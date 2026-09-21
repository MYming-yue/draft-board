# Draft Board 公开规格

本文随源码维护，描述当前 `.draft` 格式、Agent 批次和编辑行为。类型的精确载荷定义见 [`src/model/types.ts`](../src/model/types.ts)，运行时校验见 [`validate.ts`](../src/model/validate.ts)。当前没有单独发布可供通用 JSON Schema 校验器加载的 schema 文件；不能把 TypeScript 类型检查当作运行时输入校验。

## 1. 范围与实现边界

核心对象是带身份的卡片与关系。保存、复制、撤销、回放与 Agent 修改应保留可编辑结构。界面与 CLI 共用操作词汇；一次 Agent 批次对应一个历史步骤。

模型校验、ZIP 读取和浏览器界面的能力并不完全等价。例如 `parseBoard` 验证载荷形状与资源引用，不能视为对任意外部历史的完整回放验证。处理不可信文件的完整资源配额与恶意 ZIP 防护仍需加强。

## 2. 数据契约

### 2-A. 容器

`.draft` 是 ZIP，包含 UTF-8 `board.json` 和零到多个 `assets/<assetId>.png|jpg|jpeg` 图片。图片随文件携带，禁止外部绝对路径引用；单个资源声明大小为 1–5,242,880 字节。缺失资源应明确报错。

### 2-B. board.json

| 字段 | 内容 |
| --- | --- |
| `formatVersion` | 当前为 `"1.0"`；未知主版本拒绝读取 |
| `board` | `id`、`name`、`createdAt`、`updatedAt`、`contentVersion`、`view` |
| `nodes` | 卡片数组 |
| `edges` | 关系数组 |
| `assets` | 图片元数据数组：`id`、`mime`、`path`、`bytes` |
| `history` | 历史步骤数组；脱历史分享时为空 |

`view` 含 `panX/panY/zoom`，zoom 范围为 `(0,10]`。节点、边、资源、白板的 ID 分别使用 `n_`、`e_`、`a_`、`b_` 前缀，后接 6–32 个字母、数字、下划线或短横线。

节点公共字段：`id/type/x/y/w`，可选 `h/accent/captionExpanded/coreScale/captionW`。位置是有限世界坐标，宽度大于零，`h` 可缺省、为 null 或为正数。颜色为 `default/blue/green/amber/red`。`captionExpanded` 为布尔值，缺省或 `false` 表示未选中时备注按 15 行截断；`true` 表示阅读态常驻展开。`coreScale` 为普通文本核心比例，缺省 1。`captionW` 为备注阅读宽度。

- `type=text`：必须含 `markdown` 字符串，可含独立 `caption` 字符串。
- `type=image`：必须含 `assetId`，可选 `markdown` 作为图片说明；不使用 `caption`。
- 普通文本卡以 `markdown` 为核心表达，居中、18px×`coreScale` 强调呈现；解释由独立 `caption` 承载，默认可见、左对齐、13px 较弱颜色。核心区阅读态只按编辑源码中的换行分行，不按宽度自动折行；编辑态同样不自动折行，用 Enter 控制阅读分行。不根据字数自动把正文迁移到备注。
- 文本/公式卡外框宽度为 `max(核心区宽, 备注阅读宽)`。四角手柄在**卡片外框**四角（与原公式卡相同），比例由指针相对按下点的距离决定（往外放大、往里缩小），等比缩放核心，备注字号不变。左右手柄只改 `captionW`（最低 `max(220, 核心宽)`，最高 800），不能压缩或拉长核心文字。缺省 `captionW` 时有备注则至少 220。
- 纯公式文本卡的 `w/h` 仍描述公式区域，公式居中并等比缩放；备注以正常字号排列在其下方。图片保持原比例，外框高度包含可见说明。关联圆点在所有卡片右边框外 24px。
- 备注阅读态默认最多 15 行，超出截断；单击选中卡片时展开全文。编辑区固定 15 行高，并提供「常驻展开」开关（默认关闭），写入 `captionExpanded`。结构视图仍整段隐藏备注。
- 纯公式由 Markdown 去除首尾空白后是否整体为单个 `$...$` 或 `$$...$$` 判断；混合正文保留普通卡片布局。渲染失败保留源码。

