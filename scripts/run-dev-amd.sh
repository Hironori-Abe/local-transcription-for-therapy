#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export LOTT_DEV_VARIANT=amd
export LOTT_TORCH_BACKEND=rocm
export LOTT_FRONTEND_HOST=127.0.0.1
export LOTT_FRONTEND_PORT=4201
export LOTT_FRONTEND_URL=http://127.0.0.1:4201
export LOTT_FRONTEND_BUILD_TARGET=offline-transcriber:build:development
unset LOTT_DEV_ENV_FILE LOTT_TAURI_CONFIGS

if [[ -n "${LOTT_AMD_DEV_PYTHON_BIN:-}" ]]; then
  export PYTHON_BIN="$LOTT_AMD_DEV_PYTHON_BIN"
elif [[ -x "$ROOT_DIR/.venv312-amd/bin/python" ]]; then
  export PYTHON_BIN="$ROOT_DIR/.venv312-amd/bin/python"
else
  unset PYTHON_BIN
fi
if [[ -n "${PYTHON_BIN:-}" ]]; then
  export DIARIZATION_PYTHON_BIN="$PYTHON_BIN"
else
  unset DIARIZATION_PYTHON_BIN
fi

exec "$ROOT_DIR/scripts/run-dev.sh"
