// 编辑器全局状态：React useReducer，无外部状态库。
// 所有内容修改都经 model 的 commitStep（校验+历史+contentVersion），
// 视图/文件名等非内容变化直接改 board 元数据（不进历史，契约 op 词汇表不覆盖）。
import { useMemo, useReducer } from "react";
import {
  commitStep,
  createEmptyBoard,
  duplicateGroup,
  forestRoots,
  layoutBranchOps,
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
  saveState: SaveState;
  saveError: string | null;
  replay: { active: boolean; step: number; playing: boolean };
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
  | { type: "setHandle"; handle: FileSystemFileHandle | null; fileName: string }
  | { type: "markSaving" }
  | { type: "markSaved" }
  | { type: "markSaveError"; message: string }
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
    saveState: "clean",
    saveError: null,
    replay: { active: false, step: 0, playing: false },
  };
}

function dirtyOf(s: EditorState): SaveState {
  return s.fileHandle ? "dirty" : "dirty";
}

export function editorReducer(s: EditorState, a: Action): EditorState {
  switch (a.type) {
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
        saveState: dirtyOf(s),
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
        saveState: "clean",
      };
    }
    case "newBoard": {
      for (const url of Object.values(s.blobUrls)) URL.revokeObjectURL(url);
      return initialEditorState();
    }
    case "setHandle":
      return { ...s, fileHandle: a.handle, fileName: a.fileName };
    case "markSaving":
      return { ...s, saveState: "saving" };
    case "markSaved":
      return { ...s, saveState: "saved", saveError: null };
    case "markSaveError":
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
  layoutTidy: () => void;
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
    const layoutTidy = () => {
      const roots = state.selection.nodes.length > 0 ? state.selection.nodes : forestRoots(state.file);
      const ops = layoutBranchOps(state.file, roots);
      if (ops.length > 0) dispatch({ type: "commit", label: "布局整理", ops });
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
