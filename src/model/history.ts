// 契约 §3-D / I5：历史只增不减；撤销 = 追加逆操作步骤；重做 = 再追加正向步骤。
import type { Actor, ApplyResult, BatchError, BoardFile, HistoryStep, Op } from "./types";
import { applyOps, invertOps } from "./ops";

export type CommitResult =
  | { ok: true; state: BoardFile; step: HistoryStep }
  | { ok: false; error: BatchError };

/** 推进一步：校验+应用 ops，追加 {seq, at, actor, label, base, result, ops}，contentVersion +1。 */
export function commitStep(input: BoardFile, label: string, actor: Actor, ops: Op[]): CommitResult {
  const applied: ApplyResult = applyOps(input, ops);
  if (!applied.ok) return applied;
  const now = new Date().toISOString();
  const base = applied.state.board.contentVersion;
  const step: HistoryStep = {
    seq: applied.state.history.length + 1,
    at: now,
    actor,
    label,
    base,
    result: base + 1,
    ops: applied.ops,
  };
  applied.state.history.push(step);
  applied.state.board.contentVersion = base + 1;
  applied.state.board.updatedAt = now;
  return { ok: true, state: applied.state, step };
}

/**
 * 撤销：对 history[cursor-1] 求逆并追加为新步骤（历史只增不减）。
 * cursor 由调用方（编辑器）持有：正常编辑后 cursor = history.length；
 * 撤销后 cursor-1；返回 null 表示无可撤销。
 */
export function undo(
  input: BoardFile,
  cursor: number,
  actor: Actor = "user",
): { state: BoardFile; cursor: number; undone: HistoryStep; step: HistoryStep } | null {
  if (cursor < 1 || cursor > input.history.length) return null;
  const target = input.history[cursor - 1];
  const inverse = invertOps(target.ops);
  const committed = commitStep(input, `撤销：${target.label}`, actor, inverse);
  if (!committed.ok) throw new Error(`撤销失败：${committed.error.message}`);
  return { state: committed.state, cursor: cursor - 1, undone: target, step: committed.step };
}

/** 重做：把被撤销步骤的正向 ops 再追加一次（ops 的 before 由 applyOps 重算）。 */
export function redo(
  input: BoardFile,
  stepToRedo: HistoryStep,
  actor: Actor = "user",
): { state: BoardFile; step: HistoryStep } {
  const ops = structuredClone(stepToRedo.ops);
  const committed = commitStep(input, `重做：${stepToRedo.label}`, actor, ops);
  if (!committed.ok) throw new Error(`重做失败：${committed.error.message}`);
  return { state: committed.state, step: committed.step };
}
