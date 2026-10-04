# KERNEL

> 个人事务内核 · 本地优先 · AI 协作 · 为"类助手"而生

KERNEL 是一个本地优先（local-first）的个人事务管理系统，面向课业、学生工作、竞赛、算法训练、技术创作与生活作息并行的真实场景。它把散落的待办、日程、项目、资料与复盘收进一个统一的通用循环，并用 AI 作为可插拔的协作者。

本文件是仓库门面。项目的事实源是 `docs/00-DESIGN-BRIEF.md`（项目宪法），任何会话在动代码或数据前都应先读它。

---

## 一句话哲学

**文件即数据库，opencode 即大脑，网页即驾驶舱。**

- 文件即数据库：所有事务以人可读的 JSON 存在 `data/` 下，一记录一文件，可 diff、可备份、可迁移。
- opencode 即大脑：AI 能力经本地 opencode 服务接入，不外泄、不越权（v0.4 起）。
- 网页即驾驶舱：React 前端是操作界面，负责呈现与调度，不是数据的所有者。

## 内核隐喻

项目名 KERNEL 取自操作系统内核，系统各模块与内核概念的对应关系如下：

| 内核概念 | KERNEL 对应物 |
|---|---|
| 进程 | 任务 / 项目 |
| 内存 | 资料 / 知识 |
| I/O | 收件箱 / 通知 |
| 调度器 | 日程 |
| 检索 | 命令面板 |
| GC / 平衡环 | 回顾 |

## 核心立场

**身份与领域是交叉筛选标签，不是容器。**

用户拥有多重身份（`role:student`、`role:assistant`、`role:competition-head`、`role:acm`、`role:monitor`、`role:vibecoder`），但系统不按这些身份或领域做一级分区。一级信息架构只呈现通用循环：捕捉 → 澄清 → 组织 → 执行 → 回顾。身份、领域、上下文、能量都是视图内的筛选器（tag）。这条立场是项目"通用性"的核心，详见 `docs/01-PROJECT-BRIEF.md` 与 ADR `docs/decisions/0002-no-role-silos.md`。

## 快速开始

环境要求：Node.js 18+ 与 npm。


```bash
# 1. 安装依赖
npm install

# 2. 生成种子数据（可选，写入 data/）
npm run seed

# 3. 本地开发（数据服务 127.0.0.1:4097 + opencode serve 4096 + 前端一体启动）
npm run dev
# 浏览器打开 http://localhost:5173
```

```bash
# 其他常用命令
npm run dev:web      # 只启动前端（数据服务离线时只读）
npm run server       # 单独启动数据服务
npm run build        # 生产构建
npm run preview -- --host   # 预览构建产物（含数据服务）
```

### 手机局域网访问

手机与电脑处于同一 WiFi 时，让 Vite 监听所有网卡：

```bash
npm run dev -- --host
# 手机访问 http://<电脑局域网IP>:5173
```

生产构建与预览：

```bash
npm run build
npm run preview -- --host
# 手机访问 http://<电脑局域网IP>:4173
```

完整步骤、Windows 防火墙放行与常见问题见 `docs/07-DEPLOYMENT.md`。

## 安装（Windows 安装包）

面向 Windows 桌面用户，提供开箱即用的安装包（`KERNEL-Setup-x.y.z.exe`）：

1. 从 GitHub Releases 下载最新的 `KERNEL-Setup-x.y.z.exe`；
2. 双击运行，按向导选择安装目录（例如 `D:\KERNEL`；**不建议装到 `C:\Program Files`**，避免系统目录的写入限制）；
3. 安装完成后，从开始菜单或桌面快捷方式启动（安装包内置运行时，目标机无需另装 Node.js）。

