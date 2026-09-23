import { afterEach, expect, it, vi } from "vitest";
import { GREEK, readGreekHistory, rememberGreek, sortedGreek } from "./greekPalette";
import { renderMarkdown } from "./markdown";

afterEach(() => vi.unstubAllGlobals());
it("恢复记录、去重过滤，并按最近使用排序", () => {
  let saved = '["τ","α","τ","unknown"]';
  vi.stubGlobal("localStorage", { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } });
  expect(readGreekHistory()).toEqual(["τ", "α"]);
  rememberGreek("α");
  expect(readGreekHistory()).toEqual(["α", "τ"]);
  expect(sortedGreek(readGreekHistory()).slice(0, 3).map(g => g.symbol)).toEqual(["α", "τ", "β"]);
  expect(new Set(GREEK.map(g => g.symbol)).size).toBe(54);
});
it("存储不可用时仍可记住会话使用顺序", () => {
  vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
  rememberGreek("ψ");
  expect(readGreekHistory()[0]).toBe("ψ");
});
it.each([
  String.raw`\left|x\right|`, String.raw`\overline{x}`, String.raw`\left\lVert x\right\rVert`,
  String.raw`\vec{x}`, String.raw`\hat{x}`, String.raw`\dot{x}`, String.raw`\frac{d x}{d t}`,
  String.raw`\lim_{x\to 0}`, String.raw`\prod_{x=1}^{n}`, String.raw`\log_{a}{x}`,
  String.raw`\begin{cases} x & t>0 \\ 0 & t\le 0 \end{cases}`,
  String.raw`\mathrm{H_2O}`, String.raw`\xrightarrow{t}`, String.raw`\rightleftharpoons`,
])("新增公式可由当前 KaTeX 渲染：%s", latex => {
  const html = renderMarkdown(`$$${latex}$$`);
  expect(html).toContain("katex");
  expect(html).not.toContain("math-error");
});
