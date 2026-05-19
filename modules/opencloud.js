'use strict';

const fsSync = require('fs');
const fs = require('fs').promises;
const { buildRobloxCookieHeader } = require('./common');

let _rlUntil = 0;
function setRateLimit(ms) {
  _rlUntil = Math.max(_rlUntil, Date.now() + ms);
}
async function waitRateLimit() {
  const wait = _rlUntil - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

async function downloadAnimationAssetWithProgress(
  url,
  robloxCookie,
  filePath,
  transferId,
  entryName,
  originalAssetId,
  sendTransferUpdate,
  placeId = null,
  options = {}
) {
  const cookieHeader = buildRobloxCookieHeader(robloxCookie);
  if (!cookieHeader) {
    const errorMsg = 'Missing or invalid ROBLOSECURITY cookie';
    sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
    return { success: false, error: errorMsg };
  }
  sendTransferUpdate({
    id: transferId,
    name: entryName,
    originalAssetId,
    status: 'processing',
    direction: 'download',
    progress: 0,
    error: null,
    size: 0,
  });
  const timeoutMs =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 15000;
  const retries = typeof options.retries === 'number' && options.retries > 0 ? options.retries : 2;
  const retryDelayMs =
    typeof options.retryDelayMs === 'number' && options.retryDelayMs > 0
      ? options.retryDelayMs
      : 2000;
  let lastReportedProgress = 0;
  let fileStream = null;
  let attemptError = null;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    attemptError = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, {
        headers: { Cookie: cookieHeader },
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        throw new Error(`Failed to download asset: ${response.status} ${response.statusText}`);
      }
      if (!response.body) throw new Error(`No response body for asset (ID: ${originalAssetId})`);
      const totalSize = Number(response.headers.get('content-length'));
      sendTransferUpdate({ id: transferId, size: isNaN(totalSize) ? 0 : totalSize });
      const reader = response.body.getReader();
      fileStream = fsSync.createWriteStream(filePath);
      let earlyStreamError = null;
      fileStream.on('error', err => {
        earlyStreamError = err;
      });
      let receivedLength = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (earlyStreamError) throw earlyStreamError;
        fileStream.write(value);
        receivedLength += value.length;
        if (totalSize > 0) {
          const currentProgress = Math.round((receivedLength / totalSize) * 100);
          if (currentProgress > lastReportedProgress) {
            sendTransferUpdate({ id: transferId, progress: currentProgress });
            lastReportedProgress = currentProgress;
          }
        }
      }
      if (earlyStreamError) throw earlyStreamError;
      fileStream.end();
      await new Promise((resolve, reject) => {
        fileStream.once('finish', resolve);
        fileStream.once('error', err => reject(new Error(`File stream error: ${err.message}`)));
      });
      if (lastReportedProgress < 100 && totalSize > 0)
        sendTransferUpdate({ id: transferId, progress: 100 });
      sendTransferUpdate({ id: transferId, status: 'completed', progress: 100 });
      return { success: true, filePath };
    } catch (error) {
      attemptError = error;
      const msg = error && error.message ? error.message : 'unknown error';
      const isTimeout = error && (error.name === 'AbortError' || /aborted|timeout/i.test(msg));
      const shouldRetry =
        isTimeout ||
        /\b5\d\d\b/.test(msg) ||
        /Failed to download asset: (500|502|503|504)/.test(msg);
      try {
        if (fileStream) fileStream.end();
      } catch {}
      try {
        if (fsSync.existsSync(filePath)) fsSync.unlinkSync(filePath);
      } catch {}
      if (!shouldRetry || attempt > retries) {
        sendTransferUpdate({
          id: transferId,
          status: 'error',
          error: msg,
          progress: lastReportedProgress || 0,
        });
        return { success: false, error: msg };
      }
      const jitter = Math.floor(Math.random() * 300);
      await new Promise(r => setTimeout(r, retryDelayMs + jitter));
      continue;
    }
  }
}

