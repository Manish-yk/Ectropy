const { app, BrowserWindow } = require('electron');
const path = require('path');
const HistoryManager = require('./history');
const { registerIpcHandlers } = require('./ipc');

let mainWindow = null;

function createWindow() {
  const historyPath = path.join(app.getPath('userData'), 'history.json');
  const historyManager = new HistoryManager(historyPath);

  registerIpcHandlers({ historyManager });

  mainWindow = new BrowserWindow({
    title: 'Ectropy — File Organizer',
    width: 1200,
    height: 800,
    minWidth: 760,
    minHeight: 600,
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: '#f6f1ec',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
