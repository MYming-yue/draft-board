export interface SnapRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AlignmentAxis = "x" | "y";
export type AlignmentKind = "start" | "center" | "end";

export interface AlignmentGuide {
  axis: AlignmentAxis;
  position: number;
  start: number;
  end: number;
  movingKind: AlignmentKind;
  targetKind: AlignmentKind;
  targetId: string;
}

export interface AlignmentSnapResult {
  dx: number;
  dy: number;
  guides: AlignmentGuide[];
}

function rectDistance(a: SnapRect, b: SnapRect): number {
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
  return Math.hypot(gapX, gapY);
}

interface Anchor {
  value: number;
  kind: AlignmentKind;
}

interface Candidate {
  correction: number;
  movingKind: AlignmentKind;
  targetKind: AlignmentKind;
  target: SnapRect;
  position: number;
}

const anchors = (start: number, size: number): Anchor[] => [
  { value: start, kind: "start" },
  { value: start + size / 2, kind: "center" },
  { value: start + size, kind: "end" },
];

function bounds(rects: readonly SnapRect[]): SnapRect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { id: "selection", x, y, w: right - x, h: bottom - y };
}

function bestCandidate(
  axis: AlignmentAxis,
  moving: SnapRect,
  targets: readonly SnapRect[],
  rawDelta: number,
  threshold: number,
): Candidate | null {
  const startKey = axis === "x" ? "x" : "y";
  const sizeKey = axis === "x" ? "w" : "h";
  const movingAnchors = anchors(moving[startKey], moving[sizeKey]);
  let best: Candidate | null = null;
  let bestScore = Infinity;
  for (const target of targets) {
    for (const ma of movingAnchors) {
      for (const ta of anchors(target[startKey], target[sizeKey])) {
        const correction = ta.value - (ma.value + rawDelta);
        if (Math.abs(correction) > threshold) continue;
        // 同类轴线（左对左、中对中、右对右）在相同距离时更符合视觉预期。
        const score = Math.abs(correction) * 10 + (ma.kind === ta.kind ? 0 : 1);
        if (score >= bestScore) continue;
        bestScore = score;
        best = {
          correction,
          movingKind: ma.kind,
          targetKind: ta.kind,
          target,
          position: ta.value,
        };
      }
    }
  }
  return best;
}

/**
 * 将拖动选择框的左/中/右、上/中/下轴与其他卡片对应轴吸附。
 * x/y 独立选择最近候选，允许一次拖动形成十字对齐；threshold 使用世界坐标。
 */
export function snapDragToCards(
  movingRects: readonly SnapRect[],
  targetRects: readonly SnapRect[],
  rawDelta: { dx: number; dy: number },
  threshold: number,
  minSearchRadius: number,
  maxSearchRadius: number,
): AlignmentSnapResult {
  const moving = bounds(movingRects);
  if (!moving || !targetRects.length || threshold <= 0 || minSearchRadius < 0 || maxSearchRadius < minSearchRadius)
    return { ...rawDelta, guides: [] };
  // 先按卡片外框的实际空间距离筛选局部邻居。只有拖到目标卡周围，
  // 才比较轴线；搜索半径随目标卡对角线增长，小卡不低于下限，大卡不超过上限。
  const rawMoved = { ...moving, x: moving.x + rawDelta.dx, y: moving.y + rawDelta.dy };
  const nearbyTargets = targetRects.filter((target) => {
    const adaptiveRadius = Math.min(maxSearchRadius, Math.max(minSearchRadius, Math.hypot(target.w, target.h) / 2));
    return rectDistance(rawMoved, target) <= adaptiveRadius;
  });
  if (!nearbyTargets.length) return { ...rawDelta, guides: [] };
  const xSnap = bestCandidate("x", moving, nearbyTargets, rawDelta.dx, threshold);
  const ySnap = bestCandidate("y", moving, nearbyTargets, rawDelta.dy, threshold);
  const dx = rawDelta.dx + (xSnap?.correction ?? 0);
  const dy = rawDelta.dy + (ySnap?.correction ?? 0);
  const moved = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const guides: AlignmentGuide[] = [];
  if (xSnap) {
    guides.push({
      axis: "x",
      position: xSnap.position,
      start: Math.min(moved.y, xSnap.target.y) - 16,
      end: Math.max(moved.y + moved.h, xSnap.target.y + xSnap.target.h) + 16,
      movingKind: xSnap.movingKind,
      targetKind: xSnap.targetKind,
      targetId: xSnap.target.id,
    });
  }
  if (ySnap) {
    guides.push({
      axis: "y",
      position: ySnap.position,
      start: Math.min(moved.x, ySnap.target.x) - 16,
      end: Math.max(moved.x + moved.w, ySnap.target.x + ySnap.target.w) + 16,
      movingKind: ySnap.movingKind,
      targetKind: ySnap.targetKind,
      targetId: ySnap.target.id,
    });
  }
  return { dx, dy, guides };
}
