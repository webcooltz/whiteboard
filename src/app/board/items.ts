// What the Select tool can grab: text boxes, stickers, shapes. Where they are, how to hit them, how to resize them.
import { textBox } from './renderer';
import { corners } from './shapes';
import type { Stroke } from './stroke';

export interface Box { x: number; y: number; w: number; h: number; }
export interface Handle { id: string; x: number; y: number; }

/** A change to an item. `null` removes a fill, background or label. */
export interface ItemPatch { p?: number[]; color?: string; size?: number; fill?: string | null; bg?: string | null; text?: string | null; group?: string | null; }

/** The item with a patch applied (the server does the same, and checks it). */
export function patchItem(s: Stroke, patch: ItemPatch): Stroke {
  const out: Stroke = { ...s };
  if (patch.p) out.p = patch.p;
  if (patch.color) out.color = patch.color;
  if (patch.size) out.size = patch.size;
  for (const k of ['fill', 'bg', 'text', 'group'] as const) {
    if (patch[k] === undefined) continue;
    if (patch[k]) out[k] = patch[k] as string; else delete out[k];
  }
  return out;
}

export const isItem = (s: Stroke) => s.tool === 'text' || s.tool === 'sticker' || s.tool === 'shape';

/** The area an item covers, in board coordinates. */
export function itemBox(ctx: CanvasRenderingContext2D, s: Stroke): Box {
  if (s.tool === 'text') return textBox(ctx, s);
  if (s.tool === 'sticker') {
    const r = s.size * 0.62;
    return { x: s.p[0] - r, y: s.p[1] - r, w: r * 2, h: r * 2 };
  }
  const [x, y, r, b] = corners(s.p);
  return { x, y, w: r - x, h: b - y };
}

/** Is (x, y) on the item? `slack` is how far off still counts (bigger for fingers than for a mouse). */
export function hitItem(ctx: CanvasRenderingContext2D, s: Stroke, x: number, y: number, slack = 6): boolean {
  if (s.tool === 'shape' && s.shape === 'arrow' && s.p.length >= 4) return distToSegment(x, y, s.p) <= Math.max(slack + s.size, 10);
  const b = itemBox(ctx, s);
  return x >= b.x - slack && x <= b.x + b.w + slack && y >= b.y - slack && y <= b.y + b.h + slack;
}

/** The grab points drawn on a selected shape: both ends of an arrow, or the corners and edge middles of a box. */
export function handlesOf(s: Stroke): Handle[] {
  if (s.tool !== 'shape' || s.p.length < 4) return [];
  if (s.shape === 'arrow') return [{ id: 'a', x: s.p[0], y: s.p[1] }, { id: 'b', x: s.p[2], y: s.p[3] }];
  const [l, t, r, b] = corners(s.p), mx = (l + r) / 2, my = (t + b) / 2;
  return [
    { id: 'nw', x: l, y: t }, { id: 'n', x: mx, y: t }, { id: 'ne', x: r, y: t }, { id: 'e', x: r, y: my },
    { id: 'se', x: r, y: b }, { id: 's', x: mx, y: b }, { id: 'sw', x: l, y: b }, { id: 'w', x: l, y: my },
  ];
}

/** The shape's points after dragging handle `id` to (x, y). Boxes never shrink below `min` in either direction. */
export function dragHandle(s: Stroke, id: string, x: number, y: number, min = 12): number[] {
  if (s.shape === 'arrow') return id === 'a' ? [x, y, s.p[2], s.p[3]] : [s.p[0], s.p[1], x, y];
  let [l, t, r, b] = corners(s.p);
  if (id.includes('n')) t = Math.min(y, b - min);
  if (id.includes('s')) b = Math.max(y, t + min);
  if (id.includes('w')) l = Math.min(x, r - min);
  if (id.includes('e')) r = Math.max(x, l + min);
  return [l, t, r, b].map((v) => Math.round(v * 10) / 10);
}

function distToSegment(px: number, py: number, p: number[]): number {
  const [x1, y1, x2, y2] = p;
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// ---- selections: several items at once, as a group ----

/** The area covered by all of `items` together. */
export function unionBox(ctx: CanvasRenderingContext2D, items: Stroke[]): Box {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const s of items) {
    const x = itemBox(ctx, s);
    l = Math.min(l, x.x); t = Math.min(t, x.y); r = Math.max(r, x.x + x.w); b = Math.max(b, x.y + x.h);
  }
  return { x: l, y: t, w: r - l, h: b - t };
}

/**
 * The grab points on a selection: the two ends of a single arrow, the corners and edge middles round shapes, or just the
 * corners once a text box or sticker is included (those can only be scaled evenly).
 */
