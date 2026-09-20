import { describe, expect, it } from "vitest";
import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM, panCanvasView, zoomViewAt, zoomViewByVerticalDrag } from "./view";

describe("画布视图缩放", () => {
  const view = { panX: 35, panY: -20, zoom: 1.25 };
  const anchor = { x: 480, y: 310 };

  it("Alt+左键上拖缩小、下拖放大", () => {
    expect(zoomViewByVerticalDrag(view, anchor.x, anchor.y, -100).zoom).toBeLessThan(view.zoom);
    expect(zoomViewByVerticalDrag(view, anchor.x, anchor.y, 100).zoom).toBeGreaterThan(view.zoom);
  });

  it("缩放前后锚点下的世界坐标不变", () => {
    const before = {
      x: (anchor.x - view.panX) / view.zoom,
      y: (anchor.y - view.panY) / view.zoom,
    };
    const next = zoomViewByVerticalDrag(view, anchor.x, anchor.y, 140);
    expect((anchor.x - next.panX) / next.zoom).toBeCloseTo(before.x, 10);
    expect((anchor.y - next.panY) / next.zoom).toBeCloseTo(before.y, 10);
  });

  it("沿用 10%–400% 的画布缩放边界", () => {
    expect(zoomViewAt(view, anchor.x, anchor.y, 0.001).zoom).toBe(MIN_CANVAS_ZOOM);
    expect(zoomViewAt(view, anchor.x, anchor.y, 100).zoom).toBe(MAX_CANVAS_ZOOM);
  });

  it("画布平移只改变偏移量，不改变缩放", () => {
    expect(panCanvasView(view, -60, 60)).toEqual({ panX: -25, panY: 40, zoom: 1.25 });
  });
});
