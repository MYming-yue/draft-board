import { collectionBounds, visibleEdges, type BoardFile, type LayoutGeometry, type Op } from "../model";
import { edgeGeometry } from "./EdgeLayer";

type Rect = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };
export interface LayoutConflict { kind: "card" | "edge" | "collection"; nodeId: string; otherIds: string[] }
const MARGIN = 10;
function segmentTouchesRect(a: Point, b: Point, r: Rect): boolean {
  // Liang–Barsky 裁剪，覆盖采样点之间的细卡片。
  let lo = 0, hi = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - r.x], [dx, r.x + r.w - a.x], [-dy, a.y - r.y], [dy, r.y + r.h - a.y]]) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
    if (lo > hi) return false;
  }
  return true;
}
function curvePoints(path: string): Point[] {
  const numbers = [...path.matchAll(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)].map(m => Number(m[0]));
  if (numbers.length !== 6 && numbers.length !== 8) return [];
  const [x0, y0] = numbers, x1 = numbers.at(-2)!, y1 = numbers.at(-1)!;
  return Array.from({ length: 25 }, (_, i) => {
    const t = i / 24, u = 1 - t;
    if (numbers.length === 6) return { x: u*u*x0 + 2*u*t*numbers[2] + t*t*x1, y: u*u*y0 + 2*u*t*numbers[3] + t*t*y1 };
    return { x: u*u*u*x0 + 3*u*u*t*numbers[2] + 3*u*t*t*numbers[4] + t*t*t*x1,
      y: u*u*u*y0 + 3*u*u*t*numbers[3] + 3*u*t*t*numbers[5] + t*t*t*y1 };
  });
}
function touchesCollection(r: Rect, c: Rect, shape: string): boolean {
  if (shape === "rectangle") return r.x < c.x + c.w + MARGIN && r.x + r.w > c.x - MARGIN && r.y < c.y + c.h + MARGIN && r.y + r.h > c.y - MARGIN;
  const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  const nearX = Math.max(r.x, Math.min(cx, r.x + r.w));
  const nearY = Math.max(r.y, Math.min(cy, r.y + r.h));
  return ((nearX - cx) / (c.w / 2 + MARGIN)) ** 2 + ((nearY - cy) / (c.h / 2 + MARGIN)) ** 2 <= 1;
}
export function layoutConflicts(file: BoardFile, geometry: LayoutGeometry): LayoutConflict[] {
  const rects = new Map(file.nodes.map(n => [n.id, { x: n.x, y: n.y, w: geometry[n.id]?.w ?? n.w, h: geometry[n.id]?.h ?? n.h ?? 120 }]));
  const out: LayoutConflict[] = [];
  for (let i = 0; i < file.nodes.length; i++) for (let j = i + 1; j < file.nodes.length; j++) {
    const a = file.nodes[i], b = file.nodes[j], x = rects.get(a.id)!, y = rects.get(b.id)!;
    if (x.x < y.x + y.w + MARGIN && x.x + x.w + MARGIN > y.x && x.y < y.y + y.h + MARGIN && x.y + x.h + MARGIN > y.y)
      out.push({ kind: "card", nodeId: a.id, otherIds: [b.id] });
  }
  const heights = Object.fromEntries(Object.entries(geometry).map(([id, v]) => [id, v.h]));
  const widths = Object.fromEntries(Object.entries(geometry).map(([id, v]) => [id, v.w]));
  const shownEdges = visibleEdges(file.edges);
  for (const edge of shownEdges) {
    const path = edgeGeometry(edge, file.nodes, heights, widths, shownEdges)?.d;
    if (!path) continue;
    const points = curvePoints(path);
    if (!points.length) continue;
    for (const n of file.nodes) {
      if (n.id === edge.from || n.id === edge.to) continue;
      const raw = rects.get(n.id)!;
      const r = { x: raw.x - MARGIN, y: raw.y - MARGIN, w: raw.w + 2*MARGIN, h: raw.h + 2*MARGIN };
      if (points.slice(1).some((p, i) => segmentTouchesRect(points[i], p, r)))
        out.push({ kind: "edge", nodeId: n.id, otherIds: [edge.from, edge.to] });
    }
  }
  for (const collection of file.collections ?? []) {
    const bounds = collectionBounds(collection, file.nodes, geometry);
    for (const n of file.nodes) {
      if (collection.nodeIds.includes(n.id)) continue;
      if (touchesCollection(rects.get(n.id)!, bounds, collection.shape))
        out.push({ kind: "collection", nodeId: n.id, otherIds: collection.nodeIds });
    }
  }
  return out;
}
function outline(file: BoardFile, geometry: LayoutGeometry): { w: number; h: number } {
  const rects = file.nodes.map(n => ({ x: n.x, y: n.y, w: geometry[n.id]?.w ?? n.w, h: geometry[n.id]?.h ?? n.h ?? 120 }));
  rects.push(...(file.collections ?? []).map(c => collectionBounds(c, file.nodes, geometry)));
  const x0 = Math.min(...rects.map(r => r.x)), y0 = Math.min(...rects.map(r => r.y));
  return { w: Math.max(...rects.map(r => r.x + r.w)) - x0, h: Math.max(...rects.map(r => r.y + r.h)) - y0 };
}
function withPositions(file: BoardFile, positions: Map<string, { x: number; y: number }>): BoardFile {
  return { ...file, nodes: file.nodes.map(n => ({ ...n, ...(positions.get(n.id) ?? {}) })) };
}
export function avoidLayoutConflicts(file: BoardFile, base: Op[], geometry: LayoutGeometry, movable: Set<string>, aspectRatio?: number): { ops: Op[]; conflicts: LayoutConflict[] } {
  const positions = new Map(file.nodes.map(n => [n.id, { x: n.x, y: n.y }]));
  for (const op of base) if (op.op === "moveNode") positions.set(op.nodeId, op.after);
  const state = () => withPositions(file, positions);
  let issues = layoutConflicts(state(), geometry).filter(c => movable.has(c.nodeId) || c.otherIds.some(id => movable.has(id)));
  const directions = [[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
  const seen = new Set<string>();
  for (let pass = 0; issues.length && pass < movable.size * 3; pass++) {
    const signature = JSON.stringify([...positions]);
    if (seen.has(signature)) break;
    seen.add(signature);
    let best: { ids: string[]; dx: number; dy: number; issues: LayoutConflict[]; cost: number; score: number } | null = null;
    const reference = outline(state(), geometry);
    for (const issue of issues) {
      const candidates: string[][] = [];
      if (movable.has(issue.nodeId)) candidates.push([issue.nodeId]);
      for (const id of issue.otherIds) if (movable.has(id)) candidates.push([id]);
      if (issue.kind === "collection" && issue.otherIds.length && issue.otherIds.every(id => movable.has(id))) candidates.push(issue.otherIds);
      for (const ids of candidates) {
        const original = ids.map(id => positions.get(id)!);
        const stepX = Math.max(...ids.map(id => geometry[id]?.w ?? 120)) + 32;
        const stepY = Math.max(...ids.map(id => geometry[id]?.h ?? 120)) + 32;
        for (let radius = 1; radius <= 12; radius++) for (const [vx, vy] of directions) {
          const dx = Math.round(vx * radius * stepX), dy = Math.round(vy * radius * stepY);
          ids.forEach((id, i) => positions.set(id, { x: original[i].x + dx, y: original[i].y + dy }));
          const candidate = state();
          const next = layoutConflicts(candidate, geometry).filter(c => movable.has(c.nodeId) || c.otherIds.some(id => movable.has(id)));
          const cost = Math.hypot(dx, dy);
          const bounds = aspectRatio && aspectRatio > 0 ? outline(candidate, geometry) : null;
          const score = bounds
            ? Math.abs(Math.log((bounds.w / bounds.h) / aspectRatio!)) + 0.3 * (bounds.w * bounds.h / (reference.w * reference.h)) + 0.08 * cost / Math.max(reference.w, reference.h)
            : cost;
          ids.forEach((id, i) => positions.set(id, original[i]));
          if (next.length < issues.length && (!best || next.length < best.issues.length || (next.length === best.issues.length && (score < best.score || (score === best.score && cost < best.cost)))))
            best = { ids, dx, dy, issues: next, cost, score };
        }
      }
    }
    if (!best) break;
    for (const id of best.ids) {
      const p = positions.get(id)!;
      positions.set(id, { x: p.x + best.dx, y: p.y + best.dy });
    }
    issues = best.issues;
  }
  // 全板整理的避让可能整体向左/上平移；恢复到整理前锚点，避免下一次以新极值为起点逐次漂移。
  if (movable.size === file.nodes.length && file.nodes.length > 0 && !issues.length) {
    const currentX = Math.min(...file.nodes.map(n => positions.get(n.id)!.x));
    const currentY = Math.min(...file.nodes.map(n => positions.get(n.id)!.y));
    const originalX = Math.min(...file.nodes.map(n => n.x));
    const originalY = Math.min(...file.nodes.map(n => n.y));
    const dx = originalX - currentX, dy = originalY - currentY;
    if (dx || dy) {
      for (const id of movable) {
        const p = positions.get(id)!;
        positions.set(id, { x: p.x + dx, y: p.y + dy });
      }
      const shifted = layoutConflicts(state(), geometry);
      if (shifted.length) for (const id of movable) {
        const p = positions.get(id)!;
        positions.set(id, { x: p.x - dx, y: p.y - dy });
      }
    }
  }
  const ops: Op[] = [...movable].flatMap(id => {
    const p = positions.get(id)!, n = file.nodes.find(n => n.id === id)!;
    return p.x === n.x && p.y === n.y ? [] : [{ op: "moveNode", nodeId: id, before: { x: n.x, y: n.y }, after: p }];
  });
  return { ops, conflicts: issues };
}
export function layoutMovableIds(file: BoardFile, roots: string[]): Set<string> {
  const selected = new Set<string>();
  const pending = [...roots];
  while (pending.length) {
    const id = pending.pop()!;
    if (selected.has(id)) continue;
    selected.add(id);
    for (const edge of file.edges) if (edge.kind === "parentChild" && edge.from === id) pending.push(edge.to);
  }
  return selected;
}
