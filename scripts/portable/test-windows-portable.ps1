param(
    [int]$Port = 4325
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$artifactRoot = Join-Path $projectRoot 'release-artifacts'
$archivePath = Join-Path $artifactRoot 'ielts-writing-studio-v0.1.0-windows-x64.zip'
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw 'The test port is already in use.' }

# 必须测试最终 ZIP 的解压副本，且测试日志不能回流到发布包。
$testRoot = Join-Path $artifactRoot ('免安装 验证 ' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
[IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $testRoot)
$packageRoot = Join-Path $testRoot 'ielts-writing-studio-v0.1.0-windows-x64'
$manifest = Get-Content -LiteralPath (Join-Path $packageRoot 'PORTABLE-MANIFEST.json') -Raw | ConvertFrom-Json
$expectedNode = Join-Path $packageRoot "runtime\node-$($manifest.Runtime.Version)-win-x64\node.exe"
$trackedFiles = @(& git -C $projectRoot -c core.quotepath=false ls-tree -r --name-only $manifest.SourceRef)

# 与标签导出逐个核对应用文件，确保打包未偷偷修改原版本。
$referenceZip = Join-Path $testRoot 'tag-reference.zip'
$referenceRoot = Join-Path $testRoot 'tag-reference'
& git -C $projectRoot archive --format=zip "--output=$referenceZip" $manifest.SourceRef
if ($LASTEXITCODE -ne 0) { throw 'Could not export reference source.' }
[IO.Compression.ZipFile]::ExtractToDirectory($referenceZip, $referenceRoot)
foreach ($relative in $trackedFiles) {
    $packagedHash = (Get-FileHash -LiteralPath (Join-Path $packageRoot $relative) -Algorithm SHA256).Hash
    $referenceHash = (Get-FileHash -LiteralPath (Join-Path $referenceRoot $relative) -Algorithm SHA256).Hash
    if ($packagedHash -ne $referenceHash) { throw "Packaged source differs from tag: $relative" }
}
$zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $entries = @($zip.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    $unexpected = @($entries | Where-Object { $_ -match '(^|/)\.env$|\.log$|\.lnk$|(^|/)live-result\.json$|(^|/)\.git/' })
    if ($unexpected.Count) { throw 'The release ZIP contains an excluded local file.' }
    $entryCount = $entries.Count
} finally { $zip.Dispose() }

$savedEnvironment = @{}
$names = @('PATH', 'PORT', 'IELTS_STUDIO_NO_BROWSER', 'AI_PROVIDER', 'OLLAMA_HOST')
foreach ($name in $names) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$testProcessId = $null
$oldLocation = Get-Location
try {
    # 隐藏系统 Node，只保留 Windows 启动所需命令，验证免安装包的独立性。
    $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0;$env:SystemRoot\System32\Wbem"
    if (Get-Command node.exe -ErrorAction SilentlyContinue) { throw 'System Node was not isolated from PATH.' }
    $env:PORT = [string]$Port
    $env:IELTS_STUDIO_NO_BROWSER = '1'
    $env:AI_PROVIDER = 'ollama'
    $env:OLLAMA_HOST = 'http://127.0.0.1:1'
    Set-Location -LiteralPath $packageRoot
    & "$env:SystemRoot\System32\cmd.exe" /d /c ('"' + (Join-Path $packageRoot 'Start Portable.cmd') + '"')
    if ($LASTEXITCODE -ne 0) { throw 'Portable launcher failed.' }
    $page = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -TimeoutSec 15 -UseBasicParsing
    if ($page.StatusCode -ne 200 -or $page.Content -notmatch 'Task 2') { throw 'Application page check failed.' }
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    $testProcessId = $connection.OwningProcess
    $testProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $testProcessId"
    if ($testProcess.ExecutablePath -ne $expectedNode) { throw 'The running server did not use bundled Node.' }
    $testOutput = @(& $expectedNode --test 'tests/*.test.mjs' 2>&1)
    $testExitCode = $LASTEXITCODE
    $testOutput | Select-Object -Last 12 | ForEach-Object { Write-Host $_ }
    if ($testExitCode -ne 0) { throw 'Bundled Node test suite failed.' }
    $report = [ordered]@{
        Archive = $archivePath
        ArchiveSHA256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
        SourceCommit = $manifest.SourceCommit
        TaggedFilesVerified = $trackedFiles.Count
        ArchiveEntries = $entryCount
        ChineseAndSpacePath = $packageRoot
        SystemNodeHidden = $true
        RuntimeExecutable = $testProcess.ExecutablePath
        RuntimeVersion = (& $expectedNode --version)
        Port = $Port
        HttpStatus = $page.StatusCode
        TestExitCode = $testExitCode
        TestSummary = @($testOutput | Select-Object -Last 9 | ForEach-Object { [string]$_ })
    }
    $json = $report | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText((Join-Path $artifactRoot 'portable-verification.json'), $json, (New-Object Text.UTF8Encoding($false)))
    Write-Output $json
} finally {
    # 仅关闭本次测试包启动的进程，不触碰用户正在使用的 4318 服务。
    if ($testProcessId) {
        $remaining = Get-CimInstance Win32_Process -Filter "ProcessId = $testProcessId" -ErrorAction SilentlyContinue
        if ($remaining -and $remaining.ExecutablePath -eq $expectedNode) { Stop-Process -Id $testProcessId -ErrorAction SilentlyContinue }
    }
    Set-Location -LiteralPath $oldLocation.Path
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}
