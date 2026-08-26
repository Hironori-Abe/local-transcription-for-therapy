#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DEV_VARIANT="${LOTT_DEV_VARIANT:-}"
case "$DEV_VARIANT" in
  nvidia)
    EXPECTED_TORCH_BACKEND="cuda"
    DEFAULT_ENV_FILE="$ROOT_DIR/.dev-linux-cuda.env"
    DEFAULT_VENV_DIR="$ROOT_DIR/.venv312-nvidia"
    DEFAULT_TAURI_CONFIGS="tauri.nvidia.linux.override.json tauri.nvidia.dev.linux.override.json"
    ;;
  amd)
    EXPECTED_TORCH_BACKEND="rocm"
    DEFAULT_ENV_FILE="$ROOT_DIR/.dev-linux-rocm.env"
    DEFAULT_VENV_DIR="$ROOT_DIR/.venv312-amd"
    DEFAULT_TAURI_CONFIGS="tauri.amd.linux.override.json tauri.amd.dev.linux.override.json"
    ;;
  cpu)
    EXPECTED_TORCH_BACKEND="cpu"
    DEFAULT_ENV_FILE="$ROOT_DIR/.dev-linux-cpu.env"
    DEFAULT_VENV_DIR="$ROOT_DIR/.venv312-cpu"
    DEFAULT_TAURI_CONFIGS="tauri.cpu.linux.override.json tauri.cpu.dev.linux.override.json"
    ;;
  *)
    printf '[ERROR] Linux development variant was not selected; refusing to default to NVIDIA/CUDA.\n' >&2
    printf '        Use one of:\n' >&2
    printf '          bash scripts/run-dev-nvidia.sh\n' >&2
    printf '          bash scripts/run-dev-amd.sh\n' >&2
    printf '          bash scripts/run-dev-cpu.sh\n' >&2
    exit 2
    ;;
esac

FRONTEND_PID=""
FRONTEND_STARTED=0
FRONTEND_HOST="${LOTT_FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${LOTT_FRONTEND_PORT:-4200}"
FRONTEND_URL="${LOTT_FRONTEND_URL:-http://${FRONTEND_HOST}:${FRONTEND_PORT}}"
FRONTEND_BUILD_TARGET="${LOTT_FRONTEND_BUILD_TARGET:-}"
DEV_ENV_FILE="$DEFAULT_ENV_FILE"
TAURI_CONFIGS_STRING="$DEFAULT_TAURI_CONFIGS"
EMULATION_MODE="${OFFLINE_TRANSCRIBER_DEV_EMULATION_MODE:-${RUN_DEV_EMULATION_MODE:-none}}"
EMULATION_STATE_FILE="$ROOT_DIR/.dev-runtime-emulation.env"
export LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS="${LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS:-1800}"

info() {
  printf '[INFO] %s\n' "$*"
}

ok() {
  printf '[OK] %s\n' "$*"
}

warn() {
  printf '[WARN] %s\n' "$*" >&2
}

