// 契约 §3-D（B4 历史与回放一致性 I5/I6）+ I4（布局整理只产生 moveNode）。
import { describe, expect, it } from "vitest";
import {
  commitStep,
  contentEqual,
  createEmptyBoard,
  forestRoots,
  layoutBranchOps,
  redo,
  replayTo,
  undo,
  type BoardEdge,
  type BoardFile,
  type BoardNode,
  type Op,
} from "./index";

const N = (s: string) => `n_${s.padEnd(6, "_")}`;
const E = (s: string) => `e_${s.padEnd(6, "_")}`;

function textNode(id: string, x = 0, y = 0): BoardNode {
  return { id, type: "text", markdown: "", x, y, w: 240 };
}
function commit(state: BoardFile, ops: Op[], label = "t"): BoardFile {
  const r = commitStep(state, label, "user", ops);
  if (!r.ok) throw new Error(`commit 失败：${r.error.code} ${r.error.message}`);
  return r.state;
}

describe("B4 撤销与重做都进入历史（I5）", () => {
  it("3 步 → 撤销 1 步再重做 1 步 → 总 5 步，contentVersion 递增，状态还原", () => {
    let s = createEmptyBoard("t");
    s = commit(s, [{ op: "addNode", node: textNode(N("a")), before: null, after: textNode(N("a")) }], "建卡 a");
    s = commit(s, [{ op: "addNode", node: textNode(N("b")), before: null, after: textNode(N("b")) }], "建卡 b");
    s = commit(s, [
      {
        op: "addEdge",
        edge: { id: E("ab"), kind: "association", from: N("a"), to: N("b"), directed: true },
        before: null,
        after: { id: E("ab"), kind: "association", from: N("a"), to: N("b"), directed: true },
      },
    ], "连线");
    expect(s.history).toHaveLength(3);
    expect(s.board.contentVersion).toBe(3);

    const u = undo(s, 3)!;
    expect(u.state.history).toHaveLength(4);
    expect(u.state.board.contentVersion).toBe(4);
    expect(u.state.edges).toHaveLength(0);
    expect(u.cursor).toBe(2);
    expect(u.state.history[3].label).toBe("撤销：连线");
    // seq 连续、base/result 链式（I5）
    expect(u.state.history[3].seq).toBe(4);
    expect(u.state.history[3].base).toBe(3);
    expect(u.state.history[3].result).toBe(4);

    const r = redo(u.state, u.undone)!;
    expect(r.state.history).toHaveLength(5);
    expect(r.state.board.contentVersion).toBe(5);
    expect(r.state.edges).toHaveLength(1);
    expect(contentEqual(replayTo(r.state), r.state)).toBe(true);
    // 回放前 3 步 == 原 3 步状态
    expect(replayTo(r.state, 3).edges).toHaveLength(1);
  });

  it("连续撤销到空再逐步重做：线性语义正确", () => {
    let s = createEmptyBoard("t");
    s = commit(s, [{ op: "addNode", node: textNode(N("a")), before: null, after: textNode(N("a")) }], "a");
    s = commit(s, [{ op: "addNode", node: textNode(N("b")), before: null, after: textNode(N("b")) }], "b");
    const u1 = undo(s, 2)!; // 撤销 "b"
    const u2 = undo(u1.state, u1.cursor)!; // 撤销 "a"
    expect(u2.state.nodes).toHaveLength(0);
    const r1 = redo(u2.state, u2.undone); // 先重做最近撤销的 "a"
    expect(r1.state.nodes.map((n) => n.id)).toEqual([N("a")]);
    const r2 = redo(r1.state, u1.undone); // 再重做 "b"
    expect(r2.state.nodes.map((n) => n.id)).toEqual([N("a"), N("b")]);
  });
});

