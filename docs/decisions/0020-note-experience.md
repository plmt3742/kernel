# ADR-0020 · 笔记体验：沉浸阅读 / 撰写 + AI 蒸馏

- 状态：已采纳
- 日期：2026-10-03
- 相关：ADR-0008（收件箱文件投递 · AI 摘录）、ADR-0010（总览 AI 对话 · 归档为笔记）、ADR-0011（状态贯通 · 笔记蒸馏层级判断标准 + 可设置）、ADR-0012（全站详情统一居中弹窗）、ADR-0013（回顾报告 · AI 草稿 / 数字护栏 / 确认后写入）、ADR-0015（AI 全链 · 绝不自动作）、ADR-0019（区域 / 目标 / 习惯可管理）

---

## 1. 背景与问题

所有者 backlog 原话：「**笔记的详情页需要设计一个笔记系统，需要有沉浸式的阅读和撰写体验**」；同时对其中的蒸馏字段提出疑问：「**这个蒸馏是什么意思，是点击后就可以 AI 蒸馏还是什么意思，不太明白**」。

到 Slice X 为止，笔记详情（`src/views/Library.tsx`，Slice K 居中弹窗）存在三处体验缺口：

1. **阅读不是主角**：笔记详情与任务 / 项目共用 `k-modal--detail`（660px），正文沿用全局 `.k-markdown`（`max-width: var(--measure)` = 65ch、行高 `1.65`），并以 `k-dl` 元数据表**居首**——正文被压在元数据之下，标题 / 段落层级未针对长文优化。
2. **撰写面局促**：编辑态复用 `EntityEditForm`，正文字段与其它字段同序同规格（`textarea` 默认 `rows=5`），标题不醒目、正文行高与读写舒适度不足。**没有「新建笔记」入口**——笔记只能经 AI 对话归档产生（`POST /api/notes` 存在但 UI 未暴露）。
3. **蒸馏语义不清**：`distillLevel`（L0–L3）在 Slice H 已可显示 / 可设置（`DISTILL_LEVEL_LABEL` / `DISTILL_LEVEL_DEF`），但**点选只标注层级、不改内容**——UI 没有任何文字说明这一点，用户自然会问「点一下是不是就 AI 蒸馏了」。同时**没有任何内容变换路径**：层级是标签，笔记正文永远不变。

本 ADR 交付沉浸式阅读 / 撰写体验、新建笔记入口，并把「蒸馏」从**语义澄清**升级为**可执行的 AI 蒸馏**（生成下一层草稿 → 用户确认 → 追加），延续 house 纪律：**AI 只出草稿、确认后才写入、可精确撤销**。

## 2. 决策

### 2.1 沉浸阅读（`k-modal--note` + `.k-note-read`）

- 笔记详情改用**专用加宽弹窗变体** `.k-modal--note`（`width: min(820px, 100vw - 32px)`、`max-height: min(88vh, 920px)`）；资料详情仍用 `.k-modal--detail`（660px）。二者由 `className` 按 `selectedNote` 切换。
- 阅读面 `.k-note-read` **只包裹 Markdown 正文**（`.k-note-read .k-markdown`）：`max-width: 68ch`、`line-height: 1.8`、段落节奏 `space-5`、标题按 `h2/h3/h4` token 安静分层、`blockquote` / `pre` / `hr` token 化——正文成为视觉主角。
- **元数据退后**：类型 / 层级 / 区域 / 项目 / 更新 / 标签收进正文上方一条**安静元数据条** `.k-note__meta`（caption 小字 + 底部细分隔线；标签 `margin-left: auto` 靠右、窄屏换行）。蒸馏设置 / AI 蒸馏 / 反向链接 / 关联收进正文下方 `.k-note__secondary`（顶部分隔线区隔）。
- 正文渲染继续使用 **`react-markdown`**（渲染为 React 元素，**不使用 `dangerouslySetInnerHTML`**；原始 HTML 默认转义）。空正文给安静占位提示。

### 2.2 沉浸撰写（编辑面 + 新建笔记）

