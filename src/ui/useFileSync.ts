import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import type { BoardFile, DraftBundle } from "../model";
import type { ExternalChanges } from "./externalChanges";
import { sameDraftAssets, sameDraftContent, verifyExternalUpdate } from "./externalChanges";
import { openDraftHandle } from "./persistence";
import type { EditorApi } from "./store";

export function useFileSync(editor: EditorApi, baseline: MutableRefObject<BoardFile | null>, assets: MutableRefObject<Record<string, Uint8Array>>, saving: MutableRefObject<boolean>, layoutBusy: boolean) {
  const latest = useRef({ editor, layoutBusy });
  latest.current = { editor, layoutBusy };
  const pending = useRef<{ sessionId: string; bundle: DraftBundle; changes: ExternalChanges } | null>(null);
  // Advance the disk baseline only after the reducer actually accepts the update.
  // A queued user edit can make receiveExternal reject its stale stamp.
  useLayoutEffect(() => {
    const update = pending.current;
    if (!update) return;
    if (editor.state.sessionId === update.sessionId && editor.state.externalUpdate === update.changes) {
      baseline.current = update.bundle.file;
      assets.current = update.bundle.blobs;
    }
    pending.current = null;
  }, [editor.state, baseline, assets]);
  const pointers = useRef(new Set<number>());
  useEffect(() => {
    const down = (event: PointerEvent) => pointers.current.add(event.pointerId);
    const up = (event: PointerEvent) => pointers.current.delete(event.pointerId);
    const reset = () => pointers.current.clear();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("pointerdown", down, true); window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true); window.removeEventListener("blur", reset);
    };
  }, []);
  useEffect(() => {
    const handle = editor.state.fileHandle;
    if (!handle) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      const before = latest.current.editor.state;
      const base = baseline.current;
      const baseAssets = assets.current;
      try {
        if (saving.current || !base) return;
        const opened = await openDraftHandle(handle);
        const { state, dispatch } = latest.current.editor;
        if (stopped || state.sessionId !== before.sessionId || state.fileHandle !== handle || baseline.current !== base || assets.current !== baseAssets || saving.current) return;
        if (!sameDraftAssets(baseAssets, opened.bundle.blobs)) throw new Error("外部图片资源发生变化，不能自动接收；当前画布保留。");
        if (sameDraftContent(base, opened.bundle.file)) {
          if (state.fileConflict) dispatch({ type: "setFileConflict", sessionId: state.sessionId, message: null });
          return;
        }
        const changes = verifyExternalUpdate(base, opened.bundle.file);
        if (!changes) return;
        if (!sameDraftContent(state.file, base)) {
          dispatch({ type: "setFileConflict", sessionId: state.sessionId, message: "磁盘有外部更新，本地也有未保存修改。已暂停回写，双方内容保留；请另存本地副本。" });
          return;
        }
        // In-progress text, gestures and replay must never be replaced under the user.
        if (latest.current.layoutBusy || pointers.current.size) return;
        if (state.editingId || state.replay.active || document.querySelector(".edge-label-input") || document.activeElement?.matches("input, textarea")) {
          dispatch({ type: "setFileConflict", sessionId: state.sessionId, message: "磁盘有外部更新，当前编辑或回放保留；完成或取消编辑、退出回放后再检查。" });
          return;
        }
        pending.current = { sessionId: state.sessionId, bundle: opened.bundle, changes };
        dispatch({ type: "receiveExternal", bundle: opened.bundle, changes, stamp: { sessionId: state.sessionId, editRevision: state.editRevision } });
      } catch (error) {
        const { state, dispatch } = latest.current.editor;
        if (!stopped && state.sessionId === before.sessionId && state.fileHandle === handle && !saving.current) {
          dispatch({ type: "setFileConflict", sessionId: state.sessionId, message: `${error instanceof Error ? error.message : String(error)} 自动回写暂停。` });
        }
      } finally { if (!stopped) timer = setTimeout(check, 1500); }
    };
    void check();
    return () => { stopped = true; clearTimeout(timer); };
  }, [editor.state.fileHandle, editor.state.sessionId, baseline, assets, saving]);
}
