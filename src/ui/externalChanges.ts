import { applyOps, type BoardFile, type HistoryStep } from "../model";

export function sameDraftContent(a: BoardFile, b: BoardFile): boolean {
  const content = (file: BoardFile) => ({ ...file, board: { ...file.board, view: null }, collections: file.collections ?? [] });
  return JSON.stringify(content(a)) === JSON.stringify(content(b));
}

export function sameDraftAssets(a: Record<string, Uint8Array>, b: Record<string, Uint8Array>): boolean {
  const ids = Object.keys(a);
  return ids.length === Object.keys(b).length && ids.every(id => {
    const left = a[id], right = b[id];
    if (!right || left.length !== right.length) return false;
    return left.every((byte, index) => byte === right[index]);
  });
}

export interface ExternalChanges {
  steps: Pick<HistoryStep, "seq" | "actor" | "label">[];
  nodes: string[];
  added: string[];
  updated: string[];
  removed: { id: string; title: string }[];
  edges: number;
  collections: number;
}

/** Only accept an append-only history that can reproduce the actual disk content. */
export function verifyExternalUpdate(base: BoardFile, next: BoardFile): ExternalChanges | null {
  if (sameDraftContent(base, next)) return null;
  if (base.board.id !== next.board.id) throw new Error("磁盘文件已换成另一张白板，当前画布保留。");
  const steps = next.history.slice(base.history.length);
  if (!steps.length || JSON.stringify(next.history.slice(0, base.history.length)) !== JSON.stringify(base.history)) {
    throw new Error("磁盘历史已分叉或被替换，当前画布保留。");
  }
  let expected = base;
  for (const step of steps) {
    if (step.seq !== expected.history.length + 1 || step.base !== expected.board.contentVersion || step.result !== step.base + 1) {
      throw new Error("外部更新的版本不连续，当前画布保留。");
    }
    const applied = applyOps(expected, step.ops);
    if (!applied.ok || JSON.stringify(applied.ops) !== JSON.stringify(step.ops)) {
      throw new Error("外部操作或撤销信息与原草稿不一致，当前画布保留。");
    }
    expected = { ...applied.state, board: { ...applied.state.board, contentVersion: step.result, updatedAt: step.at }, history: [...expected.history, step] };
  }
  if (!sameDraftContent(expected, next)) throw new Error("磁盘内容与追加历史不一致，当前画布保留。");

  const old = new Map(base.nodes.map(n => [n.id, n]));
  const current = new Set(next.nodes.map(n => n.id));
  const added = next.nodes.filter(n => !old.has(n.id)).map(n => n.id);
  const updated = next.nodes.filter(n => old.has(n.id) && JSON.stringify(n) !== JSON.stringify(old.get(n.id))).map(n => n.id);
  const removed = base.nodes.filter(n => !current.has(n.id)).map(n => ({ id: n.id, title: (n.type === "text" ? n.markdown ?? "" : "图片卡片").slice(0, 100) }));
  const nodes = new Set([...added, ...updated]);
  const changed = <T extends { id: string }>(before: T[], after: T[]) => {
    const all = new Set([...before, ...after].map(x => x.id));
    return [...all].filter(id => JSON.stringify(before.find(x => x.id === id)) !== JSON.stringify(after.find(x => x.id === id)));
  };
  const edges = changed(base.edges, next.edges);
  for (const edge of [...base.edges, ...next.edges].filter(e => edges.includes(e.id))) { nodes.add(edge.from); nodes.add(edge.to); }
  const collections = changed(base.collections ?? [], next.collections ?? []);
  for (const collection of [...base.collections ?? [], ...next.collections ?? []].filter(c => collections.includes(c.id))) collection.nodeIds.forEach(id => nodes.add(id));
  return { steps: steps.map(({ seq, actor, label }) => ({ seq, actor, label })), nodes: [...nodes].filter(id => current.has(id)), added, updated, removed, edges: edges.length, collections: collections.length };
}
