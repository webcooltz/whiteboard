// End-to-end check of the real drawing/sync code in a real browser against the real server.
// Run:  node test/e2e/e2e.cjs      (needs Playwright's Chromium, which is preinstalled in the sandbox)
const { chromium } = require('playwright');
const { stripTypeScriptTypes } = require('node:module');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildHarness(dir) {
  fs.mkdirSync(path.join(dir, 'board'), { recursive: true });
  const src = path.join(root, 'src/app/board');
  for (const f of fs.readdirSync(src).filter((f) => f.endsWith('.ts'))) {
    let js = stripTypeScriptTypes(fs.readFileSync(path.join(src, f), 'utf8'), { mode: 'strip' });
    js = js.replace(/(from\s+['"]\.\/[\w-]+)(['"])/g, '$1.js$2');
    fs.writeFileSync(path.join(dir, 'board', f.replace(/\.ts$/, '.js')), js);
  }
  fs.copyFileSync(path.join(__dirname, 'harness.js'), path.join(dir, 'harness.js'));
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset=utf-8><body style="margin:0">
<div style="position:relative;width:800px;height:450px;background:#fff">
<canvas id=main tabindex=0 width=1600 height=900 style="position:absolute;left:0;top:0;width:800px;height:450px"></canvas>
<canvas id=overlay width=1600 height=900 style="position:absolute;left:0;top:0;width:800px;height:450px;pointer-events:none"></canvas></div>
<script type=module src=/harness.js></script>`);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-e2e-'));
  const web = path.join(tmp, 'web');
  buildHarness(web);
  const { createServer } = await import(path.join(root, 'server/index.mjs'));
  const { loadConfig } = await import(path.join(root, 'server/config.mjs'));
  const app = await createServer(loadConfig({ DATA_DIR: path.join(tmp, 'data'), WEB_ROOT: web, BOARD_PASSWORD: 'pw-test-1234', HOST: '127.0.0.1' }));
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${app.server.address().port}/`;

  const browser = await chromium.launch();
  const open = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 820, height: 470 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { throw e; });
    page.on('console', (m) => { if (m.type() === 'error') console.log('  [console error]', m.text()); });
    await page.goto(url);
    await page.evaluate((n) => window.start(n), name);
    return page;
  };
  const same = async (a, b, what) => {
    await sleep(250);
    const [ha, hb] = [await a.evaluate(() => window.hash()), await b.evaluate(() => window.hash())];
    assert.deepEqual(ha, hb, `${what}: canvases differ (${JSON.stringify(ha)} vs ${JSON.stringify(hb)})`);
    return ha;
  };
  const results = [];
  const check = async (name, fn) => { await fn(); results.push(name); console.log('  ok -', name); };

  const ann = await open('Ann');
  const bob = await open('Bob');

  await check('mouse drag on Ann appears identically on Bob (canvas is CSS-scaled 2x)', async () => {
    await ann.mouse.move(100, 100);
    await ann.mouse.down();
    for (let i = 1; i <= 30; i++) await ann.mouse.move(100 + i * 10, 100 + Math.sin(i / 3) * 40, { steps: 2 });
    await ann.mouse.up();
    const h = await same(ann, bob, 'mouse stroke');
    assert.ok(h.nonEmpty > 3000, 'something was drawn');
  });

  await check('touch and pen pointers draw too', async () => {
    const before = (await bob.evaluate(() => window.hash())).nonEmpty;
    for (const [type, y] of [['touch', 600], ['pen', 700]]) {
      await ann.evaluate(([t, y]) => {
        window.pointer('pointerdown', 200, y, t); for (let i = 1; i < 20; i++) window.pointer('pointermove', 200 + i * 30, y + (i % 2) * 20, t); window.pointer('pointerup', 800, y, t);
      }, [type, y]);
    }
    const h = await same(ann, bob, 'touch+pen');
    assert.ok(h.nonEmpty > before + 3000);
  });

  await check('keyboard drawing: arrows move, space starts/stops, Bob sees it', async () => {
    const before = (await bob.evaluate(() => window.hash())).nonEmpty;
    await ann.evaluate(() => document.getElementById('main').focus());
    await ann.keyboard.press('Shift+ArrowUp'); await ann.keyboard.press('Shift+ArrowUp');
    await ann.keyboard.press('Space');
    for (let i = 0; i < 8; i++) await ann.keyboard.press('Shift+ArrowRight');
    for (let i = 0; i < 6; i++) await ann.keyboard.press('ArrowDown');
    await ann.keyboard.press('Space');
    await ann.keyboard.press('ArrowLeft'); // moving while "pen up" must not draw
    const h = await same(ann, bob, 'keyboard');
    assert.ok(h.nonEmpty > before + 2000);
  });

  await check('spray paint is pixel-identical on every screen (seeded)', async () => {
    await ann.evaluate(() => window.setTool('Spraypaint', 'spraypaint'));
    await ann.evaluate(() => { window.pointer('pointerdown', 1200, 200, 'mouse', 1); for (let i = 1; i < 25; i++) window.pointer('pointermove', 1200 + i * 6, 200 + i * 4, 'mouse', 1); window.pointer('pointerup', 1350, 300, 'mouse', 1); });
    await same(ann, bob, 'spray');
  });

  await check('line tool: Bob sees a live preview, then the final line; dashed works', async () => {
    await ann.evaluate(() => window.setTool('Line', 'dashed', { brushSize: 6, color: '#0000cc' }));
    await ann.evaluate(() => { window.pointer('pointerdown', 900, 500, 'mouse', 2); window.pointer('pointermove', 1300, 600, 'mouse', 2); });
    await sleep(250);
    const preview = await bob.evaluate(() => ({ active: window.view.active.size, o: [...window.view.active.values()][0]?.p }));
    assert.equal(preview.active, 1, 'Bob has the line in progress');
    assert.deepEqual(preview.o.slice(-2), [1300, 600]);
    await ann.evaluate(() => { window.pointer('pointermove', 1500, 700, 'mouse', 2); window.pointer('pointerup', 1500, 700, 'mouse', 2); });
    await same(ann, bob, 'line');
    const s = await bob.evaluate(() => window.view.committed.at(-1));
    assert.equal(s.tool, 'line'); assert.deepEqual(s.p, [900, 500, 1500, 700]);
  });

  await check('eraser removes pixels on both screens', async () => {
    const before = (await bob.evaluate(() => window.hash())).nonEmpty;
    await ann.evaluate(() => window.setTool('Eraser', 'eraser', { brushSize: 20 }));
    await ann.evaluate(() => { window.pointer('pointerdown', 220, 200, 'mouse', 3); for (let i = 1; i < 40; i++) window.pointer('pointermove', 220 + i * 12, 200 + (i % 4) * 10, 'mouse', 3); window.pointer('pointerup', 700, 220, 'mouse', 3); });
    const h = await same(ann, bob, 'eraser');
    assert.ok(h.nonEmpty < before, 'pixels were erased');
  });

  await check('Ctrl+Z undoes only your own last stroke', async () => {
    await bob.evaluate(() => window.setTool('Pen', 'pen', { color: '#00aa00', brushSize: 10 }));
    await bob.evaluate(() => { window.pointer('pointerdown', 300, 800, 'mouse', 4); window.pointer('pointermove', 700, 850, 'mouse', 4); window.pointer('pointerup', 700, 850, 'mouse', 4); });
    await same(ann, bob, 'bob stroke');
    const n = await ann.evaluate(() => window.view.committed.length);
    await ann.evaluate(() => document.getElementById('main').focus());
    await ann.keyboard.press('Control+z');
    await sleep(300);
    const [na, nb] = [await ann.evaluate(() => window.view.committed.length), await bob.evaluate(() => window.view.committed.length)];
    assert.equal(na, n - 1); assert.equal(nb, n - 1);
    const lastUsers = await bob.evaluate(() => window.view.committed.map((s) => s.user));
    assert.ok(lastUsers.includes('Bob'), "Bob's stroke survived Ann's undo");
    await same(ann, bob, 'after undo');
  });

  await check("remote cursors show up on the other person's overlay", async () => {
    await ann.mouse.move(400, 300); await ann.mouse.move(420, 310);
    await sleep(300);
    const cur = await bob.evaluate(() => [...window.view.cursors.keys()]);
    assert.deepEqual(cur, ['Ann']);
  });

  await check('pencil, marker, highlighter and crayon: identical on every screen (and for late joiners, below)', async () => {
    const before = (await bob.evaluate(() => window.hash())).nonEmpty;
    for (const [i, tool] of ['Pencil', 'Marker', 'Highlighter', 'Crayon'].entries()) {
      await ann.evaluate(([tool, i]) => {
        window.setTool(tool, tool.toLowerCase(), { color: '#7a3cf0', brushSize: 9 });
        const y = 120 + i * 180, id = 20 + i;
        window.pointer('pointerdown', 300, y, 'pen', id);
        for (let k = 1; k < 40; k++) window.pointer('pointermove', 300 + k * 25, y + Math.sin(k / 4) * 50, 'pen', id);
        window.pointer('pointerup', 1300, y, 'pen', id);
      }, [tool, i]);
    }
    const h = await same(ann, bob, 'new brushes');
    assert.ok(h.nonEmpty > before + 20000, 'the brushes drew');
    const tools = await bob.evaluate(() => window.view.committed.slice(-4).map((s) => s.tool));
    assert.deepEqual(tools, ['pencil', 'marker', 'highlighter', 'crayon']);
  });

  await check('a screen that joins late gets exactly the same board', async () => {
    const carol = await open('Carol');
    await same(ann, carol, 'late join');
    await carol.context().close();
  });

  await check('erase board empties every screen, and a saved board can be loaded back', async () => {
    const full = await ann.evaluate(() => window.hash());
    await ann.evaluate(() => window.client.send({ t: 'save', name: 'Sunday sketch' }));
    await ann.evaluate(() => window.client.send({ t: 'clear' }));
    await sleep(300);
    assert.equal((await bob.evaluate(() => window.hash())).nonEmpty, 0);
    await ann.evaluate(() => window.client.send({ t: 'load', name: 'Sunday sketch' }));
    await sleep(400);
    assert.deepEqual(await bob.evaluate(() => window.hash()), full);
    assert.deepEqual(await ann.evaluate(() => window.hash()), full);
  });

  await check('drawing is blocked (not silently lost) while offline', async () => {
    const dave = await open('Dave');
    await dave.evaluate(() => window.client.stop());
    const before = await dave.evaluate(() => window.view.committed.length + window.view.active.size);
    await dave.evaluate(() => { window.pointer('pointerdown', 50, 50, 'mouse', 9); window.pointer('pointermove', 90, 90, 'mouse', 9); window.pointer('pointerup', 90, 90, 'mouse', 9); });
    assert.equal(await dave.evaluate(() => window.view.committed.length + window.view.active.size), before);
    await dave.context().close();
  });

  await ann.screenshot({ path: path.join(tmp, 'ann.png') });
  const png = path.join(tmp, 'board.png');
  fs.writeFileSync(png, Buffer.from(await ann.evaluate(async () => {
    const b = await window.view.toBlob(); return Array.from(new Uint8Array(await b.arrayBuffer()));
  })));
  console.log('\nscreenshot:', png);
  console.log(`\n${results.length} browser checks passed`);
  await browser.close();
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
