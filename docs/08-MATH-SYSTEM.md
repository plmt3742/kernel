# 08 · 数理自适应系统（Math System）

> v0.3 增补层。目标：让版式从「固定值 + 视口媒体查询」升级为「公式驱动 + 容器自适应」，
> 使组件在任意宽度下都优雅自洽。所有公式可复算，证据在 `.qa/v05/`。

---

## 1. 方法论（Utopia fluid）

流体 token 一律写成：

```
clamp(MIN, calc(INTERCEPT + SLOPE·1vw), MAX)
```

其中以两个锚点视口 `v₁ = 390px`（mobile）、`v₂ = 1440px`（desktop）求解：

```
SLOPE(vw)  = (MAX − MIN) / (1440 − 390) × 100        // 单位 vw 的数字
INTERCEPT  = MIN − (SLOPE/100) × 390                 // 单位 px
```

- `MIN` 取 390px 的值，`MAX` 取 1440px 的值 → **1440 保持既有视觉尺寸（主审宽度零回归）**。
- `< 390px` 锁在 MIN；`> 1440px` 锁在 MAX（或按 token 说明的更高上限）。
- 复算：任取视口 `w`，值 = `INTERCEPT + (SLOPE/100)·w`，再线性夹在 `[MIN, MAX]`。

**为何部分 token 不流体**：`--text-micro`(11px) 与微步 `--space-1..4`(4/8/12/16) 保持固定。
它们用于图标/行内对齐与 4px 栅格；流体化会破坏栅格且视觉收益极小（反锯齿抖动 > 观感增益）。

---

## 2. 字号流体表（tokens.css §5.3）

| token | MIN@390 | MAX@1440（既有值） | SLOPEvw | INTERCEPTpx |
|---|---|---|---|---|
| `--text-micro` | 11 | 11（固定） | — | — |
| `--text-caption` | 11.5 | 12 | 0.0476 | 11.314 |
| `--text-body-sm` | 12.4 | 13 | 0.0571 | 12.177 |
| `--text-body` | 14.4 | 15 | 0.0571 | 14.177 |
| `--text-h4` | 17 | 18 | 0.0952 | 16.629 |
| `--text-h3` | 20 | 22 | 0.1905 | 19.257 |
| `--text-h2` | 24 | 27 | 0.2857 | 22.886 |
| `--text-h1` | 29 | 34 | 0.4762 | 27.143 |
| `--text-display` | 30 | 40.32（原 `2.8vw@1440`）；MAX 42 | 0.9829 | 26.167 |

行高 / 字距不随比例变化（`*-leading` / `*-tracking` 固定），避免流体字号引发垂直跳动。

**实测（`.qa/v05`）**：body 14.4px@390 → 14.76px@1024 → 14.999px@1440 ✔

---

## 3. 间距流体表（tokens.css §5.4）

| token | MIN@390 | MAX@1440 | SLOPEvw | INTERCEPTpx |
|---|---|---|---|---|
| `--space-5` | 20 | 24 | 0.381 | 18.514 |
| `--space-6` | 26 | 32 | 0.5714 | 23.771 |
| `--space-7` | 38 | 48 | 0.9524 | 34.286 |
| `--space-8` | 48 | 64 | 1.5238 | 42.057 |
| `--space-9` | 64 | 96 | 3.0476 | 52.114 |
| `--space-10` | 80 | 128 | 4.5714 | 62.171 |
| `--pad-card` | 20 | 26 | 0.5714 | 17.771 |
| `--row-min` | 52 | 64 | 1.1429 | 47.543 |
| `--page-margin` | 20 | 44（= `--rhythm-page`） | 2.2857 | 11.086 |

**实测**：`--pad-card` 20px@390 → 23.62px@1024 → 26px@1440；`--page-margin` 20 → 34.49 → 44；`--space-5`（stats gap）20 → 22.42 → 24 ✔

---

## 4. φ 间距层级（几何级数）

```
inner : element : section : page  =  1 : φ : φ² : φ³  ≈  1 : 1.62 : 2.62 : 4.24
```

以 `--rhythm-inner = 10.4px` 为基，`--phi = 1.618`：

| 层级 | token | 公式 | 锚点 1440 | 语义 | 落点 |
|---|---|---|---|---|---|
| φ⁰ | `--rhythm-inner` | 10.4px | 10.4 | 组件内缝 | `.k-panel__head` gap |
| φ¹ | `--rhythm-element` | inner × 1.618 | 16.83 | 元素间隙 | panel 头下距、`.k-chips` gap |
| φ² | `--rhythm-section` | inner × 2.618 | 27.23 | 区块间隙 | `.k-view` gap |
| φ³ | `--rhythm-page` | inner × 4.236 | 44.05 | 页边距 | `--page-margin` max |

