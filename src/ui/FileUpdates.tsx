import type { EditorApi } from "./store";

export function FileUpdates({ editor, onSaveCopy }: { editor: EditorApi; onSaveCopy: () => void }) {
  const { state, dispatch } = editor;
  const update = state.externalUpdate;
  if (!state.fileConflict && !update) return null;
  const last = update?.steps.at(-1);
  return <aside className={`file-updates ${state.fileConflict ? "conflict" : ""}`} aria-label="文件更新">
    {state.fileConflict ? <>
      <span role="status">{state.fileConflict}</span>
      <button onClick={onSaveCopy} disabled={!!state.editingId || state.saveState === "saving" || state.replay.active}>另存本地副本</button>
    </> : update && <>
      <span role="status">{last?.actor === "agent" ? "Agent" : "外部"} 更新：{last?.label}。新增 {update.added.length}、修改 {update.updated.length}、删除 {update.removed.length} 张卡片；关系 {update.edges}、集合 {update.collections} 处变化。{update.steps.length > 1 ? `收到 ${update.steps.length} 个批次，每个批次可分别撤销。` : "本轮可一次撤销。"}</span>
      <button onClick={() => dispatch({ type: "select", nodes: update.nodes.filter(id => state.file.nodes.some(node => node.id === id)), edges: [] })}>选中改动</button>
      <button onClick={() => dispatch({ type: "undo" })} disabled={state.replay.active || !!state.editingId || state.cursor !== last?.seq} title="有后续操作时，请先按普通撤销顺序回退">撤销最新一轮</button>
      <details><summary>查看记录</summary><ul>
        {update.steps.map(step => <li key={step.seq}>{step.actor === "agent" ? "Agent" : "外部"}：{step.label}</li>)}
        {update.removed.map(node => <li key={node.id}>已删除：{node.title || node.id}</li>)}
      </ul></details>
      <button onClick={() => dispatch({ type: "dismissExternal" })}>收起提示</button>
    </>}
  </aside>;
}
