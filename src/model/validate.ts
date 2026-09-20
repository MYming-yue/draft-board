// 契约 §2-B/§2-D 的 JSON Schema 校验（手写实现，不引 ajv）。
// 每个校验器返回 null（通过）或 { path, message }（首个违例）。
import { ID_PATTERNS } from "./ids";
import { ACCENTS, OP_NAMES } from "./types";

export interface ShapeViolation {
  path: string;
  message: string;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isInt = (v: unknown): v is number => Number.isInteger(v);

function v(path: string, message: string): ShapeViolation {
  return { path, message };
}

export function validateNodeShape(n: unknown, path = "node"): ShapeViolation | null {
  if (!isObj(n)) return v(path, "节点必须是对象");
  if (!isStr(n.id) || !ID_PATTERNS.node.test(n.id)) return v(`${path}.id`, "节点 id 须匹配 ^n_[A-Za-z0-9_-]{6,32}$");
  if (n.type !== "text" && n.type !== "image") return v(`${path}.type`, "type 须为 text|image");
  if (n.type === "text" && !isStr(n.markdown)) return v(`${path}.markdown`, "text 节点必须有 markdown 字符串");
  if (n.markdown !== undefined && !isStr(n.markdown)) return v(`${path}.markdown`, "markdown 须为字符串");
  if (n.caption !== undefined && (n.type !== "text" || !isStr(n.caption)))
    return v(`${path}.caption`, "caption 仅用于 text 节点，须为字符串");
  if (n.type === "image" && (!isStr(n.assetId) || !ID_PATTERNS.asset.test(n.assetId)))
    return v(`${path}.assetId`, "image 节点必须有合法 assetId");
  if (n.assetId !== undefined && (!isStr(n.assetId) || !ID_PATTERNS.asset.test(n.assetId)))
    return v(`${path}.assetId`, "assetId 须匹配 ^a_[A-Za-z0-9_-]{6,32}$");
  if (!isNum(n.x) || !isNum(n.y)) return v(`${path}.x`, "x/y 须为有限数值");
  if (!isNum(n.w) || n.w <= 0) return v(`${path}.w`, "w 须为 >0 的数值");
  if (n.h !== undefined && n.h !== null && (!isNum(n.h) || (n.h as number) <= 0))
    return v(`${path}.h`, "h 须为 null 或 >0 的数值");
  if (n.accent !== undefined && !ACCENTS.includes(n.accent as never))
    return v(`${path}.accent`, "accent 须为 default|blue|green|amber|red");
  return null;
}

export function validateEdgeShape(e: unknown, path = "edge"): ShapeViolation | null {
  if (!isObj(e)) return v(path, "边必须是对象");
  if (!isStr(e.id) || !ID_PATTERNS.edge.test(e.id)) return v(`${path}.id`, "边 id 须匹配 ^e_[A-Za-z0-9_-]{6,32}$");
  if (e.kind !== "association" && e.kind !== "parentChild") return v(`${path}.kind`, "kind 须为 association|parentChild");
  if (!isStr(e.from) || !ID_PATTERNS.node.test(e.from)) return v(`${path}.from`, "from 须为合法节点 id");
  if (!isStr(e.to) || !ID_PATTERNS.node.test(e.to)) return v(`${path}.to`, "to 须为合法节点 id");
  if (typeof e.directed !== "boolean") return v(`${path}.directed`, "directed 须为布尔值");
  if (e.kind === "parentChild" && e.directed !== true) return v(`${path}.directed`, "parentChild 边 directed 恒为 true");
  if (e.label !== undefined && !isStr(e.label)) return v(`${path}.label`, "label 须为字符串");
  return null;
}

export function validateAssetShape(a: unknown, path = "asset"): ShapeViolation | null {
  if (!isObj(a)) return v(path, "资源必须是对象");
  if (!isStr(a.id) || !ID_PATTERNS.asset.test(a.id)) return v(`${path}.id`, "资源 id 须匹配 ^a_[A-Za-z0-9_-]{6,32}$");
  if (a.mime !== "image/png" && a.mime !== "image/jpeg") return v(`${path}.mime`, "mime 须为 image/png|image/jpeg");
  if (!isStr(a.path) || !ID_PATTERNS.assetPath.test(a.path))
    return v(`${path}.path`, "path 须形如 assets/a_….png|jpg|jpeg");
  const ext = (a.path as string).split(".").pop()!;
  if (a.mime === "image/png" && ext !== "png") return v(`${path}.path`, "mime 与扩展名不一致");
  if (a.mime === "image/jpeg" && ext !== "jpg" && ext !== "jpeg") return v(`${path}.path`, "mime 与扩展名不一致");
  if (!isInt(a.bytes) || a.bytes < 1 || a.bytes > 5242880) return v(`${path}.bytes`, "bytes 须为 1..5242880 的整数");
  return null;
}

/** 单个 op 的形状校验（§2-C；before 由 applyOps 按真实状态重算，故此处不校验 before 内容）。 */
export function validateOpShape(o: unknown): ShapeViolation | null {
  if (!isObj(o)) return v("op", "op 必须是对象");
  if (!isStr(o.op) || !OP_NAMES.includes(o.op as never)) return v("op", `未知 op：${String(o.op)}`);
  const after = o.after;
  switch (o.op) {
    case "addNode":
      return validateNodeShape(o.node, "node");
    case "removeNode":
      if (!isStr(o.nodeId) || !ID_PATTERNS.node.test(o.nodeId)) return v("nodeId", "nodeId 须为合法节点 id");
      return null;
    case "updateNodeText":
      if (!isStr(o.nodeId) || !ID_PATTERNS.node.test(o.nodeId)) return v("nodeId", "nodeId 须为合法节点 id");
      if (!isObj(after) || !isStr(after.markdown)) return v("after.markdown", "after.markdown 须为字符串");
      return null;
    case "updateNodeCaption":
      if (!isStr(o.nodeId) || !ID_PATTERNS.node.test(o.nodeId)) return v("nodeId", "nodeId 须为合法节点 id");
      if (!isObj(after) || (after.caption !== null && !isStr(after.caption)))
        return v("after.caption", "after.caption 须为字符串或 null（删除备注）");
      return null;
    case "moveNode":
      if (!isStr(o.nodeId) || !ID_PATTERNS.node.test(o.nodeId)) return v("nodeId", "nodeId 须为合法节点 id");
      if (!isObj(after) || !isNum(after.x) || !isNum(after.y)) return v("after", "after 须含数值 x/y");
      return null;
    case "resizeNode":
      if (!isStr(o.nodeId) || !ID_PATTERNS.node.test(o.nodeId)) return v("nodeId", "nodeId 须为合法节点 id");
      if (!isObj(after) || !isNum(after.w) || after.w <= 0) return v("after.w", "after.w 须为 >0 的数值");
      if (after.h !== null && (!isNum(after.h) || after.h <= 0)) return v("after.h", "after.h 须为 null 或 >0 的数值");
      return null;
    case "setNodeAccent":
      if (!isStr(o.nodeId) || !ID_PATTERNS.node.test(o.nodeId)) return v("nodeId", "nodeId 须为合法节点 id");
      if (!isObj(after) || !ACCENTS.includes(after.accent as never)) return v("after.accent", "after.accent 非法");
      return null;
    case "addEdge":
      return validateEdgeShape(o.edge, "edge");
    case "removeEdge":
      if (!isStr(o.edgeId) || !ID_PATTERNS.edge.test(o.edgeId)) return v("edgeId", "edgeId 须为合法边 id");
      return null;
    case "updateEdge": {
      if (!isStr(o.edgeId) || !ID_PATTERNS.edge.test(o.edgeId)) return v("edgeId", "edgeId 须为合法边 id");
      if (!isObj(after)) return v("after", "after 须为对象");
      if (!isStr(after.from) || !ID_PATTERNS.node.test(after.from)) return v("after.from", "after.from 须为合法节点 id");
      if (!isStr(after.to) || !ID_PATTERNS.node.test(after.to)) return v("after.to", "after.to 须为合法节点 id");
      if (typeof after.directed !== "boolean") return v("after.directed", "after.directed 须为布尔值");
      if (after.label !== undefined && !isStr(after.label)) return v("after.label", "after.label 须为字符串");
      return null;
    }
    case "reparent":
      if (!isStr(o.nodeId) || !ID_PATTERNS.node.test(o.nodeId)) return v("nodeId", "nodeId 须为合法节点 id");
      if (!isObj(after) || ("parentId" in after ? false : true))
        return v("after.parentId", "after 须含 parentId（可为 null）");
      if (after.parentId !== null && (!isStr(after.parentId) || !ID_PATTERNS.node.test(after.parentId)))
        return v("after.parentId", "after.parentId 须为 null 或合法节点 id");
      return null;
    default:
      return v("op", `未知 op：${String((o as { op?: unknown }).op)}`);
  }
}

export function validateHistoryStepShape(s: unknown, path: string): ShapeViolation | null {
  if (!isObj(s)) return v(path, "历史步骤必须是对象");
  if (!isInt(s.seq) || s.seq < 1) return v(`${path}.seq`, "seq 须为 ≥1 的整数");
  if (!isStr(s.at)) return v(`${path}.at`, "at 须为 date-time 字符串");
  if (s.actor !== "user" && s.actor !== "agent") return v(`${path}.actor`, "actor 须为 user|agent");
  if (!isStr(s.label)) return v(`${path}.label`, "label 须为字符串");
  if (!isInt(s.base) || s.base < 0) return v(`${path}.base`, "base 须为 ≥0 的整数");
  if (!isInt(s.result) || s.result < 1) return v(`${path}.result`, "result 须为 ≥1 的整数");
  if (isInt(s.base) && isInt(s.result) && s.result !== s.base + 1)
    return v(`${path}.result`, "result 须等于 base + 1");
  if (!Array.isArray(s.ops) || s.ops.length < 1) return v(`${path}.ops`, "ops 须为非空数组");
  for (let i = 0; i < s.ops.length; i++) {
    const bad = validateOpShape(s.ops[i]);
    if (bad) return v(`${path}.ops.${i}.${bad.path}`, bad.message);
  }
  return null;
}

/** board.json 整体形状校验（§2-B）。 */
export function validateBoardFileShape(f: unknown): ShapeViolation | null {
  if (!isObj(f)) return v("", "board.json 必须是对象");
  if (!isStr(f.formatVersion) || !ID_PATTERNS.formatVersion.test(f.formatVersion))
    return v("formatVersion", "formatVersion 须形如 \"1.0\"");
  if (!isObj(f.board)) return v("board", "缺 board 对象");
  const b = f.board;
  if (!isStr(b.id) || !ID_PATTERNS.board.test(b.id)) return v("board.id", "board.id 须匹配 ^b_[A-Za-z0-9_-]{6,32}$");
  if (!isStr(b.name) || b.name.length < 1) return v("board.name", "board.name 须为非空字符串");
  if (!isStr(b.createdAt) || !isStr(b.updatedAt)) return v("board.createdAt", "createdAt/updatedAt 须为 date-time 字符串");
  if (!isInt(b.contentVersion) || b.contentVersion < 0) return v("board.contentVersion", "contentVersion 须为 ≥0 的整数");
  if (!isObj(b.view) || !isNum(b.view.panX) || !isNum(b.view.panY) || !isNum(b.view.zoom) || b.view.zoom <= 0 || b.view.zoom > 10)
    return v("board.view", "view 须含 panX/panY 数值与 0<zoom≤10");
  if (!Array.isArray(f.nodes)) return v("nodes", "nodes 须为数组");
  for (let i = 0; i < f.nodes.length; i++) {
    const bad = validateNodeShape(f.nodes[i], `nodes.${i}`);
    if (bad) return bad;
  }
  if (!Array.isArray(f.edges)) return v("edges", "edges 须为数组");
  for (let i = 0; i < f.edges.length; i++) {
    const bad = validateEdgeShape(f.edges[i], `edges.${i}`);
    if (bad) return bad;
  }
  if (!Array.isArray(f.assets)) return v("assets", "assets 须为数组");
  for (let i = 0; i < f.assets.length; i++) {
    const bad = validateAssetShape(f.assets[i], `assets.${i}`);
    if (bad) return bad;
  }
  if (!Array.isArray(f.history)) return v("history", "history 须为数组");
  for (let i = 0; i < f.history.length; i++) {
    const bad = validateHistoryStepShape(f.history[i], `history.${i}`);
    if (bad) return bad;
    const step = f.history[i] as { seq: number; base: number };
    if (step.seq !== i + 1) return v(`history.${i}.seq`, "seq 须从 1 起连续编号");
    if (i > 0) {
      const prev = f.history[i - 1] as { result: number };
      if (step.base !== prev.result) return v(`history.${i}.base`, "base 须等于上一步 result（历史只增不减）");
    }
  }
  return null;
}

/** Agent 批次形状校验（§2-D）。 */
export function validateBatchShape(batch: unknown): ShapeViolation | null {
  if (!isObj(batch)) return v("", "批次必须是对象");
  if (batch.batchVersion !== "1.0") return v("batchVersion", "batchVersion 须为 \"1.0\"");
  if (!isStr(batch.boardId) || !ID_PATTERNS.board.test(batch.boardId))
    return v("boardId", "boardId 须匹配 ^b_[A-Za-z0-9_-]{6,32}$");
  if (!isInt(batch.baseContentVersion) || batch.baseContentVersion < 0)
    return v("baseContentVersion", "baseContentVersion 须为 ≥0 的整数");
  if (batch.actor !== "agent") return v("actor", "actor 须为 \"agent\"");
  if (!isStr(batch.label) || batch.label.length < 1) return v("label", "label 须为非空字符串");
  if (!Array.isArray(batch.ops) || batch.ops.length < 1) return v("ops", "ops 须为非空数组");
  for (let i = 0; i < batch.ops.length; i++) {
    const bad = validateOpShape(batch.ops[i]);
    if (bad) return { path: `ops.${i}.${bad.path}`, message: bad.message };
  }
  return null;
}
