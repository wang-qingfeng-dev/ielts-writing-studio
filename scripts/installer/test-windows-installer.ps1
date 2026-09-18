param(
    [string]$InstallerPath,
    [int]$Port = 4326
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# 测试目录必须由调用者显式指定安装包；所有安装、启动和卸载都在隔离目录内完成。
if (-not $InstallerPath) {
    $artifactRoot = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path 'release-artifacts\installer-output'
    $InstallerPath = Get-ChildItem -LiteralPath $artifactRoot -Filter '*-setup.exe' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $InstallerPath -or -not (Test-Path -LiteralPath $InstallerPath)) { throw '没有找到待测试的 setup.exe。' }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "测试端口 $Port 已被占用。" }

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('jujin-installer-test-' + [guid]::NewGuid().ToString('N'))
$installRoot = Join-Path $testRoot 'app'
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$serverProcess = $null
$savedPort = [Environment]::GetEnvironmentVariable('PORT', 'Process')
try {
    # Inno 的 lowest 权限安装不应弹管理员确认；测试用 /DIR 指向一次性目录。
    $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS', "/DIR=$installRoot")
    $installerProcess = Start-Process -FilePath $InstallerPath -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    if ($installerProcess.ExitCode -ne 0) { throw "安装器退出码为 $($installerProcess.ExitCode)。" }
    foreach ($required in @('start.ps1', 'server.mjs', 'runtime\node-v24.19.0-win-x64\node.exe', 'setup-ai.ps1', 'unins000.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $installRoot $required))) { throw "安装后缺少文件：$required" }
    }

    $env:PORT = [string]$Port
    $env:IELTS_STUDIO_NO_BROWSER = '1'
    $serverProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $installRoot 'start.ps1'), '-NoBrowser') -WorkingDirectory $installRoot -WindowStyle Hidden -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
        Start-Sleep -Milliseconds 300
        try {
            $page = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -TimeoutSec 3 -UseBasicParsing
            if ($page.StatusCode -eq 200 -and $page.Content -match 'Task 2|雅思|IELTS') { $ready = $true; break }
        } catch {}
        if ($serverProcess.HasExited) { break }
    }
    if (-not $ready) { throw '安装后的本地服务没有正常响应。' }

    $nodePath = Join-Path $installRoot 'runtime\node-v24.19.0-win-x64\node.exe'
    $nodeVersion = (& $nodePath --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') { throw "安装包内置 Node 版本异常：$nodeVersion" }
    $scriptText = Get-Content -LiteralPath (Join-Path $installRoot 'start.ps1') -Raw
    if ($scriptText -notmatch 'SetupAI|NoBrowser') { throw '启动脚本没有安装版参数。' }
    [pscustomobject]@{
        Installer = (Resolve-Path $InstallerPath).Path
        InstallRoot = $installRoot
        Port = $Port
        PageStatus = $page.StatusCode
        NodeVersion = $nodeVersion
        FirstRunSetup = $true
        NoAdminDirectory = $installRoot -like "$env:LOCALAPPDATA*"
        RequiredFiles = $true
    } | ConvertTo-Json
} finally {
    if ($serverProcess -and -not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue }
    $env:PORT = $savedPort
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
