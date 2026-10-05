# TASK_BOOK

KERNEL 的任务台账与迭代记录。记录当前迭代目标、未来待办（backlog）与已完成工作。

约定：每次改代码后在本文件追加记录；当前迭代完成后移入已完成日志。

---


## 下一会话待办（遗留待办）

> **新会话处理入口**：先读 `AGENTS.md` → 本清单 → 按序处理。每项均附上下文与落点。
> **工作约定（2026-10-03）**：调研完成后按推荐默认直接开工，不以拍板阻塞等待；提问仅用于大返工风险且不空等；任务完成通知缺失时以会话读取兜底、绝不挂在等待态。
> **交互反馈纪律（2026-10-03）**：任何按钮点击必须有可见反馈（状态变化 / 面板变化 / toast / 禁用态 / 导航），禁止静默无响应；警惕「清状态被缓存 / 派生渲染回退抵消」的实现模式。
> 状态：v0.4.0 已交付（数据服务 + 前端写入改造 + 审阅 P0 六项 + 路由滚动记忆）；页面排版选型已落地 10/10；**v0.5 首个切片（收件箱「AI 解析」）已交付**；**互联 Slice A（深链 + 关联区块）、AI 澄清升级 Slice B（上下文注入 + 挂接建议 + SSE 过程可视）与 AI 周回顾 Slice C（草稿 → 编辑 → 确认落盘 / 撤销）已交付**（验收：A 20/20、B E2E 13/13、C 冒烟 PASS + E2E 13/13，证据 `.qa/v14/`）；**使用指南 HTML（`public/guide.html`，自包含单文件，三态 25/25，证据 `.qa/v15/`）已交付**；**收件箱升级 Slice D（文件投递 + 居中编辑器 + AI 先读）已交付**（冒烟 PASS + E2E 12/12，证据 `.qa/v16/`）；**收件箱修复包 Slice E1（编辑器回位 + 「批量 → 任务」反馈加固 + AI 结果缓存 + 批量 AI 解析）已交付**（E2E 24/24，证据 `.qa/v17/`）；**详情操作 + 回收站 Slice E2（通用编辑 / 软删除回收站 / 资源文件位置 + reveal）已交付**（冒烟 34/34 + E2E 19/19 + 全站 smoke PASS，证据 `.qa/v18/`）；**动效与布局稳定 Slice E2.6（批量解析过程可视 + 流式节流 + 定高 + 间距 + 换行 + 零重叠）与趋势图数据点裁切修复 Slice E2.7 已交付**（E2E 22/22 + 像素级 8/8，证据 `.qa/v20/`、`.qa/v21/`）；**回顾页重构 Slice F（周 / 月回顾卡并列一栏 + 动画弹窗报告 + 月回顾 AI 支持 + 停滞项目独立栏）已交付**（服务端冒烟 13/13 + E2E 30/30 + 移动 6/6，证据 `.qa/v22/`）；**总览升级 Slice G（AI 对话盒 + 状态条重做 + 就地详情弹窗）已交付**（E2E **42/42** + 构建通过，零残留，证据 `.qa/v23/`）；**状态贯通 Slice H（资料状态 / 笔记蒸馏判断标准 + 快捷设置 + 白名单扩充 + 任务快速新建 AI 补全）已交付**（服务端冒烟 21/21 + E2E 28/28 + 构建通过，零残留，证据 `.qa/v24/`）；**使用指南同步 Slice I（`public/guide.html` 对齐 Slice D–H，三态 65/65，证据 `.qa/v25/`）已完成**；**收件箱修复包 2 Slice J（批量 AI 解析状态跨路由存活 + OOXML `.docx/.pptx/.xlsx` 文本抽取）已完成**（服务端冒烟 14/14 + E2E 16/16 + 零写入，证据 `.qa/v26/`）；**收件箱附件「打开文件 / 位置」Slice J2（去掉浏览器下载，改默认程序打开 / 文件管理器定位；新增 `/api/open` + `/api/inbox/:id/(open|reveal)` 带 `dryRun` 测试通道）已完成**（服务端冒烟 33/33 + E2E 21/21 + 零写入，证据 `.qa/v27/`）；数据服务运行于 `127.0.0.1:4097`；**全部切片（D–J2）已交付、验证（J2 待批次提交）**；**「先确认后写入」Slice O（任务快速新建草稿确认弹窗 + 收件箱建议卡可编辑 + 全站同类审计）已完成**（服务端冒烟 35/35 + E2E 31/31 + 构建通过，零残留，证据 `.qa/v28/`）；**全站详情「居中弹窗」统一 + 操作统一 + 日历遮罩柔化 Slice K 已完成**（五类详情从 Drawer 迁居中 Modal、任务 / 项目详情组件化保证操作一致、底栏统一、日历吸顶条渐隐柔化、删除 Drawer 死代码；E2E **109/109** + 构建通过，零残留，证据 `.qa/v29/`）；**回顾报告升级 + 自动归档 Slice L 已完成**（七段结构正文 + 环比 / 阈值 / 带 id 清单 + 数字落地护栏；生成即自动归档 + 报告历史 + update 同条；服务端冒烟 40/40 + 护栏单测 6/6 + E2E 32/32 + 构建通过，零残留，证据 `.qa/v30/`）；**标签生命周期 Slice T 已完成**（录入即生成 + 自动登记 origin/createdAt/firstUsedIn + AI 可提议新标签 + 管理（重命名 / 合并 / 删除 / backfill）+ 筛选条按使用排序不截断；服务端冒烟 54/54 + 护栏单测 14/14 + E2E 41/41 + 构建通过，零残留，证据 `.qa/v31/`）；**收件箱生命周期闭合 + 澄清字段矩阵 Slice V 已完成**（文本即解析 / 删除入口 / 丢弃恢复 / 澄清撤回与产物深链 / `newProjectHint` 一键建项 / target×字段矩阵杜绝静默丢弃；服务端冒烟 43/43 + E2E 29/29 + 构建通过，零残留，证据 `.qa/v33/`）。**Slice U（回顾报告可读性）见下方专节**。

> **运维（2026-10-03）**：数据清零——新增 `scripts/reset.mjs`（预演 / `--yes` 自动备份后清空；保留 `config.json`）；owner 数据已清零（备份 `.qa/backups/data-20261003-133539`）；零状态空态巡检 9 路由 × 2 视口全绿；证据 `.qa/v48/`。

> **最新（个人页排版重做 · 名片台 · 2026-10-05）**：答 owner「重新设计个人页面，大幅调整排版以及组件设计」→ 先出 **4 版自包含草案**（`design-drafts/v2/profile-{a,b,c,d}.html`：A 名片台 / B 编年史 / C 仪表盘 / D 杂志专栏；复用真实应用壳与 token，逐版 Playwright 实测 0 error · 0 横溢）→ **选定 A「名片台」落地**——① 两栏 `360px + 1fr`（≥1025px），左身份列**吸顶**、右活动流；≤1024px 单列、≤640px 瓦片竖排；② 身份卡**竖排 + 104px 头像** + 元信息（本机记录 / 最近活动；「加入于」等虚构项未采纳，只落真实运行时派生）；③ **3 瓦片统计条**（活跃天数 / 总计 / 当前连续，`computeActivityStats`，绝不落盘）；④ `ActivityTimeline` 增可选 **`plain`**（个人页去掉「分节头 + Panel 头」双重标题；默认 `false`、回顾页逐字不变）。`npm run build` 退出 0；浏览器实测 1600/390 两视口全过（2 栏 + sticky / 1 栏 + static、0 error、0 横溢、无重叠裁切；`/review` 回归）；证据 `.qa/qa-profile/`。

> **上一个（个人页 + 习惯页 · 2026-10-05）**：答 owner「如果有多个习惯，它只显示第一个习惯，设计不合理」+ 其提出的重构方向 → 信息架构调整（ADR-0039）——① **习惯页 `/habits`**（一级导航 07：每习惯一卡——打卡 + 连续/最长/累计 + 可折叠 16 周热力图 + 编辑/删除/新建；设置页习惯区迁出；`h-` 深链改 `/habits?habit=`）；② **个人页 `/profile`**（顶栏头像进入：资料卡 = `config.owner`/`bio`/本地头像（可上传）+ **活跃日历** `GET /api/activity/summary` 本地日聚合零填充（含习惯打卡与全部真实写入、排除设置噪音）+ **动作时间线**（复用 `ActivityTimeline`））；③ **总览习惯块 → 入口卡**（`今日 N/M` + 常用习惯 chips，整卡跳 `/habits`，热力图自总览移除）；④ 服务端 `config` 扩可选 `bio`/`avatarPath` + 头像端点（`POST /api/profile/avatar(|/remove)`、`GET /api/profile/avatar`，审计 `profile.avatar`）；config 写入在 `index.mjs` 镜像 store 模式（**store.mjs 未改**，记录为收敛项）。`npm run build` 退出 0；隔离 QA **服务端 10/10 + 浏览器 28/28**（真实数据零触达）；截图 `.qa/v76/page-{profile,habits,overview-card}.png`。

> **上一个（功能完善 · B 组 · 2026-10-05）**：答交接 §5 B 组六项——① **全局全文搜索**（`searchSnapshot` 本地快照扫描 + 命令面板「搜索 · SEARCH」组 + 资料页搜索框，点结果深链）；② **习惯热力图**（`HabitHeatmap` 近 16 周贡献式网格 + 连续 / 最长 / 累计统计）；③ **`deferUntil` 真正启用**（创建链路补全 + 默认隐藏 + 「含已推迟」开关 + 行标记，日历截止任务同步跳过）；④ **日历翻周**（周游标 + 周视图逐日 + 回到本周 + 迷你月历同步）；⑤ **回顾自动化**（周一 12:00 后 / 每月 1 日 12:00 后自动生成，周期去重 + 跨标签锁 + AI 离线静默，**绝不自动应用建议**；ADR-0038）+ 迁移建议持久化与归档回看。`npm run build` 退出 0；隔离 QA **40/40 + 25/25 + schema 4/4**；证据 `.qa/v76/`。

> **上一个（体验 / 无障碍清扫 · Slice C · 2026-10-05）**：答会话交接 §5 C 组（外部审计 P5 低危项），五项修复——① 全局 `c` 快捷键在弹窗 / 命令面板打开时不再误触（误跳收件箱）；② toast / 命令面板的延迟计时器改为持有 + 卸载清理；③ 总览 AI 批量代改任一条失败即回滚已写入条目（不再半套修改）；④ `EntityEditForm` 引入初值签名，切换编辑对象 / 保存回传时重置表单；⑤ 路由级懒加载 + vendor 分包（入口包 **857.5 → 378.1 kB**，gzip 266.9 → 120.5 kB，无 chunk > 500 kB）。`npm run build` 退出 0；Playwright 冒烟 **12/12 PASS**；证据 `.qa/v76/`。

> **上一个（文档审计对齐 · 2026-10-05）**：本会话交付与文档对齐——**Windows 安装包**（`installer/KERNEL.iss` + `installer/welcome.html` + `scripts/build-installer.mjs`，内置 Inno Setup 编译器；数据位于 `<安装目录>\data` 并以 `uninsneveruninstall` 标记——覆盖安装不清空、卸载保留；两处修复：启动改 `wscript` 解析 `.vbs`、主载荷去除 `Excludes` 误删 `node_modules` 内嵌套 data 目录；build-installer 去机器路径）；**README 重写**（门面 + 界面截图 + 团队信息占位）；**仓库卫生**（删除旧分支 + `gc` 至 3.24 MiB、`.gitignore` 固化、`.gitattributes`、MIT LICENSE）；**本地服务加固**（dev / preview 默认仅本机 `server.host:false`、Origin 同源校验、`/api/files` attachment/nosniff、`/api/open` 注入防护、SSRF 加固、500 收敛、xlsx 列上限、`toDate` 兜底）；**文档审计对齐**（新建 ADR-0031、修正 `docs/00`·`05`·`07`·`README` 一致性 + 0031 引用、清理已移除产物的过期引用）。

> **上一个（Windows 安装包 · 2026-10-05）**：Windows 安装包（Setup.exe）——新增 `installer/KERNEL.iss`（安装向导 / 可选安装目录 / 开始菜单与可选桌面快捷方式 / 卸载程序；每用户安装、无需管理员）+ `installer/welcome.html`（启动页）；`scripts/build-installer.mjs` 按白名单组装干净载荷并调用仓库内置 Inno Setup 编译器（`node_modules\innosetup-compiler\bin\ISCC.exe`，无需系统安装）+ `package.json` script `installer`；数据位于 `<安装目录>\data`，空白骨架标记 `uninsneveruninstall`，**卸载保留用户数据**；`启动.cmd` 未检测到 Node 的提示文案中性化。验证：静默安装退出码 0、`curl` 5173 与 `/api/snapshot` 均 200、`POST /api/tasks` 201 且写入安装目录 `data\`、静默卸载退出码 0 且数据保留。

> **上一个（Slice N7.2 · 2026-10-04）**：桌面启动器原生重做——答 owner「桌面快捷按钮也就是启动器太丑了，优化一下，现在只是网页套壳而已，很低廉」。旧 `启动器.hta`（mshta / IE 套壳：白色系统标题栏 + mshta 图标 + 方角窗口 + IE11 天花板）→ **`启动器.vbs`（纯 ASCII 入口，`wscript` 隐藏拉起，零黑窗）→ `启动器.ps1`（PowerShell 5.1 + WPF 原生窗口：无边框圆角卡片 + 自绘标题栏 + 品牌 K 笔画标记 + 状态脉冲 / 进度轨 / 强调色 CTA）**；`kernel.ico`（16–256）由 `scripts/make-icon.ps1` 从 `public/favicon.svg` 几何生成；桌面快捷方式重建（`wscript.exe` + 启动器.vbs + kernel.ico）；**行为 parity**（探活 800ms / 启停 dev 栈 / 就绪自动开浏览器 / 创建快捷方式 / 日志 → 启动.cmd / 状态机与超时口径一致）+ 单实例互斥锁 + selftest / smoke / probe 钩子 + 停止态文案修正；打包同步（打包器改收 ps1/vbs/ico）；QA v75（前后截图 + 3 轮视觉迭代 / 自检独立复验 PS_EXIT=0 / vbs 链 1180ms 可见·5591ms 自关 / 真实快捷方式端到端 DURING=1·AFTER=0 / 图标 7 尺寸 / 快捷方式 6 项读回 / WSCRIPT=0·MSHTA=0·5173 在线）；新增 **ADR-0037**；收尾另修复 `scripts/spawn-bg.mjs` 日志捕获失效（`shell:true` 下 fd 经 cmd.exe 失效 → 自中继模式；对照实验与分发包重建证据同目录）；证据 `.qa/v75/`。

> **上一个（QA v74 · 2026-10-04）**：图片条目多动作修复——答 owner「丢入了资料（图片）……ai解析后触发了bug……有时候是单纯想要存入这个资料，有时候是为了辅助我的文字内容……在分析后也需要分析这个资料本身该如何被简介后存入资料库」。**根因**：解析侧对图片走多动作管线（N0），apply 侧却按「文件条目」一律只放行 resource（400「文件条目只能应用为资料」），两侧口径不一致。**修复**（仅图片条目；非图片文件 R2.5 不变）：① 规则 9——图片始终产出 1 个 resource 收录图片本身（note = 简介）+ 多动作；② `postValidateActions` 兜底补齐图片 resource（文件名兜底 / 置首 / ≤6）；③ apply 纵深防御收窄为 `hasFile && !isImageFile(item)`。**owner 实机复核**：i-0027 重解析 →「全部应用」成功（e-0004 / e-0005 / r-0006 + 标签 topic:ICPC）。QA v74：`fix-image-actions` **11 PASS · 0 FAIL**（一揽子 200 / path / 撤销 / 非图片仍 400 / 零残留）；构建 0；ADR-0015 §5.5；证据 `.qa/v74/`。

> **上一个（QA v73 批次 · 2026-10-04）**：答 owner 批次六项诉求（总览 AI 查阅/代改、工作台今日日程、日历含已结束、收件箱文字+附件、解析默认时间/地点/标签、长截图超时）——① 总览 AI 增**查阅**（`entityQueries` → `resolveEntities` 回喂完整记录，响应 `focused`）与**代改**（`editRequest` → `buildChatEdits` 白名单校验 → 「修改卡」旧值→新值，点「应用」才经 `POST /api/<kind>/:id/update` 写入、可撤销；**确认前零写入**）；② 工作台「现在」线下就地渲染今日未结束日程（修复，答「工作台没有显示今天的日程安排？」），点行直接弹 `EventDetailModal`；③ 日历「含已结束」开关（localStorage 记忆 / ≤50 / 排除已取消）；④ 收件箱行「文字 + 附 N 个文件 · 文件名 · 大小」并显；⑤ 解析默认钟点补全（晚上 19:30 / 晚饭 18:00 等，系统认可不算编造）+ 地点提取 + 活动标签（感知现有标签/项目）；⑥ 长图分片（>400KB 切 ≤6 张 → `ai-preview` → 多发 file part、图片解析超时 180s）。**i-0024 事故**：被误删重建的原句「今晚要去吃某餐厅的自助餐」已从解析会话精确找回并恢复（备份 `.qa/v73/i-0024-before-restore.json`；e-0002 留回收站由 owner 处置）。**QA v73**：探针 15 项 ALL PASS / 服务端 41 项 ALL PASS / 浏览器 0 FAIL / 构建通过；基线增量核验仅两处已知差异（owner 自建 i-0027 + i-0024 修复）；新增 ADR-0035 / ADR-0036；证据 `.qa/v73/`。

> **上一个（Slice G.1 · 2026-10-03）**：总览 AI 对话升级——① 助手回复改 **Markdown 渲染**（`react-markdown`，无 `dangerouslySetInnerHTML`；用户轮纯文本；`.k-chat__md` token-only）；② 尺寸放宽（thread max-height 560px、消息 94%、正文 15px、输入 44px、圆角 12）；③ **联网检索 + 自由回答**：`buildChatSystem` 三类（读库事实 / 一般知识自由答 / 需外部事实时只输出 `searchQueries` ≤2）→ 复用 N9 `buildSearchSection`（Sogou→360→Bing + 相关性过滤 + 首条页摘录）→ 同会话回喂作答，响应 `searched`，失败保守注明；④ **整理进笔记**：对话式（命中「整理/保存/归档…进笔记」意图）或每轮「存为笔记」按钮 → `POST /api/ai/chat/note` → `draftChatNote`（AI 出标题 + 正文；失败确定性回退首行标题 + 原文）→ `note.create` · via:'chat.note' 可撤销；对话仍**不落盘无审计**；QA v72 **50 PASS · 0 FAIL**（零残留 53 文件、notes 回基线）；证据 `.qa/v72/` + 探针 `.qa/probe-g1/`。

> **上一个（产品展示页 · 2026-10-03）**：产品展示页——单文件自包含（3.62 MB；base64 内嵌 15 张真实界面截图 = 10 模块 + 命令面板 + 任务弹窗 + AI 处置卡 + 双移动端；零外链、file:// 直接发人）；构建器 `.qa/showcase/build.py` 可重跑；零残留；注意截图含本机真实数据，外发前自行确认。

> **上一个（Slice N10 · 2026-10-03）**：收件箱 AI 事件识别——AI 动作新增**第 5 类 `event`（日程 / 事件）**：会在某时刻「发生」的事（面试 / 会议 / 考试 / 约谈 / 活动）产日程（`startAt` 必填 + `endAt` / `allDay` / `location`；**时间无法明确推出就不产**，宁可 task + facts），「要做的动作」仍产 task，同一内容可 event + task 同时产出不重复拆条；`postValidateActions` 清洗（startAt 无效即丢弃、endAt ≥ startAt）、apply 落 `events`（**无时间戳**、`status:'confirmed'`、via:'inbox.apply'）、撤销经 `linkedIds`（顺带修复 `kindOfId` 缺 `e-` 映射）；文件条目仍只产 resource、截图走文本管线；QA v71 **59 PASS · 0 FAIL**（零残留 45 文件）；证据 `.qa/v71/` + 探针 `.qa/probe-n10/`。

> **上一个（Slice H3 · 2026-10-03）**：日程聚合——日历页三类聚合（今日课程 + 任务截止 + 事件）：课程按星期 / 周次过滤并合并节次、任务按 dueAt 归桶（逾期落今天，行内「截止 HH:mm」）、点击行开对应详情；迷你月历圆点与月统计、bar「今日 N 节课 · M 项截止」同步；QA v70 **21 PASS · 0 FAIL**；证据 `.qa/v70/`。

> **上一个（N8.2 · 2026-10-03）**：项目详情「状态快捷切换」——详情弹窗内 4 枚 chip（进行中 / 暂停 / 将来 / 已完成）一点即保存并移动分组，toast「状态已设为「X」」+ 撤销；「已归档」仍走编辑表单；与日程同款安静 segmented（复用 `.k-lib__seg`）；QA v69 **17 PASS · 0 FAIL**；证据 `.qa/v69/`。

> **上一个（Slice N9 / N9.1 · 2026-10-03）**：收件箱 AI 联网检索——模型在解析时主动请求 `searchQueries`（≤2、每条 ≤60 字），服务端经 **Sogou 主 → 360 次 → Bing 备** 链检索（每引擎结果过**相关性令牌过滤**、每条成功问题补抓**首条结果页正文摘录** ≤900 字）后**回喂同一会话**做第二轮，补全 `dueAt` / `facts`；响应新增 `searched`，流式先发 `{kind:'status',status:'searching'}`、前端阶段「正在联网检索…」；固定主机、12s 超时、**不落盘无审计**、失败静默降级绝不编造；仅文本 / 截图条目。实测「准备一下今年的四级考试」→ 检索 2 问 → 任务 `dueAt=2026-12-12T09:00:00+08:00`、`facts` 含笔试 / 口试 / 报名入口、18.2s；N9.1 复验证据 `.qa/v68/`（`logs/reverify.log`）+ `.qa/probe-search/`；新增 **ADR-0033**。

> **上一个（N8.1 · 2026-10-03）**：项目「AI 整理」智能升级——分类标准 v2（三分类：【A 归并到现有项目】具体归属（同课程 / 同赛事 / 同组织一件事 / 同委托方 / 同一人同一事务 / 项目完成定义的一步，仅「领域相近」不算）；【B 建议新项目】≥2 条同一件多步事务，**单条**明确多步事务（准备考核 / 组织活动 / 开发交付 / 长期训练）可自行立项须给 `outcome`+`reason`；【C 不规划】单步事务正确不输出）+ 限额放宽（assignments 5→**8** / clusters 3→**5** / ≥2 成员成簇 / 单条门槛 = 非空 `outcome` + `reason` ≥6 字）+ 响应增 `unplanned`（前端「另有 N 项未纳入规划」）+ digest 占位完成定义兜底 + 项目状态编辑「判断标准」hint；实测 t-0003 单独立项「Python 5 日速成」；QA v68 全过；证据 `.qa/v68/`；修订 **ADR-0032 §7**。

> **上一个（Slice N8 · 2026-10-03）**：项目「AI 整理」——项目页「AI 整理」出两段提案（「归并到已有项目」/「建议新项目」，逐行勾选默认全选、确认后一次应用、toast 可撤销）；服务端 `POST /api/ai/organize/draft`（只读，AI 按候选编号引用、确定性兜底）+ `/api/projects/organize-apply`（归并只写任务文件、逐簇建项，审计 `via:'organize'`）+ `/api/projects/organize-unapply`（精确复原）；`useOrganizeScheduler` 中午 12:00 后每日一次（30s tick + focus 补跑 + 跨标签锁；只出草案、绝不自动应用）；QA v67 **86 PASS · 0 FAIL**（clock 验证时段门控 + 当日不重跑）；零残留；证据 `.qa/v67/`。

> **上一个（N7.1 · 2026-10-03）**：桌面启动器——`启动器.hta`（Windows 原生窗口，零依赖：启动/打开/停止/创建桌面快捷方式；隐藏拉起 dev + 自动开浏览器；selftest 钩子）；桌面快捷方式已创建（`KERNEL 启动器.lnk`）；分发包同步收录并重建（16,290 条目）；QA v65 全绿；证据 `.qa/v65/`。

> **上一个（Slice N7 · 2026-10-03）**：分发包打包 + 运行时接入——新增打包器（白名单拷贝 + 内置 node/opencode 运行时 + 空白数据骨架 + 无密钥 `opencode.json` + **强制隐私扫描 → zip**）+ 零安装；`dev.mjs` 支持 `KERNEL_OPENCODE_BIN`、`启动.cmd` 单一版本两用、`launcher.mjs` 启动页优先（就绪不再开第二个标签）；实产物：`release\KERNEL-分发包-v0.5.0\` + zip（**127 MB** / 未压缩 385.3 MB）；QA v64 独立复核全绿（隐私 0 命中 / 内置 node v22.22.3 + opencode 1.18.32 可执行 / 启动页 11/11 / zip 16,289 条目）；自检全过；证据 `.qa/v64/`。

> **上一个（Slice N6 · 2026-10-03）**：回顾人话化——digest 活动行/对比行人话化（无审计动作名、无「基准/环比」）+ 提示词改「真诚口吻」 + 七段标题友好化（这周怎么样/干了些什么/和上周比/哪里卡住了/值得保持的/接下来/需要留意的）+ 新旧标题双兼容；QA v63 26/26（真实周/月新标题·禁词 0·「开了个好头……」；旧归档回归）；证据 `.qa/v63/`。

> **上一个（Slice N5 · 2026-10-03）**：AI Key 本地配置 + 双击启动器——设置页填 DeepSeek API Key（密码型/不回显）→ 本机 `data/meta/secrets.json`（gitignore，绝不入库）→ 启动器注入 `DEEPSEEK_API_KEY`；`启动.cmd` + `launcher.mjs`；QA v62 35/35；零泄漏；证据 `.qa/v62/`。

> **上一个（Slice N4 · 2026-10-03）**：来源摘要——解析产出 `summary`（≤40 字）→ apply 落档 → 引用人话化（关联显示摘要/折叠截断、无可见编号；已澄清显示产物标题）；QA v61 25/25+24/24；证据 `.qa/v61/`。

> **上一个（N3.1 · 2026-10-03）**：第二次数据清零（含历史，备份 `.qa/backups/data-20261003-152819`）+ 收件箱窄屏长 token 折行修复（390 横溢 160→0；根因 `.ic-row__title` 缺 `overflow-wrap: anywhere`）+ 巡检脚本修订（`/timetable` 独立页）；10 路由 × 2 视口横溢全 0 · console error 全 0；证据 `.qa/v60/`。

> **上一个（Slice N3 · 2026-10-03）**：并行解析——每条目独立 job + 每 id 令牌 + FIFO 调度器（并发 ≤3 完成自动进位）+ 批量完成驱动进度 + 按条清理；多文件通用条目并行；服务端零改动（审计：零锁 / 每解析独立 session）；QA v59 **26/26**（3 条同显解析中·完成序 C→B→A·批量墙钟 4.23s·真实连发两条双就绪未断）；零残留；证据 `.qa/v59/`。

> **上一个（Slice N2 / N2.5 · 2026-10-03）**：链接阅读（首次出站抓取：文本条目首个 http(s) 链接 → 正文注入 → 简介基于实际内容；私网拒抓 / 8s / 2MB / GBK 回退；失败保守回退不阻断）+ `resource.url` 端到端 + Ctrl+V 粘贴截图（纯文本不拦截）；QA v57 16/16+9/9 · v58 10/10；零残留；证据 `.qa/v57–v58/`。

> **上一个（N0.10 · 2026-10-03）**：收件箱来源图标挤压修复——`.k-source-icon` 补 `flex-shrink: 0`（长文本行曾把 26px 徽标压到 7.7px，两行不一致）；DOM 复测两行均 26×26/13px；只读；证据 `.qa/v56/`。

> **上一个（N0.9 · 2026-10-03）**：解析状态跨页存活修复——根因锁定「单条解析中『收起』杀解析并永久丢结果」（复现矩阵 `.qa/v56/repro-matrix.py`）；修：收起纯视图化 + 迟到结果不静默丢弃（`dismissedIds` 显式作废集）；复验 B′/C′ 全 PASS；只读零写入；证据 `.qa/v56/`。

> **上一个（N0.8 · 2026-10-03）**：总览「习惯打卡」条修复——零习惯空态（「还没有习惯 · 去设置创建」深链）+ 按钮竖排/叠挤根因修复（`flex-shrink:0 + nowrap`）；QA 29/29（含真实创建→打卡→清理全流程）；证据 `.qa/v55/`。

> **上一个（N0.7 · 2026-10-03）**：本机动作反馈修复——「打开文件 / 位置」成功 toast ×4（收件箱 + 资料页）+ explorer `/select,"路径"` 原生规范形式 + spawn 失败入数据服务日志 + 资料页错误文案对齐（「定位失败」）；QA 16/16；零写入；证据 `.qa/v54/`。

> **上一个（Slice H2 · 2026-10-03）**：课表独立页面——从日程「议程 / 课表」切换搬出为侧栏一级页 `/timetable`（导航 index 05，位于日程之后；日程回退纯议程）；侧栏 / 命令面板同源；移动端底栏 6 项 + 更多；旧界面态（含 `mode` 键）容忍；QA 34/34；零写入；证据 `.qa/v53/`。

> **上一个（收件箱体验修复批 · H1.7 → H1.8 · 2026-10-03）**：课表自动识别路由（文件名含「课表/课程表/时间表」的文件到达即直走课表解析，不出通用建议卡）+ 要点笔记三态反馈（保存中 / 已存·查看 / 撤销回退）+ 「忽略」真消失（清缓存 + toast，全站按钮反馈审计）+ 课表连续节次合并显示（`mergeDayRuns`；含排序依赖缺陷修复）；QA：H1.7 17/17 · N0.5 修复后复验通过 · N0.6 22/22 · H1.8 26/26 + 定向 4/4；零残留；证据 `.qa/v49–v52`。

> **上一个（Slice S · 2026-10-03）**：回顾「动作记录」——审计自描述（`commit`/trash/restore 并入 `title`、`updateEntity` 并入 `status`）+ 时间线（日分组 / 四档过滤「全部 · 完成 · 新增 · 打卡 · 其他」/ 深链 / 空态，`kernel.ui.review.v1` 持久化）；冒烟 32/32 + E2E 27/27；零残留；证据 `.qa/v47/`。

> **上一个（Slice H1.6 · 2026-10-03）**：课表解析过程可视——`POST /api/ai/timetable/draft-stream`（SSE：status / delta / retry / suggestion / error）+ 阶段与输出预览（≤240 字、≤2 行）；冒烟 29/29 + E2E 18/18；零残留；证据 `.qa/v46/`。

> **上一个（Slice H1.5 · 2026-10-03）**：旧版 `.xls` 直读（零依赖 OLE2/CFBF + BIFF8 最小解析）——所有者真实课表 `draft` 出 **12 门课全对**（教师 / 地点 / 星期节次 / 周次），失败仍回退指引；`.qa/probe-xls/` 19/19 + `.qa/probe-h1/` 回归 19/19 + 冒烟 32/32；零残留；无新增依赖；证据 `.qa/v45/`、`.qa/probe-xls/`。

> **上一个（Slice H1 · 2026-10-03）**：课表导入——收件箱「导入为课表」：`.xlsx`（网格抽取）/ 截图（file part）/ 粘贴文本 / HTML 版 `.xls` → AI 课程草稿（勾选、默认全选）→ 确认导入 `courses`（`via:'timetable-import'`，可撤销）；旧版二进制 `.xls` 给出清晰指引（另存为 .xlsx / 截图 / 粘贴）。验收：服务端冒烟 32/32 + 浏览器 E2E 20/20（真实 AI 从 HTML 课表提取 4 门课全对）；零残留（159 数据文件字节哈希一致；owner i-0013/r-0013/tags.json 字节不变）；控制台 0 error；证据 `.qa/v45/`。

> **上一个（Slice H0 · 2026-10-03）**：课表——新实体 `course`（`c-`：课程 + 多时段「星期/节次/周次/地点」）+ 学期元数据 `data/meta/term.json`（第 1 周周一 + 总周数）+ 日历「议程 / 课表」模式（周网格 + 今天行 + 按周过滤含单双周）+ 手动录入 CRUD（回收站 / 撤销）；QA 修复 `commit()` 缺父目录（新实体首写 500）与 `.k-sched` 类名撞车（390 横溢 → `k-timetable*` 改名）。验收：服务端冒烟 53/53 + 浏览器 E2E 31/31；零残留（157 数据文件字节哈希一致、term.json 精确复原）；控制台 0 error；证据 `.qa/v44/`。

> **上一个（Slice N0 · 2026-10-03）**：收件箱「公告解析」——通知三性（facts 要点 / condition 条件任务 / 纯提醒不产动作）+ 条件动作默认不勾选 + 要点块/存为要点笔记 + 截图投递接入同一解析管线（opencode file part；默认模型读图已实测）+ 审计 signals.conditions 打底。验收：服务端冒烟 30/30 + 浏览器 E2E 30/30；零残留（157 数据文件字节哈希一致）；控制台 0 error；证据 .qa/v43/。

> **上一个（Slice Z · 2026-10-03）**：状态保留（F25–F29）——答所有者「切换页面后再回来就清空了，根本没有保留和记忆」。新增通用助手 `src/lib/uiState.ts`（模块级 store + 可选 `localStorage`，安全解析 / 裁剪 / 静默失败）；**F25 AI 对话**：`draft`/`busy`/`error` 提升到模块 store + 请求函数 / 令牌模块化（思考中跨页保留）+ 对话持久化（上限 60 轮、刷新还原、清空同步清副本）；**F26 任务**：筛选 / 分组 / 更多展开 / 快速新建草稿持久化；**F27 收件箱**：选中 / 展开 / 捕捉草稿持久化 + 数据版本对账（`pendingFiles` 刻意不持久化）；**F28 资料**：标签页 / 笔记类型 / 资料类型 / 资料状态 / 选中标签持久化；**F29**：日程游标 / 项目快速新建 / 回顾草稿运行态（回顾刻意不落 localStorage）。机制选择（module store vs localStorage vs URL）与不持久化清单见 ADR-0022。验收：`npm run build` 退出 0；浏览器 E2E **51/51**；零残留（157 文件字节哈希前后完全相同）；控制台 0 error；证据 `.qa/v42/`。

> **上一个（Slice Y · 2026-10-03）**：一致性清扫——只读审计剩余项（F4/F5/F7/F11/F12/F13/F14/F17/F18/F21/F24/F32/F33/F36 + 标签补全）。**情境统一**：AI 提示词情境从标签注册表派生（`contextNamesOf`），任务上下文筛选 = 已用 ∪ 注册表；**量纲单一源**：重要性统一 **0–3**（存量 `t-0057`/`t-0058` 含 0，故选 0–3 而非 1–3）、能量 `ENERGY_OPTIONS`；**资料可直接新建**（`POST /api/resources` + 草稿弹窗 + 撤销/深链）；**报告 / 总览**：移除死「迁移」瓦片、W40 null 安全、监视柱 / W40 深链、报告内停滞建议行可点；**摩擦修复**：详情「推迟至」行、重新解析保留用户编辑（模块级 `actionEditCache`）、多文件上传受限并发、编辑保存撤销（`undoPatchOf`）、标签输入补全。验收：服务端冒烟 **30/30** + 浏览器 E2E **35/35**，零残留、所有者 157 个数据文件字节不变，证据 `.qa/v41/`。

> **上一个（Slice M · 2026-10-03）**：笔记体验——**沉浸阅读 / 撰写 + AI 蒸馏**（ADR-0020）。详情改加宽弹窗 `.k-modal--note` + 正文 68ch/行高 1.8 + 安静元数据条（正文为主角）；编辑面标题 + 正文（`rows=18`）优先；新增「新建笔记」撰写弹窗（创建可撤销 = 回收站）并打开 `?note=`；蒸馏语义显式说明（**点选只标注、不改写**）；新增 `POST /api/ai/note/distill { id, targetLevel? }`（下一层草稿、缺省当前+1 封顶 L3、**不落盘**），应用 = 正文**追加** `## 蒸馏 → Lx` + 设层级、撤销精确还原。验收：服务端冒烟 **34/34** + 浏览器 E2E **35/35**，零残留、所有者 157 个数据文件字节不变，证据 `.qa/v40/`。