- **编辑态**：`EntityEditForm` 新增可选 `rows` 字段（textarea 专用）；笔记字段顺序改为 **标题 → 正文（`rows=18`）→ 其余元数据**，外壳 `.k-note-edit` 使 `#k-edit-title` 醒目（`text-h3`）、`#k-edit-body` 高行数（`min-height: 42vh`、行高 `1.8`）。其余字段（类型 / 区域 / 项目 / 标签）保持可用但视觉次之。保留既有「编辑」toggle 行为。
- **新建笔记**：资料页笔记区头部新增安静「新建笔记」入口 → 新组件 `NoteComposeModal`（`k-modal--note`）——醒目标题输入 + 高行数 Markdown 正文 textarea。点「创建笔记」才经通用 `POST /api/notes` 落盘（`title` 必填）；ESC / 取消零写入。
- 成功后：`toast('笔记已创建', { 撤销 })` + **打开新笔记**（`setTarget` + `setSearchParams({ note })`，与既有 `?note=` 深链一致）。**撤销 = 移入回收站**（`trashEntity('notes', id)` 复用回收站端点）+ 关闭若正打开该笔记；失败给出可读错误。

### 2.3 蒸馏语义澄清（标注 vs AI 蒸馏）

新增 `src/lib/format.ts` `DISTILL_HELP` 常量，在蒸馏快捷设置下方以安静一行呈现：

> 蒸馏 = 逐层压缩：L0 原文 → L1 划线 → L2 摘要 → L3 永久笔记。点选只标注层级、不会改写内容；『AI 蒸馏』生成下一层草稿，确认后才追加到正文。

并新增 `nextDistillLevel(level)`（当前 + 1，封顶 L3）供按钮文案使用。`DISTILL_LEVEL_LABEL` / `DISTILL_LEVEL_DEF`（每层判断标准，作为 helper 与 `title`）保持不变——**点选仅标注层级**这一语义此处被显式写清。

### 2.4 AI 蒸馏端点（`POST /api/ai/note/distill`）

- 请求 `{ id: string, targetLevel?: number }`（`noteDistillRequestSchema`：`id` 必须 `/^n-\d{4}$/`，`targetLevel` 1–3 可选）。
- **目标层级**：缺省 = 当前 `distillLevel + 1`，与显式值一并 **clamp 到 1–3**（封顶 L3）；已为 L3 时缺省目标仍为 3（生成 L3 提炼）。
- 服务端读笔记（不存在 → 404），探活 opencode（不可用 → 503），调用 `draftNoteDistill(note, target)`：
  - digest 注入标题 / 类型 / 当前层级 / 正文（正文硬上限 **6000 字**，超长截断）；
  - 系统提示词按层级给出指令（L1 划线 = 挑原句 ≤5 条；L2 摘要 = 自述压缩保留核心；L3 永久笔记 = 一个主张 + 2–4 支撑要点），并硬性要求**保守压缩、绝不编造、保留关键事实、目标 ≤300 字**（输出上限 1200 字）；若正文已含旧蒸馏小节，要求基于其上方内容重生成；
  - **指令式 JSON + Zod（`noteDistillSchema`）+ 单次重试**（与 `draftTask` / `draftProject` 同一范式）；
- 响应 `{ text, targetLevel, model, ms }`。**绝不落盘**（无 `commit`、无审计）；失败 502。

### 2.5 应用 / 撤销（追加不替换）

- UI 在详情内联展开 `.k-note-ai` 建议面板：**可编辑 textarea**（预填 AI 文本）+ 「应用到笔记」/「忽略」+ 失败时安静 toast / 重试（非阻断）。选择**内联面板**而非嵌套弹窗，避免两层 `Modal` 的 ESC / 焦点争用（沿用 Slice X 深链编辑的同一判断）。
- 应用：`body = 原正文 + "\n\n---\n\n## 蒸馏 → L{n} {层级名}\n\n{text}"`（原正文为空时直接以该小节开头），并经 `POST /api/notes/:id/update` 一次写入 `{ body, distillLevel: targetLevel }`。**追加不替换——原文永不丢失**；标题中的层级名由前端拼接，不依赖 AI 输出格式。
- 撤销：客户端记录应用前的 `body` 与 `distillLevel`，撤销即 `updateEntity('notes', id, { body: prevBody, distillLevel: prevLevel })` **往返精确还原**（注入式撤销，无需新增端点；`updatedAt` 会随两次写入变化，内容与层级精确恢复）。

