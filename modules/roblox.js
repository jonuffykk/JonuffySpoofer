'use strict';

const fsSync = require('fs');
const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function sanitizeFilename(name) {
  return name.replace(/[<>:"\/\\|?*]/g, '_');
}

function buildCookieHeader(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let v = raw.trim().replace(/^['"]+|['"]+$/g, '');
  const m = v.match(/(?:^|;\s*)\.ROBLOSECURITY=([^;]+)/i);
  if (m?.[1]) v = m[1].trim();
  v = v
    .replace(/^\.ROBLOSECURITY=/i, '')
    .replace(/[;\r\n]+$/g, '')
    .trim();
  return v ? `.ROBLOSECURITY=${v}` : '';
}

function classifyError(err) {
  const text = String(
    typeof err === 'string' ? err : err?.message || err?.error || 'Unknown error'
  );
  const low = text.toLowerCase();
  if (
    /\b401\b/.test(text) ||
    low.includes('invalid roblox cookie') ||
    low.includes('authentication failed')
  )
    return {
      category: 'Invalid cookie',
      message: 'Cookie is invalid or expired. Re-enter your .ROBLOSECURITY cookie.',
      raw: text,
    };
  if (low.includes('api key') || (/\b403\b/.test(text) && low.includes('open cloud')))
    return {
      category: 'Invalid API key',
      message: 'Open Cloud API key is missing, invalid, or lacks Assets permissions.',
      raw: text,
    };
  if (
    /\b404\b/.test(text) ||
    low.includes('not found') ||
    low.includes('moderated') ||
    low.includes('no location')
  )
    return {
      category: 'Asset unavailable',
      message: 'Asset is private, moderated, deleted, or inaccessible.',
      raw: text,
    };
  if (/\b403\b/.test(text) || low.includes('permission') || low.includes('not authorized'))
    return {
      category: 'No permission',
      message: 'Account/API key lacks permission for this target.',
      raw: text,
    };
  if (/\b429\b/.test(text) || low.includes('rate limit'))
    return { category: 'Rate limited', message: 'Roblox rate-limited the request.', raw: text };
  if (
    /\b5\d\d\b/.test(text) ||
    low.includes('network') ||
    low.includes('timeout') ||
    low.includes('enotfound')
  )
    return { category: 'Network failure', message: 'Network or server error.', raw: text };
  if (low.includes('rbxm') || low.includes('enoent') || low.includes('conversion'))
    return { category: 'File error', message: 'File could not be read or converted.', raw: text };
  return { category: 'Unknown error', message: text, raw: text };
}

function dedupeById(entries) {
  const seen = new Set();
  return (entries || []).filter(e => {
    const k = String(e.id);
    return seen.has(k) ? false : seen.add(k);
  });
}

function parseAssetInput(input) {
  if (!input || typeof input !== 'string') return [];
  const dash = /^\s*(\d+)\s+-\s+(.+?)\s+-\s+([GU]):\s*(\d+)\s*$/;
  const pipe = /^\s*(\d+)\s*\|\s*([^\|]+)\s*\|\s*([GU]):(\d+)\s*$/;
  const seen = new Set();
  return dedupeById(
    input.split('\n').flatMap(line => {
      line = line.trim();
      if (!line || line.startsWith('--') || line.startsWith('#')) return [];
      const m = line.match(dash) || line.match(pipe);
      if (!m || seen.has(m[1])) return [];
      seen.add(m[1]);
      return [
        {
          id: m[1],
          name: m[2].trim() || 'Unnamed',
          creatorType: m[3] === 'G' ? 'group' : 'user',
          creatorId: m[4],
        },
      ];
    })
  );
}

function formatEntry(e) {
  return `${e.id} - ${e.name} - ${e.creatorType === 'group' ? 'G' : 'U'}: ${e.creatorId}`;
}

async function retryAsync(fn, retries = 3, delayMs = 1000, onRetry) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      onRetry?.(i + 1, retries, err);
      if (i < retries - 1) await sleep(delayMs);
      else
        throw Object.assign(new Error(`After ${retries} attempts: ${err.message}`), { cause: err });
    }
  }
}

async function retryWithCooldown(fn, retries, delayMs, onFail, onTick) {
  const max = Math.max(1, retries);
  for (let i = 1; i <= max; i++) {
    try {
      return await fn();
    } catch (err) {
      const final = i >= max;
      onFail?.(i, max, err);
      if (final) throw err;
      const secs = Math.ceil(delayMs / 1000);
      for (let r = secs; r > 0; r--) {
        onTick?.(r, secs, i + 1, max, err);
        await sleep(1000);
      }
    }
  }
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (true) {
        const cur = idx++;
        if (cur >= items.length) break;
        results[cur] = await worker(items[cur]);
      }
    })
  );
  return results;
}

