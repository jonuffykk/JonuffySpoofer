'use strict';

const path = require('path');
const crypto = require('crypto');
const os = require('os');
const fsSync = require('fs');
const fs = require('fs').promises;
const { ipcMain, app, dialog, shell } = require('electron');
const { getStudioConnection, setMappings } = require('./connect');
const {
  sleep,
  sanitizeFilename,
  buildCookieHeader,
  classifyError,
  dedupeById,
  parseAssetInput,
  formatEntry,
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
  saveSession,
  loadSession,
  clearSession,
  loadHistory,
  clearHistory,
  loadRuns,
  saveRuns,
  hKey,
  rememberMapping,
} = require('./roblox');

let paused = false;
let pauseResolvers = [];
const pauseSpoofer = () => {
  paused = true;
};
const resumeSpoofer = () => {
  paused = false;
  pauseResolvers.splice(0).forEach(r => r());
};
const checkPaused = () => (paused ? new Promise(r => pauseResolvers.push(r)) : Promise.resolve());

function registerIpcHandlers(getMainWindow, sendTransferUpdate, sendSpooferResult, sendStatus) {
  ipcMain.handle('get-runs-history', async () => {
    return await loadRuns();
  });
  ipcMain.handle('clear-runs-history', async () => {
    await saveRuns([]);
    return { ok: true };
  });
  ipcMain.handle('delete-run', async (_e, id) => {
    const list = await loadRuns();
    const updated = list.filter(r => r.id !== id);
    await saveRuns(updated);
    return { ok: true };
  });

  ipcMain.on('window-minimize', () => getMainWindow()?.minimize());
  ipcMain.on('window-close', () => app.quit());
  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.on('open-external', (_e, url) => {
    try {
      const { hostname } = new URL(url);
      const allowed = [
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
      ];
      if (allowed.some(h => hostname === h || hostname.endsWith('.' + h))) shell.openExternal(url);
    } catch {}
  });

  ipcMain.handle('get-plugin-status', async () => {
    if (process.platform !== 'win32') return { installed: false, platform: process.platform };
    try {
      const dir = path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'Roblox',
        'Plugins'
      );
      if (!fsSync.existsSync(dir)) return { installed: false };
      const found = fsSync.readdirSync(dir).find(n => /^JonuffySpoofer.*\.rbxmx$/i.test(n));
      return { installed: !!found, file: found || null };
    } catch {
      return { installed: false };
    }
  });

  ipcMain.handle('install-plugin', async () => {
    if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
    try {
      const pluginsDir = path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'Roblox',
        'Plugins'
      );
      await fs.mkdir(pluginsDir, { recursive: true });
      const searchDirs = [
        process.resourcesPath,
        path.join(app.getAppPath(), 'dist'),
        path.join(app.getAppPath(), '..', 'dist'),
        app.getAppPath(),
      ].filter(Boolean);
      let srcPath = null;
      for (const dir of searchDirs) {
        if (!fsSync.existsSync(dir)) continue;
        const f = fsSync.readdirSync(dir).find(n => /^JonuffySpoofer-v.*\.rbxmx$/i.test(n));
        if (f) {
          srcPath = path.join(dir, f);
          break;
        }
      }
      if (!srcPath) return { ok: false, error: 'Plugin file not found. Run npm run plugin first.' };
      for (const old of fsSync
        .readdirSync(pluginsDir)
        .filter(n => /^JonuffySpoofer-v.*\.rbxmx$/i.test(n)))
        fsSync.unlinkSync(path.join(pluginsDir, old));
      const destPath = path.join(pluginsDir, path.basename(srcPath));
      await fs.copyFile(srcPath, destPath);
      return { ok: true, path: destPath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.on('open-plugins-folder', () => {
    try {
      const dir = path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'Roblox',
        'Plugins'
      );
      fsSync.mkdirSync(dir, { recursive: true });
      shell.openPath(dir);
    } catch {}
  });

  ipcMain.handle('select-folder', async () => {
    const win = getMainWindow();
    const r = await dialog.showOpenDialog(win?.isDestroyed() ? undefined : win, {
      properties: ['openDirectory'],
    });
    return r.canceled ? null : r.filePaths[0] || null;
  });

  ipcMain.on('spoofer-pause', pauseSpoofer);
  ipcMain.on('spoofer-resume', resumeSpoofer);
  ipcMain.handle('check-session', loadSession);
  ipcMain.on('clear-session', clearSession);
  ipcMain.handle('clear-app-history', async () => {
    await clearSession();
    await clearHistory();
    return { ok: true };
  });

  ipcMain.handle('check-for-updates', async () => {
    const semverGt = (a, b) => {
      const pa = a.replace(/^v/, '').split('.').map(Number);
      const pb = b.replace(/^v/, '').split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff > 0) return true;
        if (diff < 0) return false;
      }
      return false;
    };
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
      const upToDate = !semverGt(latest, current);
      return {
        current,
        latest: data.tag_name || latest,
        upToDate,
        releaseUrl: data.html_url || `https://github.com/jonuffykk/JonuffySpoofer/releases/latest`,
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

  ipcMain.handle('can-upload-to-group', async (_e, { cookie, groupId, apiKey }) => {
    return canUploadToGroup(cookie, groupId, apiKey);
  });

  ipcMain.handle('uninstall-app', async () => {
    try {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const appName = 'Jonuffy Spoofer';
      const targets = [
        app.getPath('userData'),
        path.join(localAppData, appName),
        path.join(localAppData, 'Programs', appName),
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
      const robloxPlugins = path.join(localAppData, 'Roblox', 'Plugins');
      if (fsSync.existsSync(robloxPlugins))
        for (const n of fsSync.readdirSync(robloxPlugins))
          if (/jonuffy.*\.rbxmx$/i.test(n)) targets.push(path.join(robloxPlugins, n));
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

  ipcMain.handle('get-studio-connection', getStudioConnection);

  ipcMain.on('run-spoofer-action', async (_e, data) => {
    resumeSpoofer();
    try {
      await runSpoofer(data);
    } catch (err) {
      sendSpooferResult({ output: `Spoofer action failed: ${err.message || err}`, success: false });
      sendStatus('Spoofer action failed');
    }
  });

  async function runSpoofer(data) {
    const isSoundMode = !!data.spoofSounds;
    const assetType = isSoundMode ? 'Audio' : 'Animation';
    const ext = isSoundMode ? '.ogg' : '.rbxm';
    const hasCustomFolder = !!(data.downloadOnly && data.downloadFolder?.trim());
    const tmpDir = hasCustomFolder
      ? data.downloadFolder.trim()
      : path.join(app.getPath('userData'), 'jonuffy_temp');

    const runId = crypto.randomUUID();
    const runRecord = {
      id: runId,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: 'active',
      input: data.animationId || '',
      downloadOnly: !!data.downloadOnly,
      spoofSounds: isSoundMode,
      groupId: data.groupId || '',
      transfers: [],
      output: null,
      success: null,
      failedCount: 0,
      summary: null,
    };

    const updateRunRecord = async updates => {
      Object.assign(runRecord, updates);
      const list = await loadRuns();
      const idx = list.findIndex(r => r.id === runId);
      if (idx !== -1) {
        list[idx] = runRecord;
      } else {
        list.unshift(runRecord);
      }
      await saveRuns(list);
    };

    await updateRunRecord({});

    const parentSendTransferUpdate = sendTransferUpdate;
    const trackingSendTransferUpdate = update => {
      parentSendTransferUpdate(update);
      let t = runRecord.transfers.find(x => x.id === update.id);
      let statusChanged = false;
      if (!t) {
        t = {
          id: update.id,
          name: update.name || '',
          originalAssetId: update.originalAssetId || '',
          status: 'queued',
          direction: 'download',
          progress: 0,
          size: 0,
        };
        runRecord.transfers.push(t);
        statusChanged = true;
      }
      if (update.status && update.status !== t.status) {
        statusChanged = true;
      }
      Object.assign(t, update);
      if (statusChanged) {
        updateRunRecord({});
      }
    };
    sendTransferUpdate = trackingSendTransferUpdate;

    let entries = [];
    const fail = async msg => {
      sendSpooferResult({ output: msg, success: false });
      sendStatus('Error');
      await updateRunRecord({
        finishedAt: new Date().toISOString(),
        status: 'failed',
        output: msg,
        success: false,
        failedCount: entries?.length || 0,
      });
    };

    if (data.downloadOnly && !data.downloadFolder?.trim())
      return await fail('Please select a download folder for Download-Only mode.');
    if (!data.enableSpoofing && !data.downloadOnly)
      return await fail('Enable Spoofing is OFF and Download-Only is not enabled.');
    if (data.groupId && !/^\d+$/.test(String(data.groupId).trim()))
      return await fail(`Invalid Group ID "${data.groupId}" — must be a number.`);
    if (!data.downloadOnly && !data.apiKey)
      return await fail(
        'Uploads require an Open Cloud API key.\n\nGo to create.roblox.com → Open Cloud → API Keys, create a key with Assets Read & Write, and paste it here.'
      );
    if (!data.animationId?.trim()) return await fail('No asset IDs provided.');

    entries = parseAssetInput(data.animationId);
    if (!entries.length) return await fail(`No valid ${assetType} entries.`);

    const cookie = data.robloxCookie?.trim() || '';
    if (!cookie) return await fail('No Roblox cookie provided.');
    const cookieHeader = buildCookieHeader(cookie);
    if (!cookieHeader) return await fail('Invalid ROBLOSECURITY cookie format.');

    try {
      if (!hasCustomFolder) await clearDir(tmpDir);
      await fs.mkdir(tmpDir, { recursive: true }).catch(() => {});

      const isResume = data.resumeSession === true;
      const autoSave = data.autoSaveSession !== false;
      let session = isResume ? await loadSession() : null;

      if (isResume && session) {
        data.animationId =
          session.retryAnimationIdInput || session.animationIdInput || data.animationId;
        const done = new Set((session.completedMappings || []).map(m => m.originalId));
        entries.splice(0, entries.length, ...entries.filter(e => !done.has(String(e.id))));
        if (!entries.length) {
          const out = (session.completedMappings || [])
            .map(m => `${m.originalId} = ${m.newId},`)
            .join('\n')
            .replace(/,$/, '');
          sendSpooferResult({ output: out, success: true });
          sendStatus('Session already complete');
          await clearSession();
          return;
        }
        sendSpooferResult({
          output: `Resuming — ${entries.length} asset(s) remaining.\n`,
          success: true,
        });
      } else {
        session = {
          startedAt: new Date().toISOString(),
          status: 'incomplete',
          animationIdInput: data.animationId,
          totalCount: entries.length,
          completedMappings: [],
          failedEntries: [],
          retryAnimationIdInput: '',
          lastUpdatedAt: new Date().toISOString(),
        };
        if (autoSave) await saveSession(session);
      }

      const persist = () => (autoSave && session ? saveSession(session) : Promise.resolve());
      const maxPlaceIds = parseInt(data.maxPlaceIds) || 10;
      const maxPlaceRetries = parseInt(data.maxPlaceIdRetries) || 3;
      const uploadTarget = data.groupId?.trim() ? `group:${data.groupId}` : 'user';
      const history = await loadHistory();
      const cached = [];

      if (!data.downloadOnly && !isResume) {
        for (let i = entries.length - 1; i >= 0; i--) {
          const e = entries[i];
          const rec = history[hKey(assetType, uploadTarget, e.id)];
          if (rec?.newId) {
            cached.unshift({ entry: e, newId: String(rec.newId) });
            entries.splice(i, 1);
          }
        }
        if (cached.length) sendStatus(`Skipped ${cached.length} cached mapping(s)`);
      }

      let mappingOutput = cached.map(c => `${c.entry.id} = ${c.newId},`).join('\n');
      if (mappingOutput) mappingOutput += '\n';

      if (!entries.length) {
        const mappings = mappingOutput
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean);
        const cachedSummary = {
          total: cached.length,
          downloaded: 0,
          uploaded: 0,
          cached: cached.length,
          downloadFailures: 0,
          uploadFailures: 0,
          skippedUploads: cached.length,
          downloadOnly: false,
          mode: 'Cached',
          durationSeconds: 0,
          failureCategories: {},
          failures: [],
          mappings,
        };
        await updateRunRecord({
          finishedAt: new Date().toISOString(),
          status: 'complete',
          output: mappingOutput.trim().replace(/,$/, ''),
          success: true,
          failedCount: 0,
          summary: cachedSummary,
        });
        sendSpooferResult({
          output: mappingOutput.trim().replace(/,$/, ''),
          success: true,
          failedCount: 0,
          summary: cachedSummary,
        });
        sendStatus('Run complete — cached mappings reused');
        return;
      }

      const transfers = entries.map(e => ({
        id: crypto.randomUUID(),
        name: e.name,
        originalAssetId: e.id,
        status: 'queued',
        direction: 'download',
        progress: 0,
        size: 0,
      }));
      for (const t of transfers) sendTransferUpdate(t);
      sendStatus(`0/${entries.length} spoofed`);

      const overridePlaceId = data.overridePlaceId ? parseInt(data.overridePlaceId) : null;
      const placeIdMap = {};
      const creatorKeys = [...new Set(entries.map(e => `${e.creatorType}:${e.creatorId}`))];

      if (overridePlaceId) {
        for (const k of creatorKeys) placeIdMap[k] = [overridePlaceId];
      } else {
        await Promise.all(
          creatorKeys.map(async k => {
            const [type, id] = k.split(':');
            try {
              placeIdMap[k] = await retryAsync(
                () => getPlaceIds(type, id, cookie, maxPlaceIds),
                maxPlaceRetries,
                1000
              );
            } catch {
              placeIdMap[k] = [99840799534728];
            }
          })
        );
      }

      const BATCH_RETRIES = parseInt(data.batchRetries) || 3;
      const BATCH_DELAY = parseInt(data.batchRetryDelay) || 2000;
      const BATCH_TIMEOUT = parseInt(data.batchTimeoutMs) || 15000;
      let chunkSize = Math.max(
        1,
        Math.min(parseInt(data.batchChunkSize) || (entries.length > 50 ? 10 : 20), 25)
      );
      const locMap = {};
      let hasAuthError = false;

      const singleFallback = async item => {
        const pids = placeIdMap[`${item.creatorType}:${item.creatorId}`] || [99840799534728];
        const { creatorType, creatorId, ...req } = item;
        for (const pid of pids) {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), Math.max(BATCH_TIMEOUT, 20000));
            const r = await fetch('https://assetdelivery.roblox.com/v2/assets/batch', {
              method: 'POST',
              headers: {
                'User-Agent': 'RobloxStudio/WinInet',
                'Content-Type': 'application/json',
                Cookie: cookieHeader,
                'Roblox-Place-Id': String(pid),
              },
              body: JSON.stringify([req]),
              signal: ctrl.signal,
            }).finally(() => clearTimeout(t));
            if (r.ok) {
              const loc = await r.json();
              if (loc?.[0]) return loc[0];
            }
          } catch {}
        }
        return {
          requestId: item.requestId,
          errors: [{ code: 0, message: 'Single-asset fallback failed' }],
        };
      };

      const batchItems = entries.map(e => ({
        requestId: String(e.id),
        assetType,
        assetId: String(e.id),
        creatorType: e.creatorType,
        creatorId: String(e.creatorId),
      }));

      for (let i = 0; i < batchItems.length; i += chunkSize) {
        const chunk = batchItems.slice(i, i + chunkSize);
        try {
          const groups = chunk.reduce((acc, item) => {
            const k = `${item.creatorType}:${item.creatorId}`;
            (acc[k] = acc[k] || []).push(item);
            return acc;
          }, {});
          let gi = 0;
          for (const [k, items] of Object.entries(groups)) {
            if (gi++ > 0) await sleep(500);
            let pids = placeIdMap[k] || [99840799534728];
            let pi = 0,
              retried = 0;
            while (pi < pids.length) {
              const reqs = items.map(({ creatorType, creatorId, ...r }) => r);
              let locs;
              for (let a = 1; a <= BATCH_RETRIES; a++) {
                const ctrl = new AbortController();
                const t = setTimeout(() => ctrl.abort(), BATCH_TIMEOUT);
                let resp = null,
                  caughtErr = null;
                try {
                  resp = await fetch('https://assetdelivery.roblox.com/v2/assets/batch', {
                    method: 'POST',
                    headers: {
                      'User-Agent': 'RobloxStudio/WinInet',
                      'Content-Type': 'application/json',
                      Cookie: cookieHeader,
                      'Roblox-Place-Id': String(pids[pi]),
                    },
                    body: JSON.stringify(reqs),
                    signal: ctrl.signal,
                  });
                } catch (e) {
                  caughtErr = e;
                } finally {
                  clearTimeout(t);
                }
                if (resp?.ok) {
                  locs = await resp.json();
                  break;
                }
                const status = resp?.status || 0;
                const retryable =
                  caughtErr?.name === 'AbortError' || [429, 500, 502, 503, 504].includes(status);
                if (!retryable || a === BATCH_RETRIES)
                  throw new Error(`Batch failed ${k}: ${status || caughtErr?.message}`);
                await sleep(status === 429 ? Math.max(BATCH_DELAY, 15000) : BATCH_DELAY);
              }
              if (!locs) throw new Error(`No batch response for ${k}`);
              if (locs.some(l => l.errors?.[0]?.code === 403)) {
                if (pi < pids.length - 1) {
                  pi++;
                  continue;
                }
                if (!overridePlaceId && retried++ < maxPlaceRetries) {
                  try {
                    const fresh = await retryAsync(
                      () => getPlaceIds(k.split(':')[0], k.split(':')[1], cookie, maxPlaceIds),
                      1,
                      1000
                    );
                    pids = placeIdMap[k] = fresh;
                    pi = 0;
                    continue;
                  } catch {}
                }
              }
              for (const l of locs) locMap[l.requestId] = l;
              break;
            }
          }
        } catch (err) {
          if (/\b401\b|\b403\b/.test(err?.message)) hasAuthError = true;
          sendStatus(`Batch failed, retrying ${chunk.length} item(s) individually…`);
          for (const item of chunk) {
            const t = transfers.find(x => x.originalAssetId === item.requestId);
            if (t)
              sendTransferUpdate({
                id: t.id,
                status: 'processing',
                message: 'Retrying as single lookup',
              });
            locMap[item.requestId] = await singleFallback(item);
          }
          chunkSize = Math.max(1, Math.floor(chunkSize / 2));
        }
      }

      const DL_RETRIES = parseInt(data.downloadRetries) || 2;
      const DL_DELAY = parseInt(data.downloadRetryDelayMs) || 2000;
      const DL_TIMEOUT = parseInt(data.downloadTimeoutMs) || 15000;
      const problemCount = entries.filter(e => {
        const l = locMap[e.id];
        return !l || l.errors?.length || !l.locations?.length;
      }).length;
      const baseDlConc = Math.min(parseInt(data.downloadConcurrency) || 10, entries.length);
      const dlConcurrency =
        problemCount > 0
          ? Math.max(2, Math.min(baseDlConc, Math.ceil(entries.length / 12) || 2))
          : baseDlConc;
      let dlDone = 0;
      const dlStart = Date.now();

      sendStatus(`Downloading ${assetType}s…`);

      const dlOpts = { timeoutMs: DL_TIMEOUT, retries: DL_RETRIES, retryDelayMs: DL_DELAY };

      const downloadOne = async entry => {
        const filePath = path.join(tmpDir, `${sanitizeFilename(entry.name)}_${entry.id}${ext}`);
        const transfer = transfers.find(t => t.originalAssetId === entry.id);
        sendTransferUpdate({ id: transfer.id, status: 'processing' });
        const placeId = (placeIdMap[`${entry.creatorType}:${entry.creatorId}`] || [
          99840799534728,
        ])[0];

        const tryUrl = (url, msg) => {
          if (msg) sendTransferUpdate({ id: transfer.id, status: 'processing', message: msg });
          return downloadAsset(
            url,
            cookie,
            filePath,
            transfer.id,
            entry.name,
            entry.id,
            sendTransferUpdate,
            placeId,
            dlOpts
          );
        };

        const loc = locMap[entry.id];
        let result;

        if (loc?.locations?.[0]?.location) {
          result = await tryUrl(loc.locations[0].location);
        } else {
          const batchErr =
            loc?.errors?.[0]?.Message ||
            loc?.errors?.[0]?.message ||
            'No location in batch response';
          for (const url of [
            `https://assetdelivery.roblox.com/v1/asset?id=${entry.id}&placeId=${placeId}`,
            `https://assetdelivery.roblox.com/v1/asset/?id=${entry.id}`,
          ]) {
            result = await tryUrl(url, 'Batch failed; trying direct fallback…');
            if (result?.success) break;
          }
          if (!result?.success)
            return {
              entry,
              success: false,
              error: `Batch: ${batchErr}. Fallback: ${result?.error || 'failed'}`,
            };
        }

        dlDone++;
        const avg = (Date.now() - dlStart) / 1000 / dlDone;
        const rem = entries.length - dlDone;
        const eta =
          rem > 0
            ? ` (ETA: ${Math.floor((avg * rem) / 60)}:${String(Math.ceil(avg * rem) % 60).padStart(2, '0')})`
            : '';
        sendStatus(`Downloaded ${dlDone}/${entries.length} ${assetType}s${eta}`);
        return {
          entry,
          filePath: result.success ? filePath : null,
          success: result.success,
          error: result.error,
        };
      };

      const dlResults = await runWithConcurrency(entries, dlConcurrency, downloadOne);

      const UL_RETRIES = parseInt(data.uploadRetries) || 3;
      const UL_DELAY = parseInt(data.uploadRetryDelay) || 5000;
      let ulResults = [];

      if (data.downloadOnly) {
        sendStatus('Download-only: skipping uploads');
      } else {
        let authUserId = null;
        if (!data.groupId) {
          try {
            authUserId = await getAuthUserId(cookie);
          } catch (err) {
            sendSpooferResult({
              output: `Failed to resolve user ID: ${err.message}`,
              success: false,
            });
            return;
          }
        }

        const successful = dlResults.filter(r => r.success);
        const ulConcurrency = Math.min(parseInt(data.uploadConcurrency) || 10, successful.length);
        let ulDone = 0;
        const ulStart = Date.now();
        sendStatus(`Uploading ${assetType}s…`);

        const uploadOne = async dlResult => {
          const { entry, filePath } = dlResult;
          const tid = crypto.randomUUID();
          const size = (await fs.stat(filePath).catch(() => ({ size: 0 }))).size;
          sendTransferUpdate({
            id: tid,
            name: entry.name,
            originalAssetId: entry.id,
            status: 'queued',
            direction: 'upload',
            progress: 0,
            size,
          });

          const doUpload = async () => {
            await checkPaused();
            const r = await uploadAsset(
              filePath,
              entry.name,
              data.groupId?.trim() || null,
              tid,
              sendTransferUpdate,
              assetType,
              data.apiKey || null,
              authUserId || null
            );
            if (!r.success) throw new Error(r.error || 'Upload failed');
            return r;
          };

          const onFail = (a, max, err) => {
            const c = classifyError(err);
            sendTransferUpdate({
              id: tid,
              status: a >= max ? 'error' : 'cooldown',
              message: `${c.category}: ${a >= max ? 'No more retries.' : 'Waiting…'}`,
              error: c.message,
              errorCategory: c.category,
            });
          };

          const onTick = (rem, total, next, max, err) => {
            const c = classifyError(err);
            sendTransferUpdate({
              id: tid,
              status: 'cooldown',
              progress: Math.round(((total - rem) / total) * 100),
              message: `${c.category}: retrying in ${rem}s (${next}/${max})`,
              error: c.message,
              errorCategory: c.category,
              cooldownRemaining: rem,
            });
            sendStatus(`Cooldown: retrying ${entry.name} in ${rem}s`);
          };

          try {
            const r = await retryWithCooldown(doUpload, UL_RETRIES, UL_DELAY, onFail, onTick);
            if (r.success && r.assetId) {
              if (!session.completedMappings.some(m => String(m.originalId) === String(entry.id)))
                session.completedMappings.push({ originalId: String(entry.id), newId: r.assetId });
              await rememberMapping(assetType, uploadTarget, entry.id, r.assetId, entry.name);
              session.lastUpdatedAt = new Date().toISOString();
              await persist();
            }
            ulDone++;
            const avg = (Date.now() - ulStart) / 1000 / ulDone;
            const rem = successful.length - ulDone;
            const eta =
              rem > 0
                ? ` (ETA: ${Math.floor((avg * rem) / 60)}:${String(Math.ceil(avg * rem) % 60).padStart(2, '0')})`
                : '';
            sendStatus(`Uploaded ${ulDone}/${successful.length} ${assetType}s${eta}`);
            return { entry, success: r.success, assetId: r.assetId, error: r.error };
          } catch (err) {
            const c = classifyError(err);
            sendTransferUpdate({
              id: tid,
              status: 'error',
              error: c.message,
              errorCategory: c.category,
              message: `All retries failed: ${c.category}`,
            });
            ulDone++;
            return {
              entry,
              success: false,
              error: c.message,
              errorCategory: c.category,
              rawError: c.raw,
            };
          }
        };

        ulResults = await runWithConcurrency(successful, ulConcurrency, uploadOne);
      }

      let dlSuccess = 0,
        ulSuccess = 0;
      for (const r of dlResults) {
        if (!r.success) continue;
        dlSuccess++;
        if (!data.downloadOnly) {
          const u = ulResults.find(x => x.entry.id === r.entry.id);
          if (u?.success) {
            ulSuccess++;
            mappingOutput += `${r.entry.id} = ${u.assetId},\n`;
          }
        }
      }

      sendStatus('Run complete — see Run Report');

      const finishedAt = new Date().toISOString();
      const duration = Math.max(
        0,
        Math.round((Date.now() - new Date(session.startedAt).getTime()) / 1000)
      );

      const mkFailures = (list, stage) =>
        list
          .filter(r => !r.success)
          .map(r => {
            const c = classifyError(r.rawError || r.error || 'Unknown error');
            return {
              id: r.entry.id,
              name: r.entry.name,
              creator: `${r.entry.creatorType}:${r.entry.creatorId}`,
              reason: r.error || c.message,
              category: r.errorCategory || c.category,
              raw: r.rawError || c.raw,
              stage,
            };
          });

      const dlFails = mkFailures(dlResults, 'Download');
      const ulFails = data.downloadOnly ? [] : mkFailures(ulResults, 'Upload');
      const rateLimited = ulFails.filter(f => f.category === 'Rate limited');

      let output;
      if (data.downloadOnly) {
        const list = dlResults
          .filter(r => r.success)
          .map(r => `${r.entry.name} (ID: ${r.entry.id})`)
          .join('\n');
        output = list
          ? `Downloaded ${dlSuccess}/${entries.length} ${assetType}s to:\n${tmpDir}\n\nFiles:\n${list}`
          : `No ${assetType}s were successfully downloaded.`;
      } else if (mappingOutput.trim()) {
        output = mappingOutput.trim().replace(/,$/, '');
        setMappings(
          mappingOutput
            .split('\n')
            .map(l => l.trim())
            .filter(Boolean)
        );
      } else {
        output = hasAuthError
          ? 'Authentication failed. Check your Roblox cookie.'
          : dlSuccess > 0
            ? `Downloaded ${dlSuccess}/${entries.length}, but no uploads succeeded.`
            : `No ${assetType}s processed.`;
      }

      if (rateLimited.length)
        output += `\n\n⚠️ RATE LIMIT (429): ${rateLimited.length} upload(s) hit rate limits. Increase retry delay (current: ${UL_DELAY}ms) or retry count.`;

      const failedEntries = dedupeById(
        [...dlFails, ...ulFails]
          .map(f => entries.find(e => String(e.id) === String(f.id)))
          .filter(Boolean)
      );
      const failedInput = failedEntries.map(formatEntry).join('\n');

      if (failedEntries.length) {
        Object.assign(session, {
          status: 'incomplete',
          lastUpdatedAt: finishedAt,
          failedEntries: failedEntries.map(e => ({
            id: String(e.id),
            name: e.name,
            creatorType: e.creatorType,
            creatorId: String(e.creatorId),
          })),
          retryAnimationIdInput: failedInput,
          totalCount: entries.length,
        });
        await persist();
      } else {
        session.status = 'complete';
        await clearSession();
      }

      if (!data.downloadOnly) await clearDir(tmpDir).catch(() => {});

      const allFails = [...dlFails, ...ulFails];
      const finalSummary = {
        total: entries.length + cached.length,
        downloaded: dlSuccess,
        uploaded: ulSuccess,
        cached: cached.length,
        downloadFailures: dlFails.length,
        uploadFailures: ulFails.length,
        skippedUploads: data.downloadOnly ? 0 : dlFails.length,
        downloadOnly: !!data.downloadOnly,
        mode: data.downloadOnly ? 'Download-Only' : 'Download + Upload',
        startedAt: session.startedAt,
        finishedAt,
        durationSeconds: duration,
        failureCategories: allFails.reduce((a, f) => {
          a[f.category || 'Unknown'] = (a[f.category || 'Unknown'] || 0) + 1;
          return a;
        }, {}),
        failures: allFails,
        mappings: mappingOutput
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean),
      };

      await updateRunRecord({
        finishedAt,
        status: failedEntries.length ? 'incomplete' : 'complete',
        output,
        success: dlSuccess > 0 || ulSuccess > 0,
        failedCount: failedEntries.length,
        summary: finalSummary,
      });

      sendSpooferResult({
        output,
        success: dlSuccess > 0 || ulSuccess > 0,
        failedAnimationIdInput: failedInput,
        failedCount: failedEntries.length,
        summary: finalSummary,
      });
    } catch (err) {
      await fail(err.message || String(err));
    }
  }
}

module.exports = {
  registerIpcHandlers,
};
