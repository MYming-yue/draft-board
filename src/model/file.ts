// 契约 §2-A：.draft = ZIP 容器（board.json + assets/<assetId>.<ext>）。
// 解析时校验 formatVersion 主版本（I9 → E_FORMAT_UNSUPPORTED）、
// 形状（E_SCHEMA）、assets 条目与容器文件对应（I7 → E_ASSET_MISSING / E_UNKNOWN_ASSET）。
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { DraftError } from "./errors";
import type { BoardFile } from "./types";
import { validateBoardFileShape } from "./validate";

export interface DraftBundle {
  file: BoardFile;
  /** assetId → 图片二进制（容器内 assets/ 条目内容） */
  blobs: Record<string, Uint8Array>;
}

export function serializeBoard(file: BoardFile, blobs: Record<string, Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    "board.json": strToU8(JSON.stringify(file, null, 2)),
  };
  for (const asset of file.assets) {
    const data = blobs[asset.id];
    if (!data || data.length < 1)
      throw new DraftError("E_ASSET_MISSING", `assets[] 有条目但缺少二进制：${asset.id}`);
    entries[asset.path] = data;
  }
  return zipSync(entries, { level: 6 });
}

export function parseBoard(bytes: Uint8Array): DraftBundle {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new DraftError("E_SCHEMA", "不是合法的 ZIP 容器（.draft）");
  }
  const jsonBytes = entries["board.json"];
  if (!jsonBytes) throw new DraftError("E_SCHEMA", "容器内缺 board.json");
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(jsonBytes));
  } catch {
    throw new DraftError("E_SCHEMA", "board.json 不是合法 JSON");
  }
  const fv = (raw as { formatVersion?: unknown })?.formatVersion;
  if (typeof fv === "string" && /^\d+\.\d+$/.test(fv) && fv.split(".")[0] !== "1")
    // I9：不认识的主版本明确报错，不静默丢内容
    throw new DraftError("E_FORMAT_UNSUPPORTED", `不支持的 formatVersion 主版本：${fv}`);
  const bad = validateBoardFileShape(raw);
  if (bad) throw new DraftError("E_SCHEMA", `board.json 不符契约：${bad.message}（${bad.path || "根"}）`);
  const file = raw as unknown as BoardFile;

  const blobs: Record<string, Uint8Array> = {};
  for (const asset of file.assets) {
    const data = entries[asset.path];
    if (!data || data.length < 1)
      throw new DraftError("E_ASSET_MISSING", `assets[] 有条目但容器内缺文件：${asset.path}`);
    blobs[asset.id] = data;
  }
  for (const node of file.nodes) {
    if (node.type === "image" && !file.assets.some((a) => a.id === node.assetId))
      throw new DraftError("E_UNKNOWN_ASSET", `节点 ${node.id} 引用的 assetId 无条目：${node.assetId}`);
  }
  return { file, blobs };
}

/** 「只分享当前草稿」：脱历史导出（决议 Q2）。contentVersion 保留（仍是冲突检测基准）。 */
export function stripHistory(file: BoardFile): BoardFile {
  const copy = structuredClone(file);
  copy.history = [];
  return copy;
}
