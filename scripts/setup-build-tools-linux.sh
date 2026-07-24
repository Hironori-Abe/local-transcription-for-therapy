#!/usr/bin/env bash
# setup-build-tools-linux.sh
# Ubuntu 向け NSIS に相当するビルドスクリプト。
# .deb / .AppImage パッケージ（NVIDIA 版）をビルドする。
# AMD 版は --amd、Editor 版は --editor オプションで切り替え可能。
#
# glibc 互換のため、リリースビルドは古めの Ubuntu（例 24.04）コンテナ内で
# 実行すること。詳細は scripts/run-dev-docker-ubuntu.sh を参照。
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

CONFIG_NVIDIA="tauri.nvidia.linux.override.json"
CONFIG_AMD="tauri.amd.linux.override.json"
CONFIG_EDITOR="tauri.editor.linux.override.json"
BUILD_CONFIG="$CONFIG_NVIDIA"
BUILD_LINE="NVIDIA CUDA"

# --- オプション解析 ---
for arg in "$@"; do
  case "$arg" in
    --amd) BUILD_CONFIG="$CONFIG_AMD"; BUILD_LINE="AMD ROCm" ;;
    --editor) BUILD_CONFIG="$CONFIG_EDITOR"; BUILD_LINE="Editor" ;;
    --help|-h)
      echo "Usage: $0 [--amd | --editor]"
      echo "  (デフォルト) NVIDIA CUDA 版 .deb / .AppImage をビルドします。"
      echo "  --amd        AMD ROCm 版をビルドします。"
      echo "  --editor     軽量 Editor 版をビルドします。"
      exit 0
      ;;
    *) echo "[WARN] 不明なオプション: $arg" ;;
  esac
done

echo "=== Build .deb / .AppImage (Ubuntu) ==="
echo "  配布ライン: $BUILD_LINE"
echo "  設定ファイル: $BUILD_CONFIG"
echo ""

# --- cargo チェック ---
if ! command -v cargo &>/dev/null; then
  echo "[ERROR] cargo が見つかりません。Rustup をインストールしてください:"
  echo "         curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  exit 1
fi
echo "[OK] $(cargo --version)"

# --- tauri-cli チェック / インストール ---
if ! cargo tauri -V &>/dev/null 2>&1; then
  echo "[INFO] tauri-cli が見つかりません。インストールします..."
  cargo install tauri-cli --locked
fi
echo "[OK] $(cargo tauri -V)"
echo ""

# --- LGPL FFmpeg CLI のダウンロード ---
if ! command -v python3 &>/dev/null; then
  echo "[ERROR] python3 が見つかりません。"
  exit 1
fi
echo "[INFO] LGPL FFmpeg CLI を確認中..."
python3 scripts/setup_ffmpeg_lgpl.py --platform linux --variant lgpl
echo ""

# --- 第三者ライセンス全文の収集 ---
echo "[INFO] 第三者ライセンス全文を収集中..."
if [[ -d ".venv312/Lib/site-packages" || -d ".venv312/lib" ]]; then
  python3 scripts/collect_licenses.py --venv .venv312 --frontend frontend --tauri src-tauri --out licenses
  echo "[OK] licenses/THIRD_PARTY_FULL.txt を更新しました"
else
  echo "[WARN] .venv312 が見つかりません。Python 依存のライセンス再収集をスキップします。"
  echo "[WARN] リリース前に配布相当の Python 環境を指定して scripts/collect_licenses.py を実行してください。"
fi
if [[ ! -f "licenses/THIRD_PARTY_FULL.txt" ]]; then
  echo "[WARN] licenses/THIRD_PARTY_FULL.txt が見つかりません。ライセンス resources が不完全になります。"
fi
echo ""

echo "[INFO] LLM 校正は llama.cpp llama-server を直接起動します。Lemonade/lemond は同梱しません。"
echo ""

# --- AppImage ビルド用の環境（Docker/FUSE 無し対策）---
# コンテナ内では FUSE が使えないことが多いため、linuxdeploy/appimagetool を
# 展開実行モードで動かす。ホストで FUSE が使える場合も無害。
export APPIMAGE_EXTRACT_AND_RUN=1
export NO_STRIP=true

