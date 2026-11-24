; ─────────────────────────────────────────────────────────────────────────────
; EnglishMate 桌面版 Inno Setup 安装包脚本
;
; 为什么用 Inno Setup 而不是 electron-builder 的 NSIS：
;   NSIS 需要远程拉 winCodeSign/nsis 工具链，本机网络下反复超时（HANDOVER 有记录）。
;   Inno Setup 纯本地编译，无网络依赖。本机已装 Inno Setup 6：
;     C:\Users\ASUS\AppData\Local\Programs\Inno Setup 6\ISCC.exe
;
; 编译（在仓库根执行）：
;   "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" packaging\englishmate.iss
; 产物：release\installer\EnglishMate-Setup-<版本>.exe
;
; ── 设计决策 ──────────────────────────────────────────────────────────────────
; 1. 每用户安装（PrivilegesRequired=lowest，默认装到
;    {localappdata}\Programs\EnglishMate），不需要管理员。
;    ⚠ 本机环境拦截非提权安装（error 5 / Inno 退出码 1 且不写日志）——
;    静默测试必须 -Verb RunAs 提权；普通用户机器不受影响（重装时先试默认）。
; 2. **用户数据不在安装目录**：main.cjs 的 resolveUserDataDir() 第一优先级是
;    %LOCALAPPDATA%\EnglishMate，安装/升级/卸载都碰不到学习进度。
;    卸载只删 {app}，不删数据目录（故意不加 UninstallDelete 条目）。
; 3. 打包源是 release\EnglishMate（可运行目录），但**排除 data\**——
;    那是便携 profile（运行时产物），打进安装包等于把测试记录装进用户机器。
; 4. EnglishMate.bat 保留：部分 Windows 环境 Chromium 沙箱在 JS 前初始化失败
;    （code 3 直接退出），bat 以 --no-sandbox 启动作备用通道。
;    正常机器快捷方式直接指 EnglishMate.exe。
; 5. 覆盖安装前检测运行中的实例（CloseApplications），避免文件占用装到一半失败。
; ─────────────────────────────────────────────────────────────────────────────

#define MyAppName "EnglishMate"
#define MyAppVersion "0.1.0"

[Setup]
; 每次改脚本后重编译，GUID 不变 → 升级安装复用同一登记项（控制面板里只有一个条目）
AppId={{8F3A6C2E-4D7B-4A1E-9B5C-D2E7F0A93B41}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher=EnglishMate
DefaultDirName={localappdata}\Programs\EnglishMate
; 已有安装时沿用其目录，不弹路径
UsePreviousAppDir=yes
DisableProgramGroupPage=yes
; 每用户安装：不需要管理员
PrivilegesRequired=lowest
OutputDir=..\release\installer
OutputBaseFilename=EnglishMate-Setup-{#MyAppVersion}
; lzma2 高压缩：Electron 运行目录 ~370MB，压完 101MB 左右
Compression=lzma2/max
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
; 覆盖安装时提示关闭运行中的 EnglishMate，而不是文件占用直接报错
CloseApplications=yes
CloseApplicationsFilter=*.exe
UninstallDisplayIcon={app}\EnglishMate.exe
; 仓库里没有独立 .ico，从主程序 exe 用 PowerShell ExtractAssociatedIcon 提取
; （直接指 exe 会因体积被 Inno 拒绝：「Resource update error: File is too large」）
SetupIconFile=englishmate.ico
WizardStyle=modern

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Files]
Source: "..\release\EnglishMate\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "data,data\*"

[Icons]
; 开始菜单 + 桌面，指向 exe 本体（沙箱正常的机器直接可用）
Name: "{autoprograms}\EnglishMate"; Filename: "{app}\EnglishMate.exe"; Comment: "EnglishMate — 打字即学习"
Name: "{autodesktop}\EnglishMate"; Filename: "{app}\EnglishMate.exe"; Comment: "EnglishMate — 打字即学习"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："; Flags: checkedonce

[Run]
Filename: "{app}\EnglishMate.exe"; Description: "立即运行 EnglishMate"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 故意留空：卸载只删安装目录（{app}）。
; 用户学习进度在 %LOCALAPPDATA%\EnglishMate，**绝不**出现在这里——
; 换机/重装后进度仍在；想彻底清数据的用户手动删该目录。
