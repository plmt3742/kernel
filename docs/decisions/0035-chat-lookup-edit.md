# ADR-0035 · 总览 AI 对话：实体查阅与代改（QA v73 批次）

- 状态：已采纳
- 日期：2026-10-04
- 相关：ADR-0010（总览 AI 对话）、ADR-0009（详情编辑 / 更新端点）、ADR-0011（先确认后写入）、ADR-0022（界面状态保留）

---

## 1. 背景与反馈

所有者：

> 「请你为总览页面的 AI 添加一个功能……比如我现在想要了解某个日程或任务或者是资料或者笔记什么的东西，它就可以帮我回答出来，就是这一个东西的详细内容。比如说我要说改一下这个日程的某个时间，那它就会帮我改。」

此前的总览 AI 对话（Slice G / G.1，见 ADR-0010）只能基于**有界摘要**作答：模型看不到某条记录的完整字段，无法回答「这一条的详细内容」，更不能承接「帮我改一下」的诉求。系统已有成熟的编辑端点 `POST /api/<kind>/:id/update`（ADR-0009）与「先确认后写入」纪律（ADR-0011），缺的是对话侧的**调取**与**修改提案**两条链路。

## 2. 决策

### 2.1 实体查阅（entityQueries → resolveEntities）

- 提示词（`buildChatSystem`）新增能力：当问题深入到某条记录、而摘要不足时，模型**只输出一个 JSON** `{"entityQueries":["关键词","…"]}`（1–3 条、每条 ≤30 字），不夹杂其他文字；**一次对话最多请求一次实体调取**。
- 服务端 `tryParseEntityRequest` 解析该形状（非该形状 → `null`；清洗 / 截断：≤3 条、每条 ≤30 字）；`resolveEntities(snapshot, queries)` 按关键词跨集合（任务 / 日程 / 资料 / 笔记 / 项目…）确定性匹配**完整记录**（每条查询 ≤3 条、同查询去重、笔记正文截断 ≤600 字），命中结果作为第二轮上下文**回喂同一会话**。
- 响应新增 `focused: string[]`（本轮查阅过的实体标题，≤6 条、每条 ≤80 字）；前端在助手轮下方显示安静行「已查阅 · 标题1 · 标题2」；无命中不下发。

### 2.2 修改提案（editRequest → buildChatEdits → 修改卡）

- 第二轮回喂后，如用户意在修改，模型产出 `editRequest`（`{kind, id, fields}`）；服务端 `tryParseEditRequest` 解析（未知 kind / 非法 id / 空 fields / fields >12 键 → `null`），`buildChatEdits` 对照快照做**白名单校验**：kind 属于可编辑实体、id 真实存在、fields 仅允许该实体可编辑字段、**最多 3 条**；全部无效时回退文案「我没能确认这条记录的修改（找不到记录或字段不合法），请换一种说法再试。」且不下发 `edits`。
- 响应新增 `edits`：每条含 `kind / id / title / fields`（拟修改值）与 `before`（当前值，**撤销凭据**）及 `label`（人类可读说明）。
- **零写入**：服务端只读；前端渲染「修改卡」（`.k-chat__edit`）——逐字段「旧值 → 新值」（字段名 → 中文标签映射、时间格式化），点「应用」才逐条经既有 `POST /api/<kind>/:id/update`（`updateEntity`，串行、防重复提交）写入，成功 toast「已修改「标题」」+「撤销」——**逆序写回 `before`** 还原；点「忽略」仅本地标记。
- 持久化（同 ADR-0022 纪律）：`focused`（≤6 / ≤80）与 `edits`（≤3 条、逐条重校验形状）随对话落 `localStorage`（`kernel.ui.chat.v1`），刷新后「已应用 / 已忽略」状态保留；有提案的轮次缺省为「待确认」。

## 3. 边界

- **确认前零写入**：一切修改只在点「应用」后经单写者落盘；「忽略」不触数据。
- **抗幻觉由构造保证**：模型只能输出关键词与 `kind / id / fields`，命中与否由服务端按快照裁量；找不到 / 不合法一律不放行。
- 一次对话最多一次调取（防多轮往返放大延迟）；`focused` / `edits` 是只读辅助行，不属于收件箱 `actions` 动作数组。
- 对话本身仍**不落盘、无审计**（同 ADR-0010）；撤销为逐条逆向更新（单写者串行写入，不承诺跨条原子）。

## 4. 验证与证据

QA `.qa/v73/`：

