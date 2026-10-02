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
| file? | `{ name, size, mime? }` | 文件投递附件元数据；二进制存 `data/files/<id>-<name>`（不进 git；见 ADR-0008） |

> **文件投递（v0.5 · Slice D）**：`source:'file'` 的条目由 `POST /api/inbox/upload` 创建，`content` 取 caption（无则文件名）。二进制**不**进 JSON，仅存于 `data/files/`（`.gitignore`）；AI 解析时按「文本白名单 **或 Office Open XML（`.docx/.pptx/.xlsx`，Slice J）** + ≤5MB → 前 8000 字摘录，否则仅元数据」注入提示。删除条目经 `POST /api/inbox/:id/remove`（已澄清条目 409，需先 revert）。附件**本机动作**（Slice J2）经 `POST /api/inbox/:id/open`（系统默认程序打开）/ `POST /api/inbox/:id/reveal`（文件管理器定位）——服务端解析 `data/files/<id>-<name>` 并做条目 / 元数据 / 磁盘三重校验，缺一 404；`{dryRun:true}`（`/api/inbox/:id/(open|reveal)` 与 `/api/open`）仅解析校验、绝不 spawn（自动化测试用）。详见 ADR-0008。

> **生命周期闭合（v0.5 · Slice V，见 ADR-0008 §6）**：文本捕捉成功后**自动运行一次 AI 解析**（与文件投递后自动解析节奏一致；AI 离线静默跳过、绝不自动应用，手动「AI 解析」保留）。UI 提供完整出口——未澄清 / 已丢弃条目「删除」（`POST /api/inbox/:id/remove`，服务端一并清理附件；已澄清仍 409 保护）；已丢弃条目「恢复」与已澄清条目「撤回」均复用 `POST /api/inbox/:id/revert`（discarded 无产物仅重置 `status:'unprocessed'`；clarified 先删除 `linkedId` 产物再回退）；已澄清条目「查看产物」按 `linkedId` 前缀深链跳转（`t-`→`/tasks?task=`、`p-`→`/projects?project=`、`n-`→`/library?note=`、`r-`→`/library?resource=`）。字段应用矩阵见 §4.13。

> **一揽子处置（v0.5 · Slice R1，见 ADR-0015）**：`POST /api/inbox/:id/apply { actions }` 一次写入把条目拆解出的全部动作落位——先建新项目（`kind:'project'`，至多 1 个），再逐条建 `task` / `note` / `resource`（`task` / `note` 的 `linkToNewProject:true` 自动挂到新项目）；标签以 `origin:'ai'` 登记。条目置 `clarified`，`linkedId` = 首个产物、`linkedIds` = 全部产物、`appliedTagIds` = 本次新登记标签。撤销 `POST /api/inbox/:id/unapply` 删除全部 `linkedIds` 产物并 `pruneTags(appliedTagIds)` → 条目回 `unprocessed`（`revert` 同语义，兼容旧单 `linkedId`）。动作矩阵见 §4.14。

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
| deferUntil? | ISO | |
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

### 4.3 project（`p-`）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| title | string | |
| outcome | string | 完成定义 |
| status | `active` \| `onHold` \| `someday` \| `done` \| `archived` | |
| areaId | string | |
| goalId? | string | |
| nextActionId? | string | |
| dueAt? | ISO | |
| tags | string[] | |
| createdAt | ISO | |
| updatedAt | ISO | |

> **创建可选字段（v0.5 · Slice R1，见 ADR-0015）**：`POST /api/projects` 除 `title`（必填）外接受可选 `outcome` / `areaId` / `tags`（项目快速新建草稿确认后一次性提交；`areaId` 须真实存在，否则 400）。缺省行为不变：`status:'active'`、`areaId:'a-0001'`、`outcome:'完成定义待整理'`、`tags:[]`。请求带 `ai:true` → 新标签 `origin:'ai'`；审计 `project.create` · `detail.fields`。

### 4.4 area（`a-`）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| title | string | |
| standard | string | 标准声明，如"作业不过夜" |
| cadence | `weekly` \| `monthly` \| `quarterly` | |
| status | string | |

### 4.5 goal（`g-`）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| title | string | |
| horizon | `term` \| `quarter` \| `year` | |
| areaId? | string | |
| parentGoalId? | string | |
| keyResults | array | `[{text, target, current, unit?}]` |
| status | string | |
| targetDate? | ISO | |

