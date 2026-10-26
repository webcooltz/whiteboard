import { Component } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { AuditEntry, BoardInfo, BoardService } from '../services/board.service';

@Component({
  selector: 'app-board-menu',
  templateUrl: './board-menu.component.html',
  styleUrls: ['./board-menu.component.css']
})
export class BoardMenuComponent {
  saving = false;
  saveName = '';
  showBoards = false;
  showActivity = false;
  showDrawing = false;

  constructor(public board: BoardService, public auth: AuthService) {}

  get statusText(): string {
    switch (this.board.status) {
      case 'online': return 'Live';
      case 'connecting': return 'Connecting…';
      case 'auth-failed': return 'Signed out';
      default: return 'Offline — reconnecting…';
    }
  }

  startSave(): void { this.saving = true; this.saveName = ''; }
  cancelSave(): void { this.saving = false; }
  confirmSave(): void {
    const name = this.saveName.trim();
    if (!name) return;
    this.board.save(name);
    this.saving = false;
    this.board.notify(`Saved "${name}"`);
  }

  load(b: BoardInfo): void {
    if (confirm(`Replace the board with "${b.name}"? The current board is backed up automatically.`)) {
      this.board.load(b.name);
      this.showBoards = false;
    }
  }

  remove(b: BoardInfo): void {
    if (confirm(`Delete the saved board "${b.name}"? This cannot be undone.`)) this.board.remove(b.name);
  }

  erase(): void {
    if (confirm('Erase the whole board for everyone? A backup is saved automatically, so you can load it back.')) this.board.erase();
  }

  toggleActivity(): void {
    this.showActivity = !this.showActivity;
    if (this.showActivity) this.board.refreshAudit();
  }

  get entries(): AuditEntry[] {
    const noisy = new Set(['stroke', 'connect', 'disconnect', 'ws_auth_fail']);
    return this.showDrawing ? this.board.audit : this.board.audit.filter((e) => !noisy.has(e.ev));
  }

  describe(e: AuditEntry): string {
    const s = (k: string): string => String(e[k] ?? '');
    switch (e.ev) {
      case 'login_ok': return 'signed in';
      case 'login_fail': return `failed sign-in attempt (${s('ip')})`;
      case 'login_locked': return `locked out after too many failed sign-ins (${s('ip')})`;
      case 'connect': return 'joined the board';
      case 'disconnect': return 'left the board';
      case 'stroke': return `drew with ${s('tool')} (${s('points')} points)`;
      case 'undo': return 'undid their last stroke';
      case 'clear': return `erased the board (${s('removed')} strokes${e['backup'] ? `; backup "${s('backup')}"` : ''})`;
      case 'save': return `saved the board as "${s('name')}"${e['overwrote'] ? ' (replaced an older save)' : ''}`;
      case 'load': return `loaded "${s('name')}" onto the board${e['backup'] ? ` (previous board backed up as "${s('backup')}")` : ''}`;
      case 'delete': return `deleted the saved board "${s('name')}"`;
      case 'server_start': return 'server started';
      case 'server_stop': return 'server stopped';
      default: return e.ev;
    }
  }

  when(ts: string): string { return new Date(ts).toLocaleString(); }
  trackName(_: number, b: BoardInfo): string { return b.name; }
}
