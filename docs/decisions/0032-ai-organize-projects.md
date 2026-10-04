# ADR-0032 · 项目「AI 整理」——归并已有项目 + 新项目提案 + 每日调度

- 状态：已采纳
- 日期：2026-10-03
- 相关：ADR-0005（opencode 接入）、ADR-0011（先确认后写入）、ADR-0014（标签生命周期）、ADR-0016（聚类立项 + AI 自动化档位）、ADR-0022（界面状态保留）、ADR-0027（链接阅读 / 出站抓取）、ADR-0031（Windows 安装包分发）

---

## 1. 背景与反馈

所有者：

> 「在项目页加一个 AI 整理功能，把现有的任务整理进高度相关的已有项目，剩下的相关任务建议新建项目，每天中午 12 点后自动跑一次。」

Slice R2（ADR-0016）已经解决「连续累积的相似任务如何诞生项目」——但它是**收件箱侧**的入口（未归属任务 → 预分组 → 命名 → 建项），且**只手动 / 每会话触发**。真实使用里更常见的情形是：任务已经躺在任务库里、彼此相关、却散落无归属；用户希望从**项目页**反查「哪些现有项目应该收编哪些任务」，并把剩下的聚成**新项目提案**；同时希望这件事**每天自动跑一次**（打开应用就能看到今日建议），而不是每次点一次。

本 ADR 定义 Slice N8 的决策：**归并 + 新建两段提案**、**提交 / 撤销语义**、**每日调度语义**，以及随之而来的边界。

## 2. 决策

### 2.1 三端点与数据流

| 端点 | 语义 | 写入 |
|---|---|---|
| `POST /api/ai/organize/draft` | 只读草稿：扫描候选 → 确定性预分组 → AI 出提案 → 服务端后校验 → 兜底补齐 | **无**（不落盘、无审计） |
| `POST /api/projects/organize-apply` | 一次写入：应用选中的归并 / 新项目簇 | 是（201） |
| `POST /api/projects/organize-unapply` | 精确撤销上一次应用 | 是 |

**草稿（`organize/draft`，无 body）**

1. **候选**：无 `projectId` 的**未完成**任务 + **未澄清**收件箱条目，合计 **≤50**（有界成本）。
2. **确定性预分组**：复用 R2 的信号（共享主题标签、标题关键词），产出「分组提示」随摘要交给模型。
3. **AI 两阶段按编号引用**：摘要把候选排成**编号**列表，模型**只引用编号**（`assignments` 归并 / `clusters` 新项目簇），成员 id 由服务端展开——**模型无法编造 id**，抗幻觉由构造保证，而非事后过滤。
4. **后校验（`postValidateOrganize`）**：归并 ≤**5** 条 / 每条 ≤**10** 个任务；新项目簇 ≤**3** 个、每个 ≥**3** 成员、**须含任务**、标题不得与现有项目冲突、`areaId` 须真实存在、标签优先复用注册表已有名。
5. **确定性兜底**：AI 命名失败、或某预分组未被 AI 覆盖（含被后校验丢弃）时，`fallbackOrganizeClusters` 以确定性规则（组内最高频标签 / 首条标题）补齐——只出建议，用户仍可逐行「忽略」。
6. **响应** `{ assignments, clusters, model, ms, candidates }`；opencode 离线 → **503**，调用失败 → **502**。

**应用（`organize-apply`，201）**

- 服务端**重校验**（`organizeApplySchema` + 真实存在 / 状态 / 打开态），不信任客户端形状。
- **归并只写任务文件**：目标项目文件**字节不动**（避免触碰项目聚合字段）；逐条 `task.update`。
- **新项目簇**：逐簇建项目并归入任务，另登记标签（`origin:'ai'`）；项目上记 `clusterTaskIds` / `clusterTagIds` 作为撤销凭据。
- **单簇失败不中止整批**（逐簇独立，失败项记入响应）。
- 审计 `via:'organize'`（`task.update` / `project.create`）。
- 无有效项（`assignedTotal=0 && projects=0`）→ **400**「没有可应用的整理项」。

**撤销（`organize-unapply`）**

- 新项目经 `clusterTaskIds` **移入回收站**；被归入任务的 `projectId` **清空**；`pruneTags` 仅删本次新建且已无人使用的标签。审计 `organize-unapply`。**精确回到应用前基线**。

### 2.2 前端

