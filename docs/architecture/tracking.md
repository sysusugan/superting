# SuperTing 事项机制：架构、决策与方案落地追踪

核对日期：2026-09-20。§1–9 的功能代码基线为 `68aa953d5d7fa136970be6d2a6b827396f489d16`；本轮文档基于本地 main `c2486a009a87fdfa78a33aafbf0b64a03de574ef`（含前次架构文档，领先 origin/main 三个提交，用户已授权以该本地基线推进）。§10 为待实施设计，不把设计意图当作运行保证；远端链接不作为代码已发布的证明。

入口：[领域术语](../../CONTEXT.md) · [现行 ADR-0001](../adr/0001-tracking-ledger-and-reviewed-extractions.md) · [事项中心拟议 ADR-0002](../adr/0002-tracking-recoverable-changes.md) · [实施任务清单](../superpowers/plans/2026-09-20-tracking-center.md)。本轮仅落实文档，不修改业务代码。

## 1. 为什么需要这套机制

用户的核心诉求不是每周重新整理所有笔记，而是持续识别同一工作对象，并积累它的进展、风险与结果：

```text
原始笔记 = 事实来源
追踪事项 = 长期记忆
事项更新 = 每次记录的进展、风险、结果等
周期总结 = 基于事项更新生成的输出
```

业务上，商机赢单后进入项目交付，输单后停止跟进；产品能力可以独立记录，但优先关联正在推进的商机或项目来说明价值；生态合作重点跟踪合作项目。一个实际工作可以同时涉及商机和产品，不应被笔记的单一分类限制。内部管理和其他类别先不过度设计。

这些是用户目标。当前落地的是“人工审核的本地事项账本”，尚不是自动经营完整生命周期的工作代理。

### 1.1 设计演进与证据级别

| 阶段 | 会话中的决定或问题 | 可追溯实现 |
| --- | --- | --- |
| 记忆层调研 | 曾考虑外部 memory 工具和图索引，随后用户要求最小化 | 当前事项调用链未接入这些工具；不是宣称仓库没有原有向量检索 |
| 最小方案 | 笔记页面加「事项」tab；复用「操作」；提取必须落库；周报留在外部 | `174b0d9a` |
| 重复事项修复 | 同一笔记反复提取、模型换名导致重复；改用 ID 和显式新建确认 | `174b0d9a`，身份协议 v2 |
| 聊天方案 | 读取当前事项、读取模板、修改资料和本笔记进展、强制重新提取 | `68aa953d` |
| 本文 | 对照 main 源码追记，揭示未完成部分 | 文档基线如页首 |

此前产品方案主要存在本会话中，没有在当前 main 找到对应完整规格文件；上表和下一节是其归档摘要，不虚构原始方案文件或批准日期。另在历史 `memory-layer-research` worktree 找到 `docs/research/2026-08-25-memory-layer-options.md`，其中 Graphiti 等建议属于早期研究材料，未纳入当前 main；本文不把其推荐当作现行 ADR，也未重新核实外部产品现状。

## 2. 需求 → 当前实现 → 缺口

| 编号 | 已确认的需求 | 当前实现及边界 | 依据 |
| --- | --- | --- | --- |
| R01 | 不要每周失忆 | 事项 ID、跨笔记更新、持久提取记录；并非自动读取所有旧笔记 | S1、S2、T1 |
| R02 | 页面保持简单 | 笔记「事项」tab：提取、重提取、候选绑定、新建确认、进展和历史 | S3、T2 |
| R03 | 重新提取不能重复创建 | 已关联事项优先进入候选；模型输出 ID/ref；新建须明确选择 | S1、S2、S4、T1；不保证语义匹配百分百正确，用户仍可显式建重复项 |
| R04 | 追踪模板可配置、可供其他用户定义 | 四种内置模板有存储和读取；没有模板 CRUD/UI，提示词仍固定四种类型 | S1、S4、S5；部分实现 |
| R05 | 同一工作关联商机与产品 | 每个事项只有一个模板；多个事项之间以“关联”更新表达联系 | S1、S2；不是单事项多类型，也没有关联编辑界面 |
| R06 | 产品能力可独立、关联时说明价值 | 提示词允许独立产品工作；关联可带原文证据 | S4；没有强制要求每个产品项绑定项目 |
| R07 | 赢单转项目、输单停止追踪 | 只有状态文字及 `is_active` 字段；没有转项目、停用的写入流程 | S1；未实现自动业务规则 |
| R08 | 持续记录项目与生态合作进展风险 | 内置模板和更新类型支持人工提取/确认；没有自动定时追踪 | S1、S3 |
| R09 | 外部按日/周/月汇总，不内置周报模板 | MCP 可传范围读取；调用方组织报告；时间语义仍不完备 | S8、§7 |
| R10 | 聊天读取、修改、重新提取和查模板 | 工具已注册到有当前笔记的聊天上下文；修改须确认 | S5、S6、T3、T4 |
| R11 | 可追溯到笔记、证据和修改过程 | 更新保留 `note_id/evidence_text`，提取保留历史；没有原文版本快照；聊天确认回写审计不完整 | S1、S6、§8 |

