import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { arrangeCollectionOps, collectionBounds, makeCollectionId, memberNodes, type BoardCollection, type BoardNode, type CollectionGeometry, type Op } from "../model";
import type { EditorApi } from "./store";
import { uniformCoreWidthOps } from "./collectionSizing";

type Drag = { dx: number; dy: number; ids: string[] } | null;
interface Props {
  editor: EditorApi;
  nodes: BoardNode[];
  collections: BoardCollection[];
  geoms: CollectionGeometry;
  drag: Drag;
  setDrag: (drag: Drag) => void;
  toWorld: (x: number, y: number) => { x: number; y: number };
}
function CollectionDetails({ collection, update }: { collection: BoardCollection; update: (c: BoardCollection) => void }) {
  const [name, setName] = useState(collection.name);
  const [description, setDescription] = useState(collection.description ?? "");
  useEffect(() => { setName(collection.name); setDescription(collection.description ?? ""); }, [collection]);
  return <>
    <input aria-label="集合名称" value={name} maxLength={200} onChange={e => setName(e.target.value)}
      onBlur={() => { if (name.trim() && name.trim() !== collection.name) update({ ...collection, name: name.trim() }); else setName(collection.name); }}
      onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur(); }} />
    <input aria-label="集合关系说明" placeholder="这些卡片有什么内在关系？" value={description} onChange={e => setDescription(e.target.value)}
      onBlur={() => { if (description !== (collection.description ?? "")) update({ ...collection, description }); }}
      onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur(); }} />
    <select aria-label="集合形状" value={collection.shape} onChange={e => update({ ...collection, shape: e.target.value as BoardCollection["shape"] })}>
      <option value="rectangle">矩形</option><option value="ellipse">椭圆</option><option value="circle">圆形</option>
    </select>
  </>;
}

