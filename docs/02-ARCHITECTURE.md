# 02 · 技术架构

> 本篇展开宪法 §6 与 §8。描述技术选型与理由、数据层现状与未来、opencode 集成路线、托管拓扑与目录职责。事实源是 `docs/00-DESIGN-BRIEF.md`。

---

## 1. 架构总览

```text
[手机浏览器]  ──HTTP(局域网)──>  [PC: Vite dev / preview]
                                        │  /api 代理
                                        ▼
                              [本地 Node 数据服务 127.0.0.1:4097]
                                        │  读写（唯一写者）
                                        ▼
                              [data/ 文件式 JSON 数据库 + activity.jsonl 审计]
                                        ▲
                                        │ 写入（v0.5）
                              [opencode serve 127.0.0.1:4096]
```

分层原则：前端只负责呈现与调度；数据以文件形式留在本地；写入与 AI 能力收拢到本地 Node 服务，前端不直接触达文件系统，也不直接触达 opencode。

## 2. 技术栈决策

### 2.1 选定栈

- **Vite + React 19 + TypeScript（strict）+ 原生 CSS（CSS 变量 token 体系）**
- 路由：`react-router-dom`（使用 `viewTransition` 能力）
- 动效：**Motion**（组件状态 / 布局 / layoutId 共享元素 / 手势）+ **View Transitions API**（路由级变形）
- 命令面板：**cmdk**
- 其他白名单依赖：`date-fns`、`clsx`、`lucide-react`、`react-markdown`
- 字体：`@fontsource-variable/inter`、`@fontsource/jetbrains-mono`（自托管，离线可用）
- 数据服务（`server/`，仅服务端）：`zod`、`write-file-atomic`（见 ADR-0004）

前端依赖白名单（宪法 §6.1）：

```text
react  react-dom  react-router-dom  motion  cmdk  date-fns  clsx
lucide-react  react-markdown  @fontsource-variable/inter  @fontsource/jetbrains-mono
```

### 2.2 状态与路由

- 状态管理：React 内置（Context + hooks）；数据读取为模块级可变快照（`src/lib/data.ts`，挂载后经 `/api/snapshot` 水合），写入经 `src/lib/mutations.ts` → 数据服务 API（v0.4 起，localStorage 原型层已退役）。主题与轨道折叠等纯 UI 偏好仍存 localStorage。
- 路由：`/` 总览 · `/inbox` · `/tasks` · `/calendar` · `/timetable`（课表，Slice H2）· `/projects` · `/library` · `/review` · `/settings` · `/trash`（回收站）。

### 2.3 为什么不用 UI 框架 / Tailwind

| 决策 | 理由 |
|---|---|
| 不用组件库（MUI、Ant 等） | 本项目视觉是定制化的瑞士国际主义网格 + 纸感/墨感双主题。组件库的默认观感与 token 体系冲突，覆盖成本高于从零构建。 |
| 不用 Tailwind | 设计 token 已通过 CSS 变量表达，原生 CSS 与 token 是同一套语言。引入原子类会形成第二套样式来源，破坏"唯一 token 来源"的纪律。 |
| 用原生 CSS 变量 | token 可被设计系统、主题切换、对比度校验统一管理；零圆角、发际线、单一强调色等纪律用变量表达最直接。 |
| 用 Motion 而非 GSAP | v0.2 只需状态、布局与共享元素动效，Motion 与 React 模型贴合；GSAP 属于未来可选，不在 v0.2 引入。 |

## 3. 数据层

### 3.1 当前（v0.1 / v0.2）：文件式 JSON

- 数据源：`data/**`，**一记录一文件**。
- 前端经 `src/lib/data.ts` 读取：`import.meta.glob('/data/**/*.json')` + 类型化 getter；dev 下数据改动热更新。
- 规范：JSON UTF-8；ID 稳定（`t-0001` 式）；时间 ISO 8601 带偏移；字段见 `04-DATA-MODEL.md`。
- 禁止：前端直接写文件；在 JSON 中存储计算派生值（进度等一律运行时计算）。

一记录一文件的理由：

| 好处 | 说明 |
|---|---|
| 可 diff | 单条记录变化只产生一条文件的 diff，便于人工审查与未来 git 历史。 |
| 可备份 / 可迁移 | 直接拷贝目录即可，无数据库进程依赖。 |
| 冲突面小 | 不同记录在不同文件，未来多人或代理协作时冲突范围有限。 |
| AI 友好 | AI 可直接读写单个记录文件，不需要理解数据库协议。 |

### 3.2 已实现（v0.4）：Node 单写者数据服务

本地 Node 数据服务（`server/`）是**唯一写入路径**（实现细节见 ADR-0004）：

- **单写者**：所有写入经同一服务串行化（进程内写队列），消除并发写文件的风险。
- **原子写入**：`write-file-atomic`，避免写入中断产生半截文件。
- **Schema 校验**：Zod 定义各可写实体（task / inboxItem / note / resource / project / event / area / goal / habit / course）的 schema，写入前全量校验；校验失败返回 400 与可读原因。
- **审计日志**：`data/activity.jsonl` 记录每一次变更，可追溯（重新打开任务即从审计还原先前状态）。
- **写入路径收口**：浏览器（含手机经 Vite 代理）写入一律经 `/api`；服务仅监听 `127.0.0.1:4097`，永不暴露局域网。
- **前端水合**：首帧使用构建期 seed；挂载与窗口聚焦时经 `/api/snapshot` 重水合（多标签同步由聚焦刷新承担，实时通道留待 v0.5）。

v0.5 增补（Slice E2，见 ADR-0009）：可写实体通用编辑 `POST /api/<kind>/<id>/update`（字段白名单 + Zod + 审计）；回收站存储 `data/trash/<kind>/<id>.json`（原记录 + `trashedAt`），端点 `POST /api/<kind>/<id>/trash`、`GET /api/trash`、`POST /api/trash/<kind>/<id>/restore`、`POST /api/trash/<kind>/<id>/purge`；`POST /api/reveal` 经 `explorer.exe /select` 在本机文件管理器中定位（仅本机，见 ADR-0009）。