边包含 `id/kind/from/to/directed`，可选 `label`。`parentChild` 必须有向、单父、无环；`association` 可以跨分支与形成循环。

兼容性：新读取器接受无 `caption` / `captionExpanded` / `coreScale` / `captionW` 的旧文件。增加 `updateNodeCaption`、`setCaptionExpanded`、`setCaptionWidth` 以及 `resizeNode.coreScale` 后，包含这些操作的历史可能被旧程序以 `E_SCHEMA` 拒绝；不能仅凭 `formatVersion=1.0` 推断双向兼容。

### 2-C. 操作词汇

所有操作由模型统一执行，`before` 根据真实当前状态重新生成。调用方通常传入 `before: null`；完整历史保存归一化后的 `before/after`。

| op | 标识 / 载荷 | after |
| --- | --- | --- |
| `addNode` | `node` | 完整 node |
| `removeNode` | `nodeId` | null；before 保存节点及其边 |
| `updateNodeText` | `nodeId` | `{markdown}`，含图片说明 |
| `updateNodeCaption` | `nodeId` | `{caption: string或null}`，仅 text；null 删除字段 |
| `moveNode` | `nodeId` | `{x,y}` |
| `resizeNode` | `nodeId` | `{w,h, coreScale?}`；`coreScale` 缺省不改，`null` 删除字段 |
| `setNodeAccent` | `nodeId` | `{accent}` |
| `setCaptionExpanded` | `nodeId` | `{expanded: boolean}`；`false` 删除字段 |
| `setCaptionWidth` | `nodeId` | `{captionW: number或null}`；null 删除字段 |
| `addEdge` | `edge` | 完整 edge |
| `removeEdge` | `edgeId` | null |
| `updateEdge` | `edgeId` | `{from,to,label?,directed}` |
| `reparent` | `nodeId` | `{parentId: string或null}` |

### 2-D. Agent 批次

```json
{
  "batchVersion": "1.0",
  "boardId": "b_example0",
  "baseContentVersion": 0,
  "actor": "agent",
  "label": "添加一个想法",
  "ops": [{
    "op": "addNode",
    "node": {"id":"n_example0","type":"text","markdown":"一个想法","x":80,"y":80,"w":240},
    "before": null,
    "after": {"id":"n_example0","type":"text","markdown":"一个想法","x":80,"y":80,"w":240}
  }]
}
```

替换为实际 `boardId` 和当前 `contentVersion` 才可提交。校验顺序为批次形状 → 白板身份 → 版本 → 各操作。任何一步失败，整批不提交。CLI 的 `validate` 仅验证，`apply` 验证后使用同目录临时文件与重命名写回；这不是跨进程文件锁，同时运行的外部写入者仍需自行协调。

### 2-E. 结果与错误

成功：`{"ok":true,"contentVersion":1,"appliedOps":1}`。

失败：`{"ok":false,"error":{"code":"E_VERSION_CONFLICT","message":"..."}}`，CLI 退出码 1。操作相关错误可含从零起的 `opIndex` 和 `path`；未应用操作数不作为失败结果字段返回。

封闭错误码：`E_SCHEMA`、`E_BOARD_MISMATCH`、`E_VERSION_CONFLICT`、`E_DUP_ID`、`E_UNKNOWN_NODE`、`E_UNKNOWN_EDGE`、`E_UNKNOWN_ASSET`、`E_PARENT_CYCLE`、`E_MULTI_PARENT`、`E_ASSET_MISSING`、`E_FORMAT_UNSUPPORTED`。

## 3. 行为契约

### 3-A. 分支

Tab 创建子卡；Shift+Enter 创建同级卡。存在树父时同级卡与源卡同父；没有树父时继承源卡的入向关联（标签留空）。`reparent` 保留普通关联线，拒绝父子环。删除单卡保留其子卡但移除相关边；删除整条分支是独立动作。

### 3-B. 复制

复制组内节点和边时生成新 ID，并映射新端点；组外边不复制。整次粘贴是一个可撤销步骤。

### 3-C. 批次与版本

