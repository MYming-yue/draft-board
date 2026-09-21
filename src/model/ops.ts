// 契约 §2-C 操作词汇表的纯函数实现。
// 原子性：全部 op 在状态的深拷贝上顺序校验+应用，任一失败则整体丢弃，输入状态零改动。
// 回放确定性：本模块内部从不生成随机 id；reparent 需要新边时使用状态确定性 id。
import { err } from "./errors";
import type {
  ApplyResult,
  BatchError,
  BoardEdge,
  BoardFile,
  BoardNode,
  Op,
} from "./types";
import { validateOpShape } from "./validate";

export function findNode(state: BoardFile, id: string): BoardNode | undefined {
  return state.nodes.find((n) => n.id === id);
}
export function findEdge(state: BoardFile, id: string): BoardEdge | undefined {
  return state.edges.find((e) => e.id === id);
}
/** 节点的入向 parentChild 边（I2：至多一条）。 */
export function parentEdgeOf(state: BoardFile, nodeId: string): BoardEdge | undefined {
  return state.edges.find((e) => e.kind === "parentChild" && e.to === nodeId);
}
export function parentOf(state: BoardFile, nodeId: string): string | null {
  return parentEdgeOf(state, nodeId)?.from ?? null;
}
/** 自 startId 沿父链向上走，若能到达 targetId 则为 true（成环判定）。 */
export function reachesViaParents(state: BoardFile, startId: string, targetId: string): boolean {
  let cur: string | null = startId;
  const seen = new Set<string>();
  while (cur !== null) {
    if (cur === targetId) return true;
    if (seen.has(cur)) return false; // 数据已有环时防死循环
    seen.add(cur);
    cur = parentOf(state, cur);
  }
  return false;
}
/** reparent 建边用的确定性 id：同一状态下回放必得同一 id。 */
function deterministicParentEdgeId(state: BoardFile, nodeId: string): string {
  const base = "e_pc_" + nodeId.slice(2, 31);
  let id = base;
  while (findEdge(state, id)) id += "r";
  return id.slice(0, 34);
}

function fail(error: BatchError): ApplyResult {
  return { ok: false, error };
}

/**
 * 应用一批 op。成功返回新状态与归一化后的 op（before 按应用时真实状态重算，
 * 保证撤销/回放所依据的 before 永远准确，与调用方填写无关）。
 */
