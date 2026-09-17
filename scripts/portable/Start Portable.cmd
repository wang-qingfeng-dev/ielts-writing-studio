@echo off
setlocal
set "IELTS_BUNDLED_NODE=%~dp0runtime\@NODE_DIRECTORY@"
if not exist "%IELTS_BUNDLED_NODE%\node.exe" (
  echo The bundled Node.js runtime is missing. Extract the complete ZIP first.
  pause
  exit /b 1
)
set "PATH=%IELTS_BUNDLED_NODE%;%PATH%"
call "%~dp0Start Writing Studio.cmd"
endlocal
