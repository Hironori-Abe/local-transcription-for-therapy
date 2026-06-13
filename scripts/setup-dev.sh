#!/usr/bin/env bash
set -Eeuo pipefail

HAS_WARN=0
NEEDS_NPU_REBOOT=0
SKIP_APT=0
SKIP_GEMMA=0
SKIP_LLAMA_CPP=0
SKIP_RUST=0
ONLY_RUST=0
CPU_TORCH=0
ASSUME_YES=0
VENV_DIR="${LOTT_VENV_DIR:-.venv312}"
TORCH_BACKEND_EXPLICIT=0
if [[ -n "${LOTT_TORCH_BACKEND:-}" ]]; then TORCH_BACKEND_EXPLICIT=1; fi
TORCH_BACKEND="${LOTT_TORCH_BACKEND:-cuda}"
LLAMA_CPP_BACKEND="${LOTT_LLAMA_CPP_BACKEND:-auto}"
AMD_PACKAGES=0
INSTALL_ROCM=0
INSTALL_AMD_NPU=0
INSTALL_LEMONADE=0
ROCM_VERSION="${LOTT_ROCM_VERSION:-7.2}"
PYTORCH_ROCM_INDEX_URL="${LOTT_PYTORCH_ROCM_INDEX_URL:-https://download.pytorch.org/whl/rocm7.2}"
CTRANSLATE2_ROCM_VERSION="${CTRANSLATE2_ROCM_VERSION:-4.7.1}"
LEMONADE_DEB_PATH="${LEMONADE_DEB_PATH:-}"
LEMONADE_EMBEDDABLE_VERSION="${LEMONADE_EMBEDDABLE_VERSION:-10.7.0}"
RYZEN_AI_NPU_DEB_DIR="${RYZEN_AI_NPU_DEB_DIR:-}"

usage() {
  cat <<'EOF'
Usage: scripts/setup-dev.sh [options]

Options:
  -y, --yes              Install apt packages without prompting.
  --skip-apt             Skip Ubuntu/Debian system package installation.
  --skip-gemma           Skip Gemma GGUF model download.
  --skip-llama-cpp       Skip llama-cpp-python installation.
  --skip-rust            Skip Rustup/Cargo installation and check.
  --only-rust            Only install/check Rustup/Cargo, then exit.
  --cpu-torch            Install the default PyTorch wheels instead of CUDA 12.8 wheels.
  --amd                  Prepare for AMD validation: ROCm PyTorch, Vulkan/OpenCL diagnostics,
                         and AMD runtime env checks. llama_cpp is skipped by default because
                         Lemonade is the preferred AMD LLM backend. Use
                         --llama-cpp-backend=hipblas or --llama-cpp-backend=vulkan to build
                         llama_cpp explicitly.
  --torch-backend VALUE  Python torch backend: cuda, rocm, or cpu. Default: cuda.
  --llama-cpp-backend VALUE
                         llama-cpp-python backend: cuda, hipblas, vulkan, openblas, or none.
                         Default: auto, derived from --torch-backend.
  --install-rocm         Register the AMD ROCm apt repo and install ROCm/HIP/ML packages.
  --install-amd-npu      Install AMD XDNA NPU packages available through Ubuntu/PPA,
                         then check XRT/FastFlowLM/Lemonade readiness.
  --install-lemonade     Install Lemonade Server from LEMONADE_DEB_PATH if set, otherwise
                         install the snap package when snap is available.
  -h, --help             Show this help.

Environment:
  LOTT_VENV_DIR          Python venv directory. Default: .venv312
  PYTHON_BOOTSTRAP       Python command used to create the venv. Default: python3.12, then python3
  LOTT_TORCH_BACKEND     Same as --torch-backend.
  LOTT_LLAMA_CPP_BACKEND Same as --llama-cpp-backend.
  LOTT_ROCM_VERSION      ROCm apt repo version for --install-rocm. Default: 7.2
  LOTT_PYTORCH_ROCM_INDEX_URL
                         PyTorch ROCm wheel index. Default: rocm7.2.
  LEMONADE_DEB_PATH      Optional local Lemonade Server .deb for --install-lemonade.
  RYZEN_AI_NPU_DEB_DIR   Optional local Ryzen AI/XRT .deb directory for --install-amd-npu.
EOF
}

while [[ $# -gt 0 ]]; do
  arg="$1"
  case "$arg" in
    -y|--yes)
      ASSUME_YES=1
      shift
      ;;
    --skip-apt)
      SKIP_APT=1
      shift
      ;;
    --skip-gemma)
      SKIP_GEMMA=1
      shift
      ;;
    --skip-llama-cpp)
      SKIP_LLAMA_CPP=1
      shift
      ;;
    --skip-rust)
      SKIP_RUST=1
      shift
      ;;
    --only-rust)
      ONLY_RUST=1
      shift
      ;;
    --cpu-torch)
      CPU_TORCH=1
      TORCH_BACKEND="cpu"
      TORCH_BACKEND_EXPLICIT=1
      shift
      ;;
    --amd)
      AMD_PACKAGES=1
      TORCH_BACKEND="rocm"
      TORCH_BACKEND_EXPLICIT=1
      if [[ "$LLAMA_CPP_BACKEND" == "auto" ]]; then
        LLAMA_CPP_BACKEND="none"
      fi
      shift
      ;;
    --torch-backend)
      [[ $# -ge 2 ]] || { echo "[ERROR] --torch-backend requires a value." >&2; exit 2; }
      TORCH_BACKEND="$2"
      TORCH_BACKEND_EXPLICIT=1
      shift 2
      ;;
    --torch-backend=*)
      TORCH_BACKEND="${arg#*=}"
      TORCH_BACKEND_EXPLICIT=1
      shift
      ;;
    --llama-cpp-backend)
      [[ $# -ge 2 ]] || { echo "[ERROR] --llama-cpp-backend requires a value." >&2; exit 2; }
      LLAMA_CPP_BACKEND="$2"
      shift 2
      ;;
    --llama-cpp-backend=*)
      LLAMA_CPP_BACKEND="${arg#*=}"
      shift
      ;;
    --install-rocm)
      AMD_PACKAGES=1
      INSTALL_ROCM=1
      shift
      ;;
    --install-amd-npu)
      AMD_PACKAGES=1
      INSTALL_AMD_NPU=1
      shift
      ;;
    --install-lemonade)
      INSTALL_LEMONADE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown option: $arg" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ "$CPU_TORCH" == "1" ]]; then
  TORCH_BACKEND="cpu"
fi

# 明示指定なし・非 -y・インタラクティブ端末の場合にバックエンドを選択させる
if [[ "$TORCH_BACKEND_EXPLICIT" == "0" && "$ASSUME_YES" == "0" && -t 0 ]]; then
  printf '\nGPUバックエンドを選択してください:\n'
  printf '  1) cuda   NVIDIA CUDA（デフォルト・安定版）\n'
  printf '  2) rocm   AMD ROCm\n'
  printf '  3) cpu    CPU のみ（GPU なし）\n'
  printf '\n'
  read -rp "選択 [1-3] (デフォルト: 1 cuda): " _backend_choice
  case "${_backend_choice:-1}" in
    2|rocm|ROCm)
      TORCH_BACKEND="rocm"
      ;;
    3|cpu|CPU)
      TORCH_BACKEND="cpu"
      CPU_TORCH=1
      ;;
    *)
      TORCH_BACKEND="cuda"
      ;;
  esac
  printf '[INFO] torch バックエンド: %s\n' "$TORCH_BACKEND"