> **上一个（Slice X · 2026-10-03）**：区域 / 目标 / 习惯转为可管理实体——设置页三管理区 + 创建 / 编辑 / 删除（回收站）+ 区域 / 目标**引用护栏**（被引用 → 409 可读计数）；习惯补齐**打卡**（`checkin`/`uncheckin`，缺省今天、幂等）与总览「今日打卡」切换（撤销）；修复 `h-0002` 硬编码（改取首个习惯 + 显示其标题）；area/goal 关联芯片可点（F8）；项目区域默认显式化（F23）。验收：服务端冒烟 **62/62** + 浏览器 E2E **45/45**，零残留、所有者 157 个数据文件字节不变，证据 `.qa/v39/`。至此 **task / project / note / resource / event / area / goal / habit 八类实体全部可管理**（`goal.keyResults` 与 `repeatRule` 仍仅展示保留，延后）。

> **上一个（Slice W · 2026-10-03）**：事件（日程）转为可写实体——新建（先确认后写入）/ 编辑 / 删除（回收站可撤销）/ 文档状态流可执行 + 迷你月历日格可点。验收：服务端冒烟 **33/33** + 浏览器 E2E **27/27**，零残留、所有者 20 条事件字节不变，证据 `.qa/v38/`。

### A. 验收（所有者）

- [x] **浏览器验收**（2026-10-02 修复轮已由 AI 全量复核：8 视图 × 1280/1920/390 + 折叠/滚动/抽屉/命令面板）。
- [ ] **手机验收**：同一 WiFi 下访问 `http://192.168.0.10:5173`，确认移动端布局（底部标签栏 / 单列 / 全宽抽屉）与操作可用（v0.4：手机写入经代理到数据服务，可测一条捕捉/完成）。
- [ ] **修复复核**：打开总览左上角确认品牌锁排完整（"KERNEL" 不再裁切）、顶栏接缝齐平；任务页筛选与分组同一行；日历滚到「现在」后日期条仍可见。
- [ ] **滚动记忆复核**：任务页滚到中部 → 切到总览 → 切回任务，确认停留在上次位置；各页面互不影响。
- [x] **设计稿选型**：10/10 完结——总览「工作台」已于 2026-10-02 落地（见「总览排版落地」节）。

### B. 下一步（按优先级）

- [x] **v0.4.0 数据服务**（2026-10-02 完成）：见下方「v0.4 数据服务」章节。
- [x] **总览落地「工作台」（选型 10/10 完结，2026-10-02）**：三轮 C 获采纳并落地（左工作区 + 右粘性监视柱 + 项目推进，详见下方「总览排版落地」节）。过程记录：第二轮三版（监控台 / 驾驶舱 / 信号层）均未采纳 → **第三轮交付**（今日线 TODAY LINE / 状态带 STATUS STRIP / 工作台 WORKBENCH；组织原则与前两轮全面错开，**监测图表去主导化**；二轮稿归档 `_archive/overview-*-v2.html`）；「连续刷题」打卡带 AI 感反馈已随 C 稿一并落地。其余 9 项已于 2026-10-02 全部落地并回归验证。
- [ ] **v0.5.0 opencode AI 接入**：原始核心诉求（丢文件 / 通知 → AI 解析 → 联动日程建议）。直连方案已调研完毕（`opencode serve` + `@opencode-ai/sdk` + SSE + `format: json_schema`），落点见 `docs/02-ARCHITECTURE.md` §4 与 Backlog「v0.5 opencode AI 集成」。
- [ ] **P1 体验项 · 剩余**：日历翻周 + `Task.deferUntil` 启用 / 回顾步骤持久化 + 资料搜索 / a11y 三处（路由移焦到 h1、命令按钮 aria 句柄、`focus.ts` `offsetParent` 误判）。
- [x] **修并发读竞态**（2026-10-05 已修：`readKind`/`readDirRecords` 并发读容错）：`readKind`/`readDirRecords` 与删文件写入（unapply/revert）并发时 `GET /api/snapshot` 偶发 ENOENT 500（复现 `.qa/v43/repro-500.mjs`，44 次 1 次）；建议 readFile 加 try/catch（ENOENT 跳过）或写侧短锁。
- [x] **spawn-bg 日志为空**（QA v75 已修：自中继模式）：`node scripts/spawn-bg.mjs <log> "npm run server"` 的日志文件出现 0 行（npm 子进程 stdout 未落盘），影响服务端诊断（N0.9 排查时无法查解析历史）；建议改 node 直启或 `npm --foreground-scripts`。

### C. 小尾巴（可选，低优先）

- [ ] 种子数据以 2026-10-02 为"现在"；时间久了用 `npm run seed -- --force` 重置演示数据。
- [ ] `design-drafts/`（三份设计稿 + 选型页）保留作方向参考；`.qa/` 证据归档保留（体积小）。

---

## 个人页 + 习惯页：热力图迁移 + 习惯独立成页 + 总览降级入口卡（已完成 · 2026-10-05）

答 owner「如果有多个习惯，它只显示第一个习惯，设计不合理，你觉得能怎么优化」——owner 给出更完整方向（个人页：头像/姓名 + GitHub 式贡献日历 + 时间线；习惯独立成页；总览习惯改为入口卡），采纳为信息架构调整（ADR-0039），四个并行工作流交付：

1. **习惯页 `/habits`**（新 `src/views/Habits.tsx`，一级导航 07）：全部习惯卡片——今日打卡（紧凑 `k-streak__toggle`，toast + 撤销 + busy 守卫，语义与原总览一致）、`getHabitStats` 连续/最长/累计、可折叠 `HabitHeatmap`、编辑/删除（入回收站 + 撤销）/「新建习惯」（`EntityEditForm` + Modal，字段规格自 `DimensionManagers` 迁出）；`?habit=` 深链打开编辑；零习惯空态 + 创建 CTA。**设置页移除习惯区**（`DimensionManagers` 只留区域/目标，`Settings` 去掉 habits 分区与深链）。
2. **个人页 `/profile`**（新 `src/views/Profile.tsx` + `src/components/ActivityCalendar.tsx`；顶栏头像进入）：资料卡（头像 = `config.avatarPath` 图片或姓名首字母 monogram；显示名 / 简介内联编辑；头像上传 ≤2MB、png/jpeg/webp/gif）+ **活跃日历**（`GET /api/activity/summary?days=140`，复用 `.k-heat*` 网格 + `.is-l1..is-l4` 强度 + 月份/星期轴 + 图例 + 汇总）+ **动作时间线**（直接复用 `ActivityTimeline`）。`TopBar` 增右端头像入口（`Link` → `/profile`）；`lib/data.ts` 增 `profileAvatarUrl()`；`types.ts` `AppConfig` 扩 `bio?`/`avatarPath?`；`mutations.ts` 增 `updateProfile`/`uploadProfileAvatar`/`removeProfileAvatar`。
3. **总览习惯块 → 入口卡**（`Overview.tsx`）：`习惯 · 今日 N/M` + `getFrequentHabits`（近 30 天打卡降序、并列看连续）chips（非交互）——**整卡 button 跳 `/habits`**；`getCodingStreakDetail`/热力图/打卡切换自总览移除；`derive.ts` 增 `getFrequentHabits` + `isHabitHitToday`；`relations.ts` `h-` 深链改 `/habits?habit=`。
4. **服务端 + 导航**（`server/{schemas,index}.mjs`、`src/lib/nav.ts`、`src/App.tsx`、`CommandPalette`）：`appConfigSchema`（bio ≤160 / avatarPath，catchall）；`POST /api/config` 白名单扩 `owner`/`bio`（至少一键，空 400）；头像三端点（RAW 流式 + 2MB + 413/400，替换清旧，`GET` 流式 + nosniff + no-store + 404（路径限于 `data/files` 且前缀 `profile-avatar-`））；`GET /api/activity/summary`（默认 140 / clamp 7..400 / 零填充 / 排除 `config.update` 与 `ai.key.update` / 容错坏行与缺文件）；config 写入经 `index.mjs` 内串行链 + `write-file-atomic` + 审计（**store.mjs 未改**——原 `updateConfig` 仅支持 `aiAutomation`，ADR-0039 §2.4 记录为后续收敛项）。导航：`/habits` 一级项（索引 01–11 顺延）；`nav.ts` 增 `EXTRA_PAGES`（`/profile` 标题解析，不进轨道/面板导航组）+ 命令面板「个人页」动作。

- [x] 修改：`server/{schemas,index}.mjs`、`src/{types.ts,App.tsx}`、`src/lib/{nav,relations,derive,data,mutations}.ts`、`src/components/{shell/TopBar,DimensionManagers,ActivityCalendar（新）,CommandPalette}.tsx`、`src/views/{Habits（新）,Profile（新）,Overview,Settings}.tsx`、`src/styles/{components,views}.css`、`public/guide.html`、`docs/{00,02,04,05,README}`、`docs/decisions/0039-profile-and-habits-pages.md`。
- [x] 验证：`npx tsc --noEmit` 0 error；`npm run build` 退出 0（入口 389.9 kB）；隔离 QA——服务端副本 `.qa/v76/server-qa/`（端口 4197、独立 data、脚本 `server-profile-check.mjs`）**10/10 PASS**；浏览器 `qa-pages.py`（拦截 `/api/**` 注入夹具，真实数据零触达、零写真实库）**28/28 PASS**；视觉复核 `.qa/v76/page-profile.png` / `page-habits.png` / `page-overview-card.png`。
- [x] 记录：ADR-0039；`docs/{00,02,04,05,README}`；`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md`、`public/guide.html`。

## 功能完善 · B 组（已完成 · 2026-10-05）

答会话交接 `.qa/SESSION-HANDOFF.md` §5 B 组（Roadmap v0.6 + 缺口）。六项：

1. **全局全文搜索**：`src/lib/data.ts` 新增 `searchSnapshot(query, limit = 8)`（`SearchResult = {kind, id, title, snippet, deepLink}`）——本地快照扫描任务 / 笔记 / 资料 / 日程 / 项目，大小写不敏感、标题命中（rank 0）优先于正文命中（rank 1），片段 ≤80 字（复用 `condenseContent`），深链复用 `relations.deepLinkOfId`；命令面板新增受控查询 + 「搜索 · SEARCH」分组（item value 含原始查询串防 cmdk 过滤，`run()` 契约不变）；资料页 `.k-lib__filters` 首位新增搜索框（查询持久化 `kernel.ui.library.v1` 的 `q`，与既有筛选叠加，空态文案适配）。
2. **习惯热力图 + 连续打卡统计**：新组件 `src/components/HabitHeatmap.tsx`（16 周 × 7 天、周一对齐、实心 / 空心 / 未来占位、月份标签、逐格 tooltip、`role="img"` + aria-hidden 内层、不可聚焦、零动画）；`src/lib/derive.ts` 新增 `getHabitStats(habitId, now?)`（`current` 复用 `getHabitStreak` 同口径、`longest` 日期步进连续段、`total` 命中计数）与 `getHabitHeatWeeks`；`Overview.tsx` 用热力图替换 14 天点阵并加统计行；`components.css` 新增 `.k-heat*` token-only（cell / gap / radius 均由 `--space-*` 派生）。
3. **`deferUntil` 真正启用**：创建链路——`server/schemas.mjs` `taskCreateFieldsSchema` + `server/index.mjs` `CREATE_FIELD_KEYS` / `createTask` 补 `deferUntil`，`TaskCreateInput` + `TaskDraftModal`「推迟至」输入补全；行为——`Tasks.tsx` `isDeferred`（有效未来 + 未完成 / 未丢弃）默认隐藏，「含已推迟」开关（`kernel.ui.tasks.v1` `showDeferred`）打开后列出并显示「推迟至 …」标记（推迟行越过状态 / 时间筛选，开关是唯一闸门），计数始终排除，页脚「N 项已推迟」提示；`Calendar.tsx` 截止任务同步跳过未来推迟项。全部运行时派生，绝不落盘。
4. **日历翻周**：`Calendar.tsx` `CalendarUiState` 增 `weekCursorMs`（持久化；null = 实况）；`shiftWeek(±7)`（保持星期几 + 同步月历）+ `resetToThisWeek`；游标激活时主区为周一至周日逐日视图（范围头 + 可点日头滚动 + 事件 / 截止任务 / 课程，`mergeDayRuns` 复用、`含已结束` 沿用、空周 EmptyState），「今天 / 回到现在」在周视图禁用；迷你月历点日跳周、手翻月退出游标；默认实况视图零回归。
5. **回顾自动化**（ADR-0038）：新 `src/lib/review.ts` `useReviewScheduler`（`AppLayout` 挂载）——周一 12:00 后（当前 ISO 周）/ 每月 1 日 12:00 后（当前自然月）各触发一次，门闸：`periodKey` 已归档（任意来源）/ 数据未水合 / 会话已尝试 / 跨标签锁（`kernel.ui.review.lock.v1` TTL 120s）/ AI 离线（探活前置守卫）均跳过；取得锁后**先重新水合再复查**（防他标签窗口）；成功 → 水合 + toast「已自动生成本周 / 本月回顾 · 查看」，失败静默；**绝不自动应用建议**。
6. **迁移建议持久化 + 归档回看**：`reviewSchema` 增可选 `staleAdvice`（`staleAdviceSchema` 前移避免 TDZ）；draft 归档随报告写入 + `createReview` 经 `sanitizeStaleAdvice` 透传（非法静默丢弃）；`src/types.ts` `ReviewStaleAdvice` + `Review.staleAdvice`，`mutations.ts` `StaleAdvice` 别名 + `saveReview` 透传；`Review.tsx` 归档阅读视图「迁移建议」块（复用既有处置动作），草稿面板不变。

- [x] 修改：`server/{schemas,index}.mjs`、`src/{types.ts,lib/{data,derive,mutations,aiForm,review}.ts}`、`src/components/{CommandPalette,TaskDraftModal,HabitHeatmap}.tsx`、`src/components/shell/AppLayout.tsx`、`src/views/{Tasks,Calendar,Library,Overview,Review}.tsx`、`src/styles/{components,views}.css`、`public/guide.html`、`docs/{02,04,05,README}`、`docs/decisions/0038-review-automation.md`。
- [x] 验证：`npx tsc --noEmit` 0 error；`npm run build` 退出 0（入口 386.9 kB，无 chunk 告警）；隔离 QA（Playwright + `/api/**` 拦截，真实数据零触达）——`qa-b.py` **40/40 PASS**（10 路由 / 搜索 / 资料搜索 / 推迟 / 翻周 / 热力图，0 写请求）、`qa-ws5.py` 假时钟 **25/25 PASS**（周 / 月候选 + 同周期一次 + 既有归档零动作 + 09:10·11:29 静默·过 12:00 触发 + 离线不风暴 + 迁移建议展示）、`server-schema-check.mjs` **4/4 PASS**。
- [x] 记录：ADR-0038；`docs/{02,04,05,README}`；`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md`、`public/guide.html`。

## 体验 / 无障碍清扫 · Slice C（已完成 · 2026-10-05）

答会话交接 `.qa/SESSION-HANDOFF.md` §5 C 组（外部审计 P5 低危项）。五项修复：

1. **全局 `c` 快捷键误触**（`src/components/shell/AppLayout.tsx`）：全局捕捉此前仅以「焦点是否在输入元素」判定，忽略弹窗。当焦点落在弹窗内的按钮（如「应用 / 关闭」）时按 `c`，会误跳收件箱并打断操作。修复：命中 `c` 且存在 `[role="dialog"][aria-modal="true"]`（详情 `Modal` / 命令面板）时直接忽略；另补 `event.repeat` 过滤；延迟派发 `kernel:focus-capture` 的计时器改为 `ref` 持有 + 卸载清理。`Ctrl/Cmd+K` 行为不变。
2. **计时器清理**（`src/context/ToastContext.tsx`、`src/components/CommandPalette.tsx`）：toast 自动消失计时器按 id 存入 `Map`，手动关闭（`dismiss`）与 Provider 卸载时 `clearTimeout`；命令面板 `run()` 的 20ms 延迟动作计时器同样持有并在卸载时清理。（`inboxAi` / `organize` / `hooks` / `StatusBar` / `Trash` / 各弹窗焦点计时器审计后确认均已正确清理。）
3. **总览 AI 批量代改原子性**（`src/components/OverviewChat.tsx`）：`applyEdits` 逐条 `updateEntity`；此前第 N 条失败会留下前 N-1 条已写入的「半套修改」且仍可重试。修复：维护 `applied` 列表，异常时经新增模块级 `restoreEdits` **逆序写回 `before`** 回滚；回滚本身失败则如实 toast 剩余失败数。撤销路径复用 `restoreEdits` 并报告失败数。
4. **编辑表单初值重置**（`src/components/EntityEditForm.tsx`）：`useState` 初始化只在挂载生效，复用同一实例切换编辑对象 / 保存后回传新记录时表单显示陈旧值。修复：以 `useMemo` 计算「字段键 → `JSON.stringify` 初值」签名，变化时重置表单值；签名与无关重渲染、`fields`/`initial` 对象身份无关，故不会误清用户输入。顺带抽出 `buildValues()` 统一挂载初值与重置口径。
5. **主包分包**（`src/App.tsx`、`vite.config.ts`）：10 个视图全部改为路由级 `React.lazy`（`AppLayout` 内 `Suspense` 兜底，原仅 `Library` 懒加载）；`build.rollupOptions.output.manualChunks` 拆出 `react-vendor` / `motion-vendor` / `markdown-vendor`。入口包 **857.5 kB → 378.1 kB**（gzip **266.9 → 120.5 kB**）；`markdown-vendor`（119.4 kB）仅资料页按需载入；构建不再出现「chunk > 500 kB」告警。

- [x] 修改：`src/App.tsx`、`src/components/shell/AppLayout.tsx`、`src/components/CommandPalette.tsx`、`src/components/OverviewChat.tsx`、`src/components/EntityEditForm.tsx`、`src/context/ToastContext.tsx`、`vite.config.ts`。
- [x] 验证：`npm run build` 退出 0（`tsc -b` 通过）；Playwright 冒烟 `.qa/v76/smoke-cleanup.py`（对 `vite preview` 生产构建）**12/12 PASS**——10 条路由懒加载均渲染且 `.k-route` 有子节点、控制台 0 error；`c` 无弹窗跳 `/inbox`、命令面板（`aria-modal`）打开时停留 `/tasks`。
- [x] 记录：`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md`。（无数据模型 / 目录结构 / 端点变化，未开新 ADR。）

## 总览 AI 查阅/代改 + 解析默认 + 长图分片 + 体验修复批 · QA v73（已完成 · 2026-10-04）

答所有者批次诉求「请你为总览页面的 AI 添加一个功能……比如我现在想要了解某个日程或任务或者是资料或者笔记什么的东西，它就可以帮我回答出来，就是这一个东西的详细内容。比如说我要说改一下这个日程的某个时间，那它就会帮我改」＋「我希望在工作台点击日程的时候，它会直接弹出详情弹窗，而不是跳转到日程页面去」＋「在日程页面……添加一个显示已结束日程的功能」＋「在收信箱处……你应该呈现文字，然后附带说明这里有什么文件」＋「收信箱的 AI 需要更加智能……把时间点安排得比较好……吃晚饭……时间一般就定成 6 点……我说要去大鱼吃什么什么，那它的地点最好还是能给我显示为那个餐厅的名字……把标签给我整出来……也要让它能够知道现有的标签和项目都是什么」＋「长截图了一个 1.2M 的聊天记录 结果它阅读超时」＋追问「工作台没有显示今天的日程安排？」——三路并行实现（服务端 / 聊天+总览 / 日历+收件箱+图片）六项功能。① **总览 AI 查阅 + 代改**（ADR-0035）：见 `docs/decisions/0035-chat-lookup-edit.md`。② **工作台今日日程**：修复「只渲染已结束日程」——「现在」线下补渲染今日未结束日程；日程行点击**就地**弹 `EventDetailModal`（URL 不变、不跳转）。③ **日历「含已结束」**：agenda 头部安静 segmented（复用 `.k-lib__seg`），开启后议程流首组出现「已结束」（end < now 且未取消、按开始倒序、≤50），localStorage 记忆（刷新保持）。④ **收件箱「文字 + 附件」行**：文字与「附 N 个文件 · 文件名 · 大小」同显（B3 四项断言）。⑤ **解析默认时间/地点/活动标签**（ADR-0036 §2.1）：默认钟点表 + 用餐语境 + 地点提取 + `topic:吃饭` 活动标签、感知现有标签/项目。⑥ **长图分片**（ADR-0036 §2.2）：`src/lib/imagePreview.ts`（>400KB 切 ≤6 张 864×1600 级 JPEG、失败回退单图）+ `POST /api/inbox/:id/ai-preview?index=1..6`（RAW、派生落盘、无审计、随条目清理）+ 解析多发 file part + 超时 180s。**i-0024 数据事故**：披露与恢复见 CHANGELOG 本批次条目（修复前备份 `.qa/v73/i-0024-before-restore.json`）。

- [x] 服务端（`server/{ai,index,schemas}.mjs`）：`tryParseEntityRequest` / `resolveEntities` / `tryParseEditRequest` / `buildChatEdits`（白名单 ≤3 条 / fields ≤12 键）；`/api/ai/chat` 响应增 `focused` / `edits`；解析规则 12 默认钟点 + 地点提取 + 活动标签；`ai-preview` 端点 + 分片多发 part + 180s 超时。
- [x] 前端：`OverviewChat.tsx`（「已查阅」行 + 修改卡应用/忽略/撤销 + 持久化清洗）、`Overview.tsx`（今日未结束日程 + 就地弹窗）、`Calendar.tsx`（含已结束）、`Inbox.tsx`（附件行）、`mutations.ts`（切片上传）、`imagePreview.ts`（新）、`views.css`。
- [x] 验证：探针 `.qa/v73/probe-longimg.py` **15 项 ALL PASS**（6 片 864×1600 / 解析 5.1s / 零残留）；服务端冒烟 `.qa/v73/server-smoke.mjs` **41 项 ALL PASS**（A1 18 项单测 + A2/A3 实机查阅/代改 + A4 解析默认 + A5 ai-preview + A6 指纹）；浏览器 `.qa/v73/verify.py` **0 FAIL**（工作台 / 已结束 / 附件行 / 修改卡应用+撤销 / 390 零横溢 / console 0 / 指纹回基线）；`npm run build` 退出 0；基线增量核验 `.qa/v73/verify-baseline-delta.mjs` **与基线 `24b7252f…`（71 文件）逐字节一致**（仅两处已知差异：owner 自建 i-0027、i-0024 原文恢复）。
- [x] 记录：ADR-0035 / ADR-0036；`docs/02`、`docs/05`、`docs/README`；`public/guide.html`（子代理完成，含 2026-10-04 页脚）；`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md`。

## 总览 AI 对话 · 升级 · Slice G.1（已完成 · 2026-10-03）

答所有者「这个的 md 格式没有正常显示，然后添加一下它能联网搜索以及自由回答功能，如果我觉得回答的不错，然后对他说把你现在说的这个点整理进笔记，然后他就能将某个回答整理进笔记里面单独一个笔记」+「这个聊天框我希望圆角小一些，界面宽一些大一些，上下长度也长一些」——在 Slice G 的只读对话盒之上做四项升级。① **Markdown 渲染**：助手回复改 `react-markdown`（`<div className="k-chat__text k-chat__md">`，沿用 Library 同款 import，**无 `dangerouslySetInnerHTML`**），用户轮保持纯文本；`.k-chat__md` 全套 token-only 样式（p / ul / li / strong / code / blockquote / hr / h1–h4）。② **尺寸调整**（token-only）：`.k-chat__thread` max-height 320→**560px**（≤640px 容器 420px）、圆角 → `var(--radius-inner)`（12）；消息 max-width 88%→**94%**；正文 13→**15px**；composer 圆角 → 12（`.ic-composer.k-chat__composer` 覆盖）；输入 min-height 30→**44px**（max 180）。③ **联网搜索 + 自由回答**：`buildChatSystem` 重写为三类——读库事实（依据摘要、不编造用户数据）/ 一般知识自由回答 / 需要外部事实时**只输出 JSON** `{"searchQueries":[...]}`（≤2 条、≤60 字、含年份；一次对话最多请求一次检索）；`chatWithKernel` 两阶段：模型请求 → 复用 N9 `buildSearchSection`（Sogou→360→Bing + 相关性过滤 + 首条页摘录）→ 同会话回喂正式作答；**检索失败** → 让模型保守作答并注明无法确认最新信息；响应新增 `searched: string[]`；前端助手轮下方显示安静行「已联网检索 · q1 · q2」；`tryParseSearchRequest` 导出供单测；提示行改「读库 · 联网 · 自由回答 · Enter 发送 · Shift+Enter 换行」。④ **整理进笔记**：对话式——用户消息命中意图正则（整理/保存/存/归档 + 进/到/为/成/入 + 笔记）且存在上一条助手回答时，调 `POST /api/ai/chat/note {instruction, answer}`（`chatNoteRequestSchema`：instruction ≤400 / answer ≤8000）→ `draftChatNote`（AI 出 `{title ≤40, body markdown}`；**失败 / 解析失败回退确定性**：首行标题 + 原文正文，绝不抛错）→ 服务端 `commit('notes', …, note.create, detail.via:'chat.note')` → 助手轮「已整理为笔记：**「title」**」+「打开笔记」链接（`/library?note=`）；每轮助手回复下另有「存为笔记」安静按钮（同端点），失败走既有错误条。**边界**：对话本身仍**不落盘无审计**（检索同 N9 纪律）；笔记落盘可撤销（回收站）；一次对话最多一次检索；「这个点」= 上一条回答（更早引用不支持）。**实测**：搜索问答 24.5s（`searched` 2 条）→「笔试 12月12日 9:00–11:20 · 口试 11/21–22 · 报名」并自动对照本库任务 `t-0008`；读库问答 7.5s 无检索引真实数据；笔记 `n-0004`「2026 年英语四级考试时间与报名安排」301 字落盘 + 清理。

- [x] `server/{ai,schemas,index}.mjs`：三类 `buildChatSystem` + `chatWithKernel` 两阶段（请求 → N9 检索 → 回喂）+ `searched`；`chatNoteRequestSchema` + `draftChatNote`（AI 出标题/正文 + 失败确定性回退）；`POST /api/ai/chat/note`（`note.create` · via:'chat.note'）。
- [x] 前端：`src/components/OverviewChat.tsx`（Markdown 渲染 / 尺寸 / 检索行 / 意图路由 / 「存为笔记」按钮）、`src/lib/mutations.ts`（`chatWithAi` 返回 `searched`）、`src/styles/views.css`（`.k-chat__md` + 尺寸 token）。
- [x] 验证：`.qa/v72/` 服务端 **25 PASS** + 浏览器 **25 PASS** = **50 PASS · 0 FAIL**（单测 6 组 / 真搜 + 真库 + note + 空指令 400 / markdown 元素与字面 `**` 为 0 / computed 12px·560px·44px / 对话式与按钮双路径 / UI 搜索 12月12日 / 390 零横溢 / console 0）；**零残留**（53 文件哈希基线 == 终态、`tags.json` 不变、notes 回到 n-0001..n-0003）；探针 `.qa/probe-g1/`。
- [x] 记录：ADR-0010 修订节；`docs/02`、`docs/README`；`public/guide.html`；`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md`。

## 产品展示页 · showcase.html（已完成 · 2026-10-03）

答所有者「把我这个程序的每个部分都截图，弄成一份 HTML 展示产品用，我要发给其他人看我这个产品」——新增**产品展示页**（单文件自包含）——base64 内嵌 **15 张真实界面截图**（总 2.70 MB → HTML **3.62 MB**；10 个模块 + 命令面板 + 任务详情弹窗 + AI 处置卡（日程 + 任务双动作）+ 移动端 ×2；JPEG q78 · 2x DPR）；**零外部请求 / 零字体外链**，双击 file:// 即可打开、可直接作为单个文件转发；暗色 token 与 `guide.html` 同族（Hero → 锚点导航 01–12 → 模块章节（描述 + 特性 bullet + 截图 + 图注）→ 技术一览 6 条 → 页脚「v0.5.0（切片）· 截图于 2026-10-03 · 本机真实数据」）；文案写实克制、无 emoji。构建脚本 `.qa/showcase/build.py`（Playwright；可重跑再生成：重新截图 → 重新组装 → 自验 file:// 载入 console 0 / `img` 15/15 `naturalWidth>0`）；一次性展示条目（面试通知）仅用于 AI 卡截图、用后即清；构建前后 `data/**/*.json` 哈希一致（`bd821687…`，排除 activity.jsonl）零残留。**注意**：截图取自本机真实数据（可能含少量人名 / 项目信息），对外分发前自行确认。

