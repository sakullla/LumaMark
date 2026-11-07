import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDataStore, StoreError } from './store.mjs';

const SESSION_SECONDS = 14 * 24 * 60 * 60;
const indexPath = fileURLToPath(new URL('./public/index.html', import.meta.url));

function send(res, status, body, extra = {}) {
  const html = typeof body === 'string';
  const payload = html ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': html ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(payload);
}

function sendEmpty(res, status, extra = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end();
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        failed = true;
        reject(new StoreError(413, 'payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolveBody(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => {
      if (!failed) reject(error);
    });
  });
}

function parseJson(text) {
  if (!text) throw new StoreError(400, 'invalid_json');
  try {
    return JSON.parse(text);
  } catch {
    throw new StoreError(400, 'invalid_json');
  }
}

function cookieValue(header, name) {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

function sessionCookie(token, maxAge) {
  const value = token ? encodeURIComponent(token) : '';
  return `lumamark_session=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

function bearerToken(req) {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : undefined;
}

export async function startServer({ dataDir, host = '127.0.0.1', port = 0 }) {
  const store = openDataStore(dataDir);
  await store.ready();
  const sessions = new Map();
  const page = await readFile(indexPath, 'utf8');

  function createSession(account) {
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, { accountId: account.id, username: account.username, expiresAt: Date.now() + SESSION_SECONDS * 1000 });
    return token;
  }

  function currentSession(req) {
    const token = bearerToken(req) || cookieValue(req.headers.cookie, 'lumamark_session');
    if (!token) return null;
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(token);
      return null;
    }
    return { ...session, token };
  }

  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://127.0.0.1');
    } catch {
      send(res, 400, { error: 'invalid_request' });
      return;
    }
    const path = url.pathname;
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      send(res, 200, page);
      return;
    }
    if (req.method === 'POST' && path === '/api/session') {
      const body = parseJson(await readBody(req));
      const username = body && typeof body === 'object' ? body.username : undefined;
      const password = body && typeof body === 'object' ? body.password : undefined;
      const account = await store.authenticate(username, password);
      if (!account) {
        send(res, 401, { error: 'unauthorized' });
        return;
      }
      const token = createSession(account);
      send(res, 200, { username: account.username, token }, { 'Set-Cookie': sessionCookie(token, SESSION_SECONDS) });
      return;
    }
    if (req.method === 'GET' && path === '/api/session') {
      const session = currentSession(req);
      if (!session) {
        send(res, 401, { error: 'unauthorized' });
        return;
      }
      send(res, 200, { username: session.username });
      return;
    }
    if (req.method === 'DELETE' && path === '/api/session') {
      const session = currentSession(req);
      if (session) sessions.delete(session.token);
      sendEmpty(res, 204, { 'Set-Cookie': sessionCookie('', 0) });
      return;
    }
    if (path === '/api/manifest') {
      const session = currentSession(req);
      if (!session) {
        send(res, 401, { error: 'unauthorized' });
        return;
      }
      if (req.method === 'GET') {
        const snapshot = await store.readManifest(session.accountId);
        send(res, 200, snapshot.manifest, { ETag: snapshot.etag });
        return;
      }
      if (req.method === 'PUT') {
        const ifMatch = req.headers['if-match'];
        const raw = await readBody(req);
        if (ifMatch == null || String(ifMatch).trim() === '') {
          send(res, 428, { error: 'precondition_required' });
          return;
        }
        const written = await store.writeManifest(session.accountId, parseJson(raw), ifMatch);
        send(res, 200, { etag: written.etag }, { ETag: written.etag });
        return;
      }
      send(res, 405, { error: 'method_not_allowed' });
      return;
    }
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') await readBody(req);
    send(res, 404, { error: 'not_found' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (res.headersSent || res.writableEnded) return;
      if (!(error instanceof StoreError) || error.status >= 500) console.error(error);
      const status = error instanceof StoreError ? error.status : 500;
      const code = error instanceof StoreError ? error.code : 'internal_error';
      send(res, status, { error: code });
    });
  });
  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolveListen);
  });
  const address = server.address();
  const actualPort = address && typeof address === 'object' ? address.port : port;
  const urlHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  return {
    url: `http://${urlHost}:${actualPort}`,
    close() {
      return new Promise((resolveClose, reject) => {
        server.close((error) => error ? reject(error) : resolveClose());
      });
    },
  };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST || '0.0.0.0';
  const dataDir = process.env.LUMAMARK_DATA || join(process.cwd(), 'data');
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('PORT 无效');
    process.exit(1);
  }
  const running = await startServer({ dataDir, host, port });
  console.log(`listening ${running.url}`);
  const shutdown = () => {
    running.close().then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
