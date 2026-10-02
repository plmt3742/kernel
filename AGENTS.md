# AGENTS.md

> KERNEL 新会话第一入口。用 2 分钟读完本文件即可冷启动整个项目。
> 事实源是 `docs/00-DESIGN-BRIEF.md`（项目宪法）。本文件与宪法冲突时，以宪法为准。

---

## 1. 这是什么

**KERNEL 是一个本地优先的个人事务内核**（life OS），服务一名中国大学生的事务管理：课业、学生工作、竞赛组织、算法训练、技术创作、生活作息。

一句话哲学：**文件即数据库，opencode 即大脑，网页即驾驶舱。**

内核隐喻：进程 = 任务/项目 · 内存 = 资料/知识 · I/O = 收件箱/通知 · 调度器 = 日程 · 检索 = 命令面板 · GC/平衡环 = 回顾。

**核心立场（不可违背）**：身份与领域是交叉筛选标签（tag），不是目录分区。一级信息架构只呈现通用循环：捕捉 → 澄清 → 组织 → 执行 → 回顾。详见 `docs/decisions/0002-no-role-silos.md`。

## 2. 核心文件地图

| 路径 | 作用 | 动它的后果 |
|---|---|---|
| `docs/00-DESIGN-BRIEF.md` | 项目宪法，事实源 | **只读**。除项目所有者明确要求外不改，重大方向调整走 ADR |
| `AGENTS.md` | 本文件，AI 入口 | 改项目结构或制度时同步更新 |
| `README.md` | 仓库门面与文档索引 | 入口信息变化时更新 |
| `data/**/*.json` | 数据源，一记录一文件 | 数据是事实源，改结构必须同步 `docs/04-DATA-MODEL.md` |
| `src/**` | React + TypeScript 前端 | 改代码必须更新 `CHANGELOG.md` 与 `TASK_BOOK.md` |
| `docs/01` 到 `docs/07` | 工程文档集 | 与对应主题保持一致 |
| `docs/decisions/` | ADR 架构决策记录 | 新决策开新编号 ADR，不删旧 ADR |
| `CHANGELOG.md` | 变更日志（Keep a Changelog） | 每次改代码必须追加 |
| `TASK_BOOK.md` | 任务台账与迭代记录（含「下一会话待办」交接清单） | 每次改代码必须追加 |

## 3. 命令

```bash
npm install          # 安装依赖
npm run dev          # 本地开发，默认 http://localhost:5173
npm run dev -- --host    # 允许局域网 / 手机访问
npm run build        # 生产构建
npm run preview -- --host   # 预览构建产物，默认 http://localhost:4173
npm run seed         # 生成并写入种子数据到 data/
```

技术栈固定：Vite + React 19 + TypeScript（strict）+ 原生 CSS（CSS 变量 token），不使用 UI 框架、不使用 Tailwind。依赖白名单见 `docs/02-ARCHITECTURE.md`。

## 4. 数据纪律

1. **`data/` 是唯一事实源**。前端只读，禁止前端直接写文件。
2. **当前（v0.1 / v0.2）**：数据为文件式 JSON，一记录一文件，UTF-8，ID 稳定（`t-0001` 式），时间用 ISO 8601 带偏移。
3. **禁止在 JSON 中存储计算派生值**（进度、计数、状态聚合等一律运行时计算）。
4. **未来（v0.3）**：引入 Node 单写者数据服务，作为唯一写入路径，配合原子写入（write-file-atomic）+ Zod 校验 + 审计日志（`activity.jsonl`）。浏览器写入必须经 API，禁止多进程直接写文件。
5. 改数据结构，必须同步更新 `docs/04-DATA-MODEL.md`；动目录结构，必须同步更新 `docs/05-FILE-TREE.md`。

字段定义与示例见 `docs/04-DATA-MODEL.md`。

## 5. 文档义务（每个会话强制）

改任何东西之前，先判断触发了哪条义务：

| 你做了什么 | 必须更新 |
|---|---|
| 改了代码 | `CHANGELOG.md` + `TASK_BOOK.md` |
| 动了目录结构 | `docs/05-FILE-TREE.md` |
| 改了数据字段 / 结构 | `docs/04-DATA-MODEL.md` |
| 做了重大技术决策 | `docs/decisions/` 新 ADR（递增编号） |
| 发布一个版本 | 版本号 v0.x.0，`CHANGELOG.md` 落日期 |

