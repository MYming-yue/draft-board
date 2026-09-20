// 持久化（需求 §F08/§6.2）：优先 File System Access API，fallback 下载/文件选择。
// 原子写：Chrome 的 createWritable 先写交换文件、close 时原子替换（I8 在浏览器侧的最强保证）；
// Node CLI 侧另走临时文件+rename（见 scripts/agent-batch.mjs）。
import { useEffect, useRef } from "react";
import {
  parseBoard,
  serializeBoard,
  stripHistory,
  type DraftBundle,
} from "../model";
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

/** 保存到既有 handle；无 handle 时另存（弹窗或下载兜底）。返回写到的 handle。 */
export async function saveDraft(
  state: Pick<EditorState, "file" | "blobs" | "fileHandle" | "fileName">,
  opts: { forcePicker?: boolean; historyMode?: "full" | "strip" } = {},
): Promise<FileSystemFileHandle | null> {
  const file = opts.historyMode === "strip" ? stripHistory(state.file) : state.file;
  const bytes = serializeBoard(file, state.blobs);
  const suggested = state.fileName || `${state.file.board.name}.draft`;

  if (opts.historyMode === "strip") {
    // 脱历史导出永不远程覆盖原文件：另存/下载
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: suggested.replace(/\.draft$/, "") + ".当前草稿.draft",
          types: DRAFT_TYPES,
        });
        const w = await handle.createWritable();
        await w.write(bytes as FileSystemWriteChunkType);
        await w.close();
        return null; // 不切换当前编辑文件的 handle
      } catch (e) {
        if ((e as DOMException).name === "AbortError") return null;
        throw e;
      }
    }
    download(bytes, suggested.replace(/\.draft$/, "") + ".当前草稿.draft");
    return null;
  }

  let handle = opts.forcePicker ? null : state.fileHandle;
  if (!handle && window.showSaveFilePicker) {
    try {
      handle = await window.showSaveFilePicker({ suggestedName: suggested, types: DRAFT_TYPES });
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return null;
      throw e;
    }
  }
  if (handle) {
    const w = await handle.createWritable();
    await w.write(bytes as FileSystemWriteChunkType);
    await w.close();
    return handle;
  }
  // 无 FS Access：下载兜底（浏览器下载目录写入由浏览器保证完整）
  download(bytes, suggested);
  return null;
}

/**
 * 自动保存（§6.2）：末次修改后 1.5s 内写盘（目标 ≤2s），
 * 带可见状态（saved/saving/error）；无文件句柄时不自动保存（等用户 Ctrl+S 选位置）。
 */
export function useAutosave(
  state: EditorState,
  save: () => Promise<void>,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (state.saveState !== "dirty" || !state.fileHandle) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void save();
    }, 1500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // 仅在内容版本变化时重新计时
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.file.board.contentVersion, state.file.board.updatedAt, state.saveState, state.fileHandle]);
}