- `src/lib/organize.ts`：模块级 store（键 `kernel.ui.organize.v1`，经 `createUiStore` 的 parse / prune 语义跨刷新保留提案 / 上次运行日 / 在途态；在途态与错误刷新即重置，绝不留「正在请求」残影）；`runOrganizeNow()` 手动（忽略时段 / 日期 / 锁，仅守 busy / applying）；`dismissOrganize()` 清提案、保留运行戳；`applyOrganizeSelection()` / `undoOrganizeApply()`。
- `src/components/OrganizeProposalCard.tsx`：两段「归并到已有项目」/「建议新项目」，逐行勾选**默认全选**、取消加 `.is-excluded`；页脚「全部应用（K 项）」（K = 已勾选任务数）/「重新整理」/「忽略」；无提案且已运行显示「今日整理已完成 · 暂无待确认建议」；失败为静默错误（卡片内文案，无 toast）。
- `src/views/Projects.tsx`：工具条 `.k-projects__organize`（文案「AI 整理」/ 在途「整理中…」，应用 / 草稿在途时禁用）；应用成功 toast「已整理 N 项 · 撤销」（撤销走 `organize-unapply`）。

### 2.3 每日调度语义

`useOrganizeScheduler()`（`AppLayout` 挂载）：

| 维度 | 规格 |
|---|---|
| 时段 | 仅**本地时间 12:00 之后**（`getHours() < 12` 直接跳过） |
| 频率 | **每日一次**，由持久化的 `lastRunDate`（本地 `YYYY-MM-DD`，字符串比较兼容时钟回拨）判重 |
| 触发 | 挂载即 tick；每 **30s** 轮询；每次窗口 **focus** / 页面 **visibility** 恢复即时补跑；**过午打开应用即补跑** |
| 跨标签 | 锁 `kernel.ui.organize.lock.v1`（TTL **120s**），并发窗口内仅一个标签真正发起请求 |
| 会话守卫 | 会话内「今天已尝试」置位在探活**之前**，AI 离线时也不风暴 |
| 离线 | 探活 `/api/ai/health` 失败 → 静默跳过（仅存错误态供卡片展示） |
| 写入门槛 | 调度**只调草稿端点**；应用**只来自用户在建议卡上的显式点击** |

## 3. 备选方案与取舍

| 备选 | 取舍 | 理由 |
|---|---|---|
| 让 AI 直接产出成员 id | **否决** | 编造 id 是已实证失败模式（Slice B 起即按快照过滤）；改为「编号引用 + 服务端展开」，抗幻觉前移为构造保证 |
| 归并时改写目标项目文件 | **否决** | 项目文件改动会污染其 `updatedAt` 与聚合口径；只写任务文件即可表达归属，**字节不动**保证可回滚 |
| 单簇失败 → 整批回滚 | **否决** | 用户勾选的是多条独立意图，一条坏掉不应作废其余；改为逐簇独立、失败项入响应 |
| 调度完成即自动应用 | **否决** | 违背全站「先确认后写入」纪律（ADR-0011）；调度只负责「把建议备好」，写入仍由人点 |
| 每次打开都跑一次 | **否决** | 成本与打扰；改为「每日一次 + 过午补跑」，当日已有结果不重跑 |
| 用 URL / 组件 `useState` 承载提案 | **否决** | 需跨路由 / 跨刷新存活，且不能落 `data/`；沿用 ADR-0022 的模块 store + `localStorage` |

## 4. 边界

- **护栏失败文案泛化**：向不存在项目 / 已完成任务应用时，服务端把具体原因写入响应 `errors`，但因无任何落地统一抛 **400「没有可应用的整理项」**（前端 toast 亦为该文案）。属既有设计，非缺陷。
- **任务软删除端点**：任务删除走通用 `POST /api/tasks/:id/trash`（**非 `/remove`**），purge 走 `POST /api/trash/tasks/:id/purge`。
- **候选有界**：草稿候选合计 ≤50，`draft` 每次都会重新扫描，不缓存候选。
- **无 schema 变更**：复用 `project` 的 `clusterTaskIds` / `clusterTagIds` 额外字段；**无数据模型变化**。
- **无新增依赖**。
- **调度依赖本地日期**：`lastRunDate` 取本地 `toISODateString`（绝不用 `toISOString` 的 UTC 日，避免跨日误判）。

## 5. 验证与证据

QA v67（证据 `.qa/v67/`）：

