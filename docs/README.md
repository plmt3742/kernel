# 文档索引

KERNEL 的完整文档集。本文件是导航中心，说明每份文档的职责与推荐阅读顺序。

事实源是 `docs/00-DESIGN-BRIEF.md`（项目宪法）。其余文档都是对它的展开，冲突时以宪法为准。

---

## 推荐阅读顺序

新会话请从仓库根目录的 `AGENTS.md` 起步（2 分钟冷启动），然后按下列顺序深入：

1. **`00-DESIGN-BRIEF.md`**：项目宪法。身份、用户画像、系统模型、信息架构、设计系统、技术架构、数据模型、工程制度，全在一处。
2. **`01-PROJECT-BRIEF.md`**：项目缘起与设计立场。为什么这样设计，系统模型的研究依据，实体与轴的概览。
3. **`02-ARCHITECTURE.md`**：技术架构。栈选型与理由，数据层现状与未来，opencode 集成路线，托管拓扑。
4. **`03-DESIGN-SYSTEM.md`**：设计系统。全部 token、组件词汇、可读性纪律、无障碍要求。
5. **`04-DATA-MODEL.md`**：数据模型。全部实体字段表、6 个通用轴、ID 约定、状态流、示例记录。
6. **`05-FILE-TREE.md`**：目录结构与各目录职责。动结构必看。
7. **`06-ROADMAP.md`**：v0.1 到 v1.0 的里程碑路线。
8. **`07-DEPLOYMENT.md`**：运行与部署。本地、局域网、防火墙、FAQ。
9. **`08-MATH-SYSTEM.md`**：数理自适应。流体公式、容器查询、φ 层级、复算与验证方法。

按角色的最短路径：

| 你的任务 | 优先读 |
|---|---|
| 新 AI 会话冷启动 | `AGENTS.md` → `00-DESIGN-BRIEF.md` |
| 写前端 / 做交互 | `03-DESIGN-SYSTEM.md` → `01-PROJECT-BRIEF.md` |
| 改数据 / 加字段 | `04-DATA-MODEL.md` → `02-ARCHITECTURE.md` |
| 接 AI 能力 | `02-ARCHITECTURE.md`（opencode 集成节）→ `06-ROADMAP.md` |
| 跑起来给手机看 | `07-DEPLOYMENT.md` |
| 调版式 / 自适应公式 | `08-MATH-SYSTEM.md` → `03-DESIGN-SYSTEM.md` |
| 看为什么这么决策 | `decisions/` 下的 ADR |

## 文档清单

| 文件 | 类型 | 一句话职责 |
|---|---|---|
| `00-DESIGN-BRIEF.md` | 宪法 | 项目事实源，只读 |
| `01-PROJECT-BRIEF.md` | 说明 | 背景、立场、系统模型、实体与轴 |
| `02-ARCHITECTURE.md` | 说明 | 技术决策与数据/集成/托管架构 |
| `03-DESIGN-SYSTEM.md` | 规范 | 设计 token 与组件规范 |
| `04-DATA-MODEL.md` | 规范 | 实体字段、ID、状态流 |
| `05-FILE-TREE.md` | 规范 | 目录树与职责 |
| `06-ROADMAP.md` | 计划 | 版本里程碑 |
| `07-DEPLOYMENT.md` | 操作 | 运行、局域网、FAQ |
| `08-MATH-SYSTEM.md` | 规范 | 数理自适应：流体公式、容器地图、复算方法 |
| `decisions/0001-naming-kernel.md` | ADR | 命名决策：KERNEL |
| `decisions/0002-no-role-silos.md` | ADR | 不做身份/领域分区 |
| `decisions/0003-design-direction-v2.md` | ADR | 视觉方向 v2：C 柔暗 + 柔影悬浮 |
| `decisions/0004-data-service-v0.4.md` | ADR | 数据服务：Node 单写者 + 原子写 + 审计 |
| `decisions/0005-opencode-ai-v0.5.md` | ADR | v0.5 opencode 接入：收件箱「AI 解析」首个切片 |
| `decisions/0006-ai-parse-upgrade.md` | ADR | AI 解析升级：上下文注入 + 挂接建议 + SSE 过程流 |
| `decisions/0007-ai-weekly-review.md` | ADR | AI 周回顾（Slice C）：写入路径 + 草稿端点 + 指标口径 + 撤销 |
| `decisions/0008-inbox-file-intake.md` | ADR | 收件箱文件投递（Slice D）：RAW 上传 + data/files + AI 摘录 |
| `decisions/0009-edit-trash-reveal.md` | ADR | 详情操作 + 回收站 + 资源文件位置（Slice E2）：更新端点 + 软删除 + explorer /select |
| `decisions/0010-overview-ai-chat.md` | ADR | 总览升级（Slice G）：AI 读库对话（不落盘）+ 清空先归档为笔记 + 状态条重做 + 就地详情弹窗 |
| `decisions/0011-state-coherence-and-task-draft.md` | ADR | 状态贯通（Slice H）：资料状态 / 笔记蒸馏判断标准 + 快捷设置 + 白名单扩充 + 任务快速新建 AI 补全（不落盘） |
| `decisions/0012-unified-detail-modal.md` | ADR | 全站详情统一（Slice K）：所有实体详情改居中弹窗 + 统一操作矩阵 + 底栏统一 + 日历吸顶遮罩柔化；删除 Drawer |
| `decisions/0013-review-report-and-archive.md` | ADR | 回顾报告升级 + 自动归档（Slice L）：七段结构正文 + 环比 / 阈值 / 带 id 清单 + 数字护栏 + 生成即归档（复用 reviews + update 路径 + 报告历史）；Slice U 修订（§6）：阅读视图（默认）+ 同期等长窗口 + 下期行动去重 |
| `decisions/0014-tag-lifecycle.md` | ADR | 标签生命周期（Slice T）：录入即生成 + 自动登记（origin/createdAt/firstUsedIn）+ AI 可提议新标签 + 管理（重命名 / 合并 / 删除 / backfill）+ 筛选条不截断 |

## 根目录文档（不在本目录）

| 文件 | 职责 |
|---|---|
| `README.md` | 仓库门面、快速开始、文档总入口 |
| `AGENTS.md` | 新会话 AI 第一入口、命令、数据纪律、变更记录 |
| `CHANGELOG.md` | 变更日志（Keep a Changelog） |
| `TASK_BOOK.md` | 任务台账与迭代记录 |

## 维护规则

- 文档与代码/数据必须保持一致，不一致时应尽快修复。
- 改目录结构更新 `05-FILE-TREE.md`；改数据字段更新 `04-DATA-MODEL.md`；新决策开新 ADR。
- 每次改代码，追加 `CHANGELOG.md` 与 `TASK_BOOK.md`（详见 `AGENTS.md` 的文档义务表）。
- 宪法 `00` 除项目所有者明确要求外不随意改动；重大方向调整走 `decisions/`。
