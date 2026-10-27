import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';
import { BoardClient, Status } from '../board/board-client';
import { BoardView } from '../board/board-view';
import { BOARD_H, BOARD_W, Stroke, newStrokeId } from '../board/stroke';
import { type Align, type ItemPatch, alignGhosts, changesBetween, patchItem } from '../board/items';

const CLIP_KEY = 'whiteboard.clipboard';
const MAX_BATCH = 200; // items in one multi-item message (the server's limit)

export interface BoardInfo { name: string; savedBy: string; savedAt: string; count: number; }
export interface AuditEntry { ts: string; ev: string; user: string | null; [key: string]: unknown; }

@Injectable({ providedIn: 'root' })
export class BoardService {
  status: Status = 'offline';
  users: string[] = [];
  boards: BoardInfo[] = [];
  audit: AuditEntry[] = [];
  message = '';
  private clipboard: Omit<Stroke, 'id' | 'user'>[] = [];
  private pastes = 0;
  readonly client: BoardClient;
  private view: BoardView | null = null;
  private lastStrokes: Stroke[] | null = null;
  private messageTimer: any = null;

  constructor(private auth: AuthService) {
    const wsUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    this.client = new BoardClient(wsUrl, () => this.auth.token);
    this.client.onStatus = (s) => {
      this.status = s;
      if (s !== 'online') this.users = []; // the server sends a fresh list when we reconnect
      if (s === 'auth-failed') void this.auth.handleRejected();
    };
    this.client.onMessage = (m) => this.onMessage(m);
  }

  connect(): void { this.client.start(); }
  disconnect(): void { this.client.stop(); this.users = []; }

  /** Called by the canvas component once its canvases exist. */
  attachView(view: BoardView): void {
    this.view = view;
    if (this.lastStrokes) view.reset(this.lastStrokes);
  }
  detachView(): void { this.view = null; }

