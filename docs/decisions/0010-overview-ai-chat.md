# ADR 0010 · 总览升级（Slice G）：AI 对话 + 状态条重做 + 就地详情弹窗

- 状态：已接受
- 日期：2026-10-03
- 决策者：项目所有者（三条指令：① 总览加「能对话的 AI 盒」，读库回答（例「我今天有什么特别紧急需要去做的事情」），清空前按时间命名归档为可查阅文本；② 顶部三胶囊左右不对齐、要换展示方式；③ 工作台条目点击就地弹详情，不要跳转）+ 实证（`.qa/v23/slice-g-verify.py`）
- 关联：ADR-0004（数据服务）、ADR-0005/0006（AI 接入 / 解析升级）、ADR-0007（回顾 AI，SSE / 草稿模式参考）、ADR-0009（编辑 / 回收站）、`docs/02-ARCHITECTURE.md` §4、`docs/04-DATA-MODEL.md` §9、`CHANGELOG.md`、`TASK_BOOK.md`、`.qa/v23/`

---

## 1. 背景

v0.5 已把 opencode 接入收件箱解析与周 / 月回顾（ADR-0005/0006/0007），但「快速问一句、直接读库回答」的入口缺失：用户想懒得翻页时直接问「今天最紧急要做什么」。同时总览顶部三枚状态胶囊（下一项 / 收件箱 / 逾期）为左对齐、右缘参差；工作台条目点击仍跳转 `/tasks?task=`（抽屉在另一页打开、无高亮，指向不明）。本切片把这三点在总览内一并解决。

## 2. 决策

1. **AI 对话端点（`POST /api/ai/chat`，无状态）**：请求体 `{ messages: [{ role:'user'|'assistant', content }] }`；服务端**有界裁剪**（仅保留最近 `CHAT_MAX_MESSAGES=20` 条、单条 `CHAT_MAX_CHARS=4000` 字、合计 `CHAT_TOTAL_CHARS=16000` 字；末条必须为用户消息，否则 400）。服务端 `buildChatDigest(snapshot)` 拼「现状摘要」：现在时刻 / 逾期任务（含逾期天数 + 重要性）/ 今日到期 / 未来 7 天日程 / 收件箱积压 / 进行中项目 / 高优先下一步（按重要性，最多 12）。`buildChatSystem` 要求：**只依据摘要事实**回答，摘要外信息答「数据里没有」，被问「最紧急」按「逾期 → 今日到期 → 即将开始日程」排序；自然语言输出（不解析 JSON）。调用沿用既有 SDK 模式：`variant:'low'` + 120s 超时 + **单次重试**（失败或空响应），health 预检 503、失败 502。**AI 不落盘**。
2. **归档为笔记（通用 `POST /api/notes`）**：新建笔记端点——`title` 非空（否则 400）；`type` 取白名单（`fleeting|literature|permanent|meeting|memo`，缺省 `memo`）；`body` 原文（markdown 文本）；服务端 `nextId('notes')` + `commit()`（Zod + 原子写 + 审计 `note.create`），201 `{ note }`。前端「清空对话」在对话非空时**先** `createNote({ title:'AI 对话归档 · YYYY-MM-DD HH:mm', body: transcript, type:'memo' })`（transcript 为 `**我**` / `**KERNEL**` 交替的 markdown），**成功才清空**线程，并 toast「已归档为笔记」+「查看」动作跳 `/library?note=<id>`；归档失败不清空、显示错误 toast。
3. **状态条重做（`Overview`）**：三胶囊 → 整宽状态条 `.k-status`（`grid-auto-flow:column; grid-auto-columns:minmax(0,1fr)`，N 段等分、左右边缘贴版心），三段 下一项 / 收件箱 / 逾期 均改为可聚焦按钮（下一项 → `/calendar`、收件箱 → `/inbox`、逾期 → `/tasks`，`viewTransition`）；逾期恒显示（0 项时用安静点），≤640px 竖排、段间以横线分隔。
4. **就地详情弹窗（`Overview`）**：抽出 `src/components/TaskDetail.tsx` 与 `src/components/ProjectDetail.tsx`（自 Tasks / Projects 抽屉内联 JSX 原样迁移，字段逻辑零重复），Tasks / Projects 抽屉改为引用同一组件（行为不变）。`Overview` 用既有 `src/components/Modal.tsx`（Slice F）承载——工作台任务行 → 任务弹窗（底部「标记完成 / 取消完成」沿用 `useUndoableToggle` + 条件「查看项目」深链）；项目推进条 → 项目弹窗。**URL 保持 `/`**，不跳转；ESC / 遮罩 / 焦点圈闭与还原沿用 Modal。

