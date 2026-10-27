import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../index.mjs';
import { loadConfig, readEnvFile } from '../config.mjs';
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

  for (const [i, tool] of ['pencil', 'marker', 'highlighter', 'crayon'].entries()) {
    ann.send(stroke(`brush${tool}${i}`, { tool }));
    assert.equal((await bob.wait((m) => m.t === 'begin' && m.id === `brush${tool}${i}`)).tool, tool);
  }
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

test('text boxes and stickers sync, keep their text, and undo like strokes', async () => {
  const ann = await connect('Ann');
  const bob = await connect('Bob');
  ann.send(stroke('textbox01', { tool: 'text', size: 32, p: [100, 120], text: 'Hello\r\nteam\u0007' }));
  const t = await bob.wait((m) => m.t === 'begin' && m.id === 'textbox01');
  assert.equal(t.text, 'Hello\nteam');
  ann.send({ t: 'pts', id: 'textbox01', p: [500, 500] }); // ignored: a text box is one point
  ann.send({ t: 'end', id: 'textbox01' });
  ann.send(stroke('sticker01', { tool: 'sticker', size: 64, p: [300, 300], text: '👍🏽' }));
  ann.send({ t: 'end', id: 'sticker01' });
  await bob.wait((m) => m.t === 'end' && m.id === 'sticker01');
  assert.deepEqual(app.store.strokes.find((s) => s.id === 'textbox01').p, [100, 120]);
  assert.equal(app.store.strokes.find((s) => s.id === 'sticker01').text, '👍🏽');

  const bad = [
    stroke('badtext01', { tool: 'text', p: [1, 1] }), stroke('badtext02', { tool: 'text', p: [1, 1], text: '   ' }),
    stroke('badtext03', { tool: 'text', p: [1, 1], text: 'x'.repeat(501) }), stroke('badtext04', { tool: 'text', text: 'two points' }),
    stroke('badstick1', { tool: 'sticker', p: [1, 1], text: 'way too long for a sticker' }), stroke('badstick2', { tool: 'sticker', p: [1, 1], text: 'a\nb' }),
  ];
  for (const b of bad) ann.send(b);
  await sleep(150);
  assert.equal(bob.msgs.filter((m) => m.t === 'begin' && m.id.startsWith('bad')).length, 0);

  ann.send({ t: 'undo' });
  assert.equal((await bob.wait((m) => m.t === 'remove')).id, 'sticker01');
  ann.close(); bob.close();
});

test('anyone can edit a text box; undo and redo step through edits; empty text deletes it', async () => {
  const ann = await connect('Ann');
  const bob = await connect('Bob');
  ann.send(stroke('editbox01', { tool: 'text', size: 32, p: [100, 120], text: 'first' }));
  ann.send({ t: 'end', id: 'editbox01' });
  ann.send(stroke('editother', { p: [5, 5] })); ann.send({ t: 'end', id: 'editother' }); // drawn after the box
  await bob.wait((m) => m.t === 'end' && m.id === 'editother');

  bob.send({ t: 'edit', id: 'editbox01', text: 'second', color: '#0000ff', size: 40, bg: '#fef08a' });
  const put = (await ann.wait((m) => m.t === 'put' && m.s.text === 'second')).s;
  assert.deepEqual([put.color, put.size, put.bg, put.user, put.p], ['#0000ff', 40, '#fef08a', 'Ann', [100, 120]]);
  assert.equal(app.store.strokes.findIndex((s) => s.id === 'editbox01'), app.store.strokes.length - 2, 'keeps its place');

  bob.send({ t: 'undo' }); // Bob's last action was the edit, not a stroke
  assert.equal((await ann.wait((m) => m.t === 'put' && m.s.text === 'first')).s.bg, undefined);
  bob.send({ t: 'redo' });
  await ann.wait((m) => m.t === 'put' && m.s.text === 'second' && m.s !== put);
  assert.equal(app.store.get('editbox01').bg, '#fef08a');

  bob.send({ t: 'edit', id: 'editbox01', text: '  ' });
  await ann.wait((m) => m.t === 'remove' && m.id === 'editbox01');
  bob.send({ t: 'undo' });
  await ann.wait((m) => m.t === 'put' && m.s.id === 'editbox01' && m.s.text === 'second');

  for (const bad of [{ id: 'editother', text: 'x', color: '#000000', size: 20 }, { id: 'editbox01', text: 'x', color: 'red', size: 20 },
    { id: 'editbox01', text: 'x', color: '#000000', size: 20, bg: 'blue' }, { id: 'nosuchbox1', text: 'x', color: '#000000', size: 20 }]) {
    bob.send({ t: 'edit', ...bad });
  }
  await sleep(150);
  assert.equal(bob.msgs.filter((m) => m.t === 'error').length, 4);
  assert.equal(app.store.get('editbox01').text, 'second');
  ann.close(); bob.close();
});

