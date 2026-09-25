@echo off
chcp 65001 > nul
setlocal EnableExtensions
set "HAS_WARN=0"
set "HOLD_ON_EXIT=1"

REM Capture the project root before parsing options.  The parser uses SHIFT,
REM which changes %0; resolving %~dp0 after that point can otherwise move the
REM build into the caller's parent directory when options are supplied.
for %%I in ("%~dp0..") do set "PROJECT_ROOT=%%~fI"

if /I "%~1"=="--no-hold" set "HOLD_ON_EXIT=0"
if /I "%~2"=="--trace" echo on

set "BUILD_CONFIG=tauri.nvidia.windows.override.json"
set "BUILD_LINE=NVIDIA CUDA"
set "BUILD_VARIANT=nvidia"
set "BUILD_OPTION="
set "CARGO_FEATURES="
set "DRY_RUN=0"

REM Keep the historical no-argument invocation on the NVIDIA line, while
REM allowing the other Windows installers to use the same explicit variant
REM model as setup-build-tools-linux.sh.
:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--no-hold" (
  set "HOLD_ON_EXIT=0"
  shift
  goto parse_args
)
if /I "%~1"=="--trace" (
  echo on
  shift
  goto parse_args
)
if /I "%~1"=="--dry-run" (
  set "DRY_RUN=1"
  shift
  goto parse_args
)
if /I "%~1"=="--amd" (
  if defined BUILD_OPTION goto duplicate_variant
  set "BUILD_OPTION=--amd"
  set "BUILD_LINE=AMD ROCm"
  set "BUILD_CONFIG=tauri.amd.windows.override.json"
  set "BUILD_VARIANT=amd"
  shift
  goto parse_args
)
if /I "%~1"=="--cpu" (
  if defined BUILD_OPTION goto duplicate_variant
  set "BUILD_OPTION=--cpu"
  set "BUILD_LINE=CPU"
  set "BUILD_CONFIG=tauri.cpu.windows.override.json"
  set "BUILD_VARIANT=cpu"
  shift
  goto parse_args
)
if /I "%~1"=="--vulkan" (
  if defined BUILD_OPTION goto duplicate_variant
  set "BUILD_OPTION=--vulkan"
  set "BUILD_LINE=Vulkan (NVIDIA / AMD / Intel)"
  set "BUILD_CONFIG=tauri.vulkan.windows.override.json"
  set "BUILD_VARIANT=vulkan"
  set "CARGO_FEATURES=--features vulkan"
  shift
  goto parse_args
)
if /I "%~1"=="--editor" (
  if defined BUILD_OPTION goto duplicate_variant
  set "BUILD_OPTION=--editor"
  set "BUILD_LINE=Editor"
  set "BUILD_CONFIG=tauri.editor.windows.override.json"
  set "BUILD_VARIANT=editor"
  shift
  goto parse_args
)
goto unknown_option

:args_done

cd /d "%PROJECT_ROOT%"

echo === Build NSIS Installer: %BUILD_LINE% (venv excluded) ===
echo [INFO] Tauri override: %BUILD_CONFIG%
echo [INFO] Release variant: %BUILD_VARIANT%
if not exist "%BUILD_CONFIG%" (
  echo [ERROR] Tauri override was not found: %BUILD_CONFIG%
  goto :hold_error
)
if "%DRY_RUN%"=="1" (
  echo [DRY-RUN] cargo tauri build --bundles nsis --config %BUILD_CONFIG% %CARGO_FEATURES%
  echo [DRY-RUN] collect_release_artifacts.py --platform windows --variant %BUILD_VARIANT%
  goto :hold_success
)
echo.
if /I "%BUILD_VARIANT%"=="vulkan" goto :describe_vulkan
echo Included in installer:
echo   - App executable (lott.exe)
echo   - Python 3.12 Embeddable runtime (resources/python312/)
echo   - Python scripts (transcribe_cli.py, diarize_cli.py, prompt_templates)
echo   - LGPL FFmpeg CLI (resources/ffmpeg/)
echo   - Third-party license texts (licenses/)
if /I "%BUILD_VARIANT%"=="nvidia" echo   - llama-server + CUDA DLLs (AI proofreading engine, launched directly)
echo.
echo Not included (downloaded after install via setup UI):
echo   - Python packages (faster-whisper, pyannote, torch, etc.)
echo   - Whisper turbo model
if /I not "%BUILD_VARIANT%"=="editor" echo   - Gemma 4 E4B GGUF model (Full editions; optional for CPU)
echo   - Diarization model (pyannote community-1)
echo.
goto :after_describe

