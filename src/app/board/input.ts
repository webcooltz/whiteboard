import type { BoardView } from './board-view';
import { type ItemPatch, changesBetween, moveGhosts, resizeGhosts } from './items';
import { SHAPE_DEFAULTS } from './shapes';
import { newSeed, newStrokeId, type Stroke } from './stroke';
import type { ToolState } from './tool-state';

export interface Net {
  online: boolean;
  send(m: unknown): void;
}

const FLUSH_MS = 40;
const CURSOR_MS = 100;
const MAX_CHUNK = 1800; // numbers per message; the server accepts 2000

/**
 * Turns mouse, touch, pen and keyboard input into strokes.
 * Strokes are painted locally right away and streamed to the server in small batches.
 *
 * Keyboard: Tab (or click) to focus the board, arrow keys move the cursor
 * (Shift = big steps, Alt = tiny steps), Space/Enter starts and stops drawing (or places a text box / sticker),
 * Esc stops, Ctrl+Z undoes, Ctrl+Y / Ctrl+Shift+Z redoes.
 *
 * The Select tool picks an item (click, or Space at the keyboard cursor), Shift+click adds or removes one, and dragging
 * on empty board picks everything inside the rectangle. Dragging a selection moves it, dragging a handle resizes it, the
 * arrow keys nudge it and Delete removes it. Grouped items are always picked, moved and resized together.
 */
