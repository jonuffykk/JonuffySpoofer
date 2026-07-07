'use strict';

const http = require('http');

const PORT = 28476;
const POLL_INTERVAL = 2000;
const HEARTBEAT_TIMEOUT = POLL_INTERVAL * 3 + 1000;
let server = null;
let studioConn = null;
let callbacks = {};
let pendingMappings = null;
let pendingScanReq = null;
let scanHandler = null;
let lastHeartbeat = 0;
let heartbeatTimer = null;
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

const markDisconnected = () => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (studioConn) {
    studioConn = null;
    callbacks.onStatusUpdate?.('disconnected', null);
  }
};

const startHeartbeatMonitor = () => {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (studioConn && Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT) {
      markDisconnected();
    }
  }, POLL_INTERVAL);
  if (heartbeatTimer.unref) heartbeatTimer.unref();
};

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
    const wasConnected = !!studioConn;
    studioConn = {
      connected: true,
      placeId: body.placeId,
      placeName: body.placeName,
      connectedAt: studioConn?.connectedAt || Date.now(),
    };
    lastHeartbeat = Date.now();
    startHeartbeatMonitor();
    if (!wasConnected) callbacks.onStatusUpdate?.('connected', studioConn);
    return reply(res, 200, { ok: true });
  }

  if (url === '/disconnect' && req.method === 'POST') {
    markDisconnected();
    return reply(res, 200, { ok: true });
  }

  if (url === '/poll' && req.method === 'GET') {
    lastHeartbeat = Date.now();
    if (!studioConn) {
      studioConn = { connected: true, placeId: null, placeName: null, connectedAt: Date.now() };
      startHeartbeatMonitor();
      callbacks.onStatusUpdate?.('connected', studioConn);
    }
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
  if (server) return;
  server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    handleRequest(req, res).catch(() => reply(res, 500, { error: 'Internal error' }));
  });
  server.on('error', err => {
    server = null;
    if (err.code === 'EADDRINUSE') {
      setTimeout(startServer, 3000);
    }
  });
  server.listen(PORT, '127.0.0.1');
}

const setScanHandler = fn => {
  scanHandler = fn;
};

module.exports = { startServer, getConn, setMappings, setStudioCallbacks, setScanHandler };
