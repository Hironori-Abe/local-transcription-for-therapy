#!/usr/bin/env bash
# Ubuntu 24.04でLinux配布用のNVIDIA版AppImageを再現可能にビルドする。
# Dockerデーモンへのアクセス権がない場合は、呼び出し側で sudo を付ける。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="lott-appimage-builder:ubuntu24"
TARGET_DIR="$ROOT_DIR/src-tauri/target-ubuntu24"
HOST_UID="${SUDO_UID:-${PKEXEC_UID:-$(id -u)}}"
HOST_GID="$(getent passwd "$HOST_UID" | cut -d: -f4)"
if [[ -z "$HOST_GID" ]]; then
  HOST_GID="$(id -g)"
fi

cd "$ROOT_DIR"

echo "[INFO] Ubuntu 24.04 AppImageビルダーを準備します..."
docker build \
  --file scripts/Dockerfile.appimage-ubuntu24 \
  --tag "$IMAGE_NAME" \
  scripts

echo "[INFO] Ubuntu 24.04コンテナでNVIDIA版AppImageをビルドします..."
docker run --rm \
  --volume "$ROOT_DIR:/workspace" \
  --volume lott-ubuntu-cargo-registry:/root/.cargo/registry \
  --volume lott-ubuntu-cargo-git:/root/.cargo/git \
  --volume lott-ubuntu-tauri-cache:/root/.cache/tauri \
  --workdir /workspace \
  --env CARGO_TARGET_DIR=/workspace/src-tauri/target-ubuntu24 \
  --env LOTT_VENV_DIR=/workspace/.venv312 \
  --env HOST_UID="$HOST_UID" \
  --env HOST_GID="$HOST_GID" \
  "$IMAGE_NAME" \
  bash -lc '
    set -euo pipefail
    build_status=0
    mkdir -p /workspace/src-tauri/resources/python312-linux
    cp -a /opt/lott-python312/. /workspace/src-tauri/resources/python312-linux/
    bash scripts/setup-build-tools-linux.sh || build_status=$?
    chown -R "$HOST_UID:$HOST_GID" \
      /workspace/src-tauri/target-ubuntu24 \
      /workspace/frontend/dist \
      /workspace/licenses \
      /workspace/src-tauri/resources/python312-linux \
      /workspace/src-tauri/resources/ffmpeg 2>/dev/null || true
    exit "$build_status"
  '

echo "[OK] AppImage出力先: $TARGET_DIR/release/bundle/appimage/"
