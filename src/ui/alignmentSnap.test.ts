import { describe, expect, it } from "vitest";
import { snapDragToCards, type SnapRect } from "./alignmentSnap";

const a: SnapRect = { id: "a", x: 0, y: 0, w: 100, h: 60 };
const b: SnapRect = { id: "b", x: 300, y: 200, w: 160, h: 100 };

describe("拖动智能对齐", () => {
  it("中心轴进入阈值时同时吸附横纵中轴并返回参考线", () => {
    const r = snapDragToCards([a], [b], { dx: 326, dy: 221 }, 8, 200, 200);
    expect(r.dx).toBe(330); // 50 + dx = 380 = B 中心
    expect(r.dy).toBe(220); // 30 + dy = 250 = B 中心
    expect(r.guides.map((g) => [g.axis, g.position])).toEqual([["x", 380], ["y", 250]]);
    expect(r.guides.every((g) => g.movingKind === "center" && g.targetKind === "center")).toBe(true);
  });

  it("边框可以同边对齐，也可以吸到另一张卡的相邻边", () => {
    const sameEdge = snapDragToCards([a], [b], { dx: 294, dy: 198 }, 8, 200, 200);
    expect(sameEdge.dx).toBe(300);
    expect(sameEdge.dy).toBe(200);
    const adjacent = snapDragToCards([a], [b], { dx: 193, dy: 400 }, 8, 200, 200);
    expect(adjacent.dx).toBe(200); // A 右边贴 B 左边
    expect(adjacent.guides).toHaveLength(1);
    expect(adjacent.guides[0]).toMatchObject({ axis: "x", movingKind: "end", targetKind: "start" });
  });

  it("超过阈值不吸附，横纵轴互不干扰", () => {
    const none = snapDragToCards([a], [b], { dx: 270, dy: 120 }, 8, 200, 200);
    expect(none).toEqual({ dx: 270, dy: 120, guides: [] });
    const xOnly = snapDragToCards([a], [b], { dx: 294, dy: 120 }, 8, 200, 200);
    expect(xOnly.dx).toBe(300);
    expect(xOnly.dy).toBe(120);
    expect(xOnly.guides.map((g) => g.axis)).toEqual(["x"]);
  });

  it("多选拖动按整体外框吸附并保持卡片间距", () => {
    const second = { id: "a2", x: 140, y: 20, w: 80, h: 40 };
    const r = snapDragToCards([a, second], [b], { dx: 186, dy: 220 }, 8, 200, 200);
    expect(r.dx).toBe(190); // 选择框中心 110 + 190 = B 中心 380
    expect(r.dy).toBe(220);
    expect((second.x + r.dx) - (a.x + r.dx)).toBe(140);
  });

  it("远处卡片即使轴线完全重合也不进入吸附搜索", () => {
    const far = { ...b, id: "far", y: 2000 };
    const r = snapDragToCards([a], [far], { dx: 330, dy: 0 }, 8, 96, 320);
    expect(r).toEqual({ dx: 330, dy: 0, guides: [] });
  });

  it("N 张卡片时只从当前位置附近寻找候选", () => {
    const nearby = { ...b, id: "nearby" };
    const farCards = Array.from({ length: 20 }, (_, i) => ({ ...b, id: `far-${i}`, y: 1000 + i * 200 }));
    const r = snapDragToCards([a], [...farCards, nearby], { dx: 326, dy: 221 }, 8, 96, 320);
    expect(r.guides).toHaveLength(2);
    expect(r.guides.every((g) => g.targetId === "nearby")).toBe(true);
  });

  it("搜索范围随 B 的卡片尺寸增大，96 为下限", () => {
    const small = { id: "small", x: 300, y: 220, w: 60, h: 40 };
    // A 移动后位于 small 上方，外框间距 90；虽然 small 很小，仍落在 96px 下限内。
    const smallResult = snapDragToCards([a], [small], { dx: 280, dy: 70 }, 8, 96, 320);
    expect(smallResult.guides.some((g) => g.targetId === "small")).toBe(true);

    const large = { id: "large", x: 300, y: 400, w: 600, h: 400 };
    // large 半对角线约 360，受 320 上限约束；250px 外仍应进入候选。
    const largeResult = snapDragToCards([a], [large], { dx: 550, dy: 90 }, 8, 96, 320);
    expect(largeResult.guides.some((g) => g.targetId === "large")).toBe(true);
  });

  it("超大卡的自适应搜索范围受 320 上限约束", () => {
    const huge = { id: "huge", x: 300, y: 500, w: 1200, h: 900 };
    // A 与 huge 相距 330px；即使轴线可对齐，也不应进入候选。
    const r = snapDragToCards([a], [huge], { dx: 850, dy: 110 }, 8, 96, 320);
    expect(r.guides).toEqual([]);
  });
});