:describe_vulkan
echo Included in installer:
echo   - App executable (lott.exe, built with --features vulkan)
echo   - whisper.cpp / NeMo-Speech.cpp Vulkan builds (resources/speech-engines/)
echo   - llama.cpp llama-server Vulkan build (resources/llama-server-vulkan/)
echo   - Minimal Python 3.12 for proofreading / encrypted export (resources/python312-vulkan/)
echo   - LGPL FFmpeg CLI (resources/ffmpeg/)
echo   - Third-party license texts (licenses/)
echo.
echo Not included (downloaded after install via setup UI, no token required):
echo   - Whisper large-v3-turbo ggml model + Silero VAD
echo   - Nemotron-3-Diarization model
echo   - Gemma 4 E4B GGUF model + MTP draft
echo.

:after_describe

:: --- cargo check ---
where cargo >nul 2>&1
if errorlevel 1 (
  echo [ERROR] cargo was not found.
  echo         Install Rustup first:
  echo           winget install Rustlang.Rustup
  goto :hold_error
)
for /f "delims=" %%i in ('cargo --version') do echo [OK] %%i

:: --- tauri-cli check / install ---
cargo tauri -V >nul 2>&1
if errorlevel 1 (
  echo [INFO] tauri-cli is missing. Installing now...
  cargo install tauri-cli --locked
  if errorlevel 1 (
    echo [ERROR] Failed to install tauri-cli.
    goto :hold_error
  )
)
for /f "delims=" %%i in ('cargo tauri -V') do echo [OK] %%i
echo.

:: --- Vulkan: engines / llama-server / minimal Python ---
if /I not "%BUILD_VARIANT%"=="vulkan" goto :after_vulkan_bundle
echo [INFO] Preparing Vulkan bundle (engines, llama-server, minimal Python)...
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prepare-vulkan-bundle-windows.ps1
if errorlevel 1 (
  echo [ERROR] Failed to prepare the Vulkan bundle.
  goto :hold_error
)
set "PYTHON312_DEST=src-tauri\resources\python312-vulkan"
goto :after_get_pip_vulkan

:after_vulkan_bundle

:: --- Download Python 3.12 Embeddable ---
set "PYTHON_VERSION=3.12.10"
set "PYTHON_EMBED_URL=https://www.python.org/ftp/python/%PYTHON_VERSION%/python-%PYTHON_VERSION%-embed-amd64.zip"
set "PYTHON312_DEST=src-tauri\resources\python312"
set "PYTHON312_TMP=%TEMP%\python312-embed"
set "GET_PIP_URL=https://bootstrap.pypa.io/get-pip.py"

if exist "%PYTHON312_DEST%\python.exe" (
  echo [INFO] Python Embeddable already exists: %PYTHON312_DEST%\python.exe
  goto :after_python_embed
)

echo [INFO] Downloading Python %PYTHON_VERSION% Embeddable...
if not exist "%PYTHON312_DEST%" mkdir "%PYTHON312_DEST%"
if exist "%PYTHON312_TMP%.zip" del /q "%PYTHON312_TMP%.zip" >nul 2>&1

powershell -NoProfile -NonInteractive -Command "try { Invoke-WebRequest -Uri '%PYTHON_EMBED_URL%' -OutFile '%PYTHON312_TMP%.zip' -UseBasicParsing; Expand-Archive -Path '%PYTHON312_TMP%.zip' -DestinationPath '%PYTHON312_DEST%' -Force; Write-Host 'OK' } catch { Write-Host ('FAIL: ' + $_.Exception.Message); exit 1 }" > "%TEMP%\python312_dl_result.tmp" 2>&1

if errorlevel 1 (
  if exist "%TEMP%\python312_dl_result.tmp" type "%TEMP%\python312_dl_result.tmp"
  echo [ERROR] Failed to download Python Embeddable.
  if exist "%TEMP%\python312_dl_result.tmp" del /q "%TEMP%\python312_dl_result.tmp" >nul 2>&1
  goto :hold_error
)
if exist "%TEMP%\python312_dl_result.tmp" del /q "%TEMP%\python312_dl_result.tmp" >nul 2>&1
if exist "%PYTHON312_TMP%.zip" del /q "%PYTHON312_TMP%.zip" >nul 2>&1
echo [OK] Extracted Python Embeddable to: %PYTHON312_DEST%

