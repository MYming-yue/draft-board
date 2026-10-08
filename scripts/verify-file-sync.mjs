// Real on-disk .draft and CLI; browser handles bridge the same files.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { launchBrowser } from "./browser.mjs";
import { commitStep, createEmptyBoard, parseBoard, serializeBoard } from "../dist-model/index.js";

const PORT = 4193, URL = `http://127.0.0.1:${PORT}/`;
mkdirSync("artifacts", { recursive: true });
const name = "sync-primary.draft", copy = "sync-local-copy.draft";
const paths = { [name]: resolve("artifacts", name), [copy]: resolve("artifacts", copy) };
const node = (id, markdown, x, y = 140) => ({ id, type: "text", markdown, caption: "可编辑的说明", x, y, w: 280 });
const nodes = [node("n_primary1", "动量方程", 50), node("n_convect1", "$(\\mathbf u\\cdot\\nabla)\\mathbf u$", 500), node("n_outside1", "原有内容", 1000)];
const seed = commitStep(createEmptyBoard("共享草稿回归"), "起点", "user", nodes.map(node => ({ op: "addNode", node, before: null, after: node })));
assert(seed.ok);
writeFileSync(paths[name], serializeBoard(seed.state, {}));
const apply = (label, ops) => {
  const current = parseBoard(readFileSync(paths[name])).file;
  const path = resolve("artifacts/sync.batch.json");
  writeFileSync(path, JSON.stringify({ batchVersion: "1.0", boardId: current.board.id, baseContentVersion: current.board.contentVersion, actor: "agent", label, ops }));
  for (const verb of ["validate", "apply"]) {
    const result = spawnSync(process.execPath, ["scripts/agent-batch.mjs", verb, paths[name], path], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  return parseBoard(readFileSync(paths[name])).file;
};
const caption = (nodeId, caption) => ({ op: "updateNodeCaption", nodeId, before: null, after: { caption } });
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
process.on("exit", () => server.kill());
let browser;
try {
  for (let count = 0; ; count++) {
    try { await fetch(URL); break; }
    catch { if (count > 60) throw new Error("preview 启动超时"); await new Promise(r => setTimeout(r, 250)); }
  }
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await context.exposeFunction("__syncRead", fileName => [...readFileSync(paths[fileName])]);
  await context.exposeFunction("__syncWrite", (fileName, bytes) => writeFileSync(paths[fileName], new Uint8Array(bytes)));
  await context.addInitScript(({ name, copy }) => {
    const handle = fileName => ({
      kind: "file", name: fileName,
      async isSameEntry(other) { return this.name === other.name; },
      async getFile() {
        if (window.__readDelay) await new Promise(r => setTimeout(r, window.__readDelay));
        return new File([new Uint8Array(await window.__syncRead(this.name))], this.name);
      },
      async createWritable() {
        const fileName = this.name;
        let pending;
        return {
          async write(data) {
            pending = [...new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data)];
            if (window.__stageExternalBytes) {
              await window.__syncWrite(name, window.__stageExternalBytes);
              window.__stageExternalBytes = null;
            }
          },
          async close() {
            if (window.__closeDelay) { const delay = window.__closeDelay; window.__closeDelay = 0; await new Promise(r => setTimeout(r, delay)); }
            await window.__syncWrite(fileName, pending);
            window.__lastWriteClosed = true;
          },
          async abort() { pending = null; window.__aborted = (window.__aborted || 0) + 1; },
        };
      },
    });
    window.__primary = handle(name);
    window.__copy = handle(copy);
    window.showOpenFilePicker = async () => [window.__primary];
    window.showSaveFilePicker = async () => window.__primary;
  }, { name, copy });
  const page = await context.newPage();
  const errors = [];
  context.on("page", tab => tab.on("pageerror", error => errors.push(error.message)));
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(URL, { waitUntil: "networkidle" });
  assert.equal(await page.getByRole("button", { name: "与 Codex 协作", exact: true }).count(), 0);
  await page.getByRole("button", { name: "打开", exact: true }).click();
  await page.waitForFunction(() => window.__state?.file.nodes.length === 3);
  await page.mouse.move(500, 700);
  await page.keyboard.down("Control"); await page.mouse.wheel(0, 350); await page.keyboard.up("Control");
  await page.waitForFunction(() => window.__state.file.board.view.zoom < .9);
  const view = await page.evaluate(() => window.__state.file.board.view);
  const example = node("n_example1", "定常 ≠ 没有加速度", 500, 460);
  const edge = { id: "e_example1", kind: "association", from: "n_convect1", to: example.id, directed: true, label: "检验" };
  let next = apply("补充对流项解释", [caption("n_convect1", "定常只表示固定位置的速度不随时间变。流体微团经过速度不同的位置，仍然可以加速。\n\n$$\\mathbf u=(ax,-ay,0),\\quad(\\mathbf u\\cdot\\nabla)\\mathbf u=(a^2x,a^2y,0)$$"), { op: "addNode", node: example, before: null, after: example }, { op: "addEdge", edge, before: null, after: edge }]);
  await page.waitForFunction(version => window.__state.file.board.contentVersion === version, next.board.contentVersion);
  assert.deepEqual(await page.evaluate(() => window.__state.file.board.view), view);
  assert.equal(await page.locator(".external-changed").count(), 2);
  assert.equal(await page.locator(".katex-error").count(), 0);
  assert((await page.locator(".file-updates").textContent()).includes("新增 1、修改 1"));
  await page.screenshot({ path: "artifacts/file-sync-update.png" });
  await page.getByRole("button", { name: "选中改动", exact: true }).focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => window.__state.file.nodes.length), 4);
  await page.getByRole("button", { name: "撤销最新一轮", exact: true }).click();
  await page.waitForFunction(() => window.__state.file.nodes.length === 3 && window.__state.saveState === "saved");
  assert.equal(parseBoard(readFileSync(paths[name])).file.edges.length, 0);
  assert.equal(await page.evaluate(() => window.__state.file.nodes.find(n => n.id === "n_convect1").caption), nodes[1].caption);

  // A replay snapshot cannot jump to a newly written version.
  await page.getByRole("button", { name: "回放", exact: true }).click();
  const replayVersion = await page.evaluate(() => window.__state.file.board.contentVersion);
  next = apply("回放期间新增说明", [caption("n_outside1", "外部的说明")]);
  await page.waitForFunction(() => !!window.__state.fileConflict);
  assert.equal(await page.evaluate(() => window.__state.file.board.contentVersion), replayVersion);
  await page.keyboard.press("Escape");
  await page.waitForFunction(version => window.__state.file.board.contentVersion === version && !window.__state.fileConflict, next.board.contentVersion);

  // Holding a pointer must defer replacement until the gesture finishes.
  const cardBox = await page.locator('[data-node-id="n_primary1"]').boundingBox();
  await page.mouse.move(cardBox.x + 30, cardBox.y + 20); await page.mouse.down();
  const pointerVersion = await page.evaluate(() => window.__state.file.board.contentVersion);
  next = apply("拖动期间的更新", [caption("n_outside1", "另一个更新")]);
  await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(() => window.__state.file.board.contentVersion), pointerVersion);
  await page.mouse.up();
  await page.waitForFunction(version => window.__state.file.board.contentVersion === version, next.board.contentVersion);

  // Preserve an unfinished composition, then keep both divergent versions.
  await page.locator('[data-node-id="n_primary1"]').dblclick();
  const input = page.locator(".core-editor");
  await input.fill("我的动量理解：中文输入仍在继续");
  await input.dispatchEvent("compositionstart", { data: "中文" });
  next = apply("保留外部观点", [caption("n_outside1", "Agent 已保存的外部观点")]);
  const externalBytes = readFileSync(paths[name]);
  await page.waitForFunction(() => !!window.__state.fileConflict);
  assert.equal(await input.inputValue(), "我的动量理解：中文输入仍在继续");
  assert.equal(await page.evaluate(() => window.__state.editingId), "n_primary1");
  await page.screenshot({ path: "artifacts/file-sync-editing.png" });
  await input.dispatchEvent("compositionend", { data: "中文" });
  await page.keyboard.press("Control+Enter");
  await page.waitForFunction(() => window.__state.editingId === null);
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(1800);
  assert.equal(await page.getByRole("button", { name: "保存", exact: true }).isDisabled(), true);
  assert((await page.locator(".save-status").textContent()).includes("回写暂停"));
  assert.deepEqual(readFileSync(paths[name]), externalBytes, "neither autosave nor Ctrl+S may overwrite the external version");
  assert.equal(await page.evaluate(() => window.__state.file.nodes.find(n => n.id === "n_primary1").markdown), "我的动量理解：中文输入仍在继续");
  await page.screenshot({ path: "artifacts/file-sync-conflict.png" });
  await page.evaluate(() => { window.showSaveFilePicker = async opts => { window.__suggestedCopyName = opts.suggestedName; throw new DOMException("cancelled", "AbortError"); }; });
  await page.getByRole("button", { name: "另存本地副本", exact: true }).click();
  await page.waitForFunction(() => window.__state.saveState === "dirty");
  assert.equal(await page.evaluate(() => window.__suggestedCopyName), "sync-primary-副本.draft", "copy name must use the source filename, not the board title");
  assert.equal(await page.evaluate(() => !!window.__state.fileConflict), true);
  await page.evaluate(() => { window.showSaveFilePicker = async () => window.__primary; });
  await page.getByRole("button", { name: "另存本地副本", exact: true }).click();
  await page.waitForFunction(() => window.__state.saveState === "error");
  assert.deepEqual(readFileSync(paths[name]), externalBytes, "copy must refuse the original file");
  await page.evaluate(() => { window.showSaveFilePicker = async opts => { window.__suggestedCopyName = opts.suggestedName; return window.__copy; }; });
  await page.getByRole("button", { name: "另存本地副本", exact: true }).click();
  await page.waitForFunction(() => window.__state.saveState === "saved" && !window.__state.fileConflict && window.__state.fileHandle.name === "sync-local-copy.draft");
  assert.equal(await page.evaluate(() => window.__suggestedCopyName), "sync-primary-副本.draft");
  assert.equal(await page.evaluate(() => window.__state.fileName), "sync-local-copy.draft", "use the name actually chosen by the user after saving");
  await page.evaluate(() => { window.showSaveFilePicker = async opts => { window.__suggestedCopyName = opts.suggestedName; throw new DOMException("cancelled", "AbortError"); }; });
  await page.getByRole("button", { name: "另存为", exact: true }).click();
  await page.waitForFunction(() => window.__state.saveState === "saved");
  assert.equal(await page.evaluate(() => window.__suggestedCopyName), "sync-local-copy.draft", "ordinary Save As keeps the existing filename");
  assert.deepEqual(readFileSync(paths[name]), externalBytes);
  assert.equal(parseBoard(readFileSync(paths[copy])).file.nodes.find(n => n.id === "n_primary1").markdown, "我的动量理解：中文输入仍在继续");
  await page.getByRole("button", { name: "打开", exact: true }).click();
  await page.waitForFunction(() => window.__state.fileHandle.name === "sync-primary.draft");
  assert.equal(await page.evaluate(() => window.__state.file.nodes.find(n => n.id === "n_primary1").markdown), "动量方程");

  // Invalid and foreign files preserve memory; restoration clears the block.
  const baselineBytes = readFileSync(paths[name]);
  writeFileSync(paths[name], "invalid draft");
  await page.waitForFunction(() => !!window.__state.fileConflict);
  assert.equal(await page.evaluate(() => window.__state.file.nodes.length), 3);
  writeFileSync(paths[name], serializeBoard(createEmptyBoard("其他白板"), {}));
  await page.waitForFunction(() => window.__state.fileConflict?.includes("另一张白板"));
  writeFileSync(paths[name], baselineBytes);
  await page.waitForFunction(() => !window.__state.fileConflict);

  // A writer that races after write() starts is caught before close().
  const disk = parseBoard(baselineBytes).file;
  const raced = commitStep(disk, "写入期间的 Agent 更新", "agent", [caption("n_outside1", "较晚到来的外部修改")]);
  assert(raced.ok);
  const racedBytes = serializeBoard(raced.state, {});
  await page.evaluate(bytes => { window.__stageExternalBytes = bytes; }, [...racedBytes]);
  await page.locator(".board-name").fill("我的本地标题");
  await page.keyboard.press("Control+s");
  await page.waitForFunction(() => window.__aborted === 1);
  assert.deepEqual(readFileSync(paths[name]), Buffer.from(racedBytes));
  assert.equal(await page.locator(".board-name").inputValue(), "我的本地标题");

  // Old reads and saves must not bind an old file to a newly created board.
  const fresh = await context.newPage();
  await fresh.goto(URL, { waitUntil: "networkidle" });
  await fresh.getByRole("button", { name: "打开", exact: true }).click();
  await fresh.waitForFunction(() => window.__state.fileHandle !== null);
  await fresh.evaluate(() => { window.__readDelay = 700; });
  await fresh.getByRole("button", { name: "新建", exact: true }).click();
  await fresh.waitForTimeout(2000);
  assert.equal(await fresh.evaluate(() => window.__state.fileHandle), null);
  assert.equal(await fresh.evaluate(() => window.__state.file.nodes.length), 0);
  await fresh.locator(".board-name").fill("迟到的保存");
  await fresh.evaluate(() => { window.__readDelay = 0; window.__closeDelay = 800; window.__lastWriteClosed = false; });
  await fresh.keyboard.press("Control+s");
  await fresh.waitForFunction(() => window.__state.saveState === "saving");
  fresh.once("dialog", async dialog => { assert.equal(dialog.type(), "confirm"); await dialog.accept(); });
  await fresh.getByRole("button", { name: "新建", exact: true }).click();
  await fresh.waitForFunction(() => window.__lastWriteClosed);
  assert.equal(await fresh.evaluate(() => window.__state.fileHandle), null);
  assert.equal(await fresh.evaluate(() => window.__state.saveState), "clean");
  // Default scale and new edits made while an older save is in flight.
  writeFileSync(paths[name], serializeBoard(seed.state, {}));
  const defaultPage = await context.newPage();
  await defaultPage.goto(URL, { waitUntil: "networkidle" });
  await defaultPage.getByRole("button", { name: "打开", exact: true }).click();
  await defaultPage.waitForFunction(() => window.__state.file.nodes.length === 3);
  next = apply("默认缩放下显示改动", [caption("n_outside1", "新解释\n".repeat(20))]);
  await defaultPage.waitForFunction(version => window.__state.file.board.contentVersion === version, next.board.contentVersion);
  assert.equal(await defaultPage.evaluate(() => window.__state.file.board.view.zoom), 1);
  await defaultPage.screenshot({ path: "artifacts/file-sync-default.png" });
  await defaultPage.evaluate(() => { window.__closeDelay = 2500; });
  await defaultPage.locator(".board-name").fill("保存中的第一版");
  await defaultPage.keyboard.press("Control+s");
  await defaultPage.waitForFunction(() => window.__state.saveState === "saving");
  await defaultPage.locator(".board-name").fill("保存期间新增的第二版");
  await defaultPage.waitForFunction(() => window.__state.saveState === "saved");
  assert.equal(parseBoard(readFileSync(paths[name])).file.board.name, "保存期间新增的第二版");
  // Download fallback uses the same copy name and detaches the original handle.
  const downloadPage = await context.newPage();
  await downloadPage.goto(URL, { waitUntil: "networkidle" });
  await downloadPage.getByRole("button", { name: "打开", exact: true }).click();
  await downloadPage.waitForFunction(() => window.__state.fileHandle !== null);
  await downloadPage.locator(".board-name").fill("下载副本的本地修改");
  apply("下载副本之前的外部更新", [caption("n_outside1", "磁盘版本保留")]);
  await downloadPage.waitForFunction(() => !!window.__state.fileConflict);
  const beforeDownload = readFileSync(paths[name]);
  await downloadPage.evaluate(() => { delete window.showSaveFilePicker; });
  const [download] = await Promise.all([downloadPage.waitForEvent("download"), downloadPage.getByRole("button", { name: "另存本地副本", exact: true }).click()]);
  assert.equal(download.suggestedFilename(), "sync-primary-副本.draft");
  await downloadPage.waitForFunction(() => !window.__state.fileConflict && window.__state.fileHandle === null);
  assert.equal(await downloadPage.evaluate(() => window.__state.fileName), "sync-primary-副本.draft");
  assert.equal(parseBoard(readFileSync(await download.path())).file.board.name, "下载副本的本地修改");
  assert.deepEqual(readFileSync(paths[name]), beforeDownload);
  assert.deepEqual(errors, []);
  console.log("FILE SYNC PASS: actual CLI updates, retained view, change marks, round undo, replay/gestures/IME, divergent copies, abort-on-race, invalid files and stale callbacks");
} finally { await browser?.close(); server.kill(); }
