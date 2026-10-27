import { drawStroke, drawWhole, isTextual, isWhole, paintPoints, paintTail, textBox } from './renderer';
import { type Box, hitItem, isItem, itemBox, overlaps, selectionHandles, unionBox } from './items';
import type { Stroke } from './stroke';

interface Cursor { x: number; y: number; t: number; }
export interface LocalCursor { x: number; y: number; down: boolean; }

/**
 * Holds the strokes on the board and paints them. Two canvases:
 *  - main: committed strokes (and growing point-by-point strokes, painted incrementally)
 *  - overlay: things that are not final yet — line/marker/highlighter previews, other people's cursors
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
  /** The items the Select tool has picked, and moved/resized copies of them while they are being dragged. */
  selection: Stroke[] = [];
  ghosts: Stroke[] = [];
  /** The rubber band being dragged to pick items. */
  marquee: Box | null = null;
  /** Screen pixels per board pixel, so handles stay finger-sized on a small screen. */
  scale = 1;
  onSelect: ((items: Stroke[]) => void) | null = null;
  private drawn = new Map<string, number>(); // active stroke id -> points already painted
  /** A text box being edited: left off the canvas while its text field is open over it. */
  private hidden = new Set<string>();

  constructor(main: CanvasRenderingContext2D, overlay: CanvasRenderingContext2D, w: number, h: number) {
    this.main = main;
    this.overlay = overlay;
    this.w = w;
    this.h = h;
  }

  reset(strokes: Stroke[]): void {
    this.committed = [];
    this.selection = [];
    this.ghosts = [];
    this.marquee = null;
    this.hidden.clear();
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
    if (!s || isTextual(s)) return;
    if (s.tool === 'line' || s.tool === 'shape') s.p = [s.p[0], s.p[1], p[p.length - 2], p[p.length - 1]];
    else for (const v of p) s.p.push(v);
    this.paintActive(s);
  }

  end(id: string): void {
    const s = this.active.get(id);
    if (!s) return;
    this.active.delete(id);
    this.drawn.delete(id);
    this.committed.push(s);
    if (isWhole(s)) { drawWhole(this.main, s); this.redrawOverlay(); }
    else paintTail(this.main, s);
  }

  /** A new version of a stroke (an edited text box, or one brought back by undo/redo). */
  put(s: Stroke): void {
    const i = this.committed.findIndex((c) => c.id === s.id);
    if (i >= 0) this.committed[i] = s;
    else this.committed.push(s);
    this.selection = this.selection.map((c) => (c.id === s.id ? s : c));
    this.redrawAll();
  }

  /** Several new versions at once (one repaint). */
  putMany(list: Stroke[]): void {
    for (const s of list) {
      const i = this.committed.findIndex((c) => c.id === s.id);
      if (i >= 0) this.committed[i] = s;
      else this.committed.push(s);
    }
    const byId = new Map(list.map((s) => [s.id, s]));
    this.selection = this.selection.map((c) => byId.get(c.id) ?? c);
    this.redrawAll();
  }

  /** The single item picked, or null when nothing or several are. */
  get selected(): Stroke | null { return this.selection.length === 1 ? this.selection[0] : null; }

  get(id: string): Stroke | null { return this.committed.find((s) => s.id === id) ?? null; }

  has(id: string): boolean { return this.committed.some((s) => s.id === id); }

  /** The topmost text box at (x, y), if any. */
  textAt(x: number, y: number): Stroke | null {
    for (let i = this.committed.length - 1; i >= 0; i--) {
      const s = this.committed[i];
      if (s.tool !== 'text') continue;
      const b = textBox(this.main, s);
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return s;
    }
    return null;
  }

  /** The topmost text box, sticker or shape at (x, y), if any. */
  itemAt(x: number, y: number): Stroke | null {
    const slack = Math.max(6, 10 / this.scale);
    for (let i = this.committed.length - 1; i >= 0; i--) {
      const s = this.committed[i];
      if (isItem(s) && hitItem(this.main, s, x, y, slack)) return s;
    }
    return null;
  }

  boxOf(s: Stroke): Box { return itemBox(this.main, s); }

  /** `items` plus everything grouped with them, in drawing order. */
  withGroups(items: Stroke[]): Stroke[] {
    const groups = new Set(items.map((s) => s.group).filter(Boolean));
    const ids = new Set(items.map((s) => s.id));
    return this.committed.filter((s) => isItem(s) && (ids.has(s.id) || (s.group && groups.has(s.group))));
  }

  allItems(): Stroke[] { return this.committed.filter(isItem); }

  /** Every item that touches `box` (with its group). */
  itemsIn(box: Box): Stroke[] {
    return this.withGroups(this.committed.filter((s) => isItem(s) && overlaps(box, itemBox(this.main, s))));
  }

  /** Which resize handle of the selection is at (x, y), if any. */
  handleAt(x: number, y: number): string | null {
    const r = Math.max(14, 16 / this.scale);
    for (const h of selectionHandles(this.main, this.selection)) if (Math.hypot(h.x - x, h.y - y) <= r) return h.id;
    return null;
  }

  select(list: Stroke[] | Stroke | null): void {
    const next = list === null ? [] : Array.isArray(list) ? list : [list];
    const same = next.length === this.selection.length && next.every((s, i) => s.id === this.selection[i].id);
    this.selection = next;
    if (!same) this.onSelect?.(next);
    this.redrawOverlay();
  }

  /** Show moved or resized copies of the selection (the originals stay hidden) until the drag ends; [] puts everything back. */
  setGhosts(list: Stroke[]): void {
    this.ghosts = list;
    const ids = new Set(list.map((s) => s.id));
    const same = ids.size === this.hidden.size && [...ids].every((id) => this.hidden.has(id));
    if (same) { this.redrawOverlay(); return; }
    this.hidden = ids; // one full repaint when the drag starts, then only the overlay moves
    this.redrawAll();
  }

  setMarquee(box: Box | null): void {
    this.marquee = box;
    this.redrawOverlay();
  }

  hide(id: string | null): void {
    if (id ? this.hidden.size === 1 && this.hidden.has(id) : !this.hidden.size) return;
    this.hidden = new Set(id ? [id] : []);
    this.redrawAll();
  }

  remove(id: string): void {
    const i = this.committed.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.committed.splice(i, 1);
    this.dropFromSelection([id]);
    this.redrawAll();
  }

  /** Several removals at once (one repaint). */
  removeMany(ids: string[]): void {
    const gone = new Set(ids);
    this.committed = this.committed.filter((s) => !gone.has(s.id));
    this.dropFromSelection(ids);
    this.redrawAll();
  }

  private dropFromSelection(ids: string[]): void {
    if (this.selection.some((s) => ids.includes(s.id))) this.select(this.selection.filter((s) => !ids.includes(s.id)));
  }

  private paintActive(s: Stroke): void {
    if (isWhole(s)) { this.redrawOverlay(); return; }
    paintPoints(this.main, s, this.drawn.get(s.id) ?? 0);
    this.drawn.set(s.id, s.p.length / 2);
  }

  redrawAll(): void {
    this.main.clearRect(0, 0, this.w, this.h);
    for (const s of this.committed) if (!this.hidden.has(s.id)) drawStroke(this.main, s);
    for (const s of this.active.values()) {
      if (!isWhole(s)) paintPoints(this.main, s, 0);
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
    for (const s of this.active.values()) if (isWhole(s)) drawWhole(o, s);
    for (const g of this.ghosts) drawWhole(o, g);
    this.drawSelection(o);
    this.drawMarquee(o);
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

  // A dashed outline round what is selected (round each item too when there are several), with grab handles.
  // Sizes are in screen pixels, not board pixels.
  private drawSelection(o: CanvasRenderingContext2D): void {
    const items = this.ghosts.length ? this.ghosts : this.selection;
    if (!items.length) return;
    const px = 1 / this.scale, pad = 4 * px;
    o.save();
    o.strokeStyle = '#6366f1';
    o.lineWidth = 1.5 * px;
    if (items.length > 1) {
      o.globalAlpha = 0.55;
      o.lineWidth = 1 * px;
      for (const s of items) {
        const b = this.boxOf(s);
        o.strokeRect(b.x - 2 * px, b.y - 2 * px, b.w + 4 * px, b.h + 4 * px);
      }
      o.globalAlpha = 1;
      o.lineWidth = 1.5 * px;
    }
    o.setLineDash([6 * px, 4 * px]);
    const b = unionBox(this.main, items);
    if (!(items.length === 1 && items[0].tool === 'shape' && items[0].shape === 'arrow')) o.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    o.setLineDash([]);
    o.fillStyle = '#ffffff';
    for (const h of selectionHandles(this.main, items)) {
      o.beginPath(); o.arc(h.x, h.y, 6 * px, 0, Math.PI * 2); o.fill(); o.stroke();
    }
    o.restore();
  }

  private drawMarquee(o: CanvasRenderingContext2D): void {
    const m = this.marquee;
    if (!m) return;
    const px = 1 / this.scale;
    o.save();
    o.fillStyle = 'rgba(99, 102, 241, 0.08)';
    o.strokeStyle = '#6366f1';
    o.lineWidth = 1 * px;
    o.setLineDash([5 * px, 4 * px]);
    o.fillRect(m.x, m.y, m.w, m.h);
    o.strokeRect(m.x, m.y, m.w, m.h);
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
