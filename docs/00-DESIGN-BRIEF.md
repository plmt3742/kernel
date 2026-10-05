# KERNEL · 设计总纲（Master Design Brief）

> 00 号文件 · 项目宪法 · v1 · 2026-10-02
> **v2 · 2026-10-02 · 方向变更：C 柔暗 + 柔影悬浮，见 ADR-0003**
> **v3 · 2026-10-02 · 版式重排 + 数理自适应：版心 1240 / 流体公式 / 容器查询 / φ 层级，见 `docs/08-MATH-SYSTEM.md`**
> 本文件是 KERNEL 的事实源（source of truth）。任何会话 / 代理 / 协作者在动代码或数据前，先读完本文件。
> 除项目所有者明确要求外，本文件不随版本迭代随意改动；重大方向调整走 `docs/decisions/` ADR。

---

## 1. 项目身份

| 项 | 值 |
|---|---|
| 名称 | **KERNEL**（目录名 `kernel`，位于 `<workspace>\kernel`） |
| 定位 | 个人事务内核 —— 记录、管理、解析、调度用户的一切事务；本地优先、AI 协作、为"类助手"而生 |
| 隐喻 | 操作系统内核：进程 = 任务/项目 · 内存 = 资料/知识 · I/O = 收件箱/通知 · 调度器 = 日程 · 检索 = 命令面板 · GC/平衡环 = 回顾 |
| 一句话哲学 | **文件即数据库，opencode 即大脑，网页即驾驶舱** |
| 版本节奏 | v0.1 文档+基建+数据 → v0.2 高保真前端原型 → v0.3 视觉重做（C 柔暗 + 柔影悬浮）→ v0.4 数据服务 → v0.5 AI 接入 → v0.6 自动化与检索 → v1.0 稳定 |
| 语言 | 界面与文档：中文为主 + 英文小标签点缀（安静小灰字，不重排大写等宽）；代码标识符英文 |

---

## 2. 用户画像与设计立场

- 某高校 · 工业软件专业 · 大二；vibecoding 重度用户，大量项目位于 `<workspace>`
- 身份（**均为交叉筛选标签，禁止做成目录分区**）：
  `role:student`（学生）· `role:assistant`（辅导员/学生助理）· `role:competition-head`（学生组织部长）· `role:acm`（算法实验室成员，Codeforces 刷题）· `role:monitor`（班长）· `role:vibecoder`（独立开发者）
- 近期待办：准备 **demo 开发实验室** 面试
- 品味要求：INS 黑白极简 × 瑞士国际主义 × 未来主义动效；重视体验流畅、美感、设计合理性；双主题（亮/暗）

**核心立场（用户明确要求）：不按"学生组织""学生助理"等领域/身份分区。** 系统必须是通用的：身份与领域只作为视图内的交叉筛选器（tag），一级信息架构只呈现通用循环。

---

## 3. 系统模型（研究结论，构建时不可偏离）

**设计原则（按强度排序）：**

1. **单一循环**：捕捉 → 澄清 → 组织 → 执行 → 回顾（GTD 引擎）
2. **按可行动性组织**，不按身份/学科/领域分区（PARA 精神）
3. **一切分类有界**：标签命名空间化（`role:` `topic:` `context:`），数量设上限思路，防止标签爆炸（Johnny.Decimal 精神）
4. **迁移即重决策**：过期项必须"重写或丢弃"，不允许无声堆积（Bullet Journal 精神）
5. **每个存量都有排泄口**：收件箱水位、WIP 计数、逾期计数在总览可见（系统思维：存量/流量/反馈环）
6. **周回顾是心跳**：短、可视、可自动化（平衡环）
7. **身份与领域 = 交叉筛选标签，不是容器**（本项目"通用性"的核心）
8. **蒸馏要懒惰**：资料只在重读时整理（progressive summarization）

**通用实体（v1 承载 11 类）**：inboxItem / task / project / area / goal / habit / event / course / note / resource / review
**schema 预留（不实现）**：timeLog / person / journalEntry

**通用轴（6）**：上下文（第一筛选）· 时间与紧急 · 能量 · 重要性 · 状态 · 有界标签

