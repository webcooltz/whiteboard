import type { Stroke } from './stroke';

// Small deterministic PRNG so spray paint looks identical on every screen.
function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw a stroke. `fromPoint` is the index of the first point that has not been drawn yet,
 * so a stroke that is still growing can be painted incrementally.
 */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, fromPoint = 0): void {
  const n = s.p.length / 2;
  if (n === 0 || fromPoint >= n) return;
  ctx.save();
  ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.size;
  ctx.lineCap = s.cap;
  ctx.lineJoin = 'round';
  ctx.setLineDash(s.tool === 'line' ? s.dash : []);

  if (s.tool === 'spray') {
    for (let i = fromPoint; i < n; i++) {
      const rnd = mulberry32((s.seed + Math.imul(i + 1, 0x9e3779b1)) >>> 0);
      const x = s.p[i * 2], y = s.p[i * 2 + 1];
      for (let d = 0; d < s.density; d++) {
        const ang = rnd() * Math.PI * 2;
        const r = s.radius * Math.sqrt(rnd());
        ctx.fillRect(x + Math.cos(ang) * r, y + Math.sin(ang) * r, 2, 2);
      }
    }
  } else if (s.tool === 'line') {
    if (n >= 2) {
      ctx.beginPath();
      ctx.moveTo(s.p[0], s.p[1]);
      ctx.lineTo(s.p[(n - 1) * 2], s.p[(n - 1) * 2 + 1]);
      ctx.stroke();
    } else {
      dot(ctx, s, s.p[0], s.p[1]);
    }
  } else if (n === 1) {
    dot(ctx, s, s.p[0], s.p[1]);
  } else {
    // One tiny path per segment, so the picture is identical no matter how the points were batched
    // (live batches on one screen, a full redraw on another).
    for (let i = Math.max(fromPoint, 1); i < n; i++) {
      ctx.beginPath();
      ctx.moveTo(s.p[(i - 1) * 2], s.p[(i - 1) * 2 + 1]);
      ctx.lineTo(s.p[i * 2], s.p[i * 2 + 1]);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function dot(ctx: CanvasRenderingContext2D, s: Stroke, x: number, y: number): void {
  const r = s.size / 2;
  if (s.cap === 'round') {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillRect(x - r, y - r, s.size, s.size);
  }
}
