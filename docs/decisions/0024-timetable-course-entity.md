# ADR-0024 · 课表：课程实体 + 学期元信息（Slice H0）

- 状态：已采纳
- 日期：2026-10-03
- 相关：ADR-0009（编辑 / 回收站）、ADR-0011（先确认后写入）、ADR-0018（事件可写）、ADR-0022（界面状态保留）、ADR-0023（公告解析 · 通知三性）

---

## 1. 背景与反馈

所有者反馈：「我还需要你做一个课表功能，我有时候会在这里查询课表，类似于课表这种属于固定日程，还是要和任务区分开来的。」

由此归出两条：

1. **课表要能查**：课表是每周重复、整学期固定的安排，需要一眼看清「周几第几节上什么课、在哪」，而不是混在待办里翻找。
2. **固定日程 ≠ 任务**：课表有始有终、按周重复、按节次排布；任务是一次性、带状态与上下文的一次动作。把课表塞进任务会污染执行视图，塞进事件又表达不了「第几周 / 单双周 / 节次网格」。

既有 `event` 的 `repeatRule` 字段只作展示保留、从未展开（见 ADR-0018），无法承载课表的周次范围与节次结构。本切片（Slice H0）引入**独立课程实体 + 学期元数据 + 课表视图**，先解决「手动录入 + 按周查看」；AI 导入与调休例外明确留待后续切片。

## 2. 决策

### 2.1 课程实体（`c-`）

新增可写 / 可回收实体 `course`，id 形如 `c-\d{4}`：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | `c-0001` |
| title | string | 课程名（必填，≤80） |
| teacher? | string | 教师（≤60；空则缺省） |
| location? | string | 默认地点（≤60；时段未单独指定时使用） |
| sessions | CourseSession[] | 上课时段 **1..16** |
| notes? | string | 备注（≤500） |
| createdAt | ISO | |
| updatedAt | ISO | 编辑会 bump |

时段子表 `CourseSession`：

| 字段 | 类型 | 说明 |
|---|---|---|
| dayOfWeek | 1..7 | 星期（1 = 周一 … 7 = 周日） |
| startPeriod | 1..20 | 开始节次 |
| endPeriod | 1..20 | 结束节次（须 ≥ `startPeriod`，否则 400） |
| weeks? | number[] | 周次（1..60，升序唯一）；缺省 / 空 = 每周 |
| location? | string | 该时段的地点（缺省回退课程默认地点） |

服务端 `normalizeCourseSessions` 统一规格化：周次排序去重（空则删键，表示「每周」）、`location` trim（空则删键）、`end < start` → 400 中文可读、空 `sessions` → 400。创建与编辑共用同一实现——创建经 `POST /api/courses`，编辑经通用 `POST /api/courses/:id/update`（字段白名单 `title/teacher/location/sessions/notes`）。一条课程可含多个时段（如「周一 3-4 节 某教室」与「周三 1-2 节 8A-305」），同一时段可限定周次（如 `1-16单`）。审计 `course.create` / `course.update` / `course.remove` / `course.restore` / `course.purge`。

### 2.2 学期元数据（`data/meta/term.json`）

课表的「第几周」需要一个基准。新增单例元信息 `data/meta/term.json`：

| 字段 | 类型 | 说明 |
|---|---|---|
| startDate? | `YYYY-MM-DD` | 第 1 周的周一 |
| totalWeeks? | 1..30 | 总周数 |
| updatedAt? | ISO | |

- `POST /api/term`（白名单 `startDate` / `totalWeeks`，审计 `term.update`；格式非法 / 越界 → 400 中文可读）。
- 文件**缺失 = 学期未设置**：前端不显示「第 N 周」、不按周过滤（全部课程都显示）。
- 换算：`startOfWeek(startDate)` 为第 1 周周一，目标日期所在周的周一与它相差的周数 + 1 即「第 N 周」（`weekOfTerm`）。

### 2.3 视图与交互

日历页新增安静 segmented「议程 / 课表」，模式经 Slice Z 的 `createUiStore` 存 `kernel.ui.calendar.v1`（非法值回退 `agenda`，见 ADR-0022）。

课表模式为全宽 `ClassGrid`：7 列（周一…周日）× N 行（节次）；时段块按 `dayOfWeek` 落列、按 `startPeriod..endPeriod` 跨行合并；今日列以唯一强调色作信号；块面只用表面阶 + 细描边。

- 头部：`第 N 周` + `‹ 本周 ›`（clamp 1..`totalWeeks`；无学期时禁用周导航）；右侧「设置学期」「新建课程」。
- **今天行**：按真实当前周汇总今日课程（`今天 · 周三：第3-4节 高数 · 某教室；…` / `今天无课`）。
- 无学期时头部显示「未设置学期（不按周过滤）」，全部时段一律显示。
- 点课程块 → 打开居中详情弹窗 `CourseDetailModal`（只读：教师 / 默认地点 / 上课时段列表）→「编辑」（`CourseForm`；保存 toast 可撤销，撤销回写旧 patch）→「删除」（移入回收站，toast 可撤销 = restore）。
- 点空格 → 预填该天该节的新建草稿。
- 回收站新增「课程」分组。

### 2.4 手动录入（v1）

`CourseForm`：课程名 / 教师 / 默认地点 / 备注 + 时段编辑器（星期 · 节次起止 · 周次文本 +「添加时段」）。