**信息架构**：一级导航 = 通用循环的**分层呈现**——总览置顶（驾驶舱），其余按功能分四组：**行动**（收件箱 / 任务 / 项目 / 回顾）· **时间**（日程 / 课表）· **记录**（资料 / 习惯 / 踪迹）· **系统**（设置；回收站已并入设置·数据管理，见 ADR-0042）；身份、领域、上下文、能量均为视图内**筛选器**。分组决策见 ADR-0041。

---

## 4. 信息架构与视图规格

**导航**：左侧索引轨道（Index Rail，展开 96px / 收起 64px 图标态），组间分隔 + 安静组标签（总览 / 行动 / 时间 / 记录 / 系统，**组头可折叠**、状态持久化，见 ADR-0041 §6）；移动端（<768px）变底部标签栏，仅保留 5 个核心项 + 「更多」（命令面板）。桌面轨道 / 命令面板 / 移动底栏**同源同组**。
**底部状态条（终端感，StatusBar）**：当前时间 / INBOX 水位 / WIP / 数据快照时间 / AI 状态（OFFLINE）。

各视图优先级：P0 = 必须做透；P1 = 完整可用；P2 = 可用即可。

### 总览 OVERVIEW（P0）
- 顶部状态 chips：下一项事件 · 收件箱水位 · 逾期计数（安静胶囊行）
- 统计瓦片 ×4：收件箱水位（含 meter）· 今日任务（完成/总）· WIP 项目数 · 刷题连续天数（大数字 + CN 标签 + 一行脚注）
- 今日日程（ScheduleList 紧凑列表：时间 + 标题 + 地点；下一项高亮）
- 下一步行动 TOP 6：meta 精简（上下文 + 能量 + 截止）
- 项目进度卡（右栏：进度条 + 状态徽章）——原「存量与流量」并入瓦片
- AI 建议卡（占位，徽标"待接入 v0.5"，安静收尾）

### 收件箱 INBOX（P0）
- 顶部快速捕捉输入框（快捷键 `c` 聚焦）
- 未澄清列表：来源图标 / 捕获时间 / 内容
- 每条含"澄清"操作条：→ 任务 / → 项目 / → 笔记 / → 资源 / 丢弃（原型期：前端动作 + 说明，不持久化）

### 任务 TASKS（P0）
- 筛选条：上下文 chips / 能量 / 区域 / 身份 / 状态
- 列表：分组切换（按项目 | 按上下文 | 平铺）；行内快捷完成（动效：划线 + 塌缩）
- 行内快速新建；详情居中弹窗（全字段展示 + 编辑 / 删除；见 ADR-0009 / 0012）

### 日程 CALENDAR（P0）
- 日视图：垂直日脊（0–24h）+ 事件块 + 当前时间线（实时移动）
- 周条：一周密度 mini 地图；空状态设计

### 项目 PROJECTS（P1）
- 看板 4 列：active / onHold / someday / done；卡片含 next action + 进度 + 区域标记（单色，图案区分而非彩色）
- 详情居中弹窗：目标、下一步、任务清单

### 资料 LIBRARY（P1）
- Notes + Resources 混合流；类型筛选；标签过滤（有界视觉）
- 阅读居中弹窗：Markdown 渲染（react-markdown）

### 回顾 REVIEW（P1）
- 周回顾流程 UI（步骤：清空收件箱 → 审视项目 → 统计 → 决策 → 完成）
- 计数器：本周完成 / 新增 / 逾期 / 迁移；单色图表（趋势柱 + 能量分布）
- 停滞项目清单（重决策入口：迁移或归档）

### 设置 SETTINGS（P2）
- 主题切换、数据统计（记录数）、AI 集成状态（OFFLINE + 路线图）、关于

**全局**：命令面板（`Ctrl+K`，cmdk：导航 / 新建 / 切主题 / 未来 AI 指令入口）· 键盘：`c` 捕捉、`g+?` 跳转（可选）· 主题 FOUC 防护（首帧前读 localStorage）

---

## 5. 设计系统 v2（token 级，构建时严格遵守）

> v2 方向：**C 柔暗夜色（默认）+ B 柔影悬浮融合**，见 `docs/decisions/0003-design-direction-v2.md`。
> 纪律：柔暗为默认、深度靠"表面阶 + 柔影"而非硬边线、圆角 16、单一强调色仅作信号、亮/暗共享几何与排版。

### 5.1 色彩（唯一强调色仅用于焦点/激活/信号，永不大面积填充或作数据系列）

