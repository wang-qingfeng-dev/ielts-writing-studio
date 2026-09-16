@echo off
setlocal
set "IELTS_STUDIO_ROOT=%~dp0"
powershell.exe -NoProfile -Command "& ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $env:IELTS_STUDIO_ROOT 'start.ps1'))))"
if errorlevel 1 pause
endlocal
