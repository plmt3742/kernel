# TASK_BOOK

KERNEL 的任务台账与迭代记录。记录当前迭代目标、未来待办（backlog）与已完成工作。

约定：每次改代码后在本文件追加记录；当前迭代完成后移入已完成日志。

---

## 下一会话待办（Handoff · 2026-10-03 修订）

> **新会话处理入口**：先读 `AGENTS.md` → 本清单 → 按序处理。每项均附上下文与落点。
> 状态：v0.4.0 已交付（数据服务 + 前端写入改造 + 审阅 P0 六项 + 路由滚动记忆）；页面排版选型已落地 10/10；**v0.5 首个切片（收件箱「AI 解析」）已交付**；**互联 Slice A（深链 + 关联区块）、AI 澄清升级 Slice B（上下文注入 + 挂接建议 + SSE 过程可视）与 AI 周回顾 Slice C（草稿 → 编辑 → 确认落盘 / 撤销）已交付**（验收：A 20/20、B E2E 13/13、C 冒烟 PASS + E2E 13/13，证据 `.qa/v14/`）；**使用指南 HTML（`public/guide.html`，自包含单文件，三态 25/25，证据 `.qa/v15/`）已交付**；**收件箱升级 Slice D（文件投递 + 居中编辑器 + AI 先读）已交付**（冒烟 PASS + E2E 12/12，证据 `.qa/v16/`）；**收件箱修复包 Slice E1（编辑器回位 + 「批量 → 任务」反馈加固 + AI 结果缓存 + 批量 AI 解析）已交付**（E2E 24/24，证据 `.qa/v17/`）；**详情操作 + 回收站 Slice E2（通用编辑 / 软删除回收站 / 资源文件位置 + reveal）已交付**（冒烟 34/34 + E2E 19/19 + 全站 smoke PASS，证据 `.qa/v18/`）；**动效与布局稳定 Slice E2.6（批量解析过程可视 + 流式节流 + 定高 + 间距 + 换行 + 零重叠）与趋势图数据点裁切修复 Slice E2.7 已交付**（E2E 22/22 + 像素级 8/8，证据 `.qa/v20/`、`.qa/v21/`）；**回顾页重构 Slice F（周 / 月回顾卡并列一栏 + 动画弹窗报告 + 月回顾 AI 支持 + 停滞项目独立栏）已交付**（服务端冒烟 13/13 + E2E 30/30 + 移动 6/6，证据 `.qa/v22/`）；**总览升级 Slice G（AI 对话盒 + 状态条重做 + 就地详情弹窗）已交付**（E2E **42/42** + 构建通过，零残留，证据 `.qa/v23/`）；**状态贯通 Slice H（资料状态 / 笔记蒸馏判断标准 + 快捷设置 + 白名单扩充 + 任务快速新建 AI 补全）已交付**（服务端冒烟 21/21 + E2E 28/28 + 构建通过，零残留，证据 `.qa/v24/`）；**使用指南同步 Slice I（`public/guide.html` 对齐 Slice D–H，三态 65/65，证据 `.qa/v25/`）已完成**；**收件箱修复包 2 Slice J（批量 AI 解析状态跨路由存活 + OOXML `.docx/.pptx/.xlsx` 文本抽取）已完成**（服务端冒烟 14/14 + E2E 16/16 + 零写入，证据 `.qa/v26/`）；**收件箱附件「打开文件 / 位置」Slice J2（去掉浏览器下载，改默认程序打开 / 文件管理器定位；新增 `/api/open` + `/api/inbox/:id/(open|reveal)` 带 `dryRun` 测试通道）已完成**（服务端冒烟 33/33 + E2E 21/21 + 零写入，证据 `.qa/v27/`）；数据服务运行于 `127.0.0.1:4097`；**全部切片（D–J2）已交付、验证（J2 待批次提交）**。

### A. 验收（所有者）

- [x] **浏览器验收**（2026-10-02 修复轮已由 AI 全量复核：8 视图 × 1280/1920/390 + 折叠/滚动/抽屉/命令面板）。
- [ ] **手机验收**：同一 WiFi 下访问 `http://192.168.0.10:5173`，确认移动端布局（底部标签栏 / 单列 / 全宽抽屉）与操作可用（v0.4：手机写入经代理到数据服务，可测一条捕捉/完成）。
- [ ] **修复复核**：打开总览左上角确认品牌锁排完整（"KERNEL" 不再裁切）、顶栏接缝齐平；任务页筛选与分组同一行；日历滚到「现在」后日期条仍可见。
- [ ] **滚动记忆复核**：任务页滚到中部 → 切到总览 → 切回任务，确认停留在上次位置；各页面互不影响。
- [x] **设计稿选型**：10/10 完结——总览「工作台」已于 2026-10-02 落地（见「总览排版落地」节）。

### B. 下一步（按优先级）

- [x] **v0.4.0 数据服务**（2026-10-02 完成）：见下方「v0.4 数据服务」章节。
- [x] **总览落地「工作台」（选型 10/10 完结，2026-10-02）**：三轮 C 获采纳并落地（左工作区 + 右粘性监视柱 + 项目推进，详见下方「总览排版落地」节）。过程记录：第二轮三版（监控台 / 驾驶舱 / 信号层）均未采纳 → **第三轮交付**（今日线 TODAY LINE / 状态带 STATUS STRIP / 工作台 WORKBENCH；组织原则与前两轮全面错开，**监测图表去主导化**；二轮稿归档 `_archive/overview-*-v2.html`）；「连续刷题」打卡带 AI 感反馈已随 C 稿一并落地。其余 9 项已于 2026-10-02 全部落地并回归验证。
- [ ] **v0.5.0 opencode AI 接入**：原始核心诉求（丢文件 / 通知 → AI 解析 → 联动日程建议）。直连方案已调研完毕（`opencode serve` + `@opencode-ai/sdk` + SSE + `format: json_schema`），落点见 `docs/02-ARCHITECTURE.md` §4 与 Backlog「v0.5 opencode AI 集成」。
- [ ] **P1 体验项 · 剩余**：日历翻周 + `Task.deferUntil` 启用 / 回顾步骤持久化 + 资料搜索 / a11y 三处（路由移焦到 h1、命令按钮 aria 句柄、`focus.ts` `offsetParent` 误判）。

### C. 小尾巴（可选，低优先）

- [ ] 种子数据以 2026-10-02 为"现在"；时间久了用 `npm run seed -- --force` 重置演示数据。
- [ ] `design-drafts/`（三份设计稿 + 选型页）保留作方向参考；`.qa/` 证据归档保留（体积小）。

---

## 收件箱附件「打开文件 / 位置」· Slice J2（已完成 · 2026-10-03）

以 owner 反馈为规格：收件箱点附件「查看文件」得到浏览器下载，而不是用本地默认程序打开文件 / 定位到文件管理器（「点击查看文件是直接给我下载而不是打开文件夹对应位置或者打开本地文件给到我」）。`npm run build`（tsc strict + vite）通过；服务端冒烟 **33/33** + 浏览器 E2E **21/21**；零数据写入（前后快照计数一致、trash 0、i-0009/i-0010/i-0011 未变、`data/files/` 无增删）；控制台零应用 error；证据 `.qa/v27/`。

- [x] 根因确认：`Inbox.tsx` 附件行是 `<a href="/api/files/:id" target="_blank">查看文件</a>`；`serveFile` 的 `Content-Disposition: inline` 对 `.docx` 等不可内联类型无效，浏览器一律下载。
- [x] 服务端：抽 `spawnDetached` / `statLocalPath` 共用助手，`/api/reveal` 复用；新增 `POST /api/open`（`cmd /c start "" "<path>"` → 默认程序）与 `POST /api/inbox/:id/open|reveal`（服务端解析 `data/files/<id>-<name>`，三重校验，404 可读）；`/api/inbox/:id/(open|reveal)` 与 `/api/open` 均支持 `{dryRun:true}`——仅解析校验、绝不 spawn（测试专用）。
- [x] 前端：附件行改「打开文件」+「位置」两个 `.k-pill.is-ghost`（`FileText` / `FolderOpen`），失败 toast；`mutations.ts` 新增 `openInboxFile` / `revealInboxFile` / `openPath`；移除 `.ic-file-link` 死样式。
- [x] 资源对齐：`Library.tsx` 资料抽屉「文件位置」补「打开文件」（`/api/open`）。当前无带 `path` 的资源，按钮未被 E2E 触达（不为此写 owner 数据）。
- [x] 验证：`.qa/v27/smoke-j2.mjs` 33/33（含 `/api/open` dryRun 200 + 缺失/空路径失败分支 404/400）；`.qa/v27/slice-j2-verify.py` 21/21（Playwright 拦截 open/reveal/api/open，绝不真正 spawn；成功 / 失败 toast；移动 390 零横溢；零写入）。
- [x] 记录：ADR-0008 §4 修订；`docs/04 §4.1`；`CHANGELOG.md`；`AGENTS.md`。
- **已知边界 / 延后**：`GET /api/files/:id` 保留但 UI 不再引用（未来如需浏览器内预览可复用）；Windows 专属（`explorer.exe` / `cmd start`），非 Windows 平台未适配（本项目仅本地 Windows）；`/api/open` 与 `/api/reveal` 仅本机可达（服务绑定 `127.0.0.1`），不新增暴露面。

---

## 收件箱修复包 2 · Slice J（已完成 · 2026-10-03）

以 owner 两条反馈为规格：① 批量 AI 解析后切页再回来「一切回到原始状态」；② 上传 `.docx` 后「连文件都阅读不来」（AI 只说无法读取 / 仅凭文件名判断）。`npm run build`（tsc strict + vite）通过；服务端冒烟 **14/14** + 浏览器 E2E **16/16**；零数据写入（前后快照计数一致、trash 0、i-0009/i-0010 JSON 完全未变）；控制台零 error；证据 `.qa/v26/`。

