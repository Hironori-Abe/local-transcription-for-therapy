@echo off
setlocal enabledelayedexpansion

:: ===========================================================
::  reset-installed-data.bat  (dev tool)
::  Removes downloaded data from the NSIS-installed LoTT environment
::  so that the first-run setup flow can be tested again.
::
::  NEVER deletes OS files, the installer itself, or the
::  Python interpreter binary -- only downloaded/installed data.
:: ===========================================================

echo.
echo ============================================================
echo   LoTT  --  Reset Installed Data  (dev tool)
echo ============================================================
echo.

:: ---- Locate install dir ----
set "INSTDIR=%LOCALAPPDATA%\Local Transcription for Therapy"
if not exist "%INSTDIR%" (
    echo [ERROR] Install dir not found:
    echo   %INSTDIR%
    echo Make sure LoTT was installed with the NSIS installer.
    pause
    exit /b 1
)
echo Install dir: %INSTDIR%
echo.

:: ---- Check if app is running ----
tasklist /FI "IMAGENAME eq Local Transcription for Therapy.exe" 2>nul | find /I "Local Transcription for Therapy.exe" >nul
if %ERRORLEVEL% equ 0 (
    echo [WARNING] LoTT is currently running. Please quit it first.
    pause
    exit /b 1
)

:: ---- Menu ----
echo Select what to delete:
echo.
echo   [1] Python packages  (pip-installed, site-packages)
echo       %INSTDIR%\resources\python312\Lib\site-packages\
echo.
echo   [2] Whisper models  (HuggingFace Hub cache)
echo       %LOCALAPPDATA%\net.gakkousya.lott\hf_cache\hub\  ^(v0.2+^)
echo       %USERPROFILE%\.cache\huggingface\hub\  ^(legacy^)
echo.
echo   [3] Diarization model  (pyannote-speaker-diarization-community-1)
echo       %LOCALAPPDATA%\net.gakkousya.lott\models\pyannote-speaker-diarization-community-1  ^(v0.3+^)
echo       %INSTDIR%\python_sidecar\models\pyannote-speaker-diarization-community-1  ^(legacy resource_dir^)
echo.
echo   [4] Gemma GGUF model  (LLM proofreading)
echo       %LOCALAPPDATA%\net.gakkousya.lott\models\llm\  ^(v0.3+^)
echo       %INSTDIR%\python_sidecar\models\llm\  ^(legacy resource_dir^)
echo.
echo   [5] Lemonade backend cache  (llama-server binaries etc.)
echo       %LOCALAPPDATA%\net.gakkousya.lott\lemonade\
echo.
echo   [6] App settings  (localStorage / WebView2 data)
echo       %APPDATA%\net.gakkousya.lott\
echo       %LOCALAPPDATA%\net.gakkousya.lott\EBWebView\
echo.
echo   [A] All of the above
echo   [Q] Quit / cancel
echo.

:ask_choice
set /p CHOICE="Select [1-6 / A / Q]: "
set "CHOICE=%CHOICE: =%"
if /i "%CHOICE%"=="Q" ( echo Cancelled. & exit /b 0 )
if /i "%CHOICE%"=="A" goto run_all
if "%CHOICE%"=="1" ( call :item_python & goto done )
if "%CHOICE%"=="2" ( call :item_whisper & goto done )
if "%CHOICE%"=="3" ( call :item_diarization & goto done )
if "%CHOICE%"=="4" ( call :item_gemma & goto done )
if "%CHOICE%"=="5" ( call :item_lemonade & goto done )
if "%CHOICE%"=="6" ( call :item_settings & goto done )
echo Invalid choice. Enter 1-6, A, or Q.
goto ask_choice

:run_all
echo.
echo [A] Processing all items (each requires confirmation).
echo.
call :item_python
call :item_whisper
call :item_diarization
call :item_gemma
call :item_lemonade
call :item_settings
goto done

:: ===========================================================
::  Subroutine: [1] Python packages
:: ===========================================================
:item_python
echo.
set "TARGET=%INSTDIR%\resources\python312\Lib\site-packages"
if not exist "%TARGET%" (
    echo [1] site-packages not found ^(skip^): %TARGET%
    exit /b 0
)
echo [1] Delete Python packages ^(site-packages only; python.exe is NOT touched^):
echo       %TARGET%
set /p CONFIRM1="Confirm? [Y/N]: "
if /i not "%CONFIRM1%"=="Y" ( echo Skipped. & exit /b 0 )
echo Deleting...
rd /s /q "%TARGET%"
if %ERRORLEVEL% equ 0 (
    echo [1] Done: site-packages deleted.
) else (
    echo [1] ERROR: delete failed ^(files may be in use^).
)
exit /b 0

