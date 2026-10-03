# ADR-0025 · 课表导入：来源 → 课程草稿 → 勾选确认（Slice H1）

- 状态：已采纳（Slice H1.5 修订：旧版二进制 `.xls` 直读已实现）
- 日期：2026-10-03
- 相关：ADR-0004（数据服务）、ADR-0005（opencode AI 接入）、ADR-0008（收件箱文件投递）、ADR-0011（先确认后写入）、ADR-0023（公告解析 · 截图接入）、ADR-0024（课表 · 课程实体）

> **修订（Slice H1.5 · 2026-10-03）**：旧版二进制 `.xls` 的**直读已实现**——零依赖 OLE2/CFBF + BIFF8 最小解析（Workbook 流 → SST / LABELSST / LABEL / NUMBER / RK / MULRK / MERGEDCELLS → 列对齐网格 + 合并传播），对所有者真实课表实测 draft 出 **12 门课全对**。原「不做 BIFF 解析、给指引」的取舍随之调整：**能解析就直读，解析失败（损坏 / 加密 / 非 BIFF8）才回退指引**。
> **修订（Slice H1.6 · 2026-10-03）**：课表解析**过程可视**——新增 SSE 流式端点 `POST /api/ai/timetable/draft-stream`（status / delta / retry / suggestion / error），前端实时显示阶段与输出预览（见 §2.4）。

---

## 1. 背景与反馈

所有者把学校发的个人课表 `.xls` 丢进收件箱，结果它只被当成「资料 + 简介」归档了。排查后确认两点：

1. **文件是真正的旧版二进制 `.xls`**：魔数为 OLE2 复合文档（`d0cf11e0`），不是改名后的 HTML / CSV。零依赖栈当时读不出它的单元格文本——**H1.5 修订补上直读**；HTML 版 `.xls` 与纯文本 `.xls` 另有容错分支。
2. **「课表 → 课程」此前没有导入管线**：Slice H0（ADR-0024）只做了手动录入 + 课表视图，AI 导入明确留待后续。一条真实课表落进收件箱，除了当资料看没有别的出口。

本切片（Slice H1）补齐这条链路：**课表来源 → 课程草稿 → 勾选确认 → 导入 `courses`**。来源覆盖 `.xlsx`、`.xls`（旧版二进制直读 / HTML 版容错）、截图、粘贴文本；确认制与「草稿绝不落盘」不变。

## 2. 决策

### 2.1 两个端点，确认前零写入

课程导入拆成「出草稿」与「落盘」两步，职责分明：

| 端点 | 作用 | 落盘 | 审计 |
|---|---|---|---|
| `POST /api/ai/timetable/draft { id }` | 对收件箱**未澄清**条目跑课表解析 | 否 | 无 |
| `POST /api/courses/import { courses }` | 逐条校验后写入 `courses` | 是 | 每条 `course.create` · `detail.via:'timetable-import'` |

**草稿端点**返回 `{ courses: CourseCreateInput[], model, ms }`——只出建议，不碰 `data/`。其守卫与收件箱 AI 解析一致（health 探活、超时、单次重试），状态码：

- **400**：附件的格式不可直读（给出可读指引，见 §2.2 的 `.xls` 分支）。
- **404**：收件箱条目不存在。
- **409**：条目不是「未澄清」状态（已澄清 / 已丢弃不可再解析）。
- **502**：模型调用失败。
- **503**：opencode serve 不可用。

**导入端点**接 `{ courses: CourseCreateInput[] }`，**1–30 门**。先对全部课程跑 `coursesImportSchema` + `normalizeCourseSessions` **校验并规格化、零落盘**；**全部通过**后才逐条 `commit`。任一非法即整批 400、不留半成品。返回 201 `{ created }`。

### 2.2 来源与读取

不同来源走不同读取路径，最终都归到同一段文本或同一张图：

