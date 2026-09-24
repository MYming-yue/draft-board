import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BoardNode } from "../model";
import {
  CARD_CHROME_X,
  CARD_CHROME_Y,
  CONCEPT_FONT,
  DEFAULT_CAPTION_W,
  FORMULA_FONT,
  MIN_CAPTION_W,
  conceptBoxFromNatural,
  formulaBoxFromNatural,
  formulaScaleFromCardW,
  measureConceptNatural,
  measureFormulaNatural,
  scaleFromCornerDistance,
} from "./formulaLayout";
import { pureFormulaKind, renderMarkdown } from "./markdown";
import { orderedListSnippet } from "./orderedList";
import { readGreekHistory, rememberGreek, sortedGreek } from "./greekPalette";

export const MAX_W = 800;
/** 阅读态默认最多显示的备注行数；编辑区同样为该行数。 */
export const CAPTION_MAX_LINES = 15;
const MIN_IMG_W = 90; // 图片卡最小外宽（含卡片 chrome），对应约 60px 图宽
const MAX_IMG_W = 1200;
const EDIT_MIN_W = 240; // 编辑态最小宽，避免贴合后的公式卡放不下插入条

interface NodeCardProps {
  hideCaptions: boolean;
  node: BoardNode;
  selected: boolean;
  front: boolean;
  editing: boolean;
  blobUrl?: string;
  aspect?: number; // 图片原始宽高比（img naturalWidth/naturalHeight，由 onImageAspect 回报）
  dragDelta: { dx: number; dy: number } | null;
  connectSourceId: string | null;
  readOnly: boolean;
  onCardPointerDown: (e: React.PointerEvent, nodeId: string) => void;
  onCardPointerUp: (e: React.PointerEvent, nodeId: string) => void;
  onStartConnect: (e: React.PointerEvent, nodeId: string) => void;
  onCommitText: (nodeId: string, markdown: string, caption?: string, captionExpanded?: boolean) => void;
  onStartEdit: (nodeId: string) => void;
  onCancelEdit: () => void;
  onResizeTextEnd: (nodeId: string, w: number, h: number | null, coreScale?: number | null) => void;
  onResizeCaptionWidth: (nodeId: string, captionW: number) => void;
  onImageAspect: (nodeId: string, aspect: number) => void;
  onResizeImageEnd: (nodeId: string, w: number, h: number) => void;
}

