@echo off
chcp 65001 > nul
setlocal EnableExtensions
set "HOLD_ON_EXIT=1"
if /I "%~1"=="--no-hold" set "HOLD_ON_EXIT=0"

REM Vulkan 版（NVIDIA / AMD / Intel 共通）の開発起動。
REM 文字起こし・話者分離は python_sidecar\speech-engines の ggml エンジン、
REM 校正は src-tauri\resources\llama-server-vulkan の llama-server を使う（Rust の feature "vulkan"）。
REM 準備:
REM   powershell -ExecutionPolicy Bypass -File scripts\setup-ggml-speech-windows.ps1
REM   powershell -ExecutionPolicy Bypass -File scripts\prepare-vulkan-bundle-windows.ps1 -SkipEngines
cd /d "%~dp0.."

if not exist "python_sidecar\speech-engines\whisper\bin\whisper-cli.exe" goto :err_engines
if not exist "python_sidecar\speech-engines\nemo\bin\nemo-speech.exe" goto :err_engines
if not exist "src-tauri\resources\llama-server-vulkan\llama-server.exe" goto :err_bundle

REM 校正・暗号化保存・Gemma 取得の Python は、インストーラーと同じ最小構成を使う
set "PYTHON_BIN="
if exist "src-tauri\resources\python312-vulkan\python.exe" set "PYTHON_BIN=%cd%\src-tauri\resources\python312-vulkan\python.exe"
if not defined PYTHON_BIN if exist ".venv312-nvidia\Scripts\python.exe" set "PYTHON_BIN=%cd%\.venv312-nvidia\Scripts\python.exe"
if not defined PYTHON_BIN goto :err_bundle
if "%LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS%"=="" set "LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS=1800"

where npm >nul 2>&1
if errorlevel 1 goto :err_npm

echo Starting Angular dev server in background...
start /b cmd /c "npm.cmd --prefix frontend run start"
echo Waiting 8 seconds for frontend startup...
timeout /t 8 >nul

echo Starting Tauri dev (Vulkan)...
echo PYTHON_BIN=%PYTHON_BIN%
call npm run tauri:dev -- --config tauri.vulkan.dev.windows.override.json --features vulkan
if errorlevel 1 goto :err_tauri
goto :hold_success

:err_engines
echo [ERROR] ggml speech engines were not found. Run:
echo         powershell -ExecutionPolicy Bypass -File scripts\setup-ggml-speech-windows.ps1
goto :hold_error

:err_bundle
echo [ERROR] Vulkan llama-server / Python bundle was not found. Run:
echo         powershell -ExecutionPolicy Bypass -File scripts\prepare-vulkan-bundle-windows.ps1 -SkipEngines
goto :hold_error

:err_npm
echo [ERROR] npm was not found. Please run scripts\setup-dev-nvidia.bat first.
goto :hold_error

:err_tauri
echo [ERROR] tauri dev failed.
goto :hold_error

:hold_error
if "%HOLD_ON_EXIT%"=="0" exit /b 1
echo.
echo Type Q and press Enter to close.
goto :hold_loop

:hold_success
if "%HOLD_ON_EXIT%"=="0" exit /b 0
echo.
echo Type Q and press Enter to close.
goto :hold_loop

:hold_loop
set "_HOLD_INPUT="
set /p "_HOLD_INPUT=> "
if /I "%_HOLD_INPUT%"=="Q" exit /b 0
goto :hold_loop