### 4.6 habit（`h-`）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| title | string | |
| cadence | string | |
| trigger | string | 实施意图 |
| metric | `count` \| `minutes` \| `bool` | |
| target | number | |
| areaId? | string | |
| log | array | `[{date, value}]` |

### 4.7 event（`e-`）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| title | string | |
| startAt | ISO | |
| endAt | ISO | |
| allDay | boolean | |
| location? | string | |
| areaId? | string | |
| projectId? | string | |
| tags | string[] | |
| status | `confirmed` \| `tentative` \| `cancelled` | |
| repeatRule? | string | |

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
| source? | `ai` \| `manual` | 来源：`ai` = 生成即自动归档；`manual` = 手工保存（旧记录缺省，Slice L） |
| updatedAt? | ISO | 最近编辑时间（`review.update` 时 bump；旧记录缺省，Slice L） |

> **月回顾（v0.5 · Slice F）**：`type:'monthly'` 现已实际产出；`periodKey` 采用 `YYYY-MM`（如 `2026-10`，镜像前端 `toMonthKey` 与后端 `monthKey`）。指标窗口 = 本机时区 1 日 00:00 → now，`captured / created / completed / overdue` 口径与周回顾完全一致；`migrated` 同样可缺省（见 ADR-0007 §6）。

> **报告升级 + 自动归档（v0.5 · Slice L，见 ADR-0013）**：`summary` 升级为七段结构正文，摘要注入上一周期指标 + 环比 + 阈值 + 带 id 的清单；模型输出经「数字子集护栏」校验（越界单次纠正重试，仍越界保留并记录）。`POST /api/ai/review/draft` 成功后**自动归档**一条 `review`（`source:'ai'`、`date` = 归档时刻、审计 `review.create` · `detail.auto`），响应附 `reviewId`；前端「保存回顾」经新增的 `POST /api/reviews/:id/update` 更新**同一**记录（保留 id / type / periodKey / date / metrics / staleProjectIds，递增 `updatedAt`，审计 `review.update`），不重复建。**每次生成 = 新增一个归档版本**（时间序可查阅）；`/api/reviews/:id/remove` 删除（审计 `review.remove`）。

> **可读性升级（v0.5 · Slice U，见 ADR-0013 §6）**：字段与归档语义**不变**，三点修订——① **同期口径**：进行中的周期对照上一周期**同等已走完长度**（月：本月 1..N 日 ↔ 上月 1..N 日，短月截断；周：本周至今 ↔ 上周同期），摘要以「上X同期」标注，窗口未满 7 天附【窗口说明】；② **去重**：第 6 段「下期行动」只留一行指针「见决策区（N 条）」，完整 if-then 仅在 `decisions`；③ **可读性**：清单「标题（id）」标题优先、百分比仅基准 ≥5、结论不以「窗口仅 N 天」开场。前端报告弹窗默认**阅读视图**（分节渲染，`src/lib/reviewReport.ts` 解析，「编辑」切换 textarea），报告历史只读复用同一视图。

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

> **AI 自动化档位（v0.5 · Slice R2，见 ADR-0016）**：`aiAutomation` 经 `POST /api/config { aiAutomation }` 更新（白名单 + Zod + 原子写 + 审计 `config.update`）。`'confirm'`（默认）= 先确认后写入；`'auto'` = 自动解析完成后自动应用本次**创建类低风险动作**（`task`/`note`/`resource`/`project`），可一键撤销；**永不**删除 / 完成 / 归档 / 修改既有实体（能力边界见 ADR-0016 §2.3）。旧配置缺省时前端视作 `'confirm'`。

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

### 5.4b 回收站（task / project / note / resource）

```text
正册 data/<kind>/<id>.json ──删除──> data/trash/<kind>/<id>.json（+ trashedAt）
        ↑────────恢复（去 trashedAt）────────┘
                                        └──彻底删除──> 不可恢复
```

四种可写实体（task / project / note / resource）的删除均为**软删除**：先写回收站副本再删正册文件（原子、串行）。恢复写回正册并删副本；彻底删除仅删副本。`nextId` 同时扫描正册与回收站，避免回收后 id 复用导致恢复冲突。回收站不出现在 `/api/snapshot` 中，单独经 `GET /api/trash` 读取（见 ADR-0009）。

### 5.5 event

