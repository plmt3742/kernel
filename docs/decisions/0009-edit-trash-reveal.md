# ADR 0009 · 详情操作 + 回收站 + 资源文件位置（Slice E2）

- 状态：已接受
- 日期：2026-10-03
- 决策者：项目所有者（「详情页缺编辑 / 删除按钮 → 加编辑与删除（删除进回收站）；做一个回收站（可恢复 + 彻底删除）；资源详情要指明文件存哪里，点击可在文件管理器打开」）+ 实证（`.qa/v18/smoke-e2.mjs`、`.qa/v18/slice-e2-verify.py`）
- 关联：ADR-0004（数据服务）/ ADR-0008（文件投递）、`docs/02-ARCHITECTURE.md` §3、`docs/04-DATA-MODEL.md` §4.9 / §5.4b、`docs/05-FILE-TREE.md`、`CHANGELOG.md`、`TASK_BOOK.md`、`.qa/v18/`

---

## 1. 背景

Slice A–E1 已把「文件即数据库 / opencode 即大脑」落成收件箱与回顾的 AI 闭环，并支持文件投递。但详情抽屉此前只能「看」与「标记完成」，缺少两件日常必需的操作：

1. **编辑与删除**——任务 / 项目 / 笔记 / 资料都没有通用编辑入口；删除也无处安放（不能硬删，误删不可逆）。
2. **资源文件位置**——文件投递澄清为资料后，附件躺在 `data/files/`，但资料详情不显示它在哪里，更无法一键在文件管理器中定位。

本切片补齐「详情操作」这一层：通用编辑、软删除（回收站）、资源文件位置与定位。

## 2. 决策

1. **通用更新端点**：`POST /api/(tasks|projects|notes|resources)/:id/update`（单条正则路由）。
   - 读原记录 → 不存在 404；body 为 partial；**仅合并白名单字段**（其余一律忽略）；保留 `id` / `createdAt`；`updatedAt = nowIso()`；经该 kind 的 `SCHEMAS[kind]` 校验；`commit` 审计 `<singular>.update` + `detail: { fields: [变更键] }`；返回 `{ record }`。
   - 白名单（代码内定，见 `server/index.mjs` `EDITABLE_FIELDS`）：
     - tasks：`title, status, contexts, energy, importance, estimateMin, dueAt, deferUntil, projectId, areaId, tags, notes`
     - projects：`title, outcome, status, areaId, dueAt, tags`
     - notes：`title, type, body, tags`
     - resources：`title, kind, status, url, path, tags, note`
   - body 中值为 `null` 的字段视为「清除」（从记录删除该键），供前端清空可选字段（如截止日期、项目归属）。
   - 约定：所有新增动作路由返回 `{ record }`（编辑）或 `{ trashed | kind+record | purged }`，前端 `mutations.ts` 负责 upsert / remove。

2. **回收站（软删除）**：存储 `data/trash/<kind>/<id>.json` = 原记录 + `trashedAt`。
   - `server/store.mjs` 增 `moveToTrash`（原子写副本 → 删正册）/ `restoreFromTrash`（写回正册（去 `trashedAt`，经 schema 校验）→ 删副本）/ `purgeTrash`（删副本）/ `readTrash`（全量 `{kind, record}`，按 `trashedAt` 倒序）；全部走既有 `serialize` 写队列，保证与其它写入互斥。
   - 路由：`POST /api/<kind>/<id>/trash`（不存在 404；审计 `<singular>.trash`）、`GET /api/trash` → `{ items }`、`POST /api/trash/<kind>/<id>/restore`（审计 `<singular>.restore`）、`POST /api/trash/<kind>/<id>/purge`（审计 `<singular>.purge`）。kind 白名单 = 四种可写实体；id 经 `ID_PATTERNS` 校验防目录穿越。
   - **`nextId` 同时扫描 `data/trash/<kind>` 取最大值**（原实现只扫正册）。这是必须修的正确性缺陷：删除后 id 若被复用，恢复旧记录会与新记录 id 冲突 / 覆盖。
   - 回收站**不进入** `/api/snapshot`：避免软删除记录污染常规视图与派生计算；前端 `/trash` 页单独经 `GET /api/trash` 加载。

