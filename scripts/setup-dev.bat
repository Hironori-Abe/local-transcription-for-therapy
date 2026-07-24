@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "HAS_WARN=0"
set "PYTHON_BIN=py"
set "PYTHON_BOOTSTRAP=py"
set "PYTHON_BOOTSTRAP_ARGS=-3.12"
set "ASSUME_YES=0"

REM GPU backend: cuda (default, stable) / rocm (experimental) / cpu
set "TORCH_BACKEND=%LOTT_TORCH_BACKEND%"
REM Windows AMD defaults: ROCm 7.14 multi-arch wheels for Radeon 780M (gfx1103).
REM These variables are consumed only by the isolated AMD/ROCm branch.
if not defined LOTT_PYTORCH_ROCM_INDEX_URL set "LOTT_PYTORCH_ROCM_INDEX_URL=https://repo.amd.com/rocm/whl-multi-arch/"
if not defined LOTT_ROCM_GFX_TARGET set "LOTT_ROCM_GFX_TARGET=gfx1103"

cd /d "%~dp0\.."

REM ---- Parse arguments ----
:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--torch-backend" (
  set "TORCH_BACKEND=%~2"
  shift
  shift
  goto parse_args
)
if /I "%~1"=="--cpu-torch" (
  set "TORCH_BACKEND=cpu"
  shift
  goto parse_args
)
if /I "%~1"=="--amd" (
  set "TORCH_BACKEND=rocm"
  shift
  goto parse_args
)
if /I "%~1"=="-y" (
  set "ASSUME_YES=1"
  shift
  goto parse_args
)
if /I "%~1"=="--yes" (
  set "ASSUME_YES=1"
  shift
  goto parse_args
)
if /I "%~1"=="-h" goto show_help
if /I "%~1"=="--help" goto show_help
echo [ERROR] Unknown option: %~1
goto show_help
:args_done

echo === Local Transcription for Therapy: Safe Development Setup ===
echo This script uses cmd.exe only.
echo.

REM ---- GPU backend selection ----
if not defined TORCH_BACKEND (
  if "%ASSUME_YES%"=="1" (
    set "TORCH_BACKEND=cuda"
  ) else (
    echo Select GPU backend:
    echo   1^) cuda   NVIDIA CUDA ^(default, stable^)
    echo   2^) rocm   AMD ROCm ^(EXPERIMENTAL / unverified on Windows^)
    echo   3^) cpu    CPU only
    echo.
    set "_BACKEND_CHOICE="
    set /p "_BACKEND_CHOICE=Choice [1-3] (default: 1 cuda) > "
    if "!_BACKEND_CHOICE!"=="2" set "TORCH_BACKEND=rocm"
    if /I "!_BACKEND_CHOICE!"=="rocm" set "TORCH_BACKEND=rocm"
    if "!_BACKEND_CHOICE!"=="3" set "TORCH_BACKEND=cpu"
    if /I "!_BACKEND_CHOICE!"=="cpu" set "TORCH_BACKEND=cpu"
  )
)
if not defined TORCH_BACKEND set "TORCH_BACKEND=cuda"
REM Normalize to lowercase canonical values
if /I "%TORCH_BACKEND%"=="cuda" set "TORCH_BACKEND=cuda"
if /I "%TORCH_BACKEND%"=="rocm" set "TORCH_BACKEND=rocm"
if /I "%TORCH_BACKEND%"=="cpu" set "TORCH_BACKEND=cpu"
if /I not "%TORCH_BACKEND%"=="cuda" if /I not "%TORCH_BACKEND%"=="rocm" if /I not "%TORCH_BACKEND%"=="cpu" (
  echo [ERROR] Invalid GPU backend: %TORCH_BACKEND%. Use cuda, rocm, or cpu.
  goto :hold_error
)