:: enable import site in _pth so that site-packages is usable
if not exist "%PYTHON312_DEST%\python312._pth" goto :python_pth_missing_after_download
call :normalize_python_pth "%PYTHON312_DEST%\python312._pth"
if errorlevel 1 (
  echo [ERROR] Failed to update python312._pth.
  goto :hold_error
)
echo [OK] Enabled site-packages in python312._pth
goto :python_pth_done_after_download

:python_pth_missing_after_download
echo [WARN] python312._pth not found. site-packages may not be available.
set "HAS_WARN=1"

:python_pth_done_after_download

:after_python_embed

REM Normalize python312._pth even when Python Embeddable already existed.
REM A UTF-8 BOM at the beginning makes isolated Python look for "python312.zip",
REM then startup fails before encodings can be imported.
if not exist "%PYTHON312_DEST%\python312._pth" goto :python_pth_missing_existing
call :normalize_python_pth "%PYTHON312_DEST%\python312._pth"
if errorlevel 1 (
  echo [ERROR] Failed to normalize python312._pth.
  goto :hold_error
)
echo [OK] Normalized python312._pth (UTF-8 without BOM)
goto :python_pth_done_existing

:python_pth_missing_existing
echo [WARN] python312._pth not found. site-packages may not be available.
set "HAS_WARN=1"

:python_pth_done_existing

:: get-pip.py download
if exist "%PYTHON312_DEST%\get-pip.py" (
  echo [INFO] get-pip.py already exists.
  goto :after_get_pip
)

echo [INFO] Downloading get-pip.py...
powershell -NoProfile -NonInteractive -Command "try { Invoke-WebRequest -Uri '%GET_PIP_URL%' -OutFile '%PYTHON312_DEST%\get-pip.py' -UseBasicParsing; Write-Host 'OK' } catch { Write-Host ('FAIL: ' + $_.Exception.Message); exit 1 }" > "%TEMP%\getpip_dl_result.tmp" 2>&1

if errorlevel 1 (
  if exist "%TEMP%\getpip_dl_result.tmp" type "%TEMP%\getpip_dl_result.tmp"
  echo [WARN] Failed to download get-pip.py. Python package setup may fail.
  set "HAS_WARN=1"
) else (
  echo [OK] Downloaded get-pip.py
)
if exist "%TEMP%\getpip_dl_result.tmp" del /q "%TEMP%\getpip_dl_result.tmp" >nul 2>&1

:after_get_pip
if exist "%PYTHON312_DEST%\get-pip.py" (
  echo [INFO] Ensuring resumable pip version 25.2 or newer and below 26...
  "%PYTHON312_DEST%\python.exe" "%PYTHON312_DEST%\get-pip.py" --no-warn-script-location "pip>=25.2,<26"
  if errorlevel 1 (
    echo [ERROR] Failed to install the resumable pip build.
    goto :hold_error
  )
  echo [OK] Resumable pip is ready.
)

:after_get_pip_vulkan
echo.

:: --- LLM runtime: direct llama-server launch ---
:: NVIDIA版は同梱CUDA llama-server、AMD版は取得済みROCm/Vulkan llama-serverを直接起動する。

:: --- Download LGPL FFmpeg CLI ---
echo [INFO] Ensuring LGPL FFmpeg CLI...
"%PYTHON312_DEST%\python.exe" scripts\setup_ffmpeg_lgpl.py --platform windows --variant lgpl
if errorlevel 1 (
  echo [ERROR] Failed to prepare LGPL FFmpeg.
  goto :hold_error
)
echo.

