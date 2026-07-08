#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FRONTEND_PID=""
FRONTEND_STARTED=0
FRONTEND_HOST="127.0.0.1"
FRONTEND_PORT="4201"
FRONTEND_URL="http://${FRONTEND_HOST}:${FRONTEND_PORT}"
EDITOR_TAURI_CONFIG="${LOTT_TAURI_EDITOR_CONFIG:-tauri.editor.ubuntu.override.json}"
EDITOR_TAURI_DEV_CONFIG="${LOTT_TAURI_EDITOR_DEV_CONFIG:-tauri.editor.dev.ubuntu.override.json}"
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

if [[ -f "$ROOT_DIR/.dev-linux.env" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.dev-linux.env"
  info "Loaded Linux dev environment: .dev-linux.env"
else
  info ".dev-linux.env was not found. Using local fallbacks."
fi

sanitize_ld_library_path

have npm || die "npm was not found. Please run scripts/setup-dev.sh first."
have curl || die "curl was not found. Please install curl so the script can wait for the frontend."
load_cargo_env
have cargo || die "cargo was not found. Run scripts/setup-dev.sh first, or 'source \$HOME/.cargo/env'."

[[ -f "$EDITOR_TAURI_CONFIG" ]] || die "Editor Tauri override was not found: $EDITOR_TAURI_CONFIG"
[[ -f "$EDITOR_TAURI_DEV_CONFIG" ]] || die "Editor Tauri dev override was not found: $EDITOR_TAURI_DEV_CONFIG"

frontend_ready() {
  curl -fsS "$FRONTEND_URL" >/dev/null 2>&1
}

if frontend_ready; then
  ok "Angular dev server is already running: $FRONTEND_URL"
else
  info "Starting Angular dev server for Editor..."
  npm --prefix frontend run start -- \
    --host "$FRONTEND_HOST" \
    --port "$FRONTEND_PORT" \
    --build-target offline-transcriber:build:editor &
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

info "Starting Tauri dev for Editor..."
info "Frontend URL=$FRONTEND_URL"
info "Tauri configs=$EDITOR_TAURI_CONFIG, $EDITOR_TAURI_DEV_CONFIG"
info "LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS=$LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS"

npm run tauri:dev -- --config "$EDITOR_TAURI_CONFIG" --config "$EDITOR_TAURI_DEV_CONFIG"
