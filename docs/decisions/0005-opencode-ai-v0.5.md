# ADR 0005 · v0.5 opencode AI 接入（首个切片）

- 状态：已接受
- 日期：2026-10-02
- 决策者：项目所有者（「走 opencode 的现有默认配置」指令）+ 实证探针（`.qa/v13/probe*.mjs`、`smoke-ai.mjs`）
- 关联：`docs/02-ARCHITECTURE.md` §4、`docs/06-ROADMAP.md` v0.5、`CHANGELOG.md`、`.qa/v13/`

---

## 1. 背景

宪法立场「opencode 即大脑」在 v0.5 开始落地，首个切片为**收件箱「AI 解析」**：条目 → 结构化建议 → 用户确认 → 走既有澄清写入。`docs/02` §4 的规划基于前期调研；实现前以**实证探针**对真实环境（opencode CLI 1.18.32、`@opencode-ai/sdk` 1.18.34、serve 于 4096）逐项核对，发现三处与规划不同的事实，需以 ADR 具体化：

1. `opencode serve` **默认端口为 0（随机）**，并非 4096 —— 需显式 `--port 4096`（`--hostname` 默认 `127.0.0.1` 符合预期）。
2. **结构化输出仅 v2 SDK 类型暴露**（`@opencode-ai/sdk/v2` 的 `format: json_schema` / `info.structured`）；且在本机默认模型（deepseek-flash，thinking 模式）上被上游 API 直接拒绝：`Thinking mode does not support this tool_choice`。
3. reasoning 模型默认档位延迟不可接受（实测单次解析 **236s**）；指定 `variant: 'low'` 后 **4.4s**，输出质量经样例验证（干净 JSON、字段合理）。

## 2. 决策

1. **接入链路**（沿规划）：网页 → 本地 Node 数据服务（代理与守门人）→ `opencode serve`（仅 `127.0.0.1:4096`）→ 结果回网页。opencode 不被前端直连、永不暴露局域网。
2. **启动生命周期**：`scripts/dev.mjs` 启动时探测 4096 —— 已在运行则跳过；空闲则以托管子进程拉起 `opencode serve --port 4096`（dev 退出一并关闭）；CLI 缺失仅告警不阻断。`OPENCODE_SERVER_PASSWORD` 可选：设置时以 HTTP Basic 头连接（SDK 不自动读取环境变量）。
3. **SDK**：`@opencode-ai/sdk`（ESM，服务端依赖）；使用 **v2 客户端**（扁平调用）：`session.create({ title })`、`session.prompt({ sessionID, system, variant, parts })`。
4. **模型策略**：不传 `model` —— 走 opencode 既有默认配置（本机解析为 `deepseek/deepseek-flash`）；解析调用固定 `variant: 'low'`（推理档位轻量化）。
5. **结构化输出**：不依赖 `format: json_schema`；采用**「指令式 JSON + Zod 校验 + 失败重试一次（带原因反馈）」**，输出经 `aiSuggestionSchema` 校验后才成为建议。未来对支持强制工具调用的模型可无损升级为 `format`。
6. **写入纪律**：AI 只产出建议、绝不直接写数据；用户确认后走既有 `clarifyInbox` 通道（扩展可选 `details`：title / contexts / energy / importance / estimateMin / dueAt / tags，及 `ai: true` 审计标记）；撤销沿用既有 revert（删除产物）。
7. **服务端点**：`GET /api/ai/health`（available / model / url）；`POST /api/ai/inbox/:id/parse`（建议 + model + ms；404/409/503/502 语义化错误）。解析超时上限 120s；serve 不可达时显式降级（503 文案），不阻断其它功能。

## 3. 理由

- **代理与守门人**：与数据服务同构（单写者 + 校验 + 审计），不新增暴露面；手机经代理同样可用。
- **实证优先**：三处规划偏差均由探针实测发现并修正（`.qa/v13/probe1–5`），避免按过时假设实现。
- **低档推理**：解析为轻量信息提取任务，`variant:'low'` 质量与延迟双达标（4.4s）。
- **指令式 JSON**：兼容面最大（任何具备文本能力且能遵循指令的模型都可），校验与重试收敛在服务端（Zod 为既有依赖）。
- **建议 → 确认 → 落盘**：与「敏感操作显式确认」纪律一致；AI 不越权，可撤销。

## 4. 后果

- 新增服务端依赖 `@opencode-ai/sdk`；前端依赖白名单不变。
- `docs/02` §4 事实修订：serve 端口需显式指定；结构化输出路线以本 ADR 为准。
- 状态条与设置页出现 AI 实时状态（在线/离线）；离线时功能显式降级。
- 首个切片采用**同步 prompt**（实测 ~3–5s），SSE 流式进度列为后续增量（本 ADR 记录）。
- 每次解析新建 opencode 会话（上下文隔离）；会话留存于 opencode 自有存储。
- 既有写入通道零改动（仅 clarify 扩展可选字段，旧调用不受影响）；撤销链路天然兼容。

## 5. 非目标

- 总览 AI 摘要/建议卡回归、通知与文件投递解析、SSE 流式、多轮对话 —— 后续增量。
- 模型选择 UI / provider 管理 —— 由 opencode 自身配置承担。
- 无确认自动落盘 —— 明确不做。
