# Changelog

本文件记录 KERNEL 的所有重要变更，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 `v0.x.0` 节奏。

## [Unreleased]

### 收件箱生命周期闭合 + 澄清字段矩阵 · Slice V（已完成 · 2026-10-03）
以 owner 面向的「碎片化 / 摩擦」审计为规格，修五组问题：①（F2）文本捕捉后不自动 AI 解析，与文件投递节奏不一致；②（F34）删除端点无 UI 入口、附件无法清理；③（F15/F37）已丢弃 / 已澄清条目 toast 消失后无「恢复 / 删除 / 撤回 / 查看产物」出口；④（F16/F30）`newProjectHint` 不能一键建项；⑤（F19/F31）target=note/resource 时仍渲染任务专属字段，**用户的编辑被静默丢弃**。不新增端点，复用既有 `remove` / `revert` / `clarify` / `projects`。`npm run build`（tsc strict + vite）通过；服务端冒烟 **43/43** + 浏览器 E2E **29/29**；零数据残留（inbox 回到基线 12 条；回收站 0；所有者 i-0009/i-0010、t-0061/t-0062、rev-0001/rev-0002 未动）；控制台零 error；证据 `.qa/v33/`。

- **F2 捕捉即解析（前端 `src/views/Inbox.tsx`）**：`captureText` 捕捉成功后调用 `runParseSilent(item)`——先探活 `/api/ai/health`，离线 / 探活失败**静默跳过**（不展开面板、不刷错误 toast）；在线复用既有 `runParse` + `aiParseInboxStream` + `src/lib/inboxAi.ts` 缓存路径（与文件投递自动解析同节奏）；**绝不自动应用**，手动「AI 解析」保留。
- **F34 删除入口（前端 + 既有端点）**：`src/lib/mutations.ts` 新增 `removeInbox(id)`（服务端 `POST /api/inbox/:id/remove` 已存在，一并清理附件）。未澄清条目展开动作区与已丢弃行提供「删除」，**内联二次确认**（`.ic-confirm`）后删除 + toast；已澄清条目服务端 409 保护（UI 只提供「撤回」）。
- **F15/F37 生命周期闭合（复用 `revert`）**：已丢弃行「恢复」、已澄清行「撤回」均调 `revertInbox`——discarded 无产物仅重置 `unprocessed`；clarified 删除 `linkedId` 产物后回退（撤回带确认）。已澄清行新增「查看产物」，按 `linkedId` 前缀经新增 `src/lib/relations.ts` `deepLinkOfId()` 深链（`t-`→`/tasks?task=` / `p-`→`/projects?project=` / `n-`→`/library?note=` / `r-`→`/library?resource=`；无产物禁用）。
- **F16/F30 一键建项（前端 `AiReadyCard`）**：`newProjectHint` 存在且目标为任务时显示「创建项目「X」」→ 复用 `POST /api/projects`；建成 toast（可「查看」深链）并把新项目 id 自动填入建议编辑表单的 `projectId`（仍需用户点「应用建议」才挂接，**绝不自动应用条目本身**）；note / resource 目标不提供入口（其 `projectId` 不落盘）。
- **F19/F31 澄清字段矩阵（前端 + `server/index.mjs`）**：新增 `src/lib/aiForm.ts` `CLARIFY_FIELD_MATRIX`（target × 可编辑字段，服务端同源）——task 全字段；note→title/tags/projectId/areaId；resource→title/tags/areaId；discard→无。`AiSuggestionForm` 增 `fields` 属性按 target 条件渲染；`AiReadyCard` 阅读态亦按 target 条件呈现元信息；`toClarifyDetails` 改为按 target 只挑会应用的字段。服务端对齐：`clarify` 的 note 分支接受 `projectId` / `areaId`（真实存在校验），resource 分支的 `title` 对**文件条目同样应用**并接受 `areaId`——结束「编辑被静默丢弃」。切换 target 保留仍相关字段编辑值。
- **样式（`src/styles/views.css`）**：新增 `.k-inbox-item__actions` / `.ic-lifecycle` / `.ic-confirm` / `.ic-confirm__text` / `button.k-pill.is-danger` / `.ic-ai__newproject`，全部 token-only、无渐变 / 发光。
- **验证**：`.qa/v33/smoke-v.mjs` **43/43**（remove 往返 + 附件 `GET /api/files` 由 200→404、discarded 恢复往返、clarified 撤回往返 + 已澄清 remove 409、note/resource target 字段矩阵真实落盘、resource 文件条目 title 覆盖、零残留 + 所有者未动）；`.qa/v33/slice-v-verify.py` **29/29**（文本捕捉自动解析启动 / 就绪卡、删除内联确认 → 离场 → 计数复原、丢弃行恢复 / 删除、澄清行查看产物深链 `/library?note=` + 撤回、`newProjectHint` 一键建项 → 快照出现新项目 → 清理归零、target 字段可见性矩阵、移动 390 零横溢、控制台 0、零残留 + 所有者数据未动）；截图 4 张（字段矩阵 / 一键建项 / 澄清深链 / 移动）。
- **记录**：ADR-0008 §6 修订（收件箱生命周期：文本即解析 / 删除入口 / 恢复 / 产物链接 / 字段矩阵）；`docs/02`（Slice V 增补）；`docs/04` §4.1 / §4.13 / §5.1；`docs/README.md`（ADR-0008 索引）；`public/guide.html`；`AGENTS.md`、`TASK_BOOK.md`。

### 回顾报告可读性 · 同期口径 · 去重 · Slice U（已完成 · 2026-10-03）
以 owner 反馈「生成的报告可读性太差」为规格：截图显示七段正文被塞进一个大 textarea 当一整块密文；进行中的月回顾拿「本月 3 天」去比「上月整月」（苹果对橘子，如「窗口仅 3 天，本月完成 2 项…上月 59」）；「下期行动」段与决策列表逐字重复。本切片把报告弹窗默认改为**阅读视图**（七段分节、舒适行距、可「编辑」切换），把环比对照改为**同期等长窗口**，并把第 6 段改为**指针去重**；归档 / 保存更新同条语义不变。`npm run build`（tsc strict + vite）通过；服务端冒烟 **23/23** + 纯函数单测 **25/25** + 浏览器 E2E **32/32**；零数据残留（回顾回到基线 2 条，所有者 rev-0001/rev-0002、t-0061/t-0062、i-0009/i-0010 未动）；控制台零 error；证据 `.qa/v32/`。

- **阅读视图（默认）+ 编辑切换（前端）**：新增 `src/lib/reviewReport.ts` `parseReviewSummary()`——把 `summary` 拆成七段 `{label, body}`，兼容「结论速览：…」与「一、结论速览」两种标题写法，别名归一（本期数据解读 → 数据解读 / 趋势对比 → 趋势与对比），无法识别时回退整段渲染；规则与 `server/ai.mjs` 同源。`src/views/Review.tsx` 报告弹窗默认阅读视图（`.k-report__sections` 序号 + 标题行 + 正文段落），底栏「编辑」切到既有 textarea、「完成」切回；保存 / 重新生成流程不变；报告历史（只读）弹窗复用同一阅读视图。纯文本、无 `dangerouslySetInnerHTML`；样式 token-only（`views.css`；`shell.css` `.k-modal--report` 加 `max-height` 让长报告内滚、底栏常驻）。数字护栏 `auditNumbers` 为文本级、保持生效。
- **同期口径（`server/ai.mjs`，核心修复）**：新增 `reviewWindows(now, monthly)` + `computeSameWindowPrevMetrics()`——进行中的周期对照上一周期**同等已走完长度**（月：本月 1..N 日 ↔ 上月 1..N 日，短月按上月末截断 `min(prevStart+elapsed, periodStart−1ms)`；周：本周至今 ↔ 上周同一星期数）。`generateReviewDraft` 弃用「`now` 落周期起点前 1ms 回退整周期」的旧算法；摘要 `prevLabel` 改「上X同期」并附对照窗口日期，`elapsedDays < 7` 时追加【窗口说明】（要求自然说明、禁止以「窗口仅 N 天」开场）。
- **去重与可读性规则（`server/ai.mjs`）**：新增 `dedupeActionSection(summary, decisions)`——第 6 段「下期行动」整段替换为一行指针「下期行动：见决策区（N 条）。」，完整 if-then 只留 `decisions`（空 decisions 时不动原文），从构造上杜绝逐字重复；`formatDelta(cur, prev)`（原 `deltaText`）——基准 ≥5 才出百分比，基准 <5 只给绝对变化 + 基准；`buildReviewDigest` 清单改「标题（id）」标题优先，`buildReviewSystem` 增补「叙述优先标题 / id 仅 decisions 括号补充 / 百分比基准 / 窗口不完整自然说明」规则。
- **验证**：`.qa/v32/guard-unit.mjs` **25/25**（同期窗口语义含短月截断与旧口径对照、分节 7 段与编号标题、去重指针与无逐字重复、百分比规则）；`.qa/v32/smoke-u.mjs` **23/23**（真实 monthly 一次：解析恰 7 段且标题齐全、第 6 段为指针、无 decisions 逐字原句、无小基准硬算百分比、结论不以「窗口仅 N 天」开场、自动归档 + 审计 `review.create` · auto + 零残留 + 所有者未动）；`.qa/v32/slice-u-verify.py` **32/32**（默认阅读视图无 textarea、七段分节、编辑 ↔ 完成、保存更新同条、历史阅读渲染、删除回基线、移动 390 零横溢、控制台 0、零残留 + 所有者数据未动）。
- **记录**：ADR-0013 新增 §6（Slice U 修订）；`docs/04` §4.10；`public/guide.html`（回顾报告措辞：默认阅读视图 + 同期对照）；`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md`。

### 标签生命周期（录入即生成 · 自动登记 · 管理 / 合并 / 删除 · 筛选条修正）· Slice T（已完成 · 2026-10-03）
以 owner 两条指令为规格：①「对于标签这种，没有生成由来，如果投入使用那不是用户使用体验崩塌吗」；②「类似于标签你完全可以在录入任务的时候判断后生成标签，但是你却没有做这一步」。修复标签全生命周期——注册表此前只由 seed 写入、运行时新标签从不登记、AI 被禁止生标签、筛选条只显示前 12 个、且没有任何管理入口。`npm run build`（tsc strict + vite）通过；服务端冒烟 **54/54** + 护栏单测 **14/14** + 浏览器 E2E **41/41**；零数据残留（inbox 10 / tasks 62 / projects 10 / notes 15 / resources 12 / tags 26；所有者 t-0001 未动）；控制台零 error；证据 `.qa/v31/`。

- **录入即生成 + 自动登记（`server/store.mjs`）**：新增 `normalizeTagName()` / `normalizeTagList()` 规格化（裸名 → `topic:` 前缀、`@` → context、合法前缀保留、空串丢弃），保证实体标签名与注册表 / 筛选条同名匹配；新增 `ensureTags(names, {origin, firstUsedIn})`——任意携带 `tags` 的写入（任务创建 / 更新、澄清 `details.tags`、项目创建 / 更新、笔记创建 / 更新、资料更新）之后把未注册名登记进 `data/meta/tags.json`（单写者队列 + 原子写），注册项新增可选 `origin: 'seed'|'manual'|'ai'` / `createdAt` / `firstUsedIn`，每个新标签审计 `tag.create`（`{name, origin}`）。向后兼容：旧 26 条种子记录无新字段照常读取，UI 缺省视作 `seed`；`scripts/seed.mjs` 同步补 `origin:'seed'` + `createdAt`。
- **AI 在录入时生成标签（`server/ai.mjs`）**：收件箱解析 `buildSystem` 与任务补全 `buildTaskDraftSystem` 放开——标签优先取注册表已有名，仅在确无合适标签且是稳定主题词（学科 / 领域）时才提议 `topic:名称`（≤12 字、最多 3 个、去重、禁日期 / 人名 / 整句）；`postValidate` 从「过滤掉注册表外标签」改为 `cleanTagSuggestions()` 规格化保留（超长新提议丢弃、已有名不受长度约束、总数 ≤3、去重），**臆造 `projectId/areaId/duplicateOf` 的过滤规则不变**。配套修复：收件箱 `toClarifyDetails` 此前从未把 `tags` 传给 clarify——现补上，AI 标签可随应用落盘（`origin:'ai'`）。
- **管理面板 + 端点（`server/index.mjs` / `server/store.mjs` / `server/schemas.mjs`）**：新增 `POST /api/tags/:id/update {name?, label?}`（重命名，级联重写全部实体 tags，审计 `tag.rename` · `detail.from/to/affected`；同名冲突 409）、`POST /api/tags/:id/merge {targetId}`（合并，级联替换 + 去重、源移除，`tag.merge`）、`POST /api/tags/:id/remove`（`usage>0` → 409 阻止并给出计数，不静默剥离实体标签；`usage==0` → 移除注册项，`tag.remove`）、`POST /api/tags/backfill`（扫描 `tasks/projects/notes/resources/events` 未注册名并登记，`firstUsedIn` 取首个使用实体，逐条 `tag.create` + `tag.backfill`）；`tagItemSchema` / `tagRegistrySchema` / `tagUpdateSchema` / `tagMergeSchema` + `ID_PATTERNS.tags`。级联只改 `tags` 数组、**不 bump `updatedAt`**（避免污染停滞项目 / 回顾口径）。
- **前端（`src/components/TagManager.tsx` + `src/views/Settings.tsx`）**：设置页新增「标签管理」区——列出全部标签（label / name / 命名空间 / 来源徽标【种子 / 手动 / AI】/ 使用计数 / 登记时间）、可搜索；行内「重命名 / 合并 / 删除」弹窗（删除使用中给出计数并禁用确认）；「扫描并登记现有未注册标签」按钮；成功后整体 `hydrateFromServer()` 刷新。`src/views/Library.tsx` 标签条去掉 `.slice(0, 12)`、按使用计数降序渲染全部主题标签并订阅数据版本；`src/lib/format.ts` `tagLabel` 改为运行时读注册表 + 新增 `TAG_ORIGIN_LABEL` / `tagOriginOf`；`src/lib/mutations.ts` 新增 `renameTag/mergeTag/removeTag/backfillTags` 与 `TaskCreateInput.ai`；`src/types.ts` `TagItem` 增 `origin/createdAt/firstUsedIn`；`TaskDraftModal` 创建时传 `ai:true`。
- **验证**：`.qa/v31/smoke-t.mjs` **54/54**（建任务带合成标签 → 登记 origin/firstUsedIn/namespace/createdAt + 审计；重命名级联；合并级联去重；删除使用中 409；回收站中移除 → 恢复得未注册标签 → `backfill` 登记；脱离后删除放行；零残留 + 所有者未动）；`.qa/v31/guard-unit.mjs` **14/14**（`postValidate` 保留 / 规格化新标签、超长与臆造 id 处理）；`.qa/v31/slice-t-verify.py` **41/41**（设置页标签管理可见、录入即生成即时可见、UI 重命名 / 合并 / 删除阻止与放行、扫描登记反馈、资料库标签条不截断含合成标签、移动 390 无横溢、控制台 0、零残留）。
- **记录**：新增 ADR-0014（`docs/decisions/0014-tag-lifecycle.md`）；`docs/02` §3.2 / §4.3；`docs/04` §4.11 / §4.12 / §9；`docs/README.md`（ADR 索引）；`public/guide.html`（资料筛选 / 设置卡片 / 快速新建段 + 标签录入即生成说明）；`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md`。

