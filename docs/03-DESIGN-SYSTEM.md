# 03 · 设计系统

> 本篇展开宪法 §5（v2），是构建前端时的 token 级依据。所有数值以宪法为准，本文件提供完整表格与使用纪律。
> v2 方向：**C 柔暗夜色（默认）+ B 柔影悬浮融合**，见 `docs/decisions/0003-design-direction-v2.md`。

---

## 1. 设计基调

柔暗夜色 × 柔影悬浮。三条纪律贯穿全系统：

1. **柔暗为默认**：低亮度深灰、柔和对比、避免纯黑纯白满屏；暗色是默认主题，亮色「暖雾柔光」可选。
2. **柔影悬浮表达深度**：表面阶 + 柔影，不用硬发际线；交互卡片/行悬停抬升 `translateY(-2px)`。
3. **单一强调色收窄为信号**：只用于焦点、激活与信号，永不大面积填充，亦不作图表数据系列。

## 2. 色彩 token

### 2.1 暗色「柔暗夜色」—— 默认主题

```css
--bg:#0F0F10; --surface:#1A1A1C; --surface-elevated:#212124; --surface-sunken:#141416; --surface-hover:#232327;
--ink:#F4F4F5; --ink-2:#A1A1AA; --muted:#929298;
--outline:rgba(255,255,255,.06); --outline-strong:rgba(255,255,255,.12);
--accent:#FF5A52; --accent-text:#FF8A80; --accent-on-ink:#B3261E; --accent-ink:#0F0F10;
--success:#4CAF7D; --warning:#D08A2B; --danger:#F87171;
--shadow-card:0 16px 40px rgba(0,0,0,.45); --shadow-hover:0 22px 54px rgba(0,0,0,.55);
--shadow-highlight:inset 0 1px 0 rgba(255,255,255,.05);
```

### 2.2 亮色「暖雾柔光」（draft B 语言）

```css
--bg:#F7F6F3; --surface:#FFFFFF; --surface-elevated:#FFFFFF; --surface-sunken:#F1EFE9; --surface-hover:#FBFAF8;
--ink:#1C1917; --ink-2:#665F59; --muted:#6E6862;
--outline:#EDE9E3;
--accent:#D62828; --accent-text:#B3261E; --accent-on-ink:#FF8A80; --accent-ink:#FFFFFF;
--success:#1D6B3C; --warning:#B26A00; --danger:#B91C1C;
--shadow-card:0 1px 2px rgba(28,25,23,.04), 0 10px 30px -12px rgba(28,25,23,.14);
--shadow-hover:0 2px 4px rgba(28,25,23,.05), 0 18px 42px -14px rgba(28,25,23,.20);
```

### 2.3 色彩纪律

- **强调色文字必须用变体以保证 AA**：暗底表面用 `--accent-text`（`#FF8A80`）；亮底表面用 `--accent-text`（`#B3261E`）；强调色压在 ink 填充（深色/浅色反转块）上时改用 `--accent-on-ink` 反向变体。三者均实测 ≥4.5:1。
- 语义色仅用于状态上下文，且必须同时有图标或文字，禁止仅靠颜色传达信息（WCAG 1.4.1）。
- 不用纯黑纯白铺满全屏底；暗色用 `#0F0F10`，亮色用 `#F7F6F3`。
- 构建后必须验证对比度：正文 ≥7:1，UI ≥4.5:1，强调色文字 ≥4.5:1；不达标则微调并在 `CHANGELOG.md` 记录。

## 3. 字体 token

本地打包、离线可用、禁止 CDN。

```css
--font-sans:"Inter Variable","Inter","PingFang SC","HarmonyOS Sans SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif;
--font-mono:"JetBrains Mono",ui-monospace,"SF Mono",Consolas,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",monospace;
```

- 自托管：`@fontsource-variable/inter` + `@fontsource/jetbrains-mono`（按需字重）。
- 数字一律 `tabular-nums`；时间与 ID 用等宽字体。
- 等宽栈含 CJK 回退，中文在等宽上下文不出现豆腐块。
- v2 撤下"大写等宽微标签"作为默认层级手段；`.u-label` 改为安静小灰无衬线字。

## 4. 字号与排版

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
| display | clamp(30px, calc(26.167px + 0.9829vw), 42px) | 1.08 | -0.02em | 统计数字 |

统计瓦片的值必须走 `--text-display`（`.u-display` / `.k-stat__value`），禁止视图内联魔法数。

> 表内为 1440 锚点值；caption→h1 与 display 实际为流体 `clamp`（锚点 390→1440），micro 保持固定。公式与锚点表见 `08-MATH-SYSTEM.md`。

## 5. 间距、网格与形状

- 间距：4px 基线；微步（4/8/12/16）固定，大步（≥24）流体 `clamp`（390→1440 锚点）；φ 层级 inner : element : section : page = 1 : φ : φ² : φ³。
- 网格：12 列；左索引轨道 96px（收起 64px）；版心居中 `--content-max: 1240px`；页面边距流体（20→44px）；正文 measure ≤65ch。
- 容器查询：组件内部自适应走具名容器（route / stat / task / pcard / drawer）；shell 级（轨道 / 顶栏 / 移动底栏）仍用媒体查询。
- 形状：圆角 16（卡片）/ 12（内部件）/ 全圆（胶囊）；边缘至多 `rgba(255,255,255,.06)`（暗）或 `#EDE9E3`（亮），不用硬发际线。
- 深度：**静置**时卡片/面板/瓦片带柔影（大模糊、低透明度）+ 顶部微弱高光；**交互**时 `translateY(-2px)` + 更深更广柔影 + 边缘微亮，180–240ms。
- 移动端：单列堆叠，轨道变底部栏，状态条精简。

