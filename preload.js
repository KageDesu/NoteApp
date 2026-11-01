// Мост между интерфейсом и главным процессом. Интерфейс видит только window.api.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadAll: () => ipcRenderer.invoke('data:load-all'),
  saveBoard: (board) => ipcRenderer.invoke('data:save-board', board),
  deleteBoard: (id) => ipcRenderer.invoke('data:delete-board', id),
  saveSettings: (s) => ipcRenderer.invoke('data:save-settings', s),

  importPaths: (paths) => ipcRenderer.invoke('asset:import-paths', paths),
  saveBuffer: (name, data) => ipcRenderer.invoke('asset:save-buffer', name, data),
  pickFiles: (kind) => ipcRenderer.invoke('asset:pick', kind),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },

  openAsset: (file) => ipcRenderer.invoke('shell:open-asset', file),
  showAsset: (file) => ipcRenderer.invoke('shell:show-asset', file),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  openDataDir: () => ipcRenderer.invoke('shell:open-data-dir'),

  linkPreview: (url) => ipcRenderer.invoke('link:preview', url),

  onBeforeClose: (fn) => ipcRenderer.on('app:before-close', fn),
  readyToClose: () => ipcRenderer.send('app:ready-to-close'),
});
