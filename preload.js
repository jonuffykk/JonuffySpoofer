'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (ch, cb) => ipcRenderer.on(ch, (_e, ...a) => cb(...a));

contextBridge.exposeInMainWorld('api', {
  minimize: () => ipcRenderer.send('win-minimize'),
  close: () => ipcRenderer.send('win-close'),
  appVersion: () => ipcRenderer.invoke('app-version'),
  openExternal: url => ipcRenderer.send('open-external', url),
  on: (event, cb) => on(event, cb),
  runSpoofer: data => ipcRenderer.send('run-spoofer', data),
  pauseSpoofer: () => ipcRenderer.send('spoofer-pause'),
  resumeSpoofer: () => ipcRenderer.send('spoofer-resume'),
  fetchUserInfo: cookie => ipcRenderer.invoke('fetch-user-info', { cookie }),
  fetchUserGroups: cookie => ipcRenderer.invoke('fetch-user-groups', { cookie }),
  canUploadGroup: (cookie, groupId, apiKey) =>
    ipcRenderer.invoke('can-upload-group', { cookie, groupId, apiKey }),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  pluginStatus: () => ipcRenderer.invoke('plugin-status'),
  pluginUpdateStatus: () => ipcRenderer.invoke('plugin-update-status'),
  installPlugin: () => ipcRenderer.invoke('install-plugin'),
  openPluginsFolder: () => ipcRenderer.send('open-plugins-folder'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  uninstall: () => ipcRenderer.invoke('uninstall'),
  fetchUpdateInfo: () => ipcRenderer.invoke('fetch-update-info'),
  downloadUpdate: () => ipcRenderer.send('download-update'),
  applyUpdate: () => ipcRenderer.invoke('apply-update'),
  onUpdateProgress: cb => on('update-progress', cb),
  onUpdateDone: cb => on('update-done', cb),
});
