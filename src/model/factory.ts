import { makeId } from "./ids";
import { FORMAT_VERSION, type BoardFile } from "./types";

/** 新建空板：history 从空起记（决议 Q2 默认全程记录），contentVersion=0。 */
export function createEmptyBoard(name = "未命名白板"): BoardFile {
  const now = new Date().toISOString();
  return {
    formatVersion: FORMAT_VERSION,
    board: {
      id: makeId("board"),
      name,
      createdAt: now,
      updatedAt: now,
      contentVersion: 0,
      view: { panX: 0, panY: 0, zoom: 1 },
    },
    nodes: [],
    edges: [],
    assets: [],
    history: [],
  };
}
