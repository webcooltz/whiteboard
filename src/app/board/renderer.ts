import type { Stroke } from './stroke';

// Small deterministic PRNG so textured brushes look identical on every screen.
function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rngFor = (s: Stroke, i: number) => mulberry32((s.seed + Math.imul(i + 1, 0x9e3779b1)) >>> 0);

// Fixed "paper grain": the same spots stay uncovered by crayon wherever and whoever draws.
function paperHole(x: number, y: number): boolean {
  let h = Math.imul(Math.floor(x / 1.5), 0x27d4eb2d) ^ Math.imul(Math.floor(y / 1.5), 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296 < 0.3;
}

/**
 * Brushes drawn as one path (so translucent ink does not darken where it overlaps itself).
 * While in progress they are previewed on the overlay; they are painted onto the board when finished.
 * Every other brush is painted point by point as it grows.
 */
export function isWhole(s: Stroke): boolean {
  return s.tool === 'line' || s.tool === 'marker' || s.tool === 'highlighter' || s.text !== undefined;
}

export const TEXT_FONT = "500 {size}px 'Inter', system-ui, 'Segoe UI', Roboto, sans-serif";
export const STICKER_FONT = "{size}px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";
export const LINE_HEIGHT = 1.25;

/** Text boxes: lines from the top-left point. Stickers: one emoji centered on the point. */
function drawText(ctx: CanvasRenderingContext2D, s: Stroke): void {
  ctx.save();
  ctx.fillStyle = s.color;
  const sticker = s.tool === 'sticker';
  ctx.font = (sticker ? STICKER_FONT : TEXT_FONT).replace('{size}', String(s.size));
  ctx.textAlign = sticker ? 'center' : 'left';
  ctx.textBaseline = sticker ? 'middle' : 'top';
  const lines = (s.text ?? '').split('\n');
  // Text boxes match the HTML field they were typed in, whose lines have half the extra line height above them.
  const top = sticker ? s.p[1] : s.p[1] + (s.size * (LINE_HEIGHT - 1)) / 2;
  lines.forEach((line, i) => ctx.fillText(line, s.p[0], top + i * s.size * LINE_HEIGHT));
  ctx.restore();
}

/** Draw a finished stroke. */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  if (isWhole(s)) drawWhole(ctx, s);
  else { paintPoints(ctx, s, 0); paintTail(ctx, s); }
}

/**
 * Paint points [from, n) of a growing point-by-point stroke. Each point is painted from the same inputs
 * whether it arrives live (in any batch size) or in a full redraw, so every screen matches pixel for pixel.
 */
export function paintPoints(ctx: CanvasRenderingContext2D, s: Stroke, from: number): void {
  const n = s.p.length / 2;
  if (from >= n) return;
  ctx.save();
  setup(ctx, s);
  for (let i = from; i < n; i++) paintPoint(ctx, s, i);
  ctx.restore();
}

/** Paint the last half-segment of a point-by-point stroke (the smoothed path stops halfway to the newest point). */
export function paintTail(ctx: CanvasRenderingContext2D, s: Stroke): void {
  const n = s.p.length / 2;
  if (n < 2 || s.tool === 'spray') return;
  const p = s.p;
  const ax = (p[n * 2 - 4] + p[n * 2 - 2]) / 2, ay = (p[n * 2 - 3] + p[n * 2 - 1]) / 2;
  const bx = p[n * 2 - 2], by = p[n * 2 - 1];
  ctx.save();
  setup(ctx, s);
  paintSegment(ctx, s, n - 1, ax, ay, bx, by, bx, by);
  ctx.restore();
}

