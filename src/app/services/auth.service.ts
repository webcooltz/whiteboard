import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

const TOKEN_KEY = 'wb-token';
const USER_KEY = 'wb-user';
const DEVKEY_KEY = 'wb-devkey';
const PW_KEY = 'wb-pw';
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
  /** The signed-in name, or the last one used (to pre-fill the name box). */
  user = '';
  error = '';
  busy = false;
  /** Raspberry Pi / wall display that only shows the board. */
  readOnly = false;
  tokenChanged = new Subject<string | null>();
  private lastStatus = 0;

  constructor() {
    // Kiosk URL looks like  http://board.local:8080/#display&pw=PASSWORD&name=Kitchen  (see deploy/pi/kiosk.sh),
    // or  #display&key=DEVICEKEY  for a fixed-name display; add &ro for view-only.
    // The hash is never sent to the server; we store what it carries and strip it from the address bar.
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (hash.has('display') || hash.has('key') || hash.has('pw')) {
      if (hash.get('key')) write(DEVKEY_KEY, hash.get('key'));
      if (hash.get('pw')) write(PW_KEY, hash.get('pw'));
      if (hash.get('name') && !read(USER_KEY)) write(USER_KEY, hash.get('name'));
      write(DISPLAY_KEY, hash.has('ro') ? 'ro' : '1');
      history.replaceState(null, '', location.pathname + location.search);
    }
    this.readOnly = read(DISPLAY_KEY) === 'ro';
    this.user = read(USER_KEY) ?? '';

    const saved = read(TOKEN_KEY);
    if (saved && !this.expired(saved)) this.token = saved;
    else void this.autoLogin();
  }

  /** False on a kiosk that was given the password (or a device key): it only needs a name. */
  get needsPassword(): boolean { return !read(PW_KEY) && !read(DEVKEY_KEY); }

  /** Device-key screens have a fixed name. */
  get canRename(): boolean { return !read(DEVKEY_KEY); }

  private expired(token: string): boolean {
    try {
      const body = JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
      return typeof body.exp !== 'number' || body.exp < Date.now() + 60_000;
    } catch {
      return true;
    }
  }

  private async post(url: string, body: unknown, token?: string): Promise<boolean> {
    this.busy = true;
    this.error = '';
    this.lastStatus = 0;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      this.lastStatus = res.status;
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
    if (token) {
      this.user = user;
      write(USER_KEY, user); // kept after the session ends, to pre-fill the name box
    }
    write(TOKEN_KEY, token);
    this.tokenChanged.next(token);
  }

  /** Sign in without asking, when this screen has a device key, or a stored password and a name. */
  private async autoLogin(): Promise<boolean> {
    const key = read(DEVKEY_KEY);
    if (key) return this.post('/api/login', { deviceKey: key });
    if (!read(PW_KEY) || !this.user) return false;
    const ok = await this.login(this.user);
    if (!ok && this.lastStatus === 401) write(PW_KEY, null); // the password in .env changed: ask for it
    return ok;
  }

  /** `password` may be left out on a kiosk that stored it. */
  login(name: string, password?: string): Promise<boolean> {
    return this.post('/api/login', { name, password: password || read(PW_KEY) || '' });
  }

  /** Change the name on the current session (the server issues a new token). */
  rename(name: string): Promise<boolean> {
    if (!this.token) return Promise.resolve(false);
    return this.post('/api/rename', { name }, this.token);
  }

  /** The server rejected our token (expired, or the server secret changed). */
  async handleRejected(): Promise<void> {
    this.setSession(null, '');
    await this.autoLogin();
  }
}
