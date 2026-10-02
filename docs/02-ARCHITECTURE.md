# 02 · 技术架构

> 本篇展开宪法 §6 与 §8。描述技术选型与理由、数据层现状与未来、opencode 集成路线、托管拓扑与目录职责。事实源是 `docs/00-DESIGN-BRIEF.md`。

---

## 1. 架构总览

```text
[手机浏览器]  ──HTTP(局域网)──>  [PC: Vite dev / preview]
                                        │  /api 代理
                                        ▼
                              [本地 Node 数据服务 127.0.0.1:4097]
                                        │  读写（唯一写者）
                                        ▼
                              [data/ 文件式 JSON 数据库 + activity.jsonl 审计]
                                        ▲
                                        │ 写入（v0.5）
                              [opencode serve 127.0.0.1:4096]
```

分层原则：前端只负责呈现与调度；数据以文件形式留在本地；写入与 AI 能力收拢到本地 Node 服务，前端不直接触达文件系统，也不直接触达 opencode。

## 2. 技术栈决策

### 2.1 选定栈

- **Vite + React 19 + TypeScript（strict）+ 原生 CSS（CSS 变量 token 体系）**
- 路由：`react-router-dom`（使用 `viewTransition` 能力）
- 动效：**Motion**（组件状态 / 布局 / layoutId 共享元素 / 手势）+ **View Transitions API**（路由级变形）
- 命令面板：**cmdk**
- 其他白名单依赖：`date-fns`、`clsx`、`lucide-react`、`react-markdown`
- 字体：`@fontsource-variable/inter`、`@fontsource/jetbrains-mono`（自托管，离线可用）
- 数据服务（`server/`，仅服务端）：`zod`、`write-file-atomic`（见 ADR-0004）

前端依赖白名单（宪法 §6.1）：

```text
react  react-dom  react-router-dom  motion  cmdk  date-fns  clsx
lucide-react  react-markdown  @fontsource-variable/inter  @fontsource/jetbrains-mono
```

### 2.2 状态与路由

- 状态管理：React 内置（Context + hooks）；数据读取为模块级可变快照（`src/lib/data.ts`，挂载后经 `/api/snapshot` 水合），写入经 `src/lib/mutations.ts` → 数据服务 API（v0.4 起，localStorage 原型层已退役）。主题与轨道折叠等纯 UI 偏好仍存 localStorage。
- 路由：`/` 总览 · `/inbox` · `/tasks` · `/calendar` · `/projects` · `/library` · `/review` · `/settings` · `/trash`（回收站）。

### 2.3 为什么不用 UI 框架 / Tailwind

| 决策 | 理由 |
|---|---|
| 不用组件库（MUI、Ant 等） | 本项目视觉是定制化的瑞士国际主义网格 + 纸感/墨感双主题。组件库的默认观感与 token 体系冲突，覆盖成本高于从零构建。 |
| 不用 Tailwind | 设计 token 已通过 CSS 变量表达，原生 CSS 与 token 是同一套语言。引入原子类会形成第二套样式来源，破坏"唯一 token 来源"的纪律。 |
| 用原生 CSS 变量 | token 可被设计系统、主题切换、对比度校验统一管理；零圆角、发际线、单一强调色等纪律用变量表达最直接。 |
| 用 Motion 而非 GSAP | v0.2 只需状态、布局与共享元素动效，Motion 与 React 模型贴合；GSAP 属于未来可选，不在 v0.2 引入。 |

## 3. 数据层

### 3.1 当前（v0.1 / v0.2）：文件式 JSON

- 数据源：`data/**`，**一记录一文件**。
- 前端经 `src/lib/data.ts` 读取：`import.meta.glob('/data/**/*.json')` + 类型化 getter；dev 下数据改动热更新。
- 规范：JSON UTF-8；ID 稳定（`t-0001` 式）；时间 ISO 8601 带偏移；字段见 `04-DATA-MODEL.md`。
- 禁止：前端直接写文件；在 JSON 中存储计算派生值（进度等一律运行时计算）。

一记录一文件的理由：

