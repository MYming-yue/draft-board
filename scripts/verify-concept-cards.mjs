import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { launchBrowser } from "./browser.mjs";
import { createEmptyBoard, serializeBoard, parseBoard } from "../dist-model/index.js";

const port = 4187;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { stdio: "ignore" });
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://127.0.0.1:${port}`); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; });
  await page.goto(`http://127.0.0.1:${port}`);
  const file = createEmptyBoard("概念与解释");
  file.board.view = { panX: 0, panY: 0, zoom: 1 };
  file.nodes = [
    { id: "n_concept1", type: "text", markdown: "能量守恒", x: 90, y: 100, w: 400, h: 300 },
    { id: "n_concept2", type: "text", markdown: "系统边界决定讨论范围", caption: "描述具体对象、观测范围与条件。\n\n1. 明确系统\n2. 记录观测", x: 540, y: 100, w: 320 },
    { id: "n_formula1", type: "text", markdown: "$$E=mc^2$$", caption: "E 表示能量，m 表示质量。", x: 90, y: 400, w: 240 },
    { id: "n_picture1", type: "image", assetId: "a_picture1", markdown: "图片说明也属于备注层", x: 950, y: 100, w: 180 },
  ];
  const pixels = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYJkAAAAASUVORK5CYII=", "base64");
  file.assets = [{ id: "a_picture1", mime: "image/png", path: "assets/a_picture1.png", bytes: pixels.length }];
  file.edges = [{ id: "e_concept1", kind: "association", from: "n_concept1", to: "n_concept2", directed: true }];
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "打开", exact: true }).click()]);
  await chooser.setFiles({ name: "concepts.draft", mimeType: "application/octet-stream", buffer: Buffer.from(serializeBoard(file, { a_picture1: pixels })) });
  const card = page.locator('[data-node-id="n_concept1"]');
  await card.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const box = await card.boundingBox();
  assert.ok(box.width < 180 && box.height < 80, "旧宽高中的留白不影响紧凑概念呈现");
  assert.equal(await card.locator(".concept-core").evaluate(el => getComputedStyle(el).textAlign), "center");
  await card.click();
  assert.equal(await card.locator(".core-resize-handle").count(), 4, "普通卡也有四角缩放");
  assert.equal(await card.locator(".connect-handle").evaluate((el) => getComputedStyle(el).right), "-24px");
  await card.getByRole("button", { name: "添加备注", exact: false }).click();
  const body = card.getByRole("textbox", { name: "卡片正文", exact: true });
  const note = card.getByRole("textbox", { name: "卡片备注", exact: true });
  await body.fill("能量守恒：核心表达");
  await note.fill("1. 定义系统\n2. 描述对象\n");
  await note.press("Control+End");
  await card.getByRole("button", { name: "1. 列表", exact: true }).click();
  await note.pressSequentially("提出预测");
  assert.equal(await note.inputValue(), "1. 定义系统\n2. 描述对象\n3. 提出预测");
  await note.press("Control+Enter");
  await card.locator(".node-caption").waitFor();
  const saved = await page.evaluate(() => structuredClone(window.__state.file));
  assert.equal(saved.history.at(-1).ops.length, 2, "主体和备注同一步提交");
  const coreFont = await card.locator(".concept-core").evaluate(el => getComputedStyle(el).fontSize);
  const detailBox = await card.boundingBox();
  assert.ok(detailBox.height > box.height, "备注让外框自然生长");
  assert.equal(await card.locator(".node-caption").evaluate(el => getComputedStyle(el).textAlign), "left");
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/concepts-detail.png" });
  const pathBefore = await page.locator(".edge-path").first().getAttribute("d");
  const image = page.locator('[data-node-id="n_picture1"] img');
  const imageBefore = await image.boundingBox();
  await page.getByRole("button", { name: "结构视图", exact: true }).click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator(".node-caption").count(), 0, "全局隐藏文字和公式备注");
  assert.equal((await image.boundingBox()).height, imageBefore.height, "隐藏图片说明不缩放图片");
  assert.deepEqual(await page.evaluate(() => window.__state.file), saved, "视图切换不修改内容、尺寸、位置、历史");
  assert.ok((await card.boundingBox()).height < detailBox.height);
  assert.notEqual(await page.locator(".edge-path").first().getAttribute("d"), pathBefore, "连线跟随收拢后的边框");
  await page.screenshot({ path: "artifacts/concepts-structure.png" });
  const [structureDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "保存", exact: true }).click()]);
  assert.equal(parseBoard(readFileSync(await structureDownload.path())).file.nodes[0].caption, saved.nodes[0].caption, "结构视图保存仍保留备注");
  await page.getByRole("button", { name: "显示备注", exact: true }).click();
  await card.locator(".node-caption").waitFor();
  assert.equal(await card.locator(".concept-core").evaluate(el => getComputedStyle(el).fontSize), coreFont);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "保存", exact: true }).click()]);
  const bundle = parseBoard(readFileSync(await download.path()));
  assert.equal(bundle.file.nodes[0].caption, saved.nodes[0].caption, "保存保留完整备注");
  await card.dblclick();
  await note.fill("取消不应丢失原备注");
  await note.press("Escape");
  assert.equal(await page.evaluate(() => window.__state.file.nodes[0].caption), saved.nodes[0].caption);
  await page.keyboard.press("Control+z");
  assert.equal(await page.evaluate(() => window.__state.file.nodes[0].caption), undefined);
  await page.keyboard.press("Control+Shift+z");
  await card.locator(".node-caption").waitFor();
  await page.mouse.move(1050, 650);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 180);
  await page.keyboard.up("Control");
  await page.waitForTimeout(200);
  assert.notEqual(await page.evaluate(() => window.__state.file.board.view.zoom), 1);
  await page.screenshot({ path: "artifacts/concepts-zoom.png" });
  await card.dblclick();
  await note.fill("对象的详细描述与可讨论的证据。".repeat(60));
  await note.press("Control+Enter");
  await card.locator(".node-caption").waitFor();
  const longNote = await card.evaluate(el => {
    const note = el.querySelector(".node-caption").getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return { inside: note.bottom <= box.bottom && note.right <= box.right, font: getComputedStyle(el.querySelector(".concept-core")).fontSize };
  });
  assert.ok(longNote.inside, "长备注完整包含于外框");
  assert.equal(longNote.font, coreFont, "长备注不放大主体");
  assert.deepEqual(errors, []);
  console.log("CONCEPT CARDS PASS: compact core, visible notes, ordered list, atomic edit, structure view, edges, save, undo, zoom");
} finally {
  await browser?.close();
  server.kill();
}
