export interface CanvasView {
  panX: number;
  panY: number;
  zoom: number;
}

export const MIN_CANVAS_ZOOM = 0.1;
export const MAX_CANVAS_ZOOM = 4;
export const ALT_DRAG_ZOOM_SENSITIVITY = 0.005;

export function clampCanvasZoom(zoom: number): number {
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
}

/** 围绕画布内的屏幕锚点缩放，让锚点下的世界坐标保持不动。 */
export function zoomViewAt(view: CanvasView, anchorX: number, anchorY: number, zoom: number): CanvasView {
  const nextZoom = clampCanvasZoom(zoom);
  return {
    zoom: nextZoom,
    panX: anchorX - ((anchorX - view.panX) / view.zoom) * nextZoom,
    panY: anchorY - ((anchorY - view.panY) / view.zoom) * nextZoom,
  };
}

/** Alt+左键纵向拖动：上移（负值）缩小，下移（正值）放大。 */
export function zoomViewByVerticalDrag(
  view: CanvasView,
  anchorX: number,
  anchorY: number,
  deltaY: number,
): CanvasView {
  return zoomViewAt(view, anchorX, anchorY, view.zoom * Math.exp(deltaY * ALT_DRAG_ZOOM_SENSITIVITY));
}

export function panCanvasView(view: CanvasView, dx: number, dy: number): CanvasView {
  return { ...view, panX: view.panX + dx, panY: view.panY + dy };
}
