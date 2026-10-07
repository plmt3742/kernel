# 04 · 数据模型

> 本篇展开宪法 §7，是数据字段的权威说明。任何会话改数据字段或结构，必须同步更新本文件。

---

## 1. 基本原则

1. **`data/` 是唯一事实源**，一记录一文件。
2. JSON UTF-8；时间用 ISO 8601 带偏移（例：`2026-10-02T09:00:00+08:00`）。
3. **禁止在 JSON 中存储计算派生值**（进度、计数、状态聚合等一律运行时计算）。
4. ID 稳定，一经分配不再改变。
5. 字段可选性以本篇表格为准；未来新增字段应通过 ADR 或宪法修订引入。

## 2. ID 约定

前缀标识实体类型，后接四位递增数字。

| 前缀 | 实体 | 示例 |
|---|---|---|
| `i-` | inboxItem | `i-0001` |
| `t-` | task | `t-0001` |
| `p-` | project | `p-0001` |
| `a-` | area | `a-0001` |
| `g-` | goal | `g-0001` |
| `h-` | habit | `h-0001` |
| `e-` | event | `e-0001` |
| `tr-` | trace | `tr-0001` |
| `c-` | course | `c-0001` |
| `n-` | note | `n-0001` |
| `r-` | resource | `r-0001` |
| `rev-` | review | `rev-0001` |

## 3. 通用轴（6）

所有实体共享的筛选维度：

| # | 轴 | 字段 | 取值 | 角色 |
|---|---|---|---|---|
| 1 | 上下文 | `contexts` | `@lab`、`@campus`、`@computer` 等 | 第一筛选 |
| 2 | 时间与紧急 | `dueAt` / `deferUntil` | ISO 8601 | |
| 3 | 能量 | `energy` | `low` / `medium` / `high` | |
| 4 | 重要性 | `importance` | 0 到 3 | 决策输入，非硬排名 |
| 5 | 状态 | `status` | 各实体自己的状态机 | |
| 6 | 有界标签 | `tags` | 命名空间 `role:` / `topic:` / `context:` | |

标签命名空间示例：`role:acm`、`role:competition-head`、`topic:数据结构`、`topic:面试`。

> **重要性量纲统一（v0.5 · Slice Y，见 ADR-0021）**：`importance` 统一为 **0–3**（0 = 最低 / 可略过的输入）。此前 AI 输入 schema 与部分 UI 用 1–3，与本节及 `taskSchema` 不一致；清扫后 AI 提示词 / 各创建·澄清 schema / UI 选项（`src/lib/format.ts` `IMPORTANCE_OPTIONS`）与存储一致为 0–3。**刻意不收紧为 1–3**：存量 `data/tasks/t-0057.json`、`t-0058.json` 已含 `importance: 0`，收紧将破坏既有记录。另：情境（`context`）标签列表由标签注册表派生（`contextNamesOf`），AI 提示词与任务筛选不再硬编码子集。

## 4. 实体字段

`?` 表示可选字段。

### 4.1 inboxItem（`i-`）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| content | string | 原始内容 |
| source | `manual` \| `file` \| `notification` \| `voice` | 来源 |
| capturedAt | ISO | |
| status | `unprocessed` \| `clarified` \| `discarded` | |
| linkedId? | string | 澄清 / 应用后指向新实体（深链用；一揽子应用为**首个**产物，通常是新项目） |
| linkedIds? | string[] | 一揽子应用创建的全部产物 id（Slice R1；撤回 / 撤销据此完整清理） |
| appliedTagIds? | string[] | 一揽子应用时**新登记**的标签 id（Slice R1；撤销时清理未再使用的注册项，恢复注册表基线） |
| note? | string | |
| summary? | string | AI 生成的一句话来源摘要（≤40 字、单行、多要点「 · 」分隔；见 ADR-0029）；**仅在 apply 时落档**；引用展示优先用它 |
| file? | `{ name, size, mime? }` | 文件投递附件元数据；二进制存 `data/files/<id>-<name>`（不进 git；见 ADR-0008） |

> **文件投递（v0.5 · Slice D）**：`source:'file'` 的条目由 `POST /api/inbox/upload` 创建，`content` 取 caption（无则文件名）。二进制**不**进 JSON，仅存于 `data/files/`（`.gitignore`）；AI 解析时按「文本白名单 **或 Office Open XML（`.docx/.pptx/.xlsx`，Slice J）** + ≤5MB → 前 8000 字摘录，否则仅元数据」注入提示。删除条目经 `POST /api/inbox/:id/remove`（已澄清条目 409，需先 revert）。附件**本机动作**（Slice J2）经 `POST /api/inbox/:id/open`（系统默认程序打开）/ `POST /api/inbox/:id/reveal`（文件管理器定位）——服务端解析 `data/files/<id>-<name>` 并做条目 / 元数据 / 磁盘三重校验，缺一 404；`{dryRun:true}`（`/api/inbox/:id/(open|reveal)` 与 `/api/open`）仅解析校验、绝不 spawn（自动化测试用）。详见 ADR-0008。

> **生命周期闭合（v0.5 · Slice V，见 ADR-0008 §6）**：文本捕捉成功后**自动运行一次 AI 解析**（与文件投递后自动解析节奏一致；AI 离线静默跳过、绝不自动应用，手动「AI 解析」保留）。UI 提供完整出口——未澄清 / 已丢弃条目「删除」（`POST /api/inbox/:id/remove`，服务端一并清理附件；已澄清仍 409 保护）；已丢弃条目「恢复」与已澄清条目「撤回」均复用 `POST /api/inbox/:id/revert`（discarded 无产物仅重置 `status:'unprocessed'`；clarified 先删除 `linkedId` 产物再回退）；已澄清条目「查看产物」按 `linkedId` 前缀深链跳转（`t-`→`/tasks?task=`、`p-`→`/projects?project=`、`n-`→`/library?note=`、`r-`→`/library?resource=`）。字段应用矩阵见 §4.13。

> **一揽子处置（v0.5 · Slice R1，见 ADR-0015）**：`POST /api/inbox/:id/apply { actions }` 一次写入把条目拆解出的全部动作落位——先建新项目（`kind:'project'`，至多 1 个），再逐条建 `task` / `note` / `resource`（`task` / `note` 的 `linkToNewProject:true` 自动挂到新项目）；标签以 `origin:'ai'` 登记。条目置 `clarified`，`linkedId` = 首个产物、`linkedIds` = 全部产物、`appliedTagIds` = 本次新登记标签。撤销 `POST /api/inbox/:id/unapply` 删除全部 `linkedIds` 产物并 `pruneTags(appliedTagIds)` → 条目回 `unprocessed`（`revert` 同语义，兼容旧单 `linkedId`）。动作矩阵见 §4.14。