export function applyOps(input: BoardFile, ops: Op[]): ApplyResult {
  const state = structuredClone(input);
  const normalized: Op[] = [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const bad = validateOpShape(op);
    if (bad) return fail(err("E_SCHEMA", `op 形状非法：${bad.message}`, i, `ops.${i}.${bad.path}`));
    const at = (path: string) => `ops.${i}.${path}`;

    switch (op.op) {
      case "addNode": {
        const node = structuredClone(op.node);
        if (findNode(state, node.id)) return fail(err("E_DUP_ID", `节点 id 已存在：${node.id}`, i, at("node.id")));
        if (node.type === "image" && !state.assets.some((a) => a.id === node.assetId))
          return fail(err("E_UNKNOWN_ASSET", `assetId 无对应 assets 条目：${node.assetId}`, i, at("node.assetId")));
        state.nodes.push(node);
        normalized.push({ op: "addNode", node, before: null, after: structuredClone(node) });
        break;
      }
      case "removeNode": {
        const node = findNode(state, op.nodeId);
        if (!node) return fail(err("E_UNKNOWN_NODE", `节点不存在：${op.nodeId}`, i, at("nodeId")));
        // I1：关联边同步骤级联移除
        const cascaded = state.edges.filter((e) => e.from === node.id || e.to === node.id);
        state.edges = state.edges.filter((e) => e.from !== node.id && e.to !== node.id);
        state.nodes = state.nodes.filter((n) => n.id !== node.id);
        normalized.push({
          op: "removeNode",
          nodeId: node.id,
          before: { node: structuredClone(node), edges: structuredClone(cascaded) },
          after: null,
        });
        break;
      }
      case "updateNodeText": {
        const node = findNode(state, op.nodeId);
        if (!node) return fail(err("E_UNKNOWN_NODE", `节点不存在：${op.nodeId}`, i, at("nodeId")));
        // text 节点 = 正文；image 节点 = caption（formatVersion 1.0 内向后兼容演进）
        const before = { markdown: node.markdown ?? "" };
        node.markdown = op.after.markdown;
        normalized.push({ op: "updateNodeText", nodeId: node.id, before, after: { markdown: op.after.markdown } });
        break;
      }
      case "updateNodeCaption": {
        const node = findNode(state, op.nodeId);
        if (!node) return fail(err("E_UNKNOWN_NODE", `节点不存在：${op.nodeId}`, i, at("nodeId")));
        if (node.type !== "text") return fail(err("E_SCHEMA", "独立备注仅适用于文本/公式卡", i, at("nodeId")));
        const before = { caption: node.caption ?? null };
        if (op.after.caption === null) delete node.caption;
        else node.caption = op.after.caption;
        normalized.push({ op: "updateNodeCaption", nodeId: node.id, before, after: { ...op.after } });
        break;
      }
      case "moveNode": {
        const node = findNode(state, op.nodeId);
        if (!node) return fail(err("E_UNKNOWN_NODE", `节点不存在：${op.nodeId}`, i, at("nodeId")));
        const before = { x: node.x, y: node.y };
        node.x = op.after.x;
        node.y = op.after.y;
        normalized.push({ op: "moveNode", nodeId: node.id, before, after: { x: op.after.x, y: op.after.y } });
        break;
      }
      case "resizeNode": {
        const node = findNode(state, op.nodeId);
        if (!node) return fail(err("E_UNKNOWN_NODE", `节点不存在：${op.nodeId}`, i, at("nodeId")));
        const before: { w: number; h: number | null; coreScale?: number | null } = { w: node.w, h: node.h ?? null };
        const after: { w: number; h: number | null; coreScale?: number | null } = { w: op.after.w, h: op.after.h };
        node.w = op.after.w;
        node.h = op.after.h;
        if (op.after.coreScale !== undefined) {
          before.coreScale = node.coreScale ?? null;
          after.coreScale = op.after.coreScale;
          if (op.after.coreScale === null) delete node.coreScale;
          else node.coreScale = op.after.coreScale;
        }
        normalized.push({ op: "resizeNode", nodeId: node.id, before, after });
        break;
      }
      case "setNodeAccent": {
        const node = findNode(state, op.nodeId);
        if (!node) return fail(err("E_UNKNOWN_NODE", `节点不存在：${op.nodeId}`, i, at("nodeId")));
        const before = { accent: node.accent ?? ("default" as const) };
        node.accent = op.after.accent;
        normalized.push({ op: "setNodeAccent", nodeId: node.id, before, after: { accent: op.after.accent } });
        break;
      }
      case "setCaptionExpanded": {
        const node = findNode(state, op.nodeId);
        if (!node) return fail(err("E_UNKNOWN_NODE", `节点不存在：${op.nodeId}`, i, at("nodeId")));
        const before = { expanded: Boolean(node.captionExpanded) };
        if (op.after.expanded) node.captionExpanded = true;
        else delete node.captionExpanded;
        normalized.push({ op: "setCaptionExpanded", nodeId: node.id, before, after: { expanded: op.after.expanded } });
        break;
      }
      case "setCaptionWidth": {
        const node = findNode(state, op.nodeId);
        if (!node) return fail(err("E_UNKNOWN_NODE", `节点不存在：${op.nodeId}`, i, at("nodeId")));
        const before = { captionW: node.captionW ?? null };
        if (op.after.captionW === null) delete node.captionW;
        else node.captionW = op.after.captionW;
        normalized.push({ op: "setCaptionWidth", nodeId: node.id, before, after: { captionW: op.after.captionW } });
        break;
      }
      case "addEdge": {
        const edge = structuredClone(op.edge);
        if (findEdge(state, edge.id)) return fail(err("E_DUP_ID", `边 id 已存在：${edge.id}`, i, at("edge.id")));
        if (!findNode(state, edge.from))
          return fail(err("E_UNKNOWN_NODE", `边起点不存在：${edge.from}`, i, at("edge.from")));
        if (!findNode(state, edge.to))
          return fail(err("E_UNKNOWN_NODE", `边终点不存在：${edge.to}`, i, at("edge.to")));
        if (edge.kind === "parentChild") {
          if (parentEdgeOf(state, edge.to))
            return fail(err("E_MULTI_PARENT", `节点已有父节点：${edge.to}（换父请用 reparent）`, i, at("edge.to")));
          if (edge.from === edge.to || reachesViaParents(state, edge.from, edge.to))
            return fail(err("E_PARENT_CYCLE", `parentChild 成环：${edge.from}→${edge.to}`, i, at("edge.from")));
        }
        state.edges.push(edge);
        normalized.push({ op: "addEdge", edge, before: null, after: structuredClone(edge) });
        break;
      }
      case "removeEdge": {
        const edge = findEdge(state, op.edgeId);
        if (!edge) return fail(err("E_UNKNOWN_EDGE", `边不存在：${op.edgeId}`, i, at("edgeId")));
        state.edges = state.edges.filter((e) => e.id !== edge.id);
        normalized.push({ op: "removeEdge", edgeId: edge.id, before: structuredClone(edge), after: null });
        break;
      }
      case "updateEdge": {
        const edge = findEdge(state, op.edgeId);
        if (!edge) return fail(err("E_UNKNOWN_EDGE", `边不存在：${op.edgeId}`, i, at("edgeId")));
        const { from, to, label, directed } = op.after;
        if (!findNode(state, from)) return fail(err("E_UNKNOWN_NODE", `边起点不存在：${from}`, i, at("after.from")));
        if (!findNode(state, to)) return fail(err("E_UNKNOWN_NODE", `边终点不存在：${to}`, i, at("after.to")));
        if (edge.kind === "parentChild") {
          if (directed !== true)
            return fail(err("E_SCHEMA", "parentChild 边 directed 恒为 true", i, at("after.directed")));
          const other = state.edges.find((e) => e.kind === "parentChild" && e.to === to && e.id !== edge.id);
          if (other) return fail(err("E_MULTI_PARENT", `节点已有父节点：${to}`, i, at("after.to")));
          // 以「本边已改端点」的视角查环：自新父沿父链向上不得到达新子
          const saved = { from: edge.from, to: edge.to };
          edge.from = from;
          edge.to = to;
          const cycle = from === to || reachesViaParents(state, from, to);
          edge.from = saved.from;
          edge.to = saved.to;
          if (cycle) return fail(err("E_PARENT_CYCLE", `parentChild 成环：${from}→${to}`, i, at("after.from")));
        }
        const before = { from: edge.from, to: edge.to, label: edge.label, directed: edge.directed };
        edge.from = from;
        edge.to = to;
        edge.directed = directed;
        if (label === undefined) delete edge.label;
        else edge.label = label;
        normalized.push({ op: "updateEdge", edgeId: edge.id, before, after: structuredClone(op.after) });
        break;
      }
      case "reparent": {
        const node = findNode(state, op.nodeId);
        if (!node) return fail(err("E_UNKNOWN_NODE", `节点不存在：${op.nodeId}`, i, at("nodeId")));
        const newParent = op.after.parentId;
        if (newParent !== null && !findNode(state, newParent))
          return fail(err("E_UNKNOWN_NODE", `新父节点不存在：${newParent}`, i, at("after.parentId")));
        if (newParent !== null && (newParent === node.id || reachesViaParents(state, newParent, node.id)))
          return fail(err("E_PARENT_CYCLE", `reparent 成环：${node.id} → ${newParent}`, i, at("after.parentId")));
        const pe = parentEdgeOf(state, node.id);
        const before = { parentId: pe?.from ?? null };
        if (pe && newParent === null) {
          state.edges = state.edges.filter((e) => e.id !== pe.id); // 脱离成根
        } else if (pe && newParent !== null) {
          pe.from = newParent; // 保留边身份，只换父
        } else if (!pe && newParent !== null) {
          state.edges.push({
            id: deterministicParentEdgeId(state, node.id),
            kind: "parentChild",
            from: newParent,
            to: node.id,
            directed: true,
          });
        }
        // 普通关联线不动（B1）
        normalized.push({ op: "reparent", nodeId: node.id, before, after: { parentId: newParent } });
        break;
      }
    }
  }
  return { ok: true, state, ops: normalized };
}