## 3. 组件与数据所有权

```mermaid
flowchart TD
  N[笔记正文与转录] --> A[现有提取事项操作]
  C[已有事项候选] --> A
  A --> L[模型提取]
  L --> E[持久化提取草稿]
  E --> R[事项 tab 人工审核]
  R --> D[SQLite 正式事项与本笔记更新]
  H[笔记内聊天] --> A
  H --> Q[读取事项和模板]
  Q --> D
  H --> P[修改建议及确认卡片]
  P --> D
  D --> M[只读 MCP get_tracking_context]
  M --> W[外部 Codex 组织周期总结]
```

Renderer 负责模型调用、展示和确认交互；preload 暴露 IPC；主进程 `DatabaseManager` 做持久化、归属校验和事务。聊天和事项页共享正式数据，没有独立的“聊天事项库”。原有 Qdrant/FTS 笔记搜索未用于这条事项候选召回链路。[S1、S4、S5、S6、S7]

### 3.1 四张表与两个状态概念

| 表 | 关键字段 | 所有权与语义 |
| --- | --- | --- |
| `tracking_templates` | `id/name/definition_json/version` | 定义字段、状态、更新类型；默认种子为商机、项目、产品能力、生态合作项目 |
| `tracking_items` | `id/template_id/title/state/properties_json/is_active/state_source_update_id` | 长期身份和当前资料；共享于多篇笔记。名称不是唯一键 |
| `tracking_updates` | `id/item_id/note_id/update_type/content/occurred_at/state_after/evidence_text/related_item_id/relation_type` | 当前生效的来源更新；关联也存这里 |
| `tracking_extractions` | `id/note_id/action_id/input_hash/template_version/result_json/status/supersedes_id` | 某次提取及其审核状态；不是正式事项当前值 |

`tracking_items.state` 是业务状态，如“投标中”；`tracking_extractions.status` 是审核状态，如 `pending`。不能将“风险识别”这一更新内容天然当作整个商机的新阶段。当前实现按非空 `stateAfter` 写入事项状态，并未严格验证状态是否属于模板枚举。[S1]

没有 `tracking_item_relations` 表，也没有单独的笔记—事项关系表：通过本笔记更新中的 `item_id` 加最新 confirmed 提取中的事项 ID 识别关联；无更新的事项也能显示。旧记录无 ID 时，仅在名称+类型唯一匹配时兼容识别。[S1]

迁移增加 `state_after`、`state_source_update_id`。后者没有外键约束，用来区分人工状态与进展派生状态；旧数据按同事项、相同状态的最新更新 ID 回填，是兼容推断，不是历史来源的严格证明。[S1]

## 4. 提取、缓存与身份

### 4.1 实际输入

- 模型事实输入为 `note.content` 加 `note.transcript`；有一个就能运行，两者均空则失败。结构化转录拼成带说话方的文本。[S4]
- `enhanced_content` 不作为此处的直接事实正文输入。标题、标签、增强内容参与候选召回和缓存指纹，不等同于完整传入模型；命中的候选仍会作为上下文提供。[S1、S4]
- 事项 tab 先 flush 待保存笔记，录音中可取实时转录；聊天入口读取已持久化笔记，没有同样的 flush/实时转录路径。两个入口并不完全等价。[S3、S6]
- 候选返回全部启用中的已有事项，已关联项优先；审核按类型过滤。停止跟踪项不会进入候选（也会影响依赖此查询的笔记正式事项展示，TC1 需修正）。不是向量检索或完整历史进展回忆。[S1]
- 提示词要求只用事实、原文短句证据、歧义进入 uncertainties，候选不作新证据；这些要求不是证据真实性的服务端验证。[S4]

### 4.2 身份协议 v2

`matchedItems/newItems` 中每项有草稿内 `ref`，已有项带 `itemId`；更新用 `itemRef`，关联用 `sourceRef/targetRef`。保存时删除模型自带的 `createNew`，归一化结果并写入 `protocolVersion: 2`。旧的 `itemTitle` 只有能唯一解析时才转为 ref。[S1、S2]

审核页为每个提议提供同类型候选和“新建”选择。确认时，主进程校验 ID 存在、模板类型匹配；无 ID 必须由审核结果明确设置 `createNew: true`。已有 ID 的正式名称优先，模型换个描述不会自动改名。`newItems` 只是模型提议分类，并不意味着最终一定新增。[S1、S3]

### 4.3 缓存与并发的真实边界

持久指纹为 SHA-256：标题、正文、增强正文、转录、标签、记录日期、操作 prompt、模板最大版本号。只查询同笔记/操作/指纹/模板版本的 pending 或 confirmed 最新记录；后台操作只复用 v2 结果。[S1、S9]

