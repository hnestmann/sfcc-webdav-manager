# SFCC WebDAV Manager

A modern Electron-based file manager specifically designed for Salesforce B2C Commerce (SFCC) WebDAV servers. This application provides secure credential management, intuitive file operations, and pre-configured SFCC folder structures.

## Features

### 🔐 Secure Authentication
- **Basic Authentication**: Username/password authentication
- **Bearer Token**: OAuth/JWT token-based authentication
- **Encrypted Storage**: Credentials stored securely using OS keychain (macOS Keychain, Windows Credential Store, Linux Secret Service)
- **Additional Encryption**: Double-layer encryption with AES for sensitive data

### 📁 SFCC-Optimized File Management
- **Standard SFCC Folders**: Pre-configured quick access to common SFCC directories:
  - `cartridges` - Custom cartridges and business logic
  - `impex` - Import/Export files and data
  - `catalogs` - Product catalogs and catalog data
  - `logs` - Application and system logs
  - `static` - Static resources (CSS, JS, images)
  - `libraries` - Shared libraries and dependencies
  - `metadata` - System and custom object metadata
  - `sites` - Site-specific configurations

### 🚀 Modern Interface
- **Clean Design**: Modern, professional interface with intuitive navigation
- **File Operations**: Upload, download, create folders, delete files/folders
- **Search**: Real-time file search and filtering
- **Breadcrumb Navigation**: Easy navigation with clickable path segments
- **File Type Icons**: Visual file type identification
- **Connection Management**: Save and manage multiple SFCC instances

## Installation

### Prerequisites
- Node.js (version 16 or higher)
- npm or yarn package manager

### Setup
1. Clone or download this repository
2. Navigate to the project directory:
   ```bash
   cd sfcc-webdav-manager
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Run the application:
   ```bash
   npm start
   ```

### Development
For development with auto-reload:
```bash
npm run dev
```

### Building
To build the application for distribution:
```bash
npm run build
```

## Usage

### First Time Setup
1. Launch the SFCC WebDAV Manager
2. Click the "Connect" button or "Add Connection" in the sidebar
3. Fill in your connection details:
   - **Connection Name**: A friendly name for your SFCC instance
   - **WebDAV URL**: Your SFCC WebDAV endpoint (usually `https://your-instance.demandware.net/on/demandware.servlet/webdav/Sites`)
   - **Authentication Type**: Choose between Basic Auth or Bearer Token
   - **Credentials**: Enter your username/password or bearer token

### Connecting to SFCC
1. Select a saved connection from the sidebar
2. Click the connect button (plug icon)
3. Once connected, you can browse files and folders

### File Operations
- **Navigate**: Double-click folders to enter them
- **Upload**: Click the upload button and select files
- **Download**: Click the download button next to any file
- **Create Folder**: Click the folder+ button and enter a name
- **Delete**: Click the trash button next to any file/folder
- **Search**: Use the search box to filter files by name

### SFCC Quick Navigation
Use the predefined SFCC folders in the sidebar for quick access to common directories:
- Click any folder name to navigate directly to that path
- These folders follow SFCC best practices and standard project structure

## Security Features

### Credential Storage
- **OS Integration**: Leverages your operating system's secure credential storage
- **Encryption**: Additional AES encryption layer for sensitive data
- **Separation**: Public data (URLs, names) stored separately from sensitive credentials
- **Auto-cleanup**: Secure removal of credentials when connections are deleted

### Best Practices
- Credentials are never stored in plain text
- All sensitive operations use secure IPC communication
- No sensitive data is logged or exposed in the interface
- Regular security updates through Electron framework

## Configuration

### WebDAV URLs
Common SFCC WebDAV URL patterns:
- Production: `https://your-instance.demandware.net/on/demandware.servlet/webdav/Sites`
- Staging: `https://staging-your-instance.demandware.net/on/demandware.servlet/webdav/Sites`
- Development: `https://dev-your-instance.demandware.net/on/demandware.servlet/webdav/Sites`

### Bearer Tokens
For Account Manager integration:
1. Generate an API token in SFCC Account Manager
2. Select "Bearer Token" as authentication type
3. Paste your token in the Bearer Token field

## Troubleshooting

### Common Issues

**Connection Failed**
- Verify your WebDAV URL is correct
- Check your credentials are valid
- Ensure your SFCC instance allows WebDAV connections
- Verify network connectivity

**Certificate Errors**
- Some SFCC instances may have SSL certificate issues
- Contact your SFCC administrator for proper SSL configuration

**Permission Denied**
- Ensure your SFCC user has appropriate permissions
- Check with your SFCC administrator about WebDAV access rights

### Debug Mode
Run the application with debug information:
```bash
npm run dev
```
This opens the Developer Tools for debugging.

## Development

### Project Structure
```
src/
├── main.js              # Main Electron process
├── preload.js           # Secure IPC bridge
├── credential-manager.js # Secure credential storage
├── webdav-manager.js    # WebDAV operations
└── renderer/
    ├── index.html       # Main UI
    ├── styles.css       # Application styles
    └── app.js          # Frontend logic
```

### Technologies Used
- **Electron**: Cross-platform desktop app framework
- **WebDAV**: Industry-standard web-based file management protocol
- **Keytar**: Secure OS credential storage
- **CryptoJS**: Additional encryption layer
- **Electron Store**: Configuration and settings storage

### Contributing
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues, questions, or feature requests, please create an issue in the project repository.

## Security Notice

This application handles sensitive credentials. Always:
- Keep the application updated
- Use strong passwords
- Regularly rotate API tokens
- Report security issues responsibly 