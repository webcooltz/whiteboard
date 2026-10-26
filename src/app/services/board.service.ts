import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';
import { BoardClient, Status } from '../board/board-client';
import { BoardView } from '../board/board-view';
import { Stroke } from '../board/stroke';

export interface BoardInfo { name: string; savedBy: string; savedAt: string; count: number; }
export interface AuditEntry { ts: string; ev: string; user: string | null; [key: string]: unknown; }

@Injectable({ providedIn: 'root' })
export class BoardService {
  status: Status = 'offline';
  users: string[] = [];
  boards: BoardInfo[] = [];
  audit: AuditEntry[] = [];
  message = '';
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
