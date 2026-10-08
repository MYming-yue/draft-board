import { describe, expect, it } from "vitest";
import { commitStep, createEmptyBoard, type BoardFile } from "../model";
import { sameDraftAssets, sameDraftContent, verifyExternalUpdate } from "./externalChanges";

const card = { id: "n_origin1", type: "text" as const, markdown: "原有卡片", x: 100, y: 100, w: 240 };
const base = commitStep(createEmptyBoard("共享草稿"), "起点", "user", [{ op: "addNode", node: card, before: null, after: card }]);
if (!base.ok) throw new Error("fixture failed");
const input = base.state;
function append(file: BoardFile, label: string, ops: Parameters<typeof commitStep>[3]) {
  const result = commitStep(file, label, "agent", ops);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}
describe("外部文件更新校验", () => {
  it("资源表相同时也能识别图片二进制变化", () => {
    const bytes = { a_image01: new Uint8Array([1, 2, 3]) };
    expect(sameDraftAssets(bytes, { a_image01: new Uint8Array([1, 2, 3]) })).toBe(true);
    expect(sameDraftAssets(bytes, { a_image01: new Uint8Array([1, 9, 3]) })).toBe(false);
    expect(sameDraftAssets(bytes, {})).toBe(false);
  });
  it("忽略视图变化，接收多个真实批次，识别增改删和关系变化", () => {
    const added = { ...card, id: "n_second1", markdown: "例子", x: 440 };
    let next = append(input, "解释", [{ op: "updateNodeCaption", nodeId: card.id, before: null, after: { caption: "补充" } }, { op: "addNode", node: added, before: null, after: added }]);
    next = append(next, "关联", [{ op: "addEdge", edge: { id: "e_example1", kind: "association", from: card.id, to: added.id, directed: true }, before: null, after: { id: "e_example1", kind: "association", from: card.id, to: added.id, directed: true } }]);
    expect(verifyExternalUpdate(input, next)).toMatchObject({ added: [added.id], updated: [card.id], edges: 1, steps: [{ label: "解释" }, { label: "关联" }] });
    expect(verifyExternalUpdate(next, { ...next, board: { ...next.board, view: { panX: 5, panY: 20, zoom: 2 } } })).toBeNull();
    const deleted = append(next, "删除例子", [{ op: "removeNode", nodeId: added.id, before: null, after: null }]);
    expect(verifyExternalUpdate(next, deleted)).toMatchObject({ removed: [{ id: added.id, title: "例子" }], nodes: [card.id], edges: 1 });
  });
  it("拒绝其他白板、分叉、伪造内容及撤销信息", () => {
    const next = append(input, "移动", [{ op: "moveNode", nodeId: card.id, before: null, after: { x: 200, y: 100 } }]);
    const bad = [
      { ...next, board: { ...next.board, id: "b_foreign1" } },
      { ...next, history: [...next.history].reverse() },
      { ...next, nodes: [{ ...next.nodes[0], x: 999 }] },
      { ...next, board: { ...next.board, contentVersion: 99 } },
    ];
    for (const file of bad) expect(() => verifyExternalUpdate(input, file)).toThrow();
    const incorrect = structuredClone(next);
    const move = incorrect.history.at(-1)!.ops[0];
    if (move.op === "moveNode") move.before = { x: 999, y: 999 };
    expect(() => verifyExternalUpdate(input, incorrect)).toThrow();
    expect(sameDraftContent(input, next)).toBe(false);
  });
});
