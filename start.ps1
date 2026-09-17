$ErrorActionPreference = 'Stop'
$studioRoot = $env:IELTS_STUDIO_ROOT
if (-not $studioRoot) { $studioRoot = $PSScriptRoot }
if (-not $studioRoot) { throw 'Please launch with Start Writing Studio.cmd.' }
$studioRoot = (Resolve-Path -LiteralPath $studioRoot).Path
$studioNode = Get-Command node.exe -ErrorAction SilentlyContinue
$studioNodePath = if ($studioNode) { $studioNode.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $studioNodePath)) { throw 'Node.js was not found. Install Node.js 24 LTS from nodejs.org.' }
$studioNodeVersion = (& $studioNodePath --version).TrimStart('v')
if ([version]$studioNodeVersion -lt [version]'22.9.0') { throw 'Node.js 22.9 or newer is required. Node.js 24 LTS is recommended.' }
$studioEnvPath = Join-Path $studioRoot '.env'
$studioEnvArgs = @()
$studioStartArgs = @()
if (Test-Path -LiteralPath $studioEnvPath) {
    $studioEnvArgs += "--env-file=$studioEnvPath"
    $studioStartArgs += '--env-file="' + $studioEnvPath + '"'
}
$studioPort = & $studioNodePath @studioEnvArgs -e 'const p=Number(process.env.PORT||4318); if(!Number.isInteger(p)||p<1||p>65535)process.exit(2); console.log(p)'
if ($LASTEXITCODE -ne 0) { throw 'Invalid PORT in the environment or .env. Use an integer from 1 to 65535.' }
$studioUrl = "http://127.0.0.1:$studioPort"
$studioReachable = $false
try {
    $studioStatus = Invoke-RestMethod -Uri "$studioUrl/api/status" -TimeoutSec 12
    $studioReachable = $null -ne $studioStatus.available -and $null -ne $studioStatus.engine
} catch {}
if (-not $studioReachable) {
    $studioConfiguredCodex = & $studioNodePath @studioEnvArgs -e 'process.stdout.write(process.env.IELTS_CODEX_PATH||String())'
    $studioCodex = Get-Command codex.exe -ErrorAction SilentlyContinue
    if (-not $studioConfiguredCodex -and $studioCodex) { $env:IELTS_CODEX_PATH = $studioCodex.Source }
    elseif (-not $studioConfiguredCodex) {
        $studioCodexBin = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
        if (Test-Path -LiteralPath $studioCodexBin) {
            $studioCandidate = Get-ChildItem -LiteralPath $studioCodexBin -Directory | Sort-Object LastWriteTime -Descending | ForEach-Object { Join-Path $_.FullName 'codex.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
            if ($studioCandidate) { $env:IELTS_CODEX_PATH = $studioCandidate }
        }
    }
    $studioStartArgs += '"' + (Join-Path $studioRoot 'server.mjs') + '"'
    $studioProcess = Start-Process -FilePath $studioNodePath -ArgumentList $studioStartArgs -WorkingDirectory $studioRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $studioRoot 'server.log') -RedirectStandardError (Join-Path $studioRoot 'server-error.log') -PassThru
    for ($studioTry = 0; $studioTry -lt 20; $studioTry++) {
        Start-Sleep -Milliseconds 300
        try {
            $studioStatus = Invoke-RestMethod -Uri "$studioUrl/api/status" -TimeoutSec 12
            $studioReachable = $null -ne $studioStatus.available -and $null -ne $studioStatus.engine
            if ($studioReachable) { break }
        } catch {}
        if ($studioProcess.HasExited) { break }
    }
    if (-not $studioReachable) { throw "The studio could not start. Check server-error.log or whether port $studioPort is in use." }
}
if ($env:IELTS_STUDIO_NO_BROWSER -ne '1') { Start-Process $studioUrl }
Write-Host "Writing Studio is ready: $studioUrl"
