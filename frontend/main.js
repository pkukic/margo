const { app, BrowserWindow, ipcMain, dialog, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let fileToOpen = null; // Store file path passed via command line or file association

// Settings file path in user data directory
const settingsPath = path.join(app.getPath('userData'), 'margo-settings.json');

function loadSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            const data = fs.readFileSync(settingsPath, 'utf-8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('Error loading settings:', err);
    }
    return {};
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        return true;
    } catch (err) {
        console.error('Error saving settings:', err);
        return false;
    }
}

// Check command line arguments for a PDF file to open
function getFileFromArgs(args) {
    // Skip the first arg (electron executable) and second (script path in dev)
    // In production, the first arg after the app is the file
    for (const arg of args) {
        if (arg.endsWith('.pdf') && fs.existsSync(arg)) {
            return arg;
        }
    }
    return null;
}

// Handle file open from command line (Linux "Open with...")
fileToOpen = getFileFromArgs(process.argv);

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1920,
        height: 1080,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'assets', 'icon.png')
    });

    // Maximize window on start (keeps window decorations)
    mainWindow.maximize();

    mainWindow.loadFile('index.html');

    // Once the window is ready, send the file to open if one was specified
    mainWindow.webContents.on('did-finish-load', () => {
        if (fileToOpen) {
            mainWindow.webContents.send('open-file', fileToOpen);
            fileToOpen = null;
        }
    });

    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Handle second instance (when app is already running and user opens another file)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, focus our window and open the file
        const filePath = getFileFromArgs(commandLine);
        if (filePath && mainWindow) {
            mainWindow.webContents.send('open-file', filePath);
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

app.whenReady().then(() => {
    createWindow();

    // Register global shortcuts
    globalShortcut.register('F11', () => {
        if (mainWindow) {
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
        }
    });

    globalShortcut.register('Escape', () => {
        if (mainWindow && mainWindow.isFullScreen()) {
            mainWindow.setFullScreen(false);
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    globalShortcut.unregisterAll();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC Handlers

// Open file dialog
ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'PDF Files', extensions: ['pdf'] }
        ]
    });
    
    if (result.canceled) {
        return null;
    }
    
    return result.filePaths[0];
});

// Read file as base64
ipcMain.handle('read-file-base64', async (event, filePath) => {
    try {
        const buffer = fs.readFileSync(filePath);
        return buffer.toString('base64');
    } catch (err) {
        console.error('Error reading file:', err);
        return null;
    }
});

// Read file as array buffer
ipcMain.handle('read-file-buffer', async (event, filePath) => {
    try {
        const buffer = fs.readFileSync(filePath);
        return buffer;
    } catch (err) {
        console.error('Error reading file:', err);
        return null;
    }
});

// Check if file exists
ipcMain.handle('file-exists', async (event, filePath) => {
    return fs.existsSync(filePath);
});

// Get file path info
ipcMain.handle('get-path-info', async (event, filePath) => {
    return {
        dirname: path.dirname(filePath),
        basename: path.basename(filePath),
        extname: path.extname(filePath),
        name: path.basename(filePath, path.extname(filePath))
    };
});

// Settings handlers
ipcMain.handle('get-settings', async () => {
    return loadSettings();
});

ipcMain.handle('save-settings', async (event, settings) => {
    return saveSettings(settings);
});

ipcMain.handle('update-setting', async (event, key, value) => {
    const settings = loadSettings();
    settings[key] = value;
    return saveSettings(settings);
});

// Open external URL in default browser
ipcMain.handle('open-external', async (event, url) => {
    try {
        await shell.openExternal(url);
        return true;
    } catch (err) {
        console.error('Error opening external URL:', err);
        return false;
    }
});