| 好处 | 说明 |
|---|---|
| 可 diff | 单条记录变化只产生一条文件的 diff，便于人工审查与未来 git 历史。 |
| 可备份 / 可迁移 | 直接拷贝目录即可，无数据库进程依赖。 |
| 冲突面小 | 不同记录在不同文件，未来多人或代理协作时冲突范围有限。 |
| AI 友好 | AI 可直接读写单个记录文件，不需要理解数据库协议。 |

### 3.2 已实现（v0.4）：Node 单写者数据服务

本地 Node 数据服务（`server/`）是**唯一写入路径**（实现细节见 ADR-0004）：

- **单写者**：所有写入经同一服务串行化（进程内写队列），消除并发写文件的风险。
- **原子写入**：`write-file-atomic`，避免写入中断产生半截文件。
- **Schema 校验**：Zod 定义可写实体（task / inboxItem / note / resource / project）的 schema，写入前全量校验；校验失败返回 400 与可读原因。
- **审计日志**：`data/activity.jsonl` 记录每一次变更，可追溯（重新打开任务即从审计还原先前状态）。
- **写入路径收口**：浏览器（含手机经 Vite 代理）写入一律经 `/api`；服务仅监听 `127.0.0.1:4097`，永不暴露局域网。
- **前端水合**：首帧使用构建期 seed；挂载与窗口聚焦时经 `/api/snapshot` 重水合（多标签同步由聚焦刷新承担，实时通道留待 v0.5）。

v0.5 增补（Slice E2，见 ADR-0009）：可写实体通用编辑 `POST /api/<kind>/<id>/update`（字段白名单 + Zod + 审计）；回收站存储 `data/trash/<kind>/<id>.json`（原记录 + `trashedAt`），端点 `POST /api/<kind>/<id>/trash`、`GET /api/trash`、`POST /api/trash/<kind>/<id>/restore`、`POST /api/trash/<kind>/<id>/purge`；`POST /api/reveal` 经 `explorer.exe /select` 在本机文件管理器中定位（仅本机，见 ADR-0009）。

v0.5 增补（Slice G，见 ADR-0010）：通用笔记创建 `POST /api/notes`（title 非空 + `type` 白名单缺省 `memo`；`nextId` + `commit` + 审计 `note.create`；201），供总览「AI 对话归档」等调用；只读 AI 对话 `POST /api/ai/chat`（有界历史 + 读快照摘要，自然语言回答，不落盘）。

v0.5 增补（Slice H，见 ADR-0011）：任务快速新建 AI 补全 `POST /api/ai/task/draft { title }`（标题非空 400 / 有界 ≤200 字；读快照摘要 + 指令式 JSON + Zod + 单次重试；返回 `{ suggestion, model, ms }`，**不落盘**，health 503 / 失败 502）；通用编辑白名单扩充（见 ADR-0009 路径）——`notes` 增 `areaId/projectId/distillLevel`、`resources` 增 `areaId`、`projects` 增 `goalId/nextActionId`，使「已显示」的状态 / 字段全部可设。

v0.5 增补（Slice O，见 ADR-0011 §6）：**先确认后写入**成为统一模式。`POST /api/tasks` 扩展——`title` 必填不变，接受可选白名单字段 `contexts/energy/importance/estimateMin/dueAt/projectId/areaId/tags`（`taskCreateFieldsSchema`，与澄清覆盖同口径），创建前校验 `projectId/areaId` 形状与存在性（臆造即 400），审计 `task.create` 的 `detail.fields`；仅传 `{title}` 的旧调用行为不变。前端任务快速新建改为**居中草稿确认弹窗**（打开即 `POST /api/ai/task/draft` 预填、全字段可编辑、点「创建任务」才经扩展后的 `POST /api/tasks` 落盘，确认前零写入）；收件箱 AI 建议卡亦增「编辑」，应用提交编辑值走既有 `clarify`（`details` + `ai:true`）。

