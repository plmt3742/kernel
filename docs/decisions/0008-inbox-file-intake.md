# ADR 0008 · 收件箱文件投递（Slice D）

- 状态：已接受
- 日期：2026-10-02
- 决策者：项目所有者（「收件箱编辑器居中 + 支持拖拽/点击投递文件 + AI 先读一遍」指令）+ 实证（`.qa/v16/smoke-upload.mjs`、`.qa/v16/slice-d-verify.py`）
- 关联：ADR-0004（数据服务）/ ADR-0005 / ADR-0006、`docs/02-ARCHITECTURE.md` §3、`docs/04-DATA-MODEL.md` §4.1、`docs/05-FILE-TREE.md`、`CHANGELOG.md`、`TASK_BOOK.md`、`.qa/v16/`、`.qa/v17/`（Slice E1 修订）

---

## 1. 背景

Slice A–C 已把「文件即数据库 / opencode 即大脑」落在收件箱文本解析与周回顾。本切片回应 v0.5 的原始诉求之一——**丢文件进收件箱**：捕捉栏从「纯文本全宽长条」升级为居中的圆角编辑器（DeepSeek 式），支持点击选择 / 拖拽投递文件；文件落盘后**由 AI 先读一遍**（复用既有 SSE 过程面板与建议卡），用户再确认澄清。

这是系统首次接收**二进制／大体积**输入，需要为「文件不能进 git、不能整段塞进提示词、不能无上限」定下工程边界。

## 2. 决策

1. **上传走 RAW body**：新增 `POST /api/inbox/upload?name=&type=&caption=`——请求体即文件字节流（`application/octet-stream`），**不经 `readBody`/JSON**。服务端用 Node stream 边收边写 `data/files/<id>-<safeName>`，避免整包进内存。`size` 取实际写入字节数。
2. **单文件上限 25MB**：`MAX_UPLOAD_BYTES = 25 * 1024 * 1024`。超出立即暂停读取、销毁写流、清理半成品并返回 `413 文件过大（上限 25MB）`。上限取「本地个人事务」的实用值：足够放课件／PDF／截图，又避免误投大媒体拖垮服务。
3. **文件名清洗**：`basename` → 非法字符 `[\\/:*?"<>|]` 替换为 `_` → `trim` → 截断至 120 字符（尽量保留扩展名）→ 兜底 `file`。防目录穿越（`basename` + 固定存储目录 + `id` 形状校验三重约束）。
4. **存储与不上 git**：附件二进制存 `data/files/`，`data/` 的 JSON 只存**元数据** `file: { name, size, mime? }`（v0.5 · `inboxItemSchema.file?`）。`.gitignore` 新增 `data/files/`：二进制不该进版本库（体积膨胀、无 diff 价值、可能含隐私）；元数据在 JSON 中随记录受版本管理，可复原「哪个文件属于哪条收件箱」。理由：与「文件即数据库」一致——JSON 是可 diff 的事实源，二进制是旁挂资产。
5. **AI 摘录策略**：`buildFileSection(item)` 为同步 / 流式两条解析路径**共用**：
   - 扩展名 ∈ 文本白名单（`.txt .md .csv .json .log .yml/.yaml .toml .ini .js/.mjs/.ts/.tsx/.jsx .py .java .c/.cpp/.h/.hpp .css .html/.xml .sql .sh .bat .ps1`）**或** `mime` 以 `text/` 开头，**且** `size ≤ 5MB`：读前 **8000 字**（utf8）作为摘录；
   - 否则仅给元数据 `【附件】${name}（${mime}｜${size} 字节）——无法直接读取内容，请依据文件名与上下文判断`。
   系统提示新增一行：带【附件】时基于附件内容与文件名判断 `target` 与 `title`。**无附件条目的行为完全不变。**
6. **附件读取与删除**：
   - `GET /api/files/:id`：流式 inline 返回（`Content-Type` 取 `file.mime` 或 `application/octet-stream`；`Content-Disposition: inline; filename*=UTF-8''…` 兼容非 ASCII）；条目不存在 / 无附件 / 文件缺失均 404。
   - `POST /api/inbox/:id/remove`：删除条目并清理其附件（`ENOENT` 忽略）；`status==='clarified'` 时 `409 已澄清条目请先撤销澄清`（防绕过 `revert` 误删已联动实体）。用于清理 / 测试，及未来 UI 的「删除文件条目」。
