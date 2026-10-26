@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo [LAN Pad] Installing dependencies...
  call npm.cmd install
  if errorlevel 1 goto error
)

if not exist "dist\server\index.js" (
  echo [LAN Pad] Building...
  call npm.cmd run build
  if errorlevel 1 goto error
)

echo.
echo [LAN Pad] Starting server. The browser will open in 2 seconds...
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:8787'"
node dist\server\index.js
goto end

:error
echo.
echo [LAN Pad] Failed. Check the error output above.
pause

:end
endlocal
