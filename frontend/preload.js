const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // File operations
    openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
    readFileBase64: (filePath) => ipcRenderer.invoke('read-file-base64', filePath),
    readFileBuffer: (filePath) => ipcRenderer.invoke('read-file-buffer', filePath),
    fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),
    getPathInfo: (filePath) => ipcRenderer.invoke('get-path-info', filePath),

    // Settings operations
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    updateSetting: (key, value) => ipcRenderer.invoke('update-setting', key, value),

    // External URL
    openExternal: (url) => ipcRenderer.invoke('open-external', url),

    // Backend
    getBackendPort: () => ipcRenderer.invoke('get-backend-port'),
    onBackendPort: (callback) => ipcRenderer.on('backend-port', (event, port) => callback(port)),

    // File open event (from command line / file association)
    onOpenFile: (callback) => ipcRenderer.on('open-file', (event, filePath) => callback(filePath)),
    getStartupFile: () => ipcRenderer.invoke('get-startup-file')
});
