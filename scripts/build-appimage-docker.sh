#!/usr/bin/env bash
# Ubuntu 24.04でLinux配布用の .deb / AppImage を再現可能にビルドする。
# 引数無しは NVIDIA、--amd / --cpu / --editor で配布ラインを明示する。
# Dockerデーモンへのアクセス権がない場合は、呼び出し側で sudo を付ける。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="lott-appimage-builder:ubuntu24"
TARGET_DIR="$ROOT_DIR/src-tauri/target-ubuntu24"

CONFIG_NVIDIA="tauri.nvidia.linux.override.json"
CONFIG_AMD="tauri.amd.linux.override.json"
CONFIG_CPU="tauri.cpu.linux.override.json"
CONFIG_EDITOR="tauri.editor.linux.override.json"
BUILD_CONFIG="$CONFIG_NVIDIA"
BUILD_LINE="NVIDIA CUDA"
BUILD_OPTION=""
DRY_RUN=0

usage() {
  cat <<EOF
Usage: $0 [--amd | --cpu | --editor] [--dry-run]

  (デフォルト) NVIDIA CUDA 版 .deb / .AppImage をビルドします。
  --amd        AMD ROCm 版をビルドします。
  --cpu        CPU 版をビルドします。
  --editor     軽量 Editor 版をビルドします。
  --dry-run    Docker を実行せず、選択内容と伝播する引数を表示します。
  -h, --help   このヘルプを表示します。
EOF
}

select_build_line() {
  local option="$1"
  local line="$2"
  local config="$3"
  if [[ -n "$BUILD_OPTION" ]]; then
    echo "[ERROR] 配布ライン指定は1つだけ指定してください。" >&2
    exit 2
  fi
  BUILD_OPTION="$option"
  BUILD_LINE="$line"
  BUILD_CONFIG="$config"
}

for arg in "$@"; do
  case "$arg" in
    --amd) select_build_line "--amd" "AMD ROCm" "$CONFIG_AMD" ;;
    --cpu) select_build_line "--cpu" "CPU" "$CONFIG_CPU" ;;
    --editor) select_build_line "--editor" "Editor" "$CONFIG_EDITOR" ;;
    --dry-run) DRY_RUN=1 ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[ERROR] 不明なオプション: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! command -v python3 &>/dev/null; then
  echo "[ERROR] python3 が見つかりません。" >&2
  exit 1
fi

read_config_value() {
  local key="$1"
  python3 - "$ROOT_DIR" "$BUILD_CONFIG" "$key" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
override_path = root / sys.argv[2]
base_path = root / "src-tauri/tauri.conf.json"
key = sys.argv[3]
override = json.loads(override_path.read_text(encoding="utf-8"))
base = json.loads(base_path.read_text(encoding="utf-8"))
value = override.get(key) or base.get(key)
if not isinstance(value, str) or not value:
    raise SystemExit(f"missing string config value: {key}")
print(value)
PY
}

PRODUCT_NAME="$(read_config_value productName)"
IDENTIFIER="$(read_config_value identifier)"

echo "=== Docker Build .deb / .AppImage (Ubuntu 24.04) ==="
echo "  配布ライン: $BUILD_LINE"
echo "  override 設定ファイル: $BUILD_CONFIG"
echo "  productName: $PRODUCT_NAME"
echo "  identifier: $IDENTIFIER"
echo ""

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[DRY-RUN] docker build は実行しません。"
  echo "[DRY-RUN] docker run 内で setup-build-tools-linux.sh に渡す引数: ${BUILD_OPTION:-（引数無し / NVIDIA）}"
  echo "[DRY-RUN] 伝播用環境変数: LOTT_BUILD_LINE_OPTION=${BUILD_OPTION}"
  exit 0
fi

HOST_UID="${SUDO_UID:-${PKEXEC_UID:-$(id -u)}}"
HOST_GID="$(getent passwd "$HOST_UID" | cut -d: -f4)"
if [[ -z "$HOST_GID" ]]; then
  HOST_GID="$(id -g)"
fi

cd "$ROOT_DIR"

if [[ "$BUILD_OPTION" == "" ]]; then
  # ggml-org publishes CUDA llama-server archives for Windows, but not Linux.
  # Prepare the pinned source build on the host before mounting the repository
  # into the Ubuntu AppImage builder container.
  bash scripts/build-llama-server-cuda-linux.sh --ensure
fi

echo "[INFO] Ubuntu 24.04 AppImageビルダーを準備します..."
docker build \
  --file scripts/Dockerfile.appimage-ubuntu24 \
  --tag "$IMAGE_NAME" \
  scripts

echo "[INFO] Ubuntu 24.04コンテナで${BUILD_LINE}版をビルドします..."
docker run --rm \
  --volume "$ROOT_DIR:/workspace" \
  --volume lott-ubuntu-cargo-registry:/root/.cargo/registry \
  --volume lott-ubuntu-cargo-git:/root/.cargo/git \
  --volume lott-ubuntu-tauri-cache:/root/.cache/tauri \
  --workdir /workspace \
  --env CARGO_TARGET_DIR=/workspace/src-tauri/target-ubuntu24 \
  --env LOTT_VENV_DIR=/workspace/.venv312 \
  --env "LOTT_BUILD_LINE_OPTION=$BUILD_OPTION" \
  --env HOST_UID="$HOST_UID" \
  --env HOST_GID="$HOST_GID" \
  "$IMAGE_NAME" \
  bash -lc '
    set -euo pipefail
    build_status=0
    mkdir -p /workspace/src-tauri/resources/python312-linux
    cp -a /opt/lott-python312/. /workspace/src-tauri/resources/python312-linux/
    if [[ -n "${LOTT_BUILD_LINE_OPTION:-}" ]]; then
      bash scripts/setup-build-tools-linux.sh "$LOTT_BUILD_LINE_OPTION" || build_status=$?
    else
      bash scripts/setup-build-tools-linux.sh || build_status=$?
    fi
    chown -R "$HOST_UID:$HOST_GID" \
      /workspace/src-tauri/target-ubuntu24 \
      /workspace/frontend/dist \
      /workspace/licenses \
      /workspace/src-tauri/resources/python312-linux \
      /workspace/src-tauri/resources/ffmpeg 2>/dev/null || true
    exit "$build_status"
  '

list_new_artifacts() {
  local found=0
  local artifact
  local artifact_dir
  local build_marker="$TARGET_DIR/.appimage-build-start"
  for artifact_dir in "$TARGET_DIR/release/bundle/deb" "$TARGET_DIR/release/bundle/appimage"; do
    [[ -d "$artifact_dir" ]] || continue
    while IFS= read -r -d '' artifact; do
      printf '  %s (%s bytes)\n' "$(basename "$artifact")" "$(stat -c '%s' "$artifact")"
      found=1
    done < <(find "$artifact_dir" -maxdepth 1 -type f \
      \( -name '*.deb' -o -name '*.AppImage' \) -newer "$build_marker" -print0 | sort -z)
  done
  if [[ "$found" -eq 0 ]]; then
    echo "  [WARN] BUILD_MARKER 以降に生成された .deb / .AppImage が見つかりません。"
  fi
}

echo "[OK] Dockerビルドが完了しました。"
echo "[OK] 生成成果物（今回の BUILD_MARKER 以降）:"
list_new_artifacts
