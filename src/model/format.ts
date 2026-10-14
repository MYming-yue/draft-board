import type { BoardFile } from "./types";

/** Never downgrade a format when newer features have been used, even on undo. */
export function promoteFormat(state: BoardFile, major: number) {
  if (Number(state.formatVersion.split('.')[0]) < major) state.formatVersion = `${major}.0`;
}
export function serializedFormat(state: BoardFile): string {
  const styled = state.nodes.some(n => n.shape && n.shape !== 'card') || state.edges.some(e => e.routing !== undefined || e.stroke !== undefined) ||
    state.history.some(s => s.ops.some(o => o.op === 'setNodeShape' || o.op === 'setEdgeStyle'));
  const needed = styled ? 3 : state.collections?.length ? 2 : 1;
  return Number(state.formatVersion.split('.')[0]) >= needed ? state.formatVersion : `${needed}.0`;
}