export class InputController {
  enabled = true;
  user = '';
  /** The Text tool was used at (x, y): the page shows a text field there and calls placeText() when done. */
  onTextRequest: ((x: number, y: number) => void) | null = null;
  /** A stroke started (true) or finished (false). */
  onDrawing: ((drawing: boolean) => void) | null = null;
  /** The Select tool moved or resized items, or removed them. */
  onItemsChange: ((changes: { id: string; patch: ItemPatch }[]) => void) | null = null;
  onItemsDrop: ((ids: string[]) => void) | null = null;
  private canvas: HTMLCanvasElement;
  private board: BoardView;
  private getTool: () => ToolState;
  private net: Net;
  private current: Stroke | null = null;
  private pending: number[] = [];
  private flushTimer: any = null;
  private pointerId: number | null = null;
  private lastCursorSent = 0;
  private kb = { x: 0, y: 0, down: false, active: false };
  private drag: { mode: 'move' | 'resize' | 'marquee'; orig: Stroke[]; handle?: string; ox: number; oy: number } | null = null;
  private pointerFocus = false; // focus() from a pointer press: don't show the keyboard cursor
  private cleanup: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement, board: BoardView, getTool: () => ToolState, net: Net) {
    this.canvas = canvas;
    this.board = board;
    this.getTool = getTool;
    this.net = net;
    this.kb.x = board.w / 2;
    this.kb.y = board.h / 2;
    this.attach();
  }

  destroy(): void {
    this.finish();
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
  }

  private on(el: HTMLElement | Window, type: string, fn: (e: any) => void): void {
    el.addEventListener(type, fn);
    this.cleanup.push(() => el.removeEventListener(type, fn));
  }

  private attach(): void {
    const c = this.canvas;
    c.style.touchAction = 'none';
    this.on(c, 'contextmenu', (e: Event) => e.preventDefault());
    this.on(c, 'pointerdown', (e: PointerEvent) => this.onDown(e));
    this.on(c, 'pointermove', (e: PointerEvent) => this.onMove(e));
    this.on(c, 'pointerup', (e: PointerEvent) => this.onUp(e));
    this.on(c, 'pointercancel', (e: PointerEvent) => this.onUp(e));
    this.on(c, 'lostpointercapture', (e: PointerEvent) => this.onUp(e));
    this.on(c, 'keydown', (e: KeyboardEvent) => this.onKey(e));
    this.on(c, 'focus', () => { if (!this.pointerFocus) { this.kb.active = true; this.showKb(); } });
    this.on(c, 'blur', () => { this.finish(); this.kb.down = false; this.kb.active = false; this.showKb(); });
    this.on(window, 'blur', () => this.finish());
  }

  // ---- coordinates ----
  private toBoard(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * this.board.w;
    const y = ((e.clientY - r.top) / r.height) * this.board.h;
    return [Math.min(this.board.w, Math.max(0, x)), Math.min(this.board.h, Math.max(0, y))];
  }

  // ---- pointer (mouse, touch, pen) ----
  private onDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.pointerId !== null) return; // one finger/pen at a time
    e.preventDefault();
    this.pointerFocus = true;
    this.canvas.focus({ preventScroll: true });
    this.pointerFocus = false;
    const [x, y] = this.toBoard(e);
    if (this.getTool().tool === 'select') {
      if (!this.grab(x, y, e.shiftKey)) return;
      this.pointerId = e.pointerId;
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
      return;
    }
    if (!this.start(x, y)) return;
    this.pointerId = e.pointerId;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
  }

  private onMove(e: PointerEvent): void {
    this.sendCursor(...this.toBoard(e));
    if (this.drag && e.pointerId === this.pointerId) { this.dragTo(...this.toBoard(e)); return; }
    if (e.pointerId !== this.pointerId || !this.current) return;
    const events = typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length ? e.getCoalescedEvents() : [e];
    for (const ev of events) this.add(...this.toBoard(ev));
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.endDrag(true);
    this.finish();
  }

  // ---- keyboard ----
  private onKey(e: KeyboardEvent): void {
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && (k.toLowerCase() === 'y' || (e.shiftKey && k.toLowerCase() === 'z'))) {
      e.preventDefault();
      this.net.send({ t: 'redo' });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') {
      e.preventDefault();
      this.net.send({ t: 'undo' });
      return;
    }
    const picked = this.enabled && this.getTool().tool === 'select' ? this.board.selection : [];
    if (picked.length) {
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.onItemsDrop?.(picked.map((s) => s.id)); return; }
      if (k === 'Escape') { this.board.select(null); return; }
      const d = arrowDelta(e, this.getTool().snap);
      if (d) {
        e.preventDefault();
        const moved = moveGhosts(this.board.main, picked, d[0], d[1], 0, this.board.w, this.board.h);
        this.onItemsChange?.(changesBetween(picked, moved));
        return;
      }
    }
    if (k === ' ' || k === 'Enter') {
      e.preventDefault();
      this.kb.active = true;
      if (e.repeat) return;
      if (this.kb.down) { this.kb.down = false; this.finish(); }
      else if (this.start(this.kb.x, this.kb.y)) this.kb.down = true;
      this.showKb();
      return;
    }
    if (k === 'Escape') { this.kb.down = false; this.finish(); this.showKb(); return; }
    const step = e.shiftKey ? 40 : e.altKey ? 2 : 8;
    const d = k === 'ArrowLeft' ? [-step, 0] : k === 'ArrowRight' ? [step, 0] : k === 'ArrowUp' ? [0, -step] : k === 'ArrowDown' ? [0, step] : null;
    if (!d) return;
    e.preventDefault();
    this.kb.active = true;
    this.kb.x = Math.min(this.board.w, Math.max(0, this.kb.x + d[0]));
    this.kb.y = Math.min(this.board.h, Math.max(0, this.kb.y + d[1]));
    if (this.kb.down) this.add(this.kb.x, this.kb.y, true);
    this.sendCursor(this.kb.x, this.kb.y);
    this.showKb();
  }

  private showKb(): void {
    this.canvas.classList.toggle('kb', this.kb.active);
    this.board.setLocalCursor(this.kb.active ? { x: this.kb.x, y: this.kb.y, down: this.kb.down } : null);
  }

  // ---- stroke lifecycle ----
  private start(x: number, y: number): boolean {
    if (!this.enabled || !this.net.online || this.current) return false;
    const t = this.getTool();
    if (t.tool === 'select') {
      const hit = this.board.itemAt(x, y);
      this.board.select(hit ? this.board.withGroups([hit]) : null);
      return false;
    }
    if (t.tool === 'shape' && t.snap) { x = Math.round(x / t.snap) * t.snap; y = Math.round(y / t.snap) * t.snap; }
    if (t.tool === 'text') { this.onTextRequest?.(round(x), round(y)); return false; }
    if (t.tool === 'sticker') { if (t.text) this.place(x, y, t.text, t); return false; }
    const s: Stroke = {
      id: newStrokeId(), user: this.user, tool: t.tool, color: t.color, size: t.size, cap: t.cap,
      dash: t.dash, seed: newSeed(), radius: t.radius, density: t.density, p: [round(x), round(y)],
      ...(t.tool === 'shape' ? { shape: t.shape, ...(t.fill ? { fill: t.fill } : {}), ...(t.label ? { text: t.label } : {}) } : {}),
    };
    this.current = s;
    this.board.begin(s);
    this.onDrawing?.(true);
    const { user, ...wire } = s;
    this.net.send({ t: 'begin', ...wire });
    return true;
  }

  /** Put a finished text box at (x, y) with the current tool's color and size. */
  placeText(x: number, y: number, text: string): void {
    const t = this.getTool();
    if (t.tool === 'text' && text.trim()) this.place(x, y, text, t);
  }

  // Text and stickers are whole from the start: begin and end in one go.
  private place(x: number, y: number, text: string, t: ToolState): void {
    if (!this.enabled || !this.net.online || t.tool === 'select') return;
    const s: Stroke = {
      id: newStrokeId(), user: this.user, tool: t.tool, color: t.color, size: t.size, cap: t.cap,
      dash: [], seed: 0, radius: t.radius, density: t.density, p: [round(x), round(y)], text, ...(t.bg ? { bg: t.bg } : {}),
    };
    this.board.begin(s);
    const { user, ...wire } = s;
    this.net.send({ t: 'begin', ...wire });
    this.net.send({ t: 'end', id: s.id });
    this.board.end(s.id);
  }

  private add(x: number, y: number, force = false): void {
    const s = this.current;
    if (!s) return;
    const g = s.tool === 'shape' ? this.getTool().snap : 0;
    if (g) { x = Math.round(x / g) * g; y = Math.round(y / g) * g; }
    x = round(x); y = round(y);
    const n = s.p.length;
    const minDist = s.tool === 'spray' ? 3 : 1.5;
    if (!force && Math.hypot(x - s.p[n - 2], y - s.p[n - 1]) < minDist) return;
    this.board.pts(s.id, [x, y]);
    if (s.tool === 'line' || s.tool === 'shape') this.pending = [x, y]; // only the latest end point matters
    else this.pending.push(x, y);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  private flush(): void {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const s = this.current;
    if (!s || !this.pending.length) return;
    const all = this.pending;
    this.pending = [];
    for (let i = 0; i < all.length; i += MAX_CHUNK) this.net.send({ t: 'pts', id: s.id, p: all.slice(i, i + MAX_CHUNK) });
  }

  private finish(): void {
    this.endDrag(false);
    const s = this.current;
    if (!s) return;
    if (s.tool === 'shape' && s.shape) {
      // A click without a drag drops the piece at its usual size.
      const d = SHAPE_DEFAULTS[s.shape];
      if (s.p.length < 4 || Math.hypot(s.p[2] - s.p[0], s.p[3] - s.p[1]) < 8) this.add(Math.min(this.board.w, s.p[0] + d.w), Math.min(this.board.h, s.p[1] + d.h), true);
    }
    this.flush();
    this.current = null;
    this.net.send({ t: 'end', id: s.id });
    this.board.end(s.id);
    this.onDrawing?.(false);
  }

  // ---- Select tool ----
  private grab(x: number, y: number, shift: boolean): boolean {
    if (!this.enabled || !this.net.online) return false;
    const b = this.board, sel = b.selection;
    const handle = sel.length ? b.handleAt(x, y) : null;
    if (handle) { this.drag = { mode: 'resize', orig: [...sel], handle, ox: x, oy: y }; return true; }
    const hit = b.itemAt(x, y);
    if (hit) {
      const members = b.withGroups([hit]);
      const picked = sel.some((s) => s.id === hit.id);
      if (shift) { // add to or remove from the selection; no drag
        const ids = new Set(members.map((s) => s.id));
        b.select(picked ? sel.filter((s) => !ids.has(s.id)) : b.withGroups([...sel, ...members]));
        return false;
      }
      if (!picked) b.select(members);
      this.drag = { mode: 'move', orig: [...b.selection], ox: x, oy: y };
      return true;
    }
    // Empty board: drag a rectangle to pick what it touches. A plain click picks nothing.
    this.drag = { mode: 'marquee', orig: shift ? [...sel] : [], ox: x, oy: y };
    if (!shift) b.select(null);
    return true;
  }

  private dragTo(x: number, y: number): void {
    const d = this.drag!, b = this.board, g = this.getTool().snap;
    if (d.mode === 'marquee') {
      b.setMarquee({ x: Math.min(x, d.ox), y: Math.min(y, d.oy), w: Math.abs(x - d.ox), h: Math.abs(y - d.oy) });
    } else if (d.mode === 'resize') {
      b.setGhosts(resizeGhosts(b.main, d.orig, d.handle!, x, y, g, b.w, b.h));
    } else {
      b.setGhosts(moveGhosts(b.main, d.orig, x - d.ox, y - d.oy, g, b.w, b.h));
    }
  }

  private endDrag(commit: boolean): void {
    const d = this.drag, b = this.board;
    if (!d) return;
    this.drag = null;
    if (d.mode === 'marquee') {
      const m = b.marquee;
      b.setMarquee(null);
      if (commit && m && (m.w > 3 || m.h > 3)) b.select(b.withGroups([...d.orig, ...b.itemsIn(m)]));
      return;
    }
    const ghosts = b.ghosts;
    b.setGhosts([]);
    if (commit && ghosts.length) {
      const changes = changesBetween(d.orig, ghosts);
      if (changes.length) this.onItemsChange?.(changes);
    }
  }

  private sendCursor(x: number, y: number): void {
    const now = Date.now();
    if (now - this.lastCursorSent < CURSOR_MS) return;
    this.lastCursorSent = now;
    this.net.send({ t: 'cur', x, y });
  }
}

const round = (v: number) => Math.round(v * 10) / 10;

/** Arrow-key nudge: one grid square when snapping, else 8 (Shift = 40, Alt = 2). */
function arrowDelta(e: KeyboardEvent, grid: number): [number, number] | null {
  const step = grid || (e.shiftKey ? 40 : e.altKey ? 2 : 8);
  return e.key === 'ArrowLeft' ? [-step, 0] : e.key === 'ArrowRight' ? [step, 0] : e.key === 'ArrowUp' ? [0, -step] : e.key === 'ArrowDown' ? [0, step] : null;
}
