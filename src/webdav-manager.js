// Remove the CommonJS require and handle webdav as ES module
const fs = require('fs');
const path = require('path');
const os = require('os');

class WebDAVManager {
  constructor() {
    this.client = null;
    this.currentCredentials = null;
    this.webdavModule = null;
    this.oauth2Manager = null; // Will be injected
  }

  /**
   * Set OAuth2 manager reference
   */
  setOAuth2Manager(oauth2Manager) {
    this.oauth2Manager = oauth2Manager;
  }

  /**
   * Dynamically import webdav ES module
   */
  async loadWebDAVModule() {
    if (!this.webdavModule) {
      // Enable debug logging for HTTP requests
      const originalDebug = process.env.NODE_DEBUG;
      process.env.NODE_DEBUG = (originalDebug ? originalDebug + ',' : '') + 'http,https';
      
      console.log('WebDAV Manager - Loading WebDAV module with HTTP debugging enabled...');
      const webdav = await import('webdav');
      this.webdavModule = webdav;
      console.log('WebDAV Manager - Available WebDAV exports:', Object.keys(this.webdavModule));
    }
    return this.webdavModule;
  }

  /**
   * Initialize WebDAV client with credentials
   */
  async initializeClient(credentials) {
    await this.loadWebDAVModule();
    
    console.log('WebDAV Manager - Initializing client with URL:', credentials.url);
    console.log('WebDAV Manager - Creating client with URL:', credentials.url, 'and auth type:', credentials.authType);
    console.log('WebDAV Manager - Full credentials object:', JSON.stringify(credentials, null, 2));
    
    let authConfig = {};
    
    console.log('Webdav Token ' + credentials?.token?.substring(0, 10) + ' auth type ' + credentials.authType);

    if (credentials.authType === 'basic') {
      authConfig = {
        username: credentials.username,
        password: credentials.password
      };
    } else if (credentials.authType === 'bearer') {
      authConfig = {
        authType: this.webdavModule.AuthType.Token,
        token: {
          access_token: credentials.token,
          token_type: 'Bearer'
        }
      };
    } else if (credentials.authType === 'oauth2') {
      // Get access token from OAuth2 manager
      if (!this.oauth2Manager) {
        throw new Error('OAuth2 manager not available');
      }
      
      console.log('WebDAV Manager - Getting OAuth2 token for connection ID:', credentials.id);
      console.log('WebDAV Manager - OAuth2 credentials - clientId:', credentials.clientId ? '[present]' : '[missing]', 'clientSecret:', credentials.clientSecret ? '[present]' : '[missing]');
      
      const accessToken = await this.oauth2Manager.getAccessToken(
        credentials.id,
        credentials.clientId,
        credentials.clientSecret
      );
      
      console.log('WebDAV Manager - Received access token:', accessToken ? '[present]' : '[missing]');
      console.log('Webdav Token (truncated for security):', accessToken ? accessToken.substring(0, 10) + '...' : '[missing]');
      
      authConfig = {
        authType: this.webdavModule.AuthType.Token,
        token: {
          access_token: accessToken,
          token_type: 'Bearer'
        }
      };
      
      console.log('WebDAV Manager - Using OAuth2 access token for authentication');
      console.log('WebDAV Manager - Auth config created:', {
        hasToken: !!authConfig.token,
        tokenType: authConfig.token?.token_type,
        accessTokenLength: authConfig.token?.access_token?.length
      });
    }

    console.log('WebDAV Manager - Creating client with auth config:', {
      hasToken: !!authConfig.token,
      tokenType: authConfig.token?.token_type,
      hasUsername: !!authConfig.username,
      hasPassword: !!authConfig.password
    });
    
    // Log the complete auth config structure (for debugging)
    console.log('WebDAV Manager - Complete auth config structure:', JSON.stringify(authConfig, null, 2));
    
    this.client = this.webdavModule.createClient(credentials.url, authConfig);
    this.currentCredentials = credentials;
    
    // Try to enable debug mode for the webdav client
    if (this.client) {
      console.log('WebDAV Manager - Client methods available:', Object.getOwnPropertyNames(this.client));
      
      // Try to access underlying request configuration
      if (this.client._requester) {
        console.log('WebDAV Manager - Client has _requester');
      }
      if (this.client.options) {
        console.log('WebDAV Manager - Client options:', this.client.options);
      }
    }
  }

