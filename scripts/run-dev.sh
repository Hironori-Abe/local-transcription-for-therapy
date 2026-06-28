#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FRONTEND_PID=""
FRONTEND_STARTED=0
FRONTEND_URL="${LOTT_FRONTEND_URL:-http://127.0.0.1:4200}"
TAURI_CONFIG="${LOTT_TAURI_DEV_CONFIG:-tauri.dev.linux.override.json}"
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

  warn "Removed Snap library paths from LD_LIBRARY_PATH to avoid glibc/libpthread conflicts."
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

if [[ -f "$ROOT_DIR/.dev-linux.env" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.dev-linux.env"
  info "Loaded Linux dev environment: .dev-linux.env"
else
  info ".dev-linux.env was not found. Using local fallbacks."
fi

sanitize_ld_library_path

if [[ -z "${PYTHON_BIN:-}" ]]; then
  if [[ -x "$ROOT_DIR/.venv312/bin/python" ]]; then
    PYTHON_BIN="$ROOT_DIR/.venv312/bin/python"
  else
    PYTHON_BIN="python3"
  fi
  export PYTHON_BIN
fi

if [[ -z "${DIARIZATION_PYTHON_BIN:-}" ]]; then
  DIARIZATION_PYTHON_BIN="$PYTHON_BIN"
  export DIARIZATION_PYTHON_BIN
fi

have npm || die "npm was not found. Please run scripts/setup-dev.sh first."
load_cargo_env
have cargo || die "cargo was not found. Run scripts/setup-dev.sh first, or 'source \$HOME/.cargo/env'."
if [[ "$PYTHON_BIN" == */* && ! -x "$PYTHON_BIN" ]]; then
  die "Python executable was not found or is not executable: $PYTHON_BIN"
fi
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1 && [[ "$PYTHON_BIN" != */* ]]; then
  die "Python command was not found: $PYTHON_BIN"
fi

info "Python preflight:"
"$PYTHON_BIN" -c "import sys; print('executable=', sys.executable); print('version=', sys.version)" \
  || die "Python preflight failed."

if [[ "$EMULATION_MODE" == "no_cuda" ]]; then
  info "OFFLINE_TRANSCRIBER_DEV_EMULATION_MODE=no_cuda"
  info "Emulating a machine without CUDA support."
elif [[ "${LOTT_TORCH_BACKEND:-}" == "rocm" ]]; then
  info "ROCm/PyTorch preflight:"
  if ! "$PYTHON_BIN" -c "import torch; print('torch=', torch.__version__); print('torch_hip=', getattr(torch.version, 'hip', None)); print('torch_cuda_available=', torch.cuda.is_available()); print('torch_cuda_device_count=', torch.cuda.device_count())"; then
    warn "ROCm PyTorch preflight failed. LLM-only development may still work with Lemonade or llama_cpp."
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

if have lemonade-server; then
  ok "Lemonade available: $(command -v lemonade-server)"
elif have lemond; then
  ok "Lemonade available (lemond): $(command -v lemond)"
elif have lemonade; then
  ok "Lemonade available: $(command -v lemonade)"
else
  info "Lemonade not found. LLM backend will use llama_cpp only."
fi

# Lemonade ポート確認と AMD GPU 向けヒント
if have lemonade; then
  _lemon_port_open=0
  if "$PYTHON_BIN" -c "import socket; s=socket.socket(); s.settimeout(0.3); s.connect(('127.0.0.1',13305)); s.close()" 2>/dev/null; then
    _lemon_port_open=1
    ok "Lemonade port 13305: open"
  else
    info "Lemonade port 13305: closed. Tauri will start lemond if bundled binary is found."
  fi
  if [[ "$_lemon_port_open" == "1" ]] && [[ "${LOTT_TORCH_BACKEND:-}" == "rocm" || -n "${HIP_VISIBLE_DEVICES:-}" ]]; then
    info "AMD GPU 環境: Lemonade で llamacpp:vulkan を使用するには次のコマンドを一度実行してください:"
    info "  lemonade load Gemma-4-E4B-it-GGUF --llamacpp vulkan --ctx-size 16384 --save-options"
  fi
fi

# lemond が残っていると Cargo が resources/lemonade/lemond を上書きできず "Text file busy" になる
LEMOND_BIN="$ROOT_DIR/src-tauri/resources/lemonade/lemond"
if pgrep -x lemond >/dev/null 2>&1; then
  info "Killing stale lemond process(es) before build..."
  pkill -x lemond >/dev/null 2>&1 || true
  sleep 0.5
fi
if [[ -f "$LEMOND_BIN" ]] && fuser "$LEMOND_BIN" >/dev/null 2>&1; then
  info "lemond binary is still locked. Sending SIGKILL..."
  fuser -k "$LEMOND_BIN" >/dev/null 2>&1 || true
  sleep 0.5
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
  npm --prefix frontend run start &
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

[[ -f "$TAURI_CONFIG" ]] || die "Tauri dev override was not found: $TAURI_CONFIG"

info "Starting Tauri dev..."
info "PYTHON_BIN=$PYTHON_BIN"
info "DIARIZATION_PYTHON_BIN=$DIARIZATION_PYTHON_BIN"
info "LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS=$LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS"

# WebKitGTK on Linux with ROCm: /opt/rocm/lib in LD_LIBRARY_PATH can cause WebKit's GPU
# compositor to load ROCm's OpenGL/Vulkan instead of Mesa's display stack, causing a segfault.
# Disabling compositing mode here avoids the crash without affecting the Python sidecar.
# export WEBKIT_DISABLE_COMPOSITING_MODE="${WEBKIT_DISABLE_COMPOSITING_MODE:-1}"
# info "WEBKIT_DISABLE_COMPOSITING_MODE=$WEBKIT_DISABLE_COMPOSITING_MODE"

npm run tauri:dev -- --config "$TAURI_CONFIG"