REM Keep the experimental AMD/ROCm Python packages isolated from the stable
REM NVIDIA/CUDA development environment. An explicit override is available for
REM developers who keep their venvs outside the repository.
if defined LOTT_DEV_VENV_DIR (
  set "DEV_VENV_DIR=%LOTT_DEV_VENV_DIR%"
) else if /I "%TORCH_BACKEND%"=="rocm" (
  set "DEV_VENV_DIR=.venv312-amd"
) else (
  set "DEV_VENV_DIR=.venv312"
)
for %%I in ("!DEV_VENV_DIR!") do set "DEV_VENV_DIR_ABS=%%~fI"

REM Some development PCs no longer have Python 3.12 registered in py.exe even
REM though the existing NVIDIA venv still uses it. For AMD setup, that Python
REM executable may safely create a new empty venv; installed CUDA packages are
REM not copied into the new environment.
if /I "%TORCH_BACKEND%"=="rocm" if exist "%cd%\.venv312\Scripts\python.exe" (
  set "PYTHON_BOOTSTRAP=%cd%\.venv312\Scripts\python.exe"
  set "PYTHON_BOOTSTRAP_ARGS="
)

echo [INFO] GPU backend: %TORCH_BACKEND%
echo [INFO] Python venv: !DEV_VENV_DIR_ABS!
if /I "%TORCH_BACKEND%"=="rocm" (
  echo [WARN] ROCm backend is EXPERIMENTAL on Windows.
  echo        ROCm 7.14 / %LOTT_ROCM_GFX_TARGET% packages will be installed only into:
  echo        !DEV_VENV_DIR_ABS!
  set "HAS_WARN=1"
)
echo.

where npm >nul 2>&1 || (
  echo [ERROR] npm not found. Install Node.js: https://nodejs.org/
  goto :hold_error
)
where %PYTHON_BIN% >nul 2>&1 || (
  echo [ERROR] Python launcher "%PYTHON_BIN%" not found.
  echo         Install Python for Windows: https://www.python.org/downloads/windows/
  goto :hold_error
)

if exist "%DEV_VENV_DIR_ABS%\Scripts\python.exe" (
  set "PYTHON_BIN=%DEV_VENV_DIR_ABS%\Scripts\python.exe"
  echo [INFO] Using existing Python 3.12 venv: !PYTHON_BIN!
) else (
  call "%PYTHON_BOOTSTRAP%" %PYTHON_BOOTSTRAP_ARGS% -c "import sys; print(sys.version)" >nul 2>&1
  if errorlevel 1 (
    echo [WARN] Python 3.12 was not found.
    echo        Speaker diarization is most stable on Python 3.12.
    echo        Install example: winget install Python.Python.3.12
    echo        Fallback to current launcher: %PYTHON_BIN%
    set "HAS_WARN=1"
  ) else (
    echo [INFO] Creating !DEV_VENV_DIR_ABS! with Python 3.12...
    call "%PYTHON_BOOTSTRAP%" %PYTHON_BOOTSTRAP_ARGS% -m venv "%DEV_VENV_DIR_ABS%" || goto :fail
    set "PYTHON_BIN=%DEV_VENV_DIR_ABS%\Scripts\python.exe"
    echo [OK] Created venv: !PYTHON_BIN!
  )
)

echo [0/6] Python check...
for /f "delims=" %%i in ('%PYTHON_BIN% -c "import sys; print(sys.executable)"') do set "PY_EXE=%%i"
for /f "delims=" %%i in ('%PYTHON_BIN% -c "import sys; print('.'.join(map(str, sys.version_info[:3])))"') do set "PY_VER=%%i"
echo [INFO] Python executable: %PY_EXE%
echo [INFO] Python version   : %PY_VER%
echo %PY_VER% | findstr /b "3.14" >nul && (
  echo [WARN] Python 3.14 detected. Recommended: 3.12.x or 3.11.x
  set "HAS_WARN=1"
)
echo.

echo [1/6] npm install (root)...
call npm install || goto :fail

echo [2/6] npm install (frontend)...
call npm --prefix frontend install || goto :fail

echo [3/6] Python dependencies...
call %PYTHON_BIN% -m pip install --upgrade pip || goto :fail
call %PYTHON_BIN% -m pip uninstall -y torch torchaudio torchvision torchcodec >nul 2>&1
if /I "%TORCH_BACKEND%"=="cuda" goto :torch_cuda
if /I "%TORCH_BACKEND%"=="rocm" goto :torch_rocm
goto :torch_cpu

