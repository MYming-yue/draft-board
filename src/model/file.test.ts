// 契约 §2-A 容器 + I7/I9：序列化/解析/脱历史。
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  commitStep,
  createEmptyBoard,
  parseBoard,
  serializeBoard,
  stripHistory,
  DraftError,
  type BoardFile,
} from "./index";

const N = (s: string) => `n_${s.padEnd(6, "_")}`;
const A = (s: string) => `a_${s.padEnd(6, "_")}`;

function boardWithImage(): { file: BoardFile; blob: Uint8Array } {
  let s = createEmptyBoard("图板");
  const asset = { id: A("img1"), mime: "image/png" as const, path: `assets/${A("img1")}.png`, bytes: 4 };
  s = {
    ...s,
    assets: [asset],
  };
  const r = commitStep(s, "贴图", "user", [
    {
      op: "addNode",
      node: { id: N("img"), type: "image", assetId: A("img1"), x: 0, y: 0, w: 320 },
      before: null,
      after: { id: N("img"), type: "image", assetId: A("img1"), x: 0, y: 0, w: 320 },
    },
  ]);
  if (!r.ok) throw new Error(r.error.message);
  return { file: r.state, blob: new Uint8Array([1, 2, 3, 4]) };
}

describe(".draft 容器（§2-A）", () => {
  it("序列化→解析 round-trip：board.json + assets/", () => {
    const { file, blob } = boardWithImage();
    const zip = serializeBoard(file, { [A("img1")]: blob });
    const parsed = parseBoard(zip);
    expect(parsed.file).toEqual(file);
    expect(Array.from(parsed.blobs[A("img1")])).toEqual([1, 2, 3, 4]);
  });

  it("round-trip 保留图片 caption（image 节点 markdown 字段）", () => {
    const { file, blob } = boardWithImage();
    const r = commitStep(file, "写 caption", "user", [
      { op: "updateNodeText", nodeId: N("img"), before: null, after: { markdown: "**说明** $E=mc^2$" } },
    ]);
    if (!r.ok) throw new Error(r.error.message);
    const parsed = parseBoard(serializeBoard(r.state, { [A("img1")]: blob }));
    expect(parsed.file.nodes.find((n) => n.id === N("img"))!.markdown).toBe("**说明** $E=mc^2$");
  });

  it("formatVersion 主版本 2 → E_FORMAT_UNSUPPORTED（I9，不静默丢内容）", () => {
    const s = createEmptyBoard("t");
    const zip = zipSync({
      "board.json": strToU8(JSON.stringify({ ...s, formatVersion: "2.0" })),
    });
    expect(() => parseBoard(zip)).toThrowError(DraftError);
    try {
      parseBoard(zip);
    } catch (e) {
      expect((e as DraftError).code).toBe("E_FORMAT_UNSUPPORTED");
    }
  });

  it("assets[] 有条目但容器缺文件 → E_ASSET_MISSING（I7）", () => {
    const { file } = boardWithImage();
    const zip = zipSync({ "board.json": strToU8(JSON.stringify(file)) });
    try {
      parseBoard(zip);
      expect.unreachable();
    } catch (e) {
      expect((e as DraftError).code).toBe("E_ASSET_MISSING");
    }
  });

  it("节点引用无条目 assetId → E_UNKNOWN_ASSET", () => {
    const s = createEmptyBoard("t");
    const bad: BoardFile = {
      ...structuredClone(s),
      nodes: [{ id: N("img"), type: "image", assetId: A("ghost"), x: 0, y: 0, w: 200 }],
    };
    const zip = zipSync({ "board.json": strToU8(JSON.stringify(bad)) });
    try {
      parseBoard(zip);
      expect.unreachable();
    } catch (e) {
      expect((e as DraftError).code).toBe("E_UNKNOWN_ASSET");
    }
  });

  it("缺 board.json / 非 ZIP → E_SCHEMA", () => {
    const zip = zipSync({ "foo.txt": strToU8("x") });
    try {
      parseBoard(zip);
      expect.unreachable();
    } catch (e) {
      expect((e as DraftError).code).toBe("E_SCHEMA");
    }
    try {
      parseBoard(new Uint8Array([1, 2, 3]));
      expect.unreachable();
    } catch (e) {
      expect((e as DraftError).code).toBe("E_SCHEMA");
    }
  });

  it("stripHistory：history=[]，其余不动（决议 Q2 只分享当前草稿）", () => {
    const { file } = boardWithImage();
    const stripped = stripHistory(file);
    expect(stripped.history).toEqual([]);
    expect(stripped.nodes).toEqual(file.nodes);
    expect(stripped.board.contentVersion).toBe(file.board.contentVersion);
    // 脱历史文件可序列化再解析
    const parsed = parseBoard(serializeBoard(stripped, { [A("img1")]: new Uint8Array([1, 2, 3, 4]) }));
    expect(parsed.file.history).toEqual([]);
  });
});
