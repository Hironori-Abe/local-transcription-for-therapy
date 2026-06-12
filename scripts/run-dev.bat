@echo off
chcp 65001 > nul
setlocal EnableExtensions

cd /d "%~dp0\.."

echo Stopping any running lemond process...
taskkill /F /IM lemond.exe >nul 2>&1
if errorlevel 1 (
  echo [INFO] lemond was not running.
) else (
  echo [OK] lemond stopped.
)
set "PYTHON_BIN=py"
if exist ".venv312\Scripts\python.exe" set "PYTHON_BIN=%cd%\.venv312\Scripts\python.exe"
set "CUDA_HINT_1=C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.9\bin"
set "CUDA_HINT_2=C:\Program Files\NVIDIA\CUDNN\v9.20\bin\12.9\x64"
set "EMULATION_MODE=none"
if not "%OFFLINE_TRANSCRIBER_DEV_EMULATION_MODE%"=="" set "EMULATION_MODE=%OFFLINE_TRANSCRIBER_DEV_EMULATION_MODE%"
if not "%RUN_DEV_EMULATION_MODE%"=="" set "EMULATION_MODE=%RUN_DEV_EMULATION_MODE%"
if /I not "%EMULATION_MODE%"=="no_cuda" if /I not "%EMULATION_MODE%"=="missing_community1" set "EMULATION_MODE=none"
set "OFFLINE_TRANSCRIBER_DEV_EMULATION_MODE=%EMULATION_MODE%"
if "%LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS%"=="" set "LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS=1800"
set "EMULATION_STATE_FILE=%cd%\.dev-runtime-emulation.env"

(
  echo # offline-transcriber dev emulation flags
  echo OFFLINE_TRANSCRIBER_DEV_EMULATION_MODE=%EMULATION_MODE%
) > "%EMULATION_STATE_FILE%"

where npm >nul 2>&1
if errorlevel 1 goto :err_npm

if not exist "%PYTHON_BIN%" (
  where %PYTHON_BIN% >nul 2>&1
  if errorlevel 1 goto :err_py
)

where cargo >nul 2>&1
if errorlevel 1 goto :err_cargo

echo Python preflight:
call %PYTHON_BIN% -c "import sys; print('executable=', sys.executable); print('version=', sys.version)"
if errorlevel 1 goto :err_py_preflight

set "CUDA_READY=1"
if /I "%EMULATION_MODE%"=="no_cuda" (
  echo [INFO] OFFLINE_TRANSCRIBER_DEV_EMULATION_MODE=no_cuda
  echo [INFO] Emulating a machine without CUDA support.
  set "CUDA_READY=0"
) else (
  echo CUDA DLL preflight:
  where.exe cublas64_12.dll >nul 2>&1
  if errorlevel 1 (
    echo [WARN] cublas64_12.dll is not visible on PATH in this terminal.
    echo        Add this directory to PATH, for example:
    echo          %CUDA_HINT_1%
    set "CUDA_READY=0"
  )
  where.exe cudnn64_9.dll >nul 2>&1
  if errorlevel 1 (
    echo [WARN] cudnn64_9.dll is not visible on PATH in this terminal.
    echo        Add this directory to PATH, for example:
    echo          %CUDA_HINT_2%
    set "CUDA_READY=0"
  )

  set "_PRINTED_CUBLAS="
  for /f "delims=" %%i in ('where.exe cublas64_12.dll 2^>nul') do (
    if not defined _PRINTED_CUBLAS (
      echo [OK] cublas64_12.dll: %%i
      set "_PRINTED_CUBLAS=1"
    )
  )
  set "_PRINTED_CUDNN="
  for /f "delims=" %%i in ('where.exe cudnn64_9.dll 2^>nul') do (
    if not defined _PRINTED_CUDNN (
      echo [OK] cudnn64_9.dll: %%i
      set "_PRINTED_CUDNN=1"
    )
  )

  echo ctranslate2 preflight:
  call %PYTHON_BIN% -c "import ctranslate2 as ct; n=ct.get_cuda_device_count(); print('cuda_device_count=', n); exit(0 if n > 0 else 2)"
  if errorlevel 1 (
    echo [WARN] ctranslate2 CUDA preflight failed in this terminal.
    echo        Transcription tab may be hidden; Read/Edit mode still works.
    echo        Recovery:
    echo          %PYTHON_BIN% python_sidecar\setup_venv_cli.py python_sidecar\requirements-runtime.txt
    set "CUDA_READY=0"
  )
)

