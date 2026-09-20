import { useEffect, useMemo, useRef, useState } from "react";
import type { BoardNode } from "../model";
import {
  CARD_CHROME_Y,
  FORMULA_FONT,
  clampFormulaScale,
  formulaBoxFromNatural,
  formulaScaleFromCardW,
  measureFormulaNatural,
} from "./formulaLayout";
import { pureFormulaKind, renderMarkdown } from "./markdown";

export const MIN_W = 160;
export const MAX_W = 800;
const MIN_H = 48; // 文本卡显式最小高度
const MAX_H = 1200;
const MIN_IMG_W = 90; // 图片卡最小外宽（含卡片 chrome），对应约 60px 图宽
const MAX_IMG_W = 1200;
const EDIT_MIN_W = 240; // 编辑态最小宽，避免贴合后的公式卡放不下插入条

interface NodeCardProps {
  node: BoardNode;
  selected: boolean;
  editing: boolean;
  blobUrl?: string;
  aspect?: number; // 图片原始宽高比（img naturalWidth/naturalHeight，由 onImageAspect 回报）
  dragDelta: { dx: number; dy: number } | null;
  connectSourceId: string | null;
  readOnly: boolean;
  onCardPointerDown: (e: React.PointerEvent, nodeId: string) => void;
  onCardPointerUp: (e: React.PointerEvent, nodeId: string) => void;
  onStartConnect: (e: React.PointerEvent, nodeId: string) => void;
  onCommitText: (nodeId: string, markdown: string, caption?: string) => void;
  onStartEdit: (nodeId: string) => void;
  onCancelEdit: () => void;
  onResizeTextEnd: (nodeId: string, w: number, h: number) => void;
  onImageAspect: (nodeId: string, aspect: number) => void;
  onResizeImageEnd: (nodeId: string, w: number, h: number) => void;
}