- [x] `.qa/showcase/build.py`（截图 + 组装 + 自验一体）+ `.qa/showcase/shots/**`（15 图）+ `.qa/showcase/showcase-check.png`（自验截图）。
- [x] 产品展示页（3.62 MB 单文件；`/showcase.html` 亦可访问）。
- [x] 验证：自验全绿；零残留（哈希回基线）。
- [x] 记录：`CHANGELOG.md`、`TASK_BOOK.md`。

## 收件箱 AI · 事件识别 · Slice N10（已完成 · 2026-10-03）

答所有者「但是类似于学生组织第二轮面试、例会、考试、约谈，我丢进了收信箱，并没有给我划分为事件，而是任务」——此前 AI 动作只有 `task / note / resource / project` 四类，定点安排被一律压成任务。本切片新增**第 5 类动作 `kind:"event"`（日程 / 事件）**：会在某个时刻「发生」的事（面试 / 会议 / 考试 / 约谈 / 活动）→ `event`（`startAt` ISO8601 带时区必填、明确结束时间才填 `endAt`、只有日期 → `allDay:true`、带 `location`）；「需要去做」的动作 → `task`；同一内容可同时产出 event + task（发生的事 + 要做的准备），不重复拆条。判定写进提示词**规则 12**（`buildSystem`）：**时间无法明确推出就不产 event**（宁可 task + facts）；文件条目（非图片）仍只产 resource（禁止列表加 `event`），截图条目走文本管线可用。管线：`aiActionKind` + `'event'`、`aiActionSchema` + `startAt/endAt/allDay/location`；`postValidateActions` event 清洗（`startAt` 无效 / 缺失**丢弃该动作**、`endAt` 须 ≥ startAt 否则删除、`allDay` 仅 true 保留、`location` trim ≤60、非 event 动作一律剥离这些字段、`linkToNewProject` 放行）；apply event 分支落 `events`（对齐 `POST /api/events`：**无 createdAt/updatedAt**、`status:'confirmed'`、纵深校验、`projectId`/`areaId` 挂接、`via:'inbox.apply'`），撤销走通用 `linkedIds` → `remove('events')`，**顺带修复 `kindOfId` 缺 `e-` 映射**（此前事件无法经该链路清理）。前端：`AiActionKind` 增 `'event'`；`ACTION_FIELD_MATRIX.event` = 标题 / 开始 / 结束 / 地点 / 项目 / 区域 / 标签；`AiSuggestionForm` 渲染 开始 / 结束（datetime-local）+ 地点（text）；`AiActionsCard` `KIND_LABEL.event = '日程'`。边界：`condition` / `contexts` 不适用 event；`repeatRule` 不做（重复事项仍用课程）；无 schema 迁移、无新依赖、无新端点。

- [x] `server/{ai,schemas,index}.mjs`：第 5 类动作 + 规则 12 + `aiActionSchema` 事件字段 + `postValidateActions` 清洗 + `applyInboxActions` event 分支 + `kindOfId` 补 `e-` 映射（撤销经 `linkedIds` 清理事件）。
- [x] 前端：`src/types.ts`（`AiActionKind` + `'event'`）、`src/lib/aiForm.ts`（`ACTION_FIELD_MATRIX.event`）、`src/components/{AiSuggestionForm,AiActionsCard}.tsx`（datetime-local / 地点 / 「日程」标签）。
- [x] 实测（真实 AI）：投递「10月7号晚上7点到11点，在某教室进行学生组织第二轮面试」→ event「学生组织第二轮面试（我任面试官）」`startAt=2026-10-07T19:00:00+08:00` / `endAt=23:00` / `location=某教室` / `projectId=p-0002` + task「提前十分钟到场（学生组织面试）」due 18:50；apply → `e-0001`，unapply → 归零。
- [x] 验证：`.qa/v71/` 服务端冒烟 **35 PASS** + 浏览器 **24 PASS** = **59 PASS · 0 FAIL**（6 组 `postValidateActions` 单测 + live parse / apply / unapply + UI「日程」pill + 可编辑字段 + 撤销往返 + 390 零横溢 + console 0）；**零残留**（45 文件哈希基线 == 终态、`tags.json` 不变）；探针 `.qa/probe-n10/`。
- [x] 记录：ADR-0034；`docs/02`、`docs/README`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

## 日程聚合 · Slice H3（已完成 · 2026-10-03）

答所有者「日程页怎么不显示任务以及课表等内容，这些也是需要做的日程啊」——日历页从「只看事件」升级为**三类聚合**：① **今日课程**——按「星期 + 学期第几周」过滤并合并连续节次（复用 `mergeDayRuns`），议程流顶部独立区块（节次 + 课程 + 地点；点击开 `CourseDetailModal`）；未设学期不按周过滤（与 `/timetable` 同口径）。② **任务截止**——有 `dueAt` 且未完成 / 未丢弃的任务按截止时间归 今天 / 明天 / 本周 / 下周 / 更远 桶（**逾期落今天**），行内「截止 HH:mm」、meta 显示项目名（点击开 `TaskDetailModal`）。③ **联动**——bar「今日 N 节课 · M 项截止」；迷你月历「有安排」圆点 = 事件 ∪ 截止 ∪ 有课；月统计 = 事件 + 截止 + 课次（foot「事件 E · 截止 T · 课程 C」）；hero 空事件时提示今日课程 / 截止；空态仅当三类全空；「今天 / 回到现在」禁用条件随三类收敛。边界：无截止任务不显示；课程仅「今日」（全周网格仍在 `/timetable`）；前端单文件改动、无服务端改动、无新依赖。

- [x] `src/views/Calendar.tsx`（唯一文件）：`dueTasks` / `todayRuns` / `bucketKeyOfDate` / 桶 `{events, tasks}` / 今日课程块 / 任务行 + `taskRefs` / `CourseDetailModal` + `TaskDetailModal` / 月历圆点 / 月统计 / bar / hero / 空态。
- [x] 验证：`.qa/v70/verify-h3.py` **21 PASS · 0 FAIL**（确定性一次性任务 + 课程：两行可见、双弹窗可开、圆点「is-today is-event」、月统计「事件 0 · 截止 6 · 课程 70」、bar「今日 1 节课 · 1 项截止」、390 零横溢、指纹回基线、console 0）。
- [x] 记录：`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md`、`public/guide.html`。

## 项目详情 · 状态快捷切换 · N8.2（已完成 · 2026-10-03）

答所有者追问（截图圈出「暂停 / 将来」两个空区块「关于这两个有回复吗」）→ 选定方案 B：项目详情弹窗新增**状态快捷切换**（与日程同款安静 segmented，复用 `.k-lib__seg` 轨道 + `TagPill` 选中反转）——4 枚 chip「进行中 / 暂停 / 将来 / 已完成」**一点即保存**（`updateEntity` 写 `status`，项目随即移动分组），toast「状态已设为「X」」+ **撤销**回原状态；「已归档」仍走编辑表单（不在项目页显示）；提示行「点选即保存 · 可撤销；『已归档』在编辑表单中设置」。`ProjectDetail` 增可选 `onSetStatus`（缺省不渲染），写入 / 撤销由 `ProjectDetailModal` 的 `handleSetStatus` 注入（项目页与总览就地弹窗同源生效）。无新增样式 / 端点 / 依赖。

- [x] `src/components/ProjectDetail.tsx`（`onSetStatus` + `StatusSegmented`）。
- [x] `src/components/ProjectDetailModal.tsx`（`handleSetStatus` + 注入）。
- [x] 验证：`.qa/v69/verify-n82.py` **17 PASS · 0 FAIL**（4 chip / 暂停 toast + 撤销往返 / 将来→已完成→进行中依次落盘 / 幂等 / 390 零横溢 / 清理后快照与 data 指纹回基线 / console 0）；证据 `.qa/v69/`。
- [x] 记录：`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md`、`public/guide.html`。

## 收件箱 AI · 联网检索 · Slice N9（含 N9.1 加固）（已完成 · 2026-10-03）

答所有者「我输入了准备一下今年的四级考试，它应该自行去搜索今年四级考试什么时候，作为截止日期；搜索能力需要具备上」。① **两阶段检索**：解析输出新增顶层 `searchQueries`（≤2 条、每条 ≤60 字，模型主动请求）→ 服务端先经 **Sogou 主 → 360 次 → Bing 备** 三引擎链检索 → 结果**回喂同一会话**做第二轮（补全 `dueAt` / `facts`），第二轮失败沿用首轮；响应新增 `searched`（实际执行问题）；流式先发 `{kind:'status',status:'searching'}`、前端阶段「正在联网检索…」。② **引擎链与过滤（N9.1）**：每引擎结果经**相关性令牌过滤**（CJK 二元组去通用词 + 拉丁词；不含任何检索词的泛化 / 限流结果视为该引擎失败并换下一引擎；全失败返回空、模型保守不编造）；每条成功问题**补抓首条结果页正文摘录**（≤900 字，复用 N2 `fetchLinkExcerpt`）。③ **注入与纪律**：段落「【联网检索】（…只可据此修正时间与事实，不得编造）」；固定引擎主机、12s 超时、≤5 结果 / 问、snippet ≤300 字、段落 ≤2600 字；**不落盘、无审计**、失败静默降级。④ **边界**：仅文本 / 截图条目（文件 = 资料归一化路径不触发）；限流时保守失败（安全优先）；不抓多页 / 不做 JS 渲染。⑤ **实测**：「准备一下今年的四级考试」→ 检索 2 问（如「2026年下半年 全国大学英语四级考试 时间」）→ 任务 `dueAt=2026-12-12T09:00:00+08:00`、`facts` 含「笔试 12 月 12 日 9:00–11:20 · 口试 11 月 21–22 日 · 报名入口 cet-bm.neea.edu.cn」、18.2s；N9.1 修复复验 `.qa/v68/logs/reverify.log` 15 PASS · 0 FAIL（同步 / 流式均 `searched≥1` 且 `dueAt=2026-12-12`）。

- [x] 服务端：`server/ai.mjs`（`searchQueries` 契约 + 三引擎链 + 相关性过滤 + 首条页摘录 + 第二轮回喂 + `buildSearchSection`）。
- [x] 前端：`src/views/Inbox.tsx`（阶段文案「正在联网检索…」）；流式 `searching` 状态帧。
- [x] 验证：见上；证据 `.qa/v68/`（`REPORT.md` / `logs/reverify.log` / `fixtures/sogou-sample.html`）+ `.qa/probe-search/`（probe4 / probe5）。
- [x] 记录：ADR-0033；`docs/02`、`docs/README`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## 项目「AI 整理」· 智能升级 · N8.1（已完成 · 2026-10-03）

答所有者「把能规划的任务都规划一下项目区分，AI 要够智能，体现在分类标准与规则设定」+「自行判断是不是需要建立新项目来收纳相关任务」。① **分类标准 v2**（`buildOrganizeSystem`）：三分类——【A 归并到现有项目】须**具体归属关系**（同课程 / 同活动赛事 / 同组织的一件事 / 同委托方 / 同一人的同一事务 / 或它是项目完成定义里的一步；仅「领域相近」不算）、【B 建议新项目】≥2 条同一件多步事务，**单条**候选若明确多步事务可自行判断单独立项（须 `outcome` + `reason`）、【C 不规划】单步事务正确不输出；目标「不漏、每条建议可核对 `reason`、不硬塞」，含正 / 反例。② **限额与门槛**：assignments 5→**8**、clusters 3→**5**、新项目簇 **≥2** 成员（`ORGANIZE_MIN_CLUSTER_ENTRIES = 2`）、单条任务成簇门槛 = 非空 `outcome` + `reason` ≥6 字；确定性兜底仍 ≥3 条、不造单条。③ **响应 / UI**：新增 `unplanned`（未纳入候选数），卡片显示「另有 N 项未纳入规划（单项事务或联系不足）」；schema 上限同步（draft / apply / unapply：8 / 5）；digest 占位完成定义（空 / 「完成定义待整理」）显示「（未填写，参考标题与标签判断）」。④ **附带**：项目状态编辑表单增「判断标准」hint（`EntityEditForm` 支持 `hint` + `.k-field__hint`）。⑤ **实测**：真实 t-0003 → 单独立项「Python 5 日速成」（`unplanned=1`）；QA v68 服务端单测（单条门槛 / ≥2 / 截断 8 / 5 / claimed 去重 / `unplanned + covered === candidates`）与浏览器全过。

- [x] 服务端：`server/ai.mjs`（`buildOrganizeSystem` 三分类 + 限额 + 单条门槛 + `unplanned`）、`server/schemas.mjs`（draft / apply / unapply 上限 8 / 5）。
- [x] 前端：`src/components/{OrganizeProposalCard,ProjectDetailModal,EntityEditForm}.tsx`、`src/styles/views.css`（`.k-field__hint`）。
- [x] 验证：见上；证据 `.qa/v68/`。
- [x] 记录：ADR-0032 §7；`docs/02`、`docs/README`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## 项目「AI 整理」· Slice N8（已完成 · 2026-10-03）

答所有者「在项目页加一个 AI 整理功能：把现有的任务整理进高度相关的已有项目；剩下的相关任务建议新建项目；并且每天中午 12 点后自动跑一次」。① **服务端（只读草稿 + 一次写入 + 精确撤销）**：`POST /api/ai/organize/draft`（无 body）候选 = 无 `projectId` 未完成任务 + 未澄清收件箱（≤50），确定性预分组提示 + AI **两阶段按候选编号引用**（模型无法编造 id，抗幻觉由构造保证），后校验（归并 ≤5 条 / 每条 ≤10 任务；新项目簇 ≤3 个、≥3 成员、须含任务、标题不与现有项目冲突、`areaId` 真实存在、标签优先复用），未覆盖的预分组以确定性兜底簇补齐；`POST /api/projects/organize-apply`（201；服务端重校验 + 存在性 / 状态 / 打开态）归并**只写任务文件**（目标项目文件不动）、逐簇建项目并归入、单簇失败不中止整批、审计 `via:'organize'`，空有效项 → 400「没有可应用的整理项」；`POST /api/projects/organize-unapply` 项目经 `clusterTaskIds` 入回收站 + 任务 `projectId` 清空（审计 `organize-unapply`）。② **前端**：`src/lib/organize.ts`（模块 store `kernel.ui.organize.v1` 跨刷新保留提案 / 上次运行日 / 在途态；`runOrganizeNow` 手动；`useOrganizeScheduler` 每日调度；跨标签锁 `kernel.ui.organize.lock.v1` TTL 120s + 会话守卫；**只调草稿、绝不自动应用**）+ `OrganizeProposalCard`（两段「归并到已有项目」/「建议新项目」、逐行勾选默认全选、排除行 `.is-excluded`、页脚「全部应用（K 项）」/「重新整理」/「忽略」、空态「今日整理已完成 · 暂无待确认建议」）+ `Projects` 工具条 `.k-projects__organize`「AI 整理」/「整理中…」+ toast「已整理 N 项 · 撤销」+ `AppLayout` 挂载调度器（**12:00 后每日一次**、30s tick + focus / visibility 补跑、过午打开即补跑、AI 离线静默跳过）。③ **边界**：调度只出草案、应用仍需用户确认（全站「先确认后写入」纪律不变）；护栏失败返回泛化 400（细节在 `errors`，UI 不展示）；任务软删除走 `POST /api/tasks/:id/trash`。QA v67 服务端冒烟 **47/47** + 浏览器 **39/39** = **86 PASS · 0 FAIL**；零残留（37 文件字节一致，manifest SHA256 `3403f2a9…`）；无新增依赖、无数据模型变化；证据 `.qa/v67/`。

- [x] 服务端：`server/{schemas,ai,index}.mjs`（三端点 + `draftOrganize` / `postValidateOrganize` / `fallbackOrganizeClusters` + `organizeApply` / `organizeUnapply`）。
- [x] 前端：`src/lib/organize.ts`（新）、`src/components/OrganizeProposalCard.tsx`（新）、`src/views/Projects.tsx`、`src/components/shell/AppLayout.tsx`、`src/lib/mutations.ts`。
- [x] 验证：见上；证据 `.qa/v67/`（`REPORT.md` / `server-smoke.mjs` / `verify-n8.py` / 数据指纹 + 截图）。
- [x] 记录：ADR-0032；`docs/02`、`docs/05`、`docs/README`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## 桌面启动器 · N7.1（已完成 · 2026-10-03）

答所有者「做一个启动器软件，放置在桌面，点击后会出现软件，点击可以直接打开浏览器弹出对应界面」——新增 `启动器.hta`：单文件 Windows 原生窗口（mshta 引擎 + JScript，零依赖；UTF-8 BOM + 中文全 `\uXXXX` 转义）；状态机「未启动 → 启动 KERNEL（隐藏拉起 dev；`WshShell.Run` 不返回 PID → PowerShell CIM 按 `dev.mjs` 解析真实 PID 写 `%TEMP%\kernel-launcher.pid`）→ 已就绪（自动打开浏览器一次）→ 停止服务（taskkill /F /T）」；常驻「创建桌面快捷方式」；90s 超时回退「用 启动.cmd 查看日志」；`KERNEL_HTA_SELFTEST` 自检钩子（mshta 实测：JScript 全量解析、中文路径 decode、内置 runtime 识别全部正确）。桌面快捷方式 `KERNEL 启动器.lnk` 已创建并字节级核验；分发包同步收录（扫描扩展 `.hta`；重建 16,290 条目 / 127 MB）。QA v65 全绿（包内自检 `NODE=<pkg>\runtime\node.exe` + `BUNDLED_OPENCODE=true`；zip 字节一致；隐私 0 命中）。已知边界：zip 内 CJK 文件名 GBK 字节存储（中文 Windows 正常；非中文区第三方解压工具可能乱码）；「点击→启动」真实链路由所有者实机体验。证据 `.qa/v65/`。

- [x] `启动器.hta`（新）+ 桌面快捷方式（已创建）。
- [x] 打包器（收录 + `.hta` 扫描）、`README.md` 更新。
- [x] 验证：QA v65（见上）；证据 `.qa/v65/`。
- [x] 记录：`CHANGELOG.md`、`AGENTS.md`。

---

## 分发包 + 启动页 · Slice N7（已完成 · 2026-10-03）


- [x] 打包器（新）+ `scripts/assets/welcome.html`（新）；`scripts/{dev,launcher,spawn-bg}.mjs`、`启动.cmd`、`package.json`（包内去 seed）。
- [x] 验证：见上；证据 `.qa/v64/`（含 `package-check.py` / `package-REPORT.md` / welcome 截图）。
- [x] 记录：ADR-0031；`docs/05`；`docs/README`；`CHANGELOG.md`、`AGENTS.md`。

---

## 回顾人话化 · Slice N6（已完成 · 2026-10-03）

答所有者「周回顾、月回顾目前版本的回答非常僵硬，全是系统层面的回答……我需要的是比如『这周完成的内容比上一周多，质量也比较高，充满干劲的一周』这种回答之类的，而不是一堆专业名称」。根因：digest 直接喂原始审计动作名（`course.create ×12`）+ 规则强制「绝对值带对比基准（基准 0）」括号文风 + 七段标题公文腔。修复：① 活动行中文映射（录入课程 ×12 / 新增标签 ×8 / 调整课程 ×3 / 设置学期 ×1；未知聚合为「其他整理操作」）；对比行改「与上次对照（同等已走时长）：完成 X 件（上次 Y 件）· …」（**保留全部原始数字**供数字护栏）；② 提示词角色改「复盘搭档 · 真诚口吻」——说人话、有温度、情绪与主观判断须邻句事实支撑；七段标题友好化（这周怎么样/干了些什么/和上周比/哪里卡住了/值得保持的/接下来/需要留意的；月版对应）；禁词扩充（基准/环比/同比/WIP/水位/收口/审计/字段/schema/英文点号动作名）；弱/强例重写；③ 分节别名新旧双收录（旧归档归一渲染）；④ 数字护栏核验：同指标两期差值派生已覆盖，无需扩展。QA v63 **26/26**：真实周回顾 322 字（七段新标题齐全·禁词 0·指针「接下来：见决策区（2 条）」在位·首段「开了个好头，但还只是个开头——」）+ 真实月回顾 423 字同断言；旧归档 rev-0001 阅读视图 7 分节回归；净零清理；证据 `.qa/v63/`。

- [x] `server/ai.mjs`：`humanizeActivityCounts` + `buildReviewDigest` + `buildReviewSystem` + `REVIEW_SECTION_ALIASES`。
- [x] `src/lib/reviewReport.ts` + `src/views/Review.tsx`：别名与文案同步。
- [x] 验证：见上；证据 `.qa/v63/`（含 draft-weekly/monthly 全文）。
- [x] 记录：ADR-0013 §7（修订）；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## AI Key 本地配置 + 启动器 · Slice N5（已完成 · 2026-10-03）


- [x] 服务端：`server/secrets.mjs`（新，无副作用/原子写/静默容错）+ 两端点 + 审计。
- [x] 前端：Settings「AI 集成」Key 块 + hooks/mutations。
- [x] 启动器：`启动.cmd` / `launcher.mjs` / README / `.gitignore` / `dev.mjs` 注入。
- [x] 记录：ADR-0030；`docs/02`；`docs/README`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## 来源摘要 · Slice N4（已完成 · 2026-10-03）

答所有者「这个关联的是我原始输入文本，但是我在确认执行 ai 建议后原始输入文本就没了，这个关联有意义吗」→「B（关联截断）+ 为输入收件箱的内容简单总结一下……不要 i-1234 这样子冷冰冰的说辞」。① **解析产出 `summary`**：收件箱 AI 解析（同步+流式）新增一句话摘要（≤40 字、单行、「 · 」分隔、含关键时间/事项；`cleanSummary` 折叠空白/去引号/硬截断；解析仍零写入）；② **apply 落档**：`POST /api/inbox/:id/apply { actions, summary? }` 写条目 `summary`（撤回/恢复删除；旧调用兼容）；③ **引用人话化**：任务详情「来源条目」显示摘要（缺失降级内容折叠截断 ~90 字）——关联芯片一律去可见编号（入 tooltip）；收件箱「已澄清」区显示产物**标题**（解析不到回退 id）。QA v61 冒烟 **25/25**（真实摘要恰好 40 字 / apply 落档与撤回清除 / 旧兼容 / probe-n2 23/23 + probe-h1 19/19）+ E2E **24/24**（关联显示 `QA 摘要 · 10/7 面试` 且无可见 `i-`；降级 91 字截断；产物标题 `QA N4 产物任务`）；三重哈希逐字节一致；证据 `.qa/v61/`。

- [x] 服务端：`summary` 指令 + `cleanSummary` + 双路径 + apply 落档 + schema。
- [x] 前端：类型/透传 + `condenseContent`/`titleOfId` + 芯片去编号 + 已澄清标题化。
- [x] 记录：ADR-0029（已回填）；`docs/02`；`docs/04`；`docs/README`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## 窄屏折行修复 + 第二次清零 · N3.1（已完成 · 2026-10-03）

答所有者「帮我把数据全清空，包括历史，我要从零体验」：① 运维——`node scripts/reset.mjs --yes` 第二次清零（实体 20 · 回收站 2 · 附件 1 · 审计 192 行；备份 `.qa/backups/data-20261003-152819`；标签重置 / 学期删除 / config 保留）；服务重启后 `/api/snapshot`、`/api/trash`、`/api/activity`、files 目录四重归零复验。② 清零随用随验暴露真缺陷——390 宽 `/inbox` 文档级横溢 **160px**（长 URL / 长文件名条目的 `.ic-row__title` 无折行点，块盒不膨胀但滚动溢出区膨胀；元素矩形扫描无果、`scrollWidth>clientWidth` 扫描定位）；修复 `.ic-row__title { overflow-wrap: anywhere }`（一行 + 注释）。③ 复验：390 横溢 160→**0**、1440 → 0、真实数据（含 URL / 长文件名）下 **10 路由 × 2 视口横溢全 0 · console error 全 0**；`/timetable` 零数据空态（「未设置学期」提示）正常。④ 巡检脚本修订：过期「日历课表模式切换」断言（Slice H2 已把课表迁出为一级页）→ `/timetable` 独立页断言 + 路由覆盖。

- [x] `src/styles/views.css`：`.ic-row__title` 增 `overflow-wrap: anywhere`。
- [x] 运维：清零 + 服务重启 + 四重归零复验。
- [x] 验证：见上；证据 `.qa/v60/`（含 `check-overflow-390.py` 定位脚本与 `REPORT.md`）。
- [x] 记录：`CHANGELOG.md`、`AGENTS.md`。

---

## 并行解析 · Slice N3（已完成 · 2026-10-03）

答所有者「ai解析改成能并行的，只要及时处理完成的opencode会话就行了，不然我丢快点，跑一半的ai解析全断了」。根因：全局单令牌 + 单面板——任一新解析自增令牌即令所有旧解析的 UI 回调失效、面板被接管（HTTP 流本就未断、迟到结果会入缓存，但无每条目可视状态）；批量与多文件投递为严格顺序。重构为**每条目独立 job 的并行调度器**：每 id 令牌（新解析只取代同一 id 的在途结果）+ 分桶增量缓冲（共享 ~100ms 节流）+ FIFO 队列 + **并发上限 3**（完成自动进位）+ 批量完成驱动进度（`done/total`）+ `clearInboxAiJob` 按条清理；N0.9 语义完整保留（唯一作废 = 显式忽略；收起/切页/被接管不丢结果）。多文件投递通用条目 `Promise.all` 并行（课表类仍顺序）。服务端专项审计：**零全局锁、每解析独立 opencode session → 零改动**（唯一串行是写盘 `writeChain`，不挡解析）。

- [x] `src/lib/inboxAi.ts`：jobs Map 快照 + `itemTokens` + FIFO/`AI_PARSE_CONCURRENCY=3` + sentinel（GONE/SUPERSEDED）+ `clearInboxAiJob`（取代全局清空）+ reconcile 清 job。
- [x] `src/views/Inbox.tsx`：面板按 `jobs.get(id)` 派生、「解析中…」按条显示、批条「已完成 done/total」×2、上传流并行、5 处调用点按条清理。
- [x] 验证：QA v59 **26/26**（3 条同显解析中·完成序 C→B→A·各卡各 payload；重解析接管；批量 0/4→4/4 墙钟 4.23s ≪ 顺序下界 8s；真实连发两条双「AI 建议就绪」13.4s 未断）；`tsc --noEmit` 0 + build 0；零残留（filesHash 与 v57 基线逐位一致）；证据 `.qa/v59/`。
- [x] 记录：ADR-0028；`docs/02`；`docs/README.md`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## 链接阅读 + 粘贴截图 · Slice N2 / N2.5（已完成 · 2026-10-03）

答所有者「目前程序能阅读图片和链接吗」：图片早已可读（N0 · file part）；裸 URL 实测只能分类、不能读正文（模型明说「内容未能自动读取」）。① **链接阅读（N2，系统首次出站抓取）**：文本条目含 http(s) 链接 → 解析前在数据服务抓取**首个**链接正文注入上下文 → 简介基于实际内容撰写；`resource.url` 端到端（`aiActionSchema.url` ≤2000 → apply 持久化 `record.url` → 建议卡「链接」字段可编辑 → 资料详情可点链接行）。约束：私网 / 环回 / 链路本地拒抓（**不发请求**）、8s 超时、2MB 流式截断、html/xhtml/plain、charset 探测（GBK 回退）、正文 ≤8000 字；失败回退「按链接保守处理」不阻断解析。② **粘贴截图（N2.5）**：收件箱页 window 级 Ctrl+V——剪贴板图片 → preventDefault + `粘贴截图-<时间戳>` 命名入待上传队列（与拖拽同通路）；纯文本不拦截；监听仅 Inbox 挂载期。

