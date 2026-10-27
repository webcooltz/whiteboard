import { BoardView } from './board/board-view.js';
import { BoardClient } from './board/board-client.js';
import { InputController } from './board/input.js';
import { toolStateFrom } from './board/tool-state.js';

// Mirrors what the Angular components do, minus Angular, so the real logic can be tested in a browser.
window.start = async (name) => {
  const r = await fetch('/api/login', { method: 'POST', body: JSON.stringify({ name, password: 'pw-test-1234' }) });
  const { token } = await r.json();
  const canvas = document.getElementById('main');
  const overlay = document.getElementById('overlay');
  const view = new BoardView(canvas.getContext('2d'), overlay.getContext('2d'), 1600, 900);
  const client = new BoardClient(() => `ws://${location.host}/ws`, () => token);
  const sel = {
    tool: { name: 'Pen', selectedOption: { name: 'pen' } }, color: '#d00000', brushSize: 8, brushShape: 'round',
    sprayOptions: { radius: 30, density: 60 },
  };
  const input = new InputController(canvas, view, () => toolStateFrom(sel), client);
  input.user = name;
  window.sel = sel; window.view = view; window.client = client; window.input = input;
  window.log = [];
  client.onMessage = (m) => {
    window.log.push(m.t);
    if (m.t === 'hello') view.reset(m.strokes);
    else if (m.t === 'begin') view.begin(m);
    else if (m.t === 'pts') view.pts(m.id, m.p);
    else if (m.t === 'end') view.end(m.id);
    else if (m.t === 'put') view.put(m.s);
    else if (m.t === 'remove') view.remove(m.id);
    else if (m.t === 'reset') view.reset(m.strokes);
    else if (m.t === 'cur') view.setCursor(m.user, m.x, m.y);
  };
  client.start();
  await new Promise((res) => { const i = setInterval(() => { if (client.online) { clearInterval(i); res(); } }, 20); });
};
window.setTool = (name, option, extra = {}) => {
  window.sel.tool = { name, selectedOption: { name: option } };
  Object.assign(window.sel, extra);
};
window.hash = () => {
  const d = document.getElementById('main').getContext('2d').getImageData(0, 0, 1600, 900).data;
  let h = 2166136261, nonEmpty = 0;
  for (let i = 0; i < d.length; i += 4) { h = Math.imul(h ^ d[i + 3] ^ (d[i] << 8) ^ (d[i + 1] << 16), 16777619) >>> 0; if (d[i + 3]) nonEmpty++; }
  return { h, nonEmpty };
};
window.pointer = (type, x, y, pointerType = 'touch', id = 7) => {
  const c = document.getElementById('main');
  const r = c.getBoundingClientRect();
  c.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: id, pointerType, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: r.left + (x / 1600) * r.width, clientY: r.top + (y / 900) * r.height,
  }));
};
