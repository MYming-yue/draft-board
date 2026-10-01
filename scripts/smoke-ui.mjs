// UI 冒烟：真实浏览器走需求 §2 流程 1–5 步（建板→双击输入→Tab 分支→Markdown+公式→带说明箭头→布局整理）。
// 自起 vite preview（需先 npm run build），用 playwright-core + 系统 Chrome/Edge，不下载浏览器。
import { spawn } from "node:child_process";
import { launchBrowser } from "./browser.mjs";

const PORT = 4180;
const URL = `http://127.0.0.1:${PORT}/`;
const errors = [];
const ok = (name, cond) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) process.exitCode = 1;
};

// 自起静态服务（直接 spawn vite 的 node 入口，kill 可杀干净；绑 IPv4 避免 ::1/localhost 解析分叉）
const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
  { stdio: "ignore" },
);
process.on("exit", () => server.kill());
await new Promise((resolvePromise, reject) => {
  const t0 = Date.now();
  const tick = async () => {
    try {
      await fetch(URL);
      resolvePromise();
    } catch {
      if (Date.now() - t0 > 15000) reject(new Error("vite preview 启动超时"));
      else setTimeout(tick, 300);
    }
  };
  void tick();
});

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text());
});

await page.goto(URL, { waitUntil: "networkidle" });
ok("页面加载", await page.locator(".canvas").count() === 1);
ok("空白提示可见", (await page.locator(".canvas-hint").textContent())?.includes("双击"));

// 画布缩放：Alt+左键上拖缩小、下拖放大；无论鼠标位置如何，画布中心都是缩放锚点
const zoomAnchor = { x: 900, y: 620 };
const readCanvasView = () =>
  page.evaluate(() => {
    const rect = document.querySelector(".canvas").getBoundingClientRect();
    const view = window.__state.file.board.view;
    return {
      ...view,
      worldAtCenter: {
        x: (rect.width / 2 - view.panX) / view.zoom,
        y: (rect.height / 2 - view.panY) / view.zoom,
      },
    };
  });
const altDragZoom = async (deltaY) => {
  await page.mouse.move(zoomAnchor.x, zoomAnchor.y);
  await page.keyboard.down("Alt");
  await page.mouse.down({ button: "left" });
  await page.mouse.move(zoomAnchor.x, zoomAnchor.y + deltaY, { steps: 8 });
  await page.mouse.up({ button: "left" });
  await page.keyboard.up("Alt");
  await page.waitForTimeout(100);
};
const viewBeforeAltZoom = await readCanvasView();
await altDragZoom(-100);
const viewAfterUp = await readCanvasView();
ok("Alt+左键上拖缩小画布", viewAfterUp.zoom < viewBeforeAltZoom.zoom);
ok(
  "Alt 拖动缩放固定保持画布中心为锚点",
  Math.abs(viewAfterUp.worldAtCenter.x - viewBeforeAltZoom.worldAtCenter.x) < 0.01 &&
    Math.abs(viewAfterUp.worldAtCenter.y - viewBeforeAltZoom.worldAtCenter.y) < 0.01,
);
await altDragZoom(100);
const viewAfterDown = await readCanvasView();
ok("Alt+左键下拖放大画布", viewAfterDown.zoom > viewAfterUp.zoom);

// 空白左键拖动画布，并用反向拖动恢复，避免影响后续坐标断言
const viewBeforeMousePan = await readCanvasView();
await page.mouse.move(900, 620);
await page.mouse.down({ button: "left" });
await page.mouse.move(980, 670, { steps: 6 });
await page.mouse.up({ button: "left" });
await page.waitForTimeout(100);
const viewAfterMousePan = await readCanvasView();
ok(
  "空白处左键直接拖动画布",
  Math.abs(viewAfterMousePan.panX - viewBeforeMousePan.panX - 80) < 1 &&
    Math.abs(viewAfterMousePan.panY - viewBeforeMousePan.panY - 50) < 1,
);
await page.mouse.move(980, 670);
await page.mouse.down({ button: "left" });
await page.mouse.move(900, 620, { steps: 6 });
await page.mouse.up({ button: "left" });
await page.waitForTimeout(100);

// WASD 与方向键平滑连续平移：按住一段时间后应产生可观位移
const viewBeforeKeyPan = await readCanvasView();
await page.keyboard.down("d");
await page.waitForTimeout(180);
await page.keyboard.up("d");
await page.waitForTimeout(350);
await page.keyboard.down("ArrowDown");
await page.waitForTimeout(180);
await page.keyboard.up("ArrowDown");
await page.waitForTimeout(350);
const viewAfterKeyPan = await readCanvasView();
ok(
  "WASD/方向键平滑连续平移画布",
  viewAfterKeyPan.panX > viewBeforeKeyPan.panX + 50 && viewAfterKeyPan.panY > viewBeforeKeyPan.panY + 50,
);
// 用鼠标精确恢复偏移，避免动画计时误差影响后续依赖坐标的回归断言
const keyPanDx = viewAfterKeyPan.panX - viewBeforeKeyPan.panX;
const keyPanDy = viewAfterKeyPan.panY - viewBeforeKeyPan.panY;
await page.mouse.move(700, 600);
await page.mouse.down({ button: "left" });
await page.mouse.move(700 - keyPanDx, 600 - keyPanDy, { steps: 8 });
await page.mouse.up({ button: "left" });
await page.waitForTimeout(100);

// 步骤 1：双击空白创建中心卡并输入
await page.mouse.dblclick(640, 400);
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
const ed = page.locator(".node-editor:not(.formula-caption-editor)");
await ed.click();
await ed.pressSequentially("# 中心问题\n如何提高复习效率？", { delay: 5 });
await page.keyboard.press("Control+Enter");
ok("双击建卡+Ctrl+Enter 提交", (await page.locator(".node-card").count()) === 1);
await page.waitForFunction(() => [...document.querySelectorAll('.node-card')].every(el => el.getBoundingClientRect().height < 150));
await page.waitForTimeout(100); // 让 ResizeObserver 将阅读态尺寸交给分支落点计算。

// 步骤 2：Tab 连续建两层子卡（三层分支）
await page.keyboard.press("Tab"); // 第一层
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.locator(".node-editor:not(.formula-caption-editor)").pressSequentially("思路一：**间隔重复**", { delay: 5 });
await page.keyboard.press("Control+Enter");
await page.waitForFunction(() => [...document.querySelectorAll('.node-card')].every(el => el.getBoundingClientRect().height < 150));
await page.waitForTimeout(100);
await page.keyboard.press("Tab"); // 在第一层子卡上再 Tab → 第二层
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.locator(".node-editor:not(.formula-caption-editor)").pressSequentially("按 $遗忘曲线$ 安排", { delay: 5 });
await page.keyboard.press("Control+Enter");
const cardCount = await page.locator(".node-card").count();
ok("Tab 两层分支共 3 卡", cardCount === 3);
const parentEdges = await page.locator(".edge-path.edge-parent").count();
ok("parentChild 边 2 条", parentEdges === 2);

// 步骤 3：Markdown + 公式渲染（失焦渲染、KaTeX 元素存在）
ok("Markdown 粗体渲染", (await page.locator(".node-rendered strong").count()) >= 1);
ok("KaTeX 公式渲染", (await page.locator(".node-rendered .katex").count()) >= 1);