### 回顾报告升级（七段 · 有依据 · 可指导）+ 每次生成自动归档 · Slice L（已完成 · 2026-10-03）
以 owner 两条指令为规格：①「报告不够详细，要写得有价值和有参考以及指导性意见」+「通俗易懂」；②「每次生成的报告都按时间归档保存、可在某处查阅」。报告从「≤200 字泛泛小结」升级为**七段结构正文**（结论速览 → 数据解读 → 趋势对比 → 问题诊断 → 值得保留 → 下期行动 → 风险预警），输入侧注入上一周期指标 + 环比 + 阈值 + 带 id 清单，输出侧加**数字落地护栏**（越界单次纠正重试）；每次成功生成即**自动归档**一条回顾（复用 `reviews` 实体），回顾页新增**报告历史**按时间查阅。`npm run build`（tsc strict + vite）通过；服务端冒烟 **40/40** + 护栏单测 **6/6** + 浏览器 E2E **32/32**；零数据残留（回顾回到基线 2 条，所有者 rev-0001/0002、t-0061/t-0062、i-0009/i-0010 未动）；控制台零 error；证据 `.qa/v30/`。

- **输入侧加料（`server/ai.mjs` `buildReviewDigest`）**：新增「上一周期指标（对照）」与「环比（本 X 相对上 X）」两行（把 `now` 落在周期起点前 1ms 复用 `computeWeekMetrics` / `computeMonthMetrics` 回退一个周期）；习惯给出「近 7 天 / 上 7 天 / 目标 / 节奏 / 连续未达标周数」；完成 / 逾期 / 停滞清单改为带 id（`t-xxxx` / `p-xxxx` + 天数）；显式写出「逾期 / 停滞 / 习惯未达标」阈值常量。
- **七段报告指令（`buildReviewSystem`）**：`summary` 要求恰好 7 段、每段以结论式标题开头（`结论速览 → … → 风险预警`），≤800 字；硬性规则——只用摘要数字 / 日期 / 标题 / id、每个判断带证据、绝对值带对比基准、禁套话（显著 / 一定程度 / 多方面 / 持续发力 / 闭环 / 赋能 / 值得注意 / 综上所述 / 整体向好）、行动必须 if-then 含时间与完成标准、证据不足写「数据不足」；附弱 / 强例对照（字母占位防数字污染）。`decisions` 为 1–3 条 if-then；`staleAdvice` 语义不变。
- **数字落地护栏（`auditNumbers` / `extractQuantities`，导出于 `server/ai.mjs`）**：生成后抽取 `summary` 数字，断言其为摘要数字子集——允许字面命中、由摘要数字加减 / 百分比派生、结构性小数字（≤3）、年份；越界**单次纠正重试**（回喂越界数字），仍越界则保留并 `console.warn` 记录（不阻断）。服务端后校验再截断 summary ≤2000、decisions ≤3×200，防超产导致落盘失败。
- **自动归档（`server/index.mjs`）**：`POST /api/ai/review/draft` 成功后经 `commit('reviews', …)` 自动落一条回顾（`source:'ai'`、`date`=归档时刻、审计 `review.create` · `detail.auto`+`grounded`），响应附 `reviewId` / `archivedAt`；新增 `POST /api/reviews/:id/update`（白名单仅 `summary` / `decisions`，保留 id/type/periodKey/date/metrics/staleProjectIds，递增 `updatedAt`，审计 `review.update` · `detail.fields`），「保存回顾」更新**同一条**、不重复建；`/api/reviews/:id/remove` 删除不变。**每次生成 = 新增一个归档版本**（时间序可查阅），生成是用户显式动作故数量有界。
- **前端（`src/views/Review.tsx`）**：弹窗状态重构为「编辑最新（草稿或最新归档，保存即更新同条）/ 只读查看某条归档」；报告正文按换行切段、段首「标题：」渲染为独立小标题行（纯文本，无 `dangerouslySetInnerHTML`），编辑区加高（`rows=14`）；新增**报告历史**栏（`REPORT ARCHIVE`，按 `date` 倒序，显示类型 · 周期 + 归档时间 · AI 归档，点开只读弹窗、可删除）；生成后 `hydrateFromServer()` 让历史立即出现该条。新增 `src/lib/mutations.ts` `updateReview()`；`Review` / `ReviewDraft` 类型补 `source` / `updatedAt` / `reviewId` / `archivedAt` / `grounded`。
- **schema / 文档**：`reviewSchema` 增可选 `source` / `updatedAt`（向后兼容旧记录）。新增 ADR-0013（报告格式 + 归档决策 + 版本语义 + 与 ADR-0007 §2.5「确认才写入」的差异说明）；ADR-0007 §7 修订指针；`docs/02` §4.3 端点；`docs/04` §4.10 / §9；`docs/README` 索引；`public/guide.html`（回顾卡片 + AI 回顾报告措辞 + 红线 / FAQ 说明「报告生成即归档、可删除、编辑保存更新同条」）。
- **验证**：`.qa/v30/smoke-l.mjs` **40/40**（周 + 月各一次真实 AI：七段标记 / 段数≥5 / 环比存在 / 决策 1–3 条且 if-then；自动归档计数 +1、archive 记录含 summary 且 `source:'ai'`、审计 `review.create` · `auto`；update 同 id 往返 + `updatedAt` + 审计 `review.update` + 空摘要 400 / 不存在 404；remove 往返；零残留 + 所有者未动）；`.qa/v30/guard-unit.mjs` **6/6**（字面 / 派生通过、幻觉 987 判越界、结构小数字与年份放行、抽取器剔除周键 / 完整日期 / 行号）；`.qa/v30/slice-l-verify.py` **32/32**（生成 → 自动归档即时出现在报告历史 → 七段正文可编辑 → 保存后计数不变且同条更新 → 旧归档只读 → 删除回基线 → 移动 390 零横溢 → 控制台 0 → 零残留 + 所有者数据未动）。
- **记录**：ADR-0013；`CHANGELOG.md`；`TASK_BOOK.md`；`AGENTS.md`；`docs/02`、`docs/04`、`docs/README.md`；`public/guide.html`。
- **环境说明**：测试期间所有者（或并发进程）同时在用应用生成归档，E2E 改为**只跟踪并清理本次运行新增的 review id**、绝不删除基线已有记录；最终状态还原到提交基线（回顾 2 条）。

### 全站详情「居中弹窗」统一 + 操作统一 + 日历遮罩柔化 · Slice K（已完成 · 2026-10-03）
以 owner 四条指令为规格：①「所有的卡片都是居中弹窗样式」（笔记等详情仍是侧边抽屉）；②「弹窗不是说要优化为屏幕居中弹窗详情页吗，怎么没优化」（日历事件详情仍是侧边抽屉）；③「除了标记为完成后，编辑、删除按钮等没有出现，不能进行常规操作，全系统统一审阅后处理」（总览就地弹窗缺常规操作）；④「这个地方遮罩不太自然，优化一下」（日历吸顶日期条）。纯前端切片（服务端零改动、无新增端点）。`npm run build`（tsc strict + vite）通过；浏览器 E2E **109/109**；零数据残留（计数回到基线：收件箱 10 / 任务 62 / 项目 10 / 笔记 15 / 资料 12 / 回顾 2 / 回收站 0；所有者 t-0061/t-0062 与 i-0009/i-0010 未动）；控制台零 error；证据 `.qa/v29/`。

- **五类详情从右侧 `Drawer` 迁到居中 `Modal`（Deliverable 1）**：任务（Tasks）/ 项目（Projects）/ 笔记 · 资料（Library）/ 日程（Calendar）统一由 `src/components/Modal.tsx` 承载，新增尺寸变体 `.k-modal--detail`（`width: min(660px, 100vw-32px)`、`max-height: min(85vh, 900px)`、内容在 `.k-modal__body` 内滚动、≤640px 全宽 16px 边距）。打开触发（行点击 + 全部深链 `?task= / ?project= / ?note= / ?resource= / ?event=`）、ESC / 遮罩关闭、焦点圈闭 + 还原、关闭清挂载参数等语义不变；详情身体（TaskDetail / ProjectDetail / 笔记内联 / 资料内联 / 日程字段网格 + Relations）原样渲染。
- **操作矩阵统一（Deliverable 2）**：抽出 `src/components/TaskDetailModal.tsx`（任务：标记完成 / 取消完成 · 查看项目 · 编辑 · 删除）与 `src/components/ProjectDetailModal.tsx`（项目：编辑 · 删除），Tasks / Projects 页与总览就地弹窗**共用同一组件**——两处动作一致由构造保证（此前总览缺口述：任务弹窗无编辑 / 删除，项目弹窗无任何动作）。笔记（编辑 / 删除 / 蒸馏快捷设置）、资料（编辑 / 删除 / 状态快捷设置 / 打开文件 · 位置）保留既有能力；删除沿用回收站 + 撤销 toast，编辑沿用 `EntityEditForm`；日程保持只读（结构性缺口，见 ADR-0012 §5）。
- **底栏统一（Deliverable 3）**：详情底栏统一为 `.k-modal__foot-main`（靠左，主操作，`margin-right:auto`）+ `.k-modal__foot-actions`（靠右，安静动作：编辑 / 删除），样式集中到 `shell.css`；删除 `.k-drawer__foot-*` 与总览借用抽屉类的补丁规则（`.k-modal__foot .k-drawer__foot-main`）。
- **日历吸顶遮罩柔化（Deliverable 4）**：`.k-cal__bar` 保持吸顶（`top: var(--topbar-h)`），其下以 `::after` 叠一段 `--bg → transparent`、高 `--space-4` 的渐隐层（`pointer-events: none`）；滚动时面板在条底缘柔和浮现，替代原平铺色带的「一刀切」硬横线。
- **关键修复（E2E 发现）**：`Modal` 改为 `createPortal` 到 `document.body`。根因：详情弹窗挂在 `.k-route`（`container-type: inline-size` 含 layout containment）之下，`position: fixed` 的包含块被改成该祖先——正常行点击场景侥幸居中，但深链整页加载 + Chrome 滚动恢复时不再相对视口（实测水平偏 48px、纵向越界）。Portal 到 body 后 `fixed` 语义稳定为视口。
- **退役死代码（Deliverable 5）**：删除 `src/components/Drawer.tsx` 与全部 `.k-drawer*` 样式（含 `.k-drawer-scrim` / `.k-drawer__body` 具名容器）；容器名 `drawer → modal`（`docs/08` §5）；批条侧挂 dock `.ic-dock` 层级改挂 `--z-overlay - 1`；删除 `--drawer-w` / `--z-drawer` token。
- **验证（Deliverable 6）**：`.qa/v29/slice-k-verify.py` **109/109**——每类表面（任务 / 项目 / 笔记 / 资料 / 日程）行点击 + 深链均打开 `role=dialog` 居中弹窗、DOM 无 `.k-drawer`、水平居中偏差 ≤2px、在视口内；ESC 关闭 + 焦点还原到触发行 + URL 参数清除；任务完成切换 / 编辑保存 / 删除 → 回收站 + 撤销恢复；项目编辑 / 删除 + 撤销；笔记 / 资料编辑 / 删除 + 撤销；资料状态快捷设置写入；资料文件动作（打开文件 / 定位）在有 `path` 时出现；总览任务弹窗含 标记完成/编辑/删除 且点编辑出表单、总览项目弹窗含 编辑/删除 且点编辑出表单；移动 390 弹窗零横溢 + 居中；日历吸顶条贴顶（y=104 = `--topbar-h`）+ before/after 对照截图；控制台 0；零残留 + 所有者数据未动。
- **记录**：新增 ADR-0012（《全站详情统一为居中弹窗 + 统一操作矩阵》，含非目标 / 延后）；`docs/00 §5.6`、`docs/03 §5/§7/§9`、`docs/04`（抽屉 → 详情弹窗措辞）、`docs/05`（组件清单）、`docs/08 §5/§6`、`docs/README.md`（ADR 索引）；`public/guide.html`（抽屉 → 弹窗措辞 + 演示底栏补编辑 / 删除，保持自包含）；`AGENTS.md`。

### 先确认后写入 · Slice O（已完成 · 2026-10-03）
以 owner 两条强制指令为规格：①「我输入你好后居然没经过 AI 建议我确认然后直接入库，这是不行的」——任务快速新建在用户确认前**绝不能写库**；②「AI 初步处理后需要给到我充足的编辑以及操作空间，每个类似的地方都要这样」——凡 AI 产出即须先可编辑、确认、再落盘。「先确认后写入」成为统一模式。`npm run build`（tsc strict + vite）通过；服务端冒烟 **35/35** + 浏览器 E2E **31/31**；零数据残留（计数回到基线：收件箱 10 / 任务 62 / 项目 10 / 笔记 15 / 资料 12 / 回顾 2 / 回收站 0；所有者 t-0061/t-0062 「你好」与 i-0009/i-0010 未动）；控制台零 error；证据 `.qa/v28/`。

- **任务快速新建改为「草稿确认」弹窗（Deliverable A）**：回车不再即时创建，而是打开居中弹窗（复用 `src/components/Modal.tsx`，新增加宽变体 `.k-modal--compose`）。打开即异步请求 `POST /api/ai/task/draft`（安静「AI 正在补全…」态），返回后把 `contexts / energy / importance / estimateMin / dueAt / projectId / areaId / tags` 预填为**全部可编辑控件**（宽松两列网格，标题独占整行）；**绝不改写用户标题**，且 AI 返回时**跳过用户已改动的字段**（`touchedRef`），不覆盖用户输入。底部「创建任务」（主，标题非空才可用）「取消」「重新补全」。ESC / 遮罩 / 取消 → **零写入**；AI 离线 / 慢 / 失败时表单仍完全可用，创建不被阻断（空白字段走服务端默认）。成功后沿用 toast「已创建任务 · 撤销」（撤销＝移入回收站，复用既有机制）。旧「创建后内联 AI 建议面板」及其 `.k-ai-draft*` 样式整体退役。
- **`POST /api/tasks` 扩展（服务端）**：在 `title` 必填不变的前提下，接受可选白名单字段（`server/schemas.mjs` 新增 `taskCreateFieldsSchema`，与澄清覆盖同口径）；`projectId / areaId` 做形状 + 存在性校验（臆造即 400）；缺省维持既有默认（`contexts ['@computer']` / `energy 'low'` / `importance 2` / `tags []`）；审计 `task.create` 的 `detail.fields` 列出本次携带的字段。仅传 `{ title }` 的旧调用行为完全不变。
- **收件箱建议卡可编辑（Deliverable B）**：`AiReadyCard` 增加「编辑」开关，展开统一字段表单（`src/components/AiSuggestionForm.tsx`）——目标（task/note/resource/discard 下拉）/ 标题 / 上下文 / 标签 / 能量 / 重要性 / 预估 / 截止 / 项目 / 区域，宽松两列、全行宽。应用时提交**当前（可能编辑过的）值**，仍走既有 `POST /api/inbox/:id/clarify`（`details` + `ai:true` 审计不变）；「忽略」「重新解析」语义不变，重新解析重置为全新建议；编辑为纯客户端态，应用前不落盘。批量解析自动继承同一组件，编辑互不干扰。
- **共享层（新增）**：`src/lib/aiForm.ts`（表单值类型 + `suggestionToForm` / `draftToForm` / `applyFormToSuggestion` / `formToTaskCreate` 换算）+ `src/components/AiSuggestionForm.tsx`（受控字段网格，token only）；`src/components/TaskDraftModal.tsx`（弹窗编排）。`src/lib/mutations.ts` 的 `createTask` 改为 `TaskCreateInput` 对象。
- **「每个类似的地方」审计（Deliverable C）**：结论表见 `TASK_BOOK.md` Slice O 节——收件箱建议卡（已改）、任务补全（已改）、回顾报告弹窗（本就为可编辑 textarea，确认后保留）、AI 对话（无落盘动作，不适用）、`newProjectHint`（收件箱卡内，已随卡可编辑）；**项目快速新建无 AI 处理 → 明确不在范围**（记录理由）。
- **验证**：`.qa/v28/smoke-o.mjs` **35/35**（仅标题默认值 / 全字段往返 / 审计 detail.fields / 8 类失败分支 400 / 所有者数据未动 / 零残留）；`.qa/v28/slice-o-verify.py` **31/31**（弹窗打开**确认前快照计数不变**这一核心断言 → AI 补全就绪 → 编辑 importance=3 → 创建 → 新任务带该值 + 审计 → 撤销入回收站；ESC 取消零写入；收件箱建议卡编辑目标/标题/重要性 → 应用 → 新任务带编辑值 + `inbox.clarify.task ai:true`；移动 390 弹窗 + 表单零横溢；控制台 0；零残留 + 所有者数据未动）。
- **记录**：ADR-0011 §6 修订（草稿先行取代即时创建 + 补全，保留历史与反转理由）；`docs/02 §3.2 / §4.3`；`docs/04 §9`；`docs/05`（新文件）；`public/guide.html` 快速新建措辞；`AGENTS.md`。

