# 设计任务简报 · 页面排版多版本（v2 选型）

> 背景：所有者认为当前页面「排版不够专业、流畅、全面」，要求：**每页做几版排版 / 组件样式方案供选型**；风格（柔暗夜色 v2 + 柔影悬浮）保持不变；范围含**点击展开的详情面板与卡片详情**。本目录产物为选型稿，所有者拍板后再落到 `src/`。

## 硬性约束

1. **风格冻结**：色彩 / 圆角 / 阴影 / 字体 / 动效语言一律沿用现有 token；不得引入新色值、新字体、新依赖、外部 CDN 资源。
2. **技术形态**：单文件静态 HTML（无 JS 逻辑）；复制 `_base.html` 起步；样式 = 真实应用 CSS（`/src/styles/*.css`，模板已 link）+ 文件内 `<style>` 局部排版。
3. **局部样式纪律**：颜色 / 圆角 / 阴影 / 字号只能 `var(--token)`；结构性尺寸（grid 列宽、minmax、fr、gap、max-width）可自由用 px / clamp。
4. **评审上下文**：保留 `_base.html` 中的应用壳（rail / topbar / statusbar）；页面内容区自由重排。
5. **真实感内容**：用真实种子数据（从 `data/` 与 `src/views/*.tsx` 取材，如任务、项目、日程的真实标题），中文界面；宁缺毋滥——宁可少两条，也不要用假内容。
6. **桌面优先**：以 1600×1000 视口为设计基准（版心约 1240px；如需突破版心的全宽方案，在文件顶部注释中注明）。
7. **命名**：`<page>-<a|b|c>.html`；每文件顶部 HTML 注释写明：变体代号、一句话概念、与另外两版的关键差异、移动端行为设想（一句话即可）。

## 每页三个变体方向（方向内自由发挥，但三版差异必须明确）

| 页面 | A | B | C |
|---|---|---|---|
| **overview 总览** | 「指挥台」——现有骨架精化：更严谨的三栏栅格（左日程 / 中行动 / 右项目+AI） | 「聚焦」——极简：一条「今日下一步」大焦点块 + 时间线 / 日程流 | 「仪表盘」——多瓦片网格：指标 + 迷你图 + 日程 + 项目（2×N） |
| **inbox 收件箱** | 「处理台」——左右分栏：左列表 / 右选中条目详情 + 澄清区（键盘流） | 「卡片流」——单列卡片，每条含完整澄清操作（现状升精） | 「批量」——分组浏览 + 多选批量澄清 / 丢弃 |
| **tasks 任务** | 「清单」——分组手风琴 + 行内展开详情 | 「看板」——按状态 / 上下文分列（横向） | 「表格」——紧凑多列（标题 / 上下文 / 能量 / 截止 / 项目），扫描优化 |
| **calendar 日程** | 「日视图」——日脊 + 议程（现状骨架精化） | 「周视图」——7 列时间网格（课表式） | 「议程流」——接下来事件流 + 迷你月历 |
| **projects 项目** | 「看板」——现状精化（解决空列大虚框占位问题） | 「列表」——纵向：每项目一行（标题 / 进度 / 下一步 / 截止） | 「卡片网格」——2–3 列卡片（进度条 / 环 + 下一步 + 标签） |
| **library 资料** | 「列表」——现状行式精化 | 「卡片网格」——文献卡（类型 / 标题 / 蒸馏度 / 更新时间） | 「三栏」——左导航 / 筛选 + 中列表 + 右阅读区 |
| **review 回顾** | 「叙事」——单列阅读流（周记式） | 「仪表盘」——指标网格 + 图表 + 停滞清单（双栏） | 「向导」——顶部步骤条 + 内容区（流程感） |
| **settings 设置** | 「卡片组」——现有分组卡片精化（宽屏多栏） | 「侧导航」——左分类导航 + 右面板 | 「单列流」——长表单式分区 |
| **detail 详情**<br>（task 抽屉为基准骨架，适用于 event / project / note / resource） | 「单列」——现有抽屉精化：kicker / 标题 / 字段 / 底部操作 | 「双栏」——左主内容（描述 / 子任务）+ 右元数据栏（字段 / 标签） | 「行动优先」——顶部关键操作区 + 分组字段 + 关联内容（相关任务 / 反链） |

## 现行参考

