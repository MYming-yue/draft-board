import { expect, it } from "vitest";
import { applyOps, collectionBounds, createEmptyBoard, type BoardFile, type BoardNode, type LayoutGeometry } from "../model";
import { layoutConflicts } from "./layoutConstraints";
import { planTidyLayout } from "./layoutPlanner";

// 匿名几何回归：24 张不同尺寸的卡片、9 条关联线和一个 11 成员集合。
const rectangles = [[675,-407,220,156],[498,-151,95,50],[-156,-422,270,394],[-552,-219,325,191],[488,150,240,262],[-6,491,390,193],[752,491,320,200],[-599,-422,418,76],[922,-251,242,133],[860,-69,367,53],[1096,491,320,85],[-653,34,320,138],[1281,-83,347,67],[1455,-189,143,67],[-270,491,240,77],[-270,729,597,133],[408,491,320,75],[351,729,320,71],[1653,-83,179,50],[1857,-83,117,50],[695,729,491,132],[844,246,320,71],[-653,195,336,117],[1210,729,320,80]];
const latestPositions = [[84,26],[605,356],[-210,26],[595,-422],[799,740],[-45,1027],[713,1027],[-653,26],[328,26],[64,445],[1057,1027],[455,445],[-653,445],[944,26],[-309,1027],[-653,1265],[17,919],[-32,1265],[-281,445],[-77,445],[312,1265],[-653,1027],[1063,445],[827,1265]];
const latestSizes = [[220,155.938],[94.5469,49.8906],[270,393.766],[325,191.391],[240,262.484],[390,192.719],[320,200.094],[418.109,76.4844],[242.203,133.188],[366.688,52.9688],[320,84.6406],[320,138.312],[347.422,67.1406],[142.844,66.8906],[240,77.0156],[596.688,133.062],[320,75.4688],[320,71.0781],[179.297,49.8906],[117,49.8906],[490.797,131.531],[320,71.0781],[335.875,117.375],[320,80.1094]];

const links = [[1,0],[2,0],[0,2],[5,4],[4,6],[6,5],[8,9],[6,10],[3,7]];
const memberIndexes = [21,16,17,10,23,6,4,5,14,15,20];
const ids = rectangles.map((_, i) => `n_repro${String(i).padStart(2, "0")}`);
const geometry: LayoutGeometry = Object.fromEntries(rectangles.map(([, , w, h], i) => [ids[i], { w, h }]));
const nodes: BoardNode[] = rectangles.map(([x, y, w, h], i) => ({ id: ids[i], type: "text", markdown: "卡片", x, y, w, h }));
const file: BoardFile = { ...createEmptyBoard(), nodes,
  edges: links.map(([from, to], i) => ({ id: `e_repro${String(i).padStart(2, "0")}`, kind: "association", from: ids[from], to: ids[to], directed: true })),
  collections: [{ id: "g_repro01", name: "集合", shape: "rectangle", nodeIds: memberIndexes.map(i => ids[i]), x: 2003, y: -1891 }],
};
function outline(f: BoardFile, sizing: LayoutGeometry) {
  const rects = [
    ...f.nodes.map(n => ({ x: n.x, y: n.y, w: sizing[n.id].w, h: sizing[n.id].h })),
    ...(f.collections ?? []).map(c => collectionBounds(c, f.nodes, sizing)),
  ];
  return {
    w: Math.max(...rects.map(r => r.x + r.w)) - Math.min(...rects.map(r => r.x)),
    h: Math.max(...rects.map(r => r.y + r.h)) - Math.min(...rects.map(r => r.y)),
  };
}

const latestGeometry: LayoutGeometry = Object.fromEntries(latestSizes.map(([w, h], i) => [ids[i], { w, h }]));
it.each([
  ["未整理的宽屏草稿", file, geometry, 2],
  ["上次整理后仍偏窄的草稿", { ...file, nodes: file.nodes.map((n, i) => ({ ...n, x: latestPositions[i][0], y: latestPositions[i][1] })) }, latestGeometry, 2048 / 1051],
] as const)("%s 能无冲突地填充宽屏并稳定重复整理", (_, input, sizing, aspect) => {
  const plan = planTidyLayout(input, [], sizing, aspect);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.ops.length).toBeGreaterThan(0);
  const applied = applyOps(input, plan.ops);
  if (!applied.ok) throw new Error(applied.error.message);
  expect(layoutConflicts(applied.state, sizing)).toEqual([]);
  const bounds = outline(applied.state, sizing);
  expect(bounds.w / bounds.h).toBeGreaterThan(1.7);
  expect(bounds.w / bounds.h).toBeLessThan(2.4);
  expect(planTidyLayout(applied.state, [], sizing, aspect)).toMatchObject({ ok: true, ops: [], outcome: expect.stringMatching(/already-tidy|unresolved/) });
});
