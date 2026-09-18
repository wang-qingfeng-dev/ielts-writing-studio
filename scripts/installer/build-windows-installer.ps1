param(
    [string]$SourceRef = 'main',
    [ValidatePattern('^v\d+\.\d+\.\d+$')]
    [string]$ReleaseVersion = 'v0.1.1',
    [ValidatePattern('^v24\.\d+\.\d+$')]
    [string]$NodeVersion = 'v24.19.0',
    [string]$OutputDir,
    [string]$InnoRoot,
    [switch]$SkipPortableBuild,
    [switch]$KeepBuildDirectory
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression.FileSystem

# 安装器只读取 Git 标签或提交，不把工作区中的 .env、日志和个人数据带进发行包。
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$sourceCommit = (& git -C $projectRoot rev-parse "$SourceRef^{commit}").Trim()
if ($LASTEXITCODE -ne 0 -or -not $sourceCommit) { throw "无法解析源码版本：$SourceRef" }
$artifactRoot = if ($OutputDir) { (Resolve-Path -LiteralPath $OutputDir -ErrorAction SilentlyContinue).Path } else { Join-Path $projectRoot 'release-artifacts' }
if (-not $artifactRoot) { $artifactRoot = $OutputDir }
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
$packageName = "ielts-writing-studio-$ReleaseVersion-windows-x64"
$portableArchive = Join-Path $artifactRoot "$packageName.zip"

if (-not $SkipPortableBuild) {
    if (Test-Path -LiteralPath $portableArchive) { Remove-Item -LiteralPath $portableArchive -Force }
    $portableBuilder = Join-Path $PSScriptRoot '..\portable\build-windows-portable.ps1'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $portableBuilder -SourceRef $SourceRef -ReleaseVersion $ReleaseVersion -NodeVersion $NodeVersion
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $portableArchive)) { throw '便携版构建失败，无法制作安装器。' }
}
if (-not (Test-Path -LiteralPath $portableArchive)) { throw "找不到便携版归档：$portableArchive" }

$buildRoot = Join-Path $artifactRoot ('installer-build-' + [guid]::NewGuid().ToString('N'))
$sourceRoot = Join-Path $buildRoot $packageName
New-Item -ItemType Directory -Path $sourceRoot -Force | Out-Null
[IO.Compression.ZipFile]::ExtractToDirectory($portableArchive, $buildRoot)
if (-not (Test-Path -LiteralPath $sourceRoot)) { throw '便携版归档目录结构不正确。' }

# 安装后可选的一键模型准备工具，模型仍需用户主动下载，不把数 GB 模型放进安装器。
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'setup-ai.ps1') -Destination (Join-Path $sourceRoot 'setup-ai.ps1')
$setupCmd = @('@echo off', 'setlocal', 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-ai.ps1" %*', 'if errorlevel 1 pause', 'endlocal') -join "`r`n"
[IO.File]::WriteAllText((Join-Path $sourceRoot 'Setup AI.cmd'), $setupCmd, [Text.Encoding]::ASCII)
$sourceManifest = Get-Content -LiteralPath (Join-Path $sourceRoot 'PORTABLE-MANIFEST.json') -Raw | ConvertFrom-Json
if ($sourceManifest.SourceCommit -ne $sourceCommit) { throw '便携包来源提交与目标提交不一致。' }

# 优先使用 PATH 中的 ISCC；没有时把官方安装程序放在仓库外的隔离工具目录。
$iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if ($iscc) { $isccPath = $iscc.Source } else {
    $toolRoot = if ($InnoRoot) { $InnoRoot } else { Join-Path $projectRoot '.tools\inno' }
    $isccPath = Join-Path $toolRoot 'ISCC.exe'
    if (-not (Test-Path -LiteralPath $isccPath)) {
        New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
        $installerPath = Join-Path $toolRoot 'innosetup-installer.exe'
        Invoke-WebRequest -Uri 'https://jrsoftware.org/download.php/is.exe' -OutFile $installerPath -UseBasicParsing
        Start-Process -FilePath $installerPath -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=$toolRoot") -Wait -WindowStyle Hidden
        $isccPath = Get-ChildItem -LiteralPath $toolRoot -Filter ISCC.exe -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
    }
}
if (-not $isccPath -or -not (Test-Path -LiteralPath $isccPath)) { throw '找不到 Inno Setup 编译器 ISCC.exe。' }

$outputDirResolved = (New-Item -ItemType Directory -Path (Join-Path $artifactRoot 'installer-output') -Force).FullName
$iss = Join-Path $PSScriptRoot 'JujinWritingStudio.iss'
& $isccPath "/DAppVersion=$ReleaseVersion" "/DSourceDir=$sourceRoot" "/DOutputDir=$outputDirResolved" $iss
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup 编译失败。' }
$setupExe = Join-Path $outputDirResolved "ielts-writing-studio-$ReleaseVersion-windows-x64-setup.exe"
if (-not (Test-Path -LiteralPath $setupExe)) { throw "安装器未生成：$setupExe" }

$setupHash = (Get-FileHash -LiteralPath $setupExe -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{
    FormatVersion = 1
    Application = 'IELTS Writing Studio'
    DisplayName = '句进·雅思写作工作台'
    ReleaseVersion = $ReleaseVersion
    SourceRef = $SourceRef
    SourceCommit = $sourceCommit
    Platform = 'Windows x64'
    Installer = [ordered]@{
        FileName = [IO.Path]::GetFileName($setupExe)
        SHA256 = $setupHash
        Bytes = (Get-Item -LiteralPath $setupExe).Length
        InstallScope = 'Current user (no administrator required)'
        DefaultDirectory = '%LOCALAPPDATA%\\Programs\\JujinWritingStudio'
    };
    Runtime = $sourceManifest.Runtime
    ContainsAIModel = $false
    FirstRun = '安装完成后打开 http://127.0.0.1:4318/?setup=1；本地模型可选择性下载。'
    StorageNotice = '首次模型下载约 3.5–6.5 GB，建议预留至少 12 GB 磁盘空间；卸载不删除 Ollama 模型和浏览器记录。'
}
$manifestPath = Join-Path $artifactRoot "$packageName-setup.manifest.json"
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
if (-not $KeepBuildDirectory) { Remove-Item -LiteralPath $buildRoot -Recurse -Force }
[pscustomobject]@{
    Installer = $setupExe
    SHA256 = $setupHash
    Bytes = (Get-Item -LiteralPath $setupExe).Length
    Manifest = $manifestPath
    SourceCommit = $sourceCommit
    ISCC = $isccPath
} | ConvertTo-Json
