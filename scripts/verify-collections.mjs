import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { launchBrowser } from "./browser.mjs";
import { createEmptyBoard, commitStep, serializeBoard, parseBoard, contentEqual, replayTo } from "../dist-model/index.js";
const port = 4191;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { stdio: "ignore" });
let browser;
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}`); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; });
  await page.goto(`http://127.0.0.1:${port}`);
  const ns = [
    { id: "n_member01", type: "text", markdown: "系统边界", caption: "跨学科的物质与能量关系", x: 360, y: 250, w: 240 },
    { id: "n_member02", type: "text", markdown: "$$E=mc^2$$", x: 760, y: 420, w: 180, h: 70 },
    { id: "n_member03", type: "text", markdown: "同一系统里的状态量", caption: "状态描述与边界条件\n".repeat(20), x: 1080, y: 180, w: 240 },
  ];
  const created = commitStep(createEmptyBoard("集合回归"), "卡片", "user", ns.map(node => ({ op: "addNode", node, before: null, after: node })));
  assert.ok(created.ok);
  async function open(bytes) {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "打开", exact: true }).click()]);
    await chooser.setFiles({ name: "collections.draft", mimeType: "application/octet-stream", buffer: Buffer.from(bytes) });
  }
  await open(serializeBoard(created.state, {}));
  const card = id => page.locator(`[data-node-id="${id}"]`);
  await card(ns[0].id).waitFor(); await page.evaluate(() => document.fonts.ready);
  async function choose(ids) {
    await page.keyboard.down("Control");
    for (const id of ids) await card(id).locator(".node-rendered").first().click();
    await page.keyboard.up("Control");
  }
  const button = name => page.getByRole("button", { name, exact: true });
  await choose(ns.slice(0, 2).map(n => n.id));
  await button("所选建集合").click();
  await page.locator(".collection-frame").waitFor();
  const name = page.getByRole("textbox", { name: "集合名称", exact: true });
  await name.fill("物质与能量关系");
  await name.dispatchEvent("compositionstart");
  await name.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  assert.equal(await name.evaluate(el => document.activeElement === el), true, "输入法 Enter 不提前提交");
  await name.dispatchEvent("compositionend"); await name.press("Enter");
  const description = page.getByRole("textbox", { name: "集合关系说明" });
  await description.fill("共同描述系统的守恒关系，集合允许共享成员"); await description.press("Enter");
  await choose(ns.slice(1).map(n => n.id)); await button("所选建集合").click();
  assert.equal(await page.locator(".collection-frame").count(), 2);
  await page.getByLabel("集合形状", { exact: true }).selectOption("ellipse");
  assert.equal(await page.locator(".collection-outline ellipse").count(), 1);
  // 集合一的共享成员移动，同时集合二自适应。
  const firstId = await page.locator(".collection-frame").first().getAttribute("data-collection-id");
  await page.getByLabel("当前集合").selectOption(firstId);
  const before = await Promise.all(ns.map(n => card(n.id).boundingBox()));
  const label = page.locator(".collection-frame").first().locator(".collection-label");
  const lb = await label.boundingBox();
  await page.mouse.move(lb.x + 30, lb.y + 10); await page.mouse.down(); await page.mouse.move(lb.x + 100, lb.y + 70, { steps: 8 }); await page.mouse.up();
  const after = await Promise.all(ns.map(n => card(n.id).boundingBox()));
  for (const i of [0, 1]) { assert.ok(Math.abs(after[i].x - before[i].x - 70) < 2); assert.ok(Math.abs(after[i].y - before[i].y - 60) < 2); }
  assert.equal(after[2].x, before[2].x);
  await button("撤销").click();
  assert.ok(Math.abs((await card(ns[0].id).boundingBox()).x - before[0].x) < 2);
  await page.getByLabel("当前集合").selectOption(firstId);
  await button("水平中轴对齐").click();
  const aligned = await Promise.all(ns.slice(0, 2).map(n => card(n.id).boundingBox()));
  assert.ok(Math.abs(aligned[0].y + aligned[0].height / 2 - aligned[1].y - aligned[1].height / 2) < 2);
  await button("网格排版").click();
  await page.getByLabel("统一核心宽度", { exact: true }).fill("220"); await button("统一核心宽度").click();
  await button("网格排版").click();
  await choose([ns[2].id]); await button("加入所选").click();
  assert.match(await label.textContent(), /3 张/);
  await button("移出所选").click(); assert.match(await label.textContent(), /2 张/);
  await page.getByLabel("集合形状", { exact: true }).selectOption("circle");
  const circle = await page.locator(".collection-frame").first().boundingBox(); assert.ok(Math.abs(circle.width - circle.height) < 1);
  await page.getByLabel("集合形状", { exact: true }).selectOption("rectangle");
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/collections-default.png" });
  await page.mouse.move(900, 600); await page.keyboard.down("Control"); await page.mouse.wheel(0, 250); await page.keyboard.up("Control");
  await page.waitForTimeout(150);
  await page.screenshot({ path: "artifacts/collections-zoom.png" });
  await button("解散集合").click(); assert.equal(await page.locator(".collection-frame").count(), 1); assert.equal(await page.locator(".node-card").count(), 3);
  await button("撤销").click(); assert.equal(await page.locator(".collection-frame").count(), 2);
  const [download] = await Promise.all([page.waitForEvent("download"), button("保存").click()]);
  const bytes = readFileSync(await download.path()), saved = parseBoard(bytes).file;
  assert.equal(saved.collections.length, 2); assert.equal(saved.formatVersion, "2.0"); assert.ok(contentEqual(replayTo(saved), saved));
  await open(bytes); assert.equal(await page.locator(".collection-frame").count(), 2);
  const [png] = await Promise.all([page.waitForEvent("download"), button("导出 PNG").click()]);
  assert.ok(readFileSync(await png.path()).length > 1000);
  assert.deepEqual(errors, []);
  console.log("PASS collections: sharing, drag/undo, geometry, layout, IME, membership, ZIP/replay and PNG");
} finally { await browser?.close(); server.kill(); }
