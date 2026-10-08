import { useCollections } from "./useCollections";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  makeId,
  connectAssociationOps,
  replayTo,
  resolveOverlapPos,
  type BoardAsset,
  type BoardNode,
  type Op,
  type ReplayState,
} from "../model";
import { EdgeLayer } from "./EdgeLayer";
import { snapDragToCards, type AlignmentGuide, type SnapRect } from "./alignmentSnap";
import { formulaBoxFromNatural, formulaScaleFromCardW, measureFormulaNatural } from "./formulaLayout";
import { pureFormulaKind } from "./markdown";
import { NodeCard } from "./NodeCard";
import type { EditorApi } from "./store";
import {
  panCanvasView,
  zoomViewAt,
  zoomViewByVerticalDrag,
  type CanvasView,
} from "./view";

const EST_H = 120;
const GAP = 24; // 新卡避让间距，与 F07 默认样式间距一致
const DEFAULT_W = 240;
const IMAGE_W = 320;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const KEYBOARD_PAN_MAX_SPEED = 800; // px/s，屏幕坐标速度不受 zoom 影响
const KEYBOARD_PAN_START_SPEED = 320; // 轻点也能立即获得可感知位移
const KEYBOARD_PAN_ACCELERATION = 12;
const KEYBOARD_PAN_DECELERATION = 18;
const KEYBOARD_PAN_STOP_SPEED = 2;
const SNAP_THRESHOLD_PX = 8;
const SNAP_SEARCH_MIN_PX = 96; // 小卡片最低 4 个背景网格
const SNAP_SEARCH_MAX_PX = 320; // 超大卡片也不无限扩张候选范围

type PanKey = "w" | "a" | "s" | "d" | "arrowup" | "arrowleft" | "arrowdown" | "arrowright";

function asPanKey(key: string): PanKey | null {
  const normalized = key.toLowerCase();
  return normalized === "w" ||
    normalized === "a" ||
    normalized === "s" ||
    normalized === "d" ||
    normalized === "arrowup" ||
    normalized === "arrowleft" ||
    normalized === "arrowdown" ||
    normalized === "arrowright"
    ? normalized
    : null;
}

function keyboardPanDirection(keys: ReadonlySet<PanKey>): { x: number; y: number } {
  const x = Number(keys.has("d") || keys.has("arrowright")) - Number(keys.has("a") || keys.has("arrowleft"));
  const y = Number(keys.has("s") || keys.has("arrowdown")) - Number(keys.has("w") || keys.has("arrowup"));
  const length = Math.hypot(x, y);
  return length ? { x: x / length, y: y / length } : { x: 0, y: 0 };
}

interface CanvasProps {
  structureView: boolean;
  editor: EditorApi;
  fitNonce: number; // 变化时执行「回到全部内容可见」
  layoutFit: boolean;
}

type ViewLocal = CanvasView;

