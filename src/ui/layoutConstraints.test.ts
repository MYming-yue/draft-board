import { describe, expect, it } from "vitest";
import { applyOps, createEmptyBoard, type BoardFile, type BoardNode, type LayoutGeometry } from "../model";
import { avoidLayoutConflicts, layoutConflicts } from "./layoutConstraints";

const card = (id: string, x: number, y: number): BoardNode => ({ id, type: "text", markdown: id, x, y, w: 100, h: 70 });
const geometry: LayoutGeometry = { n_line01: { w: 100, h: 70 }, n_line02: { w: 100, h: 70 }, n_line03: { w: 100, h: 70 } };
const board = (nodes: BoardNode[]): BoardFile => ({ ...createEmptyBoard(), nodes });

function resolved(file: BoardFile, movable: string[]) {
  const result = avoidLayoutConflicts(file, [], geometry, new Set(movable));
  expect(result.conflicts).toEqual([]);
  const applied = applyOps(file, result.ops);
  if (!applied.ok) throw new Error(applied.error.message);
  expect(layoutConflicts(applied.state, geometry)).toEqual([]);
  return applied.state;
}

describe("布局几何避让", () => {
  it("无关卡片避开可见关系线，端点不算冲突", () => {
    const a = card("n_line01", 0, 0), b = card("n_line02", 400, 0), c = card("n_line03", 200, 0);
    const file = { ...board([a, b, c]), edges: [{ id: "e_line01", kind: "association" as const, from: a.id, to: b.id, directed: true }] };
    expect(layoutConflicts(file, geometry).some(c => c.kind === "edge" && c.nodeId === "n_line03")).toBe(true);
    const out = resolved(file, [c.id]);
    expect(out.nodes[0]).toEqual(a);
    expect(out.nodes[1]).toEqual(b);
    expect(out.nodes[2].y).not.toBe(c.y);
  });
  for (const shape of ["rectangle", "ellipse", "circle"] as const) {
    it(`${shape} 集合与外部卡片留出边界`, () => {
      const a = card("n_line01", 0, 0), b = card("n_line02", 120, 0), c = card("n_line03", 250, 0);
      const file = { ...board([a, b, c]), collections: [{ id: "g_line01", name: "集合", shape, nodeIds: [a.id, b.id], x: 0, y: 0 }] };
      expect(layoutConflicts(file, geometry).some(i => i.kind === "collection")).toBe(true);
      const out = resolved(file, [c.id]);
      expect(out.nodes.slice(0, 2)).toEqual([a, b]);
      expect(out.nodes[2]).not.toEqual(c);
    });
  }
  it("无法移动冲突双方时如实返回未解决冲突", () => {
    const a = card("n_line01", 0, 0), b = card("n_line02", 50, 0);
    const file = board([a, b]);
    expect(avoidLayoutConflicts(file, [], geometry, new Set()).conflicts).toEqual([]);
    expect(layoutConflicts(file, geometry)).toHaveLength(1);
  });
});
