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

describe("备注常驻展开", () => {
  const expand: Op = { op: "setCaptionExpanded", nodeId: node.id, before: null, after: { expanded: true } };
  it("开启/关闭可撤销重做，false 删除字段，回放一致", () => {
    const on = commit(fixture(), [expand]);
    expect(on.nodes[0].captionExpanded).toBe(true);
    expect(on.history[1].ops[0].before).toEqual({ expanded: false });
    const off = commit(on, [{ ...expand, after: { expanded: false } }]);
    expect(off.nodes[0]).not.toHaveProperty("captionExpanded");
    const undone = undo(off, off.history.length)!;
    expect(undone.state.nodes[0].captionExpanded).toBe(true);
    expect(contentEqual(replayTo(undone.state), undone.state)).toBe(true);
  });
  it("保存重开和复制保留展开标记；缺省视为关闭", () => {
    const on = commit(fixture(), [expand]);
    const parsed = parseBoard(serializeBoard(on, {})).file;
    expect(parsed.nodes[0].captionExpanded).toBe(true);
    const copied = commit(parsed, duplicateGroup(parsed, [node.id], () => "n_copied1"));
    expect(copied.nodes[1].captionExpanded).toBe(true);
    expect(validateNodeShape(node)).toBeNull();
    expect(validateNodeShape({ ...node, captionExpanded: "yes" })?.path).toBe("node.captionExpanded");
    expect(validateOpShape({ ...expand, after: { expanded: 1 } })?.path).toBe("after.expanded");
    const missing = applyOps(fixture(), [{ ...expand, nodeId: "n_missing" }]);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("E_UNKNOWN_NODE");
  });
});

describe("核心缩放与备注宽度", () => {
  it("resizeNode 写入 coreScale，撤销恢复缺省", () => {
    const scaled = commit(fixture(), [
      { op: "resizeNode", nodeId: node.id, before: null, after: { w: 200, h: null, coreScale: 2 } },
    ]);
    expect(scaled.nodes[0].coreScale).toBe(2);
    expect(scaled.nodes[0].w).toBe(200);
    const undone = undo(scaled, scaled.history.length)!;
    expect(undone.state.nodes[0].coreScale).toBeUndefined();
    expect(undone.state.nodes[0].w).toBe(180);
  });
  it("setCaptionWidth 可撤销；null 删除字段", () => {
    const wide = commit(fixture(), [
      { op: "setCaptionWidth", nodeId: node.id, before: null, after: { captionW: 360 } },
    ]);
    expect(wide.nodes[0].captionW).toBe(360);
    const cleared = commit(wide, [
      { op: "setCaptionWidth", nodeId: node.id, before: null, after: { captionW: null } },
    ]);
    expect(cleared.nodes[0]).not.toHaveProperty("captionW");
    const restored = undo(cleared, cleared.history.length)!;
    expect(restored.state.nodes[0].captionW).toBe(360);
    expect(validateNodeShape({ ...node, coreScale: 0 })?.path).toBe("node.coreScale");
    expect(validateOpShape({ op: "setCaptionWidth", nodeId: node.id, before: null, after: { captionW: 0 } })?.path).toBe(
      "after.captionW",
    );
  });
});