- **周次文本**：留空 = 每周，支持 `1-16` / `1-16单` / `1-8,10-16`，容错「每周 / 全周」；解析为纯函数 `parseWeeksInput`，非法即抛可读错误（`周次格式：如 1-16 / 1-16单 / 1-8,10-16`），UI 原样展示。
- **反显** `formatWeeks`：连续区间压缩（`1–8、10–16 周`），单双周且步长均为 2 时压缩为「`1–15 周（单）`」。
- 由空格 /「新建课程」触发的 `CourseDraftModal` 走**先确认后写入**（点「创建课程」才落盘，ESC / 取消零写入），创建后 toast 可撤销（= 移入回收站）。
- `TermModal`：开始日期（第 1 周周一；留空则不更新 `startDate`）+ 总周数（1–30，缺省 16）。

纯函数 `src/lib/schedule.ts` 集中提供：`parseWeeksInput` / `formatWeeks` / `formatPeriods` / `weekOfTerm` / `sessionInWeek` / `sessionsOfDay`——不读全局快照、无副作用，UI 与测试复用。

### 2.5 边界

- 本期**手动优先**；AI 解析导入（截图 / 文本 → 课程草稿）为后续切片。
- 调休例外（如通知「10/10 执行周三课表」）需要基于日期的例外模型，为后续切片；本切片课表严格按 `weeks` 周期重复。
- 节次 → 具体时间映射为后续切片；本期只到「节次」粒度。
- 通知 → 课表桥（放假日历 / 调课）为后续切片。
- confirm-first 不变：任何写入先经确认（草稿弹窗 / 编辑表单），创建与编辑均可撤销。
- 无新依赖、无新前端依赖；`event.repeatRule` 不受影响（事件保持原样）。

## 3. 备选与取舍

| 备选 | 取舍 | 理由 |
|---|---|---|
| 复用 `event` + `repeatRule` | **否决** | `repeatRule` 只作展示保留、从未展开；即便展开也表达不了「周次范围 / 单双周 / 节次网格」——课表是结构化周视图，不是重复的单个事件 |
| 课程做成「每周固定的事件集合」 | **否决** | 会生成大量事件实例、污染议程流；学期切换 / 调休时也没有单一事实源。课程应是**一个实体 + 多个时段** |
| 课表塞进任务 | **否决** | 与所有者「固定日程要与任务区分」的诉求相悖；课表无状态流 / 上下文 / 能量，塞进执行视图会污染任务列表 |
| 独立课程实体 + 学期元数据 | **采纳** | 单一事实源、字段贴合课表语义；周次 / 节次结构化，可按周过滤与网格渲染 |
| 先做 AI 导入、再做手动 | **否决（顺序调整）** | 手动录入是确定性基线，能立刻验证实体 / 视图契约；AI 导入依赖读数质量，留待后续 |
| 节次 → 时间映射同步落地 | **延后** | 需要与新学期作息表联动（不同学校 / 校区不一），先到节次粒度即可满足查询 |

## 4. 边界（后续切片）

- **AI 解析导入**：截图 / 文本 → 课程草稿（复用 N0 的图片管线，见 ADR-0023），仍 confirm-first。
- **调休例外**：「10/10 执行周三课表」→ 基于日期的日程例外模型。
- **节次 → 时间映射**：把「第 3 节」落到具体起止时刻。
- **通知 → 课表桥**：放假日历 / 调课信息解析后与课表联动。
- 上述均**不在本切片**；本期手动录入，写入仍先确认后落盘、可撤销。

## 5. 影响面（文件）

- 服务端：`server/schemas.mjs`（`courseSessionSchema` / `courseSchema` / `courseCreateSchema` / `termUpdateSchema` / `normalizeCourseSessions` + `SCHEMAS.courses` + `ID_PATTERNS.courses`）、`server/store.mjs`（`readTerm` / `updateTerm` / `TERM_FILE`；快照增 `courses` / `term`）、`server/index.mjs`（`EDITABLE_KINDS` / `EDITABLE_FIELDS.courses` + `createCourse` + `POST /api/courses` · `/api/courses/:id/remove` · `/api/term`，`updateEntity` 对 courses 走 `normalizeCourseSessions`）。
- 前端：`src/types.ts`（`Course` / `CourseSession` / `TermInfo` / `Snapshot`）、`src/lib/data.ts`（`getCourses` / `getTerm` / `getCourseById`）、`src/lib/mutations.ts`（`createCourse` / `updateCourse` / `removeCourse` / `updateTerm`）、`src/lib/schedule.ts`（新）、`src/components/ClassGrid.tsx` · `CourseForm.tsx` · `CourseDraftModal.tsx` · `CourseDetailModal.tsx` · `TermModal.tsx`（新）、`src/views/Calendar.tsx`（模式 segmented + 集成）、`src/views/Trash.tsx`（课程分组）、`src/styles/views.css`（`.k-timetable*` token-only）。
- 未改 `data/` 种子（无课程种子；学期未设置即显示「未设置学期」）。

## 6. 验证与证据

- **确定性契约** `.qa/probe-h0/` **19/19**：覆盖 `normalizeCourseSessions`（空 / `end < start` / 周次排序去重 / 空周次删键 / `location` trim）与 `parseWeeksInput` / `formatWeeks` 往返等。
- QA 证据（服务端冒烟 / 浏览器 E2E）归档 **`.qa/v44/`**（数字见该目录）。
- 未新增依赖；写入均经单写者 + 原子写 + 审计（`course.*` / `term.update`）。