async function publishAnimationRbxmWithProgress(
  filePath,
  name,
  groupId = null,
  transferId,
  sendTransferUpdate,
  assetTypeName = 'Animation',
  apiKey = null,
  userId = null
) {
  let fileBuffer;
  let fileSize = 0;
  try {
    fileBuffer = await fs.readFile(filePath);
    fileSize = fileBuffer.length;
  } catch (fileError) {
    sendTransferUpdate({
      id: transferId,
      name,
      status: 'error',
      direction: 'upload',
      error: `File system error: ${fileError.message}`,
    });
    return { success: false, error: `File system error: ${fileError.message}` };
  }
  sendTransferUpdate({
    id: transferId,
    name,
    size: fileSize,
    status: 'processing',
    direction: 'upload',
    progress: 0,
    error: null,
  });
  const isAudio = assetTypeName === 'Audio';
  if (!apiKey) {
    const assetLabel = isAudio ? 'Sound' : 'Animation';
    const errorMsg = `${assetLabel} uploads require an Open Cloud API key. Go to create.roblox.com → Open Cloud → API Keys and create a key with Assets Read & Write permissions.`;
    sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
    return { success: false, error: errorMsg };
  }
  const creatorObj = groupId ? { groupId: String(groupId) } : { userId: String(userId) };
  const assetType = isAudio ? 'Audio' : 'Animation';
  const fileType = isAudio ? 'audio/ogg' : 'model/x-rbxm';
  const safeNameBase = (name || 'asset').replace(/[<>:"/\\|?*\r\n]/g, '_').substring(0, 100);
  const fileName = isAudio ? `${safeNameBase}.ogg` : `${safeNameBase}.rbxm`;
  const requestMetadata = {
    assetType,
    displayName: name,
    description: 'Placeholder',
    creationContext: { creator: creatorObj },
  };
  try {
    const MAX_RATE_LIMIT_RETRIES = 4;
    let response, responseData;
    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      const formData = new FormData();
      formData.append('request', JSON.stringify(requestMetadata));
      formData.append('fileContent', new Blob([fileBuffer], { type: fileType }), fileName);
      await waitRateLimit();
      response = await fetch('https://apis.roblox.com/assets/v1/assets', {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
        body: formData,
      });
      if (response.status === 429) {
        if (attempt >= MAX_RATE_LIMIT_RETRIES)
          throw new Error(
            `Rate limit hit after ${MAX_RATE_LIMIT_RETRIES} retries. Try again later.`
          );
        const retryAfter = Math.min(parseInt(response.headers.get('retry-after') || '30', 10), 60);
        const jitter = Math.floor(Math.random() * 8000);
        sendTransferUpdate({ id: transferId, status: 'processing', progress: 0 });
        setRateLimit(retryAfter * 1000 + jitter);
        await waitRateLimit();
        continue;
      }
      responseData = await response.json();
      break;
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new Error(
          `API key rejected (${response.status}). Make sure your key has Assets Read & Write permissions. Response: ${JSON.stringify(responseData)}`
        );
      else if (response.status >= 500)
        throw new Error(
          `Server error (${response.status}). Response: ${JSON.stringify(responseData)}`
        );
      else
        throw new Error(
          `Upload failed (Status: ${response.status}). Response: ${JSON.stringify(responseData)}`
        );
    }
    if (responseData.done && responseData.response) {
      const assetId = responseData.response.assetId || responseData.response.Id;
      if (assetId) {
        sendTransferUpdate({
          id: transferId,
          progress: 100,
          status: 'completed',
          newAssetId: String(assetId),
        });
        return { success: true, assetId: String(assetId) };
      }
    }
    if (responseData.path && !responseData.done) {
      const operationPath = responseData.path;
      const normalizedPath = operationPath.startsWith('assets/')
        ? operationPath
        : `assets/v1/${operationPath}`;
      const pollUrl = `https://apis.roblox.com/${normalizedPath}`;
      const maxPollAttempts = 30;
      const pollIntervalMs = 1000;
      for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
        await new Promise(r => setTimeout(r, pollIntervalMs));
        const pollResp = await fetch(pollUrl, { headers: { 'x-api-key': apiKey } });
        const pollData = await pollResp.json();
        if (pollData.done) {
          if (pollData.error)
            throw new Error(
              `Roblox rejected the upload: ${pollData.error.message || JSON.stringify(pollData.error)}`
            );
          if (pollData.response) {
            const assetId = pollData.response.assetId || pollData.response.Id;
            if (assetId) {
              sendTransferUpdate({
                id: transferId,
                progress: 100,
                status: 'completed',
                newAssetId: String(assetId),
              });
              return { success: true, assetId: String(assetId) };
            }
          }
        }
      }
      throw new Error(
        `Upload timed out waiting for Roblox to process the ${assetType.toLowerCase()}.`
      );
    }
    throw new Error(`Unexpected response from Open Cloud API: ${JSON.stringify(responseData)}`);
  } catch (err) {
    const errorMsg = err.message || `Upload failed for "${name}".`;
    sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
    return { success: false, error: errorMsg };
  }
}

module.exports = { downloadAnimationAssetWithProgress, publishAnimationRbxmWithProgress };
