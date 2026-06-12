@echo off
chcp 65001 > nul
setlocal EnableExtensions
set "PIP_DISABLE_PIP_VERSION_CHECK=1"

cd /d "%~dp0\.."

set "HOLD_ON_EXIT=0"
if /I "%~1"=="--hold" set "HOLD_ON_EXIT=1"

set "PY_BOOTSTRAP=py"
set "MAIN_VENV=.venv312"
set "OLD_DIAR_VENV=.venv312-pyannote4"

echo === Rebuild Unified Runtime Venv ===
echo.

if exist "%MAIN_VENV%" (
  echo [1/7] Removing existing %MAIN_VENV% ...
  rmdir /S /Q "%MAIN_VENV%"
  if exist "%MAIN_VENV%" (
    echo [ERROR] Failed to remove %MAIN_VENV%.
    echo [ERROR] Close running app/terminals that may lock files, then retry.
    goto :fail
  )
) else (
  echo [1/7] %MAIN_VENV% not found. Skip removal.
)

if exist "%OLD_DIAR_VENV%" (
  echo [2/7] Removing legacy %OLD_DIAR_VENV% ...
  rmdir /S /Q "%OLD_DIAR_VENV%"
  if exist "%OLD_DIAR_VENV%" (
    echo [ERROR] Failed to remove %OLD_DIAR_VENV%.
    echo [ERROR] Close running app/terminals that may lock files, then retry.
    goto :fail
  )
) else (
  echo [2/7] %OLD_DIAR_VENV% not found. Skip removal.
)

echo [3/7] Creating %MAIN_VENV% with Python 3.12 ...
%PY_BOOTSTRAP% -3.12 -m venv %MAIN_VENV%
if errorlevel 1 (
  echo [WARN] Python 3.12 launcher not found. Retrying with default launcher...
  %PY_BOOTSTRAP% -m venv %MAIN_VENV%
  if errorlevel 1 goto :fail
)

set "PYTHON_BIN=%cd%\%MAIN_VENV%\Scripts\python.exe"
echo [4/7] Upgrading pip tooling ...
call "%PYTHON_BIN%" -m pip install --upgrade "pip<26" "setuptools<81" wheel
if errorlevel 1 goto :fail

echo [5/7] Installing torch stack first (reduces resolver complexity) ...
call "%PYTHON_BIN%" -m pip uninstall -y torch torchaudio torchvision torchcodec >nul 2>&1
call "%PYTHON_BIN%" -m pip install --upgrade --force-reinstall --prefer-binary --index-url https://download.pytorch.org/whl/cu128 "torch==2.10.0" "torchaudio==2.10.0"
if errorlevel 1 (
  echo [ERROR] torch / torchaudio CUDA install failed.
  echo [ERROR] Verify NVIDIA driver and CUDA wheel availability for this machine.
  goto :fail
)

echo [6/8] Installing runtime dependencies in stages ...
call "%PYTHON_BIN%" -m pip uninstall -y av imageio-ffmpeg >nul 2>&1
call "%PYTHON_BIN%" -m pip install --prefer-binary --no-deps faster-whisper==1.2.1
if errorlevel 1 goto :fail
set "REQ_TMP=%TEMP%\lott-requirements-runtime-no-fw-%RANDOM%.txt"
findstr /V /B /C:"faster-whisper" python_sidecar\requirements-runtime.txt > "%REQ_TMP%"
if errorlevel 1 goto :fail
call "%PYTHON_BIN%" -m pip install --prefer-binary --only-binary=contourpy -r "%REQ_TMP%"
if errorlevel 1 goto :fail
del "%REQ_TMP%" >nul 2>&1

echo [7/8] llama-cpp-python (CUDA source build for LLM proofreading) ...
echo       This may take 10-20 minutes.
set "CMAKE_ARGS=-DGGML_CUDA=on"
call "%PYTHON_BIN%" -m pip install llama-cpp-python --no-cache-dir
set "CMAKE_ARGS="
call "%PYTHON_BIN%" -c "import llama_cpp; ok=llama_cpp.llama_supports_gpu_offload(); print('llama_cpp GPU:', ok)"
if errorlevel 1 (
  echo [WARN] llama-cpp-python install failed. LLM proofreading will be unavailable.
)

