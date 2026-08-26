@echo off
set "LOTT_SANITIZE_BACKEND=%~1"
if /I not "%LOTT_SANITIZE_BACKEND%"=="nvidia" if /I not "%LOTT_SANITIZE_BACKEND%"=="amd" if /I not "%LOTT_SANITIZE_BACKEND%"=="cpu" exit /b 2

rem Clear inherited backend variables by prefix.  This also catches versioned
rem names such as CUDA_PATH_V12_9 that cannot be listed explicitly.
if /I "%LOTT_SANITIZE_BACKEND%"=="amd" (
  call :clear_env_prefix CUDA
  call :clear_env_prefix CUDNN
  call :clear_env_prefix CT2_CUDA
) else if /I "%LOTT_SANITIZE_BACKEND%"=="cpu" (
  call :clear_env_prefix CUDA
  call :clear_env_prefix CUDNN
  call :clear_env_prefix ROCM
  call :clear_env_prefix HIP
  call :clear_env_prefix HSA
  call :clear_env_prefix MIOPEN
  call :clear_env_prefix ROCBLAS
  call :clear_env_prefix CT2_CUDA
  call :clear_env_prefix CT2_ROCM
) else (
  call :clear_env_prefix ROCM
  call :clear_env_prefix HIP
  call :clear_env_prefix HSA
  call :clear_env_prefix MIOPEN
  call :clear_env_prefix ROCBLAS
  call :clear_env_prefix CT2_ROCM
)

set "LOTT_SANITIZED_PATH="
for /f "usebackq delims=" %%P in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sanitize-dev-env.ps1" -Backend "%LOTT_SANITIZE_BACKEND%"`) do if not defined LOTT_SANITIZED_PATH set "LOTT_SANITIZED_PATH=%%P"
if not defined LOTT_SANITIZED_PATH (
  echo [ERROR] Failed to sanitize PATH for the %LOTT_SANITIZE_BACKEND% backend. >&2
  set "LOTT_SANITIZE_BACKEND="
  exit /b 1
)
set "PATH=%LOTT_SANITIZED_PATH%"
set "LOTT_SANITIZED_PATH="
set "LOTT_SANITIZE_BACKEND="
exit /b 0

:clear_env_prefix
for /f "tokens=1 delims==" %%V in ('set %~1 2^>nul') do set "%%V="
exit /b 0
