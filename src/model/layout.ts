// 只产生 moveNode：实测外框布局、稳定视觉顺序、整分支避让；一次整理一个历史步骤。
import { parentEdgeOf } from "./ops";
import { collectionBounds } from "./collections";
import type { BoardFile, BoardNode, Op } from "./types";

const GAP_X = 36;
const GAP_Y = 16;
const ROOT_GAP = 24;
const EST_H = 120;
export type LayoutGeometry = Record<string, { w: number; h: number }>;
export interface LayoutOptions { aspectRatio?: number }
interface Placed { id: string; x: number; y: number; w: number; h: number }
interface TreeBlock { nodes: Placed[]; w: number; h: number }

/**
 * roots 及其 parentChild 后代参与整理；其他卡片原地保留，作为障碍。
 * UI 必须传当前可见外框（世界坐标），无 DOM 的调用方可传测量值或使用存档尺寸估算。
 * 按真实卡片轮廓整组向下避让障碍，不逐张挤散已排好的树；不为未选中的卡片产生 moveNode。
 */
export function layoutBranchOps(state: BoardFile, rootIds: string[], geometry: LayoutGeometry = {}, options: LayoutOptions = {}): Op[] {
  const byId = new Map(state.nodes.map(n => [n.id, n]));
  const order = (a: string, b: string) => {
    const na = byId.get(a)!, nb = byId.get(b)!;
    return na.y - nb.y || na.x - nb.x || a.localeCompare(b);
  };
  const valid = new Set(rootIds.filter(id => byId.has(id)));
  const roots = [...valid].filter(id => {
    let cur = parentEdgeOf(state, id)?.from;
    const seen = new Set<string>();
    while (cur) {
      if (valid.has(cur) || seen.has(cur)) return false;
      seen.add(cur);
      cur = parentEdgeOf(state, cur)?.from;
    }
    return true;
  }).sort(order);
  if (!roots.length) return [];
  const children = new Map<string, string[]>();
  for (const e of state.edges) if (e.kind === "parentChild" && byId.has(e.to)) {
    children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
  }
  for (const ids of children.values()) ids.sort(order);
  const positive = (value: number | undefined, fallback: number) =>
    value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
  const size = (n: BoardNode) => ({
    w: Math.ceil(positive(geometry[n.id]?.w, n.w) - 1e-6),
    h: Math.ceil(positive(geometry[n.id]?.h, n.h ?? EST_H) - 1e-6),
  });
  const included = new Set<string>();
  const build = (id: string): TreeBlock => {
    included.add(id);
    const self = size(byId.get(id)!);
    const kids: TreeBlock[] = [];
    for (const child of children.get(id) ?? []) if (!included.has(child)) kids.push(build(child));
    const kidsH = kids.reduce((sum, k) => sum + k.h, 0) + Math.max(0, kids.length - 1) * GAP_Y;
    const h = Math.max(self.h, kidsH);
    const nodes: Placed[] = [{ id, x: 0, y: Math.floor((h - self.h) / 2), ...self }];
    let y = Math.floor((h - kidsH) / 2);
    for (const k of kids) {
      nodes.push(...k.nodes.map(n => ({ ...n, x: n.x + self.w + GAP_X, y: n.y + y })));
      y += k.h + GAP_Y;
    }
    return { nodes, w: Math.max(...nodes.map(n => n.x + n.w)), h };
  };
  const blocks = roots.map(id => ({ id, block: build(id) }));
  // 用整条分支原有外框排序：不同高度的父卡居中不会改变下一次整理的阅读顺序。
  const originalBounds = (block: TreeBlock) => ({
    x: Math.min(...block.nodes.map(n => byId.get(n.id)!.x)),
    y: Math.min(...block.nodes.map(n => byId.get(n.id)!.y)),
  });
  blocks.sort((a, b) => {
    const ba = originalBounds(a.block), bb = originalBounds(b.block);
    return ba.y - bb.y || ba.x - bb.x || a.id.localeCompare(b.id);
  });
  // 集合成员作为连续布局块，边界自身也留出间距，避免事后把大批卡片推到下方。
  let layoutBlocks = blocks;
  if (state.collections?.length && blocks.length > 1) {
    const claimed = new Set<string>();
    const grouped: typeof blocks = [];
    for (const collection of state.collections) {
      const memberIds = new Set(collection.nodeIds);
      const members = blocks.filter(({ id, block }) => !claimed.has(id) && block.nodes.every(n => memberIds.has(n.id)));
      if (!members.length) continue;
      members.forEach(({ id }) => claimed.add(id));
      const aspect = Number.isFinite(options.aspectRatio) && (options.aspectRatio ?? 0) > 0 ? options.aspectRatio! : 1.6;
      const cols = Math.max(1, Math.round(Math.sqrt(members.length * Math.min(aspect, 1.3))));
      const nodes: Placed[] = [];
      let x = 0, y = 0, rowH = 0;
      for (let i = 0; i < members.length; i++) {
        const block = members[i].block;
        if (i > 0 && i % cols === 0) { x = 0; y += rowH + ROOT_GAP; rowH = 0; }
        nodes.push(...block.nodes.map(n => ({ ...n, x: n.x + x, y: n.y + y })));
        x += block.w + ROOT_GAP;
        rowH = Math.max(rowH, block.h);
      }
      const virtualNodes = nodes.map(n => ({ ...byId.get(n.id)!, x: n.x, y: n.y }));
      const bounds = collectionBounds(collection, virtualNodes, geometry);
      const margin = 12;
      const shiftX = margin - bounds.x, shiftY = margin - bounds.y;
      grouped.push({ id: members[0].id, block: {
        nodes: nodes.map(n => ({ ...n, x: n.x + shiftX, y: n.y + shiftY })),
        w: Math.ceil(bounds.w + 2 * margin), h: Math.ceil(bounds.h + 2 * margin),
      } });
    }
    layoutBlocks = [...grouped, ...blocks.filter(({ id }) => !claimed.has(id))].sort((a, b) => {
      const ba = originalBounds(a.block), bb = originalBounds(b.block);
      return ba.y - bb.y || ba.x - bb.x || a.id.localeCompare(b.id);
    });
  }
  const obstacles = state.nodes.filter(n => !included.has(n.id)).map(n => ({ x: n.x, y: n.y, ...size(n) }));
  const placed: Placed[] = [];
  let originX: number, originY: number;
  if (blocks.length === 1) {
    const root = byId.get(blocks[0].id)!;
    originX = Math.round(root.x);
    originY = Math.round(root.y - blocks[0].block.nodes[0].y);
    placed.push(...blocks[0].block.nodes);
  } else {
    originX = Math.round(Math.min(...layoutBlocks.map(b => originalBounds(b.block).x)));
    originY = Math.round(Math.min(...layoutBlocks.map(b => originalBounds(b.block).y)));
    // 试出与当前窗口宽高比最接近的分行宽度；尺寸来自卡片而非窗口像素。
    const aspect = Number.isFinite(options.aspectRatio) && (options.aspectRatio ?? 0) > 0 ? options.aspectRatio! : 1.6;
    const area = layoutBlocks.reduce((sum, { block }) => sum + (block.w + ROOT_GAP) * (block.h + ROOT_GAP), 0);
    const widths = new Set<number>([Math.ceil(Math.sqrt(area * aspect))]);
    // 每种列数都考虑最宽的连续组，避免前几张较窄时出现 4/4/3/1 的孤行。
    for (let count = 1; count <= layoutBlocks.length; count++) {
      for (let first = 0; first + count <= layoutBlocks.length; first++) {
        widths.add(layoutBlocks.slice(first, first + count).reduce((sum, { block }) => sum + block.w, 0) + (count - 1) * ROOT_GAP);
      }
    }
    const packing = (limit: number) => {
      let x = 0, y = 0, rowH = 0, usedW = 0;
      const rowWidths: number[] = [];
      for (const { block } of layoutBlocks) {
        if (x > 0 && x + block.w > limit) {
          rowWidths.push(x - ROOT_GAP);
          x = 0; y += rowH + ROOT_GAP; rowH = 0;
        }
        usedW = Math.max(usedW, x + block.w);
        x += block.w + ROOT_GAP;
        rowH = Math.max(rowH, block.h);
      }
      rowWidths.push(x - ROOT_GAP);
      return { w: usedW, h: y + rowH, rowWidths };
    };
    const score = (r: ReturnType<typeof packing>) => {
      const raggedness = r.rowWidths.reduce((sum, width) => sum + ((r.w - width) / r.w) ** 2, 0) / r.rowWidths.length;
      return Math.abs(Math.log((r.w / r.h) / aspect)) + 0.06 * (r.w * r.h / area) + 1.5 * raggedness;
    };
    const rowWidth = [...widths].reduce((best, candidate) => score(packing(candidate)) < score(packing(best)) ? candidate : best);
    let x = 0, y = 0, rowH = 0;
    for (const { block } of layoutBlocks) {
      if (x > 0 && x + block.w > rowWidth) { x = 0; y += rowH + ROOT_GAP; rowH = 0; }
      placed.push(...block.nodes.map(n => ({ ...n, x: n.x + x, y: n.y + y })));
      x += block.w + ROOT_GAP;
      rowH = Math.max(rowH, block.h);
    }
  }
  // 只检查真实矩形，允许未选中的卡片留在树的空白区域；保持排好后的相对关系。
  for (;;) {
    let nextY = originY;
    for (const n of placed) for (const o of obstacles) {
      const x = n.x + originX, y = n.y + originY;
      if (x < o.x + o.w + GAP_Y && x + n.w + GAP_Y > o.x && y < o.y + o.h + GAP_Y && y + n.h + GAP_Y > o.y)
        nextY = Math.max(nextY, Math.ceil(o.y + o.h + GAP_Y - n.y));
    }
    if (nextY === originY) break;
    originY = nextY;
  }
  for (const p of placed) { p.x += originX; p.y += originY; }
  return placed.flatMap((p): Op[] => {
    const n = byId.get(p.id)!;
    return n.x === p.x && n.y === p.y ? [] : [{ op: "moveNode", nodeId: p.id, before: { x: n.x, y: n.y }, after: { x: p.x, y: p.y } }];
  });
}

