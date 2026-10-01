param([string]$OutputDir = 'release-artifacts\desktop-test')
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$version=(Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$electron=Join-Path $root 'tmp\electron'
$electronExe=Join-Path $electron 'electron.exe'
if (-not (Test-Path -LiteralPath $electronExe)) { throw "Electron runtime missing." }
$out=Join-Path $root $OutputDir
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item $out -ItemType Directory -Force|Out-Null
$app=Join-Path $out 'app'
New-Item $app -ItemType Directory -Force|Out-Null
${sourceZip}=Join-Path $out 'source.zip'
& git -C $root archive --format=zip "--output=$sourceZip" HEAD
if ($LASTEXITCODE -ne 0) { throw 'Source export failed.' }
Expand-Archive -LiteralPath $sourceZip -DestinationPath $app -Force
Remove-Item -LiteralPath $sourceZip -Force
Copy-Item $electron (Join-Path $out 'electron') -Recurse
Copy-Item (Join-Path $root 'scripts\desktop\Start Jujin Desktop.cmd') $out
Copy-Item (Join-Path $root 'scripts\desktop\README.test.zh-CN.md') (Join-Path $out 'README.test.zh-CN.md')
$zip=Join-Path $root "release-artifacts\ielts-writing-studio-v$version-windows-x64-desktop-test.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zip -CompressionLevel Optimal
Get-FileHash $zip -Algorithm SHA256 | Select-Object Path,Hash
