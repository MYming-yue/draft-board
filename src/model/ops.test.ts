// 契约 §3-A/§3-B/§3-C 行为契约的可测实现。
import { describe, expect, it } from "vitest";
import {
  applyBatch,
  applyOps,
  commitStep,
  createEmptyBoard,
  duplicateGroup,
  undo,
  type AgentBatch,
  type BoardEdge,
  type BoardFile,
  type BoardNode,
  type Op,
} from "./index";

const N = (s: string) => `n_${s.padEnd(6, "_")}`;
const E = (s: string) => `e_${s.padEnd(6, "_")}`;
const B = (s: string) => `b_${s.padEnd(6, "_")}`;

function textNode(id: string, x = 0, y = 0): BoardNode {
  return { id, type: "text", markdown: "", x, y, w: 240 };
}
function edge(id: string, from: string, to: string, kind: "association" | "parentChild" = "parentChild"): BoardEdge {
  return { id, kind, from, to, directed: true };
}
function addNodeOp(n: BoardNode): Op {
  return { op: "addNode", node: n, before: null, after: n };
}
function addEdgeOp(e: BoardEdge): Op {
  return { op: "addEdge", edge: e, before: null, after: e };
}
/** 连续提交，断言成功。 */
function commit(state: BoardFile, ops: Op[], label = "t", actor: "user" | "agent" = "user"): BoardFile {
  const r = commitStep(state, label, actor, ops);
  if (!r.ok) throw new Error(`commit 失败：${r.error.code} ${r.error.message}`);
  return r.state;
}
/** 建链：chain("a","b","c") = a→b→c（parentChild）。 */
function boardWithChain(...ids: string[]): BoardFile {
  let s = createEmptyBoard("t");
  s.board.id = B("board");
  s = commit(
    s,
    ids.map((id) => addNodeOp(textNode(N(id)))),
  );
  const edges: Op[] = [];
  for (let i = 0; i + 1 < ids.length; i++) edges.push(addEdgeOp(edge(E(`${ids[i]}${ids[i + 1]}`), N(ids[i]), N(ids[i + 1]))));
  if (edges.length) s = commit(s, edges);
  return s;
}
const reparent = (nodeId: string, parentId: string | null): Op => ({
  op: "reparent",
  nodeId,
  before: null,
  after: { parentId },
});

