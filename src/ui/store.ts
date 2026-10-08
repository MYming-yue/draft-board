// 编辑器全局状态：React useReducer，无外部状态库。
// 所有内容修改都经 model 的 commitStep（校验+历史+contentVersion），
// 视图/文件名等非内容变化直接改 board 元数据（不进历史，契约 op 词汇表不覆盖）。
import { measureLayoutGeometry } from "./layoutGeometry";
import { planTidyLayout } from "./layoutPlanner";
import { useMemo, useReducer } from "react";
import type { ExternalChanges } from "./externalChanges";
import {
  commitStep,
  createEmptyBoard,
  duplicateGroup,
  makeId,
  redo as modelRedo,
  undo as modelUndo,
  type Actor,
  type BoardAsset,
  type BoardFile,
  type DraftBundle,
  type HistoryStep,
  type Op,
} from "../model";

export type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";
export interface SaveStamp { sessionId: string; editRevision: number }

export interface EditorState {
  file: BoardFile;
  blobs: Record<string, Uint8Array>;
  blobUrls: Record<string, string>;
  cursor: number; // 撤销游标：正常编辑后 = history.length
  redoStack: HistoryStep[];
  selection: { nodes: string[]; edges: string[] };
  editingId: string | null;
  clipboard: { nodeIds: string[] } | null; // 内部卡片剪贴板（复制粘贴一组卡片）
  fileHandle: FileSystemFileHandle | null;
  fileName: string; // 展示与下载用文件名
  fileNameTracksBoardName: boolean; // 新建白板首次保存前，建议文件名随白板名变化
  saveState: SaveState;
  saveError: string | null;
  sessionId: string; // 区分新建/打开后的编辑会话，避免旧保存结果覆盖新白板状态
  editRevision: number; // 仅持久化内容变化递增；保存完成时核对快照
  replay: { active: boolean; step: number; playing: boolean };
  fileConflict: string | null;
  externalUpdate: ExternalChanges | null;
}

export type Action =
  | { type: "commit"; label: string; ops: Op[]; select?: { nodes?: string[]; edges?: string[] }; editingId?: string | null }
  | { type: "commitError"; message: string }
  | { type: "addAsset"; asset: BoardAsset; bytes: Uint8Array }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "select"; nodes: string[]; edges: string[] }
  | { type: "setEditing"; id: string | null }
  | { type: "setClipboard"; nodeIds: string[] }
  | { type: "setView"; panX: number; panY: number; zoom: number }
  | { type: "rename"; name: string }
  | { type: "load"; bundle: DraftBundle; handle: FileSystemFileHandle | null; fileName: string }
  | { type: "newBoard" }
  | { type: "setFileConflict"; sessionId: string; message: string | null }
  | { type: "receiveExternal"; bundle: DraftBundle; stamp: SaveStamp; changes: ExternalChanges }
  | { type: "dismissExternal" }
  | { type: "setHandle"; handle: FileSystemFileHandle | null; fileName: string; sessionId?: string }
  | { type: "markSaving" }
  | { type: "markSaved"; stamp: SaveStamp }
  | { type: "markSaveCancelled"; stamp: SaveStamp; previous: SaveState }
  | { type: "markSaveError"; stamp: SaveStamp; message: string }
  | { type: "replayEnter" }
  | { type: "replayExit" }
  | { type: "replaySet"; step: number }
  | { type: "replayPlay"; playing: boolean };

function makeBlobUrls(blobs: Record<string, Uint8Array>): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const [id, bytes] of Object.entries(blobs)) {
    urls[id] = URL.createObjectURL(new Blob([bytes as BlobPart]));
  }
  return urls;
}

export function initialEditorState(): EditorState {
  const file = createEmptyBoard();
  return {
    file,
    blobs: {},
    blobUrls: {},
    cursor: 0,
    redoStack: [],
    selection: { nodes: [], edges: [] },
    editingId: null,
    clipboard: null,
    fileHandle: null,
    fileName: "未命名白板.draft",
    fileNameTracksBoardName: true,
    saveState: "clean",
    saveError: null,
    sessionId: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
    editRevision: 0,
    replay: { active: false, step: 0, playing: false },
    fileConflict: null,
    externalUpdate: null,
  };
}

function dirtyOf(s: EditorState): SaveState {
  return s.fileHandle ? "dirty" : "dirty";
}

function matchesSave(s: EditorState, stamp: SaveStamp): boolean {
  return s.sessionId === stamp.sessionId && s.editRevision === stamp.editRevision;
}

