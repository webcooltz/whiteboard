// Persistence: an append-only journal for the live board + JSON files for saved boards.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { slug } from './validate.mjs';

export class Store {
  constructor(dir, { compactAfter = 5000 } = {}) {
    this.dir = dir;
    this.journal = join(dir, 'board.journal');
    this.snapDir = join(dir, 'boards');
    this.compactAfter = compactAfter;
    mkdirSync(this.snapDir, { recursive: true });
    this.strokes = [];
    this.ids = new Set();
    this.ops = 0;
    this.#replay();
  }

  #replay() {
    if (!existsSync(this.journal)) return;
    const lines = readFileSync(this.journal, 'utf8').split('\n');
    const byId = new Map();
    const reset = (arr) => { this.strokes = arr; byId.clear(); arr.forEach((s) => byId.set(s.id, s)); };
    for (const line of lines) {
      if (!line) continue;
      let op;
      try { op = JSON.parse(line); } catch { continue; } // torn final write after a crash
      this.ops++;
      if (op.o === 'add' && op.s && !byId.has(op.s.id)) { this.strokes.push(op.s); byId.set(op.s.id, op.s); }
      else if (op.o === 'put' && op.s && byId.has(op.s.id)) { const i = this.strokes.indexOf(byId.get(op.s.id)); this.strokes[i] = op.s; byId.set(op.s.id, op.s); }
      else if (op.o === 'rm') { if (byId.delete(op.id)) this.strokes = this.strokes.filter((s) => s.id !== op.id); }
      else if (op.o === 'set' && Array.isArray(op.strokes)) reset(op.strokes);
    }
    this.ids = new Set(this.strokes.map((s) => s.id));
    if (this.ops > this.compactAfter) this.compact();
  }

  #append(op) {
    appendFileSync(this.journal, JSON.stringify(op) + '\n');
    this.ops++;
  }

  compact() {
    const tmp = this.journal + '.tmp';
    writeFileSync(tmp, JSON.stringify({ o: 'set', strokes: this.strokes }) + '\n');
    renameSync(tmp, this.journal);
    this.ops = 1;
  }

  has(id) { return this.ids.has(id); }

  add(stroke) { this.strokes.push(stroke); this.ids.add(stroke.id); this.#append({ o: 'add', s: stroke }); }

  get(id) { return this.ids.has(id) ? this.strokes.find((s) => s.id === id) : null; }

  // Swap a stroke for a new version of itself, keeping its place in the drawing order.
  replace(stroke) {
    const i = this.strokes.findIndex((s) => s.id === stroke.id);
    if (i < 0) return false;
    this.strokes[i] = stroke;
    this.#append({ o: 'put', s: stroke });
    return true;
  }

  remove(id) {
    const i = this.strokes.findIndex((s) => s.id === id);
    if (i < 0) return false;
    this.strokes.splice(i, 1);
    this.ids.delete(id);
    this.#append({ o: 'rm', id });
    return true;
  }

  set(strokes) {
    this.strokes = strokes;
    this.ids = new Set(strokes.map((s) => s.id));
    this.compact(); // a "set" is the whole board, so rewrite the journal rather than append it
  }

  // The newest stroke drawn by this identity. Strokes from before identities existed only have a name.
  lastBy(uid, user) {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i];
      if (s.uid ? s.uid === uid : s.user === user) return s;
    }
    return null;
  }

  // ---- saved boards ----
  #file(name) {
    const s = slug(name);
    return s ? join(this.snapDir, s + '.json') : null;
  }

  saveBoard(name, user, strokes = this.strokes) {
    const f = this.#file(name);
    if (!f) return null;
    const rec = { name, savedBy: user, savedAt: new Date().toISOString(), strokes };
    const tmp = f + '.tmp';
    writeFileSync(tmp, JSON.stringify(rec));
    renameSync(tmp, f);
    return { name, savedBy: user, savedAt: rec.savedAt, count: strokes.length };
  }

  loadBoard(name) {
    const f = this.#file(name);
    if (!f || !existsSync(f)) return null;
    try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
  }

  deleteBoard(name) {
    const f = this.#file(name);
    if (!f || !existsSync(f)) return false;
    unlinkSync(f);
    return true;
  }

  listBoards() {
    const out = [];
    for (const f of readdirSync(this.snapDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const r = JSON.parse(readFileSync(join(this.snapDir, f), 'utf8'));
        out.push({ name: r.name, savedBy: r.savedBy, savedAt: r.savedAt, count: r.strokes.length });
      } catch { /* ignore unreadable file */ }
    }
    return out.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  }

  // Keep only the newest `keep` automatic backups.
  pruneAuto(keep = 10) {
    const autos = this.listBoards().filter((b) => b.name.startsWith('auto '));
    for (const b of autos.slice(keep)) this.deleteBoard(b.name);
  }
}