fi

case "$TORCH_BACKEND" in
  cuda|rocm|cpu)
    ;;
  *)
    echo "[ERROR] --torch-backend must be one of: cuda, rocm, cpu" >&2
    exit 2
    ;;
esac

if [[ "$LLAMA_CPP_BACKEND" == "auto" ]]; then
  case "$TORCH_BACKEND" in
    cuda) LLAMA_CPP_BACKEND="cuda" ;;
    rocm) LLAMA_CPP_BACKEND="hipblas" ;;
    cpu) LLAMA_CPP_BACKEND="openblas" ;;
  esac
fi

case "$LLAMA_CPP_BACKEND" in
  cuda|hipblas|vulkan|openblas|none)
    ;;
  *)
    echo "[ERROR] --llama-cpp-backend must be one of: cuda, hipblas, vulkan, openblas, none" >&2
    exit 2
    ;;
esac

if [[ "$TORCH_BACKEND" == "rocm" || "$LLAMA_CPP_BACKEND" == "hipblas" || "$LLAMA_CPP_BACKEND" == "vulkan" || "$INSTALL_ROCM" == "1" || "$INSTALL_AMD_NPU" == "1" ]]; then
  AMD_PACKAGES=1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

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

install_system_packages() {
  if [[ "$SKIP_APT" == "1" ]]; then
    info "Skipping apt system package installation."
    return
  fi

  if ! have apt-get; then
    warn "apt-get was not found. Install Tauri/Linux system dependencies manually."
    return
  fi

  if ! confirm_default_yes "Install/update Ubuntu system packages for Tauri, Python builds, and llama-cpp-python?"; then
    info "Skipped apt system package installation."
    return
  fi

  ensure_sudo || return

  info "Updating apt package index..."
  if ! "${SUDO_CMD[@]}" apt-get update; then
    warn "apt-get update failed. Continuing with existing system packages."
  fi

  local packages=(
    build-essential
    cmake
    curl
    ffmpeg
    file
    gpg
    libayatana-appindicator3-dev
    libgtk-3-dev
    libopenblas-dev
    libssl-dev
    libxdo-dev
    libxml2
    libxml2-dev
    ninja-build
    pkg-config
    python3-dev
    python3-pip
    python3-venv
    librsvg2-dev
    unzip
    wget
  )

  if [[ "$AMD_PACKAGES" == "1" ]]; then
    local amd_base_packages=(
      clinfo
      libdrm-dev
      libnuma-dev
      libvulkan-dev
      mesa-utils
      mesa-vulkan-drivers
      pciutils
      vulkan-tools
    )
    for pkg in "${amd_base_packages[@]}"; do
      if apt_has_package "$pkg"; then
        packages+=("$pkg")
      else
        warn "apt package not found in current repositories: $pkg"
      fi
    done
  fi

  if [[ "$INSTALL_AMD_NPU" == "1" ]]; then
    if apt_has_package software-properties-common; then
      packages+=(software-properties-common)
    fi
    for pkg in python3.10 python3.10-venv libboost-filesystem1.74.0; do
      if apt_has_package "$pkg"; then
        packages+=("$pkg")
      else
        warn "AMD NPU prerequisite package not found in apt cache: $pkg"
      fi
    done
  fi

  if apt_has_package libwebkit2gtk-4.1-dev; then
    packages+=(libwebkit2gtk-4.1-dev)
  elif apt_has_package libwebkit2gtk-4.0-dev; then
    packages+=(libwebkit2gtk-4.0-dev)
    warn "Using libwebkit2gtk-4.0-dev fallback because libwebkit2gtk-4.1-dev was not found."
  else
    warn "No WebKitGTK dev package was found in apt cache. Tauri may fail until it is installed."
  fi

  for pkg in python3.12-dev python3.12-venv; do
    if apt_has_package "$pkg"; then
      packages+=("$pkg")
    fi
  done

  info "Installing apt packages..."
  if ! "${SUDO_CMD[@]}" apt-get install -y "${packages[@]}"; then
    warn "apt package installation failed. Some native builds or Tauri dev may fail."
  fi
}

check_rocm_clang_linker() {
  local compiler="$1"
  local src
  local bin
  src="$(mktemp --suffix=.c)"
  bin="$(mktemp)"
  printf 'int main(void) { return 0; }\n' > "$src"

  if "$compiler" "$src" -o "$bin" >/tmp/lott-rocm-clang-check.log 2>&1; then
    rm -f "$src" "$bin" /tmp/lott-rocm-clang-check.log
    return 0
  fi

  warn "ROCm clang cannot link a minimal C program. See /tmp/lott-rocm-clang-check.log"
  if grep -q "libxml2.so.2" /tmp/lott-rocm-clang-check.log 2>/dev/null; then
    warn "Missing libxml2 runtime for ROCm linker. Install it with: sudo apt-get install libxml2 libxml2-dev"
  fi
  rm -f "$src" "$bin"
  return 1
}

ubuntu_codename() {
  if [[ -r /etc/os-release ]]; then
    . /etc/os-release
    printf '%s\n' "${VERSION_CODENAME:-}"
  fi
}

write_root_file() {
  local dest="$1"
  local content="$2"
  local tmp
  tmp="$(mktemp)"
  printf '%s\n' "$content" > "$tmp"
  "${SUDO_CMD[@]}" cp "$tmp" "$dest"
  rm -f "$tmp"
}

register_rocm_repository() {
  local codename
  codename="$(ubuntu_codename)"

  case "$codename" in
    noble|jammy)
      ;;
    resolute)
      info "Ubuntu 26.04 detected. ROCm is expected from Ubuntu's native repositories; skipping repo.radeon.com setup."
      return 2
      ;;
    *)
      warn "ROCm apt setup is only automated for Ubuntu 24.04 (noble) and 22.04 (jammy). Detected: ${codename:-unknown}"
      return 1
      ;;
  esac

  ensure_sudo || return 1
  if ! have wget || ! have gpg; then
    warn "wget/gpg was not found. Run setup once without --skip-apt, then retry --install-rocm."
    return 1
  fi

  info "Registering AMD ROCm apt repository version $ROCM_VERSION for Ubuntu $codename..."
  "${SUDO_CMD[@]}" mkdir --parents --mode=0755 /etc/apt/keyrings
  if ! wget -qO- https://repo.radeon.com/rocm/rocm.gpg.key \
      | gpg --dearmor \
      | "${SUDO_CMD[@]}" tee /etc/apt/keyrings/rocm.gpg >/dev/null; then
    warn "Failed to install AMD ROCm package signing key."
    return 1
  fi

  write_root_file \
    /etc/apt/sources.list.d/rocm.list \
    "deb [arch=amd64 signed-by=/etc/apt/keyrings/rocm.gpg] https://repo.radeon.com/rocm/apt/$ROCM_VERSION $codename main
deb [arch=amd64 signed-by=/etc/apt/keyrings/rocm.gpg] https://repo.radeon.com/graphics/$ROCM_VERSION/ubuntu $codename main"

  write_root_file \
    /etc/apt/preferences.d/rocm-pin-600 \
    "Package: *
Pin: release o=repo.radeon.com
Pin-Priority: 600"

  "${SUDO_CMD[@]}" apt-get update || {
    warn "apt-get update failed after registering ROCm repository."
    return 1
  }
}

