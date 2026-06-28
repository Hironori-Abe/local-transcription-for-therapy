#!/bin/bash
# Ubuntu 26.04 コンテナで .deb ビルドや動作確認を行うためのランチャー。
# cargo ツールチェーンを Docker volume (lott-ubuntu-cargo) に永続化して毎回の再インストールを防ぐ。
# --gpu  AMD GPU パススルー（ROCm）を有効化（/dev/kfd が必要）。
# --gui  X11/Wayland を転送して Tauri GUI テストを有効化。
#
# ── 使い方メモ ─────────────────────────────────────────────────────────────────
#
#  【.deb ビルド】（GPU・GUI 不要）
#    bash scripts/run-dev-docker-ubuntu.sh
#    # コンテナ内で:
#    bash scripts/setup-dev.sh --skip-gemma -y   # 初回のみ（Rust/Node/Python 導入）
#    bash scripts/setup-build-tools-ubuntu.sh    # .deb を生成
#    # → src-tauri/target/release/bundle/deb/ に .deb が出る
#
#  【Tauri GUI テスト】（Wayland/X11 表示転送）
#    bash scripts/run-dev-docker-ubuntu.sh --gui
#    # コンテナ内で:
#    bash scripts/setup-dev.sh --skip-gemma -y   # 初回のみ
#    bash scripts/run-dev.sh                     # Tauri dev サーバー起動
#
#  【AMD GPU テスト込み】
#    bash scripts/run-dev-docker-ubuntu.sh --gui --gpu
#    # コンテナ内で setup-dev.sh --amd を実行してから run-dev.sh
#
#  【2回目以降】
#    cargo ツールチェーンは lott-ubuntu-cargo volume に残るため
#    setup-dev.sh の Rust インストールステップはスキップされる。
#    .venv312・node_modules はワークスペース内に保存されるため同様に再利用可。
#
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

USE_GPU=0
USE_GUI=0
for arg in "$@"; do
  case "$arg" in
    --gpu) USE_GPU=1 ;;
    --gui) USE_GUI=1 ;;
    --help|-h)
      echo "Usage: $0 [--gpu] [--gui]"
      echo "  (デフォルト)  .deb ビルド専用（GPU・GUI なし）。"
      echo "  --gpu         /dev/kfd・/dev/dri を渡して AMD GPU テストを有効化。"
      echo "  --gui         X11/Wayland を転送して Tauri GUI テストを有効化。"
      exit 0
      ;;
    *) echo "[WARN] 不明なオプション: $arg" ;;
  esac
done

# --- AMD GPU パススルー ---
GPU_ARGS=()
if [[ "$USE_GPU" == "1" ]]; then
  if [[ ! -e /dev/kfd ]]; then
    echo "[ERROR] /dev/kfd が見つかりません。ROCm が未インストールか AMD GPU がありません。" >&2
    exit 1
  fi
  GPU_ARGS+=(--device /dev/kfd --device /dev/dri)
  VIDEO_GID=$(getent group video  2>/dev/null | cut -d: -f3 || true)
  RENDER_GID=$(getent group render 2>/dev/null | cut -d: -f3 || true)
  [[ -n "$VIDEO_GID"  ]] && GPU_ARGS+=(--group-add "$VIDEO_GID")
  [[ -n "$RENDER_GID" ]] && GPU_ARGS+=(--group-add "$RENDER_GID")
fi

# --- ディスプレイ転送 (Tauri GUI テスト用) ---
DISPLAY_ARGS=()
if [[ "$USE_GUI" == "1" ]]; then
  RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

  if [[ -n "${WAYLAND_DISPLAY:-}" && -S "$RUNTIME_DIR/${WAYLAND_DISPLAY}" ]]; then
    # Wayland ソケットを転送（優先）
    DISPLAY_ARGS+=(
      -v "$RUNTIME_DIR/${WAYLAND_DISPLAY}:$RUNTIME_DIR/${WAYLAND_DISPLAY}"
      -e "WAYLAND_DISPLAY=${WAYLAND_DISPLAY}"
      -e "XDG_RUNTIME_DIR=$RUNTIME_DIR"
    )
    # X11 (XWayland) も同時に転送しておく (GTK fallback 用)
    if [[ -n "${DISPLAY:-}" && -d /tmp/.X11-unix ]]; then
      DISPLAY_ARGS+=(-v /tmp/.X11-unix:/tmp/.X11-unix -e "DISPLAY=${DISPLAY}")
    fi
    echo "[INFO] GUI: Wayland (${WAYLAND_DISPLAY})"
  elif [[ -n "${DISPLAY:-}" && -d /tmp/.X11-unix ]]; then
    # X11 のみ転送。xauth で認証トークンを渡す（xhost 不要）
    XAUTH_TMP="$(mktemp /tmp/.docker-xauth-XXXXXX)"
    if command -v xauth >/dev/null 2>&1; then
      xauth nlist "${DISPLAY}" 2>/dev/null \
        | sed 's/^..../ffff/' \
        | xauth -f "$XAUTH_TMP" nmerge - 2>/dev/null || true
      DISPLAY_ARGS+=(-v "$XAUTH_TMP:/tmp/.docker.xauth:ro" -e "XAUTHORITY=/tmp/.docker.xauth")
    fi
    DISPLAY_ARGS+=(-v /tmp/.X11-unix:/tmp/.X11-unix -e "DISPLAY=${DISPLAY}")
    echo "[INFO] GUI: X11 (${DISPLAY})"
  else
    echo "[WARN] WAYLAND_DISPLAY も DISPLAY も未設定です。Tauri GUI は起動しません。" >&2
  fi
fi

exec docker run -it --rm \
  "${GPU_ARGS[@]}" \
  "${DISPLAY_ARGS[@]}" \
  -v "$(pwd):/workspace" \
  -v "lott-ubuntu-cargo:/root/.cargo" \
  -w /workspace \
  ubuntu:26.04 bash