> **公告解析（v0.5 · Slice N0，见 ADR-0023）**：收件箱解析输出在动作数组之外增顶层 **`facts: string[]`**（硬事实要点：放假时间、调课、截止日期等；≤8 条、每条 ≤140 字、须含日期或关键数字；`cleanFacts` trim / 去空 / 截断 / 去重 / 封顶；**为解析临时产物、不落盘**，UI 以「要点」块呈现并可一键「存为要点笔记」）。需完成的义务仍是 `kind:'task'` 动作，可带可选 **`condition`**（适用前提，≤30 字，如「仅出国（境）者」「仅留校学生」；对所有人生效则省略）——`aiActionSchema.condition` + `postValidateActions`（null / 非 task / 空串清理）保证其只随 `task` 动作存活；前端带条件的动作**默认不勾选**（勾选 = 相关 / 要做），应用经 `formToAction` 透传。图片（`isImageFile()`：扩展名或 `image/*`）走同一解析管线，`buildFileSection` 返回「见附图」+ opencode file part（读失败优雅降级），并**跳过**文件「恰 1 条 resource」硬归一化（非图片行为不变）。**解析产物（`actions` / `facts`）均为临时结果、不落盘**。`inbox.apply` 审计增 `detail.signals.conditions`（已应用动作非空条件去重、首见顺序）为后续画像留痕。

> **来源摘要（v0.5 · Slice N4，见 ADR-0029）**：收件箱解析在动作数组 / `facts` 之外增顶层 **`summary`**（一句话概括原始输入：≤40 字、单行、多要点「 · 」分隔、含关键时间 / 事项、不引入原文外信息；服务端清洗折叠空白 / 去引号 / 硬截断 40，**为解析临时产物、不落盘**）。`POST /api/inbox/:id/apply { actions, summary? }` 的 `summary` 可选（≤100 校验），提供且非空时写入条目 `summary`（`inboxItemSchema.summary` 可选、≤200 防御）；只在 apply 落档是刻意取舍（解析可重跑、零写入纪律）。引用展示据此人话化：关联区块「来源条目」标题 `summary` 非空优先、否则原文折叠截断 ~90 字；来源芯片不再显示可见编号（编号入 tooltip）；收件箱「已澄清」区产物引用显示产物标题（解析不到回退 id）。历史条目录档前无 `summary`，展示自动降级、不做回填。

### 4.2 task（`t-`）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| title | string | |
| notes? | string | |
| status | `next` \| `waiting` \| `scheduled` \| `someday` \| `done` \| `dropped` | |
| contexts | string[] | 如 `["@lab","@campus"]`，第一筛选 |
| energy | `low` \| `medium` \| `high` | |
| estimateMin? | number | |
| importance | 0 到 3 | 决策输入，非硬排名 |
| dueAt? | ISO | |
| deferUntil? | ISO | 「推迟至」；未来值为软推迟（默认从活跃列表隐藏，见下注） |
| projectId? | string | |
| areaId? | string | |
| parentTaskId? | string | |
| tags | string[] | 命名空间：`role:acm`、`topic:数据结构` |
| repeatRule? | string | |
| createdAt | ISO | |
| updatedAt | ISO | |
| doneAt? | ISO | |
| sourceInboxId? | string | |

> **子任务 / `parentTaskId` 语义（v0.5 · Slice R3）**：`parentTaskId` 指向 `data/tasks/` 中另一任务，构成父子层级（一任务至多一个父、可有多个子）；派生展示不落盘。服务端写入护栏（`server/index.mjs` `assertValidParentTask`）：① 父任务必须真实存在（否则 400）；② 不得指向自身（400）；③ **不得成环**——沿 `parentTaskId` 祖先链上溯，命中自身即 400（`A→B→A` 被拒，且拒绝后不写半成品）。创建（`POST /api/tasks` 可选 `parentTaskId`）与编辑（`POST /api/tasks/:id/update`；`parentTaskId:null` 清除）均支持，审计 `task.create` / `task.update`（`detail.fields` 含 `parentTaskId`）。UI 路径：任务详情「子任务」区块列出直接子任务（点击就地打开其详情，可逐级返回）+ 安静 quick-add（回车即建，**继承父任务 `projectId`**，其余字段走默认，toast 可撤销）；项目详情的任务行可就地打开、并提供「添加任务到本项目」（草稿确认、`projectId` 预填）。系统**不自动生成子任务**——一律用户显式创建 / 编辑。

> **「推迟至」软推迟（v0.5 · Slice Y 展示 → 回顾自动化批次启用「真正行为」）**：任务详情字段网格在 `deferUntil` 设置时显示只读「推迟至」行（与「截止」并列）；`TaskDetailModal` 编辑表单的「推迟至」字段（`EDITABLE_FIELDS.tasks`）可设 / 可清（空 = `null` 清除）。**创建期已支持写入**（`taskCreateFieldsSchema` + `CREATE_FIELD_KEYS` + `createTask` + `TaskDraftModal` 的「推迟至」输入，与 `dueAt` 同口径）。**运行时行为**（绝不落盘派生标记）：`deferUntil` 为有效未来时刻且任务未完成 / 未丢弃 = 已推迟——任务列表默认隐藏，页头「含已推迟」开关（`kernel.ui.tasks.v1` 界面态）打开后列出并显示「推迟至 …」标记；计数（未完成 / 逾期 / 今日）始终排除已推迟项；日历的截止任务同样跳过未来推迟项。到点后自然重新出现（运行时对 now 求值）。

### 4.3 project（`p-`）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| title | string | |
| outcome | string | 完成定义 |
| status | `active` \| `onHold` \| `someday` \| `done` \| `archived` | |
| areaId? | string | 可选（ADR-0043：空 = 无区域，不再兜底 `a-0001`） |
| goalId? | string | |
| nextActionId? | string | |
| dueAt? | ISO | |
| tags | string[] | |
| createdAt | ISO | |
| updatedAt | ISO | |

> **创建可选字段（v0.5 · Slice R1，见 ADR-0015）**：`POST /api/projects` 除 `title`（必填）外接受可选 `outcome` / `areaId` / `tags`（项目快速新建草稿确认后一次性提交；`areaId` 须真实存在，否则 400）。缺省：`status:'active'`、`outcome:'完成定义待整理'`、`tags:[]`、**无 `areaId`**（ADR-0043 §2.7 起不再兜底 `a-0001`）。请求带 `ai:true` → 新标签 `origin:'ai'`；审计 `project.create` · `detail.fields`。**F23（Slice X，见 ADR-0019 §2.6）**：`ProjectDraftModal` 的区域下拉默认改为**首个区域 id**（移除「—」空选项），使归属显式可见、可改；服务端原 `a-0001` 兜底已随 ADR-0043 退役。
>
> **外键引用生命周期（ADR-0043）**：全部实体间引用由 `server/refs.mjs` 的 `REF_EDGES` 声明式描述（`detach` / `keep`）。规则「**软删只隐藏、彻底删除才断链**」：进回收站不改写任何引用（恢复无损，UI 按「目标不在实时快照 = 未关联」降级显示 无项目 / —）；`purge` 时 `detachRefsTo` 清扫 `detach` 入引用（实时 + 回收站）；`keep` 溯源引用（`sourceInboxId`、`inbox.linkedId(s)`、`appliedTagIds`、`reviews.stale*`）永不改写。删除不再被引用阻断（区域 / 目标原 409 护栏退役）；编辑校验 `assertRefsExist` = 实时 ∪ 回收站。存量悬空用 `scripts/refs-repair.mjs`（默认预演，`--apply` 落盘）修复。

### 4.4 area（`a-`）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| title | string | |
| standard | string | 标准声明，如"作业不过夜" |
| cadence | `weekly` \| `monthly` \| `quarterly` | |
| status | `active` \| `archived` | |

