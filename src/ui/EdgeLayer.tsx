import { useEffect, useState } from "react";
import type { BoardEdge, BoardNode } from "../model";
import { visibleEdges } from "../model";

const EST_H = 120;

export interface EdgeGeom {
  fromPt: { x: number; y: number };
  toPt: { x: number; y: number };
  mid: { x: number; y: number };
  d: string;
}

function rectOf(n: BoardNode, heights: Record<string, number>, widths?: Record<string, number>) {
  // 实测外框优先，纯公式卡贴合后可能比旧存档 w/h 更小。
  const h = heights[n.id] ?? n.h ?? EST_H;
  const w = widths?.[n.id] ?? n.w;
  return { x: n.x, y: n.y, w, h, cx: n.x + w / 2, cy: n.y + h / 2 };
}

/** 中心到中心连线与卡片矩形边界的交点（向外再推 pad 像素，箭头锚在卡片边框外侧）。 */
function borderPoint(r: ReturnType<typeof rectOf>, toward: { x: number; y: number }, pad: number) {
  const dx = toward.x - r.cx;
  const dy = toward.y - r.cy;
  if (dx === 0 && dy === 0) return { x: r.cx, y: r.cy };
  const scaleX = dx !== 0 ? (r.w / 2 + pad) / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? (r.h / 2 + pad) / Math.abs(dy) : Infinity;
  const s = Math.min(scaleX, scaleY);
  return { x: r.cx + dx * s, y: r.cy + dy * s };
}

export function edgeGeometry(
  e: BoardEdge,
  nodes: BoardNode[],
  heights: Record<string, number>,
  widths?: Record<string, number>,
  edges: readonly BoardEdge[] = [],
): EdgeGeom | null {
  const from = nodes.find((n) => n.id === e.from);
  const to = nodes.find((n) => n.id === e.to);
  if (!from || !to) return null;
  const rf = rectOf(from, heights, widths);
  const rt = rectOf(to, heights, widths);
  const reciprocal = e.kind === "association" && e.directed && edges.some(other =>
    other.kind === "association" && other.directed && other.from === e.to && other.to === e.from);
  if (reciprocal) {
    // Both directions bend to their own left, so the two curves occupy opposite sides.
    const vx = rt.cx - rf.cx;
    const vy = rt.cy - rf.cy;
    const length = Math.hypot(vx, vy);
    const nx = length ? -vy / length : 0;
    const ny = length ? vx / length : (e.from < e.to ? 1 : -1);
    const bend = Math.min(96, Math.max(48, length * 0.18));
    const control = { x: (rf.cx + rt.cx) / 2 + nx * bend, y: (rf.cy + rt.cy) / 2 + ny * bend };
    const fromPt = borderPoint(rf, control, 2);
    const toPt = borderPoint(rt, control, 6);
    return {
      fromPt, toPt,
      mid: { x: (fromPt.x + 2 * control.x + toPt.x) / 4, y: (fromPt.y + 2 * control.y + toPt.y) / 4 },
      d: `M ${fromPt.x} ${fromPt.y} Q ${control.x} ${control.y}, ${toPt.x} ${toPt.y}`,
    };
  }
  // 边框到边框：源端 +2、目标端 +6（箭头头部完整落在目标卡外侧，任何角度可见）
  const fromPt = borderPoint(rf, { x: rt.cx, y: rt.cy }, 2);
  const toPt = borderPoint(rt, { x: rf.cx, y: rf.cy }, 6);
  const dx = Math.max(48, Math.abs(toPt.x - fromPt.x) / 2);
  const dir = toPt.x >= fromPt.x ? 1 : -1;
  const c1 = { x: fromPt.x + dx * dir, y: fromPt.y };
  const c2 = { x: toPt.x - dx * dir, y: toPt.y };
  const d = `M ${fromPt.x} ${fromPt.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${toPt.x} ${toPt.y}`;
  // 三次贝塞尔 t=0.5 中点
  const mid = {
    x: (fromPt.x + 3 * c1.x + 3 * c2.x + toPt.x) / 8,
    y: (fromPt.y + 3 * c1.y + 3 * c2.y + toPt.y) / 8,
  };
  return { fromPt, toPt, mid, d };
}