v0.5 增补（Slice G，见 ADR-0010）：通用笔记创建 `POST /api/notes`（title 非空 + `type` 白名单缺省 `memo`；`nextId` + `commit` + 审计 `note.create`；201），供总览「AI 对话归档」等调用；只读 AI 对话 `POST /api/ai/chat`（有界历史 + 读快照摘要，自然语言回答，不落盘）。**Slice G.1**：对话支持**联网检索**（模型请求 `searchQueries` ≤2 → 复用 N9 三引擎链 Sogou→360→Bing + 相关性过滤 + 首条页摘录 → 回喂同会话；响应含 `searched`）+ **自由回答**；新增 `POST /api/ai/chat/note`（对话回答 → 独立笔记，`note.create` · via:'chat.note'，可撤销）；对话仍不落盘。

v0.5 增补（Slice Y，见 ADR-0021）：**一致性清扫**。新增通用资料创建 `POST /api/resources`（`resourceCreateSchema`：`title` 必填；`kind`/`status` 缺省 `article`/`unread`；可选 `url`/`path`/`note`/`areaId`/`tags`；`areaId` 真实存在校验；标签规格化 + 登记 `origin:'manual'`；审计 `resource.create`；201），供资料页「新建资料」草稿确认流（创建可撤销 = 回收站 + 打开 `?resource=` 深链）。AI 收件箱 / 任务补全提示词的**情境列表改由标签注册表派生**（`contextNamesOf`；此前硬编码 5 个，遗漏 `@errands`/`@home`）。各 AI / 创建 / 澄清 schema 的 `importance` 统一放宽为 **0–3**（与 `taskSchema` / `docs/04` 对齐；存量 `t-0057`/`t-0058` 含 0）。无新增依赖。

v0.5 增补（Slice H，见 ADR-0011）：任务快速新建 AI 补全 `POST /api/ai/task/draft { title }`（标题非空 400 / 有界 ≤200 字；读快照摘要 + 指令式 JSON + Zod + 单次重试；返回 `{ suggestion, model, ms }`，**不落盘**，health 503 / 失败 502）；通用编辑白名单扩充（见 ADR-0009 路径）——`notes` 增 `areaId/projectId/distillLevel`、`resources` 增 `areaId`、`projects` 增 `goalId/nextActionId`，使「已显示」的状态 / 字段全部可设。

v0.5 增补（Slice O，见 ADR-0011 §6）：**先确认后写入**成为统一模式。`POST /api/tasks` 扩展——`title` 必填不变，接受可选白名单字段 `contexts/energy/importance/estimateMin/dueAt/projectId/areaId/tags`（`taskCreateFieldsSchema`，与澄清覆盖同口径），创建前校验 `projectId/areaId` 形状与存在性（臆造即 400），审计 `task.create` 的 `detail.fields`；仅传 `{title}` 的旧调用行为不变。前端任务快速新建改为**居中草稿确认弹窗**（打开即 `POST /api/ai/task/draft` 预填、全字段可编辑、点「创建任务」才经扩展后的 `POST /api/tasks` 落盘，确认前零写入）；收件箱 AI 建议卡亦增「编辑」，应用提交编辑值走既有 `clarify`（`details` + `ai:true`）。

v0.5 增补（Slice V，见 ADR-0008 §6）：**收件箱生命周期闭合 + 澄清字段矩阵**。文本捕捉成功后前端自动触发一次 AI 解析（复用既有 `POST /api/ai/inbox/:id/parse-stream`；先探活 `/api/ai/health`，离线静默跳过、绝不自动应用，手动入口保留）。复用既有端点补齐 UI 出口：删除 `POST /api/inbox/:id/remove`（未澄清 / 已丢弃；服务端一并清理附件，已澄清仍 409 保护）、恢复 / 撤回 `POST /api/inbox/:id/revert`（discarded → 仅重置 `unprocessed`；clarified → 删除 `linkedId` 产物后回退）；已澄清条目「查看产物」按 `linkedId` 前缀深链。服务端 `clarify` 扩展示意：note 分支接受 `projectId` / `areaId`（真实存在校验）、resource 分支的 `title` 对文件条目同样应用——UI 只渲染该 target 会应用的字段（`src/lib/aiForm.ts` `CLARIFY_FIELD_MATRIX`），无新端点。

v0.5 增补（Slice T，见 ADR-0014）：**标签完整生命周期**。标签名写入前经 `normalizeTagName()` 规格化（裸名 → `topic:` 前缀；`@` → context；空串丢弃）；任意携带 `tags` 的写入（任务创建 / 更新、澄清 `details.tags`、项目创建 / 更新、笔记创建 / 更新、资料更新）之后 `ensureTags()` 把未注册名登记进 `data/meta/tags.json`（新增可选字段 `origin: 'seed'|'manual'|'ai'` / `createdAt` / `firstUsedIn`，审计 `tag.create`；请求带 `ai:true` → origin `ai`）。新增标签管理端点：`POST /api/tags/:id/update { name?, label? }`（重命名，级联重写全部实体 tags，审计 `tag.rename` · `detail.from/to/affected`；同名冲突 409）、`POST /api/tags/:id/merge { targetId }`（合并，级联替换 + 去重、源移除，审计 `tag.merge`）、`POST /api/tags/:id/remove`（`usage>0` → 409 阻止并给出计数；`usage==0` → 移除注册项，审计 `tag.remove`）、`POST /api/tags/backfill`（扫描 `tasks/projects/notes/resources/events` 上未注册的标签名并登记，审计逐条 `tag.create` + `tag.backfill`）。级联只改 `tags` 数组、**不 bump `updatedAt`**（避免污染停滞项目 / 回顾口径）；写入沿单写者串行队列 + 原子写 + 审计。