  /**
   * Test connection to WebDAV server
   */
  async testConnection(credentials) {
    try {
      console.log('WebDAV Manager - Testing connection to URL:', credentials.url);
      await this.initializeClient(credentials);
      
      // Try to list current directory as connection test (instead of root)
      console.log('WebDAV Manager - Attempting to list directory contents...' + JSON.stringify(credentials));
      
      // Log the exact authorization header that would be sent
      if (credentials.authType === 'bearer' || credentials.authType === 'oauth2') {
        const token = credentials.authType === 'bearer' ? credentials.token : 
          (this.currentCredentials && this.currentCredentials.authType === 'oauth2' ? 
            await this.oauth2Manager.getAccessToken(credentials.id, credentials.clientId, credentials.clientSecret) : null);
        if (token) {
          console.log('WebDAV Manager - Authorization header would be: Bearer ' + token.substring(0, 20) + '...');
        }
      } else if (credentials.authType === 'basic') {
        const auth = Buffer.from(credentials.username + ':' + credentials.password).toString('base64');
        console.log('WebDAV Manager - Authorization header would be: Basic ' + auth.substring(0, 20) + '...');
      }
      
      // Make the actual request
      const result = await this.client.getDirectoryContents('');
      console.log('WebDAV Manager - Directory listing successful, found', result.length, 'items');
      
      return true;
    } catch (error) {
      console.error('Connection test failed:', error);
      
      // If it's a 401 error and we're using OAuth2, try with a fresh token
      if (error.status === 401 && credentials.authType === 'oauth2') {
        console.log('WebDAV Manager - 401 error with OAuth2, retrying with fresh token...');
        try {
          // Force a fresh token
          await this.oauth2Manager.getAccessToken(
            credentials.id,
            credentials.clientId,
            credentials.clientSecret,
            true // Force refresh
          );
          
          console.log('WebDAV Manager - Obtained fresh token, reinitializing client...');
          await this.initializeClient(credentials);
          
          console.log('WebDAV Manager - Retrying directory listing with fresh token...');
          
          // Log the fresh token header
          const retryToken = await this.oauth2Manager.getAccessToken(credentials.id, credentials.clientId, credentials.clientSecret);
          if (retryToken) {
            console.log('WebDAV Manager - Fresh token authorization header: Bearer ' + retryToken.substring(0, 20) + '...');
          }
          
          const result = await this.client.getDirectoryContents('');
          console.log('WebDAV Manager - Fresh token retry succeeded! Found', result.length, 'items');
          return true;
        } catch (retryError) {
          console.error('WebDAV Manager - Fresh token retry also failed:', retryError);
          return false;
        }
      }
      
      return false;
    }
  }

  /**
   * List directory contents
   */
  async listDirectory(remotePath = '/') {
    try {
      if (!this.client) {
        throw new Error('WebDAV client not initialized');
      }

      const contents = await this.client.getDirectoryContents(remotePath);
      
      // Process and format directory contents
      return contents.map(item => ({
        name: item.basename,
        path: item.filename,
        type: item.type, // 'file' or 'directory'
        size: item.size,
        lastModified: item.lastmod,
        mime: item.mime || 'application/octet-stream'
      }));
    } catch (error) {
      throw new Error(`Failed to list directory: ${error.message}`);
    }
  }

  /**
   * Download file from WebDAV server
   */
  async downloadFile(remotePath, localPath) {
    try {
      if (!this.client) {
        throw new Error('WebDAV client not initialized');
      }

      const fileBuffer = await this.client.getFileContents(remotePath);
      
      // Ensure local directory exists
      const localDir = path.dirname(localPath);
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }

      fs.writeFileSync(localPath, fileBuffer);
      
      return true;
    } catch (error) {
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }

  /**
   * Upload file to WebDAV server
   */
  async uploadFile(localPath, remotePath) {
    try {
      if (!this.client) {
        throw new Error('WebDAV client not initialized');
      }

      if (!fs.existsSync(localPath)) {
        throw new Error('Local file does not exist');
      }

      const fileBuffer = fs.readFileSync(localPath);
      await this.client.putFileContents(remotePath, fileBuffer);
      
      return true;
    } catch (error) {
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  /**
   * Create directory on WebDAV server
   */
  async createDirectory(remotePath) {
    try {
      if (!this.client) {
        throw new Error('WebDAV client not initialized');
      }

      await this.client.createDirectory(remotePath);
      
      return true;
    } catch (error) {
      throw new Error(`Failed to create directory: ${error.message}`);
    }
  }

  /**
   * Delete file or directory on WebDAV server
   */
  async deleteItem(remotePath) {
    try {
      if (!this.client) {
        throw new Error('WebDAV client not initialized');
      }

      await this.client.deleteFile(remotePath);
      
      return true;
    } catch (error) {
      throw new Error(`Failed to delete item: ${error.message}`);
    }
  }

  /**
   * Move/rename file or directory
   */
  async moveItem(fromPath, toPath) {
    try {
      if (!this.client) {
        throw new Error('WebDAV client not initialized');
      }

      await this.client.moveFile(fromPath, toPath);
      
      return true;
    } catch (error) {
      throw new Error(`Failed to move item: ${error.message}`);
    }
  }

  /**
   * Copy file or directory
   */
  async copyItem(fromPath, toPath) {
    try {
      if (!this.client) {
        throw new Error('WebDAV client not initialized');
      }

      await this.client.copyFile(fromPath, toPath);
      
      return true;
    } catch (error) {
      throw new Error(`Failed to copy item: ${error.message}`);
    }
  }

  /**
   * Get file properties/stats
   */
  async getFileStats(remotePath) {
    try {
      if (!this.client) {
        throw new Error('WebDAV client not initialized');
      }

      const stats = await this.client.stat(remotePath);
      
      return {
        name: stats.basename,
        path: stats.filename,
        type: stats.type,
        size: stats.size,
        lastModified: stats.lastmod,
        mime: stats.mime || 'application/octet-stream'
      };
    } catch (error) {
      throw new Error(`Failed to get file stats: ${error.message}`);
    }
  }

  /**
   * Get SFCC standard folder structure
   */
  getSFCCFolderStructure() {
    return [
      {
        name: 'cartridges',
        path: '/cartridges',
        description: 'Custom cartridges and business logic',
        icon: 'folder-code'
      },
      {
        name: 'impex',
        path: '/impex',
        description: 'Import/Export files and data',
        icon: 'folder-exchange'
      },
      {
        name: 'catalogs',
        path: '/catalogs',
        description: 'Product catalogs and catalog data',
        icon: 'folder-database'
      },
      {
        name: 'logs',
        path: '/logs',
        description: 'Application and system logs',
        icon: 'folder-logs'
      },
      {
        name: 'static',
        path: '/static',
        description: 'Static resources (CSS, JS, images)',
        icon: 'folder-image'
      },
      {
        name: 'libraries',
        path: '/libraries',
        description: 'Shared libraries and dependencies',
        icon: 'folder-library'
      },
      {
        name: 'metadata',
        path: '/metadata',
        description: 'System and custom object metadata',
        icon: 'folder-settings'
      },
      {
        name: 'sites',
        path: '/sites',
        description: 'Site-specific configurations',
        icon: 'folder-sites'
      }
    ];
  }

  /**
   * Initialize SFCC folder structure on WebDAV server
   */
  async initializeSFCCFolders() {
    try {
      if (!this.client) {
        throw new Error('WebDAV client not initialized');
      }

      const folders = this.getSFCCFolderStructure();
      const results = [];

      for (const folder of folders) {
        try {
          // Check if folder exists
          const exists = await this.client.exists(folder.path);
          if (!exists) {
            await this.client.createDirectory(folder.path);
            results.push({ path: folder.path, status: 'created' });
          } else {
            results.push({ path: folder.path, status: 'exists' });
          }
        } catch (error) {
          results.push({ path: folder.path, status: 'error', error: error.message });
        }
      }

      return results;
    } catch (error) {
      throw new Error(`Failed to initialize SFCC folders: ${error.message}`);
    }
  }

  /**
   * Search for files by pattern
   */
  async searchFiles(searchPath = '/', pattern = '') {
    try {
      if (!this.client) {
        throw new Error('WebDAV client not initialized');
      }

      const results = [];
      
      const searchRecursive = async (currentPath) => {
        const contents = await this.client.getDirectoryContents(currentPath);
        
        for (const item of contents) {
          if (item.type === 'directory') {
            await searchRecursive(item.filename);
          } else if (item.basename.toLowerCase().includes(pattern.toLowerCase())) {
            results.push({
              name: item.basename,
              path: item.filename,
              size: item.size,
              lastModified: item.lastmod,
              mime: item.mime
            });
          }
        }
      };

      await searchRecursive(searchPath);
      return results;
    } catch (error) {
      throw new Error(`Failed to search files: ${error.message}`);
    }
  }

  /**
   * Disconnect and cleanup
   */
  disconnect() {
    this.client = null;
    this.currentCredentials = null;
  }

  /**
   * ZIP an item on the WebDAV server
   */
  async zipItem(itemPath) {
    try {
      if (!this.client || !this.currentCredentials) {
        throw new Error('WebDAV client not initialized');
      }

      console.log('ZIP operation - Item path:', itemPath);
      console.log('ZIP operation - Base URL:', this.currentCredentials.url);

      // Construct the full URL for the item
      const baseUrl = this.currentCredentials.url;
      const fullUrl = itemPath.startsWith('/') ? `${baseUrl}${itemPath}` : `${baseUrl}/${itemPath}`;
      
      console.log('ZIP operation - Full URL:', fullUrl);

      // Prepare auth headers
      let authHeaders = {};
      if (this.currentCredentials.authType === 'basic') {
        const auth = Buffer.from(`${this.currentCredentials.username}:${this.currentCredentials.password}`).toString('base64');
        authHeaders['Authorization'] = `Basic ${auth}`;
      } else if (this.currentCredentials.authType === 'bearer') {
        authHeaders['Authorization'] = `Bearer ${this.currentCredentials.token}`;
      }

      // Make POST request with method=ZIP
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...authHeaders
        },
        body: 'method=ZIP'
      });

      console.log('ZIP response status:', response.status);
      console.log('ZIP response statusText:', response.statusText);

      if (!response.ok) {
        throw new Error(`ZIP operation failed: ${response.status} ${response.statusText}`);
      }

      return { success: true, status: response.status };
    } catch (error) {
      console.error('ZIP operation failed:', error);
      throw new Error(`Failed to ZIP item: ${error.message}`);
    }
  }

  /**
   * UNZIP a ZIP file using SFCC WebDAV POST method
   */
  async unzipItem(itemPath) {
    try {
      if (!this.client || !this.currentCredentials) {
        throw new Error('WebDAV client not initialized');
      }

      console.log('UNZIP operation - Item path:', itemPath);
      console.log('UNZIP operation - Base URL:', this.currentCredentials.url);

      // Construct the full URL for the item
      const baseUrl = this.currentCredentials.url;
      const fullUrl = itemPath.startsWith('/') ? `${baseUrl}${itemPath}` : `${baseUrl}/${itemPath}`;
      
      console.log('UNZIP operation - Full URL:', fullUrl);

      // Prepare auth headers
      let authHeaders = {};
      if (this.currentCredentials.authType === 'basic') {
        const auth = Buffer.from(`${this.currentCredentials.username}:${this.currentCredentials.password}`).toString('base64');
        authHeaders['Authorization'] = `Basic ${auth}`;
      } else if (this.currentCredentials.authType === 'bearer') {
        authHeaders['Authorization'] = `Bearer ${this.currentCredentials.token}`;
      }

      // Make POST request with method=UNZIP
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...authHeaders
        },
        body: 'method=UNZIP'
      });

      console.log('UNZIP response status:', response.status);
      console.log('UNZIP response statusText:', response.statusText);

      if (!response.ok) {
        throw new Error(`UNZIP operation failed: ${response.status} ${response.statusText}`);
      }

      return { success: true, status: response.status };
    } catch (error) {
      console.error('UNZIP operation failed:', error);
      throw new Error(`Failed to UNZIP item: ${error.message}`);
    }
  }

  /**
   * Prepare files for drag-out by downloading them to temp directory
   * Optimized for speed and better file handling
   */
  async prepareDragOutFiles(fileData) {
    try {
      if (!this.client || !this.currentCredentials) {
        throw new Error('WebDAV client not initialized');
      }

      const tempDir = path.join(os.tmpdir(), 'sfcc-webdav-dragout');
      
      // Ensure temp directory exists
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      console.log('Preparing files for drag-out:', fileData.map(f => f.name));

      const tempFiles = [];

      // Download files in parallel for better performance
      const downloadPromises = fileData.map(async (file) => {
        // Clean filename for temp storage
        const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const tempFilePath = path.join(tempDir, cleanFileName);
        
        try {
          const fileBuffer = await this.client.getFileContents(file.path);
          fs.writeFileSync(tempFilePath, fileBuffer);
          console.log(`Downloaded ${file.name} to ${tempFilePath}`);
          return tempFilePath;
        } catch (error) {
          console.error(`Failed to download ${file.name}:`, error);
          return null;
        }
      });

      // Wait for all downloads to complete
      const results = await Promise.all(downloadPromises);
      
      // Filter out failed downloads
      results.forEach(filePath => {
        if (filePath) {
          tempFiles.push(filePath);
        }
      });

      return tempFiles;
    } catch (error) {
      console.error('Failed to prepare drag-out files:', error);
      throw new Error(`Failed to prepare files for drag-out: ${error.message}`);
    }
  }
}

module.exports = WebDAVManager; 