/** Draw a stroke as a single path (lines, marker, highlighter — and previews of them), or a text box / sticker. */
export function drawWhole(ctx: CanvasRenderingContext2D, s: Stroke): void {
  const n = s.p.length / 2;
  if (n === 0) return;
  if (s.text !== undefined) { drawText(ctx, s); return; }
  const p = s.p;
  ctx.save();
  setup(ctx, s);
  if (s.tool === 'line') {
    ctx.lineWidth = s.size;
    ctx.lineCap = s.cap;
    ctx.setLineDash(s.dash);
    if (n >= 2) {
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(p[(n - 1) * 2], p[(n - 1) * 2 + 1]);
      ctx.stroke();
    } else {
      disc(ctx, p[0], p[1], s.size / 2);
    }
  } else {
    const hl = s.tool === 'highlighter';
    ctx.globalAlpha = hl ? 0.38 : 0.9;
    ctx.lineWidth = s.size * (hl ? 2.6 : 1.4);
    ctx.lineCap = hl ? 'butt' : 'round';
    if (n === 1) {
      if (hl) ctx.fillRect(p[0] - ctx.lineWidth / 2, p[1] - ctx.lineWidth / 2, ctx.lineWidth, ctx.lineWidth);
      else disc(ctx, p[0], p[1], ctx.lineWidth / 2);
    } else {
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let i = 1; i < n; i++) ctx.quadraticCurveTo(p[i * 2 - 2], p[i * 2 - 1], (p[i * 2 - 2] + p[i * 2]) / 2, (p[i * 2 - 1] + p[i * 2 + 1]) / 2);
      ctx.lineTo(p[n * 2 - 2], p[n * 2 - 1]);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function setup(ctx: CanvasRenderingContext2D, s: Stroke): void {
  ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : s.tool === 'highlighter' ? 'multiply' : 'source-over';
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
}

function paintPoint(ctx: CanvasRenderingContext2D, s: Stroke, i: number): void {
  const p = s.p;
  const x = p[i * 2], y = p[i * 2 + 1];
  if (s.tool === 'spray') {
    const rnd = rngFor(s, i);
    ctx.globalAlpha = 0.85;
    for (let d = 0; d < s.density; d++) {
      const ang = rnd() * Math.PI * 2;
      const r = s.radius * Math.sqrt(rnd());
      ctx.fillRect(x + Math.cos(ang) * r, y + Math.sin(ang) * r, 1.6, 1.6);
    }
    return;
  }
  if (i === 0) {
    paintSegment(ctx, s, 0, x, y, x, y, x, y);
    return;
  }
  // Smooth path: quadratic curves between the midpoints of consecutive points, with the points as controls.
  const px = p[i * 2 - 2], py = p[i * 2 - 1];
  const ax = i === 1 ? px : (p[i * 2 - 4] + px) / 2, ay = i === 1 ? py : (p[i * 2 - 3] + py) / 2;
  paintSegment(ctx, s, i, ax, ay, px, py, (px + x) / 2, (py + y) / 2);
}

/** Pen width: a little thinner when moving fast, and a short taper at the start — like ink. */
function penWidth(s: Stroke, i: number): number {
  const p = s.p;
  let d = 0, k = 0;
  for (let j = Math.max(1, i - 2); j <= i; j++, k++) d += Math.hypot(p[j * 2] - p[j * 2 - 2], p[j * 2 + 1] - p[j * 2 - 1]);
  const speed = k ? d / k : 0;
  const f = Math.max(0.6, 1 / (1 + speed / (40 + s.size * 2)));
  return s.size * f * Math.min(1, 0.6 + 0.1 * i);
}

// Paint one quadratic segment a -> b with control c. A segment with a === b === c is a dot.
function paintSegment(ctx: CanvasRenderingContext2D, s: Stroke, i: number, ax: number, ay: number, cx: number, cy: number, bx: number, by: number): void {
  const dot = ax === bx && ay === by && ax === cx && ay === cy;
  if (s.tool === 'pen' || s.tool === 'eraser') {
    const w = s.tool === 'pen' ? penWidth(s, i) : s.size;
    if (dot) { disc(ctx, ax, ay, w / 2); return; }
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cx, cy, bx, by); ctx.stroke();
    return;
  }
  const rnd = rngFor(s, i);
  const len = Math.hypot(cx - ax, cy - ay) + Math.hypot(bx - cx, by - cy);
  const at = (t: number): [number, number] => {
    const u = 1 - t;
    return [u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by];
  };
  if (s.tool === 'pencil') {
    // A thin graphite core plus a sprinkle of grain around it.
    const w = Math.max(1, s.size * 0.5);
    ctx.globalAlpha = 0.6;
    if (dot) disc(ctx, ax, ay, w / 2);
    else {
      ctx.lineWidth = w;
      ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cx, cy, bx, by); ctx.stroke();
    }
    ctx.globalAlpha = 0.3;
    const grains = Math.ceil(Math.max(1, len) * Math.max(1, s.size / 4));
    for (let g = 0; g < grains; g++) {
      const [gx, gy] = at(rnd());
      ctx.fillRect(gx + (rnd() - 0.5) * s.size, gy + (rnd() - 0.5) * s.size, 1, 1);
    }
    return;
  }
  // Crayon: waxy stamps that skip the paper grain.
  ctx.globalAlpha = 0.65;
  const r = s.size / 2;
  const steps = dot ? 1 : Math.max(1, Math.ceil(len / 1.5));
  const perStamp = Math.ceil(s.size * 0.8) + 2;
  for (let k = 1; k <= steps; k++) {
    const [sx, sy] = dot ? [ax, ay] : at(k / steps);
    for (let d = 0; d < perStamp; d++) {
      const ang = rnd() * Math.PI * 2;
      const rr = r * Math.sqrt(rnd());
      const x = sx + Math.cos(ang) * rr, y = sy + Math.sin(ang) * rr;
      if (!paperHole(x, y)) ctx.fillRect(x, y, 1.4, 1.4);
    }
  }
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
  ctx.fill();
}
