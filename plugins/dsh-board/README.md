# DSH-board 本地试用版

复用完整 Draft Board 页面，放在 DSH 原生对话左侧；右侧对话可以收起并拖动调整宽度。会话历史、模型选择、附件、工具与审批等继续使用 DSH 自己的组件。

当前适配本机 CLI 0.1.5-rc.1／组合包 0.1.5-rc.2。这是本地试用原型，构建后可打包安装；安装包包含白板页面和共享模型，不依赖仓库当前分支。尚未发布到 npm。

## 构建与安装

在 draft-board 仓库根目录运行：

```powershell
npm run build:dsh-board
npm run test:dsh-board
npm pack ./plugins/dsh-board --pack-destination ./artifacts
$env:DSH_HOME = 'E:\dsh\home'
New-Item -ItemType Directory -Force 'E:\dsh\home\local-plugins' | Out-Null
Copy-Item './artifacts/dsh-board-0.1.4.tgz' 'E:\dsh\home\local-plugins/dsh-board-0.1.4.tgz'
E:\dsh\dsh.cmd plugin --profile web add 'file:E:/dsh/home/local-plugins/dsh-board-0.1.4.tgz'
```

安装前备份 web profile 的 package.json、锁文件与 Cordis patch；使用 DSH CLI 增加插件，不手改 MCP／皮肤管理的派生配置。新增插件后重启 DSH Web Host。后续修改需重新构建、打包、安装并重启宿主。开发时也可使用 `link:` 指向仓库插件目录。卸载使用 `dsh plugin --profile web remove dsh-board` 并重启；草稿数据继续保留。

## 实际行为

- 当前草稿保存在 `$DSH_HOME/dsh-board/`，包含完整 `.draft` 内容、图片和历史。换聊天继续使用它；白板“新建”／“打开”显式更换，上一份宿主草稿文件保留。
- 原有文件打开／保存、卡片、公式、图片、连线、集合、布局、回放和撤销／重做操作保留。宿主持有一份副本；原生文件句柄只在当前页面有效，保存／另存为仍通过原有白板入口完成。
- 选区显示在对话上方。发送时将身份和短标题按原生消息 ID 单独提交，不改写回复文字，不自动附上全文；排队消息被处理时才成为本轮关联。AI 可按需调用 `draft_board_read`，再用 `draft_board_apply` 提交现有模型批次。
- AI 编辑使用同一套操作校验、身份与版本保护、历史和整轮撤销。浏览器快照另用修订号避免覆盖并行 AI 更新。刷新后读取当前宿主草稿。
- 同步约每 750ms 检查一次；输入、手势、布局和回放期间保留操作。AI 修改不自动移动视角。冲突时保留双方内容，暂停本地镜像；另存为后重新打开副本，明确选择继续维护的版本。

## 首版边界

只有一份“当前草稿”的绑定；不增加任务管理器、多人协作、自动合并或模型 API 配置。AI 工具读取结构与文本、保留图片资源，但首版没有新增图片视觉解析工具。详细消息／批次双向定位留待实际体验后讨论。

客户端通过 `shell.overlay` 加入面板，适配已安装 AppFrame 的中心列与 Conversation 的 `sendSession` 入口，保留原生消息提交、附件和取消流程；不修改 DSH 的 vendored 源码。此布局适配依赖当前宿主版本，升级 DSH 前需重新验证。

## 管理与上下文

在 DSH 的“设置 → DSH-board 白板”中管理“启用共同白板”和“发送时关联选中的卡片”。关闭共同白板恢复完整聊天区、注销白板工具和提示；草稿不删除，隐藏页面保留未提交输入。管理入口一直可用。设置与待处理关联保存在 `$DSH_HOME/dsh-board/plugin-state.json`，重新启动后继续生效。

固定使用说明在系统提示末尾注册，工具使用原生工具契约。本轮关联通过 `systemPrompt.context` 放在运行上下文最后，含当前 boardId 和关联卡片身份／短标题；不包含全文、时间戳、修订号或消息 ID。相同关联渲染相同文本，复用 DSH 的快照去重机制，不按每条回复重复追加；未选中时清除前一轮关联，更换白板不会沿用旧卡片。

动态变化在历史末尾追加，保留既有请求前缀；不重写已记录消息来换取去重。DSH 仍保留发生过变化的历史快照，缓存命中率取决于宿主与模型服务，不能保证固定百分比。旧版已写入的“关联卡片”文字保留在历史中，从新版发送的新回复开始使用单独上下文。
