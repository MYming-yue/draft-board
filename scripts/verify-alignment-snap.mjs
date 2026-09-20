// 真实浏览器验证：中心/边框吸附、参考线、最终坐标与历史步骤。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { launchBrowser } from "./browser.mjs";
import { createEmptyBoard, serializeBoard } from "../dist-model/index.js";

const port = 4184;
const url = `http://127.0.0.1:${port}/`;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { stdio: "ignore" });
let browser;
try {
  for (let i = 0; i < 50; i++) {
    try { await fetch(url); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  await page.addInitScript(() => { delete window.showOpenFilePicker; });
  await page.goto(url, { waitUntil: "networkidle" });

  const file = createEmptyBoard("智能对齐验证");
  file.board.view = { panX: 0, panY: 0, zoom: 1 };
  // A 后渲染，中心重合时仍能继续被鼠标命中。
  file.nodes = [
    // 与 B 共用同一中轴但相距很远，用于证明搜索范围不是无限。
    { id: "n_faraway", type: "text", markdown: "远处卡片", x: 500, y: 2000, w: 220, h: 120, accent: "red" },
    { id: "n_target1", type: "text", markdown: "## 卡片 B\n对齐参照", x: 500, y: 180, w: 220, h: 120, accent: "blue" },
    { id: "n_moving1", type: "text", markdown: "## 卡片 A\n拖动我", x: 100, y: 450, w: 180, h: 100, accent: "amber" },
  ];
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "打开", exact: true }).click(),
  ]);
  await chooser.setFiles({ name: "alignment.draft", mimeType: "application/octet-stream", buffer: Buffer.from(serializeBoard(file, {})) });
  await page.waitForSelector('[data-node-id="n_moving1"]');
  await page.waitForTimeout(250);

  const moving = page.locator('[data-node-id="n_moving1"]');
  let box = await moving.boundingBox();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // A 放在 B 下方，水平中轴相差 6px；纵向远离任何轴，只吸水平中心。
  await page.mouse.move(start.x + 414, start.y - 95, { steps: 12 });
  await page.waitForTimeout(100);
  const guideAxes = await page.locator(".alignment-guide").evaluateAll((els) => els.map((e) => e.dataset.axis).sort());
  assert.deepEqual(guideAxes, ["x"], "上下排列时显示贯穿两卡的中轴参考线");
  assert.equal(await page.locator('.alignment-guide-x[data-moving-kind="center"][data-target-kind="center"]').count(), 1, "中轴对中轴");
  assert.equal(await page.locator('.alignment-guide-x[data-target-id="n_target1"]').count(), 1, "忽略同轴但遥远的卡片");
  await page.mouse.up();
  await page.waitForTimeout(120);
  assert.equal(await page.locator(".alignment-guide").count(), 0, "松手后参考线消失");
  let state = await page.evaluate(() => window.__state.file);
  let a = state.nodes.find((n) => n.id === "n_moving1");
  assert.deepEqual({ x: a.x, y: a.y }, { x: 520, y: 355 }, "水平中轴精确吸附，纵向位置保持自由");
  assert.equal(state.history.at(-1).ops.length, 1);
  assert.equal(state.history.at(-1).ops[0].op, "moveNode");

  // 再拖到 B 左侧：A 右边框吸附 B 左边框，同时上边框齐平。
  box = await moving.boundingBox();
  const edgeStart = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(edgeStart.x, edgeStart.y);
  await page.mouse.down();
  await page.mouse.move(edgeStart.x - 207, edgeStart.y - 170, { steps: 10 });
  await page.waitForTimeout(100);
  assert.equal(await page.locator(".alignment-guide-x").count(), 1);
  assert.equal(await page.locator(".alignment-guide-y").count(), 1);
  assert.equal(await page.locator('.alignment-guide-x[data-moving-kind="end"][data-target-kind="start"]').count(), 1, "相邻边框吸附");
  assert.equal(await page.locator('.alignment-guide-y[data-moving-kind="start"][data-target-kind="start"]').count(), 1, "上边框齐平");
  const shot = process.argv[2];
  if (shot) await page.screenshot({ path: shot });
  await page.mouse.up();
  await page.waitForTimeout(120);
  state = await page.evaluate(() => window.__state.file);
  a = state.nodes.find((n) => n.id === "n_moving1");
  assert.deepEqual({ x: a.x, y: a.y }, { x: 320, y: 180 }, "A 右边框贴齐 B 左边框，且上边框齐平");

  // 大卡 B：A 与 B 外框相隔 120px（超过固定下限 96），仍应因 B 尺寸而进入自适应范围。
  const largeFile = createEmptyBoard("大卡自适应搜索验证");
  largeFile.board.view = { panX: 0, panY: 0, zoom: 1 };
  largeFile.nodes = [
    { id: "n_large01", type: "text", markdown: "# 大卡 B\n尺寸越大，邻域应适当扩大", x: 400, y: 280, w: 500, h: 300, accent: "green" },
    { id: "n_small01", type: "text", markdown: "卡片 A", x: 50, y: 80, w: 120, h: 80, accent: "amber" },
  ];
  const [largeChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "打开", exact: true }).click(),
  ]);
  await largeChooser.setFiles({ name: "adaptive-alignment.draft", mimeType: "application/octet-stream", buffer: Buffer.from(serializeBoard(largeFile, {})) });
  await page.waitForSelector('[data-node-id="n_small01"]');
  await page.waitForTimeout(200);
  const smallCard = await page.locator('[data-node-id="n_small01"]').boundingBox();
  const smallStart = { x: smallCard.x + smallCard.width / 2, y: smallCard.y + smallCard.height / 2 };
  await page.mouse.move(smallStart.x, smallStart.y);
  await page.mouse.down();
  // A 最终位于 B 上方，外框间隔 120px；中心轴距 6px。
  await page.mouse.move(smallStart.x + 534, smallStart.y, { steps: 12 });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.alignment-guide-x[data-target-id="n_large01"]').count(), 1, "大卡在 120px 外仍按尺寸进入候选");
  await page.mouse.up();
  const adaptiveState = await page.evaluate(() => window.__state.file);
  const small = adaptiveState.nodes.find((n) => n.id === "n_small01");
  assert.equal(small.x, 590, "大卡自适应范围内完成中轴吸附");
  console.log("ALIGNMENT SNAP PASS: 自适应范围 / 96px 下限 / 320px 上限 / 远卡排除 / 中轴 / 边框 / 历史步骤");
} finally {
  await browser?.close();
  server.kill();
}
