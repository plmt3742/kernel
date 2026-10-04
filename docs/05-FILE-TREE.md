# 05 · 文件树与目录职责

> 本篇给出 KERNEL 的期望目录结构，并明确每个目录的职责。
> **规则：目录结构一旦变化，必须同步更新本文件。** 这是强制文档义务（见 `AGENTS.md`）。

---

## 1. 目录树

```text
kernel/
├─ AGENTS.md                    # 新会话 AI 第一入口
├─ README.md                    # 仓库门面、快速开始
├─ CHANGELOG.md                 # 变更日志
├─ TASK_BOOK.md                 # 任务台账与迭代记录
├─ package.json                 # 依赖与脚本
├─ vite.config.ts               # Vite 配置（host: true 等）
├─ tsconfig.json                # TypeScript strict 配置
├─ index.html                   # 应用入口 HTML
├─ 启动器.vbs                   # 桌面启动器入口（隐藏拉起 PowerShell，零黑窗）
├─ 启动器.ps1                   # 原生 WPF 启动器窗口（PowerShell 5.1 + .NET WPF）
├─ kernel.ico                   # 启动器 / 快捷方式图标（多尺寸，由 scripts/make-icon.ps1 生成）
│
├─ docs/                        # 文档
│  ├─ 00-DESIGN-BRIEF.md        # 项目宪法（事实源，只读）
│  ├─ README.md                 # 文档索引
│  ├─ 01-PROJECT-BRIEF.md       # 项目简报
│  ├─ 02-ARCHITECTURE.md        # 技术架构
│  ├─ 03-DESIGN-SYSTEM.md       # 设计系统
│  ├─ 04-DATA-MODEL.md          # 数据模型
│  ├─ 05-FILE-TREE.md           # 本文件
│  ├─ 06-ROADMAP.md             # 路线图
│  ├─ 07-DEPLOYMENT.md          # 运行与部署
│  ├─ 08-MATH-SYSTEM.md         # 数理自适应系统（流体公式 / 容器地图 / 复算方法）
│  └─ decisions/                # 架构决策记录（ADR，0001–0037；完整清单见 docs/README.md）
│
├─ data/                        # 数据源（一记录一文件；v0.4 起写入经数据服务）
│  ├─ activity.jsonl            # 审计日志（每次变更追加；服务创建）
│  ├─ files/                    # 文件投递附件二进制（不进 git；见 ADR-0008）
│  ├─ trash/                    # 回收站：<kind>/<id>.json（原记录 + trashedAt；见 ADR-0009）
│  ├─ meta/
│  │  ├─ config.json            # 全局配置
│  │  ├─ tags.json              # 标签命名空间
│  │  └─ term.json              # 学期信息（第 1 周周一 / 总周数；缺失 = 未设置）
│  ├─ inbox/                    # i-*.json
│  ├─ tasks/                    # t-*.json
│  ├─ projects/                 # p-*.json
│  ├─ areas/                    # a-*.json
│  ├─ goals/                    # g-*.json
│  ├─ habits/                   # h-*.json
│  ├─ events/                   # e-*.json
│  ├─ courses/                  # c-*.json
│  ├─ notes/                    # n-*.json
│  ├─ resources/                # r-*.json
│  └─ reviews/                  # rev-*.json
│
├─ server/                      # 数据服务（v0.4：单写者 · 原子写 · Zod 校验 · 审计；仅 127.0.0.1:4097）
│  ├─ index.mjs                 # HTTP 入口与路由
│  ├─ ai.mjs                    # AI 代理（opencode 接入：解析 / 挂接建议 / SSE 过程流 / 回顾草稿 / 读库对话）
│  ├─ store.mjs                 # 存储层（读快照 / 串行写队列 / nextId / activity.jsonl）
│  └─ schemas.mjs               # Zod schema（写入前校验的唯一事实源）
│
├─ src/                         # 前端应用
│  ├─ main.tsx                  # 挂载入口（样式导入、字体自托管）
│  ├─ App.tsx                   # 应用壳与路由
│  ├─ views/                    # 九个视图（Overview/Inbox/Tasks/Calendar/Timetable/Projects/Library/Review/Settings）
│  ├─ components/               # 通用组件（Panel / Modal / Toast / EntityEditForm / CommandPalette / TaskDetail / TaskDetailModal / ProjectDetail / ProjectDetailModal / OverviewChat / AiSuggestionForm / TaskDraftModal / OrganizeProposalCard（项目 AI 整理建议卡）…）
│  │  ├─ shell/                 # 应用壳（RailNav / TopBar / StatusBar / AppLayout）
│  │  └─ charts/                # 图表（TrendLine / EnergyBars）
│  ├─ context/                  # React Context（Theme / Toast / Palette）
│  ├─ lib/                      # 数据访问与工具（data 可变快照 / api 客户端 / mutations 写入动作 / inboxAi 收件箱 AI 解析状态 / organize 项目 AI 整理状态与每日调度 / imagePreview 长图 AI 分片（>400KB 大图切 ≤6 JPEG 供解析；失败回退单图） / aiForm AI 建议表单换算 / derive / relations 互链派生 / date / format / motion / focus / hooks）
│  └─ styles/                   # 全局样式与 token（tokens / base / shell / components / views）
│
├─ design-drafts/               # 设计选型稿（v1 视觉方向 a/b/c；v2 页面排版多版本 29 方案 + 选型页 index.html + 三版对比页 _sheets/）
├─ .qa/                         # 视觉 QA 证据（截图与报告；v0.2 起按批次归档，勿改归档件）
│
├─ scripts/                     # 脚本
│  ├─ dev.mjs                   # 开发启动器（数据服务 + Vite 一体启动；--preview 走 preview）
│  ├─ spawn-bg.mjs              # 后台安全启动器（detached spawn + 日志重定向；防工具调用挂起）
│  ├─ package.mjs               # 分发包打包器（白名单拷贝 + 内置运行时 + 空白数据骨架 + 三重隐私闸门 → zip）
│  ├─ make-icon.ps1             # 生成本机启动器图标 kernel.ico（System.Drawing，可重跑）
│  ├─ assets/
│  │  └─ welcome.html           # 启动页（自包含单文件；file:// 打开后探活本机，就绪自动跳转）
│  ├─ seed.mjs                  # 种子数据生成
│  └─ reset.mjs                 # 数据清零（预演 / --yes：备份到 .qa/backups/ 后清空；保留 config）
└─ public/                      # 静态资源（字体、图标、guide.html 使用指南）
```