- 强制重新提取：`forceTracking=true` → 模型 → `saveTrackingExtraction(..., true)`，新增 pending；不立即清除旧进展。
- 普通后台提取：模型调用前检查缓存。
- 普通聊天提取：先调用模型，再由保存接口检查缓存；可能付出推理成本后返回旧结果。不要宣称所有入口都避免重复推理。
- 模板版本只是 `MAX(version)`，不是完整模板内容指纹；候选变化不在指纹里。
- 保存时根据当时数据库内容计算指纹，没有绑定请求起始快照。模型运行期间笔记被修改，可能出现结果与指纹不一致。
- 防重复执行用 Renderer 内共享 `processingFlags`；聊天和后台路径复用，但不是数据库唯一约束或跨窗口锁。

## 5. 审核与正式数据更新

```mermaid
stateDiagram-v2
  [*] --> pending: 提取并保存
  pending --> rejected: 用户取消草稿
  pending --> confirmed: 校验通过且事务成功
  pending --> superseded: 同笔记其他结果获确认
  confirmed --> superseded: 同笔记新结果获确认
```

重新提取新增一条记录，用 `supersedes_id` 指向前一 pending/confirmed；仅创建草稿时不会把前一结果立即改为 superseded。确认按当前指纹查出的记录 ID 做有效性检查，rejected/superseded 不可确认，已 confirmed 返回幂等成功。[S1]

确认事务依次：删除**本笔记**全部正式更新 → 查找/新建事项并写回 ID 和正式名称 → 将关系转成“关联”更新 → 插入更新及证据 → 更新事项状态 → 对已失去来源的状态回算 → 将同笔记其他 pending/confirmed 标为 superseded → 当前提取标为 confirmed。校验错误会回滚删除和插入；其他笔记的更新不被删除。[S1、T1]

注意：替换范围是整篇笔记，不按 action 隔离；本笔记原有人工修改过的进展也会在新草稿确认后被替换。未再出现的事项行不被删除或自动停用。现行状态以写入及 ID 顺序维护，不是按业务发生日期进行历史重放。

提取 `result_json` 在确认时会被写成审核后的内容，关系还会展开进 updates；它不是原始模型响应的不可变副本。旧记录改名时可能回填 ID，但保留提取文字。[S1]

## 6. 聊天、页面及 IPC 契约

| 聊天工具 | 输入 | 结果/副作用 |
| --- | --- | --- |
| `get_current_note_tracking` | 无；绑定当前笔记 | 正式 `items/updates`，最新提取状态和单独的 pending 草稿；不把候选当正式项、不自动提取 |
| `get_tracking_templates` | 无 | 数据库全部模板和解析后的 definition；只读 |
| `update_current_note_tracking` | `itemId`、可选 `updateId/itemPatch/updatePatch` | 要求先读；产生 confirmation metadata 和原值→新值卡片，不立即写库 |
| `run_note_action` | `actionId` 或 `actionName`，可选 `forceTracking` | 先确认操作，再执行；强制参数仅 tracking 操作接受；提取完成还需事项 tab 审核 |

只有传入 currentNote 时才注册这些事项工具；模型还须支持工具调用。工具能力存在，不等于所有模型每次都正确调用。[S5、S6]

修改白名单：事项 `title/state/properties`，当前笔记进展 `content/update_type/occurred_at/state_after`。属性浅合并，未提供的键保留；没有删除键语义。证据、类型、关系、删除和停用不在修改范围。[S1、S5]

确认 payload 携带读取快照 `expected.item/expected.update`。主进程事务重新读取并检查：事项已关联当前笔记、更新属于当前笔记与该事项、快照 JSON 相等、字段合法。进展类型按模板检查；发生时间要求日期形式且可解析；状态和自定义属性没有完整模板约束。[S1]

修改 `state_after` 仅在它是最新非空状态更新且也是 `state_source_update_id` 时同步当前状态；明确修改事项 state 优先，并清空来源 ID。状态来源清空后，旧进展修正不会覆盖人工状态。[S1、T1]

聊天确认前检查当前笔记 ID，已确认/取消或内存已处理的 tool call 不再执行。成功后数据库重新读取结果，Renderer 发 `superting-tracking-updated` 刷新事项页；正式卡片从 live items 读取，不用历史提取 JSON 充当现状。失败的同一卡片在当前 hook 生命周期内也被视为已处理，需要重新发起建议。[S3、S6]

IPC 统一经 preload → `ipcHandlers` → `DatabaseManager`，包含 `db-get-tracking-templates`、`db-get-note-tracking`、`db-get-tracking-extraction`、`db-save-tracking-extraction`、`db-confirm-tracking-extraction`、`db-reject-tracking-extraction`、`db-update-note-tracking`。聊天工具名与 IPC 名不是同一协议；本版没有对外开放事项修改 MCP。[S7]

## 7. MCP 与周期总结的时间语义

`get_tracking_context` 参数：`from/to/item_types/item_ids/include_relations/include_inactive`。返回范围和事项列表，每项有当前名称、当前状态、属性、更新及简单关联；更新含来源笔记 ID 和证据。默认只查询 `is_active=1`。[S8、S1]

必须向报告调用方说明：

