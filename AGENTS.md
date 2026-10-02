# AGENTS.md

> KERNEL 新会话第一入口。用 2 分钟读完本文件即可冷启动整个项目。
> 事实源是 `docs/00-DESIGN-BRIEF.md`（项目宪法）。本文件与宪法冲突时，以宪法为准。

---

## 1. 这是什么

**KERNEL 是一个本地优先的个人事务内核**（life OS），服务一名中国大学生的事务管理：课业、学生工作、竞赛组织、算法训练、技术创作、生活作息。

一句话哲学：**文件即数据库，opencode 即大脑，网页即驾驶舱。**

内核隐喻：进程 = 任务/项目 · 内存 = 资料/知识 · I/O = 收件箱/通知 · 调度器 = 日程 · 检索 = 命令面板 · GC/平衡环 = 回顾。

**核心立场（不可违背）**：身份与领域是交叉筛选标签（tag），不是目录分区。一级信息架构只呈现通用循环：捕捉 → 澄清 → 组织 → 执行 → 回顾。详见 `docs/decisions/0002-no-role-silos.md`。

## 2. 核心文件地图

| 路径 | 作用 | 动它的后果 |
|---|---|---|
| `docs/00-DESIGN-BRIEF.md` | 项目宪法，事实源 | **只读**。除项目所有者明确要求外不改，重大方向调整走 ADR |
| `AGENTS.md` | 本文件，AI 入口 | 改项目结构或制度时同步更新 |
| `README.md` | 仓库门面与文档索引 | 入口信息变化时更新 |
| `data/**/*.json` | 数据源，一记录一文件 | 数据是事实源，改结构必须同步 `docs/04-DATA-MODEL.md` |
| `src/**` | React + TypeScript 前端 | 改代码必须更新 `CHANGELOG.md` 与 `TASK_BOOK.md` |
| `docs/01` 到 `docs/07` | 工程文档集 | 与对应主题保持一致 |
| `docs/decisions/` | ADR 架构决策记录 | 新决策开新编号 ADR，不删旧 ADR |
| `CHANGELOG.md` | 变更日志（Keep a Changelog） | 每次改代码必须追加 |
| `TASK_BOOK.md` | 任务台账与迭代记录（含「下一会话待办」交接清单） | 每次改代码必须追加 |

## 3. 命令

```bash
npm install          # 安装依赖（前端 + 数据服务）
npm run dev          # 本地开发：数据服务(4097) + opencode serve(4096，自动) + Vite，默认 http://localhost:5173
npm run dev -- --host    # 允许局域网 / 手机访问
npm run dev:web      # 只启动前端（数据服务离线则写入不可用）
npm run server       # 单独启动数据服务
npm run build        # 生产构建
npm run preview -- --host   # 预览构建产物（含数据服务），默认 http://localhost:4173
npm run seed         # 生成并写入种子数据到 data/（绕过服务，仅维护用）
```

技术栈固定：Vite + React 19 + TypeScript（strict）+ 原生 CSS（CSS 变量 token），不使用 UI 框架、不使用 Tailwind。前端依赖白名单见 `docs/02-ARCHITECTURE.md`；服务端依赖（zod / write-file-atomic / @opencode-ai/sdk）见 ADR-0004 与 ADR-0005。

> **Windows 操作纪律（2026-10-02 事故记录）**：不要在一行 cmd 中组合 `for /f` 变量循环 + `&` 链接 + 嵌套引号——cmd 会重解析导致命令体被重复执行（曾造成服务被杀、启动流程混乱）。查端口/杀进程分两步：先 `netstat -ano | findstr :<PORT>` 取 PID，再 `taskkill /F /PID <字面量>`。**后台启动长驻服务一律用 `node scripts/spawn-bg.mjs <日志文件> "<命令>"`**（detached spawn + stdio 重定向日志 + unref，约 1 秒返回；例：`node scripts/spawn-bg.mjs .qa/logs/dev.log "npm run dev"`）——直接用 `start "" /min cmd /c "... > log 2>&1"` 仍可能挂起工具调用（2026-10-02 第三次卡死：服务实际已启动但调用不返回），未重定向的启动方式则必然挂起（前两次）。等待服务就绪 ≥6 秒后，用 netstat / HTTP 探活再断言。

## 4. 数据纪律

1. **`data/` 是唯一事实源**。前端只读，禁止前端直接写文件。
2. **v0.4 起写入一律经数据服务**：Node 单写者（`server/`，仅 `127.0.0.1:4097`）——Zod 校验 + 原子写入（write-file-atomic）+ 审计日志（`data/activity.jsonl`）。浏览器与手机均经 `/api` 代理访问；禁止绕过服务直写文件（`npm run seed` 维护脚本除外）。实现见 ADR-0004。
3. 数据为文件式 JSON，一记录一文件，UTF-8，ID 稳定（`t-0001` 式），时间用 ISO 8601 带偏移。
4. **禁止在 JSON 中存储计算派生值**（进度、计数、状态聚合等一律运行时计算）。
5. 改数据结构，必须同步更新 `docs/04-DATA-MODEL.md`；动目录结构，必须同步更新 `docs/05-FILE-TREE.md`。

字段定义与示例见 `docs/04-DATA-MODEL.md`。

## 5. 文档义务（每个会话强制）

改任何东西之前，先判断触发了哪条义务：

| 你做了什么 | 必须更新 |
|---|---|
| 改了代码 | `CHANGELOG.md` + `TASK_BOOK.md` |
| 动了目录结构 | `docs/05-FILE-TREE.md` |
| 改了数据字段 / 结构 | `docs/04-DATA-MODEL.md` |
| 做了重大技术决策 | `docs/decisions/` 新 ADR（递增编号） |
| 发布一个版本 | 版本号 v0.x.0，`CHANGELOG.md` 落日期 |

版本号规则：`v0.x.0`，小版本递增，不在文档期微调补丁号。

## 6. 代码约定

