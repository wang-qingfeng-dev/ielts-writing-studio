@echo off
setlocal
set "IELTS_STUDIO_ROOT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
endlocal
