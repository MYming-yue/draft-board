// 契约内核类型：与《数字草稿白板-接口契约》§2-B/§2-C/§2-D/§2-E 逐条对齐。

export const FORMAT_VERSION = "1.0" as const;
export const BATCH_VERSION = "1.0" as const;

export type Accent = "default" | "blue" | "green" | "amber" | "red";
export const ACCENTS: readonly Accent[] = ["default", "blue", "green", "amber", "red"];

export type NodeType = "text" | "image";
export type EdgeKind = "association" | "parentChild";
export type Actor = "user" | "agent";

export interface ViewState {
  panX: number;
  panY: number;
  zoom: number; // (0, 10]
}

export interface BoardMeta {
  id: string; // ^b_[A-Za-z0-9_-]{6,32}$
  name: string;
  createdAt: string; // date-time
  updatedAt: string;
  contentVersion: number; // 单调递增；每应用一个历史步骤 +1
  view: ViewState;
}

export interface BoardNode {
  id: string; // ^n_...
  type: NodeType;
  markdown?: string; // type=text 必填
  caption?: string; // text 节点的独立备注（Markdown）；图片说明仍用 markdown
  assetId?: string; // type=image 必填，^a_...
  x: number;
  y: number;
  w: number; // >0；文本/公式卡描述核心区外框
  h?: number | null; // null/缺省 = 高度随内容自适应
  accent?: Accent;
  captionExpanded?: boolean; // true = 阅读态常驻展开备注；缺省或 false = 未选中时截断
  coreScale?: number; // 普通文本卡核心字号比例，缺省 1；纯公式卡由 w/h 反推，忽略此字段
  captionW?: number; // 备注阅读宽度；缺省时有备注则至少 220，且不小于核心区宽
}

export interface BoardEdge {
  id: string; // ^e_...
  kind: EdgeKind; // 封闭枚举
  from: string; // ^n_...
  to: string; // ^n_...
  directed: boolean; // parentChild 恒为 true，方向 = 父→子
  label?: string;
}

export interface BoardAsset {
  id: string; // ^a_...
  mime: "image/png" | "image/jpeg";
  path: string; // ^assets/a_....(png|jpg|jpeg)$
  bytes: number; // 1..5242880
}

export interface BoardFile {
  formatVersion: string; // 语义化版本，主版本不认识 → E_FORMAT_UNSUPPORTED
  board: BoardMeta;
  nodes: BoardNode[];
  edges: BoardEdge[];
  assets: BoardAsset[];
  history: HistoryStep[]; // append-only；空数组 = 脱历史分享文件
}

// ---- §2-C 操作词汇表（历史步骤与 Agent 批次共用） ----

export type Op =
  | { op: "addNode"; node: BoardNode; before: null; after: BoardNode }
  | { op: "removeNode"; nodeId: string; before: { node: BoardNode; edges: BoardEdge[] } | null; after: null }
  | { op: "updateNodeText"; nodeId: string; before: { markdown: string } | null; after: { markdown: string } }
  | { op: "updateNodeCaption"; nodeId: string; before: { caption: string | null } | null; after: { caption: string | null } }
  | { op: "moveNode"; nodeId: string; before: { x: number; y: number } | null; after: { x: number; y: number } }
  | {
      op: "resizeNode";
      nodeId: string;
      before: { w: number; h: number | null; coreScale?: number | null } | null;
      after: { w: number; h: number | null; coreScale?: number | null };
    }
  | { op: "setNodeAccent"; nodeId: string; before: { accent: Accent } | null; after: { accent: Accent } }
  | { op: "setCaptionExpanded"; nodeId: string; before: { expanded: boolean } | null; after: { expanded: boolean } }
  | { op: "setCaptionWidth"; nodeId: string; before: { captionW: number | null } | null; after: { captionW: number | null } }
  | { op: "addEdge"; edge: BoardEdge; before: null; after: BoardEdge }
  | { op: "removeEdge"; edgeId: string; before: BoardEdge | null; after: null }
  | {
      op: "updateEdge";
      edgeId: string;
      before: { from: string; to: string; label?: string; directed: boolean } | null;
      after: { from: string; to: string; label?: string; directed: boolean };
    }
  | { op: "reparent"; nodeId: string; before: { parentId: string | null } | null; after: { parentId: string | null } };

export type OpName = Op["op"];
export const OP_NAMES: readonly OpName[] = [
  "addNode",
  "removeNode",
  "updateNodeText",
  "updateNodeCaption",
  "moveNode",
  "resizeNode",
  "setNodeAccent",
  "setCaptionExpanded",
  "setCaptionWidth",
  "addEdge",
  "removeEdge",
  "updateEdge",
  "reparent",
];

export interface HistoryStep {
  seq: number; // 从 1 起连续编号
  at: string; // date-time
  actor: Actor;
  label: string;
  base: number; // 应用前 contentVersion
  result: number; // 应用后 contentVersion = base + 1
  ops: Op[]; // minItems 1
}

// ---- §2-D Agent 批量操作批次 ----

export interface AgentBatch {
  batchVersion: typeof BATCH_VERSION;
  boardId: string;
  baseContentVersion: number;
  actor: "agent";
  label: string;
  ops: Op[];
}

// ---- §2-E 批次结果与错误码（封闭枚举 11 码） ----

export type ErrorCode =
  | "E_SCHEMA"
  | "E_BOARD_MISMATCH"
  | "E_VERSION_CONFLICT"
  | "E_DUP_ID"
  | "E_UNKNOWN_NODE"
  | "E_UNKNOWN_EDGE"
  | "E_UNKNOWN_ASSET"
  | "E_PARENT_CYCLE"
  | "E_MULTI_PARENT"
  | "E_ASSET_MISSING"
  | "E_FORMAT_UNSUPPORTED";

export interface BatchError {
  code: ErrorCode;
  message: string;
  opIndex?: number;
  path?: string;
}

export type BatchResult =
  | { ok: true; contentVersion: number; appliedOps: number }
  | { ok: false; error: BatchError };

export type ApplyResult =
  | { ok: true; state: BoardFile; ops: Op[] } // ops = 归一化（before 按真实状态重算）后的 op
  | { ok: false; error: BatchError };