/** 森林的全部根（无父节点）。 */
export function forestRoots(state: BoardFile): string[] {
  return state.nodes.filter((n) => !parentEdgeOf(state, n.id)).map((n) => n.id);
}

/**
 * 新卡落点避让（需求 §F04/F07）：在 (x, y) 起扫描全部节点矩形（四周含 gap 间距），
 * 若有重叠则跳到障碍卡正下方（gap 间距）重查，形成有序竖排展开而非随机跳。
 * heights 缺测时按 estH 保守估计。
 */
export function resolveOverlapPos(
  nodes: readonly { id: string; x: number; y: number; w: number; h?: number | null }[],
  heights: Record<string, number> | undefined,
  x: number,
  y: number,
  w: number,
  opts: { gap?: number; estH?: number; widths?: Record<string, number> } = {},
): { x: number; y: number } {
  const gap = opts.gap ?? 24;
  const estH = opts.estH ?? 120;
  // 实测外框已包含文本 min-height，公式卡则可能比存档高度更紧凑。
  const outerH = (n: { id: string; h?: number | null }) => heights?.[n.id] ?? n.h ?? estH;
  const outerW = (n: { id: string; w: number }) => opts.widths?.[n.id] ?? n.w;
  let nx = x;
  let ny = y;
  for (let i = 0; i < 60; i++) {
    const hit = nodes.find(
      (n) => nx < n.x + outerW(n) + gap && nx + w + gap > n.x && ny < n.y + outerH(n) + gap && ny + estH + gap > n.y,
    );
    if (!hit) break;
    ny = hit.y + outerH(hit) + gap;
  }
  return { x: Math.round(nx), y: Math.round(ny) };
}
