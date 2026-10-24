@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title ProjectGreed - Reload Units
set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%~dp0..\NodeJS\node.exe" (
    set "NODE_EXE=%~dp0..\NodeJS\node.exe"
  ) else if exist "%ProgramFiles%\nodejs\node.exe" (
    set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
  ) else (
    echo Node.js 22 or later is required. Install it and run this file again.
    pause
    exit /b 1
  )
)
"%NODE_EXE%" -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)"
if errorlevel 1 (
  echo Please update Node.js to version 22 or later.
  pause
  exit /b 1
)
echo ProjectGreed - Reload available units
echo Scanning assets\units for enabled unit.json files...
"%NODE_EXE%" tools\reload-units.cjs
if errorlevel 1 (
  echo.
  echo Reload failed. Fix the configuration error above and try again.
  pause
  exit /b 1
)
echo.
echo Done. Restart the ProjectGreed server and refresh your browser.
echo For an updated client ZIP, run npm run package:client.
pause
