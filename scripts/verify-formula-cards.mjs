// 真实浏览器回归：旧卡尺寸、行内/块级分式、多行公式和文字混排。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { launchBrowser } from "./browser.mjs";
import { createEmptyBoard, parseBoard, serializeBoard } from "../dist-model/index.js";

const port = 4182;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { stdio: "ignore" });
let browser;
try {
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${port}`); break; }
    catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.addInitScript(() => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  const file = createEmptyBoard("公式卡排版验证");
  file.board.view = { panX: 0, panY: 0, zoom: 1 };
  const formulas = [
    "$D_h = \\frac{4A}{P}$",
    "$$D_h = \\frac{4A}{P}$$",
    "$$\\begin{aligned}Q &= Av\\\\D_h &= \\frac{4A}{P}\\end{aligned}$$",
    "说明文字 $D_h = \\frac{4A}{P}$",
  ];
  file.nodes = formulas.map((markdown, i) => ({ id: `n_formula${i}`, type: "text", markdown, x: 80 + (i % 2) * 530, y: 100 + Math.floor(i / 2) * 280, w: i < 2 ? 400 : 240, h: i < 2 ? 210 : null, accent: "default" }));
  file.edges = [{ id: "e_formula01", from: "n_formula0", to: "n_formula1", kind: "association", directed: true }];
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "打开", exact: true }).click()]);
  await chooser.setFiles({ name: "formula-cards.draft", mimeType: "application/octet-stream", buffer: Buffer.from(serializeBoard(file, {})) });
  await page.waitForSelector('[data-node-id="n_formula0"] .katex');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const metrics = await page.evaluate(() => [...document.querySelectorAll(".formula-fit")].map((card) => {
    const c = card.getBoundingClientRect();
    const k = card.querySelector(".katex-html").getBoundingClientRect();
    return { id: card.dataset.nodeId, w: c.width, h: c.height, slackX: c.width - k.width, slackY: c.height - k.height,
      centerX: Math.abs(c.left + c.width / 2 - k.left - k.width / 2), centerY: Math.abs(c.top + c.height / 2 - k.top - k.height / 2) };
  }));
  console.log(JSON.stringify(metrics, null, 2));
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({ path: `artifacts/formula-${process.argv[2] ?? "after"}.png` });
  if (process.argv[3]) {
    const card = await page.locator('[data-node-id="n_formula0"]').boundingBox();
    await page.screenshot({ path: process.argv[3], clip: { x: card.x - 24, y: card.y - 24, width: card.width + 48, height: card.height + 48 } });
  }
  assert.equal(metrics.length, 3);
  for (const m of metrics) {
    assert.ok(m.centerX < 2 && m.centerY < 2, `${m.id}: 公式上下左右居中`);
    assert.ok(m.slackX < 40 && m.slackY < 40, `${m.id}: 无大块留白`);
  }
  for (const m of metrics.slice(0, 2)) assert.ok(Math.abs(m.w - 400) < 1, `${m.id}: 字体加载后保持保存宽度`);
  const arrow = await page.evaluate(() => {
    const path = document.querySelector(".edge-path") ?? document.querySelector("path[marker-end]");
    const start = path.getPointAtLength(0);
    const card = document.querySelector('[data-node-id="n_formula0"]');
    const target = document.querySelector('[data-node-id="n_formula1"]');
    const cx = card.offsetLeft + card.offsetWidth / 2;
    const cy = card.offsetTop + card.offsetHeight / 2;
    const tx = target.offsetLeft + target.offsetWidth / 2;
    const ty = target.offsetTop + target.offsetHeight / 2;
    return { y: start.y, expectedY: cy + (ty - cy) / (tx - cx) * (card.offsetWidth / 2 + 2) };
  });
  assert.ok(Math.abs(arrow.y - arrow.expectedY) < 1, "旧卡片连线以紧凑外框为准");
  assert.equal(await page.locator('[data-node-id="n_formula3"] .formula-scaled').count(), 0);
  console.log("FORMULA CARDS PASS");

  // 独立备注：通过真实按钮、输入、缩放、撤销和文件重开验证。
  const card = page.locator('[data-node-id="n_formula0"]');
  const readFormula = () => card.evaluate((el) => {
    const formula = el.querySelector(".formula-scaled").getBoundingClientRect();
    const note = el.querySelector(".formula-caption");
    return { w: formula.width, h: formula.height, cardH: el.getBoundingClientRect().height,
      noteFont: note && getComputedStyle(note).fontSize,
      noteInside: !note || (note.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom && note.scrollWidth <= note.clientWidth + 1) };
  });
  const baseFormula = await readFormula();
  const note = "$D_h$：水力直径\n$A$：流通截面积\n$P$：湿周";
  await card.click();
  await card.getByRole("button", { name: "+ 添加备注", exact: true }).click();
  const editor = card.locator(".formula-caption-editor");
  await editor.waitFor();
  assert.equal(await editor.evaluate((el) => document.activeElement === el), true, "添加备注自动聚焦");
  await editor.fill("变量说明");
  await editor.press("Control+a");
  await card.getByRole("button", { name: "B", exact: true }).click();
  assert.equal(await editor.inputValue(), "**变量说明**", "插入工具条作用于当前备注字段");
  assert.equal(await card.getByRole("textbox", { name: "卡片正文", exact: true }).inputValue(), formulas[0], "备注格式化不改公式正文");
  await editor.fill(note);
  await card.getByRole("textbox", { name: "卡片正文", exact: true }).click();
  assert.equal(await editor.count(), 1, "切换字段不退出编辑");
  assert.equal(await editor.inputValue(), note, "切换字段不丢备注草稿");
  await editor.click();
  await page.keyboard.press("Control+Enter");
  await card.locator(".formula-caption").waitFor();
  const afterNote = await readFormula();
  assert.ok(Math.abs(afterNote.w - baseFormula.w) < 1 && Math.abs(afterNote.h - baseFormula.h) < 1, "添加备注不改变公式大小");
  assert.ok(afterNote.cardH > baseFormula.cardH + 40 && afterNote.noteInside, "备注撑开卡片且完整显示");
  assert.equal(afterNote.noteFont, "13px");
  assert.equal(await page.locator(".node-card").count(), 4, "备注不增加卡片");
  const stateNote = await page.evaluate(() => ({ node: window.__state.file.nodes[0], step: window.__state.file.history.at(-1) }));
  assert.equal(stateNote.node.caption, note);
  assert.equal(stateNote.step.ops.length, 1);
  assert.equal(stateNote.step.ops[0].op, "updateNodeCaption");

  // 放大公式，备注字号保持正常；一次撤销恢复尺寸，再撤销移除备注。
  const handle = await card.locator(".formula-resize-handle.corner-se").boundingBox();
  await page.mouse.move(handle.x + 6, handle.y + 6);
  await page.mouse.down();
  await page.mouse.move(handle.x + 46, handle.y + 26, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const enlarged = await readFormula();
  assert.ok(enlarged.w > afterNote.w, "备注卡仍可等比放大公式");
  assert.equal(enlarged.noteFont, afterNote.noteFont, "公式缩放不放大备注");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(100);
  assert.ok(Math.abs((await readFormula()).w - baseFormula.w) < 1, "撤销恢复公式尺寸");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(100);
  assert.equal(await card.locator(".formula-caption").count(), 0, "撤销添加备注");
  await page.keyboard.press("Control+Shift+z");
  await card.locator(".formula-caption").waitFor();

  // 公式与备注在同一步修改，Esc 取消两个字段。
  await card.dblclick();
  await editor.fill("不应保存");
  await card.getByRole("textbox", { name: "卡片正文", exact: true }).fill("$$x^2$$");
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => window.__state.file.nodes[0].caption), note);
  assert.equal(await page.evaluate(() => window.__state.file.nodes[0].markdown), formulas[0]);
  await card.dblclick();
  await card.getByRole("textbox", { name: "卡片正文", exact: true }).fill("$$D_h = \\frac{4A}{P}$$");
  await editor.fill(note + "\n适用于非圆形流道");
  await page.mouse.click(1120, 700);
  await card.locator(".formula-caption").waitFor();
  const joint = await page.evaluate(() => window.__state.file.history.at(-1));
  assert.ok(joint.ops.some((o) => o.op === "updateNodeText") && joint.ops.some((o) => o.op === "updateNodeCaption"), "失焦同一步保存两个字段");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__state.file.nodes[0].caption), note);
  assert.equal(await page.evaluate(() => window.__state.file.nodes[0].markdown), formulas[0]);

  // 长备注换行；删除备注恢复紧凑高度，不重置公式缩放。
  await card.dblclick();
  await editor.fill("这是一条需要自动换行的变量解释。".repeat(20));
  await page.keyboard.press("Control+Enter");
  assert.ok((await readFormula()).noteInside, "长备注不溢出");
  await card.dblclick();
  await editor.fill("");
  await page.keyboard.press("Control+Enter");
  assert.equal(await card.locator(".formula-caption").count(), 0);
  assert.ok(Math.abs((await readFormula()).cardH - baseFormula.cardH) < 1, "清空备注恢复紧凑外框");
  await card.dblclick();
  await editor.fill(note);
  await page.keyboard.press("Control+Enter");
  await page.mouse.click(1120, 700);

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "保存", exact: true }).click()]);
  const saved = await download.path();
  assert.equal(parseBoard(new Uint8Array(readFileSync(saved))).file.nodes[0].caption, note, ".draft 存储独立备注");
  const [reopen] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "打开", exact: true }).click()]);
  await reopen.setFiles(saved);
  await card.locator(".formula-caption").waitFor();
  assert.equal(await page.evaluate(() => window.__state.file.nodes[0].caption), note, "重新打开保留备注");
  const [png] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "导出 PNG", exact: true }).click()]);
  await png.saveAs("artifacts/formula-caption-export.png");
  await page.screenshot({ path: "artifacts/formula-caption.png" });
  if (process.argv[4]) {
    const box = await card.boundingBox();
    await page.screenshot({ path: process.argv[4], clip: { x: box.x - 24, y: box.y - 24, width: box.width + 48, height: box.height + 48 } });
  }
  console.log("FORMULA CAPTIONS PASS: 编辑 / 缩放 / 撤销重做 / 取消 / 长备注 / 保存重开 / PNG 导出");
} finally {
  await browser?.close();
  server.kill();
}
