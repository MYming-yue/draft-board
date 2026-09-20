// 纯公式卡几何：卡片外框贴合公式，缩放时公式与外框同比例变化。
// 渲染层派生，不新增 op；落盘仍走现有 resizeNode。
import { pureFormulaKind, renderMarkdown } from "./markdown";

/** 与 .node-card padding/border 对齐（border-box） */
export const CARD_CHROME_X = 12 + 12 + 1.5 + 1.5; // 27
export const CARD_CHROME_Y = 10 + 10 + 1.5 + 1.5; // 23
export const FORMULA_FONT = 14;
export const FORMULA_SCALE_MIN = 0.5;
export const FORMULA_SCALE_MAX = 6;

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
