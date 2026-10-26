import type { BoardView } from './board-view';
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
 * (Shift = big steps, Alt = tiny steps), Space/Enter starts and stops drawing, Esc stops, Ctrl+Z undoes.
 */
export class InputController {
  enabled = true;
  user = '';
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
    if (!this.start(x, y)) return;
    this.pointerId = e.pointerId;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
  }

  private onMove(e: PointerEvent): void {
    this.sendCursor(...this.toBoard(e));
    if (e.pointerId !== this.pointerId || !this.current) return;
    const events = typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length ? e.getCoalescedEvents() : [e];
    for (const ev of events) this.add(...this.toBoard(ev));
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.finish();
  }

  // ---- keyboard ----
  private onKey(e: KeyboardEvent): void {
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') {
      e.preventDefault();
      this.net.send({ t: 'undo' });
      return;
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
    const s: Stroke = {
      id: newStrokeId(), user: this.user, tool: t.tool, color: t.color, size: t.size, cap: t.cap,
      dash: t.dash, seed: newSeed(), radius: t.radius, density: t.density, p: [round(x), round(y)],
    };
    this.current = s;
    this.board.begin(s);
    const { user, ...wire } = s;
    this.net.send({ t: 'begin', ...wire });
    return true;
  }

  private add(x: number, y: number, force = false): void {
    const s = this.current;
    if (!s) return;
    x = round(x); y = round(y);
    const n = s.p.length;
    const minDist = s.tool === 'spray' ? 3 : 1.5;
    if (!force && Math.hypot(x - s.p[n - 2], y - s.p[n - 1]) < minDist) return;
    this.board.pts(s.id, [x, y]);
    if (s.tool === 'line') this.pending = [x, y]; // only the latest end point matters
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
    const s = this.current;
    if (!s) return;
    this.flush();
    this.current = null;
    this.net.send({ t: 'end', id: s.id });
    this.board.end(s.id);
  }

  private sendCursor(x: number, y: number): void {
    const now = Date.now();
    if (now - this.lastCursorSent < CURSOR_MS) return;
    this.lastCursorSent = now;
    this.net.send({ t: 'cur', x, y });
  }
}

const round = (v: number) => Math.round(v * 10) / 10;