export function editorReducer(s: EditorState, a: Action): EditorState {
  switch (a.type) {
    case "setFileConflict":
      return a.sessionId === s.sessionId && s.fileConflict !== a.message ? { ...s, fileConflict: a.message } : s;
    case "dismissExternal":
      return { ...s, externalUpdate: null };
    case "receiveExternal": {
      if (!matchesSave(s, a.stamp) || s.editingId || s.replay.active || s.saveState === "saving") return s;
      for (const url of Object.values(s.blobUrls)) URL.revokeObjectURL(url);
      return {
        ...s, file: { ...a.bundle.file, board: { ...a.bundle.file.board, view: s.file.board.view } },
        blobs: a.bundle.blobs, blobUrls: makeBlobUrls(a.bundle.blobs),
        cursor: a.bundle.file.history.length, redoStack: [],
        selection: { nodes: a.changes.nodes, edges: [] },
        externalUpdate: a.changes, fileConflict: null,
        saveState: "saved", saveError: null, editRevision: s.editRevision + 1,
      };
    }
    case "commit": {
      if (s.replay.active) return s; // 回放只读，禁一切内容修改（§F10）
      const r = commitStep(s.file, a.label, "user" satisfies Actor, a.ops);
      if (!r.ok) {
        return { ...s, saveError: `${r.error.code}: ${r.error.message}` };
      }
      return {
        ...s,
        file: r.state,
        cursor: r.state.history.length,
        redoStack: [],
        selection: {
          nodes: a.select?.nodes ?? s.selection.nodes,
          edges: a.select?.edges ?? s.selection.edges,
        },
        editingId: a.editingId !== undefined ? a.editingId : s.editingId,
        saveState: dirtyOf(s),
        saveError: null,
        editRevision: s.editRevision + 1,
      };
    }
    case "commitError":
      return { ...s, saveError: a.message };
    case "addAsset": {
      const file = { ...s.file, assets: [...s.file.assets, a.asset] };
      const blob = new Blob([a.bytes as BlobPart]);
      return {
        ...s,
        file,
        blobs: { ...s.blobs, [a.asset.id]: a.bytes },
        blobUrls: { ...s.blobUrls, [a.asset.id]: URL.createObjectURL(blob) },
        saveState: dirtyOf(s),
        editRevision: s.editRevision + 1,
      };
    }
    case "undo": {
      if (s.replay.active) return s;
      const u = modelUndo(s.file, s.cursor);
      if (!u) return s;
      return {
        ...s,
        file: u.state,
        cursor: u.cursor,
        redoStack: [...s.redoStack, u.undone],
        editingId: null,
        selection: { nodes: [], edges: [] },
        saveState: dirtyOf(s),
        editRevision: s.editRevision + 1,
      };
    }
    case "redo": {
      if (s.replay.active) return s;
      const top = s.redoStack[s.redoStack.length - 1];
      if (!top) return s;
      const r = modelRedo(s.file, top);
      return {
        ...s,
        file: r.state,
        cursor: r.state.history.length,
        redoStack: s.redoStack.slice(0, -1),
        saveState: dirtyOf(s),
        editRevision: s.editRevision + 1,
      };
    }
    case "select":
      return { ...s, selection: { nodes: a.nodes, edges: a.edges } };
    case "setEditing":
      return { ...s, editingId: a.id };
    case "setClipboard":
      return { ...s, clipboard: { nodeIds: a.nodeIds } };
    case "setView": {
      // 浅拷贝即可：view 是元数据，不进历史，勿深克隆整个 history（滚轮缩放高频调用）
      return {
        ...s,
        file: {
          ...s.file,
          board: { ...s.file.board, view: { panX: a.panX, panY: a.panY, zoom: a.zoom } },
        },
      };
    }
    case "rename": {
      if (!a.name.trim()) return s;
      return {
        ...s,
        file: { ...s.file, board: { ...s.file.board, name: a.name.trim() } },
        fileName: s.fileNameTracksBoardName ? `${a.name.trim()}.draft` : s.fileName,
        saveState: dirtyOf(s),
        editRevision: s.editRevision + 1,
      };
    }
    case "load": {
      for (const url of Object.values(s.blobUrls)) URL.revokeObjectURL(url);
      return {
        ...initialEditorState(),
        file: a.bundle.file,
        blobs: a.bundle.blobs,
        blobUrls: makeBlobUrls(a.bundle.blobs),
        cursor: a.bundle.file.history.length,
        fileHandle: a.handle,
        fileName: a.fileName,
        fileNameTracksBoardName: false,
        saveState: "clean",
      };
    }
    case "newBoard": {
      for (const url of Object.values(s.blobUrls)) URL.revokeObjectURL(url);
      return initialEditorState();
    }
    case "setHandle":
      if (a.sessionId && a.sessionId !== s.sessionId) return s;
      return { ...s, fileHandle: a.handle, fileName: a.fileName, fileNameTracksBoardName: false };
    case "markSaving":
      return { ...s, saveState: "saving" };
    case "markSaved":
      if (!matchesSave(s, a.stamp)) return s;
      return { ...s, saveState: "saved", saveError: null };
    case "markSaveCancelled":
      if (!matchesSave(s, a.stamp)) return s;
      return { ...s, saveState: a.previous };
    case "markSaveError":
      if (!matchesSave(s, a.stamp)) return s;
      return { ...s, saveState: "error", saveError: a.message };
    case "replayEnter":
      if (s.file.history.length === 0) return s; // 脱历史文件不假装可回放
      return {
        ...s,
        replay: { active: true, step: s.file.history.length, playing: false },
        editingId: null,
        selection: { nodes: [], edges: [] },
      };
    case "replayExit":
      return { ...s, replay: { active: false, step: s.file.history.length, playing: false } };
    case "replaySet":
      return { ...s, replay: { ...s.replay, step: a.step, playing: false } };
    case "replayPlay":
      return { ...s, replay: { ...s.replay, playing: a.playing } };
    default:
      return s;
  }
}

