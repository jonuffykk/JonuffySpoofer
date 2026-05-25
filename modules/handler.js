'use strict';

const path = require('path');
const os = require('os');
const fsSync = require('fs');
const fs = require('fs').promises;
const { ipcMain, app, dialog, shell } = require('electron');
const { getConn, setMappings, setScanHandler } = require('./connect');
const {
  sleep,
  sanitizeFilename,
  buildCookieHeader,
  classifyError,
  parseAssetInput,
  retryAsync,
  retryWithCooldown,
  runWithConcurrency,
  clearDir,
  getPlaceIds,
  getAuthUserId,
  getAuthUserInfo,
  getUserGroups,
  canUploadToGroup,
  downloadAsset,
  uploadAsset,
  loadSession,
  clearSession,
  loadHistory,
  clearHistory,
  hKey,
  rememberMapping,
} = require('./roblox');
const { getLatestRelease, downloadFile, spawnUpdater } = require('./updater');

let paused = false;
let pauseQueue = [];
const pauseCheck = () => (paused ? new Promise(r => pauseQueue.push(r)) : Promise.resolve());
const doPause = () => {
  paused = true;
};
const doResume = () => {
  paused = false;
  pauseQueue.splice(0).forEach(r => r());
};

const ALLOWED_HOSTS = new Set([
  'github.com',
  'discord.gg',
  'roblox.com',
  'create.roblox.com',
  'apis.roblox.com',
  'games.roblox.com',
  'users.roblox.com',
  'auth.roblox.com',
  'assetdelivery.roblox.com',
  'publish.roblox.com',
  'www.roblox.com',
]);

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

const pluginsDir = () =>
  path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'Roblox',
    'Plugins'
  );

const findPluginFile = dir =>
  fsSync.existsSync(dir)
    ? fsSync.readdirSync(dir).find(n => /^JonuffySpoofer.*\.rbxmx$/i.test(n))
    : null;

const findDistPlugin = () => {
  const dirs = [
    process.resourcesPath,
    path.join(app.getAppPath(), 'dist'),
    path.join(app.getAppPath(), '..', 'dist'),
    app.getAppPath(),
  ].filter(Boolean);
  for (const d of dirs) {
    if (!fsSync.existsSync(d)) continue;
    const f = fsSync.readdirSync(d).find(n => /^JonuffySpoofer-v.*\.rbxmx$/i.test(n));
    if (f) return path.join(d, f);
  }
  return null;
};

