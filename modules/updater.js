'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const { app } = require('electron');

const OWNER = 'jonuffykk';
const REPO = 'JonuffySpoofer';
const API_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

const fetchJson = url => new Promise((res, rej) => {
  const req = https.get(url, {
    headers: { 'User-Agent': 'JonuffySpoofer', Accept: 'application/vnd.github+json' },
  }, r => {
    let buf = '';
    r.on('data', d => buf += d);
    r.on('end', () => {
      try { res(JSON.parse(buf)); } catch (e) { rej(e); }
    });
  });
  req.on('error', rej);
  req.setTimeout(15000, () => { req.destroy(); rej(new Error('Timeout')); });
});

const semverGt = (a, b) => {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d > 0) return true;
    if (d < 0) return false;
  }
  return false;
};

const getLatestRelease = async () => {
  const data = await fetchJson(API_URL);
  const current = app.getVersion();
  const latest = (data.tag_name || '').replace(/^v/, '');
  const upToDate = !semverGt(latest, current);
  const asset = (data.assets || []).find(a => /\.exe$/i.test(a.name));
  return {
    hasUpdate: !upToDate,
    current,
    latest: data.tag_name || latest,
    releaseUrl: data.html_url || `https://github.com/${OWNER}/${REPO}/releases/latest`,
    assetUrl: asset?.browser_download_url || null,
    assetName: asset?.name || null,
    assetSize: asset?.size || 0,
  };
};

const downloadFile = (url, dest, onProgress) => new Promise((res, rej) => {
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = fs.createWriteStream(dest);
  let received = 0;
  const req = https.get(url, { headers: { 'User-Agent': 'JonuffySpoofer' } }, r => {
    const total = parseInt(r.headers['content-length'] || '0', 10);
    r.on('data', chunk => {
      received += chunk.length;
      file.write(chunk);
      if (total) onProgress(received, total);
    });
    r.on('end', () => {
      file.end();
      res({ ok: true, size: received });
    });
  });
  req.on('error', e => { file.destroy(); fs.unlink(dest, () => {}); rej(e); });
  req.setTimeout(60000, () => { req.destroy(); fs.unlink(dest, () => {}); rej(new Error('Timeout')); });
});

const spawnUpdater = (currentExe, newExe) => {
  const batPath = path.join(path.dirname(currentExe), `update_${Date.now()}.bat`);
  const bat = [
    '@echo off',
    'timeout /t 2 /nobreak >nul',
    ':wait',
    `tasklist /fi "pid eq ${process.pid}" 2>nul | findstr ${process.pid} >nul && (timeout /t 1 /nobreak >nul & goto wait)`,
    `move /Y "${newExe}" "${currentExe}"`,
    `del "${newExe}" 2>nul`,
    `start "" "${currentExe}"`,
    `del "%~f0"`,
  ].join('\r\n');
  fs.writeFileSync(batPath, bat, 'utf8');
  spawn('cmd.exe', ['/c', batPath], { detached: true, windowsHide: true });
  app.quit();
};

module.exports = { getLatestRelease, downloadFile, spawnUpdater };
