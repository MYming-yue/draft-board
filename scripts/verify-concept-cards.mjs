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
  async function verifyEditingOnTop(suffix) {
    const other = page.locator('[data-node-id="n_concept2"]');
    const originalStyle = await other.getAttribute("style");
    await other.evaluate(el => {
      el.style.left = "110px";
      el.style.top = "200px";
    });
    try {
      const hit = await other.evaluate(el => {
        const box = el.getBoundingClientRect();
        return document.elementFromPoint(box.x + 10, box.y + 10)?.closest(".node-card")?.getAttribute("data-node-id");
      });
      assert.equal(hit, "n_concept1", "重叠区域命中编辑卡片，而非后面的卡片");
      mkdirSync("artifacts", { recursive: true });
      await page.screenshot({ path: `artifacts/editing-top-${suffix}.png` });
    } finally {
      await other.evaluate((el, style) => el.setAttribute("style", style), originalStyle);
    }
  }
  await verifyEditingOnTop("default");
  await card.getByRole("button", { name: "希腊字母积木面板", exact: true }).click();
  await body.fill("");
  await card.getByTitle("τ tau", { exact: true }).click();
  assert.equal(await body.inputValue(), "τ");
  const greekPanel = card.locator('[aria-label="希腊字母"]');
  assert.equal(await greekPanel.locator("button").first().textContent(), "τ");
  await note.fill("");
  await card.getByTitle("α alpha", { exact: true }).click();
  assert.equal(await note.inputValue(), "α", "希腊字母插入当前备注字段");
  assert.equal(await greekPanel.locator("button").first().textContent(), "α");
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("draft-board.greek-recent.v1"))), ["α", "τ"]);
  await card.getByTitle("∇ nabla（梯度算子）", { exact: true }).click();
  assert.equal(await note.inputValue(), "α∇", "nabla 插入当前备注字段");
  assert.equal(await greekPanel.locator("button").first().textContent(), "∇");
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("draft-board.greek-recent.v1"))), ["∇", "α", "τ"]);
  await page.screenshot({ path: "artifacts/greek-palette.png" });
  await card.getByRole("button", { name: "公式积木面板", exact: true }).click();
  assert.equal(await greekPanel.count(), 0, "两个面板互斥");
  await body.fill("$$");
  await body.press("End");
  await card.getByRole("button", { name: "|x|", exact: true }).click();
  await body.pressSequentially("a");
  assert.equal(await body.inputValue(), "$$\\left|a\\right|", "绝对值占位符可直接替换");
  await body.fill("$$");
  await body.press("End");
  await card.getByRole("button", { name: "x̄", exact: true }).click();
  await body.pressSequentially("v");
  assert.equal(await body.inputValue(), "$$\\overline{v}");
  await body.fill("$$");
  await body.press("End");
  await card.getByRole("button", { name: "→", exact: true }).click();
  await body.pressSequentially("t");
  assert.equal(await body.inputValue(), "$$\\xrightarrow{t}", "替换条件占位符不损坏箭头命令");
  await body.fill("$$a ");
  await body.press("End");
  await card.getByRole("button", { name: "∼", exact: true }).click();
  await body.pressSequentially("b$$");
  assert.equal(await body.inputValue(), "$$a \\sim b$$", "相似符号积木插入可编辑的 LaTeX 命令");
  await page.screenshot({ path: "artifacts/formula-palette.png" });
  await card.getByRole("button", { name: "公式积木面板", exact: true }).click();
  await body.fill("能量守恒：核心表达");
  await note.fill("1. 定义系统\n2. 描述对象\n");
  await note.press("Control+End");
  await card.getByRole("button", { name: "1. 列表", exact: true }).click();
  await note.pressSequentially("提出预测");
  assert.equal(await note.inputValue(), "1. 定义系统\n2. 描述对象\n3. 提出预测");
  await note.press("Control+Enter");
  assert.equal(await card.evaluate(el => getComputedStyle(el).zIndex), "2", "提交后保持最近操作卡片的层级");
  await card.locator(".node-caption").waitFor();
  const noteButton = card.getByRole("button", { name: "编辑备注", exact: false });
  const laterCard = page.locator('[data-node-id="n_concept2"]');
  const laterStyle = await laterCard.getAttribute("style");
  const noteButtonBox = await noteButton.boundingBox();
  await laterCard.evaluate((el, target) => {
    const box = el.getBoundingClientRect();
    el.style.left = (parseFloat(el.style.left) + target.x - box.x - 12) + "px";
    el.style.top = (parseFloat(el.style.top) + target.y - box.y - 12) + "px";
  }, { x: noteButtonBox.x + noteButtonBox.width / 2, y: noteButtonBox.y + noteButtonBox.height / 2 });
  const noteHit = await page.evaluate(({ x, y }) =>
    document.elementFromPoint(x, y)?.closest(".node-card")?.getAttribute("data-node-id"),
    { x: noteButtonBox.x + noteButtonBox.width / 2, y: noteButtonBox.y + noteButtonBox.height / 2 });
  assert.equal(noteHit, "n_concept1", "编辑备注入口不被后创建的卡片遮挡");
  await noteButton.click();
  assert.equal(await card.getByRole("textbox", { name: "卡片备注", exact: true }).count(), 1);
  await note.press("Escape");
  await laterCard.evaluate((el, style) => el.setAttribute("style", style), laterStyle);
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
  await body.dispatchEvent("compositionstart");
  await body.dispatchEvent("compositionend", { data: "中文" });
  await verifyEditingOnTop("zoom-long");
  await card.getByRole("button", { name: "希腊字母积木面板", exact: true }).click();
  assert.equal(await card.locator('[aria-label="希腊字母"] button').first().textContent(), "∇", "重开面板保留最近使用顺序");
  await page.screenshot({ path: "artifacts/greek-palette-zoom.png" });
  await card.getByRole("button", { name: "希腊字母积木面板", exact: true }).click();
  await note.press("Control+Enter");
  await card.locator(".node-caption").waitFor();
  const longNote = await card.evaluate(el => {
    const note = el.querySelector(".node-caption").getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return { inside: note.bottom <= box.bottom && note.right <= box.right, font: getComputedStyle(el.querySelector(".concept-core")).fontSize };
  });
  assert.ok(longNote.inside, "长备注完整包含于外框");
  assert.equal(longNote.font, coreFont, "长备注不放大主体");
  const stackPage = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  stackPage.on("pageerror", e => errors.push(e.message));
  await stackPage.addInitScript(() => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; });
  await stackPage.goto("http://127.0.0.1:" + port);
  const stackFile = createEmptyBoard("层级回归");
  stackFile.board.view = { panX: 0, panY: 0, zoom: 1 };
  stackFile.nodes = [
    { id: "n_oldcard", type: "text", markdown: "先创建的卡片", x: 100, y: 100, w: 240 },
    { id: "n_newcard", type: "text", markdown: "后创建的卡片", x: 410, y: 100, w: 240 },
  ];
  const [stackChooser] = await Promise.all([
    stackPage.waitForEvent("filechooser"),
    stackPage.getByRole("button", { name: "打开", exact: true }).click(),
  ]);
  await stackChooser.setFiles({
    name: "stacking.draft", mimeType: "application/octet-stream",
    buffer: Buffer.from(serializeBoard(stackFile, {})),
  });
  const oldCard = stackPage.locator('[data-node-id="n_oldcard"]');
  const newCard = stackPage.locator('[data-node-id="n_newcard"]');
  await oldCard.waitFor();
  await newCard.click();
  await oldCard.click();
  const beforeDrag = await oldCard.boundingBox();
  const start = { x: beforeDrag.x + beforeDrag.width / 2, y: beforeDrag.y + beforeDrag.height / 2 };
  await stackPage.mouse.move(start.x, start.y);
  await stackPage.mouse.down();
  await stackPage.mouse.move(start.x + 310, start.y, { steps: 10 });
  await stackPage.mouse.up();
  async function assertDraggedCardOnTop() {
    const a = await oldCard.boundingBox();
    const b = await newCard.boundingBox();
    const left = Math.max(a.x, b.x);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    assert.ok(right - left > 20 && bottom - top > 20, "拖动后两张卡片确实重叠");
    const hit = await stackPage.evaluate(({ x, y }) =>
      document.elementFromPoint(x, y)?.closest(".node-card")?.getAttribute("data-node-id"),
      { x: (left + right) / 2, y: (top + bottom) / 2 });
    assert.equal(hit, "n_oldcard", "最近拖动的旧卡片在新卡片上层");
  }
  await assertDraggedCardOnTop();
  await stackPage.mouse.click(900, 650);
  assert.equal(await oldCard.evaluate(el => getComputedStyle(el).zIndex), "2", "取消选中后保留最近操作层级");
  await assertDraggedCardOnTop();
  await stackPage.screenshot({ path: "artifacts/recent-card-front-default.png" });
  await stackPage.mouse.move(500, 220);
  await stackPage.keyboard.down("Control");
  await stackPage.mouse.wheel(0, -180);
  await stackPage.keyboard.up("Control");
  await stackPage.waitForTimeout(200);
  await assertDraggedCardOnTop();
  await stackPage.screenshot({ path: "artifacts/recent-card-front-zoom.png" });
  await stackPage.close();
  const namingPage = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  namingPage.on("pageerror", e => errors.push(e.message));
  await namingPage.addInitScript(() => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; });
  await namingPage.goto("http://127.0.0.1:" + port);
  await namingPage.locator(".board-name").fill("梯度草稿");
  const [firstSave] = await Promise.all([
    namingPage.waitForEvent("download"),
    namingPage.getByRole("button", { name: "保存", exact: true }).click(),
  ]);
  assert.equal(firstSave.suggestedFilename(), "梯度草稿.draft", "新白板首次保存建议使用白板名称");
  const [namingChooser] = await Promise.all([
    namingPage.waitForEvent("filechooser"),
    namingPage.getByRole("button", { name: "打开", exact: true }).click(),
  ]);
  await namingChooser.setFiles({
    name: "磁盘文件.draft", mimeType: "application/octet-stream",
    buffer: Buffer.from(serializeBoard(stackFile, {})),
  });
  await namingPage.locator(".board-name").fill("文件内部标题");
  const [existingSave] = await Promise.all([
    namingPage.waitForEvent("download"),
    namingPage.getByRole("button", { name: "保存", exact: true }).click(),
  ]);
  assert.equal(existingSave.suggestedFilename(), "磁盘文件.draft", "打开已有文件后改标题不擅自改文件名");
  await namingPage.close();
  assert.deepEqual(errors, []);
  console.log("CONCEPT CARDS PASS: compact core, visible notes, recent-card stacking, ordered list, atomic edit, structure view, edges, save, undo, zoom");
} finally {
  await browser?.close();
  server.kill();
}