- 真实截图（当前线上效果，暗色）：`.qa/review/final-overview-1920.png`、`final-inbox-1920.png`、`final-tasks-1920.png`、`final-calendar-1920.png`、`final-projects-1920.png`、`final-library-1920.png`、`final-review-1920.png`、`final-settings-1920.png`、`final-task-drawer.png`（抽屉）、`final-palette.png`
- 视图源码：`src/views/*.tsx`；组件：`src/components/**`；样式：`src/styles/**`
- 既有设计纪律：版心 1240、呼吸词汇 `--pad-card` / `--row-min`、φ 间距层级、容器查询（route / stat / task / pcard / drawer）

## 交付物

- `<page>-a/b/c.html` 若干 + `detail-*.html`（以各代理任务书为准）
- 无需截图（主会话统一渲染预览）；但需保证文件在 `http://localhost:5173/design-drafts/v2/<file>.html` 可打开、无 class 拼写错误、无控制台报错。
- 注意：`node design-drafts/v2/_build.mjs` 会把应用 CSS **内联**进所有变体文件（自包含打包）——此后双击文件（file://）也能看到完整样式；`_base.html` 模板保持 link 形态不打包。

---

## 附录 · 第二轮：总览（监控方向）+ 图表组件（2026-10-02 追加）

所有者反馈：**第一轮总览三版重做**；总览需**附加监控类图表组件**（用于监视）。第一轮稿归档于 `_archive/overview-*-v1.html`（可读，避免重复其问题）。

### 监控图表清单（图表组件词汇提案；数据全部来自真实种子）

| # | 图表 | 形态 | 真实数据（2026-10-02 16:20 口径） | 监视语义 |
|---|---|---|---|---|
| 1 | 完成趋势 | 7 日柱（风格沿 `.k-trend`） | 周一~周日 `[1,1,1,1,0,0,0]` | 产出节奏 |
| 2 | 到期负载 | 未来 7 天柱 | `[0,6,5,6,6,3,3]`（明天 6 项为峰值） | 负载前瞻 |
| 3 | 能量分布 | 横向条（沿 `.k-energy`） | 低 17 / 中 21 / 高 16 | 可执行任务的能量构成 |
| 4 | 连续打卡 | 14 日点阵（实心 = 命中 · 空心 = 缺口） | h-0002 最近 14 天（含 09-20、09-22 缺口）；当前连续 10 天 | 习惯连续性 |
| 5 | 收件箱水位 | 计量条 + 阈值线 | 6 / 12，阈值 8（健康） | 存量健康 |
| 6 | WIP 监控 | 计量条 + 上限线 | 9 个进行中 / 上限 3（超限） | 在制品超限信号 |
| 7 | 项目推进 | 多条进度条 | 4 个 active 项目：1/7 · 1/8 · 1/6 · 1/7 | 多项目推进一览 |

辅助口径：逾期 5；W40 回顾：捕捉 14 / 新增 22 / 完成 18 / 逾期 5 / 迁移 7。

### 图表设计纪律（沿用既有）

- 单一墨色阶 + 图案（**无强调色作数据系列**，P7）；阈值 / 超限允许强调色作信号（描边、标注线）。
- 图表模块解剖统一：标题 + 期间小标签（如「近 7 天」）→ 图形区 → 基线 / 阈值 → 脚注口径。全部走 token，无内联魔法色值。
- 静态 HTML/CSS（可用 inline SVG），无 JS；能复用 `.k-trend` / `.k-energy` / `.k-meter` / `.k-distill` 的尽量复用，新类建议 `.k-chart*` 前缀并在注释中给出用途。

### 总览第二轮三版方向

| 版本 | 概念 | 要点 |
|---|---|---|
| A「监控台 CONTROL ROOM」 | 图表优先 | 顶部全宽监控图表网格（≥4 图）+ 下方 日程 / 行动 / 项目 三栏 |
| B「驾驶舱 COCKPIT」 | 主图 + 纵向流 | 左 2/3：主趋势图（完成趋势）+ 图表堆叠；右 1/3：今日日程 + 下一步行动 + 项目 |
| C「信号层 SIGNALS」 | 监测即行动 | 「信号卡」逐行（数值 + 迷你图 + 阈值状态）与今日焦点 / 下一步行动交织 |

三版必须保留既有签名元素：状态胶囊、收件箱水位、今日任务、进行中项目、连续刷题、今日日程、下一步行动、项目。

额外交付：`charts-kit.html` —— 上述 7 个监控图表的组件样本页（每个模块标注名称 / 类名 / 数据来源 / 使用场景），作为落地实现说明与所有者评审依据。

---

