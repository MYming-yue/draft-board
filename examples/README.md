# Agent 批次示例

本目录为合成示例，不包含个人白板。格式说明见 [公开规格](../docs/spec.md)。

`batch-demo.json`：5 个 addNode + 4 个 addEdge + 1 个 updateNodeText，共 10 个 op，
演示 Agent 离线「读取文件 → 生成修改 → 导入验证」闭环。

## 跑通主路径

```bash
# 0. 先构建（生成 dist-model/index.js 供 CLI 复用模型代码）
npm run build

# 1. 新建一块空板，记下打印的 boardId
node scripts/agent-batch.mjs new examples/demo.draft 演示板
# → {"ok":true,"boardId":"b_xxxxxxxxxxxx","contentVersion":0}

# 2. 把 boardId 填进批次（把 b_xxxxxxxxxxxx 换成上一步的实际值）
node -e "const fs=require('fs');const p='examples/batch-demo.json';const b=JSON.parse(fs.readFileSync(p,'utf8'));b.boardId='b_xxxxxxxxxxxx';fs.writeFileSync(p,JSON.stringify(b,null,2))"

# 3. 只校验不写盘
node scripts/agent-batch.mjs validate examples/demo.draft examples/batch-demo.json
# → {"ok":true,"contentVersion":1,"appliedOps":10}

# 4. 原子应用并写回
node scripts/agent-batch.mjs apply examples/demo.draft examples/batch-demo.json
# → {"ok":true,"contentVersion":1,"appliedOps":10}
#    history 追加一个 actor=agent 的步骤，含全部 10 个 op（可一次撤销）

# 5. 用编辑器打开 examples/demo.draft 检查，可继续编辑
npm run dev
```

## 验证版本冲突

apply 成功后 contentVersion 已从 0 变成 1，此时用原批次（baseContentVersion=0）再跑一次：

```bash
node scripts/agent-batch.mjs apply examples/demo.draft examples/batch-demo.json
# → {"ok":false,"error":{"code":"E_VERSION_CONFLICT","message":"baseContentVersion=0 ≠ 当前 contentVersion=1；请重读文件后重新生成批次"}}
# 退出码 1，文件零改动，不产生分叉版本
```

## 验证可定位错误

把批次里某个 addEdge 的 `from` 改成不存在的 `n_ghost00`，应得：

```json
{"ok":false,"error":{"code":"E_UNKNOWN_NODE","message":"边起点不存在：n_ghost00","opIndex":5,"path":"ops.5.edge.from"}}
```

文件零改动（contentVersion 不变，history 无新增）。
