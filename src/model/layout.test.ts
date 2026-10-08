import { describe, it, expect } from "vitest";
import { createEmptyBoard, layoutBranchOps, forestRoots, applyOps, commitStep, undo, type BoardFile, type BoardNode, type LayoutGeometry } from "./index";
const node = (i: number, x = 0, y = 0): BoardNode => ({ id: `n_layout${i}`, type: "text", markdown: "卡片", x, y, w: 40 });
const tree = (nodes: BoardNode[], pairs: [number, number][] = []): BoardFile => ({ ...createEmptyBoard(), nodes,
  edges: pairs.map(([a, b], i) => ({ id: `e_layout${i}`, kind: "parentChild", from: nodes[a].id, to: nodes[b].id, directed: true })) });
function arranged(s: BoardFile, g: LayoutGeometry = {}, roots = forestRoots(s)) {
  const r = applyOps(s, layoutBranchOps(s, roots, g));
  if (!r.ok) throw new Error(r.error.message);
  return r.state;
}
function noOverlap(s: BoardFile, g: LayoutGeometry = {}) {
  for (let i = 0; i < s.nodes.length; i++) for (let j = i + 1; j < s.nodes.length; j++) {
    const a = s.nodes[i], b = s.nodes[j];
    const aw = g[a.id]?.w ?? a.w, ah = g[a.id]?.h ?? a.h ?? 120;
    const bw = g[b.id]?.w ?? b.w, bh = g[b.id]?.h ?? b.h ?? 120;
    expect(a.x + aw <= b.x || b.x + bw <= a.x || a.y + ah <= b.y || b.y + bh <= a.y,
      `${a.id} 和 ${b.id} 重叠`).toBe(true);
  }
}
describe("布局整理防重叠", () => {
  it("独立卡片不再挤到同一 Y，忽略选择和存储顺序，重复点击稳定", () => {
    const s = tree([node(1, 10, 320), node(2, 10, 50), node(3, 10, 90)]);
    const out = arranged(s); noOverlap(out);
    expect([...out.nodes].sort((a, b) => a.y - b.y || a.x - b.x).map(n => n.id)).toEqual([s.nodes[1].id, s.nodes[2].id, s.nodes[0].id]);
    expect(layoutBranchOps(out, forestRoots(out))).toEqual([]);
  });
  it("宽备注与高图片的实测外框优先，兄弟顺序跟随视觉位置", () => {
    const s = tree([node(1, 0, 150), node(2, 50, 300), node(3, 50, 10), node(4, 80, 100)], [[0, 1], [0, 2], [2, 3]]);
    const g = Object.fromEntries(s.nodes.map((n, i) => [n.id, { w: [520.3, 120, 240, 310][i], h: [85, 670.2, 180, 420][i] }]));
    const out = arranged(s, g); noOverlap(out, g);
    expect(out.nodes[2].y).toBeLessThan(out.nodes[1].y);
    expect(out.nodes[2].x - out.nodes[0].x).toBeGreaterThanOrEqual(556);
    expect(out.nodes[0].x).toBe(s.nodes[0].x);
    expect(layoutBranchOps(out, forestRoots(out), g)).toEqual([]);
    expect(out.edges).toEqual(s.edges);
  });
  it("局部整理整树避让外部障碍，不改变未选中的卡片", () => {
    const s = tree([node(1, 0, 0), node(2, 100, 0), node(3, 80, 0), node(4, 80, 200)], [[0, 1]]);
    const g = Object.fromEntries(s.nodes.map(n => [n.id, { w: 100, h: 130 }]));
    const out = arranged(s, g, [s.nodes[0].id]); noOverlap(out, g);
    expect(out.nodes.slice(2)).toEqual(s.nodes.slice(2));
    expect(out.nodes[0].y).toBeGreaterThanOrEqual(346);
    expect(layoutBranchOps(out, [s.nodes[0].id], g)).toEqual([]);
  });
  it("超过 60 个连续障碍仍避让，选择祖先/后代/重复 ID 只移动一次，可整体撤销", () => {
    const s = tree([node(1), node(2, 200), ...Array.from({ length: 85 }, (_, i) => node(i + 3, 90, i * 160))], [[0, 1]]);
    const ids = [s.nodes[0].id, s.nodes[1].id, s.nodes[0].id, "n_missing"];
    const ops = layoutBranchOps(s, ids);
    expect(new Set(ops.map(o => o.op === "moveNode" ? o.nodeId : "")).size).toBe(ops.length);
    const result = commitStep(s, "整理", "user", ops);
    if (!result.ok) throw new Error(result.error.message);
    noOverlap(result.state);
    expect(undo(result.state, result.state.history.length)?.state.nodes).toEqual(s.nodes);
    expect(result.state.history).toHaveLength(1);
  });
  it("12 张独立卡片紧凑分行，占地不会变成长条", () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({ ...node(i + 50, (i % 4) * 230, Math.floor(i / 4) * 110), w: 200, h: 80 }));
    const out = arranged(tree(nodes)); noOverlap(out);
    const width = Math.max(...out.nodes.map(n => n.x + n.w)) - Math.min(...out.nodes.map(n => n.x));
    const height = Math.max(...out.nodes.map(n => n.y + (n.h ?? 0))) - Math.min(...out.nodes.map(n => n.y));
    expect(width).toBeLessThanOrEqual(920);
    expect(height).toBeLessThanOrEqual(420);
    expect(width * height).toBeLessThan(920 * 420);
    expect(layoutBranchOps(out, forestRoots(out))).toEqual([]);
  });
  it("按窗口宽高比选择分行，横屏更宽、竖屏更高", () => {
    const s = tree(Array.from({ length: 12 }, (_, i) => ({ ...node(i + 200, i * 12, i * 9), w: 180, h: 80 })));
    const bounds = (aspectRatio: number) => {
      const applied = applyOps(s, layoutBranchOps(s, forestRoots(s), {}, { aspectRatio }));
      if (!applied.ok) throw new Error(applied.error.message);
      noOverlap(applied.state);
      const xs = applied.state.nodes.map(n => n.x), ys = applied.state.nodes.map(n => n.y);
      return (Math.max(...xs) - Math.min(...xs) + 180) / (Math.max(...ys) - Math.min(...ys) + 80);
    };
    const wide = bounds(3), tall = bounds(.75);
    expect(wide).toBeGreaterThan(tall);
    expect(Math.abs(Math.log(wide / 3))).toBeLessThan(Math.abs(Math.log(tall / 3)));
    expect(Math.abs(Math.log(tall / .75))).toBeLessThan(Math.abs(Math.log(wide / .75)));
  });
  it("外部卡片位于树内部空白时，不把整棵树推开", () => {
    const s = tree([node(1, 0, 200), node(2, 400, 0), node(3, 400, 400), node(4, 0, 0)], [[0, 1], [0, 2]]);
    const g = Object.fromEntries(s.nodes.map(n => [n.id, { w: 100, h: 80 }]));
    // 先取得无障碍的紧凑树，把外部卡片放在该树左上侧空白。
    const baseline = arranged({ ...s, nodes: s.nodes.slice(0, 3) }, g);
    const top = Math.min(...baseline.nodes.map(n => n.y));
    const obstacle = { ...s.nodes[3], x: 0, y: top - 60 };
    const out = arranged({ ...s, nodes: [...baseline.nodes, obstacle] }, g, [s.nodes[0].id]);
    noOverlap(out, g);
    expect(out.nodes.slice(0, 3)).toEqual(baseline.nodes);
  });
  it("确定性密集森林在不同实际尺寸下无重叠且幂等", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const nodes = Array.from({ length: 40 }, (_, i) => node(i + 100, (i * 31 * seed) % 400, (i * 67 * seed) % 500));
      const pairs: [number, number][] = [];
      for (let i = 1; i < nodes.length; i++) if (i % 7) pairs.push([Math.floor((i - 1) / 2), i]);
      const s = tree(nodes, pairs);
      const g = Object.fromEntries(nodes.map((n, i) => [n.id, { w: 70 + (i * seed * 19) % 700, h: 30 + (i * seed * 37) % 900 }]));
      const out = arranged(s, g); noOverlap(out, g);
      expect(layoutBranchOps(out, forestRoots(out), g)).toEqual([]);
    }
  });
});
