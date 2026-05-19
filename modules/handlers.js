'use strict';

const path = require('path');
const { ipcMain, app, dialog, shell } = require('electron');
const crypto = require('crypto');
const os = require('os');
const fsSync = require('fs');
const fs = require('fs').promises;
const {
  buildRobloxCookieHeader,
  clearDownloadsDirectory,
  retryAsync,
  sanitizeFilename,
} = require('./common');
const {
  getPlaceIdFromCreator,
  getAuthenticatedUserId,
  getAuthenticatedUserInfo,
  getUserGroups,
  canUploadToGroup,
} = require('./authentication');
const {
  downloadAnimationAssetWithProgress,
  publishAnimationRbxmWithProgress,
} = require('./opencloud');

let _isPaused = false;
let _pauseResolvers = [];
function pauseSpoofer() {
  _isPaused = true;
}
function resumeSpoofer() {
  _isPaused = false;
  _pauseResolvers.splice(0).forEach(r => r());
}
async function checkPaused() {
  if (_isPaused) await new Promise(resolve => _pauseResolvers.push(resolve));
}

function getSessionPath() {
  return path.join(app.getPath('userData'), 'jonuffy_state.json');
}
async function saveSession(session) {
  try {
    await fs.writeFile(getSessionPath(), JSON.stringify(session));
  } catch {}
}
async function loadSession() {
  try {
    return JSON.parse(await fs.readFile(getSessionPath(), 'utf8'));
  } catch {
    return null;
  }
}
async function clearSession() {
  await fs.unlink(getSessionPath()).catch(() => {});
}

