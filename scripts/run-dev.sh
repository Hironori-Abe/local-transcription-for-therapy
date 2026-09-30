#!/usr/bin/env bash
# Development launcher for the Full edition (Vulkan: NVIDIA, AMD, and Intel; CPU without a GPU).
# Speech engines: python_sidecar/speech-engines (whisper.cpp / NeMo-Speech.cpp).
# Setup: bash scripts/setup-dev.sh
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TAURI_CONFIGS_STRING="${LOTT_TAURI_CONFIGS:-tauri.dev.linux.override.json}"
FRONTEND_PID=""
FRONTEND_STARTED=0
FRONTEND_HOST="${LOTT_FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${LOTT_FRONTEND_PORT:-4200}"
FRONTEND_URL="${LOTT_FRONTEND_URL:-http://${FRONTEND_HOST}:${FRONTEND_PORT}}"
FRONTEND_BUILD_TARGET="${LOTT_FRONTEND_BUILD_TARGET:-}"
export LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS="${LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS:-1800}"

# Options: --cpu (dev only) sets LOTT_DEV_FORCE_CPU=1 so the app treats the GPU as absent.
for arg in "$@"; do
  case "$arg" in
    --cpu) export LOTT_DEV_FORCE_CPU=1 ;;
    *) printf '[ERROR] Unknown option: %s (supported: --cpu)\n' "$arg" >&2; exit 2 ;;
  esac
done

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
    die "GStreamer tools were not found. Run scripts/setup-dev.sh to install the required LGPL GStreamer plugins."
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
    die "Run 'bash scripts/setup-dev.sh' and allow system package installation. The setup must finish with the GStreamer verification [OK] before rerunning this script."
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

# Snap 版ブラウザなどが LD_LIBRARY_PATH へ足す Snap 側ライブラリは glibc/WebKit と衝突するため外す。
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

sanitize_ld_library_path

have npm || die "npm was not found. Run scripts/setup-dev.sh first."
have curl || die "curl was not found. Please install curl so the script can wait for the frontend."
load_cargo_env
have cargo || die "cargo was not found. Run scripts/setup-dev.sh first, or 'source \$HOME/.cargo/env'."
check_linux_audio_plugins

WHISPER_BIN="${LOTT_WHISPER_CPP_BIN:-$ROOT_DIR/python_sidecar/speech-engines/whisper/bin/whisper-cli}"
NEMO_BIN="${LOTT_NEMO_SPEECH_BIN:-$ROOT_DIR/python_sidecar/speech-engines/nemo/bin/nemo-speech}"
if [[ ! -x "$WHISPER_BIN" || ! -x "$NEMO_BIN" ]]; then
  die "ggml speech engines were not found. Run: bash scripts/setup-dev.sh (or bash scripts/setup-ggml-speech-linux.sh)"
fi

frontend_ready() {
  curl -fsS "$FRONTEND_URL" >/dev/null 2>&1
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
    npm --prefix frontend run start -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" &
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

info "Starting Tauri dev (Full edition)..."
info "Tauri configs=${TAURI_CONFIGS[*]}"
info "LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS=$LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS"
if [[ "${LOTT_DEV_FORCE_CPU:-}" == "1" ]]; then
  info "LOTT_DEV_FORCE_CPU=1: speech engines run on CPU only (dev builds)."
fi

npm run tauri:dev -- "${TAURI_ARGS[@]}"
