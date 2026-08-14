#!/usr/bin/env bash
# CachyOSのx86-64-v3対応CPU向けに、AVX-512を使わない最適化版を生成する。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$ROOT_DIR/src-tauri/tauri.conf.json').version")"

export LOTT_CPU_TARGET='x86-64-v3'
export LOTT_BUILD_LABEL='CachyOS experimental x86-64-v3 package (NVIDIA CUDA)'
export LOTT_OUTPUT_DIR="$ROOT_DIR/dist/cachyos/experimental/v$VERSION"
export LOTT_OUTPUT_NAME="LoTT-v${VERSION}-linux-x64-v3-cuda-cachyos-experimental.pkg.tar.zst"

exec bash "$ROOT_DIR/scripts/build-arch-package.sh"