## 6. 动效 token

有目的的运动，不是装饰。

```css
--dur-instant:80ms; --dur-micro:120ms; --dur-fast:180ms; --dur-base:240ms; --dur-slow:400ms; --dur-page:560ms;
--ease-standard:cubic-bezier(.22,.61,.36,1); --ease-enter:cubic-bezier(.16,1,.3,1); --ease-exit:cubic-bezier(.4,0,1,1);
```

技术栈：Motion（组件状态 / 布局 / layoutId 共享元素 / 手势）+ View Transitions API（路由级变形，react-router `viewTransition` prop）+ cmdk（命令面板）。不引入 GSAP。

**Token 纪律**：Motion 侧时长/曲线统一走 `src/lib/motion.ts` 的 `DUR` / `EASE_*` / `STAGGER`（与 `tokens.css` 一一对应），CSS 侧走 `--dur-*` / `--ease-*`，禁止内联魔法数。

### 动效技法清单

1. 路由共享元素变形
2. 列表 stagger 入场（60ms 步进，前 12 项）
3. 数字滚动
4. 完成任务划线 + 塌缩
5. 交互卡片/行悬停柔影抬升（translateY(-2px)，180–240ms）
6. "现在"指示线呼吸
7. 命令面板 fade + 4px 升起 150–200ms

## 7. 组件签名词汇

命名与形态统一，组件语义固定：

`CommandPalette` / `StatusBar` / `RailNav` / `TopBar` / `Panel` / `StatTile` / `TagPill` / `DaySpine` / `ScheduleList` / `TaskRow` / `TaskBoard` / `Drawer` / `FilterBar` / `MeterBar` / `EnergyBars` / `TrendBars` / `EmptyState` / `Skeleton` / `Toast`

要点：

- `Panel` / `StatTile`：柔影悬浮卡片；静态容器承接柔影，不抬升。
- `TagPill`：胶囊；选中 = ink 填充 + bg 文字，悬停/选中始终保证文字可读（AA）。
- `TaskRow` / `k-lib-row`：交互行，悬停柔影抬升。
- `MeterBar` / 图表：单色阶 + 图案区分；强调色不作数据系列。
- `Toast`：克制使用，不打断操作；「原型态」标签用 `--accent-text`。

> `HeatGrid` / `Ticker` / `Sparkline` 已于 v0.3.0 删除（死代码 / 已被状态 chips 与紧凑日程列表替代）。

## 8. 可读性纪律（柔暗风格陷阱防线）

### DO

- 正文 15px / 1.65。
- measure ≤65ch。
- 正文对比 ≥7:1。
- 尺寸与字重优先于颜色做层级。
- 安静小灰标签。
- 焦点可见。
- 色盲安全（不靠单一颜色区分状态）。
- 深度用表面阶 + 柔影。

### DON'T

- 不大面积使用强调色。
- 不用强调色作图表数据系列。
- 不用纯黑纯白满屏底。
- 不居中构图（左对齐为主）。
- 灰字不低于 4.5:1。
- 不用硬发际线作唯一边界。
- 不为炫技加动效。

## 9. 无障碍要求

- 动效：`MotionConfig reducedMotion="user"` + CSS `prefers-reduced-motion`。
- 焦点：焦点环 2px 柔和色，带 offset；命令面板与抽屉实现焦点圈闭（Tab 循环）并在关闭后还原焦点到触发元素。
- 键盘：全键盘可达。
- 色彩：语义色必须伴随图标或文字，禁止仅靠颜色传达信息（WCAG 1.4.1）；强调色文字用 AA 变体。
- 对比度：正文 ≥7:1，UI ≥4.5:1，构建后验证。
- 主题：暗色为默认，亮色可选；首帧前读 localStorage 防 FOUC；切换不丢失焦点。

## 10. 数理自适应系统（v0.3 增补）

设计 token 从「固定值 + 视口媒体查询」升级为「公式驱动 + 容器自适应」：

- **流体尺度**：字号（caption→display）与大步间距（`--space-5` 以上、`--pad-card`、`--row-min`、`--page-margin`）改为 `clamp(MIN, INTERCEPT + SLOPE·vw, MAX)`，锚点 390 / 1440；1440 保持既有视觉尺寸。
- **φ 间距层级**：`--rhythm-inner/element/section/page` 构成几何级数 `1 : φ : φ² : φ³`。
- **容器查询**：组件内部（瓦片 / 任务行 / 看板卡 / 分区栅格）按容器宽度自适应；仅 shell（导航轨道 / 顶栏 / 移动底栏）保留视口媒体查询。
- **公式、锚点表、容器地图与复算方法**：见 `08-MATH-SYSTEM.md`。

## 11. 相关文档

- 宪法 §5：`00-DESIGN-BRIEF.md`
- 方向决策：`decisions/0003-design-direction-v2.md`
- 数理自适应系统（流体公式 / 容器地图 / 复算）：`08-MATH-SYSTEM.md`
- 视图规格：`00-DESIGN-BRIEF.md` §4
- 数据结构：`04-DATA-MODEL.md`
- 前端技术栈：`02-ARCHITECTURE.md`
