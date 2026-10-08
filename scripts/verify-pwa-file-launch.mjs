// 验证桌面 PWA 主路径：manifest 文件关联 → launchQueue 自动载入 → 原句柄保存 → 离线应用壳。
import { spawn } from "node:child_process";
import { launchBrowser } from "./browser.mjs";
import { createEmptyBoard, serializeBoard } from "../dist-model/index.js";

const PORT = 4186;
const URL = `http://127.0.0.1:${PORT}/`;
const errors = [];
const ok = (name, condition) => {
  console.log(`${condition ? "✓" : "✗"} ${name}`);
  if (!condition) process.exitCode = 1;
};

const testBoard = createEmptyBoard("PWA 双击打开测试");
testBoard.nodes.push({ id: "n_reload1", type: "text", markdown: "已保存的卡片", x: 100, y: 100, w: 240 });
const bytes = serializeBoard(testBoard, {});

const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
  { stdio: "ignore" },
);
process.on("exit", () => server.kill());
await new Promise((resolvePromise, reject) => {
  const startedAt = Date.now();
  const poll = async () => {
    try {
      await fetch(URL);
      resolvePromise();
    } catch {
      if (Date.now() - startedAt > 15_000) reject(new Error("preview 启动超时"));
      else setTimeout(poll, 250);
    }
  };
  void poll();
});

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript(
  ({ fileBytes, fileName }) => {
    let diskBytes = new Uint8Array(fileBytes);
    const handle = {
      kind: "file",
      name: fileName,
      async getFile() {
        return new File([diskBytes], fileName, { type: "application/octet-stream" });
      },
      async createWritable() {
        let pendingBytes;
        return {
          async write(data) {
            window.__pwaSavedBytes = data.byteLength;
            pendingBytes = new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data);
          },
          async close() { if (pendingBytes) diskBytes = pendingBytes; },
          async abort() { pendingBytes = null; },
        };
      },
    };
    window.__launchHandle = handle;
    Object.defineProperty(window, "launchQueue", { configurable: true, value: {
      setConsumer(consumer) {
        window.__launchConsumer = consumer;
      },
    } });
  },
  { fileBytes: [...bytes], fileName: "双击测试.draft" },
);

const page = await context.newPage();
page.on("pageerror", (error) => errors.push("pageerror: " + error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push("console: " + message.text());
});
page.on("requestfailed", (request) => errors.push(`requestfailed: ${request.url()} (${request.failure()?.errorText ?? "unknown"})`));
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForFunction(() => typeof window.__launchConsumer === "function");
await page.evaluate(() => window.__launchConsumer({ files: [window.__launchHandle] }));
await page.waitForFunction(() => window.__state?.file?.board?.name === "PWA 双击打开测试");

const launchState = await page.evaluate(() => ({
  boardName: window.__state.file.board.name,
  fileName: window.__state.fileName,
  hasHandle: !!window.__state.fileHandle,
}));
ok("launchQueue 自动载入双击文件", launchState.boardName === "PWA 双击打开测试");
ok("保留原文件句柄用于保存", launchState.hasHandle && launchState.fileName === "双击测试.draft");

const card = page.locator('[data-node-id="n_reload1"]');
await card.dblclick();
await page.waitForFunction(() => window.__state.editingId === "n_reload1");
const editReload = page.reload({ waitUntil: "domcontentloaded" }).catch(() => null);
const editDialog = await page.waitForEvent("dialog", { timeout: 5000 });
const editDialogType = editDialog.type();
await editDialog.dismiss();
await editReload;
ok("卡片编辑尚未提交时刷新也会提示", editDialogType === "beforeunload");
await page.keyboard.press("Escape");
await page.waitForFunction(() => window.__state.editingId === null);
await page.locator(".board-name").fill("刷新保护测试");
await page.waitForFunction(() => window.__state.saveState === "dirty");
await page.evaluate(() => { window.__savePickerCalled = 0; window.showSaveFilePicker = async () => { window.__savePickerCalled++; throw new DOMException("cancelled", "AbortError"); }; });
await page.getByRole("button", { name: "另存为", exact: true }).click();
await page.waitForFunction(() => window.__savePickerCalled === 1);
ok("取消另存为仍保持未保存状态", (await page.evaluate(() => window.__state.saveState)) === "dirty");
const reloadAttempt = page.reload({ waitUntil: "domcontentloaded" }).catch(() => null);
const unloadDialog = await page.waitForEvent("dialog", { timeout: 5000 });
const unloadType = unloadDialog.type();
await unloadDialog.dismiss();
await reloadAttempt;
ok("浏览器刷新对未保存白板弹出离开提示", unloadType === "beforeunload");
ok("取消刷新后保留未保存内容", (await page.locator(".board-name").inputValue()) === "刷新保护测试");
await page.locator(".board-name").fill("PWA 保存回写测试");
await page.keyboard.press("Control+s");
await page.waitForFunction(() => window.__pwaSavedBytes > 0 && window.__state.saveState === "saved");
ok("Ctrl+S 写回启动时收到的文件句柄", (await page.evaluate(() => window.__pwaSavedBytes)) > 0);

