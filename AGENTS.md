# 贡献者与编程 Agent 指南

本文件适用于整个仓库。目标是让没有项目上下文的人或 Agent 能安全地修改代码、验证行为并提交可审查的 PR。先阅读 [README](README.md) 与 [规格说明](docs/spec.md)，再读取涉及的源码和测试。

## 产品方向

Draft Board 是本地优先、文件可携带、编辑可撤销的数字草稿白板。优先保持输入顺畅、公式可读、关系可编辑、文件可恢复。不要在没有需求的情况下引入账号体系、云后端、遥测或模型 API 依赖。界面文案主要使用简体中文。

## 架构与修改入口

| 路径 | 职责 |
| --- | --- |
| `src/model/types.ts`、`validate.ts` | 文件 / 节点 / 连线 / 操作类型与运行时载荷校验 |
| `src/model/ops.ts`、`batch.ts` | 操作执行、结构约束、批次原子性与版本冲突 |
| `src/model/history.ts`、`replay.ts` | 步骤提交、逆操作、撤销 / 重做、历史回放 |
| `src/model/file.ts` | `.draft` ZIP 序列化、读取及内嵌资源 |
| `src/model/layout.ts`、`duplicate.ts` | 树状布局、落点避让、复制时重建身份 |
| `src/ui/store.ts` | React reducer、交互动作到模型操作的提交边界 |
| `src/ui/Canvas.tsx`、`NodeCard.tsx`、`EdgeLayer.tsx` | 画布手势、卡片编辑、连线绘制 |
| `src/ui/formulaLayout.ts`、`alignmentSnap.ts`、`view.ts` | 公式尺寸、附近卡片吸附、坐标转换 |
| `src/ui/markdown.ts`、`persistence.ts`、`exportPng.ts` | Markdown / KaTeX、浏览器文件接口、PNG 导出 |
| `src/App.tsx`、`src/styles.css` | 应用组合、文件启动、界面样式 |
| `scripts/agent-batch.mjs` | 外部 Agent 离线 CLI，复用 `dist-model/index.js` |
| `public/` | PWA manifest、Service Worker、项目图标 |
| `src/**/*.test.ts`、`scripts/verify-*.mjs`、`scripts/smoke-ui.mjs` | 模型单测与浏览器 / CLI 回归 |

数据流：用户手势 → reducer → 一组 `Op` → 模型校验与 `commitStep` → 新 `BoardFile` → 界面渲染 / 持久化。CLI 的批次也进入同一个模型内核。卡片使用 HTML，连线使用 SVG；尺寸测量属于 UI 层。模型必须保持不依赖 DOM、React、浏览器存储或网络，不能在 CLI 复制另一套业务规则。

## 必须保持的约束

- `.draft` 是 `board.json` 与内嵌图片组成的 ZIP。不得把本机绝对路径或远程图片地址当作内嵌资源保存。
- 节点、边和资源各自 ID 唯一。删除节点同步处理关联边；复制生成新 ID，只复制组内边。
- `parentChild` 是单父、无环的有向森林；`association` 可以跨分支或形成环。换父使用 `reparent`。
- 内容修改通过模型操作提交。`before` 从真实状态重新计算，不信任调用方提供的旧值；批次失败不得留下部分结果。
- 每次内容提交使 `contentVersion` 加一。历史只追加，撤销也追加逆操作；一次完整拖动或编辑是一个历史步骤，不能按每一帧写历史。
- Agent 必须核对 `boardId` 与 `baseContentVersion`；冲突时重读，不得跳过版本检查强行覆盖。
- 公式卡的 `w/h` 描述公式区域，独立备注不改变公式比例。连线、框选和吸附使用实际卡片外框，包含备注。未选中且未常驻展开时备注最多显示 15 行；选中或 `captionExpanded` 时展开全文。
- 普通文本卡与公式卡共用外壳：四角手柄在卡片外框，拖动等比缩放核心；左右手柄只改 `captionW`，不能压缩或拉长核心；关联圆点在右边框外。普通卡用 `coreScale` 缩放 18px 核心，高度随内容。核心区阅读分行只跟编辑源码换行，不按宽度自动折行。备注默认显示，结构视图仅隐藏呈现。不要自动按长度把主体迁移成备注。
- 吸附搜索与吸附容差不同：目标搜索半径为目标屏幕对角线一半，限制在 96–320 屏幕 px；对齐容差为 8 屏幕 px。转换到世界坐标时必须考虑 zoom。
- 保留 Markdown 原文，禁止为排版方便把公式转成不可编辑图片；Markdown 不开放原始 HTML 执行。
- 规格、实现和测试必须同步。新增字段 / op / 错误码时同步 `docs/spec.md`、类型、校验、执行、逆操作与回放，并说明旧文件兼容性。