- [x] 根因确认（Bug 1）：`batchAi` 进度与面板为 `Inbox.tsx` 组件级 `useState`，卸载即丢；建议缓存虽为模块 Map 存活，但列表对缓存条目**无任何标记**，需手动再点「解析」才出卡 → 观感「没解析过」；且无模块级运行守卫（可重复启动）。
- [x] 根因确认（Bug 2）：`server/ai.mjs buildFileSection` 仅对 `TEXT_EXTS` / `text/*` 摘录；`.docx` 是 ZIP 二进制 → 走元数据回退（`FILE_UNREADABLE_HINT`）。
- [x] Bug 1 修复：新 `src/lib/inboxAi.ts`（模块级 store + `useSyncExternalStore`），批量任务 / 流式 ~100ms 节流 / 建议缓存 / 完成播报全部跨路由存活；`Inbox.tsx` 改为只读快照 + 派发展开 / 滚动 / 播报。切页期间批量继续；返回见真实进度 + 活跃项「解析中」+ 完成项「AI 建议就绪」标记；批量动作据 `running` 禁用（切页回来重选仍禁用）；完成播报一次；缓存命中点击「AI 解析」不重解析（强制走「重新解析」）。
- [x] Bug 2 修复：`server/ai.mjs` 无依赖最小 ZIP 读取器 + OOXML 抽取（`.docx` 必做，`.pptx` / `.xlsx` 同机制附带）；失败维持既有回退 + 5MB 上限；同步 / 流式共用。
- [x] 验证：`.qa/v26/smoke-j.mjs` 14/14（合成 docx method 8/0 + 探针命中 + 实体解码 + `buildFileSection` 摘录 + 伪 docx 回退 + 零残留）；`.qa/v26/slice-j-verify.py` 16/16（选 2 条 → 批量 → SPA 切 /tasks → 回 /inbox：状态未重置、运行中批量全禁用、返回后重选仍禁用、两条目均出标记、展开缓存 3ms、控制台 0、移动 390 零横溢、零写入、i-0009/i-0010 未变）；所有者真实 docx 只读抽取 1118 字。
- [x] 记录：ADR-0008 §4 修订（批量状态持久化 + OOXML）；`docs/05`（`inboxAi.ts`）；`CHANGELOG.md`；`AGENTS.md`。
- **已知边界 / 延后**：`.pptx` / `.xlsx` 抽取仅轻量覆盖（xlsx 仅共享字符串表、pptx 按 slide 序号拼接 text），未做表格结构 / 单元格定位；PDF 仍仅元数据（非目标）；F5 刷新丢失模块级状态（可接受，reload 后标记清零属预期）；单条解析在批量运行中与批次的交互按「批量优先」处理（运行中单条入口禁用）。

---

## 状态贯通 + 全站同类审计 + 任务快速新建 AI 判断 · Slice H（已完成 · 2026-10-03）

以 owner 三条指令为规格：① 资料页「状态」无判断标准 / 无设置按钮——解决后**全面检查同类问题**；② 笔记蒸馏层级可设；③ 任务快速新建需 AI 判断（否则「没有详细内容」）。`npm run build`（tsc strict + vite）通过；服务端冒烟 **21/21** + 浏览器 E2E **28/28**；零数据残留（回到基线：收件箱 9 / 任务 60 / 项目 10 / 笔记 14 / 资料 12 / 回顾 2 / 回收站 0）；控制台零 error；证据 `.qa/v24/`。

- [x] 判断标准：`format.ts` `RESOURCE_STATUS_DEF`（未读 / 在读 / 读完 / 参考 / 归档）与 `DISTILL_LEVEL_LABEL/DEF`（L0 原文 / L1 划线 / L2 摘要 / L3 永久）；抽屉内安静 helper 文本 + 每项 `title`；文案与 `docs/04 §4.8 / §4.9` 一致。
- [x] 快捷设置：`Library.tsx` 本地 `QuickSegmented`（复用 `.k-lib__seg` / `TagPill`，token only）——资料状态、笔记蒸馏；经既有 `POST /api/<kind>/:id/update` 写入 + toast 撤销。
- [x] 白名单扩充：`notes` +`areaId/projectId/distillLevel`、`resources` +`areaId`、`projects` +`goalId/nextActionId`；对应编辑表单补下拉。
- [x] 任务快速新建 AI：`POST /api/ai/task/draft`（`draftTask` + `taskDraftSchema` + 快照后校验 + 单次重试 + 120s；不落盘）；前端创建即时完成、建议随后安静到达（可应用 / 忽略 / 重试，失败不阻断）；应用经 `POST /api/tasks/:id/update`（审计 `task.update`）。实测真实 AI 7.0s 返回含 `@lab / energy / estimateMin / dueAt / areaId / tags` 的建议。
- [x] 验证：`.qa/v24/smoke-h.mjs` 21/21（真实草稿形状 + 空标题 400 + 三实体新增字段往返 + 审计 + 零残留）；`.qa/v24/slice-h-verify.py` 28/28（资料 / 笔记快捷设置持久化与还原、三处编辑表单字段存在性、快速新建 AI 应用 + 忽略、移动 390、控制台 0、零残留）。
- [x] 记录：ADR-0011；`docs/02 §3.2 / §4.3`；`docs/04 §4.8 / §4.9 / §9`；`docs/README`；`CHANGELOG.md`；`AGENTS.md`。

### Slice H · 全站同类审计结论表

扫描全部视图与详情抽屉，判定「已展示但不可操作 / 无判断标准」。原则：只修语义清晰且回归安全的小口子；结构性缺口显式延后。

| # | 项（字段 / 状态） | 决策 | 理由 |
|---|---|---|---|
| 1 | 资料 `status`（未读 / 在读 / 读完 / 参考 / 归档） | **fixed** | 原 owner 反馈：可写但埋于编辑表单、无判断标准 → 抽屉内快捷设置 + helper 标准（terms 入 `format.ts` / `docs/04`） |
| 2 | 笔记 `distillLevel`（L0–L3） | **fixed** | 列表 / 详情展示但不可设 → 白名单 + 快捷设置 + 标准 |
| 3 | 笔记 `areaId` / `projectId` | **fixed** | 经「关联」区块展示但不可设 → 白名单 + 编辑下拉（可清除） |
| 4 | 资料 `areaId` | **fixed** | 行内展示区域但不可设 → 白名单 + 编辑下拉 |
| 5 | 项目 `nextActionId` | **fixed** | 行 / 详情 / 关联展示但不可设 → 白名单 + 编辑下拉（选未完成任务） |
| 6 | 项目 `goalId` | **fixed（仅关联）** | 关联区块静态展示 → 白名单 + 编辑下拉（选已有目标）；目标的创建 / 管理仍延后 |
| 7 | 任务快速新建（仅标题） | **fixed** | owner 反馈「没有详细内容」→ 新端点 `POST /api/ai/task/draft` + 内联建议（不自动应用） |
| 8 | 事件（event）全实体 | **deferred** | `status / allDay / location / area / project / tags / title / startAt / endAt` 均只读；不在 `SCHEMAS / EDITABLE_KINDS / ID_PATTERNS`，无创建 / 编辑 / 取消端点——需新增可写实体（结构变更，日历 P0） |
| 9 | 区域（area）管理 | **deferred** | 仅标题作静态芯片 / 筛选项展示；`cadence / status / standard` 未展示；无视图与可写路径 |
| 10 | 目标（goal）管理 | **deferred** | `goal.title` 仅经项目关系芯片展示；`keyResults / status` 未展示；无视图与可写路径 |
| 11 | 习惯（habit）打卡 | **deferred** | 总览「连续刷题」点阵展示但无打卡入口；习惯无写入路径 |
| 12 | 笔记 `links`（互链 / 反向链接） | **deferred** | 需实体选择器（自由文本 id 不安全） |
| 13 | 任务 `parentTaskId`（父子） | **deferred** | 需层级 / 环检测语义与选择器（避免 A↔B 环） |
| 14 | 已保存回顾 `summary / decisions` 编辑 | **deferred** | `reviews` 不在 `EDITABLE_KINDS`；属 Slice F 范围，需设计编辑入口 |
| 15 | `review.metrics.migrated` 恒显示 `—` | **deferred** | 服务端刻意不产出（无编辑追踪来源，ADR-0007）；需实现编辑追踪或移除指标 |
| 16 | 回顾「迁移」按钮 | **deferred** | 实为 `touch`（只 bump `updatedAt`，不改 due / status）；语义需产品决策（改名 or 真实改期） |
| 17 | 收件箱内容编辑 / 删除入口 | **deferred** | 服务端有 `POST /api/inbox/:id/remove` 但无 UI 调用；内容不可改——需交互设计 |
| 18 | 标签注册表管理 | **deferred** | 标签仍自由文本输入，可产生无定义标签（回退原名）；需管理界面 |
| 19 | 任务 `deferUntil`（反向缺口：可设但不展示） | **deferred** | 可在编辑表单设置但 `TaskDetail` 不展示；低优先，非 owner 本轮诉求 |
| 20 | **笔记沉浸式阅读与撰写体验**（owner 15:58 诉求） | **deferred（backlog）** | 明确不在本切片范围，记录为延后 backlog |

---

## 使用指南同步 · Slice I（已完成 · 2026-10-03）

把自包含中文使用指南 `public/guide.html` 从上一版本同步到 Slice D–H 现状。仍是单文件、内联 CSS/JS、零外部请求；`file://` 双击与 `http://localhost:5173/guide.html` 均可用；沿用既有「柔暗夜色」token。只动 `public/guide.html` + `.qa/v25/**` + 三份文档，未触碰 `src/**`、`server/**`、`data/**`、`design-drafts/**`，未重启服务。

- [x] 内容同步：04 页面速览八卡逐页补新交互（总览对话盒 / 收件箱文件投递 + 批量 AI + 侧挂条 / 任务快速新建建议 / 资料状态五档与判断标准 + 笔记蒸馏 / 回顾周月卡 + 弹窗报告 + 停滞项目）；05 AI 章节扩为解析 / 对话盒 / 快速新建 / 回顾报告 + 静态对话示例；02 / 03 / 06 / 07 / 08 补文件投递、批量、`/trash` 深链、清空即归档、对话盒键位；FAQ 增三条；页脚版本串 `v0.5.0（切片） · 2026-10-03`。
- [x] 演示保留：任务详情居中弹窗（`role=dialog` / ESC / 焦点还原 / 滚动锁定）原样保留。
- [x] 验证：`.qa/v25/guide-verify.py` **65/65**（dev 桌面 1600 / dev 移动 390 / `file://` 三态；新内容命中、控制台零 error、零横溢、`file://` 无外部子资源、TOC 滚动高亮 JS、演示 a11y）。证据 `.qa/v25/`（`guide-desktop.png` / `guide-mobile.png` / `guide-file.png` / `guide-demo-open.png` / `guide-verify.log`）。
- [x] 记录：`CHANGELOG.md` 使用指南同步条目；`AGENTS.md` 变更记录行。