3. **资源文件位置 + 定位**：
   - `resourceSchema` 增可选 `path: z.string().min(1)`；`Resource.path?`（前端类型）。
   - 澄清联动：文件投递条目（`item.file`）澄清为资料时，记录 `kind:'file'`、`path = <projectRoot>/data/files/<inboxId>-<fileName>`（绝对路径）、`title = item.content`。非文件条目行为完全不变。
   - `POST /api/reveal { path }`：trim → 非空字符串；`path.resolve` 绝对化；`fs.existsSync` 否则 404 `文件不存在`；**detached + `stdio:'ignore'` + unref** 启动 `explorer.exe`：文件 → `['/select,', resolved]`（定位并选中），目录 → `[resolved]`；返回 `{ ok: true }`。
   - **本地个人工具，无额外限制**：`/api/reveal` 只在本机（服务仅监听 `127.0.0.1:4097`，前端经同源 `/api` 代理）可用；不暴露局域网即无远端触发面。不在服务端限制路径范围——所有者对自己的机器有完整权限，加白名单只会妨碍正当用途。

4. **前端**：
   - 抽屉底部统一「编辑 / 删除」安静 ghost 动作（`.k-drawer__foot-actions`，右对齐）；编辑态下底部动作让位给表单自身的「保存（实心）/ 取消（ghost）」。
   - 新增 `src/components/EntityEditForm.tsx`：字段规格驱动（`text / textarea / number / select / datetime / list`），提交时归一化为 patch；`datetime` 用 `datetime-local` 显示、以本机时区转 ISO（`+08:00`）；`contexts` 为逗号文本（占位提示 7 个已知上下文）；`tags` 为逗号文本；`path` 为可清除文本。
   - 删除 → `trashEntity` → 从快照移除 → toast「已移入回收站 · 撤销」（撤销调 `restoreEntity` upsert 回）。**不做二次确认**：撤销才是安全网。
   - 新增 `/trash` 页：按类型分组（任务 / 项目 / 笔记 / 资料），行显示标题 + id + 移入时间（相对）；「恢复」直达；「彻底删除」双击确认（首次点击标签变「再点一次确认」，5s 未再点则复位）。空态「回收站为空」。
   - 资料抽屉新增「文件位置」区块：有 `path` → 等宽截断路径 + 「在文件管理器中显示」（成功不打扰，失败错误 toast）；无 `path` → 「未记录文件位置 · 可通过编辑补充」。

## 3. 理由

- **单写者不破**：编辑 / 回收站 / 恢复 / 彻底删除全部经数据服务 `commit` / 存储层函数，审计齐全；前端只经 `/api`。
- **软删除优于确认弹窗**：删除先进回收站并给 5s 撤销，比模态确认更顺手且可逆；彻底删除才需要双击确认。
- **白名单优于整体覆盖**：显式字段白名单防止前端误传（或未来视图新增字段）覆盖 `id` / `createdAt` / `sourceInboxId` 等系统字段；`fields` 审计可回溯改了什么。
- **回收站不污染快照**：软删除记录若混入 snapshot，会让计数、进度、逾期等派生值全部失真；独立端点保持快照语义干净。
- **`explorer /select` 而非自建文件浏览器**：本机场景下系统文件管理器是最顺手的目标；`/select` 能高亮目标文件，比「打开所在目录」更精确。
- **澄清即记录位置**：文件一进系统就有稳定落点，资料详情与文件一一对应，避免「文件去哪了」。

## 4. 后果

