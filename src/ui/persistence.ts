// 持久化（需求 §F08/§6.2）：优先 File System Access API，fallback 下载/文件选择。
// 原子写：Chrome 的 createWritable 先写交换文件、close 时原子替换（I8 在浏览器侧的最强保证）；
// Node CLI 侧另走临时文件+rename（见 scripts/agent-batch.mjs）。
import { useEffect, useRef } from "react";
import {
  parseBoard,
  serializeBoard,
  stripHistory,
  type DraftBundle,
  type BoardFile,
} from "../model";
import { sameDraftAssets, sameDraftContent } from "./externalChanges";
import type { EditorState } from "./store";

declare global {
  interface Window {
    showSaveFilePicker?: (opts?: {
      suggestedName?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle>;
    showOpenFilePicker?: (opts?: {
      multiple?: boolean;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle[]>;
    launchQueue?: {
      setConsumer: (consumer: (params: { files: FileSystemFileHandle[] }) => void) => void;
    };
  }
}

export const hasFSAccess = () => typeof window.showSaveFilePicker === "function";

const DRAFT_TYPES = [{ description: "数字草稿白板", accept: { "application/octet-stream": [".draft"] } }];

export interface OpenedDraft {
  bundle: DraftBundle;
  handle: FileSystemFileHandle | null;
  fileName: string;
}

export type SaveResult =
  | { status: "saved"; handle: FileSystemFileHandle | null; fileName?: string }
  | { status: "cancelled" };

export async function openDraftHandle(handle: FileSystemFileHandle): Promise<OpenedDraft> {
  const file = await handle.getFile();
  const bundle = parseBoard(new Uint8Array(await file.arrayBuffer()));
  return { bundle, handle, fileName: file.name };
}

export async function openDraft(): Promise<OpenedDraft | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: DRAFT_TYPES });
      if (!handle) return null;
      return await openDraftHandle(handle);
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return null;
      throw e;
    }
  }
  // fallback：<input type=file>
  return new Promise((resolvePromise, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".draft";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolvePromise(null);
      try {
        const bundle = parseBoard(new Uint8Array(await f.arrayBuffer()));
        resolvePromise({ bundle, handle: null, fileName: f.name });
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}

function download(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 保存到既有 handle；无 handle 时另存（弹窗或下载兜底）。取消选择不算已保存。 */
export async function saveDraft(
  state: Pick<EditorState, "file" | "blobs" | "fileHandle" | "fileName">,
  opts: { forcePicker?: boolean; copy?: boolean; historyMode?: "full" | "strip"; expectedFile?: BoardFile; expectedBlobs?: Record<string, Uint8Array>; forbiddenHandle?: FileSystemFileHandle } = {},
): Promise<SaveResult> {
  const file = opts.historyMode === "strip" ? stripHistory(state.file) : state.file;
  const bytes = serializeBoard(file, state.blobs);
  const originalName = state.fileName || `${state.file.board.name}.draft`;
  const suggested = opts.copy ? `${originalName.replace(/\.draft$/i, "")}-副本.draft` : originalName;

  if (opts.historyMode === "strip") {
    // 脱历史导出永不远程覆盖原文件：另存/下载
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: suggested.replace(/\.draft$/, "") + ".当前草稿.draft",
          types: DRAFT_TYPES,
        });
        if (state.fileHandle && (handle === state.fileHandle || await handle.isSameEntry(state.fileHandle))) {
          throw new Error("分享草稿请选择另一个文件，原文件及历史需要保留。");
        }
        const w = await handle.createWritable();
        await w.write(bytes as FileSystemWriteChunkType);
        await w.close();
        return { status: "saved", handle: null }; // 不切换当前编辑文件的 handle
      } catch (e) {
        if ((e as DOMException).name === "AbortError") return { status: "cancelled" };
        throw e;
      }
    }
    download(bytes, suggested.replace(/\.draft$/, "") + ".当前草稿.draft");
    return { status: "saved", handle: null };
  }

  let handle = opts.forcePicker || opts.copy ? null : state.fileHandle;
  if (!handle && window.showSaveFilePicker) {
    try {
      handle = await window.showSaveFilePicker({ suggestedName: suggested, types: DRAFT_TYPES });
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return { status: "cancelled" };
      throw e;
    }
  }
  if (handle) {
    const forbidden = opts.forbiddenHandle ?? (opts.copy ? state.fileHandle ?? undefined : undefined);
    if (forbidden && (handle === forbidden || await handle.isSameEntry(forbidden))) {
      throw new Error("请为本地副本选择另一个文件，原文件的外部修改需要保留。");
    }
    const sameHandle = state.fileHandle && (handle === state.fileHandle || (typeof handle.isSameEntry === "function" && await handle.isSameEntry(state.fileHandle)));
    if (sameHandle && opts.expectedFile) {
      const disk = await openDraftHandle(handle);
      if (!sameDraftContent(disk.bundle.file, opts.expectedFile) || (opts.expectedBlobs && !sameDraftAssets(disk.bundle.blobs, opts.expectedBlobs))) {
        throw new Error("磁盘已有外部修改，已停止覆盖；当前内容保留，请另存本地副本。");
      }
    }
    const w = await handle.createWritable();
    try {
      await w.write(bytes as FileSystemWriteChunkType);
      // Recheck after staging: a changed file must not be replaced on close().
      if (sameHandle && opts.expectedFile) {
        const disk = await openDraftHandle(handle);
        if (!sameDraftContent(disk.bundle.file, opts.expectedFile) || (opts.expectedBlobs && !sameDraftAssets(disk.bundle.blobs, opts.expectedBlobs))) {
          throw new Error("写入期间磁盘出现外部修改，已取消覆盖；当前内容保留。");
        }
      }
      await w.close();
    } catch (error) {
      try { await w.abort(); } catch { /* Preserve the original save error. */ }
      throw error;
    }
    return { status: "saved", handle };
  }
  // 无 FS Access：下载兜底（浏览器下载目录写入由浏览器保证完整）
  download(bytes, suggested);
  return { status: "saved", handle: null, fileName: suggested };
}

/**
 * 自动保存（§6.2）：末次修改后 1.5s 内写盘（目标 ≤2s），
 * 带可见状态（saved/saving/error）；无文件句柄时不自动保存（等用户 Ctrl+S 选位置）。
 */
export function useAutosave(
  state: EditorState,
  save: () => Promise<void>,
  busy = false,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (busy || state.fileConflict || state.editingId || state.saveState !== "dirty" || !state.fileHandle) return;
    if (timer.current) clearTimeout(timer.current);
    let stopped = false;
    const tick = async () => {
      await save();
      // A pending edge-label input can defer saving without changing the model.
      // Keep checking until it finishes, rather than consuming the only timer.
      const current = stateRef.current;
      if (!stopped && current.saveState === "dirty" && !current.fileConflict && !current.editingId) timer.current = setTimeout(tick, 1500);
    };
    timer.current = setTimeout(tick, 1500);
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // 仅在内容版本变化时重新计时
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.file.board.contentVersion, state.file.board.updatedAt, state.saveState, state.fileHandle, state.fileConflict, state.editingId, busy]);
}
