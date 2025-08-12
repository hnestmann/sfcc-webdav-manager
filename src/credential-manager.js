const Store = require('electron-store');
const CryptoJS = require('crypto-js');
const crypto = require('crypto');

class CredentialManager {
  constructor() {
    this.store = null;
    this.encryptionKey = null;
    this.oauth2Manager = null; // Will be injected
    this.initializeStore();
    this.initializeEncryption();
  }

  /**
   * Set OAuth2 manager reference
   */
  setOAuth2Manager(oauth2Manager) {
    this.oauth2Manager = oauth2Manager;
  }

  /**
   * Initialize store without encryption first
   */
  initializeStore() {
    try {
      this.store = new Store({
        name: 'sfcc-webdav-manager'
      });
      this.serviceName = 'sfcc-webdav-manager';
      this.store.set('connections', this.store.get('connections', []));
      this.store.set('sensitiveData', this.store.get('sensitiveData', {}));
    } catch (error) {
      console.error('Failed to initialize store:', error);
    }
  }

  /**
   * Initialize encryption after store is created
   */
  initializeEncryption() {
    try {
      const encryptionKey = this.getOrCreateEncryptionKey();
      // Note: electron-store encryption setup is done once during store creation
      // For now, we'll handle encryption manually in our methods
    } catch (error) {
      console.error('Failed to initialize encryption:', error);
    }
  }

  /**
   * Get or create encryption key for additional security layer
   */
  getOrCreateEncryptionKey() {
    try {
      let key = this.store.get('encryptionSalt');
      if (!key) {
        key = crypto.randomBytes(32).toString('hex');
        this.store.set('encryptionSalt', key);
      }
      return key;
    } catch (error) {
      console.error('Error with encryption key:', error);
      // Return a fallback key
      return crypto.randomBytes(32).toString('hex');
    }
  }

  /**
   * Save credentials securely
   * @param {Object} credentials - The credentials object
   * @param {string} credentials.name - Connection name
   * @param {string} credentials.url - WebDAV URL
   * @param {string} credentials.authType - 'basic' or 'bearer'
   * @param {string} credentials.username - Username (for basic auth)
   * @param {string} credentials.password - Password (for basic auth)
   * @param {string} credentials.token - Bearer token (for bearer auth)
   */
  async saveCredentials(credentials) {
    try {
      console.log('CredentialManager: Saving credentials with authType:', credentials.authType);
      console.log('CredentialManager: OAuth2 fields - clientId:', credentials.clientId ? '[present]' : '[missing]', 'clientSecret:', credentials.clientSecret ? '[present]' : '[missing]');
      
      // Use existing ID if provided (for editing), otherwise generate new one
      const connectionId = credentials.id || this.generateConnectionId(credentials.name);
      
      // Store non-sensitive data in electron-store
      const publicData = {
        name: credentials.name,
        url: credentials.url,
        authType: credentials.authType,
        username: credentials.authType === 'basic' ? credentials.username : undefined,
        lastConnected: new Date().toISOString(),
        lastLocalFolder: credentials.lastLocalFolder || null,
        id: connectionId
      };

      // Store sensitive data in keytar (OS keychain)
      let sensitiveData = {};
      if (credentials.authType === 'basic') {
        sensitiveData = {
          username: credentials.username,
          password: credentials.password
        };
      } else if (credentials.authType === 'bearer') {
        sensitiveData = {
          token: credentials.token
        };
      } else if (credentials.authType === 'oauth2') {
        sensitiveData = {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret
        };
      }

      const encryptedSensitiveData = this.encryptData(JSON.stringify(sensitiveData));
      
      const allSensitiveData = this.store.get('sensitiveData', {});
      allSensitiveData[connectionId] = encryptedSensitiveData;
      this.store.set('sensitiveData', allSensitiveData);
      
      const connections = this.store.get('connections', []);
      const existingIndex = connections.findIndex(conn => conn.id === connectionId);
      
      if (existingIndex >= 0) {
        connections[existingIndex] = publicData;
      } else {
        connections.push(publicData);
      }
      
      this.store.set('connections', connections);
      
      return connectionId;
    } catch (error) {
      throw new Error(`Failed to save credentials: ${error.message}`);
    }
  }

  /**
   * Load all saved connections
   */
  async loadConnections() {
    try {
      return this.store.get('connections', []);
    } catch (error) {
      throw new Error(`Failed to load connections: ${error.message}`);
    }
  }

