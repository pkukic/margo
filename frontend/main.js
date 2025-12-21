const { app, BrowserWindow, ipcMain, dialog, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const net = require('net');

let mainWindow;
let backendProcess = null;
let backendPort = null;
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

// Find a free port for the backend
function findFreePort(startPort = 8765) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(startPort, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', () => {
            // Port is busy, try the next one
            resolve(findFreePort(startPort + 1));
        });
    });
}

// Find the backend directory
function findBackendDir() {
    // In development: ../backend relative to frontend
    // In production (packaged): could be in resources or alongside the app
    const possiblePaths = [
        path.join(__dirname, '..', 'backend'),  // Development
        path.join(process.resourcesPath, 'backend'),  // Packaged in resources
        path.join(app.getAppPath(), '..', 'backend'),  // Alongside app.asar
        '/opt/Margo/resources/backend',  // Linux installed location
    ];
    
    for (const p of possiblePaths) {
        if (fs.existsSync(path.join(p, 'main.py'))) {
            return p;
        }
    }
    return null;
}

// Copy backend to user-writable location if needed
function ensureWritableBackend(sourceDir) {
    // Check if source is writable
    try {
        fs.accessSync(sourceDir, fs.constants.W_OK);
        return sourceDir;  // Already writable
    } catch (e) {
        // Not writable, copy to user data directory
    }
    
    const userDataPath = app.getPath('userData');
    const userBackendDir = path.join(userDataPath, 'backend');
    const sourceMainPy = path.join(sourceDir, 'main.py');
    const destMainPy = path.join(userBackendDir, 'main.py');
    
    // Check if we need to copy (first run or update)
    let needsCopy = !fs.existsSync(destMainPy);
    
    if (!needsCopy) {
        // Check if source is newer
        try {
            const sourceStat = fs.statSync(sourceMainPy);
            const destStat = fs.statSync(destMainPy);
            needsCopy = sourceStat.mtime > destStat.mtime;
        } catch (e) {
            needsCopy = true;
        }
    }
    
    if (needsCopy) {
        console.log(`Copying backend to ${userBackendDir}...`);
        
        // Create directory
        if (!fs.existsSync(userBackendDir)) {
            fs.mkdirSync(userBackendDir, { recursive: true });
        }
        
        // Copy all Python files and config
        const filesToCopy = fs.readdirSync(sourceDir);
        for (const file of filesToCopy) {
            const srcPath = path.join(sourceDir, file);
            const destPath = path.join(userBackendDir, file);
            
            // Skip directories like .venv
            const stat = fs.statSync(srcPath);
            if (stat.isFile()) {
                fs.copyFileSync(srcPath, destPath);
            }
        }
        console.log('Backend copied successfully');
    }
    
    return userBackendDir;
}

// Start the Python backend
async function startBackend() {
    let backendDir = findBackendDir();
    
    if (!backendDir) {
        console.error('Backend directory not found');
        return null;
    }
    
    // Ensure we have a writable backend directory
    backendDir = ensureWritableBackend(backendDir);
    
    backendPort = await findFreePort(8765);
    console.log(`Starting backend on port ${backendPort} from ${backendDir}...`);
    
    // Set environment variables
    const env = { ...process.env, PORT: backendPort.toString() };
    
    // Load .env file if it exists
    const envPath = path.join(backendDir, '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        for (const line of envContent.split('\n')) {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                env[match[1].trim()] = match[2].trim();
            }
        }
    }
    
    // Set UV_PROJECT_ENVIRONMENT to a user-writable location
    // This is needed when the backend is installed in /opt (read-only)
    const userDataPath = app.getPath('userData');
    const backendVenvPath = path.join(userDataPath, 'backend-venv');
    env.UV_PROJECT_ENVIRONMENT = backendVenvPath;
    console.log(`Using venv location: ${backendVenvPath}`);
    
    // Find uv - required for running the backend
    const uvPaths = [
        path.join(process.env.HOME || '', '.local', 'bin', 'uv'),
        '/usr/local/bin/uv',
        '/usr/bin/uv',
        'uv'  // Fallback to PATH
    ];
    
    let uvCmd = null;
    for (const p of uvPaths) {
        if (p === 'uv' || fs.existsSync(p)) {
            uvCmd = p;
            break;
        }
    }
    
    if (!uvCmd) {
        console.error('uv is required but not found. Please install uv: https://docs.astral.sh/uv/');
        return null;
    }
    
    console.log(`Using uv at: ${uvCmd}`);
    const args = ['run', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', backendPort.toString()];
    
    console.log(`Running: ${uvCmd} ${args.join(' ')}`);
    
    backendProcess = spawn(uvCmd, args, {
        cwd: backendDir,
        env: env,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    
    backendProcess.stdout.on('data', (data) => {
        console.log(`Backend: ${data}`);
    });
    
    backendProcess.stderr.on('data', (data) => {
        console.error(`Backend: ${data}`);
    });
    
    backendProcess.on('close', (code) => {
        console.log(`Backend process exited with code ${code}`);
        backendProcess = null;
    });
    
    backendProcess.on('error', (err) => {
        console.error(`Backend spawn error: ${err}`);
    });
    
    // Wait for backend to be ready (reduced timeout for faster startup)
    const maxRetries = 60;  // 60 * 100ms = 6 seconds max
    for (let i = 0; i < maxRetries; i++) {
        try {
            await new Promise((resolve, reject) => {
                const req = require('http').get(`http://127.0.0.1:${backendPort}/health`, (res) => {
                    if (res.statusCode === 200) resolve();
                    else reject();
                });
                req.on('error', reject);
                req.setTimeout(100, reject);
            });
            console.log('Backend is ready');
            return backendPort;
        } catch (e) {
            await new Promise(r => setTimeout(r, 100));  // 100ms between retries
        }
    }
    
    console.error('Backend failed to start');
    return null;
}

// Stop the backend process
function stopBackend() {
    if (backendProcess) {
        console.log('Stopping backend...');
        backendProcess.kill();
        backendProcess = null;
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
        // Stop backend when window is closed
        stopBackend();
    });
}

// Allow multiple instances - each gets its own backend
app.whenReady().then(async () => {
    // Create window immediately for fast perceived startup
    createWindow();
    
    // Start the backend in parallel
    startBackend().then((port) => {
        if (port) {
            backendPort = port;
            // Send backend port to renderer
            if (mainWindow && mainWindow.webContents) {
                mainWindow.webContents.send('backend-port', backendPort);
            }
        }
    });
    
    // Send file to open once window is ready
    mainWindow.webContents.on('did-finish-load', () => {
        // Send port if already available
        if (backendPort) {
            mainWindow.webContents.send('backend-port', backendPort);
        }
        if (fileToOpen) {
            mainWindow.webContents.send('open-file', fileToOpen);
            fileToOpen = null;
        }
    });

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
    stopBackend();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('quit', () => {
    stopBackend();
});

// IPC Handlers

// Get backend port
ipcMain.handle('get-backend-port', () => {
    return backendPort;
});

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
