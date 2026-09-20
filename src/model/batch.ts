// 契约 §2-D/§2-E + §3-C：Agent 批量操作。
// 校验顺序：批次形状(E_SCHEMA) → boardId(E_BOARD_MISMATCH) → baseContentVersion(E_VERSION_CONFLICT)
// → 逐 op（形状/引用/环/多父，带 opIndex/path）。任一失败整批拒绝，输入文件零改动。
import { err } from "./errors";
import { commitStep } from "./history";
import type { AgentBatch, BatchResult, BoardFile } from "./types";
import { validateBatchShape } from "./validate";

export type BatchApplyOutcome =
  | { result: BatchResult & { ok: true }; file: BoardFile }
  | { result: BatchResult & { ok: false }; file: null };

export function applyBatch(input: BoardFile, batch: AgentBatch): BatchApplyOutcome {
  const bad = validateBatchShape(batch);
  if (bad) {
    const opIndex = /^ops\.(\d+)\./.exec(bad.path)?.[1];
    return {
      result: {
        ok: false,
        error: err(
          "E_SCHEMA",
          `批次不符 schema：${bad.message}（${bad.path}）`,
          opIndex !== undefined ? Number(opIndex) : undefined,
          bad.path,
        ),
      },
      file: null,
    };
  }
  if (batch.boardId !== input.board.id)
    return {
      result: {
        ok: false,
        error: err("E_BOARD_MISMATCH", `boardId 不符：批次 ${batch.boardId} ≠ 文件 ${input.board.id}`),
      },
      file: null,
    };
  if (batch.baseContentVersion !== input.board.contentVersion)
    return {
      result: {
        ok: false,
        error: err(
          "E_VERSION_CONFLICT",
          `baseContentVersion=${batch.baseContentVersion} ≠ 当前 contentVersion=${input.board.contentVersion}；请重读文件后重新生成批次`,
        ),
      },
      file: null,
    };
  const committed = commitStep(input, batch.label, "agent", batch.ops);
  if (!committed.ok) return { result: { ok: false, error: committed.error }, file: null };
  return {
    result: {
      ok: true,
      contentVersion: committed.state.board.contentVersion,
      appliedOps: committed.step.ops.length,
    },
    file: committed.state,
  };
}