- **`.xlsx`**：新增 `extractXlsxGrid` 抽取工作表网格——解析 `sharedStrings` + `inlineStr` + 数字单元格，按列字母对齐**补空列**（合并单元格 / 跳列时网格不塌），跳过整行空行。`extractOfficeText` 的 xlsx 分支改用网格抽取（保留行列结构，课表才有列对齐可言）；docx / pptx 行为不变。
- **`.csv`**：已在文本白名单，直接摘录。
- **旧版 `.xls`**：按内容分**三分支**——
  - 真 OLE2 二进制：**直读（H1.5 修订）**——`extractLegacyXlsGrid` 零依赖解析 CFBF 容器（DIFAT / FAT / 目录链 + miniFAT 迷你流）与 BIFF8 记录（SST 含 CONTINUE 续段、LABELSST / LABEL / RSTRING / NUMBER / RK / MULRK、MERGEDCELLS），装配**列对齐网格**并做**合并传播**（跨行跨列课程名自动重复，AI 可直接读；单元格内换行折叠为 ` / ` 保持逐行 tab 对齐）；**解析失败（损坏 / 加密 / 非 BIFF8）才回退不可读指引**。
  - HTML / XML 表格（网页另存或误改扩展名）：`htmlTableToText` 抽取表格文本。
  - 纯中文文本：原文摘录。
- **截图**：复用 N0（ADR-0023）的 opencode file part（`data:<mime>;base64,…`），默认模型读图。
- **粘贴文本**：与截图同管线，无需附件。

### 2.3 提示词与清洗

**提示词** `buildTimetableSystem` 把课表的结构先验写进指令：星期列 = 1..7、节次行或「第 N 节」、合并单元格 → 跨节段 session、周次文本 → 升序数组（识别单 / 双周）、宁缺毋滥、≤30 门、忽略学号姓名等表头。读取走 `tryParseTimetable` + 单次重试（指令式 JSON + Zod）。

**清洗**由 `cleanTimetableCourses` 确定性完成（不依赖模型自觉）：`endPeriod < startPeriod` 交换、非法时段丢弃、`weeks` 去重升序、空课程丢弃、字段 trim + 截断。清洗后仍由导入端点的 schema 兜底。

### 2.4 前端交互

收件箱展开条目新增**「导入为课表」**，与「AI 解析」同排 pill；同条目解析中显示「课表解析中…」。运行态由模块级 `src/lib/timetableAi.ts` 持有（`itemId/busy/stage/preview/courses/error`，token 守卫防串号，**不落 localStorage**）。

**过程可视（H1.6 修订）**：课表解析走 `POST /api/ai/timetable/draft-stream`（SSE，镜像收件箱解析流：status / delta / retry / suggestion / error）——面板实时显示阶段（「AI 正在阅读课表…」→「正在提取课程…」→「输出校验重试中…」）与输出预览（`field:'text'` 增量，尾部 ≤240 字、≤2 行截断）；`suggestion` 帧落地草稿并清空过程态，`error` 帧进入错误态。同步端点保留不动。

结果以 `TimetableDraftCard` 呈现：标题「识别到 N 门课程 · 勾选后导入」、逐行勾选（**默认全选**）、时段明细（如「周三 第3-4节 · 1–15 周（单） · 某教室」）、页脚「导入 N 门课程」/「忽略」。

- 点「导入」→ `POST /api/courses/import` → toast「已导入 N 门课程 · 撤销」（撤销 = 逐条移入回收站）。
- 错误态（如指引文案）安静展示，附重试 / 关闭。
- 390px 不横溢。

### 2.5 边界（本切片不做）

- **旧版 `.xls` 直读**：已实现（H1.5 修订）；**BIFF5 / 加密 / 损坏工作簿**仍回退指引。
- **多工作表 / 跨页截图**：多表合并至多解析前几表；跨页拼接延后。
- **课表与学期自动对齐**：如从「第 1 周」反推 `term.startDate`，延后。
- 条目须为**未澄清**状态。

## 3. 备选与取舍

