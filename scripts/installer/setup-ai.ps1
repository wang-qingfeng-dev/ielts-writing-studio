$ErrorActionPreference = 'Stop'

function Resolve-StudioLauncher {
    param([string]$ScriptDirectory)

    # 安装包把本脚本放在应用根目录；源码仓库中则位于 scripts\installer。
    foreach ($candidate in @(
        (Join-Path $ScriptDirectory 'start.ps1'),
        (Join-Path $ScriptDirectory '..\..\start.ps1')
    )) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw '找不到应用启动文件，请重新安装句进，或解压完整的下载包后重试。'
}

$launcher = Resolve-StudioLauncher -ScriptDirectory $PSScriptRoot
$savedStudioRoot = [Environment]::GetEnvironmentVariable('IELTS_STUDIO_ROOT', 'Process')
try {
    # 统一打开应用内的本地/在线 AI 选择页，下载只在用户点击页面按钮后开始。
    $env:IELTS_STUDIO_ROOT = Split-Path -Parent $launcher
    & $launcher -SetupAI
} finally {
    [Environment]::SetEnvironmentVariable('IELTS_STUDIO_ROOT', $savedStudioRoot, 'Process')
}
