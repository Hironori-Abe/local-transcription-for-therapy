@echo off
chcp 65001 > nul
setlocal EnableExtensions

cd /d "%~dp0\.."

set "FRONTEND_URL=http://127.0.0.1:4201"
set "EDITOR_TAURI_CONFIG=tauri.editor.windows.override.json"
set "EDITOR_TAURI_DEV_CONFIG=tauri.editor.dev.windows.override.json"
if "%LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS%"=="" set "LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS=1800"

where npm >nul 2>&1
if errorlevel 1 goto :err_npm

where cargo >nul 2>&1
if errorlevel 1 goto :err_cargo

if not exist "%EDITOR_TAURI_CONFIG%" goto :err_config
if not exist "%EDITOR_TAURI_DEV_CONFIG%" goto :err_config

call :check_frontend
if not errorlevel 1 (
  echo [OK] Angular dev server is already running: %FRONTEND_URL%
  goto :start_tauri
)

echo Starting Angular dev server for Editor in background...
start "LoTT Editor Angular" /b cmd /c "npm.cmd --prefix frontend run start -- --host 127.0.0.1 --port 4201 --build-target offline-transcriber:build:editor"

echo Waiting for frontend startup: %FRONTEND_URL%
for /l %%i in (1,1,60) do (
  call :check_frontend
  if not errorlevel 1 goto :frontend_ready
  timeout /t 1 >nul
)
goto :err_frontend

:frontend_ready
echo [OK] Angular dev server is ready: %FRONTEND_URL%

:start_tauri
echo Starting Tauri dev for Editor...
echo FRONTEND_URL=%FRONTEND_URL%
echo Tauri configs=%EDITOR_TAURI_CONFIG%, %EDITOR_TAURI_DEV_CONFIG%
echo LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS=%LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS%
call npm run tauri:dev -- --config "%EDITOR_TAURI_CONFIG%" --config "%EDITOR_TAURI_DEV_CONFIG%"
if errorlevel 1 goto :err_tauri

echo.
echo [INFO] tauri:dev command returned without an error code.
goto :hold_success

:check_frontend
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri '%FRONTEND_URL%' -TimeoutSec 1; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 }; exit 1 } catch { exit 1 }"
exit /b %ERRORLEVEL%

:err_npm
echo [ERROR] npm was not found. Please run scripts\setup-dev.bat first.
goto :hold_error

:err_cargo
echo [ERROR] cargo was not found.
echo.
echo Install Rustup:
echo   winget install Rustlang.Rustup
echo Then reopen terminal and verify:
echo   cargo --version
goto :hold_error

:err_config
echo [ERROR] Editor Tauri override was not found.
echo         %EDITOR_TAURI_CONFIG%
echo         %EDITOR_TAURI_DEV_CONFIG%
goto :hold_error

:err_frontend
echo [ERROR] Angular dev server did not become ready within 60 seconds.
goto :hold_error

:err_tauri
echo.
echo [ERROR] tauri:dev exited with an error.
echo Common causes:
echo - Rust toolchain missing
echo - invalid Tauri config
echo - frontend dev server failed to start
goto :hold_error

:hold_error
echo.
echo Window is held because an error occurred.
echo Type Q and press Enter to close.
goto :hold_loop

:hold_success
echo.
echo Window is held for log review.
echo Type Q and press Enter to close.
goto :hold_loop

:hold_loop
set "_HOLD_INPUT="
set /p "_HOLD_INPUT=> "
if /I "%_HOLD_INPUT%"=="Q" exit /b 0
goto :hold_loop
