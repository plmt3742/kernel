# ADR-0030 · AI Key 本地配置 + 双击启动器（Slice N5）

- 状态：已采纳
- 日期：2026-10-03
- 相关：ADR-0004（数据服务 · 单写者）、ADR-0005（opencode AI 接入）、ADR-0008（收件箱文件投递）、ADR-0011（先确认后写入）、ADR-0027（链接阅读）

---

## 1. 背景与反馈


在 N5 之前，AI 能力依赖本机 opencode serve，而 opencode 调 DeepSeek 需要 `DEEPSEEK_API_KEY`，这个 key 一直只存在于 opencode 自身配置或 shell 环境里，应用内既看不到、也设不了。所有者要的是三件事：

1. 在**设置页**直接填 API Key，存本地，不写死在代码里、不进仓库；
2. 以后想把项目打包传 GitHub、发对外体验；

本切片（Slice N5）给出设置页「AI 集成」的 Key 块、本机凭据存储、启动注入，以及一个双击就能跑起来的启动器。

## 2. 决策

### 2.1 本机凭据文件（`data/meta/secrets.json`）

| 维度 | 规格 |
|---|---|
| 位置 | `data/meta/secrets.json`，键 `deepseekApiKey` |
| 入库 | **已 gitignore**（`.gitignore` 第 44 行）；密钥绝不进仓库 |
| 排除项 | `data/meta/config.json` 是 git 跟踪文件，**刻意不放**密钥 |
| 读取 | `server/secrets.mjs`：文件缺失 / 非法 JSON / 非对象形状 → 一律视为「无凭据」（静默 `{}`），**绝不抛出** |
| 写入 | `write-file-atomic` 原子写；trim 后非空 = 保存，空 = 删除该键（本无该键则不产生空文件） |
| 模块纪律 | 无副作用：不写审计、不打日志、绝不输出明文；可被数据服务与 `scripts/dev.mjs` 相对导入（路径基于文件自身定位，与 cwd 无关） |

### 2.2 端点与审计

| 层 | 变更 |
|---|---|
| 读取 | `GET /api/ai/health` 追加 `hasKey`（本机凭据有非空 `deepseekApiKey` 即 true；不影响既有字段） |
| 写入 | `POST /api/ai/key { apiKey }`（`aiKeyUpdateSchema`：`apiKey` 字符串 ≤300）；trim 后非空 = 保存 / 覆盖，**空串 = 清除** |
| 审计 | 写后追加 `ai.key.update`（`entity:'ai'`、`id:'-'`），`detail` **只记 `hasKey` 布尔**，绝无明文 |
| 日志 | 服务端只打印 `hasKey=<bool>`；启动器只报「已注入」，绝无明文 |

保存与清除是同一端点：空串即清除。前端 pill「已配置 / 未配置」由 `health.hasKey` 驱动，保存 / 清除响应即时覆盖、health 刷新后归位。

### 2.3 启动注入

`scripts/dev.mjs` 拉起 opencode serve 时：

- 经 `getDeepseekKey()` 读取本机 key；非空则把 `DEEPSEEK_API_KEY` 注入 opencode 子进程环境，空则维持继承 `process.env`。
- 日志只报「已从设置注入 AI Key（DEEPSEEK_API_KEY）」，**绝不输出 key 明文**。
- opencode **已在运行时**，注入不生效（不会热改既有进程）；**下次重启启动器后生效**。

### 2.4 安全规则表

| 规则 | 落实 |
|---|---|
| 绝不回显 | 设置页输入框 `type=password`，保存成功后立即清空；对外只回布尔 `hasKey` |
| 绝不入快照 | `GET /api/snapshot` 不含 key（快照来自 `data/**` JSON，密钥是独立文件、不在其中） |
| 绝不入审计 | `ai.key.update` 的 `detail` 仅 `hasKey` |
| 绝不入日志 | 服务端 / 启动器日志只打印布尔或「已注入」 |
| 绝不入库 | `data/meta/secrets.json` 已 gitignore；密钥不写进任何 git 跟踪文件 |
| 仅本机 | 数据服务仅 `127.0.0.1:4097`；Key 只由本机数据服务读取并注入本机 opencode |

### 2.5 双击启动器

