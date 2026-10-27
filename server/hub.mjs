// The live board: one shared canvas, many connected clients.
import { verifyToken } from './auth.mjs';
import { W, H, MAX_BATCH, MAX_POINTS, MOVABLE, applyUpdate, cleanBegin, cleanEdit, cleanPoints, cleanSnapshotName } from './validate.mjs';

const MAX_STROKES = 100_000;
const MAX_OPEN_PER_CLIENT = 4;
const MAX_HISTORY = 100;

const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');

export class Hub {
  constructor({ store, audit, secret, maxClients = 20 }) {
    this.store = store;
    this.audit = audit;
    this.secret = secret;
    this.maxClients = maxClients;
    this.clients = new Set();
    // Per identity, most recent last: what they did (undo walks back through it) and what they undid (redo).
    // Actions: { k: 'add', s } | { k: 'edit', before, after } | { k: 'del', before } | { k: 'many', list: [action, ...] }
    this.history = new Map();
    this.redo = new Map();
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
    this.history.clear();
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
      this.#did(c, { k: 'add', s });
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
      case 'edit': return this.#edit(c, m);
      case 'update': return this.#update(c, m);
      case 'drop': return this.#drop(c, m);
      case 'paste': return this.#paste(c, m);
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
    if (!s || s.tool === 'text' || s.tool === 'sticker') return; // placed at one point: nothing to add
    const p = cleanPoints(m.p);
    if (!p) return;
    if (s.tool === 'line' || s.tool === 'shape') {
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

  // Record something this person did. Doing something new ends their redo chain.
  #did(c, action) {
    const stack = this.history.get(c.uid) ?? [];
    stack.push(action);
    if (stack.length > MAX_HISTORY) stack.shift();
    this.history.set(c.uid, stack);
    this.redo.delete(c.uid);
  }

  // Undo (back = true) or redo an action, collecting what changed in `out` (sent by #flush). Returns the id of a
  // stroke it changed, or null if nothing could be applied because the board has moved on (someone else changed
  // or removed it since), in which case the action is skipped.
  #apply(c, a, back, out) {
    const st = this.store;
    if (a.k === 'many') {
      let first = null;
      for (const x of back ? [...a.list].reverse() : a.list) {
        const id = this.#apply(c, x, back, out);
        first ??= id;
      }
      return first;
    }
    if (a.k === 'add' || a.k === 'del') {
      const s = a.k === 'add' ? a.s : a.before;
      if ((a.k === 'add') === back) {
        if (!st.has(s.id)) return null;
        st.remove(s.id);
        out.removes.push(s.id);
      } else {
        if (st.has(s.id) || st.strokes.length >= MAX_STROKES) return null;
        st.add(s);
        out.puts.push(s);
      }
      return s.id;
    }
    const from = back ? a.after : a.before, to = back ? a.before : a.after;
    if (st.get(from.id) !== from) return null;
    st.replace(to);
    out.puts.push(to);
    return to.id;
  }

