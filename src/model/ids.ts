import { customAlphabet } from "nanoid";

// 契约 §5 ID 规约：b_/n_/e_/a_ 前缀 + [A-Za-z0-9_-]{6,32}。
export const ID_PATTERNS = {
  collection: /^g_[A-Za-z0-9_-]{6,32}$/,
  board: /^b_[A-Za-z0-9_-]{6,32}$/,
  node: /^n_[A-Za-z0-9_-]{6,32}$/,
  edge: /^e_[A-Za-z0-9_-]{6,32}$/,
  asset: /^a_[A-Za-z0-9_-]{6,32}$/,
  assetPath: /^assets\/a_[A-Za-z0-9_-]{6,32}\.(png|jpg|jpeg)$/,
  formatVersion: /^\d+\.\d+$/,
} as const;

export function makeCollectionId(): string { return "g_" + nano(); }

const nano = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-", 12);

export type IdKind = "board" | "node" | "edge" | "asset";
const PREFIX: Record<IdKind, string> = { board: "b_", node: "n_", edge: "e_", asset: "a_" };

/** UI/CLI 层生成新 id。注意：applyOps 内部永不调用本函数（回放确定性要求）。 */
export function makeId(kind: IdKind): string {
  return PREFIX[kind] + nano();
}
