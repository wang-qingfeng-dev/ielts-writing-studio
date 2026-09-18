param(
    [string]$SourceRef = 'main',
    [ValidatePattern('^v\d+\.\d+\.\d+$')]
    [string]$ReleaseVersion = 'v0.1.1',
    [ValidatePattern('^v24\.\d+\.\d+$')]
    [string]$NodeVersion = 'v24.19.0'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression.FileSystem

# 只从 Git 标签导出应用，不复制工作目录中的 .env、日志或私人测试结果。
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$sourceCommit = (& git -C $projectRoot rev-parse "$SourceRef^{commit}").Trim()
if ($LASTEXITCODE -ne 0) { throw 'The source tag could not be resolved.' }
$artifactRoot = Join-Path $projectRoot 'release-artifacts'
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
$buildRoot = Join-Path $artifactRoot ('portable-build-' + [guid]::NewGuid().ToString('N'))
$packageName = "ielts-writing-studio-$ReleaseVersion-windows-x64"
$packageRoot = Join-Path $buildRoot $packageName
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
$sourceZip = Join-Path $buildRoot 'application-source.zip'
& git -C $projectRoot archive --format=zip "--output=$sourceZip" $SourceRef
if ($LASTEXITCODE -ne 0) { throw 'git archive failed.' }
[IO.Compression.ZipFile]::ExtractToDirectory($sourceZip, $packageRoot)
$sourceFiles = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File)
foreach ($file in $sourceFiles) {
    $relative = $file.FullName.Substring($packageRoot.Length + 1).Replace('\', '/')
    if ($relative -match '(^|/)(\.git/|release-artifacts/|output/|tmp/|node_modules/)|(^|/)\.env($|\.(?!example$))|\.log$|\.lnk$|(^|/)live-result\.json$') {
        throw "Excluded local artifact appeared in the source tag: $relative"
    }
}

# 固定官方版本，并核对官方 SHA-256 后再解压完整发行包及其许可证。
$nodeDirectory = "node-$NodeVersion-win-x64"
$nodeFile = "$nodeDirectory.zip"
$nodeBaseUrl = "https://nodejs.org/dist/$NodeVersion"
$checksumsPath = Join-Path $buildRoot 'SHASUMS256.txt'
$nodeZip = Join-Path $buildRoot $nodeFile
Invoke-WebRequest -Uri "$nodeBaseUrl/SHASUMS256.txt" -OutFile $checksumsPath -UseBasicParsing
$checksumLine = Get-Content -LiteralPath $checksumsPath | Where-Object { $_ -match ('\s+' + [regex]::Escape($nodeFile) + '$') }
if (@($checksumLine).Count -ne 1) { throw 'Node archive was not uniquely listed in the official checksums.' }
$expectedNodeHash = ($checksumLine -split '\s+')[0].ToLowerInvariant()
Invoke-WebRequest -Uri "$nodeBaseUrl/$nodeFile" -OutFile $nodeZip -UseBasicParsing
$actualNodeHash = (Get-FileHash -LiteralPath $nodeZip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualNodeHash -ne $expectedNodeHash) { throw 'Official Node archive SHA-256 mismatch.' }
$runtimeRoot = Join-Path $packageRoot 'runtime'
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
[IO.Compression.ZipFile]::ExtractToDirectory($nodeZip, $runtimeRoot)
$runtimeDirectory = Join-Path $runtimeRoot $nodeDirectory
foreach ($required in @('node.exe', 'LICENSE', 'README.md')) {
    if (-not (Test-Path -LiteralPath (Join-Path $runtimeDirectory $required))) { throw "Missing Node distribution file: $required" }
}
Copy-Item -LiteralPath $checksumsPath -Destination (Join-Path $runtimeRoot "SHASUMS256-$NodeVersion.txt")

# 启动包装器与中文说明作为独立附加文件，不改动标签中的源码。
$utf8 = New-Object Text.UTF8Encoding($false)
$wrapperSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Start Portable.cmd'))
$wrapper = $wrapperSource.Replace('@NODE_DIRECTORY@', $nodeDirectory)
$wrapper = $wrapper -replace '\r?\n', "`r`n"
[IO.File]::WriteAllText((Join-Path $packageRoot 'Start Portable.cmd'), $wrapper, [Text.Encoding]::ASCII)
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.portable.zh-CN.md') -Destination (Join-Path $packageRoot 'README.portable.zh-CN.md')
$readmePath = Join-Path $packageRoot 'README.portable.zh-CN.md'
$readme = [IO.File]::ReadAllText($readmePath).Replace('v0.1.0', $ReleaseVersion)
[IO.File]::WriteAllText($readmePath, $readme, $utf8)

# 清单记录来源与哈希；源码全量校验可对照 SourceCommit 重新运行 git archive。
$manifest = [ordered]@{
    FormatVersion = 1
    Application = 'IELTS Writing Studio'
    SourceRef = $SourceRef
    SourceCommit = $sourceCommit
    SourceArchiveSHA256 = (Get-FileHash -LiteralPath $sourceZip -Algorithm SHA256).Hash.ToLowerInvariant()
    SourceFileCount = $sourceFiles.Count
    Platform = 'Windows x64'
    Runtime = [ordered]@{
        Name = 'Node.js'
        Version = $NodeVersion
        OfficialArchiveUrl = "$nodeBaseUrl/$nodeFile"
        OfficialChecksumsUrl = "$nodeBaseUrl/SHASUMS256.txt"
        ArchiveSHA256 = $actualNodeHash
        ExecutableSHA256 = (Get-FileHash -LiteralPath (Join-Path $runtimeDirectory 'node.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
        CompleteOfficialDistribution = $true
        FileCount = @(Get-ChildItem -LiteralPath $runtimeDirectory -Recurse -File).Count
        License = "runtime/$nodeDirectory/LICENSE"
    };
    AdditionalFiles = @('Start Portable.cmd', 'README.portable.zh-CN.md', 'PORTABLE-MANIFEST.json', "runtime/SHASUMS256-$NodeVersion.txt")
    LauncherSHA256 = (Get-FileHash -LiteralPath (Join-Path $packageRoot 'Start Portable.cmd') -Algorithm SHA256).Hash.ToLowerInvariant()
    ContainsAIModel = $false
    ContainsCredentials = $false
}
[IO.File]::WriteAllText((Join-Path $packageRoot 'PORTABLE-MANIFEST.json'), ($manifest | ConvertTo-Json -Depth 8), $utf8)

# 先打包再进行运行测试，避免测试生成的日志进入发布包。
$zipPath = Join-Path $artifactRoot "$packageName.zip"
if (Test-Path -LiteralPath $zipPath) { throw "Release ZIP already exists: $zipPath" }
[IO.Compression.ZipFile]::CreateFromDirectory($packageRoot, $zipPath, [IO.Compression.CompressionLevel]::Optimal, $true)
$releaseHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$zipPath.sha256", "$releaseHash  $packageName.zip`n", [Text.Encoding]::ASCII)
Copy-Item -LiteralPath (Join-Path $packageRoot 'PORTABLE-MANIFEST.json') -Destination (Join-Path $artifactRoot "$packageName.manifest.json")
[pscustomobject]@{
    Archive = $zipPath
    SHA256 = $releaseHash
    Bytes = (Get-Item -LiteralPath $zipPath).Length
    SourceCommit = $sourceCommit
    NodeSHA256 = $actualNodeHash
    BuildDirectory = $buildRoot
} | ConvertTo-Json
