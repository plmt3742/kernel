# ADR 0007 · AI 周回顾（Slice C）

- 状态：已接受
- 日期：2026-10-02
- 决策者：项目所有者（「AI 读整个系统 → 生成周回顾草稿 → 用户编辑确认 → 落盘」指令）+ 实证（`.qa/v14/smoke-review.mjs`、`.qa/v14/slice-c-verify.py`）
- 关联：ADR-0005 / ADR-0006、`docs/02-ARCHITECTURE.md` §4、`docs/04-DATA-MODEL.md` §4.10、`CHANGELOG.md`、`TASK_BOOK.md`、`.qa/v14/`

---

## 1. 背景

ADR-0005/0006 已把「opencode 即大脑」落在收件箱解析（分类 + 挂接建议 + SSE 过程可视）。所有者将 AI 作用域扩展为**读整个系统生成周回顾草稿**：计算本周指标、总结推进与问题、给出动作导向决策、对停滞项目给出处置建议；用户在回顾页编辑后确认，才写入一条 `review` 记录。

回顾页此前为**原型态视觉演示**（五步流程仅 UI、指标取自种子 review），本切片把它变为真实读写闭环。

## 2. 决策

1. **写入路径**：新增 `POST /api/reviews`（服务端 `nextId('reviews')` 计算 id / `type:'weekly'` / `periodKey`（ISO 周）/ `date` / `metrics` / `staleProjectIds`，用户只提供 `summary` 与 `decisions`）；`POST /api/reviews/:id/remove` 删除（撤销）。均走既有 `commit()` / `remove()`（Zod + 原子写 + 审计 `review.create` / `review.remove`）。
2. **AI 草稿端点**：`POST /api/ai/review/draft`——读快照，注入紧凑中文摘要（本周指标 / 本周完成 / 逾期 / 停滞项目 / 习惯近 7 天命中 / 本周活动计数），指令式 JSON + Zod（`reviewDraftSchema`）+ 单次重试，`variant:'low'`，120s 超时；health 预检 503、失败 502。返回 `{ periodKey, metrics, summary, decisions, staleAdvice, model, ms }`。
3. **指标口径**（服务端计算，`computeWeekMetrics`）：本周 = 本机时区周一 00:00 → now；`captured` = 收件箱 `capturedAt` 入区间；`created` = 任务 `createdAt` 入区间；`completed` = 任务 `doneAt` 入区间；`overdue` = `dueAt < now` 且 status ∈ `next/waiting/scheduled`。**`migrated` 刻意不产出**：无编辑追踪来源，等编辑追踪落地后补（见原因）。
4. **停滞项目语义**：服务端 `staleProjects` 与前端 `getStaleProjects` **严格一致**（active 且 `updatedAt` 距 now ≥14 个日历日）；草稿 `staleAdvice` 按实际停滞集合二次过滤（丢弃臆造 id）。
5. **草稿即草稿**：AI 输出不落盘；用户点击「保存回顾」才经 `/api/reviews` 落盘；toast 提供 5s「撤销」（调用 remove）。页内停滞项目的迁移 / 归档按钮**保持不变**（仍为原型态，不在本切片范围）。
6. **前端**：回顾页显示「最新」周 / 月回顾（按 `date` 倒序，非目录第一条）；周期文案由 `isoWeekKey` / `monthLabel` 运行时计算；抽屉保留五步清单为安静指引，新增 AI 草稿流（idle / loading / draft / error / saving）。

## 3. 理由

- **单写者不破**：AI 只出草稿，落盘仍唯一经数据服务 `commit()`；与 ADR-0005「只建议、可撤销」一脉相承。
- **指标是派生值**：由快照运行时计算，禁止落库（宪法数据纪律）；`computeWeekMetrics` 同时供草稿与写入复用，保证「所见即所存」。
- **口径一致**：`staleProjects` 镜像前端语义，避免「页面显示停滞、草稿不提及」的分裂。
- **`migrated` 诚实缺省**：系统当前没有「任务改期 / 迁移」的审计来源，伪造迁移数违背「不夸大」原则；故该字段可缺省（`ReviewMetrics.migrated?`），UI 显示 '—'，等编辑追踪落地再补。
- **确认才写**：与「敏感操作显式确认」一致；撤销即删除，闭环可逆。

