// The live board: one shared canvas, many connected clients.
import { verifyToken } from './auth.mjs';
import { W, H, MAX_POINTS, cleanBegin, cleanPoints, cleanSnapshotName } from './validate.mjs';

const MAX_STROKES = 100_000;
const MAX_OPEN_PER_CLIENT = 4;
const MAX_REDO = 100;

const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');

export class Hub {
  constructor({ store, audit, secret, maxClients = 20 }) {
    this.store = store;
    this.audit = audit;
    this.secret = secret;
    this.maxClients = maxClients;
    this.clients = new Set();
    this.redo = new Map(); // identity -> strokes they undid, most recent last
  }

  attach(ws, ip) {
    if (this.clients.size >= this.maxClients) {
      ws.send(JSON.stringify({ t: 'error', msg: 'Too many connections' }));
      return ws.close(1013, 'busy');
    }
    const c = { ws, ip, user: null, uid: null, kind: null, open: new Map(), tokens: 400, last: Date.now() };
    this.clients.add(c);
    const authTimer = setTimeout(() => { if (!c.user) ws.close(1008, 'auth timeout'); }, 10_000);
    ws.on('message', (text) => this.#onMessage(c, text));
    ws.on('close', () => {
      clearTimeout(authTimer);
      this.#onClose(c);
    });
  }

  // ---- helpers ----
  #send(c, msg) { if (c.ws.open) c.ws.send(JSON.stringify(msg)); }
  #broadcast(msg, except = null) {
    const text = JSON.stringify(msg);
    for (const c of this.clients) if (c.user && c !== except && c.ws.open) c.ws.send(text);
  }
  #users() { return [...new Set([...this.clients].filter((c) => c.user).map((c) => c.user))]; }
  #allStrokes() {
    const open = [];
    for (const c of this.clients) for (const s of c.open.values()) open.push(s);
    return this.store.strokes.concat(open);
  }
  #resetAll(by, strokes) {
    for (const c of this.clients) c.open.clear();
    this.redo.clear();
    this.#broadcast({ t: 'reset', by, strokes });
  }
  #backup(user, why) {
    if (!this.store.strokes.length) return null;
    const name = `auto ${why} ${stamp()}`;
    this.store.saveBoard(name, user);
    this.store.pruneAuto();
    return name;
  }

  // ---- connection lifecycle ----
  #onClose(c) {
    for (const s of c.open.values()) this.#commit(c, s); // keep what they had drawn
    c.open.clear();
    this.clients.delete(c);
    if (c.user) {
      this.audit.log('disconnect', c.user, { ip: c.ip });
      this.#broadcast({ t: 'users', users: this.#users() });
    }
  }

  #commit(c, s) {
    if (!this.store.has(s.id) && this.store.strokes.length < MAX_STROKES) {
      this.store.add(s);
      this.redo.delete(c.uid); // drawing something new ends the redo chain
      this.audit.log('stroke', c.user, { id: s.id, tool: s.tool, points: s.p.length / 2 });
    }
    this.#broadcast({ t: 'end', id: s.id }, c);
  }

  #onMessage(c, text) {
    const now = Date.now();
    c.tokens = Math.min(400, c.tokens + ((now - c.last) / 1000) * 200);
    c.last = now;
    if (--c.tokens < 0) return c.ws.close(1008, 'rate limit');
    let m;
    try { m = JSON.parse(text); } catch { return c.ws.close(1003, 'bad json'); }
    if (!m || typeof m.t !== 'string') return;

    if (!c.user) {
      if (m.t !== 'auth') return c.ws.close(1008, 'auth required');
      const v = verifyToken(this.secret, m.token);
      if (!v) { this.audit.log('ws_auth_fail', null, { ip: c.ip }); this.#send(c, { t: 'auth_fail' }); return c.ws.close(1008, 'bad token'); }
      c.user = v.user;
      c.uid = v.id ?? `name:${v.user}`; // old tokens have no id: fall back to the name, as before
      c.kind = v.kind;
      this.audit.log('connect', c.user, { ip: c.ip, kind: c.kind });
      this.#send(c, {
        t: 'hello', user: c.user, w: W, h: H,
        strokes: this.#allStrokes(), users: this.#users(), boards: this.store.listBoards(),
      });
      this.#broadcast({ t: 'users', users: this.#users() }, c);
      return;
    }

    switch (m.t) {
      case 'begin': return this.#begin(c, m);
      case 'pts': return this.#pts(c, m);
      case 'end': return this.#end(c, m);
      case 'undo': return this.#undo(c);
      case 'redo': return this.#redo(c);
      case 'rename': return this.#rename(c, m);
      case 'clear': return this.#clear(c);
      case 'save': return this.#save(c, m);
      case 'load': return this.#load(c, m);
      case 'del': return this.#del(c, m);
      case 'list': return this.#send(c, { t: 'boards', boards: this.store.listBoards() });
      case 'audit': return this.#send(c, { t: 'audit', entries: this.audit.tail(+m.limit || 100) });
      case 'cur': {
        if (typeof m.x === 'number' && typeof m.y === 'number' && Number.isFinite(m.x + m.y)) {
          this.#broadcast({ t: 'cur', user: c.user, x: Math.round(m.x), y: Math.round(m.y) }, c);
        }
        return;
      }
      default: return;
    }
  }

  // ---- drawing ----
  #begin(c, m) {
    const h = cleanBegin(m);
    if (!h) return this.#send(c, { t: 'error', msg: 'Invalid stroke' });
    if (c.open.size >= MAX_OPEN_PER_CLIENT || this.store.has(h.id) || [...this.clients].some((o) => o.open.has(h.id))) return;
    if (this.store.strokes.length >= MAX_STROKES) return this.#send(c, { t: 'error', msg: 'Board is full — erase or save it first' });
    const s = { ...h, user: c.user, uid: c.uid };
    c.open.set(s.id, s);
    this.#broadcast({ t: 'begin', ...s }, c);
  }

  #pts(c, m) {
    const s = c.open.get(m.id);
    if (!s || s.text !== undefined) return; // text and stickers have no points to add
    const p = cleanPoints(m.p);
    if (!p) return;
    if (s.tool === 'line') {
      s.p = [s.p[0], s.p[1], p[p.length - 2], p[p.length - 1]]; // a line is just first + latest point
      this.#broadcast({ t: 'pts', id: s.id, p: [p[p.length - 2], p[p.length - 1]] }, c);
      return;
    }
    if (s.p.length + p.length > MAX_POINTS) return;
    for (const v of p) s.p.push(v);
    this.#broadcast({ t: 'pts', id: s.id, p }, c);
  }

  #end(c, m) {
    const s = c.open.get(m.id);
    if (!s) return;
    c.open.delete(s.id);
    this.#commit(c, s);
  }

  #undo(c) {
    const s = this.store.lastBy(c.uid, c.user);
    if (!s) return;
    this.store.remove(s.id);
    const stack = this.redo.get(c.uid) ?? [];
    stack.push(s);
    if (stack.length > MAX_REDO) stack.shift();
    this.redo.set(c.uid, stack);
    this.audit.log('undo', c.user, { id: s.id });
    this.#broadcast({ t: 'remove', id: s.id, by: c.user });
  }

  #redo(c) {
    const s = this.redo.get(c.uid)?.pop();
    if (!s || this.store.has(s.id) || this.store.strokes.length >= MAX_STROKES) return;
    this.store.add(s);
    this.audit.log('redo', c.user, { id: s.id });
    this.#broadcast({ t: 'begin', ...s });
    this.#broadcast({ t: 'end', id: s.id });
  }

  // The client got a new token from /api/rename (which audits it); switch names without reconnecting.
  #rename(c, m) {
    const v = verifyToken(this.secret, m.token);
    if (!v || !v.id || v.id !== c.uid || v.kind !== c.kind) return this.#send(c, { t: 'error', msg: 'Could not change your name' });
    for (const o of this.clients) if (o.uid === c.uid) o.user = v.user; // every tab of this sign-in
    this.#broadcast({ t: 'users', users: this.#users() });
  }

  // ---- board management ----
  #clear(c) {
    const count = this.store.strokes.length;
    const backup = this.#backup(c.user, 'before clear');
    this.store.set([]);
    this.audit.log('clear', c.user, { removed: count, backup });
    this.#resetAll(c.user, []);
    this.#broadcast({ t: 'boards', boards: this.store.listBoards() });
  }

  #save(c, m) {
    const name = cleanSnapshotName(m.name);
    if (!name) return this.#send(c, { t: 'error', msg: 'Board names can use letters, numbers, spaces, . _ - (max 40)' });
    if (name.toLowerCase().startsWith('auto ')) return this.#send(c, { t: 'error', msg: 'Names starting with "auto" are reserved' });
    const existed = !!this.store.loadBoard(name);
    const info = this.store.saveBoard(name, c.user);
    if (!info) return this.#send(c, { t: 'error', msg: 'Invalid name' });
    this.audit.log('save', c.user, { name, strokes: info.count, overwrote: existed });
    this.#broadcast({ t: 'boards', boards: this.store.listBoards() });
  }

  #load(c, m) {
    const name = cleanSnapshotName(m.name);
    const rec = name && this.store.loadBoard(name);
    if (!rec) return this.#send(c, { t: 'error', msg: 'Saved board not found' });
    const backup = this.#backup(c.user, 'before load');
    this.store.set(rec.strokes);
    this.audit.log('load', c.user, { name, strokes: rec.strokes.length, backup });
    this.#resetAll(c.user, rec.strokes);
    this.#broadcast({ t: 'boards', boards: this.store.listBoards() });
  }

  #del(c, m) {
    const name = cleanSnapshotName(m.name);
    if (!name || !this.store.deleteBoard(name)) return this.#send(c, { t: 'error', msg: 'Saved board not found' });
    this.audit.log('delete', c.user, { name });
    this.#broadcast({ t: 'boards', boards: this.store.listBoards() });
  }

  heartbeat() {
    for (const c of this.clients) {
      if (!c.ws.alive) c.ws.terminate();
      else c.ws.ping();
    }
  }

  closeAll() {
    for (const c of this.clients) c.ws.close(1001, 'server shutting down');
  }
}
