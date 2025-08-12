const https = require('https');
const querystring = require('querystring');

class OAuth2Manager {
    constructor() {
        this.tokens = new Map(); // Store tokens by connection ID
        this.refreshTimers = new Map(); // Store refresh timers
    }

    /**
     * Get access token for a connection (with automatic refresh)
     */
    async getAccessToken(connectionId, clientId, clientSecret, forceRefresh = false) {
        console.log('OAuth2Manager: Getting access token for connection:', connectionId);
        console.log('OAuth2Manager: ClientId:', clientId ? '[present]' : '[missing]', 'ClientSecret:', clientSecret ? '[present]' : '[missing]');
        
        // Check if we have a valid token (unless forcing refresh)
        const tokenData = this.tokens.get(connectionId);
        if (!forceRefresh && tokenData && tokenData.expiresAt > Date.now()) {
            console.log('OAuth2Manager: Using cached token');
            return tokenData.accessToken;
        }

        // Get new token
        console.log('OAuth2Manager: Requesting new token' + (forceRefresh ? ' (forced refresh)' : ''));
        return await this.requestNewToken(connectionId, clientId, clientSecret);
    }

    /**
     * Request a new access token using Client Credentials flow
     */
    async requestNewToken(connectionId, clientId, clientSecret) {
        const tokenUrl = 'https://account.demandware.com/dw/oauth2/access_token';
        
        console.log('OAuth2Manager: Making token request to:', tokenUrl);
        console.log('OAuth2Manager: Client credentials provided - ID:', clientId ? '[present]' : '[missing]', 'Secret:', clientSecret ? '[present]' : '[missing]');
        
        const postData = querystring.stringify({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret
        });

        console.log('OAuth2Manager: Request payload:', postData);

        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        try {
            console.log('OAuth2Manager: Sending HTTPS request...');
            const response = await this.makeHttpsRequest(tokenUrl, options, postData);

            console.log('OAuth2Manager: Received response:', response.substring(0, 30));
            
            const tokenData = JSON.parse(response);
            console.log('OAuth2Manager: Parsed token data:', {
                ...tokenData,
                access_token: tokenData.access_token ? '[present]' : '[missing]'
            });

            if (tokenData.access_token) {
                // Calculate expiration time (leave 5 minutes buffer)
                const expiresIn = (tokenData.expires_in || 3600) - 300;
                const expiresAt = Date.now() + (expiresIn * 1000);

                // Store token
                this.tokens.set(connectionId, {
                    accessToken: tokenData.access_token,
                    expiresAt: expiresAt,
                    tokenType: tokenData.token_type || 'Bearer'
                });

                // Schedule automatic refresh
                this.scheduleTokenRefresh(connectionId, clientId, clientSecret, expiresIn * 1000);

                console.log('OAuth2Manager: Token obtained successfully, expires in', expiresIn, 'seconds');
                console.log('OAuth2Manager: Returning access token:', tokenData.access_token ? '[present]' : '[missing]');
                return tokenData.access_token;
            } else {
                console.log('OAuth2Manager: No access_token in response:', tokenData);
                throw new Error(`Token request failed: ${tokenData.error_description || tokenData.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('OAuth2Manager: Token request failed:', error);
            throw new Error(`Failed to obtain access token: ${error.message}`);
        }
    }

    /**
     * Schedule automatic token refresh
     */
    scheduleTokenRefresh(connectionId, clientId, clientSecret, delayMs) {
        // Clear existing timer
        const existingTimer = this.refreshTimers.get(connectionId);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Schedule new refresh 5 minutes before expiration
        const refreshDelay = Math.max(delayMs - (5 * 60 * 1000), 60000); // At least 1 minute
        
        const timer = setTimeout(async () => {
            console.log('OAuth2Manager: Auto-refreshing token for connection:', connectionId);
            try {
                await this.requestNewToken(connectionId, clientId, clientSecret);
            } catch (error) {
                console.error('OAuth2Manager: Auto-refresh failed:', error);
                // Remove invalid token
                this.tokens.delete(connectionId);
                this.refreshTimers.delete(connectionId);
            }
        }, refreshDelay);

        this.refreshTimers.set(connectionId, timer);
        console.log('OAuth2Manager: Scheduled token refresh in', Math.round(refreshDelay / 1000), 'seconds');
    }

    /**
     * Clear tokens and timers for a connection
     */
    clearConnection(connectionId) {
        console.log('OAuth2Manager: Clearing connection:', connectionId);
        
        const timer = this.refreshTimers.get(connectionId);
        if (timer) {
            clearTimeout(timer);
            this.refreshTimers.delete(connectionId);
        }
        
        this.tokens.delete(connectionId);
    }

    /**
     * Force clear all tokens (for debugging)
     */
    clearAllTokens() {
        console.log('OAuth2Manager: Clearing all tokens');
        this.tokens.clear();
        for (const timer of this.refreshTimers.values()) {
            clearTimeout(timer);
        }
        this.refreshTimers.clear();
    }

    /**
     * Make HTTPS request
     */
    makeHttpsRequest(url, options, postData) {
        return new Promise((resolve, reject) => {
            const req = https.request(url, options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(data);
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                });
            });

            req.on('error', reject);
            
            if (postData) {
                req.write(postData);
            }
            
            req.end();
        });
    }

    /**
     * Clean up all timers
     */
    cleanup() {
        console.log('OAuth2Manager: Cleaning up all timers');
        for (const timer of this.refreshTimers.values()) {
            clearTimeout(timer);
        }
        this.refreshTimers.clear();
        this.tokens.clear();
    }
}

module.exports = OAuth2Manager; 