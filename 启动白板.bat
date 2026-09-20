@echo off
rem 数字草稿白板 一键启动：服务已在跑就直接开浏览器，否则先起服务再等它就绪
rem 优先探测 Chrome/Edge，再使用系统默认浏览器

curl -s -o nul http://localhost:5173/
if %errorlevel% neq 0 (
  start "draft-board-server" /min cmd /c "cd /d %~dp0 && npm run dev"
  :wait
  timeout /t 1 /nobreak >nul
  curl -s -o nul http://localhost:5173/
  if %errorlevel% neq 0 goto wait
)

set "URL=http://localhost:5173/"
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if exist "%CHROME%" (start "" "%CHROME%" "%URL%" & goto :eof)
if exist "%EDGE%" (start "" "%EDGE%" "%URL%" & goto :eof)
start "" "%URL%"
