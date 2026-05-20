'use strict';

const { BrowserWindow, app } = require('electron');
const path = require('path');

let mainWindow = null;

const iconPath =
  process.platform === 'win32'
    ? path.join(__dirname, '..', 'assets', 'logo.ico')
    : path.join(__dirname, '..', 'assets', 'logo.png');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 880,
    height: 680,
    title: 'Jonuffy Spoofer',
    icon: iconPath,
    frame: false,
    resizable: false,
    show: false,
    backgroundColor: '#f9fafb',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function getMainWindow() {
  return mainWindow;
}

function setupAppLifecycle() {
  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

module.exports = { createWindow, getMainWindow, setupAppLifecycle };