- [x] 服务端（`server/{ai,schemas,index}.mjs`）：`extractFirstUrl` / `fetchLinkExcerpt` / `htmlToArticleText` / `buildLinkSection` / `applyLinkUrlFallback` + 提示词字段与规则 + apply 写 `url`。
- [x] 前端（`src/views/Inbox.tsx` / `src/lib/{mutations,aiForm}.ts` / `AiSuggestionForm.tsx`）：粘贴截图；「链接」字段；资料详情链接行既有无需改。
- [x] 验证：v57 冒烟 **16/16**（真实抓取 example.com → 简介基于正文 / 失败回退含「抓取未成功」 / 内网拒抓）+ E2E **9/9**（链接字段编辑 → 落库 → 详情链接）；v58 **10/10**（合成粘贴 chip `粘贴截图-…png` / 纯文本 dispatch 返回 True 未拦截 / 390 无横溢）；探针 `.qa/probe-n2/` 23/23 + probe-h1 回归 19/19；零残留（filesHash 前后一致）；证据 `.qa/v57/`、`.qa/v58/`。
- [x] 记录：新增 ADR-0027；`docs/02`；`docs/04`（§4.9 注记）；`docs/README.md`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`（含 §8 出站抓取纪律）。

---

## 收件箱来源图标挤压修复 · N0.10（已完成 · 2026-10-03）

答所有者截图「按钮被挤压变形都不一样了」：行内来源图标徽标 `.k-source-icon` 缺 `flex-shrink: 0`——长文本行（i-0005，内容基准宽度大）的 flex 收缩按比例分摊到徽标，**DOM 实测被压到 7.7px**（内嵌图标同缩 7.7px），而短文行（i-0004）仍 26px，两行观感不一致。修复：固定尺寸徽标不参与收缩（一行 CSS）。复测：长 / 短文本行徽标均 **26×26 · 图标 13px**；`npm run build` 退出 0；只读；证据 `.qa/v56/diag-source-icon.py` + `n010-row-*.png`（3×）。

- [x] `src/styles/views.css`：`.k-source-icon { flex-shrink: 0 }` + 注释。
- [x] 验证：DOM 复测（i-0005 7.7→26；i-0004 保持 26；图标 13）；3× 行截图目视一致；构建 0。
- [x] 记录：`CHANGELOG.md`、`AGENTS.md`。

---

## 解析状态跨页存活修复 · N0.9（已完成 · 2026-10-03）

答所有者「AI 解析进行一半切换页面就消失不见」。复现矩阵（`.qa/v56/repro-matrix.py`）对照：场景 B（解析中「收起」→ 展开 → 90s）＝**面板清空且结果永久丢失**（与截图状态一致）；场景 A（解析中切页 45s 穿越完成 → 回）＝正常出卡。根因：`toggleExpand` 对单条解析调 `clearInboxAiActive()` → `activeToken++` → 完成后按 stale 直接 return，**不入缓存**。修复：① 收起 / 展开**纯视图切换**（绝不动解析态与在途请求）；② 纵深防御——stale 完成结果未被显式忽略、无同 id 新解析接管、条目仍在未澄清 → **仍写入建议缓存**（`dismissedIds` 显式作废集：忽略登记、新解析撤销、条目离场清理）。`npm run build` 退出 0；复验 `.qa/v56/verify-n09.py` **B′/C′ 全 PASS**；只读零写入。

- [x] `src/views/Inbox.tsx`：`toggleExpand` 视图化（清理由显式动作触发：忽略 / 应用 / 条目离场）。
- [x] `src/lib/inboxAi.ts`：`dismissedIds` + `parseItem` stale 兜底缓存 + reconcile 清理。
- [x] 验证：B′（收起→展开→现场恢复→12s 出卡）；C′（i-0005 解析中切去解析 i-0004 → i-0005 迟到结果入缓存，「AI 建议就绪」亮起）；场景 A 回归（切页穿越完成出卡）。
- [x] 记录：`CHANGELOG.md`、`AGENTS.md`；backlog 增「spawn-bg 日志为空」。

---

## 总览「习惯打卡」条修复 · N0.8（已完成 · 2026-10-03）

答所有者截图反馈（零习惯时该条布局崩坏：「今日打卡」被长文本挤成竖排、与点阵/缺口叠挤）。① **零习惯空态**：无任何习惯时渲染「还没有习惯 · 去设置创建」（可点深链 `/settings?section=habits`），不渲染按钮 / 点阵 / 缺口，连击数显示安静「—」；② **布局硬化**：操作行按钮 `flex-shrink:0 + white-space:nowrap`、缺口文案侧 `overflow-wrap:anywhere`。`npm run build` 退出 0；QA **29/29**；零残留（24 文件哈希一致）；证据 `.qa/v55/`。

- [x] `src/views/Overview.tsx`：习惯条按 `streak.habitId === null` 二分渲染（空态 / 有习惯原有结构）。
- [x] `src/styles/components.css`：`.k-streak__actions > .k-btn` 硬化 + 新增 `.k-streak__empty` / `.k-streak__link`（token-only）。
- [x] 验证：`.qa/v55/verify-n08.py` **29/29**（空态文案与深链 / 真实创建→打卡（`0 天 → 1 天` + 点阵命中 + toast 撤销）/ 390 零横溢按钮非竖排 / 清理回基线 / console 0）。
- [x] 记录：`CHANGELOG.md`、`AGENTS.md`。

---

## 本机动作反馈修复 · N0.7（已完成 · 2026-10-03）

答所有者「点击『位置』后无反应」：端点正常（200 + spawn 已发出）但应用内**零成功反馈**。四处本机动作补成功 toast（收件箱「打开文件 / 位置」、资料页「打开文件 / 在文件管理器中显示」）；explorer 改 `/select,"路径"` 原生规范形式（`windowsVerbatimArguments`）；`spawnDetached` 挂 `error` 日志（启动失败可诊断）；资料页 reveal 错误文案对齐「定位失败」。`node --check` + `npm run build` 退出 0；QA **16/16**；零写入；证据 `.qa/v54/`。

- [x] 服务端（`server/index.mjs`）：`spawnDetached(command, args, extra = {})` + `.on('error')` 日志；`revealPath` / `inboxFileAction` reveal 分支 → `/select,"<path>"` + `windowsVerbatimArguments`。
- [x] 前端（`src/views/{Inbox,Library}.tsx`）：成功 toast ×4；资料页 reveal 错误文案「打开失败」→「定位失败」。
- [x] 验证：`.qa/v54/verify-n07.py` **16/16**（真端点 reveal 200（一次预期弹窗）+ dryRun 面；拦截弹窗的四条成功 toast；错误路径 tone=error；快照/哈希零写入）。
- [x] 记录：`CHANGELOG.md`、`AGENTS.md`。

---

## 课表独立页面 · Slice H2（已完成 · 2026-10-03）

答所有者「课表可以单独在侧边栏开一个页面，移动一下」：课表从日程页「议程 / 课表」切换中**搬出**，成为侧栏一级页面 **`/timetable`**（中文「课表」· TIMETABLE，导航 index 05、位于「日程」之后）；日程页回退为**纯议程**（与加课表前行为一致）。导航注册表 `src/lib/nav.ts` 驱动侧栏与命令面板同源生效；移动端底栏 6 个一级项 + 「更多」。QA **34/34**；零写入；控制台 0 error；证据 `.qa/v53/`。

- [x] 迁移（`src/views/Timetable.tsx` 新）：`ClassGrid` + `CourseDetailModal` + `CourseDraftModal` + `TermModal` + 创建撤销逻辑从 Calendar 原样迁移；页头由 TopBar 统一（`课表 · TIMETABLE`），不与周次条重复。
- [x] 回退（`src/views/Calendar.tsx` / `styles/views.css`）：移除 mode / segmented / 课表分支与弹窗；`calendarUiStore` 去 `mode` 字段（旧 localStorage 多余键自然忽略）；删死样式 `.k-cal__mode`。
- [x] 导航（`src/lib/nav.ts` / `src/App.tsx`）：`/timetable` 路由与 index 05；项目 / 资料 / 回顾 / 设置 / 回收站顺延 06–10；`secondary` 标记保持原样。
- [x] 验证：`.qa/v53/verify-h2.py` **34/34**（侧栏顺序 / 课表页渲染（工业互联网基础 1 块）/ 日程无切换回归 / 命令面板 / 390 底栏 6+更多零横溢 / 旧界面态含 `mode` 键容忍 / 零写入 + console 0）。
- [x] 记录：`docs/02`（路由清单）；`docs/05`（视图清单与计数）；`public/guide.html`（「九个页面」+ 课表卡片独立化）；`CHANGELOG.md`、`AGENTS.md`。

---

## 收件箱体验修复批 · H1.7 / N0.5 / N0.6 / H1.8（已完成 · 2026-10-03）

答所有者四条实机反馈逐条闭环（课表自动路由 / 要点反馈 / 按钮反馈纪律 / 三节连堂显示）。`npm run build`（tsc strict + vite）退出 0；QA：**H1.7 17/17 · N0.5 22/23→修复后复验通过 · N0.6 22/22 · H1.8 26/26 + 合并定向 4/4**；零数据残留（owner 文件字节不变；activity 增量除外）；控制台 0 error；证据 `.qa/v49`–`.qa/v52`。

- [x] H1.7 · 课表自动识别路由（`src/lib/timetableAi.ts` / `src/views/Inbox.tsx`）：`looksLikeTimetable`（仅文件条目；`/课表|课程表|时间表|timetable/i` 匹配 name/content）+ `routeArrivedItem`（命中 → 自动展开 + 课表流、跳过通用解析；未命中 → 原通用解析；文本条目与无关键词截图保持手动入口防误伤）；课表卡零课程空态。
- [x] N0.5 · 要点笔记三态反馈（`src/lib/inboxAi.ts` / `AiActionsCard.tsx` / `Inbox.tsx`）：`factsNoteCache`（itemId→noteId）+ 按钮「保存中… → 已存为要点笔记 · 查看（深链 /library?note=）→ 撤销后恢复」；`clearFactsNote` 带 `cacheVersion` 通知（修 QA 发现的撤销不恢复）。
- [x] N0.6 · 交互反馈修复（`inboxAi.ts` / `Inbox.tsx` / `Review.tsx` / `Calendar.tsx`）：`clearCachedSuggestion` + `dismissAiSuggestion`（忽略 = 清缓存 + 面板/行尾标记消失 + toast；就绪/空态/错误态/课表忽略四路同修）+ 全站按钮审计（另修：回顾空卡点击条件挂载、日历空议程「今天/回到现在」禁用）。
- [x] H1.8 · 连续课块合并（`src/lib/schedule.ts` / `ClassGrid.tsx`）：`mergeDayRuns`（**按课程维护最后一段**；相邻/重叠 + 地点兼容合并；空地点兼容）+ 网格/今天行接入；`sessionsOfDay` 死代码删除；修复 QA 发现的排序依赖边界（同起始节次课程插入不再打断）。
- [x] 验证：`.qa/v49/verify-h17.py` 17/17（自动路由正反例）；`.qa/v50/verify-facts.py` 22/23（1 缺陷 → 修复）；`.qa/v51/verify-feedback.py` 22/22（忽略消失/课表忽略 toast/日历禁用）；`.qa/v52/verify-h18.py` 26/26（合并 1 块 vs 2 块、owner 只读抽查 span 9-11/5-8、撤销 282ms 恢复）+ `verify-merge-order.mjs` 4/4。
- [x] 备注（QA 事故透明记录）：v50 测试初版按标题前缀误清除 owner 回收站 `n-0001`，已按 SHA-256 字节级精确恢复（`.qa/v50/recover-n0001.py`）；后续清理一律按本次新建 id。
- [x] 记录：`docs/02`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`；TASK_BOOK 新增「交互反馈纪律」工作约定（2026-10-03）。

---

## 数据清零 + 零状态巡检（运维 · 2026-10-03）

应所有者「把所有数据清理一下我要从 0 开始用这个系统」。新增维护脚本 `scripts/reset.mjs`（`node scripts/reset.mjs` 预演；`--yes` 执行——先整目录备份到 `.qa/backups/data-<ts>/`，再清空实体 / 回收站 / 附件 / 审计，重置 `tags.json` 为空、删除 `term.json`，保留 `config.json`）；已执行清零（158 实体 / 2 回收站 / 4 附件 / 1730 审计行 → 0；备份 `.qa/backups/data-20261003-133539`）；服务重启后零状态验证（全 0 / term null / tags 空 / activity 空）；空态巡检（`.qa/v48/verify-empty.py`）9 路由 × 1440/390 全绿：非白屏、真实空态文案命中（含 `/review` 动作记录空态、`/calendar` 课表模式空态）、零横溢、控制台 0 error、巡检零写入。

- [x] `scripts/reset.mjs`（预演 / `--yes` / 自动备份 / 保留 config）。
- [x] 清零执行 + 服务重启 + 零状态 API 验证。
- [x] `.qa/v48/` 空态巡检（9 路由 × 2 视口 + 5 张截图）。
- [x] 记录：`docs/05`（scripts 清单）；`CHANGELOG.md`、`AGENTS.md`。

---

## 回顾 · 动作记录 · Slice S（已完成 · 2026-10-03）

答所有者「回顾页面需要详细记录我每一次动作（完成了什么、添加了什么），或单独只查看我做过什么事」。服务端为审计**自描述**增补（`commit` / `moveToTrash` / `restoreFromTrash` 并入 `title`、`updateEntity` 并入 `status`；**追加键**不破坏既有形状）；前端回顾页新增**「动作记录」时间线**（`src/lib/activity.ts` 四桶中文映射 + `ActivityTimeline`：日分组 / 过滤 chips「全部 · 完成 · 新增 · 打卡 · 其他」持久化 / 深链 / 空态；只读消费 `GET /api/activity`）。服务端冒烟 **32/32** + 浏览器 E2E **27/27**；零残留（162 文件字节哈希一致；owner 四文件字节不变）；控制台 0 error；证据 `.qa/v47/`。

- [x] Deliverable A · 审计自描述（`server/{store,index}.mjs`）：`commit()` detail 并入记录 `title`；`updateEntity` 状态变更时并入 `status` 新值；`moveToTrash` / `restoreFromTrash` 并入 `title`；`purgeTrash` 保持仅 id。
- [x] Deliverable B · 时间线（`src/lib/activity.ts` / `src/components/ActivityTimeline.tsx` / `src/views/Review.tsx` / views.css）：`describeActivity`（完成 / 新增 / 打卡 / 其他）+ `filterByBucket` + `groupByDay`（今天 / 昨天 / M月D日）；Panel + chips（`kernel.ui.review.v1` 持久化）+ `HH:mm` + 「查看」深链（`deepLinkOfId`）+ 内部滚动 + 空态；`.k-act*` token-only。
- [x] 验证：`.qa/v47/server-smoke.mjs` **32/32**（审计 detail 原文：title / status / checkin / trash / restore）；`.qa/v47/verify-s.py` **27/27**（三类动作可见 + 「今天」组头；四档过滤分桶正确；深链 `?task=`；390 零横溢；控制台 0 error；零残留）。
- [x] 记录：新增 ADR-0026；`docs/02`；`docs/README.md`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## 课表解析过程可视 · Slice H1.6（已完成 · 2026-10-03）

答所有者「我看不到 AI 思考过程」：课表解析由同步闷跑改为 **SSE 流式过程可视**——「导入为课表」实时显示阶段（「AI 正在阅读课表…」→「正在提取课程…」→「输出校验重试中…」）与输出预览（尾部 ≤240 字、≤2 行截断）。同步端点保留。服务端冒烟 **29/29** + 浏览器 E2E **18/18**；零残留；证据 `.qa/v46/`。

- [x] Deliverable A · 服务端（`server/{ai,index}.mjs`）：`draftTimetableStream`（订阅→sessionID 过滤泵→safeEmit→finally 收尾，逐字镜像 `parseInboxItemStream`；不可读护栏与失败均走 `error` 事件不抛出）+ `promptTimetableWithRetry` 增 emit（重试事件）；路由 `POST /api/ai/timetable/draft-stream`（前置 JSON 守卫后切 SSE）。
- [x] Deliverable B · 前端（`src/lib/{mutations,timetableAi}.ts` / `src/views/Inbox.tsx` / views.css）：`aiTimetableDraftStream`（镜像 `aiParseInboxStream` 的 SSE 帧解析）+ 快照扩 `{itemId, busy, stage, preview, courses, error}`（token 守卫）+ 阶段 / 预览渲染 + `.ic-tt__preview`。
- [x] 验证：`.qa/v46/server-smoke.mjs` **29/29**（帧序列 `status→delta×2100→suggestion`；4 门课；错误帧含指引；守卫 400/404/409）；`.qa/v46/verify-h16.py` **18/18**（阶段文案可见；错误路径指引 + 关闭；390 零横溢；控制台 0 error；零残留）。
- [x] 记录：ADR-0025 修订（H1.6）；`docs/02`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## 旧版 .xls 直读 · Slice H1.5（已完成 · 2026-10-03）

答所有者「我投入课表 Excel 后只是被识别为资料」的直读诉求（H1 先给指引，H1.5 补直读）：新增**零依赖 OLE2/CFBF + BIFF8 最小解析**，所有者真实课表 `.xls`（只读）直读出完整网格并 `draft` 出 **12 门课全对**（教师 / 地点 / 星期节次 / 周次）。服务端冒烟 **32/32**、`.qa/probe-xls/` **19/19**、`.qa/probe-h1/` 回归 19/19；零残留；无新增依赖。

- [x] 解析器（`server/ai.mjs`）：`extractOleStream`（CFBF：DIFAT / FAT / 目录链 + miniFAT 迷你流）+ BIFF8（BOF / BOUNDSHEET / SST 含 CONTINUE 续段 / LABELSST / LABEL / RSTRING / NUMBER / RK / MULRK / MERGEDCELLS）+ `decodeRk` + 列对齐网格 + **合并传播**；健全性护栏（无 CJK / 空网格 → null；异常一律回退）。
- [x] 集成：`buildFileSection` `.xls` 分支 OLE2 → `extractLegacyXlsGrid` 直读（失败回退原「另存为 .xlsx / 截图 / 粘贴」指引）；HTML / 文本分支不变。
- [x] 验证：`.qa/probe-xls/probe.mjs` 19/19（真实文件网格 dump 断言「大学物理C / 陈曼娜讲师 / 301 / 星期表头 / 无 U+FFFD / 合并重复」+ RK 单测 + OLE 边界）；冒烟 32/32；owner 真实 `.xls` 只读全链（草稿 12 门全对，零写入、零审计）；`node --check` 通过。
- [x] 记录：ADR-0025 修订（H1.5）；`docs/02`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## 课表导入 · Slice H1（已完成 · 2026-10-03）

以 owner 反馈为规格：「我投入课表 Excel 后只是被识别为资料」——实测其 `.xls` 为真正的 OLE2 二进制（零依赖栈不可直读），且「课表 → 课程」此前没有导入管线。本切片补齐**课表来源 → 课程草稿 → 勾选确认 → 导入**（confirm-first；草稿绝不落盘），覆盖 `.xlsx`（网格抽取）/ 截图 / 粘贴文本 / HTML 版 `.xls`；旧版二进制 `.xls` 给明确指引。`npm run build`（tsc strict + vite）退出 0；服务端冒烟 **32/32** + 浏览器 E2E **20/20**；零残留（159 数据文件字节哈希一致；owner i-0013 / r-0013 / tags.json 字节不变）；控制台 0 error；证据 `.qa/v45/`。

- [x] Deliverable A · 草稿端点（`server/{schemas,ai,index}.mjs`）：`POST /api/ai/timetable/draft { id }`（guard 同收件箱解析：400/404/409/503/502；不可直读附件 → 400 指引「另存为 .xlsx、截图或粘贴文本」；**不落盘、无审计**）；`buildTimetableSystem` 提示词（星期列=1..7 / 节次行 / 合并单元格跨段 / weeks 文本→升序数组含单双周 / 宁缺毋滥 ≤30 / 忽略学号姓名表头）+ `tryParseTimetable` + 单次重试；`cleanTimetableCourses`（确定性清洗：end<start 交换、非法时段丢弃、weeks 去重升序、空课程丢弃、trim+截断）。
- [x] Deliverable B · 导入端点（`server/index.mjs`）：`POST /api/courses/import { courses }`（1–30 门；全部先校验+`normalizeCourseSessions`、零落盘，再逐条 `commit`；审计 `course.create` · `detail.via:'timetable-import'`；201 `{created}`）。
- [x] Deliverable C · 来源读取（`server/ai.mjs`）：`extractXlsxGrid`（sharedStrings + inlineStr + 数字 + 列字母对齐补空列 + 跳空行；`extractOfficeText` xlsx 分支改用它，docx/pptx 不变）；`extractLegacyXlsText` 三分支（OLE2→不可读指引；HTML/XML 表格→`htmlTableToText`；≥10 汉字→原文）；`.csv` 已在文本白名单；截图复用 N0 file part。
- [x] Deliverable D · 前端（`src/views/Inbox.tsx` / `src/lib/timetableAi.ts` / `src/components/TimetableDraftCard.tsx`）：展开条目「导入为课表」pill（在跑显示「课表解析中…」）；模块级提取状态（token 守卫；无 localStorage）；选择卡（「识别到 N 门课程 · 勾选后导入」+ 逐行勾选默认全选 + 时段明细「周三 第3-4节 · 1–15 周（单） · 某教室」+「导入 N 门课程」/「忽略」）；导入 → toast「已导入 N 门课程 · 撤销」（撤销 = 逐条移入回收站）；错误态（`.xls` 指引）安静展示 + 重试/关闭；390px 零横溢。
- [x] 验证：`.qa/v45/server-smoke.mjs` **32/32**（守卫 409/404/400；二进制 .xls → 400 含指引；HTML 课表 → 真实 AI 提取 **4 门课**（教师/地点/星期节次/周次含单周全对）→ import 201 + 审计 `via` + 回收站往返；xlsx 端到端形状；零残留 + 159 文件哈希一致 + owner 三文件字节不变）；`.qa/v45/verify-h1.py` **20/20**（上传 → 「识别到 4 门课程」→ 取消 1 门 → 「导入 3 门课程」→ toast → 课表网格出现 3 块；错误路径指引文案 + 关闭；390 零横溢；控制台 0 error；零残留）；探针 `.qa/probe-h1/` 契约 19/19（含 xlsx 网格夹具与 .xls 三分支）。
- [x] 记录：新增 ADR-0025（`docs/decisions/0025-timetable-import.md`）；`docs/02`；`docs/04`（§4.10b 注记 / §9 写入路径）；`docs/README.md`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## 课表 · Slice H0（已完成 · 2026-10-03）

答所有者「我还需要你做一个课表功能，我有时候会在这里查询课表，类似于课表这种属于固定日程，还是要和任务区分开来的」。新增**课程实体**（`c-`，与任务 / 事件分离）+ **学期元数据**（`data/meta/term.json`）+ **日历「课表」模式**（周网格 / 按周查询 / 单双周过滤 / 今天行），先做手动录入（AI 解析导入、调休例外、节次时间映射为后续切片）。`npm run build`（tsc strict + vite）退出 0；服务端冒烟 **53/53** + 浏览器 E2E **31/31**；零残留（157 数据文件字节哈希一致；courses 0 / term.json 精确复原；trash 空）；控制台 0 error；证据 `.qa/v44/`。

- [x] Deliverable A · 实体与元数据（`server/{schemas,store,index}.mjs`）：`courseSchema`（`id/title/teacher?/location?/sessions[1..16]/notes?/createdAt/updatedAt`；时段 = `dayOfWeek 1..7 / startPeriod 1..20 / endPeriod ≥ start / weeks?（1..60 升序去重，缺省=每周）/ location?`）+ `normalizeCourseSessions`（排序去重 / 空键省略 / `end<start` 与空时段 → 400 中文可读）+ `courseCreateSchema` / `termUpdateSchema`；`SCHEMAS.courses` / `ID_PATTERNS`（`c-`）/ `nextId` / `TRASH_KINDS` / `EDITABLE_KINDS`（→ 通用 update/trash）/ `SINGULAR` / `EDITABLE_FIELDS`；`data/meta/term.json`（`readTerm`/`updateTerm`，审计 `term.update`）；`readSnapshot` 增 `courses` + `term`；路由 `POST /api/courses`（201）/ `POST /api/courses/:id/remove` / `POST /api/term`；审计 `course.*`。
- [x] Deliverable B · 课表视图（`src/views/Calendar.tsx` / `src/components/ClassGrid.tsx`）：日历页「议程 / 课表」安静 segmented（`kernel.ui.calendar.v1.mode` 持久化）；课表模式全宽 7 列 × 节次行周网格（块跨行、今日列信号高亮、点块开详情、点空格预填新建）；头部 `第 N 周` + `‹ 本周 ›` + 「设置学期」；今天行（真实当前周汇总）；无学期 → `未设置学期（不按周过滤）`。
- [x] Deliverable C · 手动录入（`CourseForm` / `CourseDraftModal` / `CourseDetailModal` / `TermModal` / `src/lib/schedule.ts`）：时段编辑器（星期 / 节次 / 周次文本 `1-16 / 1-16单 / 1-8,10-16`，空 = 每周，「每周/全周」宽容；行内校验）；创建 → toast 撤销；详情编辑（撤销回写旧 patch）/ 删除（回收站撤销）；`schedule.ts` 纯函数（解析 / 格式化「1–15 周（单）」/ 周换算 / 时段过滤）；回收站新增「课程」分组。
- [x] 修复（QA 发现，已修）: ① `store.mjs` `commit()` / `restoreFromTrash()` 缺父目录创建 → 新实体首写 ENOENT 500（各加 `mkdir recursive`）；② `.k-sched` 类名与既有 ScheduleList 撞车 → 390px 页横溢（H0 家族改名 `k-timetable*`，E2E 选择器同步）。
- [x] 验证：`.qa/v44/server-smoke.mjs` **53/53**（term 写入 / 快照 / 审计 / 非法 400；课程创建 201 + weeks 排序去重 + 空键省略 + trim；校验 400；更新 bump；回收站往返；零残留 + 157 文件哈希一致 + term.json 还原）；`.qa/v44/verify-h0.py` **31/31**（学期设置 → 第 3 周；建课 A（`1-16单`）/B → 第 4 周 A 隐 B 显 → 本周回归；今天行；详情 `1–15 周（单）` / `第3-4节` + 编辑 + 删除撤销；mode 持久化；390 零横溢 + 网格内滚；零残留 + 控制台 0 error）；探针 `.qa/probe-h0/` 契约 19/19。
- [x] 记录：新增 ADR-0024（`docs/decisions/0024-timetable-course-entity.md`）；`docs/02`；`docs/04`（§2 / §4.10b / §4.11 / §5.4b）；`docs/05`；`docs/README.md`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## 公告解析 · Slice N0（已完成 · 2026-10-03）

答所有者「我会将零散微信通知直接丢进去……提取有用信息（放假时间、待办）；这类通知无指明对象，需要判断后让我选择；聊天记录也可能是图片截图；课表属于固定日程要与任务区分（课表是后续切片，不在本文范围）」。本切片把收件箱解析从「只产动作」扩为**通知三性**，并把图片截图接入同一解析管线；画像为后续切片。`npm run build`（tsc strict + vite）退出 0；服务端冒烟 **30/30** + 浏览器 E2E **30/30**；零数据残留（`data/` 下 **157 个文件字节哈希前后完全相同**；inbox 12 / tasks 62 / notes 16 / files 2 / trash 0 回基线）；控制台零 error；证据 `.qa/v43/`。

- [x] Deliverable A · 三性 schema + 提示词（`server/{schemas,ai}.mjs`）：解析响应新增顶层 `facts: string[]`（硬事实 ≤8 条 / ≤140 字 / 含日期或数字；`cleanFacts` trim / 去空 / 截断 / 去重 / 封顶；**不落盘**）；`task` 动作新增可选 `condition`（≤30 字；`aiActionSchema.condition` + `postValidateActions` null / 非 task / 空串清理）；纯提醒 / 安全须知默认不产动作；`tryParseActions` 返回 `{ actions, facts }`，同步与流式 suggestion 均携带 `facts`；旧式单建议归一化 → `facts: []`。
- [x] Deliverable B · 条件选择 UX（`src/components/AiActionsCard.tsx` / `src/lib/{aiForm,mutations}.ts`）：带 `condition` 的动作**默认不勾选**（勾选 = 相关 / 要做），无条件维持默认勾选；卡片「适用：…」标注；`formToAction` 透传 `condition`。
- [x] Deliverable C · 截图接入（`server/ai.mjs`）：`isImageFile()`（扩展名 / `image/*`）+ `buildFileSection` 图片分支「见附图」+ opencode file part（`data:<mime>;base64,…`，读失败优雅降级）；图片**跳过**「文件 = 恰 1 条 resource」硬归一化（非图片不变）；默认模型 `deepseek/deepseek-flash` 实测可读图（探针 `.qa/probe-vision/`），无需 OCR / 换模型。
- [x] Deliverable D · 信号打底（`server/index.mjs`）：`inbox.apply` 审计增 `detail.signals.conditions`（已应用动作非空 `condition` 去重、首见顺序）；画像本体（`profile.json` / 排序提升）不在本切片。
- [x] 验证：`.qa/v43/server-smoke.mjs` **30/30**（真实 AI 文本公告解析（9.3s）→ 3 facts + 1 条件任务（`condition`「仅出国（境）者」、`contexts ["@phone"]`）；截图上传（image/png → file part）解析 200；审计 `signals.conditions` == `["仅出国（境）者"]`；零残留 + 157 文件字节不变）；`.qa/v43/verify-n0.py` **30/30**（「要点 · 2」；条件动作默认不勾选 +「适用：仅出国（境）者」；应用负载携带 condition；存为要点笔记 + 撤销 notes 16→17→16；390 零横溢；控制台 0 error；零残留）。契约 `.qa/probe-n0/contract-check.mjs` 10/10。
- [x] 记录：新增 ADR-0023（`docs/decisions/0023-notice-triage-and-image-intake.md`）；`docs/02`；`docs/04`（§4.1 / §4.14）；`docs/README.md`；`public/guide.html`；`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md`。
- [x] 已知非本切片缺陷（入 backlog）：`readKind`/`readDirRecords` 并发读竞态偶发 ENOENT 500（`.qa/v43/repro-500.mjs`）。

---

## 状态保留（F25–F29）· Slice Z（已完成 · 2026-10-03）

所有者反馈：「我每个页面的操作比如首页的 AI 对话，切换页面后再回来就清空了，根本没有保留和记忆。」根因是界面状态多放在组件 `useState`，切路由卸载即丢（既有例外仅 `scroll.ts` 滚动记忆与 `inboxAi.ts` 收件箱 AI 运行态）。本切片把「界面状态保留」确立为通用策略并以 `src/lib/uiState.ts` 落地，覆盖 F25–F29。**纯前端切片，未改服务端**。`npm run build`（tsc strict + vite）退出 0；浏览器 E2E **51/51**；零数据残留（`data/` 下 **157 个文件字节哈希前后完全相同**）；控制台零 error；证据 `.qa/v42/`。

- [x] Deliverable A · 通用助手（新 `src/lib/uiState.ts`）：`createUiStore<T>(key, initial, { parse, prune, persist })` 模块级状态 + 订阅 + `useUiStore`（`useSyncExternalStore`）；`parse` 非法回退 / `prune` 裁剪 / `persist:false` 仅模块级；读写失败静默；附 `str`/`bool`/`oneOf`/`oneOfOrEmpty` 取值助手；键 `kernel.ui.<page>.v1`。
- [x] Deliverable B · F25 AI 对话（`src/components/OverviewChat.tsx`）：`draft`/`busy`/`error` 提升到模块 store；`requestChat` + `chatToken` 模块化（切页卸载后回复仍写回 store，思考中跨页保留；清空作废在途响应）；对话 + 草稿 `localStorage` 持久化（**上限 60 轮**、刷新还原、id 序号推导）；清空 = 归档为笔记（成功才清内存 + 清持久化副本，刷新仍清空）。
- [x] Deliverable C · F26 任务（`src/views/Tasks.tsx`）：筛选 / 分组模式 / 更多筛选展开 / 快速新建草稿 → 模块 store + `localStorage`（切路由 + 刷新还原）。
- [x] Deliverable D · F27 收件箱（`src/views/Inbox.tsx`）：选中 id 集 / 内联展开 id / 捕捉草稿 → 模块 store + `localStorage`；`revision` 变化时对账剔除脏 id；`pendingFiles` 刻意维持组件级。
- [x] Deliverable E · F28 资料（`src/views/Library.tsx`）：标签页 / 笔记类型 / 资料类型 / 资料状态 / 选中标签 → 模块 store + `localStorage`。
- [x] Deliverable F · F29 其余（`Calendar.tsx` / `Projects.tsx` / `Review.tsx`）：日程选中日 + 显示月游标（毫秒）、项目快速新建草稿持久化；回顾周 / 月卡 AI 草稿运行态模块级（**刻意不持久化**：大文本且绑定归档 `reviewId`）。弹窗 / 编辑 / 撰写等瞬时态维持组件级。
- [x] 验证：`.qa/v42/verify-z.py` **51/51**（对话草稿跨路由 + 消息跨路由 + 刷新还原 + 思考中切页返回仍思考中（挂起 `/api/ai/chat` 后释放）+ 清空归档为笔记（拦截 `POST /api/notes`）+ 刷新仍清空；任务筛选 / 分组 / 草稿跨路由 + 刷新还原；收件箱 2 选中 + 1 展开 + 草稿跨路由；资料五筛选跨路由 + 刷新还原；390 零横溢；控制台 0 error；快照集合回基线 + 157 文件字节哈希相同）。`hash-data.mjs` 前后字节哈希。
- [x] 记录：新增 ADR-0022（`docs/decisions/0022-ui-state-persistence.md`，机制选择 / 聊天上限 / **不持久化清单**）；`docs/README.md`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## 一致性清扫 · Slice Y（已完成 · 2026-10-03）

只读「碎片化 / 摩擦」审计剩余项清扫（F4/F5/F7/F11/F12/F13/F14/F17/F18/F21/F24/F32/F33/F36 + 标签补全）：同一概念多处各写一份、UI 与存储口径不一致。`npm run build`（tsc strict + vite）退出 0；服务端冒烟 **30/30** + 浏览器 E2E **35/35**；零数据残留（所有者 157 个数据文件**字节不变**，含 `t-0057`/`t-0058` 的 `importance: 0`）；控制台零 error；证据 `.qa/v41/`。

- [x] Deliverable A · 情境统一（`server/ai.mjs` / `src/views/Tasks.tsx`）：AI 收件箱解析 / 任务补全提示词情境列表从注册表派生（`contextNamesOf` / `contextRuleText`），终结硬编码 5 个（遗漏 `@errands`/`@home`）；任务上下文筛选 = 已用 ∪ 注册表情境（F4/F24）。
- [x] Deliverable B · 量纲单一源（`server/schemas.mjs` / `src/lib/format.ts`）：重要性统一 **0–3**（5 个 AI / 创建 / 澄清 schema + 提示词 + UI `IMPORTANCE_OPTIONS`/`importanceLabel`）；能量 `ENERGY_OPTIONS` 去重（F7/F21；选 0–3 理由见 ADR-0021 §2.3）。
- [x] Deliverable C · 资料直接新建（`server/{schemas,index}.mjs` / `src/components/ResourceDraftModal.tsx` / `src/views/Library.tsx` / `src/lib/mutations.ts`）：`resourceCreateSchema` + `POST /api/resources`（`resource.create` 审计）+ 草稿弹窗 + toast 撤销（回收站）+ `?resource=` 深链（F5）。
- [x] Deliverable D · 报告 / 总览（`src/views/{Review,Overview}.tsx` / `src/styles/views.css`）：移除恒为「—」的「迁移」瓦片（F12，字段保留兼容）；W40 行 `?? '—'`（F11）；监视柱 / W40 深链（F13/F14）；报告内停滞建议行接到同一套动作（F17）。
- [x] Deliverable E · 任务 / 收件箱摩擦（`src/components/{TaskDetail,AiActionsCard}.tsx` / `src/lib/{inboxAi,mutations}.ts` / `src/views/Inbox.tsx` / 四详情弹窗）：任务详情「推迟至」行（F18）；重新解析经模块级 `actionEditCache` 保留用户编辑（F32）；多文件上传受限并发 `mapLimit(≤3)`、解析仍顺序（F33）；`undoPatchOf` 使任务 / 项目 / 笔记 / 资料编辑保存附撤销（F36）。
- [x] Deliverable F · 标签补全（`src/components/{AiSuggestionForm,EntityEditForm}.tsx`）：tags / contexts `<datalist>`（注册表名称 + 中文标签，revision-aware）。
- [x] 验证：`.qa/v41/server-smoke.mjs` **30/30**（情境 parity / 资料创建往返 + 400 面 / importance 0 通过 & 4 → 400 / 审计 / 回收站 / 零残留 + 157 文件字节不变）；`.qa/v41/verify-y.py` **35/35**（新建资料 / 上下文 chips == 注册表 7 / 重新解析保留编辑 / 编辑撤销还原 / 总览深链 / 报告无迁移瓦片 + 建议行归档 / tags datalist / 390 零横溢 / 控制台 0 error / 零残留）。
- [x] 记录：新增 ADR-0021；`docs/02`；`docs/04`（§3 / §4.2 / §4.9 / §4.10）；`docs/README.md`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## 笔记体验：沉浸阅读 / 撰写 + AI 蒸馏 · Slice M（已完成 · 2026-10-03）

