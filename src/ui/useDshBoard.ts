import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { parseBoard, serializeBoard, type DraftBundle } from "../model";
import { sameDraftContent, verifyExternalUpdate, type ExternalChanges } from "./externalChanges";
import type { EditorApi } from "./store";
import { measureLayoutGeometry } from "./layoutGeometry";
import { layoutMovableIds } from "./layoutConstraints";

export const isDshBoard = new URLSearchParams(window.location.search).get("dshBoard") === "1";
interface Snapshot { revision: string; data: string; fileName: string }
interface LayoutTask { id:string; boardId:string; status:string; moved:number; contentVersion?:number; message?:string }
function encode(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function decode(data: string) { return Uint8Array.from(atob(data), c => c.charCodeAt(0)); }
async function request<T>(path: string, body?: object, method?: string): Promise<T> {
  const response = await fetch("/api/dsh-board/" + path, body ? { method: method ?? "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method:method ?? 'GET', cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error?.message ?? "共同白板连接失败"), { code: result.error?.code });
  return result as T;
}

export function useDshBoard(editor: EditorApi, layoutBusy: boolean) {
  const latest = useRef({ editor, layoutBusy }); latest.current = { editor, layoutBusy };
  const baseline = useRef<{ bundle: DraftBundle; revision: string; sessionId: string | null } | null>(null);
  const pending = useRef<{ snapshot: Snapshot; bundle: DraftBundle; changes: ExternalChanges; sessionId: string; editRevision: number } | null>(null);
  const blocked = useRef<string | null>(null);
  const task = useRef<Promise<void> | null>(null);
  const pointers = useRef(new Set<number>());
  const [loading, setLoading] = useState(isDshBoard);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("连接白板…");
  const [layoutTask,setLayoutTask] = useState<LayoutTask|null>(null);
  const [layoutSubmitting,setLayoutSubmitting] = useState(false);
  const activeLayout=useRef<LayoutTask|null>(null);
  activeLayout.current=layoutTask;
  const layoutLauncher=useRef<(selectedOnly:boolean)=>Promise<void>>(async()=>{throw new Error("白板尚未连接");});
  const admissions=useRef(new Map<string,{resolve:(task:LayoutTask)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>());
  useLayoutEffect(() => {
    if (!isDshBoard) return;
    const update = pending.current;
    if (update && editor.state.externalUpdate === update.changes && baseline.current) {
      baseline.current = { bundle: update.bundle, revision: update.snapshot.revision, sessionId: editor.state.sessionId };
      pending.current = null;
    } else if (update && (editor.state.sessionId !== update.sessionId || editor.state.editRevision !== update.editRevision || editor.state.editingId || editor.state.replay.active || editor.state.saveState === "saving")) {
      // A reducer guard may refuse an update after the asynchronous read.
      // Retry from the unchanged baseline rather than leaving the bridge stuck.
      pending.current = null;
    }
    if (baseline.current?.sessionId === null && sameDraftContent(editor.state.file, baseline.current.bundle.file)) baseline.current.sessionId = editor.state.sessionId;
  }, [editor.state]);

  useEffect(() => {
    if (!isDshBoard) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const post = (message: object) => window.parent.postMessage({ source: "dsh-board", ...message }, location.origin);
    const busy = () => {
      const { state } = latest.current.editor;
      return latest.current.layoutBusy || pointers.current.size > 0 || state.editingId || state.replay.active || state.saveState === "saving" || document.querySelector(".edge-label-input") || document.activeElement?.matches("input, textarea");
    };
    async function cycle() {
      if (stopped || !baseline.current || pending.current) return;
      const { state, dispatch } = latest.current.editor;
      const base = baseline.current;
      const replace = base.sessionId !== null && state.sessionId !== base.sessionId;
      if (blocked.current && !replace) throw new Error(blocked.current);
      if (replace) {
        // Explicit New/Open selects a draft, including a saved conflict copy.
        base.revision = (await request<Snapshot>("state")).revision;
        blocked.current = null; setError(null);
      }
      if (!busy() && (replace || !sameDraftContent(state.file, base.bundle.file))) {
        const sent = serializeBoard(state.file, state.blobs);
        const result = await request<{ revision: string }>("sync", { revision: base.revision, data: encode(sent), fileName: state.fileName, replace });
        if (stopped) return;
        baseline.current = { bundle: parseBoard(sent), revision: result.revision, sessionId: state.sessionId };
        if (!state.fileHandle) dispatch({ type: "markSaved", stamp: { sessionId: state.sessionId, editRevision: state.editRevision } });
        setStatus("已同步");
      }
      const snapshot = await request<Snapshot>("state?revision=" + encodeURIComponent(baseline.current!.revision));
      if (stopped) return;
      setError(null);
      const current = latest.current.editor.state;
      const known = baseline.current!;
      if (snapshot.revision === known.revision) {
        setStatus("已同步");
        if (!current.fileHandle && ["clean", "dirty"].includes(current.saveState) && sameDraftContent(current.file, known.bundle.file)) {
          latest.current.editor.dispatch({ type: "markSaved", stamp: { sessionId: current.sessionId, editRevision: current.editRevision } });
        }
        return;
      }
      if (!sameDraftContent(current.file, known.bundle.file)) throw Object.assign(new Error("DSH 中的草稿已更新，本地内容保留。请另存为后重新打开副本，继续同步。"), { code: "E_SYNC_CONFLICT" });
      if (busy()) { setStatus("AI 更新等待当前操作结束"); return; }
      const bundle = parseBoard(decode(snapshot.data));
      const changes = verifyExternalUpdate(known.bundle.file, bundle.file);
      if (!changes) { known.revision = snapshot.revision; return; }
      pending.current = { snapshot, bundle, changes, sessionId: current.sessionId, editRevision: current.editRevision };
      latest.current.editor.dispatch({ type: "receiveExternal", bundle, changes, pendingFileSave: !!current.fileHandle,
        stamp: { sessionId: current.sessionId, editRevision: current.editRevision } });
      setStatus("AI 已更新白板");
    }
    async function flush() {
      const next = (task.current ?? Promise.resolve()).catch(() => {}).then(cycle); task.current = next;
      try { await next; } finally { if (task.current === next) task.current = null; }
    }
    const fail = (cause: unknown) => {
      const text = cause instanceof Error ? cause.message : String(cause);
      if ((cause as { code?: string })?.code === "E_SYNC_CONFLICT") blocked.current = text;
      if (!stopped) { setError(text); setStatus("同步暂停"); }
    };
    async function tick() {
      try {
        await flush();
        const active=activeLayout.current;
        if(active && ['pending','running'].includes(active.status)) {
          try {
            const geometry=measureLayoutGeometry(latest.current.editor.state.file.nodes);
            const canvas=document.querySelector<HTMLElement>('.canvas');
            if(geometry && canvas && !busy()) await request('layout/geometry',{id:active.id,geometry,viewport:{width:canvas.clientWidth,height:canvas.clientHeight}});
            const next=await request<LayoutTask>('layout?id='+encodeURIComponent(active.id));
            if(!stopped)setLayoutTask(next);
          } catch(cause) {
            if(!stopped)setLayoutTask({...active,status:'failed',message:cause instanceof Error?cause.message:'布局连接已失效，请重新整理。'});
          }
        }
      } catch (cause) { fail(cause); }
      finally { if (!stopped) timer = setTimeout(tick, 750); }
    }
    const message = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window.parent || event.data?.source !== "dsh-board-host") return;
      if(event.data.type==='layout-admitted') {
        const admission=admissions.current.get(event.data.id);if(!admission)return;
        clearTimeout(admission.timer);admissions.current.delete(event.data.id);
        if(event.data.task)admission.resolve(event.data.task);else admission.reject(new Error(event.data.error ?? '布局任务未被接受。'));
        return;
      }
      if(event.data.type !== 'flush')return;
      void flush().then(() => post({ type: "flushed", id: event.data.id }), cause => { fail(cause); post({ type: "flushed", id: event.data.id, error: cause instanceof Error ? cause.message : String(cause) }); });
    };
    layoutLauncher.current=async(selectedOnly)=>{
      if(activeLayout.current && ['pending','running'].includes(activeLayout.current.status))throw new Error('已有布局任务，请等待完成或取消。');
      await flush();
      const state=latest.current.editor.state,base=baseline.current;
      if(busy() || pending.current || !base || !sameDraftContent(state.file,base.bundle.file))throw new Error('请结束当前编辑并等待白板同步，再整理布局。');
      const geometry=measureLayoutGeometry(state.file.nodes),canvas=document.querySelector<HTMLElement>('.canvas');
      if(!geometry || !canvas)throw new Error('卡片尺寸尚未就绪，请稍后重试。');
      const nodeIds=selectedOnly?[...layoutMovableIds(state.file,state.selection.nodes)]:state.file.nodes.map(n=>n.id);
      if(!nodeIds.length)throw new Error(selectedOnly?'请先选中要整理的卡片。':'白板为空，无需整理。');
      const id=crypto.randomUUID();
      const accepted=new Promise<LayoutTask>((resolve,reject)=>{
        const timer=setTimeout(()=>{admissions.current.delete(id);reject(new Error('任务提交未确认，请查看 DSH 对话。'));},20000);
        admissions.current.set(id,{resolve,reject,timer});
      });
      post({type:'layout-request',id,snapshot:{boardId:state.file.board.id,baseContentVersion:state.file.board.contentVersion,revision:base.revision,geometry,viewport:{width:canvas.clientWidth,height:canvas.clientHeight},nodeIds}});
      setLayoutTask(await accepted);
    };
    const down = (event: PointerEvent) => pointers.current.add(event.pointerId);
    const up = (event: PointerEvent) => pointers.current.delete(event.pointerId);
    const reset = () => pointers.current.clear();
    window.addEventListener("message", message);
    window.addEventListener("pointerdown", down, true); window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true); window.addEventListener("blur", reset);
    void request<Snapshot>("state").then(snapshot => {
      if (stopped) return;
      const bundle = parseBoard(decode(snapshot.data));
      baseline.current = { bundle, revision: snapshot.revision, sessionId: null };
      latest.current.editor.dispatch({ type: "load", bundle, handle: null, fileName: snapshot.fileName });
      setLoading(false); setStatus("已同步");
      void request<{task:LayoutTask|null}>('layout').then(result=>{if(!stopped && result.task?.boardId===bundle.file.board.id)setLayoutTask(result.task);}).catch(()=>{});
      timer = setTimeout(tick, 750);
    }).catch(fail);
    return () => {
      stopped = true; clearTimeout(timer);
      for(const admission of admissions.current.values()){clearTimeout(admission.timer);admission.reject(new Error('白板已关闭。'));}admissions.current.clear();
      window.removeEventListener("message", message);
      window.removeEventListener("pointerdown", down, true); window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true); window.removeEventListener("blur", reset);
    };
  }, []);
  useEffect(() => {
    if (!isDshBoard || loading) return;
    window.parent.postMessage({ source: "dsh-board", type: "selection", boardId: editor.state.file.board.id, status,
      cards: editor.state.selection.nodes.flatMap(id => {
        const node = editor.state.file.nodes.find(item => item.id === id);
        return node ? [{ id, title: node.markdown?.split("\n")[0].replace(/^#+\s*/, "").slice(0, 80) || "图片卡片" }] : [];
      }) }, location.origin);
  }, [editor.state.file, editor.state.selection, loading, status]);
  return { loading, error, embedded:isDshBoard, layoutTask, layoutRunning:layoutSubmitting || (!!layoutTask && ['pending','running'].includes(layoutTask.status)),
    requestLayout:async(selectedOnly:boolean)=>{setLayoutSubmitting(true);try{await layoutLauncher.current(selectedOnly);}finally{setLayoutSubmitting(false);}},
    cancelLayout:async()=>{if(layoutTask)setLayoutTask(await request<LayoutTask>('layout?id='+encodeURIComponent(layoutTask.id),undefined,'DELETE'));} };
}