## 附录二 · 图表语言修订（2026-10-02 · 所有者否决「圆头柱」）

所有者指令：**趋势类图表不得采用圆头柱（大圆角柱体）呈现**；可采用折线图等方式。线上应用已同步：`TrendBars` 组件退役，改为 `TrendLine`（`src/components/charts/TrendLine.tsx`），其样式块 `.k-line` 已在 `src/styles/components.css`，并随自包含打包内联进全部草稿（**变体不要重复定义 `.k-line` CSS**）。

### 折线趋势图规范（`.k-line`）

解剖：标题 + 期间 → 折线区（面积晕染 + 数据点）→ 基线 → 脚注。
纪律：单一墨色数据系列；**强调色仅作「唯一最大值」的峰值信号环**；最大值并列时**不打信号**。

几何（viewBox `0 0 1000 100`，`preserveAspectRatio="none"`，随容器拉伸；所有描边带 `vector-effect="non-scaling-stroke"`）：
- 数据点 `x_i = 40 + i × 920 / (n−1)`；`y = 100 − (v / max) × 82`（max 为该序列最大值，最小取 1）
- 折线：单条路径，`class="k-line__stroke"`；面积：同路径下探至 `y=100` 闭合，`fill="url(#渐变)"`（`stop-color var(--ink)`，opacity 0.1 → 0）
- 数据点：**每个点**一条零长度路径 `M x y l 0 0.01`，`class="k-line__dot"`（圆头端帽成圆点，拉伸不变形）
- 峰值环（仅唯一最大值）：同法叠加 `class="k-line__peak"`，其数值标签加 `is-peak`
- 数值标签：`<span class="k-line__value" style="left:{x/10}%; top:{y}%">`；星期标签在 `.k-line__axis` 内 `<span class="k-line__label" style="left:{x/10}%">`

标准片段（示例：完成趋势 `[1,1,1,1,0,0,0]`，max=1）：

```html
<div class="k-line" style="height: 120px">
  <div class="k-line__plot">
    <svg class="k-line__svg" viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label="趋势折线图">
      <defs>
        <linearGradient id="lg-otrend" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--ink)" stop-opacity="0.1"></stop>
          <stop offset="100%" stop-color="var(--ink)" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <path d="M 40 18 L 193.3 18 L 346.7 18 L 500 18 L 653.3 100 L 806.7 100 L 960 100 L 960 100 L 40 100 Z" fill="url(#lg-otrend)"></path>
      <path class="k-line__stroke" vector-effect="non-scaling-stroke" d="M 40 18 L 193.3 18 L 346.7 18 L 500 18 L 653.3 100 L 806.7 100 L 960 100"></path>
      <path class="k-line__dot" vector-effect="non-scaling-stroke" d="M 40 18 l 0 0.01"></path>
      <path class="k-line__dot" vector-effect="non-scaling-stroke" d="M 193.3 18 l 0 0.01"></path>
      <path class="k-line__dot" vector-effect="non-scaling-stroke" d="M 346.7 18 l 0 0.01"></path>
      <path class="k-line__dot" vector-effect="non-scaling-stroke" d="M 500 18 l 0 0.01"></path>
      <path class="k-line__dot" vector-effect="non-scaling-stroke" d="M 653.3 100 l 0 0.01"></path>
      <path class="k-line__dot" vector-effect="non-scaling-stroke" d="M 806.7 100 l 0 0.01"></path>
      <path class="k-line__dot" vector-effect="non-scaling-stroke" d="M 960 100 l 0 0.01"></path>
    </svg>
    <span class="k-line__value" style="left: 4%; top: 18%">1</span>
    <span class="k-line__value" style="left: 19.33%; top: 18%">1</span>
    <span class="k-line__value" style="left: 34.67%; top: 18%">1</span>
    <span class="k-line__value" style="left: 50%; top: 18%">1</span>
    <span class="k-line__value" style="left: 65.33%; top: 100%">0</span>
    <span class="k-line__value" style="left: 80.67%; top: 100%">0</span>
    <span class="k-line__value" style="left: 96%; top: 100%">0</span>
  </div>
  <div class="k-line__axis">
    <span class="k-line__label" style="left: 4%">周一</span>
    <span class="k-line__label" style="left: 19.33%">周二</span>
    <span class="k-line__label" style="left: 34.67%">周三</span>
    <span class="k-line__label" style="left: 50%">周四</span>
    <span class="k-line__label" style="left: 65.33%">周五</span>
    <span class="k-line__label" style="left: 80.67%">周六</span>
    <span class="k-line__label" style="left: 96%">周日</span>
  </div>
</div>
```

