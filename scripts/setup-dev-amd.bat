@echo off
setlocal EnableExtensions

REM Dedicated AMD entry point. Keep the generic venv override out of this
REM process so ROCm packages can never be redirected into the NVIDIA venv.
set "LOTT_DEV_VENV_DIR="
if not defined LOTT_AMD_DEV_VENV_DIR (
  for %%I in ("%~dp0\..\.venv312-amd") do set "LOTT_AMD_DEV_VENV_DIR=%%~fI"
)

REM Put --amd last so backend-changing arguments or inherited environment
REM settings cannot turn this dedicated entry point into a .venv312 setup.
call "%~dp0setup-dev.bat" %* --amd
set "SETUP_EXIT_CODE=%ERRORLEVEL%"
exit /b %SETUP_EXIT_CODE%