> 具体文件名（如组件文件名、token 文件拆分方式）由脚手架实现决定；本树表达的是**结构与职责**，结构变化时更新本文件。
>
> **发布产物在仓库之外**：`scripts/package.mjs` 默认输出到 `<workspace>\release\KERNEL-分发包-v0.5.0\`（及同名 `.zip`），不属仓库、不纳入版本控制。详见 ADR-0031。

## 2. 目录职责

| 路径 | 职责 | 谁拥有 |
|---|---|---|
| `docs/` | 全部文档：宪法、架构、设计、数据模型、ADR | 文档工程师 |
| `design-drafts/` | 设计草案选型稿（方向参考，反映当次选型，非构建产物） | 设计 / 所有者 |
| `.qa/` | 视觉 QA 证据：截图与报告（归档件只读；按批次入子目录） | QA 执行方 |
| `data/` | 数据源，一记录一文件 JSON + 附件二进制 `data/files/` + 回收站 `data/trash/`；v0.4 起写入一律经 `server/` 数据服务（单写者） | 数据服务（唯一写者） |
| `server/` | 数据服务：Zod 校验 + 原子写 + 审计日志；仅监听 127.0.0.1:4097 | 数据层实现方 |
| `src/` | React + TypeScript 前端应用（只读数据经水合，写入经 API） | 前端实现方 |
| `scripts/` | 开发启动器（`dev.mjs`）、后台安全启动器（`spawn-bg.mjs`）、分发包打包器（`package.mjs`：白名单拷贝 + 内置运行时 + 三重隐私闸门）与启动页（`assets/welcome.html`）、启动器图标生成（`make-icon.ps1`）、种子数据生成（`seed.mjs`）、数据清零（`reset.mjs`） | 工程 |
| `public/` | 静态资源：自托管字体、图标、自包含使用指南 `guide.html`（`/guide.html`，亦可 file:// 双击打开） | 前端实现方 |
| 根目录启动器 | 桌面启动器 `启动器.vbs`（入口）+ `启动器.ps1`（原生 WPF 窗口）+ `kernel.ico` 图标；控制台入口 `启动.cmd`（显示运行日志，不变） | 工程 |
| 根目录 `*.md` | 门面与台账（README / AGENTS / CHANGELOG / TASK_BOOK） | 文档工程师 |

## 3. 数据目录与实体的对应

`data/` 下按实体分目录，前缀与目录对应：

| 目录 | 前缀 | 实体 | 文档 |
|---|---|---|---|
| `data/inbox/` | `i-` | inboxItem | `04-DATA-MODEL.md` §4.1 |
| `data/tasks/` | `t-` | task | §4.2 |
| `data/projects/` | `p-` | project | §4.3 |
| `data/areas/` | `a-` | area | §4.4 |
| `data/goals/` | `g-` | goal | §4.5 |
| `data/habits/` | `h-` | habit | §4.6 |
| `data/events/` | `e-` | event | §4.7 |
| `data/courses/` | `c-` | course | §4.10b |
| `data/notes/` | `n-` | note | §4.8 |
| `data/resources/` | `r-` | resource | §4.9 |
| `data/reviews/` | `rev-` | review | §4.10 |

> 附件二进制：`data/files/<id>-<safeName>`（文件投递；`data/files/` 已在 `.gitignore`，随条目删除清理）。详见 ADR-0008。
>
> 回收站：`data/trash/<kind>/<id>.json`（原记录 + `trashedAt`；九种可写实体 task / project / note / resource / event / area / goal / habit / course 的软删除）。恢复写回正册并删副本；彻底删除仅删副本；`nextId` 同时扫描正册与回收站以防 id 复用。回收站不参与 `/api/snapshot`，经 `GET /api/trash` 读取。详见 ADR-0009（课程并入见 ADR-0024）。

## 4. 前端目录职责

| 路径 | 职责 |
|---|---|
| `src/main.tsx` | 应用挂载入口，样式导入；主题 FOUC 防护在 `index.html` 内联脚本中先于其执行 |
| `src/App.tsx` | 应用壳：Router + Provider 链 + 路由出口 |
| `src/views/` | 九个视图页面，一一对应宪法 §4 的视图规格（`Calendar` 议程 · `Timetable` 课表，Slice H2 起课表独立成页） |
| `src/components/` | 可复用组件（含 `shell/` 与 `charts/` 子目录），命名遵循设计系统签名词汇；`AiSuggestionForm`（AI 建议可编辑字段网格，任务弹窗 / 收件箱卡共用）、`TaskDraftModal`（先确认后写入的任务草稿弹窗） |
| `src/context/` | React Context：主题、Toast、命令面板开关 |
| `src/lib/` | 数据访问与写入动作（data 可变快照 / api 客户端 / mutations / inboxAi 收件箱 AI 解析模块级状态 / imagePreview 长图 AI 分片（客户端切图、失败回退单图）/ aiForm AI 建议表单值类型与换算 / derive / relations 实体互链）、日期、格式化、动效常量、焦点工具、共享 hooks |
| `src/styles/` | 全局样式、CSS 变量 token、主题定义（唯一事实源 `tokens.css`） |

## 5. 维护规则

1. **结构变化即更新本文件**：新增、删除、重命名目录或关键文件后，必须同步修改本篇第 1、2 节的树与职责表。
2. 新增实体目录时，同时更新第 3 节表格与 `04-DATA-MODEL.md`。
3. 新增视图路由时，同步 `02-ARCHITECTURE.md` 的路由清单与 `AGENTS.md`。
4. 本文件与实际仓库不一致时，以实际为准并尽快修复文档。

## 6. 相关文档

- 数据字段：`04-DATA-MODEL.md`
- 技术架构与目录职责总述：`02-ARCHITECTURE.md`
- 运行方式：`07-DEPLOYMENT.md`