**下一会话待办**：指南已与当前实现对齐；后续若再改动用户可见交互，记得回填 `public/guide.html` 对应章节（尤其 04 / 05）并更新页脚版本串。

---

## 总览升级 · Slice G（已完成 · 2026-10-03）

以 owner 三条指令为规格：① 状态条下方加「能对话的 AI 盒」——读库回答（例「我今天有什么特别紧急需要去做的事情」）、清空对话前按时间命名归档为可查阅文本；② 顶部三胶囊右缘参差、要换展示方式；③ 工作台条目点击就地弹详情（不跳转、不无高亮）。`npm run build`（tsc strict + vite）通过；浏览器 E2E **42/42**；零数据残留（回到基线：收件箱 9 / 任务 60 / 项目 10 / 笔记 14 / 资料 12 / 回顾 2 / 回收站 0）；控制台零 error；证据 `.qa/v23/`。

- [x] AI 对话盒：新增 `src/components/OverviewChat.tsx`（状态条之下、工作台之上；复用 `.ic-composer` 视觉；消息存在时上方展开定高可滚线程；Enter 发送 / Shift+Enter 换行；加载 / 错误 + 重试；清空禁用态）；会话级持久（模块级 store，跨路由存活）。
- [x] 对话端点：`server/ai.mjs` `buildChatDigest` / `buildChatSystem` / `chatWithKernel` + `CHAT_MAX_*`（20 条 / 4000 字 / 16000 字）；`POST /api/ai/chat`（有界裁剪、末条须为用户消息；摘要含逾期 / 今日到期 / 未来 7 天日程 / 收件箱积压 / 进行中项目 / 高优先下一步；自然语言；120s 超时 + 单次重试；503/502；不落盘）。实测真实回复约 5s。
- [x] 归档为笔记：`POST /api/notes`（通用创建；title 非空 400 + type 白名单缺省 memo + `note.create` 审计 + 201）；「清空对话」先归档（`AI 对话归档 · YYYY-MM-DD HH:mm`，body 为 `**我**`/`**KERNEL**` markdown）成功才清空 + toast「查看」跳 `/library?note=<id>`；失败不清空。`mutations.chatWithAi` / `createNote`。
- [x] 状态条重做：`.k-status` 整宽等分（`grid-auto-flow:column` + `minmax(0,1fr)`），三段左右边缘严格贴版心（实测 228.00 / 1468.00）；三段改可点按钮（→ 日历 / 收件箱 / 任务）；逾期恒显示；≤640 竖排。
- [x] 就地详情：抽出 `TaskDetail.tsx` / `ProjectDetail.tsx`（Tasks / Projects 抽屉复用同款，行为不变）；`Overview` 用 Slice F 的 `Modal.tsx` 承载任务 / 项目弹窗，URL 保持 `/`，ESC / 遮罩 / 焦点还原沿用。
- [x] 验证：E2E 42/42（几何 / 点击 / 发送→加载→真实回复 / 多轮 / 清空归档→toast 深链打开 / 任务与项目弹窗 / 移动 390 / 控制台 0 / 零残留）；`npm run build` 通过。
- [x] 记录：ADR-0010；`docs/02 §4.3`；`docs/04 §9`；`docs/05`；`docs/README`；`CHANGELOG.md`；`AGENTS.md`。

---

## 回顾页重构 · Slice F（已完成 · 2026-10-03）

以 owner 三条指令为规格：① 周 / 月回顾卡并列一栏、移到能量分析上方、点「AI 解析」出报告、点开动画弹窗查阅；② 停滞项目单独一栏；③ 月回顾与周回顾同享 AI 能力。`npm run build`（tsc strict + vite）通过；服务端冒烟 **13/13** + 浏览器 E2E **30/30** + 移动端 **6/6**；零残留（回到基线：收件箱 9 / 任务 60 / 项目 10 / 笔记 14 / 资料 12 / 回顾 2）；控制台零错误；证据 `.qa/v22/`。

- [x] 布局：`.k-review__cycles`（两卡并列，route<900 单列）置于 `.k-review__charts`（能量分析在前）之上；停滞项目独立全宽 `Panel`（空态「无停滞项目」）；指标瓦片移入各周期卡（有报告时）。
- [x] 弹窗：新增 `src/components/Modal.tsx`（居中，fade + 微缩放；ESC / 遮罩关闭；焦点圈闭 + 关闭还原；`role=dialog` / `aria-modal` / `aria-labelledby`；锁定滚动；reduced-motion 降级）。周 / 月各一弹窗，草稿态可编辑 → 保存 → 撤销 toast，已保存态只读查阅。
- [x] 每卡 AI 解析：`generateReviewDraft(kind)`；进行中 / 错误态安静呈现；不自动落盘、不自动弹窗。
- [x] 月回顾服务端：`computeMonthMetrics`（月窗口径 = 周窗口径）+ `monthKey`（YYYY-MM）+ `generateReviewDraft(period)` + `/api/ai/review/draft { period }` + `/api/reviews { type:'monthly' }`；周行为不变。
- [x] 验证：冒烟 monthly 201 / periodKey 2026-10 / 4 指标 / 非法 period 400 / 删除 / 零残留；真实月度草稿 200（4.8s）；E2E 覆盖布局几何、弹窗开合与焦点、周 AI 草稿 → 弹窗报告、月度落盘 + 撤销 + UI 查阅、停滞空态、控制台、零残留；移动 390 零横溢 + 单列 + 弹窗适配。
- [x] 记录：ADR-0007 §6；`docs/04 §4.10`；`docs/05`；`CHANGELOG.md`；`AGENTS.md`。

---

## 趋势图数据点裁切修复 · Slice E2.7（已完成 · 2026-10-03）

owner 截图反馈「这里的小圆点被遮盖了」：总览「完成趋势」sparkline 贴底数据点（值 0 → viewBox y=100）被 SVG 视口裁掉下半圆，半圆看起来像被遮盖。一行 CSS 修复 + 像素级验收 **8/8**；`npm run build`（tsc strict + vite）通过；只读零写入；证据 `.qa/v21/`。

- [x] 修复：`src/styles/components.css` `.k-line__svg` 增 `overflow: visible`——零长度路径 + 圆头端帽绘制的数据点不再被 SVG 视口裁切；下溢约 3.5px 落入与下方元素的既有间隙（不影响布局）；总览 / 回顾两处 `TrendLine` 同步生效。
- [x] 验证：总览 / 回顾双页 `overflow=visible` 断言；像素级前后对照（基线下方墨色 0px → 290px，6 个贴底点半圆 → 整圆）；控制台零错误；前后快照计数一致（只读）。
- [x] 记录：`CHANGELOG.md` / `AGENTS.md` / 本文件。

---

## 动效与布局稳定 · Slice E2.6（已完成 · 2026-10-03）

以 owner 反馈五连为指令：批量 AI 解析看不见过程 / 展开区黏连 / 资料筛选横滚 / 流式抖动 / 列表切换重叠。`npm run build`（tsc strict + vite）通过；浏览器 E2E **22/22**；零残留（回到基线：收件箱 9 / 任务 60 / 项目 10 / 笔记 14 / 资料 12 / 回收站 0 / 附件 1）；控制台零错误；证据 `.qa/v20/`。

- [x] 批量解析过程可视：批量 AI 解析复用单条流式路径 `runParse`——当前条目自动展开并显示实时过程面板（阶段 + 增量预览）；条目不在视口内时轻柔滚入（尊重 `reduced-motion` → 瞬时）；绝不自动应用。
- [x] 流式增量节流：SSE delta 先入 ref 缓冲、约 100ms 节流 flush 到 React state；过程面板阶段行单行省略、预览固定 3 行高度（最新贴底 + 顶部渐隐）——解析期间面板高度极差 0.00px、下方元素零漂移。
- [x] 展开区间距：`.ic-subrow` 顶部外边距 `--space-3`（实测 12px）——展开内容与条目行不再「黏在一块」。
- [x] 资料筛选条换行：`.k-lib__filters` 由横向滚动改自然换行——1280 / 390 均无横向溢出。
- [x] 任务列表切换：`motion.tr` 去 `layout` 与位移动画（保留透明度渐入 + stagger）——过滤切换过渡期间行不相交（`overlaps=0`）。
- [x] 验收：E2E 22/22（含批量缓存 3ms 就绪、零残留、控制台 0）。
- [x] 记录：`CHANGELOG.md` / `AGENTS.md` / 本文件。

---

## AI 挂靠判断 + 项目闭环 + 批量条侧挂 · Slice E2.5（已完成 · 2026-10-03）

以 owner 三条反馈为指令：①「辩论赛」文件被 AI 硬挂到无关项目（须宁缺毋滥 + 能判断「这是新事务」）；② 项目怎么诞生 / 归档——补「直接新建项目」入口 + 停滞项迁移 / 归档真实落盘；③ 批量工具条下滑到看不见时应「移到侧边位置」。`npm run build`（tsc strict + vite）通过；服务端冒烟 **39/39** + 浏览器 E2E **21/21**；零残留（收到基线：收件箱 9 / 任务 60 / 项目 10 / 笔记 14 / 资料 12 / 回收站 0 / 附件 1）；控制台零错误；证据 `.qa/v19/`。