### 4.5 goal（`g-`）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| title | string | |
| horizon | `term` \| `quarter` \| `year` | |
| areaId? | string | |
| parentGoalId? | string | |
| keyResults | array | `[{text, target, current, unit?}]`（**仅展示保留**，不开放编辑，见 ADR-0019 §2.7） |
| status | `active` \| `achieved` \| `dropped` \| `someday` | |
| targetDate? | ISO | |

### 4.6 habit（`h-`）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| title | string | |
| cadence | `daily` \| `weekly` \| `monthly` | |
| trigger | string | 实施意图 |
| metric | `count` \| `minutes` \| `bool` | |
| target | number | |
| areaId? | string | |
| log | array | `[{date, value}]`；由打卡端点维护（见下） |

> **区域 / 目标 / 习惯可管理 + 打卡（v0.5 · Slice X，见 ADR-0019）**：三类由只读种子转为可管理实体。创建 `POST /api/areas` / `/api/goals` / `/api/habits`（`title` 必填，空 → 400；`areaId` 须真实存在）；编辑 `POST /api/<kind>/:id/update`（白名单——`areas`：`title/standard/cadence/status`；`goals`：`title/horizon/areaId/status/targetDate`；`habits`：`title/cadence/metric/target/trigger/areaId`）；删除 `POST /api/<kind>/:id/remove`（进回收站，可 `restore` / `purge`）。**引用护栏**：区域被任务/项目/笔记/资料/日程/目标/习惯的 `areaId` 引用时、目标被项目 `goalId` 或子目标 `parentGoalId` 引用时，删除返回 **409**（含可读计数），未引用才可删；习惯无护栏。三类**无 `createdAt`/`updatedAt`**（编辑不 bump）。审计 `area.*` / `goal.*` / `habit.*`。**打卡**：`POST /api/habits/:id/checkin {date?}`（缺省今天；**幂等**——该日已有 `value>0` 则不重复写；否则写 `{date,value:1}`，审计 `habit.checkin`）与 `POST /api/habits/:id/uncheckin {date?}`（无该日则无操作；否则移除，审计 `habit.uncheckin`）。`log` 不在管理表内编辑。`keyResults` 本期只读保留。

### 4.7 event（`e-`）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| title | string | |
| startAt | ISO | |
| endAt? | ISO | 可选；缺省 = 单点日程（无结束） |
| allDay? | boolean | 缺省 false |
| location? | string | |
| areaId? | string | |
| projectId? | string | |
| tags | string[] | |
| status | `confirmed` \| `tentative` \| `cancelled` | |
| notes? | string | 备注（可编辑） |
| repeatRule? | string | 重复规则，**仅展示保留**（展开 / 编辑延后，见 ADR-0018） |

> **事件可写（v0.5 · Slice W，见 ADR-0018）**：事件是第五类可写 / 可回收实体。创建 `POST /api/events`（`title` + `startAt` 必填；`endAt` 可选且须 ≥ `startAt`，否则 400）；编辑 `POST /api/events/:id/update`（白名单：`title/startAt/endAt/allDay/location/status/projectId/areaId/tags/notes`；`endAt` 置空 = 清除）；删除 `POST /api/events/:id/remove`（审计 `event.remove`，进回收站，可 `restore` / `purge`）；审计 `event.create` / `event.update` / `event.remove`。事件**无 `createdAt` / `updatedAt`**（对齐既有形状，更新不 bump 时间戳）。标签同样 `ensureTags` 登记。写入全程经单写者 + Zod + 原子写 + 审计。

### 4.7b trace（`tr-`）

> 「踪迹」（新功能）：记录「我刚刚做了什么」的时间戳条目——既非笔记（不成文）、也非资源 / 日程 / 任务，只是活动留痕。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | `tr-NNNN` | 稳定 ID |
| title | string | 必填；一句话「我做了什么」（1..80 字） |
| note? | string | 可选补充 / 感受（≤500 字） |
| at | ISO | 发生时间（ISO 8601 带偏移；缺省 = 服务端记录时刻） |
| tags | string[] | ≤8；登记进标签注册表（`origin` manual / ai） |
| areaId? | string | 可选关联区域（须真实存在） |
| projectId? | string | 可选关联项目（须真实存在） |

无 `createdAt` / `updatedAt`（对齐 event 形状；`at` 即发生时间）。写入经单写者 + Zod + 原子写 + 审计：创建 `POST /api/traces`（`trace.create`）、编辑 `POST /api/traces/:id/update`（白名单 `title/note/at/tags/areaId/projectId`，`trace.update`）、删除走通用软删除 `POST /api/traces/:id/trash`（`trace.trash`；`/api/trash/traces/:id/(restore|purge)` 恢复 / 彻底删除）。标签同样 `ensureTags` 登记。

### 4.8 note（`n-`）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| title | string | |
| type | `fleeting` \| `literature` \| `permanent` \| `meeting` \| `memo` | |
| body | string | markdown |
| links | string[] | |
| areaId? | string | |
| projectId? | string | |
| tags | string[] | |
| distillLevel | 0 到 3 | 渐进蒸馏层级（判断标准见下） |
| createdAt | ISO | |
| updatedAt | ISO | |

> **蒸馏层级可设置（v0.5 · Slice H）**：`distillLevel` 0–3 为渐进蒸馏（progressive summarization）层级——L0 原文（原始摘录 / 未加工）、L1 划线（已标出关键句）、L2 摘要（已用自己的话压缩）、L3 永久（已提炼为可复用的永久笔记）。笔记详情弹窗内以安静分段控件直接设置（经 `POST /api/notes/:id/update`，审计 `note.update`）；`areaId` / `projectId` 也可在编辑表单中设置（`notes` 编辑白名单已含 `areaId / projectId / distillLevel`，见 ADR-0011）。UI helper 文本与本文一致（`src/lib/format.ts` `DISTILL_LEVEL_DEF`）。

> **蒸馏语义（v0.5 · Slice M，见 ADR-0020）**：**点选层级只标注、不改写内容**——`distillLevel` 始终是可独立设置的标签，选择它不会触碰 `body`（UI 以 `format.ts` `DISTILL_HELP` 显式说明）。**AI 蒸馏**是独立的辅助动作：`POST /api/ai/note/distill { id, targetLevel? }` 由 AI 生成**下一层草稿**（缺省目标 = 当前层级 + 1，clamp 1–3 封顶 L3），只返回 `{ text, targetLevel, model, ms }`、**不落盘**；用户确认后经 `POST /api/notes/:id/update` 一次写入 `{ body, distillLevel }`，其中 `body` **追加**（而非替换）`\n\n---\n\n## 蒸馏 → L{n} {层级名}\n\n{text}` 小节，原文永不丢失。撤销由客户端记录应用前 `body` / `distillLevel` 往返精确还原。`distillLevel` 的派生展示（列表 / 详情点阵）不变。

### 4.9 resource（`r-`）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| title | string | |
| url? | string | |
| path? | string | 本地文件绝对路径（Slice E2：文件投递澄清为资料时写入；亦可编辑补充） |
| kind | `article` \| `course` \| `book` \| `tool` \| `paper` \| `file` | |
| status | `unread` \| `reading` \| `read` \| `reference` \| `archived` | 五档阅读状态（判断标准见下） |
| tags | string[] | |
| areaId? | string | |
| addedAt | ISO | |
| note? | string | 资料「简介」（Slice R2.5）：1–3 句、≤120 字的小结，在资料详情页标题下静默展示 |

