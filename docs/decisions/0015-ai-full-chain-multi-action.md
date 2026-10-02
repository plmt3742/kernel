# ADR 0015 · AI 全链：多实体一揽子处置（Slice R1）

- 状态：已接受
- 日期：2026-10-03
- 决策者：项目所有者指令：「现在最大的问题就是我需要做过多的介入，也就是我需要创建标签、项目等内容。我希望你能完善整条 AI 链，也就是说，我只负责往里面丢资料以及信息等内容，而你作为 AI 助手，需要帮我做好幕后工作。」
- 关联：ADR-0005（AI 只建议不落盘）、ADR-0006（AI 解析上下文 / 挂接建议）、ADR-0008 §6（收件箱生命周期 · Slice V）、ADR-0011（先确认后写入）、ADR-0014（标签生命周期）、`docs/02` §3.2 / §4.3、`docs/04` §4.1 / §4.3 / §4.14、`CHANGELOG.md`、`TASK_BOOK.md`、`.qa/v34/`

---

## 1. 背景

在此之前，AI 解析一条收件箱内容只产出**一个**建议（`target` = task / note / resource / discard）。真实场景里，一条通知往往同时意味着「一件要推进的新事务 + 若干下一步 + 一份要点」——例如「筹备校园辩论赛（下月）：定场地、招队员、写策划案」应是 **1 个新项目 + N 个任务 + 1 条笔记**。单建议模型迫使所有者反复手工介入：先建项目、再把条目澄清为任务、再逐条挂接、再补标签——正是所有者说的「需要做过多的介入」。

设计目标：**丢入 → AI 解析出一揽子动作 → 一次确认 → 全部落位（含新建项目并挂接、标签登记）+ 可撤销**。红线不变：**先确认后写入**（本切片不做自动应用）。

## 2. 决策

### 2.1 多动作抽取（`server/schemas.mjs` / `server/ai.mjs`）

解析输出由单建议升级为**动作数组** `{ actions: [...] }`：

- `aiActionSchema`：`kind` = `task` | `note` | `resource` | `project`；`title` 必填（≤80，清洗截断到 40 字）；`task` 带 `contexts/energy/importance/estimateMin/dueAt/duplicateOf`；`project` 带 `outcome`；`task`/`note` 可用 `linkToNewProject` 挂到本批次新建项目。
- 上限 **≤6 个动作**；每个动作 tags ≤3（`cleanTagSuggestions`）。
- **防臆造不变**：`postValidateActions()` 按快照过滤 `projectId` / `areaId` / `duplicateOf`（臆造即丢弃），标签规格化保留、待落盘时登记。
- **至多一个新项目**：`kind:'project'` 取第一个；标题与现有项目完全同名者丢弃（防重复建项）。`linkToNewProject` 仅在存在项目动作时保留，且与 `projectId` 互斥。
- **向后兼容**：`aiSuggestionSchema` 保留；模型若仍返回旧式单建议，`legacyToActions()` 归一化为动作数组（`target:'discard'` → `[]`；`newProjectHint` → 项目动作 + 实体 `linkToNewProject`），同步 `parseInboxItem` 与流式 `parseInboxItemStream` 两条路径共用 `tryParseActions()`。响应携带 `actions`。
- 系统提示要求：把一条 dump 拆成自然包、宁少而精、最多一个新项目、挂靠宁缺毋滥、附件不可读时更保守。

### 2.2 一揽子应用（`POST /api/inbox/:id/apply`）

一次写入把全部动作落位，顺序固定：

1. **先建新项目**（若有）：`status:'active'`，`outcome` 缺省「完成定义待整理（由收件箱一揽子应用创建）」，`areaId` 缺省 `a-0001`；审计 `project.create` · `via:'inbox.apply'`。
2. **逐条建实体**（`task` / `note` / `resource`）：`linkToNewProject:true` 的自动挂到新项目 `id`；显式 `projectId` 须真实存在（否则 400）；`task` 带 `sourceInboxId`；`resource` 对文件条目写入 `path`。审计 `task.create` / `note.create` / `resource.create`。
3. **标签登记**：本批次新标签以 `origin:'ai'` 登记（`ensureTags` + `firstUsedInMap`）。
4. **条目置 `clarified`**：`linkedId` = 首个产物（深链）、`linkedIds` = 全部产物（完整撤销）、`appliedTagIds` = 本次新登记标签（注册表复原）；审计 `inbox.apply`。

