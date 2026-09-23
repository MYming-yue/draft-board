import { expect, it } from "vitest";
import { applyOps, connectAssociationOps, createEmptyBoard, invertOps, visibleEdges, type BoardEdge } from "./index";

it("replaces all same-direction associations, preserving reverse and tree edges; undo restores them", () => {
  const file = createEmptyBoard();
  file.nodes = ["n_nodeaa", "n_nodebb"].map(id => ({ id, type: "text", markdown: id, x: 0, y: 0, w: 100 }));
  const edge: BoardEdge = { id: "e_first0", kind: "association", from: "n_nodeaa", to: "n_nodebb", directed: true, label: "旧说明" };
  file.edges = [edge, { ...edge, id: "e_second" }, { ...edge, id: "e_reverse", from: edge.to, to: edge.from }, { ...edge, id: "e_parent", kind: "parentChild" }];
  const fresh = { ...edge, id: "e_newone", label: "新说明" };
  const result = applyOps(file, connectAssociationOps(file.edges, fresh));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.edges.map(e => e.id)).toEqual(["e_reverse", "e_parent", "e_newone"]);
  const restored = applyOps(result.state, invertOps(result.ops));
  expect(restored.ok).toBe(true);
  if (restored.ok) expect(restored.state.edges.slice().sort((a,b) => a.id.localeCompare(b.id))).toEqual(file.edges.slice().sort((a,b) => a.id.localeCompare(b.id)));
  expect(visibleEdges(file.edges).map(e => e.id)).toEqual(["e_second", "e_reverse", "e_parent"]);
});
