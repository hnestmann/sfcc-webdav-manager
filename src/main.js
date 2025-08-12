const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { promisify } = require('util');
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const CredentialManager = require('./credential-manager');
const WebDAVManager = require('./webdav-manager');
const OAuth2Manager = require('./oauth2-manager');
const CatalogManager = require('./catalog-manager');

let mainWindow;
// Create singleton manager instances
const credentialManager = new CredentialManager();
const oauth2Manager = new OAuth2Manager();
const catalogManager = new CatalogManager();
const webdavManager = new WebDAVManager();

// Link managers
credentialManager.setOAuth2Manager(oauth2Manager);
webdavManager.setOAuth2Manager(oauth2Manager); // This link was missing before

// Local ZIP operations helper functions
async function zipLocalItem(sourcePath, zipPath) {
  return new Promise((resolve, reject) => {
    const sourceDir = path.dirname(sourcePath);
    const sourceBasename = path.basename(sourcePath);
    
    // Create zip using system zip command with exclusions for macOS hidden files
    const zipArgs = [
      '-r',  // recursive
      zipPath,
      sourceBasename,
      '-x', '*.DS_Store', '.__MACOSX', '*.localized', '*.Spotlight-V100', '*.Trashes', '*.fseventsd'
    ];
    
    const zipProcess = spawn('zip', zipArgs, {
      cwd: sourceDir,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stderr = '';
    
    zipProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    zipProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ZIP process failed with code ${code}: ${stderr}`));
      }
    });
    
    zipProcess.on('error', (error) => {
      reject(new Error(`Failed to start ZIP process: ${error.message}`));
    });
  });
}

async function unzipLocalItem(zipPath, extractPath) {
  return new Promise((resolve, reject) => {
    // Ensure extract directory exists
    if (!fs.existsSync(extractPath)) {
      fs.mkdirSync(extractPath, { recursive: true });
    }
    
    // Create unzip using system unzip command
    const unzipArgs = [
      '-o',  // overwrite files without prompting
      zipPath,
      '-d', extractPath,
      '-x', '*.DS_Store', '__MACOSX/*'  // exclude macOS hidden files
    ];
    
    const unzipProcess = spawn('unzip', unzipArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stderr = '';
    
    unzipProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    unzipProcess.on('close', (code) => {
      if (code === 0 || code === 1) { // unzip returns 1 for warnings but still extracts
        resolve();
      } else {
        reject(new Error(`UNZIP process failed with code ${code}: ${stderr}`));
      }
    });
    
    unzipProcess.on('error', (error) => {
      reject(new Error(`Failed to start UNZIP process: ${error.message}`));
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    titleBarStyle: 'default',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    showConnectionSelector();
  });

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

/**
 * Check if connections exist and prompt for setup if needed
 */
async function checkAndPromptForConnection() {
  try {
    if (!credentialManager.hasConnections()) {
      // No connections exist, show welcome dialog
      const response = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Welcome to SFCC WebDAV Manager',
        message: 'No WebDAV connections found.',
        detail: 'Would you like to set up a connection to your Salesforce B2C Commerce instance?',
        buttons: ['Set Up Connection', 'Skip for Now'],
        defaultId: 0,
        cancelId: 1
      });

      if (response.response === 0) {
        // User wants to set up connection
        mainWindow.webContents.send('show-connection-dialog');
      }
    } else {
      // Try to connect to the last used connection
      const lastConnection = await credentialManager.getLastConnection();
      if (lastConnection) {
        mainWindow.webContents.send('load-last-connection', lastConnection);
      }
    }
  } catch (error) {
    console.error('Error checking connections:', error);
  }
}

/**
 * Show connection selector on startup
 */
async function showConnectionSelector() {
  try {
    // Always show the connection selector modal
    mainWindow.webContents.send('show-connection-selector');
  } catch (error) {
    console.error('Error showing connection selector:', error);
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
    // Initialize managers
    // credentialManager = new CredentialManager(); // This line is now redundant
    // oauth2Manager = new OAuth2Manager(); // This line is now redundant
    // catalogManager = new CatalogManager(); // This line is now redundant
    
    // Link managers
    // credentialManager.setOAuth2Manager(oauth2Manager); // This line is now redundant

    // Register all IPC handlers
    // Move all other ipcMain.handle(...) calls here...

    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * Extract hostname from WebDAV URL
 * @param {string} webdavUrl - WebDAV URL like 'https://bbsv-063.dx.commercecloud.salesforce.com/on/demandware.servlet/webdav/Sites/Impex'
 * @returns {string} Hostname like 'bbsv-063.dx.commercecloud.salesforce.com'
 */
function extractHostnameFromWebDAVUrl(webdavUrl) {
  if (!webdavUrl || typeof webdavUrl !== 'string') {
    throw new Error(`Invalid WebDAV URL: ${webdavUrl}`);
  }
  
  try {
    const url = new URL(webdavUrl);
    return url.hostname;
  } catch (error) {
    // Fallback parsing if URL constructor fails
    const match = webdavUrl.match(/https?:\/\/([^\/]+)/);
    if (match && match[1]) {
      return match[1];
    }
    throw new Error(`Unable to extract hostname from WebDAV URL: ${webdavUrl}`);
  }
}

// IPC Handlers
ipcMain.handle('save-credentials', async (event, credentials) => {
  try {
    await credentialManager.saveCredentials(credentials);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-credentials', async () => {
  try {
    const credentials = await credentialManager.loadCredentials();
    return { success: true, credentials };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('test-connection', async (event, credentials) => {
  try {
    const result = await webdavManager.testConnection(credentials);
    return { success: true, connected: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-directory', async (event, path) => {
  try {
    const items = await webdavManager.listDirectory(path);
    return { success: true, items };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fetch-catalogs', async (event, connectionId, currentUrl) => {
  try {
    // Get connection credentials to extract hostname and get OAuth2 token
    const credentials = await credentialManager.loadCredentials(connectionId);
    if (!credentials) {
      throw new Error('Connection not found');
    }
    
    console.log('Catalog fetch - credentials loaded:', {
      id: credentials.id,
      name: credentials.name,
      authType: credentials.authType,
      url: credentials.url,
      hasUrl: !!credentials.url
    });
    
    if (credentials.authType !== 'oauth2') {
      throw new Error('Catalog fetching requires OAuth2 authentication');
    }
    
    // Use provided current URL or fall back to stored credentials URL
    const webdavUrl = currentUrl || credentials.url;
    if (!webdavUrl) {
      throw new Error('WebDAV URL not found in connection credentials or current session');
    }
    
    console.log('Using WebDAV URL for hostname extraction:', webdavUrl);
    
    // Get OAuth2 access token
    const accessToken = await oauth2Manager.getAccessToken(
      connectionId,
      credentials.clientId,
      credentials.clientSecret
    );
    
    // Extract hostname from WebDAV URL
    const hostname = extractHostnameFromWebDAVUrl(webdavUrl);
    
    // Fetch catalogs using OCAPI
    const catalogs = await catalogManager.fetchCatalogs(connectionId, hostname, accessToken);
    
    return { success: true, catalogs };
  } catch (error) {
    console.error('Failed to fetch catalogs:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-catalog-webdav-paths', async (event, connectionId, baseUrl) => {
  try {
    const catalogs = catalogManager.getCachedCatalogs(connectionId);
    const webdavPaths = catalogManager.generateWebDAVPaths(baseUrl, catalogs);
    return { success: true, paths: webdavPaths };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Custom ID management handlers
ipcMain.handle('get-custom-ids', async (event, connectionId) => {
  try {
    const customIds = credentialManager.getCustomIds(connectionId);
    return { success: true, customIds };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('add-catalog-id', async (event, connectionId, catalogId, baseUrl) => {
  try {
    // Test if the catalog ID is valid by trying to connect
    // Extract hostname from baseUrl (same logic as CatalogManager)
    const baseMatch = baseUrl.match(/(https?:\/\/[^\/]+)/);
    if (!baseMatch) {
      throw new Error('Invalid base URL format');
    }
    const hostname = baseMatch[1];
    const testUrl = `${hostname}/on/demandware.servlet/webdav/Sites/Catalogs/${catalogId}`;
    console.log('Testing catalog ID:', catalogId, 'at URL:', testUrl);
    
    // Load credentials to test connection
    const credentials = await credentialManager.loadCredentials(connectionId);
    const testCredentials = { ...credentials, url: testUrl };
    
    // Test the connection
    const result = await webdavManager.testConnection(testCredentials);
    if (result) {
      credentialManager.addCatalogId(connectionId, catalogId);
      return { success: true, message: `Catalog '${catalogId}' added successfully` };
    } else {
      return { success: false, error: `Cannot access catalog '${catalogId}'. Check the ID and permissions.` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('add-library-id', async (event, connectionId, libraryId, baseUrl) => {
  try {
    // Test if the library ID is valid by trying to connect
    // Extract hostname from baseUrl (same logic as CatalogManager)
    const baseMatch = baseUrl.match(/(https?:\/\/[^\/]+)/);
    if (!baseMatch) {
      throw new Error('Invalid base URL format');
    }
    const hostname = baseMatch[1];
    const testUrl = `${hostname}/on/demandware.servlet/webdav/Sites/Libraries/${libraryId}`;
    console.log('Testing library ID:', libraryId, 'at URL:', testUrl);
    
    // Load credentials to test connection
    const credentials = await credentialManager.loadCredentials(connectionId);
    const testCredentials = { ...credentials, url: testUrl };
    
    // Test the connection
    const result = await webdavManager.testConnection(testCredentials);
    if (result) {
      credentialManager.addLibraryId(connectionId, libraryId);
      return { success: true, message: `Library '${libraryId}' added successfully` };
    } else {
      return { success: false, error: `Cannot access library '${libraryId}'. Check the ID and permissions.` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('remove-catalog-id', async (event, connectionId, catalogId) => {
  try {
    credentialManager.removeCatalogId(connectionId, catalogId);
    return { success: true, message: `Catalog '${catalogId}' removed` };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('remove-library-id', async (event, connectionId, libraryId) => {
  try {
    credentialManager.removeLibraryId(connectionId, libraryId);
    return { success: true, message: `Library '${libraryId}' removed` };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('download-file', async (event, remotePath, localPath) => {
  try {
    await webdavManager.downloadFile(remotePath, localPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('upload-file', async (event, localPath, remotePath) => {
  try {
    await webdavManager.uploadFile(localPath, remotePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-directory', async (event, path) => {
  try {
    await webdavManager.createDirectory(path);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-item', async (event, path) => {
  try {
    await webdavManager.deleteItem(path);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('show-save-dialog', async (event, options = {}) => {
  const dialogOptions = {
    defaultPath: options.defaultPath,
    title: options.title,
    ...options
  };
  
  // If properties include directory selection, use showOpenDialog instead
  if (options.properties && (options.properties.includes('openDirectory') || options.properties.includes('createDirectory'))) {
    const result = await dialog.showOpenDialog(mainWindow, dialogOptions);
    return result;
  } else {
    // Regular file save dialog
    const result = await dialog.showSaveDialog(mainWindow, {
      properties: ['createDirectory'],
      ...dialogOptions
    });
    return result;
  }
});

ipcMain.handle('show-open-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'openDirectory', 'multiSelections']
  });
  return result;
});

// Message box dialog
ipcMain.handle('show-message-box', async (event, options) => {
  return dialog.showMessageBox(mainWindow, options);
});

// New IPC handlers for connection management
ipcMain.handle('load-connections', async () => {
  try {
    const connections = await credentialManager.loadConnections();
    return { success: true, connections };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-credentials-by-id', async (event, connectionId) => {
  try {
    const credentials = await credentialManager.loadCredentials(connectionId);
    return { success: true, credentials };
  } catch (error) {
    console.error('Failed to load credentials by ID:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-connection', async (event, connectionId) => {
  try {
    await credentialManager.deleteCredentials(connectionId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('has-connections', async () => {
  try {
    const hasConnections = credentialManager.hasConnections();
    return { success: true, hasConnections };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// IPC handler for updating last local folder for a connection
ipcMain.handle('update-last-local-folder', async (event, connectionId, folderPath) => {
  try {
    credentialManager.updateLastLocalFolder(connectionId, folderPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// IPC handler for getting local user's home directory
ipcMain.handle('get-local-home-dir', async (event) => {
  try {
    const homeDir = os.homedir();
    return { success: true, path: homeDir };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// IPC handler for listing local directory contents
ipcMain.handle('list-local-directory', async (event, dirPath) => {
  try {
    const files = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const items = await Promise.all(files.map(async (file) => {
      try {
        const fullPath = path.join(dirPath, file.name);
        const stats = await fs.promises.stat(fullPath);
        return {
          name: file.name,
          isDirectory: file.isDirectory(),
          size: stats.size,
          mtime: stats.mtime,
          path: fullPath,
        };
      } catch (error) {
        // Skip files that can't be accessed (e.g. permissions)
        console.warn(`Skipping file due to error: ${file.name}`, error);
        return null;
      }
    }));

    const validItems = items.filter(item => item !== null);
    return { success: true, items: validItems };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ZIP/UNZIP operations
ipcMain.handle('zip-item', async (event, itemPath) => {
  try {
    const result = await webdavManager.zipItem(itemPath);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('unzip-item', async (event, itemPath) => {
  try {
    const result = await webdavManager.unzipItem(itemPath);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Local ZIP operations
ipcMain.handle('zip-local-item', async (event, sourcePath, zipPath) => {
  try {
    await zipLocalItem(sourcePath, zipPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('unzip-local-item', async (event, zipPath, extractPath) => {
  try {
    await unzipLocalItem(zipPath, extractPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Local delete operation
ipcMain.handle('delete-local-item', async (event, itemPath, isDirectory) => {
  try {
    if (isDirectory) {
      await fs.promises.rm(itemPath, { recursive: true, force: true });
    } else {
      await fs.promises.unlink(itemPath);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}); 

// Prepare files for drag-out
ipcMain.handle('prepare-dragout-files', async (event, fileData) => {
  try {
    const result = await webdavManager.prepareDragOutFiles(fileData);
    return { success: true, tempFiles: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Start native drag operation with file preparation
ipcMain.handle('start-native-dragout', async (event, fileData) => {
  try {
    const tempFiles = await webdavManager.prepareDragOutFiles(fileData);
    
    if (tempFiles.length > 0) {
      const icon = nativeImage.createFromPath(tempFiles[0]);
      event.sender.startDrag({
        file: tempFiles[0], // for single file
        files: tempFiles,   // for multiple files
        icon: icon
      });
      return { success: true };
    } else {
      return { success: false, error: 'No files were prepared for drag' };
    }
  } catch (error) {
    console.error('Failed to start native drag:', error);
    return { success: false, error: error.message };
  }
}); 

ipcMain.on('start-native-dragout-fast', async (event, fileData) => {
  try {
    // Create temp placeholders synchronously to hand paths to startDrag immediately
    const tempDir = path.join(os.tmpdir(), 'sfcc-webdav-dragout');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const placeholderFiles = fileData.map(f => {
      const clean = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const p = path.join(tempDir, clean);
      if (!fs.existsSync(p)) {
        fs.writeFileSync(p, ''); // zero-byte placeholder
      }
      return p;
    });

    // Drag icon
    let icon = nativeImage.createFromPath(placeholderFiles[0]);
    if (!icon || icon.isEmpty()) icon = nativeImage.createEmpty();

    // Start drag immediately
    if (placeholderFiles.length === 1) {
      event.sender.startDrag({ file: placeholderFiles[0], icon });
    } else {
      event.sender.startDrag({ files: placeholderFiles, icon });
    }

    // Start background downloads into the placeholders (best-effort)
    ;(async () => {
      for (let i = 0; i < fileData.length; i++) {
        const src = fileData[i];
        const dest = placeholderFiles[i];
        try {
          await webdavManager.downloadFile(src.path, dest);
        } catch (e) {
          console.error('Background download failed:', src.name, e.message);
        }
      }
    })();
  } catch (error) {
    console.error('Fast drag start failed:', error);
  }
});

// Recursive directory operations
ipcMain.handle('upload-directory-recursive', async (event, localDirPath, remoteDirPath) => {
  try {
    const results = await uploadDirectoryRecursive(localDirPath, remoteDirPath);
    return { success: true, results };
  } catch (error) {
    console.error('Failed to upload directory recursively:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('download-directory-recursive', async (event, remoteDirPath, localDirPath) => {
  try {
    const results = await downloadDirectoryRecursive(remoteDirPath, localDirPath);
    return { success: true, results };
  } catch (error) {
    console.error('Failed to download directory recursively:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-remote-directory-recursive', async (event, remotePath) => {
  try {
    const files = await listRemoteDirectoryRecursive(remotePath);
    return { success: true, files };
  } catch (error) {
    console.error('Failed to list remote directory recursively:', error);
    return { success: false, error: error.message };
  }
});

// Helper functions for recursive operations
async function uploadDirectoryRecursive(localDirPath, remoteDirPath) {
  const results = { files: 0, directories: 0, errors: [] };
  
  try {
    // Ensure remote directory exists
    await webdavManager.createDirectory(remoteDirPath);
    results.directories++;
  } catch (error) {
    // Directory might already exist, that's OK
    if (!error.message.includes('already exists')) {
      results.errors.push(`Failed to create remote directory ${remoteDirPath}: ${error.message}`);
    }
  }
  
  const localItems = fs.readdirSync(localDirPath, { withFileTypes: true });
  
  for (const item of localItems) {
    const localItemPath = path.join(localDirPath, item.name);
    const remoteItemPath = `${remoteDirPath}/${item.name}`;
    
    if (item.isDirectory()) {
      // Recursively upload subdirectory
      const subResults = await uploadDirectoryRecursive(localItemPath, remoteItemPath);
      results.files += subResults.files;
      results.directories += subResults.directories;
      results.errors.push(...subResults.errors);
    } else if (item.isFile()) {
      // Upload file
      try {
        await webdavManager.uploadFile(localItemPath, remoteItemPath);
        results.files++;
      } catch (error) {
        results.errors.push(`Failed to upload file ${localItemPath}: ${error.message}`);
      }
    }
  }
  
  return results;
}

async function downloadDirectoryRecursive(remoteDirPath, localDirPath) {
  const results = { files: 0, directories: 0, errors: [] };
  
  try {
    // Ensure local directory exists
    if (!fs.existsSync(localDirPath)) {
      fs.mkdirSync(localDirPath, { recursive: true });
      results.directories++;
    }
  } catch (error) {
    results.errors.push(`Failed to create local directory ${localDirPath}: ${error.message}`);
    return results;
  }
  
  try {
    // Get remote directory listing
    const remoteItems = await webdavManager.listDirectory(remoteDirPath);
    
    for (const item of remoteItems) {
      const localItemPath = path.join(localDirPath, item.name);
      const remoteItemPath = item.path;
      
      if (item.type === 'directory') {
        // Recursively download subdirectory
        const subResults = await downloadDirectoryRecursive(remoteItemPath, localItemPath);
        results.files += subResults.files;
        results.directories += subResults.directories;
        results.errors.push(...subResults.errors);
      } else {
        // Download file
        try {
          await webdavManager.downloadFile(remoteItemPath, localItemPath);
          results.files++;
        } catch (error) {
          results.errors.push(`Failed to download file ${remoteItemPath}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    results.errors.push(`Failed to list remote directory ${remoteDirPath}: ${error.message}`);
  }
  
  return results;
}

async function listRemoteDirectoryRecursive(remotePath) {
  const allFiles = [];
  
  try {
    const items = await webdavManager.listDirectory(remotePath);
    
    for (const item of items) {
      allFiles.push(item);
      
      if (item.type === 'directory') {
        // Recursively list subdirectory
        const subFiles = await listRemoteDirectoryRecursive(item.path);
        allFiles.push(...subFiles);
      }
    }
  } catch (error) {
    console.error(`Failed to list directory ${remotePath}:`, error);
  }
  
  return allFiles;
} 