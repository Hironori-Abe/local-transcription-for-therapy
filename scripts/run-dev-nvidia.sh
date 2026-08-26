#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export LOTT_DEV_VARIANT=nvidia
export LOTT_TORCH_BACKEND=cuda
export LOTT_FRONTEND_HOST=127.0.0.1
export LOTT_FRONTEND_PORT=4200
export LOTT_FRONTEND_URL=http://127.0.0.1:4200
unset LOTT_FRONTEND_BUILD_TARGET LOTT_DEV_ENV_FILE LOTT_TAURI_CONFIGS

if [[ -n "${LOTT_NVIDIA_DEV_PYTHON_BIN:-}" ]]; then
  export PYTHON_BIN="$LOTT_NVIDIA_DEV_PYTHON_BIN"
elif [[ -x "$ROOT_DIR/.venv312-nvidia/bin/python" ]]; then
  export PYTHON_BIN="$ROOT_DIR/.venv312-nvidia/bin/python"
else
  unset PYTHON_BIN
fi
if [[ -n "${PYTHON_BIN:-}" ]]; then
  export DIARIZATION_PYTHON_BIN="$PYTHON_BIN"
else
  unset DIARIZATION_PYTHON_BIN
fi

exec "$ROOT_DIR/scripts/run-dev.sh"
