# ADR-0046 · 微信通道：企业微信群机器人（Phase 1 出站）

- 状态：已采纳（Phase 1 实现）
- 日期：2026-10-22
- 相关：`docs/02` §4、`docs/04` §1/§4.1、ADR-0030（本机凭据）、ADR-0033（联网检索）、`CONTRIBUTING.md` §4.1

---

## 1. 背景

所有者 2026-10-22 要求「做好微信 bot 接口到这个程序，实现一些基础功能」。KERNEL 是本地优先应用：数据服务 `127.0.0.1:4097`、opencode `127.0.0.1:4096`，不暴露公网。个人微信非官方协议（itchat / wechaty / PC 注入）有封号风险、违反 ToS，本决策明确禁止。

Phase 1 只做**出站**（每日简报 / 到期提醒 / 测试推送），并把**入站**的本地接口预留；双向对话在所有者选定通道后另开 Phase 2。

## 2. 通道对比

| 通道 | 能力 | 代价 | 结论 |
|---|---|---|---|
| 企业微信群机器人 webhook | 仅出站 | 5 分钟配置、零公网 | **Phase 1 采用** |
| 企业微信自建应用 + 云端中继 | 双向 | 需企业微信 admin + Worker + 回调校验 | Phase 2（待所有者选型） |
| 微信公众号（订阅号 / 服务号） | 双向 | 需公网回调域名、配置更重 | 备选 |
| 个人微信非官方协议 | 双向 | 封号 / 违反 ToS | **禁止** |

## 3. 决策

### 3.1 Phase 1：企业微信群机器人 webhook（仅出站）

- 适配层 `server/notify/`：`wecom.mjs` 定义 `Notifier` 契约（`send(text)`）与企业微信适配器；后续公众号 / 自建应用适配器实现同一契约。
- 只允许两类 webhook：
  - `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…`（官方 HTTPS）；
  - `http://127.0.0.1:<port>/…` / `http://localhost:<port>/…`（本机 mock，联调用）。
  - 其他主机 / 协议 / 带账号密码的 URL 一律 400（避免把本机数据发到未知主机）。
- webhook URL 与入站 token 只存 `data/meta/secrets.json`（gitignore），**不回显、不写日志 / 审计**；设置页只显示「已配置 / 主机名」。
- 每日简报默认 `08:00`，到期提醒默认提前 `30` 分钟；时间 / 分钟数存 `data/meta/config.json`（非密钥），设置页可改。
- 服务端定时器（数据服务进程内，30s tick）不依赖浏览器常开；失败按 1 / 5 / 15 分钟指数退避，3 次后标记失败并在状态中可查。
- 去重：`digest:<YYYY-MM-DD>` 与 `due:<taskId>|<dueAt>` 记录在 `data/meta/notify-state.json`；同一键成功 / 失败终态只发一次。

### 3.2 入站预留：`POST /api/wechat/inbound`

- 仅数据服务本机可调用（`127.0.0.1` / `::1`；不暴露局域网）。
- `Authorization: Bearer <token>`：token 与 secrets 中 `wechatInboundToken` 做定时安全比较；无 token 或错误 → 401；未配置 token → 503。
- body `{ msgId, text }`：`msgId` 幂等（状态文件记录 `msgId → inboxId`），重复请求返回 `duplicate: true`；首次写入复用 `store.commit('inbox')` 单写者 + 审计 `wechat.inbound`。
- `source: 'wechat'`；消息正文进入收件箱后仍走既有「澄清 / AI 解析」流程。
- Phase 2 中继（企业微信自建应用 / 公众号）直接调用该端点；本 ADR 不实现中继。

### 3.3 数据流

```text
本地数据（data/*.json）
  └─ 通知调度器（server/notify）→ 企业微信群机器人 webhook（出站）
Phase 2 中继（公网 / 企业微信）→ POST /api/wechat/inbound（仅本机）→ data/inbox/
```

出站内容最小化：只发标题 / 时间 / 计数，不发完整笔记正文；不把 webhook / token 放入响应、审计或日志。

## 4. 安全模型

- **密钥**：`data/meta/secrets.json`，gitignore；服务端只在发送时读取，不返回明文。
- **入站**：Bearer token + 仅回环地址 + `msgId` 幂等；token 比较使用 `crypto.timingSafeEqual`。
- **出站**：webhook 主机白名单（官方企业微信 / 本机 mock）；10s 超时；非 2xx / `errcode != 0` 视为失败。
- **审计**：`wechat.configure`（键名 / 主机 / 是否配置，不含 URL / token）、`wechat.send`（kind / 成功 / 重试次数 / 字符数）、`wechat.inbound`（msgId 哈希前缀 / 字符数，不落正文）。
- **禁区**：不接个人微信非官方协议；不暴露 4097 / 4096；不做端口映射；不提交 webhook / token / 二维码。

## 5. 影响面

- 新增 `server/notify/{index,wecom}.mjs`；`server/{index,secrets,schemas}.mjs` 增加路由 / 凭据 / 字段。
- 前端：设置页新增「通知」分区；`src/types.ts` 增加 `NotifyStatus` / config 字段；`src/lib/mutations.ts` 增加通知 API；收件箱来源增加 `wechat`。
- 文档：`README.md`、`public/guide.html`、`docs/02`（端点）、`docs/04`（config 字段 / inbox source）、`docs/05`（目录）、`docs/README.md`（ADR 索引）。
- 依赖：无新增依赖（Node 内置 `fetch` / `crypto` / `write-file-atomic` 既有）。

## 6. 验证（Phase 1）

- 测试推送：设置页配置本机 mock webhook → 测试推送 → mock 收到 1 条。
- 简报 / 到期提醒：`KERNEL_NOTIFY_TEST=1` 时用测试时钟 tick 触发；重复 tick 不重复发送。
- 入站：带 token → 收件箱新增；无 token → 401；重复 `msgId` → `duplicate: true`；`source: 'wechat'`。
- 密钥：状态 / 响应 / 日志 / 审计中不含 webhook / token 明文。
- 门禁：`npm run build` + `check:syntax` + `check:docs` + `check:privacy` 全 0；证据 `.qa/wechat-v1/`。

## 7. 非目标 / 后续

- 不实现个人微信、公众号、企业微信自建应用的入站回调；不做双向对话、群聊管理、二维码登录。
- Phase 2 需所有者选定通道并提供回调域名 / 中继方案，另行开票。