die() {
  printf '[ERROR] %s\n' "$*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

check_linux_audio_plugins() {
  if ! have gst-inspect-1.0; then
    die "GStreamer tools were not found. Run scripts/setup-dev-${DEV_VARIANT}.sh to install the required LGPL GStreamer plugins."
  fi

  # WebKitGTK delegates <audio> playback to GStreamer. In particular, MP3 files with
  # ID3 metadata require id3demux before the MP3 decoder is reached. If gst-plugins-good
  # is absent, WebKitGTK may neither emit loadedmetadata nor error and appear to freeze.
  local required_plugins=(playbin3 id3demux mpg123audiodec flacdec)
  local missing_plugins=()
  local plugin
  for plugin in "${required_plugins[@]}"; do
    if ! gst-inspect-1.0 "$plugin" >/dev/null 2>&1; then
      missing_plugins+=("$plugin")
    fi
  done
  if [[ "${#missing_plugins[@]}" -gt 0 ]]; then
    warn "Required GStreamer plugins are missing: ${missing_plugins[*]}"
    if have pacman; then
      die "Run 'bash scripts/setup-dev-${DEV_VARIANT}.sh' and allow CachyOS/Arch system package installation. The setup must finish with the GStreamer verification [OK] before rerunning this script."
    fi
    die "Run 'bash scripts/setup-dev-${DEV_VARIANT}.sh' and allow Ubuntu system package installation. The setup must finish with the GStreamer verification [OK] before rerunning this script."
  fi
}

# rustup でインストールされた cargo は ~/.cargo/bin にあるが、setup-dev.sh を
# 実行した直後の（あるいは新規に開いた）シェルでは PATH に乗っていないことがある。
# ここで env を読み込むことで、setup-dev.sh → run-dev.sh を 1 シェルで完結できる。
load_cargo_env() {
  if [[ -f "$HOME/.cargo/env" ]]; then
    # shellcheck disable=SC1090
    source "$HOME/.cargo/env"
  elif [[ -d "$HOME/.cargo/bin" ]]; then
    export PATH="$HOME/.cargo/bin${PATH:+:$PATH}"
  fi
}

sanitize_ld_library_path() {
  if [[ -z "${LD_LIBRARY_PATH:-}" ]]; then
    return
  fi

  local old_ifs="$IFS"
  local path_entry
  local kept=()
  local removed=()
  IFS=':'
  for path_entry in $LD_LIBRARY_PATH; do
    [[ -n "$path_entry" ]] || continue
    case "$path_entry" in
      /snap/*|/var/lib/snapd/snap/*)
        removed+=("$path_entry")
        ;;
      */site-packages/nvidia/*|*/cuda|*/cuda/*|*/cuda-*|*/cuda-*/*)
        if [[ "$DEV_VARIANT" != "nvidia" ]]; then
          removed+=("$path_entry")
        else
          kept+=("$path_entry")
        fi
        ;;
      /opt/rocm|/opt/rocm/*)
        if [[ "$DEV_VARIANT" != "amd" ]]; then
          removed+=("$path_entry")
        else
          kept+=("$path_entry")
        fi
        ;;
      *)
        kept+=("$path_entry")
        ;;
    esac
  done
  IFS="$old_ifs"

  if [[ "${#removed[@]}" -eq 0 ]]; then
    return
  fi

  if [[ "${#kept[@]}" -gt 0 ]]; then
    local joined
    joined="$(IFS=:; printf '%s' "${kept[*]}")"
    export LD_LIBRARY_PATH="$joined"
  else
    unset LD_LIBRARY_PATH
  fi

  warn "Removed library paths that do not belong to the $DEV_VARIANT development runtime."
}

cleanup() {
  if [[ "$FRONTEND_STARTED" == "1" && -n "$FRONTEND_PID" ]]; then
    info "Stopping Angular dev server..."
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
    wait "$FRONTEND_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

case "$EMULATION_MODE" in
  no_cuda|missing_community1|none)
    ;;
  *)
    EMULATION_MODE="none"
    ;;
esac
export OFFLINE_TRANSCRIBER_DEV_EMULATION_MODE="$EMULATION_MODE"

cat > "$EMULATION_STATE_FILE" <<EOF
# offline-transcriber dev emulation flags
OFFLINE_TRANSCRIBER_DEV_EMULATION_MODE=$EMULATION_MODE
EOF

if [[ -f "$DEV_ENV_FILE" ]]; then
  # shellcheck disable=SC1091
  source "$DEV_ENV_FILE"
  info "Loaded $DEV_VARIANT dev environment: ${DEV_ENV_FILE#$ROOT_DIR/}"
else
  info "${DEV_ENV_FILE#$ROOT_DIR/} was not found. Using the $DEV_VARIANT local fallback."
fi

if [[ -n "${LOTT_TORCH_BACKEND:-}" && "$LOTT_TORCH_BACKEND" != "$EXPECTED_TORCH_BACKEND" ]]; then
  die "Backend mismatch: $DEV_VARIANT launcher requires $EXPECTED_TORCH_BACKEND, but the environment selected $LOTT_TORCH_BACKEND."
fi
export LOTT_TORCH_BACKEND="$EXPECTED_TORCH_BACKEND"
if [[ "$DEV_VARIANT" != "nvidia" ]]; then
  unset CUDA_HOME CUDA_PATH LOTT_NVIDIA_LIB_PATHS
fi
if [[ "$DEV_VARIANT" != "amd" ]]; then
  unset ROCM_PATH HIP_PATH LOTT_ROCM_LIB_PATHS
fi

sanitize_ld_library_path

if [[ -z "${PYTHON_BIN:-}" ]]; then
  if [[ -x "$DEFAULT_VENV_DIR/bin/python" ]]; then
    PYTHON_BIN="$DEFAULT_VENV_DIR/bin/python"
  else
    PYTHON_BIN="python3"
  fi
  export PYTHON_BIN
fi
if [[ "$PYTHON_BIN" == "python3" ]]; then
  die "The $DEV_VARIANT backend-specific Python environment was not found. Run bash scripts/setup-dev-${DEV_VARIANT}.sh first."
fi

if [[ -z "${DIARIZATION_PYTHON_BIN:-}" ]]; then
  DIARIZATION_PYTHON_BIN="$PYTHON_BIN"
  export DIARIZATION_PYTHON_BIN
fi

have npm || die "npm was not found. Please run scripts/setup-dev-${DEV_VARIANT}.sh first."
load_cargo_env
have cargo || die "cargo was not found. Run scripts/setup-dev-${DEV_VARIANT}.sh first, or 'source \$HOME/.cargo/env'."
check_linux_audio_plugins
if [[ "$PYTHON_BIN" == */* && ! -x "$PYTHON_BIN" ]]; then
  die "Python executable was not found or is not executable: $PYTHON_BIN"