```gherkin
Scenario: 批次成功
  Given 白板 contentVersion 为 7
  When 提交基于版本 7 的合法批次
  Then contentVersion 为 8，history 增加一个 actor=agent 的步骤

Scenario: 中途失败
  Given 批次的第一个操作合法，第二个引用不存在的节点
  When 执行 apply
  Then 返回 E_UNKNOWN_NODE，opIndex 为 1
  And 文件字节、内容版本、历史全部保持原样

Scenario: 版本冲突
  Given 文件版本已经变为 8
  When 再次提交基于版本 7 的批次
  Then 返回 E_VERSION_CONFLICT，文件不变
```

### 3-D. 历史与回放

步骤包含 `seq/at/actor/label/base/result/ops`。`seq` 从 1 连续递增，`result=base+1`。撤销追加逆操作，重做追加正向操作；拖动过程中不逐帧写历史。公式正文与备注同时提交时属于一个步骤。

完整历史的回放从空节点 / 边集合开始，使用当前资源表重建内容；不回放资源二进制的演化。“只分享当前草稿”保留当前内容和 contentVersion，移除历史。当前回放器没有独立快照基线，因此脱历史文件再编辑后形成的部分历史不能保证完整回放，这是已知边界。

## 4. 不变式与交互几何

I1：边端点存在，删除节点同步删除关联边。I2：父子图单父无环。I3：各类 ID 唯一，复制不共享身份。I4：布局整理只移动节点，不改变内容或关系。I5：内容版本按步递增，历史追加。I6：完整历史的回放内容应与保存内容一致。I7：图片引用对应内嵌资源。I8：CLI 通过临时文件重命名提交写盘。I9：未知文件主版本明确报错。

拖动吸附先按卡片实际外框筛选附近候选，再寻找边缘 / 中轴线。目标 B 的搜索半径为 `clamp(0.5 × B的屏幕对角线, 96, 320)` 屏幕 px；A 与 B 外框的最短距离进入此范围时 B 才是候选。对齐容差另为 8 屏幕 px，X/Y 独立选择最近对齐线，多选使用整体外框。Alt 换父拖动不触发普通对齐。

布局整理仅依据 `parentChild` 向右排树：水平间隔 64、子树垂直间隔 20 世界单位，未指定高度时估算为 120。当前不会依据普通关联线或所有实测卡片高度排版，多根布局也未保证无重叠；不得把它描述为通用自动排版算法。

## 5. 结构视图与编辑

画布拖动建立有向关联时，同一 `from→to` 只保留一条：重复连接用同一步的 removeEdge + addEdge 覆盖旧关联（包括旧说明），可撤销恢复；反向关联和父子边不受影响。A→B 与 B→A 同时存在时采用向相反侧弯曲的曲线，点击区域、说明及说明编辑框跟随各自路径。删除反向边后恢复单线布局。旧文件中的同向重复关联只显示最后一条，保留原始数据及历史；再次连接该方向时清理重复项。底层 addEdge 的旧文件/历史重放语义保持不变；CLI 若需要相同覆盖行为，应显式提交删除旧边并添加新边的同一批次。

默认显示备注。工具栏“结构视图”全局隐藏文字、公式、图片的备注，外框收拢，连线、框选与吸附跟随可见外框；“显示备注”恢复。切换不移动节点，不改 `BoardFile`、contentVersion 或历史，也不随画布缩放自动切换。它是当前会话的显示状态，不写入文件；`.draft` 保存始终包含备注，PNG 导出反映当前可见视图。进入编辑时仍显示完整字段，避免隐藏待修改内容。

所有文本卡编辑器提供核心表达与备注两个区域；同次提交为一个历史步骤，Esc 取消两者修改。图片仍以 markdown 存说明。插入工具条作用于当前聚焦的字段。备注编辑区为 15 行；「常驻展开」与正文/备注同次提交。

有序列表按钮插入同层下一项序号：依据光标前连续列表最近一项递增，跨空白段落或普通正文重新从 1 开始，不受光标后列表影响。保留当前列表缩进；本次不引入 `1.1` 式多级编号。此变更不增加字段或 op，formatVersion 与 batchVersion 仍为 1.0；旧程序呈现布局可能不同。

测试对应关系与提交门槛见 [AGENTS.md](../AGENTS.md)。修改本规格时必须核对实现；已知边界不能通过修改文字假装已解决。