7. **前端编辑器**：`.k-capture` 全宽条退役，改为 `.ic-composer`——圆角抬升表面 + 柔影（仅 token）；内部：待上传 chips → 输入行 → 底行（左：回形针 + 「拖拽文件到此处」+ `C` 角标；右：圆形强调色发送按钮）。保留 `c` 聚焦快捷键与 Enter 发送。
   - ~~**光学居中**：水平居中（`max-width: 760px`），宽屏下 `translateX` 补偿固定左轨道宽度一半，使编辑器相对视口居中（与 DeepSeek 一致）。~~
   - **Slice E1 修订（owner 反馈后回位，不居中）**：撤销 `max-width` 居中与 `translateX` 光学补偿；`.ic-composer` 回到原捕捉栏位置——占满版心宽度，左右边距与下方「水位」面板（`.ic-head`）一致。DeepSeek 式视觉风格（抬升表面 / 圆角 / 柔影 / chips / 圆形发送）保留。
8. **投递即读**：选择 / 拖拽文件入队（chips 可逐个移除）；发送时若有文件 → 逐个 `uploadInboxFile(file, caption)`（`caption` 取当前输入，可选）→ 清空编辑器 → **对每个新条目顺序自动运行既有 AI 解析**（复用 `parse-stream` + 过程面板 + 建议卡；失败 toast 后继续下一个）。单活跃 AI 流下界面显示最后一条建议（可接受，不做多面板）。

## 3. 理由

- **单写者不破**：上传与删除仍唯一经数据服务（`commit()` / `remove()`），审计 `inbox.upload` / `inbox.remove`；前端只经 `/api` 调用。
- **流式 + 上限**：二进制不进 JSON、不整包入内存；25MB 上限 + 清洗 + `basename` 封死放大攻击面。
- **元数据入库、二进制旁挂**：JSON 保持可 diff、可备份的语义事实源；`data/files/` 用 gitignore 隔离，符合「文件即数据库」而非「把数据库塞进 git」。
- **AI 先读但不越权**：AI 只读**摘录**（≤8000 字）而非常驻全量；除文本外一律降级为「凭文件名与上下文判断」，避免把任意二进制喂给模型。AI 仍只出建议，落盘走既有澄清。
- **复用而非另起**：解析复用 Slice B 的 SSE 与过程面板，用户不学新交互；顺序自动解析避免并发打爆本地 4096。

## 4. 后果

