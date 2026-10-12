import { collectionBounds, type BoardFile, type LayoutGeometry, type Op } from "../model";
import { layoutConflicts, type LayoutConflict } from "../model/layoutChecks";
export { layoutConflicts } from "../model/layoutChecks";
export type { LayoutConflict } from "../model/layoutChecks";

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
