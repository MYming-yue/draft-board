import { expect, it } from "vitest";
import { editorReducer, initialEditorState } from "./store";

it("忽略保存期间新增修改对应的旧保存结果", () => {
  let state = editorReducer(initialEditorState(), { type: "rename", name: "第一版" });
  const stamp = { sessionId: state.sessionId, editRevision: state.editRevision };
  state = editorReducer(state, { type: "markSaving" });
  state = editorReducer(state, { type: "rename", name: "第二版" });
  state = editorReducer(state, { type: "markSaved", stamp });
  expect(state.saveState).toBe("dirty");
  expect(state.file.board.name).toBe("第二版");

  const latest = { sessionId: state.sessionId, editRevision: state.editRevision };
  state = editorReducer(state, { type: "markSaving" });
  state = editorReducer(state, { type: "markSaved", stamp: latest });
  expect(state.saveState).toBe("saved");
});

it("取消文件选择后保持未保存；新白板不受旧保存回调影响", () => {
  let state = editorReducer(initialEditorState(), { type: "rename", name: "未保存" });
  const stamp = { sessionId: state.sessionId, editRevision: state.editRevision };
  state = editorReducer(state, { type: "markSaving" });
  state = editorReducer(state, { type: "markSaveCancelled", stamp, previous: "dirty" });
  expect(state.saveState).toBe("dirty");

  state = editorReducer(state, { type: "newBoard" });
  state = editorReducer(state, { type: "markSaved", stamp });
  state = editorReducer(state, { type: "markSaveError", stamp, message: "旧文件失败" });
  expect(state.saveState).toBe("clean");
  expect(state.saveError).toBeNull();
});

it("新白板的建议文件名随名称更新，已打开文件保持原文件名", () => {
  let state = editorReducer(initialEditorState(), { type: "rename", name: "梯度草稿" });
  expect(state.file.board.name).toBe("梯度草稿");
  expect(state.fileName).toBe("梯度草稿.draft");
  state = editorReducer(state, { type: "rename", name: "最终草稿" });
  expect(state.fileName).toBe("最终草稿.draft");

  state = editorReducer(state, {
    type: "load",
    bundle: { file: state.file, blobs: {} },
    handle: null,
    fileName: "磁盘上的名字.draft",
  });
  state = editorReducer(state, { type: "rename", name: "文件内部标题" });
  expect(state.file.board.name).toBe("文件内部标题");
  expect(state.fileName).toBe("磁盘上的名字.draft");
});