v0.5 增补（Slice R1，见 ADR-0015）：**AI 全链 · 多实体一揽子处置**。收件箱解析输出由单建议升级为**动作数组** `{ actions: [...] }`（`aiActionSchema`：`kind` = `task` / `note` / `resource` / `project` / `event`；≤6 个；Slice N10 起可产出 **event**（定点安排 → 日程，`startAt` 必填，见 ADR-0034）；`task`/`note` 可用 `linkToNewProject` 挂到本批次新建项目；`project` 动作带 `outcome`）；旧式单建议形状仍被接受并**归一化为动作数组**（`newProjectHint` → 项目动作 + 实体 `linkToNewProject`），同步 / 流式两条路径共用。新增批量端点 `POST /api/inbox/:id/apply { actions }`——一次写入：先建新项目（至多 1 个），再逐条建实体（自动挂接），标签 `origin:'ai'` 登记，条目置 `clarified` 并记录 `linkedIds`（全部产物）与 `appliedTagIds`（本次新登记标签）；审计 `inbox.apply` + 各实体 `*.create`。撤销 `POST /api/inbox/:id/unapply`（等价于扩展后的 `revert`）：删除全部 `linkedIds` 产物 + `pruneTags(appliedTagIds)` 恢复注册表基线 → 条目回 `unprocessed`。项目快速新建 AI 补全 `POST /api/ai/project/draft { title }`（建议 `outcome` / `areaId` / `tags`，不落盘），`POST /api/projects` 扩展接受可选 `outcome` / `areaId` / `tags`（`areaId` 真实存在校验；仅传标题行为不变）。

v0.5 增补（Slice R2，见 ADR-0016）：**项目诞生 · 聚类立项 + AI 自动化档位**。新增 `POST /api/ai/cluster/draft`——扫描「无 `projectId` 的未完成任务（≤50）+ 未澄清收件箱」，用**确定性预分组**（共享标签 ≥3 / 标题关键词 ≥3）成组，AI 按**组号**命名并写 `outcome` / `reason`（成员 id 由服务端展开，模型无法编造），后校验（≥3 成员、须含任务、不得与现有项目同名、`areaId` 真实）后返回 0–3 条提案 `{ title, outcome?, reason, taskIds[], inboxIds[], areaId?, tags[] }`；AI 命名失败 / 未覆盖时以确定性名兜底。应用 `POST /api/projects/cluster-apply { title, outcome?, areaId?, tags?, taskIds[] }`——一次写入：建项目（`project.create` · `via:'cluster'`）+ 归入无归属任务（逐条 `task.update` · `via:'cluster'`）+ 标签 `origin:'ai'` 登记，项目上记 `clusterTaskIds` / `clusterTagIds`；撤销 `POST /api/projects/cluster-unapply { projectId }`——清任务 `projectId` + `pruneTags` + 项目入回收站，**精确复原**。收件箱条目无 `projectId` 结构，仅作命名参考，不被应用改写。配置端点 `POST /api/config { aiAutomation: 'confirm' | 'auto' }`（白名单 + `config.update` 审计），档位 `auto` 时前端在自动解析完成后自动 `apply` 本次动作（仅创建类，可撤销；见 ADR-0016 §2.3 能力边界）。

v0.5 增补（Slice W，见 ADR-0018）：**事件可写（日程）**——第五类可写 / 可回收实体。`eventSchema` / `ID_PATTERNS.events`（`e-`）+ `SCHEMAS.events`；`nextId` 增 `e` 前缀，`TRASH_KINDS` 增 `events`；`EDITABLE_KINDS` / `EDITABLE_FIELDS.events`（`title/startAt/endAt/allDay/location/status/projectId/areaId/tags/notes`；`repeatRule` 不开放）接入通用 `POST /api/events/:id/update` · `/trash` 与 `/api/trash/events/:id/(restore|purge)`。新增 `POST /api/events`（201）——`title` + `startAt` 必填；`endAt` 可选（缺省不写 = 单点；早于 `startAt` → 400）、`allDay` 缺省 `false`、`status` 缺省 `confirmed`、`projectId`/`areaId` 真实存在校验、标签规格化 + 登记；审计 `event.create`。新增 `POST /api/events/:id/remove`（审计 `event.remove`；与通用 `/trash` 同语义）。`updateEntity` 对 events 追加 `end < start` → 400 且不 bump `updatedAt`（事件无该字段）。前端日历新增「新建日程」确认弹窗（`EventDraftModal`，无 AI）、事件详情 `EventDetailModal`（编辑 / 删除 / 状态快捷切换 `已确认↔待定↔已取消`）、迷你月历日格可点（选中 + 滚动议程到该日）；`endAt` 可选，全部消费点以 `?? startAt` 兜底。

v0.5 增补（Slice X，见 ADR-0019）：**区域 / 目标 / 习惯可管理 + 打卡**——关闭最后三个只读结构。`areaSchema` / `goalSchema` / `habitSchema` + `SCHEMAS`；`ID_PATTERNS` 增 `goals`（`g-`）/`habits`（`h-`）；`nextId` 增 `a`/`g`/`h` 前缀，`TRASH_KINDS` 增三类。新增创建 `POST /api/areas` · `/api/goals` · `/api/habits`（201；`title` 必填，空 → 400；`areaId` 真实存在校验）与专属编辑 / 删除 `POST /api/<kind>/:id/update` · `POST /api/<kind>/:id/remove`；回收站 `POST /api/trash/<kind>/:id/(restore|purge)`（`TRASHABLE_KINDS` 扩展）。区域 / 目标删除带**引用护栏**——被引用（区域：任务/项目/笔记/资料/日程/目标/习惯的 `areaId`；目标：项目 `goalId` + 子目标 `parentGoalId`）→ **409** 并给可读计数；未引用才入回收站。三类均**无 `createdAt`/`updatedAt`**（编辑不 bump），审计 `area.*` / `goal.*` / `habit.*`。习惯打卡：`POST /api/habits/:id/checkin {date?}` / `uncheckin`（`date` 缺省今天；**幂等**；写 `{date, value:1}`；审计 `habit.checkin` / `habit.uncheckin`）。前端设置页新增「区域 / 目标 / 习惯」三管理区；总览「习惯打卡」条改为首个习惯标题 + quiet「今日打卡」切换（撤销）；关联 area/goal 芯片可点（深链 `/settings?section=…` 并自动打开编辑）。

