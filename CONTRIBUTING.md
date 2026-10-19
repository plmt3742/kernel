# CONTRIBUTING · 协作规范

> 适用对象：项目所有者（队长）、协作者、AI 会话。
> 事实源是 `docs/00-DESIGN-BRIEF.md`（项目宪法）。本文件只规定「怎么协作」，不重复产品定义。
> 冲突时的优先级：宪法 > ADR > 本文件 > 口头约定。

---

## 0. 四条硬规则

1. **`main` 只通过 PR 进入，且只由所有者合并。** 协作者可以自由推自己的分支，但不能直推 `main`。
2. **一个工单 = 一个分支 = 一个 PR。** 不夹带无关改动；发现顺手要修的东西，另开工单。
3. **没有证据 = 没完成。** 构建、行为、数据零残留，三者都要能被别人复现。
4. **未记录 = 未发生。** 代码改动的留痕是 `CHANGELOG.md` + `TASK_BOOK.md`；方向性决策再加 ADR。

---

## 1. 角色与决策权

| 角色 | 谁 | 可以做 | 不下放 |
|---|---|---|---|
| 所有者 / 队长 | @plmt3742 | 合并 PR、发布、分配工单、最终裁决 | 数据模型与字段语义、依赖引入、架构方向、目录结构、隐私与发布 |
| 协作者 | 受邀协作者 | 在工单范围内实现、补证据、更新文档、开 PR | 合并 `main`、改 `docs/00`、擅自加依赖、动 `data/` |
| AI 会话 | opencode 等 | 执行工单、产出证据、按规范留痕 | 代替所有者拍板；未经确认写入业务数据 |

`.github/CODEOWNERS` 把每个 PR 的审批指向所有者。**没有所有者的批准，PR 不能合并。**

---

## 2. 开始之前（约 30 分钟）

1. 读 `AGENTS.md`（2 分钟冷启动）。
2. 读 `docs/00-DESIGN-BRIEF.md`、`docs/02-ARCHITECTURE.md`、`docs/04-DATA-MODEL.md` 的目录与关键节。
3. 环境：Node.js **20.19+ 或 22.12+**（Vite 7 要求；推荐 22 LTS）。
4. 跑起来：

```bash
npm install
npm run dev
```

5. 确认本地门禁可运行：

```bash
node scripts/check-syntax.mjs
```

6. 从 `TASK_BOOK.md` 的「下一会话待办」或 GitHub Issue 领一张工单。**不要自行发明范围。**

**数据安全**：协作者默认只使用示例数据或隔离测试数据。不要对真实 `data/` 跑 `reset`、`refs-repair`、`resource-content-repair` 等维护脚本。需要动真实数据时，先整目录备份，并由所有者确认。

---

## 3. 工单（Definition of Ready）

一张工单必须包含以下 9 项，缺任何一项就先问，不要开工：

| 字段 | 要求 |
|---|---|
| 目标 | 一句话，一个可交付物 |
| 背景 | 对应 ADR / 文档章节 / Issue / 用户原话 |
| 通道 | A 数据面 / B 契约 / C 视图 / D 样式 / E 文档与 QA |
| 范围文件 | 只允许改这些文件或目录 |
| DoD | 可观测的完成标准，不是「做好了」 |
| 禁区 | 明确不能碰的东西 |
| 证据 | 截图 / 探针脚本 / 日志 / 哈希基线 |
| 依赖 | 前置工单、待确认问题、外部条件 |
| 优先级 | P0（本周）/ P1（近期）/ P2（后续） |

工单建议不超过 1–3 天。超过就拆成多张，每张独立可验收。

GitHub Issue 模板：`.github/ISSUE_TEMPLATE/task.yml`。

---

## 4. 通道与文件所有权

按「层」切，不按页面切。一个文件在同一迭代内只有一个 owner。

| 通道 | 拥有文件 | 交付物 | 冲突热点 |
|---|---|---|---|
| A 数据面 | `server/*.mjs`、`docs/04-DATA-MODEL.md` | 端点、Zod schema、审计、原子写 | `server/index.mjs` 一次只许一人动 |
| B 契约与状态 | `src/types.ts`、`src/lib/*.ts` | 类型、mutations、派生逻辑 | `mutations.ts`、`types.ts` |
| C 视图 | `src/views/*`、`src/components/*` | 页面与组件 | `OverviewChat.tsx`、`Library.tsx` |
| D 样式 | `src/styles/*`、`docs/03-DESIGN-SYSTEM.md` | token-only CSS、响应式、无障碍 | `views.css` 按视图前缀分块写 |
| E 文档与 QA | `docs/*`、`CHANGELOG.md`、`TASK_BOOK.md`、`.qa/vNN/`、`public/guide.html` | 台账、ADR、可复现证据 | 几乎无冲突，最适合并行 |

**跨通道改动先冻结接口**：ADR 半页 → `docs/04` 字段 → `server/schemas.mjs` → `src/types.ts`，四步完成后再并行。

---

## 5. 分支与提交

### 分支命名

```
feat/<短描述>      新功能
fix/<短描述>       缺陷修复
docs/<短描述>      纯文档
chore/<短描述>     工具、依赖、配置
qa/<短描述>        测试与证据
```

短描述用 kebab-case，例如 `feat/resource-raw-content`。

### 提交信息

中文，前缀 + 摘要；一次提交只做一件事：

```
feat: 资料详情增加原文块
fix: 收件箱应用后原文丢失
docs: 补充协作规范与风险登记
style: 资料详情原文块间距对齐
refactor: 拆分 AI 解析器
test: 补充解析器纯函数用例
chore: 增加 CI 构建门禁
```

正文写「为什么」和证据路径，不复述 diff。

### 禁止