所有者 backlog「笔记的详情页需要设计一个笔记系统，需要有沉浸式的阅读和撰写体验」+ 蒸馏困惑「这个蒸馏是什么意思，是点击后就可以 ai 蒸馏还是什么意思」。此前笔记详情与任务 / 项目共用 660px 弹窗、正文沿用全局 65ch/行高 1.65 且被元数据表压在下方；编辑态正文字段与其它字段同规格（`rows=5`）、标题不醒目；**无「新建笔记」入口**（`POST /api/notes` 存在但 UI 未暴露）；`distillLevel` 只能标注、无任何内容变换与语义说明。本切片交付沉浸阅读 / 撰写面、新建笔记入口，并把「蒸馏」从语义澄清升级为**可执行 AI 蒸馏**（出草稿 → 确认 → 追加 → 可撤销）。`npm run build` 退出 0；服务端冒烟 **34/34** + 浏览器 E2E **35/35**；零数据残留（所有者 157 个数据文件**字节不变**，`n-0016` 与标签注册表逐字节一致）；控制台零 error；证据 `.qa/v40/`。

- [x] Deliverable A · 沉浸阅读（`src/views/Library.tsx` / `src/styles/shell.css` / `views.css`）：笔记详情 `.k-modal--note`（≤820px）；`.k-note-read`（68ch / 行高 1.8 / 标题分层）；安静 `.k-note__meta` 条 + `.k-note__secondary` 次级区；`react-markdown` 渲染（无 `dangerouslySetInnerHTML`）。
- [x] Deliverable B · 沉浸撰写 + 新建笔记（`EntityEditForm.tsx` / `NoteComposeModal.tsx` / `Library.tsx`）：`rows` 可选字段；标题 + 正文（`rows=18`）优先 + `.k-note-edit` 撰写面；笔记区头部「新建笔记」→ 撰写弹窗 → `POST /api/notes` → toast 撤销（回收站）+ 打开 `?note=`。
- [x] Deliverable C · 蒸馏语义 + AI 蒸馏（`format.ts` / `Library.tsx` / `mutations.ts` / `server/{schemas,ai,index}.mjs`）：`DISTILL_HELP` + `nextDistillLevel`；`noteDistillSchema` / `noteDistillRequestSchema` + `draftNoteDistill` + `POST /api/ai/note/distill`（缺省当前+1 clamp 1–3、不落盘）；内联建议面板（可编辑 + 应用 / 忽略 / 重试）；应用正文追加 + 设层级、撤销精确还原。
- [x] 验证：`.qa/v40/server-smoke.mjs` 34/34（笔记 create→update→trash→restore→purge；蒸馏非法 id 400 / 不存在 404 / 真实 AI 形状 + 缺省目标 + 显式 target + L3 封顶 + 不写入；审计全覆盖；零残留 + 所有者 157 文件字节不变）；`.qa/v40/verify-m.py` 35/35（阅读面 / 编辑面 / 新建笔记 / AI 蒸馏应用 + 撤销 / 390 零横溢 / 控制台 0 error / 零残留 + 笔记集合与标签不变）。
- [x] 记录：新增 ADR-0020；`docs/02`；`docs/04` §4.8 / §5 写入路径；`docs/README.md`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## 区域 / 目标 / 习惯可管理 + 打卡 · Slice X（已完成 · 2026-10-03）

审计 F7 / F8 / F23 + 习惯打卡缺口：`data/areas` / `data/goals` / `data/habits` 是最后三个只读结构——有种子、有选择器 / 关联芯片 / 统计，却无 schema / 路由 / UI 可创建 / 编辑 / 删除；总览「连续刷题」条读冻结的 `habit.log` 且 `derive.ts` 硬编码 `h-0002`，无打卡写入路径。本切片把三类并入可管理 / 可回收族（含区域 / 目标**引用护栏**），补齐习惯**打卡闭环**，让 area/goal 关联芯片可点（F8），并显式化项目区域默认（F23）。`npm run build` 退出 0；服务端冒烟 **62/62** + 浏览器 E2E **45/45**；零数据残留（areas 7 / goals 7 / habits 5 等全部回基线；所有者 157 个数据文件**字节不变**，含 20 事件 / 区域 / 目标 / 习惯种子与 `h-0002` log）；控制台零 error；证据 `.qa/v39/`。

- [x] Deliverable A · 区域（`server/{schemas,store,index}.mjs` + `src/components/DimensionManagers.tsx`）：`areaSchema` + `SCHEMAS.areas`（保留 `ID_PATTERNS.areas`）+ `nextId` 增 `a` + `TRASH_KINDS` 增 areas；`POST /api/areas` · `/:id/update` · `/:id/remove`（删除带引用护栏 → 409 可读计数）；审计 `area.*`；设置页「区域」管理区 + 删除预判护栏。Relations 区域芯片可点（F8）。
- [x] Deliverable B · 目标（同上）：`goalSchema` + `ID_PATTERNS.goals` + `SCHEMAS.goals` + `nextId` 增 `g` + trash；创建 / 编辑 / 删除（护栏 = 项目 `goalId` + 子目标 `parentGoalId`）；`keyResults` **只读保留**（写入延后）；审计 `goal.*`；设置页「目标」管理区。Relations 目标芯片可点。
- [x] Deliverable C · 习惯（`server/*` + `src/views/Overview.tsx` + `DimensionManagers.tsx`）：`habitSchema` + `ID_PATTERNS.habits` + `SCHEMAS.habits` + `nextId` 增 `h` + trash；创建 / 编辑 / 删除（无护栏）；**打卡** `POST /api/habits/:id/checkin {date?}` / `uncheckin`（缺省今天、**幂等**、写 `{date,value:1}`）；审计 `habit.create/update/remove/checkin/uncheckin`；总览打卡条改首个习惯标题 + quiet「今日打卡」切换（撤销）；设置页「习惯」管理区。
- [x] Deliverable D · F23（`src/components/ProjectDraftModal.tsx`）：项目草稿区域下拉默认首个区域 id、移除「—」空选项——归属显式；服务端 `a-0001` 兜底保留（旧调用 / AI 路径）。
- [x] 修复 `h-0002` 硬编码（`src/lib/derive.ts`）：`getCodingStreak` / `getCodingStreakDetail` 确定性取 `habits[0]`；新增 `habitId` / `habitTitle` / `todayHit`。
- [x] 样式（`src/styles/views.css` / `components.css`）：`.k-mgr__*`（列表 + KR 只读）与 `.k-streak__actions`，token-only；回收站新增区域 / 目标 / 习惯分组（`Trash.tsx`）；类型 / mutations 扩展。
- [x] 验证：`.qa/v39/server-smoke.mjs` 62/62（三类 CRUD 往返 + restore/purge；`nextId` a-0008/g-0008/h-0006；空标题 400；臆造 areaId 400；区域 / 目标被引用删除 409 含计数；checkin/uncheckin 幂等；缺省今天；trigger 清空 + log 保留；审计全覆盖；零残留 + 所有者 157 文件字节不变）；`.qa/v39/verify-x.py` 45/45（区域 / 目标 新建 / 重命名 / 删除护栏 / 未引用删除回收站；芯片深链设置自动打开编辑；总览打卡 + 点阵 / 连击 + 撤销；390 零横溢；控制台 0 error；零残留 + 所有者字节不变）。
- [x] 记录：新增 ADR-0019；`docs/02`；`docs/04` §4.4–4.6 / §5.4b / §4.3；`docs/README.md`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## 事件可写（日程）· Slice W（已完成 · 2026-10-03）

审计 F6 / F9 / F10 / F38：事件是最后一个只读实体——有种子、在日历渲染、详情可看，却无 schema / 路由 / 创建 / 编辑 / 删除（`docs/04 §5.5` 状态流无法执行，迷你月历日格 inert）。本切片把 events 并入与 task/project/note/resource 同构的**可写 / 可回收实体族**，并让日历可操作。`npm run build` 退出 0；服务端冒烟 **33/33** + 浏览器 E2E **27/27**；零数据残留（events 20 / tasks 62 / notes 16 / resources 12 / projects 10 / inbox 12 / reviews 4；标签注册表回基线 27；所有者 i-0009..0012、t-0061/0062、rev-0001..0004、n-0016 与 20 条事件**字节不变**）；控制台零 error；证据 `.qa/v38/`。

- [x] Deliverable A · 服务端 schema + 存储（`server/schemas.mjs` / `store.mjs`）：`eventStatus` + `eventSchema`（`id/title/startAt/endAt?/allDay?/location?/areaId?/projectId?/tags/status/notes?/repeatRule?`，对齐既有形状、无 `createdAt/updatedAt`）+ `SCHEMAS.events` + `ID_PATTERNS.events`；`nextId` 增 `e` 前缀 + 回收站扫描；`TRASH_KINDS` 增 events。
- [x] Deliverable A · 服务端路由（`server/index.mjs`）：`EDITABLE_KINDS` / `SINGULAR` / `EDITABLE_FIELDS.events`（白名单含 `notes`，`repeatRule` 不开放）+ 通用 update/trash + restore/purge；新增 `POST /api/events`（title + startAt 必填、`end ≥ start` 400、projectId/areaId 存在校验、标签登记、审计 `event.create`）与 `POST /api/events/:id/remove`（审计 `event.remove`）；`updateEntity` 对 events 加 `end < start` 400 且不 bump `updatedAt`。
- [x] Deliverable B · 日历可操作（`src/components/EventDraftModal.tsx` / `EventDetailModal.tsx` / `EntityEditForm.tsx` / `src/views/Calendar.tsx`）：新建确认弹窗（先确认后写入、无 AI、toast 撤销）；详情编辑 / 删除（回收站 + 撤销）/ 状态快捷切换（已确认 / 待定 / 已取消，quiet segmented）；`EntityEditForm` 增 `boolean` 字段类型（全天）+ `submitLabel`；**F10 迷你月历日格可点**（选中 + 滚动议程到该日，reduced-motion aware）。
- [x] Deliverable B · 可选结束防御（`src/types.ts` / `Calendar` / `DaySpine` / `ScheduleList` / `Overview` / `data.ts` / `derive.ts` / `mutations.ts` / `Trash.tsx`）：`endAt?` / `notes?`；消费点 `event.endAt ?? event.startAt`；`TrashKind` / `TrashRecord` / `EditableRecord` 增 events；回收站新增「日程」分组。
- [x] 样式（`src/styles/views.css`）：`.k-minical__d` 可点态（悬停 / `.is-selected`）、`.k-field__check`（布尔字段），token-only。
- [x] 验证：`.qa/v38/server-smoke.mjs` 33/33（create 单点 / 完整往返、`end<start` 400、title/startAt 空 400、臆造 projectId/areaId 400、update 白名单 + 白名单外忽略、update `end<start` 400、审计 `event.create/update/remove`、remove → 回收站 → restore → purge、`nextId` 无碰撞、owner 20 条字节不变、零残留）；`.qa/v38/verify-w.py` 27/27（UI 新建 → 议程 + 月历圆点；详情编辑标题 / 时间；状态切换；删除 → 回收站（UI）恢复；日格点击滚动议程；390 零横溢；控制台 0 error；零残留 + 所有者记录字节不变）。
- [x] 记录：新增 ADR-0018（`docs/decisions/0018-events-writable.md`）；`docs/02`；`docs/04` §4.7 / §5.5 / §5.4；`docs/README.md`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## 子任务全链路 + 项目内操作 · Slice R3（已完成 · 2026-10-03）

以 owner 追问「项目里面的子任务又是怎么产生的？你根本没有关系」为规格。此前 `task.parentTaskId` 在 schema / relations 中已存在，却**没有任何创建 / 编辑路径**（字段是死的），项目详情任务行 `onOpen={() => undefined}` 也是死行。本切片补全**子任务全链路**（服务端写入白名单 + 自引用 / 成环 / 不存在三重护栏；任务详情「子任务」区块 + 就地打开 + quick-add 继承父项目；编辑表单「父任务」下拉防环）与**项目内操作**（任务行可就地打开、按项目预填新建任务），一律**先确认后写入、无自动子任务**。`npm run build`（tsc strict + vite）通过；服务端冒烟 **20/20** + 浏览器 E2E **29/29**；零数据残留（tasks 62 / projects 10 / notes 16 / inbox 12 / reviews 4；标签注册表回基线 26；所有者 i-0009..0012、t-0061/0062、rev-0001..0004、n-0016 未动）；控制台零 error；证据 `.qa/v37/`。

- [x] Deliverable A · 服务端 `parentTaskId`（`server/schemas.mjs` / `index.mjs`）：`taskCreateFieldsSchema` 增可选 `parentTaskId`；`EDITABLE_FIELDS.tasks` / `CREATE_FIELD_KEYS` 增它。`assertValidParentTask(callerId, parentId)`——父必须存在 / 不得自引用 / 不得成环（沿祖先链上溯，守卫上限 = 任务数 + 1）；创建与编辑均接入（`null` 清除键），拒绝 400、不留半成品；审计 `task.create` / `task.update`（`detail.fields` 含 `parentTaskId`）。
- [x] Deliverable A · 子任务 UI（`src/components/TaskDetail.tsx` / `TaskDetailModal.tsx` / `src/lib/data.ts`）：`getChildTasks`；「子任务 · N」区块（安静整行、完成划线、点击就地打开）+ 安静 quick-add（回车即建、**继承父任务 `projectId`**、toast 撤销）；任务弹窗导航栈（打开子任务 / 「← 返回」逐级退回，切根清空）；编辑表单「父任务」下拉（候选 = 未完成 / 未丢弃，排除自身 + 全部后代；含「—」；当前父项补入回显）。
- [x] Deliverable B · 项目内操作（`src/components/ProjectDetail.tsx` / `ProjectDetailModal.tsx` / `TaskDraftModal.tsx`）：任务行接通 `onOpen` → 就地打开任务详情；「添加任务到本项目，回车确认」→ 打开既有 `TaskDraftModal` 且 `projectId` 预填（`initialProjectId`；AI 不覆盖预填），确认后创建、可撤销；项目详情编辑 / 删除不变；覆盖层（任务 / 草稿）**替换呈现**，关闭回归项目。
- [x] 样式（`src/styles/views.css`）：`.k-subtasks` / `.k-subtask` / `.k-inline-add*`，token-only。
- [x] 验证：`.qa/v37/smoke-r3.mjs` 20/20（create/update 往返、自引用 / 非法 / `A→B→A` / 深层环 400 且不留半成品、同带 `parentTaskId`+`projectId` 落盘、审计、零残留 + 所有者未动）；`.qa/v37/verify-r3.py` 29/29（编辑设父 → 落盘；父详情列出子任务 → 就地打开 → 返回；quick-add 继承项目 → 撤销；项目任务行打开 → 返回项目；项目内新建草稿 `projectId` 预填 / 确认前零落盘 / 确认后入列表；390 可见 + 零横溢；控制台 0 error；零残留 + 所有者未动）。
- [x] 记录：新增 ADR-0017（`docs/decisions/0017-subtasks-and-project-actions.md`）；`docs/04` §4.2；`docs/README.md`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## 文件投递解析校准 + 资料简介 + 删除按钮修整 · Slice R2.5（已完成 · 2026-10-03）

以 owner 校准反馈为规格：①「丢入文件后，希望 AI 解析用于总结出简约的小结，用于资料详情页介绍这份资料，而不是拆分成一堆任务」；②「删除按钮的位置有点奇怪」。本切片把**文件条目**从 Slice R1 的「多动作一揽子」校准为 **「资料 + 简介」单一动作**（提示词 + `postValidateActions` 硬归一化双重保证），为**文本条目**补反过拆规则；资料详情页新增标题下的「简介」；收件箱展开区把删除推到动作行最右。`npm run build`（tsc strict + vite）通过；服务端冒烟 **31/31** + 浏览器 E2E **23/23**；零数据残留（inbox 12 / tasks 62 / notes 16 / resources 12 / projects 10；标签注册表回基线 26；所有者 i-0009..0012、t-0061/0062、rev-0001..0004、n-0016 未动）；控制台零 error；证据 `.qa/v36/`。

- [x] Deliverable A · 文件解析校准（`server/ai.mjs` / `schemas.mjs`）：`buildSystem(digest, hasFile)` 文件条目切换为「恰好 1 个 resource + 简介，绝不拆分」（禁 task/note/project 与任务字段）；`postValidateActions(actions, snapshot, { hasFile, fallbackTitle, fallbackNote })` 硬归一化（丢非 resource；`note` 折叠空白 + 截断 ≤120 + 文件名兜底）；`AI_RESOURCE_NOTE_MAX_CHARS` / `normalizeResourceNote` / `fileParseOptions`；同步 / 流式共用。文本条目保留多动作 + 反过拆规则（1–4 个；信息类优先 resource/note + 小结；仅明确可执行产出 task）。
- [x] Deliverable A · 写入路径（`server/index.mjs` / `schemas.mjs`）：`aiActionSchema` + `clarifyDetailsSchema` 增 `note`；`clarifyInbox` / `applyInboxActions` resource 分支写 `resource.note`（`kind:'file'` + `path` 与审计名不变）；apply 对文件条目纵深过滤（只留 1 resource，无可应用 → 400）。
- [x] Deliverable B · 资料简介展示（`src/views/Library.tsx` / `lib/aiForm.ts` / `components/AiSuggestionForm.tsx` / `AiActionsCard.tsx`）：详情弹窗标题下渲染安静「简介」区块（空则不渲染），编辑字段标签改「简介」；`AiAction.note` + `ACTION_FIELD_MATRIX.resource` 增「简介」+ textarea + 卡片小结展示。
- [x] Deliverable C · 删除按钮位置（`src/views/Inbox.tsx` / `styles/views.css`）：动作行与删除包进 `.ic-subrow__row`（flex），`.ic-lifecycle` `margin-left:auto` + 右对齐；1280 同行靠右、390 换行靠右、零横溢。
- [x] 验证：`.qa/v36/smoke-r3.mjs` 31/31（确定性层文件归一化 / normalizeResourceNote / 文本保留多动作 / note 仅 resource；真实 AI：上传 .txt → 1 resource + note、apply kind=file + path + note、resource.update note 往返、审计、文本多动作 ≥2；零残留 + 所有者未动）；`.qa/v36/verify-r25.py` 23/23（拦截 parse-stream → 卡片 1 资料 + 小结 + 编辑含简介 → 全部应用 → 详情简介在标题下且在类型区块前 → 删除按钮 1280/390 对齐 / 零横溢 → 控制台 0 error → 零残留 + 所有者未动）；截图 4 张。
- [x] 记录：ADR-0015 §5 修订；`docs/04` §4.9 / §4.13 / §4.14；`docs/README.md`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

---

## 项目诞生：聚类立项 + AI 自动化档位 · Slice R2（已完成 · 2026-10-03）

以 owner 提问「一个项目是怎么诞生的——连续输入多个类似任务会自动整合吗？项目里的子任务又怎么产生」为规格。Slice R1 回答了「一次性多条」，本切片补齐「**连续 / 累积的相似任务 → 新项目**」：新增**聚类立项**（确定性预分组 + AI 命名 + 一次建项归入 + 精确撤销）、**AI 自动化档位**（确认 ↔ 自动）、**AI 动态** 幕后日志。默认仍是**先确认后写入**；自动模式为显式 opt-in，且**只创建、永不删除 / 完成 / 归档**。`npm run build`（tsc strict + vite）通过；服务端冒烟 **44/44** + 浏览器 E2E **36/36**；零数据残留（inbox 12 / tasks 62 / notes 16 / resources 12 / projects 10；标签注册表回基线 26；`aiAutomation` 复位 `confirm`；所有者 i-0009..0012、t-0061/0062、rev-0001..0004、n-0016 未动）；控制台零 error；证据 `.qa/v35/`。

- [x] Deliverable A · 聚类立项（核心）：`collectClusterCandidates`（无 projectId 未完成任务 + 未澄清收件箱，≤50）/ `pregroupCandidates`（共享标签 ≥3 → 标题关键词（拉丁 + CJK 二元组，去停用词）≥3；每候选至多一组，成员 ≥3）/ `draftClusters`（AI 按组号命名 + `outcome`/`reason`；成员 id 服务端展开、**抗幻觉由构造保证**；失败 / 未覆盖用确定性名兜底）/ `postValidateClusters`（越界组 / <3 / 无任务 / 与现有项目同名丢弃；成员不跨提案复用；`areaId` 真实；标签 ≤3）；`POST /api/ai/cluster/draft` 返回 0–3 提案。
- [x] Deliverable A · 应用 / 撤销：`POST /api/projects/cluster-apply`（一次写入建项目 + 逐条归入无归属任务；审计 `project.create` · `via:'cluster'` + `task.update` · `via:'cluster'`；`clusterTaskIds`/`clusterTagIds` 撤销凭据）；`POST /api/projects/cluster-unapply`（清 `projectId` + `pruneTags` + 项目入回收站，**精确复原**）。收件箱条目不参与应用（无 `projectId` 结构），仅作命名参考。
- [x] Deliverable A · UI：`ClusterProposalCard`（标题 + 成员数 + 任务标题截断 + 相关条目 + 「创建并归入」/「忽略」）；Inbox 头部「发现项目」手动触发 + **每会话自动运行一次**（候选 ≥3 且无缓存，失败静默）；**只出建议，绝不自动建项**。
- [x] Deliverable B · AI 自动化档位：`config.json` 增 `aiAutomation`（默认 confirm）+ `POST /api/config`（白名单 + 审计 `config.update`）+ 设置页「AI 自动化」radio；`auto` 时捕捉自动解析完成后自动 `applyInbox`（仅创建类动作，空动作保留建议卡），toast「AI 已自动整理 N 项 · 撤销」（撤销 = `unapplyInbox`），失败静默回退。
- [x] Deliverable C · AI 动态：`AiActivityFeed`（读 `/api/activity` 过滤 AI / 自动条目，时间倒序，动作中文摘要 + 实体深链，上限 50，随 revision 刷新）置于设置「AI 自动化」下方。
- [x] Deliverable D · 自动化能力边界（不可违背）：自动模式只做 task/note/resource/project 的**创建** + 标签登记 + 关联；**永不**删除 / 完成 / 归档 / 修改既有实体；聚类立项**永远**只出建议。默认 confirm，auto 为显式 opt-in。
- [x] 验证：`.qa/v35/smoke-r2.mjs` 44/44；`.qa/v35/verify-r2.py` 36/36；控制台 0 error；零残留 + 所有者未动。
- [x] 记录：新增 ADR-0016（含能力边界表）；`docs/02`；`docs/04` §4.11；`docs/README.md`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

### Slice R2 · 聚类 vs 一揽子应用（两条「项目诞生」路径）

| | 一次性多条（Slice R1） | 连续累积（Slice R2） |
|---|---|---|
| 触发 | 一条内容解析出多动作 | 扫描无归属任务 / 未澄清条目 |
| 成员边界 | AI 从单条内容拆解 | 确定性预分组（共享标签 / 关键词 ≥3） |
| AI 角色 | 抽取动作 + 命名新项目 | 按组命名 + 写完成度定义 |
| 收件箱条目 | 被拆解应用（clarified） | 仅作命名参考，不落位 |
| 应用 / 撤销 | `inbox/:id/apply` / `unapply` | `projects/cluster-apply` / `cluster-unapply` |

## AI 全链 · 多实体一揽子处置 · Slice R1（已完成 · 2026-10-03）

以 owner 指令「我只负责往里面丢资料以及信息，你作为 AI 帮我做好幕后工作」为规格，修「需要做过多介入（手动建标签 / 项目）」的根因：一条内容此前只能解析出**一个**建议，而真实的一条通知常意味着「一件要推进的新事务 + 若干下一步 + 一份要点」。本切片把解析升级为**动作数组**（≤6）、新增**一揽子应用**（一次确认 → 先建项目、再落实体并自动挂接、标签登记）+ **精确撤销**（删产物 + 恢复标签注册表）、新增**项目快速新建 AI 草稿**。默认仍**先确认后写入**，不做自动应用。`npm run build`（tsc strict + vite）通过；服务端冒烟 **39/39** + 浏览器 E2E **36/36**（含路由拦截的确定性多动作流 + 真实 AI 多动作一次 + 项目草稿流）；零数据残留（inbox 12 / tasks 62 / notes 16 / resources 12 / projects 10；标签注册表回基线 26；所有者 i-0009/0010/0011/0012、t-0061/0062、rev-0001..0004、n-0016 未动）；控制台零 error；证据 `.qa/v34/`。

- [x] Deliverable A · 多实体抽取：`aiActionSchema`（`kind` = task/note/resource/project；task 全字段 / project `outcome` / task·note `linkToNewProject`）+ `aiActionsSchema`（≤6）+ `inboxApplySchema`；`buildSystem` 改多动作提示词；`postValidateActions()`（快照过滤臆造 id、标签 ≤3、至多一个项目、同名现有项目丢弃、linkToNewProject 与 projectId 互斥、统一补 contexts）；`legacyToActions()`（旧单建议 → 动作数组，newProjectHint → 项目动作 + linkToNewProject）；`tryParseActions()` 兼容两形状，同步 / 流式共用，响应 `{ actions, model, ms }`。
- [x] Deliverable B · 批量应用：`POST /api/inbox/:id/apply { actions }`——服务端重新校验 + 关联 id 存在性；先建项目（`project.create` · via `inbox.apply`）再落实体（自动挂接 / `sourceInboxId` / 文件 `path`）；标签 `origin:'ai'` 登记；条目 `clarified` + `linkedId`/`linkedIds`/`appliedTagIds`；审计 `inbox.apply` + 各实体 `*.create`。
- [x] Deliverable C · 撤销：`POST /api/inbox/:id/unapply`（与扩展 `revert` 共用 `detachInbox`）删 `linkedIds` 全部产物 + `pruneTags(appliedTagIds)`（`store.mjs`，删除未再使用的本次新标签）→ 条目回 `unprocessed`；修复 Slice V 单 `linkedId` 对多产物不够。
- [x] Deliverable D · 项目草稿：`POST /api/ai/project/draft { title }`（不落盘）+ `projectDraftSchema`；`POST /api/projects` 扩展接受 `outcome`/`areaId`/`tags`（缺省不变；`ai:true` → origin ai）；前端 `ProjectDraftModal.tsx`（镜像 TaskDraftModal）；Projects 页快速新建接入。
- [x] Deliverable E · 前端处置卡：`AiActionsCard.tsx`（勾选 + 按 kind 编辑 + 页脚「全部应用（N 项）」/「重新解析」/「忽略」；toast「已应用 N 项 · 撤销」→ `unapplyInbox`）；`mutations.ts` 增 `AiAction`/`applyInbox`/`unapplyInbox`/`aiProjectDraft` + 扩展 `createProject`；`aiForm.ts` 增 `outcome` + `ACTION_FIELD_MATRIX` + `actionToForm`/`formToAction`；`AiSuggestionForm` 渲染 `outcome`；`Inbox.tsx` 接入。
- [x] Deliverable F · 去重与一致性：`postValidateActions` 保证至多一个项目动作、同名现有项目丢弃、linkToNewProject 与 projectId 互斥；`newProjectHint` 仅作为旧形状输入，归一化为项目动作（不再双路径）；Slice V 的删除 / 恢复 / 撤回 / 字段矩阵全部保留。
- [x] 验证：`.qa/v34/smoke-r1.mjs` 39/39（双形状 + 归一化 + 臆造过滤；apply 往返 1 项目 + 2 任务 + 1 笔记 + 1 资源含挂接 + 标签登记 + 审计；unapply 精确复原计数与注册表；revert 多产物；扩展项目创建；项目草稿；零残留 + 所有者未动）；`.qa/v34/verify-r1.py` 36/36（拦截合成 SSE → 3 可编辑动作 → 全部应用 → 撤销复原；项目草稿弹窗；真实 AI 多动作（容忍）；移动 390；控制台 0；零残留 + 所有者未动）。
- [x] 记录：新增 ADR-0015；`docs/02`；`docs/04` §4.1 / §4.3 / §4.14 / §5.1；`docs/README.md`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

### Slice R1 · 动作 kind × 应用字段矩阵

| kind | UI 展示 / 落盘字段 | 备注 |
|---|---|---|
| task | title / contexts / tags / energy / importance / estimateMin / dueAt / projectId（或 linkToNewProject）/ areaId | 全字段；新建 `status:'next'` + `sourceInboxId` |
| note | title / tags / projectId（或 linkToNewProject）/ areaId | `type:'fleeting'`，`body` = 条目原文 |
| resource | title / tags / areaId | 文件条目 `kind:'file'` + `path` |
| project | title / outcome / tags / areaId | 新建 `status:'active'`，先于实体创建；至多 1 个 |
| （旧形状）discard | 无 | 归一化为 `actions: []` |

## 收件箱生命周期闭合 + 澄清字段矩阵 · Slice V（已完成 · 2026-10-03）

以 owner 面向的「碎片化 / 摩擦」审计为规格，修五组问题：①（F2）文本捕捉后不自动 AI 解析，与文件投递节奏不一致；②（F34）删除端点无 UI 入口、附件无法清理；③（F15/F37）已丢弃 / 已澄清条目 toast 消失后无出口；④（F16/F30）`newProjectHint` 不能一键建项；⑤（F19/F31）target=note/resource 时仍渲染任务专属字段，**编辑被静默丢弃**。不新增端点，复用既有 `remove` / `revert` / `clarify` / `projects`。`npm run build`（tsc strict + vite）通过；服务端冒烟 **43/43** + 浏览器 E2E **29/29**；零数据残留（inbox 回到基线 12 条；回收站 0；所有者 i-0009/i-0010、t-0061/t-0062、rev-0001/rev-0002 未动）；控制台零 error；证据 `.qa/v33/`。

- [x] Deliverable A · F2 捕捉即解析：`Inbox.captureText` 捕捉成功后 `runParseSilent(item)`——先探活 `/api/ai/health`，离线 / 失败静默跳过（不展开面板、不刷错误 toast）；在线复用 `runParse` + `aiParseInboxStream` + `inboxAi` 缓存（与文件投递同节奏）；绝不自动应用；手动「AI 解析」保留。
- [x] Deliverable B · F34 删除入口：`src/lib/mutations.ts` 新增 `removeInbox(id)`（既有端点，服务端一并清理附件）；未澄清展开区 + 已丢弃行提供「删除」，内联二次确认 + toast；已澄清由服务端 409 保护。
- [x] Deliverable C · F15/F37 生命周期闭合：丢弃行「恢复」、澄清行「撤回」均复用 `revertInbox`（discarded 仅重置 status；clarified 删除产物）；澄清行「查看产物」经 `relations.ts` `deepLinkOfId()` 按 `linkedId` 前缀深链（无产物禁用）；撤回带确认。
- [x] Deliverable D · F16/F30 一键建项：`AiReadyCard` 在 `newProjectHint` 且目标为任务时显「创建项目「X」」→ `createProject(hint)` → toast（可「查看」深链）+ 自动填入建议表单 `projectId`（仍需点「应用建议」才挂接，绝不自动应用条目）。
- [x] Deliverable E · F19/F31 字段矩阵：`src/lib/aiForm.ts` `CLARIFY_FIELD_MATRIX`（task 全字段 / note→title,tags,projectId,areaId / resource→title,tags,areaId / discard→无）；`AiSuggestionForm` 增 `fields` 按 target 条件渲染；`AiReadyCard` 阅读态同步条件化；`toClarifyDetails` 按 target 只挑会应用的字段。服务端对齐：`clarify` note 分支接受 `projectId/areaId`、resource 分支 `title` 对文件条目同样应用 + 接受 `areaId`（均真实存在校验）。
- [x] Deliverable F · 样式：`views.css` 新增 `.k-inbox-item__actions` / `.ic-lifecycle` / `.ic-confirm` / `button.k-pill.is-danger` / `.ic-ai__newproject`，token-only。
- [x] 验证：`.qa/v33/smoke-v.mjs` 43/43（remove 往返 + 附件 200→404、discarded 恢复往返、clarified 撤回往返 + 已澄清 remove 409、note/resource 字段矩阵真实落盘、零残留 + 所有者未动）；`.qa/v33/slice-v-verify.py` 29/29（自动解析、删除确认离场、丢弃行恢复/删除、澄清行深链/撤回、一键建项、字段矩阵、移动 390、控制台 0、零残留）；截图 4 张。
- [x] 记录：ADR-0008 §6 修订；`docs/02`；`docs/04` §4.1 / §4.13 / §5.1；`docs/README.md`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