- **服务端冒烟 ALL PASS（41 项）**——A1 共 18 项单测（`entityQueries` 清洗 / 代码栅栏 / ≤3 截断 / 关键词 ≤30 / 非法形状 null；edit 解析 / 未知 kind / 非法 id / 空 fields / >12 键 null；`resolveEntities` 命中 / 每问 ≤3 / 无匹配空 section / 跨集合匹配 / 笔记正文 ≤600 / 同查询去重）；A2 实机查阅（「某餐厅」→ `focused=["某餐厅自助餐"]`，回答含时间 / 状态）；A3 实机修改提案（`edits` 指向当前事件、`before.startAt` = 撤销凭据）。
- **浏览器 verify（0 FAIL）**——B4 修改卡端到端：卡片「将修改…」+ 字段 diff（→）→ 点「应用」→ 数据变化（`startAt`= 明日 15:00）→ toast「已修改」+ 撤销 → 回原值；390 零横溢、console 0。
- **零写入纪律**：不点「应用」数据不变（A3 仅下发建议）；撤销往返逐字节回原值。

## 5. 后果

- **正面**：对话从「摘要问答」升级为「查记录 + 提议改」；修改全程可见、可拒绝、可撤销，延续「先确认后写入」。
- **代价**：涉及具体记录时每轮最多两次模型往返（调取 + 作答），必要时延；匹配为关键词确定性逻辑，极端表述可能「找不到记录」（有可读回退文案）。
- **约束**：不做多轮连续调取；不做跨实体批量改写类激进操作（edits 每条独立、白名单内）。

## 6. 修订（2026-10-07）：对话内新建任务与日程（taskRequest / eventRequest）

答 owner 实机反馈「让 AI 记一条任务，它说『已记下，为你建立这条任务』，但任务根本没建」——**根因**：对话此前只有查阅（§2.1）与「修改**已有**记录」（§2.2）两条链路，**没有任何新建能力**；模型面对「帮我记一条任务」无结构化出口，遂以自然语言谎称「已记下」，服务端无 create 字段可下发、前端无卡片可渲染，故**零写入**。同日追加：答 owner「添加新建日程以及任务功能」，同构补上**日程**提案。

新增两条创建提案链路（均与 §2.2 修改卡同构，独立于 edit 的第 5 / 第 6 类意图）：

- 提示词（`buildChatSystem`）新增规则：用户想新建**待办任务**（将来要去完成的事）时，**只输出一个 JSON** `{"task":{"title":"≤80 字","dueAt":"可选 ISO8601 带时区（仅当用户已明确给出日期 / 时间才填）","importance":可选 0–3 整数}}`；想新建 / 内容含**会在某明确时刻发生的事**（会议 / 面试 / 考试 / 讲座 / 活动）时 `{"event":{"title":"≤80 字","startAt":"必填 ISO8601 带时区","endAt":"可选","allDay":"可选 true","location":"可选 ≤60 字"}}`；**同一 JSON 可同时输出 event 与 task**（通知「10/9 19:30 初赛 + 10/7 17:00 报名」→ 日程 + 任务两张卡）。分流——已做完 → trace；会在某时刻发生的事 → event；将来要做的待办 → task；纯想法 / 感悟 → 笔记。**时间无法明确推出才不产 event**。
- **禁止谎报写入**（堵幻觉）：提示词新增硬纪律——你只能输出 JSON 提案或用文字回答，**绝不能声称已完成任何写入**，不得写「已记下 / 已建立 / 已创建 / 已保存 / 已修改」，提议一律用「确认后建立 / 确认后生效」。
- 服务端 `tryParseTaskRequest`：title 必填（≤80，超长截断）；`dueAt` 仅在为 **ISO8601 带时区**（与 `schema.iso` 口径一致）时保留、否则**丢弃该字段**（不因格式错误整体作废）；`importance` 仅 0–3 整数保留；非该形状返回 `null`。
- 服务端 `tryParseEventRequest`：title 必填（≤80）；`startAt` 必填且须 ISO8601 带时区，**否则整条返回 `null`（不产 event，与收件箱 N10 同口径）**；`endAt` 仅在 ≥ `startAt` 时保留；`allDay` 仅 `true` 保留；`location` ≤60。两个解析各自独立，故同一 JSON 内可同时命中。
- 解析优先级 `trace > edit >（task|event）`（与 edit / trace 互斥）。`chatWithKernel` 返回 `taskRequest` / `eventRequest`；`POST /api/ai/chat` **只读清洗后**以 `task` / `event` 原样下发，回复文案「识别为一条任务 / 日程：「标题」。确认后建立。」（两者都有时「识别为 1 条日程「…」与 1 条任务「…」。确认后建立。」）。
- 前端 `OverviewChat`：新增「建立任务卡」与「建立日程卡」（均复用 `.k-chat__edit*` 样式）——分别显示标题 / 截止或开始·结束·地点，「建立」按钮经**既有** `POST /api/tasks`（`createTask`，`ai:true` → 新标签按 `origin:'ai'` 登记）或 `POST /api/events`（`createEvent`）落盘，成功 toast「已建立任务 / 已建立日程」+「撤销」（入回收站）；「忽略」仅本地标记。**本端点不新增写入面**。

