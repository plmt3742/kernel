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
- 路由：`/` 总览 · `/inbox` · `/tasks` · `/calendar` · `/projects` · `/library` · `/review` · `/settings`。

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

派生值纪律在数据服务阶段依然适用：进度、计数、聚合必须运行时计算，不落盘。

## 4. opencode 集成计划（v0.5）

### 4.1 事实基础（已调研）

- opencode 项目组织已迁移至 **`anomalyco/opencode`**。
- `opencode serve` 默认监听 **`127.0.0.1:4096`**。
- OpenAPI 文档位于 `/doc`。
- SDK：`@opencode-ai/sdk`，使用 `createOpencodeClient`；会话 API 含 `session.create` / `prompt` / `prompt_async`。
- 事件流：`event.subscribe` 为 SSE。
- 结构化输出：`format: json_schema`。
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
- AI 当前仅做 UI 预留：AI 建议卡、命令面板入口，徽标标注「待接入 v0.5」。
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