export function Canvas({ editor, fitNonce, layoutFit, structureView }: CanvasProps) {
  const { state, dispatch, commit, commitAssetNode } = editor;
  const { file } = state;
  const readOnly = state.replay.active;

  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setViewLocal] = useState<ViewLocal>(file.board.view);
  const [geoms, setGeoms] = useState<Record<string, { w: number; h: number }>>({});
  const [drag, setDrag] = useState<{ dx: number; dy: number; ids: string[] } | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [connect, setConnect] = useState<{ sourceId: string; cursor: { x: number; y: number } } | null>(null);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [frontNodeId, setFrontNodeId] = useState<string | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [altZooming, setAltZooming] = useState(false);
  const [pointerPanning, setPointerPanning] = useState(false);
  const spaceRef = useRef(false);
  const viewRef = useRef(view);
  const panKeysRef = useRef<Set<PanKey>>(new Set());
  const keyboardPanVelocityRef = useRef({ x: 0, y: 0 });
  const keyboardPanFrameRef = useRef<number | null>(null);
  const keyboardPanLastTimeRef = useRef(0);
  const keyboardPanMovedRef = useRef(false);
  viewRef.current = view;

  useEffect(() => {
    if (!editingLabelId) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [editingLabelId]);

  // 回放快照（只读）；正常编辑时用 file 本体
  const replayState: ReplayState | null = useMemo(
    () => (state.replay.active ? replayTo(file, state.replay.step) : null),
    [file, state.replay.active, state.replay.step],
  );
  const nodes = replayState ? replayState.nodes : file.nodes;
  const edges = replayState ? replayState.edges : file.edges;

  // 最近操作的卡片只影响本次会话的绘制层级，不改文件和历史。
  useEffect(() => setFrontNodeId(null), [file.board.id]);
  useEffect(() => {
    const selectedId = state.selection.nodes.at(-1);
    if (selectedId) setFrontNodeId(selectedId);
  }, [state.selection.nodes]);

  // 打开/新建白板时重置视图
  useEffect(() => {
    setViewLocal(file.board.view);
    setGeoms({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.board.id]);

  const heights: Record<string, number> = {};
  const widths: Record<string, number> = {};
  for (const id in geoms) {
    heights[id] = geoms[id].h;
    widths[id] = geoms[id].w;
  }
  /** 实测外框已包含文本 min-height；纯公式卡不沿用旧卡的多余高度。 */
  const outerH = (n: BoardNode) => heights[n.id] ?? n.h ?? EST_H;
  const outerW = (n: BoardNode) => widths[n.id] ?? n.w;

  const commitView = useCallback(
    (v: ViewLocal) => dispatch({ type: "setView", panX: v.panX, panY: v.panY, zoom: v.zoom }),
    [dispatch],
  );

  /**
   * 键盘平移使用 rAF 驱动，不依赖操作系统的按键重复频率。
   * 速度指数逼近目标值，按下有快速起步，松开后短距离减速收尾。
   */
  const startKeyboardPan = useCallback(
    (key: PanKey) => {
      panKeysRef.current.add(key);
      if (keyboardPanFrameRef.current !== null) return;

      const initialDirection = keyboardPanDirection(panKeysRef.current);
      keyboardPanVelocityRef.current = {
        x: initialDirection.x * KEYBOARD_PAN_START_SPEED,
        y: initialDirection.y * KEYBOARD_PAN_START_SPEED,
      };
      keyboardPanMovedRef.current = false;
      keyboardPanLastTimeRef.current = performance.now();

      const tick = (now: number) => {
        const dt = Math.min((now - keyboardPanLastTimeRef.current) / 1000, 0.05);
        keyboardPanLastTimeRef.current = now;

        const direction = keyboardPanDirection(panKeysRef.current);
        const hasDirection = direction.x !== 0 || direction.y !== 0;
        const targetX = direction.x * KEYBOARD_PAN_MAX_SPEED;
        const targetY = direction.y * KEYBOARD_PAN_MAX_SPEED;
        const response = hasDirection ? KEYBOARD_PAN_ACCELERATION : KEYBOARD_PAN_DECELERATION;
        const blend = 1 - Math.exp(-response * dt);
        const velocity = keyboardPanVelocityRef.current;
        velocity.x += (targetX - velocity.x) * blend;
        velocity.y += (targetY - velocity.y) * blend;

        if (!hasDirection && Math.hypot(velocity.x, velocity.y) < KEYBOARD_PAN_STOP_SPEED) {
          keyboardPanVelocityRef.current = { x: 0, y: 0 };
          keyboardPanFrameRef.current = null;
          if (keyboardPanMovedRef.current) commitView(viewRef.current);
          keyboardPanMovedRef.current = false;
          return;
        }

        if (dt > 0) {
          const next = panCanvasView(viewRef.current, velocity.x * dt, velocity.y * dt);
          viewRef.current = next;
          setViewLocal(next);
          keyboardPanMovedRef.current = true;
        }
        keyboardPanFrameRef.current = requestAnimationFrame(tick);
      };

      keyboardPanFrameRef.current = requestAnimationFrame(tick);
    },
    [commitView],
  );

  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      const key = asPanKey(e.key);
      if (key) panKeysRef.current.delete(key);
    };
    const onBlur = () => panKeysRef.current.clear();
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      panKeysRef.current.clear();
      if (keyboardPanFrameRef.current !== null) cancelAnimationFrame(keyboardPanFrameRef.current);
      keyboardPanFrameRef.current = null;
    };
  }, []);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return {
      x: (clientX - rect.left - v.panX) / v.zoom,
      y: (clientY - rect.top - v.panY) / v.zoom,
    };
  }, []);

  const collectionUI = useCollections({ editor, nodes, collections: (replayState ? replayState.collections : file.collections) ?? [], geoms, drag, setDrag, toWorld });

  // ---- 卡片实测外框高度（h=null 自适应 → 连线锚点/框选/避让需要几何） ----
  // 注意用 border-box（含 padding+border）：contentRect 只量内容高，会让几何计算矮 23px
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setGeoms((prev) => {
        const next = { ...prev };
        for (const en of entries) {
          const el = en.target as HTMLElement;
          const id = el.dataset.nodeId;
          if (!id) continue;
          next[id] = {
            w: en.borderBoxSize?.[0]?.inlineSize ?? el.offsetWidth,
            h: en.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight,
          };
        }
        return next;
      });
    });
    for (const card of el.querySelectorAll("[data-node-id]")) ro.observe(card);
    return () => ro.disconnect();
  });

  // ---- Ctrl+滚轮缩放（固定以画布中心为锚点；非 passive 才能 preventDefault） ----
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = rect.width / 2;
      const my = rect.height / 2;
      const v = viewRef.current;
      const next = zoomViewAt(v, mx, my, v.zoom * Math.exp(-e.deltaY * 0.0012));
      setViewLocal(next);
      commitView(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [commitView]);

  // ---- 空格平移状态 ----
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT") return;
      if (e.code === "Space") {
        spaceRef.current = true;
        setSpaceDown(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceRef.current = false;
        setSpaceDown(false);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ---- 适应视图（回到全部内容可见） ----
  useEffect(() => {
    if (fitNonce === 0 || (nodes.length === 0 && !collectionUI.bounds.length)) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const pad = layoutFit ? Math.max(24, Math.min(rect.width, rect.height) * 0.04) : 80;
    const lineBoxes = [...containerRef.current!.querySelectorAll<SVGGraphicsElement>(".edge-path, .edge-label")].map(path => path.getBBox());
    const x0 = Math.min(...nodes.map((n) => n.x), ...collectionUI.bounds.map(b => b.x), ...lineBoxes.map(b => b.x)) - pad;
    const y0 = Math.min(...nodes.map((n) => n.y), ...collectionUI.bounds.map(b => b.y), ...lineBoxes.map(b => b.y)) - pad;
    const x1 = Math.max(...nodes.map((n) => n.x + outerW(n)), ...collectionUI.bounds.map(b => b.x + b.w), ...lineBoxes.map(b => b.x + b.width)) + pad;
    const y1 = Math.max(...nodes.map((n) => n.y + outerH(n)), ...collectionUI.bounds.map(b => b.y + b.h), ...lineBoxes.map(b => b.y + b.height)) + pad;
    const zoom = Math.min(layoutFit ? 3 : 2, Math.max(0.1, Math.min(rect.width / (x1 - x0), rect.height / (y1 - y0))));
    const next = {
      zoom,
      panX: rect.width / 2 - ((x0 + x1) / 2) * zoom,
      panY: rect.height / 2 - ((y0 + y1) / 2) * zoom,
    };
    setViewLocal(next);
    commitView(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitNonce]);

  // ---- 键盘建子卡/同级卡与粘贴文本时避让现有卡片；双击建卡直接落在光标处 ----
  const freePos = useCallback(
    (x: number, y: number, w: number) =>
      resolveOverlapPos(nodes, heights, x, y, w, { gap: GAP, estH: EST_H, widths }),
    [nodes, heights, widths],
  );

  const createTextCard = useCallback(
    (at: { x: number; y: number }, markdown = "", label = "创建卡片", placement: "exact" | "avoid" = "avoid") => {
      const requested = { x: Math.round(at.x), y: Math.round(at.y) };
      const pos = placement === "exact" ? requested : freePos(requested.x, requested.y, DEFAULT_W);
      const node: BoardNode = {
        id: makeId("node"),
        type: "text",
        markdown,
        x: pos.x,
        y: pos.y,
        w: DEFAULT_W,
        h: null,
      };
      commit(label, [{ op: "addNode", node, before: null, after: node }], { nodes: [node.id], edges: [] }, node.id);
    },
    [commit, freePos],
  );

  // ---- 空白处指针：Alt+左键缩放 / 左键平移 / Shift+左键或 Ctrl+左键框选 ----
  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (readOnly) return;
    const ctrlLeftMarquee = e.button === 0 && e.ctrlKey && !e.altKey;
    if (e.button !== 0 && e.button !== 1) return;
    if (e.target !== e.currentTarget && (e.target as HTMLElement).closest(".node-card, .edge-hit, .edge-label")) return;
    if (!ctrlLeftMarquee && !e.shiftKey) collectionUI.clearActive();
    if (ctrlLeftMarquee) e.preventDefault();
    containerRef.current?.focus({ preventScroll: true });
    setEditingLabelId(null);
    const startClient = { x: e.clientX, y: e.clientY };
    const startView = { ...viewRef.current };
    const startWorld = toWorld(e.clientX, e.clientY);
    const zooming = e.altKey && e.button === 0;
    const directPanning = !zooming && e.button === 0 && !e.shiftKey && !ctrlLeftMarquee;
    const panning = !zooming && !ctrlLeftMarquee && (directPanning || spaceRef.current || e.button === 1);
    if (zooming) {
      e.preventDefault();
      setAltZooming(true);
    }
    if (panning) {
      e.preventDefault();
      setPointerPanning(true);
    }
    const rect = containerRef.current!.getBoundingClientRect();
    const zoomAnchor = { x: rect.width / 2, y: rect.height / 2 };
    let moved = false;
    let latestView = startView;
    let marq: { x0: number; y0: number; x1: number; y1: number } | null = null;

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startClient.x;
      const dy = ev.clientY - startClient.y;
      if (!moved && (zooming ? Math.abs(dy) : Math.hypot(dx, dy)) > 3) moved = true;
      if (!moved) return;
      if (zooming) {
        latestView = zoomViewByVerticalDrag(startView, zoomAnchor.x, zoomAnchor.y, dy);
        setViewLocal(latestView);
      } else if (panning) {
        latestView = { ...startView, panX: startView.panX + dx, panY: startView.panY + dy };
        setViewLocal(latestView);
      } else {
        const cur = toWorld(ev.clientX, ev.clientY);
        marq = { x0: startWorld.x, y0: startWorld.y, x1: cur.x, y1: cur.y };
        setMarquee(marq);
      }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setAltZooming(false);
      setPointerPanning(false);
      if (zooming || panning) {
        if (moved) commitView(latestView);
        else if (directPanning && !ev.shiftKey) dispatch({ type: "select", nodes: [], edges: [] });
      } else if (marq) {
        const [xa, xb] = [Math.min(marq.x0, marq.x1), Math.max(marq.x0, marq.x1)];
        const [ya, yb] = [Math.min(marq.y0, marq.y1), Math.max(marq.y0, marq.y1)];
        const hit = nodes.filter((n) => {
          const nh = outerH(n);
          return n.x <= xb && n.x + outerW(n) >= xa && n.y <= yb && n.y + nh >= ya;
        });
        const ids = hit.map((n) => n.id);
        dispatch({
          type: "select",
          nodes: ctrlLeftMarquee || ev.shiftKey ? [...new Set([...state.selection.nodes, ...ids])] : ids,
          edges: ctrlLeftMarquee || ev.shiftKey ? state.selection.edges : [],
        });
        setMarquee(null);
      } else if (!moved && !ev.shiftKey && !ctrlLeftMarquee) {
        dispatch({ type: "select", nodes: [], edges: [] });
      }
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setAltZooming(false);
      setPointerPanning(false);
      if (zooming || panning) setViewLocal(startView);
      setMarquee(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  // ---- 卡片拖动（一次拖动 = 一个 moveNode；多选 = 单步骤多 moveNode） ----
  const onCardPointerDown = (e: React.PointerEvent, nodeId: string) => {
    if (readOnly || e.button !== 0) return;
    if (e.ctrlKey) e.preventDefault();
    if (state.editingId === nodeId) return; // 编辑中不拖卡
    e.stopPropagation();
    setFrontNodeId(nodeId);
    containerRef.current?.focus({ preventScroll: true });

    let dragIds: string[];
    if (state.selection.nodes.includes(nodeId)) {
      dragIds = state.selection.nodes;
    } else if (e.shiftKey || e.ctrlKey) {
      dragIds = [...state.selection.nodes, nodeId];
      dispatch({ type: "select", nodes: dragIds, edges: state.selection.edges });
    } else {
      dragIds = [nodeId];
      dispatch({ type: "select", nodes: dragIds, edges: [] });
    }
    const startWorld = toWorld(e.clientX, e.clientY);
    const startPos = new Map(dragIds.map((id) => {
      const n = nodes.find((x) => x.id === id)!;
      return [id, { x: n.x, y: n.y }];
    }));
    const movingRects: SnapRect[] = dragIds.map((id) => {
      const n = nodes.find((x) => x.id === id)!;
      return { id, x: n.x, y: n.y, w: outerW(n), h: outerH(n) };
    });
    const dragSet = new Set(dragIds);
    const targetRects: SnapRect[] = nodes
      .filter((n) => !dragSet.has(n.id))
      .map((n) => ({ id: n.id, x: n.x, y: n.y, w: outerW(n), h: outerH(n) }));
    let moved = false;
    let delta = { dx: 0, dy: 0 };
    const move = (ev: PointerEvent) => {
      const cur = toWorld(ev.clientX, ev.clientY);
      const raw = { dx: cur.x - startWorld.x, dy: cur.y - startWorld.y };
      if (!moved && Math.hypot(raw.dx, raw.dy) > 2) moved = true;
      const snapped = ev.altKey
        ? { ...raw, guides: [] }
        : snapDragToCards(
            movingRects,
            targetRects,
            raw,
            SNAP_THRESHOLD_PX / viewRef.current.zoom,
            SNAP_SEARCH_MIN_PX / viewRef.current.zoom,
            SNAP_SEARCH_MAX_PX / viewRef.current.zoom,
          );
      delta = { dx: snapped.dx, dy: snapped.dy };
      if (moved) {
        setDrag({ ...delta, ids: dragIds });
        setAlignmentGuides(snapped.guides);
      }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setDrag(null);
      setAlignmentGuides([]);
      if (!moved) return;
      // Alt+拖动落点换父（需求 §F04 改父节点）：落到卡片=挂为其子，落到空白=脱离成根
      if (ev.altKey && dragIds.length === 1) {
        const nodeId = dragIds[0];
        const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
        const targetId = el?.closest("[data-node-id]")?.getAttribute("data-node-id");
        if (targetId && targetId !== nodeId) {
          commit("换父", [{ op: "reparent", nodeId, before: null, after: { parentId: targetId } }]);
        } else if (!targetId) {
          commit("脱离父节点", [{ op: "reparent", nodeId, before: null, after: { parentId: null } }]);
        }
        return;
      }
      const ops: Op[] = dragIds.map((id) => {
        const p0 = startPos.get(id)!;
        return {
          op: "moveNode" as const,
          nodeId: id,
          before: { x: p0.x, y: p0.y },
          after: { x: Math.round(p0.x + delta.dx), y: Math.round(p0.y + delta.dy) },
        };
      });
      commit(dragIds.length > 1 ? `移动 ${dragIds.length} 张卡片` : "移动卡片", ops);
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setDrag(null);
      setAlignmentGuides([]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  // ---- 连线：从连接点拖到另一卡 ----
  const onStartConnect = (e: React.PointerEvent, nodeId: string) => {
    if (readOnly) return;
    setFrontNodeId(nodeId);
    e.stopPropagation();
    e.preventDefault();
    setConnect({ sourceId: nodeId, cursor: toWorld(e.clientX, e.clientY) });
    const move = (ev: PointerEvent) => setConnect({ sourceId: nodeId, cursor: toWorld(ev.clientX, ev.clientY) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setConnect(null);
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const targetId = el?.closest("[data-node-id]")?.getAttribute("data-node-id");
      if (!targetId || targetId === nodeId) return;
      const edge = {
        id: makeId("edge"),
        kind: "association" as const,
        from: nodeId,
        to: targetId,
        directed: true,
      };
      commit("建立关联", connectAssociationOps(file.edges, edge), { nodes: [], edges: [edge.id] });
      setEditingLabelId(edge.id);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onCardPointerUp = (_e: React.PointerEvent, _nodeId: string) => {
    // 连线落点在 window pointerup 统一处理（elementFromPoint）
  };

  // ---- 双击：空白建卡；已有卡片进入编辑（文本卡） ----
  const onDoubleClick = (e: React.MouseEvent) => {
    if (readOnly || e.button !== 0 || e.ctrlKey) return;
    if ((e.target as HTMLElement).closest("input, textarea")) return; // 编辑框内的双击是选词
    const cardEl = (e.target as HTMLElement).closest("[data-node-id]");
    if (cardEl) {
      const nodeId = cardEl.getAttribute("data-node-id")!;
      const node = file.nodes.find((n) => n.id === nodeId);
      // 文本卡进入正文编辑；图片卡进入 caption 编辑
      if (node && state.editingId !== nodeId) {
        dispatch({ type: "select", nodes: [nodeId], edges: [] });
        dispatch({ type: "setEditing", id: nodeId });
      }
      return;
    }
    if ((e.target as HTMLElement).closest(".edge-hit, .edge-label")) return;
    const pt = toWorld(e.clientX, e.clientY);
    createTextCard({ x: pt.x - DEFAULT_W / 2, y: pt.y - 30 }, "", "创建卡片", "exact");
  };

  // ---- 文本提交 ----
  const onCommitText = (nodeId: string, markdown: string, caption?: string, captionExpanded?: boolean) => {
    const node = file.nodes.find((n) => n.id === nodeId);
    dispatch({ type: "setEditing", id: null });
    if (!node) return;
    const ops: Op[] = [];
    const textChanged = node.markdown !== markdown;
    const captionChanged = node.type === "text" && caption !== undefined && (node.caption ?? "") !== caption;
    const expandedChanged = captionExpanded !== undefined && Boolean(node.captionExpanded) !== captionExpanded;
    if (textChanged) ops.push({ op: "updateNodeText", nodeId, before: null, after: { markdown } });
    if (captionChanged) {
      ops.push({ op: "updateNodeCaption", nodeId, before: null, after: { caption: caption!.trim() ? caption! : null } });
    }
    if (expandedChanged) {
      ops.push({ op: "setCaptionExpanded", nodeId, before: null, after: { expanded: captionExpanded! } });
    }
    if (!ops.length) return;
    // 成为/保持纯公式：外框写成公式字形×scale + chrome，避免默认 240 宽留白
    if (textChanged && node.type === "text" && pureFormulaKind(markdown)) {
      const nat = measureFormulaNatural(markdown);
      if (nat) {
        const prevKind = pureFormulaKind(node.markdown ?? "");
        const prevNat = prevKind ? measureFormulaNatural(node.markdown ?? "") : null;
        const scale =
          prevKind && node.h != null && prevNat ? formulaScaleFromCardW(prevNat.w, node.w) : 1;
        const box = formulaBoxFromNatural(nat, scale);
        if (Math.abs(box.w - node.w) > 0.5 || Math.abs(box.h - (node.h ?? 0)) > 0.5 || node.coreScale) {
          ops.push({
            op: "resizeNode",
            nodeId,
            before: null,
            after: { w: Math.round(box.w), h: Math.round(box.h), coreScale: null },
          });
        }
      }
    }
    commit(textChanged ? "修改文本" : captionChanged ? "修改公式备注" : "设置备注展开", ops);
  };

  // ---- 图片导入（粘贴/拖入共用；需求 §F05：≤5MB、PNG/JPEG、进 assets） ----
  const importImage = async (fileBlob: File, at: { x: number; y: number }) => {
    if (fileBlob.size > MAX_IMAGE_BYTES || fileBlob.size < 1) {
      dispatch({ type: "commitError", message: "图片需 ≤5MB" });
      return;
    }
    const mime = fileBlob.type;
    if (mime !== "image/png" && mime !== "image/jpeg") {
      dispatch({ type: "commitError", message: "仅支持 PNG/JPEG 图片" });
      return;
    }
    const bytes = new Uint8Array(await fileBlob.arrayBuffer());
    const id = makeId("asset");
    const asset: BoardAsset = {
      id,
      mime,
      path: `assets/${id}.${mime === "image/png" ? "png" : "jpg"}`,
      bytes: bytes.length,
    };
    const pos = freePos(Math.round(at.x), Math.round(at.y), IMAGE_W);
    const node: BoardNode = {
      id: makeId("node"),
      type: "image",
      assetId: id,
      x: pos.x,
      y: pos.y,
      w: IMAGE_W,
      h: null,
    };
    commitAssetNode("添加图片卡片", asset, bytes, [{ op: "addNode", node, before: null, after: node }], {
      nodes: [node.id],
    });
  };

  // ---- 粘贴事件：图片 → 图片卡；纯文本 → 文本卡（需求 §4） ----
  const onPaste = (e: React.ClipboardEvent) => {
    if (readOnly || state.editingId) return; // 编辑框内粘贴走 textarea 默认行为
    const items = e.clipboardData?.items;
    if (!items) return;
    const center = (() => {
      const rect = containerRef.current!.getBoundingClientRect();
      return toWorld(rect.left + rect.width / 2 - DEFAULT_W / 2, rect.top + rect.height / 2 - 60);
    })();
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) {
          e.preventDefault();
          void importImage(f, center);
          return;
        }
      }
    }
    const text = e.clipboardData.getData("text/plain");
    if (text) {
      e.preventDefault();
      createTextCard(center, text, "粘贴文本卡片");
    }
  };

  // ---- 拖入本地图片 ----
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (readOnly) return;
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    void importImage(f, toWorld(e.clientX, e.clientY));
  };

  // ---- 键盘（§4 交互表）：挂 window——编辑提交后焦点在 body 上也要能继续快捷键 ----
  // 监听器只注册一次，经 ref 永远调最新闭包：useLayoutEffect 同步提交，
  // 杜绝「快速连按时被动 effect 尚未换绑、旧闭包读到旧 nodes」的竞态（叠卡根因之一）。
  const onKeyDown = (e: KeyboardEvent) => {
      if (readOnly) {
        if (e.key === "Escape") dispatch({ type: "replayExit" });
        return;
      }
      if (e.isComposing) return; // 中文输入法选字优先
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
    if (collectionUI.handleKey(e)) return;
    const sel = state.selection;
    const selNode = sel.nodes.length === 1 ? file.nodes.find((n) => n.id === sel.nodes[0]) : null;

    // WASD / 方向键逐帧平移；忽略 key repeat，移动速度由 rAF 动画统一控制。
    if (!state.editingId && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const panKey = asPanKey(e.key);
      if (panKey) {
        e.preventDefault();
        startKeyboardPan(panKey);
        return;
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      dispatch({ type: "undo" });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
      e.preventDefault();
      dispatch({ type: "redo" });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      dispatch({ type: "select", nodes: file.nodes.map((n) => n.id), edges: [] });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      if (sel.nodes.length) {
        dispatch({ type: "setClipboard", nodeIds: sel.nodes });
        e.preventDefault();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
      if (sel.nodes.length) {
        dispatch({ type: "setClipboard", nodeIds: sel.nodes });
        deleteSelection();
        e.preventDefault();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
      if (state.clipboard?.nodeIds.length) {
        e.preventDefault();
        editor.duplicateSelection();
      }
      // 剪贴板为空时放行，走 onPaste（图片/纯文本）
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      editor.duplicateSelection();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (e.shiftKey && sel.nodes.length > 0) deleteBranch();
      else deleteSelection();
      return;
    }
    if (e.key === "Escape") {
      if (connect) setConnect(null);
      else if (editingLabelId) setEditingLabelId(null);
      else if (sel.nodes.length || sel.edges.length) dispatch({ type: "select", nodes: [], edges: [] });
      return;
    }
      if (!selNode || state.editingId) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        // 文本卡进入正文编辑；图片卡进入 caption 编辑（契约 §2-B 演进）
        dispatch({ type: "setEditing", id: selNode.id });
        return;
      }
      if (e.key === "Enter" && e.shiftKey) {
        // 同级卡片：同父则挂在父下，无父则独立（§4）
        e.preventDefault();
        createSibling(selNode);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        createChild(selNode);
      }
  };
  const keyHandlerRef = useRef(onKeyDown);
  useLayoutEffect(() => {
    keyHandlerRef.current = onKeyDown;
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const createChild = (parent: BoardNode) => {
    // 子卡：父卡右侧（GAP 间距），与父卡顶对齐，碰撞则向障碍卡下方顺延
    const pos = freePos(Math.round(parent.x + parent.w + GAP + 40), Math.round(parent.y), DEFAULT_W);
    const node: BoardNode = {
      id: makeId("node"),
      type: "text",
      markdown: "",
      x: pos.x,
      y: pos.y,
      w: DEFAULT_W,
      h: null,
    };
    const edge = { id: makeId("edge"), kind: "parentChild" as const, from: parent.id, to: node.id, directed: true };
    commit(
      "创建子卡片",
      [
        { op: "addNode", node, before: null, after: node },
        { op: "addEdge", edge, before: null, after: edge },
      ],
      { nodes: [node.id], edges: [] },
      node.id,
    );
  };

  const createSibling = (selNode: BoardNode) => {
    // 同级卡：当前卡正下方（GAP 间距），同父则挂同父，无父则独立（§4）
    const parentEdge = file.edges.find((x) => x.kind === "parentChild" && x.to === selNode.id);
    const pos = freePos(
      Math.round(selNode.x),
      Math.round(selNode.y + outerH(selNode) + GAP),
      selNode.w,
    );
    const node: BoardNode = {
      id: makeId("node"),
      type: "text",
      markdown: "",
      x: pos.x,
      y: pos.y,
      w: selNode.w,
      h: null,
    };
    const ops: Op[] = [{ op: "addNode", node, before: null, after: node }];
    if (parentEdge) {
      const edge = { id: makeId("edge"), kind: "parentChild" as const, from: parentEdge.from, to: node.id, directed: true };
      ops.push({ op: "addEdge", edge, before: null, after: edge });
    } else {
      // 无树父但有入向 association：为每个来源复制入向关联（方向/线型一致，label 留空）。
      // 用户直觉：「A 指向 B 时，B 的同级卡也该被 A 指向」（契约 §3-A Scenario: 同级卡复制入向关联）
      const incoming = file.edges.filter((e) => e.kind === "association" && e.to === selNode.id);
      for (const e of incoming) {
        const edge = {
          id: makeId("edge"),
          kind: "association" as const,
          from: e.from,
          to: node.id,
          directed: e.directed,
        };
        ops.push({ op: "addEdge", edge, before: null, after: edge });
      }
    }
    commit("创建同级卡片", ops, { nodes: [node.id], edges: [] }, node.id);
  };

  const deleteSelection = () => {
    const sel = state.selection;
    if (!sel.nodes.length && !sel.edges.length) return;
    const ops: Op[] = sel.nodes.map((id) => ({ op: "removeNode", nodeId: id, before: null, after: null }));
    // removeNode 已级联删关联边（I1）；显式选中的边若触及被删节点则不重复删
    const removedNodeIds = new Set(sel.nodes);
    for (const eid of sel.edges) {
      const edge = file.edges.find((x) => x.id === eid);
      if (edge && !removedNodeIds.has(edge.from) && !removedNodeIds.has(edge.to))
        ops.push({ op: "removeEdge", edgeId: eid, before: null, after: null });
    }
    commit(
      sel.nodes.length > 1 ? `删除 ${sel.nodes.length} 张卡片` : "删除所选",
      ops,
      { nodes: [], edges: [] },
    );
  };

  /** 删除整条分支（需求 §F04）：选中节点及其 parentChild 后代，单步骤可一次撤销。 */
  const deleteBranch = () => {
    const sel = state.selection;
    if (!sel.nodes.length) return;
    const all = new Set<string>();
    const queue = [...sel.nodes];
    while (queue.length) {
      const id = queue.pop()!;
      if (all.has(id)) continue;
      all.add(id);
      for (const e of file.edges) if (e.kind === "parentChild" && e.from === id) queue.push(e.to);
    }
    const ops: Op[] = [...all].map((id) => ({ op: "removeNode", nodeId: id, before: null, after: null }));
    commit(`删除分支（${all.size} 张卡片）`, ops, { nodes: [], edges: [] });
  };

  const onSelectEdge = (e: React.PointerEvent, edgeId: string) => {
    if (readOnly) return;
    e.stopPropagation();
    dispatch({
      type: "select",
      nodes: [],
      edges: e.shiftKey ? [...new Set([...state.selection.edges, edgeId])] : [edgeId],
    });
  };

  const onCommitLabel = (edgeId: string, label: string) => {
    setEditingLabelId(null);
    const edge = file.edges.find((x) => x.id === edgeId);
    if (!edge || (edge.label ?? "") === label) return;
    commit("修改关系说明", [
      {
        op: "updateEdge",
        edgeId,
        before: { from: edge.from, to: edge.to, label: edge.label, directed: edge.directed },
        after: { from: edge.from, to: edge.to, label, directed: edge.directed },
      },
    ]);
  };

  const onResizeTextEnd = (nodeId: string, w: number, h: number | null, coreScale?: number | null) => {
    const node = file.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const after: { w: number; h: number | null; coreScale?: number | null } = { w, h };
    if (coreScale !== undefined) after.coreScale = coreScale;
    commit(coreScale ? "缩放核心" : "缩放公式", [{ op: "resizeNode", nodeId, before: null, after }]);
  };
  const onResizeCaptionWidth = (nodeId: string, captionW: number) => {
    const node = file.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    commit("调整备注宽度", [{ op: "setCaptionWidth", nodeId, before: null, after: { captionW } }]);
  };

  // ---- 图片等比缩放（需求 §F05）：四角手柄拖拽，松手一个 resizeNode op（w,h 都写） ----
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const onImageAspect = useCallback((nodeId: string, aspect: number) => {
    setAspects((prev) => (Math.abs((prev[nodeId] ?? 0) - aspect) < 0.001 ? prev : { ...prev, [nodeId]: aspect }));
  }, []);
  const onResizeImageEnd = (nodeId: string, w: number, h: number) => {
    const node = file.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    commit("缩放图片", [
      { op: "resizeNode", nodeId, before: { w: node.w, h: node.h ?? null }, after: { w, h } },
    ]);
  };

  return (
    <div
      ref={containerRef}
      className={"canvas" + (spaceDown ? " panning" : "") + (pointerPanning ? " pointer-panning" : "") + (altZooming ? " alt-zooming" : "") + (readOnly ? " readonly" : "")}
      tabIndex={0}
      onPointerDown={onBackgroundPointerDown}
      onDoubleClick={onDoubleClick}
      onPaste={onPaste}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      // 自愈：overflow:hidden 的容器仍可被程序滚动（如聚焦屏外元素），一旦滚动立即归位，
      // 否则容器滚动与 view.pan 双轨偏移会让鼠标坐标与卡片位置失配
      onScroll={(e) => {
        const t = e.currentTarget;
        if (t.scrollLeft !== 0 || t.scrollTop !== 0) t.scrollTo(0, 0);
      }}
    >
      <div
        className="world"
        data-zoom={view.zoom}
        style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
      >
        {collectionUI.layer}
        <EdgeLayer
          nodes={nodes}
          edges={edges}
          heights={heights}
          widths={widths}
          selectedEdgeIds={state.selection.edges}
          connect={connect}
          editingLabelId={editingLabelId}
          readOnly={readOnly}
          onSelectEdge={onSelectEdge}
          onLabelDoubleClick={(id) => setEditingLabelId(id)}
          onCommitLabel={onCommitLabel}
          onCancelLabel={() => setEditingLabelId(null)}
        />
        {nodes.map((n) => (
          <NodeCard
            hideCaptions={structureView}
            key={n.id}
            node={n}
            selected={state.selection.nodes.includes(n.id)}
            front={frontNodeId === n.id}
            editing={state.editingId === n.id}
            blobUrl={n.assetId ? state.blobUrls[n.assetId] : undefined}
            aspect={n.assetId ? aspects[n.id] : undefined}
            dragDelta={drag && drag.ids.includes(n.id) ? { dx: drag.dx, dy: drag.dy } : null}
            connectSourceId={connect?.sourceId ?? null}
            readOnly={readOnly}
            onCardPointerDown={onCardPointerDown}
            onCardPointerUp={onCardPointerUp}
            onStartConnect={onStartConnect}
            onCommitText={onCommitText}
            onStartEdit={(id) => {
              setFrontNodeId(id);
              dispatch({ type: "setEditing", id });
            }}
            onCancelEdit={() => dispatch({ type: "setEditing", id: null })}
            onResizeTextEnd={onResizeTextEnd}
            onResizeCaptionWidth={onResizeCaptionWidth}
            onImageAspect={onImageAspect}
            onResizeImageEnd={onResizeImageEnd}
          />
        ))}
        {marquee && (
          <div
            className="marquee"
            style={{
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
            }}
          />
        )}
        {alignmentGuides.map((guide) => (
          <div
            key={`${guide.axis}-${guide.position}-${guide.targetId}`}
            className={`alignment-guide alignment-guide-${guide.axis}`}
            data-axis={guide.axis}
            data-target-id={guide.targetId}
            data-moving-kind={guide.movingKind}
            data-target-kind={guide.targetKind}
            style={guide.axis === "x"
              ? {
                  left: guide.position,
                  top: guide.start,
                  width: 1.5 / view.zoom,
                  height: guide.end - guide.start,
                }
              : {
                  left: guide.start,
                  top: guide.position,
                  width: guide.end - guide.start,
                  height: 1.5 / view.zoom,
                }}
          />
        ))}
      </div>
      {collectionUI.panel}
      {!readOnly && nodes.length === 0 && (
        <div className="canvas-hint">
          双击建卡 · 左键拖动画布 · WASD/方向键平移 · Alt+左键上下拖缩放 · Shift+左键框选 · Enter 编辑
        </div>
      )}
      {readOnly && <div className="replay-shade">回放中（只读）· 第 {state.replay.step}/{file.history.length} 步 · Esc 返回编辑</div>}
    </div>
  );
}