**纪律**（同 §3）：确认前零写入；对话本身不落盘无审计；抗幻觉由构造保证（模型只能输出提案，一切写入必经用户按钮）。

**验证**：`tryParseTaskRequest` 单测 **6/6** + `tryParseEventRequest` 单测 **7/7**（缺 startAt / 非 ISO 时间 / end<start 丢弃 / allDay / event+task 同 JSON / 超长标题截断）；`node --check server/{ai,index}.mjs` 0；`npx tsc --noEmit` 0；`npm run build` 退出 0。**实机端到端**（服务端重启后复现 `/api/ai/chat`）：① 原反馈对话（「打算做 Java 实验作业」→「截止今晚 23:59」）→ `task={"title":"完成 Java 实验作业","dueAt":"2026-10-07T23:59:00+08:00"}`；② 通知「10月9日 19:30 新生辩论赛初赛…报名 10月7日 17:00」→ `event={"title":"新生辩论赛初赛（观看，19:20前签到入场）","startAt":"2026-10-09T19:30:00+08:00","endAt":"2026-10-09T21:30:00+08:00","location":"某活动中心报告厅"}` **且** `task={"title":"报名新生辩论赛初赛观看…","dueAt":"2026-10-07T17:00:00+08:00"}`、reply「识别为 1 条日程…与 1 条任务…。确认后建立。」（零写入）。

**已知边界**：本修订支持**新建任务与日程**；对话内新建项目 / 笔记仍未接（笔记走「整理进笔记」）；新建任务卡 / 日程卡与踪迹卡同样**不随刷新持久化**（`normalizeTurn` 未还原 `task` / `event` / `trace`，与现状一致）。

## 7. 修订（2026-10-08）：多意图 + 多条（traces / tasks / events 同段共存）

答 owner「可以加强这个总览对话」并选定「多意图 + 多条」——此前各类创建提案**互斥且各限一条**：命中踪迹就不再解析任务 / 日程，且任务 / 日程各只产 1 条。这导致一段日记（「今天做了什么 + 接下来要做什么」）只能收下其中一类——如「下周一/二去外地洽谈」被直接丢弃。

- **提示词**：任务 → `{"tasks":[…]} `、日程 → `{"events":[…]} `（各 **1–6 条**）；新增共存规则——一段内容既含已做的（traces）又含要做的（tasks / events）时，**在同一个 JSON 里同时给出 traces、tasks、events**。
- **解析**：新增 `tryParseTaskRequests` / `tryParseEventRequests`（数组，≤6；兼容旧 `{"task":{…}}` / `{"event":{…}}`）；`tryParseTraceRequests` 已有。`chatWithKernel` **同时**解析三类、互不排斥；创建类提案优先于 `editRequest`；回复文案由 `buildCreateReply` 汇总（单一则点名，多类则计数）。
- **接口**：`/api/ai/chat` 下发 `traces` / `tasks` / `events` 三个数组。
- **前端**：任务 / 日程卡同踪迹卡一样改**多行可编辑**（标题输入 + 只读时间 / 地点 + 单行删除）；任务卡与踪迹卡带「**拆分**」（追加一行，≤6；日程因 `startAt` 必填不提供手动加行）；「建立」逐条经既有 `POST /api/tasks` / `/api/events`（`ai:true`）落盘，toast「已建立 N 条… · 撤销」（逐条回收站）。三类卡可**同时**出现。

**边界**：仍不做项目 / 笔记的对话内新建（见 §6）；提案卡不随刷新持久化；确认前零写入；无新端点。