> **资料「简介」+ 文件条目不拆分（v0.5 · Slice R2.5，见 ADR-0015 §5）**：带【附件】的收件箱条目解析**恰好产出 1 个 `resource` 动作**（`kind:'resource'` + `title` + `note` 小结 + `tags` ≤3 + 可选 `areaId`），绝不拆分为 task / note / project；`note` 经 `postValidateActions` 归一化（折叠空白 + 截断 ≤120 字；附件内容不可读时据文件名保守概括并在小结中注明）。澄清（`clarifyDetailsSchema`）与一揽子应用（`aiActionSchema`）的 resource 分支均接受并把 `note` 写入 `resource.note`。前端资料详情弹窗在标题下渲染「简介」区块（`note` 为空则不显示），并可在编辑表单中修改（`resources` 编辑白名单含 `note`）。

> **文件投递 → 资料（v0.5 · Slice E2）**：`source:'file'` 的收件箱条目澄清为资料时，记录 `kind:'file'` 且 `path` = `data/files/<inboxId>-<fileName>` 的绝对路径；非文件条目行为不变。资料详情弹窗据此显示「文件位置」并可经 `POST /api/reveal` 在本机文件管理器中定位（见 ADR-0009）。

> **状态判断标准 + 可设置（v0.5 · Slice H）**：资料状态五档——`unread` 未读（收进资料库、尚未开始阅读）、`reading` 在读（正在读、有明确推进）、`read` 读完（已完整读完）、`reference` 参考（不打算通读，仅备查引用）、`archived` 归档（已处理完，退出主动视野）。资料详情弹窗内以安静分段控件直接设置（经 `POST /api/resources/:id/update`，审计 `resource.update`）；`areaId` 也可在编辑表单中设置（`resources` 编辑白名单已含 `areaId / status`，见 ADR-0011）。UI helper 文本与本文一致（`src/lib/format.ts` `RESOURCE_STATUS_DEF`）。

> **直接新建（v0.5 · Slice Y，见 ADR-0021）**：新增 `POST /api/resources`（`resourceCreateSchema`：`title` 必填；`kind` / `status` 缺省 `article` / `unread`；可选 `url` / `path` / `note` / `areaId` / `tags`；`areaId` 真实存在校验；标签规格化 + `ensureTags` 登记；审计 `resource.create`）。资料页「新建资料」→ 草稿弹窗（标题 / 类型 / 链接 / 简介 / 标签）→ 点「创建资料」才落盘（ESC / 取消零写入）→ toast 撤销（= 移入回收站）+ 打开 `?resource=` 深链。镜像 Slice M 的「新建笔记」流。

> **链接自动填充（v0.5 · Slice N2，见 ADR-0027）**：收件箱**文本条目**含网页链接时，AI 链接解析会抓取正文并据实写简介，同时把原始链接写入 `url`（`aiActionSchema.url` ≤2000，仅 http(s)；`POST /api/inbox/:id/apply` 的 resource 分支持久化）；用户在建议卡中可编辑该「链接」字段。

### 4.10 review（`rev-`）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| type | `weekly` \| `monthly` | |
| periodKey | string | 如 `2026-W40` |
| date | ISO | |
| metrics | object | `{captured, created, completed, overdue, migrated?}` —— `migrated` 可缺省（生成流程暂不产出；编辑追踪落地后补，见 ADR-0007） |
| decisions | string[] | 1–3 条 if-then 行动（服务端后校验截断至 3 条 × ≤200 字） |
| summary | string | 七段结构正文（结论速览 → 数据解读 → 趋势对比 → 问题诊断 → 值得保留 → 下期行动 → 风险预警），≤800 字；schema 上限 2000（Slice L） |
| staleProjectIds? | string[] | |
| staleAdvice? | object[] | 迁移建议 `{projectId, action: archive\|migrate\|reactivate, reason}`；AI 生成时随报告归档、历史可回看（见下注，ADR-0038） |
| source? | `ai` \| `manual` | 来源：`ai` = 生成即自动归档；`manual` = 手工保存（旧记录缺省，Slice L） |
| updatedAt? | ISO | 最近编辑时间（`review.update` 时 bump；旧记录缺省，Slice L） |

> **月回顾（v0.5 · Slice F）**：`type:'monthly'` 现已实际产出；`periodKey` 采用 `YYYY-MM`（如 `2026-10`，镜像前端 `toMonthKey` 与后端 `monthKey`）。指标窗口 = 本机时区 1 日 00:00 → now，`captured / created / completed / overdue` 口径与周回顾完全一致；`migrated` 同样可缺省（见 ADR-0007 §6）。

> **报告升级 + 自动归档（v0.5 · Slice L，见 ADR-0013）**：`summary` 升级为七段结构正文，摘要注入上一周期指标 + 环比 + 阈值 + 带 id 的清单；模型输出经「数字子集护栏」校验（越界单次纠正重试，仍越界保留并记录）。`POST /api/ai/review/draft` 成功后**自动归档**一条 `review`（`source:'ai'`、`date` = 归档时刻、审计 `review.create` · `detail.auto`），响应附 `reviewId`；前端「保存回顾」经新增的 `POST /api/reviews/:id/update` 更新**同一**记录（保留 id / type / periodKey / date / metrics / staleProjectIds，递增 `updatedAt`，审计 `review.update`），不重复建。**每次生成 = 新增一个归档版本**（时间序可查阅）；`/api/reviews/:id/remove` 删除（审计 `review.remove`）。

> **可读性升级（v0.5 · Slice U，见 ADR-0013 §6）**：字段与归档语义**不变**，三点修订——① **同期口径**：进行中的周期对照上一周期**同等已走完长度**（月：本月 1..N 日 ↔ 上月 1..N 日，短月截断；周：本周至今 ↔ 上周同期），摘要以「上X同期」标注，窗口未满 7 天附【窗口说明】；② **去重**：第 6 段「下期行动」只留一行指针「见决策区（N 条）」，完整 if-then 仅在 `decisions`；③ **可读性**：清单「标题（id）」标题优先、百分比仅基准 ≥5、结论不以「窗口仅 N 天」开场。前端报告弹窗默认**阅读视图**（分节渲染，`src/lib/reviewReport.ts` 解析，「编辑」切换 textarea），报告历史只读复用同一视图。

> **回顾自动化（v0.5 · 回顾自动化批次，见 ADR-0038）**：新增可选字段 `staleAdvice`（迁移建议，形状 `{projectId, action, reason}`，服务端 `staleAdviceSchema` 校验）——`/api/ai/review/draft` 自动归档时**随报告一并持久化**（此前仅在草稿响应中短暂存在），手工保存 `POST /api/reviews` 也可透传（非法形状静默丢弃，绝不 500）；`POST /api/reviews/:id/update` 白名单**不变**（建议随版本生成、不参与编辑）。前端新增每日调度 `src/lib/review.ts` `useReviewScheduler`（`AppLayout` 挂载）：**周一 12:00 后**自动生成周回顾、**每月 1 日 12:00 后**自动生成月回顾，同一 `periodKey` 已存在归档（任意来源）/ 数据未水合 / 本会话已尝试 / 他标签持锁 / AI 离线时均跳过；成功即 toast「已自动生成本周回顾 · 查看」并水合快照，失败静默；**只生成报告，绝不自动应用任何迁移建议**。归档报告阅读视图新增「迁移建议」块，可回看并复用既有处置动作（归档 / 迁移 / 重启）。

