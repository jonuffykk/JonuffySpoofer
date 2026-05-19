'use strict';

const { app } = require('electron');
const { setupAppLifecycle, getMainWindow } = require('./modules/window');
const { registerIpcHandlers } = require('./modules/handlers');

function sendToRenderer(channel, payload) {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  if (!wc || wc.isDestroyed()) return;
  wc.send(channel, payload);
}

const sendStatusMessage = message => sendToRenderer('update-status-message', message);
const sendTransferUpdate = payload => sendToRenderer('transfer-update', payload);
const sendSpooferResult = result => sendToRenderer('spoofer-result', result);

registerIpcHandlers(getMainWindow, sendTransferUpdate, sendSpooferResult, sendStatusMessage);

setupAppLifecycle();

process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err);
  sendStatusMessage(err?.message ?? String(err));
});

process.on('unhandledRejection', err => {
  console.error('Unhandled rejection:', err);
  sendStatusMessage(err?.message ?? String(err));
});
