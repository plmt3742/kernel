# ADR-0042 · 设置内数据管理——回收站并入 + 示例数据载入 / 清空

- 状态：已采纳
- 日期：2026-10-05
- 相关：ADR-0009（详情操作 + 回收站）、ADR-0031（Windows 安装包分发）、ADR-0041（分层导航：Phase 3）

---

## 1. 背景

ADR-0041 把一级导航收敛为「总览 + 行动 / 时间 / 记录 / 系统」四组，并明确 Phase 3 为「减页 + 演示支持」。本轮解决两件事：

1. **回收站仍是轨道上的一级项**——它是低频工具页，占据与循环页同等的轨道位置；系统组还为此多出一项。
2. **新用户 / 演示缺少「一键看到完整界面」的能力**——安装包发的是空数据骨架；`scripts/seed.mjs` 是**手动维护脚本**，且**安装包白名单刻意排除了 `seed.mjs`**（reset.mjs 反而在），因此安装版用户无法演示载入；同时缺少受控的「清空」入口。

## 2. 决策

### 2.1 回收站并入设置（保留路由与深链）

- `/trash` 从 `NAV_ITEMS` 移入 `EXTRA_PAGES`（`navByPath` 仍解析页面标题；轨道与移动底栏不再出现）；**系统组仅余 设置**。
- 设置页新增「回收站 / TRASH」分区，渲染与 `/trash` **同一** `TrashPanel`（`Trash.tsx` 抽出 body，路由页与设置分区共用，行为 / 类名逐字不变）。
- 命令面板「动作」组新增「回收站」动作；`/trash` 路由与全部深链保持可用。

### 2.2 示例数据载入 / 清空（设置 · 数据）

两个**受控维护端点**，均仅本机（与其余 `/api` 同口径）：

- `POST /api/demo/seed` —— 载入示例数据：
  - 要求 body `{ confirm: true }`；
  - **仅空工作区可载入**（服务端二次校验：任一实体非空 → 409）；
  - 复用既有维护脚本 `scripts/seed.mjs`（子进程执行、只读 `node:fs`）；
  - 审计 `demo.seed`。
- `POST /api/demo/reset` —— 清空所有数据：
  - 要求 body `{ confirm: true }`；
  - 复用既有维护脚本 `scripts/reset.mjs --yes`（**先整目录备份到 `.qa/backups/`**，保留 `meta/config.json`）；
  - 审计 `demo.reset`。

前端在设置·数据区提供两个动作（均需 `Modal` 二次确认；清空需勾选「我确认清空全部数据（将先自动备份）」方可提交），成功后 `hydrateFromServer()` 刷新。

### 2.3 安装包纳入 `seed.mjs`

`scripts/build-installer.mjs` 原白名单**排除** `seed.mjs`（`reset.mjs` 已在）。本决策将其纳入载荷——否则安装版无法提供「载入示例数据」。两脚本同属维护工具（`node:fs` 自包含、无外部依赖）。

### 2.4 纪律

- 正常实体写入仍一律经 `store.commit()`（Zod + 原子写 + 审计）。
- 示例载入 / 清空是 **AGENTS §4「维护脚本例外」**的显式引用：**仅在空库或显式确认**时触发，且以子进程方式执行既有脚本，**不新增常规写路径**。
- `readSnapshot()` 每次从磁盘现读（无缓存），故外部脚本写入后前端再水合即可见。

## 3. 边界（明确不做）

- 载入示例数据**不改动非空工作区**（绝不覆盖 / 合并）。
- 不做逐条演示数据管理（清空 = 全量重置，自动备份可回滚）。
- 不自动载入示例数据；首次使用仍按 ADR-0041 Phase 2 的渐进披露呈现。
- 不合并课表 / 个人页（Phase 3 剩余项，另行拍板）。

## 4. 验证

- `node --check server/index.mjs` 0；`npx tsc --noEmit` 0；`npm run build` 0（Settings chunk 24.33 kB / Trash 3.27 kB）。
- **隔离 QA**（Playwright；`/api/snapshot`、`/api/demo/seed`、`/api/demo/reset`、`/api/trash` 全拦截 mock，**真实数据零触达**；`.qa/v79/qa-phase3.py`）**21/21 PASS**：
  - 空工作区：载入按钮可用 → 弹窗 → 发出 `{confirm:true}` 请求 → toast；清空弹窗未勾选时确认禁用 → 勾选后提交 → toast；
  - 轨道 11 项且无「回收站」；命令面板含「回收站」动作；设置「回收站」分区渲染空态；`/trash` 深链仍可用；
  - 真实（非空）数据下：载入按钮禁用 + 提示「仅空工作区可载入」；各页 console 0 error。
- 截图：`.qa/v79/settings-{data-empty,demo-block,trash,reset-modal}.png`。
- 备注：端点本身**未对真实数据触发**（载入为破坏性初始化，留待所有者在空库时使用）；其正确性由 `node --check` + 代码审查 + mock 全链路验证覆盖。QA 中一次「页面空白」系测试夹具 `?api/trash` 形状错误（应为 `{"items":[]}`），非应用缺陷。