### 收件箱附件「打开文件 / 位置」· Slice J2（已完成 · 2026-10-03）
以 owner 反馈为规格：收件箱点附件「查看文件」得到的是浏览器**下载**，而不是用本地默认程序打开文件、或定位到文件管理器。改为两个安静 pill（「打开文件」/「位置」）经数据服务本机动作执行；UI 不再有下载链接。`npm run build`（tsc strict + vite）通过；服务端冒烟 **33/33** + 浏览器 E2E **21/21**；零数据写入（前后快照计数一致、trash 0、i-0009/i-0010/i-0011 未变、`data/files/` 无增删）；控制台零应用 error；证据 `.qa/v27/`。

- **根因**：`src/views/Inbox.tsx` 的「查看文件」是 `<a href="/api/files/:id" target="_blank">`；服务端 `serveFile` 虽 `Content-Disposition: inline`，但浏览器对 `.docx` 等不可内联展示的类型一律走下载。
- **服务端本机动作（`server/index.mjs`）**：抽出 `spawnDetached`（`detached + stdio ignore + windowsHide + unref`，不阻塞请求）与 `statLocalPath`（存在性校验，缺即 404），既有 `POST /api/reveal` 复用之；新增 `POST /api/open`（`cmd /c start "" "<path>"`，走系统文件关联 → 默认程序）与收件箱专用 `POST /api/inbox/:id/open|reveal`——服务端按 `data/files/<id>-<file.name>` 解析路径，条目 / 附件元数据 / 磁盘文件三重校验，缺一 404。open/reveal 均回 `{ ok, path }`；仍仅 `127.0.0.1:4097` 本机可达。
- **dryRun 测试通道**：`POST /api/inbox/:id/(open|reveal)` 与 `POST /api/open` 均接受 `{ dryRun: true }`——仅解析 + 校验并回传路径，**绝不 spawn**（自动化测试专用；真实 UI 永不传）。ADR-0008 §4 记载。
- **前端（`Inbox.tsx`）**：附件行由单个下载 `<a>` 改为「打开文件」（`FileText` 图标）+「位置」（`FolderOpen` 图标）两个 `.k-pill.is-ghost` 按钮，分别调 `openInboxFile` / `revealInboxFile`，失败 toast（「打开失败：…」/「定位失败：…」）。`GET /api/files/:id` 保留（UI 不再引用）。
- **资源对齐（`Library.tsx`）**：资料抽屉「文件位置」在「在文件管理器中显示」旁补「打开文件」（经新 `POST /api/open` / `openPath`）——与收件箱同一姿态。当前数据集无带 `path` 的资源，故该按钮未被 E2E 触达（数据驱动，不为此写 owner 数据）。
- **验证**：`.qa/v27/smoke-j2.mjs` **33/33**（上传合成 `.txt` → open/reveal `dryRun:true` 200 + 路径以期望文件名结尾 + 磁盘存在 + `dryRun:true`；`POST /api/open {dryRun:true}` 200 + 路径一致 + 缺失路径 404；通用 `/api/open` 缺失路径 404 / 空路径 400（失败分支，绝不 spawn）；缺失 id 404；非法 id 400；remove 清理附件 + 条目；审计含 `inbox.upload` / `inbox.remove`；零残留）；`.qa/v27/slice-j2-verify.py` **21/21**（Playwright 拦截 `**/api/inbox/*/(open|reveal)` 并 fulfill——展开附件行出现两 pill、旧下载 `<a>` 不存在、点击命中正确端点、成功无错误 toast、mock 500 → 「打开失败」/「定位失败」错误 toast、移动 390 零横溢、排除 2 条 mock-500 资源日志后控制台零应用 error、零写入、i-0009/i-0010/i-0011 未变、`data/files/` 无增删）。
- **记录**：ADR-0008 §4 修订；`docs/04 §4.1`；`CHANGELOG.md`；`TASK_BOOK.md`；`AGENTS.md`（安全节 + 变更记录）。

### 收件箱修复包 2 · Slice J（已完成 · 2026-10-03）
以 owner 两条反馈为规格：①「批量 AI 解析后切页再回来，一切回到原始状态」（好像没解析过）；②「内置 opencode 为什么连文件都阅读不来」（投递 `.docx` 后 AI 只说「无法读取 / 仅凭文件名判断」）。`npm run build`（tsc strict + vite）通过；服务端冒烟 **14/14** + 浏览器 E2E **16/16**；零数据写入（前后快照计数一致、trash 0、i-0009/i-0010 JSON 完全未变）；控制台零 error；证据 `.qa/v26/`。

- **AI 解析状态提升到模块级（新 `src/lib/inboxAi.ts`）**：新增收件箱 AI 解析 store（`subscribeInboxAi` / `getInboxAiSnapshot` + `useSyncExternalStore`）——批量任务 `{running,current,total,activeId,phase,stage,text,reasoning,result,error}`、流式增量 ~100ms 节流、单条建议缓存（原 `Inbox.tsx` 模块 Map 迁入）全部跨路由切换存活；导出 `startBatchAi` / `runSingleAi` / `clearInboxAiActive` / `reconcileInboxAiCache` / `takeInboxAiCompletion` / `takeInboxAiFailures`。解析仍**零写入**（`data/` 不变，reload 丢失属预期）。
- **返回即见真实状态**：切页期间批量继续跑；回 `Inbox` 后进度条按真实 `running` 显示，活跃条目行显示「解析中…」并恢复实时过程面板（自动展开 + 轻柔滚入），已完成条目行显示安静 token 标记「AI 建议就绪」（无需再次点击；展开即命中缓存）。
- **防重复启动**：内联批量条与 E2.5 侧挂 dock 的全部批量动作（批量 AI 解析 / 批量 → 任务 / 批量丢弃 / 取消选择）据模块 `running` 禁用——切页回来再勾选仍禁用。
- **完成播报一次**：切页期间完成 → 回收件箱补播一次安静 toast「AI 解析完成 · N 条建议已就绪」；失败汇总为一次「N 条失败，已跳过」（绝不刷屏）。缓存命中点击「AI 解析」直接展开就绪卡（不重解析），强制重试走「重新解析 / 重试」。
- **OOXML 文本抽取（`server/ai.mjs`）**：无新依赖的最小 ZIP 读取器（EOCD + 中央目录；method 8 → `inflateRawSync`，method 0 原文，`maxOutputLength` 防爆内存）→ `.docx`（`word/document.xml`）、`.pptx`（`ppt/slides/slide*.xml` 数字排序）、`.xlsx`（`xl/sharedStrings.xml`）；剥标签 + 解 XML 实体 + 段落 `<w:p>/</a:p>/</si>` 转行 + 归一空白 → 沿用既有 8000 字摘录与「内容摘录」格式。任何失败 → 维持既有 `FILE_UNREADABLE_HINT` 回退 + 5MB 上限；同步 / 流式两路共用受益。系统提示「附件不可读时更保守」规则未动（docx 现在可读）。
- **验证**：`.qa/v26/smoke-j.mjs` **14/14**（合成 docx method 8/0 + 探针「KERNEL-DOCX-PROBE-42」命中 + 实体解码 + `buildFileSection` 摘录 + 伪 docx 回退 + `data/files/` 零残留）；所有者真实 `示例文档.docx`（i-0009 / i-0010，只读）抽取 **1118 字**，不含不可读提示，条目 JSON 未动；`.qa/v26/slice-j-verify.py` **16/16**（选 2 条 → 批量 AI 解析 → SPA 切 `/tasks` → 回 `/inbox`：状态未重置、运行中批量全禁用、返回后重选仍禁用、两条目均出「AI 建议就绪」、展开缓存命中 3ms、点击「AI 解析」无过程面板、控制台 0、移动 390 运行 / 完成两态零横溢、零写入、i-0009/i-0010 完全未变）。
- **记录**：ADR-0008 §4 修订（批量状态持久化 + OOXML 抽取）；`docs/05`（`inboxAi.ts`）；`AGENTS.md`。

### 使用指南同步 · Slice I（已完成 · 2026-10-03）
将自包含中文使用指南 `public/guide.html` 同步到 Slice D–H 的现状（指南此前停在上一个版本）。仍是单文件、内联 CSS/JS、零外部请求，`file://` 双击与 `http://localhost:5173/guide.html` 均可用；沿用既有「柔暗夜色」token，不引入新视觉语言。

- **页面速览（04）**：八张卡逐页补入新交互——总览（状态条三段 / AI 对话盒 / 就地弹详情）、收件箱（文件投递 / 批量 AI 解析 / 侧挂批量条）、任务（快速新建 AI 建议 / 共用详情的编辑删除）、项目（快速新建 / 就地弹详情）、资料（状态五档与判断标准 / 笔记蒸馏 L0–L3 / 文件定位）、回顾（周月卡并列 / AI 解析弹窗报告 / 停滞项目迁移归档）。
- **AI 章节（05）**：由「两件事」扩为解析（含批量与文件先读）/ 对话盒（读库问答 + 清空即归档为笔记）/ 快速新建建议 / 周月回顾报告，并更新「三条红线」措辞（强调建议永不自动应用）；新增一处**静态对话示例**（`figure.chatmock`，复用 token，非交互）。
- **其余**：五分钟上手补文件投递与批量；「一条内容的一生」回顾行改周 / 月 + 弹窗；深链补 `/library?resource=` 与 `/trash`；心法增「清空即归档」「建议要你点头」；快捷键补对话盒 Enter 与 ESC 适用范围、命令面板增「新建项目」；FAQ 增三条（清空对话归档去向 / AI 建议是否自动应用 / 误删走回收站）；页脚版本串改 `KERNEL v0.5.0（切片） · 2026-10-03`。
- **交互演示保留**：任务详情居中弹窗（`role=dialog` / ESC / 焦点还原 / 滚动锁定）原样保留，未回归。
- **验证**：Python Playwright `.qa/v25/guide-verify.py` **65/65**——dev 桌面 1600×1000 / dev 移动 390×844 / `file://` 三态，新内容命中、控制台零 error、桌面与移动零横溢、`file://` 无外部子资源请求、TOC 滚动高亮 JS 生效、交互演示 a11y 通过。证据 `.qa/v25/`（四张截图 + `guide-verify.log`）。
- **边界**：仅动 `public/guide.html` 与 `.qa/v25/**` + 三份文档；未触碰 `src/**`、`server/**`、`data/**`、`design-drafts/**`，未重启服务（静态文件）。

### 状态贯通 + 全站同类审计 + 任务快速新建 AI 判断 · Slice H（已完成 · 2026-10-03）
以 owner 三条指令为规格：① 资料页「状态」无判断标准 / 无设置按钮——解决后全面检查同类问题；② 笔记蒸馏层级可设；③ 任务快速新建需 AI 判断（否则「没有详细内容」）。`npm run build`（tsc strict + vite）通过；服务端冒烟 **21/21** + 浏览器 E2E **28/28**；零数据残留（回到基线：收件箱 9 / 任务 60 / 项目 10 / 笔记 14 / 资料 12 / 回顾 2 / 回收站 0）；控制台零 error；证据 `.qa/v24/`。

- **状态判断标准**：`src/lib/format.ts` 新增 `RESOURCE_STATUS_DEF`（未读 / 在读 / 读完 / 参考 / 归档）与 `DISTILL_LEVEL_LABEL` / `DISTILL_LEVEL_DEF`（L0 原文 / L1 划线 / L2 摘要 / L3 永久）；抽屉内以安静 helper 文本呈现（每项 `title` 带该档定义），文案与 `docs/04 §4.8 / §4.9` 一致。
- **快捷设置**：`src/views/Library.tsx` 新增本地 `QuickSegmented`（复用 `.k-lib__seg` 轨道 + `TagPill` 选中反转，token only）——资料抽屉「状态 · 判断标准」、笔记抽屉「蒸馏层级 · 判断标准」直接设置，经既有 `POST /api/(resources|notes)/:id/update` 写入（审计 `resource.update` / `note.update`）+ toast 撤销回原值。
- **白名单扩充（让「已显示」的字段可设）**：`server/index.mjs` `EDITABLE_FIELDS`——`notes` 增 `areaId / projectId / distillLevel`、`resources` 增 `areaId`、`projects` 增 `goalId / nextActionId`；对应编辑表单补下拉（`Library.tsx` 笔记区域 / 项目、资料区域；`Projects.tsx` 下一步 / 目标）。
- **任务快速新建 AI 补全（`POST /api/ai/task/draft`）**：`server/ai.mjs` 新增 `draftTask(title)` + `buildTaskDraftSystem` + `TASK_DRAFT_MAX_TITLE_CHARS=200`（沿用 `buildDigest` 上下文注入 + 指令式 JSON + `taskDraftSchema` + 快照后校验过滤臆造 id / 标签 + 单次重试 + 120s 超时；**只出建议，不落盘**）；路由标题非空 400 / health 503 / 失败 502。前端创建即时完成，随后异步取建议，在工具条下方显示安静、可忽略的内联面板（loading / ready / error + 重试；`role=status` + `aria-live`）；**应用建议** 经 `POST /api/tasks/:id/update` 写入（审计 `task.update`），**忽略** 零写入，失败不阻断创建；无可应用字段时不弹面板。`mutations.ts` 新增 `TaskDraftSuggestion` / `TaskDraftResult` / `aiTaskDraft`。
- **全站同类审计**：扫描全部视图与详情，产出「已展示但不可操作 / 无判断标准」结论表（见 `TASK_BOOK.md` Slice H 节）——本切片修复上述可写实体的小口子；结构性缺口（事件全实体、区域 / 目标 / 习惯管理、笔记 `links`、任务 `parentTaskId`、已保存回顾编辑、`review.metrics.migrated` 恒空、回顾「迁移」实为 touch、收件箱内容编辑 / 删除入口、标签注册表管理）显式延后并记录；「笔记沉浸式阅读与撰写体验」（owner 15:58）作为延后 backlog。
- **验证**：`.qa/v24/smoke-h.mjs` **21/21**（真实 AI 草稿 7.0s 返回含 `@lab / energy / estimateMin / dueAt / areaId / tags` 的建议；空标题 400；note / resource / project 新增字段往返 + 审计 + 零残留）；`.qa/v24/slice-h-verify.py` **28/28**（资料状态 / 笔记蒸馏快捷设置持久化 + 还原；三处编辑表单字段存在性；快速新建 AI 建议就绪 → 应用 → 字段更新 + 审计 `task.update`，第二条走忽略路径；移动 390 零横溢；控制台 0；零残留回到基线 + 回收站 0）。
- **记录**：ADR-0011；`docs/02 §3.2 / §4.3`（端点）；`docs/04 §4.8 / §4.9 / §9`（判定标准 + 可设置 + 白名单）；`docs/README` 收录 ADR-0011；`AGENTS.md`。

