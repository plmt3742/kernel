# ADR 0011 · 状态贯通 + 任务快速新建 AI 补全（Slice H）

- 状态：已接受
- 日期：2026-10-03
- 决策者：项目所有者（三条指令：① 资料状态「没有判断标准 / 按钮选择」——解决后全面检查同类问题；② 笔记蒸馏层级可设；③ 任务快速新建要加 AI 判断，否则「没有详细内容」）+ 实证（`.qa/v24/smoke-h.mjs`、`.qa/v24/slice-h-verify.py`）
- 关联：ADR-0004（数据服务）、ADR-0005 / 0006（AI 接入 / 解析升级）、ADR-0009（编辑 / 回收站 / 字段白名单）、ADR-0010（AI 对话 + 通用笔记创建）、`docs/02-ARCHITECTURE.md` §3.2 / §4.3、`docs/04-DATA-MODEL.md` §4.8 / §4.9 / §9、`CHANGELOG.md`、`TASK_BOOK.md`、`.qa/v24/`

---

## 1. 背景

所有者反馈：资料 LIBRARY 页的「状态」筛选（未读 / 在读 / 读完 / 参考 / 归档）**既没有判断标准，也没有设置入口**——状态值在列表与筛选条上被展示，却无法便捷地设置，且各档含义无定义。这是一种「系统层面不贯通」的体验，所有者要求「解决后全面检查还有哪些地方是类似的」。

同时：笔记的「蒸馏 L0–L3」在列表与详情被展示，但不可设置；任务页「快速新建」只写标题，生成的条目「没有详细内容」（缺上下文 / 能量 / 重要性 / 预估 / 截止等）。

根因是**渲染层与写入层不对齐**：界面按字段渲染，但可写白名单（`EDITABLE_FIELDS`）与实体可写集合（`SCHEMAS` / `EDITABLE_KINDS` / `ID_PATTERNS`）只覆盖了子集——凡从非白名单字段或非可写实体渲染出的状态，都是「死状态」。

## 2. 决策

### 2.1 状态判断标准（术语落入 UI 与 docs/04）

- 资料状态五档：`unread` 未读（收进资料库、尚未开始阅读）、`reading` 在读（正在读、有明确推进）、`read` 读完（已完整读完）、`reference` 参考（不打算通读，仅备查引用）、`archived` 归档（已处理完，退出主动视野）。
- 笔记蒸馏层级：L0 原文（原始摘录 / 未加工）、L1 划线（已标出关键句）、L2 摘要（已用自己的话压缩）、L3 永久（已提炼为可复用的永久笔记）。
- 判断标准集中在 `src/lib/format.ts`（`RESOURCE_STATUS_DEF` / `DISTILL_LEVEL_LABEL` / `DISTILL_LEVEL_DEF`），UI 抽屉内以安静 helper 文本呈现，文案与 `docs/04` §4.8 / §4.9 保持一致。

### 2.2 快捷设置（复用既有写入路径）

- 资料抽屉新增「状态 · 判断标准」分段控件，笔记抽屉新增「蒸馏层级 · 判断标准」分段控件——复用 `.k-lib__seg` 轨道 + `TagPill` 选中反转视觉（token only），每项 `title` 带该档定义，当前档定义显示为 helper 文本。
- 点击即经 `POST /api/(resources|notes)/:id/update` 写入（唯一写入路径，审计 `resource.update` / `note.update`），成功 toast + 「撤销」回原值；与服务端乐观路径一致，无新增端点。

### 2.3 白名单扩充（让「已显示」的字段可设）

在 ADR-0009 的通用编辑端点内扩充字段白名单（不改写入架构）：

- `notes`：`['title','type','body','areaId','projectId','tags','distillLevel']`
- `resources`：`['title','kind','status','url','path','areaId','tags','note']`
- `projects`：`['title','outcome','status','areaId','goalId','nextActionId','dueAt','tags']`

其中 `areaId / projectId`（笔记、资料）、`goalId / nextActionId`（项目）补入对应抽屉的编辑表单（下拉选择；可清除）。`goalId` 仅提供「关联已有目标」的选择——目标的创建 / 管理仍不在本切片（属结构性缺口，见 §5）。

### 2.4 任务快速新建 AI 补全（`POST /api/ai/task/draft`）

