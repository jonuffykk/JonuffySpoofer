'use strict';

const http = require('http');

const PORT = 28476;
let server = null;
let studioConn = null;
let callbacks = {};
let pendingMappings = null;
let pendingScanReq = null;
let scanHandler = null;
let studioSocket = null;
let isScanning = false;

const setStudioCallbacks = cb => {
  callbacks = cb;
};
const getConn = () => studioConn;
const setMappings = m => {
  pendingMappings = m;
};

const parseBody = req =>
  new Promise((res, rej) => {
    let buf = '';
    req.on('data', c => {
      buf += c;
    });
    req.on('end', () => {
      try {
        res(JSON.parse(buf || '{}'));
      } catch {
        res({});
      }
    });
    req.on('error', rej);
  });

const reply = (res, status, body) => {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
};

async function handleRequest(req, res) {
  const url = req.url;

  if (url === '/connect' && req.method === 'POST') {
    const body = await parseBody(req);
    studioConn = {
      connected: true,
      placeId: body.placeId,
      placeName: body.placeName,
      connectedAt: Date.now(),
    };
    studioSocket = req.socket;
    studioSocket.on('close', () => {
      if (studioConn) {
        studioConn = null;
        studioSocket = null;
        callbacks.onStatusUpdate?.('disconnected', null);
      }
    });
    callbacks.onStatusUpdate?.('connected', studioConn);
    return reply(res, 200, { ok: true });
  }

  if (url === '/disconnect' && req.method === 'POST') {
    studioConn = null;
    callbacks.onStatusUpdate?.('disconnected', null);
    return reply(res, 200, { ok: true });
  }

  if (url === '/poll' && req.method === 'GET') {
    lastHeartbeat = Date.now();
    const resp = {};
    if (pendingScanReq) {
      resp.scanRequest = pendingScanReq;
      pendingScanReq = null;
    }
    if (pendingMappings) {
      resp.mappings = pendingMappings;
      pendingMappings = null;
    }
    return reply(res, 200, resp);
  }

  if (url === '/scan-result' && req.method === 'POST') {
    const body = await parseBody(req);
    callbacks.onScanResult?.(body);
    scanHandler?.(body);
    if (body.status === 'completed' || body.status === 'cancelled') {
      isScanning = false;
    }
    return reply(res, 200, { ok: true });
  }

  if (url === '/replace-complete' && req.method === 'POST') {
    const body = await parseBody(req);
    callbacks.onReplaceComplete?.(body);
    return reply(res, 200, { ok: true });
  }

  if (url === '/request-scan' && req.method === 'POST') {
    if (isScanning) return reply(res, 409, { error: 'Scan already in progress' });
    const body = await parseBody(req);
    pendingScanReq = body;
    isScanning = true;
    return reply(res, 200, { ok: true });
  }

  if (url === '/cancel-scan' && req.method === 'POST') {
    isScanning = false;
    pendingScanReq = null;
    scanHandler?.({ status: 'cancelled' });
    return reply(res, 200, { ok: true });
  }

  if (url === '/set-mappings' && req.method === 'POST') {
    const body = await parseBody(req);
    pendingMappings = body.mappings;
    return reply(res, 200, { ok: true });
  }

  reply(res, 404, { error: 'Not found' });
}

function startServer() {
  server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    handleRequest(req, res).catch(() => reply(res, 500, { error: 'Internal error' }));
  });
  server.listen(PORT, '127.0.0.1');
}

const setScanHandler = fn => {
  scanHandler = fn;
};

module.exports = { startServer, getConn, setMappings, setStudioCallbacks, setScanHandler };