### 总览升级 · Slice G（已完成 · 2026-10-03）
以 owner 三条指令为规格：① 状态条下方加「能对话的 AI 盒」——读库回答（例「我今天有什么特别紧急需要去做的事情」），清空对话前按时间命名归档为可查阅文本；② 顶部三胶囊左右不对齐、要换展示方式；③ 工作台条目点击就地弹详情（不跳转、不无高亮）。`npm run build`（tsc strict + vite）通过；浏览器 E2E **42/42**；零数据残留（回到基线：收件箱 9 / 任务 60 / 项目 10 / 笔记 14 / 资料 12 / 回顾 2 / 回收站 0）；控制台零 error；证据 `.qa/v23/`。

- **AI 对话盒（新 `src/components/OverviewChat.tsx`）**：置于状态条之下、工作台之上；视觉复用收件箱编辑器 `.ic-composer`（圆角 / 抬升表面 / 柔影 / 圆环强调发送）；默认紧凑，消息存在时在其上方展开安静线程面板（`.k-chat__thread`，定高 `max-height` 可滚、纯文本渲染、无 `dangerouslySetInnerHTML`）；Enter 发送 / Shift+Enter 换行；发送后同步显示「思考中…」加载态；AI 离线 / 失败显示错误态 + 「重试」（对话保留）；「清空对话」在空 / 进行中禁用。
- **AI 对话端点（`POST /api/ai/chat`，无状态）**：`server/ai.mjs` 新增 `buildChatDigest` / `buildChatSystem` / `chatWithKernel` 与 `CHAT_MAX_MESSAGES=20` / `CHAT_MAX_CHARS=4000` / `CHAT_TOTAL_CHARS=16000`。路由按有界历史裁剪（末条须为用户消息，否则 400）；摘要含 现在 / 逾期任务 / 今日到期 / 未来 7 天日程 / 收件箱积压 / 进行中项目 / 高优先下一步；系统提示要求只依据摘要事实、最紧急按「逾期 → 今日到期 → 日程」排序；自然语言输出（不解析 JSON）；`variant:'low'` + 120s 超时 + 单次重试；health 503 / 失败 502；**不落盘**。实测真实回复约 5s。
- **清空即归档为笔记（通用 `POST /api/notes`）**：新增 `createNote`（`title` 非空 400；`type` 白名单缺省 `memo`；`nextId('notes')` + `commit` 审计 `note.create`；201）。前端「清空对话」非空时**先** `createNote({ title:'AI 对话归档 · YYYY-MM-DD HH:mm', body: transcript, type:'memo' })`（`**我**` / `**KERNEL**` 交替 markdown），**成功才清空**并 toast「已归档为笔记 · 查看」→ 跳 `/library?note=<id>`（深链打开该笔记）；归档失败不清空 + 错误 toast。`src/lib/mutations.ts` 新增 `chatWithAi` / `createNote` / `AiChatMessage`。对话为模块级 store 会话级持久（跨路由存活，刷新丢失）。
- **状态条重做（owner 反馈「右缘参差」）**：`.k-status` 整宽 `grid-auto-flow:column; grid-auto-columns:minmax(0,1fr)`——三段（下一项 / 收件箱 / 逾期）等分、左右边缘严格贴版心（实测 228.00 / 1468.00，与 `.k-view` 一致）；三段均为可聚焦按钮（下一项 → `/calendar`、收件箱 → `/inbox`、逾期 → `/tasks`）；逾期恒显示（0 项用安静点）；≤640px 竖排、段间横线。原 `.k-chips` / `.k-chip` 样式保留未动。
- **就地详情弹窗（owner 反馈「跳转后不知在哪」）**：抽出 `src/components/TaskDetail.tsx` 与 `src/components/ProjectDetail.tsx`（自 Tasks / Projects 抽屉内联 JSX 原样迁移），两页抽屉改为引用同一组件（行为不变）；`Overview` 用既有 `Modal.tsx` 承载——工作台任务行 → 任务弹窗（`role=dialog`、URL 仍为 `/`、标题一致、底部「标记完成 / 取消完成」+ 条件「查看项目」、ESC 关闭 + 焦点还原到触发行）；项目推进条 → 项目弹窗。日程行行为不变。
- **验证**：`.qa/v23/slice-g-verify.py` **42/42**——状态条三段 / 左右边缘对齐 / 点击三条跳转；对话盒几何（状态条下、工作台上、左右对齐）；发送 → 加载态 → 真实 AI 回复（514–698 字）→ 多轮第二条回复；清空 → notes +1（标题正则 `AI 对话归档 · YYYY-MM-DD HH:mm`、body 含 `**我**`/`**KERNEL**`、`type=memo`）→ 线程清空 → toast「查看」跳 `/library?note=n-0015` 并打开；任务 / 项目就地弹窗（role/URL/标题/ESC/焦点还原）；移动 390 零横溢 + 弹窗在视口内；控制台 0；零残留 + 回收站归零。`npm run build` 通过。

### 回顾页重构 · Slice F（已完成 · 2026-10-03）
- **布局重排（owner 指令）**：周回顾 / 月回顾两张卡改为**并列一栏**，移到「能量分析」之上；停滞项目独立为全宽一栏；指标瓦片从页级移入各周期卡（有保存回顾或草稿时显示）；「能量分析」与「本周完成」并陈于图表区（route <900px 单列）。
- **每卡 AI 解析 + 动画弹窗**：新增 `src/components/Modal.tsx`——居中弹窗，240ms 淡入 + 微缩放（`useReducedMotion` 降级），ESC / 点击遮罩关闭，`trapTab` 焦点圈闭 + 关闭还原焦点，`role="dialog"` / `aria-modal` / `aria-labelledby`，打开时锁定页面滚动；视觉取自 `public/guide.html` 任务详情演示。每张周期卡有「AI 解析 / 重新生成」按钮（进行中 / 错误态沿用安静样式）；「查阅报告」打开弹窗，展示指标 + 摘要 + 决策 + 停滞处置建议，并保留草稿编辑 → 保存 → 撤销 toast（撤销即删除）闭环；已保存回顾以只读方式查阅。
- **月回顾 AI 支持（服务端）**：`server/ai.mjs` 新增 `computeMonthMetrics`（窗口 = 本机时区 1 日 00:00 → now；captured / created / completed / overdue 口径与 `computeWeekMetrics` **完全一致**）与 `monthKey`（`YYYY-MM`，镜像前端 `toMonthKey`）；`buildReviewDigest` / `buildReviewSystem` 参数化 `scope`（周 / 月）；`generateReviewDraft(period='weekly')` 缺省周行为不变。`server/index.mjs`：`POST /api/ai/review/draft` 接受 `{ period:'weekly'|'monthly' }`（非法 400，缺省 weekly）；`POST /api/reviews` 接受 `{ type:'monthly' }` → `type:'monthly'` + `periodKey:'YYYY-MM'` + 月指标，缺省周不变。保留单次重试 + Zod + 按实际停滞集合过滤臆造 id 的安全模式；`reviewSchema` 已支持 monthly（字段无需变更）。
- **前端写入通道**：`src/lib/mutations.ts` `generateReviewDraft(period)` / `saveReview(summary, decisions, type)`（缺省 weekly，向后兼容）。
- **验证**：`npm run build`（tsc strict + vite）通过；服务端冒烟 `.qa/v22/smoke-f.mjs` **13/13**（monthly 201 + `periodKey 2026-10` + 4 项指标 + 周缺省不变 + 非法 period 400 + 删除 + 零残留）；月度草稿真实 AI 返回 200（`periodKey:2026-10`，4.8s，证据 `.qa/v22/monthly-draft.json`）；浏览器 E2E `.qa/v22/slice-f-verify.py` **30/30**（卡片栏在能量之上几何断言 516≤543、两卡同行 y189/189、停滞独立栏空态、弹窗 role/aria/动画落定/焦点进入/ESC+焦点还原/遮罩关闭、周回顾真实 AI 草稿 → 弹窗报告 160 字摘要 + 5 指标、月度草稿端点 + `POST /api/reviews` 落盘 + 撤销删除 + 月度卡 UI 查阅、控制台零错误、零残留回到基线：收件箱 9 / 任务 60 / 项目 10 / 笔记 14 / 资料 12 / 回顾 2）；移动端 `.qa/v22/slice-f-mobile.py` **6/6**（390 零横溢 + 单列堆叠 + 弹窗适配 + ESC）。
- **记录**：ADR-0007 §6 修订（月回顾扩展）；`docs/04 §4.10`（monthly 生效 + periodKey 口径）；`docs/05`（`Modal.tsx`）；`AGENTS.md` 变更记录。

### 趋势图数据点裁切修复 · Slice E2.7（已完成 · 2026-10-03）
- **问题（owner 反馈）**：总览「完成趋势 / 到期负载」sparkline 中，贴底数据点（值 0 → viewBox y=100）被 SVG 视口裁掉下半圆——owner 截图圈注「小圆点被遮盖」。
- **修复**：`src/styles/components.css` `.k-line__svg` 增 `overflow: visible`——零长度路径 + 圆头端帽绘制的数据点在基线处完整显示（下溢约 3.5px 落入与下方元素的既有间隙，不影响布局）；总览 / 回顾两处 `TrendLine` 同步生效。
- **验证**：`.qa/v21/slice-e27-verify.py` **8/8**——总览 / 回顾双页 `overflow=visible` 断言；总览完成趋势 7 点中 6 点为贴底点；像素级前后对照（基线下方墨色 0px → 290px，半圆修复为整圆）；控制台零错误；只读零写入（前后快照计数一致）。`npm run build` 通过。证据 `.qa/v21/`（before / after 对照 + 3x 放大 + 回顾页回归截图）。
- **记录**：本条目 + `TASK_BOOK.md` + `AGENTS.md`。

### 动效与布局稳定 · Slice E2.6（已完成 · 2026-10-03）
以 owner 反馈五连为指令：批量 AI 解析看不见过程 / 展开区黏连 / 资料筛选横滚 / 流式抖动 / 列表重叠。
- **批量解析过程可视**：批量 AI 解析复用单条流式路径（`runParse`）——当前条目自动展开并显示实时过程面板（阶段 + 增量预览），条目不在视口内时轻柔滚入（尊重 `reduced-motion` → 瞬时）；绝不自动应用。
- **流式增量节流**：SSE delta 先入 ref 缓冲，约 100ms 节流 flush 到 React state——消除高频逐帧重渲染造成的抖动。
- **展开区呼吸间距**：`.ic-subrow` 顶距 `--space-3`（实测 12px）——展开内容与条目行不再「黏在一块」（内边距不产生 box 间隙，故用外边距）。
- **流式面板定高**：过程面板阶段行单行省略；预览固定 3 行高度（溢出隐藏 + 最新贴底 + 顶部渐隐遮罩）——解析期间面板高度极差 **0.00px**、下方元素零漂移；AI 卡阶段切换微淡入（`k-ai-fade`）。
- **资料筛选条换行**：`.k-lib__filters` 由横向滚动改自然换行——1280 / 390 均无横向溢出（`scrollWidth === clientWidth`）。
- **任务列表切换不重叠**：`motion.tr` 去 `layout` 与位移动画（保留透明度渐入 + stagger）——过滤切换过渡期间任意两行不相交（`overlaps=0`）。
- **验证**：`.qa/v20/slice-e26-verify.py` **22/22**——含批量解析过程可视 / 缓存 3ms 就绪 / 间距 12px / 筛选条双断点零溢出 / 流式面板极差 0.00px / 任务列表 overlaps=0 / 零残留回到基线 / 控制台零错误；`npm run build` 通过。证据 `.qa/v20/`（`e26-batch-live.png` / `e26-stable.png` / `e26-task-transition.png`）。

### AI 挂靠判断 + 项目闭环 + 批量条侧挂 · Slice E2.5（已完成 · 2026-10-03）
- **AI 挂靠判断修正（宁缺毋滥 + 新事务提示）**：`server/ai.mjs` 系统提示词修订——① 挂靠宁缺毋滥：只有当内容与现有项目 / 区域 / 标签有明确依据时才填，**表面相似（如都含「竞赛 / 比赛 / 规则」字样）不算依据**，拿不准一律 null；② 附件不可读（仅文件名 / 元数据）时更保守：除非文件名直接指向某现有项目（名称 / 主题强匹配），否则 `projectId` 一律 null，并在 reason 注明「仅基于文件名判断」；③ 新增 `newProjectHint`（string|null，≤40 字）：内容像一件需要多步推进的**新事务**（新比赛 / 新活动 / 新项目）且不属于任何现有项目时给出建议项目名（例「辩论赛筹备」）；④ `newProjectHint` 与 `projectId` **互斥**。
- **schema + 后校验**：`aiSuggestionSchema` 增 `newProjectHint: z.union([z.string(), z.null()]).optional()`；`normalizeSuggestion` 丢弃 null；`postValidate` trim + 截断 40 字 + 丢弃空串、与 `projectId` 互斥、与现有项目标题完全相同者丢弃。前端 `AiSuggestion.newProjectHint?`。
- **收件箱建议卡**：`newProjectHint` 存在时安静显示「建议新项目：{X}」+ 小灰字「可到项目页新建」（仅提示，绝不自动建 / 不自动挂）。
- **项目「新建」**：`server/index.mjs` 新增 `POST /api/projects { title, areaId? }`——title 非空（400）；创建 `{ id: nextId('projects'), title, outcome:'完成定义待整理', status:'active', areaId: areaId ?? 'a-0001', tags:[], createdAt, updatedAt }`；审计 `project.create`；201 `{ project }`。前端 `mutations.createProject`；`src/views/Projects.tsx` 增快速新建输入（镜像任务页 `.k-quickadd`，占位「新建项目，回车创建（写入 data/projects）」）→ Enter 创建 → upsert → toast「已创建项目 · 撤销」（撤销 `trashEntity` 进回收站，失败错误 toast）。
- **回顾页停滞按钮真实接通**：`server/index.mjs` `updateEntity` 支持**空 patch = touch**——无白名单字段时仍 `updatedAt = nowIso()`，审计 `<singular>.touch`（有字段仍为 `.update`）；`src/views/Review.tsx` 归档 → `updateEntity('projects', id, { status:'archived' })` → toast「已归档 · 撤销」（撤销回 active）；迁移 → 空 patch touch → toast「已重决策：继续推进」（行消失至 14 天后）；两处「原型态」文案移除；`Review` 增 `useDataRevision()` 订阅以即时重渲染。
- **批量条侧挂 dock**：`src/views/Inbox.tsx` 以 `IntersectionObserver` 观察内联批量条 `.ic-batchbar`；滚出视口时在右缘纵向居中显示窄列浮动 dock（`已选 N 项` + 「批量 AI 解析」/「批量 → 任务」/「批量丢弃」/「取消选择」，与内联条**同一状态与处理器**，禁用态一致，含批量进度播报）；`motion` fade/slide 进场（`useReducedMotion` 降级）；回到视口即隐藏；`z-index: calc(var(--z-drawer) - 1)` 位于抽屉层级之下、≤767px 隐藏；`pointer-events:none` 外壳 + `auto` 面板；真实按钮 / 可聚焦。
- **验证**：`npm run build`（tsc strict + vite）通过；服务端冒烟 `.qa/v19/smoke-e25.mjs` **39/39**（辩论赛样例 `projectId=null` 且 `newProjectHint=新生辩论赛筹备`、`areaId=a-0003`；控制样例「学生组织：策划书要补个流程图」→ `p-0002`（明确依据，正确）；形状 / 互斥 / 标题去重断言；项目 create（201 + 形状 + 审计）→ 空 patch touch（`updatedAt` 递增 + 审计 `project.touch`，无 `project.update`）→ archived（审计 `project.update` + `fields:["status"]`）→ trash / purge 清理 + 审计；零残留）；浏览器 E2E `.qa/v19/slice-e25-verify.py` **21/21**（UI AI 解析建议卡未出现「建议挂到 学生组织」且「建议新项目」可见；dock 顶部隐藏 → 深滚出现 → 勾选计数 → 「取消选择」归零 → 滚回顶部隐藏；项目快速新建 toast + 行出现；零残留回到基线：收件箱 9 / 任务 60 / 项目 10 / 笔记 14 / 资料 12 / 回收站 0 / 附件 1；控制台零错误）。**提示词一次通过，无需迭代**。证据 `.qa/v19/`（`smoke-e25.mjs` + `.log`、`slice-e25-verify.py` + `.log`、`e25-hint.png` / `e25-dock.png`）。
- **记录**：`docs/decisions/0006-ai-parse-upgrade.md` §2 修订（挂靠规则 v2 + newProjectHint）；`docs/decisions/0009-edit-trash-reveal.md` §2 修订（`project.create` + touch 语义）。