| 文件 | 职责 |
|---|---|
| `启动.cmd` | 双击入口。Node 缺失给中英双语提示 + nodejs.org 指引；CRLF / UTF-8 **无 BOM**（避免 cmd 解析问题）；检测到 Node 即转 `scripts/launcher.mjs` |
| `scripts/launcher.mjs` | Node 18 自检（低版本仅警告、不阻断）；`node_modules` 缺失自动 `npm install`；探测 opencode CLI（缺失仅提示，AI 之外功能不受影响）；启动 `node scripts/dev.mjs`；轮询 `127.0.0.1:5173` 就绪后自动开浏览器；致命错误打印中文并**按回车退出**，避免双击窗口一闪而过 |

README「快速开始」加入口。

### 2.6 librarian 事实核验

打包与注入依赖 opencode 的真实行为，经 librarian 逐条核验并写进决策依据：

- opencode 目录级确认 provider `deepseek` 的环境变量名就是 `DEEPSEEK_API_KEY`。
- **spawn 注入即生效**，无需先 `opencode auth login`。
- opencode **无原生 `OPENCODE_MODEL` 环境变量**：默认模型走 opencode.json 的 `model` 字段；可用 `OPENCODE_CONFIG_CONTENT` 内联配置替代。
- 凭据优先级：`config options.apiKey` > `auth.json` > 环境变量。
- Windows 全局配置位于 `~/.config/opencode/opencode.json`。

## 3. 备选与取舍

| 备选 | 取舍 | 理由 |
|---|---|---|
| 存进 `config.json`（git 跟踪） | **否决** | 该文件入库，密钥会被提交上 GitHub，违反「绝不入库」 |
| 独立 gitignore 文件（本次采纳，`data/meta/secrets.json`） | **采纳** | 与其它 meta 同级、语义清晰；gitignore 一行即隔离；原子写 + 无副作用模块，读写简单 |
| 引导 `opencode auth login` | **否决** | 需用户在终端交互，与「双击即用」冲突；且凭据散落在 opencode 自己的 `auth.json`，应用内不可见、不可清除 |
| 应用内填 + 启动注入（本次采纳） | **采纳** | 设置页一处填、本机存、启动注入；UI 有状态 pill、可清除，闭环留在应用内 |

## 4. 边界

- **已在运行不生效**：opencode 若早已在跑，设置页新填的 key 不会热注入，**下次重启启动器后生效**（应用内已注明）。
- 密钥（`data/meta/secrets.json`）与附件（`data/files/`）已 gitignore，不会入库；但 **GitHub 上传前仍需清理 owner 个人数据**（`data/` 目前仍入库）。
- 仅 DeepSeek 一个 provider：`secrets.mjs` 只认 `deepseekApiKey`；多 provider 为后续切片。

## 5. 影响面（文件）

- 服务端：`server/secrets.mjs`（新增：本机凭据读写 + 无副作用）、`server/index.mjs`（`GET /api/ai/health` 增 `hasKey`；`POST /api/ai/key` + `aiKeyUpdateSchema` + `recordAudit`）。
- 前端：`src/views/Settings.tsx`（「AI 集成」Key 块：密码型输入 / 保存 / 清除 / 状态 pill）、`src/lib/mutations.ts`（`setAiKey`）、`src/lib/hooks.ts`（health 增 `hasKey`）。
- 无新增依赖；无数据模型变化；**新增一个端点**（`POST /api/ai/key`）。

## 6. 验证与证据

QA v62（**35/35 PASS**，证据 `.qa/v62/`）：

- **冒烟 15/15**：初始态 = 无 `secrets.json` + `hasKey=false`；保存 200 `{ok:true,hasKey:true}` 且文件含 key；覆盖为新值（替换语义，旧值消失）；清除 200 `{ok:true,hasKey:false}` 且键已删；最终恢复初始态。
- **防泄漏**：`GET /api/snapshot` 原始响应 `containsKey=false`；审计 `ai.key.update` 的 `detail` 仅 `{"hasKey":true}`（`containsKey=false`，无明文）；数据服务日志不含 key。
- **E2E 16/16**：Key 块存在、初始 pill「未配置」、输入 `type=password`、输入框空；保存后 toast「已保存 API Key」、pill「已配置」、输入框清空（不回显）；刷新后 pill 仍「已配置」（持久）；「清除」→ toast「已清除」、pill「未配置」；console 预期外 error 0。
- **启动器静态 4/4**：`node --check scripts/launcher.mjs` exit 0；`KERNEL_LAUNCHER_SKIP_DEV=1` 自测跳过 dev、exit 0；`启动.cmd` 字节 `{bytes:368, BOM:false, hasCRLF:true}`（无 BOM、纯 CRLF）。
- **零残留**：QA 全程未改产品代码；假 key 用毕恢复初始态（`secrets.json` 不存在、`hasKey=false`），未触碰 owner 数据。