**验证**：`tryParse{Task,Event,Trace}Requests` 单测（数组 / 旧单条兼容 / 上限 6 / 三类同 JSON 共存）；`node --check` / `npx tsc --noEmit` / `npm run build` 0；**实机**按 owner 日记长文复现 → 同时返回 **4 条踪迹 + 1 条日程**（未来安排「下周一/二去外地洽谈」→ allDay 日程 10/12–10/13），reply「识别为 4 条踪迹、1 条日程。确认后分别建立。」。

## 8. 修订（2026-10-08）：多轮工具 · 流式 · 新建项目/笔记 · 完成/删除/归档 · 贴图/附件

答 owner「一次性把这些功能也做了吧」（对话加强的剩余四项）——总览对话从「单轮、整段返回、只读 + 创建」升级为「可多轮工具、流式生成、能操作既有记录、能看图/读文件」。

- **多轮工具**：工具循环由「调取 / 检索各一次、最多 2 轮」放宽为**最多 4 轮**（其中实体调取 ≤3、联网检索 ≤2），直到模型不再请求工具。
- **对话内新建项目 / 笔记**：新增 `{"projects":[{title,outcome?}]}`（1–3）与 `{"notes":[{title,body}]}`（1–3）提案 + `tryParseProjectRequests` / `tryParseNoteRequests`；前端「建立项目卡」「存为笔记卡」（多行可编辑 + 拆分 / 删除），点「建立 / 存为笔记」经**既有** `POST /api/projects`（`ai:true`）/ `POST /api/notes` 逐条落盘 + toast 撤销（回收站）。
- **完成 / 删除 / 归档**：新增 `{"actions":[{op:"complete|reopen|delete|archive",kind,id,label?}]}`（1–3）提案；服务端**校验**（id 真实存在；`complete/reopen` 仅 tasks、`archive` 仅 projects/resources、`delete` 限可回收实体）并附记录标题（archive 附 `before` 状态），非法项丢弃；前端「操作卡」逐条执行——complete→`POST /api/tasks/:id/complete`（写 `doneAt` + 审计 `beforeStatus`）、reopen→`/reopen`、delete→软删除、archive→`POST /api/<kind>/:id/update {status:'archived'}`；撤销分别为 reopen / complete / restore / 写回 `before`。
- **流式**：新增 `POST /api/ai/chat-stream`（SSE，镜像收件箱解析流的 `data: <json>\n\n` 帧：`status` / `delta` / `result` / `error`）；`chatWithKernelStream` **先订阅** opencode 事件流再建会话、按 sessionID 转发 `session.status` 与 `message.part.delta`；前端 `aiChatStream`（fetch + ReadableStream 帧解析）边收边渲染助手气泡，`result` 落定。同步 `/api/ai/chat` 保留为回退。
- **贴图 / 附件**：新增 `POST /api/ai/chat/upload`（RAW ≤25MB → `data/files/chat-*`，返回 `{stored,name,mime,size}`）；聊天请求可带 `attachments`（≤6），服务端解析为 opencode `{type:'file', url:'data:<mime>;base64,…'}` 文件 part 注入首轮（含重试）；composer 支持附件按钮 / 拖拽 / Ctrl+V 粘贴截图 + 待发 chips。
- **全类共存**：所有提案（traces / tasks / events / projects / notes / actions / edits）均从同一 JSON **独立解析、可同时出现**，回复由 `buildChatReply` 汇总计数（单一则点名）。

**边界**：对话本身仍不落盘无审计、确认前零写入；附件为临时输入（不建实体）；不新增依赖。

**验证**：三个新解析器单测 + 七类同 JSON 共存单测；`node --check` 0；`npx tsc --noEmit` 0；`npm run build` 0；**实机**（`/api/ai/chat` + `-stream` + `/upload`）：① 一句话同时产出 **1 个项目 + 1 条笔记**；② 流式返回 `status,delta,result`（**362 个增量帧**），result 帧含全部契约字段；③ 上传 201 返回 `stored`；④ 带附件读图 → 「纯白色的空白图」；⑤ 操作提案 → `actions:[{op:'complete',kind:'tasks',id:'t-0002',…}]`（含标题快照）。

## 9. 修订（2026-10-09）：全面审计驱动的 P0（摘要 v2 · 停止生成 · IME · 附件完整性 · 防重复 · 挂接项目）

答 owner「总览页的 AI 助手不够全面完整……全面检查还有哪些需要优化的方面」——先四路并行只读审查（前端组件 / 后端 AI 链路 / HTTP 契约 / 文档意图）+ Oracle 复核（修正 5 处误判、补出 6 个真实使用场景），产出 P0/P1/P2 分级清单；本轮落地 **P0 六项**。