- [x] AI 挂靠规则 v2：系统提示词加「明确依据才算挂靠、表面相似不算、拿不准 null」「附件不可读时更保守（除非文件名强匹配否则 null + reason 注明）」；新增 `newProjectHint`（≤40 字，与 `projectId` 互斥）；schema + `normalize` + `postValidate`（trim / 截断 / 互斥 / 标题去重）；建议卡显示「建议新项目：{X}」+「可到项目页新建」（仅提示）。
- [x] 项目新建：`POST /api/projects`（title 非空 400；active + a-0001 + outcome 待整理；审计 `project.create`；201）+ `mutations.createProject`；Projects 页快速新建（镜像任务页）→ 回车创建 → toast「已创建项目 · 撤销」（撤销进回收站）。
- [x] 回顾停滞按钮接通：`updateEntity` 空 patch = touch（bump `updatedAt` + 审计 `<singular>.touch`）；「归档」→ status archived + 撤销回 active；「迁移」→ touch + toast「已重决策：继续推进」；移除「原型态」文案；`Review` 订阅 `useDataRevision()`。
- [x] 批量条侧挂 dock：`IntersectionObserver` 观察 `.ic-batchbar`；滚出视口 → 右缘纵向居中的窄列浮动 dock（`已选 N 项` + 四个动作，与内联条同状态 / 同处理器 / 同禁用态）；`motion` 淡入滑入（reduced-motion 降级）；回视口隐藏；抽屉层级之下、≤767px 隐藏；真实可聚焦按钮。
- [x] 验收：辩论赛样例 `projectId=null` + `newProjectHint=新生辩论赛筹备`；控制样例正确挂 `p-0002`；dock 出现 / 勾选 / 取消选择 / 隐藏全通过；项目快速新建行出现；零残留 + 控制台 0。**提示词一次通过**。
- [x] 记录：`CHANGELOG.md`；ADR-0006（挂靠规则 v2 + newProjectHint）与 ADR-0009（`project.create` + touch）修订。
- [ ] 备注（限制）：当前 `data/` 无停滞项目（种子项目 updatedAt 均为近期）→ 回顾页「迁移 / 归档」的 **UI 点击路径无法覆盖**；touch / archive 语义已由服务端冒烟覆盖（`.qa/v19/smoke-e25.mjs`）。

---

## 详情操作 + 回收站 · Slice E2（已完成 · 2026-10-03）

以 owner 三条反馈为指令：详情页缺编辑 / 删除；需要一个回收站；资源详情要指明文件位置并可打开。`npm run build`（tsc strict + vite）通过；服务端冒烟 34/34 + 浏览器 E2E 19/19 + 全站回归 smoke PASS；零残留，证据 `.qa/v18/`。

- [x] 服务端编辑：`POST /api/(tasks|projects|notes|resources)/:id/update`——字段白名单（忽略其余）、保留 `id`/`createdAt`、`updatedAt` 递增、`SCHEMAS[kind]` 校验、审计 `<singular>.update` + `detail.fields`、返回 `{ record }`；`null` 视为清除。
- [x] 服务端回收站：`data/trash/<kind>/<id>.json`（原记录 + `trashedAt`）；`moveToTrash` / `restoreFromTrash` / `purgeTrash` / `readTrash`（走写队列）；`nextId` 增扫回收站防 id 复用；路由 trash / `GET /api/trash` / restore / purge（审计齐全）。
- [x] 资源位置：`resourceSchema.path?`；文件澄清补 `kind:'file'` + 绝对 `path`；`POST /api/reveal`（`explorer.exe /select`，detached + unref；仅本机）。
- [x] 前端：`EntityEditForm`（规格驱动表单）+ 任务 / 项目 / 笔记 / 资料四抽屉「编辑 / 删除」（删除进回收站 + 撤销 toast）；`/trash` 页（按类型分组 / 恢复 / 双击彻底删除 / 空态）；资料抽屉「文件位置」区块（路径 + 在文件管理器中显示）。
- [x] 记录：ADR-0009；`docs/04` / `docs/05` / `docs/02` / `docs/README` / `AGENTS.md` / `CHANGELOG.md` 同步。

---

## 使用指南 · HTML（已完成 · 2026-10-02）

面向首次使用系统的所有者，交付一份能读懂就会用的中文使用指南。**单文件、自包含**：`public/guide.html` 经 dev URL（`http://localhost:5173/guide.html`）访问，也可 `file://` 双击直接打开——内联 CSS/JS，零外部请求，无构建步骤。视觉复用暗色「柔暗夜色」token（表面阶 / 柔影 / 圆角 16 / 强调色仅作信号），桌面粘性左目录、≤900px 折叠为内联目录，正文 measure 72ch，响应式至 390px。

- [x] 内容十节：Hero（一句话哲学 + `npm run dev` 启动条）· 30 秒理解（捕捉→澄清→组织→执行→回顾）· 五分钟上手（5 步）· 一条内容的一生（表）· 八个页面速览（8 卡）· AI 怎么帮你（解析 / 周回顾 / 三条红线 / 本地 4096）· 系统是连起来的（关联区块 + `?task/?project/?note/?event` 深链）· 用好它的心法（六条）· 快捷键与全局（含手机局域网）· 常见问题 + 页脚版本串。
- [x] 自包含：`<html lang="zh-CN">` + viewport + 内联 `<style>`；系统字体栈（不引外部字体 / 图标 / 图片 / CDN）；无渐变 / 辉光 / emoji；末尾内联原生 JS 仅目录滚动高亮，失败静默降级。
- [x] 验证：Python Playwright（`.qa/v15/guide-verify.py`）三态 **25/25 通过**——dev 桌面 1600×1000 / 移动 390×844 / `file:///<workspace>/public/guide.html`；三处控制台 error == 0；关键区块（五分钟上手 / 关联 / 常见问题）命中；桌面与移动零横向溢出；file:// 无外部子资源请求。证据 `.qa/v15/`（三张截图 + `guide-verify.log`）。
- [x] 交互演示（追加）：任务卡内「点开看：任务详情面板」触发**任务详情面板居中弹窗**——忠实复刻真实抽屉（kicker `任务 · t-0034` / 标题 `通知同学提交医保信息（群公告）` / 2 列字段网格 / 标签 `班长` / 「关联」芯片 `所属项目 · … · p-0006`、`区域 · 学生工作 · a-0002`、`作为下一步行动 · … · p-0006` / `标记完成` 实心 + `查看项目` ghost / 关闭 X）；X / 遮罩 / ESC 关闭，打开时焦点进入弹窗、关闭还原触发按钮，打开锁定页面滚动，`role="dialog"` + `aria-modal` + `aria-labelledby`，fade + 微缩放（reduced-motion 降级）；自包含内联 CSS/JS。验收扩至 **39/39 通过**、控制台零错误，证据追加 `.qa/v15/guide-demo-open.png`。
- [x] 边界：未改 `src/**`、`server/**`、`scripts/**`、`data/**`、`public/favicon.svg`、`index.html`；未触碰运行中的 5173 / 4097 / 4096。

---

## v0.5 opencode AI 接入 · 首个切片（已完成 · 2026-10-02）

所有者指令「走 opencode 的现有默认配置」；先以实证探针（`.qa/v13/probe1–5`）核对全部关键假设再落地：**收件箱「AI 解析」**（条目 → 结构化建议 → 确认 → 走既有澄清写入）。`tsc -b` + `npm run build` 通过；服务端冒烟 + UI 端到端（Playwright）全绿；测试后数据已复原（零残留）。

- [x] 服务端：`server/ai.mjs`（SDK v2 代理；指令式 JSON + Zod + 单次重试 + 120s 超时 + 可选 Basic 认证）；`GET /api/ai/health`、`POST /api/ai/inbox/:id/parse`（404/409/503/502）。
- [x] 写入：`clarifyInbox` 扩展 `details`（title/contexts/energy/importance/estimateMin/dueAt/tags）+ `ai` 审计标记（向后兼容；撤销沿用 revert）。
- [x] 启动：`dev.mjs` 探测 4096，空闲则托管拉起 `opencode serve --port 4096`（已运行跳过；缺 CLI 仅告警）。
- [x] 前端：收件箱「AI 解析」入口 + 建议卡（安静样式）；状态条 / 设置页 AI 实时状态（在线 / 离线）。
- [x] 实证修正（ADR-0005）：serve 需显式 `--port 4096`；`format: json_schema` 在 thinking 模型被拒 → 指令式 JSON；`variant: 'low'` 4.4s vs 默认 236s。
- [ ] 顺延：SSE 流式进度、命令面板 AI 入口、通知 / 文件投递解析（原始诉求完整体）。
- 证据：`.qa/v13/`（probe1–5、smoke-ai、inbox-ai-*、settings-ai）。

---

## 结构互联 · Slice A（已完成 · 2026-10-02）

把跨实体引用变为可见、可点击（为后续 AI 关联建议打底）。`npm run build`（tsc strict + vite）通过；行为级验收（Python Playwright）20/20 通过——深链直开 / 关联芯片跳转 / 下一步 / 查看项目 / ESC 清参 / 移动端 390 / 控制台零错误（证据 `.qa/v14/`）。

- [x] `src/lib/relations.ts`：快照级线性扫描，返回 `{ kind, id, title, label }` 的出链 + 入链；任务（项目/区域/父任务/来源条目 · 子任务/作为下一步）、项目（区域/目标/下一步 · 任务/事件/笔记）、笔记（项目/区域/links · 反向链接）、事件（项目/区域）、资源（区域）。
- [x] `src/components/Relations.tsx`：抽屉内「关联」区块，`TagPill` 芯片（label · title · id），路由映射 task/project/note/resource/event/inbox；area/goal 无页面 → 静态芯片；空则不渲染。
- [x] 深链：`?project=`（Projects）/`?note=`、`?resource=`（Library）/`?event=`（Calendar），复用 `?task=` 的打开-关闭-replace 清参模式。
- [x] 集成五类抽屉；笔记「反向链接」保留。
- [x] 项目抽屉「下一步」字段；任务抽屉「查看项目」条件深链 / 无项目隐藏。
- [x] 版本串 v0.4.0 → v0.5.0（RailNav / 设置）；命令面板 AI 组更新为「AI 解析（收件箱）→ /inbox」。

---

## AI 澄清升级 · Slice B（已完成 · 2026-10-02）

收件箱 AI 解析升级：从「单点分类器」到「接入系统的连接器 + 过程可视」。服务端冒烟（SSE 帧）+ 浏览器 E2E 13/13 + `npm run build` 全通过；证据 `.qa/v14/`。

