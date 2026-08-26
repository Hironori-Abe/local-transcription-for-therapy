@echo off
chcp 65001 > nul
setlocal EnableExtensions

cd /d "%~dp0\.."

call "%~dp0sanitize-dev-env.bat" cpu
if errorlevel 1 goto :err_environment

set "LOTT_DEV_VARIANT=cpu"
set "CUDA_HOME="
set "CUDA_PATH="
set "CUDA_VISIBLE_DEVICES="
set "CUDNN_PATH="
set "HIP_PATH="
set "ROCM_PATH="
set "FRONTEND_URL=http://127.0.0.1:4202"
set "CPU_TAURI_DEV_CONFIG=tauri.cpu.dev.windows.override.json"
set "LOTT_TORCH_BACKEND=cpu"
set "PYTHON_BIN="
if defined LOTT_CPU_DEV_PYTHON_BIN set "PYTHON_BIN=%LOTT_CPU_DEV_PYTHON_BIN%"
if not defined PYTHON_BIN if exist "%cd%\.venv312-cpu\Scripts\python.exe" set "PYTHON_BIN=%cd%\.venv312-cpu\Scripts\python.exe"
if defined PYTHON_BIN set "DIARIZATION_PYTHON_BIN=%PYTHON_BIN%"
if "%LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS%"=="" set "LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS=1800"

where npm >nul 2>&1
if errorlevel 1 goto :err_npm

where cargo >nul 2>&1
if errorlevel 1 goto :err_cargo

if not defined PYTHON_BIN goto :err_python
if not exist "%PYTHON_BIN%" goto :err_python
"%PYTHON_BIN%" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)" >nul 2>&1
if errorlevel 1 goto :err_python_version

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
echo Tauri config=%CPU_TAURI_DEV_CONFIG%
echo LOTT_TORCH_BACKEND=%LOTT_TORCH_BACKEND%
echo PYTHON_BIN=%PYTHON_BIN%
call npm run tauri:dev -- --config "%CPU_TAURI_DEV_CONFIG%"
if errorlevel 1 goto :err_tauri
exit /b 0

:check_frontend
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri '%FRONTEND_URL%' -TimeoutSec 1; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 }; exit 1 } catch { exit 1 }"
exit /b %ERRORLEVEL%

:err_npm
echo [ERROR] npm was not found. Please run scripts\setup-dev-cpu.bat first.
exit /b 1

:err_cargo
echo [ERROR] cargo was not found. Install Rustup and reopen the terminal.
exit /b 1

:err_config
echo [ERROR] CPU Tauri override was not found.
echo         %CPU_TAURI_DEV_CONFIG%
exit /b 1

:err_python
echo [ERROR] CPU development Python was not found.
echo         Run scripts\setup-dev-cpu.bat first, or set LOTT_CPU_DEV_PYTHON_BIN.
exit /b 1

:err_python_version
echo [ERROR] CPU development Python must be Python 3.12:
echo         %PYTHON_BIN%
echo         Run scripts\setup-dev-cpu.bat to recreate the CPU-specific environment.
exit /b 1

:err_environment
echo [ERROR] Could not sanitize inherited CUDA/ROCm environment for CPU.
echo         PowerShell is required to start the isolated development backend.
exit /b 1

:err_frontend
echo [ERROR] Angular CPU dev server did not become ready within 60 seconds.
exit /b 1

:err_tauri
echo [ERROR] CPU tauri:dev exited with an error.
exit /b 1