install_rocm_packages() {
  if [[ "$INSTALL_ROCM" != "1" ]]; then
    return
  fi

  if ! have apt-get; then
    warn "apt-get was not found. Cannot install ROCm packages automatically."
    return
  fi

  local codename
  codename="$(ubuntu_codename)"
  ensure_sudo || return

  if [[ "$codename" == "resolute" ]]; then
    info "Installing ROCm packages from Ubuntu 26.04 native repositories..."
    "${SUDO_CMD[@]}" apt-get update || warn "apt-get update failed before native ROCm package install."
  else
    if ! register_rocm_repository; then
      return
    fi
  fi

  local rocm_packages=()
  local candidates=()
  if [[ "$codename" == "resolute" ]]; then
    candidates=(
      rocm
      rocm-dev
      rocm-smi
      rocminfo
    )
  else
    candidates=(
      amdgpu-lib
      rocminfo
      rocm-developer-tools
      rocm-hip-sdk
      rocm-ml-sdk
      rocm-opencl-runtime
    )
  fi
  for pkg in "${candidates[@]}"; do
    if apt_has_package "$pkg"; then
      rocm_packages+=("$pkg")
    else
      warn "ROCm package not found after repository setup: $pkg"
    fi
  done

  if [[ "${#rocm_packages[@]}" -eq 0 ]]; then
    warn "No ROCm packages were available to install."
    return
  fi

  info "Installing ROCm/HIP/ML packages: ${rocm_packages[*]}"
  if ! "${SUDO_CMD[@]}" apt-get install -y "${rocm_packages[@]}"; then
    warn "ROCm package installation failed. AMD GPU acceleration may be unavailable."
  else
    ok "ROCm packages installed."
  fi
}

configure_npu_memlock() {
  local limits_file="/etc/security/limits.d/amdxdna.conf"
  local memlock_kb
  memlock_kb="$(ulimit -l 2>/dev/null || echo "")"

  if [[ "$memlock_kb" == "unlimited" ]]; then
    ok "Memlock limit is already unlimited (AMD NPU OK)."
    return
  fi

  if [[ -f "$limits_file" ]]; then
    ok "AMD NPU memlock limits file exists: $limits_file"
    return
  fi

  warn "Memlock limit is ${memlock_kb:-unknown} kB. AMD NPU (XDNA/XRT) requires unlimited memlock."

  ensure_sudo || {
    warn "Cannot set memlock automatically without sudo. Run manually:"
    warn "  echo '* - memlock unlimited' | sudo tee $limits_file"
    warn "  Then log out and back in."
    return
  }

  if confirm_default_yes "Set memlock to unlimited for AMD NPU ($limits_file)?"; then
    write_root_file "$limits_file" "# AMD XDNA NPU requires unlimited memlock for DMA operations
* - memlock unlimited"
    ok "Wrote $limits_file."
    warn "Memlock change requires re-login or reboot to take effect."
    NEEDS_NPU_REBOOT=1
  else
    warn "Memlock not configured. AMD NPU may report 'Memlock limit is too low'."
    warn "Fix manually: echo '* - memlock unlimited' | sudo tee $limits_file"
  fi
}