暗色「柔暗夜色」——默认主题（无保存偏好时即此套）：
```css
--bg:#0F0F10; --surface:#1A1A1C; --surface-elevated:#212124; --surface-sunken:#141416; --surface-hover:#232327;
--ink:#F4F4F5; --ink-2:#A1A1AA; --muted:#929298;
--outline:rgba(255,255,255,.06); --outline-strong:rgba(255,255,255,.12);
--accent:#FF5A52; --accent-text:#FF8A80; --accent-on-ink:#B3261E; --accent-ink:#0F0F10;
--success:#4CAF7D; --warning:#D08A2B; --danger:#F87171;
```

亮色「暖雾柔光」（draft B 语言）：
```css
--bg:#F7F6F3; --surface:#FFFFFF; --surface-elevated:#FFFFFF; --surface-sunken:#F1EFE9; --surface-hover:#FBFAF8;
--ink:#1C1917; --ink-2:#665F59; --muted:#6E6862;
--outline:#EDE9E3;
--accent:#D62828; --accent-text:#B3261E; --accent-on-ink:#FF8A80; --accent-ink:#FFFFFF;
--success:#1D6B3C; --warning:#B26A00; --danger:#B91C1C;
```

- 强调色文字必须用可过 AA 的变体：暗底表面用 `--accent-text`（`#FF8A80`），亮底表面用 `--accent-text`（`#B3261E`）；强调色压在 ink 填充上时改用 `--accent-on-ink` 反向变体
- 深度=表面阶 + 柔影；不用纯黑纯白铺满全屏底
- 语义色仅用于状态上下文，且必须同时有图标/文字，禁止仅靠颜色传达信息（WCAG 1.4.1）
- 构建后必须验证对比度（正文 ≥7:1，UI ≥4.5:1，强调色文字 ≥4.5:1）

### 5.2 字体（本地打包、离线可用、禁止 CDN）

```css
--font-sans:"Inter Variable","Inter","PingFang SC","HarmonyOS Sans SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif;
--font-mono:"JetBrains Mono",ui-monospace,"SF Mono",Consolas,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",monospace;
```

@fontsource 自托管：`@fontsource-variable/inter` + `@fontsource/jetbrains-mono`（按需字重）。等宽栈须含 CJK 回退，避免中文豆腐块。

### 5.3 字号（双层比例：UI 1.25 / 展示层；v2 收窄，贴合柔暗基调）

| token | 值 | 行高 | 字距 | 用途 |
|---|---|---|---|---|
| micro | 11px | 1.3 | +0.02em | 安静小标签 |
| caption | 12px | 1.45 | +0.01em | 元数据 |
| body-sm | 13px | 1.55 | 0 | 密集表格 |
| body | 15px | 1.65 | 0 | 正文 |
| h4 | 18px | 1.3 | -0.01em | |
| h3 | 22px | 1.25 | -0.012em | |
| h2 | 27px | 1.2 | -0.015em | |
| h1 | 34px | 1.12 | -0.02em | |
| display | clamp(30px, calc(26.167px + 0.9829vw), 42px) | 1.08 | -0.02em | 统计数字（走 token，禁止内联） |

- 上表为 **1440 锚点值**；实际 token 为 Utopia 流体 `clamp`（锚点 390→1440，1440 保持既有值），公式见 `docs/08-MATH-SYSTEM.md`
- 层级优先靠**尺寸与字重**，不靠大写等宽重排；v2 撤下大写微标签做法
- 数字一律 `tabular-nums`；时间 / ID 用等宽字体（含 CJK 回退）

### 5.4 间距 / 网格 / 形状

- 间距：4px 基线；微步（4/8/12/16）固定，大步（≥24）流体 `clamp`（390 收紧 → 1440 锚点 → 封顶）；φ 层级 inner : element : section : page = 1 : φ : φ² : φ³（公式见 `docs/08-MATH-SYSTEM.md`）
- 网格：12 列；左索引轨道 96px（收起 64px）；版心居中 `--content-max: 1240px`；页面边距流体（20→44px）；正文 measure ≤65ch
- **圆角 16**（卡片）/ 12（内部件）/ 全圆（胶囊）；边缘至多 `rgba(255,255,255,.06)`（暗）或 `#EDE9E3`（亮），不用硬发际线
- **柔影悬浮**：卡片/面板/瓦片静置即带柔影（大模糊、低透明度）与一道极淡顶部高光；交互卡片/行悬停 `translateY(-2px)` + 更深更广柔影 + 边缘微亮，180–240ms
- 移动端：单列堆叠，轨道变底部栏，状态条精简