:: ===========================================================
::  Subroutine: [2] Whisper model
:: ===========================================================
:item_whisper
echo.
:: v0.2+ app-specific cache
set "APP_HF_HUB=%LOCALAPPDATA%\net.gakkousya.lott\hf_cache\hub"
set "W1=%APP_HF_HUB%\models--mobiuslabsgmbh--faster-whisper-large-v3-turbo"
set "W2=%APP_HF_HUB%\models--Systran--faster-whisper-turbo"
set "W3=%APP_HF_HUB%\models--Systran--faster-whisper-large-v3"
:: legacy default HF cache (pre-v0.1)
set "HF_HUB=%USERPROFILE%\.cache\huggingface\hub"
set "W1_OLD=%HF_HUB%\models--mobiuslabsgmbh--faster-whisper-large-v3-turbo"
set "W2_OLD=%HF_HUB%\models--Systran--faster-whisper-turbo"
set "W3_OLD=%HF_HUB%\models--Systran--faster-whisper-large-v3"
set "FOUND_W=0"
if exist "%W1%" set "FOUND_W=1"
if exist "%W2%" set "FOUND_W=1"
if exist "%W3%" set "FOUND_W=1"
if exist "%W1_OLD%" set "FOUND_W=1"
if exist "%W2_OLD%" set "FOUND_W=1"
if exist "%W3_OLD%" set "FOUND_W=1"
if "%FOUND_W%"=="0" (
    echo [2] Whisper model cache not found ^(skip^).
    exit /b 0
)
echo [2] Delete Whisper model cache:
if exist "%W1%" echo       %W1%
if exist "%W2%" echo       %W2%
if exist "%W3%" echo       %W3%
if exist "%W1_OLD%" echo       %W1_OLD%
if exist "%W2_OLD%" echo       %W2_OLD%
if exist "%W3_OLD%" echo       %W3_OLD%
set /p CONFIRM2="Confirm? [Y/N]: "
if /i not "%CONFIRM2%"=="Y" ( echo Skipped. & exit /b 0 )
echo Deleting...
if exist "%W1%" rd /s /q "%W1%"
if exist "%W2%" rd /s /q "%W2%"
if exist "%W3%" rd /s /q "%W3%"
if exist "%W1_OLD%" rd /s /q "%W1_OLD%"
if exist "%W2_OLD%" rd /s /q "%W2_OLD%"
if exist "%W3_OLD%" rd /s /q "%W3_OLD%"
echo [2] Done: Whisper cache deleted.
exit /b 0

:: ===========================================================
::  Subroutine: [3] Diarization model
:: ===========================================================
:item_diarization
echo.
set "DIA1=%INSTDIR%\python_sidecar\models\pyannote-speaker-diarization-community-1"
set "DIA2=%INSTDIR%\python_sidecar\models\pyannote-speaker-diarization"
set "DIA3=%INSTDIR%\_up_\python_sidecar\models\pyannote-speaker-diarization-community-1"
set "DIA4=%INSTDIR%\_up_\python_sidecar\models\pyannote-speaker-diarization"
set "DIA5=%LOCALAPPDATA%\net.gakkousya.lott\models\pyannote-speaker-diarization-community-1"
set "DIA6=%LOCALAPPDATA%\net.gakkousya.lott\models\pyannote-speaker-diarization"
set "FOUND_D=0"
if exist "%DIA1%" set "FOUND_D=1"
if exist "%DIA2%" set "FOUND_D=1"
if exist "%DIA3%" set "FOUND_D=1"
if exist "%DIA4%" set "FOUND_D=1"
if exist "%DIA5%" set "FOUND_D=1"
if exist "%DIA6%" set "FOUND_D=1"
if "%FOUND_D%"=="0" (
    echo [3] Diarization model not found ^(skip^).
    exit /b 0
)
echo [3] Delete diarization model:
if exist "%DIA1%" echo       %DIA1%
if exist "%DIA2%" echo       %DIA2%
if exist "%DIA3%" echo       %DIA3%
if exist "%DIA4%" echo       %DIA4%
if exist "%DIA5%" echo       %DIA5%
if exist "%DIA6%" echo       %DIA6%
set /p CONFIRM3="Confirm? [Y/N]: "
if /i not "%CONFIRM3%"=="Y" ( echo Skipped. & exit /b 0 )
echo Deleting...
if exist "%DIA1%" rd /s /q "%DIA1%"
if exist "%DIA2%" rd /s /q "%DIA2%"
if exist "%DIA3%" rd /s /q "%DIA3%"
if exist "%DIA4%" rd /s /q "%DIA4%"
if exist "%DIA5%" rd /s /q "%DIA5%"
if exist "%DIA6%" rd /s /q "%DIA6%"
echo [3] Done: diarization model deleted.
exit /b 0

