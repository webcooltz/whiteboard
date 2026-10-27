// Validation of stroke data coming from clients. Never trust the wire.
export const W = 1600;
export const H = 900;
export const MAX_POINTS = 40_000; // numbers (x,y pairs => 20k points) per stroke
export const MAX_CHUNK = 2_000;

const TOOLS = new Set(['pen', 'pencil', 'marker', 'highlighter', 'crayon', 'eraser', 'line', 'spray', 'text', 'sticker']);
const MAX_TEXT = 500;
const MAX_LINES = 20;
const MAX_STICKER = 16; // UTF-16 units: room for one emoji with skin tone / ZWJ joins
const CAPS = new Set(['round', 'square', 'butt']);
const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

export function cleanPoints(arr, max = MAX_CHUNK) {
  if (!Array.isArray(arr) || arr.length === 0 || arr.length % 2 !== 0 || arr.length > max) return null;
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i += 2) {
    if (!num(arr[i], -50, W + 50) || !num(arr[i + 1], -50, H + 50)) return null;
    out[i] = Math.round(arr[i] * 10) / 10;
    out[i + 1] = Math.round(arr[i + 1] * 10) / 10;
  }
  return out;
}

// Returns a sanitized stroke header (no points, no user) or null.
export function cleanBegin(m) {
  if (!m || typeof m !== 'object') return null;
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) return null;
  if (!TOOLS.has(m.tool)) return null;
  if (typeof m.color !== 'string' || !COLOR_RE.test(m.color)) return null;
  if (!num(m.size, 1, 200)) return null;
  if (!CAPS.has(m.cap)) return null;
  const dash = Array.isArray(m.dash) ? m.dash : [];
  if (dash.length > 4 || !dash.every((d) => num(d, 0, 500))) return null;
  const seed = Number.isInteger(m.seed) && m.seed >= 0 && m.seed < 2 ** 32 ? m.seed : 0;
  const radius = num(m.radius, 1, 100) ? m.radius : 10;
  const density = num(m.density, 1, 200) ? m.density : 50;
  const p = cleanPoints(m.p);
  if (!p) return null;
  const h = { id: m.id, tool: m.tool, color: m.color, size: m.size, cap: m.cap, dash, seed, radius, density, p };
  if (m.tool !== 'text' && m.tool !== 'sticker') return h;
  // Text boxes and stickers are placed at one point and carry their text.
  const text = cleanText(m.text, m.tool === 'sticker' ? MAX_STICKER : MAX_TEXT);
  if (!text || p.length !== 2 || (m.tool === 'sticker' && text.includes('\n'))) return null;
  return { ...h, text };
}

export function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  // Control characters (except newline) would render as boxes or reorder text; drop them.
  const t = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '').replace(/\s+$/, '');
  if (!t.trim() || t.length > max || t.split('\n').length > MAX_LINES) return null;
  return t;
}

export function cleanSnapshotName(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}\p{N} ._-]{1,40}$/u.test(n)) return null;
  return n;
}

export function slug(name) {
  const s = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return s || null;
}