### 5.5 动效（有目的的运动，不是装饰）

```css
--dur-instant:80ms; --dur-micro:120ms; --dur-fast:180ms; --dur-base:240ms; --dur-slow:400ms; --dur-page:560ms;
--ease-standard:cubic-bezier(.22,.61,.36,1); --ease-enter:cubic-bezier(.16,1,.3,1); --ease-exit:cubic-bezier(.4,0,1,1);
```

- 技术栈：**Motion**（组件状态 / 布局 / layoutId 共享元素 / 手势）+ **View Transitions API**（路由级变形，react-router `viewTransition` prop）+ **cmdk**（命令面板）。不引入 GSAP
- 技法清单：① 路由共享元素变形 ② 列表 stagger 入场（60ms 步进）③ 数字滚动 ④ 完成任务划线+塌缩 ⑤ 交互卡片/行悬停柔影抬升（translateY(-2px)，180–240ms）⑥"现在"指示线呼吸 ⑦ 命令面板 fade + 4px 升起 150–200ms
- **Token 纪律**：时长/曲线一律走 `--dur-*` / `--ease-*` / `DUR` / `EASE_*`，禁止内联魔法数
- **无障碍强制**：`MotionConfig reducedMotion="user"` + CSS `prefers-reduced-motion`；焦点环 2px；键盘全可达

### 5.6 组件签名词汇（命名与形态统一）

CommandPalette / StatusBar / RailNav / TopBar / Panel（柔影卡片）/ StatTile（柔影瓦片）/ TagPill（胶囊，选中=ink 填充+bg 文字）/ DaySpine / ScheduleList / TaskRow / TaskBoard / Modal（详情居中弹窗，含 TaskDetailModal / ProjectDetailModal）/ FilterBar / MeterBar / EnergyBars / TrendBars / EmptyState / Skeleton / Toast（克制）

### 5.7 可读性纪律（柔暗风格陷阱防线，逐条对照）

**DO**：正文 15px/1.65；measure ≤65ch；正文对比 ≥7:1；尺寸与字重优先于颜色做层级；安静小灰标签；焦点可见；色盲安全；深度用表面阶+柔影
**DON'T**：不大面积强调色；不用强调色作图表数据系列；不用纯黑纯白满屏底；不居中构图（左对齐为主）；灰字不低于 4.5:1；不用硬发际线作唯一边界；不为炫技加动效

---

## 6. 技术架构

### 6.1 栈决策

- **Vite + React 19 + TypeScript（strict）+ 原生 CSS（CSS 变量 token 体系，不使用 UI 框架 / Tailwind）**
- 依赖白名单：`react` `react-dom` `react-router-dom`（viewTransition）`motion` `cmdk` `date-fns` `clsx` `lucide-react` `react-markdown` `@fontsource-variable/inter` `@fontsource/jetbrains-mono`
- 状态：React 内置（Context + hooks）；原型期用户操作写 localStorage（UI 标注"原型态"）
- 路由：`/` 总览 · `/inbox` · `/tasks` · `/calendar` · `/timetable`（课表）· `/projects` · `/habits`（习惯）· `/library` · `/review` · `/settings` · `/trash`（回收站）；`/profile`（个人，顶栏头像进入，不占一级导航）

### 6.2 数据层（v1：一记录一文件）

- 数据源：`kernel/data/**`（见 §7）；前端经 `src/lib/data.ts` 读取（`import.meta.glob('/data/**/*.json')` + 类型化 getter；dev 下数据改动热更新）
- 规范：JSON UTF-8；ID 稳定（`t-0001` 式）；时间 ISO 8601 带偏移；字段见 §7
- **数据服务（v0.4 已交付）**：Node 单写者数据服务（唯一写入路径）+ 原子写入（write-file-atomic）+ Zod 校验 + 审计日志（activity.jsonl）；浏览器写入经 API，禁止多进程直接写文件
- 禁止：前端直接写文件；在 JSON 中存储计算派生值（进度等一律运行时计算）

### 6.3 opencode 集成（已调研，路线图 v0.4/v0.5）

