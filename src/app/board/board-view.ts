import { drawStroke } from './renderer';
import type { Stroke } from './stroke';

interface Cursor { x: number; y: number; t: number; }
export interface LocalCursor { x: number; y: number; down: boolean; }

/**
 * Holds the strokes on the board and paints them. Two canvases:
 *  - main: committed strokes (and growing pen/eraser/spray strokes, painted incrementally)
 *  - overlay: things that are not final yet — line previews, other people's cursors
 */
export class BoardView {
  main: CanvasRenderingContext2D;
  overlay: CanvasRenderingContext2D;
  w: number;
  h: number;
  committed: Stroke[] = [];
  active = new Map<string, Stroke>();
  cursors = new Map<string, Cursor>();
  localCursor: LocalCursor | null = null;
  private drawn = new Map<string, number>(); // active stroke id -> points already painted

  constructor(main: CanvasRenderingContext2D, overlay: CanvasRenderingContext2D, w: number, h: number) {
    this.main = main;
    this.overlay = overlay;
    this.w = w;
    this.h = h;
  }

  reset(strokes: Stroke[]): void {
    this.committed = [];
    this.active.clear();
    this.drawn.clear();
    for (const s of strokes) this.committed.push(s);
    this.redrawAll();
  }

  begin(s: Stroke): void {
    this.active.set(s.id, s);
    this.drawn.set(s.id, 0);
    this.paintActive(s);
  }

  pts(id: string, p: number[]): void {
    const s = this.active.get(id);
    if (!s) return;
    if (s.tool === 'line') s.p = [s.p[0], s.p[1], p[p.length - 2], p[p.length - 1]];
    else for (const v of p) s.p.push(v);
    this.paintActive(s);
  }

  end(id: string): void {
    const s = this.active.get(id);
    if (!s) return;
    this.active.delete(id);
    this.drawn.delete(id);
    this.committed.push(s);
    if (s.tool === 'line') { drawStroke(this.main, s); this.redrawOverlay(); }
  }

  remove(id: string): void {
    const i = this.committed.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.committed.splice(i, 1);
    this.redrawAll();
  }

  private paintActive(s: Stroke): void {
    if (s.tool === 'line') { this.redrawOverlay(); return; }
    const from = this.drawn.get(s.id) ?? 0;
    drawStroke(this.main, s, from);
    this.drawn.set(s.id, s.p.length / 2);
  }

  redrawAll(): void {
    this.main.clearRect(0, 0, this.w, this.h);
    for (const s of this.committed) drawStroke(this.main, s);
    for (const s of this.active.values()) {
      if (s.tool !== 'line') drawStroke(this.main, s);
      this.drawn.set(s.id, s.p.length / 2);
    }
    this.redrawOverlay();
  }

  setCursor(user: string, x: number, y: number, now = Date.now()): void {
    this.cursors.set(user, { x, y, t: now });
    this.redrawOverlay();
  }

  setLocalCursor(c: LocalCursor | null): void {
    this.localCursor = c;
    this.redrawOverlay();
  }

  pruneCursors(now = Date.now(), maxAge = 4000): void {
    let changed = false;
    for (const [u, c] of this.cursors) if (now - c.t > maxAge) { this.cursors.delete(u); changed = true; }
    if (changed) this.redrawOverlay();
  }

  redrawOverlay(): void {
    const o = this.overlay;
    o.clearRect(0, 0, this.w, this.h);
    for (const s of this.active.values()) if (s.tool === 'line') drawStroke(o, s);
    o.save();
    o.font = '22px sans-serif';
    for (const [user, c] of this.cursors) {
      o.fillStyle = 'rgba(30,100,220,0.9)';
      o.beginPath(); o.arc(c.x, c.y, 6, 0, Math.PI * 2); o.fill();
      o.fillStyle = 'rgba(30,100,220,0.95)';
      o.fillText(user, c.x + 10, c.y - 8);
    }
    if (this.localCursor) {
      const { x, y, down } = this.localCursor;
      o.lineWidth = 3;
      o.strokeStyle = down ? '#d22' : '#222';
      o.strokeRect(x - 10, y - 10, 20, 20);
      o.beginPath(); o.moveTo(x - 16, y); o.lineTo(x + 16, y); o.moveTo(x, y - 16); o.lineTo(x, y + 16); o.stroke();
    }
    o.restore();
  }

  /** PNG of the board on a white background. */
  toBlob(): Promise<Blob | null> {
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, this.w, this.h);
    g.drawImage(this.main.canvas, 0, 0);
    return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
  }
}
