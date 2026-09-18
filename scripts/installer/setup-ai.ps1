param(
    [string]$Model = 'qwen2.5:7b'
)

$ErrorActionPreference = 'Stop'

# 这个脚本只负责安装后的一键模型准备，不会删除或结束用户已有的 Ollama 进程。
$ollamaCommand = Get-Command ollama.exe -ErrorAction SilentlyContinue
if (-not $ollamaCommand) {
    Write-Host '未检测到 Ollama。请先从 https://ollama.com/download/windows 安装 Ollama，然后重新运行本脚本。'
    Start-Process 'https://ollama.com/download/windows'
    exit 2
}

$ollamaUrl = 'http://127.0.0.1:11434'
$ollamaProcess = $null
try { Invoke-RestMethod -Uri "$ollamaUrl/api/tags" -TimeoutSec 3 | Out-Null } catch {
    # Ollama 通常会随 Windows 登录自动运行；若尚未启动，只启动自己的服务实例。
    $ollamaProcess = Start-Process -FilePath $ollamaCommand.Source -ArgumentList 'serve' -WindowStyle Hidden -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        try { Invoke-RestMethod -Uri "$ollamaUrl/api/tags" -TimeoutSec 3 | Out-Null; $ready = $true; break } catch {}
        if ($ollamaProcess.HasExited) { break }
    }
    if (-not $ready) { throw 'Ollama 服务没有在预期时间内启动。请打开 Ollama 后重试。' }
}

Write-Host "正在下载本地模型 $Model。首次下载约需 3.5–6.5 GB，请保持网络连接并预留至少 12 GB 磁盘空间。"
& $ollamaCommand.Source pull $Model
if ($LASTEXITCODE -ne 0) { throw "模型 $Model 下载失败，请检查网络后重试。" }
Write-Host "本地模型 $Model 已准备好。现在打开句进并选择“本地 AI”。"
