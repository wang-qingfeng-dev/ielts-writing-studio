; 句进雅思写作工作台的 Inno Setup 安装脚本。
; SourceDir、OutputDir 和 AppVersion 由 build-windows-installer.ps1 通过 /D 参数传入。
#ifndef AppVersion
  #define AppVersion "v0.1.2"
#endif
#ifndef SourceDir
  #define SourceDir "."
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif

[Setup]
AppId={{D8E443F1-04B3-4E40-9CA8-CB7A0AC07111}
AppName=句进·雅思写作工作台
AppVersion={#AppVersion}
AppVerName=句进·雅思写作工作台 {#AppVersion}
AppPublisher=wang-qingfeng-dev
AppPublisherURL=https://github.com/wang-qingfeng-dev/ielts-writing-studio
AppSupportURL=https://github.com/wang-qingfeng-dev/ielts-writing-studio
AppUpdatesURL=https://github.com/wang-qingfeng-dev/ielts-writing-studio/releases
DefaultDirName={localappdata}\Programs\JujinWritingStudio
DefaultGroupName=句进·雅思写作工作台
DisableProgramGroupPage=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=句进·雅思写作工作台
Uninstallable=IsNormalInstall
CreateUninstallRegKey=IsNormalInstall
OutputDir={#OutputDir}
OutputBaseFilename=ielts-writing-studio-{#AppVersion}-windows-x64-setup
DisableWelcomePage=no
ChangesAssociations=no
VersionInfoDescription=句进·雅思写作工作台一键安装程序
VersionInfoCopyright=MIT License
SetupLogging=yes

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："; Flags: unchecked; Check: IsNormalInstall
Name: "quicklaunchicon"; Description: "创建开始菜单快捷方式"; GroupDescription: "快捷方式："; Flags: checkedonce; Check: IsNormalInstall

[Files]
; 发行包已经包含官方 Node.js 运行时，安装不需要管理员权限或额外 Node 安装。
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\句进·雅思写作工作台"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\start.ps1"""; WorkingDir: "{app}"; Check: IsNormalInstall
Name: "{userdesktop}\句进·雅思写作工作台"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\start.ps1"""; WorkingDir: "{app}"; Tasks: desktopicon; Check: IsNormalInstall
Name: "{userappdata}\Microsoft\Windows\Start Menu\Programs\句进·雅思写作工作台"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\start.ps1"""; WorkingDir: "{app}"; Tasks: quicklaunchicon; Check: IsNormalInstall

[Run]
; 安装结束后直接打开一次 AI 设置页；模型仍由用户主动选择和下载。
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\start.ps1"" -SetupAI"; WorkingDir: "{app}"; Description: "启动句进并打开首次 AI 设置"; Flags: postinstall nowait skipifsilent; Check: IsNormalInstall

[UninstallDelete]
; 模型由 Ollama 保存到用户目录，浏览器记录保存在浏览器中；卸载只移除本程序目录。
Type: filesandordirs; Name: "{app}"

[Code]
function IsTestInstall: Boolean;
begin
  { 自动测试只解包到临时目录，不改写正式安装的卸载项或快捷方式。 }
  Result := ExpandConstant('{param:TESTINSTALL|0}') = '1';
end;

function IsNormalInstall: Boolean;
begin
  Result := not IsTestInstall;
end;