- 代码标识符英文；注释与文档中文为主；未来 git 提交信息用中文。
- TypeScript strict，禁止 `any`。
- 样式用原生 CSS + CSS 变量 token，不写内联魔法值，token 定义见 `docs/03-DESIGN-SYSTEM.md`。
- 路由：`/` 总览 · `/inbox` · `/tasks` · `/calendar` · `/projects` · `/library` · `/review` · `/settings` · `/trash`（回收站）。
- 状态管理：React 内置（Context + hooks）；原型期用户操作写 localStorage，UI 需标注"原型态"。
- 无障碍强制：`MotionConfig reducedMotion="user"` + `prefers-reduced-motion`；键盘全可达；焦点环可见。
- 语言与界面：界面中文为主 + 英文小标签点缀（安静小灰字，不重排大写等宽）。
- 视觉方向：柔暗夜色为默认 + 柔影悬浮（深度=表面阶+柔影，无硬边线，圆角 16，强调色仅作信号），见 `docs/decisions/0003-design-direction-v2.md`。

## 7. 变更记录（house convention）

每次会话结束时在下方追加一行。日期格式 `YYYY-MM-DD`。

| 日期 | 版本 | 变更摘要 | 影响文件 |
|---|---|---|---|
| 2026-10-03 | v0.5.0（切片） | AI 全链 · 多实体一揽子处置 · Slice R1：解析由单建议升级为**动作数组** `{ actions:[...] }`（`aiActionSchema`，≤6；`kind`=task/note/resource/project；task·note 可 `linkToNewProject` 挂到本批次新建项目；project 带 `outcome`；旧单建议形状经 `legacyToActions` 归一化，同步 + 流式共用）——`postValidateActions` 快照过滤臆造 id / 标签 ≤3 / 至多一个新项目 / linkToNewProject 与 projectId 互斥；新增 `POST /api/inbox/:id/apply { actions }` **一次写入**（先建项目 → 再落实体并自动挂接 → 标签 origin:'ai' 登记 → 条目 clarified 记 `linkedId`/`linkedIds`/`appliedTagIds`；审计 `inbox.apply` + 各 `*.create`）与 `POST /api/inbox/:id/unapply`（与扩展 `revert` 共用 `detachInbox`：删 `linkedIds` 全部产物 + `store.pruneTags(appliedTagIds)` 恢复注册表 → 回 unprocessed）；新增项目草稿 `POST /api/ai/project/draft { title }`（不落盘）与 `projectDraftSchema`，`POST /api/projects` 扩展接受 `outcome`/`areaId`/`tags`（areaId 存在校验，缺省不变，`ai:true` → origin ai）；前端处置卡 `AiActionsCard`（勾选 + 按 kind 编辑 `ACTION_FIELD_MATRIX` + 页脚「全部应用（N 项）」/「重新解析」/「忽略」+ toast「已应用 N 项 · 撤销」）+ `ProjectDraftModal`（镜像 TaskDraftModal）；`AiSuggestionForm` 增 `outcome`；默认仍**先确认后写入**。冒烟 39/39 + E2E 36/36 + 构建通过，零残留，证据 `.qa/v34/` | `server/{schemas,ai,index,store}.mjs`、`src/lib/{mutations,aiForm}.ts`、`src/components/{AiActionsCard,ProjectDraftModal,AiSuggestionForm}.tsx`、`src/views/{Inbox,Projects}.tsx`、`src/styles/views.css`、`.qa/v34/**`、`docs/decisions/0015-*.md`、`docs/{02,04,README}`、`public/guide.html`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-03 | v0.5.0（切片） | 收件箱生命周期闭合 · 澄清字段矩阵 · Slice V：修五组摩擦（F2/F34/F15·F37/F16·F30/F19·F31）——① **文本即解析**：捕捉成功后自动跑一次 AI 解析（先探活 `/api/ai/health`，离线静默跳过、绝不自动应用、手动入口保留，与文件投递同节奏）；② **删除入口**：`mutations.removeInbox`（既有端点，转附件清理）接入未澄清展开区 + 已丢弃行，内联确认 + toast，已澄清 409 保护；③ **生命周期闭合**：丢弃行「恢复」/ 澄清行「撤回」复用 `revertInbox`（discarded 仅重置 status；clarified 删产物），澄清行「查看产物」经 `relations.deepLinkOfId` 按 `linkedId` 前缀深链；④ **一键建项**：建议卡 `newProjectHint`（task 目标）→ `createProject(hint)` + 查看深链 + 自动填入表单 projectId（仍须点应用）；⑤ **字段矩阵**：`aiForm.CLARIFY_FIELD_MATRIX`（task 全字段 / note→title,tags,projectId,areaId / resource→title,tags,areaId / discard→无），`AiSuggestionForm` 增 `fields` 条件渲染，`toClarifyDetails` 按 target 只挑会应用的字段；服务端对齐——note 接受 projectId/areaId、resource 的 title 对文件条目同样应用 + 接受 areaId（真实存在校验），结束静默丢弃；styles 增 `.ic-lifecycle`/`.ic-confirm`/`.k-inbox-item__actions`/`.ic-ai__newproject`/`button.k-pill.is-danger`。冒烟 43/43 + E2E 29/29 + 构建通过，零残留，证据 `.qa/v33/` | `src/views/Inbox.tsx`、`src/components/AiSuggestionForm.tsx`、`src/lib/{mutations,aiForm,relations}.ts`、`src/styles/views.css`、`server/index.mjs`、`.qa/v33/**`、`docs/decisions/0008-*.md`、`docs/{02,04,README}`、`public/guide.html`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-03 | v0.5.0（切片） | 回顾报告可读性 · 同期口径 · 去重 · Slice U：报告弹窗默认**阅读视图**（七段分节渲染 + 「编辑」切换 textarea；新增 `src/lib/reviewReport.ts` 解析，规则与 server 同源）修「七段塞进大 textarea」；环比对照改**同期等长窗口**（月：本月 1..N 日 ↔ 上月 1..N 日，短月截断；周：本周至今 ↔ 上周同期；标「上X同期」，窗口 <7 天自然说明且禁止以「窗口仅 N 天」开场）修「本月 3 天比上月整月」；第 6 段「下期行动」改为「见决策区（N 条）」**指针去重**，完整 if-then 仅在 `decisions`；`formatDelta` 基准 ≥5 才出百分比、清单「标题（id）」标题优先。冒烟 23/23 + 单测 25/25 + E2E 32/32 + 构建通过，零残留，证据 `.qa/v32/` | `server/ai.mjs`、`src/lib/reviewReport.ts`、`src/views/Review.tsx`、`src/styles/{views,shell}.css`、`.qa/v32/**`、`docs/decisions/0013-*.md`、`docs/04`、`public/guide.html`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-03 | v0.5.0（切片） | 回顾报告升级 + 自动归档 · Slice L：报告由 ≤200 字小结升级为**七段结构正文**（结论速览 → 数据解读 → 趋势对比 → 问题诊断 → 值得保留 → 下期行动 → 风险预警）；输入侧注入上一周期指标 + 环比 + 阈值 + 带 id 清单（`buildReviewDigest`），指令侧硬性规则（只用摘要数字 / 对象、每个判断带证据、绝对值带基准、禁套话、行动 if-then 含时间与完成标准）+ 弱 / 强例对照；新增**数字落地护栏** `auditNumbers` / `extractQuantities`（子集 + 派生，越界单次纠正重试，仍越界保留并记录）；`POST /api/ai/review/draft` 成功即**自动归档**一条 review（`source:'ai'`、审计 `review.create` · `auto`，响应附 `reviewId`），新增 `POST /api/reviews/:id/update`（白名单 summary / decisions + `updatedAt` + 审计 `review.update`）——「保存回顾」更新同条不重复建，每次生成 = 新版本；回顾页新增**报告历史**（时间倒序，只读查阅 + 删除，生成后即时出现）；`reviewSchema` 增可选 `source` / `updatedAt`；冒烟 40/40 + 护栏单测 6/6 + E2E 32/32 + 构建通过，零残留，证据 `.qa/v30/` | `server/{ai,schemas,index}.mjs`、`src/{types.ts,views/Review.tsx,lib/mutations.ts,styles/views.css}`、`.qa/v30/**`、`docs/decisions/{0013,0007}*.md`、`docs/{02,04,README}`、`public/guide.html`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-03 | v0.5.0（切片） | 全站详情「居中弹窗」统一 + 操作统一 + 日历遮罩柔化 · Slice K：五类详情（任务/项目/笔记/资料/日程）从右侧 `Drawer` 全部迁到居中 `Modal`（新增 `.k-modal--detail`：`min(660px,100vw-32px)`、`max-height ~85vh`、内容内滚、≤640px 全宽）；抽出 `TaskDetailModal` / `ProjectDetailModal` 供 Tasks/Projects 页与总览就地弹窗**共用**——任务两处均 标记完成/取消完成·查看项目·编辑·删除，项目两处均 编辑·删除，笔记/资料操作保留，日程只读；底栏统一 `.k-modal__foot-main`（左）+ `.k-modal__foot-actions`（右）；`Modal` 改 `createPortal` 到 `body`（修 `.k-route` layout containment 令 fixed 失准）；日历 `.k-cal__bar` 吸顶条加 `::after` 渐隐（柔化硬切）；删除 `Drawer.tsx` + `.k-drawer*` 样式 + `--drawer-w`/`--z-drawer`（容器 `drawer→modal`）；E2E 109/109 + 构建通过，零残留，证据 `.qa/v29/` | `src/components/{Modal,TaskDetailModal,ProjectDetailModal}.tsx`、`src/components/Drawer.tsx`（删）、`src/views/{Tasks,Projects,Library,Calendar,Overview}.tsx`、`src/styles/{shell,views,components,tokens}.css`、`.qa/v29/**`、`docs/decisions/0012-*.md`、`docs/{00,03,04,05,08,README}`、`public/guide.html`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-03 | v0.5.0（切片） | 标签生命周期 · Slice T：修复标签**无生成由来 / 无生命周期**——`server/store.mjs` 新增 `normalizeTagName`/`normalizeTagList`（裸名 → `topic:` 前缀，`@`→context，空串丢弃）+ `ensureTags(names,{origin,firstUsedIn})` **录入即生成**（任意携带 tags 的写入后自动登记进 `data/meta/tags.json`，注册项增可选 `origin:'seed'&#124;'manual'&#124;'ai'` / `createdAt` / `firstUsedIn`，审计 `tag.create`）；`server/ai.mjs` 放开收件箱解析与任务补全**可提议新标签**（优先已有名，仅确无合适标签时提议 `topic:名称` ≤12 字 · ≤3 · 去重），`postValidate` 改规格化保留（不再过滤注册表外名；臆造 id 规则不变），并修复收件箱 `toClarifyDetails` 漏传 tags；新增管理端点 `POST /api/tags/:id/update`（重命名级联，`tag.rename`）/ `…/merge`（合并级联去重，`tag.merge`）/ `…/remove`（使用中 409 阻止给计数，`tag.remove`）/ `POST /api/tags/backfill`（扫描登记存量，`tag.backfill`），级联**不 bump updatedAt**；设置页新增**「标签管理」区**（来源徽标 / 使用计数 / 登记时间 + 重命名 / 合并 / 删除 + 扫描登记），`src/views/Library.tsx` 标签条去截断、按使用计数降序、订阅 revision；冒烟 54/54 + 护栏单测 14/14 + E2E 41/41 + 构建通过，零残留，证据 `.qa/v31/` | `server/{store,schemas,index,ai}.mjs`、`src/{types.ts,lib/{format,mutations}.ts,components/TagManager.tsx,views/{Settings,Library,Inbox}.tsx,components/TaskDraftModal.tsx,styles/views.css}`、`.qa/v31/**`、`docs/decisions/0014-*.md`、`docs/{02,04,README}`、`public/guide.html`、`scripts/seed.mjs`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-03 | v0.5.0（切片） | 先确认后写入 · Slice O：任务快速新建由「即时创建 + 事后 AI 建议」改为**草稿确认弹窗**（回车 → 居中 `TaskDraftModal` → 打开即 AI 补全 → 全字段可编辑 → 点「创建任务」才写；ESC/取消零写入；AI 失败不阻断；标题永不被 AI 改写，已改字段不被覆盖）；服务端 `POST /api/tasks` 增可选白名单字段（`taskCreateFieldsSchema`，关联 id 存在性校验，审计 `detail.fields`）；收件箱 `AiReadyCard` 增「编辑」开关（目标 + 全字段 `AiSuggestionForm`），应用提交编辑值走既有 clarify（`ai:true`）；新增 `src/lib/aiForm.ts` + `src/components/{AiSuggestionForm,TaskDraftModal}.tsx`，删除旧 `.k-ai-draft*`；全站同类审计结论表入 TASK_BOOK；冒烟 35/35 + E2E 31/31 + 构建通过，零残留，证据 `.qa/v28/` | `server/{index,schemas}.mjs`、`src/lib/{mutations,aiForm}.ts`、`src/components/{AiSuggestionForm,TaskDraftModal}.tsx`、`src/views/{Tasks,Inbox}.tsx`、`src/styles/{views,shell}.css`、`.qa/v28/**`、`docs/decisions/0011-*.md`、`docs/{02,04,05}`、`public/guide.html`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-03 | v0.5.0（切片） | 收件箱附件「打开文件 / 位置」· Slice J2：去掉浏览器下载——附件行「查看文件」\<a\> 改为「打开文件」（系统默认程序）+「位置」（文件管理器定位）两个安静 pill；服务端抽 `spawnDetached` / `statLocalPath` 共用助手，新增 `POST /api/open`（`cmd /c start`）与 `POST /api/inbox/:id/(open\|reveal)`（服务端解析 `data/files/<id>-<name>`，条目/元数据/磁盘三重校验 404），带 `{dryRun:true}` 测试通道（`/api/inbox/:id/(open\|reveal)` 与 `/api/open`，仅解析校验、绝不 spawn）；资源抽屉补「打开文件」；冒烟 33/33 + E2E 21/21 + 零写入，证据 `.qa/v27/` | `server/index.mjs`、`src/views/{Inbox,Library}.tsx`、`src/lib/mutations.ts`、`src/styles/views.css`、`.qa/v27/**`、`docs/decisions/0008-inbox-file-intake.md`、`docs/04`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-03 | v0.5.0（切片） | 收件箱修复包 2 · Slice J：AI 解析状态提升模块级（新 `src/lib/inboxAi.ts` + `useSyncExternalStore`）——批量任务 / 流式面板 / 建议缓存跨路由存活，切页回来见真实进度 + 活跃项「解析中」+ 完成项「AI 建议就绪」标记，批量动作据 `running` 禁用防重复启动，完成播报一次；OOXML 无依赖抽取（最小 ZIP + `.docx/.pptx/.xlsx`）修「连文件都读不了」，失败维持不可读回退；构建通过 + 服务端冒烟 14/14 + E2E 16/16 + 零写入，证据 `.qa/v26/` | `server/ai.mjs`、`src/lib/inboxAi.ts`、`src/views/Inbox.tsx`、`src/styles/views.css`、`.qa/v26/**`、`docs/decisions/0008-inbox-file-intake.md`、`docs/05`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-03 | v0.5.0（切片） | 使用指南同步 · Slice I：`public/guide.html` 对齐 Slice D–H——04 八卡补新交互（对话盒 / 文件投递 + 批量 AI / 快速新建建议 / 资料状态五档 + 笔记蒸馏 / 回顾周月卡 + 弹窗报告）/ 05 扩为解析 + 对话盒 + 快速新建 + 回顾报告 + 静态对话示例 / 02·03·06·07·08 补文件投递、批量、`/trash`、清空即归档、键位 / FAQ 增三条 / 页脚 `v0.5.0（切片） · 2026-10-03`；Playwright 三态 65/65，控制台零错误、零横溢、`file://` 零外部请求，证据 `.qa/v25/` | `public/guide.html`、`.qa/v25/**`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-03 | v0.5.0（切片） | 状态贯通 · Slice H：资料状态判断标准 + 快捷设置（`QuickSegmented` 复用 `.k-lib__seg`）+ 笔记蒸馏层级可设 + 判断标准 helper（`format.ts`）+ 白名单扩充（`notes` +`areaId/projectId/distillLevel`、`resources` +`areaId`、`projects` +`goalId/nextActionId`）+ 任务快速新建 AI 补全（`POST /api/ai/task/draft`，内联建议可应用/忽略/重试，绝不自动应用）+ 全站同类审计结论表（`TASK_BOOK.md`，结构性缺口显式延后）；服务端冒烟 21/21 + E2E 28/28 + 构建通过，零残留，证据 `.qa/v24/` | `src/lib/{format,mutations}.ts`、`src/views/{Library,Projects,Tasks}.tsx`、`src/styles/views.css`、`server/{index,schemas,ai}.mjs`、`.qa/v24/**`、`docs/decisions/0011-state-coherence-and-task-draft.md`、`docs/{02,04,README}`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-03 | v0.5.0（切片） | 总览升级 · Slice G：AI 对话盒（`OverviewChat.tsx`—状态条下 / 工作台上、复用 `.ic-composer` 视觉、多轮、会话级持久、清空禁用态）+ 对话端点 `POST /api/ai/chat`（读库摘要含逾期 / 今日到期 / 日程 / 收件箱；有界历史 20 条 / 4000 字 / 16000 字；120s + 单次重试；不落盘）+ 清空先归档为笔记（通用 `POST /api/notes` + `note.create` 审计；toast「查看」→ `/library?note=<id>`）+ 状态条重做（`.k-status` 整宽等分、三段可点、左右严格贴版心）+ 就地详情弹窗（抽 `TaskDetail`/`ProjectDetail` 复用，Slice F 的 `Modal.tsx` 承载，URL 保持 `/`）；E2E 42/42 + 构建通过，零残留，证据 `.qa/v23/` | `src/components/{OverviewChat,TaskDetail,ProjectDetail}.tsx`、`src/views/{Overview,Tasks,Projects}.tsx`、`src/lib/mutations.ts`、`src/styles/views.css`、`server/{ai,index}.mjs`、`.qa/v23/**`、`docs/decisions/0010-overview-ai-chat.md`、`docs/{02,04,05,README}`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-03 | v0.5.0（切片） | 回顾页重构 · Slice F：周 / 月回顾卡并列一栏置于能量分析之上 + 每卡 AI 解析 + 新增 `Modal.tsx` 动画弹窗报告（草稿编辑 → 保存 → 撤销）+ 月回顾服务端支持（`computeMonthMetrics` / `monthKey` / `generateReviewDraft(period)` / `POST /api/reviews {type:'monthly'}`）+ 停滞项目独立栏；冒烟 13/13 + E2E 30/30 + 移动 6/6，零残留，证据 `.qa/v22/` | `src/components/Modal.tsx`、`src/views/Review.tsx`、`src/lib/mutations.ts`、`src/styles/{shell,views}.css`、`server/{ai,index}.mjs`、`.qa/v22/**`、`docs/decisions/0007-ai-weekly-review.md`、`docs/{04,05}`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-03 | v0.5.0（切片） | 趋势图数据点裁切修复 · Slice E2.7：owner 截图反馈「小圆点被遮盖」——`TrendLine` 贴底数据点（值 0 → y=100）被 SVG 视口裁掉下半圆；`.k-line__svg` 增 `overflow: visible` 一行修复（总览 / 回顾同步生效）；像素级前后对照（基线下方墨色 0px → 290px）+ 双页 overflow 断言 8/8 + 构建通过，只读零写入，证据 `.qa/v21/` | `src/styles/components.css`、`.qa/v21/**`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-03 | v0.5.0（切片） | 动效与布局稳定 · Slice E2.6：批量 AI 解析过程可视（复用单条流式路径、当前条目自动展开 + 轻柔滚入）+ 流式增量 ~100ms 节流 + 展开区 12px 呼吸间距 + 流式面板定高（极差 0.00px）+ 资料筛选条自然换行（1280/390 零横溢）+ 任务列表切换零重叠（去 layout/位移动画）；E2E 22/22 + 构建通过，零残留，证据 `.qa/v20/` | `src/views/{Inbox,Tasks}.tsx`、`src/styles/views.css`、`.qa/v20/**`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-03 | v0.5.0（切片） | AI 挂靠判断 + 项目闭环 + 批量条侧挂 · Slice E2.5：AI 挂靠规则 v2（宁缺毋滥 + 表面相似不算依据 + 附件不可读更保守）与新增 `newProjectHint`（≤40 字 · 与 `projectId` 互斥 · schema/normalize/postValidate 去重截断）+ 建议卡「建议新项目」；`POST /api/projects` 新建（title 非空 400 · active + a-0001 + outcome 待整理 · 审计 `project.create` · 201）+ Projects 页快速新建（回车 → toast「已创建项目 · 撤销」进回收站）；`updateEntity` 空 patch = touch（bump `updatedAt` + 审计 `<singular>.touch`）+ 回顾页「迁移/归档」真实落盘（去原型态）；收件箱批量条侧挂 dock（`IntersectionObserver` → 右缘浮动镜像 · 同状态同处理器 · reduced-motion · 抽屉层下 · ≤767px 隐藏）；冒烟 39/39 + E2E 21/21 + 构建通过，零残留，证据 `.qa/v19/` | `server/{ai,schemas,index}.mjs`、`src/types.ts`、`src/lib/mutations.ts`、`src/views/{Inbox,Projects,Review}.tsx`、`src/styles/views.css`、`.qa/v19/**`、`docs/decisions/{0006,0009}*.md`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-03 | v0.5.0（切片） | 详情操作 + 回收站 + 资源位置 · Slice E2：通用编辑 `POST /api/(tasks\|projects\|notes\|resources)/:id/update`（字段白名单 + 保留 id/createdAt + `updatedAt` 递增 + 审计 `.update` + `detail.fields`）；回收站 `data/trash/<kind>/<id>.json`（`moveToTrash`/`restoreFromTrash`/`purgeTrash`/`readTrash` + `nextId` 增扫回收站防 id 复用）+ 路由 trash/restore/purge + `GET /api/trash`；`resourceSchema.path?` + 文件澄清补 `kind:'file'` 与绝对 `path`；`POST /api/reveal`（`explorer /select`，仅本机）；前端 `EntityEditForm` + 四抽屉编辑/删除（撤销 toast）+ `/trash` 页（分组 / 恢复 / 双击彻底删除）+ 资料「文件位置」区块；冒烟 34/34 + E2E 19/19 + 全站 smoke PASS，零残留，证据 `.qa/v18/` | `server/{index,store,schemas}.mjs`、`src/{types.ts,App.tsx}`、`src/lib/{nav,mutations}.ts`、`src/components/EntityEditForm.tsx`、`src/views/{Tasks,Projects,Library,Trash}.tsx`、`src/styles/views.css`、`docs/decisions/0009-edit-trash-reveal.md`、`docs/{02,04,05,README}`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-02 | v0.5.0（切片） | 收件箱升级 · Slice D（文件投递 + 居中编辑器 + AI 先读）：服务端 `POST /api/inbox/upload`（RAW body 流式落盘 + 25MB 上限 + 文件名清洗，审计 `inbox.upload`）/ `POST /api/inbox/:id/remove`（清理附件，审计 `inbox.remove`）/ `GET /api/files/:id`（流式 inline）；`inboxItemSchema.file?` + `.gitignore data/files/`；`ai.mjs` `buildFileSection`（文本 ≤5MB → 8000 字摘录，否则仅元数据，同步/流式共用）；前端 `.ic-composer` 居中圆角编辑器（回形针 + 拖拽 + chips + 圆形发送，光学居中补偿轨道）+ 投递后顺序自动 AI 解析 + 文件行 meta / 「查看文件」；冒烟 PASS + E2E 12/12 + 构建通过，零残留，证据 `.qa/v16/` | `server/{index,schemas,ai}.mjs`、`src/views/Inbox.tsx`、`src/lib/{mutations,format}.ts`、`src/types.ts`、`src/styles/views.css`、`.gitignore`、`docs/decisions/0008-inbox-file-intake.md`、`docs/{04,05,README}`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-02 | v0.5.0（切片） | 使用指南 · HTML：自包含单文件 `public/guide.html`（十节中文指南，复用暗色「柔暗夜色」token 原值 / 柔影 / 圆角 16 / 强调色仅作信号；桌面粘性左目录、≤900px 折叠内联目录、measure 72ch、响应式至 390px；内联 CSS+JS，零外部请求，`file://` 双击可用）；Playwright 三态验收 25/25（桌面 1600 / 移动 390 / file://）+ 控制台零错误，证据 `.qa/v15/`；未改 src/server/scripts/data | `public/guide.html`、`.qa/v15/**`、`docs/05`、`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md` |
| 2026-10-02 | v0.5.0（切片） | AI 周回顾 · Slice C：`reviewSchema` / `reviewDraftSchema` + `SCHEMAS.reviews` / `ID_PATTERNS.reviews` + `nextId` 增 `rev`；服务端 `isoWeekKey` / `computeWeekMetrics` / `staleProjects`（镜像前端口径；`migrated` 刻意不产出）+ `POST /api/reviews`（审计 `review.create`）/ `/api/reviews/:id/remove`（`review.remove`）/ `POST /api/ai/review/draft`；前端最新周 / 月回顾按 date 倒序 + 周期运行时计算 + 真实 AI 草稿抽屉流（编辑 → 保存 → toast 撤销，移除原型态文案）；冒烟 PASS + E2E 13/13 + 构建通过，证据 `.qa/v14/` | `server/{ai,index,schemas,store}.mjs`、`src/views/Review.tsx`、`src/lib/{mutations,date}.ts`、`src/types.ts`、`src/styles/views.css`、`docs/decisions/0007-ai-weekly-review.md`、`docs/04`、`docs/05`、`docs/README.md`、`CHANGELOG.md`、`TASK_BOOK.md` |
| 2026-10-02 | v0.5.0（切片） | AI 澄清升级 · Slice B：解析上下文注入（项目 / 区域 / 标签 / 近期任务摘要）+ 挂接建议（`projectId / areaId / tags / duplicateOf`，服务端按快照过滤臆造）+ clarify 支持 `projectId / areaId` + SSE `parse-stream` 流式过程可视（事件泵 + 阶段 / 预览面板）；新增 `scripts/spawn-bg.mjs` 后台安全启动器 + Windows 纪律修订（`start` 挂起第三次事故）；冒烟 + E2E 13/13 + 构建通过；证据 `.qa/v14/` | `server/{ai,index,schemas}.mjs`、`src/views/Inbox.tsx`、`src/lib/mutations.ts`、`src/styles/views.css`、`scripts/spawn-bg.mjs`、`AGENTS.md`、`docs/decisions/0006-ai-parse-upgrade.md`、`CHANGELOG.md`、`TASK_BOOK.md` |
| 2026-10-02 | v0.5.0（切片） | 结构互联 · Slice A：`src/lib/relations.ts` 运行时互链派生 + `src/components/Relations.tsx`「关联」区块 + 深链补全（`?project / ?note / ?resource / ?event`）+ 项目抽屉「下一步」+ 「查看项目」深链 + 版本串 / 命令面板旧文案修复；演示数据重置为全新种子（144 记录）；行为级 20/20 + 构建通过；证据 `.qa/v14/` | `src/lib/relations.ts`、`src/components/Relations.tsx`、`src/views/{Tasks,Projects,Library,Calendar}.tsx`、`src/components/{CommandPalette,TagPill}.tsx`、`src/components/shell/RailNav.tsx`、`src/views/Settings.tsx`、`src/styles/views.css`、`CHANGELOG.md`、`TASK_BOOK.md` |
| 2026-10-02 | v0.5.0（切片） | opencode AI 接入 · 首个切片：收件箱「AI 解析」（`server/ai.mjs` 代理 + 指令式 JSON + Zod；clarify `details` + `ai` 审计标记；`dev.mjs` 自动拉起 serve；前端建议卡 + AI 状态）；ADR-0005 + docs/02 修正；实测解析 3–6s；行为级 + 构建通过，证据 `.qa/v13/` | `server/**`、`scripts/dev.mjs`、`src/views/{Inbox,Settings}.tsx`、`src/lib/{hooks,mutations}.ts`、`src/components/shell/StatusBar.tsx`、`src/styles/views.css`、`docs/decisions/0005-opencode-ai-v0.5.md`、`docs/02`、`package.json` |
| 2026-10-02 | v0.4.0 | 总览落地「工作台」（三轮 C 采纳，选型 10/10 完结）：左工作区 + 右粘性监视柱 + 项目推进（9 进行中 + W40）；`TrendLine` 增补可选属性（默认不变）/ 水位口径 12+8 / `.k-streak` 点阵入 `components.css` / AI 建议占位退役；行为级验证 + `tsc`/构建通过，证据 `.qa/v12/` | `src/views/Overview.tsx`、`src/styles/{views,components}.css`、`src/lib/derive.ts`、`src/components/{charts/TrendLine,TaskRow,ScheduleList,shell/StatusBar}.tsx`、`CHANGELOG.md`、`TASK_BOOK.md` |
| 2026-10-02 | v0.4.0 | 总览三轮组件修订（所有者反馈）：「连续刷题」打卡带（粗竖条 + 斜纹）AI 感重 → 安静圆点阵（实心 = 命中 · 空心 = 缺口；8px 圆点行内均布，对齐 `.k-meter` 行高）；`overview-a/b/c` + `charts-kit` 同步 + BRIEF 附录二规范 + 预览重渲染 | `design-drafts/v2/**`、`CHANGELOG.md`、`TASK_BOOK.md` |
| 2026-10-02 | v0.4.0 | 全站排版落地（设计选型采纳 9/10）：收件箱 C「批量」/ 任务 C「表格」/ 日程 C「议程流」/ 项目 B「列表」/ 资料 A「列表」/ 回顾 B「仪表盘」/ 设置 B「侧导航」+ 侧边栏选中态（无边框高亮 + 侧边线）+ 详情面板 B（两段式）；全站回归 + `.qa/v10/` 证据；总览待选型 | `src/views/**`、`src/styles/views.css`、`src/styles/shell.css`、`TASK_BOOK.md`、`CHANGELOG.md` |
| 2026-10-02 | v0.4.0 | 图表语言修订（所有者否决圆头柱）：`TrendBars` → `TrendLine`（折线 + 面积 + 数据点；峰值环仅唯一最大值；`.k-line` 替换 `.k-trend`）；草稿侧 7 文件同步替换 + BRIEF 附录二规范 + 打包器支持刷新内联 CSS | `src/components/charts/TrendLine.tsx`、`src/components/charts/TrendBars.tsx`（删）、`src/styles/components.css`、`src/views/Review.tsx`、`design-drafts/v2/**`、`CHANGELOG.md`、`TASK_BOOK.md` |
| 2026-10-02 | v0.4.0 | 路由滚动记忆（各页独立恢复 / 首访回顶，日历配合）+ 页面多版本设计稿 v2（8 页 ×3 + 详情 5 + 总览二轮监控重做 + 图表组件样本 = 30 方案 + 选型页，待所有者选型） | `src/lib/scroll.ts`、`src/components/shell/AppLayout.tsx`、`src/views/Calendar.tsx`、`design-drafts/v2/**`、`TASK_BOOK.md`、`CHANGELOG.md` |
| 2026-10-02 | v0.4.0 | 数据服务落地：Node 单写者（127.0.0.1:4097）+ 原子写 + Zod 校验 + `activity.jsonl` 审计；前端写入改造（proto 退役，乐观更新 + 撤销 + 离线显式报错）；审阅 P0 六项并入；ADR-0004 | `server/**`、`src/lib/{data,api,mutations,hooks}.ts`、`src/views/**`、`src/components/{Toast,shell/**}`、`scripts/dev.mjs`、`vite.config.ts`、`docs/**`、`CHANGELOG.md`、`TASK_BOOK.md` |
| 2026-10-02 | v0.3.0 | 体验增强（审阅 P1 第一批）：任务时间筛选 + 截止排序 + `?task=` 深链直达 / 撤销 toast / `useNow` 统一刷新 / AI 卡动态计数 | `src/lib/hooks.ts`、`src/context/ToastContext.tsx`、`src/components/Toast.tsx`、`src/views/{Tasks,Overview,Inbox,Library,Calendar}.tsx`、`.qa/v06/**`、`CHANGELOG.md`、`TASK_BOOK.md` |
| 2026-10-02 | v0.3.0 | 界面缺陷修复：品牌锁排（KERNEL 不再裁切）/ 顶栏接缝对齐（104px 共线）/ Toast 跟随折叠 / `color-scheme` / 任务分组行 / 项目卡标签 / 0 值柱 / 能量斜纹 / 日历日期条吸顶 / 阈值线；git 初始化 + 首次提交；全站三视角审阅（报告 `.qa/review/REVIEW-2026-10-02.md`） | `src/styles/**`、`src/components/shell/AppLayout.tsx`、`.qa/review/**`、`.gitignore`、`TASK_BOOK.md`、`CHANGELOG.md` |
| 2026-10-02 | v0.3.0 | 文档一致性全量同步（20 处：宪法/设计系统/文件树/索引/徽标顺延/零引用清理）；TASK_BOOK 新增「下一会话待办」交接清单 | `docs/**`、`TASK_BOOK.md`、`AGENTS.md`、`CHANGELOG.md` |
| 2026-10-02 | v0.3.0 | 数理自适应：流体字号/间距（Utopia，锚点 390/1440）+ φ 间距层级 + 容器查询（route/stat/task/pcard/drawer）+ 死代码清理 | `src/**`、`docs/**` |
| 2026-10-02 | v0.3.0 | 版式重排：全站呼吸感 / 组件安排 / 统一性（对齐 C 稿基准） | `src/**`、`docs/**` |
| 2026-10-02 | v0.3.0 | 验收修复：命令面板焦点还原与水平居中 + 灰阶对比校正（--muted / 亮色 --ink-2 全表面 ≥4.5:1） | `src/styles/tokens.css`、`src/styles/shell.css`、`src/components/CommandPalette.tsx`、`docs/**` |
| 2026-10-02 | v0.3.0 | 视觉方向重做：C 柔暗夜色 + 柔影悬浮融合，修复全部 QA 项 | `src/**`、`docs/**`、`CHANGELOG.md`、`TASK_BOOK.md` |
| 2026-10-02 | v0.2.0 | 高保真前端：应用壳 + 8 视图 + 命令面板 + 动效系统 + 移动端适配 | `src/**`、`CHANGELOG.md`、`TASK_BOOK.md` |
| 2026-10-02 | v0.1.0 | 建立文档系统（本文件集 + ADR）、工程脚手架、文件式数据层与种子数据 | `README.md`、`AGENTS.md`、`CHANGELOG.md`、`TASK_BOOK.md`、`docs/**`、`data/**`、`src/**` |