if "%CUDA_READY%"=="1" (
  echo [INFO] CUDA preflight passed. Transcription tab should be available.
) else (
  echo [INFO] CUDA preflight failed or emulated-off. Launching in Read/Edit-oriented mode.
)
if /I "%EMULATION_MODE%"=="missing_community1" (
  echo [INFO] OFFLINE_TRANSCRIBER_DEV_EMULATION_MODE=missing_community1
  echo [INFO] Emulating missing diarization model: community-1.
)
echo [INFO] Emulation state saved: %EMULATION_STATE_FILE%

set "LEMONADE_BIN="
where lemonade-server >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%i in ('where lemonade-server') do set "LEMONADE_BIN=%%i"
  goto :lemonade_run_done
)
where lemonade >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%i in ('where lemonade') do set "LEMONADE_BIN=%%i"
  goto :lemonade_run_done
)
if exist "C:\Program Files\Lemonade\lemonade-server.exe" (
  set "LEMONADE_BIN=C:\Program Files\Lemonade\lemonade-server.exe"
)
:lemonade_run_done
if defined LEMONADE_BIN (
  echo [OK] Lemonade available: %LEMONADE_BIN%
) else (
  echo [INFO] Lemonade not found. LLM backend will use llama_cpp only.
)

if not exist "python_sidecar\models\pyannote-speaker-diarization-community-1" (
  echo [INFO] Diarization model directory not found.
  echo [INFO] Creating placeholder directory so Tauri resource check passes.
  echo [INFO] Speaker diarization will be unavailable at runtime.
  mkdir "python_sidecar\models\pyannote-speaker-diarization-community-1"
)

echo Starting Angular dev server in background...
start /b cmd /c "npm.cmd --prefix frontend run start"
echo Waiting 8 seconds for frontend startup...
timeout /t 8 >nul

echo Starting Tauri dev...
echo PYTHON_BIN=%PYTHON_BIN%
echo LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS=%LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS%
call npm run tauri:dev -- --config tauri.dev.windows.override.json
if errorlevel 1 goto :err_tauri

echo.
echo [INFO] tauri:dev command returned without an error code.
goto :hold_success

:err_npm
echo [ERROR] npm was not found. Please run scripts\setup-dev.bat first.
goto :hold_error

:err_py
echo [ERROR] Python launcher "%PYTHON_BIN%" was not found.
echo         Please run scripts\setup-dev.bat first.
echo         Recommended runtime is .venv312\Scripts\python.exe
goto :hold_error

:err_cargo
echo [ERROR] cargo was not found.
echo.
echo This causes:
echo   failed to run 'cargo metadata' ... program not found
echo.
echo Install Rustup:
echo   winget install Rustlang.Rustup
echo Then reopen terminal and verify:
echo   cargo --version
echo   rustup --version
echo.
echo If needed, add PATH:
echo   %%USERPROFILE%%\.cargo\bin
echo.
echo Also install Visual Studio Build Tools [C++] :
echo   https://visualstudio.microsoft.com/visual-cpp-build-tools/
goto :hold_error

:err_py_preflight
echo [ERROR] Python preflight failed.
goto :hold_error

:err_tauri
echo.
echo [ERROR] tauri:dev exited with an error.
echo Common causes:
echo - src-tauri\tauri.conf.json invalid JSON
echo - Rust toolchain missing
echo - icon/resource missing
echo - Python sidecar failed to start
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
