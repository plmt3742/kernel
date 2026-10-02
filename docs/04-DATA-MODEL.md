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
| linkedId? | string | 澄清后指向新实体 |
| note? | string | |
| file? | `{ name, size, mime? }` | 文件投递附件元数据；二进制存 `data/files/<id>-<name>`（不进 git；见 ADR-0008） |

> **文件投递（v0.5 · Slice D）**：`source:'file'` 的条目由 `POST /api/inbox/upload` 创建，`content` 取 caption（无则文件名）。二进制**不**进 JSON，仅存于 `data/files/`（`.gitignore`）；AI 解析时按「文本白名单 **或 Office Open XML（`.docx/.pptx/.xlsx`，Slice J）** + ≤5MB → 前 8000 字摘录，否则仅元数据」注入提示。删除条目经 `POST /api/inbox/:id/remove`（已澄清条目 409，需先 revert）。附件**本机动作**（Slice J2）经 `POST /api/inbox/:id/open`（系统默认程序打开）/ `POST /api/inbox/:id/reveal`（文件管理器定位）——服务端解析 `data/files/<id>-<name>` 并做条目 / 元数据 / 磁盘三重校验，缺一 404；`{dryRun:true}`（`/api/inbox/:id/(open|reveal)` 与 `/api/open`）仅解析校验、绝不 spawn（自动化测试用）。详见 ADR-0008。

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
| note? | string | |

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
| decisions | string[] | |
| summary | string | |
| staleProjectIds? | string[] | |

> **月回顾（v0.5 · Slice F）**：`type:'monthly'` 现已实际产出；`periodKey` 采用 `YYYY-MM`（如 `2026-10`，镜像前端 `toMonthKey` 与后端 `monthKey`）。指标窗口 = 本机时区 1 日 00:00 → now，`captured / created / completed / overdue` 口径与周回顾完全一致；`migrated` 同样可缺省（见 ADR-0007 §6）。

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

**`data/meta/tags.json`**

| 字段 | 类型 | 说明 |
|---|---|---|
| tags | array | `[{id, name, namespace, label}]` |
| tags[].namespace | `role` \| `context` \| `topic` | |

## 5. 生命周期与状态流

### 5.1 inboxItem

```text
unprocessed ──澄清──> clarified（linkedId 指向新实体）
     └────────丢弃──> discarded
```

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
- schema 预留实体（`timeLog` / `person` / `journalEntry`）在 v1.0 前评估是否实现。
- 字段演进必须同步更新本篇，并通过 ADR 记录重大结构变更。
