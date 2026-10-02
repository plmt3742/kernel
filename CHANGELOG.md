# Changelog

本文件记录 KERNEL 的所有重要变更，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 `v0.x.0` 节奏。

## [Unreleased]

### Planned
- v0.5.0 opencode AI 集成：本地代理链路、`@opencode-ai/sdk`、SSE 流式进度与结构化输出。
- 页面排版多版本设计探索：每页 + 详情面板 / 卡片详情各做多版排版与组件样式方案（风格保持不变），供所有者选型（沿用 `design-drafts/` 选型模式）。

## [v0.4.0] - 2026-10-02

数据服务落地：本地 Node 单写者（`server/`，仅 `127.0.0.1:4097`）成为唯一写入路径——Zod 校验 + 原子写入（write-file-atomic）+ 审计日志（`data/activity.jsonl`）；前端 localStorage 原型层退役，改为「构建期 seed 首帧 + `/api/snapshot` 水合 + 乐观更新写入」；全站审阅确认的 P0 六项一并落地。决策记录：ADR-0004。

### Added
- `server/`：HTTP 入口（`index.mjs`）/ 存储层（`store.mjs`：串行写队列、原子写、nextId、审计）/ Zod schema（`schemas.mjs`，对齐 docs/04）。
- 写入端点：`POST /api/tasks`（快速新建）、`POST /api/tasks/:id/complete`、`POST /api/tasks/:id/reopen`（从审计还原先前状态）、`POST /api/inbox`（捕捉）、`POST /api/inbox/:id/clarify`（→任务 / →项目 / →笔记 / →资源 / 丢弃）、`POST /api/inbox/:id/revert`（撤销澄清并删除产物）；读取端点 `GET /api/snapshot`、`GET /api/activity`、`GET /api/health`。
- `scripts/dev.mjs`：`npm run dev` / `npm run preview` 一体启动数据服务 + Vite；`--host` 等参数透传给 Vite。
- 前端：`src/lib/api.ts`（API 客户端）、`src/lib/mutations.ts`（写入动作：乐观更新 + 失败回滚）、`src/lib/hooks.ts` 增 `useDataRevision` / `useDataSource`。
- 数据服务状态：状态条胶囊（在线 / 离线只读 / 连接中）+ 设置页「数据服务」面板（含最近 8 条审计活动）。
- 多标签同步：窗口聚焦 / 可见时重新水合（`AppLayout`）。Toast 错误态（危险色描边 + 「错误」标签）。

### Changed
- `src/lib/data.ts` 改为可变更快照 + 订阅（构建期 seed 首帧；挂载后经 `/api/snapshot` 水合），全部视图 getter 保持同步 API 不变。
- 完成语义：完成 = `status:'done'` + `doneAt` 落盘（回顾「本周完成」图表开始联动）；已完成任务可重新打开（从审计日志还原先前状态）。
- 收件箱澄清真实落地：条目 `status:'clarified'` + `linkedId` 指向新实体；新任务带 `sourceInboxId` 反指；撤销（revert）删除该次创建。
- 写入失败不再静默：全部失败显式 toast（审阅 P0#3）；乐观更新失败自动回滚。
- 「原型态」语义退役：Toast 标签移除、命令面板「原型标注」组改为「AI · 待接入」、设置页原型态说明改为数据服务面板（「清除本地覆盖」入口一并移除）。
- `vite.config.ts`：新增 `/api` 代理（dev 与 preview）；`data/**` 不再触发 Vite 热重载（避免写入后整页刷新打断撤销窗口）。
- 应用内版本号 → v0.4.0（品牌区、设置页「关于」）。

### Fixed（全站审阅 P0 六项）
- 澄清不落地 / 刷新回滚：澄清、捕捉、快速新建全部真实落盘。
- 跨视图计数口径分裂：单一数据源，总览 / 状态条 / 任务 / 收件箱口径一致。
- proto 写入失败静默：改为显式错误提示 + 回滚。
- 「清除原型态」入口移除：数据以文件为事实源，历史由 git + 审计日志承担。
- 完成态缺 `doneAt`：完成写入 `doneAt`，回顾图表联动。
- 多标签不同步：聚焦 / 可见时重水合。

