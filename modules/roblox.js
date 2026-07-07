'use strict';

const fsSync = require('fs');
const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const sanitizeFilename = n => n.replace(/[<>:"\/\\|?*]/g, '_');

const buildCookieHeader = raw => {
  if (!raw || typeof raw !== 'string') return '';
  let v = raw.trim().replace(/^['"]+|['"]+$/g, '');
  const m = v.match(/(?:^|;\s*)\.ROBLOSECURITY=([^;]+)/i);
  if (m?.[1]) v = m[1].trim();
  v = v
    .replace(/^\.ROBLOSECURITY=/i, '')
    .replace(/[;\r\n]+$/g, '')
    .trim();
  return v ? `.ROBLOSECURITY=${v}` : '';
};

const classifyError = err => {
  const text = String(typeof err === 'string' ? err : err?.message || err?.error || 'Unknown');
  const low = text.toLowerCase();
  if (
    /\b401\b/.test(text) ||
    low.includes('invalid roblox cookie') ||
    low.includes('authentication failed')
  )
    return { category: 'Invalid cookie', raw: text };
  if (low.includes('api key') || (/\b403\b/.test(text) && low.includes('open cloud')))
    return { category: 'Invalid API key', raw: text };
  if (
    /\b404\b/.test(text) ||
    low.includes('not found') ||
    low.includes('moderated') ||
    low.includes('no location')
  )
    return { category: 'Asset unavailable', raw: text };
  if (/\b403\b/.test(text) || low.includes('permission') || low.includes('not authorized'))
    return { category: 'No permission', raw: text };
  if (/\b429\b/.test(text) || low.includes('rate limit'))
    return { category: 'Rate limited', raw: text };
  if (
    /\b5\d\d\b/.test(text) ||
    low.includes('network') ||
    low.includes('timeout') ||
    low.includes('enotfound')
  )
    return { category: 'Network failure', raw: text };
  if (low.includes('rbxm') || low.includes('enoent') || low.includes('conversion'))
    return { category: 'File error', raw: text };
  return { category: 'Unknown', raw: text };
};

const parseAssetInput = input => {
  if (!input || typeof input !== 'string') return [];
  const rDash = /^\s*(\d+)\s+-\s+(.+?)\s+-\s+([GU]):\s*(\d+)\s*$/;
  const seen = new Set();
  return input.split('\n').flatMap(line => {
    line = line.trim();
    if (!line || line.startsWith('--') || line.startsWith('#')) return [];
    const m = line.match(rDash);
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
  });
};

const retryAsync = async (fn, retries = 3, delayMs = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i < retries - 1) await sleep(delayMs);
      else
        throw Object.assign(new Error(`After ${retries} attempts: ${err.message}`), { cause: err });
    }
  }
};

const retryWithCooldown = async (fn, retries, delayMs, onFail, onTick) => {
  const max = Math.max(1, retries);
  for (let i = 1; i <= max; i++) {
    try {
      return await fn();
    } catch (err) {
      onFail?.(i, max, err);
      if (i >= max) throw err;
      const secs = Math.ceil(delayMs / 1000);
      for (let r = secs; r > 0; r--) {
        onTick?.(r, secs, i + 1, max, err);
        await sleep(1000);
      }
    }
  }
};

const runWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (true) {
        const cur = idx++;
        if (cur >= items.length) break;
        await sleep(80 + Math.floor(Math.random() * 120));
        results[cur] = await worker(items[cur]);
      }
    })
  );
  return results;
};

const clearDir = async dir => {
  try {
    if (await fs.stat(dir).catch(() => null))
      for (const f of await fs.readdir(dir)) await fs.unlink(path.join(dir, f));
  } catch {}
};

