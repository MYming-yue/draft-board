import { ACCENTS, type Accent } from "../model";
import type { EditorApi } from "./store";

interface ToolbarProps {
  editor: EditorApi;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportStrip: () => void;
  onExportPng: () => void;
  onFit: () => void;
  onInstall?: () => void;
}

const ACCENT_LABEL: Record<Accent, string> = {
  default: "默认",
  blue: "蓝",
  green: "绿",
  amber: "橙",
  red: "红",
};

function saveStatusText(s: string, hasHandle: boolean): { text: string; cls: string } {
  switch (s) {
    case "saving":
      return { text: "保存中…", cls: "saving" };
    case "saved":
      return { text: "已保存", cls: "saved" };
    case "error":
      return { text: "保存失败", cls: "error" };
    case "dirty":
      return { text: hasHandle ? "待保存（自动保存已排队）" : "未保存 · Ctrl+S 选择位置", cls: "dirty" };
    default:
      return { text: hasHandle ? "已保存" : "未关联文件", cls: "clean" };
  }
}

export function Toolbar(p: ToolbarProps) {
  const { state, dispatch } = p.editor;
  const sel = state.selection;
  const single = sel.nodes.length === 1 ? state.file.nodes.find((n) => n.id === sel.nodes[0]) : null;
  const status = saveStatusText(state.saveState, !!state.fileHandle);
  const canUndo = state.cursor > 0 && !state.replay.active;
  const canRedo = state.redoStack.length > 0 && !state.replay.active;

  const setAccent = (accent: Accent) => {
    if (!single) return;
    p.editor.commit("设置强调色", [
      {
        op: "setNodeAccent",
        nodeId: single.id,
        before: { accent: single.accent ?? "default" },
        after: { accent },
      },
    ]);
  };

  return (
    <div className="toolbar">
      <span className="brand">草稿白板</span>
      <input
        className="board-name"
        value={state.file.board.name}
        onChange={(e) => dispatch({ type: "rename", name: e.target.value })}
        title="白板名称"
      />
      <button onClick={p.onNew}>新建</button>
      <button onClick={p.onOpen}>打开</button>
      <button onClick={p.onSave} title="Ctrl+S">保存</button>
      <button onClick={p.onSaveAs}>另存为</button>
      <button onClick={p.onExportStrip} title="导出 history=[] 的 .draft（契约 §3-D）">只分享当前草稿</button>
      <button onClick={p.onExportPng}>导出 PNG</button>
      <span className="sep" />
      <button disabled={!canUndo} onClick={() => dispatch({ type: "undo" })} title="Ctrl+Z">
        撤销
      </button>
      <button disabled={!canRedo} onClick={() => dispatch({ type: "redo" })} title="Ctrl+Shift+Z">
        重做
      </button>
      <button onClick={p.editor.layoutTidy} disabled={state.replay.active} title="对选中分支（未选中则全部）做树状分层整理，可一次撤销">
        布局整理
      </button>
      <button onClick={p.onFit} title="回到全部内容可见">适应视图</button>
      {p.onInstall && <button onClick={p.onInstall} title="安装后可在 Windows 中直接双击 .draft 文件">安装桌面版</button>}
      <button
        disabled={state.file.history.length === 0 || state.replay.active}
        onClick={() => dispatch({ type: "replayEnter" })}
        title={state.file.history.length === 0 ? "脱历史文件不可回放" : "播放草稿生长过程"}
      >
        回放
      </button>
      {single && (
        <span className="accent-picker" title="强调色">
          {ACCENTS.map((a) => (
            <button
              key={a}
              className={`accent-dot accent-${a}` + ((single.accent ?? "default") === a ? " active" : "")}
              title={ACCENT_LABEL[a]}
              onClick={() => setAccent(a)}
            />
          ))}
        </span>
      )}
      <span className="spacer" />
      {state.saveError && <span className="save-error" title={state.saveError}>⚠ {state.saveError}</span>}
      <span className={`save-status ${status.cls}`}>{status.text}</span>
    </div>
  );
}