### Notes
- 验证证据：`.qa/v07/`（服务端冒烟 15 项断言、浏览器端到端断言与截图、离线降级、移动端检查）。
- 写入格式：2 空格缩进 + 尾换行；时间 ISO 8601 带本机偏移；审计日志每行一条 JSON。
- `npm run build`（tsc -b + vite build）通过。

## [v0.3.0] - 2026-10-02

视觉方向重做：采纳设计稿 C「柔暗夜色」为默认基底，融合 B「暖雾柔光」的「柔影悬浮」语言，替换 v0.2 的硬瑞士风；同步修复 `.qa/QA-REPORT-v0.2.md` 归档的全部缺陷。功能、路由、数据层与原型态 localStorage 层保持不变（纯视觉 + 打磨）。

### Added
- 设计方向决策 ADR `docs/decisions/0003-design-direction-v2.md`：C 柔暗 + 柔影悬浮融合，取代硬瑞士 v1。
- v2 设计 token（`src/styles/tokens.css`）：暗色「柔暗夜色」为默认（`bg #0F0F10` / `surface #1A1A1C` / `elevated #212124` / 文字 `#F4F4F5 · #A1A1AA · #929298`），亮色「暖雾柔光」（`#F7F6F3` / 白卡 / `#1C1917` 系）；圆角 16 / 12 / 全圆；柔影 `--shadow-card` / `--shadow-soft` / `--shadow-hover` + 顶部微高光。
- 强调色 AA 文字变体：`--accent-text`（暗底提亮 `#FF8A80` / 亮底加深 `#B3261E`）与 `--accent-on-ink`（反向 ink 填充变体），实测 ≥4.5:1。
- 焦点圈闭工具 `src/lib/focus.ts`（Tab 循环），供命令面板与抽屉复用。
- 背景氛围：暗色三处极淡冷/暖辉光 + 胶片颗粒（内联 SVG，无外部依赖）。

### Changed
- 全站视觉重皮：应用壳（RailNav / TopBar / StatusBar / AppLayout / Drawer / CommandPalette / Toast）与全局组件（Panel / StatTile / TagPill / TaskRow / FilterBar / MeterBar / 图表 / Ticker / DaySpine / EmptyState / Skeleton / Tabs / 标记语言）改为柔影悬浮卡片语言；8 视图（总览 / 收件箱 / 任务 / 日程 / 项目 / 资料 / 回顾 / 设置）与详情抽屉同步。
- 深度改由「表面阶 + 柔影」表达，撤下硬发际线；交互卡片/行悬停 `translateY(-2px)` + 更深柔影（180–240ms），静态容器仅承接柔影不抬升。
- 默认主题改为暗色：`index.html` FOUC 脚本与 `ThemeContext` 在无保存偏好时输出暗色（已保存的用户切换仍优先）。
- 排版转安静：`.u-label` 由大写等宽微标签改为低对比无衬线小字；字号收窄（body 15px、display `clamp(30px,2.8vw,42px)`）。
- 等宽字体栈补 CJK 回退（`PingFang SC` / `Microsoft YaHei` / `Noto Sans CJK SC`），中文在等宽上下文不再豆腐块。
- 版本引用随路线图重编号更新：数据服务 → v0.4、AI → v0.5、自动化/回顾 → v0.6；应用内版本号 → v0.3.0。