- 直接提交到 `main`。
- 提交 `data/`、`.qa/`、`node_modules/`、`.env`、`data/meta/secrets.json`。
- 提交本机绝对路径、密钥、真实个人数据。
- 对共享分支 force push。

---

## 6. PR 与合并

1. 推分支后开 PR；未完成可以先开 Draft。
2. 填写 `.github/PULL_REQUEST_TEMPLATE.md`：工单、范围、DoD、证据、文档义务、风险。
3. CI 必须绿：构建、语法、隐私、文档义务。
4. 所有者按 5 条门禁 review；协作者 1 个工作日内响应意见。
5. 由所有者 **Squash and merge**，保持 `main` 一条改动一条提交。
6. 协作者不自行合并，即使已经获批。

---

## 7. Definition of Done（5 条门禁）

| # | 检查 | 判定方式 |
|---|---|---|
| 1 | 构建 | `npm run build` 退出 0（含 `tsc -b`） |
| 2 | 行为 | 真实入口可复现；证据在 `.qa/vNN/` 或 PR 描述里 |
| 3 | 数据 | 改前改后哈希清单一致，或明确列出预期新增记录 |
| 4 | 文档 | `CHANGELOG.md` + `TASK_BOOK.md` 已追加；触发时补 `docs/04`、`docs/05`、ADR |
| 5 | 隐私与范围 | 无 `data/`、`.qa/`、密钥、本机路径；`git diff --stat` 只出现工单声明的文件 |

额外：`node scripts/check-syntax.mjs` 必须通过。

**「我做好了」不是证据。** 只接受可复现的动作与产物。

---

## 8. 代码与数据红线

- TypeScript strict；禁止 `any`、`@ts-ignore`、`@ts-expect-error`。
- 原生 CSS + token；禁止 UI 框架、Tailwind、内联魔法值。
- **前端禁止直接写 `data/`**；写入一律经 `server/` 数据服务（Zod + 原子写 + 审计）。
- JSON 不存派生值（进度、计数、状态聚合）。
- 新增依赖必须所有者同意，并同步 `docs/02-ARCHITECTURE.md` 白名单；重大依赖开 ADR。
- AI 能力保持「先确认后写入」；禁止静默写库或谎报写入。
- 无障碍：键盘可达、焦点环可见、尊重 `prefers-reduced-motion`。
- 不提交构建产物、安装包、临时日志。

---

## 9. 文档义务（借自工程文档体系）

**一次动作、三处留痕**：

1. `CHANGELOG.md`：改了什么、为什么、怎么验的。
2. `TASK_BOOK.md`：当前迭代 + 下一会话待办。
3. ADR：方向性选择（`docs/decisions/`，递增编号，不删旧 ADR）。

**文档索引纪律**：

- 新增或修改 `docs/*.md` → 更新 `docs/README.md` 的清单与「最后更新」。
- 新增或删除目录 / 关键文件 → 更新 `docs/05-FILE-TREE.md`。
- 新增 ADR → 在 `docs/README.md` 登记；编号不得重复。
- 新增风险 → 登记到 `docs/09-RISK-REGISTER.md`，编号续增。

**登记即入台账；未记录 = 未发生。**

---

## 10. 沟通节奏

- **每日 3 行**：昨天交付 + 证据 / 今天做哪张工单 / 卡在哪。
- **卡点超过 4 小时**：直接找所有者，不要自己猜。
- **决策写在载体里**：Issue、PR、ADR，不散落在聊天记录。
- **对外承诺**只由所有者发出。
- 响应时限：1 个工作日。

---

## 11. 会话交接

每个工作段结束，在 `TASK_BOOK.md` 追加一段：

```text
日期 / 分支 / 工单
已完成：<动作 + 证据路径>
未完成：<卡点 + 下一步>
风险 / 待决：<R-xxx / 待确认问题>
```

同时确认：`CHANGELOG.md` 已追加、ADR 已补（如需要）、`docs/README.md` 已登记（如需要）。

---

## 12. 风险与升级

| 级别 | 情形 | 动作 |
|---|---|---|
| R0 | 数据丢失、密钥泄露、安全问题 | 立刻停止写入，通知所有者，不推送 |
| R1 | `main` 构建失败 | 先回滚，再修复；不在红树上叠加 |
| R2 | 范围膨胀 | 拆工单，不扩 PR |
| R3 | 技术分歧 | 所有者裁决；形成 ADR |

已知风险与缓解见 `docs/09-RISK-REGISTER.md`。

---

## 13. 自动化门禁

| 命令 / 流程 | 作用 | 当前边界 |
|---|---|---|
| `npm run build` | `tsc -b` + Vite 构建 | 不含运行时行为 |
| `npm run check:syntax` | `server/**`、`scripts/**` 的 `node --check` | 只查语法，不做类型检查 |
| `npm run check:privacy` | 变更中的密钥、本机路径、`data/`、`.qa/` | 只扫变更，不是全历史扫描 |
| `npm run check:docs` | CHANGELOG / TASK_BOOK / docs/04 / docs/05 / ADR 索引 | 只做存在性与编号校验 |
| `.github/workflows/ci.yml` | PR 上运行上述门禁 | 尚未接入单元测试 |

CI 红了就是阻塞项，不合并。

---

## 14. 第一个 PR 建议

新协作者的第一张工单不要碰 `server/`、`schemas`、依赖和安装器。建议从以下之一开始：

- 一个纯文案 / 空态修正（通道 C 或 E）。
- 一个单组件的小交互修复（通道 C）。
- 一段 `public/guide.html` 或 `docs/` 的准确性修订（通道 E）。

目的是走完「工单 → 分支 → 改动 → 证据 → 文档 → PR → 合并」全流程，而不是产出规模。