### 详情操作 + 回收站 · Slice E2（2026-10-03）
- **通用编辑端点**：`server/index.mjs` 新增 `POST /api/(tasks|projects|notes|resources)/:id/update`（单条正则路由）——读原记录（不存在 404）→ 仅合并**字段白名单**（tasks 12 字段 / projects 6 / notes 4 / resources 7；其余忽略）→ 保留 `id` / `createdAt`、`updatedAt = nowIso()` → 经 `SCHEMAS[kind]` 校验 → `commit` 审计 `<singular>.update` + `detail.fields`（变更键）→ 返回 `{ record }`；body 中 `null` 字段视为「清除」。
- **回收站（软删除）**：`server/store.mjs` 新增 `TRASH_DIR`、`moveToTrash`（原子写 `data/trash/<kind>/<id>.json`（+`trashedAt`）→ 删正册）、`restoreFromTrash`（写回正册（去 `trashedAt`，经 schema 校验）→ 删副本）、`purgeTrash`、`readTrash`（`{kind,record}` 按 `trashedAt` 倒序），全部走既有写队列；**`nextId` 增扫回收站取最大值**（修复：防回收后 id 复用导致恢复冲突）。路由：`POST /api/<kind>/<id>/trash`（404 校验 / 审计）、`GET /api/trash`、`POST /api/trash/<kind>/<id>/restore`、`POST /api/trash/<kind>/<id>/purge`；kind 白名单 = 四种可写实体，id 经 `ID_PATTERNS`。
- **资源文件位置 + 定位**：`resourceSchema` 增可选 `path`；文件投递条目澄清为资料时补 `kind:'file'` 与绝对 `path`（`data/files/<inboxId>-<name>`），title 取 `item.content`（非文件条目不变）；`POST /api/reveal { path }`——trim / 非空校验、`resolve` + `existsSync` 否则 404 `文件不存在`，**detached + stdio ignore + unref** 启动 `explorer.exe`（文件 `/select,` 定位、目录直开），返回 `{ ok:true }`（仅本机可用，无额外限制；见 ADR-0009）。
- **前端 · 抽屉编辑 / 删除**：新增 `src/components/EntityEditForm.tsx`（字段规格驱动：text / textarea / number / select / datetime / list；datetime 用 `datetime-local` 显示并按本机时区转 ISO；contexts / tags 逗号文本；numeric select 转 number）。任务 / 项目 / 笔记 / 资料四种抽屉底部加「编辑 / 删除」安静动作——编辑态内联替换字段视图（保存实心 / 取消 ghost，成功 toast「已保存」）；删除 → `trashEntity` → 快照移除 → toast「已移入回收站 · 撤销」（撤销 `restoreEntity`，无确认弹窗）。
- **前端 · 回收站页**：新增 `/trash`（nav `09 回收站` / 命令面板经 `NAV_ITEMS` 自动收录 / `App.tsx` 路由）；按类型分组（任务 / 项目 / 笔记 / 资料），行 = 标题 + id + 移入相对时间 + 「恢复」+「彻底删除」（双击确认：首点标签变「再点一次确认」，5s 复位）；空态「回收站为空」。
- **前端 · 资料文件位置**：资料抽屉新增「文件位置」区块（有 `path` → 等宽截断路径 + 「在文件管理器中显示」→ `POST /api/reveal`；无 → 「未记录文件位置 · 可通过编辑补充」）。`src/types.ts` 增 `Resource.path?` 与 `TrashKind` / `TrashRecord` / `TrashItem`；`src/lib/mutations.ts` 增 `updateEntity` / `trashEntity` / `restoreEntity` / `purgeEntity` / `fetchTrash` / `revealPath`；`src/styles/views.css` 增表单 / 回收站 / 文件位置样式（token only，含 390 响应）。
- **验证**：`npm run build`（tsc strict + vite）通过；服务端冒烟 **34/34**（编辑生效 + 白名单忽略未知字段 + `updatedAt` 递增 + 审计；trash / restore / purge 文件往返 + 审计；reveal 空路径 400 / 不存在 404 / 真实文件 200）；浏览器 E2E **19/19**（编辑保存 + UI 更新、删除 toast + 离场、回收站出现 / 恢复 / 再删 / 双击彻底删除、资源补 path + 文件位置行 + reveal HTTP 200、零残留回到基线、控制台零错误）；全站回归 smoke PASS。证据 `.qa/v18/`（`smoke-e2.mjs` + `.log`、`slice-e2-verify.py` + `.log`、`e2-edit.png` / `e2-trash.png` / `e2-resource-path.png`）。备注：验收含 2 次真实 reveal（冒烟 1 + E2E 1），各弹一次 Explorer，属预期。
- **记录**：ADR-0009；`docs/04`（§4.9 `path?` + §5.4b 回收站 + §9 写入路径）；`docs/05`（`data/trash/`）；`docs/02`（路由 `/trash` + §3.2 端点）；`docs/README` 收录 ADR-0009；`AGENTS.md` 路由行 + 安全纪律 + 变更记录行。

### 收件箱修复包 · Slice E1（2026-10-03）
- **编辑器回位（owner 反馈）**：撤销 Slice D 的居中几何——`.ic-composer` 去掉 `max-width:760px` 居中与 `translateX` 光学补偿，回到原捕捉栏位置：占满版心宽度，左右边距与下方「水位」面板（`.ic-head`）严格一致（实测 composer.x=panel.x=228、宽度均 1240）。DeepSeek 式视觉（抬升表面 / 圆角 / 柔影 / pending-file chips / 回形针 / 拖拽遮罩 / 圆形发送 / `C` 角标 / 投递即自动 AI 先读）全部保留。
- **「批量 → 任务」复现 + 反馈加固**：干净复现（API 造一文本 + 一文件临时项 → 勾选 → 批量 → 任务）**两条均成功澄清并离场，服务端流程无 bug**；owner 的「点了没用」为反馈不够醒目所致。加固：toast 改为目标感知的明确文案（`已批量创建 N 条任务` / `已批量丢弃 N 条`，仍带「撤销」）；成功后才收敛选中态（仅移除已处理项，中止时保留剩余选中，绝不提前清空）。
- **AI 结果缓存（收起不丢）**：`src/views/Inbox.tsx` 新增模块级 `Map<inboxId, AiParseResult>`（会话内跨路由存活）；收起 / 切换条目后再展开直接命中缓存 → 秒级就绪卡（无阶段文案、不重解析，实测 0.00s）；条目离开未澄清列表（应用 / 撤销 / 刷新对账）即删除其缓存；就绪卡新增安静 ghost「重新解析」（覆盖该条缓存、强制新请求）；单活跃流在途守卫保持不变。
- **批量 AI 解析**：批量条新增「批量 AI 解析」（置于 批量 → 任务 / 批量丢弃 旁）——顺序流式解析选中项（复用 `aiParseInboxStream` + 上述缓存），进度播报「AI 解析中 2/5…」，失败 toast 后**继续**剩余项，**绝不自动应用**（建议仍逐条查看 / 应用）；运行期间禁用批量动作与单条解析入口防重叠。
- **验证**：`npm run build`（tsc strict + vite）通过；浏览器 E2E **24/24**（编辑器几何回位对齐 / 批量 AI 进度与完成 / 两条均缓存即时就绪 / 批量 → 任务两条离场 + 明确 toast / 批量丢弃两条离场 + 明确 toast / 零残留：收件箱回到 i-0001..i-0008 · 任务回到 t-0001..t-0060 · `data/files/` 空 / 控制台零错误）。证据 `.qa/v17/`（`slice-e1-verify.py` + `e1-composer.png` / `e1-batch-ai.png` / `slice-e1-verify.log`）。
- **记录**：ADR-0008 §2.7 修订（标注「owner 反馈后回位，不居中」）与 §4 Slice E1 修订行。

### 收件箱升级 · Slice D（文件投递 + 居中编辑器 + AI 先读）（2026-10-02）
- 服务端投递：新增 `POST /api/inbox/upload?name=&type=&caption=`（RAW body 流式落盘，不走 JSON/`readBody`）；单文件上限 `MAX_UPLOAD_BYTES=25MB`（超出暂停读取 + 销毁写流 + 清理半成品 → `413 文件过大（上限 25MB）`）；文件名清洗（`basename` → 非法字符 `[\\/:*?"<>|]`→`_` → trim → 截断 120 字符保留扩展名 → 兜底 `file`）；落盘 `data/files/<id>-<safeName>`，条目 `source:'file'` + `file:{name,size,mime?}`，审计 `inbox.upload`；写失败清理半成品 → 500。
- 附件端点：新增 `GET /api/files/:id`（流式 inline，`Content-Type` 取 mime、`filename*=UTF-8''` 兼容非 ASCII；缺失 404）与 `POST /api/inbox/:id/remove`（删除条目并清理附件，`ENOENT` 忽略；`clarified` → `409 已澄清条目请先撤销澄清`；审计 `inbox.remove`）。
- 数据模型：`inboxItemSchema` 增可选 `file:{name,size,mime?}`；`.gitignore` 增 `data/files/`（二进制不进 git，元数据随 JSON 受版本管理）。
- AI 先读：`server/ai.mjs` 新增 `buildFileSection(item)`（同步 / 流式共用）——文本扩展名白名单或 `text/*` 且 ≤5MB → 读前 8000 字摘录；否则仅元数据「无法直接读取内容，请依据文件名与上下文判断」；系统提示增一行附件判断规则；**无附件条目行为不变**。
- 前端编辑器：`.k-capture` 全宽条退役 → `.ic-composer` 居中圆角编辑器（`max-width:760px`，抬升表面 + 柔影，仅 token）；待上传 chips（`name · humanSize` ×）→ 输入行 → 底行（回形针 + 「拖拽文件到此处」+ `C` 角标 | 圆形强调色发送）；光学居中（补偿固定轨道的一半，宽屏相对视口居中）；保留 `c` 聚焦与 Enter 发送。
- 投递交互：点击回形针（隐藏 `<input type=file multiple>`）/ 拖拽（`dragenter/over/leave/drop` + `.is-dragover` 虚线强调 + 遮罩「松开：放入收件箱」）；发送时有文件则逐个 `uploadInboxFile(file, caption)` → 清空 → **顺序自动运行既有 AI `parse-stream`**（复用过程面板 / 建议卡；失败 toast 后继续）；`aria-live` 播报上传 / 解析状态。
- 文件条目：行左侧文件字形；meta 增 `name · humanSize`；展开澄清区新增安静「查看文件」链接（`/api/files/<id>` 新标签打开）；`src/lib/format.ts` 增 `humanSize`。
- 验证：`npm run build`（tsc strict + vite）通过；服务端冒烟 PASS（201 + 文件名清洗 + 落盘内容一致 + 真实 AI 解析建议含挂接 + `remove` 清文件/条目 + 审计 `inbox.upload`/`inbox.remove`，零残留）；浏览器 E2E **12/12**（编辑器几何居中 centerX=800、chip、文件行、自动建议卡、拖拽 chip、零残留、零控制台错误，证据 `.qa/v16/`）。重启后栈在线（4097 + 5173，未触碰 4096）。
- 记录：ADR-0008；`docs/04 §4.1` 增 `file?` 行与说明；`docs/05` 目录树 / 职责 / 清单同步；`docs/README` 收录 ADR-0008。

### 使用指南 · HTML（2026-10-02）
- 新增 `public/guide.html`：单文件、自包含、中文「使用指南」，面向首次使用的所有者（读到会用）。
- 视觉：复用暗色「柔暗夜色」token 原值（`bg #0F0F10` / `surface #1A1A1C` / `ink #F4F4F5` / `accent #FF5A52` / 柔影 / 圆角 16）；字体栈为自包含系统栈（不引用任何外部字体/图片/CDN）；无渐变/辉光/emoji；强调色仅作信号；正文 measure 72ch；桌面粘性左目录、≤900px 折叠为内联目录；响应式至 390px。
- 内容：Hero（一句话哲学 + `npm run dev` → `localhost:5173` 启动条）· 30 秒理解（五步循环）· 五分钟上手（5 步照着做）· 一条内容的一生（阶段/页面/操作/结果表）· 八个页面速览（8 卡）· AI 怎么帮你（解析 + 周回顾 + 三条红线 + 本地 4096）· 系统是连起来的（关联区块 + 四类深链）· 用好它的心法（六条纪律）· 快捷键与全局（含手机）· 常见问题 + 页脚版本串；末尾内联原生 JS 仅做目录滚动高亮（无外链，失败静默降级）。
- 验证：Python Playwright（`.qa/v15/guide-verify.py`）三态 25/25 通过——dev 桌面 1600×1000 / 移动 390×844 / `file:///…/public/guide.html` 双击；三处控制台 error == 0；关键区块（五分钟上手 / 关联 / 常见问题）命中；桌面与移动零横向溢出；file:// 无外部子资源请求。证据 `.qa/v15/`（`guide-desktop.png` / `guide-mobile.png` / `guide-file.png` / `guide-verify.log`）。
- 交互演示（追加）：任务卡内「点开看：任务详情面板」触发**任务详情面板居中弹窗**——忠实复刻真实抽屉（kicker `任务 · t-0034` / 标题 / 2 列字段网格 / 标签胶囊 / 「关联」芯片 `label · title · id` / `标记完成` 实心 + `查看项目` ghost 底部按钮 + 关闭 X）；X / 遮罩 / ESC 关闭，焦点进入弹窗、关闭还原触发按钮，打开锁定页面滚动，`role="dialog"` + `aria-modal` + fade/微缩放（reduced-motion 降级），纯内联 CSS/JS。`.qa/v15/` 追加 `guide-demo-open.png`；三态 + 演示共 **39/39** 通过、控制台零错误。
- 边界：未改动 `src/**`、`server/**`、`scripts/**`、`data/**`、`public/favicon.svg`、`index.html`；未触碰运行中的服务（5173 / 4097 / 4096）。

