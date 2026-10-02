# ADR 0014 · 标签生命周期（录入即生成 · 自动登记 · 管理 / 合并 / 删除）（Slice T）

- 状态：已接受
- 日期：2026-10-03
- 决策者：项目所有者指令：「对于标签这种，没有生成由来，如果投入使用那不是用户使用体验崩塌吗」+「类似于标签你完全可以在录入任务的时候判断后生成标签，但是你却没有做这一步」+ 实证（`.qa/v31/`）
- 关联：ADR-0002（身份与领域是交叉筛选标签，不是容器）、ADR-0004（单写者数据服务 · 原子写 · 审计）、ADR-0005（AI 只建议不落盘）、ADR-0006（AI 解析上下文 / 挂接建议）、ADR-0011（先确认后写入）、`docs/02` §3.2 / §4.3、`docs/04` §4.12、`CHANGELOG.md`、`TASK_BOOK.md`、`.qa/v31/`

---

## 1. 背景

标签（tag）是本系统的核心筛选轴（ADR-0002：身份与领域是交叉筛选，不是目录分区），但它的生命周期此前是断裂的：

- **无生成由来**：`data/meta/tags.json` 注册表只由 `npm run seed` 写入；运行时用户在任务 / 项目 / 笔记 / 资料上写的新标签，只落在实体上，**从不进注册表**——于是没有 `label`、没有 `namespace`、没有来源、没有登记时间。
- **AI 无法生标签**：收件箱解析与任务补全的系统提示硬性要求「标签只能从下方标签名中选」，`postValidate` 还把注册表外的标签一律过滤——新标签在录入那一刻就被抹掉，永远无法诞生。
- **筛选条截断**：资料库标签条 `getTags().filter(namespace==='topic').slice(0, 12)` 只显示前 12 个，且按注册表顺序，与实际使用无关。
- **无管理入口**：没有重命名 / 合并 / 删除，标签一旦写错（错别字、同义分裂）只能手改 JSON。

对用户而言，这会让「标签」越用越乱：写了新标签却查不到、AI 建议的标签被悄悄丢弃、错标签无法收拾——即所有者所说的「用户体验崩塌」。本决策把标签补齐为**完整生命周期**，并把「录入即生成」定为核心行为。

## 2. 决策

### 2.1 标签名规格化与命名空间（`server/store.mjs`）

统一入口 `normalizeTagName()`（数组版 `normalizeTagList()`）在**写入实体前**把标签名规格化为规范形式：

| 输入 | 规范名 | namespace |
|---|---|---|
| `@gym` | `@gym` | `context` |
| `role:acm` / `topic:算法` / `context:office` | 原样 | 对应前缀 |
| 裸名 `线性代数` | `topic:线性代数` | `topic` |
| 未知前缀 `foo:bar` | `topic:foo:bar` | `topic` |
| 空白 / 空串 | 丢弃 | — |

规则：合法命名空间仅 `role` / `context` / `topic`（与 `docs/04`、`src/types.ts` 一致）；其余一律归入 `topic`（默认领域轴）。规格化保证**实体上的标签名与注册表 / 筛选条同名匹配**，杜绝「写了标签却筛不出来」。

### 2.2 录入即生成：自动登记（`ensureTags`）

在**任意携带 `tags` 的写入**之后（任务创建 / 更新、澄清 `details.tags`、项目创建 / 更新、笔记创建 / 更新、资料更新），调用 `ensureTags(names, { origin, firstUsedIn })`：

- 登记注册表缺失的名字到 `data/meta/tags.json`；
- 追加字段 `origin: 'seed' | 'manual' | 'ai'` + `createdAt` + 可选 `firstUsedIn`（首次随哪个实体登记）；
- 走单写者串行队列 + `write-file-atomic` 原子写；每个新标签审计 `tag.create`（`{ name, origin }`）；
- **向后兼容**：既有 26 条种子记录无这些字段也能正常读取，UI 将缺省 `origin` 视作 `seed`。

来源判定：请求带 `ai:true`（收件箱澄清的 `body.ai`、`POST /api/tasks` 的 `ai` 字段）→ `origin:'ai'`；其余 → `'manual'`。种子脚本同步补 `origin:'seed'` + `createdAt`，使未来重跑 seed 的注册表与运行时同形。

### 2.3 AI 在录入时生成标签（`server/ai.mjs`）

放开两处系统提示（收件箱解析 `buildSystem`、任务补全 `buildTaskDraftSystem`）：标签**优先取注册表已有名**；仅在确无合适已有标签、且是稳定主题词（学科 / 领域）时，才提议 `topic:名称`（≤12 字），禁止日期 / 人名 / 整句话；最多 3 个、去重。

`postValidate` 由「过滤掉注册表外标签」改为「清洗保留」：

