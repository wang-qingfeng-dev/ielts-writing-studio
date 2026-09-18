param(
    [switch]$SetupAI,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

# 解析应用根目录；安装版、免安装版和源码目录都使用同一份启动逻辑。
$studioRoot = $env:IELTS_STUDIO_ROOT
if (-not $studioRoot) { $studioRoot = $PSScriptRoot }
if (-not $studioRoot) { throw '请通过 Start Writing Studio.cmd 启动应用。' }
$studioRoot = (Resolve-Path -LiteralPath $studioRoot).Path

# 优先使用发行包内置的 Node，再兼容开发机上的 Node 和 Codex 运行时。
$studioNodePath = $env:IELTS_NODE_PATH
if (-not $studioNodePath) {
    $bundledNode = Join-Path $studioRoot 'runtime\node-v24.19.0-win-x64\node.exe'
    if (Test-Path -LiteralPath $bundledNode) { $studioNodePath = $bundledNode }
}
if (-not $studioNodePath) {
    $studioNode = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($studioNode) { $studioNodePath = $studioNode.Source }
}
if (-not $studioNodePath) {
    $studioNodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $studioNodePath)) {
    throw '找不到 Node.js。请重新运行安装程序，或安装 Node.js 24 LTS。'
}
$studioNodeVersion = (& $studioNodePath --version).TrimStart('v')
if ([version]$studioNodeVersion -lt [version]'22.9.0') {
    throw 'Node.js 版本过低，需要 22.9 或更新版本。安装版已经内置 Node.js 24。'
}

# 只读取 .env 的路径，不把配置内容写入日志或错误消息。
$studioEnvPath = Join-Path $studioRoot '.env'
$studioEnvArgs = @()
if (Test-Path -LiteralPath $studioEnvPath) { $studioEnvArgs += "--env-file=$studioEnvPath" }
$studioPort = & $studioNodePath @studioEnvArgs -e 'const p=Number(process.env.PORT||4318); if(!Number.isInteger(p)||p<1||p>65535)process.exit(2); console.log(p)'
if ($LASTEXITCODE -ne 0) { throw 'PORT 配置无效，请使用 1 到 65535 之间的整数。' }
$studioUrl = "http://127.0.0.1:$studioPort"

# 先确认已有实例是否确实是本应用；不结束任何未知进程。
$studioReachable = $false
$studioIdentity = $null
try {
    $studioIdentity = Invoke-RestMethod -Uri "$studioUrl/api/app-info" -TimeoutSec 3
    $studioReachable = $studioIdentity.app -eq 'ielts-writing-studio'
} catch {
    try {
        $studioStatus = Invoke-RestMethod -Uri "$studioUrl/api/status" -TimeoutSec 3
        $studioReachable = $null -ne $studioStatus.available -and $null -ne $studioStatus.engine
    } catch {}
}

if (-not $studioReachable) {
    $studioConfiguredCodex = & $studioNodePath @studioEnvArgs -e 'process.stdout.write(process.env.IELTS_CODEX_PATH||String())'
    $studioCodex = Get-Command codex.exe -ErrorAction SilentlyContinue
    if (-not $studioConfiguredCodex -and $studioCodex) { $env:IELTS_CODEX_PATH = $studioCodex.Source }
    elseif (-not $studioConfiguredCodex) {
        $studioCodexBin = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
        if (Test-Path -LiteralPath $studioCodexBin) {
            $studioCandidate = Get-ChildItem -LiteralPath $studioCodexBin -Directory -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending |
                ForEach-Object { Join-Path $_.FullName 'codex.exe' } |
                Where-Object { Test-Path -LiteralPath $_ } |
                Select-Object -First 1
            if ($studioCandidate) { $env:IELTS_CODEX_PATH = $studioCandidate }
        }
    }
    $studioServerPath = Join-Path $studioRoot 'server.mjs'
    # Start-Process 会把 ArgumentList 的元素再次按空格拆分；服务路径必须显式加引号，安装目录可以包含空格或中文。
    $studioServerArgs = @($studioEnvArgs)
    $studioServerArgs += '"' + $studioServerPath + '"'
    $studioOutputPath = Join-Path $studioRoot 'server.log'
    $studioErrorPath = Join-Path $studioRoot 'server-error.log'
    $studioProcess = Start-Process -FilePath $studioNodePath -ArgumentList $studioServerArgs -WorkingDirectory $studioRoot -WindowStyle Hidden -RedirectStandardOutput $studioOutputPath -RedirectStandardError $studioErrorPath -PassThru
    for ($studioTry = 0; $studioTry -lt 30; $studioTry++) {
        Start-Sleep -Milliseconds 300
        try {
            $studioIdentity = Invoke-RestMethod -Uri "$studioUrl/api/app-info" -TimeoutSec 3
            $studioReachable = $studioIdentity.app -eq 'ielts-writing-studio'
        } catch {
            try {
                $studioStatus = Invoke-RestMethod -Uri "$studioUrl/api/status" -TimeoutSec 3
                $studioReachable = $null -ne $studioStatus.available -and $null -ne $studioStatus.engine
            } catch {}
        }
        if ($studioReachable) { break }
        if ($studioProcess.HasExited) { break }
    }
    if (-not $studioReachable) {
        if ($studioProcess -and -not $studioProcess.HasExited) { Stop-Process -Id $studioProcess.Id -ErrorAction SilentlyContinue }
        throw "应用启动失败。请查看 server-error.log；如果端口 $studioPort 已被其他程序占用，请修改 .env 中的 PORT。"
    }
}

# 安装完成后默认进入一次设置页；日常启动仍然直接进入工作台。
$studioNoBrowser = $NoBrowser -or $env:IELTS_STUDIO_NO_BROWSER -eq '1'
if (-not $studioNoBrowser) {
    $studioLaunchUrl = $studioUrl
    if ($SetupAI) { $studioLaunchUrl = "$studioUrl/?setup=1" }
    Start-Process $studioLaunchUrl
}
Write-Host "句进雅思写作工作台已启动：$studioUrl"