## 4. 后果

- `reviewSchema` / `SCHEMAS.reviews` / `ID_PATTERNS.reviews` 落地；`store.nextId` 增 `reviews:'rev'`。
- `docs/04 §4.10` 标注 `metrics.migrated` 可缺省；`docs/05` / `docs/README` 收录本 ADR。
- 回顾页从纯原型演示升级为真实读写；AI 草稿实测约 4–10s（本机 deepseek-flash，`variant:'low'`）。
- 证据：`.qa/v14/smoke-review.mjs`（草稿形状 + 写入 / 删除往返 + 审计）与 `.qa/v14/slice-c-verify.py`（浏览器端到端，零残留）。

## 5. 非目标

- 月回顾生成（本切片只写 `type:'weekly'`；`reviewSchema` 已预留 `monthly`）。
- 编辑追踪 / 真实 `migrated` 统计 —— 后续增量。
- 页内停滞项目的真实迁移 / 归档落盘 —— 仍为原型态按钮，另行切片。
- 周回顾 SSE 过程流（本切片为同步草稿；`parse-stream` 复用留给后续）。
- 任何无确认自动落盘。

---

## 6. 修订（2026-10-03 · Slice F：月回顾扩展 + 回顾页重构）

**触发**：owner 指令「月回顾 AI 支持」+ 回顾页重构（周 / 月回顾卡并列一栏置于能量分析之上、点 AI 解析出报告、点开动画弹窗查阅、停滞项目独立一栏）。

1. **月指标（§2.3 扩展）**：`server/ai.mjs` 新增 `computeMonthMetrics`——窗口为**本机时区 1 日 00:00 → now**；`captured` / `created` / `completed` / `overdue` 的判定口径与 `computeWeekMetrics` **完全一致**，仅替换窗口起点（月首 vs 周首）。`migrated` 同样刻意不产出。
2. **月键**：新增 `monthKey(date)` = `YYYY-MM`（本地时区），与前端 `src/lib/date.ts` `toMonthKey` 同口径；周键 `isoWeekKey` 不变。
3. **草稿端点参数化（§2.2 扩展）**：`POST /api/ai/review/draft` 接受 `{ period:'weekly'|'monthly' }`（非法值 400；缺省 weekly，周行为完全不变）；`generateReviewDraft(period)` 按周期选择窗口 / 指标 / `periodKey` / 摘要文案（`buildReviewDigest` / `buildReviewSystem` 参数化 `scope`）。单次重试、Zod、按实际停滞集合过滤臆造 id 的安全模式全部沿用。
4. **写入路径参数化（§2.1 扩展）**：`POST /api/reviews` 接受 `{ type:'monthly' }` → `type:'monthly'` + `periodKey:'YYYY-MM'` + 月指标；缺省仍为 `weekly` + ISO 周 + 周指标。`reviewSchema` / `reviewDraftSchema` 已支持 `monthly`，**字段无需变更**；审计仍为 `review.create` / `review.remove`。
5. **前端**：`generateReviewDraft(period)` / `saveReview(summary, decisions, type)`；回顾页周 / 月各一张卡、各一弹窗，均支持草稿编辑 → 保存 → 撤销删除；已保存回顾只读查阅。新增 `src/components/Modal.tsx`（居中动画弹窗；`trapTab` 焦点圈闭 + 关闭还原；ESC / 遮罩关闭；`role=dialog` / `aria-modal` / `aria-labelledby`；reduced-motion 降级）。

**与 §5 非目标的差异**：§5 曾列「月回顾生成」为非目标；本修订将其纳入（周 / 月共用同一安全链路），其余非目标（编辑追踪 / 真实 `migrated`、SSE 过程流、自动落盘）不变。

**证据**：`.qa/v22/smoke-f.mjs`（13/13，含 monthly 201 / `periodKey 2026-10` / 删除 / 零残留）、`.qa/v22/monthly-draft.json`（真实月度草稿 200）、`.qa/v22/slice-f-verify.py`（E2E 30/30）、`.qa/v22/slice-f-mobile.py`（移动 6/6）。
