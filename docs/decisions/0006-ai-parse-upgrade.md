# ADR 0006 · AI 解析升级（上下文注入 + 挂接建议 + SSE 过程流）

- 状态：已接受
- 日期：2026-10-02
- 决策者：项目所有者（「AI 作用于全系统 + 过程可视」指令）+ 实证探针（`.qa/v14/probe-stream.mjs`、`smoke-ai-stream.mjs`）
- 关联：`docs/02-ARCHITECTURE.md` §4、ADR-0005、`CHANGELOG.md`、`TASK_BOOK.md`、`.qa/v14/`

---

## 1. 背景

ADR-0005 已把「SSE 流式进度」与「AI 作用于更多层面」列为后续增量。所有者指令将其升级为：解析除分类外要能**连接系统**（挂接既有项目 / 区域 / 标签、查重），且过程要**可见**。

探针实测（`.qa/v14/probe-stream.mjs`，真实 opencode serve）：解析期间事件流包含 `message.part.delta`（逐字增量，`{sessionID, messageID, partID, field, delta}`）、`message.part.updated`、`session.status`、`session.idle`；低档位模型亦产出 `reasoning` 分段（最终 parts：`step-start / reasoning / text / step-finish`）。服务端冒烟（`smoke-ai-stream.mjs`）验证帧协议与建议形状。

## 2. 决策

1. **上下文注入**：解析前读数据快照，生成紧凑系统摘要（项目 / 区域 / 标签注册表 / 近期未完成任务 ≤50 条，~4KB 预算）注入系统提示；模型只能引用摘要中列出的 id 与标签名。
2. **挂接建议 + 防臆造**：建议 schema 扩展 `projectId / areaId / tags / duplicateOf`；服务端 `postValidate` 按快照二次过滤（未知 id / 未注册标签一律丢弃；null 归一化）。双重防线：提示约束 + 服务端校验。
3. **澄清联动**：`clarifyDetailsSchema` 与 `clarifyInbox` 支持 `projectId / areaId`（仅 task 目标；`readEntity` 存在性校验，缺失 400）。AI 仍只出建议，落盘走既有确认链路（撤销链天然兼容）。
4. **SSE 过程流**：新增 `POST /api/ai/inbox/:id/parse-stream`——`event.subscribe` 事件泵（按 sessionID 过滤）+ 帧协议 `status / delta / retry / suggestion / error`；客户端断开即停止；同步端点 `POST /api/ai/inbox/:id/parse` 保留为回退。
5. **前端**：`aiParseInboxStream`（fetch 流 + chunk 安全 SSE 解析）；过程面板（阶段文案 + 240 字尾部实时预览，安静样式、token 化）；建议卡挂接 chips（项目 / 区域 / 标签 / 疑似重复——只展示，绝不自动合并）。

## 3. 理由

- 摘要注入使建议从「猜测」变为「对账」：实测 i-0001 建议挂接 `p-0006 / a-0002 / role:monitor`，质量可验证。
- 流式只增加可观测性：解析语义、确认与撤销链路不变（仍是只读建议）；SSE 泵为后续 AI 动作（回顾周报等）的过程可视打底。
- 与 ADR-0005 同构：本地闭环（仅 127.0.0.1）、只建议、可撤销。

## 4. 后果

- 每次解析的 prompt 体积增加（摘要 ~2–4KB）；摘要按 `updatedAt` 截断控制预算。
- 前端新增流式路径；同步端点保留，旧调用与测试不受影响。
- 新增工具 `scripts/spawn-bg.mjs`（后台安全启动器）；Windows 操作纪律修订见 AGENTS.md。
- 新增端点与帧协议纳入 `docs/02` §4 描述范围。

## 5. 非目标

- 工具调用式「真搜索」（让模型主动检索库内条目）—— 后续增量选项；本切片为摘要注入。
- 自动落盘 / 自动合并重复 —— 明确不做。
- 文件 / 通知投递解析 —— 仍列后续。

---

## 6. 修订（2026-10-03 · Slice E2.5：挂靠规则 v2 + newProjectHint）

**触发**：owner 反馈「辩论赛」文件被 AI 硬挂到无关项目（学生组织·程序设计大赛），因为旧提示词要求「只能从现有项目里选」，缺「宁缺毋滥」与「这是新事务」的判断。

1. **挂靠宁缺毋滥（§2 提示词修订）**：`projectId / areaId / tags / duplicateOf` 仅在内容与现有对象有**明确依据**时才填；**表面相似（都含「竞赛 / 比赛 / 规则」字样）不算依据**；拿不准一律 null。附件不可直接读取（仅文件名 / 元数据）时进一步保守：除非文件名直接指向某现有项目（名称 / 主题强匹配），否则 `projectId` 一律 null，并在 reason 注明「仅基于文件名判断」。
2. **新增字段 `newProjectHint`**：`aiSuggestionSchema` 增 `newProjectHint: z.union([z.string(), z.null()]).optional()`（≤40 字）。当内容像一件需要多步推进的**新事务**（新比赛 / 新活动 / 新项目）且不属于任何现有项目时给出建议项目名；否则 null。
3. **互斥 + 后校验**：`newProjectHint` 与 `projectId` 互斥（要么挂现有、要么提示新建、要么都不）。`normalizeSuggestion` 丢弃 null；`postValidate` 追加 trim + `Array.from(...).slice(0,40)` 截断 + 丢弃空串 + 与 `projectId` 互斥 + 与现有项目标题完全相同者丢弃。
4. **前端仅提示**：「建议新项目：{X}」+「可到项目页新建」安静 chip，**绝不自动创建 / 自动挂靠**；`AiSuggestion.newProjectHint?`。
5. **验证**：辩论赛样例解析 `projectId=null` + `newProjectHint=新生辩论赛筹备`（`areaId=a-0003`）；控制样例「学生组织：策划书要补个流程图」正确挂 `p-0002`（明确依据）。提示词**一次通过**。证据 `.qa/v19/smoke-e25.mjs`、`.qa/v19/slice-e25-verify.py`。