### Fixed
- M1：筛选 chip 选中态悬停时文字不可见（color 与 background 同为深色）。选中态提升特异性，`is-selected` 在悬停时保持 `ink` 填充 + `bg` 文字，始终 ≥4.5:1。
- M2：强调色文字压深底对比不足（日历激活日星期标签、Toast「原型态」标签）。改用按表面区分的强调色变体（`--accent-on-ink` / `--accent-text`），实测 ≥4.5:1。
- M3：按钮 reset 缺 `padding:0` 导致已完成勾选图形被挤成 2px。根因修复于 `base.css` 共享 reset，`.k-check` 与 `.k-task__open` 一并恢复正常。
- M4：日历「现在」线在 1440×900 首屏折叠之下。进入日历时自动滚动至当前时刻附近，并新增「回到现在」控件（不破坏日脊）。
- M5：命令面板与抽屉声明 `aria-modal` 却无焦点圈闭、关闭后不还原焦点。实现 Tab 焦点圈闭 + 关闭后还原焦点到触发元素。
- P7：停止将强调色用作图表数据系列填充（能量分布改为纯单色阶 + 图案）。
- P8：总览 TODAY 瓦片不再因逾期 >0 而把「已完成」计数标红，改为在脚注中单独标记逾期指标。
- P9：token 纪律——统计值改走 `--text-display`；间距回到 4px 体系；动效时长/曲线统一走 `--dur-*` / `--ease-*` / `DUR` / `EASE_*`，去除内联魔法数。
- P10：删除死代码 `src/components/HeatGrid.tsx`（零引用）；日脊事件设最小高度，超短事件不再被裁剪。
- Polish：日历完整日期不再补零（`10月2日`，非 `10月02日`）。
- 验收修复：命令面板关闭后焦点还原失败（`autoFocus` 在 `focusin` 监听卸载前抢焦点，记录错位）。改为 `focusin` 追踪 + 忽略面板自身与 `body`，关闭时校验 `isConnected` 后还原；抽屉路径复核通过。
- 验收修复：命令面板水平居中失效（Motion 内联 `transform` 覆盖 CSS `translateX(-50%)`）。改为 `left/right:0 + margin:0 auto` 居中（不依赖 transform），实测居中。
- 验收修复：灰阶对比校正（设计系统「灰字 ≥4.5:1」）——暗色 `--muted` `#6E6E73 → #929298`；亮色 `--ink-2` `#78716C → #665F59`、`--muted` `#A8A29E → #6E6862`。含填充合成表面全部 ≥4.5:1。

### Notes
- 归档的 v0.2 截图与 `QA-REPORT-v0.2.md` 保持不变；本次复核证据另存 `.qa/v0.3/`。
- 语法/严格类型与生产构建：`npm run build`（tsc -b + vite build）通过。

### 版式重排（2026-10-02 · 对齐设计稿 C）

所有者复核指出「页面排版不合理、组件安排不合理、缺少呼吸感、没有统一设计感」。根因：v0.3 只换了色彩与 token，沿用 v0.2 的密集通栏布局。本次在不改功能/数据/路由的前提下，按已批准的 `design-drafts/c-soft-dark.html` 重排全站版式与呼吸感。

#### Changed
- 版心居中：新增 `--content-max: 1240px` 与居中 `.k-route` / `.k-topbar__inner`，`--page-margin` 收敛为 `clamp(20px, 3.2vw, 44px)`；内容不再通栏拉伸到约 1344px。
- 统一呼吸词汇：新增 `--pad-card: 26px` / `--row-min: 64px`；Panel / StatTile / 各卡片 / 列表行 / 抽屉内块统一内边距与行高，列表行最小高度 64px。
- 区块头去噪：Panel 撤下「01 —」编号与前置斜杠，改为「标题 + 安静英文小标签」；EmptyState 同步撤下编号。
- 顶栏去噪：撤下「01 /」数字噪音；标题降为 `--text-h2` 与英文小标签成对，顶栏内容居中并与版心对齐。
- 侧轨简化：导航项由「图标 + 英文 + 中文」三行收敛为「图标 + 中文」单一层级并加大间距；移动端底部标签栏保持不变。
- 总览按 C 稿重排：密集 Ticker 信号带 → 安静状态胶囊行；全高 24h 日脊 → 紧凑日程列表（时间 + 标题 + 地点，≤6 行；日程页保留全高日脊）；统计瓦片由 5 层（英文标签 + 中文标签 + 大数字 + 计量条 + 脚注）精简为「大数字 + 中文标签 + 一条安静副行」（仅收件箱水位保留计量条）；下一步行动精简为「上下文 + 能量 + 截止」；移除与瓦片重复的「存量与流量」整卡，改为右栏紧凑「项目」进度卡，形成「左栏（日程 + 行动）/ 右栏（项目）」的 bento 布局；AI 建议卡保留并置于末尾。
- 任务筛选收敛：状态 chip 保持单行，上下文 / 能量 / 区域 / 身份收进「更多筛选 MORE」披露区；分组切换与筛选左对齐，消除中部空洞。
- 收件箱去嵌套：未澄清项由「卡片套卡片」改为面板内扁平列表行（发际线分隔 + 悬停反馈）。
- 视图一致性：日历（周条加高、议程列加宽）、项目看板卡、资料列表行、回顾（上下两排等宽）、设置卡片内边距统一到同一呼吸词汇。
- token 保持唯一事实源：新增 `--content-max` / `--pad-card` / `--row-min`，视图内零内联魔法值。

