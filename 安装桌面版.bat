@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-desktop.ps1" %*
if errorlevel 1 (
  echo.
  echo 安装器执行失败。请把窗口中的错误信息发给 Codex。
  pause
)
exit /b %errorlevel%