- [x] 上下文注入：`buildDigest`（项目 / 区域 / 标签 / 近期未完成 ≤50，~4KB）注入系统提示；建议 schema 扩 `projectId / areaId / tags / duplicateOf`。
- [x] 防臆造：`postValidate` 按快照过滤未知 id / 未注册标签；null 归一化。
- [x] clarify 联动：`clarifyDetailsSchema` + `clarifyInbox` 支持 `projectId / areaId`（仅 task；存在性校验）。
- [x] SSE 过程流：`POST /api/ai/inbox/:id/parse-stream`（`event.subscribe` 泵 + `status / delta / retry / suggestion / error` 帧 + 断开清理）；同步端点保留回退。
- [x] 前端：`aiParseInboxStream` + 过程面板（阶段 + 240 字预览）+ 挂接 chips（绝不自动合并）。
- [x] 工程：`scripts/spawn-bg.mjs` 后台安全启动器；AGENTS.md Windows 纪律修订（第三次卡死教训：`start` 方式挂起 → detached spawn）。
- 实测：i-0001 建议挂接 `p-0006 + a-0002 + role:monitor`；冒烟 625 delta 帧 ≈4.9s；E2E 只读零写入。

---

## AI 周回顾 · Slice C（已完成 · 2026-10-02）

AI 读整个系统生成周回顾草稿（指标 + 摘要 + 决策 + 停滞处置建议）→ 用户在回顾页编辑 → 确认后写入真实 `review` 记录（撤销即删除）；回顾页显示最新周 / 月回顾并移除该流程全部「原型态」文案。`npm run build` 通过；服务端冒烟 PASS + 浏览器 E2E 13/13；证据 `.qa/v14/`。

- [x] 写入路径：`reviewSchema` / `reviewDraftSchema`（`server/schemas.mjs`）；`SCHEMAS.reviews` + `ID_PATTERNS.reviews`；`store.nextId` 增 `reviews:'rev'`。
- [x] 服务端：`isoWeekKey` / `computeWeekMetrics` / `staleProjects`（`server/ai.mjs`，与前端口径严格一致）；`POST /api/reviews`（服务端算 id / periodKey / metrics / staleProjectIds；审计 `review.create`）、`POST /api/reviews/:id/remove`（审计 `review.remove`）、`POST /api/ai/review/draft`（503 / 502）。
- [x] AI 草稿：紧凑中文摘要注入 + 指令式 JSON + Zod + 单次重试（`variant:'low'`，120s）；`staleAdvice` 按实际停滞集合过滤臆造 id；`migrated` 刻意不产出（无编辑追踪来源，UI 显示 '—'）。
- [x] 前端：`mutations.ts`（`generateReviewDraft / saveReview / removeReview` + `ReviewDraft`）；`date.ts`（`isoWeekKey / monthLabel`）；`types.ts`（`migrated?`）；`Review.tsx`（最新回顾按 date 倒序 / 周期运行时计算 / 真实草稿流 idle-loading-draft-error-saving / toast 撤销）；`views.css`（安静 token-only 草稿样式）。
- [x] 验证：冒烟（草稿形状 + 写入 / 删除往返 + 审计，零残留）；E2E（草稿 / 编辑保留 / 保存 toast / 撤销复原 / 零控制台错误，零残留）；构建通过。
- [x] 文档：ADR-0007；`docs/04 §4.10`（`migrated` 可缺省）；`docs/05` / `docs/README` 收录 0007。

---

## 收件箱升级 · Slice D（文件投递 + 居中编辑器 + AI 先读）（已完成 · 2026-10-02）

收件箱捕捉栏从「全宽纯文本条」升级为**居中圆角编辑器**（DeepSeek 式）：支持点击 / 拖拽投递文件，落盘后**由 AI 先读一遍**（复用既有 SSE 过程面板 + 建议卡）。`npm run build`（tsc strict + vite）通过；服务端冒烟 PASS + 浏览器 E2E **12/12**；重启后栈在线（4097 + 5173，未触碰 4096）；数据零残留；证据 `.qa/v16/`。

- [x] 服务端：`POST /api/inbox/upload`（RAW body 流式落盘 `data/files/`；25MB 上限 → 413；文件名清洗 / 截断 / 兜底；`source:'file'` + `file:{name,size,mime?}`；审计 `inbox.upload`；写失败清半成品）、`POST /api/inbox/:id/remove`（清附件 + 删条目；`clarified` → 409；审计 `inbox.remove`）、`GET /api/files/:id`（流式 inline，`filename*=UTF-8''`）。
- [x] 数据模型：`inboxItemSchema.file?`；`.gitignore` 增 `data/files/`（二进制不进 git；元数据随 JSON）。
- [x] AI 先读：`buildFileSection`（同步 / 流式共用）——文本白名单或 `text/*` 且 ≤5MB → 前 8000 字摘录；否则仅元数据；系统提示增附件判断行；无附件条目行为不变。
- [x] 前端编辑器：`.ic-composer` 居中（`max-width:760px`）+ 圆角柔影 + chips + 回形针 + 拖拽遮罩「松开：放入收件箱」+ 圆形发送 + `C` 角标；光学居中补偿固定轨道；`humanSize` 格式化。
- [x] 投递即读：`uploadInboxFile(file, caption)` → 顺序自动运行 `parse-stream`（失败 toast 后继续）；文件行字形 / `name · humanSize` / 「查看文件」链接。
- [x] 验证：冒烟（201 + 清洗 + 落盘一致 + 真实 AI 建议 + remove 清理 + 审计，零残留）；E2E（几何居中 centerX=800 / chip / 文件行 / 自动建议卡 / 拖拽 chip / 零残留 / 零控制台错误）。
- [x] 文档：ADR-0008；`docs/04 §4.1`（`file?`）；`docs/05`（目录树 / 职责 / 清单）；`docs/README` 收录 0008。

---

## 收件箱修复包 · Slice E1（已完成 · 2026-10-03）

所有者实测反馈四项修复：①编辑器回位；②「批量 → 任务」反馈加固；③AI 结果缓存；④批量 AI 解析。`npm run build`（tsc strict + vite）通过；浏览器 E2E **24/24**（含「批量丢弃」路径）；数据零残留（收件箱回到 i-0001..i-0008 · 任务回到 t-0001..t-0060 · `data/files/` 空）；证据 `.qa/v17/`。

- [x] **编辑器回位（owner 反馈）**：撤销 Slice D 居中几何——`.ic-composer` 去 `max-width:760px` 居中与 `translateX` 光学补偿；回到原捕捉栏位置（占满版心；左右边距与「水位」面板一致，实测 x=228=panel.x、宽度均 1240）；DeepSeek 式视觉与全部 Slice D 功能（chips / 回形针 / 拖拽遮罩 / 圆形发送 / `C` 角标 / 投递即自动 AI 先读）保留。
- [x] **「批量 → 任务」复现 + 加固**：API 造一文本 + 一文件临时项 → 勾选 → 批量 → 任务，**两条均成功澄清离场，服务端流程无 bug**（owner「点了没用」是反馈不够醒目）；加固：目标感知 toast（`已批量创建 N 条任务` / `已批量丢弃 N 条`，带「撤销」）+ 成功后才收敛选中态（仅移除已处理项，中止保留剩余选中）。
- [x] **AI 结果缓存（收起不丢）**：`src/views/Inbox.tsx` 模块级 `Map<inboxId, AiParseResult>`（会话内跨路由存活）；收起 / 切换后展开命中缓存 → 秒级就绪卡（无阶段文案 / 不重解析，实测 0.00s）；条目离场（应用 / 撤销 / 刷新对账）即清除；就绪卡增安静 ghost「重新解析」（覆盖缓存强制重跑）；单活跃流在途守卫不变。
- [x] **批量 AI 解析**：批量条新增「批量 AI 解析」（旁列 批量 → 任务 / 批量丢弃）；顺序流式解析选中项（复用 `aiParseInboxStream` + 缓存），进度「AI 解析中 2/5…」，失败 toast 后继续，**绝不自动应用**；运行期间禁用批量动作与单条解析入口防重叠。
- [x] 验证：E2E 24/24（几何回位 / 批量 AI 进度与完成 / 两条均缓存即时就绪 / 批量 → 任务两条离场 + 明确 toast / 批量丢弃两条离场 + 明确 toast / 零残留 / 控制台零错误）；截图 `e1-composer.png` / `e1-batch-ai.png`；日志 `slice-e1-verify.log`。
- [x] 文档：ADR-0008 §2.7 修订（「owner 反馈后回位，不居中」）+ §4 Slice E1 修订行；`CHANGELOG.md` `[Unreleased]` 新增 Slice E1 条目。

---

## 全站排版落地（设计选型采纳 · 9/10）（已完成 · 2026-10-02）

所有者选型落地，仅排版 / 组件编排变更，功能 / 数据 / 路由零改动；`tsc` + `npm run build` 通过；8 视图 + 任务 / 笔记抽屉全站截图回归、零控制台错误（证据 `.qa/v10/`）；**行为级验证通过**：收件箱批量 → 任务闭环 + 撤销回滚（t-0061 创建→撤销删除、条目 clarified→unprocessed）、任务表完成 + 撤销（t-0010 复原 next）、设置导航切换、日历「回到现在」、移动端 390 无溢出 + 次要列渐隐。

- [x] 收件箱 C「批量」→ 见下方「收件箱排版落地」节（批量工具条 / 日期分组 / 行内澄清 / 批量撤销）。
- [x] 任务 C「表格」→ 见下方「任务页排版落地」节（验收修复：「完成」表头竖排 → 勾选列 58px + nowrap + 首列居中）。
- [x] 项目 B「列表」→ 见下方「项目页排版落地」节。
- [x] 日程 C「议程流」：`Calendar.tsx` 重写——「今天 · 日期」头 + 下一项高亮卡（`useNow` 实时倒计时）+ 今天 / 明天 / 本周 / 下周分组事件流（时间 · 标题 · 地点）+ 迷你月历（今日标记 + 有安排圆点 + 前后月导航）+ 本月场次统计；日脊 / 周条 / scrollToNow 退役（`DaySpine` 组件保留未用）；右栏窄容器移至下方。
- [x] 资料 A「列表」：四行筛选整合为单条紧凑过滤条（横向滚动，a11y 标签保留）；笔记 / 资料分区行精化（类型 / 标题 / 蒸馏 / 相对时间），计数移至标签行。
- [x] 回顾 B「仪表盘」：双栏重构——左：指标瓦片 ×5（逾期 accent）+ 本周完成 `TrendLine` + 能量分布；右：周 / 月回顾卡（决策 01–03）+ 开始周回顾 + 停滞项目；五步流程抽屉保留。
- [x] 设置 B「侧导航」+ 细致优化：左分类导航（外观 / AI 集成 / 数据统计 / 数据服务 / 关于，无边框高亮选中）+ 右单区内容；窄容器横向滚动条；间距 / 区块头 / 表格对齐 / 空态统一。
- [x] 侧边栏规格：选中态「无边框高亮（填充 + 零阴影零边框）+ 左缘 3px 强调线」；实测（bg 8% 白 / shadow none / line 3px accent）；折叠态与移动端底栏同步。
- [x] 详情面板 B：任务抽屉两段式（备注 → 2 列字段网格 → 标签 → 底部操作）；`.k-drawer .k-dl` 统一两列紧凑网格（任务 / 日程 / 项目 / 资料抽屉一致受益）；窄抽屉回落单列。

