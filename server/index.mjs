// Whiteboard server: static files + login + WebSocket live board. No npm dependencies.
import http from 'node:http';
import { existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { loadConfig } from './config.mjs';
import { AuditLog } from './audit.mjs';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { upgrade } from './ws.mjs';
import { loadUsers } from './users.mjs';
import {
  hashPassword, verifyPassword, safeEqual, loadSecret, signToken, verifyToken, Throttle, cleanName,
} from './auth.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json', '.txt': 'text/plain',
};

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' data: blob:",
  "connect-src 'self' ws: wss:", "frame-ancestors 'none'", "base-uri 'self'",
].join('; ');

export async function createServer(config = loadConfig()) {
  mkdirSync(config.dataDir, { recursive: true });
  const secret = loadSecret(config.secret, join(config.dataDir, 'secret.key'));
  const audit = new AuditLog(join(config.dataDir, 'audit.log'));
  const store = new Store(config.dataDir);
  const hub = new Hub({ store, audit, secret });

  const users = loadUsers(config.dataDir); // { name: hash } or null
  let sharedHash = null;
  if (!users) {
    sharedHash = config.passwordHash || (config.password ? await hashPassword(config.password) : null);
    if (!sharedHash) {
      throw new Error('No password configured. Set BOARD_PASSWORD (shared password) or create users with `node server/cli.mjs add-user <name>`.');
    }
  }
  const dummyHash = await hashPassword('dummy-password-for-timing');
  const ipThrottle = new Throttle({ max: 20 });
  const userThrottle = new Throttle({ max: 5 });

  const clientIp = (req) => {
    if (config.trustProxy) {
      const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (xf) return xf;
    }
    return req.socket.remoteAddress || 'unknown';
  };

  const json = (res, status, body, extra = {}) => {
    const s = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(s), ...extra });
    res.end(s);
  };

  const readBody = (req, limit = 4096) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (d) => { size += d.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

  async function login(req, res) {
    const ip = clientIp(req);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'Bad request' }); }
    if (!body || typeof body !== 'object') return json(res, 400, { error: 'Bad request' });

    const userKey = typeof body.deviceKey === 'string' ? 'dev:' + ip
      : typeof body.name === 'string' ? 'user:' + body.name.trim().toLowerCase() : 'user:-';
    if (ipThrottle.locked('ip:' + ip) || userThrottle.locked(userKey)) {
      audit.log('login_locked', typeof body.name === 'string' ? body.name.slice(0, 24) : null, { ip });
      return json(res, 429, { error: 'Too many failed attempts. Try again later.' }, { 'Retry-After': '900' });
    }
    const failed = (name) => {
      ipThrottle.fail('ip:' + ip); userThrottle.fail(userKey);
      audit.log('login_fail', name ? String(name).slice(0, 24) : null, { ip });
      return json(res, 401, { error: 'Wrong name or password' });
    };
    const ok = (name, kind) => {
      ipThrottle.reset('ip:' + ip); userThrottle.reset(userKey);
      audit.log('login_ok', name, { ip, kind });
      return json(res, 200, { token: signToken(secret, name, kind, config.tokenTtlMs), user: name });
    };

    // Device (Raspberry Pi display) login
    if (typeof body.deviceKey === 'string') {
      for (const [dev, key] of Object.entries(config.deviceKeys)) {
        if (safeEqual(body.deviceKey, key)) return ok(`${dev} (device)`, 'device');
      }
      return failed(null);
    }

    const name = cleanName(body.name);
    if (!name || typeof body.password !== 'string' || body.password.length > 200) return failed(name);

    if (users) {
      const entry = Object.entries(users).find(([n]) => n.toLowerCase() === name.toLowerCase());
      const good = await verifyPassword(body.password, entry ? entry[1] : dummyHash);
      return entry && good ? ok(entry[0], 'user') : failed(name);
    }
    return (await verifyPassword(body.password, sharedHash)) ? ok(name, 'user') : failed(name);
  }

  function serveStatic(req, res, pathname) {
    const base = config.webRoot;
    if (!existsSync(base)) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('Whiteboard server is running, but the web app is not built. Run `npm run build`.');
    }
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
    let file = normalize(join(base, rel));
    if (file !== base && !file.startsWith(base + sep)) { res.writeHead(403); return res.end(); }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      if (extname(rel)) { res.writeHead(404); return res.end('Not found'); }
      file = join(base, 'index.html'); // SPA fallback
    }
    const ext = extname(file);
    const immutable = ext !== '.html';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': CSP,
    });
    res.end(readFileSync(file));
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'POST' && url.pathname === '/api/login') return await login(req, res);
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/api/audit') {
        const t = (req.headers.authorization || '').replace(/^Bearer /, '');
        if (!verifyToken(secret, t)) return json(res, 401, { error: 'Unauthorized' });
        return json(res, 200, { entries: audit.tail(+url.searchParams.get('limit') || 100) });
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      return serveStatic(req, res, url.pathname);
    } catch (e) {
      if (!res.headersSent) json(res, 500, { error: 'Server error' }); else res.end();
      console.error(e);
    }
  });

  server.on('upgrade', (req, socket) => {
    if (new URL(req.url, 'http://x').pathname !== '/ws') { socket.destroy(); return; }
    const ws = upgrade(req, socket, {
      maxPayload: 256 * 1024,
      originOk: (r) => { const o = r.headers.origin; if (!o) return true; try { return new URL(o).host === r.headers.host; } catch { return false; } },
    });
    if (ws) hub.attach(ws, clientIp(req));
  });

  const beat = setInterval(() => hub.heartbeat(), 30_000);
  beat.unref();

  const close = () => new Promise((resolve) => {
    clearInterval(beat);
    hub.closeAll();
    server.close(() => resolve());
    server.closeAllConnections?.();
  });

  return { server, hub, store, audit, close, mode: users ? 'users' : 'shared-password' };
}

// Run directly: node server/index.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  try {
    const app = await createServer(config);
    app.server.listen(config.port, config.host, () => {
      console.log(`Whiteboard listening on http://${config.host}:${config.port}  (auth: ${app.mode}, data: ${config.dataDir})`);
      app.audit.log('server_start', null, { port: config.port });
    });
    const stop = async () => { app.audit.log('server_stop', null); await app.close(); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
