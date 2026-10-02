# TASK_BOOK

KERNEL 的任务台账与迭代记录。记录当前迭代目标、未来待办（backlog）与已完成工作。

约定：每次改代码后在本文件追加记录；当前迭代完成后移入已完成日志。

---

## 下一会话待办（Handoff · 2026-10-02 修订）

> **新会话处理入口**：先读 `AGENTS.md` → 本清单 → 按序处理。每项均附上下文与落点。
> 状态：v0.3.0 已交付（视觉重做 + 版式重排 + 数理自适应 + 界面缺陷修复与全站审阅），`npm run build` 通过；git 仓库已初始化并完成首次提交；dev server 运行于 `http://localhost:5173`。

### A. 验收（所有者）

- [x] **浏览器验收**（2026-10-02 修复轮已由 AI 全量复核：8 视图 × 1280/1920/390 + 折叠/滚动/抽屉/命令面板）。
- [ ] **手机验收**：同一 WiFi 下访问 `http://192.168.0.10:5173`，确认移动端布局（底部标签栏 / 单列 / 全宽抽屉）与操作可用。
- [ ] **修复复核**：打开总览左上角确认品牌锁排完整（"KERNEL" 不再裁切）、顶栏接缝齐平；任务页筛选与分组同一行；日历滚到「现在」后日期条仍可见。

### B. 工程剩余项（按优先级）

- [ ] **v0.4.0 数据服务**（当前最高优先）：范围见下方 Backlog「v0.4 数据服务」——Node 单写者 + 原子写（write-file-atomic）+ Zod 校验 + `data/activity.jsonl` 审计日志 + 前端写入改造。**并将审阅 P0 项并入本迭代**（澄清落地 / 计数口径统一 / proto 写失败告警 / 清除确认 / doneAt / 多标签同步，见 `.qa/review/REVIEW-2026-10-02.md`）。
- [ ] **v0.5.0 opencode AI 接入**：原始核心诉求（丢文件 / 通知 → AI 解析 → 联动日程建议）。直连方案已调研完毕（`opencode serve` + `@opencode-ai/sdk` + SSE + `format: json_schema`），落点见 `docs/02-ARCHITECTURE.md` §4 与 Backlog「v0.5 opencode AI 集成」。
- [ ] **P1 体验项**（原型期可快速做）：任务时间筛选 + `dueAt` 排序 / undo toast / `useNow` 共享刷新 / 日历翻周 / 回顾步骤持久化 + 资料搜索 / a11y 三处（路由移焦、aria、focus 误判）——清单见审阅报告 P1。

### C. 小尾巴（可选，低优先）

- [ ] 种子数据以 2026-10-02 为"现在"；时间久了用 `npm run seed -- --force` 重置演示数据。
- [ ] `design-drafts/`（三份设计稿 + 选型页）保留作方向参考；`.qa/` 证据归档保留（体积小）。

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
- **P1（原型期可做）**：任务时间筛选+排序、undo toast、useNow 共享刷新、日历翻周+deferUntil、回顾持久化+资料搜索、a11y 三处、AI 卡文案动态化。
- **P2（视觉打磨）**：看板空列收敛、Panel 序号统一、指标尺度收敛、顶栏毛玻璃（可选）、ghost 胶囊、移动端统计 2 列（需拍板）。

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

### v0.4 数据服务

- [ ] 引入 Node 单写者数据服务，作为唯一写入路径。
- [ ] 原子写入（write-file-atomic）。
- [ ] Zod schema 校验，写入前全量校验。
- [ ] 审计日志 `data/activity.jsonl`。
- [ ] 前端写入改造为经 API 调用，移除 localStorage 原型态。
- [ ] 数据迁移与备份策略。

### v0.5 opencode AI 集成

- [ ] 本地 Node 服务代理链路：网页 → 本地服务 → `opencode serve`（仅 localhost）。
- [ ] 接入 `@opencode-ai/sdk`：`session.create` / `prompt` / `prompt_async`。
- [ ] 经 `event.subscribe`（SSE）推进度与流式结果。
- [ ] 结构化输出 `format: json_schema`，用于生成待办、摘要、澄清建议。
- [ ] 结果写回 `data/`，敏感操作显式确认。
- [ ] AI 建议卡从占位转为可用。

### v0.6+

- [ ] 回顾流程自动化：自动汇总指标、生成停滞项目清单、建议迁移。
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
| 2026-10-02 | v0.3.0 | 界面缺陷修复与全站审阅：品牌锁排（KERNEL 不再裁切）/ 顶栏接缝对齐（104px 共线）/ Toast 跟随折叠 / `color-scheme` / 任务分组行同行 / 项目卡标签横排 / 0 值柱细基线 / 能量斜纹权重 / 日历日期条吸顶 / 阈值线可见；2 独立代理三视角审阅 + 实机复核（报告 `.qa/review/REVIEW-2026-10-02.md`，19 项分级建议）；git 初始化 + 首次提交；`npm run build` 通过 |
| 2026-10-02 | v0.3.0 | 数理自适应系统：Utopia 流体字号/间距（锚点 390/1440、1440 零回归）+ φ 间距层级 + 五具名容器查询（route/stat/task/pcard/drawer）+ 动效距离分级与圆角比值文档化 + 死代码清理 + `docs/08-MATH-SYSTEM.md` + `.qa/v05/` 四档实测；`npm run build` 通过 |
| 2026-10-02 | v0.3.0 | 版式与呼吸感重排：版心居中（`--content-max: 1240px`）、统一呼吸词汇（卡片 26 / 行 64）、区块头 / 顶栏 / 侧轨去噪、总览按 C 稿 bento 重排（状态胶囊 + 紧凑日程 + 精简瓦片 + 项目进度卡）、任务筛选披露、收件箱去嵌套、8 视图一致性；`npm run build` 通过 |
| 2026-10-02 | v0.3.0 | 视觉方向重做：采纳草案 C「柔暗夜色」为默认底座，融合草案 B「柔影悬浮」语言，替换 v0.2 硬瑞士风；v2 设计 token（暗色默认 / 亮色暖雾柔光、圆角 16、柔影、强调色 AA 变体）；全站重皮（应用壳 + 全局组件 + 8 视图 + 抽屉）；默认暗色；修复归档 QA 全部缺陷（M1–M5、P7–P10、Polish）；删除死代码 HeatGrid；文档更新（宪法 §5 v2、ADR-0003、设计系统 v2、文件树、CHANGELOG、AGENTS、路线图重编号）；`npm run build` 通过 |
| 2026-10-02 | v0.2.0 | 高保真前端原型交付：应用壳（RailNav/TopBar/StatusBar/AppLayout）、八个视图（总览/收件箱/任务/日程/项目/资料/回顾/设置）、命令面板（cmdk）、全局组件词汇与动效系统（Motion + View Transitions，reduced-motion 全量降级）、双子主题、响应式（含移动端底部标签栏）、原型态 localStorage 层；`npm run build` 通过 |
| 2026-10-02 | v0.1.0 | 文档系统（README、AGENTS、CHANGELOG、TASK_BOOK、docs/01 到 07、ADR 0001 与 0002）；项目宪法 v1；Vite + React + TS 脚手架；路由骨架；文件式数据层；种子数据（任务/事件/项目/目标/习惯/笔记/资源/收件箱/回顾）与元数据 |