// 步骤 4：从根卡连接点拖连线到孙卡，加关系说明
const cards = page.locator(".node-card");
const grand = await cards.nth(2).boundingBox();
ok("拖线目标中心位于视口内", grand.x + grand.width / 2 >= 0 && grand.x + grand.width / 2 < page.viewportSize().width && grand.y + grand.height / 2 >= 0 && grand.y + grand.height / 2 < page.viewportSize().height);
await cards.nth(0).hover(); // 让连接点出现
const handleBox = await cards.nth(0).locator(".connect-handle").boundingBox();
await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2, { steps: 3 });
await page.mouse.down();
await page.mouse.move(grand.x + grand.width / 2, grand.y + grand.height / 2, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(300);
const assocEdges = await page.locator(".edge-path.edge-assoc").count();
ok("拖出 association 连线 1 条", assocEdges === 1);
// 自动进入 label 编辑
const labelInput = page.locator(".edge-label-input");
ok("连线后自动打开说明输入", (await labelInput.count()) === 1);
await labelInput.fill("依赖");
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
ok("关系说明上屏", (await page.locator(".edge-label").first().textContent()) === "依赖");

// 步骤 5：先拖乱一张卡，再布局整理（应归位；单步骤可撤销）。位置断言读状态探针（__state），避免渲染时序干扰。
const nodePos = (i) =>
  page.evaluate((idx) => {
    const n = window.__state.file.nodes[idx];
    return { x: n.x, y: n.y };
  }, i);
const dragCard = await cards.nth(1).boundingBox();
await page.mouse.move(dragCard.x + dragCard.width / 2, dragCard.y + dragCard.height / 2);
await page.mouse.down();
await page.mouse.move(dragCard.x + dragCard.width / 2 + 90, dragCard.y + dragCard.height / 2 + 110, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
const messyPos = await nodePos(1);
const origPos = { x: Math.round(dragCard.x - 40), y: Math.round(dragCard.y - 40) }; // toolbar 高 40
ok("拖动卡片生效", Math.abs(messyPos.x - origPos.x) > 40 || Math.abs(messyPos.y - origPos.y) > 40);
await page.mouse.click(90, 720); // 点空白清选 → 布局整理作用于全部根
await page.waitForTimeout(200);
await page.getByRole("button", { name: "布局整理" }).click();
await page.getByRole("button", { name: "整理中…" }).waitFor({ state: "hidden", timeout: 120000 });
const afterPos = await nodePos(1);
ok("布局整理移动了卡片", Math.abs(messyPos.x - afterPos.x) > 1 || Math.abs(messyPos.y - afterPos.y) > 1);
ok("整理后 parentChild 边仍在", (await page.locator(".edge-path.edge-parent").count()) === 2);
await page.keyboard.press("Control+z"); // 撤销布局整理
await page.waitForTimeout(300);
const undoPos = await nodePos(1);
ok(
  "布局整理可一次撤销",
  Math.abs(messyPos.x - undoPos.x) < 2 && Math.abs(messyPos.y - undoPos.y) < 2,
);

// 撤销/重做状态：工具栏保存状态与历史
ok("保存状态提示可见", (await page.locator(".save-status").textContent())?.length > 0);

// 回放条：进入 → 步进 → 返回
await page.getByRole("button", { name: "回放" }).click();
await page.waitForTimeout(300);
ok("回放条出现", (await page.locator(".replay-bar").count()) === 1);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
ok("Esc 返回编辑", (await page.locator(".replay-bar").count()) === 0);

// PNG 导出（伸展项 D2）
const dl = page.waitForEvent("download", { timeout: 15000 });
await page.getByRole("button", { name: "导出 PNG" }).click();
const download = await dl;
ok("PNG 导出触发下载", download.suggestedFilename().endsWith(".png"));

// ---- 回归：用户报告「卡片没办法删除或者修改」（真实按键路径） ----
// R1：建卡 → 单击选中 → Delete 删除
await page.mouse.dblclick(300, 620);
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.locator(".node-editor:not(.formula-caption-editor)").pressSequentially("待删除的卡", { delay: 5 });
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(200);
const delTarget = await page.locator(".node-card", { hasText: "待删除的卡" }).boundingBox();
await page.mouse.click(delTarget.x + delTarget.width / 2, delTarget.y + delTarget.height / 2);
await page.waitForTimeout(200);
ok("单击即选中（有选中视觉态）", (await page.locator(".node-card.selected").count()) >= 1);
await page.keyboard.press("Delete");
await page.waitForTimeout(200);
ok("Delete 删除选中卡", (await page.locator(".node-card", { hasText: "待删除的卡" }).count()) === 0);
await page.keyboard.press("Control+z");
await page.waitForTimeout(200);
ok("删除可一次撤销恢复", (await page.locator(".node-card", { hasText: "待删除的卡" }).count()) === 1);

// R2：选中 → Enter 进入编辑 → 改字 → Ctrl+Enter 提交生效
await page.keyboard.press("Escape"); // 撤销后清选，再单击走完整路径
await page.waitForTimeout(150);
const edTarget = await page.locator(".node-card", { hasText: "待删除的卡" }).boundingBox();
await page.mouse.click(edTarget.x + edTarget.width / 2, edTarget.y + edTarget.height / 2);
await page.waitForTimeout(150);
await page.keyboard.press("Enter");
await page.waitForTimeout(150);
ok("Enter 进入编辑态", (await page.locator(".node-editor:not(.formula-caption-editor)").count()) === 1);
await page.locator(".node-editor:not(.formula-caption-editor)").fill("改过的内容XYZ");
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(200);
const updatedMd = await page.evaluate(() => window.__state.file.nodes.map((n) => n.markdown).join("|"));
ok("Ctrl+Enter 提交内容更新", updatedMd.includes("改过的内容XYZ"));

// R3：双击已有卡片直接进入编辑
const dblTarget = await page.locator(".node-card", { hasText: "改过的内容XYZ" }).boundingBox();
await page.mouse.dblclick(dblTarget.x + dblTarget.width / 2, dblTarget.y + dblTarget.height / 2);
await page.waitForTimeout(200);
ok("双击卡片进入编辑态", (await page.locator(".node-editor:not(.formula-caption-editor)").count()) === 1);
await page.keyboard.press("Escape");
await page.waitForTimeout(150);

// R4：IME composition 中按 Ctrl+Enter 也要能提交（中文输入法场景）
await page.keyboard.press("Escape");
const imeCard = await page.locator(".node-card", { hasText: "改过的内容XYZ" }).boundingBox();
await page.mouse.dblclick(imeCard.x + imeCard.width / 2, imeCard.y + imeCard.height / 2);
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
const cdp = await page.context().newCDPSession(page);
try {
  await cdp.send("Input.imeSetComposition", { text: "中文", selectionStart: 2, selectionEnd: 2 });
  await page.keyboard.press("Control+Enter");
  await page.waitForTimeout(200);
  const afterIme = await page.evaluate(() => window.__state.editingId);
  ok("IME composition 中 Ctrl+Enter 提交退出编辑", afterIme === null);
} catch (err) {
  console.log("（跳过 IME 模拟：CDP imeSetComposition 不可用）", String(err).slice(0, 80));
}

// ---- 回归：Issue 1 连续创建叠卡 ----
// 多行根卡 + 连续 3 次 Tab（子卡链）+ 3 次 Shift+Enter（同级顺延），7 卡两两不重叠且间距 ≥8
await page.mouse.dblclick(1050, 720);
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.locator(".node-editor:not(.formula-caption-editor)").pressSequentially("避让根\n第二行\n第三行", { delay: 3 });
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(200);
for (let i = 0; i < 3; i++) {
  await page.keyboard.press("Tab");
  await page.waitForTimeout(200);
  await page.locator(".node-editor:not(.formula-caption-editor)").pressSequentially(`避让子${i}`, { delay: 3 });
  await page.keyboard.press("Control+Enter");
  await page.waitForTimeout(200);
}
for (let i = 0; i < 3; i++) {
  await page.keyboard.press("Shift+Enter");
  await page.waitForTimeout(200);
  await page.locator(".node-editor:not(.formula-caption-editor)").pressSequentially(`避让同级${i}`, { delay: 3 });
  await page.keyboard.press("Control+Enter");
  await page.waitForTimeout(200);
}
const avoidBoxes = await page.evaluate(() => {
  const s = window.__state;
  const ids = s.file.nodes.filter((n) => (n.markdown || "").startsWith("避让")).map((n) => n.id);
  return ids.map((id) => {
    const el = document.querySelector(`[data-node-id="${id}"]`);
    return { id, md: s.file.nodes.find((n) => n.id === id).markdown.slice(0, 5), x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  });
});
ok("避让链共 7 卡", avoidBoxes.length === 7);
let overlapPairs = 0;
let minGap = Infinity;
for (let i = 0; i < avoidBoxes.length; i++)
  for (let j = i + 1; j < avoidBoxes.length; j++) {
    const a = avoidBoxes[i], b = avoidBoxes[j];
    const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    if (ox > 0 && oy > 0) overlapPairs++;
    const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
    const gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
    if (Math.max(gx, gy) > 0) minGap = Math.min(minGap, Math.max(gx, gy));
  }
ok("避让链两两不重叠", overlapPairs === 0);
ok("避让链间距 ≥8（不贴卡）", minGap >= 8);
const childXs = avoidBoxes.filter((b) => b.md.startsWith("避让子")).map((b) => b.x);
ok("子卡链横排有序（x 递增）", childXs.length === 3 && childXs[0] < childXs[1] && childXs[1] < childXs[2]);
const sibYs = avoidBoxes.filter((b) => b.md.startsWith("避让同级")).map((b) => b.y);
ok("同级链竖排有序（y 递增）", sibYs.length === 3 && sibYs[0] < sibYs[1] && sibYs[1] < sibYs[2]);

// ---- 回归：Issue 2 图片卡等比缩放 ----
// 用 DataTransfer 构造 200×100 PNG 走真实 drop 事件路径导入
const dt = await page.evaluateHandle(() => {
  const c = document.createElement("canvas");
  c.width = 200;
  c.height = 100;
  const g = c.getContext("2d");
  g.fillStyle = "#4a63d8";
  g.fillRect(0, 0, 200, 100);
  g.fillStyle = "#fff";
  g.font = "20px sans-serif";
  g.fillText("图", 90, 55);
  const bin = atob(c.toDataURL("image/png").split(",")[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const d = new DataTransfer();
  d.items.add(new File([arr], "test.png", { type: "image/png" }));
  return d;
});
await page.dispatchEvent(".canvas", "drop", { dataTransfer: dt });
await page.waitForTimeout(400);
ok("拖入图片生成图片卡", (await page.locator(".node-card img.node-image").count()) === 1);
await page.getByRole("button", { name: "适应视图" }).click(); // 缩放手柄须完整落在视口内。
const imgNodeId = await page.evaluate(() => window.__state.file.nodes.find((n) => n.type === "image")?.id);
const imgSize0 = await page.evaluate(() => {
  const n = window.__state.file.nodes.find((x) => x.type === "image");
  return { w: n.w, h: n.h };
});
const imgBox = await page.locator(`[data-node-id="${imgNodeId}"]`).boundingBox();
await page.mouse.click(imgBox.x + imgBox.width / 2, imgBox.y + imgBox.height / 2);
await page.waitForTimeout(200);
ok("图片卡选中显示四角手柄", (await page.locator(`[data-node-id="${imgNodeId}"] .img-resize-handle`).count()) === 4);
const seHandle = await page.locator(`[data-node-id="${imgNodeId}"] .img-resize-handle.corner-se`).boundingBox();
await page.mouse.move(seHandle.x + seHandle.width / 2, seHandle.y + seHandle.height / 2);
await page.mouse.down();
await page.mouse.move(seHandle.x + seHandle.width / 2 + 90, seHandle.y + seHandle.height / 2 + 45, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
const imgSize1 = await page.evaluate(() => {
  const n = window.__state.file.nodes.find((x) => x.type === "image");
  return n ? { w: n.w, h: n.h } : null;
});
if (!imgSize1 || !(imgSize1.w > imgSize0.w + 30)) {
  const diag = await page.evaluate(() => {
    const s = window.__state;
    const imgId = s.file.nodes.find((x) => x.type === "image")?.id;
    const el = imgId && document.querySelector(`[data-node-id="${imgId}"]`);
    const world = document.querySelector(".world");
    return {
      saveError: s.saveError,
      lastLabel: s.file.history[s.file.history.length - 1]?.label,
      sel: s.selection,
      img: s.file.nodes.find((x) => x.type === "image"),
      handleCount: document.querySelectorAll(".img-resize-handle").length,
      cardStyle: el ? el.getAttribute("style") : "no-el",
      worldTransform: world ? world.style.transform : "no-world",
      sameIdCount: imgId ? document.querySelectorAll(`[data-node-id="${imgId}"]`).length : 0,
    };
  });
  console.log("DIAG 缩放失败:", JSON.stringify(diag));
}
ok("拖拽后尺寸变大且 h 已写显式值", imgSize1.w > imgSize0.w + 30 && typeof imgSize1.h === "number");
// 宽高比按卡片 chrome（27/23）还原后应与原图 2:1 一致
const ratio = (imgSize1.w - 27) / (imgSize1.h - 23);
ok("严格等比（≈2:1）", Math.abs(ratio - 2) < 0.04);
ok("缩放只产生一个历史步骤", await page.evaluate(() => {
  const h = window.__state.file.history;
  return h[h.length - 1].label === "缩放图片" && h[h.length - 1].ops.length === 1 && h[h.length - 1].ops[0].op === "resizeNode";
}));
await page.keyboard.press("Control+z");
await page.waitForTimeout(200);
const imgSize2 = await page.evaluate(() => {
  const n = window.__state.file.nodes.find((x) => x.type === "image");
  return { w: n.w, h: n.h };
});
ok("Ctrl+Z 一次撤销恢复原尺寸", imgSize2.w === imgSize0.w && imgSize2.h === imgSize0.h);

// ---- 回归：Issue 3 箭头头部落在目标卡边框外侧 ----
const arrowInfo = await page.evaluate(() => {
  const s = window.__state;
  const paths = [...document.querySelectorAll("svg.edge-layer path.edge-path")].map((p) => {
    const nums = p.getAttribute("d").match(/-?\d+\.?\d*/g).map(Number);
    return { endX: nums[nums.length - 2], endY: nums[nums.length - 1] };
  });
  const targets = s.file.edges.map((e) => {
    const el = document.querySelector(`[data-node-id="${e.to}"]`);
    return el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, kind: e.kind } : null;
  });
  return { paths, targets };
});
let arrowsOk = true;
for (let i = 0; i < arrowInfo.targets.length; i++) {
  const t = arrowInfo.targets[i];
  const p = arrowInfo.paths[i];
  if (!t || !p) continue;
  // 终点（箭头头部）必须在目标卡矩形之外、且距边框不超过 30px（贴着边框）
  const inside = p.endX > t.x && p.endX < t.x + t.w && p.endY > t.y && p.endY < t.y + t.h;
  const dxo = Math.max(t.x - p.endX, p.endX - (t.x + t.w), 0);
  const dyo = Math.max(t.y - p.endY, p.endY - (t.y + t.h), 0);
  const dist = Math.hypot(dxo, dyo);
  if (inside || dist > 30) {
    arrowsOk = false;
    console.log(`  箭头异常：边${i}(${t.kind}) 终点(${p.endX.toFixed(0)},${p.endY.toFixed(0)}) inside=${inside} dist=${dist.toFixed(0)}`);
  }
}
ok("全部箭头头部在目标卡边框外侧且贴边", arrowsOk);

// ---- 回归：本批 Issue 1 同级卡自动继承父边 ----
await page.mouse.dblclick(60, 700);
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.locator(".node-editor:not(.formula-caption-editor)").pressSequentially("继承A", { delay: 3 });
await page.keyboard.press("Control+Enter");
await page.keyboard.press("Tab"); // 继承B 挂到 A 下
await page.waitForTimeout(200);
await page.locator(".node-editor:not(.formula-caption-editor)").pressSequentially("继承B", { delay: 3 });
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(200);
await page.keyboard.press("Shift+Enter"); // 在 B 上建同级 B1
await page.waitForTimeout(200);
await page.locator(".node-editor:not(.formula-caption-editor)").pressSequentially("继承B1", { delay: 3 });
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(200);
const inheritInfo = await page.evaluate(() => {
  const s = window.__state.file;
  const byMd = Object.fromEntries(s.nodes.map((n) => [n.markdown, n.id]));
  return {
    ids: byMd,
    edges: s.edges.filter((e) => e.kind === "parentChild").map((e) => `${e.from}->${e.to}`),
  };
});
ok(
  "Shift+Enter 同级卡自动挂同父（A→B1）",
  inheritInfo.edges.includes(`${inheritInfo.ids["继承A"]}->${inheritInfo.ids["继承B1"]}`),
);
// 无父卡 Shift+Enter → 独立卡不建边
await page.mouse.dblclick(60, 780);
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.locator(".node-editor:not(.formula-caption-editor)").pressSequentially("无父C", { delay: 3 });
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(150);
const edgeCountBefore = await page.evaluate(() => window.__state.file.edges.length);
await page.keyboard.press("Shift+Enter");
await page.waitForTimeout(200);
await page.locator(".node-editor:not(.formula-caption-editor)").pressSequentially("无父C1", { delay: 3 });
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(200);
const noParentInfo = await page.evaluate(() => {
  const s = window.__state.file;
  const c1 = s.nodes.find((n) => n.markdown === "无父C1");
  return { edgeCount: s.edges.length, intoC1: c1 ? s.edges.some((e) => e.to === c1.id) : true };
});
ok("无父卡 Shift+Enter 建独立卡不建边", noParentInfo.edgeCount === edgeCountBefore && !noParentInfo.intoC1);

// ---- 回归：本批 Issue 2 文本卡自由比例缩放 + min-height 不裁切 ----
await page.mouse.dblclick(640, 500);
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.locator(".node-editor:not(.formula-caption-editor)").pressSequentially("缩放目标", { delay: 3 });
await page.getByRole("textbox", { name: "卡片备注", exact: true }).fill("用于验证备注宽度与主体独立缩放。");
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(200);
const rszId = await page.evaluate(() => window.__state.file.nodes.find((n) => n.markdown === "缩放目标").id);
const rszBox = await page.locator(`[data-node-id="${rszId}"]`).boundingBox();
await page.mouse.click(rszBox.x + rszBox.width / 2, rszBox.y + rszBox.height / 2);
await page.waitForTimeout(150);
ok("文本卡只显示左右阅读宽度手柄", (await page.locator(`[data-node-id="${rszId}"] .text-resize-handle`).count()) === 2);
const rsz0 = await page.evaluate((id) => {
  const n = window.__state.file.nodes.find((x) => x.id === id);
  const el = document.querySelector(`[data-node-id="${id}"]`);
  return { w: n.w, h: n.h, captionW: n.captionW, domH: el.offsetHeight };
}, rszId);
const se2 = await page.locator(`[data-node-id="${rszId}"] .text-resize-handle.dir-e`).boundingBox();
await page.mouse.move(se2.x + se2.width / 2, se2.y + se2.height / 2);
await page.mouse.down();
await page.mouse.move(se2.x + se2.width / 2 + 60, se2.y + se2.height / 2 + 100, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(250);
const rsz1 = await page.evaluate((id) => {
  const n = window.__state.file.nodes.find((x) => x.id === id);
  return { w: n.w, h: n.h, captionW: n.captionW };
}, rszId);
const dw = rsz1.captionW - (rsz0.captionW ?? 320);

ok("拖动只调整备注阅读宽度，主体尺寸不变", dw > 30 && rsz1.w === rsz0.w && rsz1.h === rsz0.h);
const resizeZoom = await page.evaluate(() => window.__state.file.board.view.zoom);
ok("宽度变化对应拖动距离", Math.abs(dw - 60 / resizeZoom) < 2);
ok("备注宽度以单个 setCaptionWidth 操作提交", await page.evaluate(() => {
  const h = window.__state.file.history;
  return h[h.length - 1].ops.length === 1 && h[h.length - 1].ops[0].op === "setCaptionWidth";
}));
await page.keyboard.press("Control+z");
await page.waitForTimeout(200);
const rsz2 = await page.evaluate((id) => {
  const n = window.__state.file.nodes.find((x) => x.id === id);
  return { w: n.w, h: n.h, captionW: n.captionW };
}, rszId);
ok("Ctrl+Z 恢复", rsz2.w === rsz0.w && rsz2.h === rsz0.h && rsz2.captionW === rsz0.captionW);
// 显式小 h + 长文 → min-height 语义自动撑高不裁切
// （undo 会清空选择，需先重新点选卡片）
const rszBox2 = await page.locator(`[data-node-id="${rszId}"]`).boundingBox();
await page.mouse.click(rszBox2.x + rszBox2.width / 2, rszBox2.y + rszBox2.height / 2);
await page.waitForTimeout(150);
const se3 = await page.locator(`[data-node-id="${rszId}"] .text-resize-handle.dir-e`).boundingBox();
await page.mouse.move(se3.x + se3.width / 2, se3.y + se3.height / 2);
await page.mouse.down();
await page.mouse.move(se3.x + se3.width / 2 + 0, se3.y + se3.height / 2 + 40, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(200);
await page.mouse.dblclick(rszBox.x + rszBox.width / 2, rszBox.y + rszBox.height / 2);
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
const longText = Array.from({ length: 12 }, (_, i) => `第${i + 1}行长文字内容`).join("\n");
await page.locator(".node-editor:not(.formula-caption-editor)").fill(longText);
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(300);
const clip = await page.evaluate((id) => {
  const n = window.__state.file.nodes.find((x) => x.id === id);
  const el = document.querySelector(`[data-node-id="${id}"]`);
  const content = el.querySelector(".node-rendered");
  return {
    explicitH: n.h,
    domH: el.offsetHeight,
    // 真裁切判据：渲染内容底边是否落在卡片底边内（border 容差 2px）
    contentInside: content.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 2,
  };
}, rszId);
ok("长主体随内容增高，完整保留旧正文", clip.domH > 100 && clip.contentInside);

// ---- 回归：本批 Issue 3 图片 caption ----
const imgCount0 = await page.evaluate(() => window.__state.file.nodes.filter((n) => n.type === "image").length);
const dt2 = await page.evaluateHandle(() => {
  const c = document.createElement("canvas");
  c.width = 200; c.height = 100;
  c.getContext("2d").fillRect(0, 0, 200, 100);
  const bin = atob(c.toDataURL("image/png").split(",")[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const d = new DataTransfer();
  d.items.add(new File([arr], "t.png", { type: "image/png" }));
  return d;
});
await page.dispatchEvent(".canvas", "drop", { dataTransfer: dt2 });
await page.waitForTimeout(400);
const capId = await page.evaluate((cnt) => {
  const imgs = window.__state.file.nodes.filter((n) => n.type === "image");
  return imgs.length > cnt ? imgs[imgs.length - 1].id : null;
}, imgCount0);
ok("第二张图片卡导入", !!capId);
const capBox = await page.locator(`[data-node-id="${capId}"]`).boundingBox();
await page.mouse.click(capBox.x + capBox.width / 2, capBox.y + capBox.height / 2);
await page.waitForTimeout(150);
await page.keyboard.press("Enter"); // 图片卡 Enter → caption 编辑
await page.waitForTimeout(200);
ok("图片卡 Enter 进入 caption 编辑", (await page.locator(`[data-node-id="${capId}"] .caption-editor`).count()) === 1);
await page.locator(`[data-node-id="${capId}"] .caption-editor`).pressSequentially("**图注** $x^2$", { delay: 3 });
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(300);
ok("caption 渲染在图片下方（Markdown+公式）", await page.evaluate((id) => {
  const el = document.querySelector(`[data-node-id="${id}"]`);
  const cap = el.querySelector(".node-caption");
  return !!cap && !!cap.querySelector("strong") && !!cap.querySelector(".katex") && !cap.querySelector(".math-error");
}, capId));
ok("caption 写入 image 节点 markdown 字段", await page.evaluate((id) => {
  const n = window.__state.file.nodes.find((x) => x.id === id);
  return n.markdown === "**图注** $x^2$";
}, capId));

// ---- 回归：本批 Issue 4 插入工具条 ----
await page.mouse.dblclick(820, 500);
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
ok("编辑态出现插入工具条", (await page.locator(".insert-bar").count()) === 1);
await page.locator(".node-editor:not(.formula-caption-editor)").fill("普通");
await page.keyboard.press("Home");
await page.keyboard.press("Shift+End");
await page.locator('.insert-bar button[title^="粗体"]').click();
await page.waitForTimeout(150);
const boldVal = await page.locator(".node-editor:not(.formula-caption-editor)").evaluate((el) => el.value);
ok("粗体包裹选中文本", boldVal === "**普通**");
await page.locator(".node-editor:not(.formula-caption-editor)").fill("");
await page.locator('.insert-bar button[title^="公式积木"]').click();
await page.waitForTimeout(100);
await page.locator('.insert-panel button[title^="分式"]').click();
await page.waitForTimeout(150);
const fracVal = await page.locator(".node-editor:not(.formula-caption-editor)").evaluate((el) => ({ v: el.value, s: el.selectionStart }));
ok("插入分式模板", fracVal.v === "\\frac{}{}");
ok("光标落到分式分子占位处", fracVal.s === 6);
await page.locator('.insert-panel button[title^="根式"]').click();
await page.waitForTimeout(150);
const sqrtVal = await page.locator(".node-editor:not(.formula-caption-editor)").evaluate((el) => ({ v: el.value, s: el.selectionStart }));
ok("积木嵌套（分式里插根式）", sqrtVal.v === "\\frac{\\sqrt{}}{}" && sqrtVal.s === 12);
await page.keyboard.insertText("x");
// \frac{\sqrt{x}}{} 共 17 字符，分母 {} 内是位置 16
await page.locator(".node-editor:not(.formula-caption-editor)").evaluate((el) => el.setSelectionRange(16, 16));
await page.keyboard.press("2"); // 真实按键事件，走浏览器自身光标（尊重 setSelectionRange）
const finalVal = await page.locator(".node-editor:not(.formula-caption-editor)").evaluate((el) => el.value);
ok("连续积木搭出 \\frac{\\sqrt{x}}{2}", finalVal === "\\frac{\\sqrt{x}}{2}");
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(300);
const mathOk = await page.evaluate(() => {
  const caps = [...document.querySelectorAll(".node-rendered")];
  return caps.some((c) => c.querySelector(".katex")) && ![...document.querySelectorAll(".node-rendered")].some((c) => c.querySelector(".math-error"));
});
ok("插入后渲染无公式错误", mathOk);

// ---- 回归：本批「同级卡继承」三路径（甲：树父子；乙：入向 association 复制；丙：连续流） ----
// 空格+拖动平移找空白区（真实用户路径），找不到就继续平移，避免与既有卡片互撞
const panMore = async () => {
  await page.keyboard.down(" ");
  await page.mouse.move(1150, 400);
  await page.mouse.down();
  await page.mouse.move(400, 400, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up(" ");
  await page.waitForTimeout(150);
};
const freeSpot = async () => {
  const occ = await page.evaluate(() => {
    const canvas = document.querySelector(".canvas").getBoundingClientRect();
    return {
      zoom: window.__state.file.board.view.zoom,
      canvas: { left: canvas.left, top: canvas.top, right: canvas.right, bottom: canvas.bottom },
      rects: [...document.querySelectorAll(".node-card")].map(el => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    };
  });
  for (let y = 120; y < 700; y += 110) {
    for (let x = 80; x < 1080; x += 250) {
      const cardX = x - 120 * occ.zoom, cardY = y - 30 * occ.zoom;
      const cardW = 240 * occ.zoom, cardH = 100 * occ.zoom;
      if (cardX < occ.canvas.left + 20 || cardX + cardW > occ.canvas.right - 20 || cardY < occ.canvas.top + 20 || cardY + cardH > occ.canvas.bottom - 20) continue;
      const gap = 80 * occ.zoom;
      const hit = occ.rects.some(r => cardX < r.x + r.w + gap && cardX + cardW + gap > r.x && cardY < r.y + r.h + gap && cardY + cardH + gap > r.y);
      if (!hit) return { x, y };
    }
  }
  return null;
};
const ensureSpot = async () => {
  let s = await freeSpot();
  for (let i = 0; i < 4 && !s; i++) {
    await panMore();
    s = await freeSpot();
  }
  if (!s) throw new Error("找不到空白点");
  return s;
};
const idByMd = () => page.evaluate(() => Object.fromEntries(window.__state.file.nodes.map((n) => [n.markdown, n.id])));
const edgeBetween = (fromMd, toMd, kind) =>
  page.evaluate(([f, t, k]) => {
    const s = window.__state.file;
    const ids = Object.fromEntries(s.nodes.map((n) => [n.markdown, n.id]));
    return s.edges.some((e) => e.kind === k && e.from === ids[f] && e.to === ids[t]);
  }, [fromMd, toMd, kind]);

// 路径甲：树父子同级继承
const spA = await ensureSpot();
await page.mouse.dblclick(spA.x, spA.y);
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.keyboard.insertText("甲A");
await page.keyboard.press("Control+Enter");
await page.keyboard.press("Tab");
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.keyboard.insertText("甲B");
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(200);
// 单击选中 B 再 Shift+Enter（真实路径，不靠创建后的选中态）
await page.locator(".node-card", { hasText: "甲B" }).first().click();
await page.waitForTimeout(150);
await page.keyboard.press("Shift+Enter");
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.keyboard.insertText("甲B1");
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(200);
ok("路径甲：B1 挂同父 A→B1（parentChild）", await edgeBetween("甲A", "甲B1", "parentChild"));

// 路径乙：手动 association 箭头后 Shift+Enter 复制入向关联
const spB = await ensureSpot();
await page.mouse.dblclick(spB.x, spB.y);
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.keyboard.insertText("乙A");
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(150);
const spB2 = await ensureSpot();
await page.mouse.dblclick(spB2.x, spB2.y);
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.keyboard.insertText("乙B");
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(200);
const yiIds = await idByMd();
await page.getByRole("button", { name: "适应视图" }).click();
await page.locator(`[data-node-id="${yiIds["乙A"]}"]`).hover();
const yhb = await page.locator(`[data-node-id="${yiIds["乙A"]}"] .connect-handle`).boundingBox();
const ybb = await page.locator(`[data-node-id="${yiIds["乙B"]}"]`).boundingBox();
await page.mouse.move(yhb.x + yhb.width / 2, yhb.y + yhb.height / 2, { steps: 3 });
await page.mouse.down();
await page.mouse.move(ybb.x + ybb.width / 2, ybb.y + ybb.height / 2, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(300);
await page.keyboard.press("Escape"); // 关掉 label 输入
await page.waitForTimeout(150);
ok("路径乙：association 乙A→乙B 已建", await edgeBetween("乙A", "乙B", "association"));
await page.locator(`[data-node-id="${yiIds["乙B"]}"]`).click();
await page.waitForTimeout(150);
await page.keyboard.press("Shift+Enter");
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.keyboard.insertText("乙B1");
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(200);
ok("路径乙：同级卡复制入向 association 乙A→乙B1", await edgeBetween("乙A", "乙B1", "association"));
ok("路径乙：不产生 parentChild 边", !(await edgeBetween("乙A", "乙B1", "parentChild")));
ok(
  "路径乙：复制边 label 留空、方向一致",
  await page.evaluate(() => {
    const s = window.__state.file;
    const ids = Object.fromEntries(s.nodes.map((n) => [n.markdown, n.id]));
    const e = s.edges.find((x) => x.kind === "association" && x.from === ids["乙A"] && x.to === ids["乙B1"]);
    return !!e && !e.label && e.directed === true;
  }),
);

// 路径丙：高频连续流——Tab 建子后连按两次 Shift+Enter
const spC = await ensureSpot();
await page.mouse.dblclick(spC.x, spC.y);
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.keyboard.insertText("丙A");
await page.keyboard.press("Control+Enter");
await page.keyboard.press("Tab");
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.keyboard.insertText("丙B");
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(200);
await page.keyboard.press("Shift+Enter");
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.keyboard.insertText("丙B1");
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(200);
await page.keyboard.press("Shift+Enter");
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.keyboard.insertText("丙B2");
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(200);
ok(
  "路径丙：B/B1/B2 都挂丙A 下",
  (await edgeBetween("丙A", "丙B", "parentChild")) &&
    (await edgeBetween("丙A", "丙B1", "parentChild")) &&
    (await edgeBetween("丙A", "丙B2", "parentChild")),
);
const bingRects = await page.evaluate(() => {
  const s = window.__state.file;
  return ["丙B", "丙B1", "丙B2"].map((m) => {
    const n = s.nodes.find((x) => x.markdown === m);
    const el = document.querySelector(`[data-node-id="${n.id}"]`);
    return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  });
});
let bingOverlap = false;
for (let i = 0; i < 3; i++)
  for (let j = i + 1; j < 3; j++) {
    const a = bingRects[i], b = bingRects[j];
    if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) bingOverlap = true;
  }
ok("路径丙：三卡互不重叠", !bingOverlap);

// 公式段前：适应视图让整板可见，保证新建卡与拖拽都在视口内
await page.getByRole("button", { name: "适应视图" }).click();
await page.waitForTimeout(300);

// ---- 回归：纯公式卡缩放（公式本体随卡片连续等比缩放；混合卡字号不变） ----
const katexW = (id) =>
  page.evaluate((i) => {
    // display 模式 .katex 是 block 占满容器；真实字形宽看最外层 .base
    const k = document.querySelector(`[data-node-id="${i}"] .katex .base`);
    return k ? k.getBoundingClientRect().width : null;
  }, id);
const katexH = (id) =>
  page.evaluate((i) => {
    const k = document.querySelector(`[data-node-id="${i}"] .katex`);
    return k ? k.getBoundingClientRect().height : null;
  }, id);
const nodeWH = (id) =>
  page.evaluate((i) => {
    const n = window.__state.file.nodes.find((x) => x.id === i);
    return { w: n.w, h: n.h };
  }, id);
const formulaWrap = (id) =>
  page.evaluate((i) => {
    const card = document.querySelector(`[data-node-id="${i}"]`).getBoundingClientRect();
    const k = document.querySelector(`[data-node-id="${i}"] .katex .base`).getBoundingClientRect();
    const kh = document.querySelector(`[data-node-id="${i}"] .katex`).getBoundingClientRect();
    const zoom = window.__state.file.board.view.zoom;
    return {
      slackX: (card.width - k.width) / zoom,
      slackY: (card.height - kh.height) / zoom,
      inside:
        k.left >= card.left - 2 &&
        k.right <= card.right + 2 &&
        kh.top >= card.top - 2 &&
        kh.bottom <= card.bottom + 2,
    };
  }, id);

const spF = await ensureSpot();
await page.mouse.dblclick(spF.x, spF.y);
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.keyboard.insertText("$$\\frac{a}{b}$$");
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(300);
const fId = await page.evaluate(() => window.__state.file.nodes.find((n) => (n.markdown ?? "").includes("\\frac{a}{b}")).id);
await page.locator(`[data-node-id="${fId}"]`).click();
await page.waitForTimeout(150);
const fW0 = await nodeWH(fId);
const fK0 = await katexW(fId);
const fKH0 = await katexH(fId);
const fWrap0 = await formulaWrap(fId);
ok("纯公式卡默认宽度贴合公式（小于默认 240）", fW0.w < 200 && fW0.h != null);
ok("纯公式卡边界贴合公式", fWrap0.inside && fWrap0.slackX < 50 && fWrap0.slackY < 50);
ok("纯公式卡四角等比手柄", (await page.locator(`[data-node-id="${fId}"] .formula-resize-handle`).count()) === 4);
ok("纯公式卡无自由比例手柄", (await page.locator(`[data-node-id="${fId}"] .text-resize-handle`).count()) === 0);
// 放大
const fse = await page.locator(`[data-node-id="${fId}"] .formula-resize-handle.corner-se`).boundingBox();
await page.mouse.move(fse.x + fse.width / 2, fse.y + fse.height / 2);
await page.mouse.down();
await page.mouse.move(fse.x + fse.width / 2 + 160, fse.y + fse.height / 2 + 110, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
const fW1 = await nodeWH(fId);
const fK1 = await katexW(fId);
const fKH1 = await katexH(fId);
const fWrap1 = await formulaWrap(fId);
const fInnerRatio = (fW1.w - 27) / (fW0.w - 27); // chrome 固定，公式比例看内容宽
const fKatexRatio = fK1 / fK0;
ok("纯公式卡放大：公式随卡片变大", fKatexRatio > 1.3);
ok("放大比与内容宽比近似", Math.abs(fKatexRatio - fInnerRatio) < 0.2);
ok("放大后公式宽高比不变", Math.abs(fK1 / fKH1 - fK0 / fKH0) < 0.08);
ok("放大后边界仍贴合公式", fWrap1.inside && fWrap1.slackX < 50 && fWrap1.slackY < 50);
ok("缩放公式单 resizeNode 步骤", await page.evaluate(() => {
  const h = window.__state.file.history;
  return h[h.length - 1].label === "缩放公式" && h[h.length - 1].ops.length === 1 && h[h.length - 1].ops[0].op === "resizeNode";
}));
// 缩小
const fse2 = await page.locator(`[data-node-id="${fId}"] .formula-resize-handle.corner-se`).boundingBox();
await page.mouse.move(fse2.x + fse2.width / 2, fse2.y + fse2.height / 2);
await page.mouse.down();
await page.mouse.move(fse2.x + fse2.width / 2 - 90, fse2.y + fse2.height / 2 - 60, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(300);
const fK2 = await katexW(fId);
ok("纯公式卡缩小：公式跟着变小", fK2 < fK1 * 0.85);
ok("公式渲染无 KaTeX error", (await page.locator(`[data-node-id="${fId}"] .math-error`).count()) === 0);
// Ctrl+Z 恢复（尺寸与公式大小）
await page.keyboard.press("Control+z");
await page.waitForTimeout(250);
const fWz = await nodeWH(fId);
const fKz = await katexW(fId);
ok("Ctrl+Z 后尺寸与公式大小恢复", fWz.w === fW1.w && fWz.h === fW1.h && Math.abs(fKz - fK1) < 2);
// 极限：拖到最小尺寸，公式完整可见不裁切（undo 清空了选择，先重新点选）
await page.locator(`[data-node-id="${fId}"]`).click();
await page.waitForTimeout(150);
const fse3 = await page.locator(`[data-node-id="${fId}"] .formula-resize-handle.corner-se`).boundingBox();
await page.mouse.move(fse3.x + fse3.width / 2, fse3.y + fse3.height / 2);
await page.mouse.down();
await page.mouse.move(fse3.x + fse3.width / 2 - 400, fse3.y + fse3.height / 2 - 300, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
const minCheck = await page.evaluate((i) => {
  const cardEl = document.querySelector(`[data-node-id="${i}"]`);
  const card = cardEl.getBoundingClientRect();
  const k = document.querySelector(`[data-node-id="${i}"] .katex .base`).getBoundingClientRect();
  const kh = document.querySelector(`[data-node-id="${i}"] .katex`).getBoundingClientRect();
  const pad = 4;
  const n = window.__state.file.nodes.find((x) => x.id === i);
  return {
    cardW: card.width,
    cardH: card.height,
    kW: k.width,
    kH: kh.height,
    overflowLeft: card.left - k.left,
    overflowRight: k.right - card.right,
    overflowTop: card.top - kh.top,
    overflowBottom: kh.bottom - card.bottom,
    fontSize: getComputedStyle(cardEl.querySelector(".formula-scaled")).fontSize,
    zoom: window.__state.file.board.view.zoom,
    nodeW: n.w,
    nodeH: n.h,
    insideX: k.left >= card.left - pad && k.right <= card.right + pad,
    insideY: kh.top >= card.top - pad && kh.bottom <= card.bottom + pad,
  };
}, fId);
ok(
  "极限最小尺寸：公式完整不裁切",
  minCheck.insideX && minCheck.insideY && minCheck.kW / minCheck.zoom > 4,
);

// 混合内容卡：框变字号不变
const spM = await ensureSpot();
await page.mouse.dblclick(spM.x, spM.y);
await page.waitForSelector(".node-editor:not(.formula-caption-editor)");
await page.keyboard.insertText("说明文字 $x^2$ 结尾");
await page.getByRole("textbox", { name: "卡片备注", exact: true }).fill("混合公式卡的独立备注。");
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(250);
const mId = await page.evaluate(() => window.__state.file.nodes.find((n) => (n.markdown ?? "").startsWith("说明文字")).id);
await page.locator(`[data-node-id="${mId}"]`).click();
await page.waitForTimeout(150);
const mK0 = await katexW(mId);
const mW0 = await page.evaluate(id => window.__state.file.nodes.find(n => n.id === id).captionW ?? 320, mId);
const mse = await page.locator(`[data-node-id="${mId}"] .text-resize-handle.dir-e`).boundingBox();
await page.mouse.move(mse.x + mse.width / 2, mse.y + mse.height / 2);
await page.mouse.down();
await page.mouse.move(mse.x + mse.width / 2 + 140, mse.y + mse.height / 2 + 90, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(300);
const mK1 = await katexW(mId);
const mW1 = await page.evaluate(id => window.__state.file.nodes.find(n => n.id === id).captionW, mId);
ok("混合卡调整阅读宽度", mW1 > mW0 + 80);
ok("混合卡拖角：公式字号不变", Math.abs(mK1 - mK0) < 2);

// 双击建卡遵循光标位置，即使新卡外框与邻卡重叠；缩放后仍如此。
const placementPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
placementPage.on("pageerror", (e) => errors.push("placement pageerror: " + e.message));
await placementPage.goto(URL);
await placementPage.mouse.dblclick(620, 360);
await placementPage.getByRole("textbox", { name: "卡片正文", exact: true }).fill("邻近卡片");
await placementPage.keyboard.press("Control+Enter");
const placementCards = placementPage.locator(".node-card");
const firstPlacementCard = placementCards.first();
async function doubleClickNextTo(card, label) {
  const beforeCount = await placementCards.count();
  const box = await card.boundingBox();
  const point = { x: box.x + box.width + 40, y: box.y + box.height / 2 };
  await placementPage.evaluate(() => {
    window.__placementClick = null;
    const canvas = document.querySelector(".canvas");
    canvas.addEventListener("dblclick", e => {
      const rect = canvas.getBoundingClientRect();
      window.__placementClick = {
        x: e.clientX, y: e.clientY, left: rect.left, top: rect.top,
        view: { ...window.__state.file.board.view },
      };
    }, { once: true, capture: true });
  });
  await placementPage.mouse.dblclick(point.x, point.y);
  const clicked = await placementPage.evaluate(() => window.__placementClick);
  const expected = {
    x: Math.round((clicked.x - clicked.left - clicked.view.panX) / clicked.view.zoom - 120),
    y: Math.round((clicked.y - clicked.top - clicked.view.panY) / clicked.view.zoom - 30),
  };
  await placementPage.waitForFunction(n => window.__state.file.nodes.length === n, beforeCount + 1);
  const created = await placementPage.evaluate(() => {
    const node = window.__state.file.nodes.at(-1);
    return { id: node.id, x: node.x, y: node.y, editingId: window.__state.editingId };
  });
  ok(label + "光标原地落卡", created.x === expected.x && created.y === expected.y);
  ok(label + "立即聚焦编辑", created.editingId === created.id &&
    await placementPage.evaluate(id => document.activeElement?.closest(".node-card")?.dataset.nodeId === id, created.id));
  const newCard = placementPage.locator('[data-node-id="' + created.id + '"]');
  const newBox = await newCard.boundingBox();
  ok(label + "编辑卡仍在双击点附近",
    Math.abs(newBox.x + 120 * clicked.view.zoom - clicked.x) < 2 &&
    Math.abs(newBox.y + 30 * clicked.view.zoom - clicked.y) < 2);
  ok(label + "允许与邻卡重叠",
    Math.min(box.x + box.width, newBox.x + newBox.width) > Math.max(box.x, newBox.x) &&
    Math.min(box.y + box.height, newBox.y + newBox.height) > Math.max(box.y, newBox.y));
  return newCard;
}
const secondPlacementCard = await doubleClickNextTo(firstPlacementCard, "默认缩放：");
await placementPage.screenshot({ path: "artifacts/double-click-exact-default.png" });
await placementPage.getByRole("textbox", { name: "卡片正文", exact: true }).fill("第二张卡片");
await placementPage.keyboard.press("Control+Enter");
await placementPage.mouse.move(950, 620);
await placementPage.keyboard.down("Control");
await placementPage.mouse.wheel(0, -180);
await placementPage.keyboard.up("Control");
await placementPage.waitForTimeout(180);
ok("双击落点回归使用非 100% 缩放", await placementPage.evaluate(() => window.__state.file.board.view.zoom !== 1));
await doubleClickNextTo(secondPlacementCard, "缩放后：");
await placementPage.screenshot({ path: "artifacts/double-click-exact-zoom.png" });
await placementPage.close();
// Ctrl+左键逐张加选；从空白处左拖捕网，边缘接触也加入选区。
const selectionPage = await browser.newPage({ viewport: { width: 1100, height: 760 } });
selectionPage.on("pageerror", (e) => errors.push("selection pageerror: " + e.message));
await selectionPage.goto(URL);
for (const [x, label] of [[190, "选区 A"], [460, "选区 B"], [770, "选区 C"]]) {
  await selectionPage.mouse.dblclick(x, 260);
  await selectionPage.getByRole("textbox", { name: "卡片正文", exact: true }).fill(label);
  await selectionPage.keyboard.press("Control+Enter");
}
const selectionIds = await selectionPage.evaluate(() => window.__state.file.nodes.map(n => n.id));
const selectionCards = selectionIds.map(id => selectionPage.locator('[data-node-id="' + id + '"]'));
await selectionPage.mouse.click(1000, 620);
const selectionVersion = await selectionPage.evaluate(() => ({
  version: window.__state.file.board.contentVersion,
  history: window.__state.file.history.length,
}));
async function ctrlLeftClickCard(card) {
  const box = await card.boundingBox();
  await selectionPage.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "left" });
}
const selectedIds = () => selectionPage.evaluate(() => window.__state.selection.nodes);
await selectionPage.keyboard.down("Control");
await ctrlLeftClickCard(selectionCards[0]);
await ctrlLeftClickCard(selectionCards[1]);
await ctrlLeftClickCard(selectionCards[0]);
await selectionPage.mouse.click(1000, 620, { button: "left" });
await selectionPage.keyboard.up("Control");
ok("Ctrl+左键连续加选且空白点击不清空", JSON.stringify(await selectedIds()) === JSON.stringify(selectionIds.slice(0, 2)));
const cBox = await selectionCards[2].boundingBox();
await selectionPage.keyboard.down("Control");
await selectionPage.mouse.move(cBox.x - 55, cBox.y - 25);
await selectionPage.mouse.down({ button: "left" });
await selectionPage.mouse.move(cBox.x, cBox.y + 10, { steps: 8 });
ok("Ctrl+左拖显示矩形捕网", await selectionPage.locator(".marquee").count() === 1);
await selectionPage.screenshot({ path: "artifacts/ctrl-left-marquee-default.png" });
await selectionPage.mouse.up({ button: "left" });
await selectionPage.keyboard.up("Control");
ok("捕网触及第三张卡并保留原选区", JSON.stringify(await selectedIds()) === JSON.stringify(selectionIds));
ok("松开后捕网消失", await selectionPage.locator(".marquee").count() === 0);
await selectionPage.mouse.click(1000, 620);
await selectionCards[1].click();
ok("空白清选后普通左键单选", JSON.stringify(await selectedIds()) === JSON.stringify([selectionIds[1]]));
await selectionPage.mouse.move(820, 560);
await selectionPage.keyboard.down("Control");
await selectionPage.mouse.wheel(0, -180);
await selectionPage.keyboard.up("Control");
await selectionPage.waitForTimeout(180);
ok("左键捕网回归使用非 100% 缩放", await selectionPage.evaluate(() => window.__state.file.board.view.zoom !== 1));
const zoomC = await selectionCards[2].boundingBox();
await selectionPage.keyboard.down("Control");
await selectionPage.mouse.move(zoomC.x - 40, zoomC.y - 20);
await selectionPage.mouse.down({ button: "left" });
await selectionPage.mouse.move(zoomC.x + 5, zoomC.y + 5, { steps: 8 });
await selectionPage.mouse.up({ button: "left" });
await selectionPage.keyboard.up("Control");
ok("缩放后捕网仍可加选", JSON.stringify(await selectedIds()) === JSON.stringify(selectionIds.slice(1)));
await selectionPage.screenshot({ path: "artifacts/ctrl-left-marquee-zoom.png" });
const selectionVersionAfter = await selectionPage.evaluate(() => ({
  version: window.__state.file.board.contentVersion,
  history: window.__state.file.history.length,
}));
ok("左键选择不写入文件和历史", JSON.stringify(selectionVersionAfter) === JSON.stringify(selectionVersion));
await selectionPage.mouse.click(1000, 620);
const rightOnlyBox = await selectionCards[2].boundingBox();
await selectionPage.keyboard.down("Control");
await selectionPage.mouse.click(rightOnlyBox.x + rightOnlyBox.width / 2, rightOnlyBox.y + rightOnlyBox.height / 2, { button: "right" });
await selectionPage.keyboard.up("Control");
ok("Ctrl+右键不再选卡", (await selectedIds()).length === 0);
await selectionPage.close();
const fatal = errors.filter((e) => !e.includes("favicon"));
ok("无浏览器报错", fatal.length === 0);
if (fatal.length) console.log(fatal.join("\n"));

await browser.close();
server.kill();
console.log(process.exitCode === 1 ? "SMOKE FAIL" : "SMOKE PASS");
