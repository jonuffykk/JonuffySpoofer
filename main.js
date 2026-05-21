'use strict';

const { app } = require('electron');
const { setupAppLifecycle, getMainWindow } = require('./modules/window');
const { registerIpcHandlers } = require('./modules/handler');
const { startServer, setStudioCallbacks } = require('./modules/connect');

function sendToRenderer(channel, payload) {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents?.send(channel, payload);
}

const sendStatusMessage = msg => sendToRenderer('update-status-message', msg);
const sendTransferUpdate = payload => sendToRenderer('transfer-update', payload);
const sendSpooferResult = result => sendToRenderer('spoofer-result', result);

registerIpcHandlers(getMainWindow, sendTransferUpdate, sendSpooferResult, sendStatusMessage);

setStudioCallbacks({
  onScanResult: data => sendToRenderer('studio-scan-result', data),
  onReplaceComplete: data => {
    global.currentMappings = [];
    sendToRenderer('studio-replace-complete', data);
  },
  onStatusUpdate: (status, connection) =>
    sendToRenderer('studio-status-update', { status, connection }),
  onScanRequest: data => {
    global.pendingScanRequest = data;
  },
});

setupAppLifecycle();
app.whenReady().then(startServer);

process.on('uncaughtException', err => sendStatusMessage(err?.message ?? String(err)));
process.on('unhandledRejection', err => sendStatusMessage(err?.message ?? String(err)));
