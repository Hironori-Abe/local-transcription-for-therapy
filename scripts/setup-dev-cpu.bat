@echo off
setlocal EnableExtensions

set "LOTT_DEV_VARIANT=cpu"
set "LOTT_TORCH_BACKEND=cpu"
set "LOTT_DEV_VENV_DIR="
if defined LOTT_CPU_DEV_VENV_DIR (
  set "LOTT_DEV_VENV_DIR=%LOTT_CPU_DEV_VENV_DIR%"
) else (
  for %%I in ("%~dp0\..\.venv312-cpu") do set "LOTT_DEV_VENV_DIR=%%~fI"
)

call "%~dp0setup-dev.bat" %* --cpu-torch
exit /b %ERRORLEVEL%