fi
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1 && [[ "$PYTHON_BIN" != */* ]]; then
  die "Python command was not found: $PYTHON_BIN"
fi
if ! "$PYTHON_BIN" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)" >/dev/null 2>&1; then
  die "The $DEV_VARIANT development runtime must use Python 3.12. Run bash scripts/setup-dev-${DEV_VARIANT}.sh to recreate its backend-specific venv."
fi

info "Python preflight:"
"$PYTHON_BIN" -c "import sys; print('executable=', sys.executable); print('version=', sys.version)" \
  || die "Python preflight failed."

if [[ "$EMULATION_MODE" == "no_cuda" ]]; then
  info "OFFLINE_TRANSCRIBER_DEV_EMULATION_MODE=no_cuda"
  info "Emulating a machine without CUDA support."
elif [[ "${LOTT_TORCH_BACKEND:-}" == "rocm" ]]; then
  info "ROCm/PyTorch preflight:"
  if ! "$PYTHON_BIN" -c "import torch; print('torch=', torch.__version__); print('torch_hip=', getattr(torch.version, 'hip', None)); print('torch_rocm_available=', torch.cuda.is_available()); print('torch_rocm_device_count=', torch.cuda.device_count())"; then
    warn "ROCm PyTorch preflight failed. LLM-only development can still use the downloaded llama.cpp ROCm/Vulkan llama-server."
  fi
elif [[ "${LOTT_TORCH_BACKEND:-}" == "cpu" ]]; then
  info "CPU PyTorch backend requested. Skipping CUDA preflight."
else
  info "ctranslate2 CUDA preflight:"
  if ! "$PYTHON_BIN" -c "import ctranslate2 as ct; n=ct.get_cuda_device_count(); print('cuda_device_count=', n); raise SystemExit(0 if n > 0 else 2)"; then
    warn "ctranslate2 CUDA preflight failed in this terminal."
    warn "Transcription may be unavailable; Read/Edit and LLM proofreading development can continue."
  fi
fi

if [[ "$EMULATION_MODE" == "missing_community1" ]]; then
  info "OFFLINE_TRANSCRIBER_DEV_EMULATION_MODE=missing_community1"
  info "Emulating missing diarization model: community-1."
fi
info "Emulation state saved: $EMULATION_STATE_FILE"

if [[ "$LOTT_TORCH_BACKEND" == "rocm" ]]; then
  info "LLM backend: downloaded llama.cpp ROCm/Vulkan llama-server direct launch."
elif [[ "$LOTT_TORCH_BACKEND" == "cpu" ]]; then
  info "LLM backend: downloaded llama.cpp CPU llama-server direct launch."
else
  info "LLM backend: bundled Linux CUDA llama-server direct launch."
fi

if [[ ! -d "$ROOT_DIR/python_sidecar/models/pyannote-speaker-diarization-community-1" ]]; then
  info "Diarization model directory not found."
  info "Creating placeholder directory so Tauri resource checks pass."
  info "Speaker diarization will be unavailable at runtime."
  mkdir -p "$ROOT_DIR/python_sidecar/models/pyannote-speaker-diarization-community-1"
fi

frontend_ready() {
  if have curl; then
    curl -fsS "$FRONTEND_URL" >/dev/null 2>&1
  else
    return 1
  fi
}

if frontend_ready; then
  ok "Angular dev server is already running: $FRONTEND_URL"
else
  info "Starting Angular dev server..."
  if [[ -n "$FRONTEND_BUILD_TARGET" ]]; then
    npm --prefix frontend run start -- \
      --host "$FRONTEND_HOST" \
      --port "$FRONTEND_PORT" \
      --build-target "$FRONTEND_BUILD_TARGET" &
  else
    npm --prefix frontend run start &
  fi
  FRONTEND_PID="$!"
  FRONTEND_STARTED=1

  info "Waiting for frontend startup: $FRONTEND_URL"
  for _ in $(seq 1 60); do
    if frontend_ready; then
      ok "Angular dev server is ready: $FRONTEND_URL"
      break
    fi
    if ! kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
      wait "$FRONTEND_PID" || true
      die "Angular dev server exited before becoming ready."
    fi
    sleep 1
  done

  frontend_ready || die "Angular dev server did not become ready within 60 seconds."
fi

read -r -a TAURI_CONFIGS <<< "$TAURI_CONFIGS_STRING"
[[ "${#TAURI_CONFIGS[@]}" -gt 0 ]] || die "No Tauri config was selected."
TAURI_ARGS=()
for config in "${TAURI_CONFIGS[@]}"; do
  [[ -f "$config" ]] || die "Tauri override was not found: $config"
  TAURI_ARGS+=(--config "$config")
done

info "Starting Tauri dev ($DEV_VARIANT)..."
info "Tauri configs=${TAURI_CONFIGS[*]}"
info "PYTHON_BIN=$PYTHON_BIN"
info "DIARIZATION_PYTHON_BIN=$DIARIZATION_PYTHON_BIN"
info "LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS=$LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS"

# WebKitGTK on Linux with ROCm: /opt/rocm/lib in LD_LIBRARY_PATH can cause WebKit's GPU
# compositor to load ROCm's OpenGL/Vulkan instead of Mesa's display stack, causing a segfault.
# Disabling compositing mode here avoids the crash without affecting the Python sidecar.
# export WEBKIT_DISABLE_COMPOSITING_MODE="${WEBKIT_DISABLE_COMPOSITING_MODE:-1}"
# info "WEBKIT_DISABLE_COMPOSITING_MODE=$WEBKIT_DISABLE_COMPOSITING_MODE"

npm run tauri:dev -- "${TAURI_ARGS[@]}"
