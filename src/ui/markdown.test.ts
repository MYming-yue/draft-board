// markdown 渲染与纯公式卡判定的单测（含 KaTeX 真实渲染）。
import { describe, expect, it } from "vitest";
import { pureFormulaKind, renderMarkdown } from "./markdown";

describe("renderMarkdown 数学渲染", () => {
  it("整段 $$...$$ 渲染为 math-block 且含 .katex", () => {
    const html = renderMarkdown("$$\\frac{a}{b}$$");
    expect(html).toContain('class="math-block"');
    expect(html).toContain("katex");
    expect(html).not.toContain("math-error");
  });
  it("行内 $...$ 渲染", () => {
    const html = renderMarkdown("这是 $E=mc^2$ 行内");
    expect(html).toContain("katex");
  });
  it("公式错误保留源码不阻断（math-error）", () => {
    const html = renderMarkdown("$$\\frac{a}{$$");
    expect(html).toContain("math-error");
  });
});

describe("pureFormulaKind 纯公式卡判定", () => {
  it("$$ 整段 → block", () => {
    expect(pureFormulaKind("$$\\frac{a}{b}$$")).toBe("block");
    expect(pureFormulaKind("  \n$$x^2$$\n  ")).toBe("block");
    expect(pureFormulaKind("$$\n\\int_a^b f\n$$")).toBe("block");
  });
  it("单个行内 $...$ → inline", () => {
    expect(pureFormulaKind("$E=mc^2$")).toBe("inline");
  });
  it("混合内容 → null", () => {
    expect(pureFormulaKind("说明 $x^2$ 结尾")).toBeNull();
    expect(pureFormulaKind("$$x$$ 文字")).toBeNull();
    expect(pureFormulaKind("$$x$$\n$$y$$")).toBeNull(); // 两个块不算纯单一公式
    expect(pureFormulaKind("")).toBeNull();
    expect(pureFormulaKind("普通文字")).toBeNull();
  });
});
