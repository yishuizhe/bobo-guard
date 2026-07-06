const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('boboGuard', {
  selectDirectory: () => ipcRenderer.invoke('bobo:select-directory'),
  scanDirectory: (targetPath) => ipcRenderer.invoke('bobo:scan-directory', targetPath),
  auditGitHub: () => ipcRenderer.invoke('bobo:audit-github'),
  openExternal: (url) => ipcRenderer.invoke('bobo:open-external', url),
});
