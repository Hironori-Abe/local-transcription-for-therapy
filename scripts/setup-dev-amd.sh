#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export LOTT_TORCH_BACKEND=rocm
export LOTT_VENV_DIR="${LOTT_AMD_DEV_VENV_DIR:-$ROOT_DIR/.venv312-amd}"
unset LOTT_LLAMA_CPP_BACKEND
exec "$ROOT_DIR/scripts/setup-dev.sh" "$@" --amd
