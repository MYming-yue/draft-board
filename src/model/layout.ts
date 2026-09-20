// 布局整理（需求 §F07 / 契约 I4）：只产生 moveNode，不动内容、父子关系与关联线。
// 简单树状分层：根锚定原位（x 不变），按深度向右分层，子树垂直堆叠、父节点在子树上垂直居中；
// 多个根（选中多个分支）依次向下排列。整次整理 = 一个历史步骤里的多个 moveNode。
import { parentEdgeOf } from "./ops";
import type { BoardFile, BoardNode, Op } from "./types";

const GAP_X = 64;
const GAP_Y = 20;
const EST_H = 120; // h=null 自适应高度的保守估计

interface Placed {
  id: string;
  x: number;
  y: number;
}

function childrenOf(state: BoardFile, id: string): BoardNode[] {
  const ids = state.edges.filter((e) => e.kind === "parentChild" && e.from === id).map((e) => e.to);
  return ids.map((cid) => state.nodes.find((n) => n.id === cid)!).filter(Boolean);
}

function estH(n: BoardNode): number {
  return n.h ?? EST_H;
}

/** 放置整棵子树，返回子树块高。topY = 子树块顶；根节点在块内垂直居中。 */
function placeSubtree(
  state: BoardFile,
  rootId: string,
  x: number,
  topY: number,
  inBranch: Set<string>,
  out: Placed[],
): number {
  const node = state.nodes.find((n) => n.id === rootId)!;
  inBranch.add(rootId);
  const kids = childrenOf(state, rootId).filter((k) => !inBranch.has(k.id));
  const selfH = estH(node);
  if (kids.length === 0) {
    out.push({ id: rootId, x, y: topY });
    return selfH;
  }
  const childX = x + node.w + GAP_X;
  let cursor = topY;
  for (const k of kids) {
    cursor += placeSubtree(state, k.id, childX, cursor, inBranch, out) + GAP_Y;
  }
  const childrenH = cursor - GAP_Y - topY;
  const blockH = Math.max(childrenH, selfH);
  out.push({ id: rootId, x, y: topY + (blockH - selfH) / 2 });
  return blockH;
}

/**
 * 对给定根节点各自的分支做树状分层布局，返回 moveNode ops（可能有多个，属同一步骤）。
 * rootIds 中互为祖先的只保留最上的根；不在板上的 id 忽略；位置无变化的节点不产生 op。
 */
export function layoutBranchOps(state: BoardFile, rootIds: string[]): Op[] {
  const valid = rootIds.filter((id) => state.nodes.some((n) => n.id === id));
  // 去掉是其他所选根后代的根
  const roots = valid.filter((id) => {
    let cur = parentEdgeOf(state, id)?.from ?? null;
    const seen = new Set<string>();
    while (cur) {
      if (valid.includes(cur)) return false;
      if (seen.has(cur)) return false;
      seen.add(cur);
      cur = parentEdgeOf(state, cur)?.from ?? null;
    }
    return true;
  });
  if (roots.length === 0) return [];

  const placed: Placed[] = [];
  const inBranch = new Set<string>();
  let cursorY = Math.min(...roots.map((r) => state.nodes.find((n) => n.id === r)!.y));
  for (const rootId of roots) {
    const node = state.nodes.find((n) => n.id === rootId)!;
    const topY = Math.min(node.y, cursorY);
    cursorY = topY + placeSubtree(state, rootId, node.x, topY, inBranch, placed) + GAP_Y * 3;
  }

  const ops: Op[] = [];
  for (const p of placed) {
    const node = state.nodes.find((n) => n.id === p.id)!;
    if (Math.abs(node.x - p.x) < 0.5 && Math.abs(node.y - p.y) < 0.5) continue;
    ops.push({
      op: "moveNode",
      nodeId: p.id,
      before: { x: node.x, y: node.y },
      after: { x: Math.round(p.x), y: Math.round(p.y) },
    });
  }
  return ops;
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
