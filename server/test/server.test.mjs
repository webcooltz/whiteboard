import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../index.mjs';
import { loadConfig } from '../config.mjs';
import { hashPassword, verifyPassword, signToken, verifyToken } from '../auth.mjs';

let dir, app, port, web;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(extraEnv = {}) {
  const config = loadConfig({
    DATA_DIR: join(dir, 'data'), WEB_ROOT: web, PORT: '0', HOST: '127.0.0.1', BOARD_PASSWORD: 'correct horse',
    BOARD_DEVICE_KEYS: 'pi-kitchen=0123456789abcdef0123', ...extraEnv,
  });
  app = await createServer(config);
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  port = app.server.address().port;
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wb-'));
  web = join(dir, 'web');
  mkdirSync(web);
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>board</title>');
  writeFileSync(join(dir, 'outside-secret.txt'), 'TOP-SECRET');
  await start();
});
after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

async function login(body) {
  const r = await fetch(`http://127.0.0.1:${port}/api/login`, { method: 'POST', body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

// A tiny test client that records every server message.
async function connect(name, { token } = {}) {
  token ??= (await login({ name, password: 'correct horse' })).body.token;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const msgs = [];
  ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const c = {
    ws, msgs,
    send: (m) => ws.send(JSON.stringify(m)),
    wait: async (pred, ms = 2000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { const f = msgs.find(pred); if (f) return f; await sleep(10); }
      throw new Error('timeout waiting for message; got ' + JSON.stringify(msgs.map((m) => m.t)));
    },
    close: () => ws.close(),
  };
  c.send({ t: 'auth', token });
  c.hello = await c.wait((m) => m.t === 'hello');
  return c;
}

const stroke = (id, extra = {}) => ({ t: 'begin', id, tool: 'pen', color: '#ff0000', size: 5, cap: 'round', dash: [], seed: 1, p: [10, 10, 20, 20], ...extra });

test('password hashing and tokens', async () => {
  const h = await hashPassword('secret123');
  assert.ok(await verifyPassword('secret123', h));
  assert.ok(!(await verifyPassword('wrong', h)));
  const t = signToken('k'.repeat(32), 'ann', 'user', 1000);
  assert.equal(verifyToken('k'.repeat(32), t).user, 'ann');
  assert.equal(verifyToken('x'.repeat(32), t), null, 'wrong secret');
  assert.equal(verifyToken('k'.repeat(32), t, Date.now() + 5000), null, 'expired');
  assert.equal(verifyToken('k'.repeat(32), t.slice(0, -2) + 'xx'), null, 'tampered');
});

test('login: wrong password rejected, device key works, bad names rejected', async () => {
  assert.equal((await login({ name: 'ann', password: 'nope' })).status, 401);
  assert.equal((await login({ name: '<script>', password: 'correct horse' })).status, 401);
  const d = await login({ deviceKey: '0123456789abcdef0123' });
  assert.equal(d.status, 200);
  assert.equal(d.body.user, 'pi-kitchen (device)');
  assert.equal((await login({ deviceKey: 'wrong' })).status, 401);
});

test('login lockout after repeated failures', async () => {
  for (let i = 0; i < 5; i++) await login({ name: 'mallory', password: 'bad' + i });
  assert.equal((await login({ name: 'mallory', password: 'correct horse' })).status, 429, 'locked even with right password');
  assert.equal((await login({ name: 'ann', password: 'correct horse' })).status, 200, 'other users unaffected');
});

test('websocket requires a valid token', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((r) => (ws.onopen = r));
  const closed = new Promise((r) => (ws.onclose = (e) => r(e.code)));
  ws.send(JSON.stringify({ t: 'begin', id: 'abcdef', tool: 'pen' })); // no auth first
  assert.equal(await closed, 1008);

  const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((r) => (ws2.onopen = r));
  const closed2 = new Promise((r) => (ws2.onclose = (e) => r(e.code)));
  ws2.send(JSON.stringify({ t: 'auth', token: 'forged.token' }));
  assert.equal(await closed2, 1008);
});

test('cross-origin websocket upgrade is refused', async () => {
  const code = await new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => {
      s.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: http://evil.example\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    s.once('data', (d) => { resolve(d.toString().split(' ')[1]); s.destroy(); });
  });
  assert.equal(code, '403');
});

test('unmasked client frame is a protocol error', async () => {
  const code = await new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => {
      s.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    let upgraded = false;
    s.on('data', (d) => {
      if (!upgraded) { upgraded = true; s.write(Buffer.from([0x81, 0x02, 0x68, 0x69])); return; } // unmasked "hi"
      if (d[0] === 0x88) resolve(d.readUInt16BE(2));
    });
  });
  assert.equal(code, 1002);
});

test('strokes sync live between users, and late joiners get the board', async () => {
  const ann = await connect('Ann');
  const bob = await connect('Bob');
  ann.send(stroke('strokeA01'));
  const begin = await bob.wait((m) => m.t === 'begin' && m.id === 'strokeA01');
  assert.equal(begin.user, 'Ann');
  ann.send({ t: 'pts', id: 'strokeA01', p: [30, 30, 40, 45] });
  const pts = await bob.wait((m) => m.t === 'pts');
  assert.deepEqual(pts.p, [30, 30, 40, 45]);
  ann.send({ t: 'end', id: 'strokeA01' });
  await bob.wait((m) => m.t === 'end');

  const carol = await connect('Carol');
  const s = carol.hello.strokes.find((x) => x.id === 'strokeA01');
  assert.ok(s, 'late joiner sees stroke');
  assert.deepEqual(s.p, [10, 10, 20, 20, 30, 30, 40, 45]);
  assert.deepEqual(carol.hello.users.sort(), ['Ann', 'Bob', 'Carol']);
  ann.close(); bob.close(); carol.close();
});

