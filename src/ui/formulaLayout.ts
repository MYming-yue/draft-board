// 纯公式卡几何：卡片外框贴合公式，缩放时公式与外框同比例变化。
// 渲染层派生，不新增 op；落盘仍走现有 resizeNode。
import { pureFormulaKind, renderMarkdown } from "./markdown";

/** 与 .node-card padding/border 对齐（border-box） */
export const CARD_CHROME_X = 12 + 12 + 1.5 + 1.5; // 27
export const CARD_CHROME_Y = 10 + 10 + 1.5 + 1.5; // 23
export const FORMULA_FONT = 14;
export const CONCEPT_FONT = 18;
export const FORMULA_SCALE_MIN = 0.5;
export const FORMULA_SCALE_MAX = 6;
export const MIN_CAPTION_W = 220;
export const DEFAULT_CAPTION_W = 320;

export function clampFormulaScale(s: number): number {
  if (!Number.isFinite(s)) return 1;
  return Math.min(FORMULA_SCALE_MAX, Math.max(FORMULA_SCALE_MIN, s));
}

export function formulaBoxFromNatural(natural: { w: number; h: number }, scale: number) {
  const s = clampFormulaScale(scale);
  return {
    w: natural.w * s + CARD_CHROME_X,
    h: natural.h * s + CARD_CHROME_Y,
    scale: s,
    fontSize: FORMULA_FONT * s,
  };
}

export function formulaScaleFromCardW(naturalW: number, cardW: number): number {
  if (!(naturalW > 0)) return 1;
  return clampFormulaScale((cardW - CARD_CHROME_X) / naturalW);
}

/**
 * 四角拖动：用指针相对按下点的距离决定比例（往外放大、往里缩小）。
 * dw/dh 已按角方向取号，正值表示该轴向外。chrome 不参与对角线。
 */
export function scaleFromCornerDistance(
  startScale: number,
  natural: { w: number; h: number },
  dw: number,
  dh: number,
): number {
  const contentDiag = Math.hypot(natural.w, natural.h) * startScale;
  if (!(contentDiag > 0)) return clampFormulaScale(startScale);
  const dist = Math.hypot(dw, dh);
  const along = dw + dh;
  if (dist === 0 || along === 0) return clampFormulaScale(startScale);
  const signed = along > 0 ? dist : -dist;
  return clampFormulaScale((startScale * (contentDiag + signed)) / contentDiag);
}

export function conceptBoxFromNatural(natural: { w: number; h: number }, scale: number) {
  const s = clampFormulaScale(scale);
  return {
    w: natural.w * s + CARD_CHROME_X,
    h: natural.h * s + CARD_CHROME_Y,
    scale: s,
    fontSize: CONCEPT_FONT * s,
  };
}

/** 离屏量一次 18px 基准下的概念核心尺寸。只按源码换行，不按宽度自动折行。 */
export function measureConceptNatural(markdown: string): { w: number; h: number } | null {
  if (typeof document === "undefined") return null;
  const host = document.createElement("div");
  host.className = "node-rendered concept-core";
  host.style.cssText =
    `position:absolute;visibility:hidden;left:-9999px;top:0;font-size:${CONCEPT_FONT}px;font-weight:600;text-align:center;line-height:1.55;width:max-content;max-width:none;white-space:nowrap;word-break:normal;overflow-wrap:normal;margin:0;padding:0;border:0;`;
  host.innerHTML = renderMarkdown(markdown);
  document.body.appendChild(host);
  const box = host.getBoundingClientRect();
  host.remove();
  return box.width > 0 && box.height > 0 ? { w: box.width, h: box.height } : null;
}

/** 离屏量一次 14px 基准下的公式字形尺寸。无 DOM / 非纯公式 / 量不到则 null。 */
export function measureFormulaNatural(markdown: string): { w: number; h: number } | null {
  if (typeof document === "undefined") return null;
  if (!pureFormulaKind(markdown)) return null;
  const host = document.createElement("div");
  host.className = "node-rendered formula-scaled";
  host.style.cssText =
    `position:absolute;visibility:hidden;left:-9999px;top:0;font-size:${FORMULA_FONT}px;margin:0;padding:0;border:0;`;
  host.innerHTML = renderMarkdown(markdown);
  document.body.appendChild(host);
  // display 模式 .katex 可能撑满容器宽；取 .base / .katex / host 的最大外框，避免斜体/上下标溢出
  const boxOf = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
  const katexBox = boxOf(host.querySelector(".katex"));
  const baseBox = boxOf(host.querySelector(".katex .base"));
  const hostBox = host.getBoundingClientRect();
  // scrollHeight 会包含 KaTeX 辅助 MathML/基线溢出，不能作为可见字形高度。
  const w = Math.max(baseBox?.width ?? 0, katexBox?.width ?? 0, hostBox.width);
  const h = Math.max(baseBox?.height ?? 0, katexBox?.height ?? 0, hostBox.height);
  host.remove();
  // 保留亚像素精度；取整误差随放大会累积成尺寸漂移。余量由卡片 padding 提供。
  return w > 0 && h > 0 ? { w, h } : null;
}
