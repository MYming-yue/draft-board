import type { BoardEdge, Op } from "./types";

/** Reconnecting replaces the same directed association as one reversible step. */
export function connectAssociationOps(edges: readonly BoardEdge[], edge: BoardEdge): Op[] {
  const previous = edges.filter(e => e.kind === "association" && e.directed && e.from === edge.from && e.to === edge.to);
  return [
    ...previous.map(e => ({ op: "removeEdge" as const, edgeId: e.id, before: e, after: null })),
    { op: "addEdge", edge, before: null, after: edge },
  ];
}

/** Old files may contain duplicates: show the latest without rewriting their history. */
export function visibleEdges(edges: readonly BoardEdge[]): BoardEdge[] {
  const seen = new Set<string>();
  return [...edges].reverse().filter(e => {
    if (e.kind !== "association" || !e.directed) return true;
    const key = `${e.from}:${e.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).reverse();
}
