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
ROOT_DIR="$(pwd)"

TAURI_TARGET_DIR="${CARGO_TARGET_DIR:-src-tauri/target}"
if [[ "$TAURI_TARGET_DIR" != /* ]]; then
  TAURI_TARGET_DIR="$ROOT_DIR/$TAURI_TARGET_DIR"
fi
LICENSE_VENV_DIR="${LOTT_VENV_DIR:-.venv312}"

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
# npm install 済みの開発環境では、プロジェクト固定版を優先して不要なグローバル導入を避ける。
TAURI_CMD=()
if [[ -x "node_modules/.bin/tauri" ]]; then
  TAURI_CMD=("node_modules/.bin/tauri")
elif cargo tauri -V &>/dev/null 2>&1; then
  TAURI_CMD=(cargo tauri)
else
  echo "[INFO] tauri-cli が見つかりません。インストールします..."
  cargo install tauri-cli --locked
  TAURI_CMD=(cargo tauri)
fi
echo "[OK] $("${TAURI_CMD[@]}" -V)"
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
if [[ -d "$LICENSE_VENV_DIR/Lib/site-packages" || -d "$LICENSE_VENV_DIR/lib" ]]; then
  python3 scripts/collect_licenses.py --venv "$LICENSE_VENV_DIR" --frontend frontend --tauri src-tauri --out licenses
  echo "[OK] licenses/THIRD_PARTY_FULL.txt を更新しました"
else
  echo "[WARN] $LICENSE_VENV_DIR が見つかりません。Python 依存のライセンス再収集をスキップします。"
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

# WebKitGTK の音声再生は GStreamer 依存。プラグインを同梱しないと Ubuntu 以外の
# ホストでデコーダがゼロになり、音声ファイルを開いた時点で固まる。
# bundleMediaFramework=true（tauri.*.linux.override.json）で linuxdeploy-plugin-gstreamer が
# ビルドホストの LGPL プラグインを AppDir へ入れる。GPL の bad は明示的に除外する。
export GSTREAMER_INCLUDE_BAD_PLUGINS=0

# --- .deb / .AppImage ビルド ---
echo "[INFO] .deb / .AppImage パッケージをビルド中..."
echo "[INFO] 初回は Rust のコンパイルがあるため数十分かかることがあります。"
echo ""
APPIMAGE_DIR="$TAURI_TARGET_DIR/release/bundle/appimage"
BUILD_MARKER="$TAURI_TARGET_DIR/.appimage-build-start"
mkdir -p "$(dirname "$BUILD_MARKER")"
touch "$BUILD_MARKER"
# AppImage バンドラは AppRun/linuxdeploy を GitHub から取得するため、
# ネットワーク一時障害で "timeout: global" 失敗することがある。
# コンパイルは target/ にキャッシュされるため再試行は安価。最大3回リトライする。
build_attempt=0
until [[ $build_attempt -ge 3 ]]; do
  if "${TAURI_CMD[@]}" build --config "$BUILD_CONFIG" --bundles deb appimage; then
    break
  fi
  # linuxdeploy はAppDirを完成させた後、最終AppImage化だけ失敗することがある。
  # 必須構造が揃っていれば後段のappimagetoolで安全に再梱包できるため、再コンパイルしない。
  complete_appdir=""
  for candidate in "$APPIMAGE_DIR"/*.AppDir; do
    if [[ -x "$candidate/AppRun" && -x "$candidate/usr/bin/offline-transcriber" \
          && "$candidate/usr/bin/offline-transcriber" -nt "$BUILD_MARKER" ]]; then
      complete_appdir="$candidate"
      break
    fi
  done
  if [[ -n "$complete_appdir" ]]; then
    echo "[WARN] linuxdeploy の最終梱包に失敗しました。完成済みAppDirから直接再梱包します。" >&2
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
if compgen -G "$APPIMAGE_DIR/*.AppDir" >/dev/null 2>&1; then
  echo ""
  echo "[INFO] AppImage の libwayland-* 同梱を除去し再パッケージします（EGL 衝突対策）..."
  TOOL_DIR="$TAURI_TARGET_DIR/.appimage-tools"   # target/ は git 管理外
  APPIMAGETOOL="$TOOL_DIR/appimagetool.AppImage"
  APPIMAGE_RUNTIME="$TOOL_DIR/runtime-x86_64"
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
  if [[ ! -f "$APPIMAGE_RUNTIME" ]]; then
    for i in 1 2 3; do
      if curl -fsSL -o "$APPIMAGE_RUNTIME" \
           https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64; then
        break
      fi
      echo "[WARN] AppImage runtime 取得失敗（$i 回目）。再試行..." >&2; sleep 5
    done
  fi
  if [[ -x "$APPIMAGETOOL" && -f "$APPIMAGE_RUNTIME" ]]; then
    app_version="$(node -p "require('./src-tauri/tauri.conf.json').version")"
    for appdir in "$APPIMAGE_DIR"/*.AppDir; do
      [[ -d "$appdir" ]] || continue
      product="$(basename "$appdir" .AppDir)"
      out=""
      for existing_appimage in "$APPIMAGE_DIR/$product"*.AppImage; do
        [[ -f "$existing_appimage" ]] || continue
        out="$existing_appimage"
        break
      done
      [[ -n "$out" ]] || out="$APPIMAGE_DIR/${product}_${app_version}_amd64.AppImage"
      removed="$(find "$appdir" -iname 'libwayland-*' -print -delete 2>/dev/null | wc -l)"

      # --- GStreamer 同梱の検証と後始末 ---
      gst_dir="$appdir/usr/lib/gstreamer-1.0"
      if [[ ! -d "$gst_dir" ]] || ! compgen -G "$gst_dir/libgst*.so" >/dev/null 2>&1; then
        echo "[ERROR] AppDir に GStreamer プラグインがありません。音声の読み込み・再生ができない AppImage になります。" >&2
        echo "[ERROR] bundleMediaFramework の設定と、ビルドホストの gstreamer1.0-plugins-base/good を確認してください。" >&2
        exit 1
      fi
      # 配布ライセンス方針（AGENTS.md）: GPL プラグインを配布物に含めない。
      for forbidden in libgstlibav.so libgstfaad.so libgstx264.so libgstmpeg2dec.so libgstasf.so; do
        if [[ -e "$gst_dir/$forbidden" ]]; then
          echo "[ERROR] GPL の GStreamer プラグインが AppDir に入っています: $forbidden" >&2
          exit 1
        fi
      done
      # 同梱コアはホストより古いことがある。ホスト共有のレジストリ（~/.cache/gstreamer-1.0）を
      # 読み書きするとホスト側 GStreamer アプリのキャッシュを壊すため、専用パスへ分ける。
      # AppRun は set -e で hook を source するため、失敗しうる行は必ず握りつぶす。
      gst_hook="$appdir/apprun-hooks/linuxdeploy-plugin-gstreamer.sh"
      if [[ -f "$gst_hook" ]] && ! grep -q 'GST_REGISTRY_1_0' "$gst_hook"; then
        {
          printf '\n_lott_gst_cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/%s"\n' "$product"
          printf 'mkdir -p "$_lott_gst_cache_dir" 2>/dev/null || true\n'
          printf 'export GST_REGISTRY_1_0="$_lott_gst_cache_dir/gstreamer-registry.bin"\n'
        } >>"$gst_hook"
      fi
      echo "[INFO] $(basename "$out"): GStreamer プラグイン $(find "$gst_dir" -name 'libgst*.so' | wc -l) 個を同梱"

      ln -sfn "$product.png" "$appdir/.DirIcon"
      echo "[INFO] $(basename "$out"): libwayland-* を $removed 個除去し再パッケージ"
      ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGETOOL" --appimage-extract-and-run \
        --runtime-file "$APPIMAGE_RUNTIME" "$appdir" "$out" \
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
echo "[OK] .deb 出力先:      $TAURI_TARGET_DIR/release/bundle/deb/"
echo "[OK] .AppImage 出力先: $TAURI_TARGET_DIR/release/bundle/appimage/"
echo ""
echo "[INFO] Python パッケージはインストール後にアプリのセットアップ UI からインストールしてください。"