v0.5 增补（Slice M，见 ADR-0020）：**笔记体验：沉浸阅读 / 撰写 + AI 蒸馏**。前端——笔记详情改用加宽弹窗变体 `.k-modal--note`（≤820px），正文包入 `.k-note-read`（68ch / 行高 1.8 / 标题分层），元数据收进安静 `.k-note__meta` 条、蒸馏 / 关联收进 `.k-note__secondary`；编辑态字段顺序改为标题 + 正文（`rows=18`）优先（`EntityEditForm` 增可选 `rows`）；资料页新增「新建笔记」→ `NoteComposeModal`（标题 + Markdown 正文）经既有 `POST /api/notes` 落盘（创建 toast 可撤销 = 移入回收站）并打开 `?note=`。蒸馏语义显式化（`format.ts` `DISTILL_HELP`：点选仅标注层级、不自动改写）。服务端新增 **`POST /api/ai/note/distill { id, targetLevel? }`**——`noteDistillRequestSchema`（`id` 必 `/^n-\d{4}$/`、`targetLevel` 1–3 可选）；缺省目标 = 当前 `distillLevel + 1` 并 clamp 1–3（封顶 L3）；`draftNoteDistill` 注入笔记标题 / 类型 / 正文（≤6000 字）+ 分层指令（L1 划线 / L2 摘要 / L3 永久笔记；≤300 字、保守、保留关键事实），指令式 JSON + `noteDistillSchema` + 单次重试；返回 `{ text, targetLevel, model, ms }`，**绝不落盘**（health 503 / 失败 502 / 无审计）。应用经既有 `POST /api/notes/:id/update` 一次写 `{ body, distillLevel }`——正文**追加** `## 蒸馏 → Lx` 小节（不替换、原文不丢）；撤销客户端记录原 body + 层级往返精确还原。

v0.5 增补（Slice N0，见 ADR-0023）：**公告解析（通知三性 + 条件选择 + 截图接入）**。收件箱解析响应新增顶层 `facts: string[]`（硬事实要点：放假 / 调课 / 截止日期等，≤8 条、每条 ≤140 字、须含日期或关键数字；`cleanFacts` trim / 去空 / 截断 / 去重 / 封顶；**为解析临时产物、不落盘**，UI 以「要点」块呈现并可一键「存为要点笔记」）；义务仍经 `kind:'task'` 动作承载，可带可选 **`condition`**（适用前提 ≤30 字，如「仅出国（境）者」；对所有人生效则省略）——`aiActionSchema.condition` + `postValidateActions`（null / 非 task / 空串清理）保证只随 `task` 动作存活，前端带条件的动作**默认不勾选**（勾选 = 相关 / 要做，无条件维持默认勾选），应用经 `formToAction` 透传。**截图接入**：`isImageFile()`（扩展名或 `image/*`）命中即走图片路径，`buildFileSection` 返回「见附图」，解析构造 opencode file part（`data:<mime>;base64,…`，读失败优雅降级），图片**跳过**「文件 = 恰 1 条 resource + 简介」硬归一化（非图片行为不变），默认模型 `deepseek/deepseek-flash` 已实测可读图（无需 OCR / 换模型）。`inbox.apply` 审计增 `detail.signals.conditions`（已应用动作非空条件去重、首见顺序）为后续画像留痕；画像本身、提醒独立桶 / 调休例外、课表实体为后续切片；确认制不变。无新增依赖。

v0.5 增补（Slice H0，见 ADR-0024）：**课表（固定日程）**——课表与任务区分，成为独立实体。新增可写 / 可回收实体 `course`（`c-`）：`courseSessionSchema` / `courseSchema` / `courseCreateSchema` + `SCHEMAS.courses` + `ID_PATTERNS.courses`（`c-`）+ `normalizeCourseSessions`（周次排序去重 / 空删键 / `end ≥ start` / 空 sessions → 400）；`EDITABLE_KINDS` / `EDITABLE_FIELDS.courses`（`title/teacher/location/sessions/notes`）接入通用 `POST /api/courses/:id/update` · `/api/courses/:id/remove` 与 `POST /api/trash/courses/:id/(restore|purge)`；新增 `POST /api/courses`（201，`title` 必填、`sessions` 1..16；审计 `course.create/update/remove/restore/purge`）。学期元数据 `data/meta/term.json`（`startDate` = 第 1 周周一 / `totalWeeks` 1..30；文件缺失 = 未设置，前端不按周过滤）经 `POST /api/term` 更新（白名单 + 审计 `term.update`）。前端日历页新增「议程 / 课表」模式 segmented（模块级 `kernel.ui.calendar.v1` 持久化，见 ADR-0022）；课表模式为全宽 `ClassGrid`（7 列 × 节次行、跨行时段、今日列信号）+「第 N 周」`‹ 本周 ›` + 设置学期 + 今天行；手动录入 `CourseForm`（周次文本 `1-16 / 1-16单 / 1-8,10-16`，留空 = 每周；纯函数 `src/lib/schedule.ts`）+ 先确认后写入的 `CourseDraftModal` / `CourseDetailModal`（编辑 / 删除可撤销）/ `TermModal`；回收站增「课程」分组。AI 导入、调休例外、节次 → 时间映射为后续切片；无新增依赖。

