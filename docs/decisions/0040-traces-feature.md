# ADR-0040 · 踪迹（TRACES）：活动留痕实体 + 独立页 + 收件箱 / 对话识别

- 状态：已采纳
- 日期：2026-10-05
- 相关：ADR-0015（一揽子动作）、ADR-0010（总览 AI 对话）、ADR-0009（详情 / 回收站）、ADR-0039（个人页与习惯页）

## 背景

owner 需要一个「记录我做了什么」的轻量功能：它不是笔记（无需成文）、不是资料、不是日程、也不是任务，只是一条**已完成动作的时间戳留痕**（「我刚刚跑完 5 公里」）。诉求：独立页面（朋友圈式动态 ⇄ 纯时间线可切换）、收件箱可自然语言识别入账、总览有小组件入口、总览 AI 对话能识别「我做了 X」并收进踪迹，而「感悟 / 思考」则应进笔记。

## 决策

1. **新一等实体 `trace`（`tr-`）**，字段 `{ id, title(≤80), note?(≤500), at(ISO 带偏移), tags, areaId?, projectId? }`。**无 `createdAt/updatedAt`**（对齐 `event` 形状；`at` 即发生时间，缺省 = 服务端记录时刻）。写入全程经单写者 + Zod + 原子写 + 审计（`trace.create` / `trace.update` / `trace.trash` / `trace.restore` / `trace.purge`）；并入快照 `traces[]`、回收站族、标签级联（`ensureTags`）、`nextId` 前缀 `tr`。**派生值绝不落盘**。
2. **独立页 `/traces`**（一级导航 08）：双风格（动态 = 朋友圈卡片；时间线 = 紧凑列表）由按钮切换，偏好经界面 store `kernel.ui.traces.v1` 持久化（Slice Z 精神）；速记框回车即记录（输入即确认）；删除走回收站可撤销；`?trace=<id>` 深链定位高亮（`relations.deepLinkOfId` 增 `tr-`）。
3. **收件箱 AI** 新增第 6 类动作 `kind:"trace"`（提示词规则 13）：陈述「我刚刚 / 今天做了 X」→ 踪迹建议；`postValidateActions` 按 kind 清洗（非 trace 剥离 `at`、trace 的 `note` 截断 ≤500、无效 `at` 丢弃）；`inbox.apply` 落盘并记 `linkedIds`；撤销经 `kindOfId` 的 `tr-` 映射。
4. **总览**：踪迹小组件（最近 4 条 + 跳转独立页）；AI 对话新增 `traceRequest` 意图（模型只在陈述已完成动作时输出 `{"trace":{…}}`，服务端 `tryParseTraceRequest` 清洗），前端「记入踪迹」确认卡 → `POST /api/traces`。**思考 / 感悟不判为 trace**，仍走既有「整理进笔记」。

## 后果

- 好处：新增一类「留痕」与既有四类区分清晰；收件箱 / 对话双入口降低记录成本；总览小组件 + 独立页形成闭环；全部复用既有单写者与界面状态约定，无新依赖、无新外部调用面。
- 边界：`trace` 可编辑 / 可回收；重复性事项不做（那属课程 / `event`）；AI 只在**明确陈述已完成**时产 trace，避免与 todo / 日程 / 笔记混淆；`at` 无明确时间词则取应用 / 记录时刻（不编造）。

## 影响

- 数据模型：`docs/04-DATA-MODEL.md` §4.7b（字段 + ID `tr-` + 示例）、§2 ID 约定、§5.4b 可回收实体十种。
- 代码：`server/{schemas,store,index,ai}.mjs`、`src/types.ts`、`src/lib/{nav,data,mutations,relations,activity,aiForm}.ts`、`src/views/{Traces,Overview,Trash}.tsx`、`src/components/{AiActionsCard,AiSuggestionForm,OverviewChat}.tsx`、`src/styles/views.css`、`scripts/seed.mjs`。

## 修订（2026-10-05 · 全面审查修复）

按 UI 设计 / 产品经理视角只读审查（证据 `.qa/traces-review/`，含计算样式探针与浏览器截图）后修复与补齐：

1. **修「回车记录」失效**：速记框此前只在点「记录」时提交，回车仅换行（与占位符及本 ADR 承诺不符）。现 Enter 提交、Shift+Enter 换行，并加 IME `isComposing` 守卫（中文输入法确认候选词不误提交）。
2. **修动态卡 CSS 半覆盖**：v1 与 v2 两段同名规则并存——v2 只重写 `display/grid/padding/border-top`，v1 的 `background/border/border-radius/box-shadow` 仍在生效，且水平内边距为 0（内容贴卡边）。现合并为**唯一权威块**并显式重置旧卡 chrome：动态流为**无壳流水**（左日期列 + 内容 + 图片宫格 + hairline 分隔），删除约 90 行死规则（avatar / body / head / time / meta 等）。
3. **详情 / 编辑**：新增 `TraceDetailModal`（镜像任务详情）——阅读视图 + `EntityEditForm` 编辑 `title / note / at / tags / areaId / projectId`（保存经 `updateEntity('traces', …)` + `undoPatchOf` 撤销）；图片点击开灯箱（`TraceLightbox`，复用 Modal）。
4. **检索与可达性**：`searchSnapshot` 增扫 `traces`（title / note / tags），`SearchResult.kind` 增 `trace`，命令面板补「踪迹」标签与图标；整行可点开详情采纳**标题按钮 + `::after` 拉伸覆盖**模式（键盘可达、读屏可读，避免 `role="button"` 包裹内层按钮的嵌套交互反模式）；标签改 `tagLabel()`、区域 / 项目渲染可点安静 chip（`TraceRefChip`）。
5. **筛选 / 一致性 / 细节**：新增标签筛选 + 搜索（持久化 `kernel.ui.traces.v1` 的 `tag` / `query`，计数 `N / M`）；风格切换套 `.k-lib__seg` 轨道（与全站分段控件一致）；时间线删除改安静 `.k-trace__del` 样式、吸顶日标签背景修 `--bg`；发布器类名私有化 `k-trace-composer*`；图片上传受限并发（`mapLimit` ≤3）；深链滚动尊重 `prefers-reduced-motion`。创建补「撤销」（入回收站，与删除对称）。
6. **动态流按天分组（同日迭代）**：此前动态流每条重复日期列（同一天的「今天」反复出现）；现按自然日分组——**一天只出现一个日期标记**（左日期标记 + 右条目列），日内条目以 hairline 分隔、日间以 border 分隔；日期标记顶对齐当天首条内容；跨年补年份（如「31 / 2025年12月」）；窄屏（≤640px）日期标记改为整行标题、条目占满宽度（避免窄列换行 / 图片挤压）。`dayLabelOf` / `dateParts` 增跨年与无效日期兜底。

> 边界不变：`trace` 无 `createdAt/updatedAt`；派生值不落盘；写入仍先确认后落盘（速记框为显式「记录」动作）。验证见 `CHANGELOG.md`（隔离 QA 23/23 PASS）。