### Slice V · target × 可编辑字段 × 服务端应用矩阵

| target | UI 展示字段 | 服务端实际应用 |
|---|---|---|
| task | title / contexts / tags / energy / importance / estimateMin / dueAt / projectId / areaId | 全部（同左） |
| note | title / tags / projectId / areaId | 全部（同左；无任务专属轴） |
| resource | title / tags / areaId | 全部（同左；title 对文件条目也生效） |
| discard | 无 | 仅置 `status:'discarded'`（不产 `details`） |
| project（手工芯片） | —（AI 建议不含 project） | 忽略 `details`，`outcome` 待整理 |

## 回顾报告可读性 · 同期口径 · 去重 · Slice U（已完成 · 2026-10-03）

以 owner 反馈「生成的报告可读性太差」为规格：① 七段正文被塞进一个大 textarea 当一整块密文；② 进行中的月回顾拿「本月 3 天」比「上月整月」（苹果对橘子）；③「下期行动」段与决策列表逐字重复。`npm run build`（tsc strict + vite）通过；服务端冒烟 **23/23** + 纯函数单测 **25/25** + 浏览器 E2E **32/32**；零数据残留（回顾回到基线 2 条；所有者 rev-0001/rev-0002、t-0061/t-0062、i-0009/i-0010 未动）；控制台零 error；证据 `.qa/v32/`。

- [x] Deliverable A1 · 分节解析：`src/lib/reviewReport.ts` `parseReviewSummary()` 拆七段（兼容「结论速览：」与「一、结论速览」；别名归一；无法识别时回退整段），与 `server/ai.mjs` 同源。
- [x] Deliverable A2 · 阅读视图（默认）：`Review.tsx` 报告弹窗默认分节渲染（序号 + 标题 + 段落，行距 1.75 / 测度 68ch，纯文本无 HTML 注入）；底栏「编辑」→ textarea、「完成」→ 回阅读；保存 / 重新生成 / 报告历史只读复用同一视图；样式 token-only。
- [x] Deliverable B1 · 同期口径：`reviewWindows()` + `computeSameWindowPrevMetrics()`——月 1..N ↔ 上月 1..N（短月截断）、周至今 ↔ 上周同期；`generateReviewDraft` 改用之，摘要标「上X同期」+ 窗口日期，`<7 天`追加【窗口说明】且禁止以「窗口仅 N 天」开场。
- [x] Deliverable B2 · 去重：`dedupeActionSection()` 第 6 段替换为「见决策区（N 条）」指针，完整 if-then 仅在 `decisions`。
- [x] Deliverable B3 · 可读性规则：`formatDelta()` 基准 ≥5 才出百分比；digest 清单「标题（id）」标题优先；prompt 增补标题优先 / id 仅 decisions 括号补充规则。
- [x] 验证：`.qa/v32/guard-unit.mjs` 25/25、`smoke-u.mjs` 23/23（真实 monthly 一次）、`slice-u-verify.py` 32/32（默认阅读视图 / 编辑切换 / 保存更新同条 / 历史渲染 / 删除回基线 / 移动 390 / 控制台 0 / 零残留）；截图 4 张。
- [x] 记录：ADR-0013 §6 修订；`docs/04` §4.10；`public/guide.html`；`CHANGELOG.md`、`TASK_BOOK.md`、`AGENTS.md`。

## 标签生命周期（录入即生成 · 自动登记 · 管理 / 合并 / 删除 · 筛选条修正）· Slice T（已完成 · 2026-10-03）

以 owner 两条指令为规格：①「对于标签这种，没有生成由来，如果投入使用那不是用户使用体验崩塌吗」②「类似于标签你完全可以在录入任务的时候判断后生成标签，但是你却没有做这一步」。此前标签无生命周期：注册表只由 seed 写、运行时新标签只落实体不登记、AI 被禁止生标签、筛选条截断前 12、无管理入口。`npm run build`（tsc strict + vite）通过；服务端冒烟 **54/54** + 护栏单测 **14/14** + 浏览器 E2E **41/41**；零数据残留（inbox 10 / tasks 62 / projects 10 / notes 15 / resources 12 / tags 26；所有者 t-0001 未动）；控制台零 error；证据 `.qa/v31/`。

- [x] Deliverable A1 · 规格化：`server/store.mjs` 新增 `normalizeTagName()` / `normalizeTagList()`（裸名 → `topic:` 前缀、`@` → context、合法前缀保留、空串丢弃）；实体写入前统一规格化，保证与注册表 / 筛选条同名匹配。
- [x] Deliverable A2 · 录入即生成：`ensureTags(names, {origin, firstUsedIn})` 在任意携带 tags 的写入后登记未注册名（注册项增 `origin/createdAt/firstUsedIn`；原子写 + 审计 `tag.create`）；接入任务创建 / 更新、澄清 `details.tags`、项目创建 / 更新、笔记创建 / 更新、资料更新；请求 `ai:true` → `origin:'ai'`；`seed.mjs` 同步补 `origin:'seed'`。
- [x] Deliverable A3 · AI 生标签：`buildSystem` / `buildTaskDraftSystem` 允许提议 `topic:名称`（≤12 字、≤3、去重、禁日期 / 人名 / 整句）；`postValidate` 改 `cleanTagSuggestions()` 规格化保留（不再过滤注册表外名，臆造 id 规则不变）；修复收件箱 `toClarifyDetails` 漏传 tags。
- [x] Deliverable A4 · backfill：`POST /api/tags/backfill` 扫描 `tasks/projects/notes/resources/events` 未注册名并登记（`firstUsedIn` 取首个使用实体；审计 `tag.create` + `tag.backfill`）；设置页「扫描并登记」按钮。
- [x] Deliverable B1 · 管理区：`src/components/TagManager.tsx` + Settings「标签管理」——列出全部标签（label / name / namespace / 来源徽标 / 使用计数 / 登记时间）、可搜索；quiet token-only。
- [x] Deliverable B2 · 操作：重命名（`POST /api/tags/:id/update`，级联；`tag.rename`）、合并（`…/merge`，级联去重 + 源移除；`tag.merge`）、删除（`…/remove`，使用中 409 阻止给计数；`tag.remove`）；均带确认；级联**不 bump updatedAt**。
- [x] Deliverable C · 筛选条：`src/views/Library.tsx` 去 `.slice(0,12)`、按使用计数降序、订阅 revision；`src/lib/format.ts` `tagLabel` 运行时读注册表 + `TAG_ORIGIN_LABEL`；`src/lib/mutations.ts` `renameTag/mergeTag/removeTag/backfillTags` + `TaskCreateInput.ai`；`src/types.ts` `TagItem` 扩字段。
- [x] Deliverable D · 文档：新增 ADR-0014；`docs/02` §3.2 / §4.3；`docs/04` §4.11 / §4.12 / §9；`docs/README`；`public/guide.html`；`CHANGELOG.md`、`AGENTS.md`。

### Slice T · 标签来源语义

| origin | 含义 | 产生路径 |
|---|---|---|
| `seed`（缺省） | 种子内置 | `scripts/seed.mjs`（旧记录无字段，UI 视作种子） |
| `manual` | 用户录入 / 存量扫描 | 任务 / 项目 / 笔记 / 资料写入、`backfill` |
| `ai` | AI 提议并应用 | 收件箱澄清 `ai:true`、任务草稿确认 `POST /api/tasks { ai:true }` |

### Slice T · 已知取舍

- 级联（重命名 / 合并）只改 `tags` 数组、不 bump `updatedAt`——避免污染停滞项目 / 回顾「最近活动」口径。
- 文件式 JSON 无跨文件事务：级联先改实体后写注册表，崩溃残留可由 `backfill` 收敛；登记失败不阻断实体写入，同样由 `backfill` 兜底。
- `events` 无服务端写端点，不纳入「录入即生成」写入路径，仅在管理级联 / 计数中包含。

---

## 回顾报告升级 + 每次生成自动归档 · Slice L（已完成 · 2026-10-03）

以 owner 两条指令为规格：①「这些报告都不够详细，需要调研如何才能将报告写得有价值和有参考以及指导性意见」+「以及通俗易懂」；②「每次生成的报告都进行归档整理，按照时间进行保存，保存后可以在某个地方进行查阅」。`npm run build`（tsc strict + vite）通过；服务端冒烟 **40/40** + 护栏单测 **6/6** + 浏览器 E2E **32/32**；零数据残留（回顾回到基线 2 条；所有者 rev-0001/0002、t-0061/t-0062、i-0009/i-0010 未动）；控制台零 error；证据 `.qa/v30/`。

- [x] Deliverable A1 · 输入侧加料（`buildReviewDigest`）：上一周期指标 + 环比（`now` 落周期起点前 1ms 回退一周期，复用 `computeWeekMetrics` / `computeMonthMetrics`）；习惯「近 7 天 / 上 7 天 / 连续未达标周数」；完成 / 逾期 / 停滞清单带 id；显式阈值常量。
- [x] Deliverable A2 · 七段报告指令（`buildReviewSystem`）：结论速览 → 数据解读 → 趋势对比 → 问题诊断 → 值得保留 → 下期行动 → 风险预警；硬性规则（只用摘要数字 / 对象、每个判断带证据、绝对值带基准、禁套话、行动 if-then 含时间与完成标准、数据不足如实写、鼓励不确定性）+ 弱 / 强例对照；`decisions` 1–3 条 if-then；`staleAdvice` 不变。
- [x] Deliverable A3 · 数字落地护栏（`auditNumbers` / `extractQuantities`）：数字子集 + 派生（加减 / 百分比）+ 结构小数字 + 年份；越界单次纠正重试，仍越界保留并记录；服务端后校验再截断 summary ≤2000 / decisions ≤3×200。
- [x] Deliverable A4 · 前端渲染：报告正文按段渲染为独立区块（段首小标题，纯文本）；编辑区加高；弹窗沿用 `.k-modal--report`。
- [x] Deliverable B1 · 自动归档：`POST /api/ai/review/draft` 成功即 `commit('reviews', …)`（`source:'ai'`、`date`=归档时刻、审计 `review.create` · `auto`）；响应附 `reviewId`；每次生成 = 新版本。
- [x] Deliverable B2 · 更新同条：新增 `POST /api/reviews/:id/update`（白名单 summary / decisions，递增 `updatedAt`，审计 `review.update`）；「保存回顾」不再重复建记录。
- [x] Deliverable B3 · 报告历史：回顾页 `REPORT ARCHIVE` 栏按 `date` 倒序；点开只读弹窗；可删除（`review.remove`）；生成后 `hydrateFromServer()` 即时出现。
- [x] Deliverable C · 文档：ADR-0013（新）、ADR-0007 §7 修订指针、`docs/02` §4.3、`docs/04` §4.10 / §9、`docs/README`、`public/guide.html`、`CHANGELOG.md`、`AGENTS.md`。

### Slice L · 报告结构对照（弱 → 强）

| 维度 | 升级前 | 升级后 |
|---|---|---|
| 长度 / 结构 | ≤200 字单段 | 七段结构，每段结论式标题（≤800 字） |
| 数字依据 | 只有本期绝对值 | 本期 + 上期 + 环比（带对比基准） |
| 对象引用 | 纯标题 | 带 id（`t-xxxx` / `p-xxxx`）+ 天数 |
| 判断 | 「推进顺利」类套话 | 现象 → 原因 + 数据证据 |
| 行动 | 「聚焦 / 处置」 | if-then：做什么 + 何时 + 完成标准 + 绑定对象 |
| 风险 | 无 | 越线阈值 + 触发对象 |
| 幻觉防护 | 无 | 数字子集护栏 + 单次纠正重试 |
| 留档 | 需手动保存，只留最新 | 生成即自动归档，按时间查阅 / 可删除 |

### Slice L · 环境说明（并发使用）

测试期间所有者（或并发进程）同时在用应用生成归档报告。E2E 已改为**只跟踪并清理本次运行新增的 `review` id**，绝不删除基线已有记录；最终状态还原到提交基线（回顾 2 条）。详见 `CHANGELOG.md` 与最终报告。

---

## 全站详情「居中弹窗」统一 + 操作统一 + 日历遮罩柔化 · Slice K（已完成 · 2026-10-03）

以 owner 四条指令为规格：①「所有的卡片都是居中弹窗样式」——笔记等详情仍是侧边抽屉；②「弹窗不是说要优化为屏幕居中弹窗详情页吗，怎么没优化」——日历事件详情仍是侧边抽屉；③「除了标记为完成后，编辑、删除按钮等没有出现，不能进行常规操作，全系统统一审阅后处理」——总览就地弹窗缺常规操作；④「这个地方遮罩不太自然，优化一下」——日历吸顶日期条。`npm run build`（tsc strict + vite）通过；浏览器 E2E **109/109**；零数据残留（计数回到基线：收件箱 10 / 任务 62 / 项目 10 / 笔记 15 / 资料 12 / 回顾 2 / 回收站 0；所有者 t-0061/t-0062 与 i-0009/i-0010 未动）；控制台零 error；证据 `.qa/v29/`。

- [x] Deliverable 1 · 五类详情从右侧 `Drawer` 迁到居中 `Modal`：任务 / 项目 / 笔记 / 资料 / 日程统一由 `src/components/Modal.tsx` 承载，新增尺寸变体 `.k-modal--detail`（`min(660px, 100vw-32px)`、`max-height ~85vh`、内容内滚、≤640px 全宽 16px 边距）。同触发（行点击 + 全部深链）、同 ESC / 遮罩 / 焦点圈闭 + 还原、关闭清挂载参数。
- [x] Deliverable 2 · 操作矩阵统一：抽出 `src/components/TaskDetailModal.tsx`（标记完成 / 取消完成 · 查看项目 · 编辑 · 删除）与 `src/components/ProjectDetailModal.tsx`（编辑 · 删除），Tasks / Projects 页与总览就地弹窗**共用同一组件**——动作一致由构造保证。笔记（编辑 / 删除 / 蒸馏快捷设置）、资料（编辑 / 删除 / 状态快捷设置 / 打开文件 · 位置）保留；删除沿用回收站 + 撤销 toast，编辑沿用 `EntityEditForm`。
- [x] Deliverable 3 · 底栏统一：`.k-modal__foot-main`（左，主操作）+ `.k-modal__foot-actions`（右，编辑 / 删除）集中到 `shell.css`，删除 `.k-drawer__foot-*` 与总览借用抽屉类的补丁规则。
- [x] Deliverable 4 · 日历吸顶遮罩柔化：`.k-cal__bar` 保持 sticky（`top: var(--topbar-h)`），其下以 `::after` 叠 `--bg → transparent` 渐隐层（高 `--space-4`，`pointer-events:none`），替代原本平铺色带的「一刀切」硬横线。
- [x] Deliverable 5 · 退役死代码：删除 `src/components/Drawer.tsx` 与全部 `.k-drawer*` 样式 / `.k-drawer-scrim`；容器名 `drawer → modal`；删除 `--drawer-w` / `--z-drawer` token（批条侧挂 dock 改挂 `--z-overlay - 1`）。
- [x] 关键修复（E2E 发现）：`Modal` 改为 `createPortal` 到 `document.body`——此前详情弹窗挂在 `.k-route`（`container-type: inline-size` 含 layout containment）之下，`position: fixed` 的包含块被改成该祖先，重载 / 滚动时不再相对视口居中（深链场景偏 48px、纵向越界）。
- [x] 验证：`.qa/v29/slice-k-verify.py` **109/109**——每类表面行点击 + 深链均 `role=dialog` 居中弹窗、DOM 无 `.k-drawer`、水平居中偏差 ≤2px、在视口内；任务完成切换 / 编辑保存 / 删除 + 撤销、项目编辑 / 删除 + 撤销、笔记 / 资料编辑 / 删除 + 撤销、资料状态快捷设置写入、资料文件动作存在、总览任务 / 项目弹窗动作齐备（点编辑出表单）、移动 390 零横溢、ESC 关闭 + 焦点还原 + URL 参数清除、控制台 0、零残留 + 所有者数据未动；日历吸顶条贴顶 + before/after 对照截图。
- [x] 记录：ADR-0012；`CHANGELOG.md`；`AGENTS.md`；`docs/00 §5.6`、`docs/03 §5/§7/§9`、`docs/04`、`docs/05`、`docs/08 §5/§6`、`docs/README.md`；`public/guide.html`（抽屉 → 弹窗措辞 + 演示底栏补编辑 / 删除）。

### Slice K · 全站详情表面审计（承载 + 操作矩阵）

| 表面 | 原承载 | 原操作 | 处置 |
|---|---|---|---|
| 任务详情（Tasks 页 / 总览就地） | Tasks 抽屉 / 总览弹窗 | 抽屉完整；总览仅 标记完成 / 查看项目 | **fixed**：统一 `TaskDetailModal`；两处均 标记完成 / 取消完成 · 查看项目 · 编辑 · 删除 |
| 项目详情（Projects 页 / 总览就地） | Projects 抽屉 / 总览弹窗 | 抽屉 编辑 / 删除；总览**无动作** | **fixed**：统一 `ProjectDetailModal`；两处均 编辑 · 删除 |
| 笔记详情（Library） | Library 抽屉 | 编辑 / 删除 / 蒸馏快捷设置 | **fixed 承载**：迁居中弹窗（操作不变） |
| 资料详情（Library） | Library 抽屉 | 编辑 / 删除 / 状态快捷设置 / 打开文件 · 位置 | **fixed 承载**：迁居中弹窗（操作不变） |
| 日程详情（Calendar） | Calendar 抽屉 | 无（只读） | **fixed 承载**：迁居中弹窗；操作仍只读 |
| 回顾报告（Review） | 居中弹窗 | 编辑草稿 → 保存 | **leave**：本就是居中弹窗，动作符合 |

### Slice K · 延后（结构性缺口）

- **日程（event）可写**：`events` 仍不在 `SCHEMAS` / `EDITABLE_KINDS` / `ID_PATTERNS`，无创建 / 编辑 / 取消路径；本切片保持只读，未新增可写实体（延后至「事件可写」切片）。
- 区域 / 目标 / 习惯管理、回顾编辑、收件箱内容编辑入口、标签注册表管理：同 ADR-0011 §5，继续延后。

---

## 先确认后写入 · Slice O（已完成 · 2026-10-03）

以 owner 两条强制指令为规格：① 任务快速新建「输入你好后没经过 AI 建议我确认然后直接入库，这是不行的」——**确认前绝不写库**；②「AI 初步处理后需要给到我充足的编辑以及操作空间，每个类似的地方都要这样」——凡 AI 产出即先可编辑、确认、再落盘，「先确认后写入」列为统一模式。`npm run build`（tsc strict + vite）通过；服务端冒烟 **35/35** + 浏览器 E2E **31/31**；零数据残留（计数回到基线：收件箱 10 / 任务 62 / 项目 10 / 笔记 15 / 资料 12 / 回顾 2 / 回收站 0；所有者 t-0061/t-0062「你好」与 i-0009/i-0010 未动）；控制台零 error；证据 `.qa/v28/`。

- [x] Deliverable A · 任务快速新建草稿确认弹窗：回车 → 居中弹窗 `TaskDraftModal.tsx`（复用 `Modal.tsx`，`.k-modal--compose`）→ 打开即 `POST /api/ai/task/draft` → 全部字段可编辑（`AiSuggestionForm`，两列宽松网格）→ 用户点「创建任务」才写。**标题永不被 AI 改写**；AI 返回时跳过用户已改字段（`touchedRef`）；ESC / 遮罩 / 取消零写入；AI 失败不阻断创建（空白走默认）。成功 toast「已创建任务 · 撤销」（撤销＝移入回收站）。
- [x] 服务端 `POST /api/tasks` 扩展：`taskCreateFieldsSchema`（可选白名单 `contexts/energy/importance/estimateMin/dueAt/projectId/areaId/tags`，与澄清覆盖同口径）；关联 id 形状 + 存在性校验（臆造 400）；缺省默认不变；审计 `task.create.detail.fields`。仅传 `{title}` 行为不变。
- [x] Deliverable B · 收件箱建议卡可编辑：`AiReadyCard` 增「编辑」开关 → 目标（task/note/resource/discard）+ 全字段表单（`AiSuggestionForm`）；应用提交**当前编辑值**走既有 `clarify`（`details` + `ai:true` 不变）；忽略 / 重新解析语义不变（重新解析重置为全新建议）；编辑为客户端态，应用前不落盘；批量继承组件、互不干扰。
- [x] 共享层：新增 `src/lib/aiForm.ts`（表单值类型 + 4 个换算函数）、`src/components/AiSuggestionForm.tsx`、`src/components/TaskDraftModal.tsx`；`mutations.createTask` 改 `TaskCreateInput`。
- [x] 退役旧路径：删除任务页创建后内联建议面板与 `.k-ai-draft*` 全部样式（角色被弹窗取代）。
- [x] 验证：`.qa/v28/smoke-o.mjs` **35/35**；`.qa/v28/slice-o-verify.py` **31/31**（核心断言「弹窗打开后、确认前快照计数完全不变」；AI 就绪 → 编辑 importance=3 → 创建带编辑值 + 审计；ESC 取消零写入；收件箱编辑目标/标题/重要性 → 应用带编辑值 + `inbox.clarify.task ai:true`；移动 390 零横溢；控制台 0；零残留）。
- [x] 记录：ADR-0011 §6 修订；`docs/02 §3.2 / §4.3`；`docs/04 §9`；`docs/05`；`public/guide.html`；`CHANGELOG.md`；`AGENTS.md`。

### Slice O · 「每个类似的地方」AI 产出消费面审计

扫描全部「AI 输出被消费」的表面，判断「提交前是否可编辑」，并记录处置。

| 表面 | 提交前可编辑？ | 处置 |
|---|---|---|
| 收件箱 AI 建议卡（`AiReadyCard`，单条 + 批量） | 否（原：只读 chips + 应用） | **fixed**：增「编辑」开关 + 全字段表单（目标/标题/上下文/标签/能量/重要性/预估/截止/项目/区域），应用提交编辑值 |
| 任务快速新建 AI 补全（Slice H 内联面板） | 否（原：创建即时完成，建议事后应用） | **fixed**：改为创建前草稿确认弹窗，全字段可编辑；确认前零写入 |
| 回顾报告弹窗（周 / 月总结 + 决策） | 是（摘要 / 决策为可编辑 textarea，确认后保存） | **leave**：本就符合「先编辑后保存」，确认并保留 |
| 总览 AI 对话盒 | 不适用（读库自然语言回答，**无提交动作**） | **n/a**：不落盘，无「确认写入」环节 |
| `newProjectHint`（建议新项目） | 否（提示文本） | **fixed**：作为收件箱建议卡字段，随卡「编辑」可改标题 / 目标；仍仅提示、不自动创建项目 |
| 项目快速新建（`Projects.tsx`） | 不适用（**无 AI 处理**，仅标题即时创建） | **out of scope**：owner 指令针对「AI 初步处理后」；无 AI 步骤即不适用，保持即时创建（已在 CHANGELOG 记录理由） |

---

## 收件箱附件「打开文件 / 位置」· Slice J2（已完成 · 2026-10-03）

以 owner 反馈为规格：收件箱点附件「查看文件」得到浏览器下载，而不是用本地默认程序打开文件 / 定位到文件管理器（「点击查看文件是直接给我下载而不是打开文件夹对应位置或者打开本地文件给到我」）。`npm run build`（tsc strict + vite）通过；服务端冒烟 **33/33** + 浏览器 E2E **21/21**；零数据写入（前后快照计数一致、trash 0、i-0009/i-0010/i-0011 未变、`data/files/` 无增删）；控制台零应用 error；证据 `.qa/v27/`。

- [x] 根因确认：`Inbox.tsx` 附件行是 `<a href="/api/files/:id" target="_blank">查看文件</a>`；`serveFile` 的 `Content-Disposition: inline` 对 `.docx` 等不可内联类型无效，浏览器一律下载。
- [x] 服务端：抽 `spawnDetached` / `statLocalPath` 共用助手，`/api/reveal` 复用；新增 `POST /api/open`（`cmd /c start "" "<path>"` → 默认程序）与 `POST /api/inbox/:id/open|reveal`（服务端解析 `data/files/<id>-<name>`，三重校验，404 可读）；`/api/inbox/:id/(open|reveal)` 与 `/api/open` 均支持 `{dryRun:true}`——仅解析校验、绝不 spawn（测试专用）。
- [x] 前端：附件行改「打开文件」+「位置」两个 `.k-pill.is-ghost`（`FileText` / `FolderOpen`），失败 toast；`mutations.ts` 新增 `openInboxFile` / `revealInboxFile` / `openPath`；移除 `.ic-file-link` 死样式。
- [x] 资源对齐：`Library.tsx` 资料抽屉「文件位置」补「打开文件」（`/api/open`）。当前无带 `path` 的资源，按钮未被 E2E 触达（不为此写 owner 数据）。
- [x] 验证：`.qa/v27/smoke-j2.mjs` 33/33（含 `/api/open` dryRun 200 + 缺失/空路径失败分支 404/400）；`.qa/v27/slice-j2-verify.py` 21/21（Playwright 拦截 open/reveal/api/open，绝不真正 spawn；成功 / 失败 toast；移动 390 零横溢；零写入）。
- [x] 记录：ADR-0008 §4 修订；`docs/04 §4.1`；`CHANGELOG.md`；`AGENTS.md`。
- **已知边界 / 延后**：`GET /api/files/:id` 保留但 UI 不再引用（未来如需浏览器内预览可复用）；Windows 专属（`explorer.exe` / `cmd start`），非 Windows 平台未适配（本项目仅本地 Windows）；`/api/open` 与 `/api/reveal` 仅本机可达（服务绑定 `127.0.0.1`），不新增暴露面。

---

## 收件箱修复包 2 · Slice J（已完成 · 2026-10-03）

以 owner 两条反馈为规格：① 批量 AI 解析后切页再回来「一切回到原始状态」；② 上传 `.docx` 后「连文件都阅读不来」（AI 只说无法读取 / 仅凭文件名判断）。`npm run build`（tsc strict + vite）通过；服务端冒烟 **14/14** + 浏览器 E2E **16/16**；零数据写入（前后快照计数一致、trash 0、i-0009/i-0010 JSON 完全未变）；控制台零 error；证据 `.qa/v26/`。

- [x] 根因确认（Bug 1）：`batchAi` 进度与面板为 `Inbox.tsx` 组件级 `useState`，卸载即丢；建议缓存虽为模块 Map 存活，但列表对缓存条目**无任何标记**，需手动再点「解析」才出卡 → 观感「没解析过」；且无模块级运行守卫（可重复启动）。
- [x] 根因确认（Bug 2）：`server/ai.mjs buildFileSection` 仅对 `TEXT_EXTS` / `text/*` 摘录；`.docx` 是 ZIP 二进制 → 走元数据回退（`FILE_UNREADABLE_HINT`）。
- [x] Bug 1 修复：新 `src/lib/inboxAi.ts`（模块级 store + `useSyncExternalStore`），批量任务 / 流式 ~100ms 节流 / 建议缓存 / 完成播报全部跨路由存活；`Inbox.tsx` 改为只读快照 + 派发展开 / 滚动 / 播报。切页期间批量继续；返回见真实进度 + 活跃项「解析中」+ 完成项「AI 建议就绪」标记；批量动作据 `running` 禁用（切页回来重选仍禁用）；完成播报一次；缓存命中点击「AI 解析」不重解析（强制走「重新解析」）。
- [x] Bug 2 修复：`server/ai.mjs` 无依赖最小 ZIP 读取器 + OOXML 抽取（`.docx` 必做，`.pptx` / `.xlsx` 同机制附带）；失败维持既有回退 + 5MB 上限；同步 / 流式共用。
- [x] 验证：`.qa/v26/smoke-j.mjs` 14/14（合成 docx method 8/0 + 探针命中 + 实体解码 + `buildFileSection` 摘录 + 伪 docx 回退 + 零残留）；`.qa/v26/slice-j-verify.py` 16/16（选 2 条 → 批量 → SPA 切 /tasks → 回 /inbox：状态未重置、运行中批量全禁用、返回后重选仍禁用、两条目均出标记、展开缓存 3ms、控制台 0、移动 390 零横溢、零写入、i-0009/i-0010 未变）；所有者真实 docx 只读抽取 1118 字。
- [x] 记录：ADR-0008 §4 修订（批量状态持久化 + OOXML）；`docs/05`（`inboxAi.ts`）；`CHANGELOG.md`；`AGENTS.md`。
- **已知边界 / 延后**：`.pptx` / `.xlsx` 抽取仅轻量覆盖（xlsx 仅共享字符串表、pptx 按 slide 序号拼接 text），未做表格结构 / 单元格定位；PDF 仍仅元数据（非目标）；F5 刷新丢失模块级状态（可接受，reload 后标记清零属预期）；单条解析在批量运行中与批次的交互按「批量优先」处理（运行中单条入口禁用）。

---

## 状态贯通 + 全站同类审计 + 任务快速新建 AI 判断 · Slice H（已完成 · 2026-10-03）

以 owner 三条指令为规格：① 资料页「状态」无判断标准 / 无设置按钮——解决后**全面检查同类问题**；② 笔记蒸馏层级可设；③ 任务快速新建需 AI 判断（否则「没有详细内容」）。`npm run build`（tsc strict + vite）通过；服务端冒烟 **21/21** + 浏览器 E2E **28/28**；零数据残留（回到基线：收件箱 9 / 任务 60 / 项目 10 / 笔记 14 / 资料 12 / 回顾 2 / 回收站 0）；控制台零 error；证据 `.qa/v24/`。

- [x] 判断标准：`format.ts` `RESOURCE_STATUS_DEF`（未读 / 在读 / 读完 / 参考 / 归档）与 `DISTILL_LEVEL_LABEL/DEF`（L0 原文 / L1 划线 / L2 摘要 / L3 永久）；抽屉内安静 helper 文本 + 每项 `title`；文案与 `docs/04 §4.8 / §4.9` 一致。
- [x] 快捷设置：`Library.tsx` 本地 `QuickSegmented`（复用 `.k-lib__seg` / `TagPill`，token only）——资料状态、笔记蒸馏；经既有 `POST /api/<kind>/:id/update` 写入 + toast 撤销。
- [x] 白名单扩充：`notes` +`areaId/projectId/distillLevel`、`resources` +`areaId`、`projects` +`goalId/nextActionId`；对应编辑表单补下拉。
- [x] 任务快速新建 AI：`POST /api/ai/task/draft`（`draftTask` + `taskDraftSchema` + 快照后校验 + 单次重试 + 120s；不落盘）；前端创建即时完成、建议随后安静到达（可应用 / 忽略 / 重试，失败不阻断）；应用经 `POST /api/tasks/:id/update`（审计 `task.update`）。实测真实 AI 7.0s 返回含 `@lab / energy / estimateMin / dueAt / areaId / tags` 的建议。
- [x] 验证：`.qa/v24/smoke-h.mjs` 21/21（真实草稿形状 + 空标题 400 + 三实体新增字段往返 + 审计 + 零残留）；`.qa/v24/slice-h-verify.py` 28/28（资料 / 笔记快捷设置持久化与还原、三处编辑表单字段存在性、快速新建 AI 应用 + 忽略、移动 390、控制台 0、零残留）。
- [x] 记录：ADR-0011；`docs/02 §3.2 / §4.3`；`docs/04 §4.8 / §4.9 / §9`；`docs/README`；`CHANGELOG.md`；`AGENTS.md`。

### Slice H · 全站同类审计结论表

扫描全部视图与详情抽屉，判定「已展示但不可操作 / 无判断标准」。原则：只修语义清晰且回归安全的小口子；结构性缺口显式延后。

