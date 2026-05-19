'use strict';

const { BrowserWindow, app } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  const iconPath =
    process.platform === 'win32'
      ? path.join(__dirname, '..', 'assets', 'logo.ico')
      : path.join(__dirname, '..', 'assets', 'logo.png');

  mainWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 780,
    minHeight: 580,
    title: 'Jonuffy Spoofer',
    icon: iconPath,
    frame: false,
    resizable: true,
    show: false,
    backgroundColor: '#f9fafb',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: process.env.NODE_ENV === 'development' || process.argv.includes('--dev'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

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
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

module.exports = { createWindow, getMainWindow, setupAppLifecycle };
