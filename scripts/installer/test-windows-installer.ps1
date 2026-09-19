param(
    [string]$InstallerPath,
    [int]$Port = 4326
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Assert-TestDirectory {
    param([string]$TestRoot, [string]$InstallRoot, [string]$NodePath)

    # 删除或结束进程前，必须确认目标是当前 Temp 下本次创建的独立目录。
    $tempPath = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    $testPath = [IO.Path]::GetFullPath($TestRoot).TrimEnd('\')
    $installPath = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
    if (-not [string]::Equals([IO.Path]::GetDirectoryName($testPath), $tempPath, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($testPath) -notmatch '^jujin-installer-test-[a-f0-9]{32}$' -or
        -not [string]::Equals($installPath, (Join-Path $testPath '中文 test app'), [StringComparison]::OrdinalIgnoreCase) -or
        -not [IO.Path]::GetFullPath($NodePath).StartsWith($installPath + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw '测试清理路径不在本次隔离安装目录内，已停止清理。'
    }
    if (Test-Path -LiteralPath $testPath) {
        $resolved = (Resolve-Path -LiteralPath $testPath).ProviderPath.TrimEnd('\')
        if (-not [string]::Equals($resolved, $testPath, [StringComparison]::OrdinalIgnoreCase)) {
            throw '测试目录的实际路径与预期不一致，已停止清理。'
        }
        $directories = @((Get-Item -LiteralPath $testPath -Force)) + @(Get-ChildItem -LiteralPath $testPath -Directory -Recurse -Force)
        if (@($directories | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) {
            throw '测试目录中出现目录链接，已停止递归清理。'
        }
    }
}

function Stop-InstalledTestNode {
    param([string]$TestRoot, [string]$InstallRoot, [string]$NodePath)

    Assert-TestDirectory -TestRoot $TestRoot -InstallRoot $InstallRoot -NodePath $NodePath
    $expectedNode = [IO.Path]::GetFullPath($NodePath)
    $candidates = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $_.ExecutablePath -and [string]::Equals($_.ExecutablePath, $expectedNode, [StringComparison]::OrdinalIgnoreCase)
    })
    foreach ($candidate in $candidates) {
        # 再查一次 PID 与可执行文件路径，避免误结束 PID 已被复用后的其他进程。
        $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($candidate.ProcessId)"
        if ($current -and [string]::Equals($current.ExecutablePath, $expectedNode, [StringComparison]::OrdinalIgnoreCase) -and
            $current.CreationDate -eq $candidate.CreationDate) {
            $ownedNode = Get-Process -Id $current.ProcessId -ErrorAction SilentlyContinue
            if ($ownedNode) {
                Stop-Process -InputObject $ownedNode -Force
                if (-not $ownedNode.WaitForExit(5000)) { throw '本次测试的 Node 进程未能退出，保留临时目录供检查。' }
            }
        }
    }
    $remaining = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $_.ExecutablePath -and [string]::Equals($_.ExecutablePath, $expectedNode, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($remaining.Count) { throw '本次测试目录仍有 Node 进程运行，保留临时目录供检查。' }
}

# 只测试支持 /TESTINSTALL=1 的新版安装包；安装、启动和清理都在隔离目录内完成。
if (-not $InstallerPath) {
    $artifactRoot = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path 'release-artifacts\installer-output'
    $InstallerPath = Get-ChildItem -LiteralPath $artifactRoot -Filter '*-setup.exe' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $InstallerPath -or -not (Test-Path -LiteralPath $InstallerPath)) { throw '没有找到待测试的 setup.exe。' }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "测试端口 $Port 已被占用。" }

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('jujin-installer-test-' + [guid]::NewGuid().ToString('N'))
$installRoot = Join-Path $testRoot '中文 test app'
$nodePath = Join-Path $installRoot 'runtime\node-v24.19.0-win-x64\node.exe'
Assert-TestDirectory -TestRoot $testRoot -InstallRoot $installRoot -NodePath $nodePath
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$serverProcess = $null
$isolatedEnvironment = @{
    PORT = [string]$Port
    IELTS_STUDIO_NO_BROWSER = '1'
    IELTS_STUDIO_ROOT = $installRoot
    IELTS_NODE_PATH = $nodePath
    IELTS_LOCAL_AI_DIR = (Join-Path $testRoot 'local-ai')
    LOCALAPPDATA = (Join-Path $testRoot 'profile')
    AI_PROVIDER = 'ollama'
    AI_BASE_URL = $null
    AI_API_KEY = $null
    AI_MODEL = $null
    OPENAI_MODEL = $null
    OLLAMA_MODEL = $null
    OLLAMA_HOST = 'http://127.0.0.1:1'
    IELTS_CODEX_PATH = (Join-Path $testRoot 'unused-codex.exe')
}
$savedEnvironment = @{}
foreach ($name in $isolatedEnvironment.Keys) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$report = $null
try {
    # 云配置使用 LOCALAPPDATA，本地模型使用 IELTS_LOCAL_AI_DIR；不能读写真实用户目录。
    foreach ($name in $isolatedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $isolatedEnvironment[$name], 'Process')
    }
    New-Item -ItemType Directory -Path $env:LOCALAPPDATA -Force | Out-Null
    # 测试模式不注册卸载项、不建快捷方式、不自动启动，也不关闭其他应用。
    $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOCLOSEAPPLICATIONS', '/NORESTARTAPPLICATIONS', '/TESTINSTALL=1', ('/DIR="' + $installRoot + '"'))
    $installerProcess = Start-Process -FilePath $InstallerPath -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    if ($installerProcess.ExitCode -ne 0) { throw "安装器退出码为 $($installerProcess.ExitCode)。" }
    foreach ($required in @('start.ps1', 'server.mjs', 'package.json', 'runtime\node-v24.19.0-win-x64\node.exe', 'setup-ai.ps1', 'cloud-settings.mjs', 'public\cloud-ai-setup.js')) {
        if (-not (Test-Path -LiteralPath (Join-Path $installRoot $required))) { throw "安装后缺少文件：$required" }
    }
    if (Get-ChildItem -LiteralPath $installRoot -Filter 'unins*' -File) { throw '测试模式仍生成了卸载程序，安装隔离检查失败。' }
    if (Test-Path -LiteralPath (Join-Path $installRoot '.env')) { throw '发行包不应包含本机 .env 配置。' }

    # 检查原始发行包后，再创建仅含测试端口的配置，实际覆盖中文/空格路径参数。
    [IO.File]::WriteAllText((Join-Path $installRoot '.env'), "PORT=$Port`r`n", [Text.Encoding]::ASCII)
    [Environment]::SetEnvironmentVariable('PORT', $null, 'Process')
    $launcherArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $installRoot 'start.ps1') + '"'), '-NoBrowser')
    $serverProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $launcherArguments -WorkingDirectory $installRoot -WindowStyle Hidden -PassThru
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

    $package = Get-Content -LiteralPath (Join-Path $installRoot 'package.json') -Raw | ConvertFrom-Json
    $appInfo = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/app-info" -TimeoutSec 3
    if ($appInfo.app -ne 'ielts-writing-studio' -or $appInfo.version -ne $package.version) { throw '服务身份或版本与本次安装包不一致。' }
    $appProcessId = 0
    if (-not [int]::TryParse([string]$appInfo.pid, [ref]$appProcessId) -or $appProcessId -le 0) { throw '服务返回的进程 ID 无效。' }
    $installedProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$appProcessId"
    if (-not $installedProcess -or -not [string]::Equals($installedProcess.ExecutablePath, $nodePath, [StringComparison]::OrdinalIgnoreCase)) { throw '响应请求的服务不是本次隔离目录中的 Node 进程。' }
    $cloudSettings = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/cloud-settings" -TimeoutSec 3
    if ($cloudSettings.configured -ne $false -or $cloudSettings.keyConfigured -ne $false -or $cloudSettings.environmentConfigured -ne $false -or $cloudSettings.message) { throw '测试服务读取到了非隔离的云端配置或加载失败。' }
    $cloudSetup = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/cloud-ai-setup.js" -TimeoutSec 3 -UseBasicParsing
    if ($cloudSetup.StatusCode -ne 200) { throw '安装后的在线 AI 设置模块无法加载。' }
    $nodeVersion = (& $nodePath --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') { throw "安装包内置 Node 版本异常：$nodeVersion" }
    $scriptText = Get-Content -LiteralPath (Join-Path $installRoot 'start.ps1') -Raw
    if ($scriptText -notmatch 'SetupAI|NoBrowser') { throw '启动脚本没有安装版参数。' }
    $report = [ordered]@{
        Installer = (Resolve-Path $InstallerPath).Path
        InstallRoot = $installRoot
        Port = $Port
        PageStatus = $page.StatusCode
        AppVersion = $appInfo.version
        AppInfoVerified = $true
        ChineseAndSpacePath = $installRoot
        DotEnvPathVerified = $true
        NodeVersion = $nodeVersion
        FirstRunSetupFiles = $true
        InstallerTestMode = $true
        CloudSettingsIsolated = $true
        RequiredFiles = $true
    }
} finally {
    try {
        Assert-TestDirectory -TestRoot $testRoot -InstallRoot $installRoot -NodePath $nodePath
        # 先停止本次持有的启动器，再按独立安装目录停止它启动的后台 Node。
        if ($serverProcess -and -not $serverProcess.HasExited) {
            Stop-Process -InputObject $serverProcess -Force
            if (-not $serverProcess.WaitForExit(5000)) { throw '测试启动器未能退出，保留临时目录供检查。' }
        }
        Stop-InstalledTestNode -TestRoot $testRoot -InstallRoot $installRoot -NodePath $nodePath
        if (Test-Path -LiteralPath $testRoot) {
            Remove-Item -LiteralPath $testRoot -Recurse -Force
            if (Test-Path -LiteralPath $testRoot) { throw '测试临时目录清理失败。' }
        }
    } finally {
        foreach ($name in $savedEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
        }
    }
}

# 所有清理检查通过后才输出成功报告，避免把残留进程或删除失败算作测试通过。
if ($report) {
    $report.TestNodeStopped = $true
    $report.TemporaryDirectoryRemoved = $true
    [pscustomobject]$report | ConvertTo-Json
}
