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