## 3. 理由

- **单写者不破**：对话为只读（服务端仅 `readSnapshot`）；唯一的写入是「清空对话」产生的归档笔记，仍走 `commit()`（Zod + 原子 + 审计），与 ADR-0004/0005 一脉相承。
- **无状态对话**：不在服务端引入会话存储 / 清理，服务端仅按客户端所携有界历史作答；有界裁剪（另有 `BODY_LIMIT=256KB` 兜底）防止请求体膨胀。
- **摘要即事实**：与系统「不夸大 / 不造假数据」一致——模型被明确要求摘要外信息如实说「数据里没有」，且摘要优先组织「最紧急」所需字段（逾期 / 今日到期 / 日程）。
- **归档先于清空**：归档笔记是可 diff、可备份、可深链查阅的真事实源，契合 owner「按时间命名封存、后续可看文本内容」；归档失败则不清空，避免对话丢失。
- **复用而非重写**：`Modal` + `TaskDetail` / `ProjectDetail` 复用，消除字段渲染重复；Tasks / Projects 仅内部重构、行为不变（构建 + 全站回归通过）。
- **状态条等分是通用解**：对 N 段（含逾期为 0 时）都保持左右贴版心，避免右缘参差。

## 4. 后果

- 新端点：`POST /api/ai/chat`（回复 `{ reply, model, ms }`）与 `POST /api/notes`（201 `{ note }`）；`server/ai.mjs` 新增 `buildChatDigest` / `buildChatSystem` / `chatWithKernel` 与 `CHAT_MAX_*` 常量；`server/index.mjs` 新增 `createNote` 与两条路由。
- 前端：`src/lib/mutations.ts` 新增 `chatWithAi` / `createNote` / `AiChatMessage`；新增 `src/components/{TaskDetail,ProjectDetail,OverviewChat}.tsx`；`src/views/Overview.tsx` 重做状态条、插入对话盒、就地弹窗；`src/styles/views.css` 新增 `.k-status` / `.k-chat`（token only，含 ≤640px 响应）。
- 对话为**会话级持久**（模块级 store，跨路由切换存活；刷新丢失——owner 未要求持久化，属非目标）。
- 实测：真实回复约 5s（本机 deepseek-flash，`variant:'low'`）；构建（tsc strict + vite）通过；E2E **42/42**；零数据残留（含回收站归零）；控制台零 error。
- 证据：`.qa/v23/slice-g-verify.py` + `slice-g-verify.log` + 截图（`g-overview` / `g-status` / `g-chat-reply` / `g-chat-multiturn` / `g-archive-note` / `g-task-modal` / `g-project-modal` / `g-mobile`）。

## 5. 非目标

- 对话持久化 / 多设备同步 / 历史列表（仅会话级内存 + 归档笔记）。
- 对话 SSE 流式输出（本切片为缓冲返回；`parse-stream` 的泵模式可后续复用）。
- 归档笔记的蒸馏 / 标签 / 关联（仅 `type:'memo'` 纯文本）。
- 日程行点击行为、状态条点击的页面级预置筛选（本切片不涉及）。
- 任何无确认自动落盘（对话本身不落盘；仅用户点击「清空对话」才归档）。

---

## 修订 · G.1（对话升级，2026-10-03）