async function clearDir(dir) {
  try {
    if (await fs.stat(dir).catch(() => null))
      for (const f of await fs.readdir(dir)) await fs.unlink(path.join(dir, f));
  } catch {}
}

async function robloxFetch(url, cookie, extra = {}) {
  const cookieHeader = buildCookieHeader(cookie);
  if (!cookieHeader) throw new Error('Missing or invalid ROBLOSECURITY cookie');
  const resp = await fetch(url, {
    headers: { Cookie: cookieHeader, 'User-Agent': 'RobloxStudio/WinInet', ...extra.headers },
    ...extra,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${url}`);
  return resp.json();
}

async function getPlaceIds(creatorType, creatorId, cookie, max = 10) {
  let games = [],
    cursor = null;
  while (games.length < max) {
    let url =
      creatorType === 'group'
        ? `https://games.roblox.com/v2/groups/${creatorId}/games?limit=50`
        : `https://games.roblox.com/v2/users/${creatorId}/games?sortOrder=Asc&limit=50`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    const data = await robloxFetch(url, cookie);
    if (!data?.data?.length) break;
    games = games.concat(data.data);
    cursor = data.nextPageCursor;
    if (!cursor) break;
  }
  const ids = games
    .slice(0, max)
    .map(g => g.rootPlace?.id || g.id)
    .filter(Boolean);
  if (!ids.length) throw new Error('No root places found');
  return ids;
}

async function getAuthUserId(cookie) {
  const data = await robloxFetch('https://users.roblox.com/v1/users/authenticated', cookie);
  if (!data.id) throw new Error('No user ID in response');
  return String(data.id);
}

async function getAuthUserInfo(cookie) {
  const data = await robloxFetch('https://users.roblox.com/v1/users/authenticated', cookie);
  if (!data.id) throw new Error('No user ID in response');
  const userId = String(data.id);
  let avatarUrl = null;
  try {
    const r = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=48x48&format=Png&isCircular=true`,
      { headers: { 'User-Agent': 'RobloxStudio/WinInet' } }
    );
    if (r.ok) avatarUrl = (await r.json())?.data?.[0]?.imageUrl || null;
  } catch {}
  return {
    id: userId,
    name: data.name || '',
    displayName: data.displayName || data.name || '',
    avatarUrl,
  };
}

async function getUserGroups(cookie) {
  const { id } = await robloxFetch('https://users.roblox.com/v1/users/authenticated', cookie);
  if (!id) throw new Error('No user ID');
  const data = await robloxFetch(`https://groups.roblox.com/v1/users/${id}/groups/roles`, cookie);
  return (data.data || [])
    .map(i => ({
      id: String(i.group?.id || ''),
      name: i.group?.name || 'Unknown Group',
      role: i.role?.name || '',
    }))
    .filter(g => g.id);
}

async function canUploadToGroup(cookie, groupId, apiKey) {
  if (!cookie || !groupId || !apiKey) return { canUpload: false, reason: 'Missing credentials' };
  const cookieHeader = buildCookieHeader(cookie);
  if (!cookieHeader) return { canUpload: false, reason: 'Invalid cookie' };
  try {
    const fd = new FormData();
    fd.append(
      'request',
      JSON.stringify({
        assetType: 'Animation',
        displayName: '__permission_test__',
        description: '',
        creationContext: { creator: { groupId: String(groupId) } },
      })
    );
    fd.append('fileContent', new Blob([new Uint8Array(0)], { type: 'model/x-rbxm' }), 'test.rbxm');
    const resp = await fetch('https://apis.roblox.com/assets/v1/assets', {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: fd,
    });
    if (resp.status === 401 || resp.status === 403)
      return {
        canUpload: false,
        reason: (await resp.json())?.error?.message || 'Permission denied',
      };
    if (resp.status === 400) {
      const msg = (await resp.json())?.error?.message || '';
      if (msg.includes('permission') || msg.includes('authorized'))
        return { canUpload: false, reason: msg };
    }
    return { canUpload: true };
  } catch (err) {
    return { canUpload: false, reason: err.message };
  }
}

let _rlUntil = 0;
const setRateLimit = ms => {
  _rlUntil = Math.max(_rlUntil, Date.now() + ms);
};
const waitRateLimit = async () => {
  const w = _rlUntil - Date.now();
  if (w > 0) await sleep(w);
};

async function downloadAsset(
  url,
  cookie,
  filePath,
  transferId,
  name,
  assetId,
  sendUpdate,
  placeId,
  opts = {}
) {
  const cookieHeader = buildCookieHeader(cookie);
  if (!cookieHeader) {
    const error = 'Missing or invalid ROBLOSECURITY cookie';
    sendUpdate({ id: transferId, status: 'error', error, progress: 0 });
    return { success: false, error };
  }

  sendUpdate({
    id: transferId,
    name,
    originalAssetId: assetId,
    status: 'processing',
    direction: 'download',
    progress: 0,
    error: null,
    size: 0,
  });

  const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : 15000;
  const retries = opts.retries > 0 ? opts.retries : 2;
  const retryDelayMs = opts.retryDelayMs > 0 ? opts.retryDelayMs : 2000;
  let lastProgress = 0;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    let stream = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let resp;
      try {
        resp = await fetch(url, {
          headers: { Cookie: cookieHeader },
          redirect: 'follow',
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      if (!resp.body) throw new Error(`No response body (ID: ${assetId})`);

      const totalSize = Number(resp.headers.get('content-length'));
      sendUpdate({ id: transferId, size: isNaN(totalSize) ? 0 : totalSize });

      const reader = resp.body.getReader();
      stream = fsSync.createWriteStream(filePath);
      let streamError = null;
      stream.on('error', e => {
        streamError = e;
      });

      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (streamError) throw streamError;
        stream.write(value);
        received += value.length;
        if (totalSize > 0) {
          const p = Math.round((received / totalSize) * 100);
          if (p > lastProgress) {
            sendUpdate({ id: transferId, progress: p });
            lastProgress = p;
          }
        }
      }

      if (streamError) throw streamError;
      stream.end();
      await new Promise((res, rej) => {
        stream.once('finish', res);
        stream.once('error', e => rej(new Error(`Stream error: ${e.message}`)));
      });

      sendUpdate({ id: transferId, status: 'completed', progress: 100 });
      return { success: true, filePath };
    } catch (err) {
      const msg = err?.message || 'unknown error';
      const retryable = err?.name === 'AbortError' || /aborted|timeout|\b5\d\d\b/.test(msg);
      try {
        stream?.end();
      } catch {}
      try {
        if (fsSync.existsSync(filePath)) fsSync.unlinkSync(filePath);
      } catch {}
      if (!retryable || attempt > retries) {
        sendUpdate({ id: transferId, status: 'error', error: msg, progress: lastProgress });
        return { success: false, error: msg };
      }
      await sleep(retryDelayMs + Math.floor(Math.random() * 300));
    }
  }
}

async function uploadAsset(
  filePath,
  name,
  groupId,
  transferId,
  sendUpdate,
  assetTypeName,
  apiKey,
  userId
) {
  let fileBuffer;
  try {
    fileBuffer = await fs.readFile(filePath);
  } catch (err) {
    const error = `File read error: ${err.message}`;
    sendUpdate({ id: transferId, name, status: 'error', direction: 'upload', error });
    return { success: false, error };
  }

  if (!apiKey) {
    const error = `${assetTypeName} uploads require an Open Cloud API key.`;
    sendUpdate({ id: transferId, status: 'error', error, progress: 0 });
    return { success: false, error };
  }

  const isAudio = assetTypeName === 'Audio';
  sendUpdate({
    id: transferId,
    name,
    size: fileBuffer.length,
    status: 'processing',
    direction: 'upload',
    progress: 0,
    error: null,
  });

  const creator = groupId ? { groupId: String(groupId) } : { userId: String(userId) };
  const fileType = isAudio ? 'audio/ogg' : 'model/x-rbxm';
  const fileName = `${(name || 'asset').replace(/[<>:"/\\|?*\r\n]/g, '_').substring(0, 100)}${isAudio ? '.ogg' : '.rbxm'}`;
  const requestMeta = {
    assetType: assetTypeName,
    displayName: name,
    description: 'Placeholder',
    creationContext: { creator },
  };

  try {
    let response, responseData;
    for (let attempt = 0; attempt <= 4; attempt++) {
      const fd = new FormData();
      fd.append('request', JSON.stringify(requestMeta));
      fd.append('fileContent', new Blob([fileBuffer], { type: fileType }), fileName);
      await waitRateLimit();
      response = await fetch('https://apis.roblox.com/assets/v1/assets', {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
        body: fd,
      });
      if (response.status === 429) {
        if (attempt >= 4) throw new Error('Rate limit hit after 4 retries.');
        const after = Math.min(parseInt(response.headers.get('retry-after') || '30', 10), 60);
        setRateLimit(after * 1000 + Math.floor(Math.random() * 8000));
        sendUpdate({ id: transferId, status: 'processing', progress: 0 });
        await waitRateLimit();
        continue;
      }
      responseData = await response.json();
      break;
    }

    if (!response.ok) {
      const detail = JSON.stringify(responseData);
      if (response.status === 401 || response.status === 403)
        throw new Error(`API key rejected (${response.status}): ${detail}`);
      if (response.status >= 500) throw new Error(`Server error (${response.status}): ${detail}`);
      throw new Error(`Upload failed (${response.status}): ${detail}`);
    }

    if (responseData.done && responseData.response) {
      const assetId = responseData.response.assetId || responseData.response.Id;
      if (assetId) {
        sendUpdate({
          id: transferId,
          progress: 100,
          status: 'completed',
          newAssetId: String(assetId),
        });
        return { success: true, assetId: String(assetId) };
      }
    }

    if (responseData.path && !responseData.done) {
      const pollUrl = `https://apis.roblox.com/${responseData.path.startsWith('assets/') ? responseData.path : `assets/v1/${responseData.path}`}`;
      for (let i = 1; i <= 30; i++) {
        await sleep(1000);
        const poll = await fetch(pollUrl, { headers: { 'x-api-key': apiKey } });
        const pollData = await poll.json();
        if (!pollData.done) continue;
        if (pollData.error)
          throw new Error(
            `Roblox rejected upload: ${pollData.error.message || JSON.stringify(pollData.error)}`
          );
        const assetId = pollData.response?.assetId || pollData.response?.Id;
        if (assetId) {
          sendUpdate({
            id: transferId,
            progress: 100,
            status: 'completed',
            newAssetId: String(assetId),
          });
          return { success: true, assetId: String(assetId) };
        }
      }
      throw new Error(
        `Upload timed out waiting for Roblox to process the ${assetTypeName.toLowerCase()}.`
      );
    }

    throw new Error(`Unexpected API response: ${JSON.stringify(responseData)}`);
  } catch (err) {
    const error = err.message || `Upload failed for "${name}".`;
    sendUpdate({ id: transferId, status: 'error', error, progress: 0 });
    return { success: false, error };
  }
}

const sessionPath = () => path.join(app.getPath('userData'), 'jonuffy_state.json');
const historyPath = () => path.join(app.getPath('userData'), 'jonuffy_mappings.json');
const runsPath = () => path.join(app.getPath('userData'), 'jonuffy_runs.json');

const saveSession = s => fs.writeFile(sessionPath(), JSON.stringify(s)).catch(() => {});
const loadSession = async () => {
  try {
    return JSON.parse(await fs.readFile(sessionPath(), 'utf8'));
  } catch {
    return null;
  }
};
const clearSession = () => fs.unlink(sessionPath()).catch(() => {});

async function loadHistory() {
  try {
    const p = JSON.parse(await fs.readFile(historyPath(), 'utf8'));
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}
const saveHistory = h =>
  fs.writeFile(historyPath(), JSON.stringify(h || {}, null, 2)).catch(() => {});
const clearHistory = () => fs.unlink(historyPath()).catch(() => {});

async function loadRuns() {
  try {
    const list = JSON.parse(await fs.readFile(runsPath(), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
const saveRuns = list =>
  fs.writeFile(runsPath(), JSON.stringify(list || [], null, 2)).catch(() => {});

const hKey = (type, target, id) => `${type}:${target}:${id}`;
async function rememberMapping(type, target, origId, newId, name) {
  if (!origId || !newId) return;
  const h = await loadHistory();
  h[hKey(type, target, origId)] = {
    originalId: String(origId),
    newId: String(newId),
    name: name || '',
    assetType: type,
    target,
    savedAt: new Date().toISOString(),
  };
  await saveHistory(h);
}

module.exports = {
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
};
