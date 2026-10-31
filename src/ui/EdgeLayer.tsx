import { useEffect, useMemo, useState } from "react";
import type { BoardEdge, BoardNode } from "../model";
import { visibleEdges } from "../model";

import { edgeGeometries } from "../model/edgeRouting";
export { edgeGeometry } from "../model/edgeRouting";
export type { EdgeGeom } from "../model/edgeRouting";
const EST_H = 120;

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
  const shownEdges = useMemo(() => visibleEdges(p.edges), [p.edges]);
  const geometries = useMemo(() => edgeGeometries(shownEdges, p.nodes, p.heights, p.widths), [shownEdges, p.nodes, p.heights, p.widths]);
  const editingEdge = p.editingLabelId ? p.edges.find((e) => e.id === p.editingLabelId) : null;
  const editingMid = editingEdge ? (geometries.get(editingEdge.id)?.mid ?? null) : null;

  return (
    <>
      <svg className="edge-layer">
        {shownEdges.map((e) => {
          const g = geometries.get(e.id);
          if (!g) return null;
          const isParent = e.kind === "parentChild";
          const isSel = selected.has(e.id);
          const cls = [
            "edge-path",
            isParent ? "edge-parent" : "edge-assoc",
            isSel ? "edge-selected" : "",
            e.stroke ? `edge-stroke-${e.stroke}` : '',
            e.stroke === 'flowing-dashed' && e.directed ? 'edge-flow-active' : '',
          ].join(" ");
          const head = g.arrow;
          return (
            <g key={e.id} data-edge-id={e.id} data-routing={e.routing ?? 'curve'}>
              <path className={cls} d={g.strokeD ?? g.d} />
              {head && <path className="edge-arrow" d={`M ${head.left.x} ${head.left.y} L ${head.tip.x} ${head.tip.y} L ${head.right.x} ${head.right.y}${isParent ? ' Z' : ''}`}
                fill={isParent ? 'currentColor' : 'none'} stroke={isParent ? 'none' : 'currentColor'} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"
                style={{color:isSel ? 'var(--edge-selected)' : isParent ? 'var(--edge-parent)' : 'var(--edge-assoc)'}} />}
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