- `server/schemas.mjs`：`inboxItemSchema` 增 `file?`；`server/index.mjs` 增 `POST /api/inbox/upload`、`POST /api/inbox/:id/remove`、`GET /api/files/:id` 及流式落盘 / 清洗 / 上限逻辑；`server/ai.mjs` 增 `buildFileSection`；`src/types.ts` `InboxItem.file?`。
- `.gitignore` 增 `data/files/`；`docs/04 §4.1` 与 `docs/05` 目录树同步。
- `data/` 除 JSON 外新增旁挂二进制目录；备份 / 迁移时需一并处理 `data/files/`（文档标注）。
- 实测（本机）：上传 → 同步解析建议含 `projectId / areaId / tags`；`inbox.upload` / `inbox.remove` 审计齐全；浏览器端到端 12/12（居中 / chip / 文件行 / 自动建议卡 / 拖拽 chip / 零残留 / 零控制台错误）。
- 证据：`.qa/v16/smoke-upload.mjs`（+`.log`）与 `.qa/v16/slice-d-verify.py`（+`d-composer.png` / `d-file-row.png` / `d-suggestion.png` / `.log`）。
- **Slice E1 修订（2026-10-03，owner 反馈修复包）**：①编辑器回位（去居中，见 §2.7）；②「批量 → 任务」复现并强化反馈（目标感知 toast / 成功后收敛选中态，服务端流程无 bug）；③新增单条 AI 建议缓存（收起不丢、命中即就绪卡、「重新解析」强制覆盖）；④新增「批量 AI 解析」（顺序解析 + 进度播报，绝不自动应用）。证据：`.qa/v17/slice-e1-verify.py`（+`e1-composer.png` / `e1-batch-ai.png` / `.log`）。
- **Slice J 修订（2026-10-03，收件箱修复包 2）**：①**OOXML 文本抽取**——`buildFileSection` 除文本白名单外，对 `.docx`（`word/document.xml`）、`.pptx`（`ppt/slides/slide*.xml` 数字排序）、`.xlsx`（`xl/sharedStrings.xml`）以**无依赖最小 ZIP 读取器**（EOCD + 中央目录；method 8 → `inflateRawSync` + `maxOutputLength`，method 0 原文）抽取正文，剥标签 + 解 XML 实体（含数字引用）+ 段落 `<w:p>/</a:p>/</si>` 转行 + 归一空白；沿用 8000 字摘录 / 5MB 上限 / 失败回退 `FILE_UNREADABLE_HINT`，同步与流式两路共用。§2.5 的「纯文本或仅元数据」边界据此扩展为「文本 + Office Open XML（docx/pptx/xlsx）」，PDF 仍仅元数据。②**批量解析状态持久化**——AI 解析的批量任务 / 活跃面板 / 建议缓存提升到前端模块级 store（新 `src/lib/inboxAi.ts` + `useSyncExternalStore`），跨路由切换存活；返回收件箱见真实进度 + 活跃项「解析中」+ 完成项「AI 建议就绪」标记，模块级 `running` 守卫全部批量动作防重复启动，完成播报一次；解析仍零写入（`data/` 不变）。证据：`.qa/v26/smoke-j.mjs`（14/14）、`.qa/v26/slice-j-verify.py`（16/16），所有者真实 docx 只读抽取 1118 字。
- **Slice J2 修订（2026-10-03，附件本机动作）**：回应 owner 反馈「点击查看文件是直接给我下载而不是打开文件夹对应位置或者打开本地文件给到我」，撤销浏览器下载路径。①**新增本机动作端点**：`POST /api/inbox/:id/open`（服务端解析 `data/files/<id>-<file.name>` → 条目 / 附件元数据 / 磁盘文件三重校验，缺一 404 → `cmd /c start "" "<path>"` 以系统默认程序打开）与 `POST /api/inbox/:id/reveal`（同解析 → `explorer.exe /select,"<path>"` 定位），均回 `{ ok, path }`；抽 `spawnDetached`（`detached + stdio ignore + windowsHide + unref`，不阻塞请求）与 `statLocalPath`（存在性校验）助手，既有 `POST /api/reveal` 复用；另增通用 `POST /api/open`（客户端传 `path`，供资料抽屉「打开文件」）。②**dryRun 测试通道**：`POST /api/inbox/:id/(open|reveal)` 与 `POST /api/open` 均接受 `{ dryRun: true }`——仅解析 + 校验并回传路径，**绝不 spawn**（自动化测试专用；真实 UI 永不传）。③**前端**：附件行「查看文件」`<a href="/api/files/:id">` 改为「打开文件」/「位置」两个 pill；`GET /api/files/:id` 保留（UI 不再引用）。仍仅本机（`127.0.0.1:4097`），不新增暴露面；非 Windows 平台未适配（本项目仅本地 Windows）。证据：`.qa/v27/smoke-j2.mjs`（33/33）、`.qa/v27/slice-j2-verify.py`（21/21）。

## 5. 非目标

- **深度解析**（PDF / 图片 OCR、Office 表格结构抽取）——PDF 仍仅元数据；`.docx/.pptx/.xlsx` 正文抽取已于 Slice J 支持（轻量、无依赖；xlsx 仅共享字符串表、pptx 按 slide 序号拼接文本）。
- 多文件合并为一个条目 / 附件与条目分离管理——本切片一文件一条目。
- 文件预览（图片 / PDF 内嵌查看）——不做浏览器内预览；改以「打开文件」（系统默认程序）或「位置」（文件管理器定位）处理（Slice J2）。
- 上传进度条 / 断点续传 / 分片——本地单文件直传，够用即止。
- `data/files/` 的自动 GC / 孤儿清理——随条目删除即时清理；独立 GC 另行切片。