interface EdgeLayerProps {
  nodes: BoardNode[];
  edges: BoardEdge[];
  heights: Record<string, number>;
  widths?: Record<string, number>;
  selectedEdgeIds: string[];
  connect: { sourceId: string; cursor: { x: number; y: number } } | null;
  editingLabelId: string | null;
  readOnly: boolean;
  onSelectEdge: (e: React.PointerEvent, edgeId: string) => void;
  onLabelDoubleClick: (edgeId: string) => void;
  onCommitLabel: (edgeId: string, label: string) => void;
  onCancelLabel: () => void;
}

export function EdgeLayer(p: EdgeLayerProps) {
  const [labelDraft, setLabelDraft] = useState("");
  useEffect(() => {
    if (p.editingLabelId) {
      const e = p.edges.find((x) => x.id === p.editingLabelId);
      setLabelDraft(e?.label ?? "");
    }
  }, [p.editingLabelId, p.edges]);

  const selected = new Set(p.selectedEdgeIds);
  const shownEdges = visibleEdges(p.edges);
  const editingEdge = p.editingLabelId ? p.edges.find((e) => e.id === p.editingLabelId) : null;
  const editingMid = editingEdge ? (edgeGeometry(editingEdge, p.nodes, p.heights, p.widths, shownEdges)?.mid ?? null) : null;

  return (
    <>
      <svg className="edge-layer">
        <defs>
          <marker id="arrow-assoc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="var(--edge-assoc)" strokeWidth="1.6" />
          </marker>
          <marker id="arrow-parent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge-parent)" />
          </marker>
          <marker id="arrow-assoc-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="var(--edge-selected)" strokeWidth="1.8" />
          </marker>
          <marker id="arrow-parent-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge-selected)" />
          </marker>
        </defs>
        {shownEdges.map((e) => {
          const g = edgeGeometry(e, p.nodes, p.heights, p.widths, shownEdges);
          if (!g) return null;
          const isParent = e.kind === "parentChild";
          const isSel = selected.has(e.id);
          const cls = [
            "edge-path",
            isParent ? "edge-parent" : "edge-assoc",
            isSel ? "edge-selected" : "",
          ].join(" ");
          const marker = isSel
            ? isParent
              ? "url(#arrow-parent-sel)"
              : "url(#arrow-assoc-sel)"
            : isParent
              ? "url(#arrow-parent)"
              : "url(#arrow-assoc)";
          return (
            <g key={e.id} data-edge-id={e.id}>
              <path className={cls} d={g.d} markerEnd={e.directed ? marker : undefined} />
              {!p.readOnly && (
                <path className="edge-hit" d={g.d} onPointerDown={(ev) => p.onSelectEdge(ev, e.id)} />
              )}
              {(e.label || (isSel && !isParent)) && p.editingLabelId !== e.id && (
                <text
                  className={"edge-label" + (e.label ? "" : " edge-label-empty")}
                  x={g.mid.x}
                  y={g.mid.y - 6}
                  onPointerDown={(ev) => p.onSelectEdge(ev, e.id)}
                  onDoubleClick={() => !p.readOnly && p.onLabelDoubleClick(e.id)}
                >
                  {e.label || "双击添加说明"}
                </text>
              )}
            </g>
          );
        })}
        {(() => {
          const conn = p.connect;
          if (!conn) return null;
          const src = p.nodes.find((n) => n.id === conn.sourceId);
          if (!src) return null;
          const h = p.heights[src.id] ?? src.h ?? EST_H;
          const w = p.widths?.[src.id] ?? src.w;
          const sx = src.x + w / 2;
          const sy = src.y + h / 2;
          return <line className="edge-temp" x1={sx} y1={sy} x2={conn.cursor.x} y2={conn.cursor.y} />;
        })()}
      </svg>
      {editingMid && p.editingLabelId && (
        <input
          className="edge-label-input"
          style={{ left: editingMid.x, top: editingMid.y - 14 }}
          value={labelDraft}
          ref={(el) => el?.focus({ preventScroll: true })}
          placeholder="关系说明（推出/支持/依赖…）"
          onChange={(e) => setLabelDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") p.onCommitLabel(p.editingLabelId!, labelDraft.trim());
            if (e.key === "Escape") p.onCancelLabel();
            e.stopPropagation();
          }}
          onBlur={() => p.onCommitLabel(p.editingLabelId!, labelDraft.trim())}
          onPointerDown={(e) => e.stopPropagation()}
        />
      )}
    </>
  );
}
