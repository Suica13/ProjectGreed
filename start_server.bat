@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "SERVER_NODE=%~dp0runtime\node.exe"
if exist "%SERVER_NODE%" goto run_server
set "SERVER_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22 or later from https://nodejs.org/
  pause
  exit /b 1
)
:run_server
"%SERVER_NODE%" -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)"
if errorlevel 1 (
  echo Please update Node.js to version 22 or later.
  pause
  exit /b 1
)
if not exist "node_modules\ws\index.js" (
  echo Dependency missing. Run: npm ci --omit=dev --ignore-scripts
  pause
  exit /b 1
)
"%SERVER_NODE%" server.js %*
pause