describe("B1 父子环检测边界穷举（契约 §3-A Examples 表）", () => {
  it("链 a→b，a 换父到 b → E_PARENT_CYCLE", () => {
    const s = boardWithChain("a", "b");
    const r = applyOps(s, [reparent(N("a"), N("b"))]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_PARENT_CYCLE");
  });
  it("链 a→b→c，a 换父到 c → E_PARENT_CYCLE", () => {
    const s = boardWithChain("a", "b", "c");
    const r = applyOps(s, [reparent(N("a"), N("c"))]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_PARENT_CYCLE");
  });
  it("链 a→b, c→d，a 换父到 d → 成功（跨树合法）", () => {
    let s = boardWithChain("a", "b");
    s = commit(s, [addNodeOp(textNode(N("c"))), addNodeOp(textNode(N("d"))), addEdgeOp(edge(E("cd"), N("c"), N("d")))]);
    const r = applyOps(s, [reparent(N("a"), N("d"))]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const pe = r.state.edges.find((e) => e.kind === "parentChild" && e.to === N("a"));
      expect(pe?.from).toBe(N("d"));
      // a 原本是根（无父边），reparent 新建确定性 id 的父边；原有子边 a→b 不动
      const ab = r.state.edges.find((e) => e.id === E("ab"));
      expect(ab?.from).toBe(N("a"));
      expect(ab?.to).toBe(N("b"));
    }
  });
  it("链 a→b，b 换父到 null → 成功（脱离成根）", () => {
    const s = boardWithChain("a", "b");
    const r = applyOps(s, [reparent(N("b"), null)]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.edges.some((e) => e.kind === "parentChild")).toBe(false);
  });
});

describe("B1 单父约束与关联线自由", () => {
  it("addEdge 给已有父的节点再挂父 → E_MULTI_PARENT（§3-A）", () => {
    let s = boardWithChain("a", "b");
    s = commit(s, [addNodeOp(textNode(N("c")))]);
    const r = applyOps(s, [addEdgeOp(edge(E("cb"), N("c"), N("b")))]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_MULTI_PARENT");
  });
  it("普通关联线允许循环：a→b、b→a 都成立", () => {
    let s = createEmptyBoard("t");
    s = commit(s, [
      addNodeOp(textNode(N("a"))),
      addNodeOp(textNode(N("b"))),
      addEdgeOp(edge(E("ab"), N("a"), N("b"), "association")),
      addEdgeOp(edge(E("ba"), N("b"), N("a"), "association")),
    ]);
    expect(s.edges).toHaveLength(2);
  });
  it("reparent 保留内容与关联线（§3-A）", () => {
    let s = boardWithChain("a", "b");
    s = commit(s, [
      addNodeOp(textNode(N("x"))),
      addNodeOp(textNode(N("c"))),
      addEdgeOp(edge(E("bx"), N("b"), N("x"), "association")),
      { op: "updateNodeText", nodeId: N("b"), before: null, after: { markdown: "**要点**" } },
    ]);
    const r = applyOps(s, [reparent(N("b"), N("c"))]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const b = r.state.nodes.find((n) => n.id === N("b"))!;
      expect(b.markdown).toBe("**要点**");
      expect(r.state.edges.some((e) => e.id === E("bx"))).toBe(true);
    }
  });
});

describe("I1 删除父卡片保留子卡片 + 一次撤销整体恢复（§3-A）", () => {
  it("删 n_a：n_b 保留，两条 parentChild 边同步骤移除；undo 恢复", () => {
    const s = boardWithChain("root", "a", "b");
    const deleted = commit(s, [{ op: "removeNode", nodeId: N("a"), before: null, after: null }], "删除卡片");
    expect(deleted.nodes.some((n) => n.id === N("b"))).toBe(true);
    expect(deleted.edges).toHaveLength(0);
    // 级联与删节点同步骤：history 只增一步
    expect(deleted.history).toHaveLength(3);
    const u = undo(deleted, deleted.history.length);
    expect(u).not.toBeNull();
    expect(u!.state.nodes).toHaveLength(3);
    expect(u!.state.edges).toHaveLength(2);
    expect(u!.state.edges.map((e) => e.id).sort()).toEqual([E("roota"), E("ab")].sort());
    // 撤销是追加步骤，历史只增不减（I5）
    expect(u!.state.history).toHaveLength(4);
  });
});

describe("B2 复制组 ID 重生成（§3-B）", () => {
  it("3 卡 + 2 组内边 + 1 组外边：全新 id、组内映射、组外不复制、一步撤销", () => {
    let s = createEmptyBoard("t");
    s = commit(s, [
      addNodeOp(textNode(N("n1"))),
      addNodeOp(textNode(N("n2"))),
      addNodeOp(textNode(N("n3"))),
      addNodeOp(textNode(N("nx"))),
      addEdgeOp(edge(E("e12"), N("n1"), N("n2"), "association")),
      addEdgeOp(edge(E("e23"), N("n2"), N("n3"), "association")),
      addEdgeOp(edge(E("e1x"), N("n1"), N("nx"), "association")),
    ]);
    let counter = 0;
    const genId = (kind: "node" | "edge" | "board" | "asset") => `${kind === "node" ? "n" : "e"}_copy${String(counter++).padStart(4, "0")}`;
    const ops = duplicateGroup(s, [N("n1"), N("n2"), N("n3")], genId);
    const pasted = commit(s, ops, "粘贴 3 张卡片");
    const oldIds = new Set([N("n1"), N("n2"), N("n3")]);
    const newNodes = pasted.nodes.filter((n) => !oldIds.has(n.id) && n.id !== N("nx"));
    expect(newNodes).toHaveLength(3);
    // 新 id 与旧集合交集为空（I3）
    expect(newNodes.every((n) => !oldIds.has(n.id))).toBe(true);
    // 组内边端点全部映射到新 id
    const newIds = new Set(newNodes.map((n) => n.id));
    const newEdges = pasted.edges.filter((e) => ![E("e12"), E("e23"), E("e1x")].includes(e.id));
    expect(newEdges).toHaveLength(2);
    expect(newEdges.every((e) => newIds.has(e.from) && newIds.has(e.to))).toBe(true);
    // 组外关联不被复制（n_x 仍只有原 e1x 一条）
    expect(pasted.edges.filter((e) => e.from === N("nx") || e.to === N("nx"))).toHaveLength(1);
    // 一次撤销移除全部新对象
    const u = undo(pasted, pasted.history.length)!;
    expect(u.state.nodes).toHaveLength(4);
    expect(u.state.edges).toHaveLength(3);
  });
});

describe("B3 Agent 批次原子性与可定位错误（§3-C）", () => {
  function demoBatch(ops: Op[], baseContentVersion: number, boardId = B("board")): AgentBatch {
    return { batchVersion: "1.0", boardId, baseContentVersion, actor: "agent", label: "Agent：测试批次", ops };
  }
  function boardV2(): BoardFile {
    let s = boardWithChain("a"); // 1 步，contentVersion=1
    s = commit(s, [{ op: "updateNodeText", nodeId: N("a"), before: null, after: { markdown: "v2" } }]);
    return s; // contentVersion=2
  }

  it("原子性穷举 failAt=0：首个 op 形状非法 → E_SCHEMA，opIndex=0，零落盘", () => {
    const s = boardV2();
    const snapshot = structuredClone(s);
    const bad = { op: "moveNode", nodeId: N("a"), after: { x: "NaN" } } as unknown as Op;
    const r = applyBatch(s, demoBatch([bad, addNodeOp(textNode(N("z")))], 2));
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) {
      expect(r.result.error.code).toBe("E_SCHEMA");
      expect(r.result.error.opIndex).toBe(0);
    }
    expect(r.file).toBeNull();
    expect(s).toEqual(snapshot);
  });

  it("原子性穷举 failAt=2：E_UNKNOWN_NODE，opIndex=2，path=ops.2.from，文件零改动", () => {
    const s = boardV2();
    const snapshot = structuredClone(s);
    const ghostEdge = edge(E("g1"), N("ghost"), N("a"), "association");
    const ops: Op[] = [
      addNodeOp(textNode(N("z1"))),
      addNodeOp(textNode(N("z2"))),
      addEdgeOp(ghostEdge),
      addNodeOp(textNode(N("z3"))),
      addNodeOp(textNode(N("z4"))),
    ];
    const r = applyBatch(s, demoBatch(ops, 2));
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) {
      expect(r.result.error.code).toBe("E_UNKNOWN_NODE");
      expect(r.result.error.opIndex).toBe(2);
      expect(r.result.error.path).toBe("ops.2.edge.from");
    }
    expect(r.file).toBeNull();
    expect(s).toEqual(snapshot); // contentVersion 不变，history 无新增
  });

  it("原子性穷举 failAt=4：E_PARENT_CYCLE，appliedOps=0", () => {
    const s = boardV2(); // 含节点 a
    const snapshot = structuredClone(s);
    const ops: Op[] = [
      addNodeOp(textNode(N("z1"))),
      addNodeOp(textNode(N("z2"))),
      addEdgeOp(edge(E("az1"), N("a"), N("z1"))),
      addEdgeOp(edge(E("z1z2"), N("z1"), N("z2"))),
      reparent(N("a"), N("z2")), // a→z1→z2 之后 a 换父到 z2 → 环
    ];
    const r = applyBatch(s, demoBatch(ops, 2));
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) {
      expect(r.result.error.code).toBe("E_PARENT_CYCLE");
      expect(r.result.error.opIndex).toBe(4);
    }
    expect(s).toEqual(snapshot);
  });

  it("版本冲突：baseContentVersion=1 ≠ 当前 2 → E_VERSION_CONFLICT，文件零改动（决议 Q3）", () => {
    const s = boardV2();
    const snapshot = structuredClone(s);
    const r = applyBatch(s, demoBatch([addNodeOp(textNode(N("z")))], 1));
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) expect(r.result.error.code).toBe("E_VERSION_CONFLICT");
    expect(r.file).toBeNull();
    expect(s).toEqual(snapshot);
  });

  it("boardId 不符 → E_BOARD_MISMATCH", () => {
    const s = boardV2();
    const r = applyBatch(s, demoBatch([addNodeOp(textNode(N("z")))], 2, B("other")));
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) expect(r.result.error.code).toBe("E_BOARD_MISMATCH");
  });

  it("image 节点引用不存在 assetId → E_UNKNOWN_ASSET", () => {
    const s = boardV2();
    const img: BoardNode = { id: N("img"), type: "image", assetId: "a_ghost0", x: 0, y: 0, w: 240 };
    const r = applyBatch(s, demoBatch([addNodeOp(img)], 2));
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) expect(r.result.error.code).toBe("E_UNKNOWN_ASSET");
  });

  it("image 节点 caption：addNode 带 markdown 合法，updateNodeText 可改（契约 §2-B 演进）", () => {
    let s = createEmptyBoard("t");
    s = { ...s, assets: [{ id: "a_img001", mime: "image/png", path: "assets/a_img001.png", bytes: 4 }] };
    const img: BoardNode = { id: N("img"), type: "image", assetId: "a_img001", markdown: "**说明**", x: 0, y: 0, w: 320 };
    const r = applyOps(s, [addNodeOp(img)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = applyOps(r.state, [
      { op: "updateNodeText", nodeId: N("img"), before: null, after: { markdown: "新 caption $x^2$" } },
    ]);
    expect(u.ok).toBe(true);
    if (u.ok) expect(u.state.nodes.find((n) => n.id === N("img"))!.markdown).toBe("新 caption $x^2$");
  });
});

