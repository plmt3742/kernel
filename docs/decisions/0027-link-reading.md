# ADR-0027 · 链接阅读：首次出站抓取 + 粘贴截图（Slice N2 / N2.5）

- 状态：已采纳
- 日期：2026-10-03
- 相关：ADR-0005（opencode AI 接入）、ADR-0008（收件箱文件投递）、ADR-0011（先确认后写入）、ADR-0015（AI 全链 · 多实体一揽子处置）、ADR-0023（公告解析 · 截图接入）、ADR-0025（课表导入）

---

## 1. 背景与反馈

所有者问：「目前程序能阅读图片和链接吗？」实测两条：

1. **图片早已可读**——Slice N0（ADR-0023）把截图接进收件箱解析：`isImageFile()` 命中即走 opencode file part（`data:<mime>;base64,…`），默认模型 `deepseek/deepseek-flash` 实测可读图，无需 OCR、无需换模型。
2. **链接此前读不了**——把一条裸 URL（如网页文章地址）丢进收件箱，模型明说「内容未能自动读取」，只能凭 URL 字面猜测；产出的资料既没有正文依据，也没有像样的简介。

本切片（Slice N2）补齐**链接阅读**：文本条目含 http(s) 链接时，解析前在服务端抓**首个**链接的正文，注入解析上下文，让 AI 基于**实际内容**写简介、填 `url`。这是系统**首次出站抓取**，安全纪律需随之一并确立。附带切片 N2.5 补上 **Ctrl+V 粘贴截图**，让截图投递与拖拽同路。

## 2. 决策

### 2.1 抓取链路与约束

链接抓取只在服务端发生，且只在**解析文本条目**（无附件）时触发。链路：`extractFirstUrl` → `fetchLinkExcerpt` → `buildLinkSection`。

| 环节 | 约束 |
|---|---|
| 提取 | `extractFirstUrl` 保守正则：仅 `http(s)`，遇到空白 / CJK / 中英文标点即止，再剥尾随 ASCII 标点；**只取首个链接** |
| 目标 | 私网 / 环回 / 链路本地 hostname **直接拒绝且不发请求**（SSRF 防护）：`localhost`（含子域）/ `::1` / `0.0.0.0` / `127.*` / `10.*` / `172.16-31.*` / `192.168.*` / `169.254.*` |
| 超时 | `AbortController` **8s**；`redirect:'follow'` |
| 请求头 | 常规桌面 UA + `Accept-Language: zh-CN`（仅降低被反爬直接拒绝的概率，不代表任何自动爬取意图） |
| 类型 | 仅 `text/html` / `application/xhtml+xml` / `text/plain`；其余不读 |
| 体积 | **流式读取上限 2MB**，超限截断并 `cancel` |
| 编码 | charset 探测：content-type → `<meta charset>` → 默认 utf8；`gb2312`/`gb18030` 归一到 `gbk`；utf8 乱码过多回退 gbk |
| 正文 | `htmlToArticleText`：删 script/style/noscript/注释/svg，块级标签转换行，解实体，折叠空白，**≤8000 字**；另抽 `<title>`（≤200 字） |
| 失败 | 任何失败（网络 / 超时 / 非 2xx / 非 HTML / 空正文）→ `null`，**绝不抛出** |

### 2.2 注入与回退

`buildLinkSection(content)` 产出注入段：

- **抓取成功**：`【链接摘录】（url）` + 标题 + 正文，作为解析上下文的一部分；resource 动作获得 `url`。
- **抓取失败**：`【链接】url（自动抓取未成功——按链接保守处理）`——**不阻断解析**，仅降级为「链接资料」，`url` 仍保留。

解析注入只在**文本条目**（无附件）且内容含链接时发生；同步 `parseInboxItem` 与流式 `parseInboxItemStream` **共用同一段**逻辑。

**提示词**相应调整：动作字段表增 `url`（仅 resource）；规则补「有【链接摘录】时，resource 的 `note` 必须基于摘录实际内容撰写（这是什么 / 讲了什么 / 有什么用），**禁止再写『未能读取』式保守话术**」。

**确定性兜底**：`applyLinkUrlFallback` 在命中链接、且首个 resource 动作没有 `url` 时补上（`url` 须 ≤2000），不依赖模型自觉。

### 2.3 url 端到端