- **服务端**：`server/ai.mjs` 新增 `draftTask(title)` 与 `TASK_DRAFT_MAX_TITLE_CHARS=200`；沿用收件箱解析模式——`buildDigest` 上下文注入（项目 / 区域 / 标签 / 近期未完成任务）+ `buildTaskDraftSystem` 指令式 JSON + `taskDraftSchema`（`schemas.mjs`）+ `postValidate` 按快照过滤臆造 id / 标签 + 单次重试 + 120s 超时。**只产出建议**，不落盘。路由 `POST /api/ai/task/draft { title }`（标题非空 400，超长截断；health 503 / 失败 502）。
- **前端**：`createTask` 即时完成（不等待 AI）；随后异步 `aiTaskDraft(title)`，在任务工具条下方显示安静、可忽略的内联建议面板（loading / ready / error 三态；`role="status" aria-live="polite"`）。ready 态展示人类可读 chips（上下文 / 能量 / 重要性 / 预估 / 截止 / 项目 / 区域 / 标签）+ 理由；**应用建议** → 经 `POST /api/tasks/:id/update` 写入（审计 `task.update`）；**忽略** → 面板消失、零写入；失败 → 安静提示 + 「重试」，**不阻断 / 不降级创建**。每次创建仅一次草稿调用；无「可应用字段」时不弹面板（避免噪声）。

### 2.5 全站同类审计（本次修复 vs 记录延后）

对所有视图与详情做「已展示但不可操作 / 无判断标准」扫描（结论表见 `TASK_BOOK.md` Slice H 节）。原则：**只修语义清晰且回归安全的小口子**（白名单 + 小控件），结构性缺口（需要新可写实体或新页面的）显式延后并记录。

## 3. 理由

- **不破单写者**：所有新设置仍走既有 `commit()`（Zod + 原子写 + 审计）；AI 草稿只读快照、只出建议，应用才写——与 ADR-0004 / 0005 / 0009 / 0010 一脉相承。
- **渲染层与写入层对齐**：把「展示用的字段」纳入白名单，是消除「死状态」的最小、可回归的安全解；避免一次性铺开事件 / 区域 / 目标 / 习惯等结构性实体（高风险、需产品决策）。
- **判断标准随值走**：档位定义放在 `format.ts` 并在抽屉内以 helper 文本呈现，避免「有枚举、无含义」；同时把同义文案写入 `docs/04`，保持单一事实源。
- **AI 建议永不自动应用**：遵守宪法「AI 只产出建议」——创建即时完成，建议随后可应用 / 可忽略 / 可重试；失败不污染创建结果。
- **有界输入输出**：标题 ≤200 字、建议字段受 schema 约束、关联 id / 标签按快照过滤，防止臆造与膨胀。

## 4. 后果

- 服务端：`schemas.mjs` 新增 `taskDraftSchema`；`ai.mjs` 新增 `draftTask` / `buildTaskDraftSystem` / `tryParseTaskDraft` / `promptTaskDraftWithRetry` / `TASK_DRAFT_MAX_TITLE_CHARS`（`createSession` 参数化 title）；`index.mjs` 扩充 `EDITABLE_FIELDS` + 新增 `/api/ai/task/draft` 路由。
- 前端：`format.ts` 新增判定映射；`mutations.ts` 新增 `TaskDraftSuggestion` / `TaskDraftResult` / `aiTaskDraft`；`Library.tsx` 新增本地 `QuickSegmented` 组件 + 两个快捷设置 + 编辑字段；`Projects.tsx` / `Tasks.tsx` 编辑与快速新建增强；`views.css` 新增 `.k-quickset*` / `.k-ai-draft*`（token only，含 ≤640px）。
- 验证：服务端冒烟 **21/21**（真实 AI 草稿 7.0s、字段往返、审计、零残留）；浏览器 E2E **28/28**（资料状态 / 笔记蒸馏快捷设置持久化与还原、三处编辑表单字段存在性、快速新建 AI 应用 + 忽略、移动 390、控制台 0、零残留）；`npm run build`（tsc strict + vite）通过。
- 证据：`.qa/v24/smoke-h.mjs`、`.qa/v24/slice-h-verify.py` 及日志与截图（`h-resource-quickset` / `h-resource-status-set` / `h-note-quickset` / `h-note-distill-set` / `h-project-fields` / `h-task-draft` / `h-mobile`）。

## 5. 非目标（显式延后）