  // Tell everyone what changed: one message however many items were involved.
  #flush(c, out) {
    if (out.removes.length === 1) this.#broadcast({ t: 'remove', id: out.removes[0], by: c.user });
    else if (out.removes.length) this.#broadcast({ t: 'removes', ids: out.removes, by: c.user });
    if (out.puts.length === 1) this.#broadcast({ t: 'put', s: out.puts[0] });
    else if (out.puts.length) this.#broadcast({ t: 'puts', items: out.puts });
  }

  #undo(c) {
    const stack = this.history.get(c.uid) ?? [];
    const out = { puts: [], removes: [] };
    let a, id = null;
    while (!id && (a = stack.pop())) id = this.#apply(c, a, true, out);
    if (!id) {
      // Nothing recorded (e.g. after a server restart): fall back to their newest stroke on the board.
      const s = this.store.lastBy(c.uid, c.user);
      if (!s) return;
      a = { k: 'add', s };
      id = this.#apply(c, a, true, out);
    }
    this.#flush(c, out);
    const redo = this.redo.get(c.uid) ?? [];
    redo.push(a);
    if (redo.length > MAX_HISTORY) redo.shift();
    this.redo.set(c.uid, redo);
    this.audit.log('undo', c.user, { id });
  }

  #redo(c) {
    const stack = this.redo.get(c.uid) ?? [];
    const out = { puts: [], removes: [] };
    let a, id = null;
    while (!id && (a = stack.pop())) id = this.#apply(c, a, false, out);
    if (!id) return;
    this.#flush(c, out);
    const hist = this.history.get(c.uid) ?? [];
    hist.push(a);
    this.history.set(c.uid, hist);
    this.audit.log('redo', c.user, { id });
  }

  // Move, resize, restyle or (un)group text boxes, stickers and shapes (see applyUpdate): one item as { id, ... },
  // or several at once as { items: [{ id, ... }, ...] }. All or nothing, and one undo step.
  #update(c, m) {
    const list = Array.isArray(m.items) ? m.items : [m];
    const bad = () => this.#send(c, { t: 'error', msg: 'Could not change that item' });
    if (!list.length || list.length > MAX_BATCH) return bad();
    const changes = [], seen = new Set();
    for (const u of list) {
      const before = typeof u?.id === 'string' && !seen.has(u.id) ? this.store.get(u.id) : null;
      const after = applyUpdate(before, u);
      if (!after) return bad();
      seen.add(before.id);
      if (JSON.stringify(after) !== JSON.stringify(before)) changes.push({ k: 'edit', before, after });
    }
    if (!changes.length) return;
    const out = { puts: [], removes: [] };
    for (const x of changes) { this.store.replace(x.after); out.puts.push(x.after); }
    this.#did(c, changes.length === 1 ? changes[0] : { k: 'many', list: changes });
    this.audit.log('update', c.user, changes.length === 1 ? { id: changes[0].before.id } : { count: changes.length });
    this.#flush(c, out);
  }

  // Remove text boxes, stickers and shapes (not drawings): { id } or { ids: [...] }. One undo step.
  #drop(c, m) {
    const ids = Array.isArray(m.ids) ? m.ids : [m.id];
    const found = ids.length && ids.length <= MAX_BATCH ? ids.map((id) => (typeof id === 'string' ? this.store.get(id) : null)) : [];
    if (!found.length || found.some((s) => !s || !MOVABLE.has(s.tool)) || new Set(ids).size !== ids.length) {
      return this.#send(c, { t: 'error', msg: 'Could not remove that item' });
    }
    const out = { puts: [], removes: [] };
    for (const s of found) { this.store.remove(s.id); out.removes.push(s.id); }
    this.#did(c, found.length === 1 ? { k: 'del', before: found[0] } : { k: 'many', list: found.map((before) => ({ k: 'del', before })) });
    this.audit.log('drop', c.user, found.length === 1 ? { id: found[0].id, tool: found[0].tool } : { count: found.length });
    this.#flush(c, out);
  }

  // Paste or duplicate items. They arrive complete with fresh ids; undo removes the whole paste at once.
  #paste(c, m) {
    const list = Array.isArray(m.items) ? m.items : [];
    const bad = () => this.#send(c, { t: 'error', msg: 'Could not paste that' });
    if (!list.length || list.length > MAX_BATCH || this.store.strokes.length + list.length > MAX_STROKES) return bad();
    const items = [], seen = new Set();
    for (const raw of list) {
      const h = cleanBegin(raw, true);
      if (!h || !MOVABLE.has(h.tool) || seen.has(h.id) || this.store.has(h.id)) return bad();
      seen.add(h.id);
      items.push({ ...h, user: c.user, uid: c.uid });
    }
    for (const s of items) this.store.add(s);
    this.#did(c, items.length === 1 ? { k: 'add', s: items[0] } : { k: 'many', list: items.map((s) => ({ k: 'add', s })) });
    this.audit.log('paste', c.user, { count: items.length });
    this.#flush(c, { puts: items, removes: [] });
  }

  // Anyone can change a text box: its text (empty text deletes it), color, size and background.
  #edit(c, m) {
    const e = cleanEdit(m);
    const before = e && this.store.get(e.id);
    if (!before || before.tool !== 'text') return this.#send(c, { t: 'error', msg: 'Could not change that text box' });
    if (!e.text) {
      this.store.remove(before.id);
      this.#did(c, { k: 'del', before });
      this.audit.log('edit', c.user, { id: before.id, deleted: true });
      return this.#broadcast({ t: 'remove', id: before.id, by: c.user });
    }
    const { bg, ...rest } = before;
    const after = { ...rest, text: e.text, color: e.color, size: e.size, ...(e.bg ? { bg: e.bg } : {}) };
    this.store.replace(after);
    this.#did(c, { k: 'edit', before, after });
    this.audit.log('edit', c.user, { id: before.id });
    this.#broadcast({ t: 'put', s: after });
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
