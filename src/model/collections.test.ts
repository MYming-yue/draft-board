import { describe, it, expect } from "vitest";
import { applyOps, commitStep, createEmptyBoard, invertOps, replayTo, contentEqual, parseBoard, serializeBoard, stripHistory, duplicateGroup, collectionBounds, arrangeCollectionOps, type BoardCollection, type BoardFile, type Op } from "./index";
const ids = ["n_member01", "n_member02", "n_member03"];
const group = (id = "g_group001", nodeIds = ids.slice(0, 2)): BoardCollection => ({ id, name: "物质守恒", description: "同一系统内的关系", shape: "rectangle", nodeIds, x: 0, y: 0 });
const add = (c: BoardCollection): Op => ({ op: "addCollection", collection: c, before: null, after: c });
function commit(s: BoardFile, ops: Op[]) {
  const result = commitStep(s, "测试步骤", "user", ops);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}
function fixture() {
  return commit(createEmptyBoard(), ids.map((id, i): Op => {
    const n = { id, type: "text" as const, markdown: `卡片 ${i}`, x: i * 200, y: i * 50, w: 100, h: 80 };
    return { op: "addNode", node: n, before: null, after: n };
  })).state;
}
describe("共享集合", () => {
  it("保存、分享、回放包含重叠成员，旧文件仍可读取", () => {
    const old = fixture();
    expect(parseBoard(serializeBoard(old, {})).file.formatVersion).toBe("1.0");
    const s = commit(old, [add(group()), add(group("g_group002", ids.slice(1)))]).state;
    expect(s.formatVersion).toBe("2.0");
    expect(contentEqual(replayTo(s), s)).toBe(true);
    expect(parseBoard(serializeBoard(s, {})).file.collections).toEqual(s.collections);
    expect(parseBoard(serializeBoard(stripHistory(s), {})).file.collections).toEqual(s.collections);
  });
  it("重复成员、非法形状、空名称、身份变化、悬空成员和重复 id 拒绝，批次不留部分结果", () => {
    const s = fixture();
    for (const c of [ { ...group(), nodeIds: [ids[0], ids[0]] }, { ...group(), name: " " }, { ...group(), shape: "triangle" }, { ...group(), x: Infinity } ]) {
      expect(applyOps(s, [add(c as BoardCollection)]).ok).toBe(false);
    }
    const before = structuredClone(s);
    const bad = applyOps(s, [add(group()), add(group("g_group002", ["n_missing0"]))]);
    expect(bad.ok).toBe(false); expect(s).toEqual(before);
    const withGroup = commit(s, [add(group())]).state;
    expect(applyOps(withGroup, [add(group())]).ok).toBe(false);
    expect(applyOps(withGroup, [{ op: "updateCollection", collectionId: group().id, before: null, after: group("g_changed1") }]).ok).toBe(false);
    expect(() => parseBoard(serializeBoard({ ...withGroup, collections: [group("g_group001", ["n_missing0"])] }, {}))).toThrow();
  });
  it("删除多张卡片后一次撤销恢复多个集合和原成员顺序", () => {
    const original = commit(fixture(), [add(group()), add(group("g_group002", ids.slice(1)))]).state;
    const removed = commit(original, ids.map(nodeId => ({ op: "removeNode", nodeId, before: null, after: null })));
    expect(removed.state.collections?.every(c => c.nodeIds.length === 0)).toBe(true);
    const restored = commit(removed.state, invertOps(removed.step.ops));
    expect(restored.state.collections).toEqual(original.collections);
    expect(contentEqual(replayTo(restored.state), restored.state)).toBe(true);
  });
  it("集合改名、解散、撤销与重做保持卡片和连线", () => {
    const initial = commit(fixture(), [add(group())]).state;
    const updated = commit(initial, [{ op: "updateCollection", collectionId: group().id, before: { ...group(), name: "假 before" }, after: { ...group(), name: "新关系", shape: "ellipse" } }]);
    expect(updated.step.ops[0].before).toEqual(group());
    const removed = commit(updated.state, [{ op: "removeCollection", collectionId: group().id, before: null, after: null }]);
    expect(removed.state.nodes).toEqual(initial.nodes);
    const restored = commit(removed.state, invertOps(removed.step.ops)).state;
    expect(restored.collections).toEqual(updated.state.collections);
    expect(commit(restored, removed.step.ops).state.collections).toEqual([]);
  });
  it("完整复制集合重建身份，部分复制不携带集合", () => {
    const s = commit(fixture(), [add(group()), add(group("g_group002", ids.slice(1)))]).state;
    let count = 0;
    const gen = (kind: string) => `${kind === "edge" ? "e" : "n"}_copy${String(count++).padStart(6, "0")}`;
    const result = commit(s, duplicateGroup(s, ids, gen)).state;
    expect(result.collections).toHaveLength(4);
    expect(result.collections![2].nodeIds.every(id => !ids.includes(id))).toBe(true);
    expect(result.collections![2].nodeIds[1]).toBe(result.collections![3].nodeIds[0]);
    expect(duplicateGroup(s, [ids[0]], gen).some(op => op.op === "addCollection")).toBe(false);
  });
  it("椭圆和圆完整包围所有实测外框角点，网格不重叠且轴线一致", () => {
    const s = fixture(), c = group("g_group001", ids);
    const geoms = { [ids[0]]: { w: 330, h: 280 }, [ids[1]]: { w: 50, h: 30 }, [ids[2]]: { w: 100, h: 120 } };
    for (const shape of ["ellipse", "circle"] as const) {
      const b = collectionBounds({ ...c, shape }, s.nodes, geoms);
      if (shape === "circle") expect(b.w).toBe(b.h);
      for (const n of s.nodes) for (const x of [n.x, n.x + geoms[n.id].w]) for (const y of [n.y, n.y + geoms[n.id].h]) {
        expect(((x - b.x - b.w / 2) / (b.w / 2)) ** 2 + ((y - b.y - b.h / 2) / (b.h / 2)) ** 2).toBeLessThan(1);
      }
    }
    const aligned = commit(s, arrangeCollectionOps(c, s.nodes, geoms, "vertical")).state;
    const centers = aligned.nodes.map(n => n.x + geoms[n.id].w / 2);
    expect(new Set(centers).size).toBe(1);
    const grid = commit(s, arrangeCollectionOps(c, s.nodes, geoms, "grid")).state.nodes;
    for (let i = 0; i < grid.length; i++) for (let j = i + 1; j < grid.length; j++) {
      const a = grid[i], b = grid[j];
      expect(a.x + geoms[a.id].w <= b.x || b.x + geoms[b.id].w <= a.x || a.y + geoms[a.id].h <= b.y || b.y + geoms[b.id].h <= a.y).toBe(true);
    }
  });
});
