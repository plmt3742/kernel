# ADR-0031 · Windows 安装包分发

- 状态：已采纳
- 日期：2026-10-05
- 相关：ADR-0004（数据服务 · 单写者）、ADR-0005（opencode AI 接入）、ADR-0030（AI Key 本地配置 + 双击启动器）、ADR-0037（原生桌面启动器）

---

## 1. 背景

KERNEL 是本地优先的个人事务内核，运行需要一个本机 Node 运行时，数据以 JSON 文件存放在 `data/`。此前分发方式是「自带运行时的可移植目录」：用户自行解压、找到启动脚本双击。这对不熟悉命令行的人门槛偏高，也缺少标准的安装 / 卸载入口。

为降低安装门槛，需要交付一个 **Windows 安装包**：双击即装、自动放置开始菜单与桌面入口、并提供标准卸载程序；同时保证 `data/`（用户数据）在首次安装、覆盖安装与卸载过程中都不被误删。

## 2. 决策

### 2.1 安装脚本

新增 `installer/KERNEL.iss`（Inno Setup 6）：

| 维度 | 决策 |
|---|---|
| 权限 | `PrivilegesRequired=lowest`（每用户安装、无需管理员） |
| 安装目录 | 默认 `{localappdata}\Programs\KERNEL`，允许用户自选（`DisableDirPage=no`，如 `D:\KERNEL`） |
| 入口 | 开始菜单快捷方式 + 可选桌面快捷方式（`[Tasks] desktopicon`） |
| 卸载 | 标准卸载程序；`UninstallDisplayIcon` 指向 `kernel.ico` |
| 架构 | `ArchitecturesAllowed=x64compatible`（载荷含 64 位内置运行时） |
| 升级 | 固定 `AppId`，同一产品升级复用安装身份 |

### 2.2 数据随程序目录 + 卸载保留

应用把数据写在 `<安装目录>\data`（`server/store.mjs` 相对程序根解析）。安装时植入空白数据骨架，并以 `onlyifdoesntexist` + `uninsneveruninstall` 标记：

- 首次安装植入骨架；
- 覆盖安装不冲掉既有数据；
- **卸载后用户数据保留**（程序文件清除，`data\` 不删）。

### 2.3 构建

`scripts/build-installer.mjs` 按白名单组装干净载荷（`src/`、`server/`、`public/`、运行所需 `node_modules/`、内置 `node` 与 `opencode` 运行时、空白数据骨架、无密钥 `opencode.json`），再调用**仓库内置**的 Inno Setup 编译器 `node_modules/innosetup-compiler/bin/ISCC.exe` 编译——**无需在系统中单独安装 Inno Setup**。产物 `KERNEL-Setup-<version>.exe` 位于仓库之外。

**隐私纪律**：owner 数据（种子 / 审计 / 附件 / 凭据）绝不进包；出厂 `config.json` 的 `owner` 置空、`aiAutomation` 取 `confirm`。

## 3. 后果

- 用户无需自行安装 Node.js：安装后从开始菜单 / 桌面启动即可，目标电脑零额外安装。
- 数据与程序同目录，整个安装目录可直接拷贝迁移；卸载保留 `data\`。
- 覆盖安装复用固定 `AppId`，不清空数据。
- **边界**：仅 Windows x64；安装包未签名，首次运行可能触发 SmartScreen；安装界面暂为英文（内置编译器仅随附 `Default.isl`）。
- **维护**：改载荷白名单或安装行为须同步 `installer/KERNEL.iss` 与 `scripts/build-installer.mjs`。