> **「迁移」瓦片移除（v0.5 · Slice Y，见 ADR-0021）**：`migrated` 生成流程**刻意不产出**（`computeMetricsForWindow` 只返回 captured / created / completed / overdue），报告面板的「迁移」瓦片长期恒显示 `—`，已从 `Review.tsx` `METRIC_LABELS` **移除**。`ReviewMetrics.migrated` 字段**保留**以兼容旧归档（`rev-0001` / `rev-0002` 含该值）；总览 W40 行在缺省时渲染 `—`（修复字面 `undefined`）。若日后落地「编辑追踪」需要，可重新引入该瓦片。

### 4.10b course（`c-`）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| title | string | 课程名 |
| teacher? | string | 教师 |
| location? | string | 默认地点（时段未单独指定时回退） |
| sessions | CourseSession[] | 上课时段 **1..16**（子表见下） |
| notes? | string | 备注 |
| createdAt | ISO | |
| updatedAt | ISO | 编辑会 bump（与 event / area / goal / habit 不同） |

时段子表 `CourseSession`：

| 字段 | 类型 | 说明 |
|---|---|---|
| dayOfWeek | 1..7 | 1 = 周一 … 7 = 周日 |
| startPeriod | 1..20 | 开始节次 |
| endPeriod | 1..20 | 结束节次（须 ≥ `startPeriod`） |
| weeks? | number[] | 周次（1..60，升序唯一）；缺省 / 空 = 每周 |
| location? | string | 该时段地点（缺省回退课程默认地点） |

> **课表（v0.5 · Slice H0，见 ADR-0024）**：课程是「每周重复的多时段」——一个 `course` 含若干 `CourseSession`（星期 + 起止节次 + 可选周次），与一次性任务分开、也不混入议程流。创建 `POST /api/courses`（`title` 必填、`sessions` 1..16；`teacher`/`location`/`notes` 可选，trim 后空则省略）；编辑 `POST /api/courses/:id/update`（白名单 `title/teacher/location/sessions/notes`；可选字段置空则清除）；删除 `POST /api/courses/:id/remove` + 回收站 `restore` / `purge`。服务端 `normalizeCourseSessions` 统一规格化：周次**排序去重**（空则删 `weeks` 键 = 每周）、`location` trim（空则删键）、`endPeriod < startPeriod` → 400（结束节次不能早于开始节次）、空 `sessions` → 400（课程至少需要一个上课时段）。审计 `course.create/update/remove/restore/purge`。周次解析 / 格式化与按周过滤见前端纯函数 `src/lib/schedule.ts`（`parseWeeksInput` / `formatWeeks` / `weekOfTerm` / `sessionInWeek` / `sessionsOfDay`）。**导入来源**：批量导入经 `POST /api/courses/import` 写入，审计 `course.create` 的 `detail.via:'timetable-import'`（见 ADR-0025 / §9）。

### 4.11 元数据

**`data/meta/config.json`**

| 字段 | 类型 |
|---|---|
| name | string |
| owner | string |
| version | string |
| locale | string |
| weekStart | string |
| createdAt | ISO |
| aiAutomation | `'confirm'` \| `'auto'`（可选；Slice R2 起可写，缺省视作 `confirm`） |
| bio | string ≤160（可选；个人页简介，v0.5 个人页切片） |
| avatarPath | string（可选；头像文件绝对路径，见下注） |

> **AI 自动化档位（v0.5 · Slice R2，见 ADR-0016）**：`aiAutomation` 经 `POST /api/config { aiAutomation }` 更新（白名单 + Zod + 原子写 + 审计 `config.update`）。`'confirm'`（默认）= 先确认后写入；`'auto'` = 自动解析完成后自动应用本次**创建类低风险动作**（`task`/`note`/`resource`/`project`），可一键撤销；**永不**删除 / 完成 / 归档 / 修改既有实体（能力边界见 ADR-0016 §2.3）。旧配置缺省时前端视作 `'confirm'`。

> **个人资料（v0.5 · 个人页切片，见 ADR-0039）**：资料在 `config` 内扩展，不新增实体文件——`owner` 复用为**显示名**，新增可选 `bio`（≤160）与 `avatarPath`。更新经 `POST /api/config { owner?, bio?, aiAutomation? }`（白名单 + Zod；三键均可选、至少一键，非法 / 空补丁 400；原子写 + 审计 `config.update`）。头像为本地图片文件 `data/files/profile-avatar-<YYYYMMDDHHmmss-mmm>.<ext>`（`data/files/` 已 gitignore、不随安装包分发；png / jpeg / webp / gif，≤2 MB）：`POST /api/profile/avatar`（RAW body 流式落盘；超限 413、类型非法 / 空文件 400；写 `config.avatarPath`（绝对路径）并清理旧头像；审计 `profile.avatar`）、`POST /api/profile/avatar/remove`（清 `avatarPath` + 删文件，幂等）、`GET /api/profile/avatar`（按扩展名流式返回 + `nosniff` + `no-store`；无头像 / 文件缺失 404）。头像**不进快照字节**（快照只带 `avatarPath`），前端以 `/api/profile/avatar?v=<文件名>` 渲染。
>
> **活跃摘要（只读派生，不落盘）**：`GET /api/activity/summary?days=N`（默认 140、clamp 7..400）读取 `data/activity.jsonl`，按**本地日**聚合每个动作的条数并**零填充**缺失日（返回 `days / total / span`）；排除 `config.update`、`ai.key.update` 两类设置噪音，其余真实写入（含 `habit.checkin`）均计入。个人页「活跃日历」消费该端点；无对应存储字段。

**`data/meta/term.json`**

| 字段 | 类型 | 说明 |
|---|---|---|
| startDate? | `YYYY-MM-DD` | 第 1 周的周一 |
| totalWeeks? | 1..30 | 总周数 |
| updatedAt? | ISO | 最近更新 |

> **学期元数据（v0.5 · Slice H0，见 ADR-0024）**：单例文件，经 `POST /api/term` 更新（白名单 `startDate` / `totalWeeks`；格式非法 / 越界 → 400 中文可读；审计 `term.update` · `detail.fields`；写入经单写者 + 原子写）。**文件缺失 = 学期未设置**：前端课表不显示「第 N 周」、不按周过滤（显示全部课程）。`startDate` 为第 1 周周一，`weekOfTerm` 据此把日期换算为「第 N 周」。

**`data/meta/tags.json`**

| 字段 | 类型 | 说明 |
|---|---|---|
| tags | array | `[{id, name, namespace, label, origin?, createdAt?, firstUsedIn?}]` |
| tags[].id | string | `tag-\d{3,}`（`tag-001` 起；运行时登记继续递增） |
| tags[].name | string | 规范标签名（见 §4.12 规格化规则） |
| tags[].namespace | `role` \| `context` \| `topic` | 由名字前缀推断（`@` → `context`；`role:` / `topic:` / `context:`；裸名 → `topic`） |
| tags[].label | string | 展示名（默认取名字去掉命名空间前缀） |
| tags[].origin | `seed` \| `manual` \| `ai` | 来源（可选；旧记录缺省视作 `seed`） |
| tags[].createdAt | ISO | 登记时间（可选；旧种子记录缺省） |
| tags[].firstUsedIn | string | 首次随哪个实体登记，如 `t-0003`（可选） |

