@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or later is required.
  pause
  exit /b 1
)
node tools/open-developer.cjs
if errorlevel 1 pause