echo [8/9] Downloading Gemma4 E4B GGUF model (for LLM proofreading)...
set "GEMMA_DIR=%cd%\python_sidecar\models\llm\gemma-4-e4b-it"
set "GEMMA_FILE=%GEMMA_DIR%\gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf"
set "GEMMA_MTP_FILE=%GEMMA_DIR%\mtp-gemma-4-E4B-it.gguf"
if exist "%GEMMA_FILE%" (
  echo [INFO] Model already exists: %GEMMA_FILE%
) else (
  echo [INFO] Downloading gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf, about 4.3GB
  if not exist "%GEMMA_DIR%" mkdir "%GEMMA_DIR%"
  call "%PYTHON_BIN%" -c "from huggingface_hub import hf_hub_download; hf_hub_download('unsloth/gemma-4-E4B-it-qat-GGUF', 'gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf', local_dir=r'%GEMMA_DIR%')"
  if errorlevel 1 (
    echo [WARN] Model download failed. Download it manually later:
    echo        https://huggingface.co/unsloth/gemma-4-E4B-it-qat-GGUF
    echo        Save to: %GEMMA_FILE%
  ) else (
    echo [OK] Model downloaded: %GEMMA_FILE%
  )
)
if exist "%GEMMA_MTP_FILE%" (
  echo [INFO] MTP model already exists: %GEMMA_MTP_FILE%
) else (
  echo [INFO] Downloading mtp-gemma-4-E4B-it.gguf, about 60MB
  if not exist "%GEMMA_DIR%" mkdir "%GEMMA_DIR%"
  call "%PYTHON_BIN%" -c "from huggingface_hub import hf_hub_download; hf_hub_download('unsloth/gemma-4-E4B-it-qat-GGUF', 'mtp-gemma-4-E4B-it.gguf', local_dir=r'%GEMMA_DIR%')"
  if errorlevel 1 (
    echo [WARN] MTP model download failed. Download it manually later:
    echo        https://huggingface.co/unsloth/gemma-4-E4B-it-qat-GGUF
    echo        Save to: %GEMMA_MTP_FILE%
  ) else (
    echo [OK] MTP model downloaded: %GEMMA_MTP_FILE%
  )
)

echo [Lemonade] Checking NPU/GPU LLM backend (optional)...
set "LEMONADE_BIN="
where lemonade-server >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%i in ('where lemonade-server') do set "LEMONADE_BIN=%%i"
  goto :lemonade_rebuild_done
)
where lemonade >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%i in ('where lemonade') do set "LEMONADE_BIN=%%i"
  goto :lemonade_rebuild_done
)
if exist "C:\Program Files\Lemonade\lemonade-server.exe" (
  set "LEMONADE_BIN=C:\Program Files\Lemonade\lemonade-server.exe"
  goto :lemonade_rebuild_done
)
:lemonade_rebuild_done
if defined LEMONADE_BIN (
  echo [OK] Lemonade: %LEMONADE_BIN%
) else (
  echo [INFO] Lemonade not found. llama_cpp backend is still available.
  echo        Install Lemonade: winget install lemonade-sdk.lemonade
)

echo [9/9] Validating runtime imports ...
call "%PYTHON_BIN%" -c "import python_sidecar.transcribe_cli as t; t.install_pyav_import_stub(); import faster_whisper, torch, torchaudio; print('torch=', torch.__version__); print('torchaudio=', torchaudio.__version__); print('cuda=', torch.cuda.is_available())"
if errorlevel 1 goto :fail

echo.
echo Completed.
echo Runtime python: %PYTHON_BIN%
echo Recommended env pins:
echo   setx PYTHON_BIN "%PYTHON_BIN%"
echo   setx DIARIZATION_PYTHON_BIN "%PYTHON_BIN%"
goto :done_success

:fail
echo.
echo [ERROR] rebuild-runtime-venv failed.
goto :done_error

:done_success
if "%HOLD_ON_EXIT%"=="1" goto :hold_success
exit /b 0

:done_error
if "%HOLD_ON_EXIT%"=="1" goto :hold_error
exit /b 1

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
