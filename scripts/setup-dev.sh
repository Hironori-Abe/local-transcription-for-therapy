#!/usr/bin/env bash
# Linux 開発環境のセットアップ（Full / Editor 共通）。
#
#   bash scripts/setup-dev.sh [-y] [--skip-apt] [--skip-rust] [--only-rust]
#                             [--skip-engines] [--skip-models] [--editor]
#
# やること:
#   1. システムパッケージ（Tauri / WebKitGTK / GStreamer / Vulkan ヘッダー・glslc / ビルドツール）
#   2. npm install（ルートと frontend）
#   3. Rustup / Cargo の確認
#   4. ggml 音声エンジン（whisper.cpp / NeMo-Speech.cpp の Vulkan 版）とモデルの取得
#      -> scripts/setup-ggml-speech-linux.sh（python_sidecar/speech-engines と python_sidecar/models へ配置）
#   5. LGPL ffmpeg CLI の取得（Full のみ。src-tauri/resources/ffmpeg）
#
# Python の venv / pip / PyTorch / llama.cpp は使わない。python3 は ffmpeg 取得スクリプト
# （標準ライブラリのみ）を動かすためだけに使う。
# 起動:  bash scripts/run-dev.sh（Full） / bash scripts/run-dev-editor.sh（Editor）
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

HAS_WARN=0
SKIP_APT=0
SKIP_RUST=0
ONLY_RUST=0
SKIP_ENGINES=0
SKIP_MODELS=0
EDITOR_ONLY=0
ASSUME_YES=0

usage() {
  cat <<'EOF'
Usage: scripts/setup-dev.sh [options]

Options:
  -y, --yes         Install packages without prompting (apt / pacman).
  --skip-apt        Skip system package installation (apt on Ubuntu, pacman on CachyOS/Arch).
  --skip-rust       Skip Rustup/Cargo installation and check.
  --only-rust       Only install/check Rustup/Cargo, then exit.
  --skip-engines    Skip building the ggml speech engines (whisper.cpp / NeMo-Speech.cpp).
  --skip-models     Skip downloading the ggml models (Whisper, Silero VAD, Nemotron).
  --editor          Prepare only what the Editor edition needs (whisper.cpp; no NeMo, no ffmpeg).
  -h, --help        Show this help.

The speech engines are built with Vulkan (NVIDIA / AMD / Intel share one build; without a
GPU they run on the CPU). The network is only used during this setup.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes) ASSUME_YES=1 ;;
    --skip-apt) SKIP_APT=1 ;;
    --skip-rust) SKIP_RUST=1 ;;
    --only-rust) ONLY_RUST=1 ;;
    --skip-engines) SKIP_ENGINES=1 ;;
    --skip-models) SKIP_MODELS=1 ;;
    --editor) EDITOR_ONLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      printf '[ERROR] Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

info() {
  printf '[INFO] %s\n' "$*"
}

ok() {
  printf '[OK] %s\n' "$*"
}

warn() {
  printf '[WARN] %s\n' "$*" >&2
  HAS_WARN=1
}

