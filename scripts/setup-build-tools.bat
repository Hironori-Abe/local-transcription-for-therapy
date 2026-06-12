@echo off
chcp 65001 > nul
setlocal EnableExtensions
set "HAS_WARN=0"
set "HOLD_ON_EXIT=1"
if /I "%~1"=="--no-hold" set "HOLD_ON_EXIT=0"
if /I "%~2"=="--trace" echo on

cd /d "%~dp0\.."

echo === Build NSIS Installer (venv excluded) ===
echo.
echo Included in installer:
echo   - App executable (offline-transcriber.exe)
echo   - Python 3.12 Embeddable runtime (resources/python312/)
echo   - Python scripts (transcribe_cli.py, diarize_cli.py, prompt_templates)
echo   - LGPL FFmpeg CLI (resources/ffmpeg/)
echo   - Third-party license texts (licenses/)
echo   - llama-server + CUDA DLLs (AI proofreading engine, launched directly)
echo.
echo Not included (downloaded after install via setup UI):
echo   - Python packages (faster-whisper, pyannote, torch, etc.)
echo   - Whisper turbo model
echo   - Gemma 4 E4B GGUF model
echo   - Diarization model (pyannote community-1)
echo.

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
echo.

:: --- Lemonade is NOT bundled in the NVIDIA build ---
:: NVIDIA 版は AI 校正に同梱 llama-server (CUDA) を直接起動するため Lemonade を同梱しない。
:: Lemonade を使うのは AMD 版のみ（別ビルドフロー）。

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
if exist ".venv312\Lib\site-packages" (
  "%PYTHON312_DEST%\python.exe" scripts\collect_licenses.py --venv .venv312 --frontend frontend --tauri src-tauri --out licenses
  if errorlevel 1 (
    echo [ERROR] Failed to collect third-party license texts.
    goto :hold_error
  )
  echo [OK] Updated licenses\THIRD_PARTY_FULL.txt
) else (
  echo [WARN] .venv312\Lib\site-packages was not found. Skipping Python dependency license refresh.
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

echo [INFO] Building installer (frontend build is included)...
echo [INFO] This may take several minutes.
echo.
cargo tauri build --bundles nsis --config tauri.build.nvidia-windows.override.json
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
echo [OK] Installer path:
echo      src-tauri\target\release\bundle\nsis\Local Transcription for Therapy_*_x64-setup.exe
echo.
echo [INFO] Python packages are installed via the app's setup UI after first launch.
goto :hold_success

:normalize_python_pth
powershell -NoProfile -NonInteractive -Command "$path = '%~1'; $lines = [System.IO.File]::ReadAllLines($path) -replace '^#import site$', 'import site'; $utf8NoBom = [System.Text.UTF8Encoding]::new($false); [System.IO.File]::WriteAllLines($path, $lines, $utf8NoBom)"
exit /b %ERRORLEVEL%

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