  /**
   * Load credentials for a specific connection
   */
  async loadCredentials(connectionId) {
    try {
      const connections = this.store.get('connections', []);
      const connection = connections.find(conn => conn.id === connectionId);
      
      if (!connection) {
        throw new Error('Connection not found');
      }

      const allSensitiveData = this.store.get('sensitiveData', {});
      const encryptedSensitiveData = allSensitiveData[connectionId];
      
      if (!encryptedSensitiveData) {
        throw new Error('Credentials not found in store. Please edit this connection to re-enter your credentials.');
      }

      // Decrypt sensitive data
      const decryptedData = this.decryptData(encryptedSensitiveData);
      const sensitiveData = JSON.parse(decryptedData);

      // Combine public and sensitive data
      const fullCredentials = {
        ...connection,
        ...sensitiveData
      };

      return fullCredentials;
    } catch (error) {
      throw new Error(`Failed to load credentials: ${error.message}`);
    }
  }

  /**
   * Delete connection credentials
   */
  async deleteCredentials(connectionId) {
    try {
      const connections = this.store.get('connections', []);
      const connectionIndex = connections.findIndex(conn => conn.id === connectionId);
      
      if (connectionIndex >= 0) {
        const connection = connections[connectionIndex];
        
        // Clean up OAuth2 tokens if this is an OAuth2 connection
        if (this.oauth2Manager && connection.authType === 'oauth2') {
          this.oauth2Manager.clearConnection(connectionId);
        }
        
        // Remove from array
        connections.splice(connectionIndex, 1);
        this.store.set('connections', connections);
        
        const allSensitiveData = this.store.get('sensitiveData', {});
        delete allSensitiveData[connectionId];
        this.store.set('sensitiveData', allSensitiveData);
        
        return true;
      }
      
      return false;
    } catch (error) {
      throw new Error(`Failed to delete credentials: ${error.message}`);
    }
  }

  /**
   * Update last connected timestamp
   */
  updateLastConnected(connectionId) {
    try {
      const connections = this.store.get('connections', []);
      const connectionIndex = connections.findIndex(conn => conn.id === connectionId);
      
      if (connectionIndex >= 0) {
        connections[connectionIndex].lastConnected = new Date().toISOString();
        this.store.set('connections', connections);
      }
    } catch (error) {
      console.error('Failed to update last connected:', error);
    }
  }

  /**
   * Update last local folder for a connection
   */
  updateLastLocalFolder(connectionId, folderPath) {
    try {
      const connections = this.store.get('connections', []);
      const connectionIndex = connections.findIndex(conn => conn.id === connectionId);
      
      if (connectionIndex >= 0) {
        connections[connectionIndex].lastLocalFolder = folderPath;
        this.store.set('connections', connections);
        console.log('CredentialManager: Updated lastLocalFolder for connection:', connectionId, 'to:', folderPath);
      }
    } catch (error) {
      console.error('Failed to update last local folder:', error);
    }
  }

  /**
   * Generate a unique connection ID
   */
  generateConnectionId(name) {
    const timestamp = Date.now().toString(); // Convert to string
    const hash = crypto.createHash('md5').update(name + timestamp).digest('hex');
    return `conn_${hash.substring(0, 8)}`;
  }

  /**
   * Encrypt data using AES
   */
  encryptData(data) {
    const key = this.store.get('encryptionSalt');
    return CryptoJS.AES.encrypt(data, key).toString();
  }

  /**
   * Decrypt data using AES
   */
  decryptData(encryptedData) {
    const key = this.store.get('encryptionSalt');
    const bytes = CryptoJS.AES.decrypt(encryptedData, key);
    return bytes.toString(CryptoJS.enc.Utf8);
  }

  /**
   * Check if any connections exist
   */
  hasConnections() {
    try {
      const connections = this.store.get('connections', []);
      return connections.length > 0;
    } catch (error) {
      console.error('Failed to check connections:', error);
      return false;
    }
  }

  /**
   * Get the most recently connected connection
   */
  async getLastConnection() {
    try {
      const connections = this.store.get('connections', []);
      if (connections.length === 0) {
        return null;
      }
      
      // Sort by lastConnected date and get the most recent
      const sortedConnections = connections.sort((a, b) => 
        new Date(b.lastConnected) - new Date(a.lastConnected)
      );
      
      return sortedConnections[0];
    } catch (error) {
      console.error('Failed to get last connection:', error);
      return null;
    }
  }