与 4px 基线的关系：微步仍走 4/8/12/16（对齐用）；φ 层级是**结构接缝**的语义层，
两者并存——微步保证像素对齐，φ 保证宏观节奏的几何比例。

---

## 5. 容器地图（container queries）

支持假设：container queries 为现代浏览器基线特性（Chrome 105+ / Safari 16+ / Firefox 110+）。
**组件内部**用容器查询；**shell 级**（导航轨道 / 顶栏 / 移动底栏 / toast）仍用视口媒体查询。

| 容器名 | 承载元素 | 内部自适应 | 断点（按容器宽度） |
|---|---|---|---|
| `route` | `.k-route`（版心，≤1240） | 总览 stats/split、看板、日历主体、回顾分区、设置栅格、过滤行、周条 | ≤1000 stats→2；≤900 split/cal/review/settings→1；≤1120 kanban→2；≤640 kanban→1、metrics→2、过滤行竖排 |
| `stat` | `.k-stat` | 瓦片内大数字 | ≤200px 数字降为 `--text-h2` |
| `task` | `.k-task` | 行内 meta | ≤560 meta 换行更松；≤420 meta 竖排 + 收起 why |
| `pcard` | `.k-pcard` | 看板卡标题/说明 | ≤220px 标题降为 body、说明降为 micro |
| `modal` | `.k-modal__body` | 详情弹窗内 dl | ≤560px dl 收为单列（max-content + 1fr） |

**实测（`.qa/v05`）**：route 宽 350/891/1240 → stats 轨道数 **1 / 2 / 4**；task 行宽 308/645 → meta `flex-direction` **column / row** ✔

---

## 6. 动效常数（tokens.css §5.5 ↔ src/lib/motion.ts）

| 类别 | token | 值 | 距离/用途 |
|---|---|---|---|
| instant | `--dur-instant` / `DUR.instant` | 80ms / 0.08s | 颜色、描边（零位移） |
| micro | `--dur-micro` | 120ms | 微状态（chip 反选、透明度） |
| fast | `--dur-fast` | 180ms | 悬停/按压（translateY −2px、fade） |
| base | `--dur-base` | 240ms | 入场、弹窗淡入 + 微缩放 |
| slow | `--dur-slow` | 400ms | 计量条宽度等长距离属性 |
| page | `--dur-page` | 560ms | 路由级过渡 |

- 曲线：`standard` 通用 / `enter` 减速进场 / `exit` 加速退场；`EASE_STANDARD` 已与 CSS 对齐为 `cubic-bezier(.22,.61,.36,1)`。
- **列表 stagger 公式**：`delay(i) = min(i, STAGGER_MAX) × STAGGER`，`STAGGER = 0.06s`，`STAGGER_MAX = 12`（任务列表、趋势条）。
- reduced-motion：`prefers-reduced-motion: reduce` 下所有时长 → 0.01ms（实测 `1e-05s`）。

---

## 7. 圆角比值

| token | 值 | 适用 |
|---|---|---|
| `--radius-card` | 16px | 大表面卡片 / 面板 |
| `--radius-inner` | 12px（= card − 4 ≈ 0.75×） | 卡片内部件、列表行、输入 |
| `--radius-pill` | 999px | chip / 按钮 / 徽章 |

半径随组件尺度分级：大件保持柔影悬浮的圆润感，小件不显笨重。

**测量约束**：散文型文本块使用 `--measure: 65ch`（`.k-markdown` / `.k-view__intro` / `.k-detail-note` / `.k-philosophy` / `.k-aisug__line`）。
**相对尺寸**：`.k-check`（勾选框）与内部 svg 用 `em`（1.2em / 0.72em），随流体字号缩放。

---

## 8. 复算与验证方法

1. **复算单个 token**：取上表 MIN/MAX，按 §1 公式求 `SLOPE`、`INTERCEPT`，写回 `clamp()`。
2. **程序化验证**（`.qa/v05/` 脚本 `v05-math.cjs`）：用 Playwright 在 390 / 1024 / 1440 三档读取
   `getComputedStyle` 的 `body.fontSize`、`.k-panel.paddingTop`、`.k-content.paddingLeft`、
   `.k-overview__stats.columnGap`，并读取 `.k-overview__stats` 的 `gridTemplateColumns` 轨道数与
   `.k-task__meta.flexDirection`，打印实测数值。
3. **回归守卫**：同脚本断言命令面板居中、关闭后焦点还原、reduced-motion 时长、暗色默认、对比 token（`#929298` / `#a1a1aa`）。
4. 视口截图：`overview-dark` @1280/1440/1680/390、`tasks-dark` @1440/1280/390、`calendar-dark` @1440/1280。

---

## 9. 相关文档

- 设计系统：`03-DESIGN-SYSTEM.md`
- 方向决策：`decisions/0003-design-direction-v2.md`
- 变更日志：`../CHANGELOG.md` v0.3.0「数理自适应」