die() {
  printf '[ERROR] %s\n' "$*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

SUDO_CMD=()

ensure_sudo() {
  SUDO_CMD=()
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    if [[ -r /proc/self/status ]] && awk '$1 == "NoNewPrivs:" && $2 == "1" { found = 1 } END { exit !found }' /proc/self/status; then
      warn "Privilege escalation is disabled for this terminal (NoNewPrivs=1)."
      warn "Open an independent terminal from the desktop application launcher (not a Codex/VS Code integrated terminal), verify that 'grep NoNewPrivs /proc/self/status' reports 0, and rerun this setup there."
      return 1
    fi
    if ! have sudo; then
      warn "sudo was not found. Cannot install system packages automatically."
      return 1
    fi
    SUDO_CMD=(sudo)
  fi
}

confirm_default_yes() {
  local prompt="$1"
  local reply

  if [[ "$ASSUME_YES" == "1" ]]; then
    return 0
  fi

  if [[ ! -t 0 ]]; then
    return 1
  fi

  read -r -p "$prompt [Y/n] " reply || return 1
  [[ -z "$reply" || "$reply" =~ ^[Yy]$ ]]
}

apt_has_package() {
  apt-cache show "$1" >/dev/null 2>&1
}

verify_linux_audio_plugins() {
  local required=(playbin3 id3demux mpg123audiodec flacdec)
  local missing=()
  local element

  if ! have gst-inspect-1.0; then
    missing=("gst-inspect-1.0" "${required[@]}")
  else
    for element in "${required[@]}"; do
      if ! gst-inspect-1.0 "$element" >/dev/null 2>&1; then
        missing+=("$element")
      fi
    done
  fi

  if [[ "${#missing[@]}" -ne 0 ]]; then
    warn "Required system GStreamer components are missing: ${missing[*]}"
    if have pacman; then
      die "Install the system prerequisites in an unrestricted terminal with 'sudo pacman -S --needed gst-plugins-base gst-plugins-good', then rerun this setup."
    fi
    die "Install the system prerequisites with 'sudo apt-get install gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-pulseaudio', then rerun this setup."
  fi

  ok "Verified Linux audio playback dependencies: ${required[*]}"
}

_install_pacman_system_packages() {
  if ! confirm_default_yes "Install/update CachyOS/Arch system packages for Tauri and the Vulkan speech engine build?"; then
    info "Skipped pacman system package installation."
    return
  fi

  ensure_sudo || die "Administrator privileges are required to install CachyOS/Arch system packages."

  # Ubuntu パッケージとの対応:
  #   build-essential → base-devel  |  libwebkit2gtk-4.1-dev → webkit2gtk-4.1
  #   libgtk-3-dev    → gtk3        |  librsvg2-dev          → librsvg
  #   libssl-dev      → openssl     |  libxdo-dev            → xdotool
  #   libvulkan-dev   → vulkan-headers + vulkan-icd-loader
  #   glslc           → shaderc     |  spirv-headers         → spirv-headers
  #   ninja-build     → ninja       |  pkg-config            → pkgconf
  # Arch では -dev サフィックスなし・ヘッダーは本体パッケージに含まれる
  local packages=(
    base-devel
    cmake
    curl
    file
    git
    gst-plugins-base
    gst-plugins-good
    gtk3
    libayatana-appindicator
    librsvg
    mesa
    ninja
    openssl
    patchelf
    pkgconf
    python
    shaderc
    spirv-headers
    unzip
    vulkan-headers
    vulkan-icd-loader
    vulkan-tools
    webkit2gtk-4.1
    wget
    xdg-desktop-portal
    xdg-desktop-portal-gtk
    xdotool
    zenity
  )

  info "Installing pacman packages..."
  if ! "${SUDO_CMD[@]}" pacman -S --needed --noconfirm "${packages[@]}"; then
    die "pacman package installation failed. Resolve the error above, then rerun scripts/setup-dev.sh."
  fi

  verify_linux_audio_plugins
}

install_system_packages() {
  if [[ "$SKIP_APT" == "1" ]]; then
    info "Skipping system package installation."
    return
  fi

  if ! have apt-get; then
    if have pacman; then
      _install_pacman_system_packages
      return
    fi
    warn "apt-get / pacman was not found. Install Tauri/Linux system dependencies manually."
    return
  fi

  if ! confirm_default_yes "Install/update Ubuntu system packages for Tauri and the Vulkan speech engine build?"; then
    info "Skipped apt system package installation."
    return
  fi

  ensure_sudo || die "Administrator privileges are required to install Ubuntu system packages."

  info "Updating apt package index..."
  if ! "${SUDO_CMD[@]}" apt-get update; then
    warn "apt-get update failed. Continuing with existing system packages."
  fi

  # glslc / spirv-headers / libvulkan-dev は ggml-vulkan のビルドに必要（Ubuntu 24.04 で確認する名前）。
  # mesa-vulkan-drivers は GPU 実行用のホスト側 Vulkan ドライバー（無ければ CPU 実行）。
  local packages=(
    build-essential
    cmake
    curl
    file
    git
    glslc
    gpg
    gstreamer1.0-plugins-base
    gstreamer1.0-plugins-good
    gstreamer1.0-pulseaudio
    libayatana-appindicator3-dev
    libgtk-3-dev
    librsvg2-dev
    libssl-dev
    libvulkan-dev
    libxdo-dev
    mesa-vulkan-drivers
    ninja-build
    patchelf
    pkg-config
    python3
    spirv-headers
    unzip
    vulkan-tools
    wget
    xdg-desktop-portal
    xdg-desktop-portal-gtk
    zenity
  )

  if apt_has_package libwebkit2gtk-4.1-dev; then
    packages+=(libwebkit2gtk-4.1-dev)
  elif apt_has_package libwebkit2gtk-4.0-dev; then
    packages+=(libwebkit2gtk-4.0-dev)
    warn "Using libwebkit2gtk-4.0-dev fallback because libwebkit2gtk-4.1-dev was not found."
  else
    warn "No WebKitGTK dev package was found in apt cache. Tauri may fail until it is installed."
  fi

  info "Installing apt packages..."
  if ! "${SUDO_CMD[@]}" apt-get install -y "${packages[@]}"; then
    die "apt package installation failed. Resolve the error above, then rerun scripts/setup-dev.sh."
  fi
  verify_linux_audio_plugins
}

check_node() {
  have npm || die "npm was not found. Install Node.js LTS, then rerun this script."

  if have node; then
    local node_version node_major
    node_version="$(node -p "process.versions.node" 2>/dev/null || true)"
    node_major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
    info "Node.js version: ${node_version:-unknown}"
    if [[ "$node_major" =~ ^[0-9]+$ ]] && (( node_major < 20 )); then
      warn "Node.js 20+ is recommended for Angular 21."
    fi
  else
    warn "node was not found, but npm exists. Frontend install may fail."
  fi
}

install_npm_dependencies() {
  info "[2/5] npm install (root)..."
  npm install || die "npm install failed."

  info "[2/5] npm install (frontend)..."
  npm --prefix frontend install || die "frontend npm install failed."
}

load_cargo_env() {
  if [[ -f "$HOME/.cargo/env" ]]; then
    # shellcheck disable=SC1090
    source "$HOME/.cargo/env"
  elif [[ -d "$HOME/.cargo/bin" ]]; then
    export PATH="$HOME/.cargo/bin${PATH:+:$PATH}"
  fi
}

check_rust() {
  info "[3/5] Rust/cargo..."

  if [[ "$SKIP_RUST" == "1" ]]; then
    info "Skipping Rustup/Cargo setup."
    return
  fi

  load_cargo_env
  if have cargo; then
    ok "$(cargo --version)"
    if have rustc; then
      ok "$(rustc --version)"
    fi
    return
  fi

  if ! have curl; then
    die "cargo was not found and curl is unavailable. Install curl or Rustup, then rerun this script."
  fi

  if ! confirm_default_yes "Install Rustup/Cargo for Tauri development?"; then
    die "cargo is required for Tauri development. Install Rustup or rerun with -y."
  fi

  local rustup_installer
  rustup_installer="$(mktemp)"

  info "Downloading Rustup installer..."
  if ! curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o "$rustup_installer"; then
    rm -f "$rustup_installer"
    die "Failed to download Rustup installer."
  fi

  info "Installing Rustup/Cargo..."
  if ! sh "$rustup_installer" -y --profile minimal --default-toolchain stable; then
    rm -f "$rustup_installer"
    die "Rustup installation failed."
  fi
  rm -f "$rustup_installer"

  load_cargo_env
  if have cargo; then
    ok "$(cargo --version)"
    if have rustc; then
      ok "$(rustc --version)"
    fi
  else
    die "cargo is still not available. Run: source \"$HOME/.cargo/env\""
  fi
}

# ggml-vulkan のビルドに必要なものと、ホスト側 Vulkan の状態を確認する。
check_vulkan_build_tools() {
  info "[4/5] Vulkan build prerequisites..."
  local missing=()
  have cmake || missing+=(cmake)
  have ninja || missing+=(ninja)
  have git || missing+=(git)
  have glslc || missing+=(glslc)
  have patchelf || missing+=(patchelf)
  have c++ || missing+=(c++)
  if [[ ! -f /usr/include/vulkan/vulkan.h ]]; then
    missing+=("vulkan headers (libvulkan-dev / vulkan-headers)")
  fi
  if [[ "${#missing[@]}" -gt 0 ]]; then
    die "Missing build prerequisites: ${missing[*]}. Run scripts/setup-dev.sh without --skip-apt (or install them manually)."
  fi
  if [[ ! -f /usr/include/spirv/unified1/spirv.hpp ]]; then
    info "SPIRV-Headers was not found in the system; setup-ggml-speech-linux.sh will build the pinned one into its cache."
  fi
  ok "Vulkan build tools: glslc, cmake, ninja, patchelf"

  if have vulkaninfo; then
    if vulkaninfo --summary 2>/dev/null | grep -q 'deviceName'; then
      ok "A Vulkan device was found (GPU execution is available)."
    else
      warn "vulkaninfo found no Vulkan device. The engines will run on the CPU. Install the GPU vendor's Vulkan driver (e.g. mesa-vulkan-drivers / nvidia-utils) for GPU execution."
    fi
  else
    info "vulkaninfo was not found (vulkan-tools). Skipping the Vulkan device check."
  fi
}

setup_speech_engines() {
  if [[ "$SKIP_ENGINES" == "1" && "$SKIP_MODELS" == "1" ]]; then
    info "[4/5] Skipping ggml speech engines and models."
    return
  fi
  local args=(--backend vulkan)
  [[ "$SKIP_ENGINES" == "1" ]] && args+=(--skip-build)
  [[ "$SKIP_MODELS" == "1" ]] && args+=(--skip-models)
  [[ "$EDITOR_ONLY" == "1" ]] && args+=(--skip-nemo)
  if [[ "$SKIP_ENGINES" != "1" ]]; then
    check_vulkan_build_tools
  fi
  info "[4/5] Preparing ggml speech engines (bash scripts/setup-ggml-speech-linux.sh ${args[*]})..."
  bash scripts/setup-ggml-speech-linux.sh "${args[@]}" || die "Failed to prepare the ggml speech engines."
}

setup_ffmpeg() {
  if [[ "$EDITOR_ONLY" == "1" ]]; then
    info "[5/5] Editor does not bundle ffmpeg. Skipping."
    return
  fi
  have python3 || die "python3 was not found (needed only to fetch the LGPL ffmpeg CLI)."
  info "[5/5] Ensuring the LGPL ffmpeg CLI (src-tauri/resources/ffmpeg)..."
  python3 scripts/setup_ffmpeg_lgpl.py --platform linux --variant lgpl || die "Failed to prepare the LGPL ffmpeg CLI."
}

doctor_summary() {
  echo
  if [[ "$HAS_WARN" == "1" ]]; then
    echo "[WARN] Setup finished with warnings. Review the messages above."
  else
    echo "[OK] Setup finished."
  fi
  if [[ "$EDITOR_ONLY" == "1" ]]; then
    echo "  Start the Editor edition:  bash scripts/run-dev-editor.sh"
  else
    echo "  Start the Full edition:    bash scripts/run-dev.sh"
  fi
  echo "  Engines: python_sidecar/speech-engines/   Models: python_sidecar/models/"
  echo "  Ubuntu / Linux: prefer deb-based browsers/system libraries over Snap builds (Snap Chrome/Chromium can conflict with WebKit/glibc)."
}

echo "=== LoTT Linux development setup ==="
if [[ "$EDITOR_ONLY" == "1" ]]; then
  info "Edition: Editor (whisper.cpp only)"
else
  info "Edition: Full (whisper.cpp + NeMo-Speech.cpp + LGPL ffmpeg)"
fi

if [[ "$ONLY_RUST" == "1" ]]; then
  check_rust
  exit 0
fi

info "[1/5] System packages..."
install_system_packages
check_node
install_npm_dependencies
check_rust
setup_speech_engines
setup_ffmpeg
doctor_summary