  /**
   * Delete credentials from keychain
   */
  async deleteFromKeychain(connectionId) {
    try {
      const allSensitiveData = this.store.get('sensitiveData', {});
      if (allSensitiveData[connectionId]) {
        delete allSensitiveData[connectionId];
        this.store.set('sensitiveData', allSensitiveData);
      }
    } catch (error) {
      console.error('Failed to delete from store:', error);
    }
  }

  /**
   * Save custom catalog/library IDs for a connection
   * @param {string} connectionId - Connection ID
   * @param {Array} catalogIds - Array of catalog ID strings
   * @param {Array} libraryIds - Array of library ID strings
   */
  saveCustomIds(connectionId, catalogIds = [], libraryIds = []) {
    try {
      const customIds = this.store.get('customIds', {});
      customIds[connectionId] = {
        catalogs: catalogIds,
        libraries: libraryIds,
        lastUpdated: new Date().toISOString()
      };
      this.store.set('customIds', customIds);
      console.log('CredentialManager: Saved custom IDs for connection:', connectionId, { catalogIds, libraryIds });
      return true;
    } catch (error) {
      console.error('CredentialManager: Failed to save custom IDs:', error);
      throw new Error(`Failed to save custom IDs: ${error.message}`);
    }
  }

  /**
   * Get custom catalog/library IDs for a connection
   * @param {string} connectionId - Connection ID
   * @returns {Object} Object with catalogs and libraries arrays
   */
  getCustomIds(connectionId) {
    try {
      const customIds = this.store.get('customIds', {});
      const connectionIds = customIds[connectionId];
      
      if (!connectionIds) {
        return { catalogs: [], libraries: [] };
      }
      
      return {
        catalogs: connectionIds.catalogs || [],
        libraries: connectionIds.libraries || [],
        lastUpdated: connectionIds.lastUpdated
      };
    } catch (error) {
      console.error('CredentialManager: Failed to get custom IDs:', error);
      return { catalogs: [], libraries: [] };
    }
  }

  /**
   * Add a catalog ID to a connection
   * @param {string} connectionId - Connection ID
   * @param {string} catalogId - Catalog ID to add
   */
  addCatalogId(connectionId, catalogId) {
    const currentIds = this.getCustomIds(connectionId);
    if (!currentIds.catalogs.includes(catalogId)) {
      currentIds.catalogs.push(catalogId);
      this.saveCustomIds(connectionId, currentIds.catalogs, currentIds.libraries);
    }
  }

  /**
   * Add a library ID to a connection
   * @param {string} connectionId - Connection ID
   * @param {string} libraryId - Library ID to add
   */
  addLibraryId(connectionId, libraryId) {
    const currentIds = this.getCustomIds(connectionId);
    if (!currentIds.libraries.includes(libraryId)) {
      currentIds.libraries.push(libraryId);
      this.saveCustomIds(connectionId, currentIds.catalogs, currentIds.libraries);
    }
  }

  /**
   * Remove a catalog ID from a connection
   * @param {string} connectionId - Connection ID
   * @param {string} catalogId - Catalog ID to remove
   */
  removeCatalogId(connectionId, catalogId) {
    const currentIds = this.getCustomIds(connectionId);
    const index = currentIds.catalogs.indexOf(catalogId);
    if (index > -1) {
      currentIds.catalogs.splice(index, 1);
      this.saveCustomIds(connectionId, currentIds.catalogs, currentIds.libraries);
    }
  }

  /**
   * Remove a library ID from a connection
   * @param {string} connectionId - Connection ID
   * @param {string} libraryId - Library ID to remove
   */
  removeLibraryId(connectionId, libraryId) {
    const currentIds = this.getCustomIds(connectionId);
    const index = currentIds.libraries.indexOf(libraryId);
    if (index > -1) {
      currentIds.libraries.splice(index, 1);
      this.saveCustomIds(connectionId, currentIds.catalogs, currentIds.libraries);
    }
  }

  /**
   * Clear all saved connections and credentials
   */
  async clearAll() {
    try {
      const connections = this.store.get('connections', []);
      
      this.store.clear();
      
      return true;
    } catch (error) {
      throw new Error(`Failed to clear all data: ${error.message}`);
    }
  }

  async loadCredentialsById(connectionId) {
    const connections = await this.loadConnections();
    return connections.find(c => c.id === connectionId);
  }
}

module.exports = CredentialManager; 