### 4.12 标签生命周期（Slice T）

标签是交叉筛选轴（非目录分区，见 ADR-0002 / ADR-0014），其完整生命周期如下：

1. **规格化**：实体写入前，标签名经 `normalizeTagName()` 归一——`@x` → `@x`（context）；`role:` / `topic:` / `context:` 前缀原样；裸名 `线性代数` → `topic:线性代数`；未知前缀归入 `topic`；空串丢弃。保证实体标签名与注册表 / 筛选条同名匹配。
2. **录入即生成**：任何携带 `tags` 的写入（任务创建 / 更新、澄清 `details.tags`、项目创建 / 更新、笔记创建 / 更新、资料更新）之后，`ensureTags()` 把未注册名登记进注册表（`origin` / `createdAt` / `firstUsedIn`），每个新标签审计 `tag.create`。请求带 `ai:true` → `origin:'ai'`，否则 `'manual'`。
3. **AI 生标签**：收件箱解析与任务补全可在无合适已有标签时提议 `topic:名称`（≤12 字、≤3 个、去重）；`postValidate` 规格化保留（不再过滤注册表外名）。应用 / 创建时才登记（`origin:'ai'`）。
4. **管理**：`POST /api/tags/:id/update`（重命名，级联实体 tags；审计 `tag.rename`）、`…/merge`（合并，级联 + 去重 + 源移除；`tag.merge`）、`…/remove`（使用中 409 阻止；`tag.remove`）、`POST /api/tags/backfill`（扫描登记存量未注册名；`tag.create` + `tag.backfill`）。
5. **级联不 bump `updatedAt`**：改名 / 合并只替换 `tags` 数组，不改实体更新时间，避免污染停滞项目与回顾「最近活动」口径。
6. **计数**：使用数 = 在 `tasks / projects / notes / resources / events` 上出现的实体数（`events` 只读但计入）。

### 4.13 澄清 target × 可应用字段矩阵（Slice V）

AI 建议卡「编辑」与手工澄清 `POST /api/inbox/:id/clarify` 的 `details` 字段，**严格**按 target 落盘；UI 只渲染该 target 会应用的字段（`src/lib/aiForm.ts` `CLARIFY_FIELD_MATRIX`），服务端分支同源实现，**不存在「编辑了却被静默丢弃」**。

| target | title | tags | contexts | energy | importance | estimateMin | dueAt | projectId | areaId |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| task | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| note | ✓ | ✓ | — | — | — | — | — | ✓ | ✓ |
| resource | ✓ | ✓ | — | — | — | — | — | — | ✓ |
| project | —（忽略 details，完成定义待整理） | — | — | — | — | — | — | — | — |
| discard | —（无需字段） | — | — | — | — | — | — | — | — |

- `projectId` / `areaId` 落盘前校验形状与存在性（臆造即 400）；note 首次支持 `projectId` / `areaId`（Slice V 修复）；resource 的 `title` 对**文件条目同样应用**（此前被强制用原文，属静默丢弃，Slice V 修复）；resource 另接受 `note`（资料「简介」，Slice R2.5，见 §4.9）。
- `discard` 不产出 `details`。切换到 note / resource 时，表单保留仍相关字段的编辑值（title / tags / projectId / areaId），隐藏任务专属字段。

### 4.14 一揽子动作矩阵（Slice R1）

收件箱解析输出动作数组（`aiActionSchema`，≤6 个；`server/schemas.mjs`）；`POST /api/inbox/:id/apply` 按 `kind` 落盘如下字段（服务端重新 Zod 校验 + 关联 id 存在性校验，绝不信任客户端形状）。前端逐条编辑只渲染该 kind 会应用的字段（`src/lib/aiForm.ts` `ACTION_FIELD_MATRIX`）。

| kind | title | outcome | contexts | energy | importance | estimateMin | dueAt | projectId | areaId | tags | note | 备注 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| task | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ / linkToNewProject | ✓ | ✓ | — | 新建 `status:'next'`，带 `sourceInboxId` |
| note | ✓ | — | — | — | — | — | — | ✓ / linkToNewProject | ✓ | ✓ | — | `type:'fleeting'`，`body` = 条目原文 |
| resource | ✓ | — | — | — | — | — | — | — | ✓ | ✓ | ✓ | 文件条目 `kind:'file'` + `path`；`note` = 简介（≤120 字） |
| project | ✓ | ✓ | — | — | — | — | — | — | ✓ | ✓ | — | 新建 `status:'active'`，先于实体创建 |

- 至多 1 个 `project` 动作；`linkToNewProject` 与 `projectId` 互斥（服务端强制）；`project` 动作缺省 `areaId` 为 `a-0001`、缺省 `outcome` 为「完成定义待整理（由收件箱一揽子应用创建）」。
- 关联 id（`projectId` / `areaId` / `duplicateOf`）与标签仍走 `postValidateActions` 快照过滤（臆造即丢弃）；每个动作 tags ≤3。
- **文件条目（Slice R2.5）**：条目带【附件】时，`postValidateActions({ hasFile:true })` **硬归一化为恰好 1 个 `resource` 动作**（丢弃全部 task / note / project；模型未产出 resource 时以文件名 + 保守小结兜底），`note` 归一化 ≤120 字。`POST /api/inbox/:id/apply` 亦对文件条目纵深过滤（只保留 1 个 resource）。文本条目保留多动作能力，提示词新增反过拆规则（通常 1–4 个、信息类优先 note / resource + 小结、仅对明确可执行的事产出 task）。
- 旧式单建议形状（`target` / `newProjectHint` 等）由 `legacyToActions` 归一化为动作数组（`newProjectHint` → 项目动作 + 实体 `linkToNewProject`），同步 / 流式两条路径共用。
- **通知「三性」与条件（Slice N0，见 ADR-0023）**：解析输出除 `actions` 外增顶层 `facts`（硬事实要点，**不落盘**）；`task` 动作可带可选 `condition`（≤30 字适用前提）——`postValidateActions` 对 null / 非 task / trim 空串清理，前端带条件者**默认不勾选**（勾选 = 相关），应用经 `formToAction` 透传。图片条目（`isImageFile()`：扩展名或 `image/*`）**跳过**「文件 = 恰 1 个 resource」硬归一化，按文本多动作规则处理（非图片不变）。`inbox.apply` 审计增 `detail.signals.conditions`（已应用动作非空条件去重、首见顺序）。

## 5. 生命周期与状态流

### 5.1 inboxItem

```text
unprocessed ──澄清──> clarified（linkedId 指向新实体）
     │                    │
     │                    └──撤回（revert / unapply：删除全部产物）──> unprocessed
     │
     ├──一揽子应用（apply：建项目 + 实体，记录 linkedIds / appliedTagIds）──> clarified
     │                    │
     │                    └──撤销（unapply：删除全部 linkedIds + 清理本次新标签）──> unprocessed
     │
     └──丢弃──> discarded ──恢复（revert：无产物，仅重置 status）──> unprocessed
     │
     └──删除（remove，含附件清理）──> ∅
discarded ──删除（remove）──> ∅
```

