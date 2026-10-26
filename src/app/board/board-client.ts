export type Status = 'connecting' | 'online' | 'offline' | 'auth-failed';

/** WebSocket connection to the board server, with automatic reconnect. */
export class BoardClient {
  status: Status = 'offline';
  onStatus: ((s: Status) => void) | null = null;
  onMessage: ((m: any) => void) | null = null;
  private urlFn: () => string;
  private tokenFn: () => string | null;
  private ws: WebSocket | null = null;
  private retry = 0;
  private timer: any = null;
  private stopped = true;

  constructor(urlFn: () => string, tokenFn: () => string | null) {
    this.urlFn = urlFn;
    this.tokenFn = tokenFn;
  }

  get online(): boolean { return this.status === 'online'; }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
    this.setStatus('offline');
  }

  send(m: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.online) this.ws.send(JSON.stringify(m));
  }

  private setStatus(s: Status): void {
    if (this.status === s) return;
    this.status = s;
    this.onStatus?.(s);
  }

  private connect(): void {
    const token = this.tokenFn();
    if (!token) { this.stopped = true; this.setStatus('auth-failed'); return; }
    this.setStatus('connecting');
    const ws = new WebSocket(this.urlFn());
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token }));
    ws.onmessage = (e) => {
      let m: any;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'hello') { this.retry = 0; this.setStatus('online'); }
      else if (m.t === 'auth_fail') { this.stopped = true; this.setStatus('auth-failed'); return; }
      this.onMessage?.(m);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.stopped) return;
      this.setStatus('offline');
      const delay = Math.min(15000, 1000 * 2 ** this.retry++) + Math.random() * 500;
      this.timer = setTimeout(() => { if (!this.stopped) this.connect(); }, delay);
    };
    ws.onerror = () => { /* onclose follows */ };
  }
}
