const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Credential management
  saveCredentials: (credentials) => ipcRenderer.invoke('save-credentials', credentials),
  loadCredentials: () => ipcRenderer.invoke('load-credentials'),
  loadConnections: () => ipcRenderer.invoke('load-connections'),
  loadCredentialsById: (connectionId) => ipcRenderer.invoke('load-credentials-by-id', connectionId),
  deleteConnection: (connectionId) => ipcRenderer.invoke('delete-connection', connectionId),
  hasConnections: () => ipcRenderer.invoke('has-connections'),
  
  // WebDAV operations
  testConnection: (credentials) => ipcRenderer.invoke('test-connection', credentials),
  listDirectory: (path) => ipcRenderer.invoke('list-directory', path),
  downloadFile: (remotePath, localPath) => ipcRenderer.invoke('download-file', remotePath, localPath),
  uploadFile: (localPath, remotePath) => ipcRenderer.invoke('upload-file', localPath, remotePath),
  createDirectory: (path) => ipcRenderer.invoke('create-directory', path),
  deleteItem: (path) => ipcRenderer.invoke('delete-item', path),
  zipItem: (path) => ipcRenderer.invoke('zip-item', path),
  unzipItem: (path) => ipcRenderer.invoke('unzip-item', path),
  prepareDragOutFiles: (fileData) => ipcRenderer.invoke('prepare-dragout-files', fileData),
  startNativeDragOut: (fileData) => ipcRenderer.invoke('start-native-dragout', fileData),
  // Fast drag start (fire-and-forget) for macOS path-based drag
  startNativeDragOutFast: (fileData) => ipcRenderer.send('start-native-dragout-fast', fileData),
  startFilePromiseDrag: (files, connection) => ipcRenderer.send('start-file-promise-drag', files, connection),
  
  // Catalog operations
  fetchCatalogs: (connectionId, currentUrl) => ipcRenderer.invoke('fetch-catalogs', connectionId, currentUrl),
  getCatalogWebDAVPaths: (connectionId, baseUrl) => ipcRenderer.invoke('get-catalog-webdav-paths', connectionId, baseUrl),
  
  // Custom ID management
  getCustomIds: (connectionId) => ipcRenderer.invoke('get-custom-ids', connectionId),
  addCatalogId: (connectionId, catalogId, baseUrl) => ipcRenderer.invoke('add-catalog-id', connectionId, catalogId, baseUrl),
  addLibraryId: (connectionId, libraryId, baseUrl) => ipcRenderer.invoke('add-library-id', connectionId, libraryId, baseUrl),
  removeCatalogId: (connectionId, catalogId) => ipcRenderer.invoke('remove-catalog-id', connectionId, catalogId),
  removeLibraryId: (connectionId, libraryId) => ipcRenderer.invoke('remove-library-id', connectionId, libraryId),
  
  // File dialogs
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  showOpenDialog: () => ipcRenderer.invoke('show-open-dialog'),
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
  
  // Event listeners for main process messages
  onShowConnectionDialog: (callback) => ipcRenderer.on('show-connection-dialog', callback),
  onLoadLastConnection: (callback) => ipcRenderer.on('load-last-connection', callback),
  onShowConnectionSelector: (callback) => ipcRenderer.on('show-connection-selector', callback),
  onLocalDirectoryData: (callback) => ipcRenderer.on('local-directory-data', callback),
  
  // Local file system
  listLocalDirectory: (path) => ipcRenderer.invoke('list-local-directory', path),
  getLocalHomeDir: () => ipcRenderer.invoke('get-local-home-dir'),
  updateLastLocalFolder: (connectionId, folderPath) => ipcRenderer.invoke('update-last-local-folder', connectionId, folderPath),
  
  // Local zip/unzip operations
  zipLocalItem: (sourcePath, zipPath) => ipcRenderer.invoke('zip-local-item', sourcePath, zipPath),
  unzipLocalItem: (zipPath, extractPath) => ipcRenderer.invoke('unzip-local-item', zipPath, extractPath),
  deleteLocalItem: (itemPath, isDirectory) => ipcRenderer.invoke('delete-local-item', itemPath, isDirectory),
  
  // Recursive directory operations
  uploadDirectoryRecursive: (localDirPath, remoteDirPath) => ipcRenderer.invoke('upload-directory-recursive', localDirPath, remoteDirPath),
  downloadDirectoryRecursive: (remoteDirPath, localDirPath) => ipcRenderer.invoke('download-directory-recursive', remoteDirPath, localDirPath),
  listRemoteDirectoryRecursive: (remotePath) => ipcRenderer.invoke('list-remote-directory-recursive', remotePath),
  
  // Utility
  platform: process.platform
}); 