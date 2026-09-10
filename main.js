// main.js
// Proceso principal de Electron para la aplicación nativa de escritorio

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer, PORT } = require('./server/index');

const LOG_FILE = path.join(__dirname, 'electron_debug.log');
function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
}

process.on('uncaughtException', (err) => {
  log(`UNCAUGHT EXCEPTION: ${err ? (err.stack || err.message || err) : 'unknown'}`);
});

process.on('unhandledRejection', (reason) => {
  log(`UNHANDLED REJECTION: ${reason ? (reason.stack || reason.message || reason) : 'unknown'}`);
});

process.on('exit', (code) => {
  log(`PROCESS EXIT WITH CODE: ${code}`);
});

log('Electron arrancando proceso principal...');

// Deshabilitar aceleración por hardware para evitar cuelgues de GPU en Windows
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

let mainWindow = null;
let serverPort = PORT;

async function createWindow(port) {
  const iconPath = path.join(__dirname, 'public', 'icons', 'icon.png');
  log(`Creando BrowserWindow con icono: ${iconPath}`);

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#121212',
    title: 'Organizador Supremo de Fotos',
    icon: iconPath,
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log(`RENDER PROCESS GONE: reason=${details.reason}, exitCode=${details.exitCode}`);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    log(`DID FAIL LOAD: code=${errorCode}, desc=${errorDescription}, url=${validatedURL}`);
  });

  const appUrl = `http://127.0.0.1:${port}`;
  log(`Cargando URL: ${appUrl}`);
  
  try {
    await mainWindow.loadURL(appUrl);
    log('URL cargada exitosamente en la ventana');
  } catch (err) {
    log(`Error al cargar URL: ${err.message}`);
  }

  mainWindow.on('closed', () => {
    log('Ventana cerrada');
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('select-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleccionar carpeta de fotos para escanear',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('show-in-folder', async (event, filePath) => {
  if (filePath) {
    shell.showItemInFolder(path.normalize(filePath));
    return true;
  }
  return false;
});

ipcMain.handle('open-path', async (event, filePath) => {
  if (filePath) {
    shell.openPath(path.normalize(filePath));
    return true;
  }
  return false;
});

app.whenReady().then(async () => {
  log('app.whenReady disparado');
  try {
    const s = await startServer();
    serverPort = s.port;
    log(`Servidor iniciado en puerto: ${serverPort}`);
    await createWindow(serverPort);
  } catch (err) {
    log(`Error al iniciar servidor interno: ${err.message}, intentando puerto 3850`);
    await createWindow(3850);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(serverPort);
    }
  });
});

app.on('window-all-closed', () => {
  log('Todas las ventanas cerradas, saliendo de app...');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