1. from/to 是包含端点的字符串比较，过滤 `occurred_at`；NULL 日期始终保留，无更新项也可能保留。不是按提取日期或笔记日期归档。
2. 模型提取保存没有严格日期校验；“会议结束”等非日期字符串可能进入该字段。聊天修正路径的日期检查不能补齐历史数据。
3. 输出的事项状态是**现在**的状态，不是区间末状态；没有 `as_of` 或历史状态查询。
4. 如果一个事项只有区间外的非空日期更新，它可能整项缺席；不能当作完整进行中事项清单。
5. `include_relations` 在 schema 中声明，但 handler 未使用，关系仍按查到的更新返回。

Codex 的日/周/月总结应区分“范围内更新”“未知日期信息”“当前状态”，必要时回查笔记，不把未知日期算作本周新增。应用不存周报模板；更严格时间契约仍是待补齐能力。

## 8. 可追溯性与尚未闭合的边界

| 可追溯内容 | 当前保证 | 不应作出的承诺 |
| --- | --- | --- |
| 更新来源 | `note_id` 和 evidence 原文短句 | 没有原文版本、位置或真实性校验；笔记变更后不可保证逐字复现 |
| 提取演进 | 多条 extraction、supersedes_id、审核状态 | result_json 会被归一化/确认覆盖，不是完全不可变事件日志 |
| 事项延续 | ID 稳定、名称可改、旧名称唯一匹配回填 | 没有通用别名库、自动合并或完整实体消歧 |
| 聊天修改 | 内存卡片含变更和确认结果；数据库事务保存业务改动 | `patchToolCall` 只 setMessages，未持久化确认/取消后的 metadata；重载可能丢失终态，不能作为完整审计日志 |
| 模板变更 | 有 version 字段、读取工具 | 没有配置入口、动态模板提取与完整缓存失效策略 |
| 自动工作管理 | 手动提取并积累事项 | 没有定时运行、赢单转换、输单停用、风险自动闭环 |

建议后续按实际问题补齐：先处理聊天确认终态持久化与请求快照一致性，再统一日期契约和模板配置链路，最后落实商机生命周期。这里是差距清单，不是已排期或获授权的新实现。

## 9. 源码、测试与维护办法

所有相对链接基于本文所在仓库；需要复核历史行为时先执行 `git show 68aa953d:<path>`。函数名比浮动行号更适合作为长期定位点。

| 证据编号 | 文件与定位点 |
| --- | --- |
| S1 | [database.js](../../src/helpers/database.js)：建表/迁移、`_seedTrackingTemplates`、`getTrackingCandidates`、`saveTrackingExtraction`、`getNoteTracking`、`confirmTrackingExtraction`、`updateNoteTracking`、`getTrackingContext` |
| S2 | [trackingIdentity.js](../../src/helpers/trackingIdentity.js)：`normalizeTrackingDraft` |
| S3 | [TrackingPanel](../../src/components/notes/TrackingPanel.tsx)、[PersonalNotesView](../../src/components/notes/PersonalNotesView.tsx)：审核和 `extractTracking/flushPendingNoteSaves` |
| S4 | [noteActionInput](../../src/components/notes/noteActionInput.ts)、[runNoteActionOnce](../../src/stores/runNoteActionOnce.ts)：模型事实输入及身份协议 |
| S5 | [trackingChatTools](../../src/services/tools/trackingChatTools.ts)、[noteActionChatTools](../../src/services/tools/noteActionChatTools.ts)、[注册入口](../../src/services/tools/index.ts) |
| S6 | [useEmbeddedChat](../../src/hooks/useEmbeddedChat.ts)：`confirmToolCall/patchToolCall`；[聊天持久化](../../src/components/chat/useChatPersistence.ts)、[工具开关](../../src/components/chat/useChatStreaming.ts) |
| S7 | [preload](../../preload.js)、[IPC](../../src/helpers/ipcHandlers.js)、[接口类型](../../src/types/electron.ts) |
| S8 | [mcpServerManager](../../src/helpers/mcpServerManager.js)：`get_tracking_context` 注册 |
| S9 | [actionProcessingStore](../../src/stores/actionProcessingStore.ts)：缓存、forceTracking、共享执行标记 |
| T1 | [数据库测试](../../test/helpers/tracking.test.js)：缓存、同 ID 改名、显式新建、替换范围、旧记录、快照与归属检查、人工状态保护 |
| T2 | [事项页测试](../../test/components/trackingPanel.test.js)：空结果、疑点、拒绝记录、无进展的正式事项 |
| T3 | [聊天工具测试](../../test/services/trackingChatTools.test.ts)：真实读取、模板读取、先读后改和提议不写库 |
| T4 | [操作工具测试](../../test/services/noteActionChatTools.test.ts)、[后台提取测试](../../test/stores/trackingAction.test.js)：确认参数、强制提取和缓存 |

会话记录中的上一轮基线验证为 439 项测试通过，类型与 i18n 检查通过，lint 有 5 条已有 warning；这不等于本次文档工作重新执行了全套，也不证明真实模型端到端准确率。尤其聊天重载后的确认终态、模型推理期间改笔记、跨窗口并发、完整模板配置和周期时间语义，不能以现有单元测试宣称覆盖。