> `[0,6,5,6,6,3,3]`（到期负载，max=6）复算：y = 100 / 18 / 31.7 / 18 / 18 / 59 / 59；最大 6 并列 ×3 → **不打峰值环**，脚注改「高峰 6 项（六 / 一 / 二）· 合计 29 项」。

### 连带修订（全部草稿）

- 连续打卡点阵：粗竖条 + 斜纹 → **安静圆点阵**（实心 = 命中 · 空心 = 缺口；8px 圆点行内均布；`.k-streak__cell`）。
- 信号行迷你柱：圆角 ≤ 2px，禁止 pill。
- 删除旧 `k-trend` / `k-bars` 类与其局部 CSS；不得残留圆头柱形态（含局部覆盖）。
- 需替换的文件：`charts-kit` / `overview-a` / `overview-b` / `review-a` / `review-b` / `review-c`；`overview-c` 仅检查 `k-mini-bars__b` 圆角。
- 数据值一律保留原值，只换呈现。

---

## 附录三 · 总览第三轮（2026-10-02 · 前两轮均未采纳）

前两轮成果回顾（均已否决，**必须避免重复其气质**，可读 `_archive/overview-*-v1.html`、`_archive/overview-*-v2.html` 对照）：
- 第一轮：指挥台（三栏 bento）/ 聚焦（大焦点块）/ 仪表盘（2×N 瓦片）。
- 第二轮：监控台（图表网格铺顶）/ 驾驶舱（主图 + 纵向流）/ 信号层（信号行）。

**第三轮核心反思**：所有者连续两轮未采纳「图表主导」的版面——监测图表**不再作为整屏主视觉**，改为**内嵌 / 紧凑 / 低高度**的克制呈现；三版的组织原则必须与前两轮全面错开。

### 三版方向

**R3-A「今日线 TODAY LINE」**——以"今天"的时间轴为叙事核心
- 头部：日期问候（今天 · 10月2日 周五 · 第 40 周）+ 3 枚状态胶囊。
- 主体：一条「今日线」——把今日日程与到期 / 逾期的下一步行动**按时间编织成一条行动线**（08:00 数据结构课 → 10:00 Java → 之后插入 截止明天 的任务…），节点可点入详情。
- 右栏或下方：紧凑「监视栈」——水位 / WIP / 连续刷题 / 完成趋势以**微型形态**（内嵌 sparkline / 点阵）包在统计瓦片内，不设独立图表卡。
- 底部：项目推进条（一行横向）。
- 气质：一张"今天的手账"——安静、个人、有节奏。

**R3-B「状态带 STATUS STRIP」**——以横向仪表带为锚
- 顶部：全宽「系统状态带」——水位 / WIP / 逾期 / 连续刷题 四枚「仪表」（含阈值 / 上限标记），像内核状态栏的展开。
- 中部左右：左「焦点」（当前最重要一步大块 + 其后排队行动）；右「今日日程」紧凑列。
- 底部：「趋势带」——完成趋势 / 到期负载 / 项目推进 三条 **低高度（≤96px）** 紧凑图表横排。
- 气质：克制、精密——像操作系统的状态面板。

**R3-C「工作台 WORKBENCH」**——左工位 + 右监视柱
- 左 2/3「工作区」：下一步行动 TOP5（完整 meta）与今日日程条目**按时间穿插在同一列**（行动与日程真正交织）。
- 右 1/3「监视柱」：垂直监控栈——水位 / WIP / 连续刷题 / 完成趋势 / 到期负载，各一行 / 小块，随时可瞥。
- 顶部：仅一条窄状态行（胶囊）。
- 气质：工作台 + 侧仪表——功能分区最清晰。

### 共同规则

- 保留全部签名元素：状态胶囊、收件箱水位、今日任务、进行中项目、连续刷题、今日日程、下一步行动、项目。
- 趋势一律 `.k-line`（折线；圆头柱禁用——见附录二）；水位 / WIP 用 `.k-meter`；连续打卡用点阵（实心 = 命中 · 空心 = 缺口）。
- 顶部一屏内不得再出现"图表墙"；每版文件头注释附一句移动端设想。
- 数据使用附录一的真实值。

**采纳记录（2026-10-02）**：所有者选定 **C「工作台」**并已落地 `src/`（详见 `CHANGELOG.md`）；打卡点阵（`.k-streak`）同步收录进应用样式 `components.css`。
