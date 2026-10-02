# ADR-0021 · 一致性清扫（Slice Y）

- 状态：已采纳
- 日期：2026-10-03
- 相关：ADR-0004（单写者数据服务）、ADR-0007（AI 周回顾指标口径）、ADR-0009（编辑 / 回收站 / reveal）、ADR-0011（状态贯通 · 先确认后写入）、ADR-0013（回顾报告与归档）、ADR-0014（标签生命周期）、ADR-0018（事件可写）、ADR-0019（区域 / 目标 / 习惯可管理）、ADR-0020（笔记体验 · 新建笔记流）

---

## 1. 背景与问题

只读的「碎片化 / 摩擦」审计列出一批**一致性 / 自动化**遗留（F4/F5/F11/F12/F13/F14/F17/F18/F20/F21/F24/F32/F33/F36 + 标签补全）。它们不引入新领域，而是修复同一概念在多处各写一份、或 UI 与存储口径不一致导致的摩擦：AI 提示词与情境注册表脱节、资料无法直接新建、报告存在恒为「—」的死瓦片、总览监视柱不可点、报告内停滞建议与下方停滞栏动作不一致、重新解析覆盖用户编辑、多文件上传串行慢、编辑保存不可撤销等。本 ADR 记录**清扫的口径选择**与实现。

## 2. 决策

### 2.1 F4 · 情境统一：AI 提示词从标签注册表派生

此前 `server/ai.mjs` 的收件箱解析与任务补全提示词**硬编码 5 个情境**（`@lab/@computer/@campus/@phone/@org-room`），而注册表 `data/meta/tags.json` 的 `context` 命名空间已有 7 个（含 `@errands` / `@home`）——AI 被要求忽略两个有效情境。

- 新增 `contextNamesOf(snapshot)`（导出供冒烟 / 单测）与 `contextRuleText(contextNames)`：从快照 `tags`（`namespace === 'context'`）派生情境名，注入 `buildSystem(digest, hasFile, contextNames)` 与 `buildTaskDraftSystem(digest, contextNames)`；注册表为空时回退 `@computer`。所有已登记情境对 AI 均可达。
- 前端 `AiSuggestionForm` / `TaskDetailModal` 本就按 `namespace === 'context'` 读注册表（非硬编码）；本切片为二者补 `datalist` 情境补全。

### 2.2 F24 · 任务上下文筛选 = 已用 ∪ 注册表

`src/views/Tasks.tsx` 此前仅取**任务上出现过**的 `contexts` 并集，导致「已登记但暂无任务」的情境在筛选条不可达。改为**已用 ∪ 注册表情境**（`getTags()` 过滤 `context`），并依赖 `revision` 在注册表变化后刷新。

### 2.3 F21 · 重要性量纲统一为 0–3

不一致：`taskSchema.importance` 与 `TaskDetailModal` 用 **0–3**，而 `AiSuggestionForm` / 各 AI 输入 schema（suggestion / action / taskDraft / taskCreate / clarify）用 **1–3**；`scripts/seed.mjs` 写入 `0`，**持久数据 `t-0057` / `t-0058` 即含 `importance: 0`**。

**选择 0–3（而非审计倾向的 1–3）**，理由：① 持久化 schema 与 `docs/04 §4` 已规范为 0–3；② 收紧为 1–3 需重写既有 `t-0057/t-0058`，违反「绝不改动既有 / 所有者记录」的硬纪律；③ 0 = 最低 / 可略过的输入，语义成立。实现：把 5 个 AI / 创建 / 澄清 schema 的 `importance` 由 `.min(1)` 放宽为 `.min(0)`，AI 提示词由 `1 | 2 | 3` 改为 `0 | 1 | 2 | 3`；前端抽出单一源 `IMPORTANCE_OPTIONS = [0,1,2,3]` + `importanceLabel(n)`（`src/lib/format.ts`），`AiSuggestionForm` / `TaskDetailModal` 共用；`taskSchema` 仍 0–3（未放宽也未收紧）。