const robloxFetch = async (url, cookie, extra = {}) => {
  const h = buildCookieHeader(cookie);
  if (!h) throw new Error('Missing or invalid ROBLOSECURITY cookie');
  const resp = await fetch(url, {
    headers: { Cookie: h, 'User-Agent': 'RobloxStudio/WinInet', ...extra.headers },
    ...extra,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${url}`);
  return resp.json();
};

const getPlaceIds = async (creatorType, creatorId, cookie, max = 10) => {
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
    await sleep(500);
  }
  const ids = games
    .slice(0, max)
    .map(g => g.rootPlace?.id || g.id)
    .filter(Boolean);
  if (!ids.length) throw new Error('No root places found');
  return ids;
};

const getAuthUserId = async cookie => {
  const data = await robloxFetch('https://users.roblox.com/v1/users/authenticated', cookie);
  if (!data.id) throw new Error('No user ID in response');
  return String(data.id);
};

const getAuthUserInfo = async cookie => {
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
};

const getUserGroups = async cookie => {
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
};

const canUploadToGroup = async (cookie, groupId, apiKey) => {
  if (!cookie || !apiKey) return { canUpload: false, reason: 'Missing credentials' };
  const h = buildCookieHeader(cookie);
  if (!h) return { canUpload: false, reason: 'Invalid cookie' };
  try {
    const fd = new FormData();
    fd.append(
      'request',
      JSON.stringify({
        assetType: 'Animation',
        displayName: '__test__',
        description: '',
        creationContext: { creator: groupId ? { groupId: String(groupId) } : { userId: '0' } },
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
};

let rlUntil = 0;
const setRateLimit = ms => {
  rlUntil = Math.max(rlUntil, Date.now() + ms);
};
const waitRateLimit = async () => {
  const w = rlUntil - Date.now();
  if (w > 0) await sleep(w);
};

const downloadAsset = async (url, cookie, filePath, opts = {}) => {
  const h = buildCookieHeader(cookie);
  if (!h) return { ok: false, error: 'Invalid cookie' };
  const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : 30000;
  const retries = opts.retries > 0 ? opts.retries : 3;
  const retryDelayMs = opts.retryDelayMs > 0 ? opts.retryDelayMs : 3000;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    let stream = null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      let resp;
      try {
        resp = await fetch(url, {
          headers: { Cookie: h },
          redirect: 'follow',
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(t);
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      if (!resp.body) throw new Error('No response body');
      const reader = resp.body.getReader();
      stream = fsSync.createWriteStream(filePath);
      let streamErr = null;
      stream.on('error', e => {
        streamErr = e;
      });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (streamErr) throw streamErr;
        stream.write(value);
      }
      if (streamErr) throw streamErr;
      stream.end();
      await new Promise((res, rej) => {
        stream.once('finish', res);
        stream.once('error', e => rej(e));
      });
      return { ok: true, filePath };
    } catch (err) {
      const msg = err?.message || 'unknown';
      const retryable = err?.name === 'AbortError' || /aborted|timeout|\b5\d\d\b/.test(msg);
      try {
        stream?.end();
      } catch {}
      try {
        if (fsSync.existsSync(filePath)) fsSync.unlinkSync(filePath);
      } catch {}
      if (!retryable || attempt > retries) return { ok: false, error: msg };
      await sleep(retryDelayMs + Math.floor(Math.random() * 2000));
    }
  }
};

const uploadAsset = async (filePath, name, groupId, assetTypeName, apiKey, userId) => {
  let buf;
  try {
    buf = await fs.readFile(filePath);
  } catch (err) {
    return { ok: false, error: `File read: ${err.message}` };
  }
  if (!apiKey)
    return { ok: false, error: `${assetTypeName} uploads require an Open Cloud API key.` };
  const creator = groupId ? { groupId: String(groupId) } : { userId: String(userId) };
  const fileName = `${(name || 'asset').replace(/[<>:"/\\|?*\r\n]/g, '_').substring(0, 100)}.rbxm`;
  const meta = {
    assetType: assetTypeName,
    displayName: name,
    description: 'Placeholder',
    creationContext: { creator },
  };

  let response, responseData;
  for (let attempt = 0; attempt <= 4; attempt++) {
    const fd = new FormData();
    fd.append('request', JSON.stringify(meta));
    fd.append('fileContent', new Blob([buf], { type: 'model/x-rbxm' }), fileName);
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
    if (assetId) return { ok: true, assetId: String(assetId) };
  }

  if (responseData.path && !responseData.done) {
    const pollUrl = `https://apis.roblox.com/${responseData.path.startsWith('assets/') ? responseData.path : `assets/v1/${responseData.path}`}`;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const poll = await fetch(pollUrl, { headers: { 'x-api-key': apiKey } });
      const d = await poll.json();
      if (!d.done) continue;
      if (d.error)
        throw new Error(`Roblox rejected: ${d.error.message || JSON.stringify(d.error)}`);
      const assetId = d.response?.assetId || d.response?.Id;
      if (assetId) return { ok: true, assetId: String(assetId) };
    }
    throw new Error(`Upload timed out waiting for ${assetTypeName}.`);
  }

  throw new Error(`Unexpected API response: ${JSON.stringify(responseData)}`);
};

const historyPath = () => path.join(app.getPath('userData'), 'jonuffy_mappings.json');

const loadHistory = async () => {
  try {
    const p = JSON.parse(await fs.readFile(historyPath(), 'utf8'));
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
};
const saveHistory = h =>
  fs.writeFile(historyPath(), JSON.stringify(h || {}, null, 2)).catch(() => {});
const clearHistory = () => fs.unlink(historyPath()).catch(() => {});

const hKey = (type, target, id) => `${type}:${target}:${id}`;

const rememberMapping = async (type, target, origId, newId, name) => {
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
};

module.exports = {
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
  loadHistory,
  clearHistory,
  hKey,
  rememberMapping,
};