:torch_cuda
call %PYTHON_BIN% -m pip install --upgrade --force-reinstall --prefer-binary --index-url https://download.pytorch.org/whl/cu128 "torch==2.10.0" "torchaudio==2.10.0" || goto :fail
goto :torch_done

:torch_rocm
echo [WARN] Installing Windows ROCm 7.14 packages into the isolated AMD venv.
echo        Index: %LOTT_PYTORCH_ROCM_INDEX_URL%
echo        GFX target: %LOTT_ROCM_GFX_TARGET%
set "HAS_WARN=1"
call %PYTHON_BIN% python_sidecar\setup_venv_cli.py python_sidecar\requirements-amd.txt --variant rocm
if errorlevel 1 goto :fail
goto :python_modules_check

:torch_cpu
echo [WARN] Installing default CPU PyTorch wheels. The app default remains CUDA.
set "HAS_WARN=1"
call %PYTHON_BIN% -m pip install --upgrade --force-reinstall --prefer-binary "torch==2.10.0" "torchaudio==2.10.0" || goto :fail
goto :torch_done

:torch_done
call %PYTHON_BIN% -m pip uninstall -y av imageio-ffmpeg >nul 2>&1
call %PYTHON_BIN% -m pip install --prefer-binary --no-deps faster-whisper==1.2.1 || goto :fail
set "REQ_TMP=%TEMP%\lott-requirements-runtime-no-fw-%RANDOM%.txt"
findstr /V /B /C:"faster-whisper" python_sidecar\requirements-runtime.txt > "%REQ_TMP%" || goto :fail
call %PYTHON_BIN% -m pip install --prefer-binary --only-binary=contourpy -r "%REQ_TMP%" || goto :fail
del "%REQ_TMP%" >nul 2>&1
:python_modules_check
call %PYTHON_BIN% -c "import python_sidecar.transcribe_cli as t; t.install_pyav_import_stub(); import faster_whisper, ctranslate2, requests; print('python modules OK')" || (
  echo [ERROR] Python module import failed.
  echo         Retry: %PYTHON_BIN% -m pip install --no-deps faster-whisper==1.2.1
  goto :hold_error
)
echo.

echo [3a/6] Bundled LGPL ffmpeg (audio decoding)...
if exist "src-tauri\resources\ffmpeg\ffmpeg.exe" (
  echo [OK] ffmpeg already present: src-tauri\resources\ffmpeg\ffmpeg.exe
) else (
  echo [INFO] Downloading LGPL ffmpeg, about 170MB...
  call %PYTHON_BIN% scripts\setup_ffmpeg_lgpl.py
  if errorlevel 1 (
    echo [WARN] ffmpeg download failed. Transcription cannot run without it.
    echo        Retry manually: %PYTHON_BIN% scripts\setup_ffmpeg_lgpl.py
    set "HAS_WARN=1"
  ) else (
    echo [OK] ffmpeg placed: src-tauri\resources\ffmpeg\ffmpeg.exe
  )
)
echo.