- [x] **总览**：工作台（三轮 C）—— 已落地（见下方「总览排版落地」节）。

---

## 总览排版落地 · 工作台（变体 C）（已完成 · 2026-10-02）

所有者选定三轮 C「工作台」（`design-drafts/v2/overview-c.html`）并落地；仅排版 / 组件编排变更，数据 / 路由零改动；`tsc -b` + `npm run build` 通过；行为级验证 + 桌面 / 移动截图回归（证据 `.qa/v12/`）。

- [x] 结构：顶部胶囊行 → `.r3c-body`（左 2/3 工作区 = 已结束日程 →「现在 · HH:mm」实时分界 → 按截止升序的下一步行动 TOP5，含 `· 项目 done/total` 后缀；右 1/3 粘性监视柱）→ 底部项目推进（前 4 个活跃项目 + W40 回顾行）。
- [x] 监视柱：水位 6/12（阈值 8；口径统一 capacity 12 / threshold 8，StatusBar 同步）/ WIP 9/3 超限 / 连续刷题 14 日点阵 / 完成趋势 + 到期负载低高度 sparkline（`TrendLine` 增补 `showValues` / `showAxis` / `ariaLabel`，默认不变）。
- [x] 数据：新增 `getDueLoadSeries` / `getCodingStreakDetail` / `getUpcomingNextActions`（逾期不入列——由顶部「逾期 · N 项」胶囊承载）；`.k-streak` 点阵收录 `components.css`。
- [x] 退役：AI 建议卡（v0.5 占位）随编排移除；旧统计瓦片 / 双栏 / `.k-aisug` 死样式清理。
- [x] 行为验证：行动行深链 `/tasks?task=t-0034` + 抽屉、ESC 清参、日程行→`/calendar`、项目行→`/projects`、分割线实时时间、移动端 390 单列、回顾页 TrendLine 零回归。

---

## 项目页排版落地 · 列表（变体 B）（已完成 · 2026-10-02）

### 已完成

- [x] 所有者选定项目页「列表」（`design-drafts/v2/projects-b.html`）并落地真实应用：`src/views/Projects.tsx` 以按状态分组的纵向列表替换四列看板；`src/styles/views.css` 项目段以新增 `.k-plist*`（`.k-plist` / `.k-plist__group` / `.k-plist__row` / `.k-plist__idx` / `.k-plist__main` / `.k-plist__titleline` / `.k-plist__title` / `.k-plist__outcome` / `.k-plist__next` / `.k-plist__side` / `.k-plist__meter` / `.k-plist__due` / `.k-plist__empty` 与 `@container route` 收窄）替换原 `.k-kanban*` / `.k-pcard*`；分组头复用既有 `.k-group*`。
- [x] 行内容：序号 + 标题 + 状态/区域/首个标签胶囊 + 完成定义 + 下一步（`nextActionId` → 任务标题，accent 左信号条）+ 内联 `MeterBar`（真实 `getProjectProgress`，`done / total · pct%`）+ 截止 `humanizeDay`；非活跃分组紧凑（暂停/将来 隐藏下一步，已完成隐藏完成定义），悬停抬升。
- [x] 空态：无项目时呈现安静空态；空分组呈现一条细提示（`EmptyState` 经 `.k-plist__empty` 收敛为设计稿的安静行）。
- [x] 保留全部功能：行点击打开抽屉（`ProjectDetail` 的完成任务 / 撤销、任务清单、区域 / 标签 / 截止）；容器 `route` 收窄时行内右侧信息折到标题下方。
- [x] 清理死规则：移除 `.k-kanban` / `.k-pcard` 及其 `@container route (max-width:1120px|640px)`、`@container pcard` 块，更新 CONTAINER MAP 注释。仅改 2 文件 + 文档台账，未动 server/ · data/ · design-drafts/ 与其它视图 / 组件。`tsc -b` 通过。

## 任务页排版落地 · 表格（变体 C）（已完成 · 2026-10-02）

### 已完成

- [x] 所有者选定任务页「表格」（`design-drafts/v2/tasks-c.html`）并落地真实应用：`src/views/Tasks.tsx` 改为真实 `<table>`（完成 / 标题 / 上下文 / 能量 / 截止 / 项目），每分组一张表；`src/styles/views.css` 任务段新增 `.k-tasks__toolbar` / `.k-tasks__filters` / `.k-tasks__table` / `.k-tasks__row` / `.k-tasks__title-btn` / `.k-tasks__col--*` / `.k-tasks__foot` 及 `@container route` 收列规则。
- [x] 保留全部功能：状态 + 时间筛选、更多筛选 disclosure、`byDueTask` 排序、计数并入工具条、快速新建（`createTask` + toast）、深链 `?task=`、抽屉（未改样式）、完成勾选 + 撤销 + `pendingDone` 划线、空态、分组（平铺 / 按项目 / 按上下文）。
- [x] `tsc -b` 通过；仅改 2 文件，未动 server/ · data/ · design-drafts/ 与其它视图 / 组件。

## 收件箱排版落地 · 批量（变体 C）（已完成 · 2026-10-02）

### 已完成

- [x] 所有者选定收件箱「批量」（`design-drafts/v2/inbox-c.html`）并落地真实应用：`src/views/Inbox.tsx` 改为「捕捉条 + 水位面板 + 批量操作条 + 日期分组列表 + 内联澄清」；`src/styles/views.css` 收件箱段新增 `.ic-head` / `.ic-batchbar*` / `.ic-groups` / `.ic-item` / `.ic-row*` / `.ic-subrow` 及 `@container route` 收窄规则（分组头复用既有 `.k-group*`）。
- [x] 新增多选：`Set<string>` 未澄清 id 集合，主勾全选 / 全不选；批量 → 任务（逐条 `clarifyInbox(id,'task')`）、批量丢弃（`'discard'`）、取消选择；成功后单个「已处理 N 条」toast + 撤销（循环 `revertInbox`），失败即中止并保留剩余项。
- [x] 日期分组：按 `capturedAt` 相对今天的日历日分 今天 / 昨天 / 更早，降序；组头显示日期 · 星期 · 项数（更早组仅项数）。
- [x] 行尾「澄清」按钮（`aria-expanded`）展开 / 收起内联 5 项操作（→任务 / →项目 / →笔记 / →资源 / 丢弃）；单条澄清沿用 5s 撤销 toast。
- [x] 保留全部既有功能：捕捉（异步 + 错误 toast）、水位计量、已澄清 / 已丢弃折叠、空态、相对时间刷新；未动 server/ · data/ · design-drafts/ 与其它视图 / 组件。`tsc -b` 通过。

## 页面多版本设计稿 v2 + 路由滚动记忆（已完成 · 2026-10-02）

### 已完成

- [x] 设计基础：`design-drafts/v2/_base.html`（复用真实应用 CSS 的草稿模板，实测柔影/字体/组件全部加载）+ `BRIEF.md`（变体方向与硬性纪律）+ `_build.mjs`（选型页 / 对比页生成器）。
- [x] 8 个视觉代理并行产出 **29 个方案**：总览 / 收件箱 / 任务 / 日程 / 项目 / 资料 / 回顾 / 设置 ×3 版 + 详情抽屉 5（task ×3 + note + event）；全部真实种子数据、真实 token、零横向溢出。
- [x] **第二轮追加（所有者：总览重做 + 监控图表）**：`overview-a/b/c.html` 替换为「**监控台 CONTROL ROOM / 驾驶舱 COCKPIT / 信号层 SIGNALS**」三版——图表优先、主图+纵向流、信号行，三版合计覆盖全部 7 类监控图表；新增 `charts-kit.html` **图表组件样本页**（7 个监控模块：完成趋势 / 到期负载 / 能量分布 / 连续打卡 / 收件箱水位 / WIP 监控 / 项目推进；每个含 名称 / 建议类名 / 数据来源 / 使用场景 标注）；第一轮总览稿归档 `_archive/overview-*-v1.html`。
- [x] **图表语言修订（所有者否决圆头柱）**：线上 `TrendBars` 退役 → 新增 `TrendLine`（折线 + 面积晕染 + 数据点；峰值环仅唯一最大值；`.k-line` 样式族替换 `.k-trend`）；回顾页图表切换实测通过；草稿侧 7 文件同步替换（charts-kit / overview-a/b / review-a/b/c），条带与迷你柱去 pill 圆角；规范写入 `design-drafts/v2/BRIEF.md` 附录二；`_build.mjs` 升级支持「重跑即刷新内联 CSS」。
- [x] 预览渲染（含第二轮 4 张）+ 选型页 `design-drafts/v2/index.html`（现 30 卡片、含新「图表组件（监控）」分组、概念注释自动提取）+ 10 组三版对比页 `_sheets/`。**自包含打包**：应用 CSS 已内联进全部变体文件——评审可直接**双击 `design-drafts/v2/index.html`**（file:// 也能看到完整样式），或经 dev URL `http://localhost:5173/design-drafts/v2/index.html`。
- [x] 路由滚动记忆（所有者指定规则）：`src/lib/scroll.ts`（`useRouteScrollMemory`，AppLayout 挂载）——按 pathname 实时记录；切换后有记忆恢复、首访回顶；各页互不影响；日历首访自动到现在、回访恢复记忆；懒加载页 180ms 校正。

### 待办（所有者）

- [ ] 逐页选型（可跨页混选）→ 落地 `src/`。

