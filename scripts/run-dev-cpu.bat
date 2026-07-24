@echo off
chcp 65001 > nul
setlocal EnableExtensions

cd /d "%~dp0\.."

set "FRONTEND_URL=http://127.0.0.1:4202"
set "CPU_TAURI_CONFIG=tauri.cpu.windows.override.json"
set "CPU_TAURI_DEV_CONFIG=tauri.cpu.dev.windows.override.json"
if "%LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS%"=="" set "LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS=1800"

where npm >nul 2>&1
if errorlevel 1 goto :err_npm

where cargo >nul 2>&1
if errorlevel 1 goto :err_cargo

if not exist "%CPU_TAURI_CONFIG%" goto :err_config
if not exist "%CPU_TAURI_DEV_CONFIG%" goto :err_config

call :check_frontend
if not errorlevel 1 (
  echo [OK] Angular CPU dev server is already running: %FRONTEND_URL%
  goto :start_tauri
)

echo Starting Angular dev server for CPU in background...
start "LoTT CPU Angular" /b cmd /c "npm.cmd --prefix frontend run start -- --host 127.0.0.1 --port 4202 --build-target offline-transcriber:build:development,cpu"

echo Waiting for frontend startup: %FRONTEND_URL%
for /l %%i in (1,1,60) do (
  call :check_frontend
  if not errorlevel 1 goto :frontend_ready
  timeout /t 1 >nul
)
goto :err_frontend

:frontend_ready
echo [OK] Angular CPU dev server is ready: %FRONTEND_URL%

:start_tauri
echo Starting Tauri dev for CPU...
echo FRONTEND_URL=%FRONTEND_URL%
echo Tauri configs=%CPU_TAURI_CONFIG%, %CPU_TAURI_DEV_CONFIG%
call npm run tauri:dev -- --config "%CPU_TAURI_CONFIG%" --config "%CPU_TAURI_DEV_CONFIG%"
if errorlevel 1 goto :err_tauri
exit /b 0

:check_frontend
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri '%FRONTEND_URL%' -TimeoutSec 1; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 }; exit 1 } catch { exit 1 }"
exit /b %ERRORLEVEL%

:err_npm
echo [ERROR] npm was not found. Please run scripts\setup-dev.bat first.
exit /b 1

:err_cargo
echo [ERROR] cargo was not found. Install Rustup and reopen the terminal.
exit /b 1

:err_config
echo [ERROR] CPU Tauri override was not found.
echo         %CPU_TAURI_CONFIG%
echo         %CPU_TAURI_DEV_CONFIG%
exit /b 1

:err_frontend
echo [ERROR] Angular CPU dev server did not become ready within 60 seconds.
exit /b 1

:err_tauri
echo [ERROR] CPU tauri:dev exited with an error.
exit /b 1