复核命令（使用 `.nvmrc` 对应 Node 24，依赖已准备时）：

```sh
node --test test/helpers/tracking.test.js test/components/trackingPanel.test.js test/services/trackingChatTools.test.ts test/services/noteActionChatTools.test.ts test/stores/trackingAction.test.js
npm run typecheck
npm run i18n:check
npm test
npm run lint
```

以后修改事项行为时，同步更新本页 R 编号状态、接口/数据语义、证据位置和基线提交；领域词义变化更新 CONTEXT，核心架构取舍变化新增 ADR 并引用旧决策。普通 bug 修复无需每次新增 ADR。

## 10. 全局事项管理中心

状态：TC1 核心代码已实现于未提交工作树，GC01/GC02 待完整 Electron 集成验收；GC03–GC07 未实现。§10.1–10.7 保留完整目标设计，实际接口/迁移和验证边界以 §10.8 为准。需求来自本会话用户明确追加的全局审核、进展编辑、删除、合并和模板编辑；以最后一次 ponytail review 精简后的方案为准。可恢复删除、无永久清空、同模板合并且不支持一键拆分，是本版公开的安全默认值。后续改变这些默认值需先更新设计。

### 10.1 范围与需求追踪

| 编号 | 本版能力与验收摘要 | 实施任务 |
| --- | --- | --- |
| GC01 | 全局查阅所有正常事项及跨笔记更新，无进展事项不遗漏，支持来源往返 | TC1 |
| GC02 | 编辑名称、状态、属性及停止/恢复跟踪；共享笔记展示一致 | TC1 |
| GC03 | 编辑进展内容、类型、发生时间、stateAfter；证据和归属不变 | TC2 |
| GC04 | 删除与恢复事项/进展，历史替代记录不误恢复，原始笔记不删除 | TC2 |
| GC05 | 同模板合并，冲突预览、引用迁移、旧 ID 重定向，无自动语义去重 | TC3 |
| GC06 | 模板新增/编辑/停用/恢复/有限删除，动态提取与缓存真正生效 | TC4 |
| GC07 | 全局待审核队列复用笔记审核，确认前展示本笔记整体替换影响 | TC5 |

不包含：外部 MCP 写入、无来源的手工事项/进展录入、跨模板转换或合并、赢单自动转项目、周报模板、永久清空、自动拆分合并、图谱/看板/通用事件回放。停止跟踪不等于删除。明确要求的六类管理能力不因“最小化”移出本版。

### 10.2 页面和交互

主导航增加「事项中心」，含「事项 / 待审核 / 模板」三个 tab，右上角提供回收站入口。复用现有 ControlPanel 导航、UI 与 i18n，无新增依赖。

- **事项**：左列表右详情，窄屏切换；按名称搜索、模板 ID、实际状态、跟踪状态筛选，每页 30 条，默认全部未删除且未合并事项（含停止跟踪、无更新项）。按事项最近变动时间、ID 倒序。最近录入进展附它自身的记录时间，不能拼接事项资料修改时间冒充进展时间。
- **详情**：当前资料、分页进展、关联事项、来源笔记及简单操作历史。进展按创建时间、ID 倒序，同时展示业务发生时间；支持类型和日期筛选。关联查询包含入向/出向、保留方向与来源，不随进展翻页遗漏。
- **时间**：标准日期按本地日历日包含起止边界，带时区时间先换算；缺失/非标准旧日期单列“发生时间未明确”，过滤时仍单独可见，不算作区间内事实。日期过滤不让事项退出全局清单；不承诺当前状态是区间末状态。
- **编辑事项**：名称非空；新状态按当前模板校验，原有非标准值未修改可保留。属性局部更新，删除属性用明确的 removePropertyKeys，不用空字符串隐式删除；额外旧属性可见、不能丢失。提交前展示差异与“引用此事项的其他笔记也会变化”。
- **编辑进展**：允许 content/update_type/occurred_at/state_after；note_id、item_id、证据、关联两端不开放编辑。普通更新不得改成“关联”；关联记录本版只读、可整条删除。新设状态/类型按模板校验，未知发生时间用 null；未改旧值可保持。
- **往返**：笔记正式事项卡片按 ID 打开中心；中心按来源打开笔记「事项」tab。保留本会话筛选、页码、选中项；编辑未保存时提示保存/放弃/取消，遵守笔记原有保存保护。来源不存在或软删除时禁用跳转，不误开其他笔记。
- **刷新**：成功写入后重新读库并通知笔记页；复用 tracking 更新事件，进入/返回中心时再读取，提供刷新/重试。旧请求不得覆盖新选中项，加载、失败、空库与无匹配分别显示。

全局列表直接查询正式事项，不复用有限模型候选或 §7 的 MCP 范围接口。详情来源复用“本笔记当前更新 + 最新 confirmed 提取 ID”的规则；唯一名称+类型兼容解析不得猜同名项。以批量读取/必要 JSON 解析实现，不能逐笔记调用 getNoteTracking 反复查询全库。