type Corner = "nw" | "ne" | "sw" | "se";
type TextDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const TEXT_DIRS: TextDir[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

// ---- 插入工具条定义（Issue 4）：有选中则包裹，无则插模板并把光标落到占位处 ----
interface Snip {
  text: string;
  cur: number; // 光标/选区起点（在 text 内的下标）
  curEnd?: number; // 有值则为选区终点（选中占位符，输入即替换）
}
const sel_ = (text: string, inner: string): Snip => {
  const i = text.indexOf(inner);
  return { text, cur: i, curEnd: i + inner.length };
};
const MD_BTN: { label: string; title: string; make: (sel: string, lineStart: boolean) => Snip }[] = [
  { label: "B", title: "粗体 **文字**", make: (s) => sel_(`**${s || "粗体文字"}**`, s || "粗体文字") },
  { label: "I", title: "斜体 *文字*", make: (s) => sel_(`*${s || "斜体文字"}*`, s || "斜体文字") },
  {
    label: "H2",
    title: "标题 ## 文字",
    make: (s, ls) => {
      const pre = ls ? "" : "\n";
      const t = `${pre}## ${s || "标题"}\n`;
      return { text: t, cur: pre.length + 3, curEnd: pre.length + 3 + (s || "标题").length };
    },
  },
  {
    label: "• 列表",
    title: "无序列表 - 项目",
    make: (s, ls) => {
      const pre = ls ? "" : "\n";
      const t = `${pre}- ${s || "列表项"}`;
      return { text: t, cur: pre.length + 2, curEnd: pre.length + 2 + (s || "列表项").length };
    },
  },
  {
    label: "1. 列表",
    title: "有序列表 1. 项目",
    make: (s, ls) => {
      const pre = ls ? "" : "\n";
      const t = `${pre}1. ${s || "列表项"}`;
      return { text: t, cur: pre.length + 3, curEnd: pre.length + 3 + (s || "列表项").length };
    },
  },
  {
    label: "🔗",
    title: "链接 [文字](https://)",
    make: (s) => {
      const t = `[${s || "链接文字"}](https://)`;
      const i = t.indexOf("https://");
      return { text: t, cur: i, curEnd: i + 8 };
    },
  },
  { label: "</>", title: "行内代码 `code`", make: (s) => sel_(`\`${s || "code"}\``, s || "code") },
  {
    label: "{ }",
    title: "代码块 ``` ```",
    make: (s, ls) => {
      const pre = ls ? "" : "\n";
      const t = `${pre}\`\`\`\n${s || "代码"}\n\`\`\`\n`;
      const i = pre.length + 4;
      return { text: t, cur: i, curEnd: i + (s || "代码").length };
    },
  },
  { label: "$x$", title: "行内公式 $...$", make: (s) => sel_(`$${s || "x"}$`, s || "x") },
  {
    label: "$$",
    title: "独立公式 $$...$$",
    make: (s, ls) => {
      const pre = ls ? "" : "\n";
      const t = `${pre}$$\n${s || "E=mc^2"}\n$$\n`;
      const i = pre.length + 3;
      return { text: t, cur: i, curEnd: i + (s || "E=mc^2").length };
    },
  },
];
const GREEK = "α β γ δ ε θ λ μ π σ φ ω Δ Σ Ω".split(" ");
const BLOCKS: { label: string; title: string; snip: Snip }[] = [
  { label: "a/b", title: "分式 \\frac{a}{b}", snip: { text: "\\frac{}{}", cur: 6 } },
  { label: "√x", title: "根式 \\sqrt{x}", snip: { text: "\\sqrt{}", cur: 6 } },
  { label: "√[n]", title: "n 次根式 \\sqrt[n]{x}", snip: { text: "\\sqrt[]{}", cur: 6 } },
  { label: "x^", title: "上标 x^{a}", snip: { text: "^{}", cur: 2 } },
  { label: "x_", title: "下标 x_{a}", snip: { text: "_{}", cur: 2 } },
  { label: "x_^", title: "上下标组合 x_{a}^{b}", snip: { text: "_{}^{}", cur: 2 } },
  { label: "∑", title: "求和 \\sum_{i=1}^{n}", snip: { text: "\\sum_{i=1}^{n}", cur: 6, curEnd: 9 } },
  { label: "∫", title: "积分 \\int_{a}^{b}", snip: { text: "\\int_{a}^{b}", cur: 6, curEnd: 7 } },
  { label: "∂", title: "偏导 \\frac{\\partial}{\\partial x}", snip: { text: "\\frac{\\partial}{\\partial x}", cur: 26, curEnd: 27 } },
  {
    label: "▦",
    title: "2×2 矩阵 \\begin{pmatrix}…\\end{pmatrix}",
    snip: { text: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", cur: 16, curEnd: 17 },
  },
  { label: "( )", title: "自适应括号 \\left( \\right)", snip: { text: "\\left(  \\right)", cur: 7 } },
];

export function NodeCard(p: NodeCardProps) {
  const { node } = p;
  const [draft, setDraft] = useState(node.markdown ?? "");
  const [captionDraft, setCaptionDraft] = useState(node.caption ?? "");
  const [textSize, setTextSize] = useState<{ w: number; h: number } | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [liveScale, setLiveScale] = useState<number | null>(null);
  const [showBlocks, setShowBlocks] = useState(false);
  const composing = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const activeField = useRef<"body" | "caption">("body");
  const focusCaption = useRef(false);
  const editFinished = useRef(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (p.editing) {
      setDraft(node.markdown ?? "");
      setCaptionDraft(node.caption ?? "");
      editFinished.current = false;
      // effect 运行时 textarea 已挂载，直接聚焦——不要用 rAF（headless/后台页会被节流）
      const t = focusCaption.current ? captionRef.current : taRef.current;
      focusCaption.current = false;
      if (t) {
        t.focus({ preventScroll: true });
        t.setSelectionRange(t.value.length, t.value.length);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.editing]);

  const x = node.x + (p.dragDelta?.dx ?? 0);
  const y = node.y + (p.dragDelta?.dy ?? 0);
  const live = textSize ?? imgSize;
  let w = live?.w ?? node.w;
  let h = live?.h ?? node.h ?? undefined;
  const accent = node.accent ?? "default";
  const isImage = node.type === "image";
  const hasFormulaCaption = !isImage && Boolean(node.caption?.trim());

  // ---- 纯公式卡：外框贴合公式；缩放改 scale，w/h = 字形×scale + chrome ----
  const formulaKind = isImage ? null : pureFormulaKind(node.markdown ?? "");
  const [fontRevision, setFontRevision] = useState(0);
  useEffect(() => {
    if (!formulaKind) return;
    let active = true;
    const refresh = () => { if (active) setFontRevision((v) => v + 1); };
    void document.fonts.ready.then(refresh);
    document.fonts.addEventListener("loadingdone", refresh);
    return () => {
      active = false;
      document.fonts.removeEventListener("loadingdone", refresh);
    };
  }, [formulaKind]);
  const natural = useMemo(
    () => (formulaKind ? measureFormulaNatural(node.markdown ?? "") : null),
    [formulaKind, node.markdown, fontRevision],
  );
  let formulaScale: number | null = null;
  const editingFormula = Boolean(p.editing && formulaKind);
  if (natural && !p.editing) {
    formulaScale =
      liveScale ?? (node.h == null ? 1 : formulaScaleFromCardW(natural.w, node.w));
  } else if (editingFormula) {
    w = Math.max(w, EDIT_MIN_W);
  }

  const commitEdit = () => {
    if (!p.editing || editFinished.current) return;
    editFinished.current = true;
    p.onCommitText(node.id, draft, isImage ? undefined : captionDraft);
  };
  const onTextKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter 是显式提交指令，即使在 IME composition 中也优先响应
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      commitEdit();
      return;
    }
    // 中文输入法 composition 期间 Enter/空格不触发画布/提交操作（需求 §4）
    if (composing.current || e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      editFinished.current = true;
      p.onCancelEdit();
    }
    e.stopPropagation();
  };

  // ---- 插入工具条：replace 当前选区并落光标（按钮 onPointerDown preventDefault 保住焦点与选区） ----
  const applySnippet = (snip: Snip) => {
    const inCaption = activeField.current === "caption";
    const ta = inCaption ? captionRef.current : taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e2 = ta.selectionEnd;
    const value = inCaption ? captionDraft : draft;
    const next = value.slice(0, s) + snip.text + value.slice(e2);
    (inCaption ? setCaptionDraft : setDraft)(next);
    // 等 React 提交新值后落光标；用 setTimeout(0)，rAF 在 headless/后台页会被节流
    setTimeout(() => {
      const t = inCaption ? captionRef.current : taRef.current;
      if (!t) return;
      t.focus({ preventScroll: true });
      t.setSelectionRange(s + snip.cur, s + (snip.curEnd ?? snip.cur));
    }, 0);
  };
  const runMd = (make: (sel: string, lineStart: boolean) => Snip) => {
    const inCaption = activeField.current === "caption";
    const ta = inCaption ? captionRef.current : taRef.current;
    if (!ta) return;
    const value = inCaption ? captionDraft : draft;
    const sel = value.slice(ta.selectionStart, ta.selectionEnd);
    const lineStart = ta.selectionStart === 0 || value[ta.selectionStart - 1] === "\n";
    applySnippet(make(sel, lineStart));
  };

  // ---- 文本卡：四角+四边自由比例拖拽（Issue 2；显式 h 是最小高度，不裁切） ----
  const onTextResizeDown = (e: React.PointerEvent, dir: TextDir) => {
    e.stopPropagation();
    e.preventDefault();
    const cardEl = (e.currentTarget as HTMLElement).closest(".node-card") as HTMLElement;
    const start = { x: e.clientX, y: e.clientY };
    const startW = node.w;
    const startH = node.h ?? cardEl.offsetHeight;
    const zoom = getZoom(e.currentTarget);
    const sx = dir.includes("e") ? 1 : dir.includes("w") ? -1 : 0;
    const sy = dir.includes("s") ? 1 : dir.includes("n") ? -1 : 0;
    const sizeFor = (cx: number, cy: number) => ({
      w: Math.min(MAX_W, Math.max(MIN_W, startW + (sx * (cx - start.x)) / zoom)),
      h: Math.min(MAX_H, Math.max(MIN_H, startH + (sy * (cy - start.y)) / zoom)),
    });
    const move = (ev: PointerEvent) => setTextSize(sizeFor(ev.clientX, ev.clientY));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const next = sizeFor(ev.clientX, ev.clientY);
      setTextSize(null);
      if (Math.abs(next.w - node.w) > 0.5 || Math.abs(next.h - startH) > 0.5)
        p.onResizeTextEnd(node.id, Math.round(next.w), Math.round(next.h));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ---- 图片卡：四角手柄严格等比缩放（按原图宽高比，§F05），实时预览，松手提交一次 ----
  const onCornerPointerDown = (e: React.PointerEvent, corner: Corner) => {
    e.stopPropagation();
    e.preventDefault();
    const cardEl = (e.currentTarget as HTMLElement).closest(".node-card") as HTMLElement;
    const imgEl = imgRef.current;
    if (!cardEl || !imgEl) return;
    const chromeX = cardEl.offsetWidth - imgEl.clientWidth;
    const chromeY = cardEl.offsetHeight - imgEl.clientHeight;
    const aspect =
      p.aspect ?? (imgEl.clientWidth > 0 && imgEl.clientHeight > 0 ? imgEl.clientWidth / imgEl.clientHeight : 4 / 3);
    const zoom = getZoom(e.currentTarget);
    const start = { x: e.clientX, y: e.clientY };
    const startW = node.w;
    const startH = node.h ?? cardEl.offsetHeight;
    const sizeFor = (clientX: number, clientY: number) => {
      const dw = ((corner === "ne" || corner === "se" ? 1 : -1) * (clientX - start.x)) / zoom;
      const dh = ((corner === "sw" || corner === "se" ? 1 : -1) * (clientY - start.y)) / zoom;
      const wA = startW + dw;
      const wB = (startH - chromeY + dh) * aspect + chromeX;
      const nextW = Math.min(MAX_IMG_W, Math.max(MIN_IMG_W, Math.abs(wA - startW) >= Math.abs(wB - startW) ? wA : wB));
      const nextH = (nextW - chromeX) / aspect + chromeY;
      return { w: nextW, h: nextH };
    };
    const move = (ev: PointerEvent) => setImgSize(sizeFor(ev.clientX, ev.clientY));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const next = sizeFor(ev.clientX, ev.clientY);
      setImgSize(null);
      if (Math.abs(next.w - node.w) > 0.5 || Math.abs(next.h - (node.h ?? 0)) > 0.5)
        p.onResizeImageEnd(node.id, Math.round(next.w), Math.round(next.h));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ---- 纯公式卡：四角手柄等比缩放（公式与外框同比例；chrome 固定不参与比例） ----
  const onFormulaResizeDown = (e: React.PointerEvent, corner: Corner) => {
    e.stopPropagation();
    e.preventDefault();
    if (!natural) return;
    const zoom = getZoom(e.currentTarget);
    const start = { x: e.clientX, y: e.clientY };
    const startBox = formulaBoxFromNatural(
      natural,
      node.h == null ? 1 : formulaScaleFromCardW(natural.w, node.w),
    );
    const scaleFor = (clientX: number, clientY: number) => {
      const dw = ((corner === "ne" || corner === "se" ? 1 : -1) * (clientX - start.x)) / zoom;
      const dh = ((corner === "sw" || corner === "se" ? 1 : -1) * (clientY - start.y)) / zoom;
      const sW = formulaScaleFromCardW(natural.w, startBox.w + dw);
      const sH = clampFormulaScale((startBox.h + dh - CARD_CHROME_Y) / natural.h);
      return Math.abs(sW - startBox.scale) >= Math.abs(sH - startBox.scale) ? sW : sH;
    };
    const move = (ev: PointerEvent) => setLiveScale(scaleFor(ev.clientX, ev.clientY));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const nextS = scaleFor(ev.clientX, ev.clientY);
      setLiveScale(null);
      const next = formulaBoxFromNatural(natural, nextS);
      if (Math.abs(next.w - startBox.w) > 0.5 || Math.abs(next.h - startBox.h) > 0.5)
        p.onResizeTextEnd(node.id, Math.round(next.w), Math.round(next.h));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const showImgHandles = isImage && p.selected && !p.readOnly && !p.editing;
  const showFormulaHandles = Boolean(formulaKind && natural && p.selected && !p.readOnly && !p.editing);
  const showTextHandles = !isImage && !showFormulaHandles && p.selected && !p.readOnly && !p.editing;
  const hasCaption = isImage && (node.markdown ?? "").trim().length > 0;
  const formulaBox = formulaScale !== null && natural ? formulaBoxFromNatural(natural, formulaScale) : null;
  const showCaptionEditor = !isImage && (formulaKind || pureFormulaKind(draft) || node.caption !== undefined);

  return (
    <div
      className={[
        "node-card",
        `accent-${accent}`,
        formulaScale !== null ? "formula-fit" : "",
        p.selected ? "selected" : "",
        p.connectSourceId && p.connectSourceId !== node.id ? "connect-target" : "",
        p.readOnly ? "readonly" : "",
      ].join(" ")}
      style={{
        left: x,
        top: y,
        // 外框与缩放保存共用几何；flex 将公式放在外框中心。
        ...(formulaBox
          ? { width: Math.max(formulaBox.w, hasFormulaCaption ? 220 : 0), ...(hasFormulaCaption ? {} : { height: formulaBox.h }) }
          : {
              width: w,
              ...(h !== undefined ? (isImage ? { height: h } : { minHeight: h }) : {}),
            }),
      }}
      data-node-id={node.id}
      onPointerDown={(e) => p.onCardPointerDown(e, node.id)}
      onPointerUp={(e) => p.onCardPointerUp(e, node.id)}
      onBlur={(e) => {
        // 公式和备注在同一次编辑里；在两个输入框之间切换不提交。
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commitEdit();
      }}
    >
      {p.editing && !isImage && (
        <div className="insert-bar" onPointerDown={(e) => e.preventDefault()}>
          {MD_BTN.map((b) => (
            <button key={b.label} type="button" title={b.title} onClick={() => runMd(b.make)}>
              {b.label}
            </button>
          ))}
          <button
            type="button"
            className={showBlocks ? "active" : ""}
            title="公式积木面板（分式/根式/上下标/希腊字母/求和/积分/矩阵…）"
            onClick={() => setShowBlocks((v) => !v)}
          >
            ∑▾
          </button>
        </div>
      )}
      {p.editing && !isImage && showBlocks && (
        <div className="insert-panel" onPointerDown={(e) => e.preventDefault()}>
          {BLOCKS.map((b) => (
            <button key={b.label} type="button" title={b.title} onClick={() => applySnippet(b.snip)}>
              {b.label}
            </button>
          ))}
          {GREEK.map((g) => (
            <button key={g} type="button" title={`希腊字母 ${g}`} onClick={() => applySnippet({ text: g, cur: 1 })}>
              {g}
            </button>
          ))}
        </div>
      )}
      {isImage ? (
        <>
          {p.blobUrl ? (
            <img
              ref={imgRef}
              className="node-image"
              src={p.blobUrl}
              draggable={false}
              alt="图片卡片"
              style={h !== undefined ? { width: "100%", height: "100%", objectFit: "fill" } : undefined}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth > 0 && img.naturalHeight > 0)
                  p.onImageAspect(node.id, img.naturalWidth / img.naturalHeight);
              }}
            />
          ) : (
            <div className="node-image-missing">图片缺失</div>
          )}
          {p.editing ? (
            <textarea
              ref={taRef}
              className="node-editor caption-editor"
              value={draft}
              rows={Math.min(8, Math.max(1, draft.split("\n").length))}
              placeholder="图片说明（支持 Markdown，留空则不显示）"
              onFocus={() => { activeField.current = "body"; }}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onTextKeyDown}
              onCompositionStart={() => (composing.current = true)}
              onCompositionEnd={() => (composing.current = false)}
              onPointerDown={(e) => e.stopPropagation()}
            />
          ) : (
            hasCaption && (
              <div
                className="node-rendered node-caption"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(node.markdown ?? "") }}
              />
            )
          )}
        </>
      ) : p.editing ? (
        <>
        <textarea
          ref={taRef}
          className="node-editor"
          value={draft}
          rows={Math.min(20, Math.max(3, draft.split("\n").length + 1))}
          placeholder="输入 Markdown，公式用 $...$ / $$...$$"
          aria-label="卡片正文"
          onFocus={() => { activeField.current = "body"; }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onTextKeyDown}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onPointerDown={(e) => e.stopPropagation()}
        />
        {showCaptionEditor && (
          <label className="formula-caption-field">
            <span>备注（可选）</span>
            <textarea
              ref={captionRef}
              className="node-editor caption-editor formula-caption-editor"
              value={captionDraft}
              rows={Math.min(12, Math.max(3, captionDraft.split("\n").length))}
              placeholder="解释变量、单位或适用条件；支持 Markdown 和公式"
              onFocus={() => { activeField.current = "caption"; }}
              onChange={(e) => setCaptionDraft(e.target.value)}
              onKeyDown={onTextKeyDown}
              onCompositionStart={() => (composing.current = true)}
              onCompositionEnd={() => (composing.current = false)}
              onPointerDown={(e) => e.stopPropagation()}
            />
          </label>
        )}
        </>
      ) : formulaScale !== null ? (
        <div className="formula-stage" style={{ height: formulaBox!.h - CARD_CHROME_Y }}>
        <div
          className="node-rendered formula-scaled"
          // 纯公式卡：KaTeX 全 em 相对单位，跟随容器 font-size 整体缩放
          style={{ fontSize: FORMULA_FONT * formulaScale }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(node.markdown ?? "") }}
        />
        </div>
      ) : (
        <div
          className="node-rendered"
          // markdown-it html:false，源码中的 HTML 已转义
          dangerouslySetInnerHTML={{ __html: renderMarkdown(node.markdown ?? "") }}
        />
      )}
      {!p.editing && hasFormulaCaption && (
        <div className="node-rendered node-caption formula-caption" dangerouslySetInnerHTML={{ __html: renderMarkdown(node.caption!) }} />
      )}
      {formulaKind && p.selected && !p.editing && !p.readOnly && (
        <button
          type="button"
          className="formula-caption-button"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            focusCaption.current = true;
            p.onStartEdit(node.id);
          }}
        >{hasFormulaCaption ? "编辑备注" : "+ 添加备注"}</button>
      )}
      {!p.readOnly && !p.editing && (
        <>
          <div
            className="connect-handle"
            title="拖到另一张卡片建立关联"
            onPointerDown={(e) => p.onStartConnect(e, node.id)}
          />
          {showImgHandles &&
            (["nw", "ne", "sw", "se"] as Corner[]).map((c) => (
              <div
                key={c}
                className={`img-resize-handle corner-${c}`}
                title="拖拽等比缩放"
                onPointerDown={(e) => onCornerPointerDown(e, c)}
              />
            ))}
          {showFormulaHandles &&
            (["nw", "ne", "sw", "se"] as Corner[]).map((c) => (
              <div
                key={c}
                className={`formula-resize-handle corner-${c}`}
                title="拖拽等比缩放公式"
                onPointerDown={(e) => onFormulaResizeDown(e, c)}
              />
            ))}
          {showTextHandles &&
            TEXT_DIRS.map((d) => (
              <div
                key={d}
                className={`text-resize-handle dir-${d}`}
                title="拖拽调整宽高（自由比例，文字不裁切）"
                onPointerDown={(e) => onTextResizeDown(e, d)}
              />
            ))}
        </>
      )}
    </div>
  );
}

function getZoom(el: EventTarget | null): number {
  // 世界容器上挂了 data-zoom
  const world = (el as HTMLElement).closest("[data-zoom]");
  return world ? Number(world.getAttribute("data-zoom")) : 1;
}
