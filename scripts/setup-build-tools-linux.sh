#!/usr/bin/env bash
# setup-build-tools-linux.sh
# Ubuntu 向け NSIS に相当するビルドスクリプト。
# .deb / .AppImage パッケージを配布ライン別にビルドする。
# 引数無しは NVIDIA、--amd / --cpu / --editor で各ラインを明示する。
#
# glibc 互換のため、リリースビルドは古めの Ubuntu（例 24.04）コンテナ内で
# 実行すること。詳細は scripts/run-dev-docker-ubuntu.sh を参照。
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT_DIR="$(pwd)"

LICENSE_VENV_DIR="${LOTT_VENV_DIR:-}"

CONFIG_NVIDIA="tauri.nvidia.linux.override.json"
CONFIG_AMD="tauri.amd.linux.override.json"
CONFIG_CPU="tauri.cpu.linux.override.json"
CONFIG_EDITOR="tauri.editor.linux.override.json"
BUILD_CONFIG="$CONFIG_NVIDIA"
BUILD_LINE="NVIDIA CUDA"
BUILD_OPTION=""
BUILD_VARIANT="nvidia"
DRY_RUN=0

usage() {
  cat <<EOF
Usage: $0 [--amd | --cpu | --editor] [--dry-run]

  (デフォルト) NVIDIA CUDA 版 .deb / .AppImage をビルドします。
  --amd        AMD ROCm 版をビルドします。
  --cpu        CPU 版をビルドします。
  --editor     軽量 Editor 版をビルドします。
  --dry-run    ビルドせず、選択した設定・AppDir 選別・規約名の生成予定だけを表示します。
  -h, --help   このヘルプを表示します。
EOF
}

select_build_line() {
  local option="$1"
  local line="$2"
  local config="$3"
  local variant="$4"
  if [[ -n "$BUILD_OPTION" ]]; then
    echo "[ERROR] 配布ライン指定は1つだけ指定してください。" >&2
    exit 2
  fi
  BUILD_OPTION="$option"
  BUILD_LINE="$line"
  BUILD_CONFIG="$config"
  BUILD_VARIANT="$variant"
}

# --- オプション解析 ---
for arg in "$@"; do
  case "$arg" in
    --amd) select_build_line "--amd" "AMD ROCm" "$CONFIG_AMD" "amd" ;;
    --cpu) select_build_line "--cpu" "CPU" "$CONFIG_CPU" "cpu" ;;
    --editor) select_build_line "--editor" "Editor" "$CONFIG_EDITOR" "editor" ;;
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

if [[ -z "$LICENSE_VENV_DIR" ]]; then
  case "$BUILD_VARIANT" in
    nvidia) LICENSE_VENV_DIR=".venv312-nvidia" ;;
    amd) LICENSE_VENV_DIR=".venv312-amd" ;;
    cpu|editor) LICENSE_VENV_DIR=".venv312-cpu" ;;
  esac
fi

if ! command -v python3 &>/dev/null; then
  echo "[ERROR] python3 が見つかりません。" >&2
  exit 1
fi