- `server/schemas.mjs`：`resourceSchema` 增 `path?`。
- `server/store.mjs`：增 `TRASH_DIR`、`moveToTrash` / `restoreFromTrash` / `purgeTrash` / `readTrash`；`nextId` 增扫回收站。
- `server/index.mjs`：增 `POST /api/<kind>/<id>/update`、`POST /api/<kind>/<id>/trash`、`GET /api/trash`、`POST /api/trash/<kind>/<id>/restore`、`POST /api/trash/<kind>/<id>/purge`、`POST /api/reveal`；文件澄清补 `kind:'file'` + `path`。
- 前端：`src/types.ts`（`Resource.path?` + `TrashKind` / `TrashRecord` / `TrashItem`）、`src/lib/mutations.ts`（`updateEntity` / `trashEntity` / `restoreEntity` / `purgeEntity` / `fetchTrash` / `revealPath`）、`src/components/EntityEditForm.tsx`（新）、`src/views/{Tasks,Projects,Library}.tsx`（编辑 / 删除 / 文件位置）、`src/views/Trash.tsx`（新）、`src/lib/nav.ts`（`09 回收站`）、`src/App.tsx`（`/trash`）、`src/styles/views.css`（表单 / 回收站 / 文件位置）。
- `data/` 新增 `data/trash/` 目录（软删除记录）；备份 / 迁移需一并处理。
- 验证（本机）：`npm run build`（tsc strict + vite）通过；服务端冒烟 **34/34**（编辑生效 + updatedAt 递增 + 白名单忽略未知字段 + 审计；trash / restore / purge 文件往返 + 审计；reveal 空路径 400 / 不存在 404 / 真实文件 200）；浏览器 E2E **19/19**（编辑保存 + UI 更新、删除 toast + 离场、回收站出现 / 恢复 / 再删 / 双击彻底删除、资源补 path + 文件位置行 + reveal HTTP 200、零残留、控制台零错误）；全站回归 smoke PASS。证据 `.qa/v18/`（`smoke-e2.mjs` + `.log`、`slice-e2-verify.py` + `.log`、`e2-edit.png` / `e2-trash.png` / `e2-resource-path.png`）。
- 备注：验收含**两次真实 reveal 调用**（冒烟 1 次 + E2E 1 次），会在所有者屏幕各弹一次 Explorer 窗口，属预期行为。

## 5. 非目标

- 回收站的自动过期 / 容量上限 / GC——本地个人工具，手动彻底删除即可；需要时另行切片。
- 批量编辑 / 批量删除 / 批量恢复——本切片为单条操作；批量在收件箱批量澄清中已具雏形。
- 撤销栈 / 版本历史 / 字段级 diff 回溯——审计日志已记录变更字段名，完整版本历史另行评估。
- 编辑冲突检测（多标签同时编辑同一条）——单用户本机场景，聚焦水合已够用。
- 用系统「回收站」API（`SHFileOperation`）替代自有 `data/trash/`——自有实现与「文件即数据库」一致、可 diff、跨平台语义清晰。
- `/api/reveal` 的路径白名单 / 权限校验——仅本机可用，见 §2.3。

---

## 6. 修订（2026-10-03 · Slice E2.5：project.create + touch 语义）

补齐「项目闭环」的两个缺口（owner 反馈：项目如何诞生 / 归档）。

1. **新增 `POST /api/projects { title, areaId? }`**（§2.1 的 create 侧）：`title` 非空否则 400；创建 `{ id: nextId('projects'), title, outcome:'完成定义待整理', status:'active', areaId: areaId ?? 'a-0001', tags:[], createdAt, updatedAt }`；经 `projectSchema` 校验；`commit` 审计 `project.create`（`detail.title`）；返回 **201 `{ project }`**。前端 `mutations.createProject` + Projects 页快速新建（回车 → toast「已创建项目 · 撤销」，撤销走 `trashEntity` 进回收站）。
2. **`updateEntity` 空 patch = touch**（§2.1 update 侧）：当 body 中**没有任何白名单字段**存在时，不再视为「无变更的 update」，而是**touch**——仍然 `next.updatedAt = nowIso()` 并落盘，审计动作由 `<singular>.update` 改为 **`<singular>.touch`**（有字段时行为不变，仍 `.update` + `detail.fields`）。用途：「回顾」页停滞项目的「迁移」= 重决策继续推进 → 刷新 `updatedAt` 使其退出停滞（14 天内）。返回仍为 `{ record }`。
3. **回顾页接通**：`Review.tsx` 归档 → `updateEntity('projects', id, { status:'archived' })` + 撤销回 `active`；迁移 → `updateEntity('projects', id, {})` + toast「已重决策：继续推进」；移除原型态文案；补 `useDataRevision()` 订阅。archived 项目由 Projects 页按状态分组隐藏（`GROUPS` 不含 archived），语义一致。
4. **限制说明**：当前 `data/` 无停滞项目（种子项目 `updatedAt` 均为近期），回顾页「迁移 / 归档」的 **UI 点击路径无法覆盖**；touch / archive 语义已由服务端冒烟覆盖（`.qa/v19/smoke-e25.mjs`：create → touch → archive → trash/purge + 审计断言）。
