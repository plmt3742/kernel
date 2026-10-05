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
| `decisions/0008-inbox-file-intake.md` | ADR | 收件箱文件投递（Slice D）：RAW 上传 + data/files + AI 摘录；Slice V 修订（§6）：文本即解析 + 删除入口 + 恢复/撤回 + 产物深链 + 澄清字段矩阵 |
| `decisions/0009-edit-trash-reveal.md` | ADR | 详情操作 + 回收站 + 资源文件位置（Slice E2）：更新端点 + 软删除 + explorer /select |
| `decisions/0010-overview-ai-chat.md` | ADR | 总览升级（Slice G）：AI 读库对话（不落盘）+ 清空先归档为笔记 + 状态条重做 + 就地详情弹窗；G.1 修订：Markdown 渲染 + 联网检索/自由回答 + 对话整理进笔记（.qa/v72） |
| `decisions/0011-state-coherence-and-task-draft.md` | ADR | 状态贯通（Slice H）：资料状态 / 笔记蒸馏判断标准 + 快捷设置 + 白名单扩充 + 任务快速新建 AI 补全（不落盘） |
| `decisions/0012-unified-detail-modal.md` | ADR | 全站详情统一（Slice K）：所有实体详情改居中弹窗 + 统一操作矩阵 + 底栏统一 + 日历吸顶遮罩柔化；删除 Drawer |
| `decisions/0013-review-report-and-archive.md` | ADR | 回顾报告升级 + 自动归档（Slice L）：七段结构正文 + 环比 / 阈值 / 带 id 清单 + 数字护栏 + 生成即归档（复用 reviews + update 路径 + 报告历史）；Slice U 修订（§6）：阅读视图（默认）+ 同期等长窗口 + 下期行动去重；Slice N6 修订（§7）：回顾人话化（digest 人话化 + 真诚口吻 + 友好七段标题 + 新旧别名双兼容） |
| `decisions/0014-tag-lifecycle.md` | ADR | 标签生命周期（Slice T）：录入即生成 + 自动登记（origin/createdAt/firstUsedIn）+ AI 可提议新标签 + 管理（重命名 / 合并 / 删除 / backfill）+ 筛选条不截断 |
| `decisions/0015-ai-full-chain-multi-action.md` | ADR | AI 全链 · 多实体一揽子处置（Slice R1）：多动作抽取（≤6，含新项目）+ 一次确认批量应用（建项目 / 挂接 / 标签登记）+ 精确撤销（产物 + 注册表）+ 项目草稿端点；默认仍先确认后写入；Slice R2.5 修订（§5）：文件条目 = 资料 + 简介（不拆分），文本条目保留多动作 + 反过拆 |
| `decisions/0016-cluster-project-and-ai-automation.md` | ADR | 项目诞生：聚类立项 + AI 自动化档位（Slice R2）：连续累积相似任务 → 确定性预分组 + AI 命名（按组引用、抗幻觉）+ 一次建项归入 / 精确撤销；`aiAutomation` 档位（默认 confirm）+ 自动化能力边界表 + AI 动态 feed |
| `decisions/0017-subtasks-and-project-actions.md` | ADR | 子任务全链路 + 项目内操作（Slice R3）：`parentTaskId` 一等写入字段（创建 / 编辑 + 自引用 / 成环 / 存在性服务端护栏）；任务详情「子任务」区块 + 就地打开 + quick-add 继承父项目；项目任务行就地打开 + 按项目预填新建（草稿确认）；替换式覆盖层 |
| `decisions/0018-events-writable.md` | ADR | 事件可写（日程 · Slice W）：events 并入可写 / 可回收实体族（schema + `e-` id + `EDITABLE_FIELDS` + `POST /api/events` / `:id/remove` + 回收站）；`endAt` 可选 + `end ≥ start` 服务端校验；文档状态流（tentative→confirmed→cancelled）可执行；日历新建（先确认后写入）+ 详情编辑 / 删除 / 状态快捷切换 + 迷你月历日格可点；`repeatRule` 仅展示延后 |
| `decisions/0019-areas-goals-habits-manageable.md` | ADR | 区域 / 目标 / 习惯可管理 + 打卡（Slice X）：关闭最后三个只读结构（schema + `a-`/`g-`/`h-` id + 创建 / 编辑 / 删除 + 回收站）；区域 / 目标删除**引用护栏**（409 可读计数）；`goals.keyResults` 仅展示保留；习惯 `checkin`/`uncheckin`（缺省今天、幂等、`{date,value:1}`）；设置三管理区；总览「习惯打卡」条取首个习惯（修复 `h-0002` 硬编码）+ 今日打卡切换；关联 area/goal 芯片深链设置（F8）；F23 项目区域默认显式化 |
| `decisions/0020-note-experience.md` | ADR | 笔记体验：沉浸阅读 / 撰写 + AI 蒸馏（Slice M）：`.k-modal--note` 加宽 + 正文 68ch / 行高 1.8 + 安静元数据条；编辑面标题 + 正文优先（`rows=18`）；「新建笔记」撰写弹窗（创建可撤销）；蒸馏语义澄清（**点选只标注、不改写**）；`POST /api/ai/note/distill`（下一层草稿、缺省当前+1 封顶 L3、**不落盘**）；应用 = 正文**追加** `## 蒸馏 → Lx` + 设层级，撤销往返精确还原 |
| `decisions/0021-consistency-sweep.md` | ADR | 一致性清扫（Slice Y）：AI 提示词情境从注册表派生（F4）+ 上下文筛选 = 已用 ∪ 注册表（F24）；重要性量纲统一 **0–3**（F21，选 0–3 因存量 t-0057/t-0058 含 0）+ 能量单一源（F7）；`POST /api/resources` 资料直接新建 + 撰写弹窗（F5）；移除死「迁移」瓦片（F11/F12）；总览监视柱 / W40 深链（F13/F14）；报告内停滞建议行可点（F17）；详情「推迟至」行（F18）；重新解析保留用户编辑（F32）；多文件上传受限并发（F33）；编辑保存撤销（F36）；标签输入补全 |
| `decisions/0022-ui-state-persistence.md` | ADR | 界面状态保留策略（Slice Z）：通用助手 `createUiStore`（模块级 store + 可选 `localStorage`，安全解析 / 裁剪 / 静默失败）；F25 AI 对话（`draft`/`busy`/`error` 提升 + 请求模块化 → 思考中跨页保留 + 对话持久化**上限 60 轮** + 清空同步清副本）；F26 任务筛选 / 分组 / 草稿；F27 收件箱选中 / 展开 / 草稿（对账）；F28 资料筛选；F29 日程游标 / 项目草稿 / 回顾运行态（回顾刻意不持久化）；**机制选择（module store vs URL vs localStorage）与不持久化清单** |
| `decisions/0023-notice-triage-and-image-intake.md` | ADR | 公告解析：通知三性 + 条件选择 + 截图接入（Slice N0）：通知按可行动性分三性（硬事实 → 顶层 `facts`，≤8 / ≤140 字 / 含日期或数字 / **不落盘**，UI「要点」块 + 一键「存为要点笔记」；义务 → `task` 动作 + 可选 `condition`；纯建议默认不产动作）；带条件的动作**默认不勾选**（勾选 = 相关）+ 服务端清理链（`aiActionSchema.condition` → `postValidateActions` → `cleanFacts` → `tryParseActions` 返回 `{ actions, facts }`）；截图接入（`isImageFile()` + opencode file part，默认模型 `deepseek/deepseek-flash` 实测可读图、无需 OCR / 换模型，图片跳过「恰 1 条 resource」归一化）；`inbox.apply` 审计 `detail.signals.conditions` 为后续画像留痕；确认制不变 |
| `decisions/0024-timetable-course-entity.md` | ADR | 课表：课程实体 + 学期元信息（Slice H0）：「固定日程」独立于任务——新增可写 / 可回收实体 `course`（`c-`：标题 / 教师 / 默认地点 / 1..16 个上课时段（星期 + 起止节次 + 可选周次）/ 备注；`normalizeCourseSessions` 统一规格化 + 审计 `course.*`）；学期元数据 `data/meta/term.json`（`startDate` = 第 1 周周一 / `totalWeeks` 1..30；缺失 = 未设置）经 `POST /api/term`；日历页「议程 / 课表」模式 segmented（`kernel.ui.calendar.v1`）+ 全宽 `ClassGrid`（7 列 × 节次、跨行时段、今日列）+「第 N 周」`‹ 本周 ›` + 今天行；手动录入 `CourseForm`（周次文本 `1-16 / 1-16单 / 1-8,10-16`，留空 = 每周）+ 先确认后写入弹窗 + 回收站「课程」分组；AI 导入 / 调休例外 / 节次 → 时间映射为后续切片；无新依赖 |
| `decisions/0025-timetable-import.md` | ADR | 课表导入：来源 → 课程草稿 → 勾选确认（Slice H1）：两个端点、确认前零写入——`POST /api/ai/timetable/draft { id }` 对收件箱**未澄清**条目跑课表解析（返回 `{ courses, model, ms }`，**不落盘、无审计**；400 不可直读指引 / 404 / 409 / 502 / 503）+ `POST /api/courses/import { courses }`（1–30 门，先全量校验规格化、全通过才逐条 `commit`，审计 `course.create` · `detail.via:'timetable-import'`，201 `{ created }`，整批原子）；读取 `.xlsx` 走新 `extractXlsxGrid`（网格 + 补空列 + 跳空行）、`.csv` 文本白名单、旧版 `.xls` 走 `extractLegacyXlsText` **三分支**（真 OLE2 → 不做 BIFF 解析、给不可读指引；HTML / XML 表格 → 摘录；纯文本 → 原文摘录）、截图复用 N0 file part；`buildTimetableSystem` + `tryParseTimetable`（单次重试）+ `cleanTimetableCourses` 确定性清洗；前端收件箱「导入为课表」pill + 模块级 `timetableAi.ts` + `TimetableDraftCard`（勾选默认全选、导入可撤销）；直读 BIFF `.xls` / 多表 / 跨页 / 学期自动对齐延后；无新增依赖 |
| `decisions/0026-activity-timeline.md` | ADR | 回顾 · 动作记录（Slice S）：审计自描述（`commit` / trash / restore 并入 `title`、`updateEntity` 并入 `status`，均为**追加键**）+ 回顾页「动作记录」时间线（中文四桶 完成 / 新增 / 打卡 / 其他、日分组、过滤 chips、深链、空态，只读消费 `GET /api/activity`）；无新增端点与写入面 |
| `decisions/0027-link-reading.md` | ADR | 链接阅读：首次出站抓取 + 粘贴截图（Slice N2 / N2.5）：收件箱文本条目含 http(s) 链接时，解析前服务端抓**首个**链接正文注入上下文（`extractFirstUrl` / `fetchLinkExcerpt` / `buildLinkSection`）——**私网 / 环回拒抓且不发请求**（SSRF）、8s 超时、仅 HTML / XHTML / text、**流式上限 2MB**、charset 探测（gbk 回退）、`htmlToArticleText` ≤8000 字；抓取失败降级「链接资料」不阻断解析；`aiActionSchema.url` → apply 持久化 `record.url`；前端建议卡 resource 增「链接」输入；**Ctrl+V 粘贴截图**（window 级 paste、图片入待上传队列、纯文本不拦截）；仅首个链接、不做 JS 渲染 / 登录态 / 多页爬取；无新增依赖与端点 |
| `decisions/0028-parallel-inbox-parsing.md` | ADR | 并行解析（Slice N3）：收件箱 AI 解析从「全局单令牌 + 单面板 + 顺序批量」重构为**每条目独立 job 的并行调度器**——每 id 令牌（新解析只取代同一 id）、分桶增量缓冲 + 共享 ~100ms 节流、FIFO 队列 + **并发上限 3**（完成自动进位）、批量完成驱动进度（done/total）、`clearInboxAiJob` 按条清理、N0.9 迟到结果语义保留（唯一作废=显式忽略）；多文件通用条目并行（课表仍顺序）；**服务端零改动**（审计：零全局锁、每解析独立 opencode session；写盘仍单写者串行）；无新增依赖 / 端点 / 数据面 |
| `decisions/0029-source-summary.md` | ADR | 来源摘要：一句话摘要 + 引用人话化（Slice N4）：收件箱解析增顶层 `summary`（≤40 字、单行、多要点「 · 」分隔、不引入原文外信息；服务端确定性清洗折叠 / 去引号 / 硬截断 40；**解析仍零写入、不落盘**）；`POST /api/inbox/:id/apply { actions, summary? }` 的 `summary` 可选（≤100），提供且非空时写入条目 `summary`（`inboxItemSchema.summary` 可选、≤200 防御），只在 apply 落档；引用人话化：关联区块来源标题 `summary` 优先 / 原文截断 ~90 字兜底、来源芯片可见编号入 tooltip、已澄清区产物引用显示产物标题；历史条目无 `summary` 展示自动降级、不回填；无新增依赖 / 写入面 |
| `decisions/0030-ai-key-local.md` | ADR | AI Key 本地配置 + 双击启动器（Slice N5）：设置页「AI 集成」填 DeepSeek API Key（密码型、不回显；保存 / 清除 + 状态 pill「已配置 / 未配置」）；存储 `data/meta/secrets.json`（**已 gitignore**，git 跟踪的 `config.json` 刻意不放）；`POST /api/ai/key`（空串 = 清除；审计 `ai.key.update` 仅 `detail.hasKey` 布尔、绝无明文）；`GET /api/ai/health` 增 `hasKey`；`scripts/dev.mjs` 托管拉起 opencode serve 时注入 `DEEPSEEK_API_KEY`（已在运行则下次生效，日志只报「已注入」）；启动器 `启动.cmd` + `scripts/launcher.mjs`（Node 18 自检 / 依赖自动装 / 轮询 5173 自动开浏览器 / 错误按回车退出）；无新增依赖 |
| `decisions/0031-installer-distribution.md` | ADR | Windows 安装包分发：`installer/KERNEL.iss`（Inno Setup 6；每用户安装 `PrivilegesRequired=lowest`、自选安装目录、开始菜单 + 可选桌面快捷方式、标准卸载程序）+ `scripts/build-installer.mjs`（白名单组装载荷 + 仓库内置 Inno Setup 编译器 → `KERNEL-Setup-<version>.exe`，位于仓库之外）；数据位于 `<安装目录>\data` 并以 `uninsneveruninstall` 标记——覆盖安装不清空、**卸载保留用户数据**；无新增依赖 |
| `decisions/0032-ai-organize-projects.md` | ADR | 项目「AI 整理」+ 每日调度（Slice N8）：项目页两段提案（归并到已有项目 / 建议新项目）——`POST /api/ai/organize/draft`（只读，候选 = 无 projectId 未完成任务 + 未澄清收件箱 ≤50；确定性预分组 + AI **按候选编号引用**（不可编造 id）+ 后校验 + 确定性兜底簇）+ `POST /api/projects/organize-apply`（201；服务端重校验；归并**只写任务文件**、逐簇建项、单簇失败不中止、审计 `via:'organize'`）+ `POST /api/projects/organize-unapply`（精确复原）；`src/lib/organize.ts` 每日调度（12:00 后每日一次、30s tick + focus 补跑、跨标签锁 TTL 120s + 会话守卫；**只出草案、绝不自动应用**）+ `OrganizeProposalCard`（两段提案、逐行勾选）；无 schema 变更、无新增依赖 |
| `decisions/0033-web-search.md` | ADR | 收件箱 AI 联网检索（Slice N9 / N9.1）：模型请求式两阶段检索（searchQueries ≤2）→ Sogou→360→Bing 链 + 相关性过滤 + 首条结果页摘录 → 回喂补全 dueAt；固定主机、不落盘、失败保守；证据 .qa/v68 |
| `decisions/0034-inbox-ai-event-actions.md` | ADR | 收件箱 AI 事件识别（Slice N10）：第 5 类动作 event——定点安排（面试 / 会议 / 考试 / 约谈）产日程（startAt 必填 + endAt/allDay/location），动作仍产 task；确认后一次应用、撤销经 linkedIds；证据 .qa/v71 |
| `decisions/0035-chat-lookup-edit.md` | ADR | 总览 AI 对话：实体查阅与代改（QA v73）：模型可请求 `entityQueries`（1–3 条、每条 ≤30 字）→ `resolveEntities` 命中完整记录回喂（响应 `focused` ≤6 条）；修改走 `editRequest` → `buildChatEdits` 白名单校验（≤3 条、fields ≤12 键）→ 前端「修改卡」逐字段「旧值 → 新值」，点「应用」才经既有 `POST /api/<kind>/:id/update` 写入（toast 可撤销：逆序写回 before）；**确认前零写入**；证据 `.qa/v73/` |
| `decisions/0036-parse-defaults-long-image.md` | ADR | 解析默认时间/地点 + 长图分片（QA v73）：事件时间默认钟点补全（早上 08:00 / 上午 09:30 / 中午 12:00 / 下午 14:30 / 傍晚 17:30 / 晚上 19:30；用餐：早饭 07:30 / 午饭 12:00 / 晚饭 18:00 / 夜宵 21:30——系统认可、不算编造）+ 地点提取（≤50 字）；长截图 >400KB 客户端 `sliceImageForAi` 切 ≤6 张 JPEG（长边 ≤1600 / 片高 1600 / q0.82；失败回退单图）→ `POST /api/inbox/:id/ai-preview?index=1..6` RAW 落 `data/files/<id>-ai-<n>.jpg`（派生辅助资源、**无审计**、随条目清理）→ 解析多发 file part、图片解析超时放宽 **180s**；证据 `.qa/v73/` + 探针 `.qa/probe-longimg/` |
| `decisions/0037-native-launcher.md` | ADR | 原生桌面启动器（Slice N7.2）：`启动器.vbs`（ASCII 入口，`wscript` 隐藏拉起，零黑窗）→ `启动器.ps1`（PowerShell 5.1 + .NET Framework WPF 原生窗口，零安装；无边框圆角卡片 + 自绘标题栏 + 品牌 K + `kernel.ico`）；行为对齐旧 HTA + 单实例互斥锁 + `KERNEL_LAUNCHER_SELFTEST` / `KERNEL_LAUNCHER_SMOKE_MS` / `KERNEL_LAUNCHER_PROBE_URL` 钩子；`scripts/make-icon.ps1` 从 `public/favicon.svg` 生成图标；打包同步收录 ps1 / vbs / ico；删除 `启动器.hta`；证据 `.qa/v75/` |
| `decisions/0038-review-automation.md` | ADR | 回顾自动化：周期调度自动生成 + 迁移建议持久化——`useReviewScheduler`（周一 12:00 后 / 每月 1 日 12:00 后，周期已归档 / 未水合 / 会话已试 / 跨标签锁 / AI 离线均跳过；成功 toast + 水合，失败静默；**绝不自动应用建议**）；`reviewSchema` 增可选 `staleAdvice`（draft 归档随报告持久化、手工保存可透传清洗、update 白名单不变），归档报告阅读视图「迁移建议」块；证据 `.qa/v76/`（WS5 25/25 + 前端回归 40/40） |
| `decisions/0039-profile-and-habits-pages.md` | ADR | 个人页 + 习惯页：热力图迁往个人页、习惯独立成页、总览降级入口卡——`/habits` 一级页（打卡 + 热力图 + CRUD，设置页移除习惯区，`h-` 深链改 `/habits?habit=`）；`/profile`（顶栏头像进入：资料 `config.owner/bio/avatarPath` + 头像本地文件端点 + 活跃日历 `GET /api/activity/summary` 本地日聚合含习惯打卡 + 复用动作时间线）；总览习惯块 → `今日 N/M` + 常用习惯 chips 整卡跳转；config 写入在 index.mjs 镜像 store 模式（store.mjs 未改，记录为收敛项）；证据 `.qa/v76/`（服务端 10/10 + 浏览器 28/28） |

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
