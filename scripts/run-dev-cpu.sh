#!/usr/bin/env bash
set -Eeuo pipefail

# CPU development uses the common Linux launcher so GStreamer checks,
# emulation handling, Python preflight, and child-process cleanup stay in one
# place.  Only the CPU-specific frontend/config/backend selection lives here.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export LOTT_FRONTEND_HOST="${LOTT_FRONTEND_HOST:-127.0.0.1}"
export LOTT_FRONTEND_PORT="${LOTT_FRONTEND_PORT:-4202}"
export LOTT_FRONTEND_URL="${LOTT_FRONTEND_URL:-http://${LOTT_FRONTEND_HOST}:${LOTT_FRONTEND_PORT}}"
export LOTT_FRONTEND_BUILD_TARGET="${LOTT_FRONTEND_BUILD_TARGET:-offline-transcriber:build:development,cpu}"
export LOTT_TAURI_DEV_CONFIG="${LOTT_TAURI_DEV_CONFIG:-tauri.cpu.dev.linux.override.json}"
export LOTT_TORCH_BACKEND=cpu

if [[ -z "${PYTHON_BIN:-}" && -x "$ROOT_DIR/.venv312/bin/python" ]]; then
  export PYTHON_BIN="$ROOT_DIR/.venv312/bin/python"
fi

exec "$ROOT_DIR/scripts/run-dev.sh"