### 关键结论（供落地时参考）

- 三版差异原则：A = 信息分区表达主次；B = 单点聚焦 / 层级极简；C = 均匀密度 / 快速扫读。
- 详情抽屉骨架（单列 / 双栏 / 行动优先）可一版通用于 task / event / project / note / resource。

---

## v0.4 数据服务（已完成 · 2026-10-02）

目标：Node 单写者数据服务成为唯一写入路径；替换 localStorage 原型态覆盖层；并入全站审阅确认的 P0 六项。决策记录：ADR-0004。

### 已完成

- [x] `server/`：HTTP 路由（`index.mjs`）+ 存储层（`store.mjs`：串行写队列 / 原子写 write-file-atomic / nextId / `data/activity.jsonl` 审计）+ Zod schema（`schemas.mjs`，可写实体 5 类：task/inboxItem/note/resource/project）；仅 `127.0.0.1:4097`。
- [x] 端点：`GET /api/snapshot|activity|health`；`POST /api/tasks`（快速新建）/ `:id/complete` / `:id/reopen`（从审计还原先前状态）；`POST /api/inbox`（捕捉）/ `:id/clarify`（→任务/→项目/→笔记/→资源/丢弃）/ `:id/revert`（撤销并删除产物）。
- [x] 前端改造：`data.ts` 可变快照（seed 首帧 + `/api/snapshot` 水合 + 订阅）；`api.ts` / `mutations.ts`（乐观更新 + 失败回滚）/ `hooks`（useDataRevision / useDataSource）；**删除 `proto.ts`**；Tasks/Overview/Inbox/Projects/StatusBar/Settings 全部改造；Toast 错误态 + 去「原型态」标签；状态条 + 设置页数据服务面板；聚焦/可见重水合（多标签同步）。
- [x] 工程：`scripts/dev.mjs`（`npm run dev` / `preview` 一体启动数据服务 + Vite）；`vite.config` 增加 `/api` 代理与 `data/**` 免热重载；npm 脚本更新（`dev:web` / `server`）。
- [x] 验证：服务端冒烟 15/15（落盘 / 幂等 / 撤销还原 / 路径穿越拒绝 / 审计链）；浏览器端到端（完成→落盘→撤销；捕捉→澄清→撤销；快速新建；离线降级：错误 toast + 乐观回滚 + 红胶囊；移动端 390 无溢出）；`npm run build` 通过。证据 `.qa/v07/`。
- [x] 文档：ADR-0004；`docs/02`（§1 拓扑 / §2.2 / §3.2 / §5 / §6 / §7）、`docs/04` §9、`docs/05`、`docs/07` 同步；AGENTS / README / CHANGELOG v0.4.0。

---

## 界面缺陷修复与全站审阅（已完成 · 2026-10-02）

目标：修复所有者指出的左上角品牌遮盖问题 + 以产品经理 / UI 设计师 / 前端工程师三视角全站审阅。

### 已完成

- [x] 品牌锁排：`.k-rail__brand` 垂直居中锁排，96px 轨道内 "KERNEL" 完整显示（原被裁切为 "KERNE"）。
- [x] 接缝对齐：顶栏 `min-height: var(--topbar-h)`，与轨道品牌行底边发际线 104px 共线（原错位 19px）。
- [x] Toast 跟随折叠（`<html data-rail>` + `--rail-current`）、`color-scheme` 主题化、`.gitignore` 增补。
- [x] 审阅缺陷修复 ×10（任务分组行 / 项目卡标签 / 0 值柱 / 能量斜纹 / 日历日期条吸顶 / 阈值线），全部实机断言 + 截图。
- [x] 全站审阅：2 独立代理（视觉 / 产品＋工程）+ 主会话复核，报告与证据 `.qa/review/`（`REVIEW-2026-10-02.md`、8 视图终版截图）。
- [x] git 初始化（`main` 分支）+ 首次提交。

### 审阅发现（Review Findings · 待决策，详见报告）

- **P0（建议并入 v0.4）**：澄清不落地/刷新回滚、跨视图计数分裂、proto 写入静默失败、清除无确认、缺 doneAt、多标签不同步。
- **P1（原型期可做）**：~~任务时间筛选+排序~~ ✅、~~undo toast~~ ✅、~~useNow 共享刷新~~ ✅、~~AI 卡文案动态化~~ ✅（2026-10-02 第一批）；剩余：日历翻周+deferUntil、回顾持久化+资料搜索、a11y 三处。
- **P2（视觉打磨）**：看板空列收敛、Panel 序号统一、指标尺度收敛、顶栏毛玻璃（可选）、ghost 胶囊、移动端统计 2 列（需拍板）。

---

## 体验增强 · P1 第一批（已完成 · 2026-10-02）

目标：落地审阅建议中"对每日使用增益最大"的三项（任务时间维度 / 撤销 / 统一时间刷新）＋ AI 卡动态计数。

### 已完成

- [x] 任务页「时间」筛选组：逾期 / 今天 / 本周（周一–周日区间），与状态筛选组合（实测逾期 5 条与统计一致、今天空态、本周 16 条）。
- [x] 任务默认排序：截止近者优先（最逾期在前）→ 重要性 → id；全部视图（含分组）生效。
- [x] 深链直达：`/tasks?task=<id>` 打开对应任务抽屉；总览「下一步行动」点击直达；ESC 关闭后清理查询参数。
- [x] 撤销 toast：完成任务 / 取消完成 / 收件箱澄清（含丢弃）5s 内可撤销（Toast 支持 action，带动作停留 5s）。
- [x] `useNow` 统一刷新：总览 / 日历 / 任务 / 资料 / 收件箱 60s 自动刷新（原三处渲染时取一次）。
- [x] 总览收件箱计数含原型态捕捉；AI 卡数字动态。
- [x] 验证：`.qa/v06/` 断言 + 截图；`npm run build` 通过；控制台无错误。

---



## 当前迭代：v0.3 视觉方向重做（已完成 · 2026-10-02）

目标：按所有者选定方向重做全站视觉（C 柔暗夜色 + B 柔影悬浮融合），并修复 v0.2 QA 的全部缺陷；功能、路由与数据层保持不变。

### 已完成

- [x] 方向决策：ADR-0003，C 柔暗为默认 + 柔影悬浮融合，取代硬瑞士 v1。
- [x] v2 设计 token（`tokens.css`）：暗色默认 / 亮色暖雾柔光、圆角 16、柔影、强调色 AA 变体、等宽栈补 CJK。
- [x] 全站重皮：应用壳（RailNav/TopBar/StatusBar/Drawer/CommandPalette/Toast）+ 全局组件 + 8 视图 + 详情抽屉。
- [x] 默认暗色：`index.html` FOUC 脚本 + `ThemeContext`（已保存的用户切换仍优先）。
- [x] QA 缺陷全修：M1 选中 chip 可读 / M2 强调色文字过 AA / M3 按钮 reset `padding:0` / M4 日历 scroll-to-now / M5 焦点圈闭 + 还原 / P7 强调色退出图表 / P8 逾期信号归位 / P9 token 纪律 / P10 删 HeatGrid + spine 短事件 + 等宽 CJK / Polish 日期不补零。
- [x] 验收修复：命令面板焦点还原（`focusin` 追踪 + 忽略面板自身与 `body`；关闭校验 `isConnected` 后还原）与水平居中（弃用被 Motion 覆盖的 `translateX(-50%)`，改 `margin:0 auto`）。
- [x] 验收修复：灰阶对比校正（暗色 `--muted`→`#929298`；亮色 `--ink-2`→`#665F59`、`--muted`→`#6E6862`，全表面 ≥4.5:1）。
- [x] 版式与呼吸感重排：版心居中（`--content-max: 1240px`）+ 统一呼吸词汇（`--pad-card: 26px` / `--row-min: 64px`）+ 区块头 / 顶栏 / 侧轨去噪 + 总览按 C 稿重排（状态胶囊 / 紧凑日程 / 精简瓦片 / 项目进度卡）+ 任务筛选「更多筛选」披露 + 收件箱去嵌套 + 8 视图一致性；`npm run build` 通过。
- [x] 数理自适应系统：字号/间距改 Utopia 流体 `clamp`（锚点 390/1440，1440 零回归）+ φ 间距层级（inner:element:section:page = 1:φ:φ²:φ³）+ 五具名容器查询（route/stat/task/pcard/drawer）替代组件内部媒体查询 + 动效距离分级/圆角比值/65ch 约束文档化 + 死代码清理（Ticker/Sparkline/heat/flows/rank/rail-en/mini-spine/pad-row）+ `docs/08-MATH-SYSTEM.md` + `.qa/v05/` 实测证据；`npm run build` 通过。
- [x] 文档：宪法 §5 升 v2、ADR-0003、设计系统 v2、文件树、CHANGELOG v0.3.0、AGENTS、路线图重编号。

### 验收标准（已满足）

- 暗色为默认，亮色可切换；两主题共享几何/排版，只换色彩与高度。
- 柔影悬浮语言全站一致；无硬边线；强调色仅作信号。
- 全部归档 QA 缺陷修复并复核；对比度达标（正文 ≥7:1、UI ≥4.5:1、强调色文字 ≥4.5:1）。
- 功能/路由/数据层/原型态保持不变；`npm run build`（tsc 严格 + vite）通过。

---

## v0.2 高保真前端原型（已完成 · 2026-10-02）

目标：把宪法 §4 的视图规格落成可演示、可交互的高保真原型，视觉与动效达到设计系统要求。

### 已完成

