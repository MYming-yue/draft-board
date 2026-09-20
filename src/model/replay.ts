// 契约 §3-D / I6：回放 = 从空板顺序应用 history 全部步骤。
// 注：op 词汇表没有 addAsset（封闭枚举），assets 元数据不随步骤演化，
// 回放起点携带当前 assets[]，仅重建 nodes/edges 结构。
import { DraftError } from "./errors";
import { applyOps } from "./ops";
import type { BoardAsset, BoardEdge, BoardFile, BoardNode } from "./types";

export interface ReplayState {
  nodes: BoardNode[];
  edges: BoardEdge[];
  assets: BoardAsset[];
  contentVersion: number;
}

/** 从空板顺序应用前 stepSeq 步（缺省 = 全部）。任一步失败说明历史损坏，抛 DraftError。 */
export function replayTo(file: BoardFile, stepSeq?: number): ReplayState {
  const limit = stepSeq ?? file.history.length;
  let state: BoardFile = {
    ...structuredClone(file),
    nodes: [],
    edges: [],
    history: [],
    board: { ...structuredClone(file.board), contentVersion: 0 },
  };
  for (const step of file.history.slice(0, limit)) {
    const applied = applyOps(state, step.ops);
    if (!applied.ok)
      throw new DraftError("E_SCHEMA", `回放在步骤 seq=${step.seq} 失败：${applied.error.message}`);
    state = applied.state;
    state.board.contentVersion = step.result;
  }
  return {
    nodes: state.nodes,
    edges: state.edges,
    assets: state.assets,
    contentVersion: state.board.contentVersion,
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, (b as unknown[])[i]));
  }
  if (typeof a === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    return (
      ka.length === kb.length &&
      ka.every((k) =>
        deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
      )
    );
  }
  return false;
}

/** I6 断言：回放结果与当前保存状态内容一致（比较 nodes/edges/assets）。 */
export function contentEqual(a: ReplayState, b: Pick<BoardFile, "nodes" | "edges" | "assets">): boolean {
  return deepEqual(a.nodes, b.nodes) && deepEqual(a.edges, b.edges) && deepEqual(a.assets, b.assets);
}
