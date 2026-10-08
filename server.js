import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  addCar,
  addMessage,
  clearDelivered,
  emptyState,
  prune,
  removeCar,
  setStatus
} from './lib/state.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || '0.0.0.0';
const dataFile = process.env.DATA_FILE || path.join(root, 'data', 'state.json');

const clients = new Set();
let state = loadState();
let writeChain = Promise.resolve();

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    if (!Array.isArray(parsed.cars) || !Array.isArray(parsed.messages)) {
      throw new Error('Board file is not a state object');
    }
    return prune(parsed);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      try {
        fs.renameSync(dataFile, `${dataFile}.bak`);
      } catch {
        // Keep going with an empty board if the bad file cannot be moved.
      }
      console.error('Started with an empty board because the saved file could not be read.');
    }
    return emptyState();
  }
}

function persist() {
  const snapshot = JSON.stringify(state, null, 2);
  writeChain = writeChain
    .then(async () => {
      await fs.promises.mkdir(path.dirname(dataFile), { recursive: true });
      const temporary = `${dataFile}.tmp`;
      await fs.promises.writeFile(temporary, snapshot);
      await fs.promises.rename(temporary, dataFile);
    })
    .catch((error) => {
      console.error('Could not save the board.', error);
    });
}

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast() {
  for (const res of clients) {
    try {
      send(res, 'state', state);
    } catch {
      clients.delete(res);
    }
  }
}

function mutate(result) {
  if (result.error) return result;
  persist();
  broadcast();
  return result;
}

function lanHosts() {
  const hosts = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) hosts.push(entry.address);
    }
  }
  return hosts;
}

function info() {
  const hosts = lanHosts();
  return {
    port,
    board: hosts.map((address) => `http://${address}:${port}/`),
    staff: hosts.map((address) => `http://${address}:${port}/staff`)
  };
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32_000) {
      const error = new Error('That request is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('That request was not valid.');
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function contentType(file) {
  switch (path.extname(file)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

function publicFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const rootPath = path.resolve(publicDir);
  const file = path.resolve(rootPath, `.${decoded}`);
  if (file !== rootPath && !file.startsWith(`${rootPath}${path.sep}`)) return null;
  return file;
}

function serveFile(res, file) {
  const data = fs.readFileSync(file);
  res.writeHead(200, {
    'content-type': contentType(file),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(data);
}

function openEvents(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  res.write(': connected\n\n');
  send(res, 'state', state);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const { pathname } = url;
    const method = req.method || 'GET';

    if (method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (method === 'GET' && pathname === '/api/state') {
      sendJson(res, 200, state);
      return;
    }
    if (method === 'GET' && pathname === '/api/info') {
      sendJson(res, 200, info());
      return;
    }
    if (method === 'GET' && pathname === '/events') {
      openEvents(req, res);
      return;
    }
    if (method === 'POST' && pathname === '/api/cars') {
      const result = mutate(addCar(state, await readJson(req)));
      sendJson(res, result.error ? result.status : 201, result.error ? { error: result.error } : { car: result.car });
      return;
    }
    if (method === 'POST' && pathname === '/api/chat') {
      const result = mutate(addMessage(state, await readJson(req)));
      sendJson(res, result.error ? result.status : 201, result.error ? { error: result.error } : { message: result.message });
      return;
    }
    if (method === 'POST' && pathname === '/api/clear-delivered') {
      const result = mutate(clearDelivered(state));
      sendJson(res, 200, result);
      return;
    }

    const statusMatch = pathname.match(/^\/api\/cars\/([^/]+)\/status$/);
    if (method === 'POST' && statusMatch) {
      const body = await readJson(req);
      const result = mutate(setStatus(state, decodeURIComponent(statusMatch[1]), body.status));
      sendJson(res, result.error ? result.status : 200, result.error ? { error: result.error } : { car: result.car });
      return;
    }

    const carMatch = pathname.match(/^\/api\/cars\/([^/]+)$/);
    if (method === 'DELETE' && carMatch) {
      const result = mutate(removeCar(state, decodeURIComponent(carMatch[1])));
      sendJson(res, result.error ? result.status : 200, result.error ? { error: result.error } : { car: result.car });
      return;
    }

    if (method === 'GET' && (pathname === '/' || pathname === '/staff')) {
      serveFile(res, pathname === '/' ? path.join(publicDir, 'board.html') : path.join(publicDir, 'staff.html'));
      return;
    }

    if (method === 'GET') {
      const file = publicFile(pathname);
      if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
        serveFile(res, file);
        return;
      }
    }

    sendJson(res, 404, { error: 'Not found.' });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'Something went wrong.' });
  }
});

setInterval(() => {
  for (const res of clients) {
    try {
      send(res, 'ping', {});
    } catch {
      clients.delete(res);
    }
  }
}, 10_000).unref();

server.listen(port, host, () => {
  console.log(`Customer screen   http://localhost:${port}/`);
  console.log(`Workshop & office http://localhost:${port}/staff`);
  for (const address of lanHosts()) {
    console.log(`Other computers   http://${address}:${port}/staff`);
  }
});
