# ADR 0012 · 全站详情统一为居中弹窗 + 统一操作矩阵（Slice K）

- 状态：已接受
- 日期：2026-10-03
- 决策者：项目所有者四条指令：①「这个卡片怎么还是侧边栏，我需要所有的卡片都是居中弹窗样式」；②「弹窗不是说要优化为屏幕居中弹窗详情页吗，怎么没优化」；③「这里除了标记为完成后，编辑、删除按钮等没有出现，不能进行常规操作，全系统统一审阅后处理」；④「这个地方遮罩不太自然，优化一下」（日历吸顶日期条）+ 实证（`.qa/v29/slice-k-verify.py`）
- 关联：ADR-0003（视觉方向）、ADR-0009（详情操作 / 编辑 / 回收站）、ADR-0010（总览就地弹窗首次引入 `Modal`）、ADR-0011（状态贯通 / 编辑白名单）、`docs/00` §5.6、`docs/03` §5 / §7 / §9、`docs/05`、`docs/08` §5 / §6、`CHANGELOG.md`、`TASK_BOOK.md`、`.qa/v29/`

---

## 1. 背景

详情表面此前分裂为两套承载：

- **右侧抽屉 `Drawer.tsx`**：任务（Tasks）、项目（Projects）、笔记 / 资料（Library）、日程（Calendar）四处详情。
- **居中弹窗 `Modal.tsx`**：总览（Overview）就地任务 / 项目弹窗（ADR-0010）、任务草稿确认弹窗（ADR-0011 §6）、回顾报告弹窗。

两套承载带来三个问题：

1. **视觉不一致**：同一实体（任务）在 Tasks 页是右侧抽屉，在 Overview 是居中弹窗；所有者明确指出「所有卡片都要居中弹窗」，侧边栏体验不被接受。
2. **操作不一致**：Overview 就地弹窗只有「标记完成 / 查看项目」，缺「编辑 / 删除」；项目就地弹窗无任何动作；而 Tasks / Projects / Library 抽屉有完整操作。同为详情，动作集合不同（「不能进行常规操作」）。
3. **底栏标记不一致**：Tasks / Overview 用 `.k-drawer__foot-main` + `.k-drawer__foot-actions`，Projects / Library 只用 `.k-drawer__foot-actions`；且总览弹窗借用抽屉底栏类（`.k-modal__foot .k-drawer__foot-main`），语义错位。

此外，日历 `.k-cal__bar` 吸顶条以 `background: var(--bg)` 平铺，滚动时面板在条底缘被「一刀切」——遮罩生硬。

## 2. 决策

### 2.1 详情承载统一为居中弹窗

- 全部五类实体详情——任务 / 项目 / 笔记 / 资料 / 日程——统一由 `src/components/Modal.tsx` 承载，新增尺寸变体 `.k-modal--detail`（`width: min(660px, 100vw - 32px)`、`max-height: min(85vh, 900px)`；内容在 `.k-modal__body` 内滚动；≤640px 全宽留 16px 边距）。
- `Drawer.tsx` 及其样式（`.k-drawer*`、`.k-drawer-scrim`、`.k-drawer__body` 容器、`--drawer-w` / `--z-drawer` token）**删除**；`.k-modal__body` 成为新的具名容器 `modal`（取代 `drawer`）。批条侧挂 dock（`.ic-dock`）层级改挂 `--z-overlay - 1`。
- 打开触发（行点击 / `?task=` `?project=` `?note=` `?resource=` `?event=` 深链）、ESC / 遮罩关闭、焦点圈闭 + 还原、关闭清挂载参数等语义保持不变。

### 2.2 操作矩阵（全站统一）

| 实体 | 操作 | 承载 |
|---|---|---|
| 任务 | 标记完成 / 取消完成 · 查看项目（有项目时）· 编辑 · 删除 | `TaskDetailModal`（Tasks + Overview 共用） |
| 项目 | 编辑 · 删除 | `ProjectDetailModal`（Projects + Overview 共用） |
| 笔记 | 编辑 · 删除 · 蒸馏层级快捷设置 | Library 详情弹窗 |
| 资料 | 编辑 · 删除 · 状态快捷设置 · 打开文件 / 定位（有 path 时） | Library 详情弹窗 |
| 日程 | 只读（结构性缺口，见 §5） | Calendar 详情弹窗 |