install_amd_npu_packages() {
  if [[ "$INSTALL_AMD_NPU" != "1" ]]; then
    return
  fi

  if ! have apt-get; then
    warn "apt-get was not found. Cannot install AMD NPU packages automatically."
    return
  fi

  ensure_sudo || return

  local codename
  codename="$(ubuntu_codename)"
  if [[ "$codename" == "noble" || "$codename" == "questing" ]]; then
    if have add-apt-repository; then
      info "Adding Lemonade stable PPA for AMD XDNA NPU packages..."
      if ! "${SUDO_CMD[@]}" add-apt-repository -y ppa:lemonade-team/stable; then
        warn "Failed to add Lemonade stable PPA. AMD NPU packages may need manual installation."
      else
        "${SUDO_CMD[@]}" apt-get update || warn "apt-get update failed after adding Lemonade PPA."
      fi
    else
      warn "add-apt-repository was not found. Run setup without --skip-apt or install software-properties-common."
    fi
  else
    warn "AMD NPU package automation is intended for Ubuntu 24.04+; detected: ${codename:-unknown}"
  fi

  local npu_packages=()
  for pkg in libxrt-npu2 amdxdna-dkms; do
    if apt_has_package "$pkg"; then
      npu_packages+=("$pkg")
    else
      warn "AMD NPU package not found in apt cache: $pkg"
    fi
  done
  if [[ "${#npu_packages[@]}" -gt 0 ]]; then
    info "Installing AMD XDNA NPU packages: ${npu_packages[*]}"
    if ! "${SUDO_CMD[@]}" apt-get install -y "${npu_packages[@]}"; then
      warn "AMD XDNA NPU package installation failed."
    else
      warn "AMD NPU driver packages were installed. A reboot is usually required before NPU tests."
      NEEDS_NPU_REBOOT=1
    fi
  fi

  if [[ -n "$RYZEN_AI_NPU_DEB_DIR" ]]; then
    if [[ -d "$RYZEN_AI_NPU_DEB_DIR" ]]; then
      shopt -s nullglob
      local debs=("$RYZEN_AI_NPU_DEB_DIR"/*.deb)
      shopt -u nullglob
      if [[ "${#debs[@]}" -gt 0 ]]; then
        info "Installing local Ryzen AI/XRT .deb packages from: $RYZEN_AI_NPU_DEB_DIR"
        if ! "${SUDO_CMD[@]}" apt-get install -y "${debs[@]}"; then
          warn "Local Ryzen AI/XRT .deb installation failed."
        else
          warn "Local Ryzen AI/XRT packages were installed. Reboot before NPU validation."
          NEEDS_NPU_REBOOT=1
        fi
      else
        warn "RYZEN_AI_NPU_DEB_DIR was set but contains no .deb files: $RYZEN_AI_NPU_DEB_DIR"
      fi
    else
      warn "RYZEN_AI_NPU_DEB_DIR does not exist: $RYZEN_AI_NPU_DEB_DIR"
    fi
  fi

  configure_npu_memlock
}

install_lemonade_server() {
  if [[ "$INSTALL_LEMONADE" != "1" ]]; then
    return
  fi

  ensure_sudo || return

  if [[ -n "$LEMONADE_DEB_PATH" ]]; then
    if [[ -f "$LEMONADE_DEB_PATH" ]]; then
      info "Installing Lemonade Server from local .deb: $LEMONADE_DEB_PATH"
      if ! "${SUDO_CMD[@]}" apt-get install -y "$LEMONADE_DEB_PATH"; then
        warn "Lemonade Server .deb installation failed."
      fi
      return
    fi
    warn "LEMONADE_DEB_PATH was set but file was not found: $LEMONADE_DEB_PATH"
  fi

  if have snap; then
    info "Installing Lemonade Server snap..."
    if ! "${SUDO_CMD[@]}" snap install lemonade-server; then
      warn "Lemonade Server snap installation failed."
      return
    fi
    "${SUDO_CMD[@]}" snap connect lemonade-server:process-control >/dev/null 2>&1 || true
    warn "Snap Lemonade Server commonly listens on port 8000; LoTT currently defaults to http://localhost:13305."
  else
    warn "snap was not found and LEMONADE_DEB_PATH was not provided. Install Lemonade Server manually if needed."
  fi
}

ensure_amd_group_membership() {
  if [[ "$AMD_PACKAGES" != "1" && "$INSTALL_ROCM" != "1" && "$INSTALL_AMD_NPU" != "1" ]]; then
    return
  fi

  local login_user="${SUDO_USER:-${USER:-}}"
  if [[ -z "$login_user" || "$login_user" == "root" ]]; then
    return
  fi

  local missing_groups=()
  for group_name in render video; do
    if getent group "$group_name" >/dev/null 2>&1 && ! id -nG "$login_user" | tr ' ' '\n' | grep -qx "$group_name"; then
      missing_groups+=("$group_name")
    fi
  done

  if [[ "${#missing_groups[@]}" -eq 0 ]]; then
    return
  fi

  ensure_sudo || return
  info "Adding $login_user to AMD device access groups: ${missing_groups[*]}"
  if "${SUDO_CMD[@]}" usermod -a -G "$(IFS=,; echo "${missing_groups[*]}")" "$login_user"; then
    warn "Log out/in or reboot so group membership changes take effect."
  else
    warn "Failed to update render/video group membership."
  fi
}

select_python_bootstrap() {
  if [[ -n "${PYTHON_BOOTSTRAP:-}" ]]; then
    if have "$PYTHON_BOOTSTRAP"; then
      printf '%s\n' "$PYTHON_BOOTSTRAP"
      return
    fi
    die "PYTHON_BOOTSTRAP was set but command was not found: $PYTHON_BOOTSTRAP"
  fi

  for candidate in python3.12 python3; do
    if have "$candidate" && "$candidate" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return
    fi
  done

  die "Python 3.10+ was not found. Recommended: Python 3.12."
}

ensure_python_venv() {
  local bootstrap
  bootstrap="$(select_python_bootstrap)"

  if [[ -x "$VENV_DIR/bin/python" ]]; then
    PYTHON_BIN="$ROOT_DIR/$VENV_DIR/bin/python"
    info "Using existing Python venv: $PYTHON_BIN"
  else
    if [[ -e "$VENV_DIR" ]]; then
      die "$VENV_DIR exists but $VENV_DIR/bin/python was not found. Move it aside or set LOTT_VENV_DIR=.venv312-linux."
    fi

    info "Creating $VENV_DIR with $bootstrap..."
    "$bootstrap" -m venv "$VENV_DIR" || die "Failed to create Python venv."
    PYTHON_BIN="$ROOT_DIR/$VENV_DIR/bin/python"
    ok "Created venv: $PYTHON_BIN"
  fi

  local py_ver py_exe
  py_exe="$("$PYTHON_BIN" -c "import sys; print(sys.executable)")"
  py_ver="$("$PYTHON_BIN" -c "import sys; print('.'.join(map(str, sys.version_info[:3])))")"
  info "Python executable: $py_exe"
  info "Python version   : $py_ver"

  case "$py_ver" in
    3.12.*|3.11.*)
      ;;
    3.14.*)
      warn "Python 3.14 detected. Recommended: 3.12.x or 3.11.x."
      ;;
    *)
      warn "Recommended Python is 3.12.x or 3.11.x for this runtime stack."
      ;;
  esac
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
  info "[1/6] npm install (root)..."
  npm install || die "npm install failed."

  info "[2/6] npm install (frontend)..."
  npm --prefix frontend install || die "frontend npm install failed."
}

install_python_dependencies() {
  info "[3/6] Python dependencies..."
  "$PYTHON_BIN" -m pip install --upgrade "pip<26" "setuptools<81" wheel || die "pip tooling install failed."
  "$PYTHON_BIN" -m pip uninstall -y torch torchaudio torchvision torchcodec >/dev/null 2>&1 || true

  case "$TORCH_BACKEND" in
    cuda)
      "$PYTHON_BIN" -m pip install --upgrade --force-reinstall --prefer-binary \
        --index-url https://download.pytorch.org/whl/cu128 \
        "torch==2.10.0" "torchaudio==2.10.0" || die "CUDA PyTorch install failed."
      ;;
    rocm)
      warn "Installing ROCm PyTorch wheels for AMD validation. This can diverge from the CUDA production default."
      "$PYTHON_BIN" -m pip install --upgrade --force-reinstall --prefer-binary \
        --index-url "$PYTORCH_ROCM_INDEX_URL" \
        "torch==2.11.0" "torchaudio==2.11.0" || die "ROCm PyTorch install failed."
      # torch 2.11.0+rocm7.2 requires setuptools<82; --upgrade では降格されないので明示的に強制する
      if ! "$PYTHON_BIN" -c \
          "import setuptools; exit(0 if int(setuptools.__version__.split('.')[0]) < 82 else 1)" 2>/dev/null; then
        info "Downgrading setuptools to <82 for torch 2.11.0+rocm7.2 compatibility..."
        "$PYTHON_BIN" -m pip install --force-reinstall "setuptools<82" || \
          warn "setuptools downgrade failed. pip resolver warning about torch may persist."
      fi
      ;;
    cpu)
      warn "Installing default PyTorch wheels because CPU torch backend was requested. The app default remains CUDA."
      "$PYTHON_BIN" -m pip install --upgrade --force-reinstall --prefer-binary \
        "torch==2.10.0" "torchaudio==2.10.0" || die "PyTorch install failed."
      ;;
  esac

  local req_file="python_sidecar/requirements-runtime.txt"
  info "Removing PyAV / imageio-ffmpeg so GPL FFmpeg binaries do not linger..."
  "$PYTHON_BIN" -m pip uninstall -y av imageio-ffmpeg >/dev/null 2>&1 || true

  local fw_req
  fw_req="$(grep -E '^faster-whisper([<=>!~[:space:]]|$)' "$req_file" | head -n 1 || true)"
  if [[ -n "$fw_req" ]]; then
    info "Installing faster-whisper without PyAV dependency..."
    "$PYTHON_BIN" -m pip install --prefer-binary --no-deps "$fw_req" \
      || die "faster-whisper install failed."
  fi

  local req_tmp
  req_tmp="$(mktemp)"
  if [[ "$TORCH_BACKEND" == "rocm" ]]; then
    # ctranslate2 ROCm ホイールを先に導入する。faster_whisper は import 時に ctranslate2 を
    # 読み込むため、後続の import 検証より前に入れておかないと検証が必ず失敗する。先に入れる
    # ことで、続く pip 依存解決でも ctranslate2 競合警告が消える（av 未導入の警告は配布方針上の想定内）。
    install_rocm_ctranslate2
    # torch / ctranslate2 は ROCm ホイールで別途インストールするため除外する。
    # faster-whisper は PyAV を入れないため --no-deps で先にインストール済み。
    grep -Ev '^(faster-whisper|torch|torchaudio|torchvision|torchcodec|ctranslate2)([<=>!~[:space:]]|$)' "$req_file" > "$req_tmp"
    "$PYTHON_BIN" -m pip install --prefer-binary --only-binary=contourpy \
      -r "$req_tmp" || {
        rm -f "$req_tmp"
        die "Python runtime dependency install failed."
      }
    rm -f "$req_tmp"
    # pyannote.audio 4.0.0 が torchcodec>=0.6.0 を要求する。ROCm 専用ホイールは存在しない場合があるため
    # ROCm インデックスを試し、なければ PyPI CPU ホイールにフォールバックする。
    info "Installing torchcodec for pyannote.audio 4.0.0 compatibility..."
    "$PYTHON_BIN" -m pip install --prefer-binary \
        --index-url "$PYTORCH_ROCM_INDEX_URL" \
        "torchcodec>=0.6.0" 2>/dev/null \
      || "$PYTHON_BIN" -m pip install --prefer-binary "torchcodec>=0.6.0" \
      || warn "torchcodec>=0.6.0 is not available. pyannote.audio dependency conflict will persist (non-fatal)."
  else
    grep -Ev '^faster-whisper([<=>!~[:space:]]|$)' "$req_file" > "$req_tmp"
    "$PYTHON_BIN" -m pip install --prefer-binary --only-binary=contourpy \
      -r "$req_tmp" || {
        rm -f "$req_tmp"
        die "Python runtime dependency install failed."
      }
    rm -f "$req_tmp"
  fi

  if [[ "$TORCH_BACKEND" == "rocm" ]]; then
    # ROCm の ctranslate2 は GitHub Releases から取得する experimental 経路のため、取得失敗時も
    # セットアップ全体は止めず警告に留める（後続の check_cuda / doctor_summary で再通知される）。
    if "$PYTHON_BIN" -c "import python_sidecar.transcribe_cli as t; t.install_pyav_import_stub(); import faster_whisper, ctranslate2, requests; print('python modules OK')"; then
      ok "faster-whisper / ctranslate2 (ROCm) import OK."
    else
      warn "faster_whisper / ctranslate2 (ROCm) import に失敗しました。ROCm ctranslate2 ホイールが未導入の可能性があります。faster-whisper の GPU ASR は利用できません。"
    fi
  else
    "$PYTHON_BIN" -c "import python_sidecar.transcribe_cli as t; t.install_pyav_import_stub(); import faster_whisper, ctranslate2, requests; print('python modules OK')" \
      || die "Python module import check failed."
  fi
}

install_rocm_ctranslate2() {
  if [[ "$TORCH_BACKEND" != "rocm" ]]; then
    return
  fi

  local version="$CTRANSLATE2_ROCM_VERSION"
  local py_tag
  py_tag="$("$PYTHON_BIN" -c "import sys; print(f'cp{sys.version_info.major}{sys.version_info.minor}')")"
  local zip_url="https://github.com/OpenNMT/CTranslate2/releases/download/v${version}/rocm-python-wheels-Linux.zip"
  local tmp_dir
  tmp_dir="$(mktemp -d)"

  info "[3a/6] CTranslate2 ROCm wheel v${version} (Python ${py_tag})..."
  info "  Source: $zip_url"

  if ! curl -fL --retry 3 --retry-delay 5 -o "${tmp_dir}/ct2-rocm.zip" "$zip_url"; then
    warn "CTranslate2 ROCm wheel download failed. faster-whisper GPU acceleration will be unavailable."
    warn "  Re-run with CTRANSLATE2_ROCM_VERSION=<version> after network is available."
    rm -rf "$tmp_dir"
    return
  fi

  # Python バージョンに合うホイールを優先し、なければ任意バージョンにフォールバックする。
  if ! unzip -j "${tmp_dir}/ct2-rocm.zip" \
      "temp-linux/ctranslate2-${version}-${py_tag}-*.whl" \
      -d "${tmp_dir}/" >/dev/null 2>&1; then
    warn "No ${py_tag} wheel in archive; trying any Python version..."
    if ! unzip -j "${tmp_dir}/ct2-rocm.zip" \
        "temp-linux/ctranslate2-*.whl" \
        -d "${tmp_dir}/" >/dev/null 2>&1; then
      warn "CTranslate2 ROCm wheel extraction failed. Check zip contents manually."
      rm -rf "$tmp_dir"
      return
    fi
  fi

  local whl
  whl="$(ls "${tmp_dir}"/ctranslate2-*.whl 2>/dev/null | head -n1)"
  if [[ -z "$whl" ]]; then
    warn "CTranslate2 ROCm wheel not found after extraction."
    rm -rf "$tmp_dir"
    return
  fi

  info "  Installing: $(basename "$whl")"
  if ! "$PYTHON_BIN" -m pip install --force-reinstall "$whl"; then
    warn "CTranslate2 ROCm wheel installation failed."
  else
    ok "CTranslate2 ROCm wheel installed: $(basename "$whl")"
  fi

  rm -rf "$tmp_dir"
}

collect_nvidia_lib_paths() {
  "$PYTHON_BIN" - <<'PY'
import pathlib
import site
import sys

roots = []
try:
    roots.extend(site.getsitepackages())
except Exception:
    pass
try:
    roots.append(site.getusersitepackages())
except Exception:
    pass
roots.extend(sys.path)

paths = []
seen = set()
for root in roots:
    if not root:
        continue
    nvidia = pathlib.Path(root) / "nvidia"
    if not nvidia.exists():
        continue
    for lib_dir in sorted(nvidia.glob("*/lib")):
        path = str(lib_dir)
        if path not in seen:
            seen.add(path)
            paths.append(path)

print(":".join(paths))
PY
}

write_linux_env_file() {
  local env_file="$ROOT_DIR/.dev-linux.env"
  NVIDIA_LIB_PATHS="$(collect_nvidia_lib_paths || true)"
  local rocm_lib_paths=""
  local rocm_path="/opt/rocm"

  if [[ -n "$NVIDIA_LIB_PATHS" ]]; then
    export LD_LIBRARY_PATH="$NVIDIA_LIB_PATHS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    info "Added Python NVIDIA library paths to LD_LIBRARY_PATH for this setup run."
  fi
  if [[ -d "$rocm_path" ]]; then
    local rocm_paths=()
    [[ -d "$rocm_path/lib" ]] && rocm_paths+=("$rocm_path/lib")
    [[ -d "$rocm_path/lib64" ]] && rocm_paths+=("$rocm_path/lib64")
    if [[ "${#rocm_paths[@]}" -gt 0 ]]; then
      rocm_lib_paths="$(IFS=:; echo "${rocm_paths[*]}")"
      export ROCM_PATH="$rocm_path"
      export HIP_PATH="$rocm_path"
      export PATH="$rocm_path/bin${PATH:+:$PATH}"
      export LD_LIBRARY_PATH="$rocm_lib_paths${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
      info "Added ROCm paths for this setup run."
    fi
  fi
  if [[ -f /opt/xilinx/xrt/setup.sh ]]; then
    # shellcheck disable=SC1091
    source /opt/xilinx/xrt/setup.sh || warn "Failed to source /opt/xilinx/xrt/setup.sh."
    info "Sourced XRT setup for AMD NPU validation."
  fi

  {
    printf '# Generated by scripts/setup-dev.sh\n'
    printf 'export PYTHON_BIN=%q\n' "$PYTHON_BIN"
    printf 'export DIARIZATION_PYTHON_BIN=%q\n' "$PYTHON_BIN"
    if [[ -n "$NVIDIA_LIB_PATHS" ]]; then
      printf 'export LOTT_NVIDIA_LIB_PATHS=%q\n' "$NVIDIA_LIB_PATHS"
      printf 'export LD_LIBRARY_PATH="${LOTT_NVIDIA_LIB_PATHS}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"\n'
    fi
    if [[ -n "$rocm_lib_paths" ]]; then
      printf 'export ROCM_PATH=%q\n' "$rocm_path"
      printf 'export HIP_PATH=%q\n' "$rocm_path"
      printf 'export PATH="%s/bin:${PATH}"\n' "$rocm_path"
      printf 'export LOTT_ROCM_LIB_PATHS=%q\n' "$rocm_lib_paths"
      printf 'export LD_LIBRARY_PATH="${LOTT_ROCM_LIB_PATHS}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"\n'
    fi
    if [[ -f /opt/xilinx/xrt/setup.sh ]]; then
      printf '[ -f /opt/xilinx/xrt/setup.sh ] && source /opt/xilinx/xrt/setup.sh\n'
    fi
    if [[ "$TORCH_BACKEND" == "rocm" ]]; then
      printf 'export LOTT_TORCH_BACKEND=rocm\n'
    fi
  } > "$env_file"

  ok "Wrote Linux dev env file: $env_file"
}

install_llama_cpp() {
  if [[ "$SKIP_LLAMA_CPP" == "1" ]]; then
    info "Skipping llama-cpp-python installation."
    return
  fi
  if [[ "$LLAMA_CPP_BACKEND" == "none" ]]; then
    info "Skipping llama-cpp-python installation because --llama-cpp-backend=none was requested."
    return
  fi

  info "[3b/6] llama-cpp-python ($LLAMA_CPP_BACKEND source build for LLM proofreading)..."
  info "This may take 10-20 minutes on first install."

  local old_cmake_args="${CMAKE_ARGS-}"
  local old_cc="${CC-}"
  local old_cxx="${CXX-}"
  case "$LLAMA_CPP_BACKEND" in
    cuda)
      export CMAKE_ARGS="-DGGML_CUDA=on"
      ;;
    hipblas)
      export CMAKE_ARGS="-DGGML_HIPBLAS=on"
      if [[ -x /opt/rocm/llvm/bin/clang && -x /opt/rocm/llvm/bin/clang++ ]]; then
        export CC="/opt/rocm/llvm/bin/clang"
        export CXX="/opt/rocm/llvm/bin/clang++"
      else
        warn "ROCm clang was not found under /opt/rocm/llvm/bin. HIPBLAS build may fail unless ROCm is installed."
      fi
      ;;
    vulkan)
      export CMAKE_ARGS="-DGGML_VULKAN=on"
      ;;
    openblas)
      export CMAKE_ARGS="-DGGML_BLAS=ON -DGGML_BLAS_VENDOR=OpenBLAS"
      ;;
  esac

  if [[ "$LLAMA_CPP_BACKEND" == "hipblas" ]]; then
    if ! check_rocm_clang_linker "${CC:-/opt/rocm/llvm/bin/clang}"; then
      warn "Skipping llama-cpp-python HIPBLAS build until ROCm compiler dependencies are fixed."
      if [[ -n "$old_cmake_args" ]]; then
        export CMAKE_ARGS="$old_cmake_args"
      else
        unset CMAKE_ARGS
      fi
      if [[ -n "$old_cc" ]]; then
        export CC="$old_cc"
      else
        unset CC
      fi
      if [[ -n "$old_cxx" ]]; then
        export CXX="$old_cxx"
      else
        unset CXX
      fi
      return
    fi
  fi

  if ! "$PYTHON_BIN" -m pip install llama-cpp-python --no-cache-dir; then
    warn "llama-cpp-python is not installed. LLM proofreading will be unavailable."
  fi

  if [[ -n "$old_cmake_args" ]]; then
    export CMAKE_ARGS="$old_cmake_args"
  else
    unset CMAKE_ARGS
  fi
  if [[ -n "$old_cc" ]]; then
    export CC="$old_cc"
  else
    unset CC
  fi
  if [[ -n "$old_cxx" ]]; then
    export CXX="$old_cxx"
  else
    unset CXX
  fi

  if ! "$PYTHON_BIN" -c "import llama_cpp; print('llama_cpp GPU:', llama_cpp.llama_supports_gpu_offload())" 2>/dev/null; then
    warn "llama_cpp import or GPU-offload check failed."
  fi
}