export function selectionHandles(ctx: CanvasRenderingContext2D, items: Stroke[]): Handle[] {
  if (!items.length) return [];
  if (items.length === 1 && items[0].tool === 'shape') return handlesOf(items[0]);
  const b = unionBox(ctx, items), r = b.x + b.w, bt = b.y + b.h, mx = b.x + b.w / 2, my = b.y + b.h / 2;
  const corners = [{ id: 'nw', x: b.x, y: b.y }, { id: 'ne', x: r, y: b.y }, { id: 'se', x: r, y: bt }, { id: 'sw', x: b.x, y: bt }];
  if (items.some((s) => s.tool !== 'shape')) return corners;
  return [...corners, { id: 'n', x: mx, y: b.y }, { id: 'e', x: r, y: my }, { id: 's', x: mx, y: bt }, { id: 'w', x: b.x, y: my }];
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const shiftP = (p: number[], dx: number, dy: number) => p.map((v, i) => round1(v + (i % 2 ? dy : dx)));

/** Copies of `items` moved by (dx, dy): on the grid if `grid` is set, and never off the board. */
export function moveGhosts(ctx: CanvasRenderingContext2D, items: Stroke[], dx: number, dy: number, grid: number, w: number, h: number): Stroke[] {
  const b = unionBox(ctx, items);
  if (grid) { dx = Math.round((b.x + dx) / grid) * grid - b.x; dy = Math.round((b.y + dy) / grid) * grid - b.y; }
  const xs = items.flatMap((s) => s.p.filter((_, i) => i % 2 === 0)), ys = items.flatMap((s) => s.p.filter((_, i) => i % 2 === 1));
  dx = clampTo(dx, -Math.min(...xs), w - Math.max(...xs));
  dy = clampTo(dy, -Math.min(...ys), h - Math.max(...ys));
  return items.map((s) => ({ ...s, p: shiftP(s.p, dx, dy) }));
}

/** Copies of `items` after dragging `handle` to (x, y): positions scale with the selection, and so do text and stickers. */
export function resizeGhosts(ctx: CanvasRenderingContext2D, items: Stroke[], handle: string, x: number, y: number, grid: number, w: number, h: number): Stroke[] {
  if (grid) { x = Math.round(x / grid) * grid; y = Math.round(y / grid) * grid; }
  x = clampTo(x, 0, w); y = clampTo(y, 0, h);
  if (items.length === 1 && items[0].tool === 'shape') return [{ ...items[0], p: dragHandle(items[0], handle, x, y) }];
  const box = unionBox(ctx, items);
  const even = items.some((s) => s.tool !== 'shape'); // text and stickers keep their proportions
  const min = 12;
  let l = box.x, t = box.y, r = box.x + box.w, b = box.y + box.h;
  if (handle.includes('n')) t = Math.min(y, b - min);
  if (handle.includes('s')) b = Math.max(y, t + min);
  if (handle.includes('w')) l = Math.min(x, r - min);
  if (handle.includes('e')) r = Math.max(x, l + min);
  if (even) {
    const f = Math.max((r - l) / box.w, (b - t) / box.h);
    if (handle.includes('w')) l = r - box.w * f; else r = l + box.w * f;
    if (handle.includes('n')) t = b - box.h * f; else b = t + box.h * f;
  }
  const sx = (r - l) / box.w, sy = (b - t) / box.h, f = even ? sx : 1;
  return items.map((s) => {
    const p = s.p.map((v, i) => round1(i % 2 ? t + (v - box.y) * sy : l + (v - box.x) * sx));
    return s.tool === 'shape' ? { ...s, p } : { ...s, p, size: clampTo(Math.round(s.size * f), 6, 200) };
  });
}

export type Align = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Copies of `items` lined up with each other along one edge or middle. */
export function alignGhosts(ctx: CanvasRenderingContext2D, items: Stroke[], mode: Align): Stroke[] {
  const u = unionBox(ctx, items);
  return items.map((s) => {
    const b = itemBox(ctx, s);
    const dx = mode === 'left' ? u.x - b.x : mode === 'right' ? u.x + u.w - (b.x + b.w) : mode === 'center' ? u.x + u.w / 2 - (b.x + b.w / 2) : 0;
    const dy = mode === 'top' ? u.y - b.y : mode === 'bottom' ? u.y + u.h - (b.y + b.h) : mode === 'middle' ? u.y + u.h / 2 - (b.y + b.h / 2) : 0;
    return { ...s, p: shiftP(s.p, dx, dy) };
  });
}

/** What changed between items and their moved copies, as updates to send. */
export function changesBetween(orig: Stroke[], ghosts: Stroke[]): { id: string; patch: ItemPatch }[] {
  const out: { id: string; patch: ItemPatch }[] = [];
  ghosts.forEach((g, i) => {
    const o = orig[i], patch: ItemPatch = {};
    if (g.p.some((v, k) => v !== o.p[k])) patch.p = g.p;
    if (g.size !== o.size) patch.size = g.size;
    if (patch.p || patch.size) out.push({ id: g.id, patch });
  });
  return out;
}

/** Do the two boxes overlap? */
export const overlaps = (a: Box, b: Box) => a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