# --- .deb / .AppImage ビルド ---
echo "[INFO] .deb / .AppImage パッケージをビルド中..."
echo "[INFO] 初回は Rust のコンパイルがあるため数十分かかることがあります。"
echo ""
# AppImage バンドラは AppRun/linuxdeploy を GitHub から取得するため、
# ネットワーク一時障害で "timeout: global" 失敗することがある。
# コンパイルは target/ にキャッシュされるため再試行は安価。最大3回リトライする。
build_attempt=0
until [[ $build_attempt -ge 3 ]]; do
  if cargo tauri build --config "$BUILD_CONFIG" --bundles deb appimage; then
    break
  fi
  build_attempt=$((build_attempt + 1))
  if [[ $build_attempt -ge 3 ]]; then
    echo "[ERROR] ビルドが3回失敗しました。ログを確認してください。" >&2
    exit 1
  fi
  echo "[WARN] ビルド失敗（$build_attempt 回目）。AppImage ツール取得のタイムアウト等が原因のことがあります。10秒後に再試行..." >&2
  sleep 10
done

# --- AppImage の libwayland-* 除去（Wayland/EGL 衝突対策）---
# linuxdeploy が同梱する libwayland-client / -cursor / -egl などがホストの Mesa
# libEGL と二重ロードされ、新しめのディストロ（例 CachyOS）で
#   "Could not create default EGL display: EGL_BAD_PARAMETER. Aborting..."
# クラッシュ（起動しても真っ白）を起こす。該当ライブラリを AppDir から除去し、
# appimagetool で再パッケージしてホスト側の libwayland/EGL を使わせる。
APPIMAGE_DIR="src-tauri/target/release/bundle/appimage"
if compgen -G "$APPIMAGE_DIR/*.AppImage" >/dev/null 2>&1; then
  echo ""
  echo "[INFO] AppImage の libwayland-* 同梱を除去し再パッケージします（EGL 衝突対策）..."
  TOOL_DIR="src-tauri/target/.appimage-tools"   # target/ は git 管理外
  APPIMAGETOOL="$TOOL_DIR/appimagetool.AppImage"
  mkdir -p "$TOOL_DIR"
  if [[ ! -x "$APPIMAGETOOL" ]]; then
    for i in 1 2 3; do
      if curl -fsSL -o "$APPIMAGETOOL" \
           https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage; then
        chmod +x "$APPIMAGETOOL"; break
      fi
      echo "[WARN] appimagetool 取得失敗（$i 回目）。再試行..." >&2; sleep 5
    done
  fi
  if [[ -x "$APPIMAGETOOL" ]]; then
    for appdir in "$APPIMAGE_DIR"/*.AppDir; do
      [[ -d "$appdir" ]] || continue
      product="$(basename "$appdir" .AppDir)"
      out="$(ls "$APPIMAGE_DIR/$product"*.AppImage 2>/dev/null | head -1)"
      [[ -n "$out" ]] || { echo "[WARN] $product に対応する .AppImage が見つからず、スキップ" >&2; continue; }
      removed="$(find "$appdir" -iname 'libwayland-*' -print -delete 2>/dev/null | wc -l)"
      echo "[INFO] $(basename "$out"): libwayland-* を $removed 個除去し再パッケージ"
      ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGETOOL" --appimage-extract-and-run "$appdir" "$out" \
        && echo "[OK] 再パッケージ完了: $(basename "$out")" \
        || echo "[WARN] 再パッケージに失敗しました。生成 AppImage は新しめのホストで EGL クラッシュするおそれ。" >&2
    done
  else
    echo "[WARN] appimagetool を取得できませんでした。libwayland-* 除去をスキップします。" >&2
    echo "[WARN] 生成 AppImage は CachyOS 等の新しめホストで EGL クラッシュするおそれがあります。" >&2
  fi
fi

echo ""
echo "[OK] ビルドが完了しました。"
echo "[OK] .deb 出力先:      src-tauri/target/release/bundle/deb/"
echo "[OK] .AppImage 出力先: src-tauri/target/release/bundle/appimage/"
echo ""
echo "[INFO] Python パッケージはインストール後にアプリのセットアップ UI からインストールしてください。"