> 删除对 `clarified` 条目返回 409（保护已联动实体），须先「撤回」；`revert` 对 `unprocessed` 幂等。一揽子应用（Slice R1）的 `revert` / `unapply` 会删除 `linkedIds` 全部产物并清理 `appliedTagIds`，恢复到应用前基线。见 §4.1 / §4.14 与 ADR-0008 §6 / ADR-0015。

### 5.2 task

```text
next / waiting / scheduled / someday
        │
        ├──完成──> done（写 doneAt）
        └──放弃──> dropped

someday ──迁移/激活──> next（回顾中的重决策）
```

### 5.3 project

```text
active ──暂停──> onHold ──恢复──> active
   │
   ├──搁置──> someday
   └──完成──> done ──归档──> archived
```

### 5.4 resource

```text
unread ──> reading ──> read ──> reference ──> archived
```

### 5.4b 回收站（可写 / 可回收实体）

```text
正册 data/<kind>/<id>.json ──删除──> data/trash/<kind>/<id>.json（+ trashedAt）
        ↑────────恢复（去 trashedAt）────────┘
                                        └──彻底删除──> 不可恢复
```

十种可写 / 可回收实体（task / project / note / resource / event / trace / area / goal / habit / course）的删除均为**软删除**：先写回收站副本再删正册文件（原子、串行）。恢复写回正册并删副本；彻底删除仅删副本。`nextId` 同时扫描正册与回收站，避免回收后 id 复用导致恢复冲突。回收站不出现在 `/api/snapshot` 中，单独经 `GET /api/trash` 读取（见 ADR-0009；事件并入见 ADR-0018；区域 / 目标 / 习惯并入见 ADR-0019，其删除前另有引用护栏，见 §4.4–4.6；课程并入见 ADR-0024）。

### 5.5 event

```text
tentative ──确认──> confirmed
confirmed ──取消──> cancelled
```

> **状态流可执行（v0.5 · Slice W，见 ADR-0018）**：日程详情弹窗内 quiet segmented 直接切换 `已确认 / 待定 / 已取消`（`POST /api/events/:id/update`，审计 `event.update`），toast 可撤销。此前该状态流仅见于文档、无执行入口。

### 5.6 迁移即重决策

回顾阶段，任何过期或停滞项必须显式处理：迁移（更新到未来）或丢弃/归档，不允许无声堆积（Bullet Journal 精神）。`review.staleProjectIds` 记录待重决策的停滞项目。

## 6. 示例记录

### 6.1 task

```jsonc
// data/tasks/t-0012.json
{ "id":"t-0012", "title":"给 demo 实验室发面试确认邮件", "notes":"附上 KERNEL 仓库链接",
  "status":"next", "contexts":["@computer"], "energy":"low", "estimateMin":15, "importance":3,
  "dueAt":"2026-10-04T18:00:00+08:00", "projectId":"p-0005", "areaId":"a-0004",
  "tags":["role:acm","topic:面试"], "createdAt":"2026-10-01T21:30:00+08:00",
  "updatedAt":"2026-10-02T09:00:00+08:00" }
```

### 6.2 event

```jsonc
// data/events/e-0003.json
{ "id":"e-0003", "title":"学生组织例会", "startAt":"2026-10-06T19:30:00+08:00",
  "endAt":"2026-10-06T21:00:00+08:00", "allDay":false, "location":"某教室",
  "areaId":"a-0003", "tags":["role:competition-head"], "status":"confirmed" }
```

### 6.3 project

```jsonc
// data/projects/p-0005.json
{ "id":"p-0005", "title":"demo 实验室面试准备", "outcome":"拿到 offer 或明确差距清单",
  "status":"active", "areaId":"a-0004", "goalId":"g-0002", "nextActionId":"t-0012",
  "tags":["role:acm"], "createdAt":"2026-09-28T20:00:00+08:00",
  "updatedAt":"2026-10-02T09:00:00+08:00" }
```

## 7. 区域建议（标准式，非身份）

区域是"持续维护的标准"，不是身份分区。

| id | title | standard |
|---|---|---|
| a-0001 | 学业 | 无挂科；作业不过夜 |
| a-0002 | 学生工作 | 通知不过夜；同学求助当天回应 |
| a-0003 | 竞赛与组织 | 活动落地；结束后一周内复盘归档 |
| a-0004 | 算法成长 | 每周 ≥5 题；CF 稳步上分 |
| a-0005 | 技术创作 | 每两周至少一次可见产出 |
| a-0006 | 健康作息 | 23:30 前睡；每周运动 3 次 |
| a-0007 | 人际与连接 | 主动维护导师/同学/朋友网络 |

## 8. 种子数据要求

以 **2026-10-02** 为"现在"，全中文、真实感、可直接演示：

| 实体 | 数量 | 要求 |
|---|---|---|
| task | 40 到 60 | 覆盖全部 status / energy / contexts / roles；含 3 到 5 条逾期、5 到 8 条 someday、waiting 若干 |
| event | 15 到 20 | 未来两周：课表、学生组织例会、ACM 训练赛、CF Round、班会、助理值班、demo 面试约谈 |
| project | 8 到 10 | 含 KERNEL 自身、竞赛策划、ACM 训练计划、面试准备等 |
| goal | 6 到 8 | |
| habit | 4 到 6 | 含连续打卡数据供热力图 |
| note | 10 到 15 | |
| resource | 10 到 15 | |
| inboxItem | 5 到 8 | 未澄清 |
| review | 2 | 2026-W40 周回顾 + 9 月月回顾 |

## 9. 写入路径与未来