- **摘要 v2**：`buildChatDigest` 增【今日课程】【习惯打卡】【近 48h 踪迹】【今日已完成】四段，并对逾期 / 今日到期 / 下一步**过滤 `deferUntil`**（与任务页口径一致）；新增 `weekOfTermNumber` 按学期周 + 星期过滤课程并合并同课程相邻节次。此前摘要不含课程 / 习惯 / 踪迹 → 「今天有课吗 / 打卡了吗 / 我今天做了什么」只能答「数据里没有」。
- **停止生成 + 保留部分输出**：`aiChatStream` 增 `AbortSignal`；前端模块级 `AbortController` + 生成中「停止」按钮（替换发送键）；中止时把已流出文本保留为一条助手轮次（附「（已停止生成）」）。
- **中文 IME 守卫**：composer Enter 加 `event.nativeEvent.isComposing` 判断（镜像 `Traces.tsx`），拼音候选期回车不再误发送。
- **附件完整性**：上传**成功后才清空**待发队列（失败保留可重发）；用户气泡显示附件名（写入轮次 `attachments`，随对话持久化）；重试复用附件引用；文件选择加 `accept`；>25MB 客户端预检；上传阶段气泡显示「正在上传附件…」。
- **创建卡防重复**：五类创建卡（踪迹 / 任务 / 日程 / 项目 / 笔记）统一为通用 `applyCreate`——逐行创建，全部成功方标记「已应用」；**部分失败时成功行移出卡片、仅保留失败行待重试**（此前各自 try/catch 整体中止、卡片仍 pending → 重试全量重跑造成重复）。
- **创建记录挂接项目**：`traces / tasks / events` 提案新增可选 `projectId`（提示词 + `clean*Item` 清洗 + 前端类型 + apply 透传；落盘时经既有创建端点校验项目存在）。
- **卡片持久化补齐**：`normalizeTurn` 增 `normalizeTraces` / `normalizeTasks` / `normalizeEvents`——刷新后**踪迹 / 任务 / 日程**三类提案卡不再丢失（此前仅 edits / projects / notes / actions 存活，属不一致）。

**边界（本轮未做，列入 TASK_BOOK 待办）**：深链闭环（应用后「查看」/ `focused` 可点 / 检索来源 URL）· 按卡 `applying`（现为全局锁）· `NOTE_INTENT` 收紧 / 空态示例 / 滚动尊重 · 习惯打卡 action · `data/files/chat-*` 生命周期清理 · `remark-gfm` 表格 · multi-edit ≤3。历史遗留不变：`buildChatEdits` 每轮限 **1 条**（§2.2 的「≤3」实为 localStorage 恢复上限）；对话无跨请求记忆（每轮新 opencode session）。

**验证**：`buildChatDigest` 夹具探针 6/6（课程按周 / 星期过滤 + 相邻合并 · `deferUntil` 过滤 · 逾期 · 今日已完成 · 习惯 N/M · 48h 踪迹窗口）；`node --check` 0；`npx tsc --noEmit` 0；`npm run build` 0。

## 10. 修订（2026-10-09）：审计修复续（P1/P2 批次）

同日续作：P0 之后按审计清单继续落地 P1 / P2（详见 CHANGELOG 同日条目「审计修复续」）。

