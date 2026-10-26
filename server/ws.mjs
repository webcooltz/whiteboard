// Minimal RFC 6455 WebSocket server (text frames only, no extensions).
// Zero dependencies so the board can run on a Pi with nothing but Node installed.
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function acceptKey(key) {
  return createHash('sha1').update(key + GUID).digest('base64');
}

export class WsConnection extends EventEmitter {
  constructor(socket, { maxPayload = 256 * 1024 } = {}) {
    super();
    this.socket = socket;
    this.maxPayload = maxPayload;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragBytes = 0;
    this.open = true;
    this.alive = true;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.#onData(d));
    socket.on('close', () => this.#closed());
    socket.on('error', () => this.terminate());
  }

  #closed() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  #onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    try {
      let frame;
      while (this.open && (frame = this.#parse())) this.#handle(frame);
    } catch (e) {
      this.close(e.code || 1002, e.message);
    }
  }

  #parse() {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    if (b[0] & 0x70) throw wsErr(1002, 'reserved bits set');
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    if (!masked) throw wsErr(1002, 'client frames must be masked');
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return null;
      len = b.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (b.length < 10) return null;
      const big = b.readBigUInt64BE(2);
      if (big > BigInt(this.maxPayload)) throw wsErr(1009, 'message too big');
      len = Number(big);
      off = 10;
    }
    if (len > this.maxPayload) throw wsErr(1009, 'message too big');
    if (b.length < off + 4 + len) return null;
    const mask = b.subarray(off, off + 4);
    const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    this.buf = b.subarray(off + 4 + len);
    return { fin, opcode, payload };
  }

  #handle({ fin, opcode, payload }) {
    if (opcode >= 8) {
      if (!fin || payload.length > 125) throw wsErr(1002, 'bad control frame');
      if (opcode === 8) return this.close(1000);
      if (opcode === 9) return this.#write(0xa, payload);
      if (opcode === 10) { this.alive = true; return; }
      throw wsErr(1002, 'unknown opcode');
    }
    if (opcode === 2) throw wsErr(1003, 'binary not supported');
    if (opcode === 1 && this.frags.length) throw wsErr(1002, 'unexpected new message');
    if (opcode === 0 && !this.frags.length) throw wsErr(1002, 'unexpected continuation');
    if (opcode !== 0 && opcode !== 1) throw wsErr(1002, 'unknown opcode');
    this.fragBytes += payload.length;
    if (this.fragBytes > this.maxPayload) throw wsErr(1009, 'message too big');
    this.frags.push(payload);
    if (!fin) return;
    const msg = Buffer.concat(this.frags);
    this.frags = [];
    this.fragBytes = 0;
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(msg);
    } catch {
      throw wsErr(1007, 'invalid utf-8');
    }
    this.emit('message', text);
  }

  #write(opcode, payload) {
    if (!this.open || this.socket.destroyed) return;
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | opcode, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    this.socket.write(Buffer.concat([head, payload]));
  }

  send(text) {
    this.#write(0x1, Buffer.from(text, 'utf8'));
  }

  ping() {
    this.alive = false;
    this.#write(0x9, Buffer.alloc(0));
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const r = Buffer.from(String(reason).slice(0, 100), 'utf8');
    const p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    this.#write(0x8, p);
    this.open = false;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 1000).unref();
    this.emit('close');
  }

  terminate() {
    if (this.open) {
      this.open = false;
      this.emit('close');
    }
    this.socket.destroy();
  }
}

function wsErr(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// Handle an HTTP 'upgrade' event. Returns a WsConnection or null (after replying with an HTTP error).
export function upgrade(req, socket, { maxPayload, originOk } = {}) {
  const fail = (status, text) => {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
    return null;
  };
  const key = req.headers['sec-websocket-key'];
  if ((req.headers.upgrade || '').toLowerCase() !== 'websocket' || !key) return fail(400, 'Bad Request');
  if (req.headers['sec-websocket-version'] !== '13') return fail(426, 'Upgrade Required');
  if (originOk && !originOk(req)) return fail(403, 'Forbidden');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`
  );
  return new WsConnection(socket, { maxPayload });
}