- 已有注册名原样保留（不受长度上限约束，避免误伤 `role:competition-head`）；
- 新提议经规格化后保留，超 12 字后缀则丢弃，总数 ≤3、去重；
- **臆造 `projectId` / `areaId` / `duplicateOf` 的过滤规则不变**（本决策只松开标签）。

AI 建议的标签在**应用 / 创建落盘时**才登记（`origin:'ai'`，`firstUsedIn=实体 id`）——AI 仍然「只建议、不落盘」（ADR-0005）。配套修复：收件箱 `toClarifyDetails` 此前**从未把 `tags` 传给 clarify**，导致 AI 标签显示却不生效；现已补上。

### 2.4 管理面板与端点

设置页新增「标签管理」区（`src/components/TagManager.tsx`）：列出注册表全部标签（label / name / namespace / 来源徽标 / 使用计数 / 登记时间），支持搜索，以及：

- **重命名**（`POST /api/tags/:id/update`）：改 `name`（+ 可选 `label`），**级联重写全部实体 tags 数组**；审计 `tag.rename`（`{from,to,affected}`）。同名冲突 → 409（提示改用合并）。
- **合并**（`POST /api/tags/:id/merge` `{targetId}`）：source 名在全部实体上替换为 target 名（去重），source 从注册表移除；审计 `tag.merge`。
- **删除**（`POST /api/tags/:id/remove`）：`usage>0` → **409 阻止**（不静默剥离实体标签，提示先合并或脱离）；`usage===0` → 移除注册项；审计 `tag.remove`。
- **扫描登记**（`POST /api/tags/backfill`）：扫描全部实体上出现但未注册的名字并登记（`origin:'manual'`，`firstUsedIn` 取首个使用实体）；审计逐条 `tag.create` + 一条 `tag.backfill`。

`usage` 统计口径 = 在 `tasks / projects / notes / resources / events` 上出现的实体数（`events` 只读，但同样参与级联与计数）。

### 2.5 筛选条修正（`src/views/Library.tsx`）

资料库标签条去掉 `.slice(0, 12)`，改为**按使用计数降序**渲染全部 `topic` 标签（筛选条已自然换行），并订阅数据版本 `revision`，使新登记 / 改名 / 合并后即时刷新。

## 3. 关键取舍

- **级联不 bump `updatedAt`**：重命名 / 合并只替换 `tags` 数组，**不修改实体更新时间**。否则一次改名会把全部相关项目「刷新」，污染停滞项目判定与回顾「最近活动」口径。
- **不做事务**：文件式 JSON 无跨文件事务。级联先改实体、后写注册表；若中途崩溃，实体带未注册名可由 `backfill` 收敛。登记失败（磁盘）也不阻断实体写入，同样由 `backfill` 兜底。
- **命名空间默认 `topic`**：裸名一律 `topic:` 前缀，避免猜测错误地把用户输入塞进 `role` / `context`。
- **删除阻止而非自动剥离**：遵守「每个存量都有排泄口」但不静默丢数据（与 ADR-0009 的回收站软删除同姿态）。

## 4. 与既有决策的一致性

- **ADR-0002**：标签仍是交叉筛选器，本决策只补生命周期，不改信息架构。
- **ADR-0004**：注册表写入同样走单写者 + 原子写 + 审计。
- **ADR-0005 / ADR-0011**：AI 只提议标签，登记发生在用户应用 / 创建之时。
- **ADR-0009**：删除策略对齐「不静默丢数据」。

## 5. 非目标 / 延后

- 不做标签层级 / 父子 / 别名（合并已覆盖同义收敛）。
- 不做标签颜色 / 图标（视觉仍 quiet token-only）。
- `events` 无服务端写端点，故不纳入「录入即生成」的写入路径，仅在管理级联 / 计数中包含。
- 不做批量标签操作（多选合并 / 批量删除）。

## 6. 验证

- 构建 `npm run build`（tsc strict + vite）通过。
- 服务端冒烟 `.qa/v31/smoke-t.mjs` **54/54**：创建任务带合成新标签 → 注册（origin / firstUsedIn / namespace / createdAt / 审计 `tag.create`）→ 重命名级联 → 合并级联去重 → 删除使用中 409 → 回收站中移除 → 恢复得未注册标签 → `backfill` 登记（审计 `tag.backfill`）→ 脱离后删除放行 → 零残留 + 所有者 t-0001 未动。
- 护栏单测 `.qa/v31/guard-unit.mjs` **14/14**：`postValidate` 保留 / 规格化新标签、丢弃超长与臆造 id。
- 浏览器 E2E `.qa/v31/slice-t-verify.py` **41/41**：设置页标签管理区可见、录入即生成即时可见（手动徽标）、UI 重命名 / 合并 / 删除阻止与放行、扫描登记反馈、资料库标签条不截断且含合成标签、移动 390 无横溢、控制台零 error、零残留。
- 证据：`.qa/v31/`。
