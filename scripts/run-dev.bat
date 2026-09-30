@echo off
chcp 65001 > nul
setlocal EnableExtensions
set "HOLD_ON_EXIT=1"
REM shift moves %0 too, so remember the script directory before parsing options.
set "SCRIPT_DIR=%~dp0"
REM Options (any order): --no-hold, --cpu (dev only: LOTT_DEV_FORCE_CPU=1 treats the GPU as absent)
:parse_args
if "%~1"=="" goto :args_done
if /I "%~1"=="--no-hold" set "HOLD_ON_EXIT=0"
if /I "%~1"=="--cpu" set "LOTT_DEV_FORCE_CPU=1"
shift
goto :parse_args
:args_done
if "%LOTT_DEV_FORCE_CPU%"=="1" echo [DEV] LOTT_DEV_FORCE_CPU=1: running speech engines on CPU only.

REM Development launcher for the Full edition (Vulkan: NVIDIA, AMD, and Intel; CPU without a GPU).
REM Speech engines: python_sidecar\speech-engines.
REM Setup commands:
REM   powershell -ExecutionPolicy Bypass -File scripts\setup-ggml-speech-windows.ps1
REM   python scripts\setup_ffmpeg_lgpl.py
cd /d "%SCRIPT_DIR%.."

if not exist "python_sidecar\speech-engines\whisper\bin\whisper-cli.exe" goto :err_engines
if not exist "python_sidecar\speech-engines\nemo\bin\nemo-speech.exe" goto :err_engines
if "%LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS%"=="" set "LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS=1800"

where npm >nul 2>&1
if errorlevel 1 goto :err_npm

echo Starting Angular dev server in background...
start /b cmd /c "npm.cmd --prefix frontend run start"
echo Waiting 8 seconds for frontend startup...
powershell -NoProfile -Command "Start-Sleep -Seconds 8"

echo Starting Tauri dev (Full edition)...
call npm run tauri:dev -- --config tauri.dev.windows.override.json
if errorlevel 1 goto :err_tauri
goto :hold_success

:err_engines
echo [ERROR] ggml speech engines were not found. Run:
echo         powershell -ExecutionPolicy Bypass -File scripts\setup-ggml-speech-windows.ps1
goto :hold_error

:err_npm
echo [ERROR] npm was not found. Install Node.js (LTS), then run: npm install --prefix frontend
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