版本号规则：`v0.x.0`，小版本递增，不在文档期微调补丁号。

## 6. 代码约定

- 代码标识符英文；注释与文档中文为主；未来 git 提交信息用中文。
- TypeScript strict，禁止 `any`。
- 样式用原生 CSS + CSS 变量 token，不写内联魔法值，token 定义见 `docs/03-DESIGN-SYSTEM.md`。
- 路由：`/` 总览 · `/inbox` · `/tasks` · `/calendar` · `/projects` · `/library` · `/review` · `/settings`。
- 状态管理：React 内置（Context + hooks）；原型期用户操作写 localStorage，UI 需标注"原型态"。
- 无障碍强制：`MotionConfig reducedMotion="user"` + `prefers-reduced-motion`；键盘全可达；焦点环可见。
- 语言与界面：界面中文为主 + 英文小标签点缀（安静小灰字，不重排大写等宽）。
- 视觉方向：柔暗夜色为默认 + 柔影悬浮（深度=表面阶+柔影，无硬边线，圆角 16，强调色仅作信号），见 `docs/decisions/0003-design-direction-v2.md`。

## 7. 变更记录（house convention）

每次会话结束时在下方追加一行。日期格式 `YYYY-MM-DD`。

| 日期 | 版本 | 变更摘要 | 影响文件 |
|---|---|---|---|
| 2026-10-02 | v0.3.0 | 界面缺陷修复：品牌锁排（KERNEL 不再裁切）/ 顶栏接缝对齐（104px 共线）/ Toast 跟随折叠 / `color-scheme` / 任务分组行 / 项目卡标签 / 0 值柱 / 能量斜纹 / 日历日期条吸顶 / 阈值线；git 初始化 + 首次提交；全站三视角审阅（报告 `.qa/review/REVIEW-2026-10-02.md`） | `src/styles/**`、`src/components/shell/AppLayout.tsx`、`.qa/review/**`、`.gitignore`、`TASK_BOOK.md`、`CHANGELOG.md` |
| 2026-10-02 | v0.3.0 | 文档一致性全量同步（20 处：宪法/设计系统/文件树/索引/徽标顺延/零引用清理）；TASK_BOOK 新增「下一会话待办」交接清单 | `docs/**`、`TASK_BOOK.md`、`AGENTS.md`、`CHANGELOG.md` |
| 2026-10-02 | v0.3.0 | 数理自适应：流体字号/间距（Utopia，锚点 390/1440）+ φ 间距层级 + 容器查询（route/stat/task/pcard/drawer）+ 死代码清理 | `src/**`、`docs/**` |
| 2026-10-02 | v0.3.0 | 版式重排：全站呼吸感 / 组件安排 / 统一性（对齐 C 稿基准） | `src/**`、`docs/**` |
| 2026-10-02 | v0.3.0 | 验收修复：命令面板焦点还原与水平居中 + 灰阶对比校正（--muted / 亮色 --ink-2 全表面 ≥4.5:1） | `src/styles/tokens.css`、`src/styles/shell.css`、`src/components/CommandPalette.tsx`、`docs/**` |
| 2026-10-02 | v0.3.0 | 视觉方向重做：C 柔暗夜色 + 柔影悬浮融合，修复全部 QA 项 | `src/**`、`docs/**`、`CHANGELOG.md`、`TASK_BOOK.md` |
| 2026-10-02 | v0.2.0 | 高保真前端：应用壳 + 8 视图 + 命令面板 + 动效系统 + 移动端适配 | `src/**`、`CHANGELOG.md`、`TASK_BOOK.md` |
| 2026-10-02 | v0.1.0 | 建立文档系统（本文件集 + ADR）、工程脚手架、文件式数据层与种子数据 | `README.md`、`AGENTS.md`、`CHANGELOG.md`、`TASK_BOOK.md`、`docs/**`、`data/**`、`src/**` |

> 新增行请置于表格最上方（倒序），保持最近变更可见。

## 8. 安全纪律

- opencode 服务仅监听 `127.0.0.1:4096`，**永不直接暴露到局域网**。
- 敏感操作需显式确认。
- AI 能力现仅 UI 预留（AI 建议卡、命令面板入口），标记"待接入 v0.5"（原 v0.4，路线图重编号后顺延）。
- 本系统不发布公网，局域网访问仅限可信 WiFi。详见 `docs/07-DEPLOYMENT.md`。
