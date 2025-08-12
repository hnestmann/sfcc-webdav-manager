const https = require('https');
const querystring = require('querystring');

class CatalogManager {
    constructor() {
        // Cache catalogs per connection
        this.catalogCache = new Map();
    }

    /**
     * Fetch catalogs for a connection using OCAPI Data API
     * @param {string} connectionId - The connection ID
     * @param {string} hostname - SFCC hostname (e.g., 'bbsv-063.dx.commercecloud.salesforce.com')
     * @param {string} accessToken - OAuth2 access token
     * @returns {Promise<Array>} Array of catalog objects
     */
    async fetchCatalogs(connectionId, hostname, accessToken) {
        console.log('CatalogManager: Fetching catalogs for connection:', connectionId);
        console.log('CatalogManager: Using hostname:', hostname);
        console.log('CatalogManager: Token present:', !!accessToken);

        if (!accessToken) {
            throw new Error('Access token is required for OCAPI calls');
        }

        // OCAPI Data API endpoint for catalogs
        const path = '/s/-/dw/data/v23_2/catalogs';
        const url = `https://${hostname}${path}`;
        
        console.log('CatalogManager: Making request to:', url);

        try {
            const catalogData = await this.makeOCAPIRequest(hostname, path, accessToken);
            
            // Extract catalogs from response
            const catalogs = catalogData.data || [];
            
            console.log('CatalogManager: Found', catalogs.length, 'catalogs');
            console.log('CatalogManager: Catalog data:', JSON.stringify(catalogs, null, 2));

            // Cache the results
            this.catalogCache.set(connectionId, catalogs);

            return catalogs;
        } catch (error) {
            console.error('CatalogManager: Error fetching catalogs:', error);
            throw new Error(`Failed to fetch catalogs: ${error.message}`);
        }
    }

    /**
     * Make an HTTPS request to OCAPI
     * @param {string} hostname - SFCC hostname
     * @param {string} path - API path
     * @param {string} accessToken - OAuth2 access token
     * @returns {Promise<Object>} Parsed JSON response
     */
    makeOCAPIRequest(hostname, path, accessToken) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: hostname,
                port: 443,
                path: path,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            };

            console.log('CatalogManager: HTTPS request options:', {
                hostname: options.hostname,
                path: options.path,
                method: options.method,
                headers: {
                    ...options.headers,
                    'Authorization': `Bearer ${accessToken.substring(0, 20)}...`
                }
            });

            const req = https.request(options, (res) => {
                let data = '';

                console.log('CatalogManager: Response status:', res.statusCode);
                console.log('CatalogManager: Response headers:', res.headers);

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        console.log('CatalogManager: Raw response:', data);
                        
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            const jsonData = JSON.parse(data);
                            resolve(jsonData);
                        } else {
                            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                        }
                    } catch (parseError) {
                        reject(new Error(`Failed to parse response: ${parseError.message}`));
                    }
                });
            });

            req.on('error', (error) => {
                console.error('CatalogManager: Request error:', error);
                reject(error);
            });

            req.end();
        });
    }

    /**
     * Get cached catalogs for a connection
     * @param {string} connectionId - The connection ID
     * @returns {Array} Array of cached catalog objects
     */
    getCachedCatalogs(connectionId) {
        return this.catalogCache.get(connectionId) || [];
    }

    /**
     * Generate WebDAV paths for catalogs
     * @param {string} baseWebDAVUrl - Base WebDAV URL
     * @param {Array} catalogs - Array of catalog objects
     * @returns {Array} Array of WebDAV path objects
     */
    generateWebDAVPaths(baseWebDAVUrl, catalogs) {
        console.log('CatalogManager: Generating WebDAV paths for', catalogs.length, 'catalogs');
        console.log('CatalogManager: Base WebDAV URL:', baseWebDAVUrl);

        if (!catalogs || catalogs.length === 0) {
            return [];
        }

        // Extract base URL (remove /webdav/Sites/Impex part)
        const baseMatch = baseWebDAVUrl.match(/(https?:\/\/[^\/]+)/);
        if (!baseMatch) {
            throw new Error('Invalid WebDAV URL format');
        }
        
        const baseUrl = baseMatch[1];
        console.log('CatalogManager: Extracted base URL:', baseUrl);

        return catalogs.map(catalog => {
            const catalogId = catalog.id || catalog.catalog_id;
            if (!catalogId) {
                console.warn('CatalogManager: Catalog missing ID:', catalog);
                return null;
            }

            const webdavUrl = `${baseUrl}/on/demandware.servlet/webdav/Sites/Catalogs/${catalogId}`;
            const displayName = catalog.display_name || catalog.name || catalogId;

            console.log('CatalogManager: Generated path for catalog', catalogId, ':', webdavUrl);

            return {
                catalogId: catalogId,
                displayName: displayName,
                webdavUrl: webdavUrl,
                catalog: catalog
            };
        }).filter(path => path !== null);
    }

    /**
     * Clear cached catalogs for a connection
     * @param {string} connectionId - The connection ID
     */
    clearCache(connectionId) {
        this.catalogCache.delete(connectionId);
    }

    /**
     * Clear all cached catalogs
     */
    clearAllCache() {
        this.catalogCache.clear();
    }
}

module.exports = CatalogManager; 