v0.5 增补（Slice H1，见 ADR-0025）：**课表导入：来源 → 课程草稿 → 勾选确认**。两个端点、确认前零写入——`POST /api/ai/timetable/draft { id }` 对收件箱**未澄清**条目跑课表解析，返回 `{ courses: CourseCreateInput[], model, ms }`（`buildTimetableSystem` + `tryParseTimetable` + 单次重试；**不落盘、无审计**；400 不可直读附件 / 404 / 409 非未澄清 / 502 / 503，守卫与收件箱 AI 解析一致）；`POST /api/courses/import { courses }`（1–30 门）先全量 `coursesImportSchema` + `normalizeCourseSessions` 校验规格化、**零落盘**，全部通过后逐条 `commit`（审计 `course.create` · `detail.via:'timetable-import'`；201 `{ created }`），任一非法整批 400 不留半成品。读取侧新增 `extractXlsxGrid`（`sharedStrings` / `inlineStr` / 数字 + 列字母对齐补空列 + 跳空行；`extractOfficeText` 的 xlsx 分支改用它，docx / pptx 不变），`.csv` 在文本白名单；旧版 `.xls` 走 `extractLegacyXlsText` **三分支**（真 OLE2 二进制 → `extractLegacyXlsGrid` 直读（零依赖 OLE2/CFBF + BIFF8 最小解析，SST 续段 / LABELSST / NUMBER / RK / MULRK / MERGEDCELLS → 列对齐网格 + 合并传播；损坏 / 加密 / 非 BIFF8 才回退指引；H1.5 修订）；HTML / XML 表格 → `htmlTableToText` 摘录；纯中文文本 → 原文摘录）；截图复用 N0 file part、粘贴文本同管线。`cleanTimetableCourses` 确定性清洗（`end < start` 交换 / 非法时段丢弃 / `weeks` 去重升序 / 空课程丢弃 / trim 截断）。前端收件箱展开条目新增「导入为课表」pill（同条目显「课表解析中…」），运行态由模块级 `src/lib/timetableAi.ts` 持有（`itemId/busy/courses/error` + token 守卫，不落 localStorage）；结果以 `TimetableDraftCard` 呈现（逐行勾选默认全选 + 时段明细 + 「导入 N 门课程」/「忽略」），导入后 toast「已导入 N 门课程 · 撤销」（撤销 = 逐条移入回收站）。课表解析另有流式变体 `POST /api/ai/timetable/draft-stream`（SSE：status / delta / retry / suggestion / error，前端显示阶段与输出预览；H1.6 修订）；多工作表 / 跨页截图、课表与学期自动对齐为后续切片；回顾页新增「动作记录」时间线（Slice S，见 ADR-0026）：只读消费 `GET /api/activity`（审计自描述 title / status），无新增端点与写入面；收件箱侧（H1.7 / N0.5 / N0.6 / H1.8）：文件名含课表关键词的文件到达即自动路由课表解析、要点笔记三态反馈与「忽略」真消失（全站按钮反馈审计）、课表网格与今天行将同课同日相邻节次合并显示（`mergeDayRuns`）；无新增依赖。

v0.5 增补（Slice N2，见 ADR-0027）：**链接阅读（首次出站抓取）+ 粘贴截图**。收件箱**文本条目**（无附件）内容含 http(s) 链接时，解析前在服务端抓**首个**链接的网页正文，注入解析上下文，让 AI 基于实际内容给资料写简介并填 `url`——链路 `extractFirstUrl`（保守正则，仅 http(s)、只取首个）→ `fetchLinkExcerpt` → `buildLinkSection`。**出站抓取安全纪律**：私网 / 环回 / 链路本地 hostname（`localhost` / `::1` / `0.0.0.0` / `127.*` / `10.*` / `172.16-31.*` / `192.168.*` / `169.254.*`）**直接拒绝且不发请求**（SSRF 防护）；`AbortController` 8s 超时；`redirect:'follow'`；常规桌面 UA + `Accept-Language: zh-CN`；仅 `text/html` / `application/xhtml+xml` / `text/plain`；**流式读取上限 2MB**（超限截断并 cancel）；charset 探测（content-type → `<meta charset>` → 默认 utf8，`gb2312`/`gb18030` 归一 `gbk`，utf8 乱码回退 gbk）；`htmlToArticleText` 抽正文 ≤8000 字并抽 `<title>`；任何失败 → `null` **绝不抛出**。**注入与回退**：成功注入 `【链接摘录】（url）`（标题 + 正文），失败注入 `【链接】url（自动抓取未成功——按链接保守处理）`，**不阻断解析**；同步 / 流式共用。提示词增「resource 的 `url` 字段」与「有摘录时 `note` 必须基于摘录实际内容，禁止『未能读取』式话术」。**url 端到端**：`aiActionSchema.url`（≤2000，nullable）→ `postValidateActions` 清洗（仅 resource、须 `http(s)`、≤2000）→ `applyLinkUrlFallback` 确定性兜底 → `POST /api/inbox/:id/apply` 的 resource 分支持久化 `record.url`；前端建议卡 resource 增「链接」输入（`ACTION_FIELD_MATRIX.resource` + `AiSuggestionForm` `type=url`），`formToAction` 空串删除。**粘贴截图（N2.5）**：收件箱页 window 级 `paste` 监听（仅挂载期存活）——剪贴板含图片时 `preventDefault()` 并按 `粘贴截图-YYYYMMDD-HHmmss.<ext>` 命名入待上传队列（与拖拽同通路 `addFiles`），**纯文本不拦截**。抓取**只在解析文本条目时**发生、仅限时限体积、私网拒抓，**不改变单写者 / 审计边界**（抓取本身不落盘、无审计）；仅抓首个链接、不做 JS 渲染 / 登录态 / 多页爬取；DNS 解析后地址不做二次校验（个人本地工具，literal 级防护）；未新增依赖与端点。

v0.5 增补（Slice N3，见 ADR-0028）：**收件箱并行解析**。解析运行态由「全局单令牌 + 单面板」改为**每条目独立 job** 的模块级调度器（`src/lib/inboxAi.ts`，快照 `jobs: ReadonlyMap<itemId, InboxAiJob>`）——每条目独立 `phase / stage / 流式 text 与 reasoning / result / error`，**每条目令牌**（新解析只令同一 id 的在途结果失去回填资格，其它条目互不影响），增量缓冲按条目分桶 + 单一共享 ~100ms 节流计时器。**FIFO 队列 + 并发上限 `AI_PARSE_CONCURRENCY = 3`**（`pump()` 完成自动进位；启动前后双重校验条目存在未澄清 + 令牌仍当前，sentinel `GONE` / `SUPERSEDED` 批量不计失败）。批量 `startBatchAi` 经同一调度器并行、`done/total` 完成驱动、失败续跑、一次播报，批量期间手动单条共享队列不影响计数；多文件投递的**通用**条目 `Promise.all` 并行（课表类仍顺序，草稿 store 单例）。`clearInboxAiActive` → 按条 `clearInboxAiJob(itemId)`；N0.9 语义保留（唯一作废意图 = 显式「忽略」，收起 / 切页 / 被接管不丢结果，job 移除后绝不复活）；面板按 `jobs.get(item.id)` 派生、行尾「解析中…」与「AI 建议就绪」按条。**服务端零改动**：专项审计确认天然并行就绪——每请求新建独立 opencode session（无复用 / 无单活动会话）、无全局锁 / 单飞 / inflight / 信号量、唯一串行是 `store.writeChain`（只约束解析后落盘）、无共享 `AbortController`（每条 prompt 独立 120s 超时）、SSE 断连仅置标志位不影响其它条目。边界：同 id 快速重解析新旧流短暂并存（无 AbortController 的取舍，旧流回调被令牌忽略、无污染）；超时 / 断连不 abort 底层生成（上游空转，接 `session.abort` 延后）；并发上限 3 为常量不做设置项。无新增依赖与端点。