describe("op 语义补充", () => {
  it("updateEdge 改端点后重查 B1：换到已有父的节点 → E_MULTI_PARENT", () => {
    let s = boardWithChain("a", "b");
    s = commit(s, [addNodeOp(textNode(N("c"))), addEdgeOp(edge(E("pc2"), N("c"), N("a")))]);
    // 把 a→b 改为 c→b：b 已有父 a…… 先删原父边之外，直接改 E("ab") 的 from 为 c 合法（b 的父边仍是这一条）
    const ok = applyOps(s, [
      { op: "updateEdge", edgeId: E("ab"), before: null, after: { from: N("c"), to: N("b"), directed: true } },
    ]);
    expect(ok.ok).toBe(true);
    // 把 pc2（c→a）改成 c→b：b 已有父边 ab → E_MULTI_PARENT
    const bad = applyOps(s, [
      { op: "updateEdge", edgeId: E("pc2"), before: null, after: { from: N("c"), to: N("b"), directed: true } },
    ]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("E_MULTI_PARENT");
  });
  it("addNode 重复 id → E_DUP_ID；removeEdge 不存在 → E_UNKNOWN_EDGE", () => {
    const s = boardWithChain("a", "b");
    const dup = applyOps(s, [addNodeOp(textNode(N("a")))]);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("E_DUP_ID");
    const noEdge = applyOps(s, [{ op: "removeEdge", edgeId: E("ghost"), before: null, after: null }]);
    expect(noEdge.ok).toBe(false);
    if (!noEdge.ok) expect(noEdge.error.code).toBe("E_UNKNOWN_EDGE");
  });
});
