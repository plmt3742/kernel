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

---

## 5. 修订（Slice R2.5 · 2026-10-03）：文件条目 = 资料 + 简介，不拆分

### 5.1 背景（owner 校准）

Slice R1 把「一条内容 → 一揽子动作」铺开，对**文本**条目是增益；但对**文件投递**它是错的默认。Owner 原话：「我丢入文件后，我希望 AI 解析是用于总结出简约的小结用于到时候资料详情页介绍这个资料用的，而不是作为一个任务，拆分成一堆任务。」——一份 `示例文档.docx` 被拆成「新建项目 + 任务 + 笔记 + 资料」四件套，与 owner 的心智（**文件 = 一份资料**）相反。

### 5.2 决策

- **文件条目（`item.file` 存在）只产出 1 个 `resource` 动作**：`{ kind:'resource', title, note, tags? ≤3, areaId? }`。
  - **提示词**：`buildSystem(digest, hasFile)` 在 `hasFile` 时切换到「资料 + 简介，绝不拆分」规则（并禁止 outcome / linkToNewProject / 任务字段）。
  - **硬归一化**：`postValidateActions(actions, snapshot, { hasFile:true, fallbackTitle, fallbackNote })` 丢弃全部 task / note / project，仅保留首个 resource，并归一化 `note`（折叠空白 + 截断 ≤120 字；未产出 resource 时用文件名 + 保守小结兜底）；`normalizeResourceNote()` 导出供单测。
  - **小结语义**：`note` 是资料详情页的「简介」，必须基于【附件】文本摘录；内容不可读时据文件名保守概括并注明。
- **前端纵深防御**：`POST /api/inbox/:id/apply` 对文件条目额外只允许 1 个 resource（多于 0 的非 resource 动作被过滤；无可应用 resource → 400）。
- **文本条目保留多动作**：新增反过拆规则——通常 1–4 个（最多 6）；纯信息 / 资料类优先 `resource`（带 `note` 小结）或 `note`，仅对明确可执行的事产出 task。
- **存储与展示**：`resource.note` 经 `clarifyDetailsSchema`（新增 `note`）与 `aiActionSchema`（新增 `note`）接受并落盘；资料详情弹窗标题下渲染安静「简介」区块（空则不显示），`resources` 编辑白名单已含 `note`。

### 5.3 不变

- `resource` 的 `kind:'file'` + `path` 行为、Zod 校验、审计动作名（`inbox.apply` / `resource.create` / `resource.update`）均不变。
- 默认仍是先确认后写入；撤销仍走 `unapply`（文件条目产物为单个 resource）。
- 手工澄清路径（→ 任务 / 项目 / 笔记 / 资源 / 丢弃）不受影响。

### 5.4 影响

- `server/schemas.mjs`：`aiActionSchema` + `clarifyDetailsSchema` 增 `note`。
- `server/ai.mjs`：`AI_RESOURCE_NOTE_MAX_CHARS` / `normalizeResourceNote` / `fileParseOptions`；`buildSystem(digest, hasFile)`；`postValidateActions(..., options)`；`parseInboxItem` / `parseInboxItemStream` 传递文件校准。
- `server/index.mjs`：`clarifyInbox` / `applyInboxActions` 写 `resource.note`；apply 文件条目纵深过滤。
- `src/`：`lib/mutations.ts`（`AiAction.note`）、`lib/aiForm.ts`（`note` 字段 + `ACTION_FIELD_MATRIX.resource`）、`components/AiSuggestionForm.tsx`（简介 textarea）、`components/AiActionsCard.tsx`（小结展示）、`views/Library.tsx`（简介区块 + 编辑标签）、`views/Inbox.tsx`（动作行 + 删除同排）、`styles/views.css`（`.ic-subrow__row` / `.ic-lifecycle` 靠右 / `.ic-action__note`）。
- 验证：服务端冒烟 31/31 + 前端 E2E 23/23 + 构建通过，零残留，证据 `.qa/v36/`。

### 5.5 修订（QA v74 · 2026-10-04）：图片条目 = 内容动作 + 图片资料（两处口径对齐）

- **背景（owner 报告）**：owner 丢入图片 + 文字（赛程截图与相关文字），解析正确地产出了 2 个 event，但点「全部应用」被 `applyInboxActions` 的「文件条目只能应用为资料」400 拦截——解析侧对图片走多动作管线（Slice N0），apply 侧却按 §5.2 的「文件条目」一律只放行 resource，**两侧口径不一致**（bug）。owner 诉求原话：「我输入图片也是为了提供信息（有时候只是单纯想要存入这个资料，有时候是为了辅助我的文字内容）……在分析后也需要分析这个资料本身该如何被简介后存入资料库」。
- **决策（仅限图片条目；非图片文件维持 §5.2 全部规则）**：
  1. **解析侧始终补一条「图片本身」的 resource**：提示词规则 9 更新（始终产出 1 个 resource 收录图片本身——note 为简介；同时按文本规则解析图片中信息，多动作产出）；`postValidateActions({ hasFile, isImage:true })` 在模型未产出 resource 时按文件名兜底补齐（简介用兜底文案），其余内容动作照常保留（资源动作置首、总数 ≤6）。
  2. **apply 侧对齐**：`applyInboxActions` 的「文件条目只能应用为资料」纵深防御收窄为**非图片文件**（`hasFile && !isImageFile(item)`）；图片条目允许内容动作与「图片自身」resource 一揽子落位（resource 分支照常带 `kind:'file'` + 附件 `path`）。
- **不变**：非图片文件（pdf / docx / xlsx 等）= 资料 + 简介、绝不拆分；确认制、撤销（`unapply`）、审计动作名全部不变。
- **验证**：`.qa/v74/`（探针 + 服务端断言；图片条目 resource+event 一揽子落位 → 撤销零残留；非图片文件仍被拦截）；详见 CHANGELOG / TASK_BOOK 本条目。