### AI 周回顾 · Slice C（2026-10-02）
- 写入路径：`server/schemas.mjs` 新增 `reviewSchema`（`id /^rev-\d{4}$/` · `type` weekly|monthly · `periodKey` · `date` · `metrics{captured·created·completed·overdue·migrated?}` · `decisions` · `summary` · `staleProjectIds?`）与 `reviewDraftSchema`；`SCHEMAS.reviews` / `ID_PATTERNS.reviews` 落地；`store.nextId` 增 `reviews:'rev'`。
- 服务端指标：`server/ai.mjs` 新增 `isoWeekKey`（ISO 周键）、`computeWeekMetrics`（本周 周一 00:00 → now：捕获 / 新增 / 完成 / 逾期；`migrated` 刻意不产出）、`staleProjects`（与前端 `getStaleProjects` 严格一致：active 且 ≥14 天未更新）。
- 端点：`server/index.mjs` 新增 `POST /api/reviews`（服务端计算 id / 周期 / 指标 / 停滞项目，用户只给摘要与决策；审计 `review.create`）、`POST /api/reviews/:id/remove`（审计 `review.remove`）、`POST /api/ai/review/draft`（health 预检 503 / 失败 502）。
- AI 草稿：`generateReviewDraft()`——注入紧凑中文摘要（指标 / 本周完成 / 逾期 / 停滞项目 / 习惯近 7 天命中 / 本周活动计数）+ 指令式 JSON + Zod + 单次重试（`variant:'low'`，120s）；`staleAdvice` 按实际停滞集合二次过滤（丢弃臆造 id），文本 trim。
- 前端：`src/lib/mutations.ts` 增 `generateReviewDraft / saveReview / removeReview` + `ReviewDraft` 接口；`src/lib/date.ts` 增 `isoWeekKey` / `monthLabel`；`src/types.ts` `ReviewMetrics.migrated` 改可选；`Review.tsx` 显示最新周 / 月回顾（按 date 倒序）、周期文案运行时计算、抽屉升级为真实 AI 草稿流（idle / loading / draft / error / saving，指标行 · 可编辑摘要 / 决策 · 停滞处置建议只读 · 保存 / 重新生成），保存 toast 5s「撤销」，移除该流程全部「原型态」文案；停滞项目 迁移 / 归档按钮保持原型态不动。
- 验证：`npm run build`（tsc strict + vite）通过；服务端冒烟 PASS（草稿形状 + 写入 / 删除往返 + 审计 `review.create` / `review.remove`，零残留）；浏览器 E2E 13/13（草稿加载 / 编辑保留 / 保存 toast / 撤销数据复原 / 零控制台错误，零残留）。证据 `.qa/v14/`。
- 记录：ADR-0007；`docs/04 §4.10` 标注 `migrated` 可缺省。

### AI 澄清升级 · Slice B（2026-10-02）
- 解析上下文注入：`server/ai.mjs` 注入系统摘要（项目 / 区域 / 标签注册表 / 近期未完成任务 ≤50，~4KB 预算）；系统提示新增 `projectId / areaId / tags / duplicateOf` 建议规则。
- 挂接建议 + 防臆造：`aiSuggestionSchema` 扩展四字段；服务端 `postValidate` 按快照过滤（未知 id / 未注册标签一律丢弃，null 归一化）。
- 澄清联动：`clarifyDetailsSchema` + `clarifyInbox` 支持 `projectId / areaId`（仅 task 目标；存在性校验，缺失 400）。
- 过程可视（SSE）：新增 `POST /api/ai/inbox/:id/parse-stream`（`event.subscribe` 事件泵 + 会话过滤；`status / delta / retry / suggestion / error` 帧；客户端断开清理；同步端点保留为回退）。
- 前端：`aiParseInboxStream`（fetch 流式 + chunk 安全 SSE 解析）；收件箱过程面板（阶段：已连接 / 思考中 / 生成中 / 重试中 / 校验通过 + 240 字尾部实时预览）；建议卡挂接 chips（挂到项目 / 归入区域 / 标签 / 疑似重复，绝不自动合并）。
- 工程：新增 `scripts/spawn-bg.mjs`（后台安全启动器：detached spawn + 日志重定向 + unref，防工具调用挂起）；AGENTS.md Windows 纪律修订（`start` 方式第三次挂起事故）。
- 验证：服务端冒烟 PASS（625 delta 帧；建议含 `p-0006 / a-0002 / role:monitor` 挂接）；浏览器 E2E 13/13（过程面板 / 流式预览 / 建议卡 / 只读零写入 / 零控制台错误）；`npm run build` 通过。证据 `.qa/v14/`。

### 结构互联 · Slice A（2026-10-02）
- 新增 `src/lib/relations.ts`：从数据快照运行时派生实体互链（出链 + 入链），覆盖任务 / 项目 / 笔记 / 事件 / 资源；纯派生、不落盘、不缓存。
- 新增 `src/components/Relations.tsx`：抽屉内「关联」安静区块，复用 `TagPill` 芯片（label · title · id）并沿用路由深链跳转；空关联不渲染；area / goal 无独立页面故渲染为静态芯片。
- 深链：新增 `/projects?project=`、`/library?note=`、`/library?resource=`、`/calendar?event=` 四处，mirror `Tasks.tsx` 生命周期（打开抽屉 / 关闭时 replace 清参）；「关联」区块集成任务 / 项目 / 笔记 / 资源 / 事件五类抽屉（笔记原「反向链接」保留）。
- 项目抽屉补「下一步」字段（`nextActionId` → 可点击任务深链，空为 —）；任务抽屉「查看项目」改为有 `projectId` 时深链 `/projects?project=`，无则隐藏。
- 版本串 `v0.4.0 → v0.5.0`（RailNav / 设置「关于」）；命令面板陈旧「AI · 待接入」组替换为「AI」组，条目「AI 解析（收件箱）→ /inbox」，移除过期 toast。
- `npm run build`（tsc strict + vite）通过；行为级验收（Python Playwright）20/20 通过——深链直开 / 关联芯片跳转 / 下一步 / 查看项目 / ESC 清参 / 移动端 390 / 控制台零错误（证据 `.qa/v14/`）。

### Planned
- v0.5.0 opencode AI 集成：本地代理链路、`@opencode-ai/sdk`、SSE 流式进度与结构化输出。
- 页面排版多版本设计探索：每页 + 详情面板 / 卡片详情各做多版排版与组件样式方案（风格保持不变），供所有者选型（沿用 `design-drafts/` 选型模式）。

### Changed
- 总览落地所有者选定排版「工作台」（`design-drafts/v2/overview-c.html`）：统计瓦片 + 双栏拆分 + AI 建议卡改为——顶部胶囊行 → **左 2/3 工作区**（已结束日程 →「现在 · HH:mm」实时分界 → 按截止升序的下一步行动 TOP5，含 `· {项目} {done}/{total}` 后缀）→ **右 1/3 粘性监视柱**（收件箱水位 capacity 12 / threshold 8 · WIP 9/3 · 连续刷题 14 日点阵 · 完成趋势 / 到期负载低高度 sparkline）→ 底部项目推进（真实计数「9 个进行中」+ W40 回顾行）。新增 `getDueLoadSeries` / `getCodingStreakDetail` / `getUpcomingNextActions`（逾期不入列，由「逾期 · N 项」胶囊承载）；`TrendLine` 增补 `showValues` / `showAxis` / `ariaLabel` 可选属性（默认行为不变，回顾页零回归）；水位口径统一 capacity 12 / threshold 8（StatusBar 同步）；`.k-streak` 点阵收录 `components.css`；AI 建议占位卡随编排退役。行为级验证（行动深链 + 抽屉、ESC 清参、日程行→日历、项目行→项目页、移动端 390 单列、实时分割线）+ `tsc -b` / `npm run build` 通过；证据 `.qa/v12/`。仅改 `src/views/Overview.tsx`、`src/styles/{views,components}.css`、`src/lib/derive.ts`、`src/components/{charts/TrendLine,TaskRow,ScheduleList,shell/StatusBar}.tsx`。
- 项目页落地所有者选定排版「列表」（`design-drafts/v2/projects-b.html`）：四列看板改为按状态分组（进行中 / 暂停 / 将来 / 已完成）的纵向列表——组头安静收敛（标题 + 计数），每项目一行（序号 + 标题 + 状态/区域/标签胶囊 + 完成定义 + 下一步 + 内联进度计「done / total · pct%」+ 截止 humanizeDay）；非活跃分组更紧凑（暂停/将来 收敛行距并隐藏下一步、已完成最紧凑），交互行悬停 `--surface-hover` + 2px 抬升；窄容器 `@container route` 收窄时右侧进度/截止折到标题下方。保留全部功能（`getProjectProgress` 真实计数、`nextActionId` → 任务标题、`dueAt` humanizeDay、区域/标签、空分组与无项目时的安静空态、行点击抽屉及任务清单 / 标记完成撤销）。仅改 `src/views/Projects.tsx` 与 `src/styles/views.css`（项目段；另清理死看板/pcard 容器查询与 MAP 注释）；`tsc -b` 通过。
- 任务页落地所有者选定排版「表格」（`design-drafts/v2/tasks-c.html`）：改为真实 `<table>`（完成 / 标题 / 上下文 / 能量 / 截止 / 项目），表头吸顶（`top: var(--topbar-h)`）、行悬浮 `--surface-hover`、逾期 `--danger-text` + 告警图标、完成行弱化 + `k-task__strike` 划线；计数并入工具条与快速新建同排；筛选压缩为一行；分组切换（平铺 / 按项目 / 按上下文）保留于工具条；窄屏经 `@container route` 逐级收列（保留 完成 / 标题 / 截止）。既有逻辑（筛选 / `byDueTask` 排序 / 深链 `?task=` / 抽屉 / 完成撤销 / 空态）全部保留。仅改 `src/views/Tasks.tsx` 与 `src/styles/views.css`（任务段）；`tsc -b` 通过。
- 收件箱落地所有者选定排版「批量」（`design-drafts/v2/inbox-c.html`）：多选批量处理 + 按捕捉日期分组浏览（今天 / 昨天 / 更早）。新增 `Set<string>` 多选、主勾全选、批量 → 任务 / 批量丢弃（逐条 `clarifyInbox`，成功汇总为一个「已处理 N 条 / 撤销」toast，失败中止并保留剩余项）、行尾「澄清」可展开内联 5 项操作（`aria-expanded`）。保留捕捉、水位计量、已澄清 / 已丢弃折叠、单条澄清 5s 撤销、空态、相对时间刷新。仅改 `src/views/Inbox.tsx` 与 `src/styles/views.css`（收件箱段，新增 `.ic-*`）；`tsc -b` 通过。

### opencode AI 接入 · 首个切片（2026-10-02）

- **收件箱「AI 解析」**：条目 → 本地 opencode 结构化建议（target / title / contexts / energy / importance / estimateMin / dueAt / reason）→ 预览 → 确认（走既有 clarify 通道：`details` 覆盖 + `ai` 审计标记）→ 撤销沿用 revert。实测解析 3–6s。
- 服务端：`server/ai.mjs`（`@opencode-ai/sdk/v2` 代理；指令式 JSON + Zod 校验 + 单次重试 + 120s 超时 + 可选 Basic 认证）；`GET /api/ai/health`、`POST /api/ai/inbox/:id/parse`（404/409/503/502 语义化）；`clarifyInbox` 扩展可选 `details` 与 `ai` 标记（向后兼容）。
- 启动：`scripts/dev.mjs` 探测 4096，空闲则托管拉起 `opencode serve --port 4096`（已运行跳过；CLI 缺失仅告警）。
- 前端：收件箱 AI 入口与建议卡（安静样式）；状态条「AI: 在线 / 离线 · opencode」；设置页 AI 面板实时状态。
- 实证修正（ADR-0005）：serve 端口需显式 `--port 4096`；`format: json_schema` 在 thinking 模型被拒 → 指令式 JSON；`variant: 'low'` 实测 4.4s vs 默认 236s。
- 顺延：SSE 流式进度、命令面板 AI 入口、通知/文件投递解析。
- 证据：`.qa/v13/`（探针 probe1–5 + 服务端冒烟 smoke-ai + UI 端到端 inbox-ai-* / settings-ai）。

## [v0.4.0] - 2026-10-02

数据服务落地：本地 Node 单写者（`server/`，仅 `127.0.0.1:4097`）成为唯一写入路径——Zod 校验 + 原子写入（write-file-atomic）+ 审计日志（`data/activity.jsonl`）；前端 localStorage 原型层退役，改为「构建期 seed 首帧 + `/api/snapshot` 水合 + 乐观更新写入」；全站审阅确认的 P0 六项一并落地。决策记录：ADR-0004。

### Added
- `server/`：HTTP 入口（`index.mjs`）/ 存储层（`store.mjs`：串行写队列、原子写、nextId、审计）/ Zod schema（`schemas.mjs`，对齐 docs/04）。
- 写入端点：`POST /api/tasks`（快速新建）、`POST /api/tasks/:id/complete`、`POST /api/tasks/:id/reopen`（从审计还原先前状态）、`POST /api/inbox`（捕捉）、`POST /api/inbox/:id/clarify`（→任务 / →项目 / →笔记 / →资源 / 丢弃）、`POST /api/inbox/:id/revert`（撤销澄清并删除产物）；读取端点 `GET /api/snapshot`、`GET /api/activity`、`GET /api/health`。
- `scripts/dev.mjs`：`npm run dev` / `npm run preview` 一体启动数据服务 + Vite；`--host` 等参数透传给 Vite。
- 前端：`src/lib/api.ts`（API 客户端）、`src/lib/mutations.ts`（写入动作：乐观更新 + 失败回滚）、`src/lib/hooks.ts` 增 `useDataRevision` / `useDataSource`。
- 数据服务状态：状态条胶囊（在线 / 离线只读 / 连接中）+ 设置页「数据服务」面板（含最近 8 条审计活动）。
- 多标签同步：窗口聚焦 / 可见时重新水合（`AppLayout`）。Toast 错误态（危险色描边 + 「错误」标签）。

### Changed
- `src/lib/data.ts` 改为可变更快照 + 订阅（构建期 seed 首帧；挂载后经 `/api/snapshot` 水合），全部视图 getter 保持同步 API 不变。
- 完成语义：完成 = `status:'done'` + `doneAt` 落盘（回顾「本周完成」图表开始联动）；已完成任务可重新打开（从审计日志还原先前状态）。
- 收件箱澄清真实落地：条目 `status:'clarified'` + `linkedId` 指向新实体；新任务带 `sourceInboxId` 反指；撤销（revert）删除该次创建。
- 写入失败不再静默：全部失败显式 toast（审阅 P0#3）；乐观更新失败自动回滚。
- 「原型态」语义退役：Toast 标签移除、命令面板「原型标注」组改为「AI · 待接入」、设置页原型态说明改为数据服务面板（「清除本地覆盖」入口一并移除）。
- `vite.config.ts`：新增 `/api` 代理（dev 与 preview）；`data/**` 不再触发 Vite 热重载（避免写入后整页刷新打断撤销窗口）。
- 应用内版本号 → v0.4.0（品牌区、设置页「关于」）。

### Fixed（全站审阅 P0 六项）
- 澄清不落地 / 刷新回滚：澄清、捕捉、快速新建全部真实落盘。
- 跨视图计数口径分裂：单一数据源，总览 / 状态条 / 任务 / 收件箱口径一致。
- proto 写入失败静默：改为显式错误提示 + 回滚。
- 「清除原型态」入口移除：数据以文件为事实源，历史由 git + 审计日志承担。
- 完成态缺 `doneAt`：完成写入 `doneAt`，回顾图表联动。
- 多标签不同步：聚焦 / 可见时重水合。

### Notes
- 验证证据：`.qa/v07/`（服务端冒烟 15 项断言、浏览器端到端断言与截图、离线降级、移动端检查）。
- 写入格式：2 空格缩进 + 尾换行；时间 ISO 8601 带本机偏移；审计日志每行一条 JSON。
- `npm run build`（tsc -b + vite build）通过。

### 路由滚动记忆（2026-10-02 · 体验）

所有者指定的体验规则：切换页面时——**有记忆则恢复上次浏览位置，首次进入回到顶部；各页面位置互不影响**。

