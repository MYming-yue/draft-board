import type { BatchError, ErrorCode } from "./types";

export function err(code: ErrorCode, message: string, opIndex?: number, path?: string): BatchError {
  const e: BatchError = { code, message };
  if (opIndex !== undefined) e.opIndex = opIndex;
  if (path !== undefined) e.path = path;
  return e;
}

/** 文件解析/序列化层抛出的带契约错误码异常（E_ASSET_MISSING / E_FORMAT_UNSUPPORTED / E_SCHEMA…）。 */
export class DraftError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "DraftError";
    this.code = code;
  }
}