export interface EditorApi {
  state: EditorState;
  dispatch: React.Dispatch<Action>;
  commit: (label: string, ops: Op[], select?: { nodes?: string[]; edges?: string[] }, editingId?: string | null) => boolean;
  commitAssetNode: (label: string, asset: BoardAsset, bytes: Uint8Array, ops: Op[], select?: { nodes?: string[] }) => boolean;
    layoutTidy: (selectedOnly?: boolean) => { ok: boolean; moved: number; outcome?: "changed" | "already-tidy" | "unresolved" };
  duplicateSelection: () => void;
}

export function useEditor(): EditorApi {
  const [state, dispatch] = useReducer(editorReducer, undefined, initialEditorState);
  return useMemo(() => {
    const commit: EditorApi["commit"] = (label, ops, select, editingId) => {
      if (ops.length === 0) return false;
      dispatch({ type: "commit", label, ops, select, editingId });
      return true;
    };
    const commitAssetNode: EditorApi["commitAssetNode"] = (label, asset, bytes, ops, select) => {
      dispatch({ type: "addAsset", asset, bytes });
      dispatch({ type: "commit", label, ops, select });
      return true;
    };
    const layoutTidy = (selectedOnly = false) => {
      if (state.replay.active || state.editingId || !state.file.nodes.length) return { ok: false, moved: 0 };
      const geometry = measureLayoutGeometry(state.file.nodes);
      if (!geometry) {
        dispatch({ type: "commitError", message: "卡片或字体、图片仍在加载，请加载完成后再整理。" });
        return { ok: false, moved: 0 };
      }
      const canvas = document.querySelector<HTMLElement>(".canvas");
      const aspectRatio = canvas && canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 1.6;
      const planned = planTidyLayout(state.file, selectedOnly ? state.selection.nodes : [], geometry, aspectRatio);
      if (!planned.ok) {
        dispatch({ type: "commitError", message: "当前关系线或集合边界无法全部避开；请调整相关卡片后再整理。" });
        return { ok: false, moved: 0 };
      }
      if (planned.ops.length > 0) dispatch({ type: "commit", label: "布局整理", ops: planned.ops });
      return { ok: true, moved: planned.ops.length, outcome: planned.outcome };
    };
    const duplicateSelection = () => {
      if (state.selection.nodes.length === 0) return;
      const ops = duplicateGroup(state.file, state.selection.nodes, makeId);
      if (ops.length > 0) {
        const newNodeIds = ops.filter((o) => o.op === "addNode").map((o) => (o.op === "addNode" ? o.node.id : ""));
        dispatch({ type: "commit", label: `粘贴 ${newNodeIds.length} 张卡片`, ops, select: { nodes: newNodeIds, edges: [] } });
      }
    };
    return { state, dispatch, commit, commitAssetNode, layoutTidy, duplicateSelection };
  }, [state]);
}
