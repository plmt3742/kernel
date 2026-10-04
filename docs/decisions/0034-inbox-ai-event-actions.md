# ADR-0034 · 收件箱 AI 事件识别（Slice N10）

- 状态：已采纳
- 日期：2026-10-03
- 相关：ADR-0015（AI 全链 · 多实体一揽子处置）、ADR-0018（事件可写 / 可回收）、ADR-0023（公告解析 · 通知三性）、ADR-0032（项目「AI 整理」）、ADR-0033（收件箱 AI 联网检索）

---

## 1. 背景与反馈

所有者：

> 「但是类似于学生组织第二轮面试、例会、考试、约谈，我丢进了收信箱，并没有给我划分为事件，而是任务。」

此前收件箱 AI 动作只有 `task` / `note` / `resource` / `project` 四类（Slice R1，ADR-0015）。「会在某个时刻发生」的定点安排（面试 / 会议 / 考试 / 约谈 / 活动）没有对应动作，被一律压成 `task`，丢失了「时间 + 地点」这一事件语义，也无法进入日历。系统已有可写事件实体（Slice W，ADR-0018）与事件创建端点 `POST /api/events`，缺的是解析侧的第五类动作与端到端写入 / 撤销。

本 ADR 定义 Slice N10 的决策：新增 **`kind:"event"`（日程 / 事件）** 动作、判定标准、字段契约、管线清洗与 apply / undo 路径。

## 2. 决策

### 2.1 第 5 类动作与判定标准

提示词 `buildSystem` 新增**规则 12**：

- 会在某个时刻「发生」的事（面试 / 会议 / 考试 / 约谈 / 活动）→ `event`。
- 「需要去做」的动作 → `task`；同一内容**可同时产出 event + task**（发生的事 + 要做的准备），不重复拆条。
- `startAt` 为 ISO8601 带时区、**必填**；只有明确结束时间才填 `endAt`；**只有日期** → `allDay:true`（`startAt` 填当天 00:00）。
- **时间无法明确推出就不产 event**（宁可 `task` + `facts`），绝不编造时间。
- 文件条目（非图片）仍只产 `resource`（禁止列表加 `event`）；截图条目走文本管线，可用 `event`。

### 2.2 字段契约与管线清洗

- `aiActionKind` 增 `'event'`；`aiActionSchema` 增 `startAt` / `endAt` / `allDay` / `location`（union / nullable）。
- `postValidateActions` event 清洗：`startAt` 无效 / 缺失 → **丢弃该动作**；`endAt` 须 ≥ `startAt` 否则删除；`allDay` 仅 `true` 保留；`location` trim ≤60；**非 event 动作一律剥离这些字段**（防串味）；`linkToNewProject` 放行 event。

### 2.3 apply 与撤销

- `applyInboxActions` 增 event 分支，落 `data/events/`——对齐 `POST /api/events`：**无 `createdAt` / `updatedAt`**、`status:'confirmed'`、纵深校验 `startAt` / `endAt` / `location`、`projectId` / `areaId` 挂接、审计 `via:'inbox.apply'`。
- 撤销走通用 `linkedIds` → `remove('events')`，**顺带修复 `kindOfId` 缺 `e-` 映射**（此前事件无法经该链路清理）；条目回 `unprocessed`。

### 2.4 前端

- `AiActionKind` 增 `'event'`；`ACTION_FIELD_MATRIX.event` = 标题 / 开始 / 结束 / 地点 / 项目 / 区域 / 标签。
- `AiSuggestionForm` 渲染 开始 / 结束（`datetime-local`）+ 地点（`text`）；`AiActionsCard` `KIND_LABEL.event = '日程'`。
- **先确认后写入**不变：动作默认勾选、可编辑，点「应用」才落盘，写后可撤销。

## 3. 边界

- **文件条目例外**：非图片文件仍走「文件 = 资料」归一化路径，只产 `resource`；`event` 加入其禁止列表。
- **时间不明保守**：无法明确推出 `startAt` 时不产 `event`，降级为 `task`（必要时附 `facts`），绝不编造。
- **`condition` / `contexts` 不适用**：event 不承载条件任务与情境轴。
- **`repeatRule` 不做**：周期性重复事项仍用课表（`course`），event 只表达单次定点。
- 无 schema 迁移、无新依赖、无新端点（复用 `POST /api/inbox/:id/apply` / `unapply` 与既有 events 写路径）。

## 4. 验证与证据

QA `.qa/v71/`（证据 `.qa/v71/`）+ 探针 `.qa/probe-n10/`：

- **服务端冒烟 35 PASS**：含 6 组 `postValidateActions` 单测（startAt 无效丢弃 / endAt < startAt 删除 / allDay 仅 true / location trim ≤60 / 非 event 剥离字段 / linkToNewProject 放行）+ live parse（同步 / 流式）。
- **浏览器 24 PASS**：UI「日程」pill、可编辑字段（datetime-local + 地点）、apply → `e-0001`、unapply 归零、撤销往返、390 零横溢、console 0。
- **实测（真实 AI）**：投递「10月7号晚上7点到11点，在某教室进行学生组织第二轮面试」→ `event`「学生组织第二轮面试（我任面试官）」`startAt=2026-10-07T19:00:00+08:00` / `endAt=23:00` / `location=某教室` / `projectId=p-0002` + `task`「提前十分钟到场（学生组织面试）」due 18:50——**动作与发生正确分离**；apply → `e-0001`；unapply → 归零。
- **零残留**：45 个数据文件哈希基线 == 终态，`tags.json` 不变。
- **汇总**：**59 PASS · 0 FAIL**（35 + 24）。

## 5. 后果

- **正面**：定点安排（面试 / 会议 / 考试 / 约谈）不再被压成任务，直接进入日历；「发生的事」与「要做的准备」可同时产出，语义完整；撤销链路补齐 `e-` 映射，事件也能经 `linkedIds` 精确回退。
- **代价**：多一类动作需维护字段清洗与提示词规则；时间抽取依赖模型判断，模糊时间保守降级为任务。
- **约束**：不在解析阶段编造时间；`repeatRule` 与 `condition` 不纳入，重复事项仍交课表。