### 2.6 边界（明确不做）

- **绝不自动应用**：AI 蒸馏只出草稿，必须用户点「应用到笔记」；无 `aiAutomation` 联动（该档位仅覆盖收件箱创建类动作）。
- **不替换正文**：只追加带 `## 蒸馏 → Lx` 标题的小节；不做「覆盖式重写」。
- **不做富文本 / 所见即所得编辑器**：撰写面是纯 textarea + Markdown；不引入编辑器依赖（无新前端依赖）。
- **不做笔记版本历史**：撤销仅覆盖「最近一次蒸馏应用」；更早版本不追溯。
- **不做批量蒸馏 / 自动分层**：一次一篇、用户显式触发。
- `distillLevel` 仍是可独立设置的标签；AI 蒸馏只是「生成下一层草稿」的辅助，不改变「点选 = 标注」的基本语义。

## 3. 后果

**正面**

- 笔记详情从「元数据表 + 正文」变为「**正文为主角 + 安静元数据条 + 次级区**」，长文阅读舒适（68ch / 行高 1.8 / 清晰标题层级）。
- 撰写体验完整：编辑面标题醒目、正文高行数；资料页可直接新建 Markdown 笔记并即时打开，创建可撤销。
- 「蒸馏」语义被显式解释（标注 vs AI 草稿），消除所有者困惑；蒸馏从死标签升级为可执行的渐进压缩，且**原文永不丢失、可精确撤销**。
- 沿用 house 纪律：AI 只出建议、确认后写入、经单写者 + Zod + 原子写 + 审计；无新增依赖。

**代价 / 已知限制**

- 追加式蒸馏会使正文增长（含 `---` 与标题）；多次蒸馏会累积多节。这是「不丢原文」的有意取舍（README / guide 提示）。
- `updatedAt` 在应用 / 撤销各 bump 一次；撤销后内容精确但时间戳前移（可接受）。
- AI 蒸馏质量取决于模型；系统以「≤300 字、保守、保留关键事实」约束并允许用户编辑草稿，但不对内容正确性做保证。
- 不记录笔记版本，撤销窗口仅限最近一次应用。

## 4. 验证

- `npm run build`（tsc strict + vite）退出 0。
- 服务端冒烟 `.qa/v40/server-smoke.mjs` **34/34**：笔记 `create`（`nextId` = `n-<max+1>`、`distillLevel=0`、`links=[]`、空标题 400）；`update`（body + `distillLevel` 生效、`updatedAt` 递增）；`POST /api/ai/note/distill` 非法 id 400 / 不存在 404 / 真实 AI 返回 `text` 非空 + 缺省 `targetLevel = 当前+1`（2→3）+ 显式 `targetLevel=1` + L3 封顶、**且蒸馏前后笔记 body / 层级不变（不写入）**；回收站 `trash → restore → purge` 往返；审计 `note.create/update/trash/restore/purge`；零残留；所有者 157 个数据文件**字节不变**（`n-0016` 逐字节一致）。
- 浏览器 E2E `.qa/v40/verify-m.py` **35/35**：`n-0001` 阅读面（`.k-modal--note` + 元数据条 + 正文行高 1.80 + 阅读宽度 634px ≤720）；编辑面（标题 21.7px > 正文 14.9px、正文行高 1.80、撰写面高 501px）；新建笔记（撰写弹窗 → 创建落盘 → 打开 `?note=` → toast 撤销移出正册）；AI 蒸馏（拦截端点 → 建议面板可编辑 → 应用后正文追加 `## 蒸馏 → L1` + `distillLevel=1` + 原文保留 → toast 撤销精确还原）；390 零横溢；控制台 0 error；零残留；标签注册表与笔记集合与基线一致。
- 证据目录 `.qa/v40/`（冒烟日志、E2E 脚本、7 张截图、前后哈希）。