#### Added
- `src/lib/scroll.ts`：`useRouteScrollMemory()`（AppLayout 挂载一次）——按 `pathname` 实时记录滚动位置；路由切换后同步恢复，懒加载页面高度不足时 180ms 自动校正一次；初次挂载不干预浏览器原生刷新恢复。
- 日历配合：已有记忆位置的回访跳过「进页滚到此刻」（首次进入仍自动到现在）；「回到现在」手动入口保持不变。

#### Notes
- 实测（Playwright 真实滚轮输入）：`/tasks` 700 ↔ `/` 400 双向独立恢复；日历首访自动到现在 932 → 回访恢复 973（不回跳）；懒加载资料页恢复 300。
- `npm run build` 通过。

### 页面排版多版本设计稿 v2（2026-10-02 · 选型）

所有者要求：每页 + 点击展开的详情面板 / 卡片详情各做多版**排版与组件样式**方案供选择（**风格不变**：柔暗夜色 v2 + 柔影悬浮）。产物在 `design-drafts/v2/`：8 页 ×3 版 + 详情抽屉 5 版 = **29 个方案**，以真实应用 CSS 渲染（真 token、真种子数据）；附选型页 `index.html` 与 9 张三版对比页 `_sheets/`。**自包含打包**：应用 CSS 已内联进全部变体文件（双击 HTML 即可完整预览，file:// 与 dev URL 均可）；选型后落到 `src/`。

**第二轮追加**（总览重做 + 监控图表）：`overview-a/b/c.html` 重做为「监控台 / 驾驶舱 / 信号层」三版（监控图表优先），新增 `charts-kit.html` 图表组件样本页（7 个监控模块：完成趋势 / 到期负载 / 能量分布 / 连续打卡 / 收件箱水位 / WIP / 项目推进，含名称 / 类名 / 数据源 / 使用场景标注）；第一轮总览稿归档 `_archive/`；选型页更新为 30 卡 + 「图表组件（监控）」分组。图表现值全部为种子真实数据；强调色仅作阈值 / 超限 / 峰值信号，不作数据系列（P7 纪律）。

**第三轮追加**（总览再重做）：二轮三版未采纳（「都不行，再改一轮」）；按「**监测图表去主导化**」重做为三版——今日线 TODAY LINE（日程与截止任务编织成时间轴；监测微型化内嵌）/ 状态带 STATUS STRIP（顶部四仪表带 + 焦点/日程 + 低高度趋势带）/ 工作台 WORKBENCH（左工作区行动×课程时间穿插 + 右监视柱）；二轮稿归档 `_archive/overview-*-v2.html`；规范见 `BRIEF.md` 附录三；第三轮 C「工作台」已获采纳并落地 src（见 Unreleased）。

**组件修订（所有者反馈）**：第三轮预览「连续刷题」打卡带（粗竖条 + 斜纹）被指「AI 感比较重」→ 改为**安静圆点阵**（实心 = 命中 · 空心 = 缺口；8px 圆点行内均布，与 `.k-meter` 行高对齐；去斜纹 / 去渐变 / 去粗条）；`overview-a/b/c` 与 `charts-kit` 同步修订、预览重渲染，规范同步 `BRIEF.md` 附录二。

### 页面排版落地（2026-10-02 · 设计选型二轮采纳）

所有者选型落地：收件箱 C「批量」/ 任务 C「表格」/ 日程 C「议程流」/ 项目 B「列表」/ 资料 A「列表」/ 回顾 B「仪表盘」/ 设置 B「侧导航」（含细致优化）→ 全部落进 `src/`（仅排版与组件编排，功能 / 数据 / 路由零变更）；侧边栏按新规格（无边框高亮 + 侧边线）；详情面板 B（任务抽屉两段式 + 全抽屉共享紧凑字段网格）。总览选型待定（监控台 / 驾驶舱 / 信号层）。

#### Changed
- 收件箱：日期分组（今天 / 昨天 / 更早）+ 多选批量（批量 → 任务 / 批量丢弃，各含撤销）+ 行内展开澄清；水位面板保留。
- 任务：表格布局（完成 / 标题 / 上下文 / 能量 / 截止 / 项目）+ 吸顶表头 + 工具条合并计数与快速新建；筛选 / 排序 / `?task=` 深链 / 抽屉 / 撤销全保留；窄容器渐隐次要列；「完成」表头竖排缺陷已修。
- 日程：日脊 → 「议程流」（下一项高亮卡含实时倒计时 + 今天 / 明天 / 本周 / 下周分组事件流 + 迷你月历含今日标记与安排圆点 + 本月场次统计）。
- 项目：看板 → 分组纵向列表（每行：标题 / 状态 / 区域标签、完成定义、下一步、内联进度 + 计数、截止）。
- 资料：四行筛选整合为单一紧凑过滤条；行精化（类型 / 标题 / 蒸馏 / 相对时间）。
- 回顾：双栏仪表盘（左：五枚指标瓦片 + 本周完成折线 + 能量分布；右：周 / 月回顾卡 + 决策 + 停滞项目 + CTA）。
- 设置：左侧分类导航 + 右侧单区内容（外观 / AI 集成 / 数据统计 / 数据服务 / 关于；窄容器横向滚动条）；细节统一（区块头 / 间距 / 表格对齐 / 空态）。
- 侧边栏：选中态「无边框高亮（填充 + 零阴影零边框）+ 左缘 3px 强调线」；折叠态与移动端底栏同步。
- 详情面板：任务抽屉两段式（备注 → 2 列字段网格 → 标签 → 底部操作）；`.k-drawer .k-dl` 统一两列紧凑网格，任务 / 日程 / 项目 / 资料四处抽屉一致受益。

#### Notes
- 验证：`tsc` + `npm run build` 通过；8 视图 + 任务 / 笔记抽屉全站截图回归、零控制台错误；**行为级验证**（收件箱批量 → 任务闭环 + 撤销回滚、任务表完成 + 撤销、设置导航切换、日历按钮、移动端 390 无溢出 / 次要列渐隐）；证据 `.qa/v10/`。
- 总览三版仍待所有者选型，择日落 `src/`。

### 图表语言修订：圆头柱退役，趋势改折线（2026-10-02 · 所有者指令）

所有者否决「圆头柱（大圆角柱体）」趋势图呈现（线上回顾页为触发点），改以折线形式表达。

#### Changed
- `TrendBars` 组件退役（删除），新增 `TrendLine`（`src/components/charts/TrendLine.tsx`）：折线 + 面积晕染 + 数据点；**峰值信号环仅在唯一最大值时出现**（并列不打信号）；SVG `preserveAspectRatio="none"` + `non-scaling-stroke` 拉伸不变形；数据点以「零长度路径 + 圆头端帽」绘制；reduced-motion 降级保留。
- `components.css`：`.k-trend*`（圆头柱族）样式移除，新增 `.k-line*` 样式族（含 `is-peak` 信号态）。
- 回顾页「本周完成」图表切换为折线形式（实测 7 数据点、并列最大值无误打信号）。

#### Notes
- 设计稿侧同步（`design-drafts/v2/`）：`charts-kit` / `overview-a` / `overview-b` / `review-a` / `review-b` / `review-c` 替换为 `.k-line`；连续打卡条带与信号迷你柱去 pill 圆角（3px / ≤2px）；规范写入 `BRIEF.md` 附录二。
- 自包含打包器升级：重跑 `_build.mjs` 会把最新应用 CSS 同步刷新进全部草稿（含本轮 `.k-line`）。
- `npm run build` 通过。

## [v0.3.0] - 2026-10-02

视觉方向重做：采纳设计稿 C「柔暗夜色」为默认基底，融合 B「暖雾柔光」的「柔影悬浮」语言，替换 v0.2 的硬瑞士风；同步修复 `.qa/QA-REPORT-v0.2.md` 归档的全部缺陷。功能、路由、数据层与原型态 localStorage 层保持不变（纯视觉 + 打磨）。

### Added
- 设计方向决策 ADR `docs/decisions/0003-design-direction-v2.md`：C 柔暗 + 柔影悬浮融合，取代硬瑞士 v1。
- v2 设计 token（`src/styles/tokens.css`）：暗色「柔暗夜色」为默认（`bg #0F0F10` / `surface #1A1A1C` / `elevated #212124` / 文字 `#F4F4F5 · #A1A1AA · #929298`），亮色「暖雾柔光」（`#F7F6F3` / 白卡 / `#1C1917` 系）；圆角 16 / 12 / 全圆；柔影 `--shadow-card` / `--shadow-soft` / `--shadow-hover` + 顶部微高光。
- 强调色 AA 文字变体：`--accent-text`（暗底提亮 `#FF8A80` / 亮底加深 `#B3261E`）与 `--accent-on-ink`（反向 ink 填充变体），实测 ≥4.5:1。
- 焦点圈闭工具 `src/lib/focus.ts`（Tab 循环），供命令面板与抽屉复用。
- 背景氛围：暗色三处极淡冷/暖辉光 + 胶片颗粒（内联 SVG，无外部依赖）。

### Changed
- 全站视觉重皮：应用壳（RailNav / TopBar / StatusBar / AppLayout / Drawer / CommandPalette / Toast）与全局组件（Panel / StatTile / TagPill / TaskRow / FilterBar / MeterBar / 图表 / Ticker / DaySpine / EmptyState / Skeleton / Tabs / 标记语言）改为柔影悬浮卡片语言；8 视图（总览 / 收件箱 / 任务 / 日程 / 项目 / 资料 / 回顾 / 设置）与详情抽屉同步。
- 深度改由「表面阶 + 柔影」表达，撤下硬发际线；交互卡片/行悬停 `translateY(-2px)` + 更深柔影（180–240ms），静态容器仅承接柔影不抬升。
- 默认主题改为暗色：`index.html` FOUC 脚本与 `ThemeContext` 在无保存偏好时输出暗色（已保存的用户切换仍优先）。
- 排版转安静：`.u-label` 由大写等宽微标签改为低对比无衬线小字；字号收窄（body 15px、display `clamp(30px,2.8vw,42px)`）。
- 等宽字体栈补 CJK 回退（`PingFang SC` / `Microsoft YaHei` / `Noto Sans CJK SC`），中文在等宽上下文不再豆腐块。
- 版本引用随路线图重编号更新：数据服务 → v0.4、AI → v0.5、自动化/回顾 → v0.6；应用内版本号 → v0.3.0。

### Fixed
- M1：筛选 chip 选中态悬停时文字不可见（color 与 background 同为深色）。选中态提升特异性，`is-selected` 在悬停时保持 `ink` 填充 + `bg` 文字，始终 ≥4.5:1。
- M2：强调色文字压深底对比不足（日历激活日星期标签、Toast「原型态」标签）。改用按表面区分的强调色变体（`--accent-on-ink` / `--accent-text`），实测 ≥4.5:1。
- M3：按钮 reset 缺 `padding:0` 导致已完成勾选图形被挤成 2px。根因修复于 `base.css` 共享 reset，`.k-check` 与 `.k-task__open` 一并恢复正常。
- M4：日历「现在」线在 1440×900 首屏折叠之下。进入日历时自动滚动至当前时刻附近，并新增「回到现在」控件（不破坏日脊）。
- M5：命令面板与抽屉声明 `aria-modal` 却无焦点圈闭、关闭后不还原焦点。实现 Tab 焦点圈闭 + 关闭后还原焦点到触发元素。
- P7：停止将强调色用作图表数据系列填充（能量分布改为纯单色阶 + 图案）。
- P8：总览 TODAY 瓦片不再因逾期 >0 而把「已完成」计数标红，改为在脚注中单独标记逾期指标。
- P9：token 纪律——统计值改走 `--text-display`；间距回到 4px 体系；动效时长/曲线统一走 `--dur-*` / `--ease-*` / `DUR` / `EASE_*`，去除内联魔法数。
- P10：删除死代码 `src/components/HeatGrid.tsx`（零引用）；日脊事件设最小高度，超短事件不再被裁剪。
- Polish：日历完整日期不再补零（`10月2日`，非 `10月02日`）。
- 验收修复：命令面板关闭后焦点还原失败（`autoFocus` 在 `focusin` 监听卸载前抢焦点，记录错位）。改为 `focusin` 追踪 + 忽略面板自身与 `body`，关闭时校验 `isConnected` 后还原；抽屉路径复核通过。
- 验收修复：命令面板水平居中失效（Motion 内联 `transform` 覆盖 CSS `translateX(-50%)`）。改为 `left/right:0 + margin:0 auto` 居中（不依赖 transform），实测居中。
- 验收修复：灰阶对比校正（设计系统「灰字 ≥4.5:1」）——暗色 `--muted` `#6E6E73 → #929298`；亮色 `--ink-2` `#78716C → #665F59`、`--muted` `#A8A29E → #6E6862`。含填充合成表面全部 ≥4.5:1。

### Notes
- 归档的 v0.2 截图与 `QA-REPORT-v0.2.md` 保持不变；本次复核证据另存 `.qa/v0.3/`。
- 语法/严格类型与生产构建：`npm run build`（tsc -b + vite build）通过。

### 版式重排（2026-10-02 · 对齐设计稿 C）

所有者复核指出「页面排版不合理、组件安排不合理、缺少呼吸感、没有统一设计感」。根因：v0.3 只换了色彩与 token，沿用 v0.2 的密集通栏布局。本次在不改功能/数据/路由的前提下，按已批准的 `design-drafts/c-soft-dark.html` 重排全站版式与呼吸感。

#### Changed
- 版心居中：新增 `--content-max: 1240px` 与居中 `.k-route` / `.k-topbar__inner`，`--page-margin` 收敛为 `clamp(20px, 3.2vw, 44px)`；内容不再通栏拉伸到约 1344px。
- 统一呼吸词汇：新增 `--pad-card: 26px` / `--row-min: 64px`；Panel / StatTile / 各卡片 / 列表行 / 抽屉内块统一内边距与行高，列表行最小高度 64px。
- 区块头去噪：Panel 撤下「01 —」编号与前置斜杠，改为「标题 + 安静英文小标签」；EmptyState 同步撤下编号。
- 顶栏去噪：撤下「01 /」数字噪音；标题降为 `--text-h2` 与英文小标签成对，顶栏内容居中并与版心对齐。
- 侧轨简化：导航项由「图标 + 英文 + 中文」三行收敛为「图标 + 中文」单一层级并加大间距；移动端底部标签栏保持不变。
- 总览按 C 稿重排：密集 Ticker 信号带 → 安静状态胶囊行；全高 24h 日脊 → 紧凑日程列表（时间 + 标题 + 地点，≤6 行；日程页保留全高日脊）；统计瓦片由 5 层（英文标签 + 中文标签 + 大数字 + 计量条 + 脚注）精简为「大数字 + 中文标签 + 一条安静副行」（仅收件箱水位保留计量条）；下一步行动精简为「上下文 + 能量 + 截止」；移除与瓦片重复的「存量与流量」整卡，改为右栏紧凑「项目」进度卡，形成「左栏（日程 + 行动）/ 右栏（项目）」的 bento 布局；AI 建议卡保留并置于末尾。
- 任务筛选收敛：状态 chip 保持单行，上下文 / 能量 / 区域 / 身份收进「更多筛选 MORE」披露区；分组切换与筛选左对齐，消除中部空洞。
- 收件箱去嵌套：未澄清项由「卡片套卡片」改为面板内扁平列表行（发际线分隔 + 悬停反馈）。
- 视图一致性：日历（周条加高、议程列加宽）、项目看板卡、资料列表行、回顾（上下两排等宽）、设置卡片内边距统一到同一呼吸词汇。
- token 保持唯一事实源：新增 `--content-max` / `--pad-card` / `--row-min`，视图内零内联魔法值。