#### Fixed
- 通栏拉伸导致的超长行与无视觉中心（≥1440px）。
- 总览日脊过高（约 1344px）压制首屏、Ticker 密集滚动带的信息噪音。
- 任务页 35+ 筛选 chip 墙（5 行）与分组行的中部空洞。
- 收件箱嵌套双层容器与重复内边距。
- 回顾上下两排栅格比例不一致（本周完成 / 能量分布不等宽）。
- 不回归既有质量项：命令面板焦点还原与 `margin:0 auto` 居中、灰阶对比 token、选中 chip 可读性、reduced-motion 全部保持不变。

### Notes
- 版式重排证据另存 `.qa/v04/`；`design-drafts/**`、`data/**`、既有 `.qa/v03` 证据与 `QA-REPORT-v0.2.md` 保持不变。
- `npm run build`（tsc -b + vite build）通过。

### 数理自适应系统（2026-10-02 · 公式驱动 + 容器自适应）

在版式重排基础上，将几何系统升级为公式驱动：字号与间距改为 Utopia 流体 `clamp`，组件内部改用容器查询。原则：1440px 保持既有视觉尺寸，流体仅在 <1280 收紧、>1280 打开。

#### Added
- 流体字号表（tokens.css §5.3）：caption→display 改为 `clamp(MIN, INTERCEPT + SLOPE·vw, MAX)`，锚点 390/1440；micro 保持固定。
- 流体间距表（tokens.css §5.4）：`--space-5..10`、`--pad-card`、`--row-min`、`--page-margin` 流体化；微步 4/8/12/16 固定（保 4px 栅格 + 行内对齐）。
- φ 间距层级：`--rhythm-inner/element/section/page` = 1 : φ : φ² : φ³（10.4 / 16.83 / 27.23 / 44.05 @1440），落在 panel 头 / chips / `.k-view` / 页边距。
- 容器查询层：`route`（版心）/ `stat`（瓦片）/ `task`（任务行）/ `pcard`（看板卡）/ `drawer`（抽屉）五个具名容器；组件内部自适应改由容器宽度驱动。
- 文档 `docs/08-MATH-SYSTEM.md`：方法论、字号/间距流体表、φ 层级表、容器地图、动效常数、复算与验证方法。
- 验证证据 `.qa/v05/`：1280/1440/1680/390 四档截图 + 程序化实测（流体与容器行为数值）。

#### Changed
- 总览统计瓦片、看板、日历主体、回顾分区、设置栅格、任务过滤行/行内 meta 的断点由视口媒体查询改为容器查询；shell（导航轨道 / 顶栏 / 移动底栏）仍用媒体查询。
- 动效曲线对齐：`EASE_STANDARD` 与 CSS `--ease-standard` 统一为 `cubic-bezier(.22,.61,.36,1)`；`lib/motion.ts` 补距离分级与 stagger 公式注释。
- 散文约束统一到 `--measure: 65ch`；勾选框改用 `em` 相对尺寸随流体字号缩放。
- 圆角比值（16 / 12 / pill）与动效距离分级在 tokens 内文档化。

#### Removed
- 死代码：`src/components/Ticker.tsx` + `.k-ticker*` CSS（总览已用状态胶囊替代）、`src/components/charts/Sparkline.tsx` + `.k-spark*` CSS、`.k-heat*` CSS（HeatGrid 已于 v0.3 删除）、`.k-overview__flows`、`.k-task__rank`、`.k-rail__en` 选择器、DaySpine mini 变体与 `.k-spine--mini` CSS、未用 token `--pad-row`。