test('shapes and wireframe pieces: drag out, move, restyle, remove, and undo each step', async () => {
  const ann = await connect('Ann');
  const bob = await connect('Bob');
  ann.send(stroke('shape0001', { tool: 'shape', shape: 'button', fill: '#3b82f6', text: 'Sign in', size: 3, p: [100, 100] }));
  await bob.wait((m) => m.t === 'begin' && m.id === 'shape0001');
  ann.send({ t: 'pts', id: 'shape0001', p: [150, 150] });
  ann.send({ t: 'pts', id: 'shape0001', p: [300, 160] }); // only the latest corner counts
  ann.send({ t: 'end', id: 'shape0001' });
  await bob.wait((m) => m.t === 'end' && m.id === 'shape0001');
  const made = app.store.get('shape0001');
  assert.deepEqual([made.p, made.shape, made.fill, made.text], [[100, 100, 300, 160], 'button', '#3b82f6', 'Sign in']);

  const bad = [
    stroke('badshape1', { tool: 'shape', p: [1, 1] }), stroke('badshape2', { tool: 'shape', shape: 'rm-rf', p: [1, 1] }),
    stroke('badshape3', { tool: 'shape', shape: 'rect', fill: 'red', p: [1, 1] }), stroke('badshape4', { tool: 'shape', shape: 'rect', p: [1, 1, 2, 2] }),
    stroke('badshape5', { tool: 'shape', shape: 'rect', text: 'two\nlines', p: [1, 1] }),
  ];
  for (const b of bad) ann.send(b);
  await sleep(150);
  assert.equal(bob.msgs.filter((m) => m.t === 'begin' && m.id.startsWith('badshape')).length, 0);

  bob.send({ t: 'update', id: 'shape0001', p: [120, 130, 320, 190] }); // anyone can move it
  assert.deepEqual((await ann.wait((m) => m.t === 'put' && m.s.p[0] === 120)).s.p, [120, 130, 320, 190]);
  bob.send({ t: 'update', id: 'shape0001', color: '#ef4444', size: 6, fill: null, text: 'Go' });
  const re = (await ann.wait((m) => m.t === 'put' && m.s.text === 'Go')).s;
  assert.deepEqual([re.color, re.size, re.fill], ['#ef4444', 6, undefined]);

  for (const badUpdate of [{ p: [1, 2] }, { p: [1, 2, 3, 99999] }, { color: 'red' }, { size: 0 }, { bg: '#000000' }, { fill: 'x' }, { text: 'a\nb' }]) {
    bob.send({ t: 'update', id: 'shape0001', ...badUpdate });
  }
  bob.send({ t: 'update', id: 'nosuchshape', p: [1, 1, 2, 2] });
  await sleep(150);
  assert.equal(bob.msgs.filter((m) => m.t === 'error').length, 8);
  assert.equal(app.store.get('shape0001').text, 'Go');

  bob.send({ t: 'undo' }); // undoes the restyle, then the move
  await ann.wait((m) => m.t === 'put' && m.s.text === 'Sign in' && m.s.p[0] === 120);
  bob.send({ t: 'undo' });
  await ann.wait((m) => m.t === 'put' && m.s.p[0] === 100);

  bob.send({ t: 'drop', id: 'shape0001' });
  await ann.wait((m) => m.t === 'remove' && m.id === 'shape0001');
  bob.send({ t: 'undo' });
  await ann.wait((m) => m.t === 'put' && m.s.id === 'shape0001');
  ann.send(stroke('penstroke1')); ann.send({ t: 'end', id: 'penstroke1' });
  await bob.wait((m) => m.t === 'end' && m.id === 'penstroke1');
  bob.send({ t: 'drop', id: 'penstroke1' }); // drawings are removed by undo or the eraser, not dropped
  await bob.wait((m) => m.t === 'error' && /remove/.test(m.msg));
  assert.ok(app.store.has('penstroke1'));
  ann.close(); bob.close();
});

