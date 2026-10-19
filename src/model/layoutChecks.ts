import { collectionBounds } from "./collections";
import { visibleEdges } from "./association";
import type { BoardFile } from "./types";
import type { LayoutGeometry } from "./layout";
import { edgeGeometry, segmentTouchesRect, type Point } from "./edgeRouting";
type Rect = {
    x: number;
    y: number;
    w: number;
    h: number;
};
export interface LayoutConflict {
    kind: "card" | "edge" | "label" | "collection" | "collection-overlap" | "edge-crossing" | "edge-overlap" | "label-overlap" | "edge-label";
    nodeId: string;
    otherIds: string[];
    edgeIds?: string[];
    collectionIds?: string[];
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
export function layoutConflicts(file: BoardFile, geometry: LayoutGeometry, labels?: Record<string, Rect>): LayoutConflict[] {
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
                out.push({ kind: "edge", nodeId: n.id, otherIds: [edge.from, edge.to], edgeIds: [edge.id] });
        }
        const label = labels?.[edge.id] ?? routed.labelBox;
        if (label)
            for (const n of file.nodes) {
                const r = rects.get(n.id)!, l = label;
                if (l.x < r.x + r.w && l.x + l.w > r.x && l.y < r.y + r.h && l.y + l.h > r.y)
                    out.push({ kind: "label", nodeId: n.id, otherIds: [edge.from, edge.to], edgeIds: [edge.id] });
            }
    }
    for (const collection of file.collections ?? []) {
        const bounds = collectionBounds(collection, file.nodes, geometry);
        for (const n of file.nodes) {
            if (collection.nodeIds.includes(n.id))
                continue;
            if (touchesCollection(rects.get(n.id)!, bounds, collection.shape))
                out.push({ kind: "collection", nodeId: n.id, otherIds: collection.nodeIds, collectionIds: [collection.id] });
        }
    }
    return out;
}

const overlaps = (a: Rect, b: Rect, gap = 0) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
function intersection(a: Point, b: Point, c: Point, d: Point): "edge-crossing" | "edge-overlap" | null {
    const cross = (p: Point, q: Point, r: Point) => (q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
    const ab = Math.hypot(b.x-a.x, b.y-a.y), cd = Math.hypot(d.x-c.x, d.y-c.y);
    if (ab < 1e-6 || cd < 1e-6) return null;
    const x = cross(a,b,c), y = cross(a,b,d), z = cross(c,d,a), w = cross(c,d,b);
    if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) {
        const axis = Math.abs(b.x-a.x) >= Math.abs(b.y-a.y) ? "x" : "y";
        return Math.min(Math.max(a[axis],b[axis]), Math.max(c[axis],d[axis])) - Math.max(Math.min(a[axis],b[axis]),Math.min(c[axis],d[axis])) > 1 ? "edge-overlap" : null;
    }
    return x*y < -1e-8 && z*w < -1e-8 ? "edge-crossing" : null;
}

/** Strict integration check; existing offline layout planning keeps its original contract. */
export function readabilityConflicts(file: BoardFile, geometry: LayoutGeometry, labels?: Record<string, Rect>): LayoutConflict[] {
    const out = layoutConflicts(file, geometry, labels);
    const collections = file.collections ?? [];
    for (let i=0;i<collections.length;i++) for (let j=i+1;j<collections.length;j++) {
        const a=collections[i], b=collections[j];
        // Shared membership is intentional model semantics, not inferred containment.
        if (a.nodeIds.some(id=>b.nodeIds.includes(id))) continue;
        if (overlaps(collectionBounds(a,file.nodes,geometry),collectionBounds(b,file.nodes,geometry),MARGIN))
            out.push({kind:"collection-overlap",nodeId:a.nodeIds[0] ?? a.id,otherIds:[...a.nodeIds.slice(1),...b.nodeIds],collectionIds:[a.id,b.id]});
    }
    const heights=Object.fromEntries(Object.entries(geometry).map(([id,g])=>[id,g.h]));
    const widths=Object.fromEntries(Object.entries(geometry).map(([id,g])=>[id,g.w]));
    const edges=visibleEdges(file.edges);
    const routed=edges.flatMap(e=>{const g=edgeGeometry(e,file.nodes,heights,widths,edges);return g ? [{e,g,label:labels?.[e.id] ?? g.labelBox}] : [];});
    for (let i=0;i<routed.length;i++) for (let j=i+1;j<routed.length;j++) {
        const a=routed[i],b=routed[j],common=[a.e.from,a.e.to].some(id=>id===b.e.from || id===b.e.to);
        const issue=(kind:LayoutConflict["kind"])=>out.push({kind,nodeId:a.e.from,otherIds:[a.e.to,b.e.from,b.e.to],edgeIds:[a.e.id,b.e.id]});
        if (a.label && b.label && overlaps(a.label,b.label,4)) issue("label-overlap");
        if ((a.label && b.g.points.slice(1).some((p,k)=>segmentTouchesRect(b.g.points[k],p,a.label!))) ||
            (b.label && a.g.points.slice(1).some((p,k)=>segmentTouchesRect(a.g.points[k],p,b.label!)))) issue("edge-label");
        // Common endpoints may deliberately share a flow trunk. Their labels still must be distinct.
        if (common) continue;
        let kind: "edge-crossing" | "edge-overlap" | null=null;
        for (let x=1;x<a.g.points.length && kind!=="edge-overlap";x++) for(let y=1;y<b.g.points.length;y++) {
            const hit=intersection(a.g.points[x-1],a.g.points[x],b.g.points[y-1],b.g.points[y]);
            if (hit) {kind=hit;if(hit==="edge-overlap")break;}
        }
        if(kind)issue(kind);
    }
    return out;
}
