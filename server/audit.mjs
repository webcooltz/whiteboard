// Append-only audit log (one JSON object per line) with simple size-based rotation.
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, openSync, readSync, closeSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

export class AuditLog {
  constructor(file, { maxBytes = 5 * 1024 * 1024, keep = 5 } = {}) {
    this.file = file;
    this.maxBytes = maxBytes;
    this.keep = keep;
    mkdirSync(dirname(file), { recursive: true });
  }

  log(ev, user, detail = {}) {
    const entry = { ts: new Date().toISOString(), ev, user: user ?? null, ...detail };
    try {
      this.#rotate();
      appendFileSync(this.file, JSON.stringify(entry) + '\n');
    } catch (e) {
      console.error('audit write failed:', e.message);
    }
    return entry;
  }

  #rotate() {
    if (!existsSync(this.file) || statSync(this.file).size < this.maxBytes) return;
    for (let i = this.keep - 1; i >= 1; i--) {
      const from = `${this.file}.${i}`;
      if (existsSync(from)) renameSync(from, `${this.file}.${i + 1}`);
    }
    renameSync(this.file, `${this.file}.1`);
    const oldest = `${this.file}.${this.keep + 1}`;
    if (existsSync(oldest)) unlinkSync(oldest);
  }

  // Most recent entries, newest last.
  tail(limit = 100) {
    limit = Math.max(1, Math.min(1000, limit | 0));
    if (!existsSync(this.file)) return [];
    const size = statSync(this.file).size;
    const want = Math.min(size, 512 * 1024);
    const fd = openSync(this.file, 'r');
    const b = Buffer.alloc(want);
    try { readSync(fd, b, 0, want, size - want); } finally { closeSync(fd); }
    const lines = b.toString('utf8').split('\n');
    if (want < size) lines.shift(); // first line may be cut
    const out = [];
    for (const l of lines) {
      if (!l) continue;
      try { out.push(JSON.parse(l)); } catch { /* skip torn line */ }
    }
    return out.slice(-limit);
  }
}
