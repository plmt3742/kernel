; ============================================================================
; KERNEL · Windows 安装脚本（Inno Setup 6）
; ----------------------------------------------------------------------------
; 由 scripts/build-installer.mjs 调用仓库内置编译器编译：
;   node_modules\innosetup-compiler\bin\ISCC.exe
; 因此无需在系统中单独安装 Inno Setup。
;
; 编译器预处理器变量（由构建脚本以 /D 覆盖）：
;   StageDir   安装载荷（payload）目录的绝对路径
;   OutputDir  Setup.exe 的输出目录（绝对路径）
;
; 数据纪律：应用把数据写在 <安装目录>\data（server/store.mjs 相对根目录解析）。
; 安装时植入空白数据骨架，并以 uninsneveruninstall / onlyifdoesntexist 标记，
; 保证：① 首次安装植入骨架；② 覆盖安装不冲掉用户数据；③ 卸载后用户数据保留。
; ============================================================================

#ifndef StageDir
  #error 缺少 StageDir：请通过 ISCC /DStageDir=<payload 目录> 传入安装载荷目录。
#endif

#ifndef OutputDir
  #define OutputDir "."
#endif

#ifndef DataDir
  #error 缺少 DataDir：请通过 ISCC /DDataDir=<数据骨架目录> 传入空白数据骨架目录。
#endif

#define AppName "KERNEL"
#define AppVersion "0.5.0"
#define AppPublisher "KERNEL"
#define SetupBase "KERNEL-Setup-0.5.0"

[Setup]
; 固定 AppId：同一产品升级时复用同一安装身份（此处为项目自有 GUID）。
AppId={{B5A1E7C3-9D24-4F68-A0F1-2C7E9B4D3A56}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
; 每用户安装，无需管理员权限；默认目录位于用户可写位置，数据可与程序同目录。
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\KERNEL
DefaultGroupName={#AppName}
; 允许用户选择安装目录（如 D:\KERNEL）。
DisableDirPage=no
; 不显示程序组选择页（每用户安装）。
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename={#SetupBase}
SetupIconFile=kernel.ico
UninstallDisplayIcon={app}\kernel.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; 载荷内含 64 位内置运行时。
ArchitecturesAllowed=x64compatible

[Languages]
; 内置编译器仅随附 Default.isl（英文），故默认英文界面。
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; 主载荷：整目录递归拷贝（不含任何 data\；数据骨架在独立暂存目录）。
; 注意：此处刻意不用 Excludes——Inno 的 * 通配会跨目录匹配，曾把 node_modules 内嵌套的 data 目录（如 node-releases\data）一并误删。
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
; 空白数据骨架（独立目录）：仅在目标不存在时植入；卸载时永不删除（用户数据保留）。
Source: "{#DataDir}\data\*"; DestDir: "{app}\data"; Flags: recursesubdirs createallsubdirs onlyifdoesntexist uninsneveruninstall

[Dirs]
; 空白数据子目录（多数初始为空，需显式创建）；卸载时永不删除。
Name: "{app}\data\tasks"; Flags: uninsneveruninstall
Name: "{app}\data\projects"; Flags: uninsneveruninstall
Name: "{app}\data\notes"; Flags: uninsneveruninstall
Name: "{app}\data\resources"; Flags: uninsneveruninstall
Name: "{app}\data\events"; Flags: uninsneveruninstall
Name: "{app}\data\areas"; Flags: uninsneveruninstall
Name: "{app}\data\goals"; Flags: uninsneveruninstall
Name: "{app}\data\habits"; Flags: uninsneveruninstall
Name: "{app}\data\reviews"; Flags: uninsneveruninstall
Name: "{app}\data\inbox"; Flags: uninsneveruninstall
Name: "{app}\data\courses"; Flags: uninsneveruninstall
Name: "{app}\data\trash"; Flags: uninsneveruninstall
Name: "{app}\data\files"; Flags: uninsneveruninstall
Name: "{app}\data\meta"; Flags: uninsneveruninstall

[Icons]
Name: "{group}\{#AppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\启动器.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\kernel.ico"
Name: "{userdesktop}\{#AppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\启动器.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\kernel.ico"; Tasks: desktopicon

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\启动器.vbs"""; WorkingDir: "{app}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 运行期缓存（Vite 依赖预打包等）不属于安装内容，卸载时一并清理；
; 用户数据位于 {app}\data，由 [Files]/[Dirs] 的 uninsneveruninstall 保护，不在此处。
Type: filesandordirs; Name: "{app}\node_modules\.vite"
Type: filesandordirs; Name: "{app}\node_modules\.cache"
Type: filesandordirs; Name: "{app}\node_modules"
