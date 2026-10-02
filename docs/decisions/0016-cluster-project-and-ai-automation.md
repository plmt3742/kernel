# ADR-0016 · 项目诞生：聚类立项 + AI 自动化档位

- 状态：已采纳
- 日期：2026-10-03
- 相关：ADR-0005（opencode 接入）、ADR-0006（AI 解析升级）、ADR-0008（收件箱文件投递 / 生命周期）、ADR-0011（先确认后写入）、ADR-0014（标签生命周期）、ADR-0015（AI 全链 · 多实体一揽子处置）

---

## 1. 背景与问题

所有者提问：

> 「一个项目，它是怎么诞生的——是因为我连续输入了多个类似的任务，所以它自动整合成一个项目，还是我一次性输入了多个类似的任务它才会生成？……项目里面的子任务又是怎么产生的？」

到 Slice R1 为止，系统只回答了**一次性多条**这一半：一条内容（通知 / 文件）经 AI 解析出**动作数组**，一次确认后建立新项目并挂上若干任务。但真实使用中更常见的是**连续、累积**地丢入多条**彼此相似**的任务（今天记一条「合唱定曲目」、明天记一条「合唱招新」、后天丢一条「合唱场地」）——这些零星条目永远停留在无归属状态，没有人把它们**归纳成一件新事务**。同时，所有者要求：AI 全链必须有**自动化档位**（确认 ↔ 免确认全自动），并且能**看见 AI 在幕后做了什么**。

本 ADR 定义 Slice R2 的两个决策：**聚类立项**与**AI 自动化档位**；并给出自动化档位的**能力边界表**。

## 2. 决策

### 2.1 聚类立项（连续累积的相似任务 → 新项目）

**确定性预分组是成员边界的唯一来源，AI 只负责命名。**

1. **候选**（`collectClusterCandidates`）：无 `projectId` 的未完成任务（`next` / `waiting` / `scheduled` / `someday`，按 `updatedAt` 倒序）+ 未澄清收件箱条目（按 `capturedAt` 倒序），合计 **≤50**（有界成本）。
2. **预分组**（`pregroupCandidates`，纯确定性）：先用**共享标签**（≥3 个候选共享同一标签）贪心成组，再用**标题关键词**（拉丁词 + CJK 二元组，去停用词）在剩余项上补组；每个候选最多归入一组。仅保留**成员 ≥3** 的组，按规模降序，最多 6 组送 AI。
3. **AI 命名**（`/api/ai/cluster/draft`）：把「组号 → 成员」摘要交给模型，要求为**每个组**起项目名、写完成定义（`outcome`）与理由；模型**只引用组号**，成员 id 由服务端展开——**模型无法编造 id**（抗幻觉由构造保证，而非事后过滤）。
4. **后校验**（`postValidateClusters`）：丢弃越界组、成员 <3、无任务的组、与现有项目**同名**的组；成员任务不跨提案复用；`areaId` 须真实存在；标签规格化 ≤3。
5. **覆盖兜底**：AI 命名失败、或某组未被 AI 覆盖（含被后校验丢弃）时，用**确定性命名**（组内最高频标签 / 首条标题 → `归纳：X`）补齐。保证「成员 ≥3 且未被现有项目覆盖」的组**一定会被提议**（用户仍可逐条「忽略」）——这是对所有者「连续输入相似任务应当被整合」诉求的直接回应。
6. **端点输出** `{ proposals: [{ title, outcome?, reason, taskIds[], inboxIds[], areaId?, tags[] }], model, ms, candidates }`（0–3 条）。

**应用 / 撤销（服务端一次写入）**

- `POST /api/projects/cluster-apply { title, outcome?, areaId?, tags?, taskIds[] }`：校验后**创建项目**（`project.create` · `via:'cluster'`）并把列出的**无归属任务**逐个 `projectId` 归入（每条 `task.update` · `via:'cluster'`）；标签 `origin:'ai'` 登记。项目上记录 `clusterTaskIds` / `clusterTagIds`（`catchall` 允许的额外字段）作为**撤销凭据**。已于别处归属的任务被跳过；臆造 / 不存在的 id 被丢弃；无有效任务 → 400。
- `POST /api/projects/cluster-unapply { projectId }`：按 `clusterTaskIds` 清除本次归入任务的 `projectId`（恢复无归属）→ `pruneTags(clusterTagIds)`（仅删本次新建且已无人使用的标签）→ 项目**移入回收站**。**精确回到应用前基线**。
- **收件箱条目不参与应用**：`InboxItem` 无 `projectId` 结构，无法被归入项目；它们只作为命名参考，在提案卡片中以「相关条目（澄清时会自动参考）」展示，**本端点不改写它们**（澄清时 AI 仍会参考其内容）。这一边界被显式记录，避免「看起来归纳了却没落位」的误解。

**前端**：收件箱在编辑器 / 列表之间加一张安静的「AI 归纳」建议卡（`ClusterProposalCard`：标题 + 成员数 + 任务标题截断 + 相关条目 + 「创建并归入」/「忽略」）。头部提供手动「发现项目」按钮；并在**每会话自动运行一次**（候选 ≥3 且本会话无缓存时，静默请求一次；失败静默、可手动重试）。**永远只出建议，绝不自动建项**。

### 2.2 AI 自动化档位