- **深链闭环（P1-2）**：`buildSearchSection` 回传 `sources`（title/url ≤6、按 url 去重）→ 响应 `searchSources`，「已联网检索」行附**来源链接**；`resolveEntities` 回传 `items`（kind/id/title）→ 响应 `focusedRefs`，「已查阅」渲染为**可点深链**（`deepLinkOfId`）；应用成功后 `createdRefs` 记录产物 id，「已应用」行给「**查看**（单条→实体详情）/ 查看全部（多条→列表页）」。
- **按卡 applying（P1-3）**：全局 `applying` 布尔 → 按卡键 `${turnId}:kind`（ref 同步判重 + state 驱动渲染），**卡与卡互不阻塞**（同卡仍互斥防重复提交）。
- **交互润滑（P1-4）**：`NOTE_INTENT` 收紧（以问号结尾的疑问句不再劫持为整理指令）；空态**示例问题**（点击填入草稿）；`saveTurnAsNote` 防连点；滚动**尊重用户上滑**（距底 <48px 吸底）+「回到底部」；>20 条时显示上下文截断提示。
- **习惯打卡 action（P1-5）**：`actions` 增 `checkin` / `uncheckin`（仅 `habits`）；服务端 `CHAT_ACTION_KIND_BY_OP` + `cleanActionItem` 闭合集扩展；前端 `ACTION_RUN` / `ACTION_UNDO` / `ACTION_LABEL` / `ACTION_KINDS` 同步（撤销 = 反向打卡）。
- **chat-* 生命周期（P1-6）**：数据服务启动时清理 **>7 天**的 `data/files/chat-*`（无实体引用的临时输入；失败静默）。
- **multi-edit ≤3（P2-2）**：提示词与解析支持 `{"edits":[{…}, …]}`（**≤3**，兼容旧 `{"edit":{…}}`）；`tryParseEditRequests` + `buildChatEdits` 逐条校验、按 id 去重、总上限 3——§2.2 的「≤3」自此与实现对齐（此前每轮限 1 条）。
- **资源从对话入档（P2-3）**：`{"resources":[{title,url?,note?}]}`（1–3）提案 +「收录资料卡」→ 既有 `POST /api/resources` + 撤销。
- **子任务挂接（P2-3）**：`tasks` 提案支持可选 `parentTaskId`（落盘由既有 `assertValidParentTask` 护栏校验存在 / 不自引用 / 不成环）。
- **remark-gfm 表格（P2-1）**：助手回复支持 GFM 表格（新增依赖 `remark-gfm`，已入前端白名单 `${docs/02}`）；`.k-chat__md table` token 样式；每轮「**复制**」按钮（剪贴板）；轮次**时间戳**（当天 HH:mm、跨天 M/D HH:mm）。

**边界（显式延后，记录于 TASK_BOOK）**：按筛选批量（带预览——批量破坏性操作需专用预览 UI）· 对话内重复日程（`repeatRule` 全库仅展示保留、无写入路径）· 跨请求会话复用（单用户价值低；每轮已带有界历史）。

**验证**：解析器 / 摘要探针 **7/7**（multi-edit ≤3 与去重 · 旧式单条兼容 · resource 提案 · checkin/uncheckin · parentTaskId · resolveEntities items · digest v2 段）；`node --check` 0；`npx tsc --noEmit` 0；`npm run build` 0。

## 11. 修订（2026-10-09）：卡片字段 + 反问澄清 + 思考折叠

答 owner「卡片要能带 tag / 时间 / 地点，创建时一次带上；缺必要信息时 AI 要反问、再按回答完善，直到可执行」+「思考要可折叠、默认折叠、可展开」。

- **卡片字段**：`traces / tasks / events / projects / resources` 提案加 `tags`（`cleanProposalTags`：≤8 × ≤12 字、去重）；创建卡**就地编辑**（共享 `createRowFields` 按实体渲染），时间 `datetime-local` ↔ ISO8601 带偏移互转；apply 透传 tags（既有创建端点 + `ensureTags` 登记）。
- **反问澄清（AI 判断）**：新增顶层 `{"ask":{text,options,fields}}` 意图；`tryParseAskRequest`（text 必填 ≤200 / options ≤4×≤30 / fields ≤6×≤20）；`runChat` 返回 `askRequest`、reply = `ask.text`；`finalizeChatResult` 清洗透传 `ask`。提示词：AI 自行判断缺「必要且不可推断」信息时**先追问再出卡**（日程缺 `startAt`、任务缺 `dueAt`、日程缺 `location` 等），给 2–4 个候选选项，**同段最多追问 2 轮**；用户答后继续完善。前端「反问面板」：选项 chips（点击即发 `sendOption`）+ 自由输入；**仅最新轮可答**。
- **思考折叠**：捕获 `reasoning` 流（此前客户端只处理 text、**丢弃** reasoning）；`ChatTurn.reasoning` 随对话持久化；助手轮渲染「思考过程」`<details>`（**默认折叠**、可展开），内含 reasoning + 已查阅 / 已联网检索（含来源）步骤，流式阶段实时显示。

**边界**：追问上限（2 轮）由提示词约束（非服务端硬计数）；反问与提案互斥（同一轮不并出）；卡片未做「项目 / 区域选择器」（`projectId` 仍由 AI 依据摘要给出）。

**验证**：ask / tags 探针 **9/9**（ask 有效 / 无 text→null / 错形状→null / options ≤4；task·trace·event·project·resource tags 清洗去重）；`node --check` 0；`npx tsc --noEmit` 0；`npm run build` 0。
