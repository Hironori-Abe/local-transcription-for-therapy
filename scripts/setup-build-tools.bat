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

REM Full edition (Vulkan: NVIDIA / AMD / Intel, CPU without a GPU) uses src-tauri\tauri.conf.json as is.
set "BUILD_CONFIG="
set "BUILD_LINE=Full (Vulkan)"
set "BUILD_VARIANT=full"
set "BUILD_OPTION="
set "DRY_RUN=0"

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
REM --vulkan is the former name of the Full edition. Keep accepting it.
if /I "%~1"=="--vulkan" (
  if defined BUILD_OPTION goto duplicate_variant
  set "BUILD_OPTION=--vulkan"
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

set "CONFIG_ARGS="
if defined BUILD_CONFIG set "CONFIG_ARGS=--config %BUILD_CONFIG%"

echo === Build NSIS Installer: %BUILD_LINE% ===
if defined BUILD_CONFIG (
  echo [INFO] Tauri override: %BUILD_CONFIG%
  if not exist "%BUILD_CONFIG%" (
    echo [ERROR] Tauri override was not found: %BUILD_CONFIG%
    goto :hold_error
  )
) else (
  echo [INFO] Tauri config: src-tauri\tauri.conf.json
)
echo [INFO] Release variant: %BUILD_VARIANT%
if "%DRY_RUN%"=="1" (
  echo [DRY-RUN] cargo tauri build --bundles nsis %CONFIG_ARGS%
  echo [DRY-RUN] collect_release_artifacts.py --platform windows --variant %BUILD_VARIANT%
  goto :hold_success
)
echo.
if /I "%BUILD_VARIANT%"=="editor" goto :describe_editor
echo Included in installer:
echo   - App executable (lott.exe)
echo   - whisper.cpp / NeMo-Speech.cpp Vulkan builds (resources/speech-engines/)
echo   - LGPL FFmpeg CLI (resources/ffmpeg/)
echo   - Third-party license texts (licenses/)
echo.
echo Not included (downloaded after install via setup UI, no token required):
echo   - Whisper large-v3-turbo ggml model + Silero VAD
echo   - Nemotron-3-Diarization model
echo.
goto :after_describe

:describe_editor
echo Included in installer:
echo   - Editor executable (lott.exe)
echo   - whisper.cpp Vulkan engine only (resources/speech-engines/whisper/)
echo   - whisper.cpp / ggml license and build information
echo   - Third-party license texts (licenses/)
echo.
echo Not included (downloaded after install via the settings UI):
echo   - Whisper large-v3-turbo model + Silero VAD (about 1.6 GB)
echo   - NeMo-Speech.cpp / Nemotron and FFmpeg
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

:: --- Speech engines / build-only Python ---
:: Python はアプリに同梱しない。下の ffmpeg 取得・ライセンス収集・成果物整理だけに使う
:: （prepare-vulkan-bundle-windows.ps1 の $BuildPythonDir と同じパス）
if /I "%BUILD_VARIANT%"=="editor" goto :prepare_editor_whisper_bundle
echo [INFO] Preparing speech engines (whisper.cpp / NeMo-Speech.cpp, build-only Python)...
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prepare-vulkan-bundle-windows.ps1
if errorlevel 1 (
  echo [ERROR] Failed to prepare the speech engines.
  goto :hold_error
)
goto :after_engine_bundle

:prepare_editor_whisper_bundle
echo [INFO] Preparing Editor bundle (whisper.cpp Vulkan engine, build-only Python)...
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prepare-vulkan-bundle-windows.ps1 -WhisperOnly
if errorlevel 1 (
  echo [ERROR] Failed to prepare the Editor whisper bundle.
  goto :hold_error
)

:after_engine_bundle
set "PYTHON312_DEST=%LOCALAPPDATA%\lott-ggml-speech-build\python-3.12.10-build"
if not exist "%PYTHON312_DEST%\python.exe" (
  echo [ERROR] Build-only Python was not found: %PYTHON312_DEST%\python.exe
  goto :hold_error
)
echo.

:: --- Download LGPL FFmpeg CLI ---
if /I "%BUILD_VARIANT%"=="editor" goto :after_ffmpeg_prepare
echo [INFO] Ensuring LGPL FFmpeg CLI...
"%PYTHON312_DEST%\python.exe" scripts\setup_ffmpeg_lgpl.py --platform windows --variant lgpl
if errorlevel 1 (
  echo [ERROR] Failed to prepare LGPL FFmpeg.
  goto :hold_error
)
:after_ffmpeg_prepare
echo.

:: --- Collect third-party license texts ---
:: Python パッケージは同梱しないので、Rust / Node と手動補完だけを集める
echo [INFO] Collecting third-party license texts...
"%PYTHON312_DEST%\python.exe" scripts\collect_licenses.py --no-python --frontend frontend --tauri src-tauri --out licenses
if errorlevel 1 (
  echo [ERROR] Failed to collect third-party license texts.
  goto :hold_error
)
echo [OK] Updated licenses\THIRD_PARTY_FULL.txt
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
cargo tauri build --bundles nsis %CONFIG_ARGS%
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
goto :hold_success

:duplicate_variant
echo [ERROR] Specify only one build line: (default) or --editor.
goto :show_help

:unknown_option
echo [ERROR] Unknown option: %~1
goto :show_help

:show_help
echo Usage: scripts\setup-build-tools.bat [--editor] [--dry-run] [--no-hold] [--trace]
echo.
echo   (default)  Build the Full installer (Vulkan: NVIDIA / AMD / Intel, CPU without a GPU).
echo   --editor   Build the lightweight Editor installer.
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