- [x] 设计 token 落地为 CSS 变量：色板（亮/暗）、字体、字号、间距、动效曲线。
- [x] 布局骨架：左侧 Index Rail（展开 96px / 收起 64px）+ TopBar + StatusBar + 主内容区。
- [x] 主题系统：亮/暗双主题，首帧前读 localStorage 防 FOUC，设置页可切换。
- [x] 路由与视图骨架：8 条路由接通（react-router v7 声明式 + 布局路由）。
- [x] 总览 OVERVIEW（P0）：Ticker、统计瓦片 ×4、DaySpine mini、下一步 TOP 6、存量与流量面板、AI 建议卡占位。
- [x] 收件箱 INBOX（P0）：快速捕捉输入框（快捷键 `c`）、未澄清列表、澄清操作条、水位计。
- [x] 任务 TASKS（P0）：筛选条、三种分组切换、行内完成动效、详情抽屉、行内快速新建。
- [x] 日程 CALENDAR（P0）：日脊 0 到 24h、事件块重叠分列、实时"现在"线、周条 mini 地图。
- [x] 项目 PROJECTS（P1）：四列看板 active / onHold / someday / done、详情抽屉。
- [x] 资料 LIBRARY（P1）：Notes + Resources 混合流、类型/状态/标签筛选、Markdown 阅读抽屉与反向链接。
- [x] 回顾 REVIEW（P1）：周回顾五步流程 UI、计数与单色图表、停滞项目清单。
- [x] 设置 SETTINGS（P2）：主题、数据统计、AI 状态（OFFLINE + 路线图）、关于、原型态说明。
- [x] 命令面板（`Ctrl+K`，cmdk）：导航 / 动作 / 原型标注入口。
- [x] 动效技法接入：路由进入、列表 stagger（60ms 步进）、数字滚动、完成划线塌缩、标签悬浮反转、现在线呼吸、Ticker 滚动、命令面板 fade + 4px 升起。
- [x] 无障碍：`MotionConfig reducedMotion="user"`、焦点环 2px accent offset、键盘全可达。
- [x] 响应式：≥1280 / 768–1280 / <768 三档，移动端底部标签栏，适配至约 390px。
- [x] 原型态本地层：任务完成 / 收件箱捕捉 / 快速新建任务写 localStorage 并跨视图联动。

### 验收标准（已满足）

- 八个视图均按宪法 §4 的优先级（P0 做透 / P1 完整可用 / P2 可用即可）达到对应完成度。
- 双主题切换无闪烁，动效在 reduced-motion 下自动降级。
- 原型期用户操作写 localStorage，界面标注"原型态"。
- 无 UI 框架、无 Tailwind，样式全部走 token。
- `npm run build`（tsc 严格 + vite）通过。

---

## Backlog

### v0.4 数据服务（已实现 · 2026-10-02）

- [x] 引入 Node 单写者数据服务，作为唯一写入路径。
- [x] 原子写入（write-file-atomic）。
- [x] Zod schema 校验，写入前全量校验。
- [x] 审计日志 `data/activity.jsonl`。
- [x] 前端写入改造为经 API 调用，移除 localStorage 原型态。
- [x] 数据迁移与备份策略：原子写 + 审计日志 + git 跟踪 `data/`（ADR-0004）。

### v0.5 opencode AI 集成（首个切片已交付 · 2026-10-02）

- [x] 本地 Node 服务代理链路：网页 → 本地服务 → `opencode serve`（仅 localhost）——`server/ai.mjs` + `dev.mjs` 自动拉起。
- [x] 接入 `@opencode-ai/sdk`（v2 客户端、扁平调用）：`session.create` / `prompt`。
- [x] 经 `event.subscribe`（SSE）推进度与流式结果 —— Slice B 落地（`/api/ai/inbox/:id/parse-stream` + 过程面板）。
- [x] AI 建议挂接（Slice B）：系统摘要注入 + `projectId / areaId / tags / duplicateOf` + clarify 关联字段。
- [x] 结构化建议：`format: json_schema` 在 thinking 模型被拒（ADR-0005）→ 指令式 JSON + Zod 校验 + 单次重试。
- [x] 结果写回 `data/`：AI 只出建议；确认后走 clarify（`details` + `ai` 审计标记），撤销沿用 revert。
- [ ] AI 建议卡从占位转为可用 —— **形态演进**：收件箱「AI 解析」建议卡已上线；总览建议卡留待后续增量。
- [ ] 后续增量：通知解析（原始诉求完整体）、命令面板 AI 入口；文件投递解析已落地（Slice D）。

### v0.6+

- [ ] 回顾流程自动化（Slice C 已部分落地 · 2026-10-02）：自动汇总指标 + 生成停滞清单 + 处置建议已交付（`/api/ai/review/draft` → 确认落盘）；顺延——页内停滞项目迁移 / 归档真实落盘、月回顾生成、编辑追踪支撑真实 `migrated` 统计。
- [ ] 习惯热力图与连续打卡统计。
- [ ] 搜索与命令面板的深度整合。

### v1.0 稳定

- [ ] schema 预留实体落地评估：`timeLog` / `person` / `journalEntry`。
- [ ] 完整数据自检与一致性工具。
- [ ] 文档与代码全量对齐审计。

---

## 已完成日志

| 日期 | 版本 | 完成项 |
|---|---|---|
| 2026-10-02 | v0.5.0（切片） | opencode AI 接入 · 首个切片：收件箱「AI 解析」（server/ai.mjs 代理 + 指令式 JSON + Zod；clarify details + ai 审计标记；dev.mjs 自动拉起 serve；前端建议卡 + 状态条/设置 AI 状态）；ADR-0005 + docs/02 修正；实测解析 3–6s；行为级 + 构建通过；证据 `.qa/v13/` |
| 2026-10-02 | v0.4.0 | 总览落地「工作台」（三轮 C 采纳，选型 10/10 完结）：左工作区（已结束日程→实时「现在」分界→按截止行动 TOP5 + 项目后缀）+ 右粘性监视柱（水位 12/8 · WIP 9/3 · 14 日点阵 · 完成趋势/到期负载 sparkline）+ 项目推进（真实计数 9 进行中 + W40 行）；`TrendLine` 增补可选属性、水位口径 12/8 统一、`.k-streak` 入组件库、AI 建议占位退役；行为级验证 + 构建通过；证据 `.qa/v12/` |
| 2026-10-02 | v0.4.0 | 全站排版落地（设计选型采纳 9 项）：收件箱 C / 任务 C / 日程 C / 项目 B / 资料 A / 回顾 B / 设置 B（+细化）/ 侧边栏（无边框高亮 + 侧边线）/ 详情面板 B（两段式 + 2 列字段网格）；全站回归零错误；`tsc` + `npm run build` 通过；证据 `.qa/v10/` |
| 2026-10-02 | v0.4.0 | 页面多版本设计稿 v2（29 方案 + 选型页 + 9 张三版对比页；真 CSS / 真数据；待所有者选型）+ 路由滚动记忆（各页独立恢复 / 首访回顶；日历配合「首访到现在、回访恢复」）；Playwright 实测 + `npm run build` 通过 |
| 2026-10-02 | v0.4.0 | 数据服务：Node 单写者（127.0.0.1:4097）+ 原子写 + Zod 校验 + `activity.jsonl` 审计；proto 退役（可变快照水合 + 乐观更新 + 撤销 + 离线显式报错）；审阅 P0 六项并入；`scripts/dev.mjs` 一体启动；ADR-0004；`.qa/v07/` 服务端 15 项 + 浏览器端到端验证；`npm run build` 通过 |
| 2026-10-02 | v0.3.0 | 体验增强（审阅 P1 第一批）：任务时间筛选（逾期/今天/本周）+ 截止排序 + `?task=` 深链直达 / 完成与澄清撤销 toast（Toast action + 5s）/ `useNow` 统一 60s 刷新（总览/日历/任务/资料/收件箱）/ 总览收件箱计数含原型态 + AI 卡动态计数；`.qa/v06/` 断言 + `npm run build` 通过 |
| 2026-10-02 | v0.3.0 | 界面缺陷修复与全站审阅：品牌锁排（KERNEL 不再裁切）/ 顶栏接缝对齐（104px 共线）/ Toast 跟随折叠 / `color-scheme` / 任务分组行同行 / 项目卡标签横排 / 0 值柱细基线 / 能量斜纹权重 / 日历日期条吸顶 / 阈值线可见；2 独立代理三视角审阅 + 实机复核（报告 `.qa/review/REVIEW-2026-10-02.md`，19 项分级建议）；git 初始化 + 首次提交；`npm run build` 通过 |
| 2026-10-02 | v0.3.0 | 数理自适应系统：Utopia 流体字号/间距（锚点 390/1440、1440 零回归）+ φ 间距层级 + 五具名容器查询（route/stat/task/pcard/drawer）+ 动效距离分级与圆角比值文档化 + 死代码清理 + `docs/08-MATH-SYSTEM.md` + `.qa/v05/` 四档实测；`npm run build` 通过 |
| 2026-10-02 | v0.3.0 | 版式与呼吸感重排：版心居中（`--content-max: 1240px`）、统一呼吸词汇（卡片 26 / 行 64）、区块头 / 顶栏 / 侧轨去噪、总览按 C 稿 bento 重排（状态胶囊 + 紧凑日程 + 精简瓦片 + 项目进度卡）、任务筛选披露、收件箱去嵌套、8 视图一致性；`npm run build` 通过 |
| 2026-10-02 | v0.3.0 | 视觉方向重做：采纳草案 C「柔暗夜色」为默认底座，融合草案 B「柔影悬浮」语言，替换 v0.2 硬瑞士风；v2 设计 token（暗色默认 / 亮色暖雾柔光、圆角 16、柔影、强调色 AA 变体）；全站重皮（应用壳 + 全局组件 + 8 视图 + 抽屉）；默认暗色；修复归档 QA 全部缺陷（M1–M5、P7–P10、Polish）；删除死代码 HeatGrid；文档更新（宪法 §5 v2、ADR-0003、设计系统 v2、文件树、CHANGELOG、AGENTS、路线图重编号）；`npm run build` 通过 |
| 2026-10-02 | v0.2.0 | 高保真前端原型交付：应用壳（RailNav/TopBar/StatusBar/AppLayout）、八个视图（总览/收件箱/任务/日程/项目/资料/回顾/设置）、命令面板（cmdk）、全局组件词汇与动效系统（Motion + View Transitions，reduced-motion 全量降级）、双子主题、响应式（含移动端底部标签栏）、原型态 localStorage 层；`npm run build` 通过 |
| 2026-10-02 | v0.1.0 | 文档系统（README、AGENTS、CHANGELOG、TASK_BOOK、docs/01 到 07、ADR 0001 与 0002）；项目宪法 v1；Vite + React + TS 脚手架；路由骨架；文件式数据层；种子数据（任务/事件/项目/目标/习惯/笔记/资源/收件箱/回顾）与元数据 |