- **已实现（v0.4）**：写入经 Node 单写者数据服务（`server/`）：Zod 校验 + 原子写入，审计日志 `data/activity.jsonl`；前端经 `/api` 访问（ADR-0004）。
- **完成语义**：任务完成 = `status:'done'` + `doneAt` 落盘；重新打开从审计日志还原此前的 `status`。
- **澄清联动**：收件箱条目澄清后 `status:'clarified'` 且 `linkedId` 指向新实体；新任务带 `sourceInboxId` 反指；撤销澄清（`revert`）会删除该次澄清创建的实体。
- **编辑 / 回收站（v0.5 · Slice E2）**：四种可写实体（Slice E2 起为 task / project / note / resource 四类，后续切片逐步扩展至九类，见 §5.4b）经 `POST /api/<kind>/<id>/update` 部分更新（字段白名单，保留 id / createdAt，递增 updatedAt）；删除走回收站（`data/trash/`，见 §5.4b），可恢复或彻底删除；`POST /api/reveal` 在本机文件管理器中定位本地文件（见 ADR-0009）。
- **通用笔记创建（v0.5 · Slice G）**：`POST /api/notes` 新建笔记（`title` 非空、`type` 白名单缺省 `memo`、`body` 为 markdown 文本；`nextId('notes')` + Zod + 原子写 + 审计 `note.create`）。总览「AI 对话归档」即经此端点落盘（标题 `AI 对话归档 · YYYY-MM-DD HH:mm`、`type:'memo'`、body 为 `**我**`/`**KERNEL**` 交替的 transcript）；只读对话 `POST /api/ai/chat` 不落盘（见 ADR-0010）。
- **状态贯通（v0.5 · Slice H）**：编辑白名单扩充，使「已显示」的状态 / 字段可设置——`notes` 增 `areaId / projectId / distillLevel`、`resources` 增 `areaId`、`projects` 增 `goalId / nextActionId`（均经 `POST /api/<kind>/<id>/update`，审计 `<singular>.update`）。资料状态 / 笔记蒸馏层级在详情弹窗内以安静分段控件直接设置（判断标准见 §4.8 / §4.9）。任务快速新建 AI 补全 `POST /api/ai/task/draft { title }` 只产出建议（`contexts / energy / importance / estimateMin / dueAt / projectId / areaId / tags`，按快照过滤臆造 id / 标签），**绝不自动落盘**，应用经既有 update 端点（见 ADR-0011）。
- **先确认后写入（v0.5 · Slice O）**：`POST /api/tasks` 创建时接受可选字段 `contexts / energy / importance / estimateMin / dueAt / projectId / areaId / tags`（`title` 必填不变；缺省默认同旧：`contexts ['@computer'] / energy 'low' / importance 2 / tags []`）；`projectId / areaId` 需形状合法且存在（否则 400）；审计 `task.create` 的 `detail.fields` 列出本次携带字段。任务快速新建改为**草稿确认弹窗**（确认前零写入；AI 仅预填，绝不改写标题 / 用户已改字段；AI 失败不阻断创建）；收件箱 AI 建议卡增「编辑」，应用提交编辑值经既有 `clarify`（`details` + `ai:true`）。见 ADR-0011 §6。
- 审计动作新增：`note.update` / `resource.update` / `project.update` 的 `detail.fields` 记录变更键；`task.update` 同。
- **回顾报告归档（v0.5 · Slice L，见 ADR-0013）**：`POST /api/ai/review/draft` 成功后自动 `commit('reviews', …)`（`source:'ai'`，审计 `review.create` · `detail.auto`）；`POST /api/reviews/:id/update` 编辑归档报告（白名单 `summary` / `decisions`，递增 `updatedAt`，审计 `review.update` · `detail.fields`）；`POST /api/reviews/:id/remove` 删除（审计 `review.remove`）。前端回顾页「报告历史」按 `date` 倒序查阅。
- **标签生命周期（v0.5 · Slice T，见 ADR-0014 / §4.12）**：标签名写入前规格化（裸名 → `topic:` 等）；任意携带 `tags` 的写入后 `ensureTags()` **自动登记**未注册名（`origin` / `createdAt` / `firstUsedIn`，审计 `tag.create`）；AI 可在无合适已有标签时提议新标签（`postValidate` 规格化保留，应用时以 `origin:'ai'` 登记）；新增管理端点 `POST /api/tags/:id/update`（重命名级联，`tag.rename`）、`…/merge`（合并级联 + 去重，`tag.merge`）、`…/remove`（使用中 409 阻止，`tag.remove`）、`POST /api/tags/backfill`（扫描登记存量，`tag.backfill`）；设置页新增「标签管理」区；资料库标签条按使用计数降序、不再截断前 12。
- **区域 / 目标 / 习惯可管理 + 打卡（v0.5 · Slice X，见 ADR-0019 / §4.4–4.6）**：三类只读结构转为可管理——创建 `POST /api/areas` · `/api/goals` · `/api/habits`、编辑 `POST /api/<kind>/:id/update`（白名单）、删除 `POST /api/<kind>/:id/remove`（入回收站，区域 / 目标带**引用护栏**：被引用 → 409 含可读计数）；习惯打卡 `POST /api/habits/:id/checkin` · `/uncheckin`（缺省今天、幂等、写 `{date,value:1}`）；审计 `area.*` / `goal.*` / `habit.*`。设置页新增「区域 / 目标 / 习惯」三管理区；总览「习惯打卡」条取首个习惯并支持「今日打卡」切换；关联 area/goal 芯片深链到设置分区（F8）。`keyResults` 与 `habit.log` 的精细编辑延后。
- **笔记 AI 蒸馏（v0.5 · Slice M，见 ADR-0020 / §4.8）**：`POST /api/ai/note/distill { id, targetLevel? }` 只产出**下一层草稿文本**（返回 `{ text, targetLevel, model, ms }`，**不落盘、无审计**；缺省目标 = 当前层级 + 1，clamp 1–3）。应用经既有 `POST /api/notes/:id/update` 一次写 `{ body, distillLevel }`——`body` **追加** `## 蒸馏 → Lx` 小节（不替换、原文不丢），撤销往返精确还原；**点选层级本身只标注、不改内容**。新建笔记入口 `POST /api/notes`（Slice M 前端暴露，创建可撤销 = 移入回收站）。
- **课表（v0.5 · Slice H0，见 ADR-0024 / §4.10b）**：新增可写 / 可回收实体 `course`（`c-`）——创建 `POST /api/courses`（`title` 必填、`sessions` 1..16；审计 `course.create`）、编辑 `POST /api/courses/:id/update`（白名单 `title/teacher/location/sessions/notes`；审计 `course.update`）、删除 `POST /api/courses/:id/remove`（入回收站，审计 `course.remove`）；`normalizeCourseSessions` 统一规格化时段（周次排序去重 / 空删键 / `end ≥ start` / 空 sessions → 400）。学期元数据 `data/meta/term.json`（见 §4.11）经 `POST /api/term` 更新（白名单 `startDate` / `totalWeeks`，审计 `term.update`；缺失 = 未设置）。前端日历页「议程 / 课表」模式（`kernel.ui.calendar.v1`）+ `ClassGrid` + 手动录入弹窗；无新依赖。AI 导入 / 调休例外 / 节次 → 时间映射延后。
- **课表导入（v0.5 · Slice H1，见 ADR-0025 / §4.10b）**：来源 → 课程草稿 → 勾选确认。`POST /api/ai/timetable/draft { id }` 对收件箱**未澄清**条目跑课表解析，返回 `{ courses: CourseCreateInput[], model, ms }`（**不落盘、无审计**；400 不可直读附件指引 / 404 / 409 非未澄清 / 502 / 503）。`POST /api/courses/import { courses }`（1–30 门）先全量校验 + `normalizeCourseSessions` 规格化、零落盘，全部通过后逐条 `commit`（审计 `course.create` · `detail.via:'timetable-import'`；201 `{ created }`），任一非法整批 400 不留半成品。读取：`.xlsx` 走 `extractXlsxGrid` 网格抽取、`.csv` 文本白名单、旧版 `.xls` 走 `extractLegacyXlsText` 三分支（OLE2 二进制 → 不做 BIFF 解析、给不可读指引；HTML / XML 表格 → 摘录；纯文本 → 原文摘录）、截图复用 N0 file part；`cleanTimetableCourses` 确定性清洗。前端收件箱「导入为课表」入口 + `TimetableDraftCard`（勾选默认全选，导入可撤销 = 逐条回收站）；直读旧版 `.xls`（BIFF）/ 多表 / 跨页 / 学期自动对齐延后。
- schema 预留实体（`timeLog` / `person` / `journalEntry`）在 v1.0 前评估是否实现。
- 字段演进必须同步更新本篇，并通过 ADR 记录重大结构变更。