## 修改与验证流程

使用 Node.js 22+，在仓库根目录执行。首次安装或依赖锁文件变化后运行：

```bash
npm ci
node node_modules/playwright-core/cli.js install chromium
```

Linux 环境缺少系统库时使用 `install --with-deps chromium`。脚本默认依次尝试系统 Chrome、Edge、Playwright Chromium；设置 `DRAFT_BROWSER=chromium` 可与 CI 保持一致，也可指定 `chrome` / `msedge`。测试会自行启动本地预览，预留端口 4180、4182、4184、4186；不要并行运行完整浏览器套件。生成的截图放在被 Git 忽略的 `artifacts/`。

**提交任何代码 PR 前，Agent 必须完整执行并通过 `npm run check`：**

| 命令（按执行顺序） | 必须验证的行为 |
| --- | --- |
| `npm run build` | 严格 TypeScript 检查；网页与共享 CLI 模型都可构建 |
| `npm test` | 模型操作、历史、文件、备注、Markdown、公式几何、视图和附近吸附的单元测试 |
| `npm run smoke:cli` | CLI 建板、validate 不写盘、apply 后可回读、历史 / 回放一致；冲突及中途失败不改文件 |
| `npm run smoke` | 真实浏览器基础编辑、手势、分支、连线、布局、保存与撤销等流程 |
| `npm run smoke:formula` | 公式居中与紧凑尺寸、备注编辑与撤销、缩放、文件往返及 PNG 导出 |
| `npm run smoke:alignment` | 实际拖动时附近对齐、大卡扩大搜索、远处卡片不成为目标、撤销 |
| `npm run smoke:concept` | 紧凑主体、默认备注、有序列表续号、结构视图及连线、保存与撤销、缩放；使用端口 4187 |
| `npm run smoke:edges` | 同向关联覆盖、撤销恢复、双向曲线分离与保存；使用端口 4190 |
| `npm run smoke:pwa` | manifest、模拟 launchQueue 打开 / 回写、缓存后离线重载 |

`npm run check` 是上述命令的顺序组合，CI 执行同一命令。纯文档 PR 可以注明未运行代码测试及原因，但仍需检查相对链接、示例命令与实现一致。测试环境缺失或命令失败时，明确记录阻塞与日志，不得声称通过、删断言或跳过失败来制造绿色结果。

对 bug 修复补充能复现问题的回归测试；对模型变化覆盖合法路径和拒绝路径，不只测试内部实现细节。UI / CSS 变化还需在真实浏览器检查截图，至少验证默认与非 100% 缩放、较长内容和输入法编辑。修改 PWA 安装 / 文件关联时，还要手动验证目标系统的安装、双击 `.draft`、保存及离线重开，自动模拟不能替代这一步。

目前没有单独的 lint 命令，也没有已保证的覆盖率门槛；不要在 PR 中捏造这些检查。

## PR 应包含什么

- 说明具体问题、触发条件、修改后的行为；交互变化附截图或短录屏。
- 列出实际执行的检查及结果、使用的 Node / 浏览器版本，以及未验证的部分。
- 修改文件格式或交互规则时更新公开规格；对不兼容变更写出影响和迁移方式。
- 保持改动集中，避免无关重构；依赖变化同步提交 `package-lock.json` 并解释必要性。
- 不提交 `node_modules/`、构建产物、测试截图、个人 `.draft`、凭据、环境文件或用户资料。示例必须是可公开的合成数据。
- Agent 不得替维护者决定合并 PR、发布版本或启用外部服务；遵循任务中明确授予的权限。

建议分支名 `codex/<简短主题>` 或 `feat/<简短主题>`。提交信息描述最终行为；PR 标题和说明可使用中文或英文。