/**
 * 计算一批 op 的逆操作（按相反顺序）。before 以 ops 内记录为准，
 * 由 applyOps 在应用时再按真实状态重算校正。
 */
export function invertOps(ops: Op[]): Op[] {
  const inverse: Op[] = [];
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    switch (op.op) {
      case "addNode":
        inverse.push({ op: "removeNode", nodeId: op.node.id, before: null, after: null });
        break;
      case "removeNode": {
        if (!op.before) throw new Error("removeNode 缺 before，无法求逆");
        inverse.push({ op: "addNode", node: structuredClone(op.before.node), before: null, after: structuredClone(op.before.node) });
        for (const edge of op.before.edges)
          inverse.push({ op: "addEdge", edge: structuredClone(edge), before: null, after: structuredClone(edge) });
        break;
      }
      case "updateNodeText":
        if (!op.before) throw new Error("updateNodeText 缺 before，无法求逆");
        inverse.push({ op: "updateNodeText", nodeId: op.nodeId, before: null, after: { markdown: op.before.markdown } });
        break;
      case "updateNodeCaption":
        if (!op.before) throw new Error("updateNodeCaption 缺 before，无法求逆");
        inverse.push({ op: "updateNodeCaption", nodeId: op.nodeId, before: null, after: { ...op.before } });
        break;
      case "moveNode":
        if (!op.before) throw new Error("moveNode 缺 before，无法求逆");
        inverse.push({ op: "moveNode", nodeId: op.nodeId, before: null, after: { x: op.before.x, y: op.before.y } });
        break;
      case "resizeNode":
        if (!op.before) throw new Error("resizeNode 缺 before，无法求逆");
        inverse.push({
          op: "resizeNode",
          nodeId: op.nodeId,
          before: null,
          after: {
            w: op.before.w,
            h: op.before.h,
            ...(op.before.coreScale !== undefined ? { coreScale: op.before.coreScale } : {}),
          },
        });
        break;
      case "setNodeAccent":
        if (!op.before) throw new Error("setNodeAccent 缺 before，无法求逆");
        inverse.push({ op: "setNodeAccent", nodeId: op.nodeId, before: null, after: { accent: op.before.accent } });
        break;
      case "setCaptionExpanded":
        if (!op.before) throw new Error("setCaptionExpanded 缺 before，无法求逆");
        inverse.push({ op: "setCaptionExpanded", nodeId: op.nodeId, before: null, after: { expanded: op.before.expanded } });
        break;
      case "setCaptionWidth":
        if (!op.before) throw new Error("setCaptionWidth 缺 before，无法求逆");
        inverse.push({ op: "setCaptionWidth", nodeId: op.nodeId, before: null, after: { captionW: op.before.captionW } });
        break;
      case "addEdge":
        inverse.push({ op: "removeEdge", edgeId: op.edge.id, before: null, after: null });
        break;
      case "removeEdge":
        if (!op.before) throw new Error("removeEdge 缺 before，无法求逆");
        inverse.push({ op: "addEdge", edge: structuredClone(op.before), before: null, after: structuredClone(op.before) });
        break;
      case "updateEdge":
        if (!op.before) throw new Error("updateEdge 缺 before，无法求逆");
        inverse.push({ op: "updateEdge", edgeId: op.edgeId, before: null, after: { ...op.before } });
        break;
      case "reparent":
        if (!op.before) throw new Error("reparent 缺 before，无法求逆");
        inverse.push({ op: "reparent", nodeId: op.nodeId, before: null, after: { parentId: op.before.parentId } });
        break;
    }
  }
  return inverse;
}
