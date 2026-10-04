# ADR-0037 · 原生桌面启动器（Slice N7.2）

- 状态：已采纳
- 日期：2026-10-04
- 相关：ADR-0030（AI Key 本地配置 + 双击启动器）、ADR-0031（分发包 + 启动页）

---

## 1. 背景与反馈

所有者对旧启动器的评价：「太丑 / 网页套壳 / 很低廉。」

Slice N5（ADR-0030）与 N7.1 交付了 `启动器.hta`：单文件、零依赖，但界面用 IE / MSHTML 引擎（经 `mshta.exe`）承载，观感是标准的「网页套壳」：

- 白色系统标题栏，与 KERNEL「柔暗夜色」视觉方向割裂；
- 窗口图标为 mshta 默认图标，无品牌识别；
- 方角窗口，无圆角与柔影，像早期浏览器弹窗；
- 渲染天花板锁定 IE11，做不了圆角卡片、自绘标题栏与细腻动效。

行为层面旧启动器已够用（启动 / 打开 / 停止 / 创建桌面快捷方式 / 自动开浏览器），问题集中在观感与廉价感。本切片（Slice N7.2）以原生 Windows 窗口替换 HTA：保留全部行为，重做外观。

## 2. 决策

采用「VBScript 引导 + PowerShell 原生窗口」两段式：

```text
双击 启动器.vbs → wscript 隐藏拉起 启动器.ps1 → PowerShell 5.1 + .NET Framework WPF 原生窗口
```

- **`启动器.vbs`**：入口，纯 ASCII（避免编码地雷），以 `wscript` 无控制台方式启动 PowerShell，全程零黑窗。
- **`启动器.ps1`**：单文件原生窗口，用 PowerShell 5.1 + .NET Framework WPF（Win10 / 11 内置，零安装）。无边框圆角卡片 + 自绘标题栏 + 品牌 K 标记 + `kernel.ico` 图标。
- **`kernel.ico`**（仓库根）：多尺寸图标，由 `public/favicon.svg` 的 K 笔画几何重新生成；生成器 `scripts/make-icon.ps1`（System.Drawing，可重跑）。
- **桌面快捷方式** `KERNEL 启动器.lnk`：目标改为 `wscript.exe` + `启动器.vbs`，图标指向 `kernel.ico`（此前是 mshta + HTA + 默认图标）。

行为与旧启动器一致（parity）：探活 `127.0.0.1:5173`（每 800ms）、启动 / 停止 dev 栈、就绪后自动开浏览器、创建桌面快捷方式、日志按钮打开 `启动.cmd`、同一状态机。新增能力见下表。

| 能力 | 说明 |
|---|---|
| 单实例 | 互斥锁，防止重复开窗 |
| selftest 钩子 | 环境变量 `KERNEL_LAUNCHER_SELFTEST`，写 `%TEMP%\kernel-launcher-selftest.txt` |
| smoke 钩子 | 环境变量 `KERNEL_LAUNCHER_SMOKE_MS`，自动关窗，供自动化测试 |
| 探活覆盖 | 环境变量 `KERNEL_LAUNCHER_PROBE_URL`（测试用） |
| 停止态文案 | 停止中按钮文案修正为「停止中…」 |

## 3. 备选与取舍

| 备选 | 取舍 | 理由 |
|---|---|---|
| 继续打磨 HTA | **否决** | IE11 + 系统标题栏是硬天花板，圆角 / 自绘标题栏 / 柔影都做不出；「网页套壳」的廉价感源于载体本身 |
| csc 编译 exe | **否决** | 会引入构建产物与二进制入库，启动器从「可读脚本」变成「不透明二进制」，维护与审计成本上升 |
| WebView2 | **否决** | 仍是用网页承载界面，正是被否决的观感；且依赖运行时（并非所有机器预装） |
| PowerShell + WPF 原生窗口 | **采纳** | WPF 随 Win10 / 11 内置、零安装、零编译产物；窗口由系统原生渲染，圆角卡片 / 自绘标题栏 / 图标 / 动效都能做到；脚本可读、可 diff |

## 4. 约束与边界

- **平台**：仅 Windows 10 / 11。依赖 PowerShell 5.1 与 .NET Framework WPF，均为系统内置。
- **编码纪律**：`启动器.ps1` 用 UTF-8 BOM（否则 PowerShell 5.1 按 ANSI 解析中文会乱码）；`启动器.vbs` 保持纯 ASCII。
- **启动链健壮性**：VBS 拉起 PowerShell 必须用完整路径（`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`），不能依赖 PATH。
- **执行策略**：启动时对脚本文件使用 Bypass（不改系统全局执行策略）。
- **启动耗时**：从双击到窗口出现需数百毫秒（PowerShell 初始化 + WPF 渲染），属可接受范围；不做精确断言。
- **单写者与安全边界不变**：启动器只负责拉起 `dev.mjs` 与开浏览器，数据写入仍一律经 `127.0.0.1:4097` 数据服务。
- **`启动.cmd` 不变**：控制台 / 日志路径保持原样，作为启动器的替代入口。

## 5. 影响面（文件清单）

- 新增：`启动器.vbs`（入口）、`启动器.ps1`（WPF 窗口）、`kernel.ico`（多尺寸图标）、`scripts/make-icon.ps1`（图标生成器）。
- 删除：`启动器.hta`（旧 HTA 启动器）。
- 修改：桌面快捷方式 `KERNEL 启动器.lnk`（目标 `wscript.exe` + `启动器.vbs`，图标 `kernel.ico`）。
- 打包同步：`scripts/package.mjs` 白名单改为收录 `启动器.ps1` + `启动器.vbs` + `kernel.ico`，不再收录 HTA。
- 文档：`README.md`、`使用说明.md`（入口指向 `启动器.vbs`）、`docs/05-FILE-TREE.md`、`docs/02-ARCHITECTURE.md`、`docs/README.md`（ADR 索引）。
- 不变：`启动.cmd`；无新增依赖；无数据模型变化；无新增服务端点。

## 6. 验证与证据

QA 证据归档 **`.qa/v75/`**：替换前后截图对比 + selftest 与启动链日志。

- **观感**：无系统白标题栏；圆角卡片 + 自绘标题栏 + 品牌 K + `kernel.ico` 图标。
- **行为 parity**：探活 / 启动 / 停止 / 自动开浏览器 / 桌面快捷方式 / 日志入口。
- **钩子**：`KERNEL_LAUNCHER_SELFTEST` 产出文件；`KERNEL_LAUNCHER_SMOKE_MS` 自动关窗；`KERNEL_LAUNCHER_PROBE_URL` 覆盖探活地址。