v0.5 增补（Slice V，见 ADR-0008 §6）：**收件箱生命周期闭合 + 澄清字段矩阵**。文本捕捉成功后前端自动触发一次 AI 解析（复用既有 `POST /api/ai/inbox/:id/parse-stream`；先探活 `/api/ai/health`，离线静默跳过、绝不自动应用，手动入口保留）。复用既有端点补齐 UI 出口：删除 `POST /api/inbox/:id/remove`（未澄清 / 已丢弃；服务端一并清理附件，已澄清仍 409 保护）、恢复 / 撤回 `POST /api/inbox/:id/revert`（discarded → 仅重置 `unprocessed`；clarified → 删除 `linkedId` 产物后回退）；已澄清条目「查看产物」按 `linkedId` 前缀深链。服务端 `clarify` 扩展示意：note 分支接受 `projectId` / `areaId`（真实存在校验）、resource 分支的 `title` 对文件条目同样应用——UI 只渲染该 target 会应用的字段（`src/lib/aiForm.ts` `CLARIFY_FIELD_MATRIX`），无新端点。

v0.5 增补（Slice T，见 ADR-0014）：**标签完整生命周期**。标签名写入前经 `normalizeTagName()` 规格化（裸名 → `topic:` 前缀；`@` → context；空串丢弃）；任意携带 `tags` 的写入（任务创建 / 更新、澄清 `details.tags`、项目创建 / 更新、笔记创建 / 更新、资料更新）之后 `ensureTags()` 把未注册名登记进 `data/meta/tags.json`（新增可选字段 `origin: 'seed'|'manual'|'ai'` / `createdAt` / `firstUsedIn`，审计 `tag.create`；请求带 `ai:true` → origin `ai`）。新增标签管理端点：`POST /api/tags/:id/update { name?, label? }`（重命名，级联重写全部实体 tags，审计 `tag.rename` · `detail.from/to/affected`；同名冲突 409）、`POST /api/tags/:id/merge { targetId }`（合并，级联替换 + 去重、源移除，审计 `tag.merge`）、`POST /api/tags/:id/remove`（`usage>0` → 409 阻止并给出计数；`usage==0` → 移除注册项，审计 `tag.remove`）、`POST /api/tags/backfill`（扫描 `tasks/projects/notes/resources/events` 上未注册的标签名并登记，审计逐条 `tag.create` + `tag.backfill`）。级联只改 `tags` 数组、**不 bump `updatedAt`**（避免污染停滞项目 / 回顾口径）；写入沿单写者串行队列 + 原子写 + 审计。

派生值纪律在数据服务阶段依然适用：进度、计数、聚合必须运行时计算，不落盘。

## 4. opencode 集成计划（v0.5）

### 4.1 事实基础（已调研）

- opencode 项目组织已迁移至 **`anomalyco/opencode`**。
- `opencode serve` 以 **`--port 4096`** 显式启动（v1.18 默认端口为 0/随机）；仅监听 `127.0.0.1`。
- OpenAPI 文档位于 `/doc`。
- SDK：`@opencode-ai/sdk`（v2 客户端、扁平调用），使用 `createOpencodeClient`；会话 API 含 `session.create` / `prompt` / `promptAsync`。
- 事件流：`event.subscribe` 为 SSE。
- 结构化输出：`format: json_schema`（仅 v2 类型暴露；thinking 模式模型可能拒绝强制 tool_choice——v0.5 首个切片改用「指令式 JSON + Zod 校验」，见 ADR-0005）。
- 鉴权：`OPENCODE_SERVER_PASSWORD`。

### 4.2 目标链路

```text
网页 → 本地 Node 服务（单写者、代理）→ opencode serve（仅 localhost）→ 结果写回 data/ ，进度经 SSE 推回网页
```

- opencode 只被本地 Node 服务访问，前端不直连 opencode。
- Node 服务扮演代理与守门人：拼装 prompt、校验结构化输出、写回数据。
- 进度与流式结果经 SSE 推送到网页。

### 4.3 安全纪律

