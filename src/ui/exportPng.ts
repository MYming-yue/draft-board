// PNG 导出（需求 §F08）：克隆画布 DOM → 内联样式与图片 → SVG foreignObject → canvas → PNG。
// 不引 html-to-image 类依赖。已知限制：KaTeX Web 字体在 SVG 沙箱内不加载，
// 公式回退为衬线斜体（仍可读）；其余样式完整。
export async function exportBoardPng(fileName: string): Promise<void> {
  const world = document.querySelector<HTMLElement>(".world");
  if (!world) throw new Error("找不到画布");

  const cards = [...world.querySelectorAll<HTMLElement>(".node-card, .collection-frame")];
  if (cards.length === 0) throw new Error("白板为空，无可导出内容");
  const pad = 60;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const c of cards) {
    x0 = Math.min(x0, c.offsetLeft);
    y0 = Math.min(y0, c.offsetTop);
    x1 = Math.max(x1, c.offsetLeft + c.offsetWidth);
    y1 = Math.max(y1, c.offsetTop + c.offsetHeight);
  }
  x0 -= pad;
  y0 -= pad;
  x1 += pad;
  y1 += pad;
  const w = x1 - x0;
  const h = y1 - y0;

  // 克隆并平移到 (0,0)
  const clone = world.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".formula-caption-button").forEach((button) => button.remove());
  clone.style.transform = `translate(${-x0}px, ${-y0}px)`;
  clone.style.width = `${w}px`;
  clone.style.height = `${h}px`;

  // blob: 图片内联为 data URL（SVG <img> 沙箱不加载外部 blob）
  const imgs = [...clone.querySelectorAll("img")];
  for (const img of imgs) {
    if (img.src.startsWith("blob:")) {
      const blob = await (await fetch(img.src)).blob();
      img.src = await new Promise<string>((resolvePromise) => {
        const fr = new FileReader();
        fr.onload = () => resolvePromise(fr.result as string);
        fr.readAsDataURL(blob);
      });
    }
    img.style.maxWidth = "100%";
  }

  // 收集同源样式表文本
  let css = "";
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) css += rule.cssText + "\n";
    } catch {
      // 跨域样式表跳过（本项目没有）
    }
  }

  const serialized = new XMLSerializer().serializeToString(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<foreignObject x="0" y="0" width="${w}" height="${h}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml"><style>${css}</style>${serialized}</div>` +
    `</foreignObject></svg>`;

  // data: URL 而非 blob: URL——blob SVG <img> 绘制到 canvas 会被污染（taint），无法 toBlob
  const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  try {
    const img = await new Promise<HTMLImageElement>((resolvePromise, reject) => {
      const i = new Image();
      i.onload = () => resolvePromise(i);
      i.onerror = () => reject(new Error("SVG 渲染失败"));
      i.src = svgUrl;
    });
    const scale = Math.min(2, 16384 / Math.max(w, h)); // 清晰度 ×2，防爆 canvas 上限
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor || "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const pngBlob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!pngBlob) throw new Error("PNG 编码失败");
    const url = URL.createObjectURL(pngBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(/\.draft$/, "") + ".png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } finally {
    // data URL 无需 revoke
  }
}