function registerIpcHandlers(getWin, emit) {
  ipcMain.on('win-minimize', () => getWin()?.minimize());
  ipcMain.on('win-close', () => app.quit());
  ipcMain.handle('app-version', () => app.getVersion());

  ipcMain.on('open-external', (_e, url) => {
    try {
      const { hostname } = new URL(url);
      if (ALLOWED_HOSTS.has(hostname) || [...ALLOWED_HOSTS].some(h => hostname.endsWith('.' + h)))
        shell.openExternal(url);
    } catch {}
  });

  ipcMain.handle('plugin-status', async () => {
    if (process.platform !== 'win32') return { installed: false, platform: process.platform };
    try {
      const dir = pluginsDir();
      const found = findPluginFile(dir);
      return { installed: !!found, file: found || null };
    } catch {
      return { installed: false };
    }
  });

  ipcMain.handle('install-plugin', async () => {
    if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
    try {
      const dir = pluginsDir();
      await fs.mkdir(dir, { recursive: true });
      const src = findDistPlugin();
      if (!src) return { ok: false, error: 'Plugin file not found. Run npm run plugin first.' };
      for (const old of fsSync.readdirSync(dir).filter(n => /^JonuffySpoofer-v.*\.rbxmx$/i.test(n)))
        fsSync.unlinkSync(path.join(dir, old));
      const dest = path.join(dir, path.basename(src));
      await fs.copyFile(src, dest);
      return { ok: true, path: dest };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('plugin-update-status', async () => {
    if (process.platform !== 'win32') return { hasUpdate: false };
    try {
      const dir = pluginsDir();
      const installedFile = findPluginFile(dir);
      const installedVersion = installedFile?.match(/v?(\d+\.\d+(?:\.\d+)?)/i)?.[1] || null;
      const distSrc = findDistPlugin();
      const distVersion = distSrc
        ? path.basename(distSrc).match(/v?(\d+\.\d+(?:\.\d+)?)/i)?.[1]
        : null;
      if (!distVersion) return { hasUpdate: false };
      if (!installedVersion) return { hasUpdate: true, distVersion, installedVersion: null };
      return { hasUpdate: semverGt(distVersion, installedVersion), distVersion, installedVersion };
    } catch {
      return { hasUpdate: false };
    }
  });

  ipcMain.on('open-plugins-folder', () => {
    try {
      const dir = pluginsDir();
      fsSync.mkdirSync(dir, { recursive: true });
      shell.openPath(dir);
    } catch {}
  });

  ipcMain.handle('select-folder', async () => {
    const win = getWin();
    const r = await dialog.showOpenDialog(win?.isDestroyed() ? undefined : win, {
      properties: ['openDirectory'],
    });
    return r.canceled ? null : r.filePaths[0] || null;
  });

  ipcMain.on('spoofer-pause', doPause);
  ipcMain.on('spoofer-resume', doResume);
  ipcMain.on('spoofer-stop', () => {
    doPause();
    try {
      fetch('http://127.0.0.1:28476/cancel-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {}
  });
  ipcMain.handle('check-session', loadSession);
  ipcMain.on('clear-session', clearSession);

  ipcMain.handle('clear-history', async () => {
    await clearSession();
    await clearHistory();
    return { ok: true };
  });

  ipcMain.handle('check-updates', async () => {
    try {
      const current = app.getVersion();
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(
        'https://api.github.com/repos/jonuffykk/JonuffySpoofer/releases/latest',
        {
          headers: { 'User-Agent': 'JonuffySpoofer', Accept: 'application/vnd.github+json' },
          signal: ctrl.signal,
        }
      ).finally(() => clearTimeout(t));
      if (!r.ok) return { error: `HTTP ${r.status}` };
      const data = await r.json();
      const latest = (data.tag_name || '').replace(/^v/, '');
      return {
        current,
        latest: data.tag_name || latest,
        upToDate: !semverGt(latest, current),
        releaseUrl: data.html_url || 'https://github.com/jonuffykk/JonuffySpoofer/releases/latest',
      };
    } catch {
      return { error: 'Network error' };
    }
  });

  ipcMain.handle('fetch-user-info', async (_e, { cookie }) => {
    try {
      return await getAuthUserInfo(cookie);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('fetch-user-groups', async (_e, { cookie }) => {
    try {
      return await getUserGroups(cookie);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('can-upload-group', (_e, { cookie, groupId, apiKey }) =>
    canUploadToGroup(cookie, groupId, apiKey)
  );

  ipcMain.handle('uninstall', async () => {
    try {
      const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const appName = 'Jonuffy Spoofer';
      const targets = [
        app.getPath('userData'),
        path.join(local, appName),
        path.join(local, 'Programs', appName),
        path.join(app.getPath('desktop'), `${appName}.lnk`),
        path.join(
          app.getPath('appData'),
          'Microsoft',
          'Windows',
          'Start Menu',
          'Programs',
          `${appName}.lnk`
        ),
      ];
      const dir = pluginsDir();
      if (fsSync.existsSync(dir))
        for (const n of fsSync.readdirSync(dir))
          if (/jonuffy.*\.rbxmx$/i.test(n)) targets.push(path.join(dir, n));
      for (const t of [...new Set(targets.filter(Boolean))]) {
        try {
          if (!fsSync.existsSync(t)) continue;
          fsSync.lstatSync(t).isDirectory()
            ? fsSync.rmSync(t, { recursive: true, force: true })
            : fsSync.unlinkSync(t);
        } catch {}
      }
      app.quit();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('get-studio-conn', getConn);

  ipcMain.on('run-spoofer', async (_e, data) => {
    doResume();
    try {
      await runPipeline(data, emit);
    } catch (err) {
      emit('log-line', `ERR:${err.message || err}`);
      emit('status', 'Error');
      emit('result', { ok: false });
    }
  });

  ipcMain.handle('fetch-update-info', async () => {
    try {
      return await getLatestRelease();
    } catch (err) {
      return { error: err.message };
    }
  });

  let updateDest = null;
  ipcMain.on('download-update', async () => {
    try {
      const info = await getLatestRelease();
      if (!info.hasUpdate || !info.assetUrl) {
        emit('update-done', { ok: false, error: 'No update available' });
        return;
      }
      const dir = path.join(app.getPath('userData'), 'updates');
      updateDest = path.join(dir, info.assetName || 'JonuffySpoofer.exe');
      await fs.mkdir(dir, { recursive: true });
      await downloadFile(info.assetUrl, updateDest, (received, total) => {
        emit('update-progress', {
          received,
          total,
          pct: total ? Math.round((received / total) * 100) : 0,
        });
      });
      emit('update-done', { ok: true, path: updateDest });
    } catch (err) {
      emit('update-done', { ok: false, error: err.message });
    }
  });

  ipcMain.handle('apply-update', () => {
    if (!updateDest || !fsSync.existsSync(updateDest))
      return { ok: false, error: 'Update file missing' };
    spawnUpdater(process.execPath, updateDest);
    return { ok: true };
  });
}

async function runPipeline(data, emit) {
  const ext = '.rbxm';
  const assetType = 'Animation';
  const hasCustomDir = !!(data.downloadOnly && data.downloadFolder?.trim());
  const tmpDir = hasCustomDir
    ? data.downloadFolder.trim()
    : path.join(app.getPath('userData'), 'jonuffy_tmp');

  const log = msg => emit('log-line', msg);

  const fail = msg => {
    log(`ERR:${msg}`);
    emit('status', 'Error');
    emit('result', { ok: false });
  };

  if (data.downloadOnly && !data.downloadFolder?.trim())
    return fail('Select a download folder for Download-Only mode.');
  if (!data.enableSpoofing && !data.downloadOnly)
    return fail('Enable Spoofing is OFF and Download-Only is not enabled.');
  if (data.groupId && !/^\d+$/.test(String(data.groupId).trim()))
    return fail(`Invalid Group ID "${data.groupId}".`);
  if (!data.downloadOnly && !data.apiKey) return fail('Uploads require an Open Cloud API key.');

  const cookie = data.robloxCookie?.trim() || '';
  if (!cookie) return fail('No Roblox cookie provided.');
  if (!buildCookieHeader(cookie)) return fail('Invalid ROBLOSECURITY cookie format.');

  if (!hasCustomDir) await clearDir(tmpDir);
  await fs.mkdir(tmpDir, { recursive: true }).catch(() => {});

  const maxPlaceIds = parseInt(data.maxPlaceIds) || 10;
  const maxPlaceRetries = parseInt(data.maxPlaceIdRetries) || 3;
  const dlOpts = {
    timeoutMs: 30000,
    retries: 3,
    retryDelayMs: 3000,
  };
  const UL_RETRIES = parseInt(data.uploadRetries) || 3;
  const UL_DELAY = parseInt(data.uploadRetryDelay) || 5000;
  const dlConcurrency = Math.min(parseInt(data.downloadConcurrency) || 10, 25);

  let authUserId = null;
  if (!data.downloadOnly) {
    try {
      authUserId = await getAuthUserId(cookie);
    } catch (err) {
      return fail(`Failed to resolve user ID: ${err.message}`);
    }
  }

  const groupId = data.groupId?.trim() || null;
  const uploadTarget = groupId ? `group:${groupId}` : `user:${authUserId || 'unknown'}`;

  const isOwnedByTarget = entry => {
    if (groupId)
      return entry.creatorType === 'group' && String(entry.creatorId) === String(groupId);
    return (
      entry.creatorType === 'user' && authUserId && String(entry.creatorId) === String(authUserId)
    );
  };

  const history = await loadHistory();
  let totalDone = 0,
    totalFailed = 0;
  const collectedMappings = [];
  const FALLBACK_PLACES = [99840799534728, 606849621, 155615604, 5704517949];

  const processEntry = async entry => {
    await sleep(100 + Math.floor(Math.random() * 150));
    if (!data.downloadOnly && isOwnedByTarget(entry)) {
      log(`OWN:${entry.id}:${entry.name}`);
      totalDone++;
      emit('progress', { done: totalDone, failed: totalFailed });
      return;
    }

    const cached = !data.downloadOnly && history[hKey(assetType, uploadTarget, entry.id)];
    if (cached?.newId) {
      log(`CACHED:${entry.id}:${cached.newId}:${entry.name}`);
      collectedMappings.push(`${entry.id}=${cached.newId}`);
      totalDone++;
      emit('progress', { done: totalDone, failed: totalFailed });
      return;
    }

    let pids = await retryAsync(
      () => getPlaceIds(entry.creatorType, entry.creatorId, cookie, Math.max(maxPlaceIds, 10)),
      maxPlaceRetries,
      1000
    ).catch(() => []);
    pids = pids.length ? [...new Set([...pids, ...FALLBACK_PLACES])] : FALLBACK_PLACES.slice();

    let dlUrl = null;
    for (const pid of pids) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 15000);
        const resp = await fetch('https://assetdelivery.roblox.com/v2/assets/batch', {
          method: 'POST',
          headers: {
            'User-Agent': 'RobloxStudio/WinInet',
            'Content-Type': 'application/json',
            Cookie: buildCookieHeader(cookie),
            'Roblox-Place-Id': String(pid),
          },
          body: JSON.stringify([
            { requestId: String(entry.id), assetType, assetId: String(entry.id) },
          ]),
          signal: ctrl.signal,
        }).finally(() => clearTimeout(t));
        if (resp.ok) {
          const locs = await resp.json();
          if (locs?.[0]?.locations?.[0]?.location) {
            dlUrl = locs[0].locations[0].location;
            break;
          }
        }
      } catch {}
    }
    if (!dlUrl) dlUrl = `https://assetdelivery.roblox.com/v1/asset/?id=${entry.id}`;

    const filePath = path.join(tmpDir, `${sanitizeFilename(entry.name)}_${entry.id}${ext}`);
    log(`DL:${entry.id}:${entry.name}`);

    let dlResult = await downloadAsset(dlUrl, cookie, filePath, dlOpts);
    if (!dlResult?.ok) {
      const altUrl = `https://assetdelivery.roblox.com/v1/asset/?id=${entry.id}&serverplaceid=${pids[0]}`;
      dlResult = await downloadAsset(altUrl, cookie, filePath, dlOpts);
    }
    if (!dlResult?.ok) {
      log(`FAIL_DL:${entry.id}:${entry.name}:${dlResult?.error || 'unknown'}`);
      totalFailed++;
      emit('progress', { done: totalDone, failed: totalFailed });
      return;
    }

    if (data.downloadOnly) {
      log(`OK_DL:${entry.id}:${entry.name}`);
      totalDone++;
      emit('progress', { done: totalDone, failed: totalFailed });
      return;
    }

    log(`UL:${entry.id}:${entry.name}`);
    await pauseCheck();

    try {
      const ulResult = await retryWithCooldown(
        () =>
          uploadAsset(filePath, entry.name, groupId, assetType, data.apiKey || null, authUserId),
        UL_RETRIES,
        UL_DELAY,
        (attempt, max, err) =>
          log(`WARN:${entry.id}:${classifyError(err).category} (${attempt}/${max})`),
        rem => emit('status', `Cooldown ${rem}s — ${entry.name}`)
      );

      if (ulResult?.ok && ulResult.assetId) {
        log(`OK:${entry.id}:${ulResult.assetId}:${entry.name}`);
        await rememberMapping(assetType, uploadTarget, entry.id, ulResult.assetId, entry.name);
        collectedMappings.push(`${entry.id}=${ulResult.assetId}`);
        totalDone++;
        await sleep(250);
      } else {
        log(`FAIL_UL:${entry.id}:${entry.name}`);
        totalFailed++;
      }
    } catch (err) {
      log(`FAIL_UL:${entry.id}:${entry.name}:${classifyError(err).category}`);
      totalFailed++;
    }

    emit('progress', { done: totalDone, failed: totalFailed });
    try {
      if (fsSync.existsSync(filePath)) await fs.unlink(filePath).catch(() => {});
    } catch {}
  };

  const studioConn = getConn();
  if (studioConn?.connected) {
    log('INFO:Requesting scan from Studio...');
    emit('status', 'Scanning Studio...');

    try {
      await fetch('http://127.0.0.1:28476/request-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetType }),
      });
    } catch {}

    const scanTimeout = Date.now() + 120000;
    let scanDone = false;
    const scanQueue = [];
    let resolveQueue;
    const queuePromise = new Promise(res => {
      resolveQueue = res;
    });

    const onScanData = async scanData => {
      if (scanData.status === 'cancelled') {
        scanDone = true;
        resolveQueue?.();
        return;
      }
      if (scanData.status === 'scanning' && scanData.results?.length) {
        for (const e of parseAssetInput(scanData.results.join('\n'))) {
          if (!scanQueue.find(x => x.id === e.id)) {
            scanQueue.push(e);
            log(`FOUND:${e.id}:${e.name}`);
          }
        }
      }
      if (scanData.status === 'completed') {
        scanDone = true;
        resolveQueue?.();
      }
    };

    setScanHandler(onScanData);

    const processLoop = async () => {
      const processed = new Set();
      while (!scanDone || processed.size < scanQueue.length) {
        const pending = scanQueue.filter(e => !processed.has(e.id));
        if (pending.length) {
          await runWithConcurrency(pending, dlConcurrency, async entry => {
            processed.add(entry.id);
            await processEntry(entry);
          });
        } else if (!scanDone) {
          await sleep(500);
        }
        if (!scanDone && Date.now() > scanTimeout) {
          scanDone = true;
          resolveQueue?.();
        }
      }
    };

    await Promise.all([queuePromise, processLoop()]);
    setScanHandler(null);
  } else {
    return fail(
      'Studio not connected. Open Roblox Studio with the plugin to scan assets automatically.'
    );
  }

  if (!data.downloadOnly) {
    await clearDir(tmpDir).catch(() => {});
    if (studioConn?.connected && collectedMappings.length) {
      setMappings(collectedMappings);
      try {
        await fetch('http://127.0.0.1:28476/set-mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mappings: collectedMappings }),
        });
      } catch {}
    } else {
      setMappings([]);
    }
  }

  const total = totalDone + totalFailed;
  log(`SUMMARY:${totalDone}:${totalFailed}:${total}`);
  emit(
    'status',
    `Done — ${totalDone}/${total} succeeded${totalFailed > 0 ? `, ${totalFailed} failed` : ''}`
  );
  emit('result', { ok: totalDone > 0, totalDone, totalFailed });
}

module.exports = { registerIpcHandlers };