- **服务端冒烟 `server-smoke.mjs` 47 PASS · 0 FAIL**：真实草稿（只读，`candidates=4`，`assignments={p-0001, t-0006}`、`clusters=[]`）；空载荷 400；归入往返（p-0001 **字节不变** `b52a019a5bf6…`，审计 `via:'organize'`）；新项目簇往返（p-0002 建 / 归入 / 撤销入回收站 / purge）；护栏（不存在项目、已完成任务 → 400 且**零写入**）；清理后 37 文件指纹回落基线。
- **浏览器 `verify-n8.py`（Chromium，1440 / 390）39 PASS · 0 FAIL**：工具条可见 + 真实草稿只读；勾选 / 取消 / 全取消禁用 / 忽略完成态；确定性 fixture 应用 + toast「已整理 3 项 · 撤销」+ 撤销后项目进回收站；390 文档级横溢 **0px**；console error **0**。
- **调度器**：Playwright **clock**（`page.clock.install`）`11:30 → 0` 次请求，`run_for` 跨 12:00 → `1` 次；实时全新 context 打开 `/` 恰好 1 次，`lastRunDate == '2026-10-03'`，刷新后仍为 1 次（当日不重跑）。
- **零残留**：`data/**/*.json`（排除 `activity.jsonl` 与 `data/files/`）测试前后 **37 文件字节级一致**，manifest SHA256 `3403f2a95d204e5fb79a26056993fc4fc6c663040ad4e747f42a33d16151b0f2`；`p-0001` 与 `meta/tags.json` 字节不变；`[QA-N8]` 零残留。
- **缺陷：无**。

## 6. 影响面（文件）

- 服务端：`server/schemas.mjs`（`organizeDraftSchema` / `organizeApplySchema` / `organizeUnapplySchema`）、`server/ai.mjs`（`buildOrganizeSystem` / `buildOrganizeDigest` / `promptOrganizeWithRetry` / `postValidateOrganize` / `fallbackOrganizeClusters` / `draftOrganize`）、`server/index.mjs`（三路由 + `organizeApply` / `organizeUnapply`）。
- 前端：`src/lib/organize.ts`（新）、`src/lib/mutations.ts`（草稿 / 应用 / 撤销 + 类型）、`src/components/OrganizeProposalCard.tsx`（新）、`src/views/Projects.tsx`、`src/components/shell/AppLayout.tsx`、`src/styles/views.css`（token-only）。
- 记录：本 ADR；`docs/02`、`docs/05`、`docs/README`；`public/guide.html`；`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md`。

## 7. 修订 · N8.1（智能升级）

答所有者「把能规划的任务都规划一下项目区分，AI 要够智能，体现在分类标准与规则设定」+「自行判断是不是需要建立新项目来收纳相关任务」。本修订不新增端点，只升级 §2.1 草稿的分类标准与限额：

1. **分类标准 v2（三分类）**（`buildOrganizeSystem`，含正 / 反例）：
   - 【A 归并到现有项目】须**具体归属关系**（同课程 / 同活动赛事 / 同组织的一件事 / 同委托方 / 同一人的同一事务 / 或它就是项目完成定义里的一步）；仅「领域相近」**不算**。
   - 【B 建议新项目】≥2 条同一件多步事务；**单条**候选若明确是多步事务（准备考核 / 组织活动 / 开发交付 / 长期训练），模型可**自行判断单独立项**，须给出 `outcome` + `reason`。
   - 【C 不规划】单步即可完成的事务**正确不输出**。
   - 目标：遍历全部候选、**不漏**（能合理规划的都给归属），每条建议能写出**可核对 `reason`**（不硬塞）。
2. **限额与门槛放宽**（`postValidateOrganize`）：assignments 5→**8**、clusters 3→**5**；新项目簇 **≥2 成员**即可（`ORGANIZE_MIN_CLUSTER_ENTRIES = 2`）；单条任务成簇门槛 = 非空 `outcome` + `reason` ≥**6** 字。确定性兜底（AI 失败）仍 ≥3 条、**不造单条**。draft / apply / unapply schema 上限同步为 **8 / 5**。
3. **响应增 `unplanned`**：未纳入任何建议的候选数；前端卡片显示「另有 N 项未纳入规划（单项事务或联系不足）」，无提案但已运行时同样带出。
4. **digest 占位处理**：完成定义为空 / 以「完成定义待整理」开头时显示「（未填写，参考标题与标签判断）」。
5. **附带**：项目状态编辑表单新增**判断标准提示**（`EntityEditForm` 支持 `hint`；`ProjectDetailModal` 状态字段提示「进行中 = 正在推进；暂停 = 已开始但暂时搁置（计划恢复）；将来 = 未承诺、也许哪天做；已完成 = 完成定义达成；已归档 = 不再跟进（从项目页隐藏）」；`.k-field__hint` QUIET 样式）。
6. **实测与证据**：真实数据 `t-0003` → 单独立项「Python 5 日速成」（含 `outcome` / `reason`，`unplanned=1`）；QA v68 服务端单测（单条门槛 / ≥2 / 截断 8 / 5 / `claimed` 去重 / `unplanned + covered === candidates`）与浏览器全过；证据 `.qa/v68/`。