  notify(text: string): void {
    this.message = text;
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => (this.message = ''), 5000);
  }

  private onMessage(m: any): void {
    const v = this.view;
    switch (m.t) {
      case 'hello':
        this.lastStrokes = m.strokes;
        this.users = m.users;
        this.boards = m.boards;
        v?.reset(m.strokes);
        break;
      case 'begin': v?.begin(m as Stroke); break;
      case 'pts': v?.pts(m.id, m.p); break;
      case 'end': v?.end(m.id); break;
      case 'put': v?.put(m.s as Stroke); break;
      case 'puts': v?.putMany(m.items as Stroke[]); break;
      case 'removes': v?.removeMany(m.ids as string[]); break;
      case 'remove': v?.remove(m.id); break;
      case 'reset':
        this.lastStrokes = m.strokes;
        v?.reset(m.strokes);
        if (m.by && m.by !== this.auth.user) this.notify(`${m.by} replaced the board`);
        break;
      case 'cur': v?.setCursor(m.user, m.x, m.y); break;
      case 'users': this.users = m.users; break;
      case 'boards': this.boards = m.boards; break;
      case 'audit': this.audit = m.entries.slice().reverse(); break;
      case 'error': this.notify(m.msg); break;
    }
  }

  // ---- actions ----
  undo(): void { this.client.send({ t: 'undo' }); }
  redo(): void { this.client.send({ t: 'redo' }); }
  /** Change a text box (empty text deletes it). The view is updated right away; the server's copy follows. */
  editText(s: Stroke): void {
    if (!this.view?.has(s.id)) return this.notify('That text box was removed by someone else');
    if (s.text?.trim()) this.view?.put(s);
    else this.view?.remove(s.id);
    this.client.send({ t: 'edit', id: s.id, text: s.text ?? '', color: s.color, size: s.size, bg: s.bg ?? null });
  }
  /** Switch this connection to the name in a fresh token (if offline, the next connect uses it anyway). */
  rename(token: string): void { this.client.send({ t: 'rename', token }); }
  // ---- items: text boxes, stickers and shapes ----
  /** The items the Select tool has picked (shown in the palette). */
  get selection(): Stroke[] { return this.view?.selection ?? []; }
  /** The single item picked, or null when nothing or several are. */
  get selected(): Stroke | null { return this.selection.length === 1 ? this.selection[0] : null; }
  get canGroup(): boolean { return this.selection.length > 1; }
  get hasGroup(): boolean { return this.selection.some((s) => !!s.group); }

  /** Move, resize, restyle or (un)group items. Shown right away; the server's copy follows. One undo step. */
  updateItems(changes: { id: string; patch: ItemPatch }[]): void {
    const v = this.view;
    if (!v) return;
    const list = changes.filter((c) => v.has(c.id)).slice(0, MAX_BATCH);
    if (!list.length) return;
    v.putMany(list.map((c) => patchItem(v.get(c.id)!, c.patch)));
    const items = list.map((c) => ({ id: c.id, ...c.patch }));
    this.client.send(items.length === 1 ? { t: 'update', ...items[0] } : { t: 'update', items });
  }
  updateItem(id: string, patch: ItemPatch): void { this.updateItems([{ id, patch }]); }

  /** Remove items (undo brings them back). */
  dropItems(ids: string[]): void {
    const v = this.view;
    const present = ids.filter((id) => v?.has(id)).slice(0, MAX_BATCH);
    if (!v || !present.length) return;
    v.removeMany(present);
    this.client.send(present.length === 1 ? { t: 'drop', id: present[0] } : { t: 'drop', ids: present });
  }
  deleteSelection(): void { this.dropItems(this.selection.map((s) => s.id)); }

  selectAll(): void { this.view?.select(this.view.allItems()); }

  groupSelection(): void {
    if (!this.canGroup) return;
    const group = newStrokeId();
    this.updateItems(this.selection.map((s) => ({ id: s.id, patch: { group } })));
  }
  ungroupSelection(): void {
    this.updateItems(this.selection.filter((s) => s.group).map((s) => ({ id: s.id, patch: { group: null } })));
  }

  align(mode: Align): void {
    const v = this.view, items = this.selection;
    if (v && items.length > 1) this.updateItems(changesBetween(items, alignGhosts(v.main, items, mode)));
  }

  // ---- copy and paste (kept in localStorage too, so it works across tabs and board loads) ----
  copySelection(): void {
    if (!this.selection.length) return;
    this.clipboard = this.selection.map((s) => this.bare(s));
    this.pastes = 0;
    try { localStorage.setItem(CLIP_KEY, JSON.stringify(this.clipboard)); } catch { /* the copy still works in this tab */ }
    this.notify(this.clipboard.length === 1 ? 'Copied 1 item' : `Copied ${this.clipboard.length} items`);
  }
  cutSelection(): void { this.copySelection(); this.deleteSelection(); }

  hasClipboard(): boolean { return this.readClipboard().length > 0; }
  /** Put the copied items on the board, a little further down and right each time. Returns false if there was nothing to paste. */
  paste(): boolean {
    const clip = this.readClipboard();
    if (!clip.length) return false;
    this.place(clip, 24 * ++this.pastes);
    return true;
  }
  duplicateSelection(): void {
    if (this.selection.length) this.place(this.selection.map((s) => this.bare(s)), 24);
  }

  private readClipboard(): Omit<Stroke, 'id' | 'user'>[] {
    try {
      const saved = JSON.parse(localStorage.getItem(CLIP_KEY) ?? 'null');
      if (Array.isArray(saved)) return saved;
    } catch { /* fall back to this tab's copy */ }
    return this.clipboard;
  }

  /** An item without its identity, ready to be placed again. */
  private bare(s: Stroke): Omit<Stroke, 'id' | 'user'> {
    const { id, user, ...rest } = s as Stroke & { uid?: string };
    delete rest.uid;
    return rest;
  }

  private place(items: Omit<Stroke, 'id' | 'user'>[], offset: number): void {
    const v = this.view;
    if (!v || !items.length || items.length > MAX_BATCH) return;
    const xs = items.flatMap((s) => s.p.filter((_, i) => i % 2 === 0)), ys = items.flatMap((s) => s.p.filter((_, i) => i % 2 === 1));
    const dx = Math.max(-Math.min(...xs), Math.min(offset, BOARD_W - Math.max(...xs)));
    const dy = Math.max(-Math.min(...ys), Math.min(offset, BOARD_H - Math.max(...ys)));
    const groups = new Map<string, string>(); // copies of a group form a new group
    const made: Stroke[] = items.map((src) => {
      const { group, ...rest } = src;
      if (group && !groups.has(group)) groups.set(group, newStrokeId());
      return {
        ...rest, id: newStrokeId(), user: this.auth.user, ...(group ? { group: groups.get(group) } : {}),
        p: src.p.map((c, i) => Math.round((c + (i % 2 ? dy : dx)) * 10) / 10),
      };
    });
    v.putMany(made);
    v.select(made);
    this.client.send({ t: 'paste', items: made.map(({ user, ...wire }) => wire) });
  }

  erase(): void { this.client.send({ t: 'clear' }); }
  save(name: string): void { this.client.send({ t: 'save', name }); }
  load(name: string): void { this.client.send({ t: 'load', name }); }
  remove(name: string): void { this.client.send({ t: 'del', name }); }
  refreshAudit(): void { this.client.send({ t: 'audit', limit: 200 }); }

  async downloadPng(): Promise<void> {
    const blob = await this.view?.toBlob();
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `whiteboard-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}