echo [3b/6] Downloading Gemma4 E4B GGUF model (for LLM proofreading)...
set "GEMMA_DIR=python_sidecar\models\llm\gemma-4-e4b-it"
set "GEMMA_FILE=%GEMMA_DIR%\gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf"
set "GEMMA_MTP_FILE=%GEMMA_DIR%\mtp-gemma-4-E4B-it.gguf"
if exist "%GEMMA_FILE%" (
  echo [INFO] Model already exists: %GEMMA_FILE%
) else (
  echo [INFO] Downloading gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf, about 4.3GB
  if not exist "%GEMMA_DIR%" mkdir "%GEMMA_DIR%"
  call %PYTHON_BIN% -c "import os; from huggingface_hub import hf_hub_download; hf_hub_download('unsloth/gemma-4-E4B-it-qat-GGUF', 'gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf', local_dir=os.environ['GEMMA_DIR'])"
  if errorlevel 1 (
    echo [WARN] Model download failed. Download it manually later:
    echo        https://huggingface.co/unsloth/gemma-4-E4B-it-qat-GGUF
    echo        Save to: %GEMMA_FILE%
    set "HAS_WARN=1"
  ) else (
    echo [OK] Model downloaded: %GEMMA_FILE%
  )
)
if exist "%GEMMA_MTP_FILE%" (
  echo [INFO] MTP model already exists: %GEMMA_MTP_FILE%
) else (
  echo [INFO] Downloading mtp-gemma-4-E4B-it.gguf, about 60MB
  if not exist "%GEMMA_DIR%" mkdir "%GEMMA_DIR%"
  call %PYTHON_BIN% -c "import os; from huggingface_hub import hf_hub_download; hf_hub_download('unsloth/gemma-4-E4B-it-qat-GGUF', 'mtp-gemma-4-E4B-it.gguf', local_dir=os.environ['GEMMA_DIR'])"
  if errorlevel 1 (
    echo [WARN] MTP model download failed. Download it manually later:
    echo        https://huggingface.co/unsloth/gemma-4-E4B-it-qat-GGUF
    echo        Save to: %GEMMA_MTP_FILE%
    set "HAS_WARN=1"
  ) else (
    echo [OK] MTP model downloaded: %GEMMA_MTP_FILE%
  )
)
echo.

echo [3c/6] llama-server CUDA binary (for NVIDIA GPU LLM inference)...
if /I not "%TORCH_BACKEND%"=="cuda" (
  echo [INFO] Skipping llama-server CUDA download for %TORCH_BACKEND% backend.
  goto :llama_server_done
)
set "LLAMA_BUILD=b10075"
set "LLAMA_BUILD_NUMBER=10075"
set "LLAMA_CUDA_SHA256=acb782eb7d82b7aefaab4ea4f92f84793d11fdddacf888299ef3af9a63054744"
set "LLAMA_CUDART_SHA256=8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6"
set "LLAMA_CUDA_ZIP=llama-%LLAMA_BUILD%-bin-win-cuda-12.4-x64.zip"
set "LLAMA_CUDART_ZIP=cudart-llama-bin-win-cuda-12.4-x64.zip"
set "LLAMA_CUDA_URL=https://github.com/ggml-org/llama.cpp/releases/download/%LLAMA_BUILD%/%LLAMA_CUDA_ZIP%"
set "LLAMA_CUDART_URL=https://github.com/ggml-org/llama.cpp/releases/download/%LLAMA_BUILD%/%LLAMA_CUDART_ZIP%"
set "LLAMA_SERVER_DEST=src-tauri\resources\llama-server"
set "LLAMA_TMP=%TEMP%\llama-server-cuda"
if exist "%LLAMA_SERVER_DEST%\llama-server.exe" (
  "%LLAMA_SERVER_DEST%\llama-server.exe" --version 2^>^&1 ^| findstr /c:"version: %LLAMA_BUILD_NUMBER% " >nul
  if not errorlevel 1 if exist "%LLAMA_SERVER_DEST%\cudart64_12.dll" if exist "%LLAMA_SERVER_DEST%\cublas64_12.dll" if exist "%LLAMA_SERVER_DEST%\cublasLt64_12.dll" (
    echo [OK] llama-server CUDA %LLAMA_BUILD% already present: %LLAMA_SERVER_DEST%\llama-server.exe
    goto :llama_server_done
  )
  echo [INFO] Existing llama-server CUDA is outdated or incomplete; updating to %LLAMA_BUILD%.
)
where nvidia-smi >nul 2>&1
if errorlevel 1 (
  echo [INFO] nvidia-smi not found. Skipping llama-server CUDA download - NVIDIA GPU not detected.
  goto :llama_server_done
)
echo [INFO] Downloading llama-server CUDA v%LLAMA_BUILD% (cuda 12.4)...
if not exist "%LLAMA_SERVER_DEST%" mkdir "%LLAMA_SERVER_DEST%"
if exist "%LLAMA_TMP%" rmdir /s /q "%LLAMA_TMP%" >nul 2>&1
if exist "%LLAMA_TMP%.zip" del /q "%LLAMA_TMP%.zip" >nul 2>&1
powershell -NoProfile -NonInteractive -Command ^
  "try { Invoke-WebRequest -Uri '%LLAMA_CUDA_URL%' -OutFile '%LLAMA_TMP%.zip' -UseBasicParsing; if ((Get-FileHash -Algorithm SHA256 '%LLAMA_TMP%.zip').Hash -ne '%LLAMA_CUDA_SHA256%') { throw 'llama.cpp CUDA archive SHA256 mismatch' }; Expand-Archive -Path '%LLAMA_TMP%.zip' -DestinationPath '%LLAMA_TMP%' -Force; $files = Get-ChildItem -Path '%LLAMA_TMP%' -Recurse -File; foreach ($f in $files) { Copy-Item -Path $f.FullName -Destination '%LLAMA_SERVER_DEST%\' -Force }; Write-Host 'OK' } catch { Write-Host ('FAIL: ' + $_.Exception.Message); exit 1 }" ^
  > "%TEMP%\llama_dl_result.tmp" 2>&1
