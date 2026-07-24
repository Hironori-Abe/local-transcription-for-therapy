@echo off
chcp 65001 > nul
setlocal EnableExtensions

cd /d "%~dp0\.."

set "FRONTEND_URL=http://127.0.0.1:4201"
set "AMD_TAURI_CONFIG=tauri.amd.windows.override.json"
set "AMD_TAURI_DEV_CONFIG=tauri.amd.dev.windows.override.json"
if "%LOTT_AMD_DEV_PYTHON_BIN%"=="" (
  set "AMD_PYTHON_BIN=%cd%\.venv312-amd\Scripts\python.exe"
) else (
  set "AMD_PYTHON_BIN=%LOTT_AMD_DEV_PYTHON_BIN%"
)
set "PYTHON_BIN=%AMD_PYTHON_BIN%"
set "DIARIZATION_PYTHON_BIN=%AMD_PYTHON_BIN%"
if "%LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS%"=="" set "LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS=1800"

where npm >nul 2>&1
if errorlevel 1 goto :err_npm

where cargo >nul 2>&1
if errorlevel 1 goto :err_cargo

if not exist "%AMD_PYTHON_BIN%" goto :err_python

if not exist "%AMD_TAURI_CONFIG%" goto :err_config
if not exist "%AMD_TAURI_DEV_CONFIG%" goto :err_config

call :check_frontend
if not errorlevel 1 (
  echo [OK] Angular AMD dev server is already running: %FRONTEND_URL%
  goto :start_tauri
)

echo Starting Angular dev server for AMD in background...
start "LoTT AMD Angular" /b cmd /c "npm.cmd run frontend:dev:amd"

echo Waiting for frontend startup: %FRONTEND_URL%
for /l %%i in (1,1,60) do (
  call :check_frontend
  if not errorlevel 1 goto :frontend_ready
  timeout /t 1 >nul
)
goto :err_frontend

:frontend_ready
echo [OK] Angular AMD dev server is ready: %FRONTEND_URL%

:start_tauri
echo Starting Tauri dev for AMD...
echo FRONTEND_URL=%FRONTEND_URL%
echo Tauri configs=%AMD_TAURI_CONFIG%, %AMD_TAURI_DEV_CONFIG%
echo PYTHON_BIN=%PYTHON_BIN%
echo DIARIZATION_PYTHON_BIN=%DIARIZATION_PYTHON_BIN%
echo [INFO] Select the AMD integrated GPU in Settings after launch.
call npm run tauri:dev -- --config "%AMD_TAURI_CONFIG%" --config "%AMD_TAURI_DEV_CONFIG%"
if errorlevel 1 goto :err_tauri
exit /b 0

:check_frontend
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri '%FRONTEND_URL%' -TimeoutSec 1; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 }; exit 1 } catch { exit 1 }"
exit /b %ERRORLEVEL%

:err_npm
echo [ERROR] npm was not found. Please run scripts\setup-dev.bat --amd first.
exit /b 1

:err_cargo
echo [ERROR] cargo was not found. Install Rustup and reopen the terminal.
exit /b 1

:err_python
echo [ERROR] AMD development Python was not found:
echo         %AMD_PYTHON_BIN%
echo         Create the separate AMD environment before launching this command.
echo         To use another path, set LOTT_AMD_DEV_PYTHON_BIN before launch.
exit /b 1

:err_config
echo [ERROR] AMD Tauri override was not found.
echo         %AMD_TAURI_CONFIG%
echo         %AMD_TAURI_DEV_CONFIG%
exit /b 1

:err_frontend
echo [ERROR] Angular AMD dev server did not become ready within 60 seconds.
exit /b 1

:err_tauri
echo [ERROR] AMD tauri:dev exited with an error.
exit /b 1
