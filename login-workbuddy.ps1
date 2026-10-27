$ErrorActionPreference = 'Stop'

$bin = 'D:\Software\WorkBuddyAI\resources\app.asar.unpacked\cli\bin\codebuddy'

Write-Host ''
Write-Host '  ==========================================================' -ForegroundColor DarkCyan
Write-Host '    WorkBuddy 命令行登录（只做一次，以后不用再管）' -ForegroundColor Cyan
Write-Host '  ==========================================================' -ForegroundColor DarkCyan
Write-Host ''
Write-Host '    1) 稍等一下，会出现一个可以打字的输入框'
Write-Host '    2) 输入   /login   然后按回车'
Write-Host '    3) 浏览器会打开授权页，登录你的账号并点"允许"'
Write-Host '    4) 回到这个黑窗口，看到登录成功后，直接关掉窗口'
Write-Host ''
Write-Host '    如果一直没出现输入框、或者卡住不动：按 Ctrl+C 结束，' -ForegroundColor Yellow
Write-Host '    把这个窗口截图发给我。' -ForegroundColor Yellow
Write-Host ''
Write-Host '  ----------------------------------------------------------'
Write-Host ''

if (-not (Test-Path -LiteralPath $bin)) {
    Write-Host '  [X] 找不到 WorkBuddy 命令行：' -ForegroundColor Red
    Write-Host "      $bin"
    Write-Host ''
    Write-Host '  WorkBuddy 可能装在别的目录，把你的安装位置告诉我，我改一下就行。'
    exit 1
}

# 命令行在带代理变量的环境里会崩溃，先清空。
$env:HTTP_PROXY = ''
$env:HTTPS_PROXY = ''
$env:ALL_PROXY = ''
$env:NO_PROXY = '*'

# --port 0 让系统自动分配端口。桌面版 WorkBuddy 会占住 CLI 的默认端口 51179，
# 不指定端口时命令行会直接报 EADDRINUSE 退出。
& node $bin --port 0

Write-Host ''
Write-Host '  ----------------------------------------------------------'
Write-Host '    命令行已退出，接下来自动检查登录结果...'
Write-Host ''
exit 0