describe("B4 回放一致性（I6）：混合编辑后 replay == current", () => {
  it("创建/连接/修改/移动/删除/撤销/布局整理 后回放逐步一致", () => {
    let s = createEmptyBoard("t");
    s = commit(s, [
      { op: "addNode", node: textNode(N("root"), 0, 0), before: null, after: textNode(N("root"), 0, 0) },
      { op: "addNode", node: textNode(N("c1"), 400, 100), before: null, after: textNode(N("c1"), 400, 100) },
      { op: "addNode", node: textNode(N("c2"), 400, 300), before: null, after: textNode(N("c2"), 400, 300) },
    ], "建卡");
    s = commit(s, [
      { op: "addEdge", edge: { id: E("r1"), kind: "parentChild", from: N("root"), to: N("c1"), directed: true }, before: null, after: { id: E("r1"), kind: "parentChild", from: N("root"), to: N("c1"), directed: true } },
      { op: "addEdge", edge: { id: E("r2"), kind: "parentChild", from: N("root"), to: N("c2"), directed: true }, before: null, after: { id: E("r2"), kind: "parentChild", from: N("root"), to: N("c2"), directed: true } },
    ], "分支");
    s = commit(s, [{ op: "updateNodeText", nodeId: N("c1"), before: null, after: { markdown: "$E=mc^2$" } }], "写公式");
    s = commit(s, [{ op: "moveNode", nodeId: N("c2"), before: null, after: { x: 420, y: 320 } }], "拖动");
    s = commit(s, [{ op: "removeNode", nodeId: N("c2"), before: null, after: null }], "删除");
    const u = undo(s, s.history.length)!; // 撤销删除
    s = u.state;
    // 布局整理 = 单步骤多 moveNode（I4）
    const layoutOps = layoutBranchOps(s, [N("root")]);
    expect(layoutOps.length).toBeGreaterThan(0);
    expect(layoutOps.every((o) => o.op === "moveNode")).toBe(true);
    const before = s;
    s = commit(s, layoutOps, "布局整理");
    // 布局不动内容、父子关系、关联线（I4）
    expect(s.nodes.map((n) => n.id).sort()).toEqual(before.nodes.map((n) => n.id).sort());
    expect(s.edges).toEqual(before.edges);
    expect(s.nodes.find((n) => n.id === N("c1"))!.markdown).toBe("$E=mc^2$");

    const replayed = replayTo(s);
    expect(contentEqual(replayed, s)).toBe(true);
    expect(replayed.contentVersion).toBe(s.board.contentVersion);
    // 每一步单独回放也一致（逐步一致）
    for (let k = 1; k <= s.history.length; k++) {
      expect(replayTo(s, k).contentVersion).toBe(s.history[k - 1].result);
    }
  });

  it("脱历史文件（history=[]）回放为空板，可继续编辑续记 seq=1（§3-D）", () => {
    let s = createEmptyBoard("t");
    s = commit(s, [{ op: "addNode", node: textNode(N("a")), before: null, after: textNode(N("a")) }], "a");
    const stripped: BoardFile = { ...structuredClone(s), history: [] };
    expect(replayTo(stripped).nodes).toHaveLength(0);
    // 继续编辑：新步骤 seq=1
    const s2 = commit(stripped, [{ op: "moveNode", nodeId: N("a"), before: null, after: { x: 9, y: 9 } }], "续编");
    expect(s2.history[0].seq).toBe(1);
  });
});

describe("布局整理辅助", () => {
  it("forestRoots 返回无父节点", () => {
    let s = createEmptyBoard("t");
    const mk = (id: string) => textNode(N(id));
    s = commit(s, [
      { op: "addNode", node: mk("r"), before: null, after: mk("r") },
      { op: "addNode", node: mk("k"), before: null, after: mk("k") },
      { op: "addNode", node: mk("solo"), before: null, after: mk("solo") },
      {
        op: "addEdge",
        edge: { id: E("rk"), kind: "parentChild", from: N("r"), to: N("k"), directed: true } satisfies BoardEdge,
        before: null,
        after: { id: E("rk"), kind: "parentChild", from: N("r"), to: N("k"), directed: true },
      },
    ]);
    expect(forestRoots(s).sort()).toEqual([N("r"), N("solo")].sort());
  });
});
