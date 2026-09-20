#!/usr/bin/env node
// Agent 离线批次 CLI（契约 §2-D/E + §3-C）。
// 用法：
//   node scripts/agent-batch.mjs new <board.draft> [名称]     新建空板（打印 boardId）
//   node scripts/agent-batch.mjs validate <board.draft> <batch.json>  只校验不写盘
//   node scripts/agent-batch.mjs apply <board.draft> <batch.json>     校验+原子应用+原子写回
// 结果 JSON 打印到 stdout（§2-E 形状）；ok=false 时退出码 1，文件零改动。
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  applyBatch,
  createEmptyBoard,
  parseBoard,
  serializeBoard,
  DraftError,
} from "../dist-model/index.js";

function print(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function readDraft(path) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    print({ ok: false, error: { code: "E_SCHEMA", message: `读不到文件：${path}` } });
    process.exit(1);
  }
  try {
    return parseBoard(new Uint8Array(bytes));
  } catch (e) {
    if (e instanceof DraftError) {
      print({ ok: false, error: { code: e.code, message: e.message } });
      process.exit(1);
    }
    throw e;
  }
}

/** I8：写盘原子——临时文件 + 重命名；写入中断后上一份有效文件可打开。 */
function atomicWrite(path, bytes) {
  const tmp = path + ".tmp-" + process.pid;
  writeFileSync(tmp, bytes);
  renameSync(tmp, path);
}

function readBatch(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    print({ ok: false, error: { code: "E_SCHEMA", message: `batch.json 解析失败：${e.message}` } });
    process.exit(1);
  }
}

const [, , cmd, draftPath, third] = process.argv;

if (cmd === "new") {
  if (!draftPath) {
    process.stderr.write("用法：agent-batch.mjs new <board.draft> [名称]\n");
    process.exit(2);
  }
  const file = createEmptyBoard(third ?? "未命名白板");
  const out = resolve(draftPath);
  mkdirSync(dirname(out), { recursive: true });
  atomicWrite(out, serializeBoard(file, {}));
  print({ ok: true, boardId: file.board.id, contentVersion: file.board.contentVersion });
  process.exit(0);
}

if (cmd === "validate" || cmd === "apply") {
  if (!draftPath || !third) {
    process.stderr.write("用法：agent-batch.mjs <validate|apply> <board.draft> <batch.json>\n");
    process.exit(2);
  }
  const { file, blobs } = readDraft(resolve(draftPath));
  const batch = readBatch(resolve(third));
  const outcome = applyBatch(file, batch);
  if (!outcome.result.ok) {
    print(outcome.result);
    process.exit(1);
  }
  if (cmd === "apply") {
    atomicWrite(resolve(draftPath), serializeBoard(outcome.file, blobs));
  }
  print(outcome.result);
  process.exit(0);
}

process.stderr.write(
  "用法：\n  agent-batch.mjs new <board.draft> [名称]\n  agent-batch.mjs validate <board.draft> <batch.json>\n  agent-batch.mjs apply <board.draft> <batch.json>\n",
);
process.exit(2);
