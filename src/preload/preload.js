const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose safe APIs to the renderer window via contextBridge.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // Dialogs
  selectDirectory: (options) => ipcRenderer.invoke('dialog:select-directory', options),

  // File sorting operations
  scanAndMap: (params) => ipcRenderer.invoke('sorter:scan-and-map', params),
  executeMoves: (params) => ipcRenderer.invoke('sorter:execute-moves', params),
  onMoveProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('sorter:move-progress', listener);
    return () => ipcRenderer.removeListener('sorter:move-progress', listener);
  },

  // History & Rollback
  getHistory: () => ipcRenderer.invoke('sorter:get-history'),
  rollbackTransaction: (params) => ipcRenderer.invoke('sorter:rollback-transaction', params),

  // Shell interactions
  showItemInFolder: (itemPath) => ipcRenderer.invoke('shell:show-item', itemPath),
  openPath: (dirPath) => ipcRenderer.invoke('shell:open-path', dirPath),

  // Window management for frameless glassmorphism UI
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close')
});