### Notes
- 数理自适应证据另存 `.qa/v05/`；`design-drafts/**`、`data/**`、既有 `.qa/v03|v04` 证据与 `QA-REPORT-v0.2.md` 保持不变。

### 文档一致性修订（2026-10-02 · 收尾）

- 全量同步 20 处失同步：宪法总览规格（Ticker→状态 chips、迷你日脊→ScheduleList）与 §5 流体数值/间距/网格；设计系统（display 流体公式、容器查询、动效清单、组件词汇、删除组件注记）；文件树补 `docs/08`；文档索引补 08 与 ADR-0003；`AGENTS` / `01` / `02` / `CHANGELOG` 的「待接入 v0.4 → v0.5」徽标顺延；路线图补记三个追加波次；删除零引用 token `--gutter`。
- `TASK_BOOK.md` 新增「下一会话待办」：验收 → git 初始化 → v0.4 数据服务 → v0.5 AI 接入。

### 界面缺陷修复（2026-10-02 · 品牌锁排 / 接缝对齐 / 审阅缺陷）

所有者反馈左上角品牌区疑似被遮盖。复核确认：`KERNEL` 字标在 96px 索引轨道内溢出被裁切（仅显示 "KERNE"），且轨道品牌行（104px）与顶栏（84.8px）底边发际线错位约 19px。本次修复该缺陷及全站审阅确认的其余缺陷；功能、数据、路由不变。

#### Fixed
- 品牌锁排：`.k-rail__brand` 改「K 标 / KERNEL / 版本」垂直居中锁排，96px 轨道内完整显示（实测 scrollWidth 95 = clientWidth 95，零溢出）；折叠态仅保留 K 标。
- 接缝对齐：`.k-topbar` 增加 `min-height: var(--topbar-h)` + 垂直居中，与轨道品牌行共享 104px 基准，两条底边发际线连成一线；移动端保持自适应高度（`min-height: 0`）。
- Toast 跟随折叠：折叠态同步 `<html data-rail>`（`AppLayout.tsx`），`.k-toasts` 偏移改 `calc(var(--rail-current) + …)`（展开 120px / 折叠 88px 实测）。
- 原生控件主题化：`:root` / `[data-theme='light']` 声明 `color-scheme`，暗色下原生滚动条/控件不再呈现亮色。
- 任务页：groupbar 内 `.k-collapse-head` 保持自身宽度，「更多筛选 MORE」与分组切换回到同一行（原 `width:100%` 独占整行导致换行与约 90px 垂直空档）。
- 项目页：`.k-pcard__next .u-label` 禁止挤压换行，「下一步」不再竖排断字。
- 回顾页：`TrendBars` 0 值柱改 2px 平基线（原 4px 圆头短柱与实值柱混淆）；低能斜纹改 `--muted` 并放宽间距，能量分布感知权重恢复 低<中<高。
- 日历：`.k-cal__bar` 桌面端吸顶（`top: var(--topbar-h)`），自动滚动到「现在」后仍保留日期与「回到现在」上下文。
- 度量条阈值线改为可见（`--muted` / 0.7，原 `--bg` 不可见）。
- `.gitignore` 增补 `.playwright-mcp/`、`.codegraph/`、`.omo/`。

#### Notes
- 审阅证据与报告：`.qa/review/`（8 视图截图 + `REVIEW-2026-10-02.md`，含剩余 19 项分级建议）；修复复核截图：`.qa/issue/`。
- 审阅其余发现（原型态数据一致性 P0、任务时间筛选、撤销/确认、看板空列等）已列入 `TASK_BOOK.md`「审阅发现（Review Findings）」跟踪，其中 1–6 建议并入 v0.4 范围。
- `npm run build`（tsc -b + vite build）通过。

### 体验增强（2026-10-02 · 审阅 P1 第一批）

落地 `.qa/review/REVIEW-2026-10-02.md` 审阅建议的 P1 前几项：任务时间维度、撤销、统一时间刷新、AI 卡动态计数。功能、数据、路由不变（原型态纪律保持）。