v0.5 增补（Slice N8，见 ADR-0032）：**项目「AI 整理」+ 每日调度**。新增 `POST /api/ai/organize/draft`（无 body，**只读不落盘 / 无审计**）——候选 = 无 `projectId` 未完成任务 + 未澄清收件箱（≤50）；先做**确定性预分组**提示，再由 AI **两阶段按候选编号引用**出提案（成员 id 由服务端展开，模型无法编造 id），后校验（归并 ≤5 条 / 每条 ≤10 任务；新项目簇 ≤3 个、≥3 成员、须含任务、标题不得与现有项目冲突、`areaId` 真实存在、标签优先复用），未被 AI 覆盖的预分组以**确定性兜底簇**补齐；返回 `{ assignments, clusters, model, ms, candidates }`（opencode 离线 503 / 失败 502）。新增 `POST /api/projects/organize-apply`（201）——服务端重校验（`organizeApplySchema` + 真实存在 / 状态 / 打开态）；归并**只写任务文件**（目标项目文件字节不动），逐簇建项目并归入，**单簇失败不中止整批**，审计 `via:'organize'`；空有效项 → 400「没有可应用的整理项」。撤销 `POST /api/projects/organize-unapply`——项目经 `clusterTaskIds` 入回收站 + 任务 `projectId` 清空（`pruneTags` 恢复注册表），审计 `organize-unapply`，**精确复原**。前端 `src/lib/organize.ts`（模块 store `kernel.ui.organize.v1`：提案 / 上次运行日 / 在途态跨刷新保留；`runOrganizeNow` 手动；`useOrganizeScheduler` 每日调度；跨标签锁 `kernel.ui.organize.lock.v1` TTL 120s + 会话守卫；**只调草稿端点、绝不自动应用**）+ `OrganizeProposalCard`（两段「归并到已有项目」/「建议新项目」、逐行勾选默认全选、页脚「全部应用（K 项）」/「重新整理」/「忽略」）+ `Projects` 工具条（「AI 整理」/「整理中…」）+ `AppLayout` 挂载调度器（**中午 12:00 后**每日一次、30s tick + focus / visibility 补跑、过午打开应用即补跑、AI 离线静默跳过；应用仍需用户在建议卡显式确认）。无 schema 变更、无新增依赖。（N8.1 修订：分类标准三分类 + 限额放宽至 8/5、≥2 成员成簇、单条多步事务可单独立项（须 outcome + reason）；响应增 unplanned；见 ADR-0032 §7。）

v0.5 增补（Slice N9 / N9.1，见 ADR-0033）：**收件箱 AI 联网检索**。收件箱解析支持**模型请求式两阶段检索**——首轮输出新增顶层 `searchQueries`（≤2 条、每条 ≤60 字，模型主动请求），服务端先检索（**Sogou 主 → 360 次 → Bing 备**；每引擎结果过**相关性令牌过滤**：CJK 二元组去通用词 + 拉丁词，泛化 / 限流结果视为该引擎失败并换下一引擎；每条成功问题**补抓首条结果页正文摘录** ≤900 字，复用 ADR-0027 `fetchLinkExcerpt`），再把【联网检索】结果**回喂同一会话**做第二轮以补全 `dueAt` / `facts`（第二轮失败沿用首轮）；响应新增 `searched`（实际执行问题）；流式路径先发 `{kind:'status',status:'searching'}`，前端阶段文案「正在联网检索…」。注入段落「【联网检索】（…只可据此修正时间与事实，不得编造）」；固定引擎主机、12s 超时、≤5 结果 / 问、snippet ≤300 字、段落 ≤2600 字；**不落盘、无审计**、失败静默降级、**绝不编造日期**；仅文本 / 截图条目触发（文件 = 资料归一化路径不触发），限流时保守失败，不抓多页 / 不做 JS 渲染。无新增依赖、无数据模型变化。

v0.5 增补（Slice N10，见 ADR-0034）：**收件箱 AI 事件识别**。AI 动作新增**第 5 类 `kind:'event'`（日程 / 事件）**——会在某个时刻「发生」的事（面试 / 会议 / 考试 / 约谈 / 活动）产 `event`（`startAt` ISO8601 带时区必填、明确结束时间才填 `endAt`、只有日期 → `allDay:true`、`location` ≤60），「需要去做」动作仍产 `task`，同一内容可同时产出 event + task（发生的事 + 要做的准备）不重复拆条；提示词**规则 12** 判定，**时间无法明确推出就不产 event**（宁可 task + facts）。管线：`aiActionKind` + `'event'`、`aiActionSchema` + `startAt/endAt/allDay/location`、`postValidateActions` 清洗（`startAt` 无效 / 缺失丢弃该动作、`endAt` ≥ startAt 否则删除、`allDay` 仅 true 保留、非 event 动作剥离这些字段、`linkToNewProject` 放行）；apply event 分支落 `events`（对齐 `POST /api/events`：**无 `createdAt`/`updatedAt`**、`status:'confirmed'`、纵深校验、`projectId`/`areaId` 挂接、`via:'inbox.apply'`），撤销走通用 `linkedIds` → `remove('events')`（**顺带修复 `kindOfId` 缺 `e-` 映射**）。文件条目（非图片）仍只产 resource（禁止列表加 `event`），截图条目走文本管线可用；`condition` / `contexts` 不适用 event，`repeatRule` 延后；无 schema 迁移、无新依赖、无新端点。

v0.5 增补（Slice G.1，见 ADR-0010 修订）：**总览 AI 对话升级**。助手回复改 `react-markdown` 渲染（无 `dangerouslySetInnerHTML`）+ token-only 尺寸放宽；`buildChatSystem` 三类（读库事实 / 一般知识自由回答 / 需外部事实时只输出 `searchQueries` ≤2）→ `chatWithKernel` 两阶段复用 N9 `buildSearchSection`（Sogou→360→Bing + 相关性过滤 + 首条页摘录）回喂同会话，响应新增 `searched`，检索失败保守注明；新增 `POST /api/ai/chat/note`（`draftChatNote`：AI 出标题 + 正文，失败确定性回退；`note.create` · `via:'chat.note'`，可撤销）；对话仍**不落盘无审计**；无 schema 迁移、无新依赖；证据 `.qa/v72/`（50 PASS · 0 FAIL）。