服务端重新 `inboxApplySchema.parse()` + 关联 id 存在性校验，**不信任客户端形状**；至多一个项目动作（多于一个 400）。

### 2.3 撤销 / 撤回（`POST /api/inbox/:id/unapply`、扩展 `revert`）

`unapply` 与 `revert` 共用 `detachInbox()`：

- 删除 `linkedIds`（兼容旧单 `linkedId`）指向的全部产物；
- `pruneTags(appliedTagIds)` 删除**本次应用新登记且已无人使用**的标签（正在被其它记录使用则保留），把注册表恢复到应用前基线；
- 清除 `linkedId` / `linkedIds` / `appliedTagIds`，条目回 `unprocessed`（`unprocessed` 幂等）。

这使「已澄清行撤回」在**多产物**下也正确（Slice V 只删单个 `linkedId`，对一揽子应用不够）。

### 2.4 项目快速新建 AI 草稿（`POST /api/ai/project/draft`）

- 新端点读快照摘要 + 指令式 JSON + Zod + 单次重试，只建议 `outcome` / `areaId` / `tags`（不落盘，health 503 / 失败 502）。`postValidate` 过滤臆造 id。
- `POST /api/projects` 扩展接受可选 `outcome` / `areaId` / `tags`（`areaId` 存在性校验；缺省行为不变）。Projects 页快速新建改为**居中草稿确认弹窗**（镜像 `TaskDraftModal`）：回车打开 → AI 预填 → 可编辑 → 点「创建项目」才写入；AI 失败不阻断。

### 2.5 前端处置卡（`src/components/AiActionsCard.tsx`）

- 逐条呈现动作：勾选（纳入 / 排除）+「编辑」按 `ACTION_FIELD_MATRIX` 只渲染该 kind 会落盘的字段（**杜绝展示不生效的输入框**）。
- 页脚固定三键：**「全部应用（N 项）」** / **「重新解析」** / **「忽略」**；应用成功 toast「已应用 N 项 · 撤销」。
- `motion` / reduced-motion / 键盘可达 / 中文 UI 沿用既有规范。

## 3. 保持不变（本切片不做的）

- **先确认后写入**仍是默认：解析只出动作，绝不自动应用。
- 「一键建项目」能力**并入**项目动作（一个勾选 + 一次应用即完成「建项目 + 挂接任务」，是原能力的超集）；原独立的 `newProjectHint` 前端按钮退役，`newProjectHint` 仅在旧式形状归一化中作为输入存在。
- 单条手工澄清按钮（→ 任务 / 项目 / 笔记 / 资源 / 丢弃）、删除 / 恢复 / 撤回、字段矩阵等 Slice V 行为全部保留。
- 仍需人工的环节（显式延后）：AI 不自动合并重复任务（`duplicateOf` 仅提示）、不自动改现有实体、不做跨条目的批量编排——留待后续切片。

## 4. 影响

- `server/`：`schemas.mjs`（+`aiActionSchema` / `aiActionsSchema` / `inboxApplySchema` / `projectDraftSchema`）、`ai.mjs`（多动作提示词 + `postValidateActions` / `legacyToActions` / `tryParseActions` / `draftProject`）、`index.mjs`（apply / unapply / 扩展 createProject / project draft 路由）、`store.mjs`（`pruneTags`）。
- `src/`：`lib/mutations.ts`（`AiAction` / apply / unapply / project draft / 扩展 createProject）、`lib/aiForm.ts`（`outcome` + `ACTION_FIELD_MATRIX` + `actionToForm` / `formToAction`）、`components/AiActionsCard.tsx`（新）、`components/ProjectDraftModal.tsx`（新）、`components/AiSuggestionForm.tsx`（outcome）、`views/Inbox.tsx`、`views/Projects.tsx`、`styles/views.css`。
- 验证：服务端冒烟 39/39 + 前端 E2E 36/36 + 构建通过，零残留，证据 `.qa/v34/`。