export function useCollections({ editor, nodes, collections, geoms, drag, setDrag, toWorld }: Props) {
  const { state, commit, dispatch } = editor;
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setToolbarHost(document.getElementById("collection-controls")); }, []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [emptyDelta, setEmptyDelta] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [width, setWidth] = useState(240);
  const readOnly = state.replay.active;
  const active = collections.find(c => c.id === activeId);
  useEffect(() => { setActiveId(null); }, [state.sessionId, readOnly]);
  const selectedIds = state.selection.nodes.filter(id => nodes.some(n => n.id === id));
  const update = (c: BoardCollection) => commit("修改集合", [{ op: "updateCollection", collectionId: c.id, before: null, after: c }]);
  const dissolve = () => {
    if (!active) return;
    commit("解散集合（保留卡片）", [{ op: "removeCollection", collectionId: active.id, before: null, after: null }]);
    setActiveId(null);
  };
  const create = () => {
    const members = nodes.filter(n => selectedIds.includes(n.id));
    const c: BoardCollection = { id: makeCollectionId(), name: `集合 ${collections.length + 1}`, shape: "rectangle", nodeIds: selectedIds,
      x: Math.min(...members.map(n => n.x)) - 40, y: Math.min(...members.map(n => n.y)) - 50 };
    commit("将所选卡片建为集合", [{ op: "addCollection", collection: c, before: null, after: c }], { nodes: [], edges: [] });
    setActiveId(c.id);
  };
  const onPointerDown = (e: React.PointerEvent, c: BoardCollection) => {
    if (readOnly || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).focus?.({ preventScroll: true });
    setActiveId(c.id);
    dispatch({ type: "select", nodes: [], edges: [] });
    const start = toWorld(e.clientX, e.clientY);
    const members = memberNodes(c, nodes);
    let delta = { dx: 0, dy: 0 }, moved = false;
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      delta = { dx: p.x - start.x, dy: p.y - start.y };
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
      moved = true;
      setDrag({ ...delta, ids: members.map(n => n.id) });
      setEmptyDelta({ ...delta, id: c.id });
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel);
      setDrag(null); setEmptyDelta(null);
    };
    const up = () => {
      cleanup();
      if (!moved) return;
      const ops: Op[] = members.map(n => ({ op: "moveNode", nodeId: n.id, before: null, after: { x: n.x + delta.dx, y: n.y + delta.dy } }));
      ops.push({ op: "updateCollection", collectionId: c.id, before: null, after: { ...c, x: c.x + delta.dx, y: c.y + delta.dy } });
      commit("移动集合", ops);
    };
    const cancel = () => cleanup();
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel);
  };
  const displayed = nodes.map(n => drag?.ids.includes(n.id) ? { ...n, x: n.x + drag.dx, y: n.y + drag.dy } : n);
  const bounds = collections.map(c => ({ c, rect: collectionBounds(c, displayed, geoms) }));
  const layer = <>{bounds.map(({ c, rect }) => {
    const dx = !c.nodeIds.length && emptyDelta?.id === c.id ? emptyDelta.dx : 0;
    const dy = !c.nodeIds.length && emptyDelta?.id === c.id ? emptyDelta.dy : 0;
    return <div key={c.id} data-collection-id={c.id} className={`collection-frame ${activeId === c.id ? "active" : ""}`}
      style={{ left: rect.x + dx, top: rect.y + dy, width: rect.w, height: rect.h }}>
      <svg className="collection-outline" width={rect.w} height={rect.h} onPointerDown={e => onPointerDown(e, c)} onDoubleClick={e => e.stopPropagation()}>
        {c.shape === "rectangle" ? <rect x="1" y="1" width={rect.w - 2} height={rect.h - 2} rx="3" />
          : <ellipse cx={rect.w / 2} cy={rect.h / 2} rx={rect.w / 2 - 1} ry={rect.h / 2 - 1} />}
      </svg>
      <button className="collection-label" title={c.description || "拖动标题可整体移动集合"} onPointerDown={e => onPointerDown(e, c)} onDoubleClick={e => e.stopPropagation()}>
        <strong>{c.name}</strong><span>{c.nodeIds.length} 张</span>{c.description && <small>{c.description}</small>}
      </button>
    </div>;
  })}</>;
  const entry = toolbarHost && createPortal(<div className="collection-entry" onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>

      <button disabled={readOnly || !!state.editingId || !selectedIds.length} onClick={create}>所选建集合</button>
      <select disabled={readOnly || !!state.editingId} aria-label="当前集合" value={active?.id ?? ""} onChange={e => setActiveId(e.target.value || null)}>
        <option value="">集合（{collections.length}）</option>{collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>, toolbarHost);
  const panel = <>{entry}{!readOnly && !state.editingId && active && <div className="collection-panel" onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <div className="collection-panel-row"><strong>集合 · {active.nodeIds.length} 张卡片</strong><button aria-label="关闭集合面板" onClick={() => setActiveId(null)}>×</button></div>
      <CollectionDetails key={active.id} collection={active} update={update} />
      <div className="collection-panel-row">
        <button onClick={() => dispatch({ type: "select", nodes: active.nodeIds, edges: [] })}>选择成员</button>
        <button disabled={!selectedIds.some(id => !active.nodeIds.includes(id))} onClick={() => update({ ...active, nodeIds: [...new Set([...active.nodeIds, ...selectedIds])] })}>加入所选</button>
        <button disabled={!selectedIds.some(id => active.nodeIds.includes(id))} onClick={() => update({ ...active, nodeIds: active.nodeIds.filter(id => !selectedIds.includes(id)) })}>移出所选</button>
      </div>
      <div className="collection-panel-row">
        <button disabled={!active.nodeIds.length} onClick={() => commit("集合水平中轴对齐", arrangeCollectionOps(active, nodes, geoms, "horizontal"))}>水平中轴对齐</button>
        <button disabled={!active.nodeIds.length} onClick={() => commit("集合垂直中轴对齐", arrangeCollectionOps(active, nodes, geoms, "vertical"))}>垂直中轴对齐</button>
        <button disabled={!active.nodeIds.length} onClick={() => commit("集合网格排版", arrangeCollectionOps(active, nodes, geoms, "grid"))}>网格排版</button>
      </div>
      <div className="collection-panel-row">
        <input type="number" aria-label="统一核心宽度" min="90" max="800" value={width} onChange={e => setWidth(Number(e.target.value))} />
        <button disabled={!active.nodeIds.length || !Number.isFinite(width) || width < 90 || width > 800} title="世界坐标宽度；保留比例与原有缩放上限，备注字号不变" onClick={() => commit("集合统一核心宽度", uniformCoreWidthOps(memberNodes(active, nodes), width))}>统一核心宽度</button>
        <button onClick={dissolve}>解散集合</button>
      </div>
      <p>成员可共享 · 拖动标题整体移动 · 解散保留卡片</p>
  </div>}</>;
  return { layer, panel, bounds: bounds.map(b => b.rect), clearActive: () => setActiveId(null),
    handleKey: (e: KeyboardEvent) => {
      if (!active || state.selection.nodes.length || state.selection.edges.length) return false;
      if (e.key === "Escape") { setActiveId(null); return true; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); dissolve(); return true; }
      return false;
    } };
}