| # | 项（字段 / 状态） | 决策 | 理由 |
|---|---|---|---|
| 1 | 资料 `status`（未读 / 在读 / 读完 / 参考 / 归档） | **fixed** | 原 owner 反馈：可写但埋于编辑表单、无判断标准 → 抽屉内快捷设置 + helper 标准（terms 入 `format.ts` / `docs/04`） |
| 2 | 笔记 `distillLevel`（L0–L3） | **fixed** | 列表 / 详情展示但不可设 → 白名单 + 快捷设置 + 标准 |
| 3 | 笔记 `areaId` / `projectId` | **fixed** | 经「关联」区块展示但不可设 → 白名单 + 编辑下拉（可清除） |
| 4 | 资料 `areaId` | **fixed** | 行内展示区域但不可设 → 白名单 + 编辑下拉 |
| 5 | 项目 `nextActionId` | **fixed** | 行 / 详情 / 关联展示但不可设 → 白名单 + 编辑下拉（选未完成任务） |
| 6 | 项目 `goalId` | **fixed（仅关联）** | 关联区块静态展示 → 白名单 + 编辑下拉（选已有目标）；目标的创建 / 管理仍延后 |
| 7 | 任务快速新建（仅标题） | **fixed** | owner 反馈「没有详细内容」→ 新端点 `POST /api/ai/task/draft` + 内联建议（不自动应用） |
| 8 | 事件（event）全实体 | **deferred** | `status / allDay / location / area / project / tags / title / startAt / endAt` 均只读；不在 `SCHEMAS / EDITABLE_KINDS / ID_PATTERNS`，无创建 / 编辑 / 取消端点——需新增可写实体（结构变更，日历 P0） |
| 9 | 区域（area）管理 | **deferred** | 仅标题作静态芯片 / 筛选项展示；`cadence / status / standard` 未展示；无视图与可写路径 |
| 10 | 目标（goal）管理 | **deferred** | `goal.title` 仅经项目关系芯片展示；`keyResults / status` 未展示；无视图与可写路径 |
| 11 | 习惯（habit）打卡 | **deferred** | 总览「连续刷题」点阵展示但无打卡入口；习惯无写入路径 |
| 12 | 笔记 `links`（互链 / 反向链接） | **deferred** | 需实体选择器（自由文本 id 不安全） |
| 13 | 任务 `parentTaskId`（父子） | **deferred** | 需层级 / 环检测语义与选择器（避免 A↔B 环） |
| 14 | 已保存回顾 `summary / decisions` 编辑 | **deferred** | `reviews` 不在 `EDITABLE_KINDS`；属 Slice F 范围，需设计编辑入口 |
| 15 | `review.metrics.migrated` 恒显示 `—` | **deferred** | 服务端刻意不产出（无编辑追踪来源，ADR-0007）；需实现编辑追踪或移除指标 |
| 16 | 回顾「迁移」按钮 | **deferred** | 实为 `touch`（只 bump `updatedAt`，不改 due / status）；语义需产品决策（改名 or 真实改期） |
| 17 | 收件箱内容编辑 / 删除入口 | **deferred** | 服务端有 `POST /api/inbox/:id/remove` 但无 UI 调用；内容不可改——需交互设计 |
| 18 | 标签注册表管理 | **deferred** | 标签仍自由文本输入，可产生无定义标签（回退原名）；需管理界面 |
| 19 | 任务 `deferUntil`（反向缺口：可设但不展示） | **deferred** | 可在编辑表单设置但 `TaskDetail` 不展示；低优先，非 owner 本轮诉求 |
| 20 | **笔记沉浸式阅读与撰写体验**（owner 15:58 诉求） | **deferred（backlog）** | 明确不在本切片范围，记录为延后 backlog |

---

## 使用指南同步 · Slice I（已完成 · 2026-10-03）

把自包含中文使用指南 `public/guide.html` 从上一版本同步到 Slice D–H 现状。仍是单文件、内联 CSS/JS、零外部请求；`file://` 双击与 `http://localhost:5173/guide.html` 均可用；沿用既有「柔暗夜色」token。只动 `public/guide.html` + `.qa/v25/**` + 三份文档，未触碰 `src/**`、`server/**`、`data/**`、`design-drafts/**`，未重启服务。

- [x] 内容同步：04 页面速览八卡逐页补新交互（总览对话盒 / 收件箱文件投递 + 批量 AI + 侧挂条 / 任务快速新建建议 / 资料状态五档与判断标准 + 笔记蒸馏 / 回顾周月卡 + 弹窗报告 + 停滞项目）；05 AI 章节扩为解析 / 对话盒 / 快速新建 / 回顾报告 + 静态对话示例；02 / 03 / 06 / 07 / 08 补文件投递、批量、`/trash` 深链、清空即归档、对话盒键位；FAQ 增三条；页脚版本串 `v0.5.0（切片） · 2026-10-03`。
- [x] 演示保留：任务详情居中弹窗（`role=dialog` / ESC / 焦点还原 / 滚动锁定）原样保留。
- [x] 验证：`.qa/v25/guide-verify.py` **65/65**（dev 桌面 1600 / dev 移动 390 / `file://` 三态；新内容命中、控制台零 error、零横溢、`file://` 无外部子资源、TOC 滚动高亮 JS、演示 a11y）。证据 `.qa/v25/`（`guide-desktop.png` / `guide-mobile.png` / `guide-file.png` / `guide-demo-open.png` / `guide-verify.log`）。
- [x] 记录：`CHANGELOG.md` 使用指南同步条目；`AGENTS.md` 变更记录行。

**下一会话待办**：指南已与当前实现对齐；后续若再改动用户可见交互，记得回填 `public/guide.html` 对应章节（尤其 04 / 05）并更新页脚版本串。

---

## 总览升级 · Slice G（已完成 · 2026-10-03）

以 owner 三条指令为规格：① 状态条下方加「能对话的 AI 盒」——读库回答（例「我今天有什么特别紧急需要去做的事情」）、清空对话前按时间命名归档为可查阅文本；② 顶部三胶囊右缘参差、要换展示方式；③ 工作台条目点击就地弹详情（不跳转、不无高亮）。`npm run build`（tsc strict + vite）通过；浏览器 E2E **42/42**；零数据残留（回到基线：收件箱 9 / 任务 60 / 项目 10 / 笔记 14 / 资料 12 / 回顾 2 / 回收站 0）；控制台零 error；证据 `.qa/v23/`。

- [x] AI 对话盒：新增 `src/components/OverviewChat.tsx`（状态条之下、工作台之上；复用 `.ic-composer` 视觉；消息存在时上方展开定高可滚线程；Enter 发送 / Shift+Enter 换行；加载 / 错误 + 重试；清空禁用态）；会话级持久（模块级 store，跨路由存活）。
- [x] 对话端点：`server/ai.mjs` `buildChatDigest` / `buildChatSystem` / `chatWithKernel` + `CHAT_MAX_*`（20 条 / 4000 字 / 16000 字）；`POST /api/ai/chat`（有界裁剪、末条须为用户消息；摘要含逾期 / 今日到期 / 未来 7 天日程 / 收件箱积压 / 进行中项目 / 高优先下一步；自然语言；120s 超时 + 单次重试；503/502；不落盘）。实测真实回复约 5s。
- [x] 归档为笔记：`POST /api/notes`（通用创建；title 非空 400 + type 白名单缺省 memo + `note.create` 审计 + 201）；「清空对话」先归档（`AI 对话归档 · YYYY-MM-DD HH:mm`，body 为 `**我**`/`**KERNEL**` markdown）成功才清空 + toast「查看」跳 `/library?note=<id>`；失败不清空。`mutations.chatWithAi` / `createNote`。
- [x] 状态条重做：`.k-status` 整宽等分（`grid-auto-flow:column` + `minmax(0,1fr)`），三段左右边缘严格贴版心（实测 228.00 / 1468.00）；三段改可点按钮（→ 日历 / 收件箱 / 任务）；逾期恒显示；≤640 竖排。
- [x] 就地详情：抽出 `TaskDetail.tsx` / `ProjectDetail.tsx`（Tasks / Projects 抽屉复用同款，行为不变）；`Overview` 用 Slice F 的 `Modal.tsx` 承载任务 / 项目弹窗，URL 保持 `/`，ESC / 遮罩 / 焦点还原沿用。
- [x] 验证：E2E 42/42（几何 / 点击 / 发送→加载→真实回复 / 多轮 / 清空归档→toast 深链打开 / 任务与项目弹窗 / 移动 390 / 控制台 0 / 零残留）；`npm run build` 通过。
- [x] 记录：ADR-0010；`docs/02 §4.3`；`docs/04 §9`；`docs/05`；`docs/README`；`CHANGELOG.md`；`AGENTS.md`。

---

## 回顾页重构 · Slice F（已完成 · 2026-10-03）

以 owner 三条指令为规格：① 周 / 月回顾卡并列一栏、移到能量分析上方、点「AI 解析」出报告、点开动画弹窗查阅；② 停滞项目单独一栏；③ 月回顾与周回顾同享 AI 能力。`npm run build`（tsc strict + vite）通过；服务端冒烟 **13/13** + 浏览器 E2E **30/30** + 移动端 **6/6**；零残留（回到基线：收件箱 9 / 任务 60 / 项目 10 / 笔记 14 / 资料 12 / 回顾 2）；控制台零错误；证据 `.qa/v22/`。

- [x] 布局：`.k-review__cycles`（两卡并列，route<900 单列）置于 `.k-review__charts`（能量分析在前）之上；停滞项目独立全宽 `Panel`（空态「无停滞项目」）；指标瓦片移入各周期卡（有报告时）。
- [x] 弹窗：新增 `src/components/Modal.tsx`（居中，fade + 微缩放；ESC / 遮罩关闭；焦点圈闭 + 关闭还原；`role=dialog` / `aria-modal` / `aria-labelledby`；锁定滚动；reduced-motion 降级）。周 / 月各一弹窗，草稿态可编辑 → 保存 → 撤销 toast，已保存态只读查阅。
- [x] 每卡 AI 解析：`generateReviewDraft(kind)`；进行中 / 错误态安静呈现；不自动落盘、不自动弹窗。
- [x] 月回顾服务端：`computeMonthMetrics`（月窗口径 = 周窗口径）+ `monthKey`（YYYY-MM）+ `generateReviewDraft(period)` + `/api/ai/review/draft { period }` + `/api/reviews { type:'monthly' }`；周行为不变。
- [x] 验证：冒烟 monthly 201 / periodKey 2026-10 / 4 指标 / 非法 period 400 / 删除 / 零残留；真实月度草稿 200（4.8s）；E2E 覆盖布局几何、弹窗开合与焦点、周 AI 草稿 → 弹窗报告、月度落盘 + 撤销 + UI 查阅、停滞空态、控制台、零残留；移动 390 零横溢 + 单列 + 弹窗适配。
- [x] 记录：ADR-0007 §6；`docs/04 §4.10`；`docs/05`；`CHANGELOG.md`；`AGENTS.md`。

---

## 趋势图数据点裁切修复 · Slice E2.7（已完成 · 2026-10-03）

owner 截图反馈「这里的小圆点被遮盖了」：总览「完成趋势」sparkline 贴底数据点（值 0 → viewBox y=100）被 SVG 视口裁掉下半圆，半圆看起来像被遮盖。一行 CSS 修复 + 像素级验收 **8/8**；`npm run build`（tsc strict + vite）通过；只读零写入；证据 `.qa/v21/`。

- [x] 修复：`src/styles/components.css` `.k-line__svg` 增 `overflow: visible`——零长度路径 + 圆头端帽绘制的数据点不再被 SVG 视口裁切；下溢约 3.5px 落入与下方元素的既有间隙（不影响布局）；总览 / 回顾两处 `TrendLine` 同步生效。
- [x] 验证：总览 / 回顾双页 `overflow=visible` 断言；像素级前后对照（基线下方墨色 0px → 290px，6 个贴底点半圆 → 整圆）；控制台零错误；前后快照计数一致（只读）。
- [x] 记录：`CHANGELOG.md` / `AGENTS.md` / 本文件。

---

## 动效与布局稳定 · Slice E2.6（已完成 · 2026-10-03）

以 owner 反馈五连为指令：批量 AI 解析看不见过程 / 展开区黏连 / 资料筛选横滚 / 流式抖动 / 列表切换重叠。`npm run build`（tsc strict + vite）通过；浏览器 E2E **22/22**；零残留（回到基线：收件箱 9 / 任务 60 / 项目 10 / 笔记 14 / 资料 12 / 回收站 0 / 附件 1）；控制台零错误；证据 `.qa/v20/`。

- [x] 批量解析过程可视：批量 AI 解析复用单条流式路径 `runParse`——当前条目自动展开并显示实时过程面板（阶段 + 增量预览）；条目不在视口内时轻柔滚入（尊重 `reduced-motion` → 瞬时）；绝不自动应用。
- [x] 流式增量节流：SSE delta 先入 ref 缓冲、约 100ms 节流 flush 到 React state；过程面板阶段行单行省略、预览固定 3 行高度（最新贴底 + 顶部渐隐）——解析期间面板高度极差 0.00px、下方元素零漂移。
- [x] 展开区间距：`.ic-subrow` 顶部外边距 `--space-3`（实测 12px）——展开内容与条目行不再「黏在一块」。
- [x] 资料筛选条换行：`.k-lib__filters` 由横向滚动改自然换行——1280 / 390 均无横向溢出。
- [x] 任务列表切换：`motion.tr` 去 `layout` 与位移动画（保留透明度渐入 + stagger）——过滤切换过渡期间行不相交（`overlaps=0`）。
- [x] 验收：E2E 22/22（含批量缓存 3ms 就绪、零残留、控制台 0）。
- [x] 记录：`CHANGELOG.md` / `AGENTS.md` / 本文件。

---

## AI 挂靠判断 + 项目闭环 + 批量条侧挂 · Slice E2.5（已完成 · 2026-10-03）

以 owner 三条反馈为指令：①「辩论赛」文件被 AI 硬挂到无关项目（须宁缺毋滥 + 能判断「这是新事务」）；② 项目怎么诞生 / 归档——补「直接新建项目」入口 + 停滞项迁移 / 归档真实落盘；③ 批量工具条下滑到看不见时应「移到侧边位置」。`npm run build`（tsc strict + vite）通过；服务端冒烟 **39/39** + 浏览器 E2E **21/21**；零残留（收到基线：收件箱 9 / 任务 60 / 项目 10 / 笔记 14 / 资料 12 / 回收站 0 / 附件 1）；控制台零错误；证据 `.qa/v19/`。

- [x] AI 挂靠规则 v2：系统提示词加「明确依据才算挂靠、表面相似不算、拿不准 null」「附件不可读时更保守（除非文件名强匹配否则 null + reason 注明）」；新增 `newProjectHint`（≤40 字，与 `projectId` 互斥）；schema + `normalize` + `postValidate`（trim / 截断 / 互斥 / 标题去重）；建议卡显示「建议新项目：{X}」+「可到项目页新建」（仅提示）。
- [x] 项目新建：`POST /api/projects`（title 非空 400；active + a-0001 + outcome 待整理；审计 `project.create`；201）+ `mutations.createProject`；Projects 页快速新建（镜像任务页）→ 回车创建 → toast「已创建项目 · 撤销」（撤销进回收站）。
- [x] 回顾停滞按钮接通：`updateEntity` 空 patch = touch（bump `updatedAt` + 审计 `<singular>.touch`）；「归档」→ status archived + 撤销回 active；「迁移」→ touch + toast「已重决策：继续推进」；移除「原型态」文案；`Review` 订阅 `useDataRevision()`。
- [x] 批量条侧挂 dock：`IntersectionObserver` 观察 `.ic-batchbar`；滚出视口 → 右缘纵向居中的窄列浮动 dock（`已选 N 项` + 四个动作，与内联条同状态 / 同处理器 / 同禁用态）；`motion` 淡入滑入（reduced-motion 降级）；回视口隐藏；抽屉层级之下、≤767px 隐藏；真实可聚焦按钮。
- [x] 验收：辩论赛样例 `projectId=null` + `newProjectHint=新生辩论赛筹备`；控制样例正确挂 `p-0002`；dock 出现 / 勾选 / 取消选择 / 隐藏全通过；项目快速新建行出现；零残留 + 控制台 0。**提示词一次通过**。
- [x] 记录：`CHANGELOG.md`；ADR-0006（挂靠规则 v2 + newProjectHint）与 ADR-0009（`project.create` + touch）修订。
- [ ] 备注（限制）：当前 `data/` 无停滞项目（种子项目 updatedAt 均为近期）→ 回顾页「迁移 / 归档」的 **UI 点击路径无法覆盖**；touch / archive 语义已由服务端冒烟覆盖（`.qa/v19/smoke-e25.mjs`）。

---

## 详情操作 + 回收站 · Slice E2（已完成 · 2026-10-03）

以 owner 三条反馈为指令：详情页缺编辑 / 删除；需要一个回收站；资源详情要指明文件位置并可打开。`npm run build`（tsc strict + vite）通过；服务端冒烟 34/34 + 浏览器 E2E 19/19 + 全站回归 smoke PASS；零残留，证据 `.qa/v18/`。

- [x] 服务端编辑：`POST /api/(tasks|projects|notes|resources)/:id/update`——字段白名单（忽略其余）、保留 `id`/`createdAt`、`updatedAt` 递增、`SCHEMAS[kind]` 校验、审计 `<singular>.update` + `detail.fields`、返回 `{ record }`；`null` 视为清除。
- [x] 服务端回收站：`data/trash/<kind>/<id>.json`（原记录 + `trashedAt`）；`moveToTrash` / `restoreFromTrash` / `purgeTrash` / `readTrash`（走写队列）；`nextId` 增扫回收站防 id 复用；路由 trash / `GET /api/trash` / restore / purge（审计齐全）。
- [x] 资源位置：`resourceSchema.path?`；文件澄清补 `kind:'file'` + 绝对 `path`；`POST /api/reveal`（`explorer.exe /select`，detached + unref；仅本机）。
- [x] 前端：`EntityEditForm`（规格驱动表单）+ 任务 / 项目 / 笔记 / 资料四抽屉「编辑 / 删除」（删除进回收站 + 撤销 toast）；`/trash` 页（按类型分组 / 恢复 / 双击彻底删除 / 空态）；资料抽屉「文件位置」区块（路径 + 在文件管理器中显示）。
- [x] 记录：ADR-0009；`docs/04` / `docs/05` / `docs/02` / `docs/README` / `AGENTS.md` / `CHANGELOG.md` 同步。

---

## 使用指南 · HTML（已完成 · 2026-10-02）

面向首次使用系统的所有者，交付一份能读懂就会用的中文使用指南。**单文件、自包含**：`public/guide.html` 经 dev URL（`http://localhost:5173/guide.html`）访问，也可 `file://` 双击直接打开——内联 CSS/JS，零外部请求，无构建步骤。视觉复用暗色「柔暗夜色」token（表面阶 / 柔影 / 圆角 16 / 强调色仅作信号），桌面粘性左目录、≤900px 折叠为内联目录，正文 measure 72ch，响应式至 390px。

- [x] 内容十节：Hero（一句话哲学 + `npm run dev` 启动条）· 30 秒理解（捕捉→澄清→组织→执行→回顾）· 五分钟上手（5 步）· 一条内容的一生（表）· 八个页面速览（8 卡）· AI 怎么帮你（解析 / 周回顾 / 三条红线 / 本地 4096）· 系统是连起来的（关联区块 + `?task/?project/?note/?event` 深链）· 用好它的心法（六条）· 快捷键与全局（含手机局域网）· 常见问题 + 页脚版本串。
- [x] 自包含：`<html lang="zh-CN">` + viewport + 内联 `<style>`；系统字体栈（不引外部字体 / 图标 / 图片 / CDN）；无渐变 / 辉光 / emoji；末尾内联原生 JS 仅目录滚动高亮，失败静默降级。
- [x] 验证：Python Playwright（`.qa/v15/guide-verify.py`）三态 **25/25 通过**——dev 桌面 1600×1000 / 移动 390×844 / `file:///<workspace>/public/guide.html`；三处控制台 error == 0；关键区块（五分钟上手 / 关联 / 常见问题）命中；桌面与移动零横向溢出；file:// 无外部子资源请求。证据 `.qa/v15/`（三张截图 + `guide-verify.log`）。
- [x] 交互演示（追加）：任务卡内「点开看：任务详情面板」触发**任务详情面板居中弹窗**——忠实复刻真实抽屉（kicker `任务 · t-0034` / 标题 `通知同学提交医保信息（群公告）` / 2 列字段网格 / 标签 `班长` / 「关联」芯片 `所属项目 · … · p-0006`、`区域 · 学生工作 · a-0002`、`作为下一步行动 · … · p-0006` / `标记完成` 实心 + `查看项目` ghost / 关闭 X）；X / 遮罩 / ESC 关闭，打开时焦点进入弹窗、关闭还原触发按钮，打开锁定页面滚动，`role="dialog"` + `aria-modal` + `aria-labelledby`，fade + 微缩放（reduced-motion 降级）；自包含内联 CSS/JS。验收扩至 **39/39 通过**、控制台零错误，证据追加 `.qa/v15/guide-demo-open.png`。
- [x] 边界：未改 `src/**`、`server/**`、`scripts/**`、`data/**`、`public/favicon.svg`、`index.html`；未触碰运行中的 5173 / 4097 / 4096。

---

## v0.5 opencode AI 接入 · 首个切片（已完成 · 2026-10-02）

所有者指令「走 opencode 的现有默认配置」；先以实证探针（`.qa/v13/probe1–5`）核对全部关键假设再落地：**收件箱「AI 解析」**（条目 → 结构化建议 → 确认 → 走既有澄清写入）。`tsc -b` + `npm run build` 通过；服务端冒烟 + UI 端到端（Playwright）全绿；测试后数据已复原（零残留）。

- [x] 服务端：`server/ai.mjs`（SDK v2 代理；指令式 JSON + Zod + 单次重试 + 120s 超时 + 可选 Basic 认证）；`GET /api/ai/health`、`POST /api/ai/inbox/:id/parse`（404/409/503/502）。
- [x] 写入：`clarifyInbox` 扩展 `details`（title/contexts/energy/importance/estimateMin/dueAt/tags）+ `ai` 审计标记（向后兼容；撤销沿用 revert）。
- [x] 启动：`dev.mjs` 探测 4096，空闲则托管拉起 `opencode serve --port 4096`（已运行跳过；缺 CLI 仅告警）。
- [x] 前端：收件箱「AI 解析」入口 + 建议卡（安静样式）；状态条 / 设置页 AI 实时状态（在线 / 离线）。
- [x] 实证修正（ADR-0005）：serve 需显式 `--port 4096`；`format: json_schema` 在 thinking 模型被拒 → 指令式 JSON；`variant: 'low'` 4.4s vs 默认 236s。
- [ ] 顺延：SSE 流式进度、命令面板 AI 入口、通知 / 文件投递解析（原始诉求完整体）。
- 证据：`.qa/v13/`（probe1–5、smoke-ai、inbox-ai-*、settings-ai）。

---

## 结构互联 · Slice A（已完成 · 2026-10-02）

把跨实体引用变为可见、可点击（为后续 AI 关联建议打底）。`npm run build`（tsc strict + vite）通过；行为级验收（Python Playwright）20/20 通过——深链直开 / 关联芯片跳转 / 下一步 / 查看项目 / ESC 清参 / 移动端 390 / 控制台零错误（证据 `.qa/v14/`）。

- [x] `src/lib/relations.ts`：快照级线性扫描，返回 `{ kind, id, title, label }` 的出链 + 入链；任务（项目/区域/父任务/来源条目 · 子任务/作为下一步）、项目（区域/目标/下一步 · 任务/事件/笔记）、笔记（项目/区域/links · 反向链接）、事件（项目/区域）、资源（区域）。
- [x] `src/components/Relations.tsx`：抽屉内「关联」区块，`TagPill` 芯片（label · title · id），路由映射 task/project/note/resource/event/inbox；area/goal 无页面 → 静态芯片；空则不渲染。
- [x] 深链：`?project=`（Projects）/`?note=`、`?resource=`（Library）/`?event=`（Calendar），复用 `?task=` 的打开-关闭-replace 清参模式。
- [x] 集成五类抽屉；笔记「反向链接」保留。
- [x] 项目抽屉「下一步」字段；任务抽屉「查看项目」条件深链 / 无项目隐藏。
- [x] 版本串 v0.4.0 → v0.5.0（RailNav / 设置）；命令面板 AI 组更新为「AI 解析（收件箱）→ /inbox」。

---

## AI 澄清升级 · Slice B（已完成 · 2026-10-02）

收件箱 AI 解析升级：从「单点分类器」到「接入系统的连接器 + 过程可视」。服务端冒烟（SSE 帧）+ 浏览器 E2E 13/13 + `npm run build` 全通过；证据 `.qa/v14/`。

- [x] 上下文注入：`buildDigest`（项目 / 区域 / 标签 / 近期未完成 ≤50，~4KB）注入系统提示；建议 schema 扩 `projectId / areaId / tags / duplicateOf`。
- [x] 防臆造：`postValidate` 按快照过滤未知 id / 未注册标签；null 归一化。
- [x] clarify 联动：`clarifyDetailsSchema` + `clarifyInbox` 支持 `projectId / areaId`（仅 task；存在性校验）。
- [x] SSE 过程流：`POST /api/ai/inbox/:id/parse-stream`（`event.subscribe` 泵 + `status / delta / retry / suggestion / error` 帧 + 断开清理）；同步端点保留回退。
- [x] 前端：`aiParseInboxStream` + 过程面板（阶段 + 240 字预览）+ 挂接 chips（绝不自动合并）。
- [x] 工程：`scripts/spawn-bg.mjs` 后台安全启动器；AGENTS.md Windows 纪律修订（第三次卡死教训：`start` 方式挂起 → detached spawn）。
- 实测：i-0001 建议挂接 `p-0006 + a-0002 + role:monitor`；冒烟 625 delta 帧 ≈4.9s；E2E 只读零写入。

---

## AI 周回顾 · Slice C（已完成 · 2026-10-02）

AI 读整个系统生成周回顾草稿（指标 + 摘要 + 决策 + 停滞处置建议）→ 用户在回顾页编辑 → 确认后写入真实 `review` 记录（撤销即删除）；回顾页显示最新周 / 月回顾并移除该流程全部「原型态」文案。`npm run build` 通过；服务端冒烟 PASS + 浏览器 E2E 13/13；证据 `.qa/v14/`。

- [x] 写入路径：`reviewSchema` / `reviewDraftSchema`（`server/schemas.mjs`）；`SCHEMAS.reviews` + `ID_PATTERNS.reviews`；`store.nextId` 增 `reviews:'rev'`。
- [x] 服务端：`isoWeekKey` / `computeWeekMetrics` / `staleProjects`（`server/ai.mjs`，与前端口径严格一致）；`POST /api/reviews`（服务端算 id / periodKey / metrics / staleProjectIds；审计 `review.create`）、`POST /api/reviews/:id/remove`（审计 `review.remove`）、`POST /api/ai/review/draft`（503 / 502）。
- [x] AI 草稿：紧凑中文摘要注入 + 指令式 JSON + Zod + 单次重试（`variant:'low'`，120s）；`staleAdvice` 按实际停滞集合过滤臆造 id；`migrated` 刻意不产出（无编辑追踪来源，UI 显示 '—'）。
- [x] 前端：`mutations.ts`（`generateReviewDraft / saveReview / removeReview` + `ReviewDraft`）；`date.ts`（`isoWeekKey / monthLabel`）；`types.ts`（`migrated?`）；`Review.tsx`（最新回顾按 date 倒序 / 周期运行时计算 / 真实草稿流 idle-loading-draft-error-saving / toast 撤销）；`views.css`（安静 token-only 草稿样式）。
- [x] 验证：冒烟（草稿形状 + 写入 / 删除往返 + 审计，零残留）；E2E（草稿 / 编辑保留 / 保存 toast / 撤销复原 / 零控制台错误，零残留）；构建通过。
- [x] 文档：ADR-0007；`docs/04 §4.10`（`migrated` 可缺省）；`docs/05` / `docs/README` 收录 0007。

---

## 收件箱升级 · Slice D（文件投递 + 居中编辑器 + AI 先读）（已完成 · 2026-10-02）

收件箱捕捉栏从「全宽纯文本条」升级为**居中圆角编辑器**（DeepSeek 式）：支持点击 / 拖拽投递文件，落盘后**由 AI 先读一遍**（复用既有 SSE 过程面板 + 建议卡）。`npm run build`（tsc strict + vite）通过；服务端冒烟 PASS + 浏览器 E2E **12/12**；重启后栈在线（4097 + 5173，未触碰 4096）；数据零残留；证据 `.qa/v16/`。

- [x] 服务端：`POST /api/inbox/upload`（RAW body 流式落盘 `data/files/`；25MB 上限 → 413；文件名清洗 / 截断 / 兜底；`source:'file'` + `file:{name,size,mime?}`；审计 `inbox.upload`；写失败清半成品）、`POST /api/inbox/:id/remove`（清附件 + 删条目；`clarified` → 409；审计 `inbox.remove`）、`GET /api/files/:id`（流式 inline，`filename*=UTF-8''`）。
- [x] 数据模型：`inboxItemSchema.file?`；`.gitignore` 增 `data/files/`（二进制不进 git；元数据随 JSON）。
- [x] AI 先读：`buildFileSection`（同步 / 流式共用）——文本白名单或 `text/*` 且 ≤5MB → 前 8000 字摘录；否则仅元数据；系统提示增附件判断行；无附件条目行为不变。
- [x] 前端编辑器：`.ic-composer` 居中（`max-width:760px`）+ 圆角柔影 + chips + 回形针 + 拖拽遮罩「松开：放入收件箱」+ 圆形发送 + `C` 角标；光学居中补偿固定轨道；`humanSize` 格式化。
- [x] 投递即读：`uploadInboxFile(file, caption)` → 顺序自动运行 `parse-stream`（失败 toast 后继续）；文件行字形 / `name · humanSize` / 「查看文件」链接。
- [x] 验证：冒烟（201 + 清洗 + 落盘一致 + 真实 AI 建议 + remove 清理 + 审计，零残留）；E2E（几何居中 centerX=800 / chip / 文件行 / 自动建议卡 / 拖拽 chip / 零残留 / 零控制台错误）。
- [x] 文档：ADR-0008；`docs/04 §4.1`（`file?`）；`docs/05`（目录树 / 职责 / 清单）；`docs/README` 收录 0008。

---

## 收件箱修复包 · Slice E1（已完成 · 2026-10-03）

所有者实测反馈四项修复：①编辑器回位；②「批量 → 任务」反馈加固；③AI 结果缓存；④批量 AI 解析。`npm run build`（tsc strict + vite）通过；浏览器 E2E **24/24**（含「批量丢弃」路径）；数据零残留（收件箱回到 i-0001..i-0008 · 任务回到 t-0001..t-0060 · `data/files/` 空）；证据 `.qa/v17/`。

- [x] **编辑器回位（owner 反馈）**：撤销 Slice D 居中几何——`.ic-composer` 去 `max-width:760px` 居中与 `translateX` 光学补偿；回到原捕捉栏位置（占满版心；左右边距与「水位」面板一致，实测 x=228=panel.x、宽度均 1240）；DeepSeek 式视觉与全部 Slice D 功能（chips / 回形针 / 拖拽遮罩 / 圆形发送 / `C` 角标 / 投递即自动 AI 先读）保留。
- [x] **「批量 → 任务」复现 + 加固**：API 造一文本 + 一文件临时项 → 勾选 → 批量 → 任务，**两条均成功澄清离场，服务端流程无 bug**（owner「点了没用」是反馈不够醒目）；加固：目标感知 toast（`已批量创建 N 条任务` / `已批量丢弃 N 条`，带「撤销」）+ 成功后才收敛选中态（仅移除已处理项，中止保留剩余选中）。
- [x] **AI 结果缓存（收起不丢）**：`src/views/Inbox.tsx` 模块级 `Map<inboxId, AiParseResult>`（会话内跨路由存活）；收起 / 切换后展开命中缓存 → 秒级就绪卡（无阶段文案 / 不重解析，实测 0.00s）；条目离场（应用 / 撤销 / 刷新对账）即清除；就绪卡增安静 ghost「重新解析」（覆盖缓存强制重跑）；单活跃流在途守卫不变。
- [x] **批量 AI 解析**：批量条新增「批量 AI 解析」（旁列 批量 → 任务 / 批量丢弃）；顺序流式解析选中项（复用 `aiParseInboxStream` + 缓存），进度「AI 解析中 2/5…」，失败 toast 后继续，**绝不自动应用**；运行期间禁用批量动作与单条解析入口防重叠。
- [x] 验证：E2E 24/24（几何回位 / 批量 AI 进度与完成 / 两条均缓存即时就绪 / 批量 → 任务两条离场 + 明确 toast / 批量丢弃两条离场 + 明确 toast / 零残留 / 控制台零错误）；截图 `e1-composer.png` / `e1-batch-ai.png`；日志 `slice-e1-verify.log`。
- [x] 文档：ADR-0008 §2.7 修订（「owner 反馈后回位，不居中」）+ §4 Slice E1 修订行；`CHANGELOG.md` `[Unreleased]` 新增 Slice E1 条目。