- 事实：opencode 已迁移至 `anomalyco/opencode`；`opencode serve` 默认 `127.0.0.1:4096`；OpenAPI 位于 `/doc`；SDK `@opencode-ai/sdk`（createOpencodeClient；session.create / prompt / prompt_async；event.subscribe 为 SSE）；结构化输出 `format: json_schema`；鉴权 `OPENCODE_SERVER_PASSWORD`
- 目标链路：网页 → 本地 Node 服务（单写者、代理）→ `opencode serve`（仅 localhost）→ 结果写回 `data/` + SSE 推进度
- 安全纪律：opencode 永不直接暴露到局域网；敏感操作需显式确认；v0.2 仅做 UI 预留（AI 建议卡 / 命令面板入口，标记"待接入"）

### 6.4 托管（局域网）

- `npm run dev -- --host`；生产：`npm run build && npm run preview -- --host`；手机同 WiFi 访问 `http://<局域网IP>:5173 / 4173`
- 注意：Windows 防火墙需放行 Node（专用网络）；纯 HTTP 局域网 IP 非安全上下文（无 PWA/摄像头等，本项目不需要）；WSL 需端口转发（本项目直接跑 Windows 侧）
- vite.config 中 `server.host: false` + `preview.host: false`（dev / preview 默认只监听本机）；局域网 / 手机来访需显式 `--host`，含义与安全提醒见 `docs/07`

---

## 7. 数据模型（v1 字段，种子数据必须遵守）

**ID 约定**：`i-` 收件箱 · `t-` 任务 · `p-` 项目 · `a-` 区域 · `g-` 目标 · `h-` 习惯 · `e-` 事件 · `c-` 课程 · `n-` 笔记 · `r-` 资料 · `rev-` 回顾；四位数字递增（如 `t-0001`）。

### 7.1 实体字段

**inboxItem（i-）**
| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | |
| content | string | 原始内容 |
| source | `manual\|file\|notification\|voice` | 来源 |
| capturedAt | ISO | |
| status | `unprocessed\|clarified\|discarded` | |
| linkedId? | string | 澄清后指向新实体 |
| note? | string | |

**task（t-）**
| 字段 | 类型 | 说明 |
|---|---|---|
| id / title / notes? | | |
| status | `next\|waiting\|scheduled\|someday\|done\|dropped` | |
| contexts | string[] | 如 `["@lab","@campus"]`，第一筛选 |
| energy | `low\|medium\|high` | |
| estimateMin? | number | |
| importance | 0–3 | 决策输入，非硬排名 |
| dueAt? / deferUntil? | ISO | |
| projectId? / areaId? / parentTaskId? | string | |
| tags | string[] | 命名空间：`role:acm`、`topic:数据结构` |
| repeatRule? | string | |
| createdAt / updatedAt / doneAt? | ISO | |
| sourceInboxId? | string | |

**project（p-）**
| 字段 | 类型 | 说明 |
|---|---|---|
| id / title / outcome | | outcome = 完成定义 |
| status | `active\|onHold\|someday\|done\|archived` | |
| areaId / goalId? / nextActionId? | string | |
| dueAt? | ISO | |
| tags | string[] | |
| createdAt / updatedAt | ISO | |

**area（a-）**：id / title / standard（标准声明，如"作业不过夜"）/ cadence `weekly|monthly|quarterly` / status
**goal（g-）**：id / title / horizon `term|quarter|year` / areaId? / parentGoalId? / keyResults:[{text,target,current,unit?}] / status / targetDate?
**habit（h-）**：id / title / cadence / trigger（实施意图）/ metric `count|minutes|bool` / target / areaId? / log:[{date,value}]
**event（e-）**：id / title / startAt / endAt / allDay / location? / areaId? / projectId? / tags / status `confirmed|tentative|cancelled` / repeatRule?
**note（n-）**：id / title / type `fleeting|literature|permanent|meeting|memo` / body（markdown）/ links[] / areaId? / projectId? / tags / distillLevel 0–3 / createdAt / updatedAt
**resource（r-）**：id / title / url? / kind `article|course|book|tool|paper|file` / status `unread|reading|read|reference|archived` / tags / areaId? / addedAt / note?
**review（rev-）**：id / type `weekly|monthly` / periodKey（如 `2026-W40`）/ date / metrics:{captured,created,completed,overdue,migrated} / decisions[] / summary / staleProjectIds?