#### Fixed
- 通栏拉伸导致的超长行与无视觉中心（≥1440px）。
- 总览日脊过高（约 1344px）压制首屏、Ticker 密集滚动带的信息噪音。
- 任务页 35+ 筛选 chip 墙（5 行）与分组行的中部空洞。
- 收件箱嵌套双层容器与重复内边距。
- 回顾上下两排栅格比例不一致（本周完成 / 能量分布不等宽）。
- 不回归既有质量项：命令面板焦点还原与 `margin:0 auto` 居中、灰阶对比 token、选中 chip 可读性、reduced-motion 全部保持不变。

### Notes
- 版式重排证据另存 `.qa/v04/`；`design-drafts/**`、`data/**`、既有 `.qa/v03` 证据与 `QA-REPORT-v0.2.md` 保持不变。
- `npm run build`（tsc -b + vite build）通过。

### 数理自适应系统（2026-10-02 · 公式驱动 + 容器自适应）

在版式重排基础上，将几何系统升级为公式驱动：字号与间距改为 Utopia 流体 `clamp`，组件内部改用容器查询。原则：1440px 保持既有视觉尺寸，流体仅在 <1280 收紧、>1280 打开。

#### Added
- 流体字号表（tokens.css §5.3）：caption→display 改为 `clamp(MIN, INTERCEPT + SLOPE·vw, MAX)`，锚点 390/1440；micro 保持固定。
- 流体间距表（tokens.css §5.4）：`--space-5..10`、`--pad-card`、`--row-min`、`--page-margin` 流体化；微步 4/8/12/16 固定（保 4px 栅格 + 行内对齐）。
- φ 间距层级：`--rhythm-inner/element/section/page` = 1 : φ : φ² : φ³（10.4 / 16.83 / 27.23 / 44.05 @1440），落在 panel 头 / chips / `.k-view` / 页边距。
- 容器查询层：`route`（版心）/ `stat`（瓦片）/ `task`（任务行）/ `pcard`（看板卡）/ `drawer`（抽屉）五个具名容器；组件内部自适应改由容器宽度驱动。
- 文档 `docs/08-MATH-SYSTEM.md`：方法论、字号/间距流体表、φ 层级表、容器地图、动效常数、复算与验证方法。
- 验证证据 `.qa/v05/`：1280/1440/1680/390 四档截图 + 程序化实测（流体与容器行为数值）。

#### Changed
- 总览统计瓦片、看板、日历主体、回顾分区、设置栅格、任务过滤行/行内 meta 的断点由视口媒体查询改为容器查询；shell（导航轨道 / 顶栏 / 移动底栏）仍用媒体查询。
- 动效曲线对齐：`EASE_STANDARD` 与 CSS `--ease-standard` 统一为 `cubic-bezier(.22,.61,.36,1)`；`lib/motion.ts` 补距离分级与 stagger 公式注释。
- 散文约束统一到 `--measure: 65ch`；勾选框改用 `em` 相对尺寸随流体字号缩放。
- 圆角比值（16 / 12 / pill）与动效距离分级在 tokens 内文档化。

#### Removed
- 死代码：`src/components/Ticker.tsx` + `.k-ticker*` CSS（总览已用状态胶囊替代）、`src/components/charts/Sparkline.tsx` + `.k-spark*` CSS、`.k-heat*` CSS（HeatGrid 已于 v0.3 删除）、`.k-overview__flows`、`.k-task__rank`、`.k-rail__en` 选择器、DaySpine mini 变体与 `.k-spine--mini` CSS、未用 token `--pad-row`。

### Notes
- 数理自适应证据另存 `.qa/v05/`；`design-drafts/**`、`data/**`、既有 `.qa/v03|v04` 证据与 `QA-REPORT-v0.2.md` 保持不变。

### 文档一致性修订（2026-10-02 · 收尾）

- 全量同步 20 处失同步：宪法总览规格（Ticker→状态 chips、迷你日脊→ScheduleList）与 §5 流体数值/间距/网格；设计系统（display 流体公式、容器查询、动效清单、组件词汇、删除组件注记）；文件树补 `docs/08`；文档索引补 08 与 ADR-0003；`AGENTS` / `01` / `02` / `CHANGELOG` 的「待接入 v0.4 → v0.5」徽标顺延；路线图补记三个追加波次；删除零引用 token `--gutter`。
- `TASK_BOOK.md` 新增「下一会话待办」：验收 → git 初始化 → v0.4 数据服务 → v0.5 AI 接入。

### 界面缺陷修复（2026-10-02 · 品牌锁排 / 接缝对齐 / 审阅缺陷）

所有者反馈左上角品牌区疑似被遮盖。复核确认：`KERNEL` 字标在 96px 索引轨道内溢出被裁切（仅显示 "KERNE"），且轨道品牌行（104px）与顶栏（84.8px）底边发际线错位约 19px。本次修复该缺陷及全站审阅确认的其余缺陷；功能、数据、路由不变。

#### Fixed
- 品牌锁排：`.k-rail__brand` 改「K 标 / KERNEL / 版本」垂直居中锁排，96px 轨道内完整显示（实测 scrollWidth 95 = clientWidth 95，零溢出）；折叠态仅保留 K 标。
- 接缝对齐：`.k-topbar` 增加 `min-height: var(--topbar-h)` + 垂直居中，与轨道品牌行共享 104px 基准，两条底边发际线连成一线；移动端保持自适应高度（`min-height: 0`）。
- Toast 跟随折叠：折叠态同步 `<html data-rail>`（`AppLayout.tsx`），`.k-toasts` 偏移改 `calc(var(--rail-current) + …)`（展开 120px / 折叠 88px 实测）。
- 原生控件主题化：`:root` / `[data-theme='light']` 声明 `color-scheme`，暗色下原生滚动条/控件不再呈现亮色。
- 任务页：groupbar 内 `.k-collapse-head` 保持自身宽度，「更多筛选 MORE」与分组切换回到同一行（原 `width:100%` 独占整行导致换行与约 90px 垂直空档）。
- 项目页：`.k-pcard__next .u-label` 禁止挤压换行，「下一步」不再竖排断字。
- 回顾页：`TrendBars` 0 值柱改 2px 平基线（原 4px 圆头短柱与实值柱混淆）；低能斜纹改 `--muted` 并放宽间距，能量分布感知权重恢复 低<中<高。
- 日历：`.k-cal__bar` 桌面端吸顶（`top: var(--topbar-h)`），自动滚动到「现在」后仍保留日期与「回到现在」上下文。
- 度量条阈值线改为可见（`--muted` / 0.7，原 `--bg` 不可见）。
- `.gitignore` 增补 `.playwright-mcp/`、`.codegraph/`、`.omo/`。

#### Notes
- 审阅证据与报告：`.qa/review/`（8 视图截图 + `REVIEW-2026-10-02.md`，含剩余 19 项分级建议）；修复复核截图：`.qa/issue/`。
- 审阅其余发现（原型态数据一致性 P0、任务时间筛选、撤销/确认、看板空列等）已列入 `TASK_BOOK.md`「审阅发现（Review Findings）」跟踪，其中 1–6 建议并入 v0.4 范围。
- `npm run build`（tsc -b + vite build）通过。

### 体验增强（2026-10-02 · 审阅 P1 第一批）

落地 `.qa/review/REVIEW-2026-10-02.md` 审阅建议的 P1 前几项：任务时间维度、撤销、统一时间刷新、AI 卡动态计数。功能、数据、路由不变（原型态纪律保持）。

#### Added
- 任务页「时间」筛选组：逾期 / 今天 / 本周（周一–周日区间落点），与状态筛选组合生效。
- 任务默认排序：截止近者优先（无截止垫底）→ 重要性 → id 稳定（`byDueTask`）。
- 任务深链：`/tasks?task=<id>` 直达任务详情抽屉；总览「下一步行动」点击直达对应任务（原仅跳转列表页），关闭抽屉时清理查询参数。
- Toast 动作支持（`ToastOptions.action`；带动作默认停留 5s，动作按钮 click 后即消失）：完成任务、取消完成、收件箱任一澄清动作（含丢弃）均可 5s 内「撤销」。
- `src/lib/hooks.ts`：`useNow`（统一 60s 时刻刷新）与 `useUndoableToggle`（完成切换 + 撤销，返回 wasDone）。
- 总览「下一步行动」勾选完成支持撤销；AI 建议卡第 2 条数字改为动态（收件箱含原型态捕捉）。

#### Changed
- 时刻口径统一：总览 / 日历 / 任务 / 资料 / 收件箱 的相对时间与「今天」判定全部走 `useNow`，每 60s 自动刷新（原仅总览与日历带定时器，任务 / 资料 / 收件箱渲染时取一次）。
- 总览收件箱计数对齐：`getInboxCount() + protoInbox.length`（与状态条、收件箱页未澄清数同口径；完整数据源统一仍属 v0.4 范围）。

#### Notes
- 验证证据 `.qa/v06/`（时间筛选 / 排序 / 深链 / 撤销断言与截图，控制台无错误）；`npm run build`（tsc -b + vite build）通过。
- 审阅 P1 剩余项：日历翻周 + `deferUntil`、回顾步骤持久化 + 资料搜索、a11y 三处——保留在 `TASK_BOOK.md` Handoff。

## [v0.2.0] - 2026-10-02

高保真前端原型。在 v0.1 的文档系统、脚手架与文件式数据层之上，实现完整的可演示 UI、动效系统与移动端适配。所有用户可变操作仅写 localStorage 覆盖层，`data/**` 保持只读。

### Added
- 应用壳（`src/components/shell/`）：RailNav（展开 96px / 收起 64px 索引轨道，折叠状态持久化，移动端转底部标签栏）、TopBar（章节序号 + 瑞士式大标题 `01 / 总览 OVERVIEW` + 命令入口 + 主题切换）、StatusBar（实时时钟 / INBOX / WIP / 数据快照 / AI 状态 / PROTO 标识）、AppLayout（布局路由 + 路由进入动效 + 全局快捷键 `Ctrl/Cmd+K`、`c`）。
- 八个视图：
  - 总览 OVERVIEW：Ticker 信号带、4 统计瓦片（收件箱水位 / 今日任务 / WIP / 刷题连续，含计数动画）、今日日脊 mini（含 Now 线）、下一步行动 TOP 6（展示排序依据标签）、存量与流量面板、AI 建议卡占位。
  - 收件箱 INBOX：快速捕捉（快捷键 `c` 聚焦）、水位 MeterBar、未澄清列表（来源图标 / 相对时间 / 澄清操作条 `→任务 / →项目 / →笔记 / →资源 / 丢弃`）、已澄清与已丢弃折叠区。
  - 任务 TASKS：未完成/逾期/今日计数、筛选条（状态/上下文/能量/区域/身份）、分组切换（平铺/按项目/按上下文）、行内完成划线 + 塌缩动效、行内快速新建、全字段详情抽屉（标记完成可用）。
  - 日程 CALENDAR：0–24h 垂直日脊、事件块重叠分列、实时"现在"线（每分钟更新 + 呼吸）、全天事件条、周条密度 mini 地图、前一天/今天/后一天导航、事件详情抽屉。
  - 项目 PROJECTS：四列看板（进行中/暂停/将来/已完成）、卡片含 outcome、下一步、进度 MeterBar、区域标记、截止；详情抽屉含项目任务清单。
  - 资料 LIBRARY：笔记 + 资料混合流、按标签页/类型/状态/标签筛选、笔记蒸馏度指示、react-markdown 阅读抽屉含反向链接、资料抽屉含链接与备注。
  - 回顾 REVIEW：当前周期摘要（2026-W40 + 9 月）、"开始周回顾"五步流程抽屉、本周指标计数、单色图表（TrendBars + EnergyBars）、停滞项目清单（迁移/归档演示）。
  - 设置 SETTINGS：主题切换、数据统计表、AI 集成状态（OFFLINE + 路线图）、关于 KERNEL、原型态说明与清除入口。
- 命令面板（cmdk）：`Ctrl/Cmd+K` 开关、导航 / 动作 / 原型标注三组、墨底纸字反选行、全键盘导航、fade + 4px 升起 180ms、`↑↓ 导航 · ↵ 选择 · esc 关闭` 页脚提示。
- 全局组件词汇（`src/components/`）：Panel / StatTile / TagPill / Checkbox / TaskRow / Drawer / FilterBar / MeterBar / Sparkline / TrendBars / HeatGrid / EnergyBars / Ticker / DaySpine / EmptyState / Skeleton / Toast / CountUp。
- 动效系统（Motion + View Transitions API）：路由进入（fade + 6px 升起）、列表 stagger 入场（60ms 步进，前 12 项）、数字滚动、完成任务划线 + 塌缩、悬浮反转（TagPill / 行 / 面板项）、Now 线呼吸、Ticker 横向滚动（悬浮暂停）、命令面板出入场；统一由 `MotionConfig reducedMotion="user"` + CSS `prefers-reduced-motion` 降级。
- 原型态本地层（`src/lib/proto.ts`）：任务完成写 `kernel:proto:done`、收件箱捕捉写 `kernel:proto:inbox`、快速新建任务写 `kernel:proto:tasks`，并通过订阅跨视图联动；界面以「原型态」明确标注，不写入 `data/`。
- 主题系统：`useTheme` + localStorage `kernel-theme`，默认系统偏好，首帧 FOUC 防护沿用 `index.html` 内联脚本。
- 响应式：≥1280px 全尺寸；768–1280px 图标轨道；<768px 底部标签栏 + 精简状态条 + 单列布局 + 全宽抽屉，适配至约 390px。
- 设计系统落地：`src/styles/` 五个文件（tokens / base / shell / components / views），全部使用 token、零圆角、发际线；新增透明度辅助 token 与自托管可变字体族并入字体栈。
- 工程：资料页按需加载（`React.lazy`）以压缩首屏包体；`npm run build`（tsc + vite）通过。

### Notes
- AI 能力仅为 UI 预留（AI 建议卡、命令面板入口），标注"待接入 v0.5"（当时代号 v0.4，路线图重编号后顺延）。
- 原型态的澄清 / 迁移 / 归档为演示动作 + 提示，计划 v0.3 起持久化写入 `data/`。

## [v0.1.0] - 2026-10-02

工程地基。建立文档系统、前端脚手架与文件式数据层，作为后续所有迭代的基线。

### Added
- 文档系统：`README.md`、`AGENTS.md`、`CHANGELOG.md`、`TASK_BOOK.md`、`docs/01` 到 `docs/07`、`docs/decisions/0001` 与 `0002`。
- 项目宪法 `docs/00-DESIGN-BRIEF.md`（v1，2026-10-02）。
- 工程脚手架：Vite + React 19 + TypeScript（strict）+ 原生 CSS token 体系。
- 路由骨架：`/` 总览、`/inbox`、`/tasks`、`/calendar`、`/projects`、`/library`、`/review`、`/settings`。
- 数据层（v1 文件式）：`data/` 下按实体分目录、一记录一文件的 JSON；前端经 `src/lib/data.ts` 读取。
- 种子数据：任务 40 到 60 条、事件 15 到 20 条、项目 8 到 10、目标 6 到 8、习惯 4 到 6、笔记 10 到 15、资源 10 到 15、收件箱 5 到 8、回顾 2 条，以 2026-10-02 为"现在"。
- 元数据：`data/meta/config.json`、`data/meta/tags.json`。

### Notes
- v0.1.0 不含数据服务与 AI 接入，两者分别规划在 v0.3.0 与 v0.4.0。
- 数据字段规范见 `docs/04-DATA-MODEL.md`；目录职责见 `docs/05-FILE-TREE.md`。