#### Added
- 任务页「时间」筛选组：逾期 / 今天 / 本周（周一–周日区间落点），与状态筛选组合生效。
- 任务默认排序：截止近者优先（无截止垫底）→ 重要性 → id 稳定（`byDueTask`）。
- 任务深链：`/tasks?task=<id>` 直达任务详情抽屉；总览「下一步行动」点击直达对应任务（原仅跳转列表页），关闭抽屉时清理查询参数。
- Toast 动作支持（`ToastOptions.action`；带动作默认停留 5s，动作按钮 click 后即消失）：完成任务、取消完成、收件箱任一澄清动作（含丢弃）均可 5s 内「撤销」。
- `src/lib/hooks.ts`：`useNow`（统一 60s 时刻刷新）与 `useUndoableToggle`（完成切换 + 撤销，返回 wasDone）。
- 总览「下一步行动」勾选完成支持撤销；AI 建议卡第 2 条数字改为动态（收件箱含原型态捕捉）。

#### Changed
- 时刻口径统一：总览 / 日历 / 任务 / 资料 / 收件箱 的相对时间与「今天」判定全部走 `useNow`，每 60s 自动刷新（原仅总览与日历带定时器，任务 / 资料 / 收件箱渲染时取一次）。
- 总览收件箱计数对齐：`getInboxCount() + protoInbox.length`（与状态条、收件箱页未澄清数同口径；完整数据源统一仍属 v0.4 范围）。

#### Notes
- 验证证据 `.qa/v06/`（时间筛选 / 排序 / 深链 / 撤销断言与截图，控制台无错误）；`npm run build`（tsc -b + vite build）通过。
- 审阅 P1 剩余项：日历翻周 + `deferUntil`、回顾步骤持久化 + 资料搜索、a11y 三处——保留在 `TASK_BOOK.md` Handoff。

## [v0.2.0] - 2026-10-02

高保真前端原型。在 v0.1 的文档系统、脚手架与文件式数据层之上，实现完整的可演示 UI、动效系统与移动端适配。所有用户可变操作仅写 localStorage 覆盖层，`data/**` 保持只读。

### Added
- 应用壳（`src/components/shell/`）：RailNav（展开 96px / 收起 64px 索引轨道，折叠状态持久化，移动端转底部标签栏）、TopBar（章节序号 + 瑞士式大标题 `01 / 总览 OVERVIEW` + 命令入口 + 主题切换）、StatusBar（实时时钟 / INBOX / WIP / 数据快照 / AI 状态 / PROTO 标识）、AppLayout（布局路由 + 路由进入动效 + 全局快捷键 `Ctrl/Cmd+K`、`c`）。
- 八个视图：
  - 总览 OVERVIEW：Ticker 信号带、4 统计瓦片（收件箱水位 / 今日任务 / WIP / 刷题连续，含计数动画）、今日日脊 mini（含 Now 线）、下一步行动 TOP 6（展示排序依据标签）、存量与流量面板、AI 建议卡占位。
  - 收件箱 INBOX：快速捕捉（快捷键 `c` 聚焦）、水位 MeterBar、未澄清列表（来源图标 / 相对时间 / 澄清操作条 `→任务 / →项目 / →笔记 / →资源 / 丢弃`）、已澄清与已丢弃折叠区。
  - 任务 TASKS：未完成/逾期/今日计数、筛选条（状态/上下文/能量/区域/身份）、分组切换（平铺/按项目/按上下文）、行内完成划线 + 塌缩动效、行内快速新建、全字段详情抽屉（标记完成可用）。
  - 日程 CALENDAR：0–24h 垂直日脊、事件块重叠分列、实时"现在"线（每分钟更新 + 呼吸）、全天事件条、周条密度 mini 地图、前一天/今天/后一天导航、事件详情抽屉。
  - 项目 PROJECTS：四列看板（进行中/暂停/将来/已完成）、卡片含 outcome、下一步、进度 MeterBar、区域标记、截止；详情抽屉含项目任务清单。
  - 资料 LIBRARY：笔记 + 资料混合流、按标签页/类型/状态/标签筛选、笔记蒸馏度指示、react-markdown 阅读抽屉含反向链接、资料抽屉含链接与备注。
  - 回顾 REVIEW：当前周期摘要（2026-W40 + 9 月）、"开始周回顾"五步流程抽屉、本周指标计数、单色图表（TrendBars + EnergyBars）、停滞项目清单（迁移/归档演示）。
  - 设置 SETTINGS：主题切换、数据统计表、AI 集成状态（OFFLINE + 路线图）、关于 KERNEL、原型态说明与清除入口。
