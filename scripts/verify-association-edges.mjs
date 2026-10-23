import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { launchBrowser, prepareFixtureOpen } from "./browser.mjs";
import { createEmptyBoard, serializeBoard, parseBoard } from "../dist-model/index.js";
const port = 4190;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { stdio: "ignore" });
let browser;
try {
  for (let i=0; i<60; i++) {
    try { await fetch(`http://127.0.0.1:${port}`); break; }
    catch { await new Promise(r => setTimeout(r,200)); }
  }
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errors=[];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; });
  await page.goto(`http://127.0.0.1:${port}`);
  const file = createEmptyBoard("双向关联");
  file.board.view = { panX: 0, panY: 0, zoom: 1 };
  file.nodes = [
    { id: "n_nodeaa", type: "text", markdown: "概念 A", x: 120, y: 220, w: 200 },
    { id: "n_nodebb", type: "text", markdown: "概念 B", x: 650, y: 220, w: 200 },
  ];
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name:"打开", exact:true }).click()]);
  await chooser.setFiles({ name:"edges.draft", mimeType:"application/octet-stream", buffer:Buffer.from(serializeBoard(file,{})) });
  await page.locator('[data-node-id="n_nodeaa"]').waitFor();
  const connect = async (from,to,label) => {
    const source = page.locator(`[data-node-id="${from}"]`);
    await source.click();
    const handle = await source.locator(".connect-handle").boundingBox();
    const target = await page.locator(`[data-node-id="${to}"]`).boundingBox();
    await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
    await page.mouse.down();
    await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:8});
    await page.mouse.up();
    await page.locator(".edge-label-input").fill(label);
    await page.locator(".edge-label-input").press("Enter");
  };
  await connect("n_nodeaa","n_nodebb","旧说明");
  await connect("n_nodeaa","n_nodebb","新说明");
  let edges = await page.evaluate(() => window.__state.file.edges);
  assert.equal(edges.length,1);
  assert.equal(edges[0].label,"新说明");
  await page.keyboard.press("Control+z"); // label
  await page.keyboard.press("Control+z"); // replacement
  edges = await page.evaluate(() => window.__state.file.edges);
  assert.equal(edges.length,1);
  assert.equal(edges[0].label,"旧说明","覆盖可撤销恢复旧关联");
  await connect("n_nodebb","n_nodeaa","反向说明");
  for (let i=0;i<3;i++) await connect("n_nodeaa","n_nodebb",`正向说明 ${i}`);
  edges = await page.evaluate(() => window.__state.file.edges);
  assert.equal(edges.length,2);
  assert.equal(edges.filter(e => e.from === "n_nodeaa").length,1);
  const points = await page.locator(".edge-assoc").evaluateAll(paths => paths.map(path => {
    const p=path.getPointAtLength(path.getTotalLength()/2); return {x:p.x,y:p.y};
  }));
  assert.equal(points.length,2);
  assert.ok(Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)>40,"双向路径分离");
  assert.equal(await page.locator(".edge-hit").count(),2);
  mkdirSync("artifacts",{recursive:true});
  await page.screenshot({path:"artifacts/reciprocal-arrows.png"});
  const [download]=await Promise.all([page.waitForEvent("download"),page.getByRole("button",{name:"保存",exact:true}).click()]);
  assert.deepEqual(parseBoard(readFileSync(await download.path())).file.edges,edges);
  for (const zoom of [1, 0.7]) {
    file.board.view.zoom = zoom;
    file.nodes = [
      { id: "n_nodeaa", type: "text", markdown: "纵向连接不再拐弯", x: 160, y: 120, w: 400 },
      { id: "n_nodebb", type: "text", markdown: "纵向连接不再拐弯", x: 160, y: 280, w: 400 },
    ];
    file.edges = [{ id: "e_vertical", kind: "association", from: "n_nodebb", to: "n_nodeaa", directed: true }];
    await prepareFixtureOpen(page);
    const [verticalChooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "打开", exact: true }).click()]);
    await verticalChooser.setFiles({ name: "vertical.draft", mimeType: "application/octet-stream", buffer: Buffer.from(serializeBoard(file, {})) });
    await page.locator('[data-edge-id="e_vertical"]').waitFor({ state: "attached" });
    await page.evaluate(() => document.fonts.ready);
    const path = page.locator('[data-edge-id="e_vertical"] .edge-path');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-edge-id="e_vertical"] .edge-path');
      if (!el) return false;
      const xs = [0, .25, .5, .75, 1].map(t => el.getPointAtLength(el.getTotalLength() * t).x);
      return Math.max(...xs) - Math.min(...xs) < 0.01;
    });
    const xs = await path.evaluate(el => [0, .25, .5, .75, 1].map(t => el.getPointAtLength(el.getTotalLength() * t).x));
    assert.ok(Math.max(...xs) - Math.min(...xs) < 0.01, "纵向连线整条路径保持竖直");
    await page.screenshot({ path: `artifacts/vertical-arrow-${zoom}.png` });
  }
  assert.deepEqual(errors,[]);
  console.log("ASSOCIATION EDGES PASS: replacement, undo, reverse pair, separate paths, save");
} finally { await browser?.close(); server.kill(); }