v0.5 增补（QA v73 批次，见 ADR-0035 / ADR-0036）：**总览 AI 查阅与代改 + 解析默认时间/地点 + 长图分片 + 体验修复**。总览 AI 对话新增**实体查阅**（模型输出 `entityQueries` → `resolveEntities` 回喂完整记录，响应增 `focused`）与**修改提案**（响应增 `edits`：kind/id/fields 白名单校验，前端「修改卡」逐字段 旧值 → 新值，点「应用」才经既有 `POST /api/<kind>/:id/update` 写入、可撤销——**确认前零写入**）；收件箱 / 事件解析新增**默认钟点补全**（早/上午/中午/下午/傍晚/晚上 + 用餐语境，系统认可不算编造）与**地点提取**；新增**长图分片**链路（客户端 `imagePreview.ts` 把 >400KB 大图切 ≤6 张 JPEG → `POST /api/inbox/:id/ai-preview?index=1..6` RAW 落派生分片 → 解析多发 file part、图片解析超时放宽 180s）；体验修复：工作台今日未结束日程就地显示 + 点击弹详情、日历「含已结束」开关、收件箱「文字 + 附件」行；证据 `.qa/v73/` + 探针 `.qa/probe-longimg/`。

v0.5 增补（桌面启动器 v2，见 ADR-0037）：**原生 WPF 启动器**。旧 `启动器.hta`（mshta / IE 套壳：白色系统标题栏 + 方角窗口 + mshta 图标）替换为原生窗口链：`启动器.vbs`（纯 ASCII 入口，`wscript` 隐藏拉起，零黑窗）→ `启动器.ps1`（PowerShell 5.1 + .NET Framework WPF，Win10 / 11 内置、零安装；无边框圆角卡片 + 自绘标题栏 + 品牌 K + `kernel.ico`）。行为与旧启动器一致（探活 `127.0.0.1:5173` 每 800ms、启动 / 停止 dev 栈、就绪自动开浏览器、创建桌面快捷方式、日志按钮打开 `启动.cmd`），并新增单实例互斥锁与测试钩子（`KERNEL_LAUNCHER_SELFTEST` 写 `%TEMP%\kernel-launcher-selftest.txt`、`KERNEL_LAUNCHER_SMOKE_MS` 自动关窗、`KERNEL_LAUNCHER_PROBE_URL` 覆盖探活地址）。`kernel.ico` 由 `scripts/make-icon.ps1`（System.Drawing）从 `public/favicon.svg` 的 K 笔画几何生成；桌面快捷方式 `KERNEL 启动器.lnk` 改为目标 `wscript.exe` + `启动器.vbs`、图标 `kernel.ico`。打包同步：打包器白名单收录 `启动器.ps1` / `启动器.vbs` / `kernel.ico`（不再收录 HTA）。控制台入口 `启动.cmd` 不变，仍是显示运行日志的替代路径。

派生值纪律在数据服务阶段依然适用：进度、计数、聚合必须运行时计算，不落盘。

## 4. opencode 集成计划（v0.5）

### 4.1 事实基础（已调研）

- opencode 项目组织已迁移至 **`anomalyco/opencode`**。
- `opencode serve` 以 **`--port 4096`** 显式启动（v1.18 默认端口为 0/随机）；仅监听 `127.0.0.1`。
- OpenAPI 文档位于 `/doc`。
- SDK：`@opencode-ai/sdk`（v2 客户端、扁平调用），使用 `createOpencodeClient`；会话 API 含 `session.create` / `prompt` / `promptAsync`。
- 事件流：`event.subscribe` 为 SSE。
- 结构化输出：`format: json_schema`（仅 v2 类型暴露；thinking 模式模型可能拒绝强制 tool_choice——v0.5 首个切片改用「指令式 JSON + Zod 校验」，见 ADR-0005）。
- 鉴权：`OPENCODE_SERVER_PASSWORD`。

### 4.2 目标链路

```text
网页 → 本地 Node 服务（单写者、代理）→ opencode serve（仅 localhost）→ 结果写回 data/ ，进度经 SSE 推回网页
```

- opencode 只被本地 Node 服务访问，前端不直连 opencode。
- Node 服务扮演代理与守门人：拼装 prompt、校验结构化输出、写回数据。
- 进度与流式结果经 SSE 推送到网页。

### 4.3 安全纪律

