import type { BoardNode, LayoutGeometry } from "../model";

/** 点击整理时同步读取最终 DOM，避免 ResizeObserver 的上一帧测量或 zoom 误差。 */
export function measureLayoutGeometry(nodes: BoardNode[]): LayoutGeometry | null {
  const world = document.querySelector<HTMLElement>(".world");
  if (!world || document.fonts.status === "loading") return null;
  if ([...world.querySelectorAll("img")].some(img => !img.complete || !img.naturalWidth)) return null;
  const geometry: LayoutGeometry = {};
  for (const card of world.querySelectorAll<HTMLElement>(".node-card[data-node-id]")) {
    // 卡片使用 border-box；CSS 使用值在世界坐标中，不受父级缩放矩阵和屏幕位置舍入影响。
    const style = getComputedStyle(card);
    geometry[card.dataset.nodeId!] = { w: parseFloat(style.width), h: parseFloat(style.height) };
  }
  return nodes.every(n => geometry[n.id]?.w > 0 && geometry[n.id]?.h > 0) ? geometry : null;
}
