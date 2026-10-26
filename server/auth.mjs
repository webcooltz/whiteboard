// Password hashing (scrypt), signed session tokens (HMAC), and login throttling.
import { scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const scryptAsync = promisify(scrypt);
const N = 16384, R = 8, P = 1, KEYLEN = 32;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function safeEqual(a, b) {
  const ha = createHmac('sha256', 'cmp').update(String(a)).digest();
  const hb = createHmac('sha256', 'cmp').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function loadSecret(envValue, file) {
  if (envValue && envValue.length >= 16) return envValue;
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(dirname(file), { recursive: true });
  const s = randomBytes(32).toString('hex');
  writeFileSync(file, s + '\n', { mode: 0o600 });
  return s;
}

const b64u = (b) => Buffer.from(b).toString('base64url');

export function signToken(secret, user, kind, ttlMs, now = Date.now()) {
  const body = b64u(JSON.stringify({ u: user, k: kind, exp: now + ttlMs }));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(secret, token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const want = createHmac('sha256', secret).update(body).digest();
  let got;
  try { got = Buffer.from(sig, 'base64url'); } catch { return null; }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof d.u !== 'string' || typeof d.exp !== 'number' || d.exp < now) return null;
    return { user: d.u, kind: d.k };
  } catch { return null; }
}

// Counts failures per key (ip / username); locks the key out after too many.
export class Throttle {
  constructor({ max = 5, windowMs = 15 * 60_000 } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.map = new Map();
  }
  locked(key, now = Date.now()) {
    const e = this.map.get(key);
    if (!e) return false;
    if (now - e.first > this.windowMs) { this.map.delete(key); return false; }
    return e.count >= this.max;
  }
  fail(key, now = Date.now()) {
    const e = this.map.get(key);
    if (!e || now - e.first > this.windowMs) this.map.set(key, { count: 1, first: now });
    else e.count++;
    if (this.map.size > 5000) this.map.clear();
  }
  reset(key) { this.map.delete(key); }
}

export function cleanName(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim().replace(/\s+/g, ' ');
  return /^[\p{L}\p{N} ._'-]{1,24}$/u.test(n) ? n : null;
}
