'use strict';

const fs = require('fs').promises;
const path = require('path');

async function retryAsync(fn, retries = 3, delayMs = 1000, onRetryAttempt) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (onRetryAttempt) onRetryAttempt(i + 1, retries, err);
      if (i < retries - 1) await new Promise(resolve => setTimeout(resolve, delayMs));
      else {
        const enriched = new Error(`After ${retries} attempts: ${err.message}`);
        enriched.cause = err;
        throw enriched;
      }
    }
  }
}

async function clearDownloadsDirectory(directoryPath) {
  try {
    if (await fs.stat(directoryPath).catch(() => null)) {
      const files = await fs.readdir(directoryPath);
      for (const file of files) await fs.unlink(path.join(directoryPath, file));
    }
    return true;
  } catch {
    return false;
  }
}

function sanitizeFilename(filename) {
  return filename.replace(/[<>:"\/\\|?*]/g, '_');
}

function normalizeRobloxCookie(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return '';
  let normalized = cookieValue.trim().replace(/^['"]+|['"]+$/g, '');
  const prefixedMatch = normalized.match(/(?:^|;\s*)\.ROBLOSECURITY=([^;]+)/i);
  if (prefixedMatch?.[1]) normalized = prefixedMatch[1].trim();
  normalized = normalized.replace(/^\.ROBLOSECURITY=/i, '').trim();
  normalized = normalized.replace(/[;\r\n]+$/g, '').trim();
  return normalized;
}

function buildRobloxCookieHeader(cookieValue) {
  const normalized = normalizeRobloxCookie(cookieValue);
  return normalized ? `.ROBLOSECURITY=${normalized}` : '';
}

module.exports = {
  retryAsync,
  clearDownloadsDirectory,
  sanitizeFilename,
  buildRobloxCookieHeader,
};