### 10.3 审核、人工修改与状态

单次操作路径：读取真实记录 → 变更/影响预览 → 主进程事务比较快照 → 写入及操作留痕 → 重读与刷新。

- 普通编辑复用 expected 原值快照校验，不给所有表增加 revision 列。快照覆盖目标完整可变业务值；状态来源变动也必须比较。所有比较与写入在同一事务内完成，时间戳不是唯一并发凭据。
- 合并和审核比较预览所涉及记录的 ID 集合与可变值，必须检测新增、删除、重绑定；旧提取状态、笔记输入和模板指纹也参与审核检查。失败返回“数据已变化，请刷新”，保留用户编辑，不部分落库。
- 不为全部写接口设计统一请求 ID 框架。删除/恢复目标已达状态时幂等返回；审核检查提取状态；合并检查来源已指向同目标后幂等返回，若指向别处则冲突。普通重复编辑由原值校验阻止误覆盖，不以按钮禁用代替主进程保护。
- 明确设置事项状态建立人工状态保护；旧进展编辑、删除、恢复和重新审核均不得隐式覆盖。后续审核若建议改状态，须显式确认这项差异；确认采用新进展状态才重新建立来源。删除当前派生来源时，仅在其非人工状态下回算剩余有效来源；无来源采用模板默认状态。恢复旧记录不能无条件恢复旧状态。
- 全局修改走独立入口，笔记/聊天入口继续验证事项与笔记、更新与笔记的归属。共享底层校验、局部属性更新、旧记录改名补 ID 和状态维护，不复制另一套写逻辑，不放宽旧入口权限。

**重新提取不能无提示抹掉人工工作**：保留当前整篇笔记审核替换边界，但将物理删除旧进展改为标记 superseded，记录所属提取（可靠可得时）。旧记录含人工编辑/删除时，笔记审核与全局审核均显示替换影响，要求明确接受替换；不确认则当前数据不变。无论用户在哪个事项详情发起，替换的都是这篇笔记的有效更新，而不是某一事项子集。旧进展保留为历史，不计入 MCP 与当前时间线。

### 10.4 删除、恢复与合并

**事项删除**：设置 deleted_at，不逐条改变子更新删除状态；当前列表、候选和 MCP 隐藏该事项及涉及它的有效关系，原笔记不删。恢复事项后只显露原本有效的更新，不能连带恢复单独删除的更新。被合并来源不进入普通回收站，不能“恢复”成重复事项。

**进展删除**：设置 deleted_at，留存原值，按 §10.3 维护当前状态。恢复前检查父事项正常存在、记录未被新审核替代；父事项已删除要先恢复，superseded 更新只读历史不可直接恢复。关系删除用同一更新规则，保留证据。

**合并预览**：仅两个同模板、未删除未合并的事项，禁止自合并。默认保留目标名称/状态/跟踪标记，来源独有属性带入，同键不同值必须选择。展示受影响的笔记、有效与历史更新、关系数量及无进展关联；合并不是变更分类。

**合并事务**：将来源标记 merged_into_id；更新记录（包括删除/替代历史）的 item_id、related_item_id 迁移至目标，保留 note_id/证据。原归属在合并操作快照中保留。因合并产生的自关联退出有效集合并记原因，不硬删。不同更新不按内容相似度自动去重；展示重复关系可聚合但保留每条证据。目标状态取用户确认值，并设人工状态保护。

历史提取 JSON 不批量改写旧名称/证据，读取、绑定、审核和旧 ID 查询统一解析 merged_into_id 到最终目标，检测循环与无效目标。已合并源不可再作为新的来源；目标以后合并时允许形成可解析链。目标删除后旧 ID 解析也不可绕过删除限制。持久状态使重复合并只执行一次。

删除/合并 ID 可确定性拦截或重定向；无 ID 的新提议仍需审核。人工搜索可显式查回收站，展示恢复/历史匹配提示，不自动恢复或新建。不承诺能识别所有换名后的语义重复项。不提供通用撤销、合并拆分或永久清空。

### 10.5 模板与提取配置

模板支持名称、说明、文本属性字段（名称/说明/顺序）、状态列表与默认状态、更新类型。保留结构性“关联”类型用于既有关系协议，不作为普通进展类型互转。无公式、字段继承或通用动态表单引擎。

