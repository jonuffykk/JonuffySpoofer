'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app } = require('electron');

const OWNER = 'jonuffykk';
const REPO = 'JonuffySpoofer';
const API_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

const fetchJson = url =>
  new Promise((res, rej) => {
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': 'JonuffySpoofer', Accept: 'application/vnd.github+json' },
      },
      r => {
        let buf = '';
        r.on('data', d => (buf += d));
        r.on('end', () => {
          try {
            res(JSON.parse(buf));
          } catch (e) {
            rej(e);
          }
        });
      }
    );
    req.on('error', rej);
    req.setTimeout(15000, () => {
      req.destroy();
      rej(new Error('Timeout'));
    });
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
  if (!data || !data.tag_name) throw new Error(data?.message || 'No release found');
  const current = app.getVersion();
  const latest = (data.tag_name || '').replace(/^v/, '');
  const upToDate = !semverGt(latest, current);
  const asset = (data.assets || []).find(a => /\.exe$/i.test(a.name));
  const checksum = (data.assets || []).find(a => /^SHA256SUMS(\.txt)?$/i.test(a.name));
  return {
    hasUpdate: !upToDate,
    current,
    latest: data.tag_name || latest,
    releaseUrl: data.html_url || `https://github.com/${OWNER}/${REPO}/releases/latest`,
    assetUrl: asset?.browser_download_url || null,
    assetName: asset?.name || null,
    assetSize: asset?.size || 0,
    checksumUrl: checksum?.browser_download_url || null,
  };
};

const httpText = (url, redirects = 0) =>
  new Promise((res, rej) => {
    if (redirects > 5) return rej(new Error('Too many redirects'));
    const client = url.startsWith('http://') ? http : https;
    const req = client.get(url, { headers: { 'User-Agent': 'JonuffySpoofer' } }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume();
        return httpText(new URL(r.headers.location, url).toString(), redirects + 1).then(res, rej);
      }
      if (r.statusCode !== 200) {
        r.resume();
        return rej(new Error(`HTTP ${r.statusCode}`));
      }
      let buf = '';
      r.on('data', d => (buf += d));
      r.on('end', () => res(buf));
    });
    req.on('error', rej);
    req.setTimeout(15000, () => {
      req.destroy();
      rej(new Error('Timeout'));
    });
  });

const sha256File = filePath =>
  new Promise((res, rej) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => res(hash.digest('hex')));
    stream.on('error', rej);
  });

const expectedChecksum = async (checksumUrl, assetName) => {
  const txt = await httpText(checksumUrl);
  for (const line of txt.split('\n')) {
    const m = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (m && m[2].trim() === assetName) return m[1].toLowerCase();
  }
  return null;
};

const downloadFile = (url, dest, onProgress, redirects = 0) =>
  new Promise((res, rej) => {
    if (redirects > 5) return rej(new Error('Too many redirects'));
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const req = https.get(url, { headers: { 'User-Agent': 'JonuffySpoofer' } }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume();
        const next = new URL(r.headers.location, url).toString();
        return downloadFile(next, dest, onProgress, redirects + 1).then(res, rej);
      }
      if (r.statusCode !== 200) {
        r.resume();
        return rej(new Error(`HTTP ${r.statusCode}`));
      }
      const total = parseInt(r.headers['content-length'] || '0', 10);
      let received = 0;
      const file = fs.createWriteStream(dest);
      const fail = e => {
        file.destroy();
        fs.unlink(dest, () => {});
        rej(e);
      };
      r.on('data', chunk => {
        received += chunk.length;
        if (total) onProgress(received, total);
      });
      r.on('error', fail);
      file.on('error', fail);
      file.on('finish', () => file.close(() => res({ ok: true, size: received })));
      r.pipe(file);
    });
    req.on('error', rej);
    req.setTimeout(60000, () => {
      req.destroy();
      rej(new Error('Timeout'));
    });
  });

const spawnUpdater = (currentExe, newExe) => {
  if (!fs.existsSync(newExe)) {
    throw new Error('Update file not found');
  }
  currentExe = process.env.PORTABLE_EXECUTABLE_FILE || currentExe;
  const dir = path.dirname(newExe);
  const stamp = Date.now();
  const ps1Path = path.join(dir, `update_${stamp}.ps1`);
  const vbsPath = path.join(dir, `update_${stamp}.vbs`);
  const logPath = path.join(dir, 'update.log');
  const q = s => String(s).replace(/'/g, "''");

  const ps1 = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$waitPid = ${process.pid}`,
    `$src = '${q(newExe)}'`,
    `$dst = '${q(currentExe)}'`,
    `$log = '${q(logPath)}'`,
    `$self = '${q(ps1Path)}'`,
    `$vbs = '${q(vbsPath)}'`,
    'function Log($m) { "$(Get-Date -Format o)  $m" | Out-File -FilePath $log -Append -Encoding utf8 }',
    'try { Wait-Process -Id $waitPid -Timeout 60 -ErrorAction Stop } catch {}',
    '$ok = $false',
    'for ($i = 0; $i -lt 40; $i++) {',
    '  try {',
    '    Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop',
    '    $ok = $true',
    '    break',
    '  } catch {',
    '    Start-Sleep -Milliseconds 500',
    '  }',
    '}',
    'if ($ok) {',
    '  Remove-Item -LiteralPath $src -Force',
    '  Start-Process -FilePath $dst',
    '} else {',
    '  Log "Failed to replace $dst after 40 attempts"',
    '}',
    'Remove-Item -LiteralPath $vbs -Force',
    'Remove-Item -LiteralPath $self -Force',
  ].join('\r\n');

  const vbs =
    'CreateObject("WScript.Shell").Run ' +
    `"powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${ps1Path}""", 0, False`;

  fs.writeFileSync(ps1Path, ps1, 'utf8');
  fs.writeFileSync(vbsPath, vbs, 'utf8');
  spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  app.quit();
};

module.exports = {
  getLatestRelease,
  downloadFile,
  spawnUpdater,
  semverGt,
  sha256File,
  expectedChecksum,
};
