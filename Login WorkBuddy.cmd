@echo off
setlocal
title WorkBuddy CLI login

rem Proxy variables crash the WorkBuddy CLI, so clear them first.
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
set "http_proxy="
set "https_proxy="
set "NO_PROXY=*"

set "CB_BIN=D:\Software\WorkBuddyAI\resources\app.asar.unpacked\cli\bin\codebuddy"
set "CB_PS=%~dp0login-workbuddy.ps1"

if not exist "%CB_BIN%" (
  echo.
  echo  [X] Not found: %CB_BIN%
  echo      Tell me where WorkBuddy is installed and I will fix this line.
  echo.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CB_PS%"

echo  ----------------------------------------------------------
echo   Checking login status ...
echo.

node "%CB_BIN%" -p --output-format json --tools "" --permission-mode dontAsk --no-session-persistence --port 0 "Reply with exactly: OK" 2>&1

echo.
echo  ----------------------------------------------------------
echo   OK                        = login works. Choose "WorkBuddy CLI" in the app.
echo   Authentication required   = not logged in yet. Run this file again.
echo.
pause
endlocal
