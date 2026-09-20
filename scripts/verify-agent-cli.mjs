import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseBoard, replayTo, contentEqual } from "../dist-model/index.js";

mkdirSync("artifacts", { recursive: true });
const temp = mkdtempSync("artifacts/cli-");
const draft = join(temp, "board.draft");
const batchPath = join(temp, "batch.json");
function cli(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, ["scripts/agent-batch.mjs", ...args], { encoding: "utf8" });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
try {
  const created = cli(["new", draft, "Public CLI regression"]);
  assert.equal(created.ok, true);
  const batch = JSON.parse(readFileSync("examples/batch-demo.json", "utf8"));
  batch.boardId = created.boardId;
  batch.baseContentVersion = 0;
  writeFileSync(batchPath, JSON.stringify(batch));
  const original = readFileSync(draft);
  const validated = cli(["validate", draft, batchPath]);
  assert.equal(validated.ok, true);
  assert.equal(validated.appliedOps, batch.ops.length);
  assert.deepEqual(readFileSync(draft), original, "validate must not write");
  assert.deepEqual(cli(["apply", draft, batchPath]), validated);
  const committed = readFileSync(draft);
  const { file } = parseBoard(committed);
  assert.equal(file.board.contentVersion, 1);
  assert.equal(file.nodes.length, 5);
  assert.equal(file.history.length, 1);
  assert.equal(file.history[0].actor, "agent");
  assert.ok(contentEqual(replayTo(file), file), "history replays saved content");
  const conflict = cli(["apply", draft, batchPath], 1);
  assert.equal(conflict.error.code, "E_VERSION_CONFLICT");
  assert.deepEqual(readFileSync(draft), committed, "conflict must not write");
  const firstId = file.nodes[0].id;
  batch.baseContentVersion = 1;
  batch.ops = [
    { op: "updateNodeCaption", nodeId: firstId, before: null, after: { caption: "temporary change" } },
    { op: "moveNode", nodeId: "n_missing0", before: null, after: { x: 1, y: 1 } },
  ];
  writeFileSync(batchPath, JSON.stringify(batch));
  const invalid = cli(["apply", draft, batchPath], 1);
  assert.equal(invalid.error.code, "E_UNKNOWN_NODE");
  assert.equal(invalid.error.opIndex, 1);
  assert.deepEqual(readFileSync(draft), committed, "later failure must roll back the entire batch");
  console.log("CLI VERIFY PASS: create, validate, apply, replay, version conflict, atomic rejection");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