### 2.4 F7 · 能量选项单一源

抽出 `ENERGY_OPTIONS`（`format.ts`），`AiSuggestionForm` / `Tasks` 筛选 / `TaskDetailModal` 复用，删除三处 `['low','medium','high']` 字面量。

### 2.5 F5 · 资料直接新建

此前资料只能经收件箱澄清 / 文件投递产生。新增：

- 服务端 `resourceCreateSchema`（`title` 必填；`kind` / `status` 缺省 `article` / `unread`；可选 `url` / `path` / `note` / `areaId` / `tags`）+ `POST /api/resources`（`areaId` 真实存在校验；标签规格化并登记 `origin:'manual'`；审计 `resource.create`）。
- 前端 `ResourceDraftModal`（镜像 Slice M 的 `NoteComposeModal`：标题 / 类型 / 链接 / 简介 / 标签）→ Library 资料区头部「新建资料」→ 点「创建资料」才经 `POST /api/resources` 落盘（ESC / 取消零写入）→ toast「资料已创建 · 撤销」（撤销 = 移入回收站）+ 打开 `?resource=` 深链。

### 2.6 F11 / F12 · `migrated` 死瓦片移除

`ReviewMetrics.migrated` 生成流程**刻意不产出**（`computeMetricsForWindow` 只给 captured/created/completed/overdue），面板「迁移」瓦片恒显示 `—`。

- **移除报告 UI 的「迁移」瓦片**（`Review.tsx` `METRIC_LABELS` 删除该条），`ReviewMetrics.migrated` 数据字段**保留**以兼容旧归档（rev-0001/0002）。
- 总览 W40 行 `迁移 ${...migrated}` 缺省渲染 `—`（`?? '—'`），修复字面 `undefined`。

### 2.7 F13 / F14 · 总览可达性（廉价深链）

监视柱「收件箱水位」→ `/inbox`、「WIP · 进行中」→ `/tasks` 整块按钮化；底部 W40 回顾行 → `/review`。项目行原本即可点开弹窗，保持不变。新增 `button.r3c-block--link` / `button.r3c-w40` token-only 样式（无边框、通栏、hover 微亮）。

### 2.8 F17 · 报告内停滞建议行可点

报告弹窗内 `draft.staleAdvice` 行此前只读，而下方「停滞项目」栏有动作。抽出 `applyStaleAdvice(advice)`：按建议动作调用**同一套**处理——`archive` → 归档（可撤销）、`migrate` → 重决策 touch、`reactivate` → 重启（新增）；弹窗行渲染对应动作按钮（项目不存在时禁用）。

### 2.9 F18 · 任务详情显示「推迟至」

`TaskDetail` 字段网格新增只读「推迟至」行（仅 `deferUntil` 设置时显示）；编辑仍在编辑表单内（`TaskDetailModal` 早已有该字段）。创建期仍不写入（延后）。

### 2.10 F32 · 重新解析保留用户编辑

「重新解析」会把活跃相位切到 `parsing`（`result` 置 null），`AiActionsCard` 被**卸载重建**，组件内 `touchedRef` / `values` 丢失。改为把「用户已手改字段」提升到模块级 `actionEditCache`（`src/lib/inboxAi.ts`，按 `itemId`）：

- `AiActionsCard` 增 `itemId` prop；挂载时若缓存 kind 对齐则恢复用户值 / 已改字段，编辑与建议变化时回写缓存；行标题恒显示当前表单值（使保留可见）。
- 条目离开未澄清列表（`reconcileInboxAiCache`）或忽略（`clearInboxAiActive`）时清除缓存。

### 2.11 F33 · 多文件上传受限并发

`Inbox.send` 的多文件上传由串行 `for + await` 改为**受限并发** `mapLimit(files, 3, …)`（保持结果顺序、逐条失败 toast）；**AI 解析仍严格顺序**（AI 更重且共享 opencode 会话，顺序给出稳定进度与自动应用次序）。