test('invalid strokes are rejected and do not reach other users', async () => {
  const ann = await connect('Ann');
  const bob = await connect('Bob');
  const bad = [
    stroke('badbad01', { color: 'red' }), stroke('badbad02', { tool: 'rm -rf' }), stroke('badbad03', { size: 99999 }),
    stroke('badbad04', { p: [1, 2, 3] }), stroke('badbad05', { p: [1e9, 2] }), stroke('x', {}), stroke('badbad06', { dash: [1, 2, 3, 4, 5] }),
  ];
  for (const b of bad) ann.send(b);
  ann.send({ t: 'end', id: 'goodgood1' });
  await sleep(150);
  assert.equal(bob.msgs.filter((m) => m.t === 'begin').length, 0);
  assert.equal(ann.msgs.filter((m) => m.t === 'error').length, bad.length);
  ann.close(); bob.close();
});

test('undo removes only your own last stroke', async () => {
  const ann = await connect('Ann');
  const bob = await connect('Bob');
  ann.send(stroke('annstroke1')); ann.send({ t: 'end', id: 'annstroke1' });
  bob.send(stroke('bobstroke1')); bob.send({ t: 'end', id: 'bobstroke1' });
  await ann.wait((m) => m.t === 'end' && m.id === 'bobstroke1');
  await bob.wait((m) => m.t === 'end' && m.id === 'annstroke1');
  ann.send({ t: 'undo' });
  const rm = await bob.wait((m) => m.t === 'remove');
  assert.equal(rm.id, 'annstroke1');
  assert.equal(rm.by, 'Ann');
  assert.ok(app.store.has('bobstroke1'));
  ann.close(); bob.close();
});

test('save, erase (with automatic backup), load, delete — and all of it is audited', async () => {
  const ann = await connect('Ann');
  ann.send({ t: 'save', name: 'My Board 1' });
  const b = await ann.wait((m) => m.t === 'boards' && m.boards.some((x) => x.name === 'My Board 1'));
  const saved = b.boards.find((x) => x.name === 'My Board 1');
  assert.equal(saved.savedBy, 'Ann');
  const n = saved.count;
  assert.ok(n > 0);

  ann.msgs.length = 0;
  ann.send({ t: 'clear' });
  const reset = await ann.wait((m) => m.t === 'reset');
  assert.equal(reset.strokes.length, 0);
  const boards = (await ann.wait((m) => m.t === 'boards')).boards;
  assert.ok(boards.some((x) => x.name.startsWith('auto before clear')), 'auto backup was made');

  ann.msgs.length = 0;
  ann.send({ t: 'load', name: 'My Board 1' });
  const loaded = await ann.wait((m) => m.t === 'reset');
  assert.equal(loaded.strokes.length, n);

  ann.send({ t: 'save', name: '../../etc/passwd' });
  await ann.wait((m) => m.t === 'error');

  ann.send({ t: 'del', name: 'My Board 1' });
  await ann.wait((m) => m.t === 'boards' && !m.boards.some((x) => x.name === 'My Board 1'));

  ann.send({ t: 'audit', limit: 200 });
  const { entries } = await ann.wait((m) => m.t === 'audit');
  const evs = entries.filter((e) => e.user === 'Ann').map((e) => e.ev);
  for (const ev of ['connect', 'stroke', 'undo', 'save', 'clear', 'load', 'delete']) assert.ok(evs.includes(ev), `audit has ${ev}`);
  assert.ok(entries.some((e) => e.ev === 'login_fail'), 'failed logins are logged');
  assert.ok(entries.some((e) => e.ev === 'login_locked'), 'lockouts are logged');
  ann.close();
});

test('audit endpoint needs a token and never contains passwords', async () => {
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/audit`)).status, 401);
  const { body } = await login({ name: 'Ann', password: 'correct horse' });
  const r = await fetch(`http://127.0.0.1:${port}/api/audit?limit=50`, { headers: { Authorization: `Bearer ${body.token}` } });
  assert.equal(r.status, 200);
  const raw = readFileSync(join(dir, 'data', 'audit.log'), 'utf8');
  assert.ok(!raw.includes('correct horse'));
});

test('the board survives a server restart', async () => {
  const ann = await connect('Ann');
  ann.send(stroke('persist001')); ann.send({ t: 'end', id: 'persist001' });
  await sleep(100);
  ann.close();
  await app.close();
  await start();
  const bob = await connect('Bob');
  assert.ok(bob.hello.strokes.some((s) => s.id === 'persist001'));
  bob.close();
});

test('a half-finished stroke is kept when its author disconnects', async () => {
  const ann = await connect('Ann');
  ann.send(stroke('halfhalf01'));
  await sleep(50);
  ann.close();
  await sleep(100);
  assert.ok(app.store.has('halfhalf01'));
});

test('static: serves the app, falls back to index.html for routes, refuses path traversal', async () => {
  const home = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /board/);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/some/route`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/missing.js`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/nope`)).status, 404);
  for (const path of ['/../outside-secret.txt', '/%2e%2e/outside-secret.txt', '/..%2foutside-secret.txt', '/web/../../outside-secret.txt']) {
    const body = await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1');
      let out = '';
      s.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      s.on('data', (d) => (out += d)); s.on('close', () => resolve(out));
    });
    assert.ok(!body.includes('TOP-SECRET'), `leaked via ${path}`);
  }
});

test('server refuses to start with no password configured', async () => {
  const d2 = mkdtempSync(join(tmpdir(), 'wb2-'));
  await assert.rejects(createServer(loadConfig({ DATA_DIR: d2 })), /No password configured/);
  rmSync(d2, { recursive: true, force: true });
});