- **opencode 永不直接暴露到局域网**，仅监听 `127.0.0.1`。
- 敏感操作需显式确认。
- AI 已接入（v0.5：收件箱「AI 解析」→ 升级切片：上下文注入 + 挂接建议 + SSE 过程可视，见 ADR-0005 / ADR-0006）；状态条 / 设置页显示 AI 在线状态；命令面板 AI 入口留待后续。
- AI 端点清单（均经本地 Node 服务代理，前端不直连 opencode）：`POST /api/ai/inbox/:id/parse`（同步）+ `…/parse-stream`（SSE 过程可视）；`POST /api/ai/review/draft`（周 / 月回顾草稿：七段结构正文 + 环比 + 数字落地护栏；Slice L 起**生成即自动归档**一条 `review`，审计 `review.create` · `auto`，响应附 `reviewId`，见 ADR-0013）；`POST /api/ai/chat`（Slice G · 总览 AI 对话：读库摘要 + 有界历史，自然语言回答，**不落盘**，见 ADR-0010）；`POST /api/ai/task/draft`（Slice H · 任务快速新建补全：只填标题 → 建议 `contexts/energy/importance/estimateMin/dueAt/projectId/areaId/tags`，**不落盘**；Slice O 改为**先确认后写入**——弹窗内编辑后经扩展的 `POST /api/tasks` 一次性创建，见 ADR-0011 §6）。Slice T（见 ADR-0014）起，收件箱解析与任务补全**可提议新标签**（优先已有注册名，仅在确无合适标签时提议 `topic:名称` ≤12 字、≤3 个），`postValidate` 规格化保留（不再过滤注册表外名），标签在应用 / 创建落盘时才登记（`origin:'ai'`）。配套通用创建 `POST /api/notes`（「清空对话」归档为 `type:'memo'` 笔记，审计 `note.create`）。
- 回顾写入路径：`POST /api/reviews`（手工保存 / 回退创建）、`POST /api/reviews/:id/update`（Slice L · 编辑归档报告，白名单 `summary` / `decisions`，审计 `review.update`）、`POST /api/reviews/:id/remove`（审计 `review.remove`）。
- 本地服务与 opencode 之间使用 `OPENCODE_SERVER_PASSWORD` 保护（本机场景下的纵深防御）。

## 5. 托管拓扑（局域网）

- 开发：`npm run dev -- --host`（v0.4 起同一命令拉起数据服务 + Vite）。
- 生产预览：`npm run build && npm run preview -- --host`。
- 手机同 WiFi 访问：`http://<局域网IP>:5173`（dev）或 `http://<局域网IP>:4173`（preview）。
- 数据服务仅监听 `127.0.0.1:4097`，由上述启动器一并拉起；浏览器与手机均经 Vite 的 `/api` 代理写入，数据服务本身不暴露到局域网。
- `vite.config` 中设置 `server.host: true` 与 `preview.host: true`，以便开箱即用。
- 安全含义：这会让 Vite 监听所有网卡，同一局域网的任何设备都能访问（含写入 API）。仅应在可信 WiFi 下使用，使用后关闭。
- Windows 防火墙需放行 Node（专用网络）。
- 纯 HTTP 局域网 IP 不是安全上下文（无 PWA、摄像头等能力），本项目不需要这些能力，因此可接受。
- WSL 需端口转发；本项目直接跑 Windows 侧，规避该问题。

详见 `07-DEPLOYMENT.md`。

## 6. 目录职责

| 目录 | 职责 |
|---|---|
| `docs/` | 文档：宪法、架构、设计、数据模型、ADR |
| `data/` | 数据源：一记录一文件 JSON 数据库 + `activity.jsonl` 审计 |
| `server/` | 数据服务：唯一写入路径（校验 / 原子写 / 审计；仅 127.0.0.1:4097） |
| `src/` | 前端：React + TypeScript 应用 |
| `scripts/` | 脚本：开发启动器（`dev.mjs`）、种子数据生成（`seed.mjs`） |
| `public/` | 静态资源：字体、图标等 |

完整目录树见 `05-FILE-TREE.md`。目录结构变化必须同步更新该文件。

## 7. 与宪法的一致性

- 依赖白名单、路由、数据规范、opencode 事实、托管方式均以宪法 §6 为准，本文件不引入白名单外的前端依赖；服务端依赖（zod / write-file-atomic）经 ADR-0004 记录。
- v0.4 数据服务已实现（ADR-0004）；v0.5 及其后内容仍是规划，实现时若需偏离，应开新 ADR。
