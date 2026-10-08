import type { BoardCollection, BoardNode, Op } from "./types";

export interface CollectionRect { x: number; y: number; w: number; h: number }
export type CollectionGeometry = Record<string, { w: number; h: number }>;
export function memberNodes(collection: BoardCollection, nodes: BoardNode[]): BoardNode[] {
  const ids = new Set(collection.nodeIds);
  return nodes.filter(n => ids.has(n.id));
}
export function collectionBounds(collection: BoardCollection, nodes: BoardNode[], geoms: CollectionGeometry): CollectionRect {
  const members = memberNodes(collection, nodes);
  if (!members.length) return { x: collection.x, y: collection.y, w: 240, h: collection.shape === "circle" ? 240 : 160 };
  const left = Math.min(...members.map(n => n.x));
  const top = Math.min(...members.map(n => n.y));
  const right = Math.max(...members.map(n => n.x + (geoms[n.id]?.w ?? n.w)));
  const bottom = Math.max(...members.map(n => n.y + (geoms[n.id]?.h ?? n.h ?? 120)));
  // 根号 2 扩展使矩形四角也落在椭圆内部；圆形用包围框对角线作直径。
  let w = right - left + 80, h = bottom - top + 100;
  if (collection.shape === "ellipse") { w *= Math.SQRT2; h *= Math.SQRT2; }
  if (collection.shape === "circle") w = h = Math.hypot(w, h);
  return { x: (left + right - w) / 2, y: (top + bottom - h) / 2, w, h };
}
export function arrangeCollectionOps(collection: BoardCollection, nodes: BoardNode[], geoms: CollectionGeometry, mode: "horizontal" | "vertical" | "grid"): Op[] {
  const members = memberNodes(collection, nodes).sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  if (!members.length) return [];
  const size = (n: BoardNode) => ({ w: geoms[n.id]?.w ?? n.w, h: geoms[n.id]?.h ?? n.h ?? 120 });
  const x0 = Math.min(...members.map(n => n.x)), y0 = Math.min(...members.map(n => n.y));
  const maxW = Math.max(...members.map(n => size(n).w)), maxH = Math.max(...members.map(n => size(n).h));
  const right = Math.max(...members.map(n => n.x + size(n).w));
  const bottom = Math.max(...members.map(n => n.y + size(n).h));
  const cols = Math.ceil(Math.sqrt(members.length));
  return members.flatMap((n, i): Op[] => {
    let x = n.x, y = n.y;
    if (mode === "horizontal") y = (y0 + bottom - size(n).h) / 2;
    if (mode === "vertical") x = (x0 + right - size(n).w) / 2;
    if (mode === "grid") {
      x = x0 + (i % cols) * (maxW + 48) + (maxW - size(n).w) / 2;
      y = y0 + Math.floor(i / cols) * (maxH + 48);
    }
    return x === n.x && y === n.y ? [] : [{ op: "moveNode", nodeId: n.id, before: null, after: { x, y } }];
  });
}
