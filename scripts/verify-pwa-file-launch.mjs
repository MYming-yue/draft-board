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
    const handle = {
      kind: "file",
      name: fileName,
      async getFile() {
        return new File([new Uint8Array(fileBytes)], fileName, { type: "application/octet-stream" });
      },
      async createWritable() {
        return {
          async write(data) {
            window.__pwaSavedBytes = data.byteLength;
          },
          async close() {},
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

await page.locator(".board-name").fill("PWA 保存回写测试");
await page.keyboard.press("Control+s");
await page.waitForFunction(() => window.__pwaSavedBytes > 0 && window.__state.saveState === "saved");
ok("Ctrl+S 写回启动时收到的文件句柄", (await page.evaluate(() => window.__pwaSavedBytes)) > 0);

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