- 稳定模板 ID 是身份，name 仅为显示；保存模板内容时递增已有 version。旧属性按字段名存储，字段改名按新增/停用处理，不自动搬数据；删字段/状态/类型后旧值保留并提示，新设值须符合新定义。
- 停用后仍可读改已有事项，但不新建，不进入新模型提取配置。没有任何事项引用（包括删除和合并来源）的模板才能软删除；有引用只能停用。历史提取继续可读。恢复需满足名称唯一约束；默认模板种子不能因停用/改名/删除而重新生成一套，种子逻辑迁移为识别已完成初始化。
- 模型请求使用有效模板定义及 ID，而不是固定四种类型；新提取协议携带 templateId，旧名称协议仅唯一解析兼容。名称歧义、停用、删除或缺失模板不能在审核时静默猜测。
- 新请求记录笔记输入与模板配置快照/指纹；模板指纹包含有效 ID、名称、version、定义，替代 MAX(version) 作为新缓存判据。模型运行中笔记或配置变化，保存结果标为不可确认的旧输入草稿，不复用为当前缓存。旧无完整指纹的 pending 要重提取，旧 confirmed 仍用于历史和关联读取。
- 全局最新 pending 列表按笔记去重，旧 pending 只在历史展示；过期草稿保留并提示重提取。拒绝不影响正式进展。资料修改只要求重读绑定目标/影响预览，不一律重跑模型。
- 审核的人工候选搜索可分页查同模板全部正常事项（含停止跟踪并标注）；模型输入保持有界候选，不能把全库无上限塞入提示词。候选修复已在 main cef18a39；人工搜索与有界模型输入尚需分离。

### 10.6 持久化与接口（按任务增量实现）

继续 SQLite，扩展四表并新增一张简单操作记录表；不增加关系表、revision 全表改造、外部服务或事件回放系统。

| 表 | 拟议新增/复用信息 |
| --- | --- |
| tracking_items | deleted_at、merged_into_id、人工状态保护标记；复用 is_active 和 state_source_update_id |
| tracking_updates | updated_at、deleted_at、superseded_at、extraction_id（可空）、人工编辑标记；关系因合并退出有效集合的原因 |
| tracking_templates | is_active、deleted_at；复用 version，definition_json 扩展说明/字段定义/默认状态 |
| tracking_extractions | 请求输入和模板快照/完整指纹；复用现有 status，不增设一套审核状态机 |
| tracking_operations（新） | 操作类型、目标类型/ID、前后快照、来源入口、时间；记录与业务写入同事务 |

操作表保存编辑、删除、恢复、合并、模板变更和审核关键前后值及所涉 ID；不复制整篇笔记正文，不写凭据。普通查看不记日志。只做简单历史列表，不提供回放或自动撤销；审计记录不作为当前数据查询真源。首个编辑任务按需引入该表，后续扩展操作种类。

| 拟议应用内接口 | 最小契约 |
| --- | --- |
| listTrackingItems / getTrackingItemDetail | 筛选/分页/总数；按 ID 读取实时资料、分页更新、关系和来源，旧 ID 返回规范 ID |
| updateTrackingItem / updateTrackingUpdate | 目标 ID、expected 快照、白名单 patch；属性删除用显式键列表；返回重读数据 |
| deleteTrackingItem / restoreTrackingItem | ID 与 expected，预览影响后事务执行 |
| deleteTrackingUpdate / restoreTrackingUpdate | ID 与 expected，校验父事项/有效版本和状态来源 |
| listTrackingTrash / listTrackingOperations | 类型/目标筛选及分页，不混入正常查询 |
| previewTrackingMerge / mergeTrackingItems | 来源/目标 ID、冲突选择及预览快照；规范目标 ID 与影响摘要 |
| getTrackingTemplates / saveTrackingTemplate | 复用读取；新增/修改时校验定义及 expected version，返回真实新版本 |
| setTrackingTemplateActive / deleteTrackingTemplate / restoreTrackingTemplate | ID、expected version；分别执行停用/恢复可用性、无引用删除及删除恢复 |
| listPendingTrackingNotes | 按笔记分页最新 pending，含过期原因和来源可用性 |
| 既有确认/拒绝接口 | 扩展审核影响预览与 expected，显式确认人工变更替换；复用笔记流程 |

不创建通用 deleteTrackingEntity 接口；实体规则不同。所有接口经 preload → IPC → 数据库事务，SQL 参数化，校验 ID、patch、日期、枚举与分页边界。UI 用原生日期输入和已有组件。旧 API 调用者必须一并适配审核保护，不能留一个无校验的旧确认通道。

需要同步核对的调用链：S1 数据库、S2 身份解析、S3 笔记审核、S4 提取输入、S5/S6 聊天、S7 IPC、S8 MCP、S9 后台缓存及新中心页面。有效更新查询统一排除删除/替代；正常事项查询排除删除/合并源；MCP 默认仍排除停止跟踪项，includeInactive 不能变成包含已删除项。

### 10.7 迁移、失败与交付

每阶段只加所需迁移与可用界面，不先搭全套基础设施。迁移前用 SQLite 一致性备份（不得只拷贝正在使用的主文件），迁移事务成功后才开启对应写入。失败关闭本次数据库连接并阻止写入，提供备份位置与真实错误；不能带着半迁移数据库继续运行。

旧数据默认未删除/未合并/有效；来源提取 ID 无法可靠还原则为空。旧人工状态保护只能依据既有来源信息尽力兼容，不能宣称找回全部人工修改历史。旧代码已经物理删除的进展无法恢复；旧被丢失的关系也不能补造。

不能简单降级旧 App 继续使用新库：旧查询不认识删除/替代标记。回退需要匹配版本与备份，恢复前再备份新库并提示会丢失备份后的工作；不得静默覆盖用户数据库。发布前在真实旧库副本验证升级和恢复流程，不直接拿用户唯一数据库试迁移。