// 挂起真实 UI 的保存回调，在完成前切换会话；普通保存和另存为都不能污染新白板。
for (const [saveAs, failSave] of [[false, false], [true, false], [false, true], [true, true]]) {
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.evaluate(failSave => {
    window.__oldSaveStarted = false;
    window.__oldSaveClosed = false;
    window.showSaveFilePicker = async () => ({
      kind: "file", name: "旧会话保存.draft",
      async createWritable() { return {
        async write() { window.__oldSaveStarted = true; },
        async close() {
          await new Promise(resolve => { window.__releaseOldSave = resolve; });
          window.__oldSaveClosed = true;
          if (failSave) throw new Error("模拟旧会话写入失败");
        },
      }; },
    });
  }, failSave);
  await page.getByRole("button", { name: saveAs ? "另存为" : "保存", exact: true }).click();
  await page.waitForFunction(() => window.__oldSaveStarted);
  const oldSession = await page.evaluate(() => window.__state.sessionId);
  page.once("dialog", async dialog => {
    if (dialog.type() !== "confirm") throw new Error("切换保存中的会话应触发确认");
    const expected = saveAs ? "当前白板有未保存修改，确定打开另一个文件吗？" : "当前白板有未保存修改，确定新建并丢弃吗？";
    if (dialog.message() !== expected) throw new Error(`意外的确认：${dialog.message()}`);
    await dialog.accept();
  });
  if (saveAs) {
    await page.evaluate(() => window.__launchConsumer({ files: [window.__launchHandle] }));
  } else {
    await page.getByRole("button", { name: "新建", exact: true }).click();
  }
  await page.waitForFunction(old => window.__state.sessionId !== old, oldSession);
  const before = await page.evaluate(() => ({ fileName: window.__state.fileName, saveState: window.__state.saveState, saveError: window.__state.saveError }));
  await page.evaluate(() => window.__releaseOldSave());
  await page.waitForFunction(() => window.__oldSaveClosed);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  ok(`${saveAs ? "另存为" : "首次保存"}${failSave ? "失败" : "成功"}旧回调不改变新会话句柄、文件名或保存状态`, await page.evaluate(({ saveAs, before }) =>
    window.__state.fileHandle === (saveAs ? window.__launchHandle : null)
    && window.__state.fileName === before.fileName && window.__state.saveState === before.saveState
    && window.__state.saveError === before.saveError,
  { saveAs, before }));
}

const manifest = await (await page.request.get(`${URL}manifest.webmanifest`)).json();
ok("manifest 声明 .draft 文件处理器", manifest.file_handlers?.[0]?.accept?.["application/octet-stream"]?.includes(".draft"));
ok("manifest 包含 192/512 桌面图标", manifest.icons?.some((icon) => icon.sizes === "192x192") && manifest.icons?.some((icon) => icon.sizes === "512x512"));

await page.waitForFunction(async () => {
  if (!("serviceWorker" in navigator)) return false;
  await navigator.serviceWorker.ready;
  return !!navigator.serviceWorker.controller;
});
const cachedUrls = await page.evaluate(async () => {
  const names = await caches.keys();
  return (await Promise.all(names.map(async (name) => (await caches.open(name)).keys()))).flat().map((request) => request.url);
});
ok("离线缓存包含页面、脚本和样式", cachedUrls.some((url) => url.endsWith("/")) && cachedUrls.some((url) => url.includes("/assets/") && url.endsWith(".js")) && cachedUrls.some((url) => url.includes("/assets/") && url.endsWith(".css")));
await context.setOffline(true);
server.kill();
await page.reload({ waitUntil: "domcontentloaded" });
const offlineCanvasCount = await page.locator(".canvas").count();
if (!offlineCanvasCount) console.log("offline body:", (await page.locator("body").innerHTML()).slice(0, 500));
ok("preview 停止后应用壳仍可离线启动", offlineCanvasCount === 1);

const fatal = errors.filter((error) => !error.includes("favicon"));
ok("无浏览器报错", fatal.length === 0);
if (fatal.length) console.log(fatal.join("\n"));

await browser.close();
console.log(process.exitCode === 1 ? "PWA VERIFY FAIL" : "PWA VERIFY PASS");
