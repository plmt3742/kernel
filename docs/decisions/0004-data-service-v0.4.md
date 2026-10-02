# ADR 0004 · v0.4 数据服务实现

- 状态：已接受
- 日期：2026-10-02
- 决策者：项目所有者（「继续」指令）+ 实现方提案
- 关联：`docs/02-ARCHITECTURE.md` §3.2、`docs/04-DATA-MODEL.md` §9、`CHANGELOG.md` v0.4.0、`.qa/review/REVIEW-2026-10-02.md`（P0 六项并入本版）

---

## 1. 背景

宪法与架构文档规划的「Node 单写者数据服务」在 v0.4 落地：所有写入收口为唯一路径，替换 localStorage 原型态覆盖层，并解决全站审阅确认的 P0 数据可信性问题（澄清不落地、计数口径分裂、写入失败静默、缺 `doneAt`、多标签不同步）。`docs/02` §7 约定：实现时可对规划做具体化，偏离需新 ADR——本 ADR 记录这些具体化决策。

## 2. 决策

1. **进程与端口**：数据服务为独立 Node 进程（纯 `node:http`，无 Web 框架），仅监听 `127.0.0.1:4097`（opencode serve 预留 4096）；浏览器经 Vite 代理 `/api` 访问（dev 与 preview 同一配置，手机经局域网入口同样只走代理）。
2. **依赖**：新增 `zod`（写入校验）与 `write-file-atomic`（原子写）；均为服务端依赖，前端依赖白名单不变。
3. **写入端点**（单写者串行队列 + Zod 校验 + 原子写 + 审计追加）：
   - `POST /api/tasks`（快速新建）/ `POST /api/tasks/:id/complete` / `POST /api/tasks/:id/reopen`
   - `POST /api/inbox`（捕捉）/ `POST /api/inbox/:id/clarify`（task / project / note / resource / discard）/ `POST /api/inbox/:id/revert`（撤销澄清，含删除产物）
   - `GET /api/snapshot`（前端水合）/ `GET /api/activity`（审计尾部）/ `GET /api/health`
4. **完成语义**：完成 = `status:'done'` + `doneAt` 落盘；重新打开从审计日志还原 `beforeStatus`（缺省 `next`）。
5. **前端数据模型**：`src/lib/data.ts` 持有可变更快照（首帧为构建期 seed，挂载后经 `/api/snapshot` 水合），视图 getter 保持同步 API 不变；写入经 `src/lib/mutations.ts` 乐观更新 + 失败回滚；删除 `src/lib/proto.ts`（localStorage 原型层退役）。
6. **一致性**：窗口聚焦 / 可见时重新水合（多标签同步）；状态条与设置页显示数据服务在线状态；写入失败显式 toast（不再静默）。
7. **数据目录**：`data/activity.jsonl` 为审计日志（每次变更追加）；`data/**` 写入不再触发 Vite 热重载（`server.watch.ignored`），前端经水合与本地合并获取最新状态。

## 3. 理由

- **回环 + 代理**：浏览器与手机都只有一个入口（5173/4173），数据服务永不暴露局域网，与 `docs/02` §4.3 安全纪律一致。
- **纯 node:http**：路由面小（9 个），引入框架的收益低于依赖增量。
- **同步 getter + 单一 store**：保持全部视图的读取姿势不变，改造面集中于写入路径，降低回归风险。
- **乐观更新**：本机毫秒级延迟下仍保证 UI 即时反馈（完成划线/塌缩动效不等待网络）；失败回滚 + 错误 toast 兜底审阅 P0#3。

## 4. 后果

- 「原型态」语义退役：界面标签改为数据服务状态；Review 的迁移/归档演示与 AI 占位仍标注其规划版本（v0.6 / v0.5）。
- 审阅 P0 六项随本版落地：澄清落地（含撤销）、计数口径统一（单一数据源）、写失败告警、清除原型态入口移除（不再需要）、`doneAt`（回顾图表联动）、多标签聚焦同步。
- 备份策略：原子写入 + 审计日志 + git（`data/` 在版本控制内）；暂不引入额外备份工具。
- 手机端经局域网写数据同样经 Vite 代理 → 数据服务，单写者纪律不破。

## 5. 非目标

- opencode AI 接入（v0.5）。
- 实时推送（SSE / WebSocket）：多标签以聚焦重水合满足当前需求；实时通道留给 v0.5 的 AI 流式场景。
- 数据编辑面扩张（任务编辑、项目编辑等）：留待后续版本。