:: --- Collect third-party license texts ---
echo [INFO] Collecting third-party license texts...
set "LICENSE_VENV=.venv312-nvidia"
if /I "%BUILD_VARIANT%"=="amd" set "LICENSE_VENV=.venv312-amd"
if /I "%BUILD_VARIANT%"=="cpu" set "LICENSE_VENV=.venv312-cpu"
if /I "%BUILD_VARIANT%"=="editor" set "LICENSE_VENV=.venv312-cpu"
if /I "%BUILD_VARIANT%"=="vulkan" set "LICENSE_VENV=src-tauri\resources\python312-vulkan"
if exist "%LICENSE_VENV%\Lib\site-packages" (
  "%PYTHON312_DEST%\python.exe" scripts\collect_licenses.py --venv "%LICENSE_VENV%" --frontend frontend --tauri src-tauri --out licenses
  if errorlevel 1 (
    echo [ERROR] Failed to collect third-party license texts.
    goto :hold_error
  )
  echo [OK] Updated licenses\THIRD_PARTY_FULL.txt
) else (
  echo [WARN] %LICENSE_VENV%\Lib\site-packages was not found. Skipping Python dependency license refresh.
  echo [WARN] Run scripts\collect_licenses.py with the distribution-equivalent Python environment before release.
  set "HAS_WARN=1"
)
if not exist "licenses\THIRD_PARTY_FULL.txt" (
  echo [WARN] licenses\THIRD_PARTY_FULL.txt is missing. License resources will be incomplete.
  set "HAS_WARN=1"
)
echo.

:: --- Build NSIS installer ---
set "TAURI_RELEASE_UP=src-tauri\target\release\_up_"
if exist "%TAURI_RELEASE_UP%" (
  echo [INFO] Removing stale Tauri resource staging: %TAURI_RELEASE_UP%
  rmdir /S /Q "%TAURI_RELEASE_UP%"
  if exist "%TAURI_RELEASE_UP%" (
    echo [ERROR] Failed to remove stale Tauri resource staging.
    goto :hold_error
  )
)

echo [INFO] Building %BUILD_LINE% installer (frontend build is included)...
echo [INFO] This may take several minutes.
echo.
cargo tauri build --bundles nsis --config "%BUILD_CONFIG%" %CARGO_FEATURES%
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed.
  goto :hold_error
)

echo.
if "%HAS_WARN%"=="1" (
  echo [WARN] Build completed with warnings.
) else (
  echo [OK] Build completed.
)
echo [INFO] Collecting release artifacts under the release naming convention...
"%PYTHON312_DEST%\python.exe" scripts\collect_release_artifacts.py --platform windows --variant "%BUILD_VARIANT%" --source-dir "src-tauri\target\release\bundle\nsis"
if errorlevel 1 (
  echo [ERROR] Failed to collect release artifacts.
  goto :hold_error
)
echo [OK] Release artifacts and SHA256SUMS.txt were collected under the output path listed above.
echo.
if /I not "%BUILD_VARIANT%"=="vulkan" echo [INFO] Python packages are installed via the app's setup UI after first launch.
goto :hold_success

:normalize_python_pth
powershell -NoProfile -NonInteractive -Command "$path = '%~1'; $lines = [System.IO.File]::ReadAllLines($path) -replace '^#import site$', 'import site'; $utf8NoBom = [System.Text.UTF8Encoding]::new($false); [System.IO.File]::WriteAllLines($path, $lines, $utf8NoBom)"
exit /b %ERRORLEVEL%

:duplicate_variant
echo [ERROR] Specify only one Windows build line: --vulkan, --amd, --cpu, or --editor.
goto :show_help

:unknown_option
echo [ERROR] Unknown option: %~1
goto :show_help

:show_help
echo Usage: scripts\setup-build-tools.bat [--vulkan ^| --amd ^| --cpu ^| --editor] [--dry-run] [--no-hold] [--trace]
echo.
echo   (default)  Build the NVIDIA CUDA NSIS installer.
echo   --vulkan   Build the Vulkan installer (NVIDIA / AMD / Intel, ggml speech engines).
echo   --amd      Build the AMD ROCm Windows installer.
echo   --cpu      Build the CPU Windows installer.
echo   --editor   Build the lightweight Editor Windows installer.
echo   --dry-run   Print the selected config and release variant without building.
echo   --no-hold   Return immediately instead of waiting for Q after completion.
echo   --trace     Enable cmd.exe command tracing.
exit /b 2

:hold_error
if "%HOLD_ON_EXIT%"=="0" exit /b 1
echo.
echo Window is held because an error occurred.
echo Type Q and press Enter to close.
goto :hold_loop

:hold_success
if "%HOLD_ON_EXIT%"=="0" exit /b 0
echo.
echo Window is held for log review.
echo Type Q and press Enter to close.
goto :hold_loop

:hold_loop
set "_HOLD_INPUT="
set /p "_HOLD_INPUT=> "
if /I "%_HOLD_INPUT%"=="Q" exit /b 0
goto :hold_loop