---

## 全站排版落地（设计选型采纳 · 9/10）（已完成 · 2026-10-02）

所有者选型落地，仅排版 / 组件编排变更，功能 / 数据 / 路由零改动；`tsc` + `npm run build` 通过；8 视图 + 任务 / 笔记抽屉全站截图回归、零控制台错误（证据 `.qa/v10/`）；**行为级验证通过**：收件箱批量 → 任务闭环 + 撤销回滚（t-0061 创建→撤销删除、条目 clarified→unprocessed）、任务表完成 + 撤销（t-0010 复原 next）、设置导航切换、日历「回到现在」、移动端 390 无溢出 + 次要列渐隐。

- [x] 收件箱 C「批量」→ 见下方「收件箱排版落地」节（批量工具条 / 日期分组 / 行内澄清 / 批量撤销）。
- [x] 任务 C「表格」→ 见下方「任务页排版落地」节（验收修复：「完成」表头竖排 → 勾选列 58px + nowrap + 首列居中）。
- [x] 项目 B「列表」→ 见下方「项目页排版落地」节。
- [x] 日程 C「议程流」：`Calendar.tsx` 重写——「今天 · 日期」头 + 下一项高亮卡（`useNow` 实时倒计时）+ 今天 / 明天 / 本周 / 下周分组事件流（时间 · 标题 · 地点）+ 迷你月历（今日标记 + 有安排圆点 + 前后月导航）+ 本月场次统计；日脊 / 周条 / scrollToNow 退役（`DaySpine` 组件保留未用）；右栏窄容器移至下方。
- [x] 资料 A「列表」：四行筛选整合为单条紧凑过滤条（横向滚动，a11y 标签保留）；笔记 / 资料分区行精化（类型 / 标题 / 蒸馏 / 相对时间），计数移至标签行。
- [x] 回顾 B「仪表盘」：双栏重构——左：指标瓦片 ×5（逾期 accent）+ 本周完成 `TrendLine` + 能量分布；右：周 / 月回顾卡（决策 01–03）+ 开始周回顾 + 停滞项目；五步流程抽屉保留。
- [x] 设置 B「侧导航」+ 细致优化：左分类导航（外观 / AI 集成 / 数据统计 / 数据服务 / 关于，无边框高亮选中）+ 右单区内容；窄容器横向滚动条；间距 / 区块头 / 表格对齐 / 空态统一。
- [x] 侧边栏规格：选中态「无边框高亮（填充 + 零阴影零边框）+ 左缘 3px 强调线」；实测（bg 8% 白 / shadow none / line 3px accent）；折叠态与移动端底栏同步。
- [x] 详情面板 B：任务抽屉两段式（备注 → 2 列字段网格 → 标签 → 底部操作）；`.k-drawer .k-dl` 统一两列紧凑网格（任务 / 日程 / 项目 / 资料抽屉一致受益）；窄抽屉回落单列。

- [x] **总览**：工作台（三轮 C）—— 已落地（见下方「总览排版落地」节）。

---

## 总览排版落地 · 工作台（变体 C）（已完成 · 2026-10-02）

所有者选定三轮 C「工作台」（`design-drafts/v2/overview-c.html`）并落地；仅排版 / 组件编排变更，数据 / 路由零改动；`tsc -b` + `npm run build` 通过；行为级验证 + 桌面 / 移动截图回归（证据 `.qa/v12/`）。

- [x] 结构：顶部胶囊行 → `.r3c-body`（左 2/3 工作区 = 已结束日程 →「现在 · HH:mm」实时分界 → 按截止升序的下一步行动 TOP5，含 `· 项目 done/total` 后缀；右 1/3 粘性监视柱）→ 底部项目推进（前 4 个活跃项目 + W40 回顾行）。
- [x] 监视柱：水位 6/12（阈值 8；口径统一 capacity 12 / threshold 8，StatusBar 同步）/ WIP 9/3 超限 / 连续刷题 14 日点阵 / 完成趋势 + 到期负载低高度 sparkline（`TrendLine` 增补 `showValues` / `showAxis` / `ariaLabel`，默认不变）。
- [x] 数据：新增 `getDueLoadSeries` / `getCodingStreakDetail` / `getUpcomingNextActions`（逾期不入列——由顶部「逾期 · N 项」胶囊承载）；`.k-streak` 点阵收录 `components.css`。
- [x] 退役：AI 建议卡（v0.5 占位）随编排移除；旧统计瓦片 / 双栏 / `.k-aisug` 死样式清理。
- [x] 行为验证：行动行深链 `/tasks?task=t-0034` + 抽屉、ESC 清参、日程行→`/calendar`、项目行→`/projects`、分割线实时时间、移动端 390 单列、回顾页 TrendLine 零回归。

---

## 项目页排版落地 · 列表（变体 B）（已完成 · 2026-10-02）

### 已完成

- [x] 所有者选定项目页「列表」（`design-drafts/v2/projects-b.html`）并落地真实应用：`src/views/Projects.tsx` 以按状态分组的纵向列表替换四列看板；`src/styles/views.css` 项目段以新增 `.k-plist*`（`.k-plist` / `.k-plist__group` / `.k-plist__row` / `.k-plist__idx` / `.k-plist__main` / `.k-plist__titleline` / `.k-plist__title` / `.k-plist__outcome` / `.k-plist__next` / `.k-plist__side` / `.k-plist__meter` / `.k-plist__due` / `.k-plist__empty` 与 `@container route` 收窄）替换原 `.k-kanban*` / `.k-pcard*`；分组头复用既有 `.k-group*`。
- [x] 行内容：序号 + 标题 + 状态/区域/首个标签胶囊 + 完成定义 + 下一步（`nextActionId` → 任务标题，accent 左信号条）+ 内联 `MeterBar`（真实 `getProjectProgress`，`done / total · pct%`）+ 截止 `humanizeDay`；非活跃分组紧凑（暂停/将来 隐藏下一步，已完成隐藏完成定义），悬停抬升。
- [x] 空态：无项目时呈现安静空态；空分组呈现一条细提示（`EmptyState` 经 `.k-plist__empty` 收敛为设计稿的安静行）。
- [x] 保留全部功能：行点击打开抽屉（`ProjectDetail` 的完成任务 / 撤销、任务清单、区域 / 标签 / 截止）；容器 `route` 收窄时行内右侧信息折到标题下方。
- [x] 清理死规则：移除 `.k-kanban` / `.k-pcard` 及其 `@container route (max-width:1120px|640px)`、`@container pcard` 块，更新 CONTAINER MAP 注释。仅改 2 文件 + 文档台账，未动 server/ · data/ · design-drafts/ 与其它视图 / 组件。`tsc -b` 通过。

## 任务页排版落地 · 表格（变体 C）（已完成 · 2026-10-02）

### 已完成

- [x] 所有者选定任务页「表格」（`design-drafts/v2/tasks-c.html`）并落地真实应用：`src/views/Tasks.tsx` 改为真实 `<table>`（完成 / 标题 / 上下文 / 能量 / 截止 / 项目），每分组一张表；`src/styles/views.css` 任务段新增 `.k-tasks__toolbar` / `.k-tasks__filters` / `.k-tasks__table` / `.k-tasks__row` / `.k-tasks__title-btn` / `.k-tasks__col--*` / `.k-tasks__foot` 及 `@container route` 收列规则。
- [x] 保留全部功能：状态 + 时间筛选、更多筛选 disclosure、`byDueTask` 排序、计数并入工具条、快速新建（`createTask` + toast）、深链 `?task=`、抽屉（未改样式）、完成勾选 + 撤销 + `pendingDone` 划线、空态、分组（平铺 / 按项目 / 按上下文）。
- [x] `tsc -b` 通过；仅改 2 文件，未动 server/ · data/ · design-drafts/ 与其它视图 / 组件。

## 收件箱排版落地 · 批量（变体 C）（已完成 · 2026-10-02）

### 已完成

- [x] 所有者选定收件箱「批量」（`design-drafts/v2/inbox-c.html`）并落地真实应用：`src/views/Inbox.tsx` 改为「捕捉条 + 水位面板 + 批量操作条 + 日期分组列表 + 内联澄清」；`src/styles/views.css` 收件箱段新增 `.ic-head` / `.ic-batchbar*` / `.ic-groups` / `.ic-item` / `.ic-row*` / `.ic-subrow` 及 `@container route` 收窄规则（分组头复用既有 `.k-group*`）。
- [x] 新增多选：`Set<string>` 未澄清 id 集合，主勾全选 / 全不选；批量 → 任务（逐条 `clarifyInbox(id,'task')`）、批量丢弃（`'discard'`）、取消选择；成功后单个「已处理 N 条」toast + 撤销（循环 `revertInbox`），失败即中止并保留剩余项。
- [x] 日期分组：按 `capturedAt` 相对今天的日历日分 今天 / 昨天 / 更早，降序；组头显示日期 · 星期 · 项数（更早组仅项数）。
- [x] 行尾「澄清」按钮（`aria-expanded`）展开 / 收起内联 5 项操作（→任务 / →项目 / →笔记 / →资源 / 丢弃）；单条澄清沿用 5s 撤销 toast。
- [x] 保留全部既有功能：捕捉（异步 + 错误 toast）、水位计量、已澄清 / 已丢弃折叠、空态、相对时间刷新；未动 server/ · data/ · design-drafts/ 与其它视图 / 组件。`tsc -b` 通过。

## 页面多版本设计稿 v2 + 路由滚动记忆（已完成 · 2026-10-02）

### 已完成

- [x] 设计基础：`design-drafts/v2/_base.html`（复用真实应用 CSS 的草稿模板，实测柔影/字体/组件全部加载）+ `BRIEF.md`（变体方向与硬性纪律）+ `_build.mjs`（选型页 / 对比页生成器）。
- [x] 8 个视觉代理并行产出 **29 个方案**：总览 / 收件箱 / 任务 / 日程 / 项目 / 资料 / 回顾 / 设置 ×3 版 + 详情抽屉 5（task ×3 + note + event）；全部真实种子数据、真实 token、零横向溢出。
- [x] **第二轮追加（所有者：总览重做 + 监控图表）**：`overview-a/b/c.html` 替换为「**监控台 CONTROL ROOM / 驾驶舱 COCKPIT / 信号层 SIGNALS**」三版——图表优先、主图+纵向流、信号行，三版合计覆盖全部 7 类监控图表；新增 `charts-kit.html` **图表组件样本页**（7 个监控模块：完成趋势 / 到期负载 / 能量分布 / 连续打卡 / 收件箱水位 / WIP 监控 / 项目推进；每个含 名称 / 建议类名 / 数据来源 / 使用场景 标注）；第一轮总览稿归档 `_archive/overview-*-v1.html`。
- [x] **图表语言修订（所有者否决圆头柱）**：线上 `TrendBars` 退役 → 新增 `TrendLine`（折线 + 面积晕染 + 数据点；峰值环仅唯一最大值；`.k-line` 样式族替换 `.k-trend`）；回顾页图表切换实测通过；草稿侧 7 文件同步替换（charts-kit / overview-a/b / review-a/b/c），条带与迷你柱去 pill 圆角；规范写入 `design-drafts/v2/BRIEF.md` 附录二；`_build.mjs` 升级支持「重跑即刷新内联 CSS」。
- [x] 预览渲染（含第二轮 4 张）+ 选型页 `design-drafts/v2/index.html`（现 30 卡片、含新「图表组件（监控）」分组、概念注释自动提取）+ 10 组三版对比页 `_sheets/`。**自包含打包**：应用 CSS 已内联进全部变体文件——评审可直接**双击 `design-drafts/v2/index.html`**（file:// 也能看到完整样式），或经 dev URL `http://localhost:5173/design-drafts/v2/index.html`。
- [x] 路由滚动记忆（所有者指定规则）：`src/lib/scroll.ts`（`useRouteScrollMemory`，AppLayout 挂载）——按 pathname 实时记录；切换后有记忆恢复、首访回顶；各页互不影响；日历首访自动到现在、回访恢复记忆；懒加载页 180ms 校正。

### 待办（所有者）

- [ ] 逐页选型（可跨页混选）→ 落地 `src/`。

### 关键结论（供落地时参考）

- 三版差异原则：A = 信息分区表达主次；B = 单点聚焦 / 层级极简；C = 均匀密度 / 快速扫读。
- 详情抽屉骨架（单列 / 双栏 / 行动优先）可一版通用于 task / event / project / note / resource。

---

## v0.4 数据服务（已完成 · 2026-10-02）

目标：Node 单写者数据服务成为唯一写入路径；替换 localStorage 原型态覆盖层；并入全站审阅确认的 P0 六项。决策记录：ADR-0004。

### 已完成

- [x] `server/`：HTTP 路由（`index.mjs`）+ 存储层（`store.mjs`：串行写队列 / 原子写 write-file-atomic / nextId / `data/activity.jsonl` 审计）+ Zod schema（`schemas.mjs`，可写实体 5 类：task/inboxItem/note/resource/project）；仅 `127.0.0.1:4097`。
- [x] 端点：`GET /api/snapshot|activity|health`；`POST /api/tasks`（快速新建）/ `:id/complete` / `:id/reopen`（从审计还原先前状态）；`POST /api/inbox`（捕捉）/ `:id/clarify`（→任务/→项目/→笔记/→资源/丢弃）/ `:id/revert`（撤销并删除产物）。
- [x] 前端改造：`data.ts` 可变快照（seed 首帧 + `/api/snapshot` 水合 + 订阅）；`api.ts` / `mutations.ts`（乐观更新 + 失败回滚）/ `hooks`（useDataRevision / useDataSource）；**删除 `proto.ts`**；Tasks/Overview/Inbox/Projects/StatusBar/Settings 全部改造；Toast 错误态 + 去「原型态」标签；状态条 + 设置页数据服务面板；聚焦/可见重水合（多标签同步）。
- [x] 工程：`scripts/dev.mjs`（`npm run dev` / `preview` 一体启动数据服务 + Vite）；`vite.config` 增加 `/api` 代理与 `data/**` 免热重载；npm 脚本更新（`dev:web` / `server`）。
- [x] 验证：服务端冒烟 15/15（落盘 / 幂等 / 撤销还原 / 路径穿越拒绝 / 审计链）；浏览器端到端（完成→落盘→撤销；捕捉→澄清→撤销；快速新建；离线降级：错误 toast + 乐观回滚 + 红胶囊；移动端 390 无溢出）；`npm run build` 通过。证据 `.qa/v07/`。
- [x] 文档：ADR-0004；`docs/02`（§1 拓扑 / §2.2 / §3.2 / §5 / §6 / §7）、`docs/04` §9、`docs/05`、`docs/07` 同步；AGENTS / README / CHANGELOG v0.4.0。

---

## 界面缺陷修复与全站审阅（已完成 · 2026-10-02）

目标：修复所有者指出的左上角品牌遮盖问题 + 以产品经理 / UI 设计师 / 前端工程师三视角全站审阅。

### 已完成

- [x] 品牌锁排：`.k-rail__brand` 垂直居中锁排，96px 轨道内 "KERNEL" 完整显示（原被裁切为 "KERNE"）。
- [x] 接缝对齐：顶栏 `min-height: var(--topbar-h)`，与轨道品牌行底边发际线 104px 共线（原错位 19px）。
- [x] Toast 跟随折叠（`<html data-rail>` + `--rail-current`）、`color-scheme` 主题化、`.gitignore` 增补。
- [x] 审阅缺陷修复 ×10（任务分组行 / 项目卡标签 / 0 值柱 / 能量斜纹 / 日历日期条吸顶 / 阈值线），全部实机断言 + 截图。
- [x] 全站审阅：2 独立代理（视觉 / 产品＋工程）+ 主会话复核，报告与证据 `.qa/review/`（`REVIEW-2026-10-02.md`、8 视图终版截图）。
- [x] git 初始化（`main` 分支）+ 首次提交。

### 审阅发现（Review Findings · 待决策，详见报告）

- **P0（建议并入 v0.4）**：澄清不落地/刷新回滚、跨视图计数分裂、proto 写入静默失败、清除无确认、缺 doneAt、多标签不同步。
- **P1（原型期可做）**：~~任务时间筛选+排序~~ ✅、~~undo toast~~ ✅、~~useNow 共享刷新~~ ✅、~~AI 卡文案动态化~~ ✅（2026-10-02 第一批）；剩余：日历翻周+deferUntil、回顾持久化+资料搜索、a11y 三处。
- **P2（视觉打磨）**：看板空列收敛、Panel 序号统一、指标尺度收敛、顶栏毛玻璃（可选）、ghost 胶囊、移动端统计 2 列（需拍板）。

---

## 体验增强 · P1 第一批（已完成 · 2026-10-02）

目标：落地审阅建议中"对每日使用增益最大"的三项（任务时间维度 / 撤销 / 统一时间刷新）＋ AI 卡动态计数。

### 已完成

- [x] 任务页「时间」筛选组：逾期 / 今天 / 本周（周一–周日区间），与状态筛选组合（实测逾期 5 条与统计一致、今天空态、本周 16 条）。
- [x] 任务默认排序：截止近者优先（最逾期在前）→ 重要性 → id；全部视图（含分组）生效。
- [x] 深链直达：`/tasks?task=<id>` 打开对应任务抽屉；总览「下一步行动」点击直达；ESC 关闭后清理查询参数。
- [x] 撤销 toast：完成任务 / 取消完成 / 收件箱澄清（含丢弃）5s 内可撤销（Toast 支持 action，带动作停留 5s）。
- [x] `useNow` 统一刷新：总览 / 日历 / 任务 / 资料 / 收件箱 60s 自动刷新（原三处渲染时取一次）。
- [x] 总览收件箱计数含原型态捕捉；AI 卡数字动态。
- [x] 验证：`.qa/v06/` 断言 + 截图；`npm run build` 通过；控制台无错误。

---



## 当前迭代：v0.3 视觉方向重做（已完成 · 2026-10-02）

目标：按所有者选定方向重做全站视觉（C 柔暗夜色 + B 柔影悬浮融合），并修复 v0.2 QA 的全部缺陷；功能、路由与数据层保持不变。

### 已完成

- [x] 方向决策：ADR-0003，C 柔暗为默认 + 柔影悬浮融合，取代硬瑞士 v1。
- [x] v2 设计 token（`tokens.css`）：暗色默认 / 亮色暖雾柔光、圆角 16、柔影、强调色 AA 变体、等宽栈补 CJK。
- [x] 全站重皮：应用壳（RailNav/TopBar/StatusBar/Drawer/CommandPalette/Toast）+ 全局组件 + 8 视图 + 详情抽屉。
- [x] 默认暗色：`index.html` FOUC 脚本 + `ThemeContext`（已保存的用户切换仍优先）。
- [x] QA 缺陷全修：M1 选中 chip 可读 / M2 强调色文字过 AA / M3 按钮 reset `padding:0` / M4 日历 scroll-to-now / M5 焦点圈闭 + 还原 / P7 强调色退出图表 / P8 逾期信号归位 / P9 token 纪律 / P10 删 HeatGrid + spine 短事件 + 等宽 CJK / Polish 日期不补零。
- [x] 验收修复：命令面板焦点还原（`focusin` 追踪 + 忽略面板自身与 `body`；关闭校验 `isConnected` 后还原）与水平居中（弃用被 Motion 覆盖的 `translateX(-50%)`，改 `margin:0 auto`）。
- [x] 验收修复：灰阶对比校正（暗色 `--muted`→`#929298`；亮色 `--ink-2`→`#665F59`、`--muted`→`#6E6862`，全表面 ≥4.5:1）。
- [x] 版式与呼吸感重排：版心居中（`--content-max: 1240px`）+ 统一呼吸词汇（`--pad-card: 26px` / `--row-min: 64px`）+ 区块头 / 顶栏 / 侧轨去噪 + 总览按 C 稿重排（状态胶囊 / 紧凑日程 / 精简瓦片 / 项目进度卡）+ 任务筛选「更多筛选」披露 + 收件箱去嵌套 + 8 视图一致性；`npm run build` 通过。
- [x] 数理自适应系统：字号/间距改 Utopia 流体 `clamp`（锚点 390/1440，1440 零回归）+ φ 间距层级（inner:element:section:page = 1:φ:φ²:φ³）+ 五具名容器查询（route/stat/task/pcard/drawer）替代组件内部媒体查询 + 动效距离分级/圆角比值/65ch 约束文档化 + 死代码清理（Ticker/Sparkline/heat/flows/rank/rail-en/mini-spine/pad-row）+ `docs/08-MATH-SYSTEM.md` + `.qa/v05/` 实测证据；`npm run build` 通过。
- [x] 文档：宪法 §5 升 v2、ADR-0003、设计系统 v2、文件树、CHANGELOG v0.3.0、AGENTS、路线图重编号。

### 验收标准（已满足）

- 暗色为默认，亮色可切换；两主题共享几何/排版，只换色彩与高度。
- 柔影悬浮语言全站一致；无硬边线；强调色仅作信号。
- 全部归档 QA 缺陷修复并复核；对比度达标（正文 ≥7:1、UI ≥4.5:1、强调色文字 ≥4.5:1）。
- 功能/路由/数据层/原型态保持不变；`npm run build`（tsc 严格 + vite）通过。

---

## v0.2 高保真前端原型（已完成 · 2026-10-02）

目标：把宪法 §4 的视图规格落成可演示、可交互的高保真原型，视觉与动效达到设计系统要求。

### 已完成

- [x] 设计 token 落地为 CSS 变量：色板（亮/暗）、字体、字号、间距、动效曲线。
- [x] 布局骨架：左侧 Index Rail（展开 96px / 收起 64px）+ TopBar + StatusBar + 主内容区。
- [x] 主题系统：亮/暗双主题，首帧前读 localStorage 防 FOUC，设置页可切换。
- [x] 路由与视图骨架：8 条路由接通（react-router v7 声明式 + 布局路由）。
- [x] 总览 OVERVIEW（P0）：Ticker、统计瓦片 ×4、DaySpine mini、下一步 TOP 6、存量与流量面板、AI 建议卡占位。
- [x] 收件箱 INBOX（P0）：快速捕捉输入框（快捷键 `c`）、未澄清列表、澄清操作条、水位计。
- [x] 任务 TASKS（P0）：筛选条、三种分组切换、行内完成动效、详情抽屉、行内快速新建。
- [x] 日程 CALENDAR（P0）：日脊 0 到 24h、事件块重叠分列、实时"现在"线、周条 mini 地图。
- [x] 项目 PROJECTS（P1）：四列看板 active / onHold / someday / done、详情抽屉。
- [x] 资料 LIBRARY（P1）：Notes + Resources 混合流、类型/状态/标签筛选、Markdown 阅读抽屉与反向链接。
- [x] 回顾 REVIEW（P1）：周回顾五步流程 UI、计数与单色图表、停滞项目清单。
- [x] 设置 SETTINGS（P2）：主题、数据统计、AI 状态（OFFLINE + 路线图）、关于、原型态说明。
- [x] 命令面板（`Ctrl+K`，cmdk）：导航 / 动作 / 原型标注入口。
- [x] 动效技法接入：路由进入、列表 stagger（60ms 步进）、数字滚动、完成划线塌缩、标签悬浮反转、现在线呼吸、Ticker 滚动、命令面板 fade + 4px 升起。
- [x] 无障碍：`MotionConfig reducedMotion="user"`、焦点环 2px accent offset、键盘全可达。
- [x] 响应式：≥1280 / 768–1280 / <768 三档，移动端底部标签栏，适配至约 390px。
- [x] 原型态本地层：任务完成 / 收件箱捕捉 / 快速新建任务写 localStorage 并跨视图联动。

### 验收标准（已满足）

- 八个视图均按宪法 §4 的优先级（P0 做透 / P1 完整可用 / P2 可用即可）达到对应完成度。
- 双主题切换无闪烁，动效在 reduced-motion 下自动降级。
- 原型期用户操作写 localStorage，界面标注"原型态"。
- 无 UI 框架、无 Tailwind，样式全部走 token。
- `npm run build`（tsc 严格 + vite）通过。

---

## Backlog

### v0.4 数据服务（已实现 · 2026-10-02）

- [x] 引入 Node 单写者数据服务，作为唯一写入路径。
- [x] 原子写入（write-file-atomic）。
- [x] Zod schema 校验，写入前全量校验。
- [x] 审计日志 `data/activity.jsonl`。
- [x] 前端写入改造为经 API 调用，移除 localStorage 原型态。
- [x] 数据迁移与备份策略：原子写 + 审计日志 + git 跟踪 `data/`（ADR-0004）。

### v0.5 opencode AI 集成（首个切片已交付 · 2026-10-02）

- [x] 本地 Node 服务代理链路：网页 → 本地服务 → `opencode serve`（仅 localhost）——`server/ai.mjs` + `dev.mjs` 自动拉起。
- [x] 接入 `@opencode-ai/sdk`（v2 客户端、扁平调用）：`session.create` / `prompt`。
- [x] 经 `event.subscribe`（SSE）推进度与流式结果 —— Slice B 落地（`/api/ai/inbox/:id/parse-stream` + 过程面板）。
- [x] AI 建议挂接（Slice B）：系统摘要注入 + `projectId / areaId / tags / duplicateOf` + clarify 关联字段。
- [x] 结构化建议：`format: json_schema` 在 thinking 模型被拒（ADR-0005）→ 指令式 JSON + Zod 校验 + 单次重试。
- [x] 结果写回 `data/`：AI 只出建议；确认后走 clarify（`details` + `ai` 审计标记），撤销沿用 revert。
- [ ] AI 建议卡从占位转为可用 —— **形态演进**：收件箱「AI 解析」建议卡已上线；总览建议卡留待后续增量。
- [ ] 后续增量：通知解析（原始诉求完整体）、命令面板 AI 入口；文件投递解析已落地（Slice D）。

### v0.6+

- [ ] 回顾流程自动化（Slice C 已部分落地 · 2026-10-02）：自动汇总指标 + 生成停滞清单 + 处置建议已交付（`/api/ai/review/draft` → 确认落盘）；顺延——页内停滞项目迁移 / 归档真实落盘、月回顾生成、编辑追踪支撑真实 `migrated` 统计。
- [ ] 习惯热力图与连续打卡统计。
- [ ] 搜索与命令面板的深度整合。

### v1.0 稳定

- [ ] schema 预留实体落地评估：`timeLog` / `person` / `journalEntry`。
- [ ] 完整数据自检与一致性工具。
- [ ] 文档与代码全量对齐审计。

---

## 已完成日志

| 日期 | 版本 | 完成项 |
|---|---|---|
| 2026-10-02 | v0.5.0（切片） | opencode AI 接入 · 首个切片：收件箱「AI 解析」（server/ai.mjs 代理 + 指令式 JSON + Zod；clarify details + ai 审计标记；dev.mjs 自动拉起 serve；前端建议卡 + 状态条/设置 AI 状态）；ADR-0005 + docs/02 修正；实测解析 3–6s；行为级 + 构建通过；证据 `.qa/v13/` |
| 2026-10-02 | v0.4.0 | 总览落地「工作台」（三轮 C 采纳，选型 10/10 完结）：左工作区（已结束日程→实时「现在」分界→按截止行动 TOP5 + 项目后缀）+ 右粘性监视柱（水位 12/8 · WIP 9/3 · 14 日点阵 · 完成趋势/到期负载 sparkline）+ 项目推进（真实计数 9 进行中 + W40 行）；`TrendLine` 增补可选属性、水位口径 12/8 统一、`.k-streak` 入组件库、AI 建议占位退役；行为级验证 + 构建通过；证据 `.qa/v12/` |
| 2026-10-02 | v0.4.0 | 全站排版落地（设计选型采纳 9 项）：收件箱 C / 任务 C / 日程 C / 项目 B / 资料 A / 回顾 B / 设置 B（+细化）/ 侧边栏（无边框高亮 + 侧边线）/ 详情面板 B（两段式 + 2 列字段网格）；全站回归零错误；`tsc` + `npm run build` 通过；证据 `.qa/v10/` |
| 2026-10-02 | v0.4.0 | 页面多版本设计稿 v2（29 方案 + 选型页 + 9 张三版对比页；真 CSS / 真数据；待所有者选型）+ 路由滚动记忆（各页独立恢复 / 首访回顶；日历配合「首访到现在、回访恢复」）；Playwright 实测 + `npm run build` 通过 |
| 2026-10-02 | v0.4.0 | 数据服务：Node 单写者（127.0.0.1:4097）+ 原子写 + Zod 校验 + `activity.jsonl` 审计；proto 退役（可变快照水合 + 乐观更新 + 撤销 + 离线显式报错）；审阅 P0 六项并入；`scripts/dev.mjs` 一体启动；ADR-0004；`.qa/v07/` 服务端 15 项 + 浏览器端到端验证；`npm run build` 通过 |
| 2026-10-02 | v0.3.0 | 体验增强（审阅 P1 第一批）：任务时间筛选（逾期/今天/本周）+ 截止排序 + `?task=` 深链直达 / 完成与澄清撤销 toast（Toast action + 5s）/ `useNow` 统一 60s 刷新（总览/日历/任务/资料/收件箱）/ 总览收件箱计数含原型态 + AI 卡动态计数；`.qa/v06/` 断言 + `npm run build` 通过 |
| 2026-10-02 | v0.3.0 | 界面缺陷修复与全站审阅：品牌锁排（KERNEL 不再裁切）/ 顶栏接缝对齐（104px 共线）/ Toast 跟随折叠 / `color-scheme` / 任务分组行同行 / 项目卡标签横排 / 0 值柱细基线 / 能量斜纹权重 / 日历日期条吸顶 / 阈值线可见；2 独立代理三视角审阅 + 实机复核（报告 `.qa/review/REVIEW-2026-10-02.md`，19 项分级建议）；git 初始化 + 首次提交；`npm run build` 通过 |
| 2026-10-02 | v0.3.0 | 数理自适应系统：Utopia 流体字号/间距（锚点 390/1440、1440 零回归）+ φ 间距层级 + 五具名容器查询（route/stat/task/pcard/drawer）+ 动效距离分级与圆角比值文档化 + 死代码清理 + `docs/08-MATH-SYSTEM.md` + `.qa/v05/` 四档实测；`npm run build` 通过 |
| 2026-10-02 | v0.3.0 | 版式与呼吸感重排：版心居中（`--content-max: 1240px`）、统一呼吸词汇（卡片 26 / 行 64）、区块头 / 顶栏 / 侧轨去噪、总览按 C 稿 bento 重排（状态胶囊 + 紧凑日程 + 精简瓦片 + 项目进度卡）、任务筛选披露、收件箱去嵌套、8 视图一致性；`npm run build` 通过 |
| 2026-10-02 | v0.3.0 | 视觉方向重做：采纳草案 C「柔暗夜色」为默认底座，融合草案 B「柔影悬浮」语言，替换 v0.2 硬瑞士风；v2 设计 token（暗色默认 / 亮色暖雾柔光、圆角 16、柔影、强调色 AA 变体）；全站重皮（应用壳 + 全局组件 + 8 视图 + 抽屉）；默认暗色；修复归档 QA 全部缺陷（M1–M5、P7–P10、Polish）；删除死代码 HeatGrid；文档更新（宪法 §5 v2、ADR-0003、设计系统 v2、文件树、CHANGELOG、AGENTS、路线图重编号）；`npm run build` 通过 |
| 2026-10-02 | v0.2.0 | 高保真前端原型交付：应用壳（RailNav/TopBar/StatusBar/AppLayout）、八个视图（总览/收件箱/任务/日程/项目/资料/回顾/设置）、命令面板（cmdk）、全局组件词汇与动效系统（Motion + View Transitions，reduced-motion 全量降级）、双子主题、响应式（含移动端底部标签栏）、原型态 localStorage 层；`npm run build` 通过 |
| 2026-10-02 | v0.1.0 | 文档系统（README、AGENTS、CHANGELOG、TASK_BOOK、docs/01 到 07、ADR 0001 与 0002）；项目宪法 v1；Vite + React + TS 脚手架；路由骨架；文件式数据层；种子数据（任务/事件/项目/目标/习惯/笔记/资源/收件箱/回顾）与元数据 |
