#requires -Version 7.0
# 此开发测试脚本使用 PowerShell 7；实际更新辅助程序使用系统内置的 Windows PowerShell。
param([Parameter(Mandatory=$true)][string]$OldInstaller, [Parameter(Mandatory=$true)][string]$NewInstaller, [int]$Port=4327)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw 'Test port is occupied.' }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('jujin-upgrade-' + [guid]::NewGuid().ToString('N'))
$appRoot = Join-Path $testRoot 'upgrade app'
$nodePath = Join-Path $appRoot 'runtime\node-v24.19.0-win-x64\node.exe'
$helper = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\updater\install-update.ps1'))
$saved = @{}
$environment = @{PORT=[string]$Port; LOCALAPPDATA=(Join-Path $testRoot 'profile'); IELTS_STUDIO_ROOT=$appRoot; IELTS_STUDIO_NO_BROWSER='1'; IELTS_LOCAL_AI_DIR=(Join-Path $testRoot 'models'); AI_PROVIDER='openai-compatible'; IELTS_NODE_PATH=$null; AI_API_KEY=$null; AI_BASE_URL=$null; OPENAI_MODEL=$null}
function Read-App { try { Invoke-RestMethod "http://127.0.0.1:$Port/api/app-info" -TimeoutSec 1 } catch { $null } }
try {
    foreach ($key in $environment.Keys) { $saved[$key]=[Environment]::GetEnvironmentVariable($key,'Process'); [Environment]::SetEnvironmentVariable($key,$environment[$key],'Process') }
    New-Item -ItemType Directory -Path $testRoot,$env:LOCALAPPDATA -Force | Out-Null
    $installed=Start-Process -FilePath $OldInstaller -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOCLOSEAPPLICATIONS','/NORESTARTAPPLICATIONS','/TESTINSTALL=1',('/DIR="'+$appRoot+'"')) -Wait -PassThru -WindowStyle Hidden
    if ($installed.ExitCode -ne 0) { throw 'Old installer failed.' }
    # 只写入合成配置，不读取用户的真实 API 密钥或学习数据。
    foreach ($key in $environment.Keys) { [Environment]::SetEnvironmentVariable($key,$environment[$key],'Process') }
    $settingsRoot=Join-Path $environment.LOCALAPPDATA 'JujinWritingStudio\settings'
    New-Item -ItemType Directory -Path $settingsRoot -Force | Out-Null
    $settingsPath=Join-Path $settingsRoot 'cloud-ai.json'
    $settings='{"version":1,"provider":"custom","baseUrl":"http://127.0.0.1:1/v1","model":"synthetic-test","apiKey":"synthetic-not-a-secret","tested":true,"selectedProvider":"openai-compatible"}'
    [IO.File]::WriteAllText($settingsPath,$settings,[Text.Encoding]::ASCII)
    $envPath=Join-Path $appRoot '.env'
    [IO.File]::WriteAllText($envPath,"PORT=$Port`nUPGRADE_SENTINEL=keep-me`n",[Text.Encoding]::ASCII)
    $beforeSettings=(Get-FileHash -LiteralPath $settingsPath).Hash
    $beforeEnv=(Get-FileHash -LiteralPath $envPath).Hash
    & (Join-Path $appRoot 'start.ps1') -NoBrowser
    $before=Read-App
    if ($before.version -ne '0.1.2') { throw 'Old app identity mismatch.' }
    $oldPid=[int]$before.pid
    $owned=Get-CimInstance Win32_Process -Filter "ProcessId=$oldPid"
    if ($owned.ExecutablePath -ne $nodePath) { throw 'Unexpected old app process.' }
    $hash=(Get-FileHash -LiteralPath $NewInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
    # 使用真实更新辅助程序：等待旧进程、校验安装器、原目录升级、原端口重启。
    $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$helper+'"'),'-Installer',('"'+$NewInstaller+'"'),'-ExpectedHash',$hash,'-AppRoot',('"'+$appRoot+'"'),'-ParentProcessId',[string]$oldPid,'-AppPort',[string]$Port,'-TestInstall')
    for ($index=0; $index -lt $arguments.Count; $index++) { if ([string]::IsNullOrEmpty($arguments[$index])) { throw ('Empty updater argument at index '+$index) } }
    $update=Start-Process powershell.exe -ArgumentList $arguments -PassThru -WindowStyle Hidden
    Stop-Process -Id $oldPid
    $deadline=(Get-Date).AddSeconds(90)
    do { Start-Sleep -Milliseconds 500; $after=Read-App } until (($after -and $after.version -eq '0.2.0') -or (Get-Date) -gt $deadline)
    if ($after.version -ne '0.2.0') { throw 'Updated app did not restart.' }
    if ((Get-FileHash -LiteralPath $settingsPath).Hash -ne $beforeSettings -or (Get-FileHash -LiteralPath $envPath).Hash -ne $beforeEnv) { throw 'User configuration was modified.' }
    $cloud=Invoke-RestMethod "http://127.0.0.1:$Port/api/cloud-settings"
    if (-not $cloud.configured -or $cloud.model -ne 'synthetic-test') { throw 'Saved online settings were not restored.' }
    $page=Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing
    if ($page.Content -notmatch 'task1-academic' -or $page.Content -notmatch 'update-check') { throw 'New features missing.' }
    if (Get-ChildItem -LiteralPath $appRoot -Filter 'unins*') { throw 'Isolated update registered an uninstall program.' }
    [pscustomobject]@{From=$before.version;To=$after.version;Port=$Port;HelperRestart=$true;DotEnvPreserved=$true;CloudSettingsPreserved=$true;NewTask1AndUpdateUI=$true;TestInstallIsolation=$true} | ConvertTo-Json
} finally {
    # 只结束本次隔离目录的 Node；核实路径后再清理测试目录。
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -eq $nodePath } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key,$saved[$key],'Process') }
    $resolved=[IO.Path]::GetFullPath($testRoot)
    $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    if ([IO.Path]::GetDirectoryName($resolved) -eq $temp -and [IO.Path]::GetFileName($resolved) -match '^jujin-upgrade-[a-f0-9]{32}$') { Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue }
}
