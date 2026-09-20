// 只读回放条（需求 §F10）：播放/暂停/重播/返回编辑；按 history 步进；播放中白板只读。
import { useEffect } from "react";
import type { EditorApi } from "./store";

export function ReplayBar({ editor }: { editor: EditorApi }) {
  const { state, dispatch } = editor;
  const total = state.file.history.length;
  const { step, playing } = state.replay;

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      if (step >= total) {
        dispatch({ type: "replayPlay", playing: false });
      } else {
        dispatch({ type: "replaySet", step: step + 1 });
      }
    }, 900);
    return () => clearInterval(t);
  }, [playing, step, total, dispatch]);

  if (!state.replay.active) return null;
  const current = step > 0 ? state.file.history[step - 1] : null;

  return (
    <div className="replay-bar">
      <button onClick={() => dispatch({ type: "replaySet", step: 0 })} title="回到起点">⏮</button>
      <button
        onClick={() => {
          if (!playing && step >= total) dispatch({ type: "replaySet", step: 0 });
          dispatch({ type: "replayPlay", playing: !playing });
          if (!playing && step >= total) dispatch({ type: "replayPlay", playing: true });
        }}
      >
        {playing ? "暂停" : step >= total ? "重播" : "播放"}
      </button>
      <input
        type="range"
        min={0}
        max={total}
        value={step}
        onChange={(e) => dispatch({ type: "replaySet", step: Number(e.target.value) })}
      />
      <span className="replay-step">
        {step}/{total}
      </span>
      <span className="replay-label">{current ? `${current.label}（${current.actor === "agent" ? "Agent" : "用户"}）` : "空板"}</span>
      <button onClick={() => dispatch({ type: "replayExit" })} title="回到当前草稿">
        返回编辑
      </button>
    </div>
  );
}
