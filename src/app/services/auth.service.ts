import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

const TOKEN_KEY = 'wb-token';
const USER_KEY = 'wb-user';
const DEVKEY_KEY = 'wb-devkey';
const DISPLAY_KEY = 'wb-display';

// localStorage can throw (private windows, blocked storage), so every access goes through these.
function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null): void {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* ignore */ }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  token: string | null = null;
  user = '';
  error = '';
  busy = false;
  /** Raspberry Pi / wall display: signs in with a device key instead of a typed password. */
  readOnly = false;
  tokenChanged = new Subject<string | null>();

  constructor() {
    // Kiosk URL looks like  https://board.local/#display&key=DEVICEKEY   (add &ro for view-only).
    // The hash is never sent to the server; we store the key and strip it from the address bar.
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (hash.has('display') || hash.has('key')) {
      if (hash.get('key')) write(DEVKEY_KEY, hash.get('key'));
      write(DISPLAY_KEY, hash.has('ro') ? 'ro' : '1');
      history.replaceState(null, '', location.pathname + location.search);
    }
    this.readOnly = read(DISPLAY_KEY) === 'ro';

    const saved = read(TOKEN_KEY);
    if (saved && !this.expired(saved)) {
      this.token = saved;
      this.user = read(USER_KEY) ?? '';
    } else if (read(DEVKEY_KEY)) {
      void this.deviceLogin();
    }
  }

  private expired(token: string): boolean {
    try {
      const body = JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
      return typeof body.exp !== 'number' || body.exp < Date.now() + 60_000;
    } catch {
      return true;
    }
  }

  private async post(body: unknown): Promise<boolean> {
    this.busy = true;
    this.error = '';
    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.error = data.error || 'Sign-in failed';
        return false;
      }
      this.setSession(data.token, data.user);
      return true;
    } catch {
      this.error = 'Cannot reach the server';
      return false;
    } finally {
      this.busy = false;
    }
  }

  private setSession(token: string | null, user: string): void {
    this.token = token;
    this.user = user;
    write(TOKEN_KEY, token);
    write(USER_KEY, token ? user : null);
    this.tokenChanged.next(token);
  }

  login(name: string, password: string): Promise<boolean> {
    return this.post({ name, password });
  }

  async deviceLogin(): Promise<boolean> {
    const key = read(DEVKEY_KEY);
    return key ? this.post({ deviceKey: key }) : false;
  }

  /** The server rejected our token (expired, or the server secret changed). */
  async handleRejected(): Promise<void> {
    this.setSession(null, '');
    if (read(DEVKEY_KEY)) await this.deviceLogin();
  }

  logout(): void {
    write(DEVKEY_KEY, null);
    write(DISPLAY_KEY, null);
    this.readOnly = false;
    this.setSession(null, '');
  }
}