### 2.12 F36 · 编辑保存撤销

新增纯函数 `undoPatchOf(record, patch)`（`mutations.ts`）：对 patch 中出现过的键取记录原值（缺失 → null 清除语义）。任务 / 项目 / 笔记 / 资料四个详情弹窗的保存成功 toast 附「撤销」，回写该补丁即往返还原。**部分覆盖**：仅覆盖「编辑保存」；状态快捷设置 / 应用蒸馏等已有各自的撤销；回顾编辑撤销仍为删除整条（既有语义）。

### 2.13 标签输入补全

- `AiSuggestionForm` 的 `tags` / `contexts` 文本域加 `<datalist>`（注册表名称 + 中文标签）。
- `EntityEditForm` 的 `list` 字段（`key === 'tags'`）加 `<datalist>`，并 `useDataRevision()` 订阅注册表版本（revision-aware）；5 个 tags 调用方（任务 / 项目 / 笔记 / 资料 / 日程）自动获得补全。

## 3. 后果

**正面**

- 同一概念单一源：情境（注册表）、能量（`ENERGY_OPTIONS`）、重要性（`IMPORTANCE_OPTIONS` + 0–3）不再各处硬编码；AI 与 UI 口径一致。
- 资料可像笔记一样直接新建（先确认后写入、可撤销、可深链）。
- 移除恒为「—」的死瓦片；总览监视柱可点；报告内建议行与下方栏动作一致；重新解析不再吞掉用户编辑；多文件上传更快；编辑保存可撤销。
- 全部经单写者 + Zod + 原子写 + 审计；无新增依赖；无新增数据字段。

**代价 / 已知限制**

- 重要性量纲选择 **0–3**（非 1–3），与审计倾向不同；理由见 §2.3，已在 `docs/04 §4` 注明。
- `migrated` 字段保留但不再有 UI；「编辑追踪」若日后落地需重新引入该瓦片。
- F36 撤销覆盖「编辑保存」一处；文案 / 富文本等无版本历史；`updatedAt` 会随保存 + 撤销各 bump 一次（内容精确，时间戳前移）。
- F17 的 `migrate`（touch）无撤销（touch 本身无副作用）；`archive` / `reactivate` 有撤销。
- F32 的编辑缓存按 `itemId` 且仅 kind 对齐时复用；重新解析若改变了动作数量 / kind，对应行的编辑不回填（安全侧退避）。
- `deferUntil` 仍不能在创建期写入（延后）。

## 4. 验证

- `npm run build`（tsc strict + vite）退出 0。
- 服务端冒烟 `.qa/v41/server-smoke.mjs` **30/30**：`contextNamesOf` 派生情境 == 注册表情境（7，含 `@errands`/`@home`）；`POST /api/resources` 201 + `nextId` = `r-<max+1>` + `kind/status/url/note/tags` 生效 + 缺省 `article`/`unread`/`[]` + 空标题 400 + 臆造 `areaId` 400 + 非法 `kind` 400；重要性创建 / 编辑 `0` 通过、`4` → 400；审计 `resource.create` / `task.create`；回收站 `trash → restore → purge` 往返；零残留；**所有者 157 个数据文件字节不变**（`t-0057`/`t-0058` importance 0 逐字节一致）。
- 浏览器 E2E `.qa/v41/verify-y.py` **35/35**：新建资料（草稿 → 创建落盘 → 打开 `?resource=` → toast 撤销）；上下文筛选 chips == 注册表情境数（7）；重新解析保留用户标题；编辑保存撤销还原；总览 水位→/inbox、WIP→/tasks、W40→/review；报告指标不含「迁移」瓦片 + 建议行按钮按建议归档；tags 字段带 datalist；390 零横溢；控制台 0 error；零残留（资料 / 任务集合与标签注册表回基线）。证据 `.qa/v41/`（冒烟 / E2E 日志、5 张截图、前后字节哈希）。