| 备选 | 取舍 | 理由 |
|---|---|---|
| 独立草稿端点 `POST /api/ai/timetable/draft` | **采纳** | 与聚类立项（ADR-0016 `POST /api/ai/cluster/draft`）同模式——课表输出的形状是**同质课程数组**，与收件箱「动作数组」（task/note/resource/project 混合）不同容器、不同确认 UI；塞进通用动作数组会撑开 `aiActionSchema` 并让「勾选课程」与「勾选动作」两套语义纠缠 |
| 并入通用动作数组 | **否决** | 见上——多实体动作数组服务于「一次澄清」，课表导入服务于「一次建 N 门课」，目标与确认面板都不是一回事 |
| 直读旧版 `.xls`（零依赖手写最小解析） | **修订（H1.5）采纳** | 原为「否决（本期）」——先给「另存为 .xlsx」指引。H1.5 以零依赖手写解析实测打通（所有者真实课表 draft 出 12 门课全对），且「丢进去就该能读」是核心体验，故补上直读；解析失败仍回退指引 |
| 自动导入（解析即落盘） | **否决** | 课表识别有歧义（合并单元格 / 单双周 / 表头），错一门就污染整学期视图；勾选确认让用户先校一遍，符合全站 confirm-first |
| 草稿落盘暂存 | **否决** | 草稿是解析临时产物，重解析可再得；落盘会沉淀中间态并需额外生命周期（同 ADR-0023 对 `facts` 的取舍） |
| 导入 = 逐条 `POST /api/courses` 循环 | **否决** | 逐条会留下一半成功的半成品；`/api/courses/import` 先全量校验再统一提交，整批原子 |

## 4. 边界（后续切片）

- **BIFF5 / 加密工作簿**：非 BIFF8 或加密文件仍走指引（暂不解析）。
- **多表 / 跨页**：多工作表合并、跨页截图拼接。
- **学期自动对齐**：由课表内容推 `term.startDate` / `totalWeeks`。
- **调休例外 / 通知 → 课表桥**：沿用 ADR-0024 的后续项，不在本切片。
- confirm-first 不变：任何写入先经用户勾选确认，导入后可撤销。

## 5. 影响面（文件）

- 服务端：`server/ai.mjs`（`extractXlsxGrid` + `extractOfficeText` xlsx 分支改用它、`extractLegacyXlsText` 三分支、`htmlTableToText`、**H1.5：`extractOleStream` / `decodeRk` / `extractLegacyXlsGrid`（OLE2/CFBF + BIFF8 最小解析）**、`buildTimetableSystem` + `tryParseTimetable` + `cleanTimetableCourses`）、`server/schemas.mjs`（`coursesImportSchema`、课表草稿请求 schema）、`server/index.mjs`（`POST /api/ai/timetable/draft`、`POST /api/courses/import`）。
- 前端：`src/lib/timetableAi.ts`（新，模块级状态 + token 守卫）、`src/components/TimetableDraftCard.tsx`（新）、`src/lib/mutations.ts`（`aiTimetableDraft` / `importCourses`）、`src/views/Inbox.tsx`（「导入为课表」入口 + 卡片集成）、`src/styles/views.css`（卡片样式，token-only）。
- 未改 `data/` 种子；未新增依赖。

## 6. 验证与证据

- **确定性契约** `.qa/probe-h1/` **19/19**：覆盖 `extractXlsxGrid` 网格夹具（sharedStrings / inlineStr / 数字 / 补空列 / 跳空行）、`.xls` 三分支（HTML 表格摘录 / 纯文本摘录 / 无效 OLE → null）、`cleanTimetableCourses` 清洗（`end < start` 交换 / 非法时段丢弃 / 周次去重升序 / 空课程丢弃 / trim 截断）。
- **H1.5 直读契约** `.qa/probe-xls/` **19/19**：所有者真实 `.xls` 网格 dump 断言（含「大学物理C / 陈曼娜讲师 / 301 / 星期表头 / 无 U+FFFD / 合并重复」）+ `decodeRk` 单测 + OLE 边界（假魔数 / 随机 / 空 buffer → null）。
- QA 证据（服务端冒烟 **32/32** / 浏览器 E2E **20/20**）归档 **`.qa/v45/`**；owner 真实 `.xls` **只读**全链实测：draft 出 **12 门课全对**（教师 / 地点 / 星期节次 / 周次），零写入、零审计。
- **流式过程可视（H1.6 修订）**：`.qa/v46/` 冒烟 **29/29**（帧序列 status→delta→suggestion、4 门课；错误帧指引；守卫 400/404/409）+ E2E **18/18**（阶段文案可见、错误指引、390 零横溢、控制台 0 error）。
- 未新增依赖；写入均经单写者 + 原子写 + 审计（`course.create` · `detail.via:'timetable-import'`）。
