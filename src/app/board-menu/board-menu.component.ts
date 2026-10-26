import { Component, ElementRef, HostListener, ViewChild } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { AuditEntry, BoardInfo, BoardService } from '../services/board.service';

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#a855f7'];

@Component({
  selector: 'app-board-menu',
  templateUrl: './board-menu.component.html',
  styleUrls: ['./board-menu.component.css']
})
export class BoardMenuComponent {
  panel: 'boards' | 'activity' | null = null;
  saving = false;
  saveName = '';
  renaming = false;
  newName = '';
  renameError = '';
  showDrawing = false;

  constructor(public board: BoardService, public auth: AuthService) {}

  // Focus the text box of whichever dialog just opened.
  @ViewChild('dialogInput') set dialogInput(el: ElementRef<HTMLInputElement> | undefined) {
    if (el) setTimeout(() => el.nativeElement.select());
  }

  @HostListener('document:keydown.escape')
  closeTop(): void {
    if (this.saving || this.renaming) { this.saving = this.renaming = false; return; }
    this.panel = null;
  }

  get statusText(): string {
    switch (this.board.status) {
      case 'online': return 'Live';
      case 'connecting': return 'Connecting…';
      case 'auth-failed': return 'Signed out';
      default: return 'Reconnecting…';
    }
  }

  toggle(panel: 'boards' | 'activity'): void {
    this.panel = this.panel === panel ? null : panel;
    if (this.panel === 'activity') this.board.refreshAudit();
  }

  startSave(): void { this.saving = true; this.saveName = ''; }
  confirmSave(): void {
    const name = this.saveName.trim();
    if (!name) return;
    this.board.save(name);
    this.saving = false;
    this.board.notify(`Saved "${name}"`);
  }

  startRename(): void {
    if (!this.auth.canRename) return;
    this.newName = this.auth.user;
    this.renameError = '';
    this.renaming = true;
  }
  async confirmRename(): Promise<void> {
    const name = this.newName.trim();
    if (!name) return;
    if (name === this.auth.user) { this.renaming = false; return; }
    if (await this.auth.rename(name)) {
      this.renaming = false;
      this.board.notify(`You're now "${name}"`);
    } else {
      this.renameError = this.auth.error;
    }
  }

  load(b: BoardInfo): void {
    if (confirm(`Replace the board with "${b.name}"? The current board is backed up automatically.`)) {
      this.board.load(b.name);
      this.panel = null;
    }
  }

  remove(b: BoardInfo): void {
    if (confirm(`Delete the saved board "${b.name}"? This cannot be undone.`)) this.board.remove(b.name);
  }

  erase(): void {
    if (confirm('Erase the whole board for everyone? A backup is saved automatically, so you can load it back.')) this.board.erase();
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
      case 'rename': return `changed their name (was "${s('from')}")`;
      case 'connect': return 'joined the board';
      case 'disconnect': return 'left the board';
      case 'stroke': return `drew with the ${s('tool')} (${s('points')} points)`;
      case 'undo': return 'undid their last stroke';
      case 'clear': return `erased the board (${s('removed')} strokes${e['backup'] ? `; backup "${s('backup')}"` : ''})`;
      case 'save': return `saved the board as "${s('name')}"${e['overwrote'] ? ' (replaced an older save)' : ''}`;
      case 'load': return `opened "${s('name')}"${e['backup'] ? ` (previous board backed up as "${s('backup')}")` : ''}`;
      case 'delete': return `deleted the saved board "${s('name')}"`;
      case 'server_start': return 'server started';
      case 'server_stop': return 'server stopped';
      default: return e.ev;
    }
  }

  initials(name: string): string {
    const parts = name.replace(/\(device\)/, '').trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
  }

  colorFor(name: string): string {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
  }

  when(ts: string): string { return new Date(ts).toLocaleString(); }
  trackName(_: number, b: BoardInfo): string { return b.name; }
}