- **事件（event）全实体**：不在 `SCHEMAS` / `EDITABLE_KINDS` / `ID_PATTERNS`，无编辑 / 创建 / 取消路径；`event.status` 等在日历展示却不可操作。需要新增可写实体与端点，延后。
- **区域 / 目标 / 习惯管理**：无独立视图与可写路径；区域标题、目标标题仅作静态芯片展示；「连续刷题」点阵展示但无打卡入口。延后。
- **笔记 `links`（互链）与任务 `parentTaskId`（父子）**：需选择器与层级 / 环检测语义，延后。
- **已保存回顾的编辑**：`reviews` 不在 `EDITABLE_KINDS`，保存后 `summary / decisions` 只读；`review.metrics.migrated` 恒显示 `—`（无编辑追踪来源）；回顾页「迁移」按钮实为 `touch`。均延后（属 Slice F 范围）。
- **收件箱条目内容编辑 / 删除入口**：服务端有 `POST /api/inbox/:id/remove` 但无 UI 调用；内容不可改。延后。
- **标签注册表管理**：标签仍以自由文本输入，可能产生无标签定义（回退原名）；延后。
- **笔记沉浸式阅读与撰写体验**（所有者 15:58 诉求）：未纳入本切片，作为延后 backlog 记录于 `TASK_BOOK.md`。

---

## 6. 修订（Slice O · 2026-10-03）：草稿先行（draft-first）取代「即时创建 + 事后补全」

- 状态：已接受（**修订 §2.4**，历史保留）
- 决策者：项目所有者两条强制指令：①「我在这里输入你好后居然没有经过 ai 建议我确认然后直接入库，这是不行的」；②「ai 初步处理后需要给到我充足的编辑以及操作空间，每个类似的地方都是需要这样子的」
- 关联：Slice O 实现与证据 `.qa/v28/`、`CHANGELOG.md`、`TASK_BOOK.md`、`docs/02 §3.2 / §4.3`、`docs/04 §9`

### 6.1 为什么反转

§2.4 的原设计是「**即时创建 + 事后建议**」：`createTask` 先落盘，AI 建议随后异步到达、由用户决定是否应用。理由是「建议迟到 / 失败不拖住创建」。但所有者实测后否决：**在用户确认之前就把记录写入数据库**，违背了本系统「AI 只产出建议、落盘必须经人确认」的核心立场（§3「AI 建议永不自动应用」）——原设计的错误在于把「建议」与「创建」分裂成两步，导致**创建本身绕过了确认**。所有者同时要求把「充足编辑空间」推广到所有同类表面。

### 6.2 新决策（取代 §2.4）

- **先确认后写入（draft-first）**：任务快速新建回车不再创建，而是打开**居中草稿确认弹窗**（`TaskDraftModal.tsx`，复用 `Modal.tsx`）；打开即请求 `POST /api/ai/task/draft`，返回后把全部字段预填为可编辑控件；**点「创建任务」才写入**，ESC / 遮罩 / 取消一律零写入。
- **AI 绝不改写用户输入**：标题永远由用户掌控；AI 返回时跳过用户已改动的字段（`touchedRef`），不覆盖人工编辑。
- **创建不被 AI 阻断**：AI 离线 / 慢 / 失败时表单仍完全可用，空白字段由服务端补默认。
- **`POST /api/tasks` 扩展**（取代「创建后 `/:id/update` 应用建议」）：创建时一次性携带用户确认（含编辑）后的可选字段（`taskCreateFieldsSchema`：`contexts/energy/importance/estimateMin/dueAt/projectId/areaId/tags`；关联 id 形状 + 存在性校验），审计 `task.create` 的 `detail.fields`；仅传 `{title}` 的旧调用行为不变。
- **收件箱建议卡可编辑**：`AiReadyCard` 增「编辑」开关（目标 + 全字段），应用提交当前编辑值，仍走既有 `clarify`（`details` + `ai:true` 审计不变）。
- **同类面审计**：见 `TASK_BOOK.md` Slice O 节结论表；项目快速新建无 AI 处理，明确不在范围。

### 6.3 历史保留

§2.4 的「即时创建 + 事后补全」及其内联 `.k-ai-draft` 面板作为历史记录保留于本节之前；其代码路径已于 Slice O 删除。§3「AI 建议永不自动应用」的立场不变——本修订正是为使其在**创建**环节也成立。
