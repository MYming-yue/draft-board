import { useCallback, useEffect, useRef, useState } from "react";
import { DraftError, type BoardFile } from "./model";
import { Canvas } from "./ui/Canvas";
import { exportBoardPng } from "./ui/exportPng";
import { openDraft, openDraftHandle, saveDraft, useAutosave } from "./ui/persistence";
import { ReplayBar } from "./ui/ReplayBar";
import { useEditor } from "./ui/store";
import { Toolbar } from "./ui/Toolbar";
import { FileUpdates } from "./ui/FileUpdates";
import { useFileSync } from "./ui/useFileSync";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function App() {
  const editor = useEditor();
  const { state, dispatch } = editor;
  const [fitNonce, setFitNonce] = useState(0);
  const [layoutFit, setLayoutFit] = useState(false);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [layoutResult, setLayoutResult] = useState<string | null>(null);
  const [structureView, setStructureView] = useState(false);
  const diskBaseline = useRef<BoardFile | null>(null);
  const diskAssets = useRef<Record<string, Uint8Array>>({});
  const saveInFlight = useRef(false);
  const [savingIO, setSavingIO] = useState(false);
  const currentState = useRef(state);
  currentState.current = state;
  useFileSync(editor, diskBaseline, diskAssets, saveInFlight, layoutBusy);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (!layoutResult) return;
    const timer = window.setTimeout(() => setLayoutResult(null), 5000);
    return () => window.clearTimeout(timer);
  }, [layoutResult]);

  const reportError = useCallback(
    (e: unknown) => {
      const msg = e instanceof DraftError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
      dispatch({ type: "commitError", message: msg });
    },
    [dispatch],
  );

  const doNew = useCallback(() => {
    if (state.replay.active) dispatch({ type: "replayExit" });
    if ((state.editingId || state.fileConflict || document.querySelector(".edge-label-input") || ["dirty", "saving", "error"].includes(state.saveState)) && !window.confirm("当前白板有未保存修改，确定新建并丢弃吗？")) return;
    diskBaseline.current = null;
    diskAssets.current = {};
    dispatch({ type: "newBoard" });
  }, [state.replay.active, state.saveState, state.editingId, state.fileConflict, dispatch]);

  const doOpen = useCallback(async () => {
    if ((state.editingId || state.fileConflict || document.querySelector(".edge-label-input") || ["dirty", "saving", "error"].includes(state.saveState)) && !window.confirm("当前白板有未保存内容，确定打开另一个文件吗？")) return;
    if (state.replay.active) dispatch({ type: "replayExit" });
    const sessionId = state.sessionId;
    try {
      const opened = await openDraft();
      if (!opened || currentState.current.sessionId !== sessionId) return;
      diskBaseline.current = opened.bundle.file;
      diskAssets.current = opened.bundle.blobs;
      dispatch({ type: "load", bundle: opened.bundle, handle: opened.handle, fileName: opened.fileName });
    } catch (e) {
      reportError(e);
    }
  }, [state.replay.active, state.editingId, state.fileConflict, state.saveState, dispatch, reportError]);

  // 已安装 PWA 从 Windows 双击 .draft 启动时，Chromium 会把真实文件句柄放入 launchQueue。
  const openLaunchedFile = useCallback(
    async (handle: FileSystemFileHandle) => {
      if ((state.editingId || state.fileConflict || document.querySelector(".edge-label-input") || ["dirty", "saving", "error"].includes(state.saveState)) && !window.confirm("当前白板有未保存修改，确定打开另一个文件吗？")) return;
      if (state.replay.active) dispatch({ type: "replayExit" });
      try {
        const opened = await openDraftHandle(handle);
        if (currentState.current.sessionId !== state.sessionId) return;
        diskBaseline.current = opened.bundle.file;
        diskAssets.current = opened.bundle.blobs;
        dispatch({ type: "load", bundle: opened.bundle, handle: opened.handle, fileName: opened.fileName });
      } catch (error) {
        reportError(error);
      }
    },
    [state.saveState, state.editingId, state.fileConflict, state.replay.active, dispatch, reportError],
  );
  const launchOpenRef = useRef(openLaunchedFile);
  launchOpenRef.current = openLaunchedFile;
  useEffect(() => {
    if (!window.launchQueue) return;
    window.launchQueue.setConsumer((params) => {
      const handle = params.files?.find((file) => file.kind === "file");
      if (handle) void launchOpenRef.current(handle);
    });
  }, []);

  // 浏览器确认满足安装条件后显示工具栏按钮；安装完成后 Windows 才会注册 .draft 文件处理器。
  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const doInstall = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  }, [installPrompt]);

  const doSave = useCallback(async () => {
    if (state.replay.active || saveInFlight.current || state.fileConflict || state.editingId || document.querySelector(".edge-label-input")) return;
    saveInFlight.current = true;
    setSavingIO(true);
    const stamp = { sessionId: state.sessionId, editRevision: state.editRevision };
    const previous = state.saveState;
    dispatch({ type: "markSaving" });
    try {
      const result = await saveDraft(state, { expectedFile: diskBaseline.current ?? undefined, expectedBlobs: diskAssets.current });
      if (result.status === "cancelled") {
        dispatch({ type: "markSaveCancelled", stamp, previous });
        return;
      }
      const handle = result.handle;
      if (currentState.current.sessionId !== stamp.sessionId) return;
      diskBaseline.current = state.file;
      diskAssets.current = state.blobs;
      if (handle && handle !== state.fileHandle)
        dispatch({ type: "setHandle", handle, fileName: handle.name, sessionId: stamp.sessionId });
      dispatch({ type: "markSaved", stamp });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      dispatch({ type: "markSaveError", stamp, message: `保存失败：${msg}（内容仍在内存中，可另存为）` });
    } finally { saveInFlight.current = false; setSavingIO(false); }
  }, [state, dispatch]);

  const doSaveAs = useCallback(async () => {
    if (saveInFlight.current || state.replay.active || state.editingId || document.querySelector(".edge-label-input")) return;
    saveInFlight.current = true;
    setSavingIO(true);
    const stamp = { sessionId: state.sessionId, editRevision: state.editRevision };
    const previous = state.saveState;
    dispatch({ type: "markSaving" });
    try {
      const result = await saveDraft(state, { forcePicker: true, copy: !!state.fileConflict, expectedFile: diskBaseline.current ?? undefined, expectedBlobs: diskAssets.current, forbiddenHandle: state.fileConflict ? state.fileHandle ?? undefined : undefined });
      if (currentState.current.sessionId !== stamp.sessionId) return;
      if (result.status === "cancelled") {
        dispatch({ type: "markSaveCancelled", stamp, previous });
        return;
      }
      if (result.status === "saved") {
        diskBaseline.current = state.file;
        diskAssets.current = state.blobs;
        dispatch({ type: "setHandle", handle: result.handle, fileName: result.handle?.name ?? result.fileName ?? state.fileName, sessionId: stamp.sessionId });
        dispatch({ type: "setFileConflict", sessionId: stamp.sessionId, message: null });
        dispatch({ type: "dismissExternal" });
        dispatch({ type: "markSaved", stamp });
      }
    } catch (e) {
      dispatch({ type: "markSaveError", stamp, message: e instanceof Error ? e.message : String(e) });
    } finally { saveInFlight.current = false; setSavingIO(false); }
  }, [state, dispatch]);

  const doExportStrip = useCallback(async () => {
    try {
      await saveDraft(state, { historyMode: "strip" });
    } catch (e) {
      reportError(e);
    }
  }, [state, reportError]);

  const doExportPng = useCallback(async () => {
    try {
      await exportBoardPng(state.file.board.name);
    } catch (e) {
      reportError(e);
    }
  }, [state.file.board.name, reportError]);

  // 自动保存：末次修改后 1.5s（目标 ≤2s，§6.2）
  const saveRef = useRef(doSave);
  saveRef.current = doSave;
  const autosaveFn = useCallback(() => saveRef.current(), []);
  useAutosave(state, autosaveFn, savingIO);

  // Ctrl+S 全局保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 浏览器刷新/关闭时保护未落盘修改，也保护仍在输入框中的草稿。
  const unloadState = useRef(state);
  unloadState.current = state;
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const current = unloadState.current;
      if (!current.fileConflict && current.editingId === null && !["dirty", "saving", "error"].includes(current.saveState)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
  const onFit = useCallback(() => { setLayoutFit(false); setFitNonce((n) => n + 1); }, []);
  const onLayout = (selectedOnly: boolean) => {
    if (layoutBusy) return;
    setLayoutResult(null);
    setLayoutBusy(true);
    // 先让“整理中”绘制一帧，再运行可能耗时的关系线/集合避让。
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        const result = editor.layoutTidy(selectedOnly);
        if (result.ok) {
          setLayoutFit(true);
          setFitNonce(n => n + 1);
          setLayoutResult(result.moved ? `已整理 ${result.moved} 张卡片` : result.outcome === "unresolved" ? "未找到更好的无冲突布局" : "已按当前规则排好，无需再移动");
        }
      } catch (error) { reportError(error); }
      finally { setLayoutBusy(false); }
    }));
  };

  // 调试探针：冒烟脚本只读检查用
  useEffect(() => {
    (window as unknown as { __state?: unknown }).__state = state;
  }, [state]);

  return (
    <div className="app">
      <Toolbar
        editor={editor}
        onNew={doNew}
        onOpen={() => void doOpen()}
        onSave={() => void doSave()}
        onSaveAs={() => void doSaveAs()}
        onExportStrip={() => void doExportStrip()}
        onExportPng={() => void doExportPng()}
        onFit={onFit}
        onLayout={onLayout}
        layoutBusy={layoutBusy}
          layoutResult={layoutResult}
        structureView={structureView}
        onToggleStructure={() => setStructureView((v) => !v)}
        onInstall={installPrompt ? () => void doInstall() : undefined}
      />
      <FileUpdates editor={editor} onSaveCopy={() => void doSaveAs()} />
      <Canvas editor={editor} fitNonce={fitNonce} layoutFit={layoutFit} structureView={structureView} />
      <ReplayBar editor={editor} />
    </div>
  );
}