- 任务 / 项目的动作**由构造保证一致**：抽出 `src/components/TaskDetailModal.tsx` 与 `ProjectDetailModal.tsx`，Tasks / Projects 页与 Overview 就地弹窗引用同一组件，不再各自维护字段规格、保存 / 删除处理器。编辑走既有 `EntityEditForm`，删除走回收站 + 撤销 toast（沿用 ADR-0009）。

### 2.3 底栏统一

- 详情底栏统一为两组：主操作区 `.k-modal__foot-main`（靠左，`margin-right:auto`）与安静动作区 `.k-modal__foot-actions`（靠右：编辑 / 删除）。样式集中到 `shell.css`，删除 `.k-drawer__foot-*` 与总览借用抽屉类的补丁规则。
- 编辑态下底栏让位给表单自身的「保存（实心）/ 取消（ghost）」，行为不变。

### 2.4 日历吸顶日期条柔化（同一切片，视觉修复）

- `.k-cal__bar` 保持吸顶（`top: var(--topbar-h)`），其下以 `::after` 叠一段 `--bg → transparent`、高 `--space-4` 的渐隐层（`pointer-events:none`），让滚上来的面板自然浮现，替代原「一刀切」硬横线。

## 3. 理由

- **一致性即正确性**：详情是同一实体在不同入口的同一视图，承载与动作不应随入口变化。抽出共用详情弹窗组件，让「动作一致」成为构造性质而非约定。
- **复用既有 Modal**：`Modal.tsx` 已具备 role=dialog / aria-modal / ESC / 遮罩 / 焦点圈闭 + 还原 / 锁滚动（ADR-0010 总览已用），扩展尺寸变体即可承载所有详情，无需新组件基座。
- **不新增写入路径**：编辑 / 删除沿用 ADR-0009 的 `/:id/update` 与回收站端点；仅重组承载与动作入口，服务端零改动。
- **柔化而非去除吸顶**：吸顶保留了「今天 / 哪天」上下文（原设计意图），渐变层只消除色带硬切，遵守「无硬边线 / 深度=表面阶+柔影」的柔暗语言。

## 4. 后果

- 新增：`src/components/TaskDetailModal.tsx`、`ProjectDetailModal.tsx`；`.k-modal--detail` / `.k-modal__foot-main` / `.k-modal__foot-actions`；`.k-cal__bar::after` 渐隐层。
- 删除：`src/components/Drawer.tsx` 及 `.k-drawer*` 样式、`--drawer-w` / `--z-drawer` token；各视图内的抽屉分支与重复的字段 / 保存 / 删除代码。
- 迁移：容器名 `drawer → modal`（`docs/08` §5、`docs/03` §5）；组件词汇 `Drawer → Modal`（`docs/00` §5.6、`docs/03` §7）。
- 验证（`.qa/v29/slice-k-verify.py`）：五类表面行点击 + 深链均打开 `role=dialog` 居中弹窗且 DOM 无 `.k-drawer`；水平居中偏差 ≤2px；移动 390 零横溢；ESC 关闭 + 焦点还原 + URL 参数清除；任务完成 / 编辑 / 删除（含撤销）、项目编辑 / 删除、笔记 / 资料编辑 / 删除、资料快捷设置与文件动作、Overview 任务 / 项目弹窗动作齐备；控制台零 error、零数据残留；`npm run build`（tsc strict + vite）通过。
- 证据：`.qa/v29/`（`slice-k-verify.py` + 日志 + 截图，含日历吸顶条滚动前后对照）。

## 5. 非目标（显式延后）

- **日程（event）可写**：`events` 仍不在 `SCHEMAS` / `EDITABLE_KINDS` / `ID_PATTERNS`，无创建 / 编辑 / 取消路径。本切片仅把其详情从抽屉迁到弹窗，保持只读，**不新增可写实体**（与 ADR-0011 §5 一致）。日程详情的操作矩阵留待「事件可写」切片。
- **区域 / 目标 / 习惯管理**、**回顾编辑**、**收件箱内容编辑入口**、**标签注册表管理**：同 ADR-0011 §5，延后。

---

## 6. 修订记录

- 2026-10-03 初版（Slice K）：确立「所有实体详情统一居中弹窗 + 统一操作矩阵」，删除 Drawer，柔化日历吸顶遮罩。
