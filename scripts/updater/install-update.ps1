param(
    [Parameter(Mandatory=$true)][string]$Installer,
    [Parameter(Mandatory=$true)][string]$ExpectedHash,
    [Parameter(Mandatory=$true)][string]$AppRoot,
    [Parameter(Mandatory=$true)][int]$ParentProcessId,
    [Parameter(Mandatory=$true)][int]$AppPort,
    [switch]$TestInstall
)
$ErrorActionPreference = 'Stop'
$updateFolder = Split-Path -Parent $Installer
$updateLog = Join-Path $updateFolder 'update-result.log'
try {
    # 再次验证文件；只等待调用我们的应用自行退出，不按名称结束其他进程。
    if ((Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedHash) { throw 'Installer checksum mismatch.' }
    $oldProcess = Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue
    if ($oldProcess -and -not $oldProcess.WaitForExit(45000)) { throw 'The running app did not close. Please close it and retry.' }
    $arguments = @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/DIR="' + $AppRoot + '"'),('/LOG="' + (Join-Path $updateFolder 'installer.log') + '"'))
    if ($TestInstall) { $arguments += '/TESTINSTALL=1' }
    $setup = Start-Process -FilePath $Installer -ArgumentList $arguments -PassThru -Wait -WindowStyle Hidden
    if ($setup.ExitCode -ne 0) { throw ('Installer returned ' + $setup.ExitCode) }
    'Update installed successfully.' | Out-File -LiteralPath $updateLog -Encoding utf8
} catch {
    $_.Exception.Message | Out-File -LiteralPath $updateLog -Encoding utf8
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(('Update failed. Please retry or download the installer from GitHub. Log: ' + $updateLog),'Jujin update') | Out-Null
} finally {
    # 保留端口与浏览器存储来源，外部 AI 设置、模型和浏览器历史不在安装目录中。
    $env:PORT = [string]$AppPort
    $env:IELTS_STUDIO_ROOT = $AppRoot
    Remove-Item Env:IELTS_NODE_PATH -ErrorAction SilentlyContinue
    $starter = Join-Path $AppRoot 'start.ps1'
    if (Test-Path -LiteralPath $starter) {
        Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',('"' + $starter + '"')) -WorkingDirectory $AppRoot -WindowStyle Hidden
    }
}
