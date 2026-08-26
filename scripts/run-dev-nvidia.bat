@echo off
setlocal EnableExtensions

set "LOTT_DEV_VARIANT=nvidia"
set "LOTT_TORCH_BACKEND=cuda"
set "PYTHON_BIN="
if defined LOTT_NVIDIA_DEV_PYTHON_BIN set "PYTHON_BIN=%LOTT_NVIDIA_DEV_PYTHON_BIN%"
if not defined PYTHON_BIN if exist "%~dp0\..\.venv312-nvidia\Scripts\python.exe" (
  for %%I in ("%~dp0\..\.venv312-nvidia\Scripts\python.exe") do set "PYTHON_BIN=%%~fI"
)
if defined PYTHON_BIN set "DIARIZATION_PYTHON_BIN=%PYTHON_BIN%"

call "%~dp0run-dev.bat"
exit /b %ERRORLEVEL%
