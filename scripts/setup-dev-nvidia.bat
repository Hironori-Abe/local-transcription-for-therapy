@echo off
setlocal EnableExtensions

set "LOTT_DEV_VARIANT=nvidia"
set "LOTT_TORCH_BACKEND=cuda"
set "LOTT_DEV_VENV_DIR="
if defined LOTT_NVIDIA_DEV_VENV_DIR (
  set "LOTT_DEV_VENV_DIR=%LOTT_NVIDIA_DEV_VENV_DIR%"
) else (
  for %%I in ("%~dp0\..\.venv312-nvidia") do set "LOTT_DEV_VENV_DIR=%%~fI"
)

call "%~dp0setup-dev.bat" %* --torch-backend cuda
exit /b %ERRORLEVEL%