- 命令面板（cmdk）：`Ctrl/Cmd+K` 开关、导航 / 动作 / 原型标注三组、墨底纸字反选行、全键盘导航、fade + 4px 升起 180ms、`↑↓ 导航 · ↵ 选择 · esc 关闭` 页脚提示。
- 全局组件词汇（`src/components/`）：Panel / StatTile / TagPill / Checkbox / TaskRow / Drawer / FilterBar / MeterBar / Sparkline / TrendBars / HeatGrid / EnergyBars / Ticker / DaySpine / EmptyState / Skeleton / Toast / CountUp。
- 动效系统（Motion + View Transitions API）：路由进入（fade + 6px 升起）、列表 stagger 入场（60ms 步进，前 12 项）、数字滚动、完成任务划线 + 塌缩、悬浮反转（TagPill / 行 / 面板项）、Now 线呼吸、Ticker 横向滚动（悬浮暂停）、命令面板出入场；统一由 `MotionConfig reducedMotion="user"` + CSS `prefers-reduced-motion` 降级。
- 原型态本地层（`src/lib/proto.ts`）：任务完成写 `kernel:proto:done`、收件箱捕捉写 `kernel:proto:inbox`、快速新建任务写 `kernel:proto:tasks`，并通过订阅跨视图联动；界面以「原型态」明确标注，不写入 `data/`。
- 主题系统：`useTheme` + localStorage `kernel-theme`，默认系统偏好，首帧 FOUC 防护沿用 `index.html` 内联脚本。
- 响应式：≥1280px 全尺寸；768–1280px 图标轨道；<768px 底部标签栏 + 精简状态条 + 单列布局 + 全宽抽屉，适配至约 390px。
- 设计系统落地：`src/styles/` 五个文件（tokens / base / shell / components / views），全部使用 token、零圆角、发际线；新增透明度辅助 token 与自托管可变字体族并入字体栈。
- 工程：资料页按需加载（`React.lazy`）以压缩首屏包体；`npm run build`（tsc + vite）通过。

### Notes
- AI 能力仅为 UI 预留（AI 建议卡、命令面板入口），标注"待接入 v0.5"（当时代号 v0.4，路线图重编号后顺延）。
- 原型态的澄清 / 迁移 / 归档为演示动作 + 提示，计划 v0.3 起持久化写入 `data/`。

## [v0.1.0] - 2026-10-02

工程地基。建立文档系统、前端脚手架与文件式数据层，作为后续所有迭代的基线。

### Added
- 文档系统：`README.md`、`AGENTS.md`、`CHANGELOG.md`、`TASK_BOOK.md`、`docs/01` 到 `docs/07`、`docs/decisions/0001` 与 `0002`。
- 项目宪法 `docs/00-DESIGN-BRIEF.md`（v1，2026-10-02）。
- 工程脚手架：Vite + React 19 + TypeScript（strict）+ 原生 CSS token 体系。
- 路由骨架：`/` 总览、`/inbox`、`/tasks`、`/calendar`、`/projects`、`/library`、`/review`、`/settings`。
- 数据层（v1 文件式）：`data/` 下按实体分目录、一记录一文件的 JSON；前端经 `src/lib/data.ts` 读取。
- 种子数据：任务 40 到 60 条、事件 15 到 20 条、项目 8 到 10、目标 6 到 8、习惯 4 到 6、笔记 10 到 15、资源 10 到 15、收件箱 5 到 8、回顾 2 条，以 2026-10-02 为"现在"。
- 元数据：`data/meta/config.json`、`data/meta/tags.json`。

### Notes
- v0.1.0 不含数据服务与 AI 接入，两者分别规划在 v0.3.0 与 v0.4.0。
- 数据字段规范见 `docs/04-DATA-MODEL.md`；目录职责见 `docs/05-FILE-TREE.md`。