:: ===========================================================
::  Subroutine: [4] Gemma GGUF model
:: ===========================================================
:item_gemma
echo.
set "GEMMA1=%INSTDIR%\python_sidecar\models\llm"
set "GEMMA2=%INSTDIR%\_up_\python_sidecar\models\llm"
set "GEMMA3=%LOCALAPPDATA%\net.gakkousya.lott\models\llm"
set "FOUND_G=0"
if exist "%GEMMA1%" set "FOUND_G=1"
if exist "%GEMMA2%" set "FOUND_G=1"
if exist "%GEMMA3%" set "FOUND_G=1"
if "%FOUND_G%"=="0" (
    echo [4] Gemma GGUF model dir not found ^(skip^).
    exit /b 0
)
echo [4] Delete Gemma GGUF model:
if exist "%GEMMA1%" echo       %GEMMA1%
if exist "%GEMMA2%" echo       %GEMMA2%
if exist "%GEMMA3%" echo       %GEMMA3%
set /p CONFIRM4="Confirm? [Y/N]: "
if /i not "%CONFIRM4%"=="Y" ( echo Skipped. & exit /b 0 )
echo Deleting...
if exist "%GEMMA1%" rd /s /q "%GEMMA1%"
if exist "%GEMMA2%" rd /s /q "%GEMMA2%"
if exist "%GEMMA3%" rd /s /q "%GEMMA3%"
echo [4] Done: Gemma GGUF deleted.
exit /b 0

:: ===========================================================
::  Subroutine: [5] Lemonade backend cache
:: ===========================================================
:item_lemonade
echo.
set "LEMON=%LOCALAPPDATA%\net.gakkousya.lott\lemonade"
if not exist "%LEMON%" (
    echo [5] Lemonade cache dir not found ^(skip^): %LEMON%
    exit /b 0
)
echo [5] Delete Lemonade backend cache ^(llama-server binaries, config.json^):
echo       %LEMON%
set /p CONFIRM5="Confirm? [Y/N]: "
if /i not "%CONFIRM5%"=="Y" ( echo Skipped. & exit /b 0 )
echo Deleting...
rd /s /q "%LEMON%"
if %ERRORLEVEL% equ 0 (
    echo [5] Done: Lemonade cache deleted.
) else (
    echo [5] ERROR: delete failed ^(lemond.exe may still be running^).
)
exit /b 0

:: ===========================================================
::  Subroutine: [6] App settings
:: ===========================================================
:item_settings
echo.
set "APPDATA_DIR=%APPDATA%\net.gakkousya.lott"
set "WEBVIEW_DIR=%LOCALAPPDATA%\net.gakkousya.lott\EBWebView"
set "FOUND_S=0"
if exist "%APPDATA_DIR%" set "FOUND_S=1"
if exist "%WEBVIEW_DIR%" set "FOUND_S=1"
if "%FOUND_S%"=="0" (
    echo [6] App settings dirs not found ^(skip^).
    exit /b 0
)
echo [6] Delete app settings ^(speaker names, system prompts, etc. will also be reset^):
if exist "%APPDATA_DIR%" echo       %APPDATA_DIR%
if exist "%WEBVIEW_DIR%" echo       %WEBVIEW_DIR%   ^(WebView2 / localStorage^)
set /p CONFIRM6="Confirm? [Y/N]: "
if /i not "%CONFIRM6%"=="Y" ( echo Skipped. & exit /b 0 )
echo Deleting...
if exist "%APPDATA_DIR%" rd /s /q "%APPDATA_DIR%"
if exist "%WEBVIEW_DIR%" rd /s /q "%WEBVIEW_DIR%"
echo [6] Done: app settings deleted.
exit /b 0

:: ===========================================================
::  Done
:: ===========================================================
:done
echo.
echo ============================================================
echo   Finished. Launch LoTT to go through first-run setup.
echo ============================================================
echo.
pause
endlocal
