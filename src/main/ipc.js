const { ipcMain, dialog, shell, BrowserWindow } = require('electron');
const path = require('path');
const { scanAndMap, executeMovesAsync } = require('./sorter');

/**
 * Registers all IPC handlers between main process and renderer.
 * @param {object} context
 * @param {import('./history')} context.historyManager
 */
function registerIpcHandlers({ historyManager }) {
  // Directory selection dialog
  ipcMain.handle('dialog:select-directory', async (event, options = {}) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window, {
      title: options.title || 'Select Folder',
      defaultPath: options.defaultPath,
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, path: null };
    }

    return { canceled: false, path: result.filePaths[0] };
  });

  // Scan and Map
  ipcMain.handle('sorter:scan-and-map', async (_event, { sourceDir, targetBaseDir, recursive }) => {
    try {
      if (!sourceDir) {
        throw new Error('Source directory is required.');
      }

      const scanResult = await scanAndMap(sourceDir, {
        targetBaseDir: targetBaseDir || sourceDir,
        recursive: recursive !== false
      });

      return {
        success: true,
        data: scanResult
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  });

  // Execute Moves and Log Transaction
  ipcMain.handle('sorter:execute-moves', async (event, { items, sourceDir, targetBaseDir, mode }) => {
    try {
      if (!items || !Array.isArray(items) || items.length === 0) {
        throw new Error('No items selected for execution.');
      }

      const executionReport = await executeMovesAsync(items, progress => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('sorter:move-progress', progress);
        }
      }, { mode: mode || 'move' });

      let transaction = null;
      if (executionReport.successful.length > 0) {
        transaction = historyManager.logTransaction({
          operations: executionReport.successful,
          sourceDir: sourceDir || '',
          targetBaseDir: targetBaseDir || '',
          mode: mode || 'move'
        });
      }

      return {
        success: true,
        report: executionReport,
        transaction
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  });

  // Get History
  ipcMain.handle('sorter:get-history', async () => {
    try {
      const history = historyManager.getHistory();
      return {
        success: true,
        history
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        history: []
      };
    }
  });

  // Rollback Transaction (Undo)
  ipcMain.handle('sorter:rollback-transaction', async (_event, { transactionId }) => {
    try {
      if (!transactionId) {
        throw new Error('Transaction ID is required for rollback.');
      }

      const result = historyManager.rollbackTransaction(transactionId);
      return {
        success: true,
        ...result
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  });

  // Open item in OS File Explorer
  ipcMain.handle('shell:show-item', async (_event, itemPath) => {
    try {
      if (itemPath) {
        shell.showItemInFolder(itemPath);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Open directory
  ipcMain.handle('shell:open-path', async (_event, dirPath) => {
    try {
      if (dirPath) {
        await shell.openPath(dirPath);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Window Controls (Frameless)
  ipcMain.on('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
  });

  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.on('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
  });
}

module.exports = {
  registerIpcHandlers
};
