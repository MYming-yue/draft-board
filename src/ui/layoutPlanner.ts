import { collectionBounds, forestRoots, layoutBranchOps, type BoardFile, type LayoutGeometry, type Op } from "../model";
import { avoidLayoutConflicts, layoutConflicts, layoutMovableIds } from "./layoutConstraints";

export type TidyPlan = { ok: true; ops: Op[]; outcome: "changed" | "already-tidy" | "unresolved" } | { ok: false; reason: "conflicts" };

function aspectOf(file: BoardFile, geometry: LayoutGeometry): number {
  const rects = [
    ...file.nodes.map(n => ({ x: n.x, y: n.y, w: geometry[n.id]?.w ?? n.w, h: geometry[n.id]?.h ?? n.h ?? 120 })),
    ...(file.collections ?? []).map(c => collectionBounds(c, file.nodes, geometry)),
  ];
  const width = Math.max(...rects.map(r => r.x + r.w)) - Math.min(...rects.map(r => r.x));
  const height = Math.max(...rects.map(r => r.y + r.h)) - Math.min(...rects.map(r => r.y));
  return width / height;
}

/** 保留每轮已验证无冲突的结果；后续重排失败不能抹掉可用布局。 */
export function planTidyLayout(file: BoardFile, selectedIds: string[], geometry: LayoutGeometry, aspectRatio: number): TidyPlan {
  const roots = selectedIds.length ? selectedIds : forestRoots(file);
  const movable = layoutMovableIds(file, roots);
  let virtual = file;
  const seen = new Set<string>();
  for (let pass = 0; pass < 8; pass++) {
    const signature = JSON.stringify(virtual.nodes.map(n => [n.id, n.x, n.y]));
    if (seen.has(signature)) break;
    seen.add(signature);
    const base = layoutBranchOps(virtual, roots, geometry, { aspectRatio });
    const planned = avoidLayoutConflicts(virtual, base, geometry, movable, aspectRatio);
    if (planned.conflicts.length) {
      if (pass > 0) break;
      const currentConflicts = layoutConflicts(virtual, geometry).filter(c => movable.has(c.nodeId) || c.otherIds.some(id => movable.has(id)));
      if (!currentConflicts.length) {
        const currentAspect = aspectOf(virtual, geometry);
        const closeToViewport = Number.isFinite(currentAspect) && Math.abs(Math.log(currentAspect / aspectRatio)) < 0.3;
        return { ok: true, ops: [], outcome: closeToViewport ? "already-tidy" : "unresolved" };
      }
      return { ok: false, reason: "conflicts" };
    }
    if (!planned.ops.length) break;
    const positions = new Map(planned.ops.filter(op => op.op === "moveNode").map(op => [op.nodeId, op.after]));
    virtual = { ...virtual, nodes: virtual.nodes.map(n => ({ ...n, ...(positions.get(n.id) ?? {}) })) };
  }
  const ops: Op[] = file.nodes.flatMap(n => {
    const after = virtual.nodes.find(v => v.id === n.id)!;
    return n.x === after.x && n.y === after.y ? [] : [{ op: "moveNode", nodeId: n.id, before: { x: n.x, y: n.y }, after: { x: after.x, y: after.y } }];
  });
  return { ok: true, ops, outcome: ops.length ? "changed" : "already-tidy" };
}
