# ADR-0018 · 事件可写（日程）

- 状态：已采纳
- 日期：2026-10-03
- 相关：ADR-0004（数据服务 · 单写者 / 校验 / 审计）、ADR-0009（详情操作 + 回收站）、ADR-0011（状态贯通 + 任务草稿确认）、ADR-0012（全站详情统一弹窗）、ADR-0017（子任务全链路 + 项目内操作）

---

## 1. 背景与问题

到 Slice R3 为止，`data/events/e-0001..0020` 是**只读实体**：有种子数据、在日历（议程流 + 迷你月历）渲染、详情弹窗可看（Slice K），但 `server/schemas.mjs` 无 `SCHEMAS.events` / `ID_PATTERNS.events`，`server/index.mjs` 无路由，`EDITABLE_FIELDS` 无 events，也没有创建 / 编辑 / 删除入口。后果（审计 F6 / F9 / F10 / F38）：

1. **文档定义的状态流不可执行**——`docs/04 §5.5` 写着 `tentative → confirmed → cancelled`，但用户无法确认或取消任何日程。
2. **迷你月历日格是 inert `<span>`**——点击无反应，不能定位到某天。
3. **无法新建日程**——只能看种子事件。
4. 事件是唯一一个「有实体、有页面、有详情」却完全不可写的实体，与全局「先确认后写入 + 软删除可撤销」的模式不一致。

本 ADR 把事件转为**与其他四类实体同构的可写实体**（task / project / note / resource 之后的第五类），并给出字段白名单与状态流。

## 2. 决策

### 2.1 事件并入通用「可编辑 / 可回收」实体族

**沿用 house patterns，最小新增面。** 事件 `kind = 'events'`、`id` 前缀 `e-`，接入既有机制：

1. **Schema（`server/schemas.mjs`）**：新增 `eventSchema`，字段对齐既有 `data/events/*.json`——`id / title / startAt / endAt? / allDay? / location? / areaId? / projectId? / tags / status / notes? / repeatRule?`。`eventStatus = confirmed | tentative | cancelled`。**不引入 `createdAt` / `updatedAt`**，与既有事件形状保持一致（避免污染 owner 数据形状）。`SCHEMAS.events` + `ID_PATTERNS.events = /^e-\d{4}$/`。
2. **存储（`server/store.mjs`）**：`nextId` 增 `events: 'e'`（扫描正册 + 回收站，防回收后 id 复用）；`TRASH_KINDS` 增 `'events'`，回收站可见日程。
3. **可编辑（`server/index.mjs`）**：`EDITABLE_KINDS` / `SINGULAR` / `EDITABLE_FIELDS` 增 events。字段白名单：`title / startAt / endAt / allDay / location / status / projectId / areaId / tags / notes`（`repeatRule` 不开放，见 §2.4）。由此**免费获得**通用 `POST /api/events/:id/update`、`POST /api/events/:id/trash`、`POST /api/trash/events/:id/restore`、`POST /api/trash/events/:id/purge`。
4. **创建（新增 `POST /api/events`，201）**：`title` + `startAt` 必填（空 → 400）；`endAt` **可选**（缺省不写 = 单点日程；早于 `startAt` → 400「结束时间不能早于开始时间」）；`allDay` 缺省 `false`；`status` 缺省 `confirmed`（可显式 `tentative` / `cancelled`）；`projectId` / `areaId` 须真实存在（同 `createTask` 口径）；标签规格化并 `ensureTags`（`origin:'manual'`）。审计 `event.create`（`detail.fields` 记录携带的可选字段）。
5. **删除（新增 `POST /api/events/:id/remove`）**：与通用 `/trash` 同语义（先写回收站副本再删正册），但审计名为 **`event.remove`**（house 命名见 ADR-0009 的单数约定）。撤销 = `restore`。
6. **跨字段校验（update 路径）**：`updateEntity` 对 `events` 追加一步——更新后若 `endAt < startAt` → 400。`endAt` 置空（`null`）= 清除结束（单点日程）。
7. **无时间戳**：`updateEntity` 对 events **不 bump `updatedAt`**（事件无该字段）；`touch` 语义仅审计。

### 2.2 日历可操作：新建 / 详情 / 状态流 / 日格

- **新建日程**：日期条右侧安静「新建日程」按钮 → 复用 `Modal` 承载的 `EventDraftModal`（字段组件复用 `EntityEditForm`，`submitLabel="创建日程"`）；**先确认后写入、无 AI**，确认前零落盘；成功 toast「已创建日程 · 撤销」（撤销 = `removeEvent`）。
- **详情弹窗**：新 `EventDetailModal`（与 `TaskDetailModal` / 项目 / 笔记 / 资料同构）——只读字段网格 + **编辑**（`EntityEditForm`，新增 `boolean` 字段类型以支持「全天」）+ **删除**（回收站 + 撤销）。底栏沿用 `.k-modal__foot-actions`。
- **状态快捷切换**：详情内 quiet segmented（复用 `.k-lib__seg` + `TagPill`，与资料状态同姿态）——`已确认 / 待定 / 已取消`，写入即 toast 可撤销。**文档状态流由此可执行**（待定 → 已确认 → 已取消）。
- **F10 迷你月历日格可点**：inert `<span>` 改为 `<button>`，点击**选中该日**（`.is-selected`）并**滚动议程到该日首个未结束事件**（`scrollIntoView`，`prefers-reduced-motion` 时 `auto`）；today 标记与「有安排」圆点保留。选中日同时作为「新建日程」的预填开始时刻（当天 09:00；否则下一整点）。

### 2.3 `endAt` 可选的后果（前端防御）

`endAt` 由必填改为可选后，所有消费点统一以 `event.endAt ?? event.startAt` 兜底（`Calendar` / `DaySpine` / `ScheduleList` / `Overview` / `data.ts` / `derive.ts`），渲染不因缺结束而崩。`src/types.ts` `CalendarEvent.endAt` 随之改为可选，新增 `notes?`。

### 2.4 边界（明确不做）

- **`repeatRule` 仍只读 / 仅展示**：重复规则（RRULE）的展开、编辑与实例化延后，不在本切片开放写入口；既有 `repeatRule` 字段原样保留、原样展示。
- **不加 AI**：日程创建是纯表单（先确认后写入），不调用 opencode。
- **不新增前端依赖**，不引入 `any` / `ts-ignore`；`EntityEditForm` 仅新增一个 `boolean` 字段类型与 `submitLabel` 文案参数（向后兼容，旧调用行为不变）。

## 3. 后果

**正面**

- 事件从「只读摆设」变为完整可用：新建 / 编辑 / 状态流 / 软删除与撤销，全部经单写者 + Zod + 原子写 + 审计。
- 与其余四类实体同构，动作矩阵 / 回收站 / 深链 / 关联区块自动一致；新增代码面小。
- 迷你月历从静态装饰变为导航控件（F10 修复）。
- 文档状态流（`docs/04 §5.5`）与实际能力对齐。

**代价 / 已知限制**

- `endAt` 可选使 6 个消费点需 `?? startAt` 兜底（已补，类型系统保证覆盖）。
- 事件无 `createdAt` / `updatedAt`，故「最近活动」类派生不覆盖事件；这是为对齐既有数据形状的**有意取舍**。
- 删除日程不级联处理引用（无实体引用事件）；`repeatRule` 延后。

## 4. 验证

- `npm run build`（tsc strict + vite）退出 0。
- 服务端冒烟 `.qa/v38/server-smoke.mjs` **33/33**：create 往返（单点 / 完整）、`end < start` 400、title / startAt 空 400、臆造 projectId / areaId 400、update 白名单 + 白名单外忽略、update `end < start` 400、审计 `event.create/update/remove`、`event.remove` → 回收站 → restore → purge、`nextId` 无碰撞（e-0021 / e-0022）、owner 20 条事件**字节不变**、零残留。
- 浏览器 E2E `.qa/v38/verify-w.py` **27/27**：UI 新建（fixture 日期）→ 议程流 + 月历圆点、详情编辑标题 / 时间、状态快捷切换（已取消 ↔ 已确认）、删除 → 回收站（UI）恢复、日格点击滚动议程、390 零横溢、控制台 0 error、零残留、owner 记录字节不变。
