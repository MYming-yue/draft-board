import { collectionBounds } from "./collections";
import { visibleEdges } from "./association";
import type { BoardFile } from "./types";
import type { LayoutGeometry } from "./layout";
import { edgeGeometry, segmentTouchesRect } from "./edgeRouting";
type Rect = {
    x: number;
    y: number;
    w: number;
    h: number;
};
export interface LayoutConflict {
    kind: "card" | "edge" | "label" | "collection";
    nodeId: string;
    otherIds: string[];
}
const MARGIN = 10;
function touchesCollection(r: Rect, c: Rect, shape: string): boolean {
    if (shape === "rectangle")
        return r.x < c.x + c.w + MARGIN && r.x + r.w > c.x - MARGIN && r.y < c.y + c.h + MARGIN && r.y + r.h > c.y - MARGIN;
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    const nearX = Math.max(r.x, Math.min(cx, r.x + r.w));
    const nearY = Math.max(r.y, Math.min(cy, r.y + r.h));
    return ((nearX - cx) / (c.w / 2 + MARGIN)) ** 2 + ((nearY - cy) / (c.h / 2 + MARGIN)) ** 2 <= 1;
}
export function layoutConflicts(file: BoardFile, geometry: LayoutGeometry): LayoutConflict[] {
    const rects = new Map(file.nodes.map(n => [n.id, { x: n.x, y: n.y, w: geometry[n.id]?.w ?? n.w, h: geometry[n.id]?.h ?? n.h ?? 120 }]));
    const out: LayoutConflict[] = [];
    for (let i = 0; i < file.nodes.length; i++)
        for (let j = i + 1; j < file.nodes.length; j++) {
            const a = file.nodes[i], b = file.nodes[j], x = rects.get(a.id)!, y = rects.get(b.id)!;
            if (x.x < y.x + y.w + MARGIN && x.x + x.w + MARGIN > y.x && x.y < y.y + y.h + MARGIN && x.y + x.h + MARGIN > y.y)
                out.push({ kind: "card", nodeId: a.id, otherIds: [b.id] });
        }
    const heights = Object.fromEntries(Object.entries(geometry).map(([id, v]) => [id, v.h]));
    const widths = Object.fromEntries(Object.entries(geometry).map(([id, v]) => [id, v.w]));
    const shownEdges = visibleEdges(file.edges);
    for (const edge of shownEdges) {
        const routed = edgeGeometry(edge, file.nodes, heights, widths, shownEdges);
        if (!routed)
            continue;
        const points = routed.points;
        if (!points.length)
            continue;
        for (const n of file.nodes) {
            if (n.id === edge.from || n.id === edge.to)
                continue;
            const raw = rects.get(n.id)!;
            const r = { x: raw.x - MARGIN, y: raw.y - MARGIN, w: raw.w + 2 * MARGIN, h: raw.h + 2 * MARGIN };
            if (points.slice(1).some((p, i) => segmentTouchesRect(points[i], p, r)))
                out.push({ kind: "edge", nodeId: n.id, otherIds: [edge.from, edge.to] });
        }
        if (routed.labelBox)
            for (const n of file.nodes) {
                const r = rects.get(n.id)!, l = routed.labelBox;
                if (l.x < r.x + r.w && l.x + l.w > r.x && l.y < r.y + r.h && l.y + l.h > r.y)
                    out.push({ kind: "label", nodeId: n.id, otherIds: [edge.from, edge.to] });
            }
    }
    for (const collection of file.collections ?? []) {
        const bounds = collectionBounds(collection, file.nodes, geometry);
        for (const n of file.nodes) {
            if (collection.nodeIds.includes(n.id))
                continue;
            if (touchesCollection(rects.get(n.id)!, bounds, collection.shape))
                out.push({ kind: "collection", nodeId: n.id, otherIds: collection.nodeIds });
        }
    }
    return out;
}
