// 契约 §3-B（B2）：复制一组卡片生成全新身份。
// 新节点 id 与旧集合交集为空；组内边端点映射到新 id；组外关联不复制；
// 返回的 ops 由调用方作为单个历史步骤提交（一次撤销移除全部新对象）。
import type { IdKind } from "./ids";
import type { BoardFile, Op } from "./types";

export function duplicateGroup(
  state: BoardFile,
  nodeIds: string[],
  genId: (kind: IdKind) => string,
  offset = { dx: 40, dy: 40 },
): Op[] {
  const set = new Set(nodeIds.filter((id) => state.nodes.some((n) => n.id === id)));
  if (set.size === 0) return [];
  const idMap = new Map<string, string>();
  for (const oldId of set) idMap.set(oldId, genId("node"));

  const ops: Op[] = [];
  for (const node of state.nodes) {
    if (!set.has(node.id)) continue;
    const copy = structuredClone(node);
    copy.id = idMap.get(node.id)!;
    copy.x += offset.dx;
    copy.y += offset.dy;
    ops.push({ op: "addNode", node: copy, before: null, after: structuredClone(copy) });
  }
  for (const edge of state.edges) {
    if (!set.has(edge.from) || !set.has(edge.to)) continue; // 组内边才复制
    const copy = structuredClone(edge);
    copy.id = genId("edge");
    copy.from = idMap.get(edge.from)!;
    copy.to = idMap.get(edge.to)!;
    ops.push({ op: "addEdge", edge: copy, before: null, after: structuredClone(copy) });
  }
  return ops;
}