| 层 | 变更 |
|---|---|
| schema | `aiActionSchema.url`（`z.union([z.string().max(2000), z.null()]).optional()`） |
| 清洗 | `postValidateActions`：`url` 仅 resource 有意义，trim 后须 `http(s)` 开头且 ≤2000，否则删除；`applyLinkUrlFallback` 兜底 |
| 落盘 | `POST /api/inbox/:id/apply` 的 resource 分支把 `action.url` 写入 `record.url`（Zod 已验形状） |
| 前端 | `AiAction.url` 类型 + `ACTION_FIELD_MATRIX.resource` 增 `url` + `AiSuggestionForm` `type=url` 输入；`formToAction` 空串删除，避免送出空值 |
| 展示 | 资料详情的链接行用既有 `<a>` 渲染（无需改动） |

### 2.4 前端配套：Ctrl+V 粘贴截图（N2.5）

收件箱页挂 **window 级 `paste` 监听**（仅组件挂载期存活，卸载即移除）：剪贴板含图片时 `preventDefault()`，按 `粘贴截图-YYYYMMDD-HHmmss.<ext>` 命名（MIME → 扩展名，未知回退 png）入**待上传队列**——与拖拽**同通路**（`addFiles`）；**纯文本不拦截**，照常落进输入框。收件箱编辑器提示同步为「拖拽文件到此处 · Ctrl+V 粘贴截图」。

## 3. 备选与取舍

| 备选 | 取舍 | 理由 |
|---|---|---|
| 服务端抓取（本次采纳） | **采纳** | 唯一能拿到网页正文的出口；可控、可限时限体积、可做 SSRF 防护；抓取结果只进本机解析上下文，不落盘 |
| 让模型侧（opencode 工具）抓取 | **否决** | 不可控、不确定性高；模型何时抓、抓几个、超时行为都难约束，失败还会以自然语言掩盖 |
| 前端抓取 | **否决** | CORS 会挡住绝大多数站点；且把抓取能力放到浏览器端，会把本机信息面暴露给任意页面脚本 |
| 专用抓取端点（如 `POST /api/fetch-link`） | **暂不加** | 当前只需「解析时读首个链接」；一旦暴露成独立端点，等于给前端开一个任意 URL 的抓取面，安全边界变大。需要时（如手动「读取链接」按钮）再开 ADR |
| 自动应用抓取结果 | **否决** | 与全站 confirm-first 一致：抓取与解析只产建议，写入仍需用户确认 |

## 4. 边界

- 仅抓**首个**链接；不做 JS 渲染（抓的是静态 HTML）；不做登录态、不做多页爬取。
- 公众号 / 反爬站点可能失败——失败即回退「链接资料」保守处理，**不阻断解析**。
- **DNS 解析后的地址不做二次校验**（如 DNS rebinding）：面向个人本地工具，literal 级 hostname 防护即可，不为此引入 DNS 解析依赖。
- IPv6 私网段未穷举（当前仅 `::1`）。
- 出站抓取仅发生在**解析文本条目**时、仅 `http(s)`、限时限体积、私网拒抓；**不改变单写者 / 审计边界**（抓取本身不落盘、无审计）。
- 抓取结果不落盘：落盘的 `url` 是**用户可核对的原始链接**，正文摘录只作解析上下文。

## 5. 影响面（文件）

- 服务端：`server/ai.mjs`（`extractFirstUrl` / `isPrivateHostname` / `readBodyLimited` / `detectCharset` / `decodeBytes` / `extractHtmlTitle` / `htmlToArticleText` / `fetchLinkExcerpt` / `buildLinkSection` / `applyLinkUrlFallback` + 提示词 `url` 字段与规则；同步 / 流式共用）、`server/schemas.mjs`（`aiActionSchema.url`）、`server/index.mjs`（apply 的 resource 分支持久化 `record.url`）。
- 前端：`src/lib/mutations.ts`（`AiAction.url`）、`src/lib/aiForm.ts`（`url` 字段 + `ACTION_FIELD_MATRIX.resource`）、`src/components/AiSuggestionForm.tsx`（`type=url` 输入）、`src/views/Inbox.tsx`（window 级 `paste` 监听 + 时间戳命名 + 提示文案）。
- 未改 `data/` 种子；未新增依赖；无新增写入面与端点。

## 6. 验证与证据

- 链接探测 `.qa/probe-n2/` **23/23**：覆盖 `extractFirstUrl`（CJK / 标点 / 多链接 / 空壳 → null）、`isPrivateHostname`（`localhost` / `::1` / `127.*` / `10.*` / `172.16-31.*` / `192.168.*` / `169.254.*` 拒绝、公网放行）、`htmlToArticleText`（script / style / 注释 / 块级换行 / 实体 / 截断）、**真实抓取 `example.com` → 「Example Domain」正文**、失败回退段文案。
- 回归 `probe-h1` **19/19**（课表导入契约不受影响）。
- 抓取为只读外部请求，不产生本地写入与审计；未新增依赖。