download_gemma_model() {
  if [[ "$SKIP_GEMMA" == "1" ]]; then
    info "Skipping Gemma GGUF model download."
    return
  fi

  info "[3c/6] Gemma4 E4B GGUF model download for local LLM proofreading..."
  local gemma_dir="$ROOT_DIR/python_sidecar/models/llm/gemma-4-e4b-it"
  local gemma_file="$gemma_dir/gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf"
  local gemma_mtp_file="$gemma_dir/mtp-gemma-4-E4B-it.gguf"
  local legacy_ptq_file="$gemma_dir/gemma-4-E4B-it-Q4_K_M.gguf"

  if [[ -f "$gemma_file" ]]; then
    info "Model already exists: $gemma_file"
  else
    info "Downloading gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf (about 4.3GB)..."
    mkdir -p "$gemma_dir"
    if ! GEMMA_DIR="$gemma_dir" "$PYTHON_BIN" -c "import os; from huggingface_hub import hf_hub_download; hf_hub_download('unsloth/gemma-4-E4B-it-qat-GGUF', 'gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf', local_dir=os.environ['GEMMA_DIR'])"; then
      warn "Gemma model download failed. Download later and save it to: $gemma_file"
    else
      ok "Downloaded model: $gemma_file"
    fi
  fi

  if [[ -f "$gemma_mtp_file" ]]; then
    info "MTP model already exists: $gemma_mtp_file"
  else
    info "Downloading mtp-gemma-4-E4B-it.gguf (about 60MB)..."
    mkdir -p "$gemma_dir"
    if ! GEMMA_DIR="$gemma_dir" "$PYTHON_BIN" -c "import os; from huggingface_hub import hf_hub_download; hf_hub_download('unsloth/gemma-4-E4B-it-qat-GGUF', 'mtp-gemma-4-E4B-it.gguf', local_dir=os.environ['GEMMA_DIR'])"; then
      warn "Gemma MTP model download failed. Download later and save it to: $gemma_mtp_file"
    else
      ok "Downloaded MTP model: $gemma_mtp_file"
    fi
  fi

  # 旧 PTQ 量子化 (Q4_K_M) が同じディレクトリに残っていれば削除（QAT へ移行済み）
  [[ -f "$legacy_ptq_file" ]] && rm -f "$legacy_ptq_file" && info "Removed legacy PTQ model: $legacy_ptq_file"
}

