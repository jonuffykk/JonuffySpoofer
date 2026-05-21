'use strict';

const http = require('http');
const { URL } = require('url');

let server = null;
let studioConnection = null;
let callbacks = {
  onScanResult: null,
  onReplaceComplete: null,
  onStatusUpdate: null,
  onScanRequest: null,
};

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function startServer(port = 28476) {
  if (server) {
    server.close();
    studioConnection = null;
  }

  server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return send(res, 204, {});

    try {
      if (pathname === '/ping' && req.method === 'GET') {
        return send(res, 200, { status: 'ok', timestamp: Date.now() });
      }

      if (pathname === '/connect' && req.method === 'POST') {
        studioConnection = null;
        global.currentMappings = [];
        const data = await parseBody(req);
        studioConnection = {
          connected: true,
          placeId: data.placeId ?? null,
          placeName: data.placeName ?? null,
          connectedAt: new Date().toISOString(),
        };
        callbacks.onStatusUpdate?.('connected', studioConnection);
        return send(res, 200, { success: true });
      }

      if (!studioConnection) {
        return send(res, 401, { error: 'Unauthorized' });
      }

      if (pathname === '/disconnect' && req.method === 'POST') {
        studioConnection = null;
        callbacks.onStatusUpdate?.('disconnected', null);
        return send(res, 200, { success: true });
      }

      if (pathname === '/scan' && req.method === 'POST') {
        const data = await parseBody(req);
        callbacks.onScanResult?.(data);
        return send(res, 200, { success: true });
      }

      if (pathname === '/get-mappings' && req.method === 'GET') {
        return send(res, 200, { mappings: global.currentMappings ?? [] });
      }

      if (pathname === '/set-mappings' && req.method === 'POST') {
        const data = await parseBody(req);
        global.currentMappings = data.mappings ?? [];
        return send(res, 200, { success: true });
      }

      if (pathname === '/request-scan' && req.method === 'POST') {
        const data = await parseBody(req);
        callbacks.onScanRequest?.(data);
        return send(res, 200, { success: true });
      }

      if (pathname === '/get-scan-request' && req.method === 'GET') {
        const pending = global.pendingScanRequest ?? null;
        global.pendingScanRequest = null;
        return send(res, 200, { assetType: pending?.assetType ?? null });
      }

      if (pathname === '/replace-complete' && req.method === 'POST') {
        const data = await parseBody(req);
        callbacks.onReplaceComplete?.(data);
        return send(res, 200, { success: true });
      }

      send(res, 404, { error: 'Not found' });
    } catch {
      send(res, 400, { error: 'Invalid JSON' });
    }
  });

  server.listen(port, '127.0.0.1').on('error', err => {
    console.error(
      `Server error: ${err.code === 'EADDRINUSE' ? `Port ${port} already in use` : err.message}`
    );
  });

  return server;
}

function stopServer() {
  server?.close();
  server = null;
  studioConnection = null;
}

function getStudioConnection() {
  return studioConnection;
}
function setStudioCallbacks(cbs) {
  callbacks = { ...callbacks, ...cbs };
}
function setMappings(mappings) {
  global.currentMappings = mappings;
}

module.exports = {
  startServer,
  stopServer,
  getStudioConnection,
  setStudioCallbacks,
  setMappings,
};