答所有者「这个的 md 格式没有正常显示，然后添加一下它能联网搜索以及自由回答功能，如果我觉得回答的不错，然后对他说把你现在说的这个点整理进笔记，然后他就能将某个回答整理进笔记里面单独一个笔记」+「这个聊天框我希望圆角小一些，界面宽一些大一些，上下长度也长一些」。在原 §2.1 只读对话之上做四项升级：

1. **Markdown 渲染**：助手回复改 `react-markdown`（`<div className="k-chat__text k-chat__md">`，沿用 Library.tsx 同款 import，**无 `dangerouslySetInnerHTML`**），用户轮保持纯文本；`.k-chat__md` 全套 token-only 样式（p / ul / li / strong / code / blockquote / hr / h1–h4）。
2. **尺寸调整**（token-only）：`.k-chat__thread` max-height 320→**560px**（≤640px 容器 420px）、圆角 → `var(--radius-inner)`（12）；消息 max-width 88%→**94%**；正文 13→**15px**；composer 圆角 → 12（`.ic-composer.k-chat__composer` 覆盖）；输入 min-height 30→**44px**（max 180）。
3. **联网搜索 + 自由回答**：`buildChatSystem` 重写为三类——**读库事实**（依据摘要、不编造用户数据）/ **一般知识自由回答** / **需要外部事实时只输出 JSON** `{"searchQueries":[...]}`（≤2 条、≤60 字、含年份；一次对话最多请求一次检索）。`chatWithKernel` 两阶段：模型请求 → 复用 N9 `buildSearchSection`（Sogou→360→Bing + 相关性令牌过滤 + 首条结果页摘录）→ **同会话回喂**正式作答；**检索失败** → 让模型保守作答并注明无法确认最新信息。响应新增 `searched: string[]`；前端助手轮下方显示安静行「已联网检索 · q1 · q2」；`tryParseSearchRequest` 导出供单测；提示行改「读库 · 联网 · 自由回答 · Enter 发送 · Shift+Enter 换行」。
4. **整理进笔记**：① **对话式**——用户消息命中意图正则（整理/保存/存/归档 + 进/到/为/成/入 + 笔记，如「把这条整理进笔记」）且存在上一条助手回答时，调 `POST /api/ai/chat/note {instruction, answer}`（`chatNoteRequestSchema`：instruction ≤400 / answer ≤8000）→ `draftChatNote`（AI 出 `{title ≤40, body markdown}`；**失败 / 解析失败回退确定性**：首行标题 + 原文正文，绝不抛错）→ 服务端 `commit('notes', …, note.create, detail.via:'chat.note')` → 助手轮「已整理为笔记：**「title」**」+「打开笔记」链接（`/library?note=`）；② 每轮助手回复下另有「存为笔记」安静按钮（同端点），失败走既有错误条。

**边界**：对话本身仍**不落盘无审计**（检索同 N9 纪律）；笔记落盘**可撤销**（回收站）；一次对话最多一次检索；「这个点」= 上一条回答（更早引用不支持）；§2.2「清空对话先归档为笔记」路径不变。

**验证**：QA `.qa/v72/` 服务端 **25 PASS** + 浏览器 **25 PASS** = **50 PASS · 0 FAIL**（单测 6 组 / 真搜 + 真库 + note + 空指令 400 / markdown 元素与字面 `**` 为 0 / computed 12px·560px·44px / 对话式与按钮双路径 / UI 搜索 12月12日 / 390 零横溢 / console 0）；**零残留**（53 文件哈希基线 == 终态、`tags.json` 不变、notes 回到 n-0001..n-0003）；探针 `.qa/probe-g1/`。实测：搜索问答 24.5s（`searched` 2 条）→「笔试 12月12日 9:00–11:20 · 口试 11/21–22 · 报名」并自动对照本库任务 `t-0008`；读库问答 7.5s 无检索引真实数据；笔记 `n-0004`「2026 年英语四级考试时间与报名安排」301 字落盘 + 清理。