check_lemonade() {
  info "[3d/6] Lemonade backend check..."
  local lemonade_bin=""

  if have lemonade-server; then
    lemonade_bin="$(command -v lemonade-server)"
  elif have lemond; then
    lemonade_bin="$(command -v lemond)"
  elif have lemonade; then
    lemonade_bin="$(command -v lemonade)"
  fi

  if [[ -n "$lemonade_bin" ]]; then
    ok "Lemonade binary: $lemonade_bin"
    if have lemonade; then
      lemonade backends || warn "Lemonade backend enumeration failed."
    fi
  else
    info "Lemonade was not found. llama_cpp backend can still be used."
    info "Install Lemonade manually if you need the NPU/GPU backend on Linux."
  fi

  "$PYTHON_BIN" - <<'PY'
import socket

for port in (13305, 8000):
    sock = socket.socket()
    sock.settimeout(0.25)
    try:
        sock.connect(("127.0.0.1", port))
    except OSError:
        print(f"lemonade_port_{port}=closed")
    else:
        print(f"lemonade_port_{port}=open")
    finally:
        sock.close()
PY
}

setup_lemonade_embeddable() {
  local dest_dir="$ROOT_DIR/src-tauri/resources/lemonade"
  local lemond_bin="$dest_dir/lemond"
  local lemonade_cli="$dest_dir/lemonade"

  if [[ -x "$lemond_bin" ]]; then
    ok "Lemonade embeddable already present: $lemond_bin"
    return
  fi

  if ! have curl; then
    warn "curl was not found. Cannot download Lemonade embeddable binary."
    warn "Download manually: https://github.com/lemonade-sdk/lemonade/releases/download/v${LEMONADE_EMBEDDABLE_VERSION}/lemonade-embeddable-${LEMONADE_EMBEDDABLE_VERSION}-ubuntu-x64.tar.gz"
    warn "Extract lemond and lemonade to: $dest_dir/"
    return
  fi

  local url="https://github.com/lemonade-sdk/lemonade/releases/download/v${LEMONADE_EMBEDDABLE_VERSION}/lemonade-embeddable-${LEMONADE_EMBEDDABLE_VERSION}-ubuntu-x64.tar.gz"
  info "Downloading Lemonade embeddable v${LEMONADE_EMBEDDABLE_VERSION}..."

  local tmp_tar tmp_dir
  tmp_tar="$(mktemp --suffix=.tar.gz)"
  tmp_dir="$(mktemp -d)"

  if ! curl -L --fail --progress-bar -o "$tmp_tar" "$url"; then
    rm -f "$tmp_tar"
    rmdir "$tmp_dir" 2>/dev/null || true
    warn "Lemonade embeddable download failed."
    warn "Download manually and extract lemond + lemonade to: $dest_dir/"
    return
  fi

  if ! tar -xzf "$tmp_tar" -C "$tmp_dir"; then
    rm -f "$tmp_tar"
    rm -rf "$tmp_dir"
    warn "Failed to extract Lemonade embeddable archive."
    return
  fi
  rm -f "$tmp_tar"

  local lemond_src lemonade_src
  lemond_src="$(find "$tmp_dir" -maxdepth 3 -name "lemond" -not -name "*.sh" -type f | head -1)"
  lemonade_src="$(find "$tmp_dir" -maxdepth 3 -name "lemonade" -not -name "*.sh" -type f | head -1)"

  if [[ -f "$lemond_src" ]]; then
    cp "$lemond_src" "$lemond_bin"
    chmod +x "$lemond_bin"
    ok "Installed: $lemond_bin"
  else
    warn "lemond binary not found in archive. Check archive structure manually."
  fi

  if [[ -f "$lemonade_src" ]]; then
    cp "$lemonade_src" "$lemonade_cli"
    chmod +x "$lemonade_cli"
    ok "Installed: $lemonade_cli"
  else
    warn "lemonade CLI not found in archive."
  fi

  rm -rf "$tmp_dir"
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
  info "[4/6] Rust/cargo..."

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

check_cuda() {
  info "[5/6] NVIDIA / CUDA visibility..."
  if [[ "$TORCH_BACKEND" == "rocm" ]]; then
    info "Skipping NVIDIA/CUDA preflight; using ROCm ctranslate2 for faster-whisper GPU ASR."
    info "[5b/6] CTranslate2 ROCm import check..."
    if "$PYTHON_BIN" -c \
        "import ctranslate2; print('ct2_version=', ctranslate2.__version__)" 2>/dev/null; then
      ok "ctranslate2 ROCm is importable."
    else
      warn "ctranslate2 ROCm import failed. Run install_rocm_ctranslate2 step or check the wheel."
    fi
    return
  fi
  if [[ "$TORCH_BACKEND" != "cuda" ]]; then
    info "Skipping NVIDIA/CUDA preflight because torch backend is $TORCH_BACKEND."
    return
  fi

  if have nvidia-smi; then
    if ! nvidia-smi -L; then
      warn "nvidia-smi exists but failed to list GPUs."
    fi
  else
    warn "nvidia-smi was not found. GPU mode requires an NVIDIA driver."
  fi

  info "[6/6] ctranslate2 CUDA runtime check..."
  set +e
  "$PYTHON_BIN" -c "import sys, ctranslate2 as ct; n=ct.get_cuda_device_count(); print('CUDA device count:', n); sys.exit(0 if n > 0 else 2)"
  local status=$?
  set -e

  if [[ "$status" == "0" ]]; then
    ok "CUDA is available for faster-whisper."
  elif [[ "$status" == "2" ]]; then
    warn "CUDA device count is 0. Check NVIDIA driver/CUDA visibility, then rerun setup or source .dev-linux.env."
  else
    warn "ctranslate2 cannot use CUDA in this terminal."
  fi
}

check_llama_cpp_import() {
  "$PYTHON_BIN" - <<'PY'
try:
    import llama_cpp
except Exception as exc:
    print(f"llama_cpp_import_error={type(exc).__name__}: {exc}")
    raise SystemExit(1)

try:
    print("llama_cpp_gpu_offload=", llama_cpp.llama_supports_gpu_offload())
except Exception as exc:
    print(f"llama_cpp_gpu_offload_error={type(exc).__name__}: {exc}")
    raise SystemExit(2)
PY
}

check_amd_acceleration() {
  if [[ "$AMD_PACKAGES" != "1" && "$TORCH_BACKEND" != "rocm" && "$LLAMA_CPP_BACKEND" != "hipblas" && "$LLAMA_CPP_BACKEND" != "vulkan" && "$INSTALL_AMD_NPU" != "1" ]]; then
    return
  fi

  info "[AMD Doctor] AMD GPU/NPU validation summary..."
  if have lspci; then
    lspci | grep -Ei 'amd|ati|radeon|display|vga|3d' || true
  fi

  if [[ -e /dev/dri ]]; then
    ok "/dev/dri exists."
  else
    warn "/dev/dri was not found. Vulkan/ROCm GPU access may be unavailable."
  fi
  if [[ -e /dev/kfd ]]; then
    ok "/dev/kfd exists."
  else
    warn "/dev/kfd was not found. ROCm compute access may be unavailable."
  fi

  local login_user="${SUDO_USER:-${USER:-}}"
  if [[ -n "$login_user" ]]; then
    info "Groups for $login_user: $(id -nG "$login_user" 2>/dev/null || echo unknown)"
  fi

  if have rocminfo; then
    if rocminfo >/tmp/lott-rocminfo.txt 2>&1; then
      ok "rocminfo completed successfully."
      grep -E 'Name:|Marketing Name:|gfx[0-9]+' /tmp/lott-rocminfo.txt | head -n 20 || true
    else
      warn "rocminfo failed. See /tmp/lott-rocminfo.txt for details."
    fi
  else
    warn "rocminfo was not found. Install ROCm with --install-rocm for ROCm diagnostics."
  fi

  if [[ -x /opt/rocm/bin/hipconfig ]]; then
    /opt/rocm/bin/hipconfig --full | sed -n '1,80p' || warn "hipconfig failed."
  elif have hipconfig; then
    hipconfig --full | sed -n '1,80p' || warn "hipconfig failed."
  fi

  if have vulkaninfo; then
    if vulkaninfo --summary >/tmp/lott-vulkaninfo.txt 2>&1; then
      ok "vulkaninfo completed successfully."
      grep -E 'GPU[0-9]+:|deviceName|vendorID|driverName' /tmp/lott-vulkaninfo.txt | head -n 40 || true
    else
      warn "vulkaninfo failed. See /tmp/lott-vulkaninfo.txt for details."
    fi
  else
    warn "vulkaninfo was not found. Install AMD packages with --amd or --install-rocm."
  fi

  if [[ "$TORCH_BACKEND" == "rocm" ]]; then
    if ! "$PYTHON_BIN" -c "import torch; print('torch=', torch.__version__); print('torch_hip=', getattr(torch.version, 'hip', None)); print('torch_rocm_cuda_available=', torch.cuda.is_available()); print('torch_rocm_device_count=', torch.cuda.device_count())"; then
      warn "PyTorch ROCm summary failed."
    fi
  fi

  if ls /dev/accel/accel* >/dev/null 2>&1 || [[ -e /dev/accel/accel0 ]]; then
    local memlock_kb
    memlock_kb="$(ulimit -l 2>/dev/null || echo "")"
    if [[ "$memlock_kb" != "unlimited" ]]; then
      local limits_file="/etc/security/limits.d/amdxdna.conf"
      if [[ -f "$limits_file" ]]; then
        ok "AMD NPU memlock limits file exists: $limits_file"
      else
        warn "AMD NPU (/dev/accel detected) but memlock limit is ${memlock_kb:-unknown} kB."
        warn "Fix: echo '* - memlock unlimited' | sudo tee /etc/security/limits.d/amdxdna.conf && reboot"
        warn "Or rerun setup with --install-amd-npu to configure it automatically."
      fi
    fi
  fi

  if have xrt-smi; then
    if xrt-smi examine; then
      ok "xrt-smi detected an XRT/NPU runtime."
    else
      warn "xrt-smi exists but NPU examination failed."
    fi
  elif [[ "$INSTALL_AMD_NPU" == "1" ]]; then
    warn "xrt-smi was not found. AMD NPU runtime may need reboot or manual XRT/FastFlowLM installation."
  fi

  if have flm; then
    flm validate || warn "FastFlowLM validation failed."
  elif [[ "$INSTALL_AMD_NPU" == "1" ]]; then
    warn "FastFlowLM CLI was not found. Install the FLM .deb package before NPU LLM validation."
  fi

  if have lemonade; then
    lemonade backends || warn "lemonade backends failed."
  elif have lemond; then
    info "lemond (Lemonade daemon) is installed. Install the Lemonade CLI if you want 'lemonade backends'."
  elif have lemonade-server; then
    lemonade-server --help >/dev/null 2>&1 || true
    info "lemonade-server is installed; install the Lemonade CLI too if you want 'lemonade backends'."
  else
    info "Lemonade CLI was not found."
  fi

  info "CTranslate2 ROCm wheel status:"
  if "$PYTHON_BIN" -c "import ctranslate2; print('  ct2_version=', ctranslate2.__version__)" 2>/dev/null; then
    ok "ctranslate2 is installed (ROCm wheel expected for AMD GPU ASR)."
  else
    warn "ctranslate2 is not importable. Run setup again to fetch the ROCm wheel."
  fi
}

doctor_summary() {
  info "[Doctor] Environment summary..."
  if ! "$PYTHON_BIN" -c "import sys; print('python_exe=', sys.executable); print('python_ver=', sys.version.split()[0])"; then
    warn "Python runtime summary failed."
  fi
  if ! "$PYTHON_BIN" -c "import torch; print('torch=', torch.__version__)"; then
    warn "torch is not available."
  fi
  if ! "$PYTHON_BIN" -c "import torchaudio; print('torchaudio=', torchaudio.__version__)"; then
    warn "torchaudio is not available."
  fi
  if ! "$PYTHON_BIN" -c "import torch; print('torch_cuda_available=', torch.cuda.is_available()); print('torch_cuda_version=', torch.version.cuda); print('torch_cuda_device_count=', torch.cuda.device_count())"; then
    warn "torch CUDA summary failed."
  fi
  if ! "$PYTHON_BIN" -c "import importlib.metadata as m; print('pyannote.audio=', m.version('pyannote.audio'))"; then
    warn "pyannote.audio is not installed."
  fi

  local diar_model="$ROOT_DIR/python_sidecar/models/pyannote-speaker-diarization-community-1"
  if [[ -f "$diar_model/config.yaml" ]]; then
    ok "Local diarization model exists: $diar_model"
  else
    info "Local diarization model was not found: $diar_model"
    info "Place the model locally or use the app setup flow before offline operation."
  fi

  if [[ "$TORCH_BACKEND" == "cuda" ]]; then
    if ! "$PYTHON_BIN" -c "import ctranslate2 as ct; print('ct2_cuda_device_count=', ct.get_cuda_device_count())"; then
      warn "ctranslate2 CUDA summary failed."
    fi
  elif [[ "$TORCH_BACKEND" == "rocm" ]]; then
    if ! "$PYTHON_BIN" -c "import ctranslate2; print('ct2_version=', ctranslate2.__version__)"; then
      warn "ctranslate2 ROCm summary failed. ROCm wheel may not be installed."
    fi
  else
    info "Skipping ctranslate2 CUDA/ROCm summary because torch backend is $TORCH_BACKEND."
  fi
  if [[ "$SKIP_LLAMA_CPP" == "1" || "$LLAMA_CPP_BACKEND" == "none" ]]; then
    info "llama_cpp check skipped by setup option."
  elif ! check_llama_cpp_import; then
    warn "llama_cpp is not installed or import failed. LLM proofreading can still use Lemonade if it is available."
    if [[ "$LLAMA_CPP_BACKEND" == "hipblas" ]]; then
      warn "For AMD HIPBLAS, install ROCm compiler dependencies and rerun setup. Start with: sudo apt-get install -y libxml2 libxml2-dev"
      warn "If it still fails, check /tmp/lott-rocm-clang-check.log and the pip build output above."
    fi
  fi
}

print_development_reminders() {
  echo
  echo "開発時のリマインダー:"
  echo "- プライバシー最優先: 会話データ・音声データを外部 API に送信しない。"
  echo "- ネット接続は初回セットアップ、依存導入、モデル取得時のみ許可する。"
  echo "- LLM 優先開発では、ローカル backend の llama_cpp または Lemonade を使う。"
  echo "- AMD GPU: ctranslate2 ROCm ホイール (GitHub Releases) + ROCm PyTorch で faster-whisper が動作する。"
  echo "- AMD GPU ASR: ROCm 7.2 以降なら HSA_OVERRIDE_GFX_VERSION 不要。"
  echo "- AMD GPU でも --device cuda を渡す (HIP-CUDA 互換レイヤーのため)。"
  echo "- compute_type int8 は AMD/ROCm での動作が未確認のため UI 上で無効化している。"
  if [[ "$NEEDS_NPU_REBOOT" == "1" ]]; then
    echo
    echo "[要再起動] AMD NPU (XDNA) を有効化するには再起動が必要です。"
    echo "           再起動後に 'xrt-smi examine' で NPU が認識されているか確認してください。"
  fi
}

echo "=== Local Transcription for Therapy: Linux Development Setup ==="
echo "Repository: $ROOT_DIR"
echo "Torch backend: $TORCH_BACKEND"
echo "llama-cpp-python backend: $LLAMA_CPP_BACKEND"
if [[ "$AMD_PACKAGES" == "1" ]]; then
  echo "AMD validation packages: enabled"
fi
echo

if [[ "$ONLY_RUST" == "1" ]]; then
  check_rust
  echo
  echo "Rust/Cargo setup completed."
  exit 0
fi

install_system_packages
install_rocm_packages
install_amd_npu_packages
install_lemonade_server
ensure_amd_group_membership
check_rust
check_node
ensure_python_venv
install_npm_dependencies
install_python_dependencies
write_linux_env_file
install_llama_cpp
download_gemma_model
check_lemonade
setup_lemonade_embeddable
check_cuda
check_amd_acceleration
doctor_summary

echo
echo "Setup completed."
if [[ "$HAS_WARN" == "1" ]]; then
  echo "Completed with warnings."
else
  echo "Completed without warnings."
fi
echo "[INFO] Runtime Python: $PYTHON_BIN"
echo "[INFO] For this terminal, run: source .dev-linux.env"
echo "[INFO] For a clean rebuild, remove $VENV_DIR and rerun this script."
print_development_reminders
