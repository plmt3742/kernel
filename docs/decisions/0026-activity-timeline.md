# ADR-0026 · 回顾 · 动作记录：审计自描述 + 活动时间线（Slice S）

- 状态：已采纳
- 日期：2026-10-03
- 相关：ADR-0004（数据服务 · 审计日志）、ADR-0007（AI 周回顾）、ADR-0013（回顾报告升级）、ADR-0022（界面状态保留）

---

## 1. 背景与反馈

所有者：「回顾页面需要详细地记录我每一次动作——完成了什么任务、添加了什么任务，或者单独只查看我做过什么事。」

既有回顾页只有**聚合指标**（完成 / 新增计数）与 **AI 报告**，没有**逐条动作史**。而数据服务自 v0.4 起就写有 `data/activity.jsonl` 全量审计（每次写入一条），但条目偏机械（如 `task.update {fields}`），缺少「标题 / 新状态」等可读要素，不足以直接渲染为人话。

## 2. 决策

### 2.1 审计自描述（服务端 · 写入侧增补）

在既有审计形状上做**追加键**（不覆盖、不重构，任何既有断言 / 消费方不受影响）：

| 位置 | 增补 | 说明 |
|---|---|---|
| `store.commit()` | `detail.title` | 记录含非空 `title` 时自动并入（inbox / reviews 等无 title 记录不变） |
| `store.moveToTrash()` / `restoreFromTrash()` | `detail.title` | 记录已读出，直接并入；`purgeTrash` 无记录可读，保持仅 id |
| `index.updateEntity()` | `detail.status` | 仅当 `fields` 含 `status` 时并入新值原值（中文映射留给前端） |

由此，「完成了什么任务」= `task.update` + `detail.status==='done'` + `detail.title`；「添加了什么任务」= `task.create` + `detail.title`——时间线可自描述。

### 2.2 活动时间线（前端 · 回顾页只读展示）

- 新 `src/lib/activity.ts`（纯函数）：`describeActivity` 把审计条目翻译为「分桶 + 中文文案」（**完成 / 新增 / 打卡 / 其他** 四桶；覆盖全部现有动作，未知动作安静回退 `action · id`，不臆造语义）；`filterByBucket` / `groupByDay`（今天 / 昨天 / M月D日，ISO 日为组键防跨年合并）。
- 新 `ActivityTimeline` 组件挂在回顾页：Panel「动作记录」+ 过滤 chips（全部 / 完成 / 新增 / 打卡 / 其他，经 `kernel.ui.review.v1` 持久化，非法值回退 `all`）+ 日分组 + `HH:mm` + 实体「查看」深链（`deepLinkOfId`）+ 内部滚动（`min(60vh, 560px)`）+ 空态。
- 数据源：既有 `GET /api/activity?limit=200`（**不新增端点、不新增写入面**）；`useDataRevision` 驱动随写刷新。

### 2.3 完成语义

`task.update` 且 `detail.status === 'done'` 判定为「完成」；其余状态变更显示「调整任务「x」→ 中文状态」（next/waiting/scheduled/someday/dropped）。

## 3. 备选与取舍

| 备选 | 取舍 | 理由 |
|---|---|---|
| 从当前实体状态推导历史 | **否决** | 只见幸存实体、无编辑 / 删除史；审计日志才是全量事实源 |
| 新建「动作历史」存储 | **否决** | `activity.jsonl` 已是全量审计；重复存储违反单一事实源 |
| 后端渲染中文文案 | **否决** | 展示语义属前端；审计保持数据态（可被多端 / 后续消费复用） |
| 提升 `/api/activity` 上限 / 分页 | **延后** | 200 条覆盖当前需要；分页需要时再加 |

## 4. 边界

- 时间线**只读**；审计不可变，不提供删除 / 编辑。
- 仅覆盖**数据写入**动作；浏览器 localStorage 界面态（如 AI 对话）不经审计。
- 分页 / 搜索 / 导出 / 「仅看手动（排除 AI 自动）」开关：延后。

## 5. 影响面（文件）

- 服务端：`server/store.mjs`（`commit` / `moveToTrash` / `restoreFromTrash` 审计并入 `title`）、`server/index.mjs`（`updateEntity` 并入 `status`）。
- 前端：`src/lib/activity.ts`（新）、`src/components/ActivityTimeline.tsx`（新）、`src/views/Review.tsx`、`src/styles/views.css`（`.k-act*`，token-only）。
- 无新增依赖；无新增端点。

## 6. 验证与证据

- 服务端冒烟 **32/32**（`.qa/v47/server-smoke.mjs`）：create / update(done) / trash / restore / checkin 的审计 detail 原文断言（title 与 status 均正确）；零残留。
- 浏览器 E2E **27/27**（`.qa/v47/verify-s.py`）：时间线三类动作可见 + 「今天」组头；过滤器四档分桶正确（「新增」下完成行隐藏、新增行保留）；深链跳转 `?task=`；390 零横溢；控制台 0 error。
- 零数据残留（162 文件字节哈希一致；owner 四文件字节不变）。