```text
tentative ──确认──> confirmed
confirmed ──取消──> cancelled
```

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
- **编辑 / 回收站（v0.5 · Slice E2）**：四种可写实体（task / project / note / resource）经 `POST /api/<kind>/<id>/update` 部分更新（字段白名单，保留 id / createdAt，递增 updatedAt）；删除走回收站（`data/trash/`，见 §5.4b），可恢复或彻底删除；`POST /api/reveal` 在本机文件管理器中定位本地文件（见 ADR-0009）。
- **通用笔记创建（v0.5 · Slice G）**：`POST /api/notes` 新建笔记（`title` 非空、`type` 白名单缺省 `memo`、`body` 为 markdown 文本；`nextId('notes')` + Zod + 原子写 + 审计 `note.create`）。总览「AI 对话归档」即经此端点落盘（标题 `AI 对话归档 · YYYY-MM-DD HH:mm`、`type:'memo'`、body 为 `**我**`/`**KERNEL**` 交替的 transcript）；只读对话 `POST /api/ai/chat` 不落盘（见 ADR-0010）。
- **状态贯通（v0.5 · Slice H）**：编辑白名单扩充，使「已显示」的状态 / 字段可设置——`notes` 增 `areaId / projectId / distillLevel`、`resources` 增 `areaId`、`projects` 增 `goalId / nextActionId`（均经 `POST /api/<kind>/<id>/update`，审计 `<singular>.update`）。资料状态 / 笔记蒸馏层级在详情弹窗内以安静分段控件直接设置（判断标准见 §4.8 / §4.9）。任务快速新建 AI 补全 `POST /api/ai/task/draft { title }` 只产出建议（`contexts / energy / importance / estimateMin / dueAt / projectId / areaId / tags`，按快照过滤臆造 id / 标签），**绝不自动落盘**，应用经既有 update 端点（见 ADR-0011）。
- **先确认后写入（v0.5 · Slice O）**：`POST /api/tasks` 创建时接受可选字段 `contexts / energy / importance / estimateMin / dueAt / projectId / areaId / tags`（`title` 必填不变；缺省默认同旧：`contexts ['@computer'] / energy 'low' / importance 2 / tags []`）；`projectId / areaId` 需形状合法且存在（否则 400）；审计 `task.create` 的 `detail.fields` 列出本次携带字段。任务快速新建改为**草稿确认弹窗**（确认前零写入；AI 仅预填，绝不改写标题 / 用户已改字段；AI 失败不阻断创建）；收件箱 AI 建议卡增「编辑」，应用提交编辑值经既有 `clarify`（`details` + `ai:true`）。见 ADR-0011 §6。
- 审计动作新增：`note.update` / `resource.update` / `project.update` 的 `detail.fields` 记录变更键；`task.update` 同。
- **回顾报告归档（v0.5 · Slice L，见 ADR-0013）**：`POST /api/ai/review/draft` 成功后自动 `commit('reviews', …)`（`source:'ai'`，审计 `review.create` · `detail.auto`）；`POST /api/reviews/:id/update` 编辑归档报告（白名单 `summary` / `decisions`，递增 `updatedAt`，审计 `review.update` · `detail.fields`）；`POST /api/reviews/:id/remove` 删除（审计 `review.remove`）。前端回顾页「报告历史」按 `date` 倒序查阅。
- **标签生命周期（v0.5 · Slice T，见 ADR-0014 / §4.12）**：标签名写入前规格化（裸名 → `topic:` 等）；任意携带 `tags` 的写入后 `ensureTags()` **自动登记**未注册名（`origin` / `createdAt` / `firstUsedIn`，审计 `tag.create`）；AI 可在无合适已有标签时提议新标签（`postValidate` 规格化保留，应用时以 `origin:'ai'` 登记）；新增管理端点 `POST /api/tags/:id/update`（重命名级联，`tag.rename`）、`…/merge`（合并级联 + 去重，`tag.merge`）、`…/remove`（使用中 409 阻止，`tag.remove`）、`POST /api/tags/backfill`（扫描登记存量，`tag.backfill`）；设置页新增「标签管理」区；资料库标签条按使用计数降序、不再截断前 12。
- schema 预留实体（`timeLog` / `person` / `journalEntry`）在 v1.0 前评估是否实现。
- 字段演进必须同步更新本篇，并通过 ADR 记录重大结构变更。
