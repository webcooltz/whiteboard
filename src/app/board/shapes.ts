// Shapes and wireframe pieces. Each is dragged out as two corner points (arrows: tail and head) and drawn from
// those, so every screen shows the same thing. Framework-free, like the rest of this folder.
import type { Stroke } from './stroke';

export type ShapeKind = 'rect' | 'round' | 'ellipse' | 'diamond' | 'arrow'
  | 'button' | 'input' | 'checkbox' | 'toggle' | 'image' | 'phone' | 'browser';

/** Size (and label) of a piece dropped with a plain click instead of a drag. */
export const SHAPE_DEFAULTS: Record<ShapeKind, { w: number; h: number; label?: string }> = {
  rect: { w: 160, h: 100 }, round: { w: 160, h: 100 }, ellipse: { w: 160, h: 100 }, diamond: { w: 160, h: 120 }, arrow: { w: 160, h: 0 },
  button: { w: 180, h: 56, label: 'Button' }, input: { w: 280, h: 52, label: 'Placeholder text' }, checkbox: { w: 220, h: 36, label: 'Checkbox' },
  toggle: { w: 72, h: 40 }, image: { w: 240, h: 160, label: 'Image' }, phone: { w: 260, h: 520 }, browser: { w: 520, h: 340, label: 'example.com' },
};

const FONT = "'Inter', system-ui, 'Segoe UI', Roboto, sans-serif";
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Normalised corners of a shape: [left, top, right, bottom]. */
export function corners(p: number[]): [number, number, number, number] {
  const [a, b] = [p[0], p[1]], [c, d] = p.length >= 4 ? [p[2], p[3]] : [p[0], p[1]];
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

/** Black or white, whichever reads better on this background. */
export function onColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#111827' : '#ffffff';
}

