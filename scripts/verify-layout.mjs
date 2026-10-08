import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { launchBrowser } from "./browser.mjs";
import { createEmptyBoard, commitStep, parseBoard, serializeBoard } from "../dist-model/index.js";
const port = 4192;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { stdio: "ignore" });
let browser;
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}`); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; });
  await page.goto(`http://127.0.0.1:${port}`);
  const file = createEmptyBoard("防重叠布局");
  const pixels = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYJkAAAAASUVORK5CYII=", "base64");
  file.assets = [{ id: "a_layout00", mime: "image/png", path: "assets/a_layout00.png", bytes: pixels.length }];
  const nodes = [
    { id: "n_layout01", type: "text", markdown: "系统", caption: "根节点的备注宽度远大于核心区域", captionW: 410, x: 60, y: 80, w: 40 },
    { id: "n_layout02", type: "text", markdown: "$$F=ma$$", caption: "较长公式说明\n".repeat(25), captionExpanded: true, x: 250, y: 280, w: 80, h: 50 },
    { id: "n_layout03", type: "image", assetId: "a_layout00", markdown: "图片也要按实际高度参与避让", x: 310, y: 60, w: 180 },
    { id: "n_layout04", type: "text", markdown: "独立卡片一", x: 610, y: 50, w: 40 },
    { id: "n_layout05", type: "text", markdown: "独立卡片二", caption: "备注\n".repeat(10), x: 610, y: 130, w: 40 },
  ];
  const edges = [1, 2].map((i) => ({ id: `e_layout0${i}`, kind: "parentChild", from: nodes[0].id, to: nodes[i].id, directed: true }));
  const seeded = commitStep(file, "示例", "user", [...nodes.map(node => ({ op: "addNode", node, before: null, after: node })), ...edges.map(edge => ({ op: "addEdge", edge, before: null, after: edge }))]);
  assert.ok(seeded.ok);
  const button = name => page.getByRole("button", { name, exact: true });
  const tidy = async (selectedOnly = false) => { await button("布局整理").click(selectedOnly ? { modifiers: ["Shift"] } : {}); await button("整理中…").waitFor({ state: "hidden", timeout: 120000 }); };
  async function open() {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), button("打开").click()]);
    await chooser.setFiles({ name: "layout.draft", mimeType: "application/octet-stream", buffer: Buffer.from(serializeBoard(seeded.state, { a_layout00: pixels })) });
    await page.locator(".node-card").first().waitFor();
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {}))); });
  }
  async function boxes() {
    return page.locator(".node-card").evaluateAll(cards => cards.map(c => {
      const r = c.getBoundingClientRect(); return { id: c.dataset.nodeId, x: r.x, y: r.y, w: r.width, h: r.height };
    }));
  }
  function noOverlap(rects) {
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      assert.ok(a.x + a.w <= b.x + .01 || b.x + b.w <= a.x + .01 || a.y + a.h <= b.y + .01 || b.y + b.h <= a.y + .01, `实际外框重叠：${a.id}, ${b.id}`);
    }
  }
  async function save() {
    const [d] = await Promise.all([page.waitForEvent("download"), button("保存").click()]);
    return parseBoard(readFileSync(await d.path())).file;
  }
  mkdirSync("artifacts", { recursive: true });
  for (const zoomed of [false, true]) {
    await open();
    if (zoomed) { await page.mouse.move(1000, 500); await page.keyboard.down("Control"); await page.mouse.wheel(0, 300); await page.keyboard.up("Control"); }
    await tidy();
    noOverlap(await boxes());
    const saved = await save();
    assert.equal(saved.history.length, 2, "整次整理只有一个步骤");
    assert.deepEqual(saved.edges, seeded.state.edges);
    assert.ok(saved.nodes[2].y < saved.nodes[1].y, "兄弟按视觉上下顺序排列");
    await tidy();
    assert.deepEqual((await save()).nodes, saved.nodes, "重复整理不能漂移");
    assert.equal((await save()).history.length, saved.history.length, "无变化不追加历史");
    await page.screenshot({ path: `artifacts/layout-${zoomed ? "zoom" : "default"}.png` });
    await button("适应视图").click();
    await page.screenshot({ path: `artifacts/layout-overview-${zoomed ? "zoom" : "default"}.png` });
    await button("撤销").click();
    assert.deepEqual((await save()).nodes, seeded.state.nodes, "一次撤销恢复原位置");
  }
  await open();
  await page.locator('[data-node-id="n_layout01"] .concept-core').click();
  await tidy(); noOverlap(await boxes());
  const globalWithSelection = await save();
  assert.ok(globalWithSelection.nodes.slice(3).some((node, i) => node.x !== seeded.state.nodes[i + 3].x || node.y !== seeded.state.nodes[i + 3].y), "顶栏普通点击始终整理全板");
  assert.match(await page.locator('.layout-result').textContent(), /已整理 \d+ 张卡片/);
  await open();
  await page.locator('[data-node-id="n_layout01"] .concept-core').click();
  await tidy(true); noOverlap(await boxes());
  const local = await save();
  assert.deepEqual(local.nodes.slice(3), seeded.state.nodes.slice(3), "Shift 点击只整理选中分支");
  // 密集独立卡片不应整理成长条；比较真实像素占地，而不只验证模型坐标。
  const compactFile = createEmptyBoard("紧凑布局");
  const compactNodes = Array.from({ length: 12 }, (_, i) => ({ id: `n_compact${i}`, type: "text", markdown: `概念 ${i + 1}`, x: 100 + (i % 4) * 200, y: 100 + Math.floor(i / 4) * 110, w: 240 }));
  const compact = commitStep(compactFile, "紧凑测试", "user", compactNodes.map(node => ({ op: "addNode", node, before: null, after: node })));
  assert.ok(compact.ok);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), button("打开").click()]);
  await chooser.setFiles({ name: "compact.draft", mimeType: "application/octet-stream", buffer: Buffer.from(serializeBoard(compact.state, {})) });
  await page.locator('[data-node-id="n_compact11"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  const extent = rects => ({ w: Math.max(...rects.map(r => r.x + r.w)) - Math.min(...rects.map(r => r.x)), h: Math.max(...rects.map(r => r.y + r.h)) - Math.min(...rects.map(r => r.y)) });
  await tidy();
  noOverlap(await boxes());
  const afterCompact = extent(await boxes());
  const canvasBox = await page.locator(".canvas").boundingBox();
  assert.ok(canvasBox, "画布可见");
  assert.ok(afterCompact.w > canvasBox.width * .55 && afterCompact.h > canvasBox.height * .55, "整理后卡片填充窗口");
  assert.ok(afterCompact.w < canvasBox.width && afterCompact.h < canvasBox.height, "整理后整体留在窗口内");
  assert.ok(Math.abs(Math.log((afterCompact.w / afterCompact.h) / (canvasBox.width / canvasBox.height))) < .35, "整理轮廓接近窗口宽高比");
  const compactSaved = await save();
  const rowCounts = [...new Set(compactSaved.nodes.map(n => n.y))].map(y => compactSaved.nodes.filter(n => n.y === y).length);
  // 字体度量随系统变化，行数由实测外框和窗口比例决定；验证均衡而非固定列数。
  assert.ok(rowCounts.length > 1, "紧凑布局分为多行");
  assert.equal(rowCounts.reduce((sum, count) => sum + count, 0), compactNodes.length, "每张卡片都在布局中");
  assert.ok(Math.min(...rowCounts) >= 2, "不留单张卡片的孤行");
  assert.ok(Math.max(...rowCounts) - Math.min(...rowCounts) <= 1, "各行卡片数量均衡");
  await tidy();
  assert.deepEqual((await save()).nodes, compactSaved.nodes);
  await page.screenshot({ path: "artifacts/layout-compact.png" });
  console.log("COMPACT EXTENTS", JSON.stringify({ after: afterCompact, canvas: canvasBox }));
  // 关系线和集合边界同时存在时，顶栏整理应提交并完成适应视图。
  const related = createEmptyBoard("关系与集合避让");
  const relatedNodes = [
    { id: "n_related01", type: "text", markdown: "成员 A", x: 0, y: 0, w: 100, h: 70 },
    { id: "n_related02", type: "text", markdown: "成员 B", x: 400, y: 0, w: 100, h: 70 },
    { id: "n_related03", type: "text", markdown: "外部卡片", x: 200, y: 0, w: 100, h: 70 },
  ];
  const relatedEdge = { id: "e_related01", kind: "association", from: relatedNodes[0].id, to: relatedNodes[1].id, directed: true };
  const relatedCollection = { id: "g_related01", name: "同一主题", shape: "rectangle", nodeIds: [relatedNodes[0].id, relatedNodes[1].id], x: 0, y: 0 };
  const relatedSeed = commitStep({ ...related, collections: [relatedCollection] }, "示例", "user", [...relatedNodes.map(node => ({ op: "addNode", node, before: null, after: node })), { op: "addEdge", edge: relatedEdge, before: null, after: relatedEdge }]);
  assert.ok(relatedSeed.ok);
  const [relatedChooser] = await Promise.all([page.waitForEvent("filechooser"), button("打开").click()]);
  await relatedChooser.setFiles({ name: "related.draft", mimeType: "application/octet-stream", buffer: Buffer.from(serializeBoard(relatedSeed.state, {})) });
  await page.locator('[data-node-id="n_related03"]').waitFor();
  await tidy();
  const relatedSaved = await save();
  assert.equal(relatedSaved.history.length, 2, "关系和集合参与整理且产生一个历史步骤");
  noOverlap(await boxes());
  const relatedClear = await page.evaluate(() => {
    const card = document.querySelector('[data-node-id="n_related03"]');
    const line = document.querySelector('[data-edge-id="e_related01"] .edge-path');
    const collection = document.querySelector('[data-collection-id="g_related01"]');
    if (!card || !line || !collection) return false;
    const c = { x: parseFloat(card.style.left), y: parseFloat(card.style.top), w: card.offsetWidth, h: card.offsetHeight };
    const g = { x: parseFloat(collection.style.left), y: parseFloat(collection.style.top), w: collection.offsetWidth, h: collection.offsetHeight };
    const touches = c.x < g.x + g.w + 8 && c.x + c.w > g.x - 8 && c.y < g.y + g.h + 8 && c.y + c.h > g.y - 8;
    const length = line.getTotalLength();
    const crosses = Array.from({ length: 201 }, (_, i) => line.getPointAtLength(length * i / 200)).some(p => p.x > c.x - 8 && p.x < c.x + c.w + 8 && p.y > c.y - 8 && p.y < c.y + c.h + 8);
    return !touches && !crosses;
  });
  assert.ok(relatedClear, "外部卡片避开集合边界和可见关系线");
  await tidy();
  assert.deepEqual((await save()).nodes, relatedSaved.nodes, "关系和集合布局重复整理不漂移");
  assert.deepEqual(errors, []);
  console.log("LAYOUT PASS: measured bounds, notes/images/formulas, local obstacles, order, zoom, idempotence, undo");
} finally { await browser?.close(); server.kill(); }