`data/meta/config.json` 新增 `aiAutomation: 'confirm' | 'auto'`（**缺省 `'confirm'`**；旧配置缺省由前端视作 confirm）。端点 `POST /api/config { aiAutomation }`（白名单 + Zod + 原子写 + 审计 `config.update`）。设置页新增「AI 自动化」区（radio：确认模式（默认）/ 自动模式 + 说明）与下方「AI 动态」feed。

**自动模式行为**：捕捉文本 / 投递文件后的**自动解析**完成时，若档位为 `auto`，自动经 R1 的 `POST /api/inbox/:id/apply` 应用本次动作（构造上仅含 `task` / `note` / `resource` / `project` 的**创建**）；成功 toast「AI 已自动整理 N 项 · 撤销」（撤销 = `unapplyInbox`）。**空动作 / 无建议 → 保持条目未澄清并显示建议卡**。**失败 → 静默回退到建议卡**（条目不变、绝不崩溃）。审计 `inbox.apply` 的 `detail.ai:true` 已标记来源。

### 2.3 自动化能力边界（不可违背）

| 自动模式**可以**做（低风险、可撤销） | 自动模式**永不**做（高风险 / 不可逆或需人判断） |
|---|---|
| 创建任务 / 笔记 / 资料（`task` / `note` / `resource`） | 删除任何实体（收件箱 / 任务 / 项目 / 笔记 / 资料 / 回顾） |
| 创建新项目（`project`）并挂接本批次新建实体 | 完成任务 / 改状态 / 归档项目 / 丢弃条目 |
| 登记标签（`origin:'ai'`） | 修改 / 重命名 / 合并 / 删除已有标签 |
| 关联到现有项目 / 区域（真实存在校验后） | 修改任何**已存在**实体的字段（任务 / 项目 / 笔记 / 资料） |
| — | 触碰 `data/` 之外的系统（文件系统 / 外部网络） |
| — | 未经确认执行聚类立项（聚类**永远**只出建议，无自动应用） |

- **默认仍是「先确认后写入」**：自动模式是**显式 opt-in**，非默认；随时可切回确认模式。
- 自动应用是 R1 已交付的**同一写入路径**（`applyInbox`），因此天然带上「全部产物可一键撤销 + 标签注册表恢复」的保证；**不新增任何写入面**。

## 3. 备选方案与取舍

- **让 AI 直接给出成员 id**：模型编造 id 是已实证的失败模式（Slice B 起即按快照过滤）。改为「AI 引用组号、服务端展开成员」，把抗幻觉从**事后过滤**前移为**构造保证**。
- **完全交给 AI 聚类（不预分组）**：成本高、不稳定、且会把无关条目并组。确定性预分组把「哪些条目算一类」变成可解释、可复现、可单测的规则；AI 只做它擅长的「命名 + 写完成定义」。
- **AI 可拒绝所有组**：若如此，所有者的核心诉求（相似任务被整合）可能落空。故保留**覆盖兜底**——确定性层已保证成员 ≥3 的组确有共同信号，AI 未命名时以确定性名补齐；用户仍可忽略。
- **自动模式允许「完成 / 归档」**：这些操作改变既有状态、难以安全批量撤销，且需要人的判断；排除在自动范围外（见边界表）。

## 4. 后果

- 「项目如何诞生」有了两条互补路径：**一次性多条** → R1 一揽子应用；**连续累积** → R2 聚类立项。二者共用同一写入 / 撤销原语，行为一致。
- 自动档位把「幕后工作」落到实处，但**风险面被显式圈定**：只创建、永不删除 / 完成 / 归档；默认仍需确认。
- 「AI 动态」feed 让 AI 的每次幕后动作（解析 / 应用 / 撤销 / 档位更新 / 聚类建项与撤销）在设置页时间倒序可见，并带实体深链——撤销仍在动作发生时的 toast 中，feed 是长期记录。
- 新增端点 4 个、`data/meta/config.json` 增 1 字段；无新依赖。

## 5. 落地清单

- 服务端：`server/schemas.mjs`（`aiAutomationSchema` / `configUpdateSchema` / `clusterDraftSchema` / `clusterProposalSchema` / `clusterApplySchema` / `clusterUnapplySchema`）、`server/store.mjs`（`readConfig` / `updateConfig`）、`server/ai.mjs`（`collectClusterCandidates` / `pregroupCandidates` / `draftClusters` / `postValidateClusters` + 摘要 / 提示词 / 重试 / 兜底）、`server/index.mjs`（4 路由 + `clusterApply` / `clusterUnapply` / `applyConfigUpdate`）。
- 前端：`src/types.ts`（`AiAutomation` + `AppConfig.aiAutomation`）、`src/lib/mutations.ts`（聚类类型 + `aiClusterDraft` / `applyCluster` / `unapplyCluster` / `updateAiAutomation` / `fetchActivity`）、`src/components/ClusterProposalCard.tsx`、`src/components/AiActivityFeed.tsx`、`src/views/Inbox.tsx`（建议卡 + 每会话自动运行 + 自动应用钩子）、`src/views/Settings.tsx`（AI 自动化区 + AI 动态）、`src/styles/views.css`（token-only）。
- 验证：`.qa/v35/`（冒烟 44/44 + E2E 36/36，零残留、所有者数据未动、控制台 0 error）。
