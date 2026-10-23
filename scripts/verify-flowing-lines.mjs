import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { launchBrowser, prepareFixtureOpen } from './browser.mjs';
import { commitStep, createEmptyBoard, parseBoard, serializeBoard } from '../dist-model/index.js';

const port = 4196;
// An explicit local preview URL also verifies the same build served to the installed desktop app.
const url = process.env.DRAFT_FLOW_URL || `http://127.0.0.1:${port}/`;
const server = process.env.DRAFT_FLOW_URL ? null : spawn(process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  for (let i = 0; ; i++) {
    try { await fetch(url); break; }
    catch { if (i > 60) throw new Error('Flowing line preview did not start'); await new Promise(r => setTimeout(r, 200)); }
  }
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, reducedMotion: 'no-preference' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    delete window.showOpenFilePicker; delete window.showSaveFilePicker;
    const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    Object.defineProperty(HTMLImageElement.prototype, 'src', { ...src, set(value) {
      if (value.startsWith('data:image/svg+xml;charset=utf-8,')) window.__exportSvg = decodeURIComponent(value.split(',').slice(1).join(','));
      src.set.call(this, value);
    } });
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('.app-version').textContent(), `v${JSON.parse(readFileSync('package.json', 'utf8')).version}`);
  mkdirSync('artifacts', { recursive: true });
  const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const open = async file => {
    await prepareFixtureOpen(page);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: '打开', exact: true }).click()]);
    await chooser.setFiles({ name: '流动虚线测试.draft', mimeType: 'application/octet-stream', buffer: Buffer.from(serializeBoard(file, {})) });
    await page.waitForFunction(id => window.__state.file.board.id === id && !window.__state.selection.edges.length && !window.__state.selection.nodes.length, file.board.id);
    await page.evaluate(() => document.fonts.ready); await settle();
  };
  const n = (id, markdown, x, y, caption) => ({ id: `n_${id}`, type: 'text', markdown, x, y, w: 240, ...(caption ? { caption, captionW: 300 } : {}) });
  const nodes = [
    n('flowfrom1', '$$Q=mc\\Delta T$$', 120, 200, '自由曲线沿箭头流动，保留公式与说明。'), n('flowto001', '形成初步结论', 1120, 200),
    n('flowblock1', '待核实的证据', 620, 160, '线条绕过卡片和独立备注。'),
    n('flowfrom2', '比较可选方案', 120, 480), n('flowto002', '由人决定', 1120, 480),
    n('flowblock2', '需要补充的条件', 620, 440, '流程折线保留清楚的转折。'),
    n('flowfrom3', '记录依据', 120, 760), n('flowto003', '相关背景', 1120, 760),
  ];
  const e = (id, from, to, routing, stroke, label, directed = true, kind = 'association') => ({ id: `e_${id}`, from: `n_${from}`, to: `n_${to}`, kind, directed, routing, ...(stroke ? { stroke } : {}), label });
  const edges = [
    e('flowcurve', 'flowfrom1', 'flowto001', 'curve', 'solid', '向右推导'),
    e('flowreverse', 'flowto001', 'flowfrom1', 'curve', 'flowing-dashed', '向左追溯'),
    e('flowortho', 'flowfrom2', 'flowto002', 'orthogonal', 'solid', '向右选择'),
    e('flownone0', 'flowfrom3', 'flowto003', 'curve', 'flowing-dashed', '无箭头：静态关联', false),
    e('flowparent', 'flowfrom2', 'flowfrom3', 'orthogonal', 'flowing-dashed', '向下展开', true, 'parentChild'),
    e('flowback0', 'flowto003', 'flowto002', 'orthogonal', 'flowing-dashed', '反馈向上'),
    e('flowdefault', 'flowfrom1', 'flowfrom2', 'curve', undefined, '默认：静态实线', true, 'parentChild'),
  ];
  const seed = commitStep(createEmptyBoard('流动虚线 · 方向与静态对照'), '合成测试草稿', 'agent', [
    ...nodes.map(node => ({ op: 'addNode', node, before: null, after: node })),
    ...edges.map(edge => ({ op: 'addEdge', edge, before: null, after: edge })),
  ]);
  assert.equal(seed.ok, true); await open(seed.state);
  await page.getByRole('button', { name: '适应视图', exact: true }).click(); await settle();
  const path = id => page.locator(`[data-edge-id="${id}"] .edge-path`);
  const select = async (id, multi = false) => {
    const hit = page.locator(`[data-edge-id="${id}"] .edge-hit`);
    const at = await hit.evaluate(el => {
      const p = el.getPointAtLength(el.getTotalLength() * .3), q = new DOMPoint(p.x, p.y).matrixTransform(el.getScreenCTM());
      return { x: q.x, y: q.y };
    });
    if (multi) await page.keyboard.down('Shift');
    try { await page.mouse.click(at.x, at.y); } finally { if (multi) await page.keyboard.up('Shift'); }
    await page.waitForFunction(id => window.__state.selection.edges.includes(id), id);
  };
  const setStroke = async value => {
    const entry = page.getByRole('button', { name: '外形与连线 ▾', exact: true });
    if (await entry.getAttribute('aria-expanded') !== 'true') await entry.click();
    await page.getByRole('combobox', { name: '线条样式', exact: true }).selectOption(value); await settle();
    assert.equal(await page.evaluate(() => window.__state.saveError), null);
  };
  const stopMenu = async () => {
    const close = page.getByRole('button', { name: '收起设置', exact: true }); if (await close.isVisible()) await close.click();
  };
  const originalPaths = await page.locator('.edge-path').evaluateAll(els => els.map(el => el.getAttribute('d')));
  await select('e_flowcurve'); await select('e_flowortho', true);
  const before = await page.evaluate(() => window.__state.file);
  await setStroke('flowing-dashed');
  assert.equal(await page.evaluate(() => window.__state.file.history.length), before.history.length + 1, 'multi-edge change is a single step');
  assert.deepEqual(await page.evaluate(() => window.__state.file.nodes), before.nodes);
  assert.deepEqual(await page.locator('.edge-path').evaluateAll(els => els.map(el => el.getAttribute('d'))), originalPaths, 'animation does not alter routes');
  await setStroke('flowing-dashed');
  assert.equal(await page.evaluate(() => window.__state.file.history.length), before.history.length + 1, 'same style is a no-op');
  await stopMenu();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__state.file.edges), before.edges);
  await page.getByRole('button', { name: '重做', exact: true }).click(); await settle();
  for (const id of ['e_flowcurve', 'e_flowreverse', 'e_flowortho', 'e_flowparent', 'e_flowback0']) {
    const sample = await path(id).evaluate(el => {
      const animation = el.getAnimations()[0]; if (!animation) return null;
      animation.pause(); animation.currentTime = 0; const start = getComputedStyle(el).strokeDashoffset;
      animation.currentTime = 200; const next = getComputedStyle(el).strokeDashoffset;
      const first = el.getPointAtLength(0), last = el.getPointAtLength(el.getTotalLength());
      const marker = el.ownerSVGElement.querySelector(el.getAttribute('marker-end').slice(4, -1));
      const result = { start, next, dash: getComputedStyle(el).strokeDasharray, first: { x: first.x, y: first.y }, last: { x: last.x, y: last.y }, markerAnimations: marker.getAnimations({ subtree: true }).length };
      animation.play(); return result;
    });
    assert.ok(sample, `${id} has an active animation`); assert.equal(sample.dash, '6px, 4px');
    assert.ok(parseFloat(sample.next) < parseFloat(sample.start), 'dash phase advances toward the arrow');
    assert.equal(sample.markerAnimations, 0, 'arrowhead stays still');
    if (id === 'e_flowreverse') assert.ok(sample.first.x > sample.last.x, 'reverse edge path also starts at its source');
    if (id === 'e_flowback0') assert.ok(sample.first.y > sample.last.y, 'feedback path runs upward toward its target');
  }
  for (const id of ['e_flownone0', 'e_flowdefault']) assert.equal(await path(id).evaluate(el => el.getAnimations().length), 0);
  assert.equal(await path('e_flownone0').getAttribute('marker-end'), null);
  const stamp = await page.evaluate(() => [window.__state.file.board.contentVersion, window.__state.file.history.length]);
  const liveTime = await path('e_flowcurve').evaluate(el => el.getAnimations()[0].currentTime);
  await settle(); await settle();
  assert.ok(await path('e_flowcurve').evaluate((el, t) => el.getAnimations()[0].currentTime > t, liveTime), 'animation runs without model updates');
  assert.deepEqual(await page.evaluate(() => [window.__state.file.board.contentVersion, window.__state.file.history.length]), stamp);

  await select('e_flownone0'); await setStroke('flowing-dashed');
  await page.getByText('无箭头的连线保持静态虚线。', { exact: true }).waitFor(); await stopMenu();
  await select('e_flowcurve'); await setStroke('dashed');
  assert.equal(await path('e_flowcurve').evaluate(el => el.getAnimations().length), 0, 'static dash selection stops motion');
  await setStroke('flowing-dashed'); await stopMenu();
  await page.emulateMedia({ reducedMotion: 'reduce' }); await settle();
  assert.equal(await path('e_flowcurve').evaluate(el => el.getAnimations().length), 0);
  assert.equal(await path('e_flowcurve').evaluate(el => getComputedStyle(el).strokeDasharray), '6px, 4px');
  assert.equal(await page.evaluate(() => window.__state.file.edges.find(e => e.id === 'e_flowcurve').stroke), 'flowing-dashed');
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await settle();
  assert.equal(await path('e_flowcurve').evaluate(el => el.getAnimations().length), 1);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '保存', exact: true }).click()]);
  const saved = parseBoard(readFileSync(await download.path())).file;
  assert.equal(saved.edges.find(e => e.id === 'e_flowcurve').stroke, 'flowing-dashed');
  writeFileSync('artifacts/flowing-lines-demo.draft', serializeBoard(saved, {}));
  await open(saved); await settle(); assert.equal(await path('e_flowcurve').evaluate(el => el.getAnimations().length), 1);
  const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '导出 PNG', exact: true }).click()]);
  await png.saveAs('artifacts/flowing-lines-export.png'); assert.ok(readFileSync(await png.path()).length > 1000);
  const exportStyles = await page.evaluate(() => [...new DOMParser().parseFromString(window.__exportSvg, 'image/svg+xml').querySelectorAll('.edge-flow-active')]
    .map(el => ({ animation: el.style.animationName, offset: el.style.strokeDashoffset })));
  assert.equal(exportStyles.length, 5); for (const style of exportStyles) assert.deepEqual(style, { animation: 'none', offset: '0' });
  assert.equal(await path('e_flowcurve').evaluate(el => el.getAnimations().length), 1, 'export leaves live motion running');
  await page.getByRole('button', { name: '回放', exact: true }).click();
  await page.locator('.replay-shade').waitFor();
  const duringReplay = await page.evaluate(() => window.__state.file.history.length);
  assert.equal(await page.locator('.edge-hit').count(), 0, 'replay exposes no editable edge hit targets');
  assert.equal(await page.getByRole('button', { name: '外形与连线 ▾', exact: true }).count(), 0, 'replay clears selection and hides appearance editing');
  await page.keyboard.press('Escape'); await settle();
  assert.equal(await page.evaluate(() => window.__state.file.history.length), duringReplay);
  await page.getByRole('button', { name: '适应视图', exact: true }).click(); await settle();
  await page.screenshot({ path: 'artifacts/flowing-lines.png' });
  await page.locator('.canvas').hover(); await page.keyboard.down('Control'); await page.mouse.wheel(0, 350); await page.keyboard.up('Control'); await settle();
  assert.notEqual(await page.evaluate(() => window.__state.file.board.view.zoom), 1);
  assert.equal(await path('e_flowortho').evaluate(el => el.getAnimations().length), 1);
  await page.screenshot({ path: 'artifacts/flowing-lines-zoom.png' });
  assert.deepEqual(errors, []);
  console.log(`FLOWING LINES PASS (${url}): arrow direction on curves, elbows, reverse/feedback/parent edges; defaults and undirected stay still; multi-select, undo/redo, no-op, save/reopen, reduced motion, replay, zoom and static PNG.`);
} finally { await browser?.close(); server?.kill(); }
