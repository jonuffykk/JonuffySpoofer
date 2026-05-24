'use strict';

const { app } = require('electron');
const { setupAppLifecycle, getMainWindow } = require('./modules/window');
const { registerIpcHandlers } = require('./modules/handler');
const { startServer, setStudioCallbacks } = require('./modules/connect');

const send = (channel, payload) => {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents?.send(channel, payload);
};

const emit = (event, payload) => send(event, payload);

registerIpcHandlers(getMainWindow, emit);

setStudioCallbacks({
  onScanResult: data => send('studio-scan-result', data),
  onReplaceComplete: data => send('studio-replace-complete', data),
  onStatusUpdate: (status, connection) => send('studio-status-update', { status, connection }),
});

setupAppLifecycle();
app.whenReady().then(startServer);

process.on('uncaughtException', err => emit('status', err?.message ?? String(err)));
process.on('unhandledRejection', err => emit('status', err?.message ?? String(err)));
