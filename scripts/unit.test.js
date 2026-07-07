'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

const {
  buildCookieHeader,
  parseAssetInput,
  classifyError,
  sanitizeFilename,
} = require('../modules/roblox');
const { semverGt, sha256File, expectedChecksum } = require('../modules/updater');

test('semverGt compares versions numerically', () => {
  assert.equal(semverGt('1.6.0', '1.5.7'), true);
  assert.equal(semverGt('1.5.7', '1.6.0'), false);
  assert.equal(semverGt('1.6.0', '1.6.0'), false);
  assert.equal(semverGt('v2.0.0', 'v1.9.9'), true);
  assert.equal(semverGt('1.10.0', '1.9.0'), true);
});

test('buildCookieHeader normalizes cookie forms', () => {
  assert.equal(buildCookieHeader('ABC123'), '.ROBLOSECURITY=ABC123');
  assert.equal(buildCookieHeader('.ROBLOSECURITY=ABC123'), '.ROBLOSECURITY=ABC123');
  assert.equal(buildCookieHeader('"ABC123"'), '.ROBLOSECURITY=ABC123');
  assert.equal(buildCookieHeader('_|WARNING|_do-not-share; .ROBLOSECURITY=XYZ'), '.ROBLOSECURITY=XYZ');
  assert.equal(buildCookieHeader(''), '');
  assert.equal(buildCookieHeader(null), '');
});

test('parseAssetInput reads the dash format and dedupes', () => {
  const out = parseAssetInput(
    ['123 - Run - U: 55', '# comment', '123 - Run - U: 55', '999 - Dance - G: 77', 'garbage'].join(
      '\n'
    )
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { id: '123', name: 'Run', creatorType: 'user', creatorId: '55' });
  assert.deepEqual(out[1], { id: '999', name: 'Dance', creatorType: 'group', creatorId: '77' });
});

test('parseAssetInput handles empty and non-string input', () => {
  assert.deepEqual(parseAssetInput(''), []);
  assert.deepEqual(parseAssetInput(null), []);
});

test('classifyError buckets known failures', () => {
  assert.equal(classifyError('HTTP 401').category, 'Invalid cookie');
  assert.equal(classifyError('HTTP 429 rate limit').category, 'Rate limited');
  assert.equal(classifyError('HTTP 404 not found').category, 'Asset unavailable');
  assert.equal(classifyError('HTTP 503').category, 'Network failure');
  assert.equal(classifyError('totally unexpected').category, 'Unknown');
});

test('sanitizeFilename strips illegal characters', () => {
  assert.equal(sanitizeFilename('a/b:c*d?'), 'a_b_c_d_');
  assert.equal(sanitizeFilename('clean_name'), 'clean_name');
});

test('sha256File hashes file contents', async () => {
  const p = path.join(os.tmpdir(), `jspoofer_test_${Date.now()}.bin`);
  fs.writeFileSync(p, 'abc');
  try {
    assert.equal(
      await sha256File(p),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  } finally {
    fs.unlinkSync(p);
  }
});

test('expectedChecksum finds the asset hash from a SHA256SUMS feed', async () => {
  const hash = 'a'.repeat(64);
  const body = [`${'b'.repeat(64)}  other.exe`, `${hash} *JonuffySpoofer-1.6.0.exe`].join('\n');
  const server = http.createServer((_req, res) => res.end(body));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/SHA256SUMS.txt`;
  try {
    assert.equal(await expectedChecksum(url, 'JonuffySpoofer-1.6.0.exe'), hash);
    assert.equal(await expectedChecksum(url, 'missing.exe'), null);
  } finally {
    server.close();
  }
});