**meta/config.json**：name / owner / version / locale / weekStart / createdAt
**meta/tags.json**：tags:[{id,name,namespace:`role|context|topic`,label}]

### 7.2 示例

```jsonc
// data/tasks/t-0012.json
{ "id":"t-0012", "title":"给 demo 实验室发面试确认邮件", "notes":"附上 KERNEL 仓库链接",
  "status":"next", "contexts":["@computer"], "energy":"low", "estimateMin":15, "importance":3,
  "dueAt":"2026-10-04T18:00:00+08:00", "projectId":"p-0005", "areaId":"a-0004",
  "tags":["role:acm","topic:面试"], "createdAt":"2026-10-01T21:30:00+08:00", "updatedAt":"2026-10-02T09:00:00+08:00" }

// data/events/e-0003.json
{ "id":"e-0003", "title":"学生组织例会", "startAt":"2026-10-06T19:30:00+08:00", "endAt":"2026-10-06T21:00:00+08:00",
  "allDay":false, "location":"某教室", "areaId":"a-0003", "tags":["role:competition-head"], "status":"confirmed" }

// data/projects/p-0005.json
{ "id":"p-0005", "title":"demo 实验室面试准备", "outcome":"拿到 offer 或明确差距清单",
  "status":"active", "areaId":"a-0004", "goalId":"g-0002", "nextActionId":"t-0012", "tags":["role:acm"],
  "createdAt":"2026-09-28T20:00:00+08:00", "updatedAt":"2026-10-02T09:00:00+08:00" }
```

### 7.3 区域建议（标准式，非身份）

| id | title | standard |
|---|---|---|
| a-0001 | 学业 | 无挂科；作业不过夜 |
| a-0002 | 学生工作 | 通知不过夜；同学求助当天回应 |
| a-0003 | 竞赛与组织 | 活动落地；结束后一周内复盘归档 |
| a-0004 | 算法成长 | 每周 ≥5 题；CF 稳步上分 |
| a-0005 | 技术创作 | 每两周至少一次可见产出 |
| a-0006 | 健康作息 | 23:30 前睡；每周运动 3 次 |
| a-0007 | 人际与连接 | 主动维护导师/同学/朋友网络 |

### 7.4 种子数据要求（Wave B 构建代理执行）

- 以 **2026-10-02** 为"现在"，全中文、真实感、可直接演示
- 任务 40–60 条：覆盖全部 status / energy / contexts / roles；含 3–5 条逾期、5–8 条 someday、waiting 若干
- 事件 15–20 条（未来两周）：课表、学生组织例会、ACM 训练赛、CF Round、班会、助理值班、demo 面试约谈
- 项目 8–10（含 KERNEL 自身、竞赛策划、ACM 训练计划、面试准备…）、目标 6–8、习惯 4–6（含连续打卡数据供热力图）、笔记 10–15、资源 10–15、收件箱未澄清 5–8、回顾 2 条（2026-W40 周回顾 + 9 月月回顾）

---

## 8. 工程制度

- **文档义务（每个会话强制）**：改代码 → 更新 `CHANGELOG.md` + `TASK_BOOK.md`；动结构 → 更新 `docs/05-FILE-TREE.md`；重大决策 → `docs/decisions/` 新 ADR；版本号 v0.x.0
- `AGENTS.md` = 新会话第一入口：含速览 / 命令 / 数据纪律 / 变更记录表
- 目录职责：`docs/` 文档 · `data/` 数据源 · `src/` 前端 · `scripts/` 脚本（未来）· `public/` 静态
- 语言规范：代码标识符英文；注释与文档中文为主；提交信息（未来 git）中文

---

## 9. 参考（研究摘要）

- 管理体系：GTD（引擎）· PARA（货架）· Johnny.Decimal（有界约束）· Bullet Journal（迁移）· Zettelkasten-lite（知识子图）· 系统思维（存量/流量/反馈环）
- 设计：柔暗夜色（低亮度柔和对比）· 柔影悬浮（表面阶 + 柔影表达深度，无硬边线）· 圆角 16 · 单一强调色纪律（仅信号）· 安静排版 · Motion/View Transitions（详见 `docs/decisions/0003-design-direction-v2.md`）
- 架构：opencode serve/SDK/SSE（anomalyco）· 单写者+原子写+Schema 校验 · Vite 局域网托管与安全上下文注意
- 完整来源清单见各子文档（docs/01–03）