type Corner = "nw" | "ne" | "sw" | "se";
type TextDir = "e" | "w";
const TEXT_DIRS: TextDir[] = ["e", "w"];

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
type MakeSnippet = (sel: string, lineStart: boolean, context: { value: string; start: number; end: number }) => Snip;
const MD_BTN: { label: string; title: string; make: MakeSnippet }[] = [
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
    title: "有序列表：延续当前列表编号",
    make: (_s, _ls, { value, start, end }) => orderedListSnippet(value, start, end),
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
const BLOCKS: { label: string; title: string; snip: Snip }[] = [
  ...[
    ["|x|", "绝对值", "\\left|x\\right|"],
    ["x̄", "平均值横线", "\\overline{x}"],
    ["‖x‖", "范数", "\\left\\lVert x\\right\\rVert"],
    ["向量", "向量", "\\vec{x}"],
    ["x̂", "帽子符号", "\\hat{x}"],
    ["ẋ", "时间导数", "\\dot{x}"],
    ["d/dx", "导数", "\\frac{d x}{d t}"],
    ["lim", "极限", "\\lim_{x\\to 0}"],
    ["∏", "连乘", "\\prod_{x=1}^{n}"],
    ["log", "对数", "\\log_{a}{x}"],
    ["cases", "分段函数", "\\begin{cases} x & t>0 \\\\ 0 & t\\le 0 \\end{cases}"],
    ["单位", "正体单位或化学式", "\\mathrm{x}"],
    ["→", "反应箭头与条件", "\\xrightarrow{x}"],
    ["⇌", "可逆反应", "\\rightleftharpoons"],
    ["±", "正负号", "\\pm "],
    ["×", "乘号", "\\times "],
    ["·", "点乘", "\\cdot "],
    ["∼", "相似符号", "\\sim "],
    ["≈", "约等于", "\\approx "],
    ["≠", "不等于", "\\ne "],
    ["≤", "小于等于", "\\le "],
    ["≥", "大于等于", "\\ge "],
    ["∞", "无穷大", "\\infty "],
    ["°", "角度", "^{\\circ}"],
  ].map(([label, title, text]) => {
    const placeholder = text.indexOf("{x}") >= 0 ? text.indexOf("{x}") + 1 : text.indexOf("x");
    return { label, title: `${title} ${text}`, snip: placeholder >= 0
      ? { text, cur: placeholder, curEnd: placeholder + 1 } : { text, cur: text.length } };
  }),
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
  const [expandedDraft, setExpandedDraft] = useState(Boolean(node.captionExpanded));
  const [liveCaptionW, setLiveCaptionW] = useState<number | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [liveScale, setLiveScale] = useState<number | null>(null);
  const [showBlocks, setShowBlocks] = useState(false);
  const [showGreek, setShowGreek] = useState(false);
  const [greekHistory, setGreekHistory] = useState<string[]>(readGreekHistory);
  const composing = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const activeField = useRef<"body" | "caption">("body");
  const focusCaption = useRef(false);
  const editFinished = useRef(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const [insertSelection, setInsertSelection] = useState<{ caption: boolean; start: number; end: number } | null>(null);
  useLayoutEffect(() => {
    if (!insertSelection) return;
    const ta = insertSelection.caption ? captionRef.current : taRef.current;
    ta?.focus({ preventScroll: true });
    ta?.setSelectionRange(insertSelection.start, insertSelection.end);
  }, [insertSelection]);

  useEffect(() => {
    if (p.editing) {
      setDraft(node.markdown ?? "");
      setCaptionDraft(node.caption ?? "");
      setExpandedDraft(Boolean(node.captionExpanded));
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
  const live = imgSize;
  let w = live?.w ?? node.w;
  const accent = node.accent ?? "default";
  const isImage = node.type === "image";
  const hasFormulaCaption = !isImage && !p.hideCaptions && Boolean(node.caption?.trim());

  // ---- 纯公式卡：外框贴合公式；缩放改 scale，w/h = 字形×scale + chrome ----
  const formulaKind = isImage ? null : pureFormulaKind(node.markdown ?? "");
  const [fontRevision, setFontRevision] = useState(0);
  useEffect(() => {
    if (isImage) return;
    let active = true;
    const refresh = () => { if (active) setFontRevision((v) => v + 1); };
    void document.fonts.ready.then(refresh);
    document.fonts.addEventListener("loadingdone", refresh);
    return () => {
      active = false;
      document.fonts.removeEventListener("loadingdone", refresh);
    };
  }, [isImage]);
  const formulaNatural = useMemo(
    () => (formulaKind ? measureFormulaNatural(node.markdown ?? "") : null),
    [formulaKind, node.markdown, fontRevision],
  );
  const conceptScale0 = node.coreScale ?? 1;
  const conceptNatural = useMemo(
    () => (!isImage && !formulaKind ? measureConceptNatural(node.markdown ?? "") : null),
    [isImage, formulaKind, node.markdown, fontRevision],
  );
  let formulaScale: number | null = null;
  if (formulaNatural && !p.editing) {
    formulaScale =
      liveScale ?? (node.h == null ? 1 : formulaScaleFromCardW(formulaNatural.w, node.w));
  } else if (p.editing) {
    w = Math.max(w, EDIT_MIN_W);
  }
  const conceptScale = !formulaKind && !isImage && !p.editing ? (liveScale ?? conceptScale0) : null;
  const formulaBox = formulaScale !== null && formulaNatural ? formulaBoxFromNatural(formulaNatural, formulaScale) : null;
  const conceptBox = conceptNatural && conceptScale !== null ? conceptBoxFromNatural(conceptNatural, conceptScale) : null;
  const coreBox = formulaBox ?? conceptBox;

  const commitEdit = () => {
    if (!p.editing || editFinished.current) return;
    editFinished.current = true;
    p.onCommitText(node.id, draft, isImage ? undefined : captionDraft, expandedDraft);
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
    // DOM 新值提交后、下一次输入之前恢复选区，避免定时器与快速输入竞争。
    setInsertSelection({ caption: inCaption, start: s + snip.cur, end: s + (snip.curEnd ?? snip.cur) });
  };
  const runMd = (make: MakeSnippet) => {
    const inCaption = activeField.current === "caption";
    const ta = inCaption ? captionRef.current : taRef.current;
    if (!ta) return;
    const value = inCaption ? captionDraft : draft;
    const sel = value.slice(ta.selectionStart, ta.selectionEnd);
    const lineStart = ta.selectionStart === 0 || value[ta.selectionStart - 1] === "\n";
    applySnippet(make(sel, lineStart, { value, start: ta.selectionStart, end: ta.selectionEnd }));
  };

  // ---- 左右手柄：只改备注阅读宽度，不能压扁核心区 ----
  const onCaptionResizeDown = (e: React.PointerEvent, dir: TextDir) => {
    e.stopPropagation();
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    const coreW = formulaBox?.w ?? conceptBox?.w ?? node.w;
    const startW = Math.max(coreW, node.captionW ?? DEFAULT_CAPTION_W);
    const zoom = getZoom(e.currentTarget);
    const sx = dir.includes("e") ? 1 : dir.includes("w") ? -1 : 0;
    const minW = Math.max(MIN_CAPTION_W, coreW);
    const sizeFor = (cx: number) => Math.min(MAX_W, Math.max(minW, startW + (sx * (cx - start.x)) / zoom));
    const move = (ev: PointerEvent) => setLiveCaptionW(sizeFor(ev.clientX));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const next = sizeFor(ev.clientX);
      setLiveCaptionW(null);
      if (Math.abs(next - startW) > 0.5) p.onResizeCaptionWidth(node.id, Math.round(next));
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
    const startH = cardEl.offsetHeight;
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

  // ---- 四角：核心区等比缩放（公式或文字）；chrome / 备注不参与比例 ----
  const onCoreResizeDown = (e: React.PointerEvent, corner: Corner) => {
    e.stopPropagation();
    e.preventDefault();
    const nat = formulaKind ? formulaNatural : conceptNatural;
    if (!nat) return;
    const zoom = getZoom(e.currentTarget);
    const start = { x: e.clientX, y: e.clientY };
    const startScale = formulaKind
      ? (node.h == null ? 1 : formulaScaleFromCardW(nat.w, node.w))
      : conceptScale0;
    const startBox = formulaKind ? formulaBoxFromNatural(nat, startScale) : conceptBoxFromNatural(nat, startScale);
    const scaleFor = (clientX: number, clientY: number) => {
      const dw = ((corner === "ne" || corner === "se" ? 1 : -1) * (clientX - start.x)) / zoom;
      const dh = ((corner === "sw" || corner === "se" ? 1 : -1) * (clientY - start.y)) / zoom;
      return scaleFromCornerDistance(startScale, nat, dw, dh);
    };
    const move = (ev: PointerEvent) => setLiveScale(scaleFor(ev.clientX, ev.clientY));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const nextS = scaleFor(ev.clientX, ev.clientY);
      setLiveScale(null);
      const next = formulaKind ? formulaBoxFromNatural(nat, nextS) : conceptBoxFromNatural(nat, nextS);
      if (Math.abs(next.w - startBox.w) > 0.5 || Math.abs(next.h - startBox.h) > 0.5) {
        p.onResizeTextEnd(
          node.id,
          Math.round(next.w),
          formulaKind ? Math.round(next.h) : null,
          formulaKind ? null : next.scale,
        );
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const showImgHandles = isImage && p.selected && !p.readOnly && !p.editing;
  const showCoreHandles = Boolean(coreBox && p.selected && !p.readOnly && !p.editing);
  const showCaptionHandles = showCoreHandles && hasFormulaCaption;
  const hasCaption = isImage && !p.hideCaptions && (node.markdown ?? "").trim().length > 0;
  const captionOpen = p.selected || Boolean(node.captionExpanded);
  const captionClass = ["node-rendered", "node-caption", captionOpen ? "" : "caption-clamped"].filter(Boolean).join(" ");
  const showCaptionEditor = !isImage;
  const captionReadingW = hasFormulaCaption ? (liveCaptionW ?? node.captionW ?? DEFAULT_CAPTION_W) : 0;
  const outerW = coreBox ? Math.max(coreBox.w, captionReadingW) : w;

  return (
    <div
      className={[
        "node-card",
        p.editing ? "editing" : "",
        p.front ? "front" : "",
        !isImage && !p.editing && !formulaKind ? "concept-card" : "",
        `accent-${accent}`,
        !isImage && !p.editing ? "has-core" : "",
        formulaScale !== null ? "formula-fit" : "",
        p.selected ? "selected" : "",
        p.connectSourceId && p.connectSourceId !== node.id ? "connect-target" : "",
        p.readOnly ? "readonly" : "",
      ].join(" ")}
      style={{
        left: x,
        top: y,
        ...(p.editing && !isImage
          ? { width: "max-content", minWidth: EDIT_MIN_W }
          : coreBox
            ? {
                width: outerW,
                ...(formulaBox && !hasFormulaCaption ? { height: formulaBox.h } : {}),
              }
            : { width: w }),
      }}
      data-node-id={node.id}
      onClick={(e) => {
        if (e.ctrlKey && (e.target as HTMLElement).closest("a")) e.preventDefault();
      }}
      onPointerDown={(e) => p.onCardPointerDown(e, node.id)}
      onPointerUp={(e) => p.onCardPointerUp(e, node.id)}
      onBlur={(e) => {
        // 公式和备注在同一次编辑里；在两个输入框之间切换不提交。
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commitEdit();
      }}
    >
      {p.editing && (
        <div className="insert-bar" onPointerDown={(e) => e.preventDefault()}>
          {MD_BTN.map((b) => (
            <button key={b.label} type="button" title={b.title} onClick={() => runMd(b.make)}>
              {b.label}
            </button>
          ))}
          <button
            type="button"
            className={showBlocks ? "active" : ""}
            title="公式积木面板（分式/绝对值/平均值/求和/积分/矩阵…）"
            aria-label="公式积木面板"
            aria-expanded={showBlocks}
            onClick={() => { setShowBlocks((v) => !v); setShowGreek(false); }}
          >
            ∑▾
          </button>
          <button type="button" title="希腊字母（最近使用优先）" aria-label="希腊字母积木面板" aria-expanded={showGreek}
            className={showGreek ? "active" : ""}
            onClick={() => { setGreekHistory(readGreekHistory()); setShowGreek(v => !v); setShowBlocks(false); }}>
            αβ▾
          </button>
        </div>
      )}
      {p.editing && showBlocks && (
        <div className="insert-panel" onPointerDown={(e) => e.preventDefault()}>
          {BLOCKS.map((b) => (
            <button key={b.label} type="button" title={b.title} onClick={() => applySnippet(b.snip)}>
              {b.label}
            </button>
          ))}
        </div>
      )}
      {p.editing && showGreek && (
        <div className="insert-panel" aria-label="希腊字母" onPointerDown={e => e.preventDefault()}>
          {sortedGreek(greekHistory).map(({ symbol, name }) => (
            <button key={symbol} type="button" title={`${symbol} ${name}`} onClick={() => {
              applySnippet({ text: symbol, cur: symbol.length });
              setGreekHistory(rememberGreek(symbol));
            }}>
              {symbol}
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
            <div className="formula-caption-field">
              <div className="caption-field-head">
                <span>图片说明（可选）</span>
                <CaptionExpandToggle checked={expandedDraft} onChange={setExpandedDraft} />
              </div>
              <textarea
                ref={taRef}
                className="node-editor caption-editor"
                value={draft}
                rows={CAPTION_MAX_LINES}
                placeholder="图片说明（支持 Markdown，留空则不显示）"
                onFocus={() => { activeField.current = "body"; }}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onTextKeyDown}
                onCompositionStart={() => (composing.current = true)}
                onCompositionEnd={() => (composing.current = false)}
                onPointerDown={(e) => e.stopPropagation()}
              />
            </div>
          ) : (
            hasCaption && (
              <div
                className={captionClass}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(node.markdown ?? "") }}
              />
            )
          )}
        </>
      ) : p.editing ? (
        <>
        <div className="core-field-label">核心表达</div>
        <textarea
          ref={taRef}
          className="node-editor core-editor"
          value={draft}
          rows={Math.min(20, Math.max(3, draft.split("\n").length + 1))}
          wrap="off"
          placeholder="核心表达：概念、问题或主张；详细解释请写在备注中"
          aria-label="卡片正文"
          onFocus={() => { activeField.current = "body"; }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onTextKeyDown}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onPointerDown={(e) => e.stopPropagation()}
        />
        {showCaptionEditor && (
          <div className="formula-caption-field">
            <div className="caption-field-head">
              <span>备注（可选）</span>
              <CaptionExpandToggle checked={expandedDraft} onChange={setExpandedDraft} />
            </div>
            <textarea
              ref={captionRef}
              className="node-editor caption-editor formula-caption-editor"
              value={captionDraft}
              rows={CAPTION_MAX_LINES}
              placeholder="对象描述、解释或证据；支持 Markdown 和公式"
              aria-label="卡片备注"
              onFocus={() => { activeField.current = "caption"; }}
              onChange={(e) => setCaptionDraft(e.target.value)}
              onKeyDown={onTextKeyDown}
              onCompositionStart={() => (composing.current = true)}
              onCompositionEnd={() => (composing.current = false)}
              onPointerDown={(e) => e.stopPropagation()}
            />
          </div>
        )}
        </>
      ) : formulaScale !== null ? (
        <div
          className="core-stage formula-stage"
          style={{ width: formulaBox!.w - CARD_CHROME_X, height: formulaBox!.h - CARD_CHROME_Y }}
        >
        <div
          className="node-rendered formula-scaled"
          style={{ fontSize: FORMULA_FONT * formulaScale }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(node.markdown ?? "") }}
        />
        </div>
      ) : (
        <div
          className="core-stage"
          style={conceptBox ? { width: conceptBox.w - CARD_CHROME_X } : undefined}
        >
        <div
          className="node-rendered concept-core"
          style={conceptScale ? { fontSize: CONCEPT_FONT * conceptScale } : undefined}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(node.markdown ?? "") }}
        />
        </div>
      )}
      {!p.editing && hasFormulaCaption && (
        <div className={`${captionClass} formula-caption`} dangerouslySetInnerHTML={{ __html: renderMarkdown(node.caption!) }} />
      )}
      {p.selected && !p.editing && !p.readOnly && (
        <button
          type="button"
          className="formula-caption-button"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            focusCaption.current = !isImage;
            p.onStartEdit(node.id);
          }}
        >{(isImage ? node.markdown : node.caption)?.trim() ? "编辑备注" : "+ 添加备注"}</button>
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
          {showCoreHandles &&
            (["nw", "ne", "sw", "se"] as Corner[]).map((c) => (
              <div
                key={c}
                className={`core-resize-handle formula-resize-handle corner-${c}`}
                title="拖拽卡片四角，等比缩放核心"
                onPointerDown={(e) => onCoreResizeDown(e, c)}
              />
            ))}
          {showCaptionHandles &&
            TEXT_DIRS.map((d) => (
              <div
                key={d}
                className={`text-resize-handle dir-${d}`}
                title="调整备注阅读宽度，不改变核心大小"
                onPointerDown={(e) => onCaptionResizeDown(e, d)}
              />
            ))}
        </>
      )}
    </div>
  );
}

function CaptionExpandToggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="caption-expand-toggle" onPointerDown={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={checked}
        aria-label="常驻展开"
        onChange={(e) => onChange(e.target.checked)}
      />
      常驻展开
    </label>
  );
}

function getZoom(el: EventTarget | null): number {
  // 世界容器上挂了 data-zoom
  const world = (el as HTMLElement).closest("[data-zoom]");
  return world ? Number(world.getAttribute("data-zoom")) : 1;
}
