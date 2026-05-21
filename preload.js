'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  onStatusUpdate: cb => ipcRenderer.on('update-status-message', (_e, ...args) => cb(...args)),
  onTransferUpdate: cb => ipcRenderer.on('transfer-update', (_e, ...args) => cb(...args)),
  onSpooferResult: cb => ipcRenderer.on('spoofer-result', (_e, ...args) => cb(...args)),
  onStudioStatusUpdate: cb => ipcRenderer.on('studio-status-update', (_e, ...args) => cb(...args)),
  onStudioScanResult: cb => ipcRenderer.on('studio-scan-result', (_e, ...args) => cb(...args)),
  onStudioReplaceComplete: cb =>
    ipcRenderer.on('studio-replace-complete', (_e, ...args) => cb(...args)),
  getRunsHistory: () => ipcRenderer.invoke('get-runs-history'),
  clearRunsHistory: () => ipcRenderer.invoke('clear-runs-history'),
  deleteRun: id => ipcRenderer.invoke('delete-run', id),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openExternal: url => ipcRenderer.send('open-external', url),
  runSpooferAction: data => ipcRenderer.send('run-spoofer-action', data),
  resumeSession: data => ipcRenderer.send('run-spoofer-action', { ...data, resumeSession: true }),
  pauseSpoofer: () => ipcRenderer.send('spoofer-pause'),
  resumeSpoofer: () => ipcRenderer.send('spoofer-resume'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  fetchUserInfo: cookie => ipcRenderer.invoke('fetch-user-info', { cookie }),
  fetchUserGroups: cookie => ipcRenderer.invoke('fetch-user-groups', { cookie }),
  canUploadToGroup: (cookie, groupId, apiKey) =>
    ipcRenderer.invoke('can-upload-to-group', { cookie, groupId, apiKey }),
  checkSession: () => ipcRenderer.invoke('check-session'),
  clearSession: () => ipcRenderer.send('clear-session'),
  clearAppHistory: () => ipcRenderer.invoke('clear-app-history'),
  uninstallApp: () => ipcRenderer.invoke('uninstall-app'),
  installPlugin: () => ipcRenderer.invoke('install-plugin'),
  getPluginStatus: () => ipcRenderer.invoke('get-plugin-status'),
  openPluginsFolder: () => ipcRenderer.send('open-plugins-folder'),
  getStudioConnection: () => ipcRenderer.invoke('get-studio-connection'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
});