- **opencode 永不直接暴露到局域网**，仅监听 `127.0.0.1`。
- 敏感操作需显式确认。
- AI 已接入（v0.5：收件箱「AI 解析」→ 升级切片：上下文注入 + 挂接建议 + SSE 过程可视，见 ADR-0005 / ADR-0006）；状态条 / 设置页显示 AI 在线状态；命令面板 AI 入口留待后续。
- AI 端点清单（均经本地 Node 服务代理，前端不直连 opencode）：`POST /api/ai/inbox/:id/parse`（同步）+ `…/parse-stream`（SSE 过程可视）；`POST /api/ai/review/draft`（周 / 月回顾草稿：七段结构正文 + 环比 + 数字落地护栏；Slice L 起**生成即自动归档**一条 `review`，审计 `review.create` · `auto`，响应附 `reviewId`，见 ADR-0013）；`POST /api/ai/chat`（Slice G · 总览 AI 对话：读库摘要 + 有界历史，自然语言回答，**不落盘**，见 ADR-0010）；`POST /api/ai/task/draft`（Slice H · 任务快速新建补全：只填标题 → 建议 `contexts/energy/importance/estimateMin/dueAt/projectId/areaId/tags`，**不落盘**；Slice O 改为**先确认后写入**——弹窗内编辑后经扩展的 `POST /api/tasks` 一次性创建，见 ADR-0011 §6）。Slice T（见 ADR-0014）起，收件箱解析与任务补全**可提议新标签**（优先已有注册名，仅在确无合适标签时提议 `topic:名称` ≤12 字、≤3 个），`postValidate` 规格化保留（不再过滤注册表外名），标签在应用 / 创建落盘时才登记（`origin:'ai'`）。配套通用创建 `POST /api/notes`（「清空对话」归档为 `type:'memo'` 笔记，审计 `note.create`）。Slice R1（见 ADR-0015）：`POST /api/ai/inbox/:id/parse` / `…/parse-stream` 返回**动作数组** `actions`（兼容旧单建议形状），并新增 `POST /api/ai/project/draft`（项目快速新建补全，不落盘）；应用 / 撤销走 `POST /api/inbox/:id/apply` / `…/unapply`。Slice R2（见 ADR-0016）：新增 `POST /api/ai/cluster/draft`（连续累积相似任务 → 0–3 个新项目提案，只读不落盘）与写入端点 `POST /api/projects/cluster-apply` / `…/cluster-unapply`（一次建项 + 归入 / 精确撤销）；配置 `POST /api/config { aiAutomation }`（默认 `confirm`；`auto` 时前端自动应用低风险动作）。Slice M（见 ADR-0020）：新增 `POST /api/ai/note/distill { id, targetLevel? }`（把笔记压缩到目标层级：缺省 = 当前 `distillLevel + 1`，clamp 1–3 封顶 L3；返回 `{ text, targetLevel, model, ms }`，**不落盘**、无审计）；应用经既有 `POST /api/notes/:id/update` 一次写 `{ body（追加 `## 蒸馏 → Lx` 小节）, distillLevel }`，撤销往返精确还原。Slice N8（见 ADR-0032）：新增 `POST /api/ai/organize/draft`（项目「AI 整理」：无归属任务 + 未澄清收件箱 → 归并已有项目 / 新项目两段提案，只读不落盘）与写入端点 `POST /api/projects/organize-apply` / `…/organize-unapply`（一次归并 / 建项 + 精确撤销；归并只写任务文件）；前端 `useOrganizeScheduler` 中午 12:00 后每日一次、只出草案绝不自动应用。Slice N9（见 ADR-0033）：收件箱解析支持**模型请求式联网检索**（顶层 `searchQueries` ≤2）——服务端经 Sogou→360→Bing 链检索（**相关性过滤 + 首条结果页摘录**）后**回喂同会话**补全时间与事实；响应含 `searched`；不落盘、失败保守。QA v73（见 ADR-0035 / ADR-0036）：`POST /api/ai/chat` 响应增 `focused`（已查阅实体 ≤6）与 `edits`（修改提案：kind/id/fields 白名单校验后下发；**只读建议，应用经既有 `POST /api/<kind>/:id/update`**）；新增 `POST /api/inbox/:id/ai-preview?index=1..6`（长图分片 RAW 上传 → `data/files/<id>-ai-<n>.jpg`，派生辅助资源、**无审计**、随条目删除清理）。
- 回顾写入路径：`POST /api/reviews`（手工保存 / 回退创建）、`POST /api/reviews/:id/update`（Slice L · 编辑归档报告，白名单 `summary` / `decisions`，审计 `review.update`）、`POST /api/reviews/:id/remove`（审计 `review.remove`）。
- 本地服务与 opencode 之间使用 `OPENCODE_SERVER_PASSWORD` 保护（本机场景下的纵深防御）。

## 5. 托管拓扑（局域网）

- 开发：`npm run dev -- --host`（v0.4 起同一命令拉起数据服务 + Vite）。
- 生产预览：`npm run build && npm run preview -- --host`。
- 手机同 WiFi 访问：`http://<局域网IP>:5173`（dev）或 `http://<局域网IP>:4173`（preview）。
- 数据服务仅监听 `127.0.0.1:4097`，由上述启动器一并拉起；浏览器与手机均经 Vite 的 `/api` 代理写入，数据服务本身不暴露到局域网。
- `vite.config` 中设置 `server.host: true` 与 `preview.host: true`，以便开箱即用。
- 安全含义：这会让 Vite 监听所有网卡，同一局域网的任何设备都能访问（含写入 API）。仅应在可信 WiFi 下使用，使用后关闭。
- Windows 防火墙需放行 Node（专用网络）。
- 纯 HTTP 局域网 IP 不是安全上下文（无 PWA、摄像头等能力），本项目不需要这些能力，因此可接受。
- WSL 需端口转发；本项目直接跑 Windows 侧，规避该问题。

**Windows 分发**：桌面用户可经安装包（`installer/KERNEL.iss`，由 `scripts/build-installer.mjs` 调用仓库内置 Inno Setup 编译器构建，无需系统安装）一键安装——向导可选安装目录（如 `D:\KERNEL`），开始菜单与可选桌面快捷方式启动；安装包内置运行时，目标机无需另装 Node.js。数据位于**安装目录下的 `data\`**（`<安装目录>\data`，与程序同目录），安装时植入空白骨架并标记 `uninsneveruninstall`，**卸载后用户数据保留**。

详见 `07-DEPLOYMENT.md`。

## 6. 目录职责

| 目录 | 职责 |
|---|---|
| `docs/` | 文档：宪法、架构、设计、数据模型、ADR |
| `data/` | 数据源：一记录一文件 JSON 数据库 + `activity.jsonl` 审计 |
| `server/` | 数据服务：唯一写入路径（校验 / 原子写 / 审计；仅 127.0.0.1:4097） |
| `src/` | 前端：React + TypeScript 应用 |
| `scripts/` | 脚本：开发启动器（`dev.mjs`）、Windows 安装包构建（`build-installer.mjs`）、种子数据生成（`seed.mjs`） |
| `installer/` | Windows 安装包脚本（`KERNEL.iss`）与启动页（`welcome.html`） |
| `public/` | 静态资源：字体、图标等 |

完整目录树见 `05-FILE-TREE.md`。目录结构变化必须同步更新该文件。

## 7. 与宪法的一致性

- 依赖白名单、路由、数据规范、opencode 事实、托管方式均以宪法 §6 为准，本文件不引入白名单外的前端依赖；服务端依赖（zod / write-file-atomic）经 ADR-0004 记录。
- v0.4 数据服务已实现（ADR-0004）；v0.5 及其后内容仍是规划，实现时若需偏离，应开新 ADR。