if errorlevel 1 (
  if exist "%TEMP%\llama_dl_result.tmp" type "%TEMP%\llama_dl_result.tmp"
  echo [WARN] llama-server CUDA download failed.
  echo        If you have an NVIDIA GPU, download manually and place it under %LLAMA_SERVER_DEST%\:
  echo        %LLAMA_CUDA_URL%
  set "HAS_WARN=1"
  goto :llama_server_done
) else (
  echo [OK] llama-server CUDA placed: %LLAMA_SERVER_DEST%
)
if exist "%LLAMA_TMP%" rmdir /s /q "%LLAMA_TMP%" >nul 2>&1
if exist "%LLAMA_TMP%.zip" del /q "%LLAMA_TMP%.zip" >nul 2>&1
if exist "%TEMP%\llama_dl_result.tmp" del /q "%TEMP%\llama_dl_result.tmp" >nul 2>&1
echo [INFO] Downloading CUDA runtime DLLs for llama-server...
if exist "%LLAMA_TMP%" rmdir /s /q "%LLAMA_TMP%" >nul 2>&1
if exist "%LLAMA_TMP%.zip" del /q "%LLAMA_TMP%.zip" >nul 2>&1
powershell -NoProfile -NonInteractive -Command ^
  "try { Invoke-WebRequest -Uri '%LLAMA_CUDART_URL%' -OutFile '%LLAMA_TMP%.zip' -UseBasicParsing; if ((Get-FileHash -Algorithm SHA256 '%LLAMA_TMP%.zip').Hash -ne '%LLAMA_CUDART_SHA256%') { throw 'llama.cpp CUDA runtime archive SHA256 mismatch' }; Expand-Archive -Path '%LLAMA_TMP%.zip' -DestinationPath '%LLAMA_TMP%' -Force; $files = Get-ChildItem -Path '%LLAMA_TMP%' -Recurse -File; foreach ($f in $files) { Copy-Item -Path $f.FullName -Destination '%LLAMA_SERVER_DEST%\' -Force }; Write-Host 'OK' } catch { Write-Host ('FAIL: ' + $_.Exception.Message); exit 1 }" ^
  > "%TEMP%\llama_dl_result.tmp" 2>&1
if errorlevel 1 (
  echo [WARN] CUDA runtime DLL download failed - optional, continuing.
) else (
  echo [OK] CUDA runtime DLLs placed: %LLAMA_SERVER_DEST%
)
if exist "%LLAMA_TMP%" rmdir /s /q "%LLAMA_TMP%" >nul 2>&1
if exist "%LLAMA_TMP%.zip" del /q "%LLAMA_TMP%.zip" >nul 2>&1
if exist "%TEMP%\llama_dl_result.tmp" del /q "%TEMP%\llama_dl_result.tmp" >nul 2>&1
:llama_server_done
echo.

