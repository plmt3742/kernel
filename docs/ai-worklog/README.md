# AI 协作开发记录

> KERNEL 的 AI 协作开发记录。每条记录保存一次与 AI 的协作：时间、提交、Prompt 原话与结果。
> 条目按时间顺序编号（`NN-<slug>.md`），下方索引同序。

| 文件 | 时间 | 提交 | 标题 |
|---|---|---|---|
| [01-page-design-variants.md](01-page-design-variants.md) | 2026-10-02 | feat: 界面设计选型稿（三方案 + 预览 + 字体）／feat: 页面多版本设计稿 v2 主体（8 页 ×3 方案 + 详情 5 套 + 构建脚本） | 设计选型 · 页面多版本方案 |
| [02-relations-slice-a.md](02-relations-slice-a.md) | 2026-10-02 | feat: 结构互联 · Slice A（运行时互链派生 + 关联区块 + 深链补全） | 结构互联 · Slice A |
| [03-ai-sse-slice-b.md](03-ai-sse-slice-b.md) | 2026-10-02 | feat: 收件箱 AI 解析升级 + SSE · Slice B（上下文注入 + 挂接建议 + 流式过程可视） | AI 过程可视（SSE）· Slice B |
| [04-scroll-memory.md](04-scroll-memory.md) | 2026-10-02 | feat: 路由滚动记忆（各页独立恢复 / 首访回顶） | 路由滚动记忆 |
| [05-inbox-file-intake-slice-d.md](05-inbox-file-intake-slice-d.md) | 2026-10-02 | feat: 收件箱文件投递 · Slice D（上传 / 文件读取 / 居中编辑器 + 附件行） | 收件箱文件投递 + AI 先读 · Slice D |
| [06-edit-trash-reveal-slice-e2.md](06-edit-trash-reveal-slice-e2.md) | 2026-10-02 | feat: 编辑与回收站 · Slice E2（通用编辑 + trash/restore/purge + 文件定位） | 编辑 / 回收站 / 文件定位 · Slice E2 |
| [07-subtasks-slice-r3.md](07-subtasks-slice-r3.md) | 2026-10-03 | feat: 子任务与项目内操作 · Slice R3（parentTaskId 全链路 + 项目行可点 + 项目内加任务） | 项目内操作与子任务 · Slice R3 |
| [08-review-redesign-slice-f.md](08-review-redesign-slice-f.md) | 2026-10-03 | feat: 回顾页重构 · Slice F（周月卡 + Modal 报告 + 月指标） | 回顾页重构 · Slice F |
| [09-overview-chat-slice-g.md](09-overview-chat-slice-g.md) | 2026-10-03 | feat: 总览对话盒与就地详情 · Slice G（多轮对话 + 状态条 + 任务/项目弹窗） | 总览 AI 对话盒 · Slice G |
| [10-chat-upgrade-slice-g1.md](10-chat-upgrade-slice-g1.md) | 2026-10-03 | feat: 总览 AI 查阅/代改与解析默认/长图分片 · Slice G.1 + v73（对话查阅代改 + 钟点地点补全 + 图片分片） | 对话升级：联网 / 自由回答 / 整理进笔记 · Slice G.1 |
| [11-state-coherence-slice-h.md](11-state-coherence-slice-h.md) | 2026-10-03 | feat: 状态贯通 · Slice H（资料/笔记/项目状态 + 快捷设置 + 任务草稿补全） | 状态贯通 · Slice H |
| [12-modal-unify-slice-k.md](12-modal-unify-slice-k.md) | 2026-10-03 | feat: 全站详情居中弹窗统一 · Slice K（5 抽屉→Modal + 操作矩阵补齐 + 日历遮罩 + Drawer 退役） | 全站居中弹窗统一 · Slice K |
| [13-review-archive-slice-l.md](13-review-archive-slice-l.md) | 2026-10-03 | feat: 回顾报告升级 + 自动归档 · Slice L（七段结构 + 环比输入 + 接地护栏 + 生成即归档） | 回顾报告归档 · Slice L |
| [14-note-experience-slice-m.md](14-note-experience-slice-m.md) | 2026-10-03 | feat: 笔记沉浸式体验 · Slice M（阅读/撰写升级 + 新建笔记 + AI 蒸馏） | 笔记沉浸式阅读与撰写 · Slice M |
| [15-tag-lifecycle-slice-t.md](15-tag-lifecycle-slice-t.md) | 2026-10-03 | feat: 标签生命周期 · Slice T（录入即生成 + 系统级自动登记 + 管理/合并/删除 + 筛选条修正） | 标签生命周期 · Slice T |
| [16-review-readability-slice-u.md](16-review-readability-slice-u.md) | 2026-10-03 | feat: 报告可读性 · Slice U（阅读视图默认 + 七段分节排版 + 同期口径 + 行动去重） | 回顾报告可读性 · Slice U |
| [17-confirm-before-write-slice-o.md](17-confirm-before-write-slice-o.md) | 2026-10-03 | feat: 先确认后写入 · Slice O（快速新建草稿确认弹窗 + AI 建议可编辑） | 先确认后写入 · Slice O |
| [18-open-reveal-slice-j2.md](18-open-reveal-slice-j2.md) | 2026-10-03 | fix: 收件箱附件本机动作 · Slice J2（「打开文件/位置」替代下载 + /api/open + dryRun 测试通道） | 打开文件 / 定位 · Slice J2 |
| [19-source-summary-slice-n4.md](19-source-summary-slice-n4.md) | 2026-10-03 | feat: 来源摘要 · Slice N4（解析 summary + 引用人话化） | 数据标签 / 来源人话化 · Slice N4 |
| [20-review-humanize-slice-n6.md](20-review-humanize-slice-n6.md) | 2026-10-03 | feat: 回顾人话化 · Slice N6（digest 人话 + 提示词重写 + 分节别名兼容） | 回顾人话化 · Slice N6 |
| [21-announcement-parse-slice-n0.md](21-announcement-parse-slice-n0.md) | 2026-10-03 | feat: 公告解析 · Slice N0（通知三性 + 条件任务 + 截图投递 + 要点笔记） | 公告解析 · Slice N0 |
| [22-timetable-slice-h0-h2.md](22-timetable-slice-h0-h2.md) | 2026-10-03 | feat: 课程实体 · Slice H0（course 实体 + 学期元数据 + 课表视图 + 手动 CRUD）／feat: 课表导入 · Slice H1（xlsx / 截图 / 文本 → 课程草稿 → 导入）／feat: 回顾动作记录 · Slice S（审计自描述 + 时间线 + 中文四桶） | 课表 · Slice H0–H2 |
| [23-timetable-auto-route-h1-7.md](23-timetable-auto-route-h1-7.md) | 2026-10-03 | fix: 收件箱体验修复批 · H1.7–H1.8（课表自动路由 + 要点三态 + 忽略真消失 + 连续课块合并） | 课表自动路由 · H1.7 |
| [24-link-read-paste-slice-n2.md](24-link-read-paste-slice-n2.md) | 2026-10-03 | feat: 链接阅读与粘贴截图 · Slice N2/N2.5（首链接正文抓取 + Ctrl+V 粘贴截图） | 链接阅读 + 粘贴截图 · Slice N2 |
| [25-parallel-parse-slice-n3.md](25-parallel-parse-slice-n3.md) | 2026-10-03 | feat: 并行解析 · Slice N3/N3.1（每条目独立 job + FIFO 调度 + 窄屏折行） | 并行解析 · Slice N3 |
| [26-project-ai-organize-slice-n8.md](26-project-ai-organize-slice-n8.md) | 2026-10-03 | feat: 项目 AI 整理 · Slice N8（聚类立项 + 每日调度 + 建议卡） | 项目「AI 整理」 · Slice N8 / N8.1 / N8.2 |
| [27-inbox-ai-search-slice-n9.md](27-inbox-ai-search-slice-n9.md) | 2026-10-03 | feat: 收件箱 AI 联网检索 · Slice N9/N9.1（三引擎链 + 相关性过滤 + 回喂） | 收件箱 AI 联网检索 · Slice N9 |
| [28-inbox-ai-event-slice-n10.md](28-inbox-ai-event-slice-n10.md) | 2026-10-03 | feat: 收件箱 AI 事件识别 · Slice N10（新增第 5 类 event 动作） | 收件箱 AI 事件识别 · Slice N10 |
| [29-calendar-aggregate-slice-h3.md](29-calendar-aggregate-slice-h3.md) | 2026-10-03 | feat: 日程聚合 · Slice H3（今日课程 + 任务截止 + 事件） | 日程页三类聚合 · Slice H3 |
| [30-overview-ai-query-edit-v73.md](30-overview-ai-query-edit-v73.md) | 2026-10-04 | feat: 总览 AI 查阅/代改与解析默认/长图分片 · Slice G.1 + v73（对话查阅代改 + 钟点地点补全 + 图片分片） | 总览 AI 查阅与代改 + 解析默认 + 长图分片（QA v73 批次） |
| [31-image-actions-fix-v74.md](31-image-actions-fix-v74.md) | 2026-10-04 | fix: 图片条目「内容动作 + 图片资料」两处口径对齐 · QA v74 | 图片条目的多动作修复（QA v74） |
| [32-desktop-launcher-n7.md](32-desktop-launcher-n7.md) | 2026-10-03 ~ 2026-10-04 | feat: 分发包与桌面启动器 · Slice N7/N7.1（打包器 + 启动页 + HTA 启动器 + 展示页）／feat: 原生桌面启动器（无边框窗口 + 品牌图标 + VBS 隐藏入口） | 桌面启动器 · Slice N7.1 / N7.2 |
