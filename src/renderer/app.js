class SFCCWebDAVManager {
    constructor() {
        this.currentPath = '/';
        this.currentConnection = null;
        this.pathHistory = [];
        this.isConnected = false;
        this.currentConnectionId = null;
        this.catalogPaths = null;
        this.isInCatalogView = false;
        this.currentCustomIdType = null; // Track whether we're adding catalog or library
        this.isInitializing = true; // Prevent modals during initialization
        this.lastSelectedIndex = -1; // For Shift+Click range selection
        this.focusedIndex = -1; // For keyboard navigation
        this.savedConnections = []; // Store saved connections
        this.shouldShowConnectionSelector = true; // Flag to show selector on startup
        
        this.initializeEventListeners();
        this.setupKeyboardNavigation();
        this.setupIPCListeners();
        this.setupSortingEventListeners();
        
        this.loadSavedConnections().then(() => {
            // Initialize hidden files toggle after DOM is ready
            this.updateHiddenFilesToggle();
            // Allow modals after initialization is complete
            setTimeout(() => {
                this.isInitializing = false;
            }, 1000);
        });

        this.localFileTableBody = document.getElementById('localFileTableBody');
        this.localBackBtn = document.getElementById('localBackBtn');
        this.localRefreshBtn = document.getElementById('localRefreshBtn');
        this.localPathBreadcrumb = document.getElementById('localPathBreadcrumb');
        this.goToHomeFolderBtn = document.getElementById('go-to-home-folder');
        this.showHiddenFilesBtn = document.getElementById('showHiddenFiles');
        this.copyToLocalBtn = document.getElementById('copyToLocalBtn');
        this.copyToRemoteBtn = document.getElementById('copyToRemoteBtn');

        this.currentLocalPath = '';
        this.localHistory = [];
        this.showHiddenFiles = false;
        this.selectedLocalFiles = new Set();
        
        // Sorting state
        this.remoteSortBy = 'name';
        this.remoteSortOrder = 'asc';
        this.localSortBy = 'name';
        this.localSortOrder = 'asc';
        this.currentRemoteItems = [];
        this.currentLocalItems = [];

        this.localBackBtn.addEventListener('click', () => this.navigateLocalBack());
        this.localRefreshBtn.addEventListener('click', () => this.loadLocalDirectory(this.currentLocalPath));
        this.goToHomeFolderBtn.addEventListener('click', () => this.loadInitialLocalDirectory());
        document.getElementById('showHiddenFiles').addEventListener('click', (e) => {
            this.showHiddenFiles = !this.showHiddenFiles;
            this.updateHiddenFilesToggle();
            this.loadLocalDirectory(this.currentLocalPath);
        });
        this.copyToLocalBtn.addEventListener('click', () => this.copySelectedToLocal());
        this.copyToRemoteBtn.addEventListener('click', () => this.copySelectedToRemote());
        
        this.localFileTableBody.addEventListener('click', (e) => {
            const row = e.target.closest('tr');
            if (row && e.target.tagName !== 'BUTTON') {
                this.updateLocalSelection(row);
            }
        });
        this.localFileTableBody.addEventListener('dblclick', (e) => {
            // Immediately stop all propagation and default behavior
            e.stopPropagation();
            e.preventDefault();
            e.stopImmediatePropagation();
            
            // Ignore double-clicks on buttons or their children
            if (e.target.closest('button') || e.target.tagName === 'BUTTON' || e.target.closest('.file-actions')) {
                return;
            }
            
            const row = e.target.closest('tr');
            if (row && row.dataset.path && row.dataset.isDirectory === 'true') {
                // Only navigate for directories
                this.loadLocalDirectory(row.dataset.path);
            }
        });

        // Set up IPC listeners and load initial data
        this.setupIPCListeners();
        
        // Ensure DOM is ready before loading local directory
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.loadInitialLocalDirectory();
                this.initializeDragAndDrop();
            });
        } else {
            this.loadInitialLocalDirectory();
            this.initializeDragAndDrop();
        }
    }

    setupIPCListeners() {
        // Listen for IPC messages from main process
        if (window.electronAPI && window.electronAPI.onShowConnectionSelector) {
            window.electronAPI.onShowConnectionSelector(() => {
                this.showConnectionSelector();
            });
        }
        
        // Handle the show-connection-dialog message (for backward compatibility)
        if (window.electronAPI && window.electronAPI.onShowConnectionDialog) {
            window.electronAPI.onShowConnectionDialog(() => {
                this.showConnectionModal();
            });
        }
    }

    setupSortingEventListeners() {
        // Remote table sorting
        const remoteHeaders = document.querySelectorAll('#fileTable thead th');
        remoteHeaders.forEach((header, index) => {
            if (index < 4) { // Skip Actions column
                header.style.cursor = 'pointer';
                header.addEventListener('click', () => {
                    const columns = ['name', 'type', 'size', 'modified'];
                    this.sortRemoteFiles(columns[index]);
                });
            }
        });

        // Local table sorting
        const localHeaders = document.querySelectorAll('#localFileTable thead th');
        localHeaders.forEach((header, index) => {
            if (index < 4) { // Skip Actions column
                header.style.cursor = 'pointer';
                header.addEventListener('click', () => {
                    const columns = ['name', 'type', 'size', 'modified'];
                    this.sortLocalFiles(columns[index]);
                });
            }
        });
    }

    initializeEventListeners() {
        // Connection modal events
        document.getElementById('connectBtn').addEventListener('click', () => this.showConnectionModal());
        document.getElementById('switchConnectionBtn').addEventListener('click', () => this.showConnectionSelector());
        document.getElementById('addNewConnectionBtn').addEventListener('click', () => {
            this.hideModal('connectionSelectorModal');
            this.showConnectionModal();
        });
        
        // Modal close events
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modalId = e.target.closest('button').dataset.modal;
                this.hideModal(modalId);
            });
        });

        // Auth type switching
        document.getElementById('authType').addEventListener('change', (e) => {
            const authType = e.target.value;
            const basicFields = document.getElementById('basicAuthFields');
            const bearerFields = document.getElementById('bearerAuthFields');
            const oauth2Fields = document.getElementById('oauth2AuthFields');
            
            // Hide all auth fields
            basicFields.style.display = 'none';
            bearerFields.style.display = 'none';
            oauth2Fields.style.display = 'none';
            
            // Show relevant fields
            if (authType === 'basic') {
                basicFields.style.display = 'block';
            } else if (authType === 'bearer') {
                bearerFields.style.display = 'block';
            } else if (authType === 'oauth2') {
                oauth2Fields.style.display = 'block';
            }
        });

        // URL input real-time preview
        document.getElementById('webdavUrl').addEventListener('input', (e) => {
            this.updateUrlPreview(e.target.value);
        });

        // Connection form
        const connectionForm = document.getElementById('connectionForm');
        if (connectionForm) {
            connectionForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveConnection();
            });
            console.log('Connection form event listener attached successfully');
        } else {
            console.error('Connection form not found!');
        }

        // Test connection
        document.getElementById('testConnectionBtn').addEventListener('click', () => {
            this.testConnection();
        });

        // File browser actions
        document.getElementById('backBtn').addEventListener('click', () => this.navigateBack());
        document.getElementById('refreshBtn').addEventListener('click', () => this.refreshCurrentDirectory());
        document.getElementById('createFolderBtn').addEventListener('click', () => this.handleCreateFolderClick());
        document.getElementById('uploadBtn').addEventListener('click', () => this.uploadFile());
        document.getElementById('downloadSelectedBtn').addEventListener('click', () => this.downloadSelectedFiles());

        // Create folder form
        document.getElementById('createFolderForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.createFolder();
        });

        // Add custom ID form
        document.getElementById('addCustomIdForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAddCustomIdForm();
        });

        // SFCC folder navigation
        document.querySelectorAll('.folder-item').forEach(item => {
            item.addEventListener('click', () => {
                const path = item.dataset.path;
                this.navigateToSFCCFolder(path);
            });
        });

        // Search
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.filterFiles(e.target.value);
        });

        // Local search
        document.getElementById('localSearchInput').addEventListener('input', (e) => {
            this.filterLocalFiles(e.target.value);
        });

        // Modal backdrop clicks
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal && modal.id !== 'connectionSelectorModal') {
                    this.hideModal(modal.id);
                }
            });
        });
    }

    setupKeyboardNavigation() {
        document.addEventListener('keydown', (e) => {
            // Only handle keyboard navigation when file table is visible and focused
            const fileTable = document.getElementById('fileTable');
            if (fileTable.classList.contains('hidden') || this.isInCatalogView) {
                return;
            }

            const allRows = document.querySelectorAll('.file-row');
            if (allRows.length === 0) return;

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    this.navigateSelection(1, e.shiftKey);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.navigateSelection(-1, e.shiftKey);
                    break;
                case 'Home':
                    e.preventDefault();
                    this.navigateToFirst(e.shiftKey);
                    break;
                case 'End':
                    e.preventDefault();
                    this.navigateToLast(e.shiftKey);
                    break;
                case 'Enter':
                    e.preventDefault();
                    this.activateSelection();
                    break;
                case 'a':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.selectAll();
                    }
                    break;
                case 'Escape':
                    this.clearSelection();
                    break;
            }
        });
    }

    navigateSelection(direction, extendSelection) {
        const allRows = document.querySelectorAll('.file-row');
        if (allRows.length === 0) return;

        // Initialize focus if not set
        if (this.focusedIndex === -1) {
            this.focusedIndex = 0;
        }

        const newIndex = Math.max(0, Math.min(allRows.length - 1, this.focusedIndex + direction));
        
        if (newIndex !== this.focusedIndex) {
            this.focusedIndex = newIndex;

            if (extendSelection) {
                // Shift+Arrow: Extend selection from last selected to focused
                if (this.lastSelectedIndex === -1) {
                    this.lastSelectedIndex = this.focusedIndex;
                }
                this.selectRange(this.lastSelectedIndex, this.focusedIndex);
            } else {
                // Arrow only: Move selection to focused item
                document.querySelectorAll('.file-row.selected').forEach(r => {
                    r.classList.remove('selected');
                });
                allRows[this.focusedIndex].classList.add('selected');
                this.lastSelectedIndex = this.focusedIndex;
            }

            this.updateFocus();
            this.updateSelectionInfo();
            this.scrollToFocused();
        }
    }

    navigateToFirst(extendSelection) {
        const allRows = document.querySelectorAll('.file-row');
        if (allRows.length === 0) return;

        if (extendSelection && this.lastSelectedIndex !== -1) {
            this.selectRange(this.lastSelectedIndex, 0);
        } else {
            document.querySelectorAll('.file-row.selected').forEach(r => {
                r.classList.remove('selected');
            });
            allRows[0].classList.add('selected');
            this.lastSelectedIndex = 0;
        }

        this.focusedIndex = 0;
        this.updateFocus();
        this.updateSelectionInfo();
        this.scrollToFocused();
    }

    navigateToLast(extendSelection) {
        const allRows = document.querySelectorAll('.file-row');
        if (allRows.length === 0) return;

        const lastIndex = allRows.length - 1;

        if (extendSelection && this.lastSelectedIndex !== -1) {
            this.selectRange(this.lastSelectedIndex, lastIndex);
        } else {
            document.querySelectorAll('.file-row.selected').forEach(r => {
                r.classList.remove('selected');
            });
            allRows[lastIndex].classList.add('selected');
            this.lastSelectedIndex = lastIndex;
        }

        this.focusedIndex = lastIndex;
        this.updateFocus();
        this.updateSelectionInfo();
        this.scrollToFocused();
    }

    activateSelection() {
        const allRows = document.querySelectorAll('.file-row');
        if (this.focusedIndex >= 0 && allRows[this.focusedIndex]) {
            const row = allRows[this.focusedIndex];
            const path = row.dataset.path;
            const type = row.dataset.type;
            
            if (type === 'directory') {
                this.navigateToPath(path);
            } else {
                this.downloadFile(path);
            }
        }
    }

    selectAll() {
        const allRows = document.querySelectorAll('.file-row');
        allRows.forEach(row => {
            row.classList.add('selected');
        });
        this.updateSelectionInfo();
    }

    clearSelection() {
        document.querySelectorAll('.file-row.selected').forEach(r => {
            r.classList.remove('selected');
        });
        this.lastSelectedIndex = -1;
        this.updateSelectionInfo();
    }

    scrollToFocused() {
        const allRows = document.querySelectorAll('.file-row');
        if (this.focusedIndex >= 0 && allRows[this.focusedIndex]) {
            allRows[this.focusedIndex].scrollIntoView({
                behavior: 'smooth',
                block: 'nearest'
            });
        }
    }

    async loadSavedConnections() {
        try {
            console.log('Loading saved connections...');
            const result = await window.electronAPI.loadConnections();
            console.log('Load connections result:', result);
            console.log('Result success:', result?.success);
            console.log('Connections array:', result?.connections);
            if (result.success && result.connections) {
                this.savedConnections = result.connections;
                console.log('Saved connections loaded:', this.savedConnections.length, 'connections');
                // Check if we should show connection selector on startup
                if (this.shouldShowConnectionSelector) {
                    console.log('Showing connection selector');
                    this.showConnectionSelector();
                    this.shouldShowConnectionSelector = false;
                }
            } else {
                console.log('No connections found or failed to load');
            }
        } catch (error) {
            console.error('Failed to load saved connections:', error);
        }
    }

    showConnectionSelector() {
        console.log('showConnectionSelector called, savedConnections:', this.savedConnections?.length || 0);
        // Hide add-connection modal to avoid overlap
        this.hideModal('connectionModal');
        if (!this.savedConnections || this.savedConnections.length === 0) {
            console.log('No saved connections, showing connection modal instead');
            // No connections available, hide the selector and show the add connection modal directly
            this.hideModal('connectionSelectorModal');
            this.showConnectionModal();
            return;
        }

        console.log('Rendering connection selector with', this.savedConnections.length, 'connections');
        this.renderConnectionSelector();
        this.showModal('connectionSelectorModal');
    }

    renderConnectionSelector() {
        const container = document.getElementById('connectionSelectorList');
        
        if (!this.savedConnections || this.savedConnections.length === 0) {
            container.innerHTML = `
                <div class="no-connections-selector">
                    <i class="fas fa-cloud"></i>
                    <h3>No Connections</h3>
                    <p>Add your first WebDAV connection to get started</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.savedConnections.map(connection => {
            let authBadge = '';
            if (connection.authType === 'bearer') {
                authBadge = '<span class="selector-auth-badge">Token</span>';
            } else if (connection.authType === 'oauth2') {
                authBadge = '<span class="selector-auth-badge oauth2">OAuth2</span>';
            } else {
                authBadge = '<span class="selector-auth-badge">Basic</span>';
            }

            return `
                <div class="connection-selector-item" data-connection-id="${connection.id}">
                    <div class="selector-connection-name">${connection.name}</div>
                    <div class="selector-connection-url">${connection.url}</div>
                    <div class="selector-connection-meta">
                        <div class="selector-auth-info">${authBadge}</div>
                        <div class="selector-connection-actions">
                            <button class="icon-btn edit-connection-btn" title="Edit" data-connection-id="${connection.id}">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="icon-btn delete-connection-btn" title="Delete" data-connection-id="${connection.id}">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Attach event listeners
        container.querySelectorAll('.connection-selector-item').forEach(item => {
            const connectionId = item.dataset.connectionId;
            
            item.addEventListener('click', (e) => {
                // Don't connect if clicking on action buttons
                if (e.target.closest('.selector-connection-actions')) {
                    return;
                }
                
                this.selectAndConnect(connectionId);
            });

            item.querySelector('.edit-connection-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.hideModal('connectionSelectorModal');
                this.editConnection(connectionId);
            });

            item.querySelector('.delete-connection-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteConnectionFromSelector(connectionId);
            });
        });
    }

    async selectAndConnect(connectionId) {
        try {
            this.hideModal('connectionSelectorModal');
            this.showNotification('info', 'Connecting...', 'Establishing connection...');
            
            const credentials = await this.loadConnectionCredentials(connectionId);
            const result = await window.electronAPI.testConnection(credentials);
            
            if (result.success && result.connected) {
                this.currentConnection = credentials;
                this.currentConnectionId = connectionId;
                this.isConnected = true;
                this.updateConnectionStatus(true, credentials.name);
                this.navigateToPath('/');
                
                // Navigate to last local folder if available
                if (credentials.lastLocalFolder) {
                    console.log('Navigating to last local folder:', credentials.lastLocalFolder);
                    this.loadLocalDirectory(credentials.lastLocalFolder);
                } else {
                    // Load home directory as default
                    this.loadInitialLocalDirectory();
                }
                
                this.showNotification('success', 'Connected', `Connected to ${credentials.name}`);
            } else {
                this.showNotification('error', 'Connection Failed', 'Failed to connect to the server.');
                // Show selector again on failure
                setTimeout(() => this.showConnectionSelector(), 1000);
            }
        } catch (error) {
            this.showNotification('error', 'Connection Failed', error.message);
            // Show selector again on failure
            setTimeout(() => this.showConnectionSelector(), 1000);
        }
    }

    async deleteConnectionFromSelector(connectionId) {
        const connection = this.savedConnections.find(c => c.id === connectionId);
        const confirmed = confirm(`Are you sure you want to delete "${connection?.name}"? This action cannot be undone.`);
        
        if (confirmed) {
            try {
                const result = await window.electronAPI.deleteConnection(connectionId);
                if (result.success) {
                    this.showNotification('success', 'Connection Deleted', 'Connection has been deleted successfully.');
                    
                    // If this was the current connection, disconnect
                    if (this.currentConnection && this.currentConnection.id === connectionId) {
                        this.currentConnection = null;
                        this.currentConnectionId = null;
                        this.isConnected = false;
                        this.isInCatalogView = false;
                        this.catalogPaths = null;
                        this.updateConnectionStatus(false);
                        
                        // Show not connected state
                        document.getElementById('notConnected').classList.remove('hidden');
                        document.getElementById('fileTable').classList.add('hidden');
                    }
                    
                    // Reload connections and refresh selector
                    await this.loadSavedConnections();
                    this.renderConnectionSelector();
                } else {
                    this.showNotification('error', 'Delete Failed', result.error || 'Failed to delete connection.');
                }
            } catch (error) {
                console.error('Failed to delete connection:', error);
                this.showNotification('error', 'Delete Failed', error.message);
            }
        }
    }

    renderSavedConnections(connections) {
        // This method is no longer needed as we use the connection selector instead
        // Keep it for backward compatibility but make it a no-op
        this.savedConnections = connections;
    }

    showConnectionModal() {
        // Ensure selector is hidden to avoid overlap
        this.hideModal('connectionSelectorModal');
        this.showModal('connectionModal');
        this.resetConnectionForm();
    }

    handleCreateFolderClick() {
        if (this.isInCatalogView) {
            // In catalog/library view - show add custom ID modal
            if (this.currentPath === '/catalogs') {
                this.currentCustomIdType = 'catalog';
                this.updateCustomIdModal();
                this.showModal('addCustomIdModal');
            } else if (this.currentPath === '/libraries') {
                this.currentCustomIdType = 'library';
                this.updateCustomIdModal();
                this.showModal('addCustomIdModal');
            }
        } else {
            // Normal folder view - show create folder modal
            this.showCreateFolderModal();
        }
    }

    showCreateFolderModal() {
        if (!this.isConnected) {
            this.showNotification('error', 'Not Connected', 'Please connect to a WebDAV server first.');
            return;
        }
        this.showModal('createFolderModal');
        document.getElementById('folderName').value = '';
    }

    showModal(modalId) {
        document.getElementById(modalId).classList.remove('hidden');
    }

    hideModal(modalId) {
        document.getElementById(modalId).classList.add('hidden');
    }



    resetConnectionForm() {
        document.getElementById('connectionForm').reset();
        
        // Reset to basic auth and hide all other auth fields
        document.getElementById('authType').value = 'basic';
        document.getElementById('basicAuthFields').style.display = 'block';
        document.getElementById('bearerAuthFields').style.display = 'none';
        document.getElementById('oauth2AuthFields').style.display = 'none';
        
        this.updateUrlPreview(''); // Reset URL preview
        this.editingConnectionId = null; // Clear editing state
    }

    async saveConnection() {
        const formData = new FormData(document.getElementById('connectionForm'));
        const authType = formData.get('authType');
        
        const credentials = {
            name: formData.get('connectionName'),
            url: this.normalizeWebDAVUrl(formData.get('webdavUrl')),
            authType: authType
        };

        // If editing an existing connection, include the ID
        if (this.editingConnectionId) {
            credentials.id = this.editingConnectionId;
        }

        if (authType === 'basic') {
            credentials.username = formData.get('username');
            credentials.password = formData.get('password');
        } else if (authType === 'bearer') {
            credentials.token = formData.get('bearerToken');
        } else if (authType === 'oauth2') {
            credentials.clientId = formData.get('clientId');
            credentials.clientSecret = formData.get('clientSecret');
            credentials.refreshToken = formData.get('refreshToken');
        }

        try {
            const result = await window.electronAPI.saveCredentials(credentials);
            if (result.success) {
                const message = this.editingConnectionId ? 'Connection updated successfully.' : 'Connection has been saved successfully.';
                this.showNotification('success', 'Connection Saved', message);
                this.hideModal('connectionModal');
                
                // Reload connections
                await this.loadSavedConnections();
                
                // If we're not currently connected and this is a new connection, show the selector
                if (!this.isConnected && !this.editingConnectionId) {
                    this.showConnectionSelector();
                }
                
                // Clear editing state
                this.editingConnectionId = null;
            } else {
                this.showNotification('error', 'Save Failed', result.error || 'Failed to save connection.');
            }
        } catch (error) {
            this.showNotification('error', 'Save Failed', error.message);
        }
    }

    /**
     * Normalize URL input to create proper WebDAV URL
     */
    normalizeWebDAVUrl(input) {
        if (!input) return '';
        
        // Remove whitespace
        input = input.trim();
        
        // If it's already a full WebDAV URL, extract hostname and rebuild with /Sites/Impex
        if (input.includes('/webdav') || input.includes('servlet')) {
            // Extract hostname from the URL
            let url;
            try {
                url = new URL(input.startsWith('http') ? input : 'https://' + input);
                const hostname = url.hostname;
                return `https://${hostname}/on/demandware.servlet/webdav/Sites/Impex`;
            } catch (e) {
                // If URL parsing fails, try to extract hostname manually
                const match = input.match(/(?:https?:\/\/)?([^\/]+)/);
                if (match) {
                    const hostname = match[1];
                    return `https://${hostname}/on/demandware.servlet/webdav/Sites/Impex`;
                }
            }
        }
        
        // If it looks like a hostname/domain, construct the WebDAV URL
        let hostname = input;
        
        // Remove protocol if present
        hostname = hostname.replace(/^https?:\/\//, '');
        
        // Remove trailing slash
        hostname = hostname.replace(/\/$/, '');
        
        // Construct full WebDAV URL for SFCC using /Sites/Impex
        return `https://${hostname}/on/demandware.servlet/webdav/Sites/Impex`;
    }

    async testConnection() {
        const formData = new FormData(document.getElementById('connectionForm'));
        const authType = formData.get('authType');
        
        // Get raw URL input
        const rawUrl = formData.get('webdavUrl');
        console.log('Raw URL input:', rawUrl);
        
        // Normalize the URL
        const normalizedUrl = this.normalizeWebDAVUrl(rawUrl);
        console.log('Normalized URL:', normalizedUrl);
        
        const credentials = {
            url: normalizedUrl,
            authType: authType
        };

        if (authType === 'basic') {
            credentials.username = formData.get('username');
            credentials.password = formData.get('password');
        } else if (authType === 'bearer') {
            credentials.token = formData.get('bearerToken');
        } else if (authType === 'oauth2') {
            credentials.clientId = formData.get('clientId');
            credentials.clientSecret = formData.get('clientSecret');
            credentials.refreshToken = formData.get('refreshToken');
        }

        // Debug logging
        console.log('Testing connection with:', {
            url: credentials.url,
            authType: credentials.authType,
            hasUsername: !!credentials.username,
            hasPassword: !!credentials.password,
            hasToken: !!credentials.token
        });

        const testBtn = document.getElementById('testConnectionBtn');
        const originalText = testBtn.innerHTML;
        testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
        testBtn.disabled = true;

        try {
            const result = await window.electronAPI.testConnection(credentials);
            if (result.success && result.connected) {
                this.showNotification('success', 'Connection Test', 'Connection successful!');
            } else {
                console.error('Connection test failed:', result);
                this.showNotification('error', 'Connection Test', result.error || 'Connection failed. Please check your credentials.');
            }
        } catch (error) {
            console.error('Connection test error:', error);
            this.showNotification('error', 'Connection Test', error.message);
        } finally {
            testBtn.innerHTML = originalText;
            testBtn.disabled = false;
        }
    }

    async connectToServer(connectionId) {
        // This method is now only used internally - external calls should use selectAndConnect
        return this.selectAndConnect(connectionId);
    }

    async loadConnectionCredentials(connectionId) {
        const result = await window.electronAPI.loadCredentialsById(connectionId);
        if (result.success && result.credentials) {
            return result.credentials;
        }
        throw new Error('Connection not found');
    }

    async editConnection(connectionId) {
        try {
            // Load the connection credentials
            const credentials = await window.electronAPI.loadCredentialsById(connectionId);
            
            if (credentials) {
                // Fill the form with existing data
                document.getElementById('connectionName').value = credentials.name || '';
                document.getElementById('webdavUrl').value = credentials.url || '';
                document.getElementById('authType').value = credentials.authType || 'basic';
                
                // Show appropriate auth fields and fill them
                const authType = credentials.authType || 'basic';
                
                // Hide all auth fields first
                document.getElementById('basicAuthFields').style.display = 'none';
                document.getElementById('bearerAuthFields').style.display = 'none';
                document.getElementById('oauth2AuthFields').style.display = 'none';
                
                // Show and fill appropriate fields
                if (authType === 'basic') {
                    document.getElementById('basicAuthFields').style.display = 'block';
                    document.getElementById('username').value = credentials.username || '';
                    document.getElementById('password').value = ''; // Don't pre-fill password for security
                } else if (authType === 'bearer') {
                    document.getElementById('bearerAuthFields').style.display = 'block';
                    document.getElementById('bearerToken').value = ''; // Don't pre-fill token for security
                } else if (authType === 'oauth2') {
                    document.getElementById('oauth2AuthFields').style.display = 'block';
                    document.getElementById('clientId').value = credentials.clientId || '';
                    document.getElementById('clientSecret').value = ''; // Don't pre-fill secret for security
                }
                
                this.updateUrlPreview(credentials.url);
                
                // Store the connection ID for updating
                this.editingConnectionId = connectionId;
                
                // Show the modal
                document.getElementById('connectionModal').style.display = 'block';
            }
        } catch (error) {
            console.error('Failed to load connection for editing:', error);
            this.showNotification('error', 'Load Failed', 'Could not load connection details');
        }
    }

    async deleteConnection(connectionId) {
        // Redirect to the new selector-based delete method
        return this.deleteConnectionFromSelector(connectionId);
    }

    updateConnectionStatus(connected, connectionName = '') {
        const notConnectedEl = document.getElementById('notConnected');
        const fileTableEl = document.getElementById('fileTable');
        const statusElement = document.getElementById('connectionStatus');
        const switchBtn = document.getElementById('switchConnectionBtn');
        
        if (connected) {
            statusElement.className = 'status-connected';
            statusElement.innerHTML = `<i class="fas fa-circle"></i> Connected to ${connectionName}`;
            
            // Update switch connection button to show current connection
            switchBtn.innerHTML = `<i class="fas fa-exchange-alt"></i> ${connectionName}`;
            switchBtn.title = `Currently connected to ${connectionName}. Click to switch connections.`;
            if (notConnectedEl) notConnectedEl.classList.add('hidden');
            if (fileTableEl) fileTableEl.classList.remove('hidden');
        } else {
            statusElement.className = 'status-disconnected';
            statusElement.innerHTML = '<i class="fas fa-circle"></i> Disconnected';
            
            // Reset switch connection button
            switchBtn.innerHTML = '<i class="fas fa-exchange-alt"></i> Switch Connection';
            switchBtn.title = 'Switch Connection';
            if (notConnectedEl) notConnectedEl.classList.remove('hidden');
            if (fileTableEl) fileTableEl.classList.add('hidden');
        }
    }

    async navigateToPath(path) {
        if (!this.isConnected) {
            this.showNotification('error', 'Not Connected', 'Please connect to a WebDAV server first.');
            return;
        }

        // Check if we're clicking on a catalog virtual folder
        if (this.isInCatalogView && this.catalogPaths) {
            const catalogPath = this.catalogPaths.find(cp => cp.catalogId === path);
            if (catalogPath) {
                await this.navigateToCatalog(catalogPath);
                return;
            }
        }

        this.showLoading(true);
        
        try {
            const result = await window.electronAPI.listDirectory(path);
            this.pathHistory.push(this.currentPath);
            this.currentPath = path;
            this.updateFileListView(result); // Use the centralized UI update method
            this.updateBreadcrumb(path);
            this.updateBackButton();
        } catch (error) {
            this.showNotification('error', 'Navigation Failed', error.message);
        } finally {
            this.showLoading(false);
        }
    }

    renderFileList(items) {
        // Store items for sorting
        this.currentRemoteItems = items || [];
        
        const tbody = document.getElementById('fileTableBody');
        
        if (!items || items.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; padding: 40px; color: #6c757d;">
                        <i class="fas fa-folder-open" style="font-size: 24px; margin-bottom: 8px; display: block;"></i>
                        This directory is empty
                    </td>
                </tr>
            `;
            document.getElementById('remoteFileCount').innerHTML = '<i class="fas fa-cloud"></i> Remote: 0 items';
            return;
        }

        // Apply sorting
        const sortedItems = this.getSortedItems(items, this.remoteSortBy, this.remoteSortOrder);

        tbody.innerHTML = sortedItems.map(item => {
            const icon = this.getFileIcon(item);
            const size = item.type === 'directory' ? '-' : this.formatFileSize(item.size);
            const date = new Date(item.lastModified).toLocaleDateString();
            
            // Determine ZIP/UNZIP actions based on file type and extension
            let zipUnzipActions = '';
            if (item.type === 'directory') {
                // Folders can be zipped
                zipUnzipActions = '<button class="icon-btn zip-btn" title="ZIP Folder"><i class="fas fa-file-archive"></i></button>';
            } else if (item.name.toLowerCase().endsWith('.zip')) {
                // ZIP files can be unzipped
                zipUnzipActions = '<button class="icon-btn unzip-btn" title="UNZIP"><i class="fas fa-expand-arrows-alt"></i></button>';
            } else {
                // Regular files can be zipped
                zipUnzipActions = '<button class="icon-btn zip-btn" title="ZIP File"><i class="fas fa-file-archive"></i></button>';
            }
            
            return `
                <tr class="file-row" data-path="${item.path}" data-type="${item.type}" data-name="${item.name}" draggable="true">
                    <td>
                        <div class="file-name">
                            <i class="${icon} file-icon"></i>
                            ${item.name}
                        </div>
                    </td>
                    <td>${item.type === 'directory' ? 'Folder' : 'File'}</td>
                    <td class="file-size">${size}</td>
                    <td class="file-date">${date}</td>
                    <td>
                        <div class="file-actions">
                            ${item.type === 'file' ? '<button class="icon-btn download-btn" title="Download"><i class="fas fa-download"></i></button>' : ''}
                            ${zipUnzipActions}
                            <button class="icon-btn delete-btn" title="Delete"><i class="fas fa-trash"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // Attach event listeners
        document.querySelectorAll('.file-row').forEach((row, index) => {
            // Set data index for keyboard navigation
            row.dataset.index = index;
            
            row.addEventListener('click', (e) => {
                e.preventDefault();
                const currentIndex = parseInt(row.dataset.index);
                
                if (e.shiftKey && this.lastSelectedIndex !== -1) {
                    // Shift+Click: Select range from last selected to current
                    this.selectRange(this.lastSelectedIndex, currentIndex);
                } else if (e.ctrlKey || e.metaKey) {
                    // Ctrl/Cmd+Click: Toggle individual selection
                    row.classList.toggle('selected');
                    this.lastSelectedIndex = currentIndex;
                } else {
                    // Regular click: Select only this item
                    document.querySelectorAll('.file-row.selected').forEach(r => {
                        r.classList.remove('selected');
                    });
                    row.classList.add('selected');
                    this.lastSelectedIndex = currentIndex;
                }
                
                this.focusedIndex = currentIndex;
                this.updateFocus();
                this.updateSelectionInfo();
            });

            row.addEventListener('dblclick', (e) => {
                // Don't trigger double-click if multiple items are selected
                const selectedRows = document.querySelectorAll('.file-row.selected');
                if (selectedRows.length > 1) {
                    return;
                }

                const path = row.dataset.path;
                const type = row.dataset.type;
                
                if (type === 'directory') {
                    this.navigateToPath(path);
                } else {
                    // Double-click file to download it
                    this.downloadFile(path);
                }
            });

            // Drag start event for cross-panel transfer
            row.addEventListener('dragstart', (e) => {
                const selectedRows = Array.from(document.querySelectorAll('#fileTableBody .file-row.selected'));
                const draggedFiles = selectedRows.length > 0 && selectedRows[0] === row 
                    ? selectedRows 
                    : [row];

                const fileData = draggedFiles.map(r => ({
                    name: r.dataset.name,
                    path: r.dataset.path,
                    isDirectory: r.dataset.type === 'directory'
                }));
                
                e.dataTransfer.setData('application/json', JSON.stringify({
                    files: fileData,
                    sourceType: 'remote'
                }));
                
                draggedFiles.forEach(r => r.classList.add('dragging'));
            });

            row.addEventListener('dragend', async (e) => {
                // Clean up visual feedback
                document.querySelectorAll('.file-row.dragging').forEach(r => {
                    r.classList.remove('dragging');
                });
            });
        });

        document.querySelectorAll('.download-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const row = e.target.closest('.file-row');
                this.downloadFile(row.dataset.path);
            });
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const row = e.target.closest('.file-row');
                this.deleteItem(row.dataset.path);
            });
        });

        document.querySelectorAll('.zip-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const row = e.target.closest('.file-row');
                this.zipItem(row.dataset.path, row.dataset.name);
            });
        });

        document.querySelectorAll('.unzip-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const row = e.target.closest('.file-row');
                this.unzipItem(row.dataset.path, row.dataset.name);
            });
        });

        document.getElementById('remoteFileCount').innerHTML = `<i class="fas fa-cloud"></i> Remote: ${items.length} item${items.length !== 1 ? 's' : ''}`;
        
        // Update sort indicators
        this.updateSortIndicators('remote');
        
        // Clear search input when directory changes
        const searchInput = document.getElementById('searchInput');
        if (searchInput && searchInput.value) {
            searchInput.value = '';
        }
        
        // Update selection info
        this.updateSelectionInfo();
    }

    selectRange(startIndex, endIndex) {
        const start = Math.min(startIndex, endIndex);
        const end = Math.max(startIndex, endIndex);
        
        // Clear all selections first
        document.querySelectorAll('.file-row.selected').forEach(r => {
            r.classList.remove('selected');
        });
        
        // Select the range
        const allRows = document.querySelectorAll('.file-row');
        for (let i = start; i <= end; i++) {
            if (allRows[i]) {
                allRows[i].classList.add('selected');
            }
        }
    }

    updateFocus() {
        // Remove focus from all rows
        document.querySelectorAll('.file-row').forEach(row => {
            row.classList.remove('focused');
        });
        
        // Add focus to current row
        const allRows = document.querySelectorAll('.file-row');
        if (this.focusedIndex >= 0 && allRows[this.focusedIndex]) {
            allRows[this.focusedIndex].classList.add('focused');
        }
    }

    updateSelectionInfo() {
        const selectedRows = document.querySelectorAll('.file-row.selected');
        const remoteFileCountElement = document.getElementById('remoteFileCount');
        const downloadBtn = document.getElementById('downloadSelectedBtn');
        const selectionCount = downloadBtn.querySelector('.selection-count');
        const totalItems = document.querySelectorAll('.file-row').length;
        
        // Filter only files (not directories) for download
        const selectedFiles = Array.from(selectedRows).filter(row => row.dataset.type === 'file');
        
        if (selectedFiles.length > 0) {
            // Show download button with count
            downloadBtn.classList.remove('hidden');
            selectionCount.textContent = selectedFiles.length > 1 ? ` (${selectedFiles.length})` : '';
            
            remoteFileCountElement.innerHTML = `<i class="fas fa-cloud"></i> Remote: ${totalItems} item${totalItems !== 1 ? 's' : ''} (${selectedRows.length} selected)`;
        } else {
            // Hide download button
            downloadBtn.classList.add('hidden');
            selectionCount.textContent = '';
            
            remoteFileCountElement.innerHTML = `<i class="fas fa-cloud"></i> Remote: ${totalItems} item${totalItems !== 1 ? 's' : ''}`;
        }
        
        this.updateCopyButtons();
    }

    getFileIcon(item) {
        if (item.type === 'directory') {
            return 'fas fa-folder';
        }
        
        const ext = item.name.split('.').pop().toLowerCase();
        const iconMap = {
            'js': 'fab fa-js-square',
            'ts': 'fas fa-file-code',
            'json': 'fas fa-file-code',
            'xml': 'fas fa-file-code',
            'html': 'fab fa-html5',
            'css': 'fab fa-css3-alt',
            'scss': 'fab fa-sass',
            'jpg': 'fas fa-file-image',
            'jpeg': 'fas fa-file-image',
            'png': 'fas fa-file-image',
            'gif': 'fas fa-file-image',
            'svg': 'fas fa-file-image',
            'pdf': 'fas fa-file-pdf',
            'doc': 'fas fa-file-word',
            'docx': 'fas fa-file-word',
            'xls': 'fas fa-file-excel',
            'xlsx': 'fas fa-file-excel',
            'zip': 'fas fa-file-archive',
            'rar': 'fas fa-file-archive',
            '7z': 'fas fa-file-archive'
        };
        
        return iconMap[ext] || 'fas fa-file';
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    updateBreadcrumb(path) {
        const breadcrumb = document.getElementById('pathBreadcrumb');
        
        // Special handling for catalog view
        if (this.isInCatalogView && path === '/catalogs') {
            breadcrumb.innerHTML = '<span class="path-segment root">Catalogs</span>';
            this.updateCreateFolderButton('catalog');
            return;
        }
        
        // Special handling for library view
        if (this.isInCatalogView && path === '/libraries') {
            breadcrumb.innerHTML = '<span class="path-segment root">Libraries</span>';
            this.updateCreateFolderButton('library');
            return;
        }
        
        // Normal view - reset button to create folder
        this.updateCreateFolderButton('folder');
        
        const segments = path.split('/').filter(segment => segment !== '');
        
        // Get the current endpoint name from the URL
        let rootName = 'Root';
        if (this.currentConnection && this.currentConnection.url) {
            const urlParts = this.currentConnection.url.split('/');
            // Find the last meaningful segment (e.g., "Logs" from ".../webdav/Logs")
            for (let i = urlParts.length - 1; i >= 0; i--) {
                const part = urlParts[i];
                // Only consider valid SFCC WebDAV endpoints
                if (part && !part.startsWith('.') && part !== 'webdav' && ['Logs', 'Cartridges', 'Libraries', 'Static', 'Catalogs', 'Import/Export', 'Temp'].includes(part)) {
                    rootName = part;
                    break;
                }
            }
        }
        
        if (segments.length === 0) {
            breadcrumb.innerHTML = `<span class="path-segment root">${rootName}</span>`;
            return;
        }
        
        let currentPath = '';
        const breadcrumbHtml = [`<span class="path-segment root" data-path="/">${rootName}</span>`];
        
        segments.forEach(segment => {
            currentPath += '/' + segment;
            breadcrumbHtml.push(`<span class="path-separator">/</span>`);
            breadcrumbHtml.push(`<span class="path-segment" data-path="${currentPath}">${segment}</span>`);
        });
        
        breadcrumb.innerHTML = breadcrumbHtml.join('');
        
        // Attach click listeners to breadcrumb segments
        breadcrumb.querySelectorAll('.path-segment').forEach(segment => {
            segment.addEventListener('click', () => {
                const path = segment.dataset.path;
                if (path) {
                    this.navigateToPath(path);
                }
            });
        });
    }

    updateCreateFolderButton(type) {
        const button = document.getElementById('createFolderBtn');
        const icon = button.querySelector('i');
        
        if (type === 'catalog') {
            icon.className = 'fas fa-plus-square';
            button.title = 'Add Catalog';
        } else if (type === 'library') {
            icon.className = 'fas fa-plus-square';
            button.title = 'Add Library';
        } else {
            // Default folder creation
            icon.className = 'fas fa-folder-plus';
            button.title = 'Create Folder';
        }
    }

    updateBackButton() {
        const backBtn = document.getElementById('backBtn');
        backBtn.disabled = this.pathHistory.length === 0;
    }

    navigateBack() {
        if (this.pathHistory.length > 0) {
            const previousPath = this.pathHistory.pop();
            this.currentPath = previousPath;
            this.navigateToPath(previousPath);
        }
    }

    refreshCurrentDirectory() {
        this.navigateToPath(this.currentPath);
    }

    async createFolder() {
        const folderName = document.getElementById('folderName').value.trim();
        if (!folderName) {
            this.showNotification('error', 'Invalid Name', 'Please enter a folder name.');
            return;
        }

        const newPath = this.currentPath === '/' ? `/${folderName}` : `${this.currentPath}/${folderName}`;
        
        try {
            const result = await window.electronAPI.createDirectory(newPath);
            if (result.success) {
                this.showNotification('success', 'Folder Created', `Folder "${folderName}" created successfully.`);
                this.hideModal('createFolderModal');
                this.refreshCurrentDirectory();
            } else {
                this.showNotification('error', 'Creation Failed', result.error || 'Failed to create folder.');
            }
        } catch (error) {
            this.showNotification('error', 'Creation Failed', error.message);
        }
    }

    async uploadFile() {
        if (!this.isConnected) {
            this.showNotification('error', 'Not Connected', 'Please connect to a WebDAV server first.');
            return;
        }

        try {
            const result = await window.electronAPI.showOpenDialog();
            if (!result.canceled && result.filePaths.length > 0) {
                const localPath = result.filePaths[0];
                const fileName = localPath.split('/').pop();
                const remotePath = this.currentPath === '/' ? `/${fileName}` : `${this.currentPath}/${fileName}`;
                
                const uploadResult = await window.electronAPI.uploadFile(localPath, remotePath);
                if (uploadResult.success) {
                    this.showNotification('success', 'Upload Complete', `File "${fileName}" uploaded successfully.`);
                    this.refreshCurrentDirectory();
                } else {
                    this.showNotification('error', 'Upload Failed', uploadResult.error || 'Failed to upload file.');
                }
            }
        } catch (error) {
            this.showNotification('error', 'Upload Failed', error.message);
        }
    }

    async handleDroppedFiles(files) {
        if (!this.isConnected) {
            this.showNotification('error', 'Not Connected', 'Please connect to a WebDAV server first.');
            return;
        }
        
        if (files.length === 0) return;

        const uploadPromises = files.map(async (file) => {
            try {
                const fileName = file.name;
                const remotePath = this.currentPath === '/' ? `/${fileName}` : `${this.currentPath}/${fileName}`;
                
                console.log(`Uploading: ${fileName} to ${remotePath}`);
                
                // Use the file path for upload
                const uploadResult = await window.electronAPI.uploadFile(file.path, remotePath);
                
                if (uploadResult.success) {
                    return { success: true, fileName };
                } else {
                    return { success: false, fileName, error: uploadResult.error };
                }
            } catch (error) {
                console.error(`Failed to upload ${file.name}:`, error);
                return { success: false, fileName: file.name, error: error.message };
            }
        });

        // Show progress notification
        this.showNotification('info', 'Uploading...', `Uploading ${files.length} file(s)...`);

        try {
            const results = await Promise.all(uploadPromises);
            
            const successful = results.filter(r => r.success);
            const failed = results.filter(r => !r.success);
            
            if (successful.length > 0) {
                this.showNotification('success', 'Upload Complete', 
                    `${successful.length} file(s) uploaded successfully.`);
            }
            
            if (failed.length > 0) {
                const failedNames = failed.map(f => f.fileName).join(', ');
                this.showNotification('error', 'Upload Failed', 
                    `Failed to upload: ${failedNames}`);
            }
            
            // Refresh directory to show uploaded files
            this.refreshCurrentDirectory();
            
        } catch (error) {
            this.showNotification('error', 'Upload Failed', error.message);
        }
    }

    async downloadFile(remotePath) {
        try {
            // Extract filename from remote path
            const filename = remotePath.split('/').pop() || 'download';
            
            const result = await window.electronAPI.showSaveDialog({
                defaultPath: filename
            });
            
            if (!result.canceled) {
                const localPath = result.filePath;
                const downloadResult = await window.electronAPI.downloadFile(remotePath, localPath);
                
                if (downloadResult.success) {
                    this.showNotification('success', 'Download Complete', 'File downloaded successfully.');
                } else {
                    this.showNotification('error', 'Download Failed', downloadResult.error || 'Failed to download file.');
                }
            }
        } catch (error) {
            this.showNotification('error', 'Download Failed', error.message);
        }
    }

    async downloadSelectedFiles() {
        const selectedRows = document.querySelectorAll('.file-row.selected');
        const selectedFiles = Array.from(selectedRows).filter(row => row.dataset.type === 'file');
        
        if (selectedFiles.length === 0) {
            this.showNotification('warning', 'No Files Selected', 'Please select one or more files to download.');
            return;
        }

        if (selectedFiles.length === 1) {
            // Single file - use regular download
            this.downloadFile(selectedFiles[0].dataset.path);
            return;
        }

        // Multiple files - ask for directory
        try {
            const result = await window.electronAPI.showSaveDialog({
                properties: ['openDirectory', 'createDirectory'],
                title: `Select folder to save ${selectedFiles.length} files`
            });

            if (!result.canceled) {
                const targetDirectory = result.filePath;
                
                // Show progress notification
                this.showNotification('info', 'Downloading...', `Downloading ${selectedFiles.length} files...`);

                // Download all files
                const downloadPromises = selectedFiles.map(async (row) => {
                    try {
                        const remotePath = row.dataset.path;
                        const filename = row.dataset.name;
                        const localPath = `${targetDirectory}/${filename}`;
                        
                        console.log(`Downloading: ${filename} to ${localPath}`);
                        
                        const downloadResult = await window.electronAPI.downloadFile(remotePath, localPath);
                        
                        if (downloadResult.success) {
                            return { success: true, filename };
                        } else {
                            return { success: false, filename, error: downloadResult.error };
                        }
                    } catch (error) {
                        return { success: false, filename: row.dataset.name, error: error.message };
                    }
                });

                const results = await Promise.all(downloadPromises);
                
                const successful = results.filter(r => r.success);
                const failed = results.filter(r => !r.success);
                
                if (successful.length > 0) {
                    this.showNotification('success', 'Download Complete', 
                        `${successful.length} file(s) downloaded successfully.`);
                }
                
                if (failed.length > 0) {
                    const failedNames = failed.map(f => f.filename).join(', ');
                    this.showNotification('error', 'Download Failed', 
                        `Failed to download: ${failedNames}`);
                }
            }
        } catch (error) {
            this.showNotification('error', 'Download Failed', error.message);
        }
    }

    async deleteItem(path) {
        if (confirm('Are you sure you want to delete this item?')) {
            try {
                const result = await window.electronAPI.deleteItem(path);
                if (result.success) {
                    this.showNotification('success', 'Deleted', 'Item deleted successfully.');
                    this.refreshCurrentDirectory();
                } else {
                    this.showNotification('error', 'Delete Failed', result.error || 'Failed to delete item.');
                }
            } catch (error) {
                this.showNotification('error', 'Delete Failed', error.message);
            }
        }
    }

    async zipItem(itemPath, itemName) {
        if (!this.isConnected) {
            this.showNotification('error', 'Not Connected', 'Please connect to a WebDAV server first.');
            return;
        }

        try {
            console.log('Zipping item:', itemPath);
            const result = await window.electronAPI.zipItem(itemPath);
            if (result.success) {
                this.showNotification('success', 'ZIP Complete', `"${itemName}" has been zipped successfully.`);
                this.refreshCurrentDirectory();
            } else {
                this.showNotification('error', 'ZIP Failed', result.error || 'Failed to zip item.');
            }
        } catch (error) {
            console.error('ZIP error:', error);
            this.showNotification('error', 'ZIP Failed', error.message);
        }
    }

    async unzipItem(itemPath, itemName) {
        if (!this.isConnected) {
            this.showNotification('error', 'Not Connected', 'Please connect to a WebDAV server first.');
            return;
        }

        try {
            console.log('Unzipping item:', itemPath);
            const result = await window.electronAPI.unzipItem(itemPath);
            if (result.success) {
                this.showNotification('success', 'UNZIP Complete', `"${itemName}" has been unzipped successfully.`);
                this.refreshCurrentDirectory();
            } else {
                this.showNotification('error', 'UNZIP Failed', result.error || 'Failed to unzip item.');
            }
        } catch (error) {
            console.error('UNZIP error:', error);
            this.showNotification('error', 'UNZIP Failed', error.message);
        }
    }

    async zipLocalItem(itemPath, itemName) {
        try {
            // Show save dialog for the zip file in the current folder
            const defaultPath = `${this.currentLocalPath}/${itemName}.zip`;
            const result = await window.electronAPI.showSaveDialog({
                defaultPath: defaultPath,
                filters: [
                    { name: 'ZIP Archives', extensions: ['zip'] }
                ]
            });

            if (!result.canceled) {
                const zipPath = result.filePath;
                console.log('Zipping local item:', itemPath, 'to:', zipPath);
                
                const zipResult = await window.electronAPI.zipLocalItem(itemPath, zipPath);
                if (zipResult.success) {
                    this.showNotification('success', 'ZIP Complete', `"${itemName}" has been zipped successfully to "${zipPath.split('/').pop()}".`);
                    // Refresh local directory to show the new zip file
                    this.loadLocalDirectory(this.currentLocalPath);
                } else {
                    this.showNotification('error', 'ZIP Failed', zipResult.error || 'Failed to zip item.');
                }
            }
        } catch (error) {
            console.error('Local ZIP error:', error);
            this.showNotification('error', 'ZIP Failed', error.message);
        }
    }

    async unzipLocalItem(itemPath, itemName) {
        try {
            // Show folder selection dialog for extraction, defaulting to current folder
            const result = await window.electronAPI.showOpenDialog({
                defaultPath: this.currentLocalPath,
                properties: ['openDirectory']
            });
            
            if (!result.canceled && result.filePaths.length > 0) {
                const extractPath = result.filePaths[0];
                console.log('Unzipping local item:', itemPath, 'to:', extractPath);
                
                const unzipResult = await window.electronAPI.unzipLocalItem(itemPath, extractPath);
                if (unzipResult.success) {
                    this.showNotification('success', 'UNZIP Complete', `"${itemName}" has been extracted successfully to "${extractPath.split('/').pop()}".`);
                } else {
                    this.showNotification('error', 'UNZIP Failed', unzipResult.error || 'Failed to unzip item.');
                }
            }
        } catch (error) {
            console.error('Local UNZIP error:', error);
            this.showNotification('error', 'UNZIP Failed', error.message);
        }
    }

    async deleteLocalItem(itemPath, itemName, isDirectory) {
        try {
            console.log('Deleting local item:', itemPath);
            const result = await window.electronAPI.deleteLocalItem(itemPath, isDirectory);
            
            if (result.success) {
                const itemType = isDirectory ? 'Folder' : 'File';
                this.showNotification('success', 'Delete Complete', `${itemType} "${itemName}" has been deleted.`);
                // Refresh the current directory
                this.loadLocalDirectory(this.currentLocalPath);
            } else {
                this.showNotification('error', 'Delete Failed', result.error || 'Failed to delete item.');
            }
        } catch (error) {
            console.error('Local delete error:', error);
            this.showNotification('error', 'Delete Failed', error.message);
        }
    }

    filterFiles(searchTerm) {
        const rows = document.querySelectorAll('#fileTable .file-row');
        const pattern = this.createFilterPattern(searchTerm);
        console.log('Filtering with pattern:', pattern);
        
        rows.forEach(row => {
            // Get the filename from the data attribute
            const fileName = row.dataset.name;
            if (!fileName) {
                console.warn('No filename found in dataset for row:', row);
                return;
            }
            
            console.log('Testing file:', fileName, 'against pattern:', pattern);
            if (pattern.test(fileName.toLowerCase())) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }

    filterLocalFiles(searchTerm) {
        const rows = document.querySelectorAll('#localFileTable .file-row');
        const pattern = this.createFilterPattern(searchTerm);
        console.log('Filtering with pattern:', pattern);
        
        rows.forEach(row => {
            // Get the filename from the data attribute
            const fileName = row.dataset.name;
            if (!fileName) {
                console.warn('No filename found in dataset for row:', row);
                return;
            }
            
            console.log('Testing file:', fileName, 'against pattern:', pattern);
            if (pattern.test(fileName.toLowerCase())) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }

    createFilterPattern(searchTerm) {
        if (!searchTerm) {
            // Empty search matches everything
            return /.*/;
        }
        
        // Convert to lowercase for case-insensitive matching
        const term = searchTerm.toLowerCase();
        
        // If no asterisks, create a contains pattern (implicit wildcards)
        if (!term.includes('*')) {
            // Escape special regex characters and create a contains pattern
            const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // No anchors - can match anywhere in the string
            return new RegExp(escapedTerm, 'i');
        }
        
        // Convert asterisk pattern to regex
        // Escape special regex characters except asterisks
        let regexPattern = term.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        
        // Convert asterisks to regex wildcards
        regexPattern = regexPattern.replace(/\*/g, '.*');
        
        // Always add implicit wildcards at start and end unless explicitly anchored
        // Only anchor if pattern explicitly starts/ends with ^/$
        if (!regexPattern.startsWith('^')) {
            regexPattern = '.*' + regexPattern;
        }
        if (!regexPattern.endsWith('$')) {
            regexPattern = regexPattern + '.*';
        }
        
        try {
            console.log('Search pattern:', searchTerm, '-> regex:', regexPattern);
            return new RegExp(regexPattern, 'i');
        } catch (error) {
            console.warn('Invalid search pattern:', searchTerm, error);
            // Fall back to literal search if regex is invalid
            const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(escapedTerm, 'i');
        }
    }

    updateHiddenFilesToggle() {
        const btn = this.showHiddenFilesBtn;
        if (!btn) {
            console.warn('Hidden files toggle button not found');
            return;
        }
        
        const icon = btn.querySelector('i');
        if (!icon) {
            console.warn('Hidden files toggle icon not found');
            return;
        }
        
        if (this.showHiddenFiles) {
            // Show hidden files is ON - use open eye icon and blue color
            icon.className = 'fas fa-eye';
            btn.classList.add('active');
            btn.title = 'Hide hidden files';
        } else {
            // Show hidden files is OFF - use closed eye icon and normal color
            icon.className = 'fas fa-eye-slash';
            btn.classList.remove('active');
            btn.title = 'Show hidden files';
        }
    }

    showLoading(show) {
        const loading = document.getElementById('loadingIndicator');
        if (show) {
            loading.classList.remove('hidden');
        } else {
            loading.classList.add('hidden');
        }
    }

    showNotification(type, title, message) {
        const notifications = document.getElementById('notifications');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-circle',
            warning: 'fas fa-exclamation-triangle',
            info: 'fas fa-info-circle'
        };
        
        notification.innerHTML = `
            <i class="${icons[type]} notification-icon"></i>
            <div class="notification-content">
                <div class="notification-title">${title}</div>
                <div class="notification-message">${message}</div>
            </div>
            <button class="notification-close">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        notifications.appendChild(notification);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
        
        // Close button
        notification.querySelector('.notification-close').addEventListener('click', () => {
            notification.parentNode.removeChild(notification);
        });
    }

    /**
     * Update URL preview in real-time
     */
    updateUrlPreview(input) {
        const preview = document.getElementById('urlPreview');
        const previewText = document.getElementById('urlPreviewText');
        
        if (!input || input.trim() === '') {
            preview.classList.add('hidden');
            return;
        }
        
        const normalizedUrl = this.normalizeWebDAVUrl(input);
        previewText.textContent = normalizedUrl;
        preview.classList.remove('hidden');
    }

    /**
     * Navigate to an SFCC folder by changing the connection URL base path
     */
    async navigateToSFCCFolder(folderPath) {
        if (!this.isConnected || !this.currentConnection) {
            this.showNotification('error', 'Not Connected', 'Please connect to a WebDAV server first.');
            return;
        }

        // Special handling for catalogs folder
        if (folderPath === '/catalogs') {
            await this.handleCatalogsNavigation();
            return;
        }

        // Special handling for libraries folder  
        if (folderPath === '/libraries') {
            await this.handleLibrariesNavigation();
            return;
        }

        try {
            // Create new credentials with updated URL
            const baseUrl = this.currentConnection.url.split('/webdav/')[0];
            const newUrl = `${baseUrl}/webdav/Sites${folderPath}`;
            
            console.log('Navigating to SFCC folder:', folderPath);
            console.log('New URL:', newUrl);
            
            const updatedCredentials = {
                ...this.currentConnection,
                url: newUrl
            };

            // Test the new connection
            const result = await window.electronAPI.testConnection(updatedCredentials);
            if (result.success && result.connected) {
                // Update current connection and navigate to root of this folder
                this.currentConnection = updatedCredentials;
                const listResult = await window.electronAPI.listDirectory('/');
                this.currentPath = '/';
                this.pathHistory = [];
                this.updateFileListView(listResult); // Use the centralized UI update method
                this.updateBreadcrumb('/');
                this.updateBackButton();
                this.showNotification('info', 'Folder Changed', `Switched to ${folderPath.substring(1)} folder`);
            } else {
                this.showNotification('error', 'Navigation Failed', `Cannot access ${folderPath.substring(1)} folder. Check permissions.`);
            }
        } catch (error) {
            console.error('SFCC folder navigation error:', error);
            this.showNotification('error', 'Navigation Failed', error.message);
        }
    }

    async handleCatalogsNavigation() {
        // Don't handle catalog navigation during initialization
        if (this.isInitializing) {
            return;
        }
        
        try {
            this.showNotification('info', 'Loading Catalogs', 'Fetching available catalogs...');
            
            let allCatalogs = [];
            let allWebdavPaths = [];
            
            // Try to fetch catalogs via OCAPI if OAuth2 is available
            if (this.currentConnection && this.currentConnection.authType === 'oauth2') {
                try {
                    console.log('Fetching catalogs via OCAPI for connection:', this.currentConnectionId);
                    const result = await window.electronAPI.fetchCatalogs(this.currentConnectionId, this.currentConnection.url);
                    
                    if (result.success && result.catalogs && result.catalogs.length > 0) {
                        const pathsResult = await window.electronAPI.getCatalogWebDAVPaths(
                            this.currentConnectionId, 
                            this.currentConnection.url
                        );
                        
                        if (pathsResult.success) {
                            allCatalogs = result.catalogs;
                            allWebdavPaths = pathsResult.paths;
                            console.log('OCAPI catalogs found:', allCatalogs.length);
                        }
                    }
                } catch (error) {
                    console.log('OCAPI catalog fetch failed, falling back to custom IDs:', error.message);
                }
            }
            
            // Always load custom catalog/library IDs as well
            const customIdsResult = await window.electronAPI.getCustomIds(this.currentConnectionId);
            if (customIdsResult.success) {
                const customIds = customIdsResult.customIds;
                console.log('Custom IDs loaded:', customIds);
                
                // Add custom catalog IDs only (not libraries in catalog view)
                if (customIds.catalogs && customIds.catalogs.length > 0) {
                    const customCatalogPaths = this.generateCustomWebDAVPaths(
                        this.currentConnection.url, 
                        customIds.catalogs, 
                        'catalogs'
                    );
                    allWebdavPaths = allWebdavPaths.concat(customCatalogPaths);
                }
            }
            
            if (allWebdavPaths.length > 0) {
                await this.showCatalogSelection(allCatalogs, allWebdavPaths);
            } else {
                // Show option to add custom catalog/library IDs
                await this.showAddCustomIdModal();
            }
            
        } catch (error) {
            console.error('Catalog navigation error:', error);
            this.showNotification('error', 'Catalog Navigation Failed', error.message);
        }
    }

    async showCatalogSelection(catalogs, webdavPaths) {
        console.log('Showing catalogs as virtual folders:', catalogs.length, 'catalogs found');
        
        // Store catalog paths for later navigation
        this.catalogPaths = webdavPaths;
        this.isInCatalogView = true;
        
        // Create virtual folder items for each catalog
        const virtualFolders = webdavPaths.map(catalogPath => ({
            name: catalogPath.displayName || catalogPath.catalogId,
            type: 'directory',
            size: '',
            lastmod: '',
            path: catalogPath.catalogId,
            isCatalogFolder: true,
            webdavUrl: catalogPath.webdavUrl,
            catalog: catalogPath.catalog
        }));

        // Update path and render virtual catalog folders
        this.currentPath = '/catalogs';
        this.renderFileList(virtualFolders);
        
        // Update breadcrumb to show we're in catalogs view
        this.updateBreadcrumb('/catalogs');
        
        const catalogNames = catalogs.map(cat => cat.id || cat.name).join(', ');
        this.showNotification('success', 'Catalogs Loaded', `Found ${catalogs.length} catalogs. Click on a catalog to browse it.`);
    }

    async navigateToCatalog(catalogPath) {
        console.log('Navigating to catalog:', catalogPath);
        
        try {
            this.showLoading(true);
            
            // Update connection to point to catalog WebDAV path
            const updatedCredentials = {
                ...this.currentConnection,
                url: catalogPath.webdavUrl
            };

            // Test the catalog connection
            const result = await window.electronAPI.testConnection(updatedCredentials);
            if (result.success && result.connected) {
                // Update current connection and reset state
                this.currentConnection = updatedCredentials;
                this.isInCatalogView = false;
                this.catalogPaths = null;
                
                // Navigate to root of catalog
                this.currentPath = '/';
                this.pathHistory = [];
                
                // Load catalog contents
                const listResult = await window.electronAPI.listDirectory('/');
                if (listResult.success) {
                    this.renderFileList(listResult.items);
                    this.updateBreadcrumb('/');
                    this.updateBackButton();
                    this.showNotification('success', 'Catalog Loaded', `Connected to catalog: ${catalogPath.displayName}`);
                } else {
                    this.showNotification('error', 'Catalog Browse Failed', 'Connected to catalog but failed to list contents.');
                }
            } else {
                this.showNotification('error', 'Catalog Access Failed', `Cannot access catalog: ${catalogPath.displayName}`);
            }
        } catch (error) {
            console.error('Catalog navigation error:', error);
            this.showNotification('error', 'Catalog Access Failed', error.message);
        } finally {
            this.showLoading(false);
        }
    }

    async handleLibrariesNavigation() {
        try {
            this.showNotification('info', 'Loading Libraries', 'Fetching available libraries...');
            
            // Load custom library IDs
            const customIdsResult = await window.electronAPI.getCustomIds(this.currentConnectionId);
            let allWebdavPaths = [];
            
            if (customIdsResult.success) {
                const customIds = customIdsResult.customIds;
                console.log('Custom library IDs loaded:', customIds.libraries);
                
                // Add custom library IDs
                if (customIds.libraries && customIds.libraries.length > 0) {
                    allWebdavPaths = this.generateCustomWebDAVPaths(
                        this.currentConnection.url, 
                        customIds.libraries, 
                        'libraries'
                    );
                }
            }
            
            if (allWebdavPaths.length > 0) {
                await this.showLibrarySelection(allWebdavPaths);
            } else {
                // Show option to add custom library IDs
                await this.showAddLibraryIdModal();
            }
            
        } catch (error) {
            console.error('Library navigation error:', error);
            this.showNotification('error', 'Library Navigation Failed', error.message);
        }
    }

    async showLibrarySelection(webdavPaths) {
        console.log('Showing libraries as virtual folders:', webdavPaths.length, 'libraries found');
        
        // Store library paths for later navigation
        this.catalogPaths = webdavPaths; // Reuse the same property for libraries
        this.isInCatalogView = true; // Reuse the same state for libraries
        
        // Create virtual folder items for each library
        const virtualFolders = webdavPaths.map(libraryPath => ({
            name: libraryPath.displayName || libraryPath.catalogId,
            type: 'directory',
            size: '',
            lastmod: '',
            path: libraryPath.catalogId,
            isCatalogFolder: true, // Reuse same property
            webdavUrl: libraryPath.webdavUrl,
            catalog: libraryPath
        }));

        // Update path and render virtual library folders
        this.currentPath = '/libraries';
        this.renderFileList(virtualFolders);
        
        // Update breadcrumb to show we're in libraries view
        this.updateBreadcrumb('/libraries');
        
        this.showNotification('success', 'Libraries Loaded', `Found ${webdavPaths.length} libraries. Click on a library to browse it.`);
    }

    async showAddLibraryIdModal() {
        // Don't show modal during initialization
        if (this.isInitializing) {
            console.log('Skipping library modal during initialization');
            return;
        }
        
        this.currentCustomIdType = 'library';
        this.updateCustomIdModal();
        this.showModal('addCustomIdModal');
    }

    showLibraryIdInputModal() {
        this.currentCustomIdType = 'library';
        this.updateCustomIdModal();
        this.showModal('addCustomIdModal');
    }

    generateCustomWebDAVPaths(baseWebDAVUrl, ids, type) {
        // Extract base URL (remove /webdav/Sites/... part)
        const baseMatch = baseWebDAVUrl.match(/(https?:\/\/[^\/]+)/);
        if (!baseMatch) {
            throw new Error('Invalid WebDAV URL format');
        }
        
        const baseUrl = baseMatch[1];
        const pathType = type === 'catalogs' ? 'Catalogs' : 'Libraries';
        
        return ids.map(id => ({
            catalogId: id,
            displayName: `${id} (${type.slice(0, -1)})`, // Remove 's' from type
            webdavUrl: `${baseUrl}/on/demandware.servlet/webdav/Sites/${pathType}/${id}`,
            isCustom: true,
            type: type
        }));
    }

    async showAddCustomIdModal() {
        // Don't show modal during initialization
        if (this.isInitializing) {
            console.log('Skipping modal during initialization');
            return;
        }
        
        // This should only be called from catalog context, so set type to catalog
        this.currentCustomIdType = 'catalog';
        this.updateCustomIdModal();
        this.showModal('addCustomIdModal');
    }

    showCustomIdInputModal() {
        // This should only be called from catalog context, so set type to catalog  
        this.currentCustomIdType = 'catalog';
        this.updateCustomIdModal();
        this.showModal('addCustomIdModal');
    }

    updateCustomIdModal() {
        const isLibrary = this.currentCustomIdType === 'library';
        const typeName = isLibrary ? 'Library' : 'Catalog';
        const typeNameLower = typeName.toLowerCase();
        
        // Update modal title
        document.querySelector('#addCustomIdModal .modal-header h3').textContent = `Add ${typeName}`;
        
        // Update form elements
        document.getElementById('customIdLabel').textContent = `${typeName} ID`;
        document.getElementById('customIdValue').placeholder = `Enter ${typeNameLower} ID`;
        document.getElementById('customIdHelp').textContent = `Example: your-${typeNameLower}-id`;
        document.getElementById('addCustomIdSubmit').textContent = `Test & Add ${typeName}`;
    }

    handleAddCustomIdForm() {
        const id = document.getElementById('customIdValue').value.trim();
        
        if (!id) {
            this.showNotification('error', 'Invalid Input', 'Please enter an ID.');
            return;
        }
        
        // Hide modal
        this.hideModal('addCustomIdModal');
        
        // Clear form
        document.getElementById('addCustomIdForm').reset();
        
        // Add the custom ID using the current type
        this.addCustomId(id, this.currentCustomIdType);
    }

    async addCustomId(id, type) {
        try {
            this.showNotification('info', 'Testing Access', `Testing access to ${type}: ${id}`);
            
            const result = type === 'catalog' 
                ? await window.electronAPI.addCatalogId(this.currentConnectionId, id, this.currentConnection.url)
                : await window.electronAPI.addLibraryId(this.currentConnectionId, id, this.currentConnection.url);
            
            if (result.success) {
                this.showNotification('success', 'Added Successfully', result.message);
                // Refresh the appropriate view based on what was added
                setTimeout(() => {
                    if (type === 'catalog') {
                        this.handleCatalogsNavigation();
                    } else {
                        this.handleLibrariesNavigation();
                    }
                }, 1000);
            } else {
                this.showNotification('error', 'Access Failed', result.error);
                
                // Ask if they want to try another ID
                setTimeout(() => {
                    if (confirm(`Failed to access ${type} '${id}'.\n\nWould you like to try another ${type} ID?`)) {
                        // Set the current type and show modal
                        this.currentCustomIdType = type;
                        this.updateCustomIdModal();
                        this.showModal('addCustomIdModal');
                    }
                }, 2000);
            }
        } catch (error) {
            this.showNotification('error', 'Error', error.message);
        }
    }

    updateFileListView(result) {
        if (result && result.success && result.items && result.items.length > 0) {
            // Render file list
            this.renderFileList(result.items);

            // Show file table, hide empty state
            document.getElementById('notConnected').classList.add('hidden');
            document.getElementById('fileTable').classList.remove('hidden');

            // Footer is now handled by updateSelectionInfo()
        } else {
            // Show empty state, hide file table
            document.getElementById('notConnected').classList.remove('hidden');
            document.getElementById('fileTable').classList.add('hidden');
            
            // Clear footer
            document.getElementById('footer').textContent = '';
            
            if (result && !result.success) {
                this.showNotification('error', 'Navigation Failed', result.error);
            }
        }
    }

    async loadInitialLocalDirectory() {
        try {
            const result = await window.electronAPI.getLocalHomeDir();
            if (result.success) {
                this.loadLocalDirectory(result.path);
            } else {
                this.showNotification('Error', `Failed to get home directory: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification('Error', `Failed to get home directory: ${error.message}`, 'error');
        }
    }

    async loadLocalDirectory(dirPath) {
        this.currentLocalPath = dirPath;
        this.updateLocalHistory(dirPath);

        try {
            const result = await window.electronAPI.listLocalDirectory(dirPath);
            if (result.success) {
                this.renderLocalFiles(result.items);
                this.updateLocalBreadcrumb();
                
                // Save this as the last local folder for the current connection
                if (this.currentConnectionId) {
                    await window.electronAPI.updateLastLocalFolder(this.currentConnectionId, dirPath);
                }
            } else {
                this.showNotification('Error', `Failed to load local directory: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification('Error', `Failed to load local directory: ${error.message}`, 'error');
        }
    }

    renderLocalFiles(items) {
        // Store items for sorting
        this.currentLocalItems = items || [];
        
        this.localFileTableBody.innerHTML = '';
        
        // Filter hidden files if checkbox is unchecked
        const filteredItems = this.showHiddenFiles 
            ? items 
            : items.filter(item => !item.name.startsWith('.'));
        
        // Apply sorting using the centralized sort method
        const sortedItems = this.getSortedItems(filteredItems, this.localSortBy, this.localSortOrder);

        sortedItems.forEach(item => {
            const row = document.createElement('tr');
            row.dataset.path = item.path;
            row.dataset.isDirectory = item.isDirectory;
            row.dataset.name = item.name;
            row.className = 'file-row';
            row.draggable = false; // Set to false initially to prevent interference with double-clicks

            const icon = item.isDirectory ? 'fa-folder' : 'fa-file';
            const type = item.isDirectory ? 'Folder' : 'File';
            const size = item.isDirectory ? '--' : this.formatFileSize(item.size);
            const date = new Date(item.mtime).toLocaleDateString();
            
            // Determine actions based on file type and extension
            let actions = '';
            
            // Add ZIP/UNZIP action
            if (item.isDirectory) {
                // Folders can be zipped
                actions += '<button class="icon-btn local-zip-btn" title="ZIP Folder"><i class="fas fa-file-archive"></i></button>';
            } else if (item.name.toLowerCase().endsWith('.zip')) {
                // ZIP files can be unzipped
                actions += '<button class="icon-btn local-unzip-btn" title="UNZIP"><i class="fas fa-expand-arrows-alt"></i></button>';
            } else {
                // Regular files can be zipped
                actions += '<button class="icon-btn local-zip-btn" title="ZIP File"><i class="fas fa-file-archive"></i></button>';
            }
            
            // Add delete action for all items
            actions += '<button class="icon-btn local-delete-btn" title="Delete"><i class="fas fa-trash-alt"></i></button>';
            
            row.innerHTML = `
                <td><i class="fas ${icon} file-icon"></i>${item.name}</td>
                <td>${type}</td>
                <td>${size}</td>
                <td>${date}</td>
                <td class="file-actions">${actions}</td>
            `;
            
            // Enable dragging only when mouse is held down (not on click/double-click)
            row.addEventListener('mousedown', (e) => {
                // Only enable dragging for left mouse button and not on buttons
                if (e.button === 0 && !e.target.closest('button') && !e.target.closest('.file-actions')) {
                    row.draggable = true;
                }
            });
            
            row.addEventListener('mouseup', () => {
                // Disable dragging after mouse up to prevent interference with clicks
                setTimeout(() => {
                    row.draggable = false;
                }, 0);
            });
            
            // Add drag event listener
            row.addEventListener('dragstart', (e) => {
                const selectedRows = document.querySelectorAll('#localFileTableBody .file-row.selected');
                const draggedFiles = selectedRows.length > 0 && selectedRows[0] === row 
                    ? Array.from(selectedRows) 
                    : [row];
                
                const fileData = draggedFiles.map(r => ({
                    name: r.dataset.name,
                    path: r.dataset.path,
                    isDirectory: r.dataset.isDirectory === 'true'
                }));
                
                e.dataTransfer.setData('application/json', JSON.stringify({
                    files: fileData,
                    sourceType: 'local'
                }));
                
                draggedFiles.forEach(r => r.classList.add('dragging'));
            });
            
            row.addEventListener('dragend', (e) => {
                document.querySelectorAll('.file-row.dragging').forEach(r => {
                    r.classList.remove('dragging');
                });
            });
            
            this.localFileTableBody.appendChild(row);
        });
        
        // Update sort indicators
        this.updateSortIndicators('local');
        
        // Add event listeners for local zip/unzip/delete buttons
        document.querySelectorAll('.local-zip-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const row = e.target.closest('.file-row');
                this.zipLocalItem(row.dataset.path, row.dataset.name);
            });
        });

        document.querySelectorAll('.local-unzip-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const row = e.target.closest('.file-row');
                this.unzipLocalItem(row.dataset.path, row.dataset.name);
            });
        });

        document.querySelectorAll('.local-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const row = e.target.closest('.file-row');
                const isDirectory = row.dataset.isDirectory === 'true';
                const itemType = isDirectory ? 'folder' : 'file';
                
                // Show confirmation dialog
                const result = await window.electronAPI.showMessageBox({
                    type: 'warning',
                    title: 'Confirm Delete',
                    message: `Are you sure you want to delete this ${itemType}?`,
                    detail: `"${row.dataset.name}" will be permanently deleted.`,
                    buttons: ['Delete', 'Cancel'],
                    defaultId: 1,
                    cancelId: 1
                });

                if (result.response === 0) { // User clicked Delete
                    this.deleteLocalItem(row.dataset.path, row.dataset.name, isDirectory);
                }
            });
        });
        
        // Update local file count after rendering
        this.updateLocalFileCount();
        
        // Clear search input when directory changes
        const localSearchInput = document.getElementById('localSearchInput');
        if (localSearchInput && localSearchInput.value) {
            localSearchInput.value = '';
        }
    }

    updateLocalBreadcrumb() {
        this.localPathBreadcrumb.innerHTML = '';
        const segments = this.currentLocalPath.split('/').filter(Boolean);
        let currentPath = '/';
        
        const rootSegment = this.createLocalPathSegment('/', 'Home');
        this.localPathBreadcrumb.appendChild(rootSegment);

        segments.forEach(segment => {
            currentPath = `${currentPath}${segment}/`;
            const pathSegment = this.createLocalPathSegment(currentPath, segment);
            this.localPathBreadcrumb.appendChild(document.createTextNode('/'));
            this.localPathBreadcrumb.appendChild(pathSegment);
        });
    }

    createLocalPathSegment(path, name) {
        const segment = document.createElement('span');
        segment.className = 'path-segment';
        segment.textContent = name;
        segment.dataset.path = path;
        segment.addEventListener('click', () => {
            this.loadLocalDirectory(path);
        });
        return segment;
    }

    updateLocalHistory(dirPath) {
        if (this.localHistory[this.localHistory.length - 1] !== dirPath) {
            this.localHistory.push(dirPath);
        }
        this.localBackBtn.disabled = this.localHistory.length <= 1;
    }

    navigateLocalBack() {
        if (this.localHistory.length > 1) {
            this.localHistory.pop();
            const prevPath = this.localHistory[this.localHistory.length - 1];
            this.loadLocalDirectory(prevPath);
        }
    }

    updateLocalSelection(row) {
        const filePath = row.dataset.path;
        
        if (this.selectedLocalFiles.has(filePath)) {
            this.selectedLocalFiles.delete(filePath);
            row.classList.remove('selected');
        } else {
            this.selectedLocalFiles.add(filePath);
            row.classList.add('selected');
        }
        
        this.updateCopyButtons();
        this.updateLocalFileCount();
    }

    updateCopyButtons() {
        const remoteSelectedRows = document.querySelectorAll('#fileTableBody .file-row.selected');
        const localSelectedRows = document.querySelectorAll('#localFileTableBody .file-row.selected');
        const hasRemoteSelection = remoteSelectedRows.length > 0;
        const hasLocalSelection = localSelectedRows.length > 0;
        const isConnected = this.isConnected;
        
        // Enable for both files and directories (recursive copying)
        this.copyToLocalBtn.disabled = !hasRemoteSelection || !isConnected;
        this.copyToRemoteBtn.disabled = !hasLocalSelection || !isConnected;
    }

    updateLocalFileCount() {
        const localSelectedRows = document.querySelectorAll('#localFileTableBody .file-row.selected');
        const localFileCountElement = document.getElementById('localFileCount');
        const totalLocalItems = document.querySelectorAll('#localFileTableBody .file-row').length;
        
        if (localSelectedRows.length > 0) {
            localFileCountElement.innerHTML = `<i class="fas fa-folder"></i> Local: ${totalLocalItems} item${totalLocalItems !== 1 ? 's' : ''} (${localSelectedRows.length} selected)`;
        } else {
            localFileCountElement.innerHTML = `<i class="fas fa-folder"></i> Local: ${totalLocalItems} item${totalLocalItems !== 1 ? 's' : ''}`;
        }
    }

    sortRemoteFiles(column) {
        // Toggle sort order if clicking the same column
        if (this.remoteSortBy === column) {
            this.remoteSortOrder = this.remoteSortOrder === 'asc' ? 'desc' : 'asc';
        } else {
            this.remoteSortBy = column;
            this.remoteSortOrder = 'asc';
        }

        this.updateSortIndicators('remote');
        this.rerenderRemoteFiles();
    }

    sortLocalFiles(column) {
        // Toggle sort order if clicking the same column
        if (this.localSortBy === column) {
            this.localSortOrder = this.localSortOrder === 'asc' ? 'desc' : 'asc';
        } else {
            this.localSortBy = column;
            this.localSortOrder = 'asc';
        }

        this.updateSortIndicators('local');
        this.rerenderLocalFiles();
    }

    updateSortIndicators(tableType) {
        const tableSelector = tableType === 'remote' ? '#fileTable' : '#localFileTable';
        const headers = document.querySelectorAll(`${tableSelector} thead th`);
        const columns = ['name', 'type', 'size', 'modified'];
        const currentSortBy = tableType === 'remote' ? this.remoteSortBy : this.localSortBy;
        const currentSortOrder = tableType === 'remote' ? this.remoteSortOrder : this.localSortOrder;
        const baseTexts = tableType === 'remote' 
            ? ['Name', 'Type', 'Size', 'Modified', 'Actions']
            : ['Name', 'Type', 'Size', 'Modified', 'Actions'];

        headers.forEach((header, index) => {
            if (index < columns.length) {
                // Reset to base text
                header.textContent = baseTexts[index];
                
                if (columns[index] === currentSortBy) {
                    header.textContent += currentSortOrder === 'asc' ? ' ↑' : ' ↓';
                }
            }
        });
    }

    getSortedItems(items, sortBy, sortOrder) {
        return [...items].sort((a, b) => {
            let aValue, bValue;

            switch (sortBy) {
                case 'name':
                    aValue = a.name?.toLowerCase() || '';
                    bValue = b.name?.toLowerCase() || '';
                    break;
                case 'type':
                    // Directories first, then by type
                    const aIsDir = a.isDirectory || a.type === 'directory';
                    const bIsDir = b.isDirectory || b.type === 'directory';
                    if (aIsDir !== bIsDir) {
                        return aIsDir ? -1 : 1;
                    }
                    aValue = aIsDir ? 'directory' : 'file';
                    bValue = bIsDir ? 'directory' : 'file';
                    break;
                case 'size':
                    aValue = a.size || 0;
                    bValue = b.size || 0;
                    break;
                case 'modified':
                    aValue = new Date(a.mtime || a.lastModified || 0);
                    bValue = new Date(b.mtime || b.lastModified || 0);
                    break;
                default:
                    aValue = a.name?.toLowerCase() || '';
                    bValue = b.name?.toLowerCase() || '';
            }

            if (sortBy === 'size' || sortBy === 'modified') {
                // Numeric/date comparison
                if (sortOrder === 'asc') {
                    return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
                } else {
                    return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
                }
            } else {
                // String comparison
                if (sortOrder === 'asc') {
                    return aValue.localeCompare(bValue, undefined, { numeric: true, sensitivity: 'base' });
                } else {
                    return bValue.localeCompare(aValue, undefined, { numeric: true, sensitivity: 'base' });
                }
            }
        });
    }

    rerenderRemoteFiles() {
        if (this.currentRemoteItems.length > 0) {
            this.renderFileList(this.currentRemoteItems);
        }
    }

    rerenderLocalFiles() {
        if (this.currentLocalItems.length > 0) {
            this.renderLocalFiles(this.currentLocalItems);
        }
    }

    async copySelectedToLocal() {
        const remoteSelectedRows = document.querySelectorAll('#fileTableBody .file-row.selected');
        const selectedItems = Array.from(remoteSelectedRows).map(row => ({
            path: row.dataset.path,
            name: row.dataset.path.split('/').pop(),
            type: row.dataset.type
        }));
            
        if (selectedItems.length === 0 || !this.isConnected) {
            this.showNotification('Warning', 'No remote items selected or not connected', 'warning');
            return;
        }

        const localDestination = this.currentLocalPath;
        
        try {
            let totalFiles = 0;
            let totalDirs = 0;
            const errors = [];
            
            this.showNotification('Info', `Downloading ${selectedItems.length} item(s) to ${localDestination}...`, 'info');
            
            for (const item of selectedItems) {
                if (item.type === 'directory') {
                    // Handle directory recursively
                    const localDirPath = `${localDestination}/${item.name}`;
                    const result = await window.electronAPI.downloadDirectoryRecursive(item.path, localDirPath);
                    
                    if (result.success) {
                        totalFiles += result.results.files;
                        totalDirs += result.results.directories;
                        if (result.results.errors.length > 0) {
                            errors.push(...result.results.errors);
                        }
                    } else {
                        errors.push(`Failed to download directory ${item.name}: ${result.error}`);
                    }
                } else {
                    // Handle file
                    const localFilePath = `${localDestination}/${item.name}`;
                    const result = await window.electronAPI.downloadFile(item.path, localFilePath);
                    
                    if (result.success) {
                        totalFiles++;
                    } else {
                        errors.push(`Failed to download file ${item.name}: ${result.error}`);
                    }
                }
            }
            
            let message = `Successfully downloaded ${totalFiles} file(s)`;
            if (totalDirs > 0) {
                message += ` and ${totalDirs} director(ies)`;
            }
            
            if (errors.length > 0) {
                this.showNotification('Warning', `${message}, but encountered ${errors.length} error(s). Check console for details.`, 'warning');
                console.error('Download errors:', errors);
            } else {
                this.showNotification('Success', message, 'success');
            }
            
            this.loadLocalDirectory(this.currentLocalPath);
        } catch (error) {
            this.showNotification('Error', `Download failed: ${error.message}`, 'error');
        }
    }

    async copySelectedToRemote() {
        const localSelectedRows = document.querySelectorAll('#localFileTableBody .file-row.selected');
        const selectedItems = Array.from(localSelectedRows).map(row => ({
            path: row.dataset.path,
            name: row.dataset.path.split('/').pop(),
            isDirectory: row.dataset.isDirectory === 'true'
        }));
            
        if (selectedItems.length === 0 || !this.isConnected) {
            this.showNotification('Warning', 'No local items selected or not connected', 'warning');
            return;
        }

        const remoteDestination = this.currentPath;
        
        try {
            let totalFiles = 0;
            let totalDirs = 0;
            const errors = [];
            
            this.showNotification('Info', `Uploading ${selectedItems.length} item(s) to ${remoteDestination}...`, 'info');
            
            for (const item of selectedItems) {
                if (item.isDirectory) {
                    // Handle directory recursively
                    const remoteDirPath = `${remoteDestination}/${item.name}`;
                    const result = await window.electronAPI.uploadDirectoryRecursive(item.path, remoteDirPath);
                    
                    if (result.success) {
                        totalFiles += result.results.files;
                        totalDirs += result.results.directories;
                        if (result.results.errors.length > 0) {
                            errors.push(...result.results.errors);
                        }
                    } else {
                        errors.push(`Failed to upload directory ${item.name}: ${result.error}`);
                    }
                } else {
                    // Handle file
                    const remoteFilePath = `${remoteDestination}/${item.name}`;
                    const result = await window.electronAPI.uploadFile(item.path, remoteFilePath);
                    
                    if (result.success) {
                        totalFiles++;
                    } else {
                        errors.push(`Failed to upload file ${item.name}: ${result.error}`);
                    }
                }
            }
            
            let message = `Successfully uploaded ${totalFiles} file(s)`;
            if (totalDirs > 0) {
                message += ` and ${totalDirs} director(ies)`;
            }
            
            if (errors.length > 0) {
                this.showNotification('Warning', `${message}, but encountered ${errors.length} error(s). Check console for details.`, 'warning');
                console.error('Upload errors:', errors);
            } else {
                this.showNotification('Success', message, 'success');
            }
            
            this.refreshCurrentDirectory();
        } catch (error) {
            this.showNotification('Error', `Upload failed: ${error.message}`, 'error');
        }
    }

    initializeDragAndDrop() {
        const remoteContainer = document.querySelector('#left-panel .file-list-container');
        const localContainer = document.querySelector('#right-panel .file-list-container');
        
        if (!remoteContainer || !localContainer) return;

        // Set up drop zones
        this.setupDropZone(remoteContainer, 'remote');
        this.setupDropZone(localContainer, 'local');
    }

    setupDropZone(container, type) {
        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            container.classList.add('drag-over');
        });

        container.addEventListener('dragleave', (e) => {
            e.preventDefault();
            if (!container.contains(e.relatedTarget)) {
                container.classList.remove('drag-over');
            }
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            container.classList.remove('drag-over');
            
            const dragData = e.dataTransfer.getData('application/json');
            if (dragData) {
                const { files, sourceType } = JSON.parse(dragData);
                this.handleFileDrop(files, sourceType, type);
            }
        });
    }

    async handleFileDrop(files, sourceType, targetType) {
        if (sourceType === targetType) {
            return; // Same panel, no need to copy
        }

        if (!this.isConnected) {
            this.showNotification('Warning', 'Not connected to remote server', 'warning');
            return;
        }

        try {
            if (sourceType === 'local' && targetType === 'remote') {
                // Upload local files to remote
                await this.uploadFilesToRemote(files);
            } else if (sourceType === 'remote' && targetType === 'local') {
                // Download remote files to local
                await this.downloadFilesToLocal(files);
            }
        } catch (error) {
            this.showNotification('Error', `Transfer failed: ${error.message}`, 'error');
        }
    }

    async uploadFilesToRemote(files) {
        const remoteDestination = this.currentPath;
        
        if (files.length === 0) {
            this.showNotification('Warning', 'No items selected for upload', 'warning');
            return;
        }
        
        try {
            let totalFiles = 0;
            let totalDirs = 0;
            const errors = [];
            
            this.showNotification('Info', `Uploading ${files.length} item(s) to ${remoteDestination}...`, 'info');
            
            for (const file of files) {
                if (file.isDirectory) {
                    // Handle directory recursively
                    const remoteDirPath = `${remoteDestination}/${file.name}`;
                    const result = await window.electronAPI.uploadDirectoryRecursive(file.path, remoteDirPath);
                    
                    if (result.success) {
                        totalFiles += result.results.files;
                        totalDirs += result.results.directories;
                        if (result.results.errors.length > 0) {
                            errors.push(...result.results.errors);
                        }
                    } else {
                        errors.push(`Failed to upload directory ${file.name}: ${result.error}`);
                    }
                } else {
                    // Handle file
                    const remoteFilePath = `${remoteDestination}/${file.name}`;
                    const result = await window.electronAPI.uploadFile(file.path, remoteFilePath);
                    
                    if (result.success) {
                        totalFiles++;
                    } else {
                        errors.push(`Failed to upload file ${file.name}: ${result.error}`);
                    }
                }
            }
            
            let message = `Successfully uploaded ${totalFiles} file(s)`;
            if (totalDirs > 0) {
                message += ` and ${totalDirs} director(ies)`;
            }
            
            if (errors.length > 0) {
                this.showNotification('Warning', `${message}, but encountered ${errors.length} error(s). Check console for details.`, 'warning');
                console.error('Upload errors:', errors);
            } else {
                this.showNotification('Success', message, 'success');
            }
            
            this.refreshCurrentDirectory();
        } catch (error) {
            this.showNotification('Error', `Upload failed: ${error.message}`, 'error');
        }
    }

    async downloadFilesToLocal(files) {
        const localDestination = this.currentLocalPath;
        
        if (files.length === 0) {
            this.showNotification('Warning', 'No items selected for download', 'warning');
            return;
        }
        
        try {
            let totalFiles = 0;
            let totalDirs = 0;
            const errors = [];
            
            this.showNotification('Info', `Downloading ${files.length} item(s) to ${localDestination}...`, 'info');
            
            for (const file of files) {
                if (file.isDirectory) {
                    // Handle directory recursively
                    const localDirPath = `${localDestination}/${file.name}`;
                    const result = await window.electronAPI.downloadDirectoryRecursive(file.path, localDirPath);
                    
                    if (result.success) {
                        totalFiles += result.results.files;
                        totalDirs += result.results.directories;
                        if (result.results.errors.length > 0) {
                            errors.push(...result.results.errors);
                        }
                    } else {
                        errors.push(`Failed to download directory ${file.name}: ${result.error}`);
                    }
                } else {
                    // Handle file
                    const localFilePath = `${localDestination}/${file.name}`;
                    const result = await window.electronAPI.downloadFile(file.path, localFilePath);
                    
                    if (result.success) {
                        totalFiles++;
                    } else {
                        errors.push(`Failed to download file ${file.name}: ${result.error}`);
                    }
                }
            }
            
            let message = `Successfully downloaded ${totalFiles} file(s)`;
            if (totalDirs > 0) {
                message += ` and ${totalDirs} director(ies)`;
            }
            
            if (errors.length > 0) {
                this.showNotification('Warning', `${message}, but encountered ${errors.length} error(s). Check console for details.`, 'warning');
                console.error('Download errors:', errors);
            } else {
                this.showNotification('Success', message, 'success');
            }
            
            this.loadLocalDirectory(this.currentLocalPath);
        } catch (error) {
            this.showNotification('Error', `Download failed: ${error.message}`, 'error');
        }
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    const resizer = document.getElementById('resizer');
    const leftPanel = document.getElementById('left-panel');
    const rightPanel = document.getElementById('right-panel');

    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.removeEventListener('mousemove', handleMouseMove);
        });
    });

    function handleMouseMove(e) {
        if (!isResizing) {
            return;
        }

        const container = resizer.parentElement;
        const containerOffset = container.getBoundingClientRect().left;
        const newLeftWidth = e.clientX - containerOffset;
        const panelDivider = document.querySelector('.panel-divider');
        const dividerWidth = panelDivider ? panelDivider.offsetWidth : 60;
        const resizerWidth = 5;
        const minPanelWidth = 300;
        const availableWidth = container.clientWidth - dividerWidth - resizerWidth;

        if (newLeftWidth > minPanelWidth && (availableWidth - newLeftWidth) > minPanelWidth) {
            const leftPercentage = (newLeftWidth / availableWidth) * 100;
            const rightPercentage = 100 - leftPercentage;
            
            leftPanel.style.width = `${leftPercentage}%`;
            document.getElementById('right-panel').style.width = `${rightPercentage}%`;
        }
    }

    new SFCCWebDAVManager();
});