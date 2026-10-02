# ADR-0019 · 区域 / 目标 / 习惯：可管理 + 打卡

- 状态：已采纳
- 日期：2026-10-03
- 相关：ADR-0004（数据服务 · 单写者 / 校验 / 审计）、ADR-0009（详情操作 + 回收站）、ADR-0012（全站详情统一弹窗）、ADR-0014（标签生命周期）、ADR-0017（子任务全链路 + 项目内操作）、ADR-0018（事件可写）

---

## 1. 背景与问题

到 Slice W 为止，`data/areas/a-0001..0007`、`data/goals/g-0001..0007`、`data/habits/h-0001..0005` 是**仅种子可读**的结构：

1. 可读（选择器 / 关联芯片 / 统计）但 `server/schemas.mjs` 无 schema、`server/index.mjs` 无路由、设置页无管理区——用户**无法创建 / 编辑 / 删除**（审计 F7 / F8）。
2. **F8**：`Relations` 中的 area / goal 芯片无点击目标（inert），是「看得见摸不着」的死链接。
3. **习惯打卡缺口**：总览「连续刷题」条读 `habit.log`（冻结种子），`derive.ts` **硬编码 `h-0002`**，且**没有任何打卡写入路径**——点阵永远不变，与「习惯本应每日打卡」的语义相悖（审计 F23 / 习惯打卡缺口）。
4. **F23**：项目快速新建此前会静默默认 `a-0001`——`ProjectDraftModal` 的区域下拉默认值为空（显示「—」），而服务端缺省仍落 `a-0001`，用户看不到实际归属。

本 ADR 关闭最后三个只读结构，并为习惯补上打卡闭环。

## 2. 决策

### 2.1 三实体并入可管理族（沿用 house patterns，最小新增面）

**Schema（`server/schemas.mjs`）**：新增 `areaSchema` / `goalSchema` / `habitSchema` + 对应枚举（`areaCadence` / `areaStatus` / `goalHorizon` / `goalStatus` / `habitCadence` / `habitMetric`）；`SCHEMAS.areas/goals/habits`；`ID_PATTERNS` 增 `goals:/^g-\d{4}$/`、`habits:/^h-\d{4}$/`（`areas:/^a-\d{4}$/` 既已存在）。字段严格对齐既有 `data/*.json` 形状，**不引入 `createdAt` / `updatedAt`**（避免污染 owner 数据形状）。

**存储（`server/store.mjs`）**：`nextId` 增 `areas:'a' / goals:'g' / habits:'h'`（扫描正册 + 回收站，防 id 复用）；`TRASH_KINDS` 增三类，回收站可见。区域 / 目标 / 习惯的删除均**移入回收站**（可 `restore` / `purge`）。

**路由（`server/index.mjs`）**：

| 端点 | 语义 |
|---|---|
| `POST /api/areas` · `/api/goals` · `/api/habits` | 创建（201）；`title` 必填（空 → 400 中文）；`areaId` 须真实存在 |
| `POST /api/<kind>/:id/update` | 通用白名单编辑（复用 `updateEntity`） |
| `POST /api/<kind>/:id/remove` | 删除 → 回收站（区域 / 目标带引用护栏，见 §2.2） |
| `POST /api/trash/<kind>/:id/(restore\|purge)` | 回收站恢复 / 彻底删除（`TRASHABLE_KINDS` 扩展） |

编辑字段白名单：`areas` = `title / standard / cadence / status`；`goals` = `title / horizon / areaId / status / targetDate`；`habits` = `title / cadence / metric / target / trigger / areaId`。`updateEntity` 对这三类**不 bump `updatedAt`**（对齐无时间戳形状）。审计：`area.create/update/remove`、`goal.create/update/remove`、`habit.create/update/remove`（+ 回收站 `restore/purge`）。

### 2.2 引用护栏（remove → 409 可读计数）

- **区域**：被以下任一实体的 `areaId` 引用时拒绝删除——任务 / 项目 / 笔记 / 资料 / 日程 / 目标 / 习惯。响应 **409**，文案含可读计数（如「该区域正被 5 条记录引用（任务 3 · 项目 2），不能删除；请先解除引用」）。
- **目标**：被项目的 `goalId` 或子目标的 `parentGoalId` 引用时拒绝删除（同 409 文案）。
- **习惯**：无引用护栏（区域仅为其出链），直接入回收站。
- UI 亦按快照**预判**并禁用「确认删除」、展示同一说明；服务端为权威（防竞态）。

### 2.3 设置页三个管理区 + F8 芯片可点

- 设置页新增「区域 / 目标 / 习惯」三个分区（`AreaManager` / `GoalManager` / `HabitManager`，共用 `DimensionManager` 壳）：列表 + 新建（`Modal` + `EntityEditForm`，`submitLabel="创建"`）+ 编辑 + 删除（护栏 / 回收站），token-only、安静。
- **F8**：`Relations` 的 area / goal 芯片改为可点 `<button>`（`TagPill` 已支持 `onClick`），深链到设置页对应分区并**自动打开该实体的编辑弹窗**：`/settings?section=areas&area=<id>` / `?section=goals&goal=<id>`。`deepLinkOfId` 同步支持 `a-` / `g-` 前缀。选择「深链 + 设置区编辑」而非嵌套弹窗，避免两层 `Modal` 的 ESC / 焦点争用。

### 2.4 习惯打卡（check-in）

- 端点：`POST /api/habits/:id/checkin {date?}` 与 `POST /api/habits/:id/uncheckin {date?}`；`date` 缺省为服务端「今天」（本地时区 `YYYY-MM-DD`）。
- **幂等**：check-in 若该日已存在且 `value > 0` 则**不重复写、不审计**（返回 `changed:false`）；否则写入 `{date, value:1}` 并审计 `habit.checkin`。uncheck-in 无该日则无操作（`changed:false`）；否则移除并审计 `habit.uncheckin`。
- **value 约定**：打卡统一写 `value:1`（「当日已完成一次」）。连击 / 点阵只判断 `value > 0`，故 `count / minutes / bool` 三种度量口径一致；具体度量值（分钟数等）不在此 UI 录入（边界见 §2.6）。
- 总览「习惯打卡」条：标题改为**所选习惯标题**（见 §2.5）；新增 quiet「今日打卡 / 今日已打卡」切换按钮（`aria-pressed` 反映今日 log），点击打卡 / 取消打卡 + toast「撤销」；经 `useDataRevision` 即时刷新点阵与连击天数。
- 设置页「习惯」区只管理定义（`log` 不在表中编辑）；删除入回收站。

### 2.5 修复 `h-0002` 硬编码

`derive.ts` 的 `getCodingStreak` / `getCodingStreakDetail` 此前 `habits.find(h => h.id === 'h-0002') ?? habits[0]`。改为**确定性取 `habits[0]`**（快照按 id 升序，种子即 `h-0001`「23:30 前入睡」），并新增 `habitId / habitTitle / todayHit` 供监视柱标签与打卡按钮态。理由：不再硬编码某个具体 id；用户可通过编辑 / 新建习惯控制排序首位（id 最小者被展示）。若未来需要「置顶某习惯」，再引入显式 `featured` 字段（本切片不做）。

### 2.6 F23：项目区域默认值显式化

`ProjectDraftModal` 的区域下拉默认值由空串（显示「—」但服务端落 `a-0001`）改为**首个区域 id**，并移除「—」空选项——项目必须有区域，用户与 AI 均能看到并更改实际归属。服务端 `createProject` 的 `a-0001` 兜底保留（向后兼容旧调用 / AI 路径），但常规 UI 路径不再静默。

### 2.7 边界（明确不做）

- **`goal.keyResults` 仅保留展示**：本切片不开放 KR 的增删改（编辑弹窗内只读展示），写入能力延后；既有 KR 原样保留。
- **`habit.log` 不在管理表编辑**：只经 check-in / un-check-in 维护；不提供补录任意历史度量值的 UI。
- **不新增前端依赖**；不引入 `any` / `ts-ignore`；`EntityEditForm` 复用既有字段类型（无需新增）。

## 3. 后果

**正面**

- 最后三个只读结构闭环：区域 / 目标 / 习惯可创建、编辑、软删除与恢复，全经单写者 + Zod + 原子写 + 审计。
- F8 修复：关联芯片可点、可深链直达编辑。
- 习惯打卡有真实写入路径；总览点阵 / 连击即时反映，且可撤销；`h-0002` 硬编码消除。
- 引用护栏避免悬空外键（删除被引用的区域 / 目标被明确拒绝并提示计数）。
- F23：项目区域归属显式可见。

**代价 / 已知限制**

- 新增 `TRASH_KINDS` 三类，回收站分组增多（语义一致，代价可忽略）。
- 区域 / 目标 / 习惯无 `createdAt` / `updatedAt`，故「最近活动」类派生不覆盖它们（对齐既有数据形状的有意取舍）。
- 习惯打卡 UI 仅记录「完成一次」（`value:1`）；按分钟 / 次数的精确度量录入延后。
- 删除习惯不级联处理总览展示（若 `habits[0]` 被删，下一条自动补位；删空则条显示「习惯打卡 / 0 天」并禁用按钮）。

## 4. 验证

- `npm run build`（tsc strict + vite）退出 0。
- 服务端冒烟 `.qa/v39/server-smoke.mjs` **62/62**：区域 / 目标 / 习惯 create → update → remove →（restore）→ purge 往返；`nextId` 扫描得 `a-0008 / g-0008 / h-0006`；空标题 400；臆造 `areaId` 400；区域 / 目标被引用删除 409（文案含可读计数）；习惯 check-in / un-check-in **幂等**（第二次 `changed:false`，不重复记录）；缺省日期 = 今天；`trigger` 置空清除；审计全覆盖；零残留；所有者 157 个数据文件**字节不变**（`h-0002` log 逐字节一致）。
- 浏览器 E2E `.qa/v39/verify-x.py` **45/45**：设置页区域 / 目标 新建 → 重命名 → 删除护栏（`role=alert` + 确认禁用）→ 未引用删除入回收站；项目详情区域 / 目标芯片点击 → 深链设置并自动打开编辑弹窗（URL 含 `section` / id，标题正确）；总览「今日打卡」→ 落盘 + 按钮态 + 点阵命中 + 连击即时更新 → toast 撤销还原；390 零横溢；控制台 0 error；零残留；所有者记录语义不变 + `h-0001` 今日状态还原后**字节不变**。