function getAssetHistoryPath() {
  return path.join(app.getPath('userData'), 'jonuffy_mappings.json');
}
async function loadAssetHistory() {
  try {
    const parsed = JSON.parse(await fs.readFile(getAssetHistoryPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
async function saveAssetHistory(history) {
  try {
    await fs.writeFile(getAssetHistoryPath(), JSON.stringify(history || {}, null, 2));
  } catch {}
}
function buildHistoryKey(assetTypeName, targetKey, originalId) {
  return `${assetTypeName || 'Asset'}:${targetKey || 'default'}:${String(originalId)}`;
}
async function rememberAssetMapping(assetTypeName, targetKey, originalId, newId, name) {
  if (!originalId || !newId) return;
  const history = await loadAssetHistory();
  history[buildHistoryKey(assetTypeName, targetKey, originalId)] = {
    originalId: String(originalId),
    newId: String(newId),
    name: name || '',
    assetType: assetTypeName || 'Asset',
    target: targetKey || 'default',
    savedAt: new Date().toISOString(),
  };
  await saveAssetHistory(history);
}
async function clearAssetHistory() {
  await fs.unlink(getAssetHistoryPath()).catch(() => {});
}

function formatAssetEntry(entry) {
  const creatorPrefix = entry.creatorType === 'group' ? 'G' : 'U';
  return `${entry.id} - ${entry.name} - ${creatorPrefix}: ${entry.creatorId}`;
}

function classifyError(error) {
  const raw =
    typeof error === 'string'
      ? error
      : (error && (error.message || error.error)) || 'Unknown error';
  const text = String(raw);
  const lower = text.toLowerCase();
  if (
    /\b401\b/.test(text) ||
    lower.includes('invalid roblox cookie') ||
    (lower.includes('cookie') && lower.includes('invalid')) ||
    lower.includes('authentication failed') ||
    lower.includes('failed to resolve your roblox user id')
  )
    return {
      category: 'Invalid cookie',
      message:
        'The Roblox cookie appears to be invalid or expired. Please re-enter your .ROBLOSECURITY cookie.',
      raw: text,
    };
  if (
    lower.includes('api key') ||
    lower.includes('x-api-key') ||
    (/\b403\b/.test(text) && lower.includes('open cloud'))
  )
    return {
      category: 'Invalid API key',
      message:
        'The Open Cloud API key is missing, invalid, expired, or lacks Assets read/write permissions.',
      raw: text,
    };
  if (
    /\b404\b/.test(text) ||
    lower.includes('asset unavailable') ||
    lower.includes('no location') ||
    lower.includes('no locations') ||
    lower.includes('not found') ||
    lower.includes('moderated')
  )
    return {
      category: 'Asset unavailable',
      message:
        'Roblox did not return a downloadable location for this asset. It may be private, moderated, deleted, or unavailable to the authenticated user.',
      raw: text,
    };
  if (
    /\b403\b/.test(text) ||
    lower.includes('permission') ||
    lower.includes('not authorized') ||
    lower.includes('not allowed')
  ) {
    const looksLikeDownloadAccess =
      lower.includes('access asset') || lower.includes('asset') || lower.includes('download');
    if (looksLikeDownloadAccess && !lower.includes('open cloud') && !lower.includes('group'))
      return {
        category: 'Asset access denied',
        message:
          'Roblox says this asset is private or the current cookie/place context is not allowed to download it. Use an account/place that owns or can access the source asset.',
        raw: text,
      };
    return {
      category: 'No group permission',
      message:
        'The account or API key does not appear to have permission for the selected group/upload target.',
      raw: text,
    };
  }
  if (/\b429\b/.test(text) || lower.includes('rate limit') || lower.includes('too many request'))
    return {
      category: 'Rate limited',
      message:
        'Roblox rate-limited the request. The queue will wait before retrying when retries remain.',
      raw: text,
    };
  if (
    lower.includes('network') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('econn') ||
    lower.includes('enotfound') ||
    lower.includes('socket') ||
    /\b5\d\d\b/.test(text)
  )
    return {
      category: 'Network failure',
      message:
        'The request failed because of a network/server timeout or temporary Roblox service error.',
      raw: text,
    };
  if (
    lower.includes('rbxm') ||
    lower.includes('conversion') ||
    lower.includes('convert') ||
    lower.includes('file system') ||
    lower.includes('fs') ||
    lower.includes('enoent') ||
    lower.includes('readfile')
  )
    return {
      category: 'File conversion failed',
      message: 'The downloaded file could not be read, converted, or prepared for upload.',
      raw: text,
    };
  return { category: 'Unknown error', message: text, raw: text };
}

function dedupeAssetEntries(entries) {
  const seen = new Set();
  return (entries || []).filter(entry => {
    const key = String(entry.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseAnimationIdInput(input) {
  const entries = [];
  const seen = new Set();
  if (!input || typeof input !== 'string') return entries;
  const dashPattern = /^\s*(\d+)\s+-\s+(.+?)\s+-\s+([GU]):\s*(\d+)\s*$/;
  const pipePattern = /^\s*(\d+)\s*\|\s*([^\|]+)\s*\|\s*([GU]):(\d+)\s*$/;
  const lines = input.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('--') || line.startsWith('#')) continue;
    const match = line.match(dashPattern) || line.match(pipePattern);
    if (!match) continue;
    const id = match[1].trim();
    const name = match[2].trim() || 'Unnamed';
    const creatorTypePrefix = match[3].trim();
    const creatorId = match[4].trim();
    const creatorType = creatorTypePrefix === 'G' ? 'group' : 'user';
    if (id && creatorId && !seen.has(id)) {
      seen.add(id);
      entries.push({ id, name, creatorType, creatorId });
    }
  }
  return dedupeAssetEntries(entries);
}

async function retryWithCooldown(fn, retries, delayMs, onAttemptFailure, onCooldownTick) {
  const attempts = Math.max(1, retries);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isFinal = attempt >= attempts;
      if (onAttemptFailure) onAttemptFailure(attempt, attempts, err);
      if (isFinal) throw err;
      const totalSeconds = Math.ceil(delayMs / 1000);
      for (let remaining = totalSeconds; remaining > 0; remaining--) {
        if (onCooldownTick) onCooldownTick(remaining, totalSeconds, attempt + 1, attempts, err);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
}

function registerIpcHandlers(
  getMainWindow,
  sendTransferUpdate,
  sendSpooferResultToRenderer,
  sendStatusMessage
) {
  ipcMain.on('window-minimize', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.minimize();
  });
  ipcMain.on('window-close', () => {
    app.quit();
  });
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.on('open-external', (_event, url) => {
    if (!url || typeof url !== 'string') return;
    try {
      const parsed = new URL(url);
      const allowedHosts = [
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
      const isAllowed = allowedHosts.some(
        h => parsed.hostname === h || parsed.hostname.endsWith('.' + h)
      );
      if (isAllowed) shell.openExternal(url);
      else console.warn('Blocked external URL:', url);
    } catch {
      console.warn('Invalid external URL:', url);
    }
  });
  ipcMain.handle('check-for-update', async () => {
    try {
      const current = app.getVersion();
      const resp = await fetch(
        'https://api.github.com/repos/jonuffykk/JonuffySpoofer/releases/latest',
        { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'JonuffySpoofer' } }
      );
      if (!resp.ok) return { upToDate: true, current };
      const data = await resp.json();
      const latest = (data.tag_name || '').replace(/^v/, '');
      const parseV = v => v.split('.').map(Number);
      const isNewer = (a, b) => {
        const pa = parseV(a),
          pb = parseV(b);
        for (let i = 0; i < 3; i++) {
          if ((pa[i] || 0) > (pb[i] || 0)) return true;
          if ((pa[i] || 0) < (pb[i] || 0)) return false;
        }
        return false;
      };
      if (!latest || !isNewer(latest, current)) return { upToDate: true, current, latest };
      return { upToDate: false, current, latest, url: data.html_url };
    } catch (err) {
      return { upToDate: true, error: err.message };
    }
  });

  ipcMain.handle('get-plugin-status', async () => {
    if (process.platform !== 'win32') return { installed: false, platform: process.platform };
    try {
      const pluginsDir = path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'Roblox',
        'Plugins'
      );
      if (!fsSync.existsSync(pluginsDir)) return { installed: false };
      const entries = fsSync.readdirSync(pluginsDir);
      const found = entries.find(n => /^JonuffySpoofer.*\.rbxmx$/i.test(n));
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
      const version = app.getVersion();
      const srcName = `JonuffySpoofer-v${version}.rbxmx`;
      const appRoot = app.getAppPath();
      const resourcesPath = process.resourcesPath || path.join(appRoot, '..');
      const searchDirs = [
        resourcesPath,
        path.join(appRoot, 'dist'),
        path.join(appRoot, '..', 'dist'),
        appRoot,
      ];
      let srcPath = null;
      for (const dir of searchDirs) {
        if (!fsSync.existsSync(dir)) continue;
        const exact = path.join(dir, srcName);
        if (fsSync.existsSync(exact)) {
          srcPath = exact;
          break;
        }
        const files = fsSync.readdirSync(dir);
        const f = files.find(n => /^JonuffySpoofer-v.*\.rbxmx$/i.test(n));
        if (f) {
          srcPath = path.join(dir, f);
          break;
        }
      }
      if (!srcPath) return { ok: false, error: 'Plugin file not found. Run npm run plugin first.' };
      const destPath = path.join(pluginsDir, path.basename(srcPath));
      const existing = fsSync
        .readdirSync(pluginsDir)
        .filter(n => /^JonuffySpoofer-v.*\.rbxmx$/i.test(n));
      for (const old of existing) {
        try {
          fsSync.unlinkSync(path.join(pluginsDir, old));
        } catch {}
      }
      await fs.copyFile(srcPath, destPath);
      return { ok: true, path: destPath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.on('open-plugins-folder', () => {
    try {
      const pluginsDir = path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'Roblox',
        'Plugins'
      );
      require('fs').mkdirSync(pluginsDir, { recursive: true });
      shell.openPath(pluginsDir);
    } catch {}
  });

  ipcMain.handle('select-folder', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  ipcMain.on('spoofer-pause', () => pauseSpoofer());
  ipcMain.on('spoofer-resume', () => resumeSpoofer());
  ipcMain.handle('check-session', async () => loadSession());
  ipcMain.on('clear-session', async () => {
    await clearSession();
  });
  ipcMain.handle('clear-app-history', async () => {
    await clearSession();
    await clearAssetHistory();
    return { ok: true };
  });
  ipcMain.handle('fetch-audio-quota', async (_event, { cookie }) => {
    const resolvedCookie = cookie;
    if (!resolvedCookie) return { error: 'No cookie available' };
    const cookieHeader = buildRobloxCookieHeader(resolvedCookie);
    if (!cookieHeader) return { error: 'Invalid cookie' };
    try {
      const resp = await fetch('https://publish.roblox.com/v1/asset-quotas?resourceType=Audio', {
        headers: {
          Cookie: cookieHeader,
          'User-Agent': 'RobloxStudio/WinInet',
          Accept: 'application/json',
        },
      });
      if (!resp.ok) return { error: `HTTP ${resp.status}` };
      return await resp.json();
    } catch {
      return { error: 'Network error' };
    }
  });

  ipcMain.handle('fetch-user-info', async (_event, { cookie }) => {
    const resolvedCookie = cookie;
    if (!resolvedCookie) return { error: 'No cookie available' };
    try {
      return await getAuthenticatedUserInfo(resolvedCookie);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('fetch-user-groups', async (_event, { cookie }) => {
    const resolvedCookie = cookie;
    if (!resolvedCookie) return { error: 'No cookie available' };
    try {
      return await getUserGroups(resolvedCookie);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('can-upload-to-group', async (_event, { cookie, groupId, apiKey }) => {
    const resolvedCookie = cookie;
    if (!resolvedCookie) return { canUpload: false, reason: 'No cookie available' };
    try {
      return await canUploadToGroup(resolvedCookie, groupId, apiKey);
    } catch (err) {
      return { canUpload: false, reason: err.message };
    }
  });

  ipcMain.handle('uninstall-app', async () => {
    try {
      const home = os.homedir();
      const appData = app.getPath('appData');
      const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
      const desktop = app.getPath('desktop');
      const startMenu = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
      const userData = app.getPath('userData');
      const appName = 'Jonuffy Spoofer';
      const targets = [];
      targets.push(userData);
      if (localAppData) {
        targets.push(path.join(localAppData, appName));
        targets.push(path.join(localAppData, 'Programs', appName));
      }
      if (process.platform === 'win32') {
        try {
          const robloxPlugins = path.join(localAppData, 'Roblox', 'Plugins');
          if (fsSync.existsSync(robloxPlugins)) {
            const entries = fsSync.readdirSync(robloxPlugins);
            for (const name of entries) {
              if (/jonuffy.*\.rbxmx$/i.test(name)) targets.push(path.join(robloxPlugins, name));
            }
          }
        } catch {}
        targets.push(path.join(desktop, `${appName}.lnk`));
        targets.push(path.join(startMenu, `${appName}.lnk`));
      }
      const uniqueTargets = [...new Set(targets.filter(Boolean))];
      for (const target of uniqueTargets) {
        try {
          if (!fsSync.existsSync(target)) continue;
          const stat = fsSync.lstatSync(target);
          if (stat.isDirectory()) fsSync.rmSync(target, { recursive: true, force: true });
          else fsSync.unlinkSync(target);
        } catch {}
      }
      app.quit();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.on('run-spoofer-action', async (_event, data) => {
    resumeSpoofer();
    try {
      await handleSpooferAction(data);
    } catch (error) {
      console.error('Spoofer action error:', error);
      sendSpooferResultToRenderer({
        output: `Spoofer action failed: ${error.message || error}`,
        success: false,
      });
      sendStatusMessage('Spoofer action failed');
    }
  });

  async function handleSpooferAction(data) {
    const assetTypeName = data.spoofSounds ? 'Audio' : 'Animation';
    const isSoundMode = data.spoofSounds;

    const hasCustomDownloadFolder = !!(
      data.downloadOnly &&
      data.downloadFolder &&
      data.downloadFolder.trim()
    );
    const downloadsDir = hasCustomDownloadFolder
      ? data.downloadFolder.trim()
      : path.join(app.getPath('userData'), 'jonuffy_temp');

    if (data.downloadOnly && (!data.downloadFolder || !data.downloadFolder.trim())) {
      sendSpooferResultToRenderer({
        output: 'Please select a download folder for Download-Only mode.',
        success: false,
      });
      sendStatusMessage('Error: No download folder selected');
      return;
    }

    if (!data.enableSpoofing && !data.downloadOnly) {
      sendSpooferResultToRenderer({
        output: 'Enable Spoofing toggle is OFF and Download-Only mode is not enabled.',
        success: false,
      });
      return;
    }

    if (data.groupId && !/^\d+$/.test(String(data.groupId).trim())) {
      sendSpooferResultToRenderer({
        output: `Invalid Group ID "${data.groupId}" — must be a number only, not a URL or text.`,
        success: false,
      });
      return;
    }

    if (!data.downloadOnly && !data.apiKey) {
      sendSpooferResultToRenderer({
        output:
          'Uploads now require an Open Cloud API key.\n\nTo fix this:\n1. Go to create.roblox.com → Open Cloud → API Keys\n2. Create a key with Assets Read & Write permissions\n3. Paste the key into the "Open Cloud API Key" field',
        success: false,
      });
      return;
    }

    if (!data.animationId || !data.animationId.trim()) {
      sendSpooferResultToRenderer({
        output: 'No asset IDs provided. Paste at least one asset ID and try again.',
        success: false,
      });
      return;
    }

    const animationEntries = parseAnimationIdInput(data.animationId);
    if (animationEntries.length === 0) {
      sendSpooferResultToRenderer({
        output: `No valid ${isSoundMode ? 'sound' : 'animation'} entries.`,
        success: false,
      });
      return;
    }

    const robloxCookie = data.robloxCookie || '';
    if (!robloxCookie.trim()) {
      sendSpooferResultToRenderer({
        output:
          'No Roblox cookie provided. Please enter your .ROBLOSECURITY cookie in the Credentials page.',
        success: false,
      });
      return;
    }

    const robloxCookieHeader = buildRobloxCookieHeader(robloxCookie);
    if (!robloxCookieHeader) {
      sendSpooferResultToRenderer({
        output: 'Invalid ROBLOSECURITY cookie format.',
        success: false,
      });
      return;
    }

    if (!hasCustomDownloadFolder) {
      await clearDownloadsDirectory(downloadsDir);
    }

    try {
      await fs.mkdir(downloadsDir, { recursive: true });
    } catch {}

    const autoSaveSession = data.autoSaveSession !== false;
    const isResume = data.resumeSession === true;
    let session = isResume ? await loadSession() : null;

    if (isResume && session) {
      const savedInput = session.retryAnimationIdInput || session.animationIdInput;
      if (savedInput) data.animationId = savedInput;
      const completedIds = new Set((session.completedMappings || []).map(m => m.originalId));
      animationEntries.splice(
        0,
        animationEntries.length,
        ...animationEntries.filter(e => !completedIds.has(String(e.id)))
      );
      if (animationEntries.length === 0) {
        const mappingOutput = (session.completedMappings || [])
          .map(m => `${m.originalId} = ${m.newId},`)
          .join('\n');
        sendSpooferResultToRenderer({ output: mappingOutput.replace(/,$/, ''), success: true });
        sendStatusMessage('Session already complete');
        await clearSession();
        return;
      }
      sendSpooferResultToRenderer({
        output: `Resuming — ${animationEntries.length} asset(s) remaining from previous session.\n`,
        success: true,
      });
    } else {
      session = {
        startedAt: new Date().toISOString(),
        status: 'incomplete',
        animationIdInput: data.animationId,
        totalCount: animationEntries.length,
        completedMappings: [],
        failedEntries: [],
        retryAnimationIdInput: '',
        lastUpdatedAt: new Date().toISOString(),
      };
      if (autoSaveSession) await saveSession(session);
    }

    async function persistSession() {
      if (autoSaveSession && session) await saveSession(session);
    }

    const maxPlaceIds = parseInt(data.maxPlaceIds, 10) || 10;
    const maxPlaceIdRetries = parseInt(data.maxPlaceIdRetries, 10) || 3;

    const assetHistory = await loadAssetHistory();
    const uploadTargetKey =
      data.groupId && String(data.groupId).trim() ? `group:${data.groupId}` : 'user';
    const cachedHistoryMappings = [];

    if (!data.downloadOnly && !isResume) {
      for (let idx = animationEntries.length - 1; idx >= 0; idx--) {
        const entry = animationEntries[idx];
        const key = buildHistoryKey(assetTypeName, uploadTargetKey, entry.id);
        if (assetHistory[key] && assetHistory[key].newId) {
          cachedHistoryMappings.unshift({ entry, newId: String(assetHistory[key].newId) });
          animationEntries.splice(idx, 1);
        }
      }
      if (cachedHistoryMappings.length > 0)
        sendStatusMessage(`Skipped ${cachedHistoryMappings.length} cached asset mapping(s)`);
    }

    let uploadMappingOutput = cachedHistoryMappings
      .map(m => `${m.entry.id} = ${m.newId},`)
      .join('\n');
    if (uploadMappingOutput) uploadMappingOutput += '\n';

    if (animationEntries.length === 0) {
      sendSpooferResultToRenderer({
        output: uploadMappingOutput.trim().replace(/,$/, ''),
        success: true,
        failedAnimationIdInput: '',
        failedCount: 0,
        summary: {
          total: cachedHistoryMappings.length,
          downloaded: 0,
          uploaded: 0,
          cached: cachedHistoryMappings.length,
          downloadFailures: 0,
          uploadFailures: 0,
          skippedUploads: cachedHistoryMappings.length,
          downloadOnly: false,
          mode: 'Cached mappings',
          durationSeconds: 0,
          failureCategories: {},
          failures: [],
          mappings: uploadMappingOutput
            .split('\n')
            .map(l => l.trim())
            .filter(Boolean),
        },
      });
      sendStatusMessage('Run complete — cached mappings reused');
      return;
    }

    const initialTransferStates = animationEntries.map(entry => ({
      id: crypto.randomUUID(),
      name: entry.name,
      originalAssetId: entry.id,
      status: 'queued',
      direction: 'download',
      progress: 0,
      size: 0,
    }));
    for (const t of initialTransferStates) sendTransferUpdate(t);

    sendStatusMessage(`0/${animationEntries.length} spoofed`);

    const overridePlaceId = data.overridePlaceId ? parseInt(data.overridePlaceId) : null;
    const placeIdMap = {};

    if (overridePlaceId) {
      const uniqueCreators = [
        ...new Set(animationEntries.map(e => `${e.creatorType}:${e.creatorId}`)),
      ];
      for (const creatorKey of uniqueCreators) placeIdMap[creatorKey] = [overridePlaceId];
    } else {
      const uniqueCreators = [
        ...new Set(animationEntries.map(e => `${e.creatorType}:${e.creatorId}`)),
      ];
      await Promise.all(
        uniqueCreators.map(async creatorKey => {
          const [creatorType, creatorId] = creatorKey.split(':');
          try {
            const placeIds = await retryAsync(
              () => getPlaceIdFromCreator(creatorType, creatorId, robloxCookie, maxPlaceIds),
              maxPlaceIdRetries,
              1000,
              undefined
            );
            placeIdMap[creatorKey] = Array.isArray(placeIds) ? placeIds : [placeIds];
          } catch {
            placeIdMap[creatorKey] = [99840799534728];
          }
        })
      );
    }

    const batchItems = animationEntries.map(entry => ({
      requestId: String(entry.id),
      assetType: isSoundMode ? 'Audio' : 'Animation',
      assetId: String(entry.id),
      creatorType: entry.creatorType,
      creatorId: String(entry.creatorId),
    }));

    const BATCH_MAX_RETRIES = parseInt(data.batchRetries, 10) || 3;
    const BATCH_RETRY_DELAY_MS = parseInt(data.batchRetryDelay, 10) || 2000;
    const BATCH_TIMEOUT_MS = parseInt(data.batchTimeoutMs, 10) || 15000;
    let chunkSize = parseInt(data.batchChunkSize, 10) || (batchItems.length > 50 ? 10 : 20);
    chunkSize = Math.max(1, Math.min(chunkSize, 25));

    const locationsMap = {};
    let hasAuthError = false;

    async function fetchSingleBatchLocation(item) {
      const creatorKey = `${item.creatorType}:${item.creatorId}`;
      const placeIds = placeIdMap[creatorKey] || [99840799534728];
      const placeIdArray = Array.isArray(placeIds) ? placeIds : [placeIds];
      const itemWithoutCreator = (({ creatorType, creatorId, ...rest }) => rest)(item);
      let lastError = null;
      for (const placeId of placeIdArray) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), Math.max(BATCH_TIMEOUT_MS, 20000));
          const resp = await fetch('https://assetdelivery.roblox.com/v2/assets/batch', {
            method: 'POST',
            headers: {
              'User-Agent': 'RobloxStudio/WinInet',
              'Content-Type': 'application/json',
              Cookie: robloxCookieHeader,
              'Roblox-Place-Id': String(placeId),
            },
            body: JSON.stringify([itemWithoutCreator]),
            signal: controller.signal,
          }).finally(() => clearTimeout(timeout));
          if (resp.ok) {
            const singleLocations = await resp.json();
            if (singleLocations && singleLocations[0]) return singleLocations[0];
          }
          lastError = new Error(`single batch status ${resp.status}`);
        } catch (err) {
          lastError = err;
        }
      }
      return {
        requestId: item.requestId,
        errors: [
          {
            code: 0,
            message: `Single-asset batch fallback failed: ${lastError && lastError.message ? lastError.message : 'unknown error'}`,
          },
        ],
      };
    }

    for (let i = 0; i < batchItems.length; i += chunkSize) {
      const chunk = batchItems.slice(i, i + chunkSize);
      try {
        const creatorGroups = {};
        for (const item of chunk) {
          const creatorKey = `${item.creatorType}:${item.creatorId}`;
          if (!creatorGroups[creatorKey]) creatorGroups[creatorKey] = [];
          creatorGroups[creatorKey].push(item);
        }
        let creatorGroupIndex = 0;
        for (const [creatorKey, items] of Object.entries(creatorGroups)) {
          if (creatorGroupIndex > 0) await new Promise(r => setTimeout(r, 500));
          creatorGroupIndex++;
          const [creatorType, creatorId] = creatorKey.split(':');
          let placeIdArray = placeIdMap[creatorKey] || [99840799534728];
          let placeIdIndex = 0;
          let retryCount = 0;
          while (placeIdIndex < placeIdArray.length) {
            const placeId = placeIdArray[placeIdIndex];
            const itemsWithoutCreator = items.map(({ creatorType, creatorId, ...rest }) => rest);
            let locations;
            for (let attempt = 1; attempt <= BATCH_MAX_RETRIES; attempt++) {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
              let resp;
              let caughtErr = null;
              try {
                resp = await fetch('https://assetdelivery.roblox.com/v2/assets/batch', {
                  method: 'POST',
                  headers: {
                    'User-Agent': 'RobloxStudio/WinInet',
                    'Content-Type': 'application/json',
                    Cookie: robloxCookieHeader,
                    'Roblox-Place-Id': String(placeId),
                  },
                  body: JSON.stringify(itemsWithoutCreator),
                  signal: controller.signal,
                });
              } catch (err) {
                caughtErr = err;
              } finally {
                clearTimeout(timeout);
              }
              if (resp && resp.ok) {
                locations = await resp.json();
                break;
              }
              const status = resp ? resp.status : 0;
              const isTimeout =
                caughtErr &&
                (caughtErr.name === 'AbortError' || /aborted|timeout/i.test(caughtErr.message));
              const retryable =
                isTimeout ||
                status === 429 ||
                status === 502 ||
                status === 503 ||
                status === 504 ||
                status === 500;
              const statusText = resp
                ? `${status}`
                : isTimeout
                  ? 'timeout'
                  : caughtErr
                    ? caughtErr.message
                    : 'unknown';
              if (!retryable || attempt === BATCH_MAX_RETRIES)
                throw new Error(`Batch request failed for ${creatorKey}: ${statusText}`);
              let delayMs = BATCH_RETRY_DELAY_MS;
              if (status === 429 && resp) {
                const retryAfter = parseInt(resp.headers.get('retry-after') || '0', 10);
                if (retryAfter > 0) delayMs = Math.min(retryAfter * 1000, 120000);
                else delayMs = Math.max(BATCH_RETRY_DELAY_MS, 15000);
              }
              const jitter = Math.floor(Math.random() * 300);
              await new Promise(r => setTimeout(r, delayMs + jitter));
            }
            if (!locations) throw new Error(`Batch request failed for ${creatorKey}: no response`);
            const hasBatchErrors = locations.some(
              loc => loc.errors && loc.errors.length > 0 && loc.errors[0].code === 403
            );
            if (hasBatchErrors) {
              if (placeIdIndex < placeIdArray.length - 1) {
                placeIdIndex++;
                continue;
              } else {
                if (overridePlaceId) {
                  for (const loc of locations) locationsMap[loc.requestId] = loc;
                  break;
                }
                if (retryCount < maxPlaceIdRetries) {
                  retryCount++;
                  try {
                    const freshPlaceIds = await retryAsync(
                      () =>
                        getPlaceIdFromCreator(creatorType, creatorId, robloxCookie, maxPlaceIds),
                      1,
                      1000
                    );
                    placeIdMap[creatorKey] = Array.isArray(freshPlaceIds)
                      ? freshPlaceIds
                      : [freshPlaceIds];
                    placeIdArray = placeIdMap[creatorKey];
                    placeIdIndex = 0;
                    continue;
                  } catch {
                    for (const loc of locations) locationsMap[loc.requestId] = loc;
                    break;
                  }
                } else {
                  for (const loc of locations) locationsMap[loc.requestId] = loc;
                  break;
                }
              }
            } else {
              for (const loc of locations) locationsMap[loc.requestId] = loc;
              break;
            }
          }
        }
      } catch (error) {
        console.error('Batch request error:', error);
        const msg = error && error.message ? error.message : '';
        if (/\b401\b|\b403\b/.test(msg)) hasAuthError = true;
        sendStatusMessage(
          `Batch request failed; splitting ${chunk.length} item(s) into single-asset lookups...`
        );
        for (const item of chunk) {
          const transfer = initialTransferStates.find(t => t.originalAssetId === item.requestId);
          if (transfer)
            sendTransferUpdate({
              id: transfer.id,
              status: 'processing',
              message: 'Retrying as single-asset lookup',
            });
          const singleLoc = await fetchSingleBatchLocation(item);
          locationsMap[item.requestId] = singleLoc;
          if (transfer && singleLoc.errors && singleLoc.errors.length)
            sendTransferUpdate({
              id: transfer.id,
              status: 'queued',
              error:
                singleLoc.errors[0].message ||
                singleLoc.errors[0].Message ||
                'Single-asset lookup failed',
              message: 'Will try direct download fallback',
            });
        }
        chunkSize = Math.max(1, Math.floor(chunkSize / 2));
      }
    }

    const UPLOAD_RETRIES = parseInt(data.uploadRetries, 10) || 3;
    const UPLOAD_RETRY_DELAY_MS = parseInt(data.uploadRetryDelay, 10) || 5000;
    const DOWNLOAD_RETRIES = parseInt(data.downloadRetries, 10) || 2;
    const DOWNLOAD_RETRY_DELAY_MS = parseInt(data.downloadRetryDelayMs, 10) || 2000;
    const DOWNLOAD_TIMEOUT_MS = parseInt(data.downloadTimeoutMs, 10) || 15000;

    const runWithConcurrency = async (items, limit, worker) => {
      const results = new Array(items.length);
      let index = 0;
      const workers = Array.from(
        { length: Math.max(1, Math.min(limit, items.length)) },
        async () => {
          while (true) {
            const current = index++;
            if (current >= items.length) break;
            results[current] = await worker(items[current]);
          }
        }
      );
      await Promise.all(workers);
      return results;
    };

    sendStatusMessage(`Downloading ${isSoundMode ? 'sounds' : 'animations'}...`);
    let downloadCompleted = 0;
    const downloadStartTime = Date.now();
    const batchProblemCount = animationEntries.reduce((count, entry) => {
      const loc = locationsMap[entry.id];
      return (
        count +
        (!loc ||
        (loc.errors && loc.errors.length > 0) ||
        !loc.locations ||
        loc.locations.length === 0
          ? 1
          : 0)
      );
    }, 0);
    const baseDownloadConcurrency = Math.min(
      parseInt(data.downloadConcurrency, 10) || 10,
      animationEntries.length
    );
    const DOWNLOAD_CONCURRENCY =
      batchProblemCount > 0
        ? Math.max(
            2,
            Math.min(baseDownloadConcurrency, Math.ceil(animationEntries.length / 12) || 2)
          )
        : baseDownloadConcurrency;

    const downloadOne = async entry => {
      const sanitizedName = sanitizeFilename(entry.name);
      const fileExtension = isSoundMode ? '.ogg' : '.rbxm';
      const fileName = `${sanitizedName}_${entry.id}${fileExtension}`;
      const filePath = path.join(downloadsDir, fileName);
      const downloadTransfer = initialTransferStates.find(t => t.originalAssetId === entry.id);
      const downloadTransferId = downloadTransfer.id;
      sendTransferUpdate({ id: downloadTransferId, status: 'processing' });
      const creatorKey = `${entry.creatorType}:${entry.creatorId}`;
      const entryPlaceIds = placeIdMap[creatorKey] || [99840799534728];
      const entryPlaceId = Array.isArray(entryPlaceIds) ? entryPlaceIds[0] : entryPlaceIds;

      const tryDownloadUrl = async (url, reason) => {
        if (reason)
          sendTransferUpdate({ id: downloadTransferId, status: 'processing', message: reason });
        return downloadAnimationAssetWithProgress(
          url,
          robloxCookie,
          filePath,
          downloadTransferId,
          entry.name,
          entry.id,
          sendTransferUpdate,
          entryPlaceId,
          {
            timeoutMs: DOWNLOAD_TIMEOUT_MS,
            retries: DOWNLOAD_RETRIES,
            retryDelayMs: DOWNLOAD_RETRY_DELAY_MS,
          }
        );
      };

      const loc = locationsMap[entry.id];
      let batchErrorMessage = '';
      let result = null;
      if (loc && loc.locations && loc.locations.length > 0 && loc.locations[0].location) {
        result = await tryDownloadUrl(loc.locations[0].location);
      } else {
        if (loc && loc.errors && loc.errors.length > 0) {
          const errorObj = loc.errors[0];
          batchErrorMessage =
            errorObj.Message ||
            errorObj.message ||
            JSON.stringify(errorObj) ||
            'Unknown batch error';
        } else {
          batchErrorMessage = 'No location in batch response';
        }
        const directUrls = [
          `https://assetdelivery.roblox.com/v1/asset?id=${encodeURIComponent(entry.id)}&placeId=${encodeURIComponent(String(entryPlaceId || ''))}`,
          `https://assetdelivery.roblox.com/v1/asset/?id=${encodeURIComponent(entry.id)}`,
        ];
        for (const directUrl of directUrls) {
          result = await tryDownloadUrl(
            directUrl,
            'Batch lookup failed; trying direct asset download fallback'
          );
          if (result && result.success) break;
        }
        if (!result || !result.success)
          return {
            entry,
            success: false,
            error: `Batch error: ${batchErrorMessage}. Direct fallback: ${result && result.error ? result.error : 'failed'}`,
            rawBatchError: batchErrorMessage,
          };
      }
      downloadCompleted++;
      const elapsed = (Date.now() - downloadStartTime) / 1000;
      const avgTimePerItem = elapsed / downloadCompleted;
      const remaining = animationEntries.length - downloadCompleted;
      const etaSeconds = Math.ceil(avgTimePerItem * remaining);
      const etaMin = Math.floor(etaSeconds / 60);
      const etaSec = etaSeconds % 60;
      const etaStr = remaining > 0 ? ` (ETA: ${etaMin}:${String(etaSec).padStart(2, '0')})` : '';
      sendStatusMessage(
        `Downloaded ${downloadCompleted}/${animationEntries.length} ${isSoundMode ? 'sounds' : 'animations'}${etaStr}`
      );
      return {
        entry,
        filePath: result.success ? filePath : null,
        success: result.success,
        error: result.error,
      };
    };
    const downloadResults = await runWithConcurrency(
      animationEntries,
      DOWNLOAD_CONCURRENCY,
      downloadOne
    );

    let authenticatedUserId = null;
    if (!data.downloadOnly && data.apiKey && !data.groupId) {
      try {
        authenticatedUserId = await getAuthenticatedUserId(robloxCookie);
      } catch (err) {
        sendSpooferResultToRenderer({
          output: `Failed to resolve your Roblox user ID: ${err.message}\n\nMake sure your cookie is valid.`,
          success: false,
        });
        return;
      }
    }

    let uploadResults = [];
    if (data.downloadOnly) {
      sendStatusMessage('Download-only mode: Skipping uploads');
    } else {
      sendStatusMessage(`Uploading ${isSoundMode ? 'sounds' : 'animations'}...`);
      let uploadCompleted = 0;
      const uploadStartTime = Date.now();
      const successfulDownloads = downloadResults.filter(r => r.success);
      const UPLOAD_CONCURRENCY = Math.min(
        parseInt(data.uploadConcurrency, 10) || 10,
        successfulDownloads.length
      );

      const uploadOne = async downloadResult => {
        const entry = downloadResult.entry;
        const filePath = downloadResult.filePath;
        const uploadTransferId = crypto.randomUUID();
        const fileSize = (await fs.stat(filePath).catch(() => ({ size: 0 }))).size;
        sendTransferUpdate({
          id: uploadTransferId,
          name: entry.name,
          originalAssetId: entry.id,
          status: 'queued',
          direction: 'upload',
          progress: 0,
          size: fileSize,
        });
        const uploadFn = async () => {
          await checkPaused();
          const result = await publishAnimationRbxmWithProgress(
            filePath,
            entry.name,
            data.groupId && String(data.groupId).trim() ? data.groupId : null,
            uploadTransferId,
            sendTransferUpdate,
            assetTypeName,
            data.apiKey || null,
            authenticatedUserId || null
          );
          if (!result.success) throw new Error(result.error || 'Upload failed');
          return result;
        };
        const onAttemptFailure = (attempt, maxAttempts, err) => {
          const classified = classifyError(err);
          const isFinal = attempt >= maxAttempts;
          sendTransferUpdate({
            id: uploadTransferId,
            status: isFinal ? 'error' : 'cooldown',
            message: `${classified.category}: ${isFinal ? 'No more retries.' : 'Waiting before retry...'}`,
            error: classified.message,
            errorCategory: classified.category,
          });
        };
        const onCooldownTick = (remainingSeconds, totalSeconds, nextAttempt, maxAttempts, err) => {
          const classified = classifyError(err);
          sendTransferUpdate({
            id: uploadTransferId,
            status: 'cooldown',
            progress: Math.max(
              0,
              Math.min(99, Math.round(((totalSeconds - remainingSeconds) / totalSeconds) * 100))
            ),
            message: `${classified.category}: retrying in ${remainingSeconds}s (${nextAttempt}/${maxAttempts})`,
            error: classified.message,
            errorCategory: classified.category,
            cooldownRemaining: remainingSeconds,
          });
          sendStatusMessage(`Paused for cooldown: retrying ${entry.name} in ${remainingSeconds}s`);
        };
        try {
          const uploadResult = await retryWithCooldown(
            uploadFn,
            UPLOAD_RETRIES,
            UPLOAD_RETRY_DELAY_MS,
            onAttemptFailure,
            onCooldownTick
          );
          if (uploadResult.success && uploadResult.assetId) {
            if (!session.completedMappings.some(m => String(m.originalId) === String(entry.id)))
              session.completedMappings.push({
                originalId: String(entry.id),
                newId: uploadResult.assetId,
              });
            await rememberAssetMapping(
              assetTypeName,
              uploadTargetKey,
              entry.id,
              uploadResult.assetId,
              entry.name
            );
            session.lastUpdatedAt = new Date().toISOString();
            await persistSession();
          }
          uploadCompleted++;
          const elapsed = (Date.now() - uploadStartTime) / 1000;
          const avgTimePerItem = elapsed / uploadCompleted;
          const remaining = successfulDownloads.length - uploadCompleted;
          const etaSeconds = Math.ceil(avgTimePerItem * remaining);
          const etaMin = Math.floor(etaSeconds / 60);
          const etaSec = etaSeconds % 60;
          const etaStr =
            remaining > 0 ? ` (ETA: ${etaMin}:${String(etaSec).padStart(2, '0')})` : '';
          sendStatusMessage(
            `Uploaded ${uploadCompleted}/${successfulDownloads.length} ${isSoundMode ? 'sounds' : 'animations'}${etaStr}`
          );
          return {
            entry,
            success: uploadResult.success,
            assetId: uploadResult.assetId,
            error: uploadResult.error,
          };
        } catch (finalRetryError) {
          const classified = classifyError(finalRetryError);
          sendTransferUpdate({
            id: uploadTransferId,
            status: 'error',
            error: classified.message,
            errorCategory: classified.category,
            message: `All upload attempts failed: ${classified.category}`,
          });
          uploadCompleted++;
          const elapsed = (Date.now() - uploadStartTime) / 1000;
          const avgTimePerItem = elapsed / uploadCompleted;
          const remaining = successfulDownloads.length - uploadCompleted;
          const etaSeconds = Math.ceil(avgTimePerItem * remaining);
          const etaMin = Math.floor(etaSeconds / 60);
          const etaSec = etaSeconds % 60;
          const etaStr =
            remaining > 0 ? ` (ETA: ${etaMin}:${String(etaSec).padStart(2, '0')})` : '';
          sendStatusMessage(
            `Uploaded ${uploadCompleted}/${successfulDownloads.length} ${isSoundMode ? 'sounds' : 'animations'}${etaStr}`
          );
          return {
            entry,
            success: false,
            error: classified.message,
            errorCategory: classified.category,
            rawError: classified.raw,
          };
        }
      };
      uploadResults = await runWithConcurrency(successfulDownloads, UPLOAD_CONCURRENCY, uploadOne);
    }

    let downloadedSuccessfullyCount = 0;
    let successfulUploadCount = 0;
    for (const downloadResult of downloadResults) {
      const entry = downloadResult.entry;
      if (downloadResult.success) {
        downloadedSuccessfullyCount++;
        if (!data.downloadOnly) {
          const uploadResult = uploadResults.find(u => u.entry.id === entry.id);
          if (uploadResult && uploadResult.success) {
            successfulUploadCount++;
            uploadMappingOutput += `${entry.id} = ${uploadResult.assetId},\n`;
          }
        }
      }
    }

    sendStatusMessage('Run complete — see Run Report');

    const finishedAt = new Date().toISOString();
    const durationSeconds = Math.max(
      0,
      Math.round((Date.now() - new Date(session.startedAt || Date.now()).getTime()) / 1000)
    );

    const downloadFailures = downloadResults
      .filter(r => !r.success)
      .map(r => {
        const classified = classifyError(r.error || 'Unknown error');
        return {
          id: r.entry.id,
          name: r.entry.name,
          creator: `${r.entry.creatorType}:${r.entry.creatorId}`,
          reason: classified.message,
          category: classified.category,
          raw: classified.raw,
        };
      });
    const uploadFailures = data.downloadOnly
      ? []
      : (uploadResults || [])
          .filter(u => !u.success)
          .map(u => {
            const classified = classifyError(u.rawError || u.error || 'Unknown error');
            return {
              id: u.entry.id,
              name: u.entry.name,
              creator: `${u.entry.creatorType}:${u.entry.creatorId}`,
              reason: u.error || classified.message,
              category: u.errorCategory || classified.category,
              raw: u.rawError || classified.raw,
            };
          });
    const rateLimitFailures = uploadFailures.filter(
      f =>
        f.category === 'Rate limited' ||
        (f.reason || '').includes('429') ||
        (f.reason || '').includes('Rate limit')
    );
    const skippedUploadsCount = data.downloadOnly ? 0 : downloadFailures.length;

    const listFailures = (label, items) => {
      if (!items || items.length === 0) return '';
      const maxItems = 5;
      const lines = items
        .slice(0, maxItems)
        .map(
          it =>
            `- ${it.name} (ID: ${it.id}) — ${it.category ? `[${it.category}] ` : ''}${it.reason}`
        );
      const remaining = items.length - maxItems;
      return `${label}:\n${lines.join('\n')}${remaining > 0 ? `\n(+${remaining} more…)` : ''}\n`;
    };

    let runSummary = `\n--- Summary ---\nMode: ${data.downloadOnly ? 'Download-Only' : 'Download + Upload'}\nTotal ${isSoundMode ? 'sounds' : 'animations'}: ${animationEntries.length}\nDownloaded: ${downloadedSuccessfullyCount}/${animationEntries.length}${downloadFailures.length ? ` (Failed: ${downloadFailures.length})` : ''}\n`;
    if (!data.downloadOnly)
      runSummary += `Uploaded: ${successfulUploadCount}/${downloadResults.filter(r => r.success).length}${uploadFailures.length ? ` (Failed: ${uploadFailures.length}, Skipped: ${skippedUploadsCount})` : skippedUploadsCount ? ` (Skipped: ${skippedUploadsCount})` : ''}\n`;
    if (downloadFailures.length)
      runSummary += '\n' + listFailures('Download failures', downloadFailures);
    if (!data.downloadOnly && uploadFailures.length)
      runSummary += '\n' + listFailures('Upload failures', uploadFailures);
    if (rateLimitFailures.length > 0) {
      const suggestedDelay = Math.min(Math.max(UPLOAD_RETRY_DELAY_MS * 2, 10000), 60000);
      runSummary += `\n⚠️ RATE LIMIT DETECTED (429): ${rateLimitFailures.length} upload(s) hit rate limits.\n   Recommendation: Try again with higher "Retry Delay" (current: ${UPLOAD_RETRY_DELAY_MS}ms, suggested: ${suggestedDelay}ms)\n   Or increase "Upload Retries" for more attempts.\n`;
    }

    let finalOutput = '';
    if (data.downloadOnly) {
      const successfulDownloadsList = downloadResults
        .filter(r => r.success)
        .map(r => `${r.entry.name} (ID: ${r.entry.id})`)
        .join('\n');
      finalOutput = successfulDownloadsList
        ? `Downloaded ${downloadedSuccessfullyCount}/${animationEntries.length} ${isSoundMode ? 'sounds' : 'animations'} to:\n${downloadsDir}\n\nFiles:\n${successfulDownloadsList}`
        : `No ${isSoundMode ? 'sounds' : 'animations'} were successfully downloaded.`;
    } else if (uploadMappingOutput.trim()) {
      finalOutput = uploadMappingOutput.trim().replace(/,$/, '');
    } else {
      if (downloadedSuccessfullyCount > 0 && successfulUploadCount === 0)
        finalOutput = `Downloads successful (${downloadedSuccessfullyCount}/${animationEntries.length}), but no ${isSoundMode ? 'sounds' : 'animations'} were successfully uploaded.`;
      else if (animationEntries.length > 0)
        finalOutput = hasAuthError
          ? 'Authentication failed. Please check your Roblox cookie.'
          : `No ${isSoundMode ? 'sounds' : 'animations'} were successfully processed to provide mappings.`;
      else finalOutput = 'No operations performed.';
    }

    const failedEntriesForRetry = dedupeAssetEntries([
      ...downloadFailures
        .map(failure => animationEntries.find(entry => String(entry.id) === String(failure.id)))
        .filter(Boolean),
      ...uploadFailures
        .map(failure => animationEntries.find(entry => String(entry.id) === String(failure.id)))
        .filter(Boolean),
    ]);
    const failedAnimationIdInput = failedEntriesForRetry.map(formatAssetEntry).join('\n');

    if (failedEntriesForRetry.length > 0) {
      session.status = 'incomplete';
      session.lastUpdatedAt = new Date().toISOString();
      session.failedEntries = failedEntriesForRetry.map(entry => ({
        id: String(entry.id),
        name: entry.name,
        creatorType: entry.creatorType,
        creatorId: String(entry.creatorId),
      }));
      session.retryAnimationIdInput = failedAnimationIdInput;
      session.totalCount = animationEntries.length;
      await persistSession();
    } else {
      session.status = 'complete';
      await clearSession();
    }

    sendSpooferResultToRenderer({
      output: finalOutput,
      success: downloadedSuccessfullyCount > 0 || successfulUploadCount > 0,
      failedAnimationIdInput,
      failedCount: failedEntriesForRetry.length,
      summary: {
        total: animationEntries.length + cachedHistoryMappings.length,
        downloaded: downloadedSuccessfullyCount,
        uploaded: successfulUploadCount,
        downloadFailures: downloadFailures.length,
        uploadFailures: uploadFailures.length,
        cached: cachedHistoryMappings.length,
        skippedUploads: skippedUploadsCount,
        downloadOnly: !!data.downloadOnly,
        mode: data.downloadOnly ? 'Download-Only' : 'Download + Upload',
        startedAt: session.startedAt,
        finishedAt,
        durationSeconds,
        failureCategories: [...downloadFailures, ...uploadFailures].reduce((acc, f) => {
          acc[f.category || 'Unknown error'] = (acc[f.category || 'Unknown error'] || 0) + 1;
          return acc;
        }, {}),
        failures: [
          ...downloadFailures.map(f => ({ ...f, stage: 'Download' })),
          ...uploadFailures.map(f => ({ ...f, stage: 'Upload' })),
        ],
        mappings: (uploadMappingOutput || '')
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean),
      },
    });

    if (!data.downloadOnly) {
      await clearDownloadsDirectory(downloadsDir).catch(() => {});
    }
  }
}

module.exports = { registerIpcHandlers };