echo [4/6] Rust/cargo...
where cargo >nul 2>&1
if errorlevel 1 (
  echo [WARN] cargo not found.
  echo        Install Rustup: winget install Rustlang.Rustup
  echo        Reopen terminal, then run:
  echo          cargo --version
  echo          rustup --version
  echo        If needed, add PATH: %%USERPROFILE%%\.cargo\bin
  echo        Install C++ Build Tools:
  echo          https://visualstudio.microsoft.com/visual-cpp-build-tools/
  set "HAS_WARN=1"
) else (
  for /f "delims=" %%i in ('cargo --version') do echo [OK] %%i
)
echo.

if /I not "%TORCH_BACKEND%"=="cuda" (
  echo [5/6] Skipping NVIDIA/CUDA visibility checks for %TORCH_BACKEND% backend.
  if /I "%TORCH_BACKEND%"=="rocm" (
    echo [INFO] For AMD ROCm on Windows, verify your ROCm/HIP runtime separately.
    where hipInfo >nul 2>&1 && (for /f "delims=" %%i in ('hipInfo 2^>nul ^| findstr /i "gcnArchName"') do echo [INFO] %%i)
  )
  echo.
  goto :after_cuda_checks
)

echo [5/6] NVIDIA / CUDA DLL visibility...
where nvidia-smi >nul 2>&1
if errorlevel 1 (
  echo [WARN] nvidia-smi not found. GPU mode requires NVIDIA driver.
  set "HAS_WARN=1"
) else (
  for /f "delims=" %%i in ('nvidia-smi -L') do echo [OK] GPU: %%i
)

where cublas64_12.dll >nul 2>&1
if errorlevel 1 (
  echo [WARN] cublas64_12.dll not found on PATH.
  echo        Add PATH: C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.9\bin
  set "HAS_WARN=1"
) else (
  for /f "delims=" %%i in ('where cublas64_12.dll') do (
    echo [OK] cublas64_12.dll: %%i
    goto :cuda_ok
  )
)
:cuda_ok

where cudnn64_9.dll >nul 2>&1
if errorlevel 1 (
  echo [WARN] cudnn64_9.dll not found on PATH.
  echo        Add PATH: C:\Program Files\NVIDIA\CUDNN\v9.20\bin\12.9\x64
  set "HAS_WARN=1"
) else (
  for /f "delims=" %%i in ('where cudnn64_9.dll') do (
    echo [OK] cudnn64_9.dll: %%i
    goto :cudnn_ok
  )
)
:cudnn_ok
echo.

echo [6/6] ctranslate2 CUDA runtime check...
call %PYTHON_BIN% -c "import sys,ctranslate2 as ct; n=ct.get_cuda_device_count(); print('CUDA device count:', n); sys.exit(0 if n > 0 else 2)"
if errorlevel 2 (
  echo [WARN] CUDA device count is 0.
  echo        Check CUDA/cuDNN install and PATH, then reopen terminal.
  set "HAS_WARN=1"
) else if errorlevel 1 (
  echo [WARN] ctranslate2 cannot use CUDA in this terminal.
  echo        Check DLL PATH and restart VS Code.
  set "HAS_WARN=1"
) else (
  echo [OK] CUDA is available for faster-whisper.
)
echo.
:after_cuda_checks

