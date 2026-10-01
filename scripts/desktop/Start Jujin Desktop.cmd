@echo off
setlocal
cd /d "%~dp0"
set PORT=4338
start "" "%~dp0electron\electron.exe" --no-sandbox "%~dp0app"
endlocal
