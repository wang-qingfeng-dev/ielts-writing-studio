$ErrorActionPreference = 'Stop'
$studioRoot = $env:IELTS_STUDIO_ROOT
if (-not $studioRoot) { $studioRoot = $PSScriptRoot }
if (-not $studioRoot) { throw 'Please launch with Start Writing Studio.cmd.' }
$studioRoot = (Resolve-Path -LiteralPath $studioRoot).Path
$studioUrl = 'http://127.0.0.1:4318'
$studioReady = $false
$studioReachable = $false
try {
    $studioStatus = Invoke-RestMethod -Uri "$studioUrl/api/status" -TimeoutSec 3
    $studioReachable = $true
    $studioReady = $studioStatus.available -eq $true
} catch {}
if (-not $studioReachable) {
    $studioNode = Get-Command node.exe -ErrorAction SilentlyContinue
    $studioNodePath = if ($studioNode) { $studioNode.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
    if (-not (Test-Path -LiteralPath $studioNodePath)) { throw 'Node.js was not found. Install Node.js 20 or later from nodejs.org.' }
    $studioCodex = Get-Command codex.exe -ErrorAction SilentlyContinue
    if ($studioCodex) { $env:IELTS_CODEX_PATH = $studioCodex.Source }
    else {
        $studioCodexBin = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
        if (Test-Path -LiteralPath $studioCodexBin) {
            $studioCandidate = Get-ChildItem -LiteralPath $studioCodexBin -Directory | Sort-Object LastWriteTime -Descending | ForEach-Object { Join-Path $_.FullName 'codex.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
            if ($studioCandidate) { $env:IELTS_CODEX_PATH = $studioCandidate }
        }
    }
    $studioProcess = Start-Process -FilePath $studioNodePath -ArgumentList @('"' + (Join-Path $studioRoot 'server.mjs') + '"') -WorkingDirectory $studioRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $studioRoot 'server.log') -RedirectStandardError (Join-Path $studioRoot 'server-error.log') -PassThru
    for ($studioTry = 0; $studioTry -lt 20; $studioTry++) {
        Start-Sleep -Milliseconds 300
        try {
            $studioStatus = Invoke-RestMethod -Uri "$studioUrl/api/status" -TimeoutSec 2
            $studioReachable = $true
            $studioReady = $studioStatus.available -eq $true
            if ($studioReachable) { break }
        } catch {}
        if ($studioProcess.HasExited) { break }
    }
    if (-not $studioReachable) { throw 'The studio could not start. Check server-error.log, or whether port 4318 is already in use.' }
}
if ($env:IELTS_STUDIO_NO_BROWSER -ne '1') { Start-Process $studioUrl }
Write-Host "Writing Studio is ready: $studioUrl"