> 新增行请置于表格最上方（倒序），保持最近变更可见。

## 8. 安全纪律

- opencode 服务仅监听 `127.0.0.1:4096`，**永不直接暴露到局域网**。
- 数据服务（v0.4）仅监听 `127.0.0.1:4097`，经 Vite 代理接入，永不直接暴露到局域网。
- 敏感操作需显式确认。
- AI 能力已接入（v0.5：收件箱「AI 解析」→ Slice B 升级为上下文注入 + 挂接建议 + SSE 过程可视；Slice C 增「AI 周回顾草稿」——读全系统生成草稿，确认后经 `/api/reviews` 落盘、撤销即删除；Slice D 增「文件投递 + AI 先读」——文件经 `POST /api/inbox/upload` RAW 落 `data/files/`（不进 git），AI 按文本摘录（≤8000 字）或仅元数据出建议，附件仅经本机 `GET /api/files/:id` 读取；经本地 opencode serve，仅 127.0.0.1:4096；状态条 / 设置页显示在线状态；Slice H 增「任务快速新建 AI 补全」`POST /api/ai/task/draft`——只填标题 → 建议，**绝不自动落盘**，应用走 `POST /api/tasks/:id/update`，见 ADR-0011；Slice O 改为**先确认后写入**：任务快速新建为草稿确认弹窗，全部字段可编辑、点「创建任务」才经扩展后的 `POST /api/tasks` 落盘，收件箱建议卡亦可编辑后经 clarify 提交，见 ADR-0011 §6；Slice L 增「七段回顾报告 + 数字落地护栏 + 生成即自动归档」——报告由摘要注入环比 / 阈值 / 带 id 清单驱动，护栏 `auditNumbers` 越界单次纠正重试；`POST /api/ai/review/draft` 成功即自动归档一条 review（审计 `review.create` · `auto`），`POST /api/reviews/:id/update` 更新同条，「报告历史」按时间查阅 / 删除，见 ADR-0013；Slice T 起 AI 可提议**新标签**——优先复用注册表已有名，仅确无合适标签时提议 `topic:名称`（≤12 字 · ≤3），`postValidate` 规格化保留，标签在应用 / 创建落盘时才登记 `origin:'ai'`，见 ADR-0014；Slice U 修报告可读性——回顾报告弹窗默认**阅读视图**（七段分节渲染，「编辑」切换 textarea；解析见 `src/lib/reviewReport.ts`），环比对照改**同期等长窗口**（本月 1..N 日 ↔ 上月 1..N 日 / 本周至今 ↔ 上周同期，短月截断），第 6 段「下期行动」改「见决策区（N 条）」**指针去重**（完整 if-then 仅在 `decisions`），`formatDelta` 基准 ≥5 才出百分比，见 ADR-0013 §6）。
- 标签生命周期（v0.5 · Slice T）：标签名写入前规格化（裸名 → `topic:` 前缀等），任意携带 tags 的写入后 `ensureTags` 自动登记进 `data/meta/tags.json`（新增 `origin` / `createdAt` / `firstUsedIn`，审计 `tag.create`）；管理端点 `POST /api/tags/:id/update`（重命名级联）/ `…/merge`（合并级联）/ `…/remove`（使用中 409 阻止，不静默剥离）/ `POST /api/tags/backfill`（扫描登记存量），均经单写者 + 原子写 + 审计，级联不 bump `updatedAt`。见 ADR-0014。
- 详情操作（v0.5 · Slice E2）：四种可写实体（task / project / note / resource）支持编辑（`POST /api/<kind>/<id>/update`，字段白名单 + 审计）与软删除回收站（`data/trash/`，可恢复 / 彻底删除）；`POST /api/reveal` 经 `explorer.exe /select` 在本机文件管理器中定位文件——仅本机可用（服务仅 `127.0.0.1:4097`、前端经同源 `/api` 代理），不暴露远端触发面。详见 ADR-0009。
- 附件本机动作（v0.5 · Slice J2）：收件箱附件「打开文件」经 `POST /api/inbox/:id/open`（服务端解析 `data/files/<id>-<name>` 后 `cmd /c start "" "<path>"` 以默认程序打开）、「位置」经 `POST /api/inbox/:id/reveal`（`explorer.exe /select` 定位）；资料抽屉「打开文件」经 `POST /api/open`（路径白名单同 reveal）。三者均 `detached + stdio ignore + windowsHide + unref`，**仅本机**（`127.0.0.1:4097`）；`/api/inbox/:id/(open|reveal)` 与 `/api/open` 均支持 `{dryRun:true}` 仅解析校验、绝不 spawn（自动化测试用）。详见 ADR-0008 §4。
- 收件箱生命周期（v0.5 · Slice V，见 ADR-0008 §6）：**文本即解析**——捕捉成功后前端自动触发一次 AI 解析（先探活 `/api/ai/health`，离线静默跳过、绝不自动应用，手动入口保留）；删除复用 `POST /api/inbox/:id/remove`（未澄清 / 已丢弃；服务端一并清理附件，已澄清 409 保护）、恢复 / 撤回复用 `POST /api/inbox/:id/revert`（discarded 仅重置 `unprocessed`；clarified 删除 `linkedId` 产物）、「查看产物」按 `linkedId` 前缀深链；澄清字段矩阵 `src/lib/aiForm.ts` `CLARIFY_FIELD_MATRIX` 与服务端同源，UI 只渲染会应用的字段（note 接受 projectId/areaId、resource 的 title 对文件条目也应用），**杜绝静默丢弃**。无新增端点。
- AI 全链 · 多实体一揽子处置（v0.5 · Slice R1，见 ADR-0015）：收件箱解析输出**动作数组** `{ actions:[...] }`（`aiActionSchema`，`kind` = task/note/resource/project，≤6；旧单建议形状经 `legacyToActions` 归一化，同步 / 流式共用；`postValidateActions` 快照过滤臆造 id、标签 ≤3、至多一个新项目、`linkToNewProject` 与 `projectId` 互斥）。`POST /api/inbox/:id/apply { actions }` 一次写入——服务端重新 `inboxApplySchema` 校验 + 关联 id 存在性校验（**不信任客户端形状**）；先建新项目（`project.create` · via `inbox.apply`），再逐条建 task/note/resource（`linkToNewProject` 自动挂接、`task` 带 `sourceInboxId`、文件 resource 带 `path`），标签 `origin:'ai'` 登记，条目置 `clarified` 并记 `linkedId` / `linkedIds` / `appliedTagIds`，审计 `inbox.apply` + 各 `*.create`。撤销 `POST /api/inbox/:id/unapply`（与扩展 `revert` 共用 `detachInbox`）：删除 `linkedIds` 全部产物 + `pruneTags(appliedTagIds)`（仅删本次新登记且已无人使用的标签）→ 回 `unprocessed`，恢复到应用前基线。项目草稿 `POST /api/ai/project/draft { title }` 只出建议（**不落盘**）；`POST /api/projects` 扩展接受 `outcome`/`areaId`/`tags`（areaId 存在校验）。**默认仍先确认后写入**，本切片不做自动应用。
- 本系统不发布公网，局域网访问仅限可信 WiFi。详见 `docs/07-DEPLOYMENT.md`。
