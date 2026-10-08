import { useCallback, useEffect, useRef, useState } from "react";
import { DraftError } from "./model";
import { Canvas } from "./ui/Canvas";
import { exportBoardPng } from "./ui/exportPng";
import { openDraft, openDraftHandle, saveDraft, useAutosave } from "./ui/persistence";
import { ReplayBar } from "./ui/ReplayBar";
import { useEditor } from "./ui/store";
import { Toolbar } from "./ui/Toolbar";

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
    if (state.saveState === "dirty" && !window.confirm("当前白板有未保存修改，确定新建并丢弃吗？")) return;
    dispatch({ type: "newBoard" });
  }, [state.replay.active, state.saveState, dispatch]);

  const doOpen = useCallback(async () => {
    if (state.replay.active) dispatch({ type: "replayExit" });
    try {
      const opened = await openDraft();
      if (!opened) return;
      dispatch({ type: "load", bundle: opened.bundle, handle: opened.handle, fileName: opened.fileName });
    } catch (e) {
      reportError(e);
    }
  }, [state.replay.active, dispatch, reportError]);

  // 已安装 PWA 从 Windows 双击 .draft 启动时，Chromium 会把真实文件句柄放入 launchQueue。
  const openLaunchedFile = useCallback(
    async (handle: FileSystemFileHandle) => {
      if (state.saveState === "dirty" && !window.confirm("当前白板有未保存修改，确定打开另一个文件吗？")) return;
      if (state.replay.active) dispatch({ type: "replayExit" });
      try {
        const opened = await openDraftHandle(handle);
        dispatch({ type: "load", bundle: opened.bundle, handle: opened.handle, fileName: opened.fileName });
      } catch (error) {
        reportError(error);
      }
    },
    [state.saveState, state.replay.active, dispatch, reportError],
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
    if (state.replay.active) return;
    const stamp = { sessionId: state.sessionId, editRevision: state.editRevision };
    const previous = state.saveState;
    dispatch({ type: "markSaving" });
    try {
      const result = await saveDraft(state);
      if (result.status === "cancelled") {
        dispatch({ type: "markSaveCancelled", stamp, previous });
        return;
      }
      const handle = result.handle;
      if (handle && handle !== state.fileHandle)
        dispatch({ type: "setHandle", handle, fileName: handle.name, stamp });
      dispatch({ type: "markSaved", stamp });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      dispatch({ type: "markSaveError", stamp, message: `保存失败：${msg}（内容仍在内存中，可另存为）` });
    }
  }, [state, dispatch]);

  const doSaveAs = useCallback(async () => {
    const stamp = { sessionId: state.sessionId, editRevision: state.editRevision };
    const previous = state.saveState;
    dispatch({ type: "markSaving" });
    try {
      const result = await saveDraft(state, { forcePicker: true });
      if (result.status === "cancelled") {
        dispatch({ type: "markSaveCancelled", stamp, previous });
        return;
      }
      if (result.handle) dispatch({ type: "setHandle", handle: result.handle, fileName: result.handle.name, stamp });
      dispatch({ type: "markSaved", stamp });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      dispatch({ type: "markSaveError", stamp, message: `保存失败：${msg}（内容仍在内存中，可另存为）` });
    }
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
  useAutosave(state, autosaveFn);

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
      if (current.editingId === null && !["dirty", "saving", "error"].includes(current.saveState)) return;
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
      <Canvas editor={editor} fitNonce={fitNonce} layoutFit={layoutFit} structureView={structureView} />
      <ReplayBar editor={editor} />
    </div>
  );
}