TAURI_TARGET_DIR="${CARGO_TARGET_DIR:-src-tauri/target}"
if [[ "$TAURI_TARGET_DIR" != /* ]]; then
  TAURI_TARGET_DIR="$ROOT_DIR/$TAURI_TARGET_DIR"
fi
APPIMAGE_DIR="$TAURI_TARGET_DIR/release/bundle/appimage"
BUILD_MARKER="$TAURI_TARGET_DIR/.appimage-build-start"

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

appdir_is_current_build() {
  local candidate="$1"
  local candidate_product
  candidate_product="$(basename "$candidate" .AppDir)"

  if [[ "$candidate_product" != "$PRODUCT_NAME" ]]; then
    APPDIR_MATCH_REASON="別の配布ライン: $candidate_product"
    return 1
  fi

  if [[ ! -e "$BUILD_MARKER" ]]; then
    APPDIR_MATCH_REASON="productName 一致（BUILD_MARKER なし）"
    return 0
  fi

  if [[ -e "$candidate/usr/bin/offline-transcriber" && "$candidate/usr/bin/offline-transcriber" -nt "$BUILD_MARKER" ]] \
      || [[ "$candidate" -nt "$BUILD_MARKER" ]]; then
    APPDIR_MATCH_REASON="productName 一致（BUILD_MARKER より新しい AppDir）"
    return 0
  fi

  echo "[WARN] 今回のビルドで再生成されていない AppDir を再梱包します: $(basename "$candidate")（BUILD_MARKER より新しくありません）" >&2
  APPDIR_MATCH_REASON="productName 一致（BUILD_MARKER より新しくないため警告）"
  return 0
}

print_appdir_selection() {
  local candidate
  local found=0
  if [[ ! -d "$APPIMAGE_DIR" ]]; then
    echo "[INFO] AppImage AppDir はまだありません。"
    return 0
  fi
  for candidate in "$APPIMAGE_DIR"/*.AppDir; do
    [[ -d "$candidate" ]] || continue
    if appdir_is_current_build "$candidate"; then
      echo "[INFO] AppDir 対象: $(basename "$candidate")（$APPDIR_MATCH_REASON）"
      found=1
    else
      echo "[INFO] AppDir 対象外のためスキップ: $(basename "$candidate")（$APPDIR_MATCH_REASON）"
    fi
  done
  if [[ "$found" -eq 0 ]]; then
    echo "[INFO] 今回の配布ラインに再梱包できる AppDir はありません。"
  fi
}

echo "=== Build .deb / .AppImage (Ubuntu) ==="
echo "  配布ライン: $BUILD_LINE"
echo "  override 設定ファイル: $BUILD_CONFIG"
echo "  productName: $PRODUCT_NAME"
echo "  identifier: $IDENTIFIER"
echo ""

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[DRY-RUN] Tauri: build --config $BUILD_CONFIG --bundles deb appimage"
  echo "[DRY-RUN] AppDir 選別規則: productName 一致を必須とし、別の配布ラインはスキップ。同一ラインは AppDir または offline-transcriber が BUILD_MARKER より新しければ対象、古くても WARN 付きで再梱包。BUILD_MARKER なしは mtime 比較せず対象"
  print_appdir_selection
  python3 scripts/collect_release_artifacts.py \
    --platform linux \
    --variant "$BUILD_VARIANT" \
    --source-dir "$TAURI_TARGET_DIR/release/bundle/deb" \
    --source-dir "$APPIMAGE_DIR" \
    --dry-run
  exit 0
fi

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

if [[ "$BUILD_VARIANT" == "nvidia" ]]; then
  # Linux CUDA has no official llama.cpp release archive.  The host-side
  # build-appimage-docker.sh / build-arch-package.sh prepares this resource
  # from the pinned b10075 source before entering this build step.
  if ! bash scripts/build-llama-server-cuda-linux.sh --check; then
    echo '[ERROR] Linux NVIDIA CUDA llama-serverがありません。' >&2
    echo '        先に bash scripts/build-llama-server-cuda-linux.sh --ensure を実行してください。' >&2
    exit 1
  fi
fi
echo "[INFO] LLM校正: llama.cpp llama-serverを直接起動します（NVIDIA Linuxは同梱CUDA、AMDはROCm/Vulkan）。"
echo ""

# --- 同梱 Python から readline 拡張モジュールを外す ---
# これを残すと linuxdeploy が依存の libreadline.so.8 を AppDir/usr/lib へ入れ、
# AppRun の LD_LIBRARY_PATH 経由でホストの /bin/sh（Arch 系 bash 5.3 = readline 8.3）が
# 古い 8.2 を掴んで `undefined symbol: rl_print_keybinding` で即死する。
# サイドカーも pip も readline を使わないため、同梱しないのが最も安全。
PY_DYNLOAD_DIR="src-tauri/resources/python312-linux/lib/python3.12/lib-dynload"
PY_SITECUSTOMIZE="src-tauri/resources/python312-linux/lib/python3.12/sitecustomize.py"
# Ubuntu の Python 配置をコピーすると、sitecustomize.py が
# /etc/python3.12/sitecustomize.py への絶対 symlink のまま残ることがある。
# CachyOS 等ではリンク先が無く、Tauri の resource 収集がビルド前に失敗する。
# 埋め込み Python はホストの /etc 設定を取り込まないため、壊れたリンクだけ除去する。
if [[ -L "$PY_SITECUSTOMIZE" && ! -e "$PY_SITECUSTOMIZE" ]]; then
  rm -f "$PY_SITECUSTOMIZE"
  echo "[OK] 同梱 Python の壊れた sitecustomize.py symlink を除外しました"
fi
if compgen -G "$PY_DYNLOAD_DIR/readline.cpython-*.so" >/dev/null 2>&1; then
  rm -f "$PY_DYNLOAD_DIR"/readline.cpython-*.so
  echo "[OK] 同梱 Python の readline 拡張モジュールを除外しました（ホスト /bin/sh 保護）"
fi
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
          && "$candidate/usr/bin/offline-transcriber" -nt "$BUILD_MARKER" \
          && "$(basename "$candidate" .AppDir)" == "$PRODUCT_NAME" ]]; then
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
    selected_appdir_count=0
    for appdir in "$APPIMAGE_DIR"/*.AppDir; do
      [[ -d "$appdir" ]] || continue
      if ! appdir_is_current_build "$appdir"; then
        echo "[INFO] AppDir 対象外のためスキップ: $(basename "$appdir")（$APPDIR_MATCH_REASON）"
        continue
      fi
      selected_appdir_count=$((selected_appdir_count + 1))
      product="$(basename "$appdir" .AppDir)"
      echo "[INFO] AppDir を再梱包します: $product（$APPDIR_MATCH_REASON）"
      out=""
      for existing_appimage in "$APPIMAGE_DIR/$product"*.AppImage; do
        [[ -f "$existing_appimage" ]] || continue
        if [[ "$existing_appimage" -nt "$BUILD_MARKER" ]]; then
          out="$existing_appimage"
          break
        fi
      done
      [[ -n "$out" ]] || out="$APPIMAGE_DIR/${product}_${app_version}_amd64.AppImage"
      removed="$(find "$appdir" -iname 'libwayland-*' -print -delete 2>/dev/null | wc -l)"

      # --- ホストの /bin/sh を壊す同梱 readline の除去 ---
      # AppRun は $APPDIR/usr/lib を LD_LIBRARY_PATH 先頭へ入れ、それが子・孫プロセスまで
      # 継承される。Ubuntu 24.04 の libreadline.so.8（8.2）には Arch 系ホストの bash 5.3 が
      # 要求する rl_print_keybinding が無いため、AppImage から起動したホストの /bin/sh が
      #   /bin/sh: symbol lookup error: /bin/sh: undefined symbol: rl_print_keybinding
      # で即死し、#!/bin/sh スクリプトである xdg-open などが一切動かなくなる。
      # AppDir 内で readline を必要とするのは同梱 Python の任意モジュールだけなので、
      # 拡張モジュールごと外す（import readline は ImportError になるだけで、pip も
      # サイドカーも readline を使わない）。
      # 実行時側の根本対策は Rust の apply_host_command_env（ホストコマンドへ AppDir 環境を渡さない）。
      readline_removed="$(find "$appdir" \
        \( -name 'libreadline.so*' -o -name 'libhistory.so*' -o -name 'readline.cpython-*.so' \) \
        -print -delete 2>/dev/null | wc -l)"
      echo "[INFO] $(basename "$out"): readline 関連 $readline_removed 件を除去（ホスト /bin/sh 保護）"
      if find "$appdir" \( -name 'libreadline.so*' -o -name 'libhistory.so*' \) | grep -q .; then
        echo "[ERROR] AppDir に libreadline/libhistory が残っています。ホストの /bin/sh が壊れます。" >&2
        exit 1
      fi

      # --- GTK の表示バックエンドと IME 経路をセッションに合わせる ---
      # linuxdeploy-plugin-gtk は Wayland セッションでも GDK_BACKEND=x11 を強制する。
      # Wayland 側の fcitx5 は GTK 組み込み im-wayland と text-input 経路を使えるため、
      # 生成済み hook の既定値だけを置き換える。AppDir cache に存在する
      # ユーザー指定値は hook 内で尊重し、存在しない値だけ対応する module へ救済する。
      # X11 側の GTK_IM_MODULE は、XMODIFIERS があるときだけ xim にする。
      # XMODIFIERS が無い環境では XIM を有効化しない。
      # GTK_IM_MODULE_FILE は AppDir 内 GTK と同じビルドで生成された cache を使い、
      # ホスト側の GTK immodule を混在させない（fcitx5-gtk の同梱・ABI依存は行わない）。
      gtk_hook="$appdir/apprun-hooks/linuxdeploy-plugin-gtk.sh"
      if [[ -f "$gtk_hook" ]] && ! grep -q 'LOTT_GTK_BACKEND_IME_POLICY' "$gtk_hook"; then
        if grep -q '^export GDK_BACKEND=x11' "$gtk_hook"; then
          sed -i \
            '/^export GDK_BACKEND=x11/c\
# LOTT_GTK_BACKEND_IME_POLICY\
if [[ -n "${LOTT_GDK_BACKEND:-}" ]]; then\
  export GDK_BACKEND="${LOTT_GDK_BACKEND}"\
elif [[ -z "${GDK_BACKEND:-}" ]]; then\
  if [[ "${XDG_SESSION_TYPE:-}" == "wayland" && -n "${WAYLAND_DISPLAY:-}" ]]; then\
    export GDK_BACKEND=wayland\
  else\
    export GDK_BACKEND=x11\
  fi\
fi\
_lott_gtk_immodules_file="$APPDIR//usr/lib/x86_64-linux-gnu/gtk-3.0/3.0.0/immodules.cache"\
_lott_gtk_im_module_has_entry() {\
  [[ -f "$_lott_gtk_immodules_file" ]] && grep -Fq "\\\"$1\\\"" "$_lott_gtk_immodules_file"\
}\
_lott_gtk_backend="${GDK_BACKEND%%,*}"\
if [[ "$_lott_gtk_backend" == "wayland" ]]; then\
  if [[ -n "${GTK_IM_MODULE:-}" ]]; then\
    if ! _lott_gtk_im_module_has_entry "${GTK_IM_MODULE}" && _lott_gtk_im_module_has_entry wayland; then\
      export GTK_IM_MODULE=wayland\
    fi\
  elif _lott_gtk_im_module_has_entry wayland; then\
    export GTK_IM_MODULE=wayland\
  fi\
else\
  if [[ -n "${GTK_IM_MODULE:-}" ]]; then\
    if ! _lott_gtk_im_module_has_entry "${GTK_IM_MODULE}" && [[ -n "${XMODIFIERS:-}" ]] && _lott_gtk_im_module_has_entry xim; then\
      export GTK_IM_MODULE=xim\
    fi\
  elif [[ -n "${XMODIFIERS:-}" ]] && _lott_gtk_im_module_has_entry xim; then\
    export GTK_IM_MODULE=xim\
  fi\
fi' "$gtk_hook"
          echo "[OK] GTK hook の GDK/IME 経路を Wayland/X11 セッション別に設定しました"
        else
          echo "[INFO] GTK hook に GDK_BACKEND=x11 の強制がないため IME rewrite をスキップします"
        fi
      fi

      # ホストの基本コマンドが動的リンクするライブラリを同梱していると、同じ経路で
      # 別の undefined symbol を踏みうる。除去はせず、把握のために一覧だけ出す。
      host_risk="$(find "$appdir/usr/lib" -maxdepth 1 \
        \( -name 'libncursesw.so*' -o -name 'libtinfo.so*' -o -name 'libcurl.so*' \
           -o -name 'libssl.so*' -o -name 'libcrypto.so*' -o -name 'libstdc++.so*' \) \
        -printf '%f ' 2>/dev/null)"
      if [[ -n "${host_risk// /}" ]]; then
        echo "[WARN] ホストコマンドと共有されうるライブラリを同梱しています: $host_risk" >&2
        echo "[WARN] ホスト側コマンドの起動は apply_host_command_env で AppDir 環境を外すこと。" >&2
      fi

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
    if [[ "$selected_appdir_count" -eq 0 ]]; then
      echo "[INFO] 今回の配布ラインに再梱包できる AppDir はありません。"
    fi
  else
    echo "[WARN] appimagetool を取得できませんでした。libwayland-* 除去をスキップします。" >&2
    echo "[WARN] 生成 AppImage は CachyOS 等の新しめホストで EGL クラッシュするおそれがあります。" >&2
  fi
fi

list_new_artifacts() {
  local found=0
  local artifact
  local artifact_dir
  for artifact_dir in "$TAURI_TARGET_DIR/release/bundle/deb" "$APPIMAGE_DIR"; do
    [[ -d "$artifact_dir" ]] || continue
    while IFS= read -r -d '' artifact; do
      printf '  %s (%s bytes)\n' "$(basename "$artifact")" "$(stat -c '%s' "$artifact")"
      found=1
    done < <(find "$artifact_dir" -maxdepth 1 -type f \
      \( -name '*.deb' -o -name '*.AppImage' \) -newer "$BUILD_MARKER" -print0 | sort -z)
  done
  if [[ "$found" -eq 0 ]]; then
    echo "  [WARN] BUILD_MARKER 以降に生成された .deb / .AppImage が見つかりません。"
  fi
}

echo ""
echo "[OK] ビルドが完了しました。"
echo "[OK] 生成成果物（今回の BUILD_MARKER 以降）:"
list_new_artifacts
echo ""
echo "[INFO] リリース用の規約名へ成果物を配置中..."
if ! python3 scripts/collect_release_artifacts.py \
  --platform linux \
  --variant "$BUILD_VARIANT" \
  --source-dir "$TAURI_TARGET_DIR/release/bundle/deb" \
  --source-dir "$APPIMAGE_DIR"; then
  echo "[ERROR] リリース用成果物の集約に失敗しました。" >&2
  exit 1
fi
echo ""
echo "[INFO] Python パッケージはインストール後にアプリのセットアップ UI からインストールしてください。"