验收案例与依赖见[任务清单](../superpowers/plans/2026-09-20-tracking-center.md)。本轮仅文档，未跑功能测试、不声称迁移或 UI 已验证；实施时逐项回填实际提交、测试和剩余限制。本版阶段结果不自动发布；最终提交须 DCO，集成 main 使用 rebase/快进，打包另按发布规范授权。

### 10.8 TC1 实施记录（2026-09-21）

基线更新为获授权的 main `cef18a395bb1640dd62e10fe0e6428136d2cb9f6`；独立 codex/tracking-center 工作树尚未提交、合并或发布。TC1 核心代码和自动化验证完成，原生集成验收未完成；原文档工作树保留，TC2–TC5 未开始。

实际实现：

- [TrackingCenter](../../src/components/TrackingCenter.tsx) 目前只有事项与只读模板两个 tab，不展示尚未实现的审核/删除/合并。支持 30 条分页、搜索/筛选、详情与证据、关系/来源、日期范围（未知日期单列标识）、名称/状态/字符串属性编辑、显式移除属性、停止/恢复跟踪、差异预览、冲突保留输入和刷新。历史非字符串属性只读保留，可显式移除；操作历史暂取最近 30 条，不是完整审计浏览器。
- `listTrackingItems`、`getTrackingItemDetail`、`updateTrackingItem` 已经 S7 接入；定义在 [tracking 类型](../../src/types/tracking.ts)。详情读当前表，规范 ID 合并解析尚属 TC3。`_saveTrackingItem` 被全局和笔记修改共用；全局用深比较 expected item 快照，笔记仍用既有 expected.item/update 与归属校验。快照比较和数据/操作记录写入同事务，事务内重读后才返回成功。
- 实际迁移仅 `tracking_items.manual_state` 和 `tracking_operations`（id/item_id/operation/before_json/after_json/entrypoint/created_at），没有其他删除/合并/版本字段。首次检测旧 tracking_items 无 manual_state 时，在任何初始化迁移之前执行 `VACUUM INTO`，备份在数据库旁 `.tracking-center-<时间>-<UUID>.bak`；失败关闭连接并抛错。字段与操作表创建在事务中。manual_state 的旧数据回填只推断“无状态来源且有非空状态更新”的情况，不是完备的人工编辑历史。
- 显式人工状态现在不被后续提取覆盖；更新自身的 state_after 仍保留事实。TC1 没有“审核时接受模型新状态”的按钮，只能人工编辑当前状态；TC2/TC5 再接入替换影响确认。旧进展仍被审核物理替换，不能宣称人工进展修正已受保护或回收站已可用。
- `getNoteTracking` 分离正式关联与 active 候选，停止跟踪项仍可在笔记读取/修改。无进展来源使用最新 confirmed ID，旧唯一名称匹配兼容。为旧来源仍需扫描最新 confirmed JSON；未做索引表，数据量变大时需测量再优化。
- 笔记正式卡片通过事件打开中心；中心打开来源时传入 tracking 初始视图。`useFolderManagement` 保留请求的来源 ID，`PersonalNotesView` 单独读取未在前 50 条中的来源，避免错误改选首篇；完整原生往返尚待验证。

本轮实际检查（Node 24.13.1，复用 main 的 node_modules，无下载/重建共享原生依赖）：

| 检查 | 结果与证据 |
| --- | --- |
| 完整测试 | `npm test`：449 通过、0 失败，含 [数据库测试](../../test/helpers/tracking.test.js) 和新 [页面 SSR 测试](../../test/components/trackingCenter.test.js) |
| 类型 / 文案 | `npm run typecheck`、`npm run i18n:check` 通过，10 个 locale |
| Lint | 0 error，5 个既有 warning（sqlite-abi 2 个，NoteEditor/PersonalNotesView/RichTextEditor 各 1 个） |
| 迁移与事务失败 | 升级前一致性备份可读；迁移失败回滚新字段、原笔记保留；操作记录插入失败时资料改动回滚，均有数据库回归测试 |
| Renderer 构建 | `npm run build:renderer` 通过，有既有大 chunk 提示；不是 App 打包 |
| 隔离浏览器交互 | 使用 [内存 IPC fixture](../../test/fixtures/tracking-center.html)：31 条翻页、名称/属性预览与保存、模板展示、来源回调与返回、并发冲突保留输入、加载失败及恢复通过；760×800 和 1280×850 截图检查无横向溢出，非用户数据库 |
| 未完成验证 | 完整 Electron 导航/旧来源加载、关闭窗口未保存提示、跨窗口并发和配套降级恢复演练；不能用浏览器 fixture 冒充原生集成测试 |

复现 fixture：在仓库根运行 `./node_modules/.bin/vite --config src/vite.config.mjs --host 127.0.0.1 --port 5194`，访问 `/test/fixtures/tracking-center.html`。fixture 只有内存数据，不访问用户数据库、不属于生产构建入口。测试用服务器和浏览器已在验证结束后关闭。
