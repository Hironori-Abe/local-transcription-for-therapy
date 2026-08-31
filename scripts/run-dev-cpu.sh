#!/usr/bin/env bash
set -Eeuo pipefail

# CPU development uses the common Linux launcher so GStreamer checks,
# emulation handling, Python preflight, and child-process cleanup stay in one
# place.  Only the CPU-specific frontend/config/backend selection lives here.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export LOTT_FRONTEND_HOST=127.0.0.1
export LOTT_FRONTEND_PORT=4202
export LOTT_FRONTEND_URL=http://127.0.0.1:4202
export LOTT_FRONTEND_BUILD_TARGET=lott:build:development,cpu
export LOTT_DEV_VARIANT=cpu
export LOTT_TORCH_BACKEND=cpu
unset LOTT_DEV_ENV_FILE LOTT_TAURI_CONFIGS

if [[ -n "${LOTT_CPU_DEV_PYTHON_BIN:-}" ]]; then
  export PYTHON_BIN="$LOTT_CPU_DEV_PYTHON_BIN"
elif [[ -x "$ROOT_DIR/.venv312-cpu/bin/python" ]]; then
  export PYTHON_BIN="$ROOT_DIR/.venv312-cpu/bin/python"
else
  unset PYTHON_BIN
fi
if [[ -n "${PYTHON_BIN:-}" ]]; then
  export DIARIZATION_PYTHON_BIN="$PYTHON_BIN"
else
  unset DIARIZATION_PYTHON_BIN
fi

exec "$ROOT_DIR/scripts/run-dev.sh"