echo [Doctor] Environment summary...
echo [INFO] GPU backend: %TORCH_BACKEND%
call %PYTHON_BIN% -c "import sys; print('python_exe=', sys.executable); print('python_ver=', sys.version.split()[0])"
if errorlevel 1 (
  echo [WARN] Python runtime summary failed.
  set "HAS_WARN=1"
)
call %PYTHON_BIN% -c "import torch; print('torch=', torch.__version__)"
if errorlevel 1 (
  echo [WARN] torch is not available.
  set "HAS_WARN=1"
)
call %PYTHON_BIN% -c "import torchaudio; print('torchaudio=', torchaudio.__version__)"
if errorlevel 1 (
  echo [WARN] torchaudio is not available.
  set "HAS_WARN=1"
)
call %PYTHON_BIN% -c "import torch; print('torch_cuda_available=', torch.cuda.is_available()); print('torch_cuda_version=', torch.version.cuda); print('torch_cuda_device_count=', torch.cuda.device_count())"
if errorlevel 1 (
  echo [WARN] torch CUDA summary failed.
  set "HAS_WARN=1"
)
call %PYTHON_BIN% -c "import importlib.metadata as m; print('pyannote.audio=', m.version('pyannote.audio'))"
if errorlevel 1 (
  echo [WARN] pyannote.audio is not installed.
  echo        Run: %PYTHON_BIN% python_sidecar\setup_venv_cli.py python_sidecar\requirements-runtime.txt
  set "HAS_WARN=1"
)
if exist "python_sidecar\models\pyannote-speaker-diarization-community-1\config.yaml" (
  echo [OK] Local diarization model path exists:
  echo      python_sidecar\models\pyannote-speaker-diarization-community-1
) else (
  echo [INFO] Local diarization model path not found:
  echo       python_sidecar\models\pyannote-speaker-diarization-community-1
  echo [INFO] It will be downloaded when diarization setup is executed.
)
where nvidia-smi >nul 2>&1
if errorlevel 1 (
  echo [INFO] nvidia-smi not available.
) else (
  nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits > "%TEMP%\gpu_summary.tmp" 2>nul
  if errorlevel 1 (
    nvidia-smi -L > "%TEMP%\gpu_summary.tmp" 2>nul
  )
  for /f "usebackq delims=" %%i in ("%TEMP%\gpu_summary.tmp") do echo [GPU] %%i
  del /q "%TEMP%\gpu_summary.tmp" >nul 2>&1
)
call %PYTHON_BIN% -c "import ctranslate2 as ct; print('ct2_cuda_device_count=', ct.get_cuda_device_count())"
if errorlevel 1 (
  echo [WARN] ctranslate2 CUDA summary failed.
  set "HAS_WARN=1"
)
echo [INFO] LLM backend: llama.cpp llama-server direct launch ^(no Lemonade/lemond^).
where xrt-smi >nul 2>&1
if not errorlevel 1 (
  echo [INFO] AMD NPU xrt-smi status:
  xrt-smi examine
)
echo.

echo Setup completed.
if "%HAS_WARN%"=="1" (
  echo Completed with warnings.
) else (
  echo Completed without warnings.
)
echo [INFO] GPU backend: %TORCH_BACKEND%
echo [INFO] Runtime Python: %PYTHON_BIN%
echo [INFO] If needed for this terminal:
echo        set PYTHON_BIN=%PYTHON_BIN%
echo.
if /I "%TORCH_BACKEND%"=="rocm" (
  echo [INFO] AMD venv is isolated from the NVIDIA venv:
  echo        AMD:    %DEV_VENV_DIR_ABS%
  echo        NVIDIA: %cd%\.venv312
  echo Next: npm run tauri:dev:amd
) else (
  echo [INFO] To rebuild the venv from scratch:
  echo        scripts\rebuild-runtime-venv.bat
  echo Next: scripts\run-dev.bat
)
goto :hold_success

:show_help
echo Usage: scripts\setup-dev.bat [options]
echo.
echo Options:
echo   --torch-backend VALUE   GPU backend: cuda, rocm, or cpu. Default: cuda.
echo   --amd                   Shortcut for --torch-backend rocm (EXPERIMENTAL on Windows).
echo   --cpu-torch             Shortcut for --torch-backend cpu.
echo   -y, --yes               Non-interactive: use defaults.
echo   -h, --help              Show this help.
echo.
echo Environment:
echo   LOTT_TORCH_BACKEND            Same as --torch-backend.
echo   LOTT_PYTORCH_ROCM_INDEX_URL   PyTorch ROCm wheel index for --torch-backend rocm.
echo   LOTT_ROCM_GFX_TARGET           Windows ROCm target. Default: gfx1103 ^(Radeon 780M^).
echo   LOTT_DEV_VENV_DIR             Override the venv directory.
echo                                 Default: .venv312-amd for rocm, .venv312 otherwise.
goto :eof

:fail
echo.
echo [ERROR] Setup failed.
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
