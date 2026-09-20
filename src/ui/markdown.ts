// Markdown + KaTeX 渲染（需求 §F06）：编辑时输入源码，失焦渲染；
// 公式渲染失败保留源码、不阻断编辑。
import MarkdownIt from "markdown-it";
import katex from "katex";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderMath(src: string, displayMode: boolean): string {
  try {
    return katex.renderToString(src, { displayMode, throwOnError: true, strict: false });
  } catch {
    // 公式错误不清空源码、不阻止继续编辑：以 code 展示源码并标错
    return `<code class="math-error" title="公式渲染失败，已保留源码">${escapeHtml(src)}</code>`;
  }
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

// 行内 $...$（不允许跨行、允许 \$ 转义）
md.inline.ruler.after("escape", "math_inline", (state, silent) => {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x24) return false; // $
  if (state.src.charCodeAt(start + 1) === 0x24) return false; // $$ 归块级
  let pos = start + 1;
  let close = -1;
  while (pos < state.src.length) {
    const idx = state.src.indexOf("$", pos);
    if (idx === -1) break;
    if (state.src.charCodeAt(idx - 1) === 0x5c) {
      pos = idx + 1; // 跳过 \$
      continue;
    }
    close = idx;
    break;
  }
  if (close === -1 || close === start + 1) return false;
  const content = state.src.slice(start + 1, close);
  if (content.includes("\n")) return false;
  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.content = content;
  }
  state.pos = close + 1;
  return true;
});
md.renderer.rules.math_inline = (tokens, idx) => renderMath(tokens[idx].content, false);

// 块级 $$...$$（单行或多行）
md.block.ruler.after("fence", "math_block", (state, startLine, endLine, silent) => {
  const pos = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (state.src.slice(pos, pos + 2) !== "$$") return false;
  const firstLine = state.src.slice(pos, max);
  let content: string;
  let nextLine: number;
  if (firstLine.length > 2 && firstLine.trimEnd().endsWith("$$")) {
    content = firstLine.trimEnd().slice(2, -2);
    nextLine = startLine + 1;
  } else {
    content = firstLine.slice(2);
    let found = false;
    nextLine = startLine + 1;
    for (let line = startLine + 1; line < endLine; line++) {
      const p = state.bMarks[line] + state.tShift[line];
      const m = state.eMarks[line];
      const text = state.src.slice(p, m);
      if (text.trimEnd().endsWith("$$")) {
        content += "\n" + text.trimEnd().slice(0, -2);
        nextLine = line + 1;
        found = true;
        break;
      }
      content += "\n" + text;
    }
    if (!found) return false;
  }
  if (silent) return true;
  state.line = nextLine;
  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content = content;
  return true;
});
md.renderer.rules.math_block = (tokens, idx) =>
  `<div class="math-block">${renderMath(tokens[idx].content, true)}</div>`;

// 链接新窗口打开，避免画布内跳转丢失状态
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(source: string): string {
  return md.render(source ?? "");
}

/**
 * 纯公式卡判定（公式缩放特性的开关）：markdown 去掉首尾空白后整体就是一个公式——
 * 整段 $$...$$ 块（内部不再含 $$），或单个行内 $...$（内部不含 $ 与换行）。
 * 混有文字/列表等其他内容的卡片返回 null（缩放只改框，字号不变）。
 */
export function pureFormulaKind(markdown: string): "block" | "inline" | null {
  const t = (markdown ?? "").trim();
  const block = /^\$\$([\s\S]+?)\$\$$/.exec(t);
  if (block && block[1].trim().length > 0 && !block[1].includes("$$")) return "block";
  const inline = /^\$([^$\n]+?)\$$/.exec(t);
  if (inline && inline[1].trim().length > 0) return "inline";
  return null;
}
