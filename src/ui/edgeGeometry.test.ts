import { expect, it } from "vitest";
import type { BoardEdge, BoardNode } from "../model";
import { edgeGeometry } from "./EdgeLayer";

it.each([[500, 0], [0, 500], [400, 300], [-400, 250]])("separates reciprocal arrows for offset %s,%s", (x,y) => {
  const nodes: BoardNode[] = [
    { id: "a", type: "text", markdown: "A", x: 0, y: 0, w: 160, h: 80 },
    { id: "b", type: "text", markdown: "B", x, y, w: 160, h: 80 },
  ];
  const a: BoardEdge = { id: "ab", kind: "association", from: "a", to: "b", directed: true };
  const b: BoardEdge = { ...a, id: "ba", from: "b", to: "a" };
  const ga = edgeGeometry(a, nodes, {}, {}, [a,b])!;
  const gb = edgeGeometry(b, nodes, {}, {}, [a,b])!;
  expect(Math.hypot(ga.mid.x - gb.mid.x, ga.mid.y - gb.mid.y)).toBeGreaterThan(40);
  expect(ga.d).toContain(" Q ");
  expect(edgeGeometry(a, nodes, {}, {}, [a])!.d).toContain(" C ");
  for (const [geometry,target] of [[ga,nodes[1]], [gb,nodes[0]]] as const) {
    const pt = geometry.toPt;
    expect(pt.x < target.x || pt.x > target.x + target.w || pt.y < target.y || pt.y > target.y + target.h!).toBe(true);
  }
});