数据保存在**安装目录下的 `data\` 子目录**（`<安装目录>\data`），与程序放在一起，便于整目录备份、迁移或拷贝。卸载程序时该目录及其中的用户数据会**保留**，不会被删除。

安装包由 `scripts/build-installer.mjs` 构建，使用仓库内置的 Inno Setup 编译器（无需在系统中单独安装 Inno Setup），脚本见 `installer/KERNEL.iss`。

## 版本状态

| 版本 | 主题 | 状态 |
|---|---|---|
| v0.1.0 | 文档系统 + 工程脚手架 + 数据层 | 已完成 |
| v0.2.0 | 高保真前端原型 | 已完成 |
| v0.3.0 | 视觉重做（柔暗夜色 v2）+ 版式重排 + 数理自适应 + 全站审阅 | 已完成 |
| v0.4.0 | 数据服务（单写者 + 原子写 + Zod 校验 + 审计日志） | 已完成 |
| v0.5.0 | opencode AI 接入（结构化建议 · 首批接入收件箱「AI 解析」） | 进行中 |
| v1.0.0 | 稳定版 | 规划中 |

详细里程碑见 `docs/06-ROADMAP.md`。

## 文档索引

推荐阅读顺序（新会话从 `AGENTS.md` 起步）：

1. `AGENTS.md`：新会话 AI 第一入口，含速览 / 命令 / 数据纪律 / 变更记录
2. `docs/00-DESIGN-BRIEF.md`：项目宪法（事实源）
3. `docs/README.md`：文档总索引与推荐阅读顺序
4. `docs/01-PROJECT-BRIEF.md`：背景、用户画像、系统模型、实体与轴
5. `docs/02-ARCHITECTURE.md`：技术选型、数据层、opencode 集成、托管拓扑
6. `docs/03-DESIGN-SYSTEM.md`：设计 token、组件词汇、可读性纪律、无障碍
7. `docs/04-DATA-MODEL.md`：实体字段表、6 轴、ID 约定、状态流、示例
8. `docs/05-FILE-TREE.md`：目录树与各目录职责
9. `docs/06-ROADMAP.md`：v0.1 到 v1.0 里程碑
10. `docs/07-DEPLOYMENT.md`：本地运行、局域网访问、防火墙、FAQ
11. `docs/decisions/`：架构决策记录（ADR）
12. `CHANGELOG.md`、`TASK_BOOK.md`：变更日志与任务台账

## 目录总览

| 目录 | 职责 |
|---|---|
| `docs/` | 全部文档：总纲、架构、设计、数据模型、ADR |
| `data/` | 数据源：一记录一文件的 JSON 数据库 + `activity.jsonl` 审计 |
| `server/` | 数据服务：唯一写入路径（校验 / 原子写 / 审计；仅 127.0.0.1:4097） |
| `src/` | 前端：React + TypeScript 应用 |
| `scripts/` | 脚本：开发启动器、种子数据生成 |
| `public/` | 静态资源（字体、图标等） |

结构与职责的完整说明见 `docs/05-FILE-TREE.md`。目录结构变化时必须同步更新该文件。

---

本项目仅本地运行，不发布到公网。opencode 服务与数据服务均永不暴露到局域网，详见 `docs/02-ARCHITECTURE.md` 的安全纪律一节。


## 环境配置

**运行环境**

- Node.js 18+
- npm
- Windows 桌面环境（本项目直接跑 Windows 侧，不使用 WSL）

**安装**

```bash
npm install
```

**启动**

```bash
npm run dev
# 浏览器打开 http://localhost:5173
```

**端口**

| 端口 | 用途 |
|---|---|
| 5173 | 前端（Vite 开发服务器） |
| 4097 | 数据服务（仅 `127.0.0.1`，唯一写入路径） |
| 4096 | opencode serve（仅 `127.0.0.1`，AI 能力） |

**依赖清单**

`dependencies`：`@fontsource-variable/inter`、`@fontsource/jetbrains-mono`、`@opencode-ai/sdk`、`clsx`、`cmdk`、`date-fns`、`lucide-react`、`motion`、`react`、`react-dom`、`react-markdown`、`react-router-dom`、`write-file-atomic`、`zod`

`devDependencies`：`@types/react`、`@types/react-dom`、`@vitejs/plugin-react`、`typescript`、`vite`

**环境变量**

| 变量 | 用途 | 默认 |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API Key，opencode 调用 AI 时使用 | 空（未设置） |
| `OPENCODE_SERVER_PASSWORD` | 本地数据服务与 opencode serve 之间的访问口令 | 空 |
| `KERNEL_OPENCODE_URL` | opencode serve 地址 | `http://127.0.0.1:4096` |
| `KERNEL_OPENCODE_BIN` | 指定 opencode 可执行文件路径（不依赖系统 PATH） | 空（回退 PATH 查找） |

DeepSeek API Key 也可在应用「设置 → AI 集成」中填写，保存在本机 `data/meta/secrets.json`（已加入 `.gitignore`，不会提交到版本库），无需写入环境变量。环境变量模板见根目录 `.env.example`。