test('paste, group, move many at once, and delete many: each is one undo step', async () => {
  const ann = await connect('Ann');
  const bob = await connect('Bob');
  const base = { color: '#000000', size: 3, cap: 'round', dash: [], seed: 0 };
  const items = [
    { ...base, id: 'multi0001', tool: 'shape', shape: 'rect', p: [10, 10, 60, 60], group: 'groupone01' },
    { ...base, id: 'multi0002', tool: 'text', size: 30, p: [100, 100], text: 'Hi', group: 'groupone01' },
    { ...base, id: 'multi0003', tool: 'sticker', size: 60, p: [200, 200], text: '🎉' },
  ];
  ann.send({ t: 'paste', items });
  const pasted = (await bob.wait((m) => m.t === 'puts' && m.items.length === 3)).items;
  assert.deepEqual(pasted.map((s) => [s.id, s.user, s.group]), [['multi0001', 'Ann', 'groupone01'], ['multi0002', 'Ann', 'groupone01'], ['multi0003', 'Ann', undefined]]);

  const before = app.store.strokes.length;
  const badPastes = [
    [{ ...items[0], id: 'multi0009', p: [1, 1] }], // a shape needs both corners
    [{ ...items[0], id: 'multi0001' }], // id already on the board
    [{ ...items[0], id: 'multi0010' }, { ...items[1], id: 'multi0010' }], // same id twice
    [{ ...base, id: 'multi0011', tool: 'pen', p: [1, 1] }], // drawings are not pasted
    [{ ...items[0], id: 'multi0012', group: 'no' }], // bad group id
    Array.from({ length: 201 }, (_, i) => ({ ...items[2], id: `many${String(i).padStart(5, '0')}` })),
    [],
  ];
  for (const b of badPastes) ann.send({ t: 'paste', items: b });
  await sleep(200);
  assert.equal(app.store.strokes.length, before, 'bad pastes add nothing');
  assert.equal(ann.msgs.filter((m) => m.t === 'error').length, badPastes.length);

  // Move two items in one message: Bob sees one 'puts', and one undo of Bob's puts both back.
  bob.send({ t: 'update', items: [{ id: 'multi0001', p: [20, 20, 70, 70] }, { id: 'multi0003', p: [210, 210] }] });
  const moved = (await ann.wait((m) => m.t === 'puts' && m.items[0].p[0] === 20)).items;
  assert.deepEqual(moved.map((s) => s.p), [[20, 20, 70, 70], [210, 210]]);
  bob.send({ t: 'update', items: [{ id: 'multi0001', group: null }, { id: 'multi0002', group: null }] }); // ungroup
  await ann.wait((m) => m.t === 'puts' && m.items.every((s) => s.group === undefined));
  bob.send({ t: 'update', items: [{ id: 'multi0001', p: [30, 30, 80, 80] }, { id: 'nosuchitem', p: [1, 1] }] }); // all or nothing
  await bob.wait((m) => m.t === 'error' && /change/.test(m.msg));
  assert.deepEqual(app.store.get('multi0001').p, [20, 20, 70, 70]);
  bob.send({ t: 'update', items: [{ id: 'multi0001', group: 'newgroup01' }, { id: 'multi0002', group: 'newgroup01' }] }); // regroup
  await ann.wait((m) => m.t === 'puts' && m.items.every((s) => s.group === 'newgroup01'));

  bob.send({ t: 'undo' }); // undoes the regroup
  await ann.wait((m) => m.t === 'puts' && m.items.every((s) => s.group === undefined));
  bob.send({ t: 'undo' }); // undoes the ungroup
  await ann.wait((m) => m.t === 'puts' && m.items.every((s) => s.group === 'groupone01'));
  bob.send({ t: 'undo' }); // undoes the move of two items
  await ann.wait((m) => m.t === 'puts' && m.items[0].p[0] === 10);

  bob.send({ t: 'drop', ids: ['multi0001', 'multi0002'] });
  assert.deepEqual((await ann.wait((m) => m.t === 'removes')).ids, ['multi0001', 'multi0002']);
  bob.send({ t: 'undo' });
  await ann.wait((m) => m.t === 'puts' && m.items.length === 2 && m.items[0].id === 'multi0001');
  bob.send({ t: 'drop', ids: ['multi0001', 'penstroke9'] });
  await bob.wait((m) => m.t === 'error' && /remove/.test(m.msg));
  assert.ok(app.store.has('multi0001'));

  ann.send({ t: 'undo' }); // undoes the whole paste, in one step
  assert.equal((await bob.wait((m) => m.t === 'removes' && m.ids.length === 3)).ids.length, 3);
  assert.ok(!app.store.has('multi0001') && !app.store.has('multi0003'));
  ann.send({ t: 'redo' });
  await bob.wait((m) => m.t === 'puts' && m.items.length === 3);
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

test('redo restores your own undone strokes, and drawing again ends the redo chain', async () => {
  const ann = await connect('Ann');
  const bob = await connect('Bob');
  ann.send(stroke('annredo01')); ann.send({ t: 'end', id: 'annredo01' });
  ann.send(stroke('annredo02')); ann.send({ t: 'end', id: 'annredo02' });
  await bob.wait((m) => m.t === 'end' && m.id === 'annredo02');
  ann.send({ t: 'undo' }); ann.send({ t: 'undo' });
  await bob.wait((m) => m.t === 'remove' && m.id === 'annredo01');
  bob.send({ t: 'redo' }); // Bob has nothing to redo; Ann's strokes stay gone
  await sleep(100);
  assert.ok(!app.store.has('annredo01') && !app.store.has('annredo02'));

  ann.send({ t: 'redo' });
  const b = (await bob.wait((m) => m.t === 'put' && m.s.id === 'annredo01')).s;
  assert.equal(b.user, 'Ann');
  assert.ok(b.p.length > 0, 'redo sends the whole stroke');
  await ann.wait((m) => m.t === 'put' && m.s.id === 'annredo01');
  assert.ok(app.store.has('annredo01'));

  ann.send(stroke('annredo03')); ann.send({ t: 'end', id: 'annredo03' });
  await bob.wait((m) => m.t === 'end' && m.id === 'annredo03');
  ann.send({ t: 'redo' });
  await sleep(100);
  assert.ok(!app.store.has('annredo02'), 'a new stroke clears what could be redone');
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

test('rename: a signed-in person can change their name; devices and bad names cannot', async () => {
  const post = async (token, name) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/rename`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify({ name }) });
    return { status: r.status, body: await r.json() };
  };
  const { body } = await login({ name: 'Ann', password: 'correct horse' });
  assert.equal((await post(null, 'Annie')).status, 401);
  assert.equal((await post(body.token, '<script>')).status, 400);
  const ok = await post(body.token, 'Annie');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user, 'Annie');
  assert.equal(verifyToken(readFileSync(join(dir, 'data', 'secret.key'), 'utf8').trim(), ok.body.token).user, 'Annie');
  const c = await connect('Annie', { token: ok.body.token });
  assert.ok(c.hello.users.includes('Annie'));
  c.close();
  const dev = await login({ deviceKey: '0123456789abcdef0123' });
  assert.equal((await post(dev.body.token, 'Bob')).status, 403);
  assert.ok(app.audit.tail(20).some((e) => e.ev === 'rename' && e.user === 'Annie' && e.from === 'Ann'));
});

test('renaming keeps you the same person: no reconnect, and undo/redo still reach your earlier strokes', async () => {
  const secret = readFileSync(join(dir, 'data', 'secret.key'), 'utf8').trim();
  const { body } = await login({ name: 'Cara', password: 'correct horse' });
  const cara = await connect('Cara', { token: body.token });
  const bob = await connect('Bob');
  cara.send(stroke('carastroke1')); cara.send({ t: 'end', id: 'carastroke1' });
  await bob.wait((m) => m.t === 'end' && m.id === 'carastroke1');

  const r = await fetch(`http://127.0.0.1:${port}/api/rename`, { method: 'POST', headers: { Authorization: `Bearer ${body.token}` }, body: JSON.stringify({ name: 'Carla' }) });
  const renamed = await r.json();
  assert.equal(verifyToken(secret, renamed.token).id, verifyToken(secret, body.token).id, 'same identity');
  cara.send({ t: 'rename', token: renamed.token });
  const u = await bob.wait((m) => m.t === 'users' && m.users.includes('Carla'));
  assert.ok(!u.users.includes('Cara'));
  assert.equal(cara.ws.readyState, WebSocket.OPEN, 'still the same connection');

  cara.send({ t: 'undo' });
  assert.equal((await bob.wait((m) => m.t === 'remove' && m.id === 'carastroke1')).by, 'Carla');
  cara.send({ t: 'redo' });
  await bob.wait((m) => m.t === 'put' && m.s.id === 'carastroke1');

  // A token for someone else's sign-in can't take over this connection.
  const other = (await login({ name: 'Mallory', password: 'correct horse' })).body.token;
  cara.send({ t: 'rename', token: other });
  await cara.wait((m) => m.t === 'error' && /name/.test(m.msg));
  cara.close(); bob.close();
});

test('env file: KEY=value lines, comments and quotes; real env wins in loadConfig', () => {
  const f = join(dir, 'test.env');
  writeFileSync(f, '# comment\nBOARD_PASSWORD="pa ss # word"\r\nPORT=9090   # inline comment\nexport WHITEBOARD_URL=http://pi:8080\nnot a line\n');
  assert.deepEqual(readEnvFile(f), { BOARD_PASSWORD: 'pa ss # word', PORT: '9090', WHITEBOARD_URL: 'http://pi:8080' });
  assert.deepEqual(readEnvFile(join(dir, 'missing.env')), {});
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