export function drawShape(ctx: CanvasRenderingContext2D, s: Stroke): void {
  if (s.p.length < 4 || !s.shape) return;
  const [x, y, r, b] = corners(s.p);
  const w = r - x, h = b - y;
  ctx.save();
  ctx.lineWidth = s.size;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.fill ?? s.color;
  switch (s.shape) {
    case 'rect': box(ctx, s, x, y, w, h, 0); break;
    case 'round': box(ctx, s, x, y, w, h, clamp(Math.min(w, h) * 0.18, 0, 28)); break;
    case 'ellipse':
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      if (s.fill) ctx.fill();
      ctx.stroke();
      centered(ctx, s, x + w / 2, y + h / 2, w * 0.7, h);
      break;
    case 'diamond':
      ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(r, y + h / 2); ctx.lineTo(x + w / 2, b); ctx.lineTo(x, y + h / 2); ctx.closePath();
      if (s.fill) ctx.fill();
      ctx.stroke();
      centered(ctx, s, x + w / 2, y + h / 2, w * 0.5, h);
      break;
    case 'arrow': arrow(ctx, s); break;
    case 'button': {
      round(ctx, x, y, w, h, Math.min(14, h / 2));
      ctx.fill();
      label(ctx, s.text, x + w / 2, y + h / 2, clamp(h * 0.38, 12, 40), onColor(s.fill ?? s.color), 'center', w - 16, 600);
      break;
    }
    case 'input': {
      round(ctx, x, y, w, h, Math.min(10, h / 2));
      ctx.fillStyle = s.fill ?? '#ffffff';
      ctx.fill();
      ctx.stroke();
      label(ctx, s.text, x + h * 0.3, y + h / 2, clamp(h * 0.36, 12, 36), '#9ca3af', 'left', w - h * 0.6);
      break;
    }
    case 'checkbox': {
      const side = clamp(h * 0.75, 14, 44), by = y + (h - side) / 2;
      round(ctx, x, by, side, side, side * 0.2);
      ctx.fillStyle = s.fill ?? '#ffffff';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + side * 0.22, by + side * 0.52); ctx.lineTo(x + side * 0.43, by + side * 0.72); ctx.lineTo(x + side * 0.78, by + side * 0.28);
      ctx.lineWidth = Math.max(2, s.size * 1.2); ctx.stroke();
      label(ctx, s.text, x + side + side * 0.4, y + h / 2, side * 0.8, s.color, 'left', w - side * 1.4);
      break;
    }
    case 'toggle': {
      const hh = Math.min(h, w * 0.6);
      round(ctx, x, y, w, hh, hh / 2);
      ctx.fillStyle = s.fill ?? '#22c55e';
      ctx.fill();
      ctx.beginPath(); ctx.arc(x + w - hh / 2, y + hh / 2, hh * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      break;
    }
    case 'image': {
      round(ctx, x, y, w, h, 6);
      ctx.fillStyle = s.fill ?? '#f3f4f6';
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(r, b); ctx.moveTo(r, y); ctx.lineTo(x, b);
      ctx.stroke();
      ctx.restore();
      if (s.text) {
        const fs = clamp(Math.min(w, h) * 0.14, 12, 28);
        ctx.fillStyle = s.fill ?? '#f3f4f6';
        const tw = (ctx.font = `500 ${fs}px ${FONT}`, ctx.measureText(s.text).width);
        ctx.fillRect(x + w / 2 - tw / 2 - 8, y + h / 2 - fs * 0.8, tw + 16, fs * 1.6);
        label(ctx, s.text, x + w / 2, y + h / 2, fs, '#6b7280', 'center', w - 24);
      }
      break;
    }
    case 'phone': {
      round(ctx, x, y, w, h, clamp(w * 0.12, 8, 40));
      ctx.fillStyle = s.fill ?? '#ffffff';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = s.color;
      round(ctx, x + w * 0.35, y + Math.min(14, h * 0.03) + s.size, w * 0.3, Math.min(10, h * 0.02) + 2, 6);
      ctx.fill();
      round(ctx, x + w * 0.35, b - Math.min(16, h * 0.03) - s.size - 4, w * 0.3, 5, 3);
      ctx.fill();
      break;
    }
    case 'browser': {
      const bar = clamp(h * 0.12, 26, 44);
      round(ctx, x, y, w, h, 12);
      ctx.fillStyle = s.fill ?? '#ffffff';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y + bar); ctx.lineTo(r, y + bar); ctx.stroke();
      ['#ef4444', '#facc15', '#22c55e'].forEach((c, i) => {
        ctx.beginPath(); ctx.arc(x + 18 + i * 20, y + bar / 2, 5, 0, Math.PI * 2);
        ctx.fillStyle = c; ctx.fill();
      });
      if (w > 200) {
        round(ctx, x + 88, y + bar * 0.2, w - 88 - 14, bar * 0.6, bar * 0.3);
        ctx.fillStyle = '#f3f4f6'; ctx.fill();
        label(ctx, s.text, x + 88 + 12, y + bar / 2, bar * 0.36, '#6b7280', 'left', w - 88 - 40);
      }
      break;
    }
  }
  ctx.restore();
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  if (r > 0) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

function box(ctx: CanvasRenderingContext2D, s: Stroke, x: number, y: number, w: number, h: number, r: number): void {
  round(ctx, x, y, w, h, r);
  if (s.fill) ctx.fill();
  ctx.stroke();
  centered(ctx, s, x + w / 2, y + h / 2, w - 16, h);
}

/** A label in the middle of a basic shape, in the shape's color (or readable on its fill). */
function centered(ctx: CanvasRenderingContext2D, s: Stroke, cx: number, cy: number, maxW: number, h: number): void {
  label(ctx, s.text, cx, cy, clamp(h * 0.3, 12, 40), s.fill ? onColor(s.fill) : s.color, 'center', maxW);
}

function label(ctx: CanvasRenderingContext2D, text: string | undefined, x: number, y: number, size: number, color: string,
  align: CanvasTextAlign, maxW: number, weight = 500): void {
  if (!text) return;
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y, Math.max(10, maxW));
  ctx.restore();
}

function arrow(ctx: CanvasRenderingContext2D, s: Stroke): void {
  const [x1, y1, x2, y2] = s.p;
  const head = Math.max(26, s.size * 6);
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath(); ctx.moveTo(x1, y1);
  // Stop the shaft inside the head so a thick line does not poke past the tip.
  const len = Math.hypot(x2 - x1, y2 - y1);
  const k = len > head * 0.7 ? (len - head * 0.7) / len : 0;
  ctx.lineTo(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(a - 0.45), y2 - head * Math.sin(a - 0.45));
  ctx.lineTo(x2 - head * Math.cos(a + 0.45), y2 - head * Math.sin(a + 0.45));
  ctx.closePath();
  ctx.fillStyle = s.color;
  ctx.fill();
}
