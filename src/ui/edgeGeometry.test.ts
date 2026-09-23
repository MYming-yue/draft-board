import { expect, it } from "vitest";
import type { BoardEdge, BoardNode } from "../model";
import { edgeGeometry } from "./EdgeLayer";

it.each(["association", "parentChild"] as const)("%s：宽卡片上下短间距、横向错位时控制点不回折", kind => {
  const nodes: BoardNode[] = [
    { id: "a", type: "text", markdown: "A", x: 0, y: 0, w: 1000, h: 80 },
    { id: "b", type: "text", markdown: "B", x: 400, y: 90, w: 1000, h: 80 },
  ];
  const g = edgeGeometry({ id: "ab", kind, from: "a", to: "b", directed: true }, nodes, {})!;
  const [, y0, , y1, , y2, , y3] = g.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  expect(y1).toBeGreaterThanOrEqual(y0);
  expect(y2).toBeGreaterThanOrEqual(y1);
  expect(y3).toBeGreaterThanOrEqual(y2);
});

it.each([150, -150, 90, -90])("纵向单线从上下边竖直进出且不回折：%s", y => {
  const nodes: BoardNode[] = [
    { id: "a", type: "text", markdown: "A", x: 0, y: 0, w: 400, h: 80 },
    { id: "b", type: "text", markdown: "B", x: 0, y, w: 400, h: 80 },
  ];
  const e: BoardEdge = { id: "ab", kind: "association", from: "a", to: "b", directed: true };
  const g = edgeGeometry(e, nodes, {})!;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = g.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  expect([x0, x1, x2, x3]).toEqual([200, 200, 200, 200]);
  for (const value of [y1, y2]) {
    expect(value).toBeGreaterThanOrEqual(Math.min(y0, y3));
    expect(value).toBeLessThanOrEqual(Math.max(y0, y3));
  }
});

it("不同实测宽高的错位卡片按各自边框法线连接", () => {
  const nodes: BoardNode[] = [
    { id: "a", type: "text", markdown: "A", x: 0, y: 0, w: 100, h: 80 },
    { id: "b", type: "text", markdown: "B", x: 40, y: 200, w: 100, h: 80 },
  ];
  const g = edgeGeometry({ id: "ab", kind: "parentChild", from: "a", to: "b", directed: true }, nodes, { a: 60, b: 100 }, { a: 400, b: 350 })!;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = g.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  expect(x0).toBe(x1);
  expect(x2).toBe(x3);
  expect(y1).toBeGreaterThan(y0);
  expect(y2).toBeLessThan(y3);
});

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
