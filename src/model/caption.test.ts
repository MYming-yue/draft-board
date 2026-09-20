import { describe, expect, it } from "vitest";
import { applyOps, commitStep, contentEqual, createEmptyBoard, duplicateGroup, parseBoard, redo, replayTo, serializeBoard, undo, type BoardFile, type BoardNode, type Op } from "./index";
import { validateNodeShape, validateOpShape } from "./validate";

const node: BoardNode = { id: "n_formula", type: "text", markdown: "$D_h=4A/P$", x: 10, y: 20, w: 180, h: 60 };
const caption = "$A$：截面积\n$P$：湿周";
const change: Op = { op: "updateNodeCaption", nodeId: node.id, before: null, after: { caption } };
function commit(file: BoardFile, ops: Op[]) {
  const r = commitStep(file, "备注", "user", ops);
  if (!r.ok) throw new Error(r.error.message);
  return r.state;
}
function fixture() {
  return commit(createEmptyBoard(), [{ op: "addNode", node, before: null, after: node }]);
}

describe("独立公式备注", () => {
  it("添加/修改/删除备注可撤销重做，正文与公式尺寸不变，回放一致", () => {
    const added = commit(fixture(), [change]);
    expect(added.nodes[0]).toEqual({ ...node, caption });
    expect(added.history[1].ops[0].before).toEqual({ caption: null });
    const undone = undo(added, 2)!;
    expect(undone.state.nodes[0]).toEqual(node);
    const redone = redo(undone.state, undone.undone).state;
    expect(redone.nodes[0].caption).toBe(caption);
    const edited = commit(redone, [{ ...change, after: { caption: "新的备注" } }]);
    const removed = commit(edited, [{ ...change, after: { caption: null } }]);
    expect(removed.nodes[0]).not.toHaveProperty("caption");
    const restored = undo(removed, removed.history.length)!.state;
    expect(restored.nodes[0].caption).toBe("新的备注");
    expect(contentEqual(replayTo(restored), restored)).toBe(true);
  });
  it("保存重开和复制保留备注；改正文不会清掉备注", () => {
    const added = commit(fixture(), [change]);
    const parsed = parseBoard(serializeBoard(added, {})).file;
    expect(parsed).toEqual(added);
    const copied = commit(parsed, duplicateGroup(parsed, [node.id], () => "n_copied1"));
    expect(copied.nodes[1].caption).toBe(caption);
    const edited = commit(copied, [{ op: "updateNodeText", nodeId: node.id, before: null, after: { markdown: "公式改成说明文字" } }]);
    expect(edited.nodes[0].caption).toBe(caption);
  });
  it("拒绝错误字段类型和不存在的节点，旧节点没有备注也可读", () => {
    expect(validateNodeShape(node)).toBeNull();
    expect(validateNodeShape({ ...node, caption: 5 })?.path).toBe("node.caption");
    expect(validateOpShape({ ...change, after: {} })?.path).toBe("after.caption");
    expect(validateOpShape({ ...change, after: { caption: 5 } })?.path).toBe("after.caption");
    const r = applyOps(fixture(), [{ ...change, nodeId: "n_missing" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_UNKNOWN_NODE");
  });
});
