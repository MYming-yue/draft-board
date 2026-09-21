# Draft Board · 数字草稿白板

[![CI](https://github.com/MYming-yue/draft-board/actions/workflows/ci.yml/badge.svg)](https://github.com/MYming-yue/draft-board/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**把零散想法放到同一张画布上，让推导、关系和思考过程都能留下来。**

A local-first, editable whiteboard for notes, equations, and connected thinking. Built for people and coding agents to work on the same portable file.

Draft Board 是一个本地优先的无限画布工具。你可以把 Markdown、LaTeX 公式和图片组成卡片，用连线表达关系，在草稿成熟后继续整理，而不必一开始就决定文档的章节结构。当前为 **0.1 早期版本**，界面以简体中文为主，主要面向桌面 Chrome / Edge。

## 为什么做这个项目

- **先思考，再排版。** 草稿允许跳跃、分支和反复修改。画布提供空间，卡片和关系帮助想法逐渐成形。
- **结构应该留得住。** 一张截图只能保留外观；可编辑的卡片身份、公式源码和父子关系，才让后续推导与修改成为可能。
- **文件属于使用者。** 一份 `.draft` 文件携带卡片、连线、图片和历史。基础编辑无需账号、后端或云服务。
- **过程也有价值。** 撤销、重做和回放记录思路如何生长；分享时也可以只保留当前草稿。
- **让 Agent 参与同一份草稿。** 人通过界面编辑，Agent 通过受校验的操作批次编辑。两者共用模型、历史和版本冲突规则。

## 现在可以做什么

- 在无限画布上创建、移动、缩放和多选卡片，建立父子分支与普通关联线。
- 核心表达与备注分层：概念、主张和公式居中呈现，卡片贴合内容；详细解释默认显示在下方备注区。
- 一键切换结构视图，暂时隐藏备注；恢复后完整显示，不改变卡片位置与保存内容。
- 编辑 Markdown 和行内 / 块级 LaTeX；有序列表按钮延续当前列表编号。
- 粘贴或拖入 PNG / JPEG 图片，并为图片添加说明。
- 拖动时自动吸附附近卡片的边缘或中轴线，显示对齐辅助线；搜索范围随目标卡片大小调整。
- 将父子分支整理为向右展开的树状布局。
- 保存、打开和分享可编辑的 `.draft` 文件，导出 PNG，撤销 / 重做与历史回放。
- 安装为 PWA，缓存应用壳后离线打开；通过 CLI 让 Agent 校验并应用批量修改。

## 本地运行

需要 **Node.js 22 或更新版本**（含 npm）、Git，以及桌面浏览器。

```bash
git clone https://github.com/MYming-yue/draft-board.git
cd draft-board
npm ci
npm run dev
```

打开终端显示的本地地址（通常是 `http://localhost:5173`）。构建与本地预览：

```bash
npm run build
npm run preview
```

`dist/` 是网页产物，`dist-model/` 是 CLI 复用的模型产物。部署网页时需要 HTTPS 或 localhost 才能使用 Service Worker 和部分文件 API；当前 PWA 的路径配置要求部署在域名根路径。

Windows 用户可运行 `安装桌面版.bat`，按浏览器提示安装 PWA。系统文件关联取决于浏览器及操作系统支持；普通网页也可用“打开”按钮读取 `.draft`。

## 基本操作

| 操作 | 方法 |
| --- | --- |
| 新建 / 编辑卡片 | 双击画布空白处 / 双击卡片 |
| 创建子卡片 / 同级卡片 | 选中卡片后 `Tab` / `Shift+Enter` |
| 平移画布 | 拖动画布空白处，或在未编辑时使用 WASD / 方向键 |
| 缩放画布 | `Ctrl+滚轮`，或 `Alt+左键`在空白处上下拖动 |
| 框选卡片 | `Shift+左键`拖动 |
| 换父节点 | `Alt` 拖动卡片到目标父卡片 |
| 保存 | `Ctrl+S` 或工具栏保存按钮 |
| 编辑卡片备注 | 选中卡片，点击“添加备注”或“编辑备注” |
| 查看整体结构 | 点击“结构视图”隐藏备注，点击“显示备注”恢复 |
| 提交 / 取消卡片编辑 | `Ctrl+Enter` / `Esc` |

首次保存选择文件后，支持 File System Access API 的浏览器可回写原文件；其他浏览器使用下载方式。重要内容请保存为 `.draft`，不要只依赖页面状态。默认保存包含历史，分享前可选择只分享当前草稿。

## 与 Agent 一起编辑

不需要模型 API key 或内置 AI 服务。外部 Agent 可以生成 JSON 操作批次，再通过项目 CLI 校验、应用：

```bash
npm run build
node scripts/agent-batch.mjs new examples/demo.draft 演示板
node scripts/agent-batch.mjs validate examples/demo.draft examples/batch-demo.json
node scripts/agent-batch.mjs apply examples/demo.draft examples/batch-demo.json
```

执行前，需将批次的 `boardId` 替换为新建命令返回的 ID，并使用当前 `baseContentVersion`。完整步骤见 [示例](examples/README.md)；文件格式、操作词汇和冲突处理见 [规格说明](docs/spec.md)。一个批次作为一个历史步骤提交，版本冲突或非法操作会整批拒绝。

## 架构与贡献

项目使用 **React + TypeScript + Vite**。纯 TypeScript 模型负责文件、操作和历史；React 界面负责交互；浏览器和 CLI 共用同一个模型内核。

欢迎提交 bug、交互改进和 PR。请先阅读 [AGENTS.md](AGENTS.md)：其中包含目录架构、数据不变式、规格维护要求及提交前检查。无论人工还是 Agent 编写的代码，都适用同一套验证要求。

```bash
npm ci
node node_modules/playwright-core/cli.js install chromium
npm run check
```

`check` 会依次执行类型检查与构建、单元测试、CLI 回归和五组真实浏览器检查。Linux 首次配置浏览器可使用 `install --with-deps chromium`。GitHub Actions 使用同一入口。

## 当前边界

- 仍是早期项目，尚未实现多人协作、云同步、PDF 导出或完整移动端交互。
- 布局整理按父子关系和估算高度排列；普通关联线不参与，复杂或多根布局尚不能保证无重叠。
- PNG 导出中的公式字体可能与画布略有差异；图片文件目前限 PNG / JPEG，单张不超过 5 MB。
- PWA 离线能力依赖已缓存的资源；自动化测试模拟文件启动事件，不能代替真实系统的安装与文件关联验收。
- 新版可以读取旧文件；包含新操作（例如公式备注）的历史不保证能由旧版读取。

## 许可与致谢

项目源码采用 [MIT License](LICENSE)。第三方依赖保留各自许可证。感谢 React、Vite、TypeScript、KaTeX、markdown-it、fflate、nanoid、Vitest 和 Playwright。
