#!/usr/bin/env bash
# ggml 音声エンジン（whisper.cpp + NeMo-Speech.cpp / Nemotron-3-Diarization）を開発環境へ準備する。
#
#   bash scripts/setup-ggml-speech-linux.sh [--backend vulkan|cpu] [--skip-build] [--skip-models]
#
# - 固定 commit からソースビルドし、python_sidecar/speech-engines/<engine>/ へ配置する
# - モデルは固定 revision から取得し、SHA-256 を検証して python_sidecar/models/ へ配置する
# - ネットワークを使うのはこのセットアップ時だけ。アプリの実行時は通信しない
# - システムに無いビルド依存（SPIRV-Headers / sentencepiece）はビルドキャッシュ内の prefix へ入れる（sudo 不要）
set -euo pipefail

BACKEND="vulkan"
SKIP_BUILD=0
SKIP_MODELS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --backend) BACKEND="${2:-}"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --skip-models) SKIP_MODELS=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
case "$BACKEND" in
  vulkan|cpu) ;;
  *) echo "--backend は vulkan / cpu を指定してください（cuda は未対応）: $BACKEND" >&2; exit 2 ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINES_DIR="$REPO_ROOT/python_sidecar/speech-engines"
MODELS_DIR="$REPO_ROOT/python_sidecar/models"
WORK="${XDG_CACHE_HOME:-$HOME/.cache}/lott-ggml-speech-build"
PREFIX="$WORK/prefix"
LOGS="$WORK/logs"
JOBS="${JOBS:-$(nproc)}"

# ---- 固定バージョン ----------------------------------------------------------
WHISPER_CPP_REPO="https://github.com/ggml-org/whisper.cpp.git"
WHISPER_CPP_COMMIT="d09f61a708f3487afa956ff578e60eae5e7a233c"
NEMO_SPEECH_REPO="https://github.com/NVIDIA/NeMo-Speech.cpp.git"
NEMO_SPEECH_COMMIT="97a15afa5caa9bce5baaa86c1184103877af4101"
SPIRV_HEADERS_REPO="https://github.com/KhronosGroup/SPIRV-Headers.git"
SPIRV_HEADERS_COMMIT="f1fa5178eced755a189619b8e4546bcc2ce69fdd"
SENTENCEPIECE_REPO="https://github.com/google/sentencepiece.git"
SENTENCEPIECE_COMMIT="31646a467d2051eb904e0b45de3a73e91fe1c1e3" # v0.2.1

# 形式: 配置先相対パス|URL|SHA-256
MODELS=(
  "whisper-ggml/ggml-large-v3-turbo.bin|https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo.bin|1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69"
  "whisper-ggml/ggml-silero-v6.2.0.bin|https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin|2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987"
  "nemotron-3-diarization/Nemotron-3-Diarization.q8_0.gguf|https://huggingface.co/nvidia/Nemotron-3-Diarization/resolve/f667ed73aee57d40cc39428eb768b4fd87a0a29e/Nemotron-3-Diarization.q8_0.gguf|08456d9e22cd9a323c0364d98375f3746d6e68507ebb705cd46438c534c7a3a1"
)

log() { printf '[ggml-speech] %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "必要なコマンドがありません: $1" >&2; exit 1; }; }

checkout() { # name repo commit [--recurse]
  local name="$1" repo="$2" commit="$3" dir="$WORK/src/$1"
  if [ ! -d "$dir/.git" ]; then
    log "取得: $name"
    git clone --quiet "$repo" "$dir"
  fi
  if [ "$(git -C "$dir" rev-parse HEAD)" != "$commit" ]; then
    git -C "$dir" fetch --quiet origin "$commit" || git -C "$dir" fetch --quiet origin
    git -C "$dir" checkout --quiet --detach "$commit"
  fi
  if [ "${4:-}" = "--recurse" ]; then
    git -C "$dir" submodule update --init --quiet ggml
  fi
}

build_deps() {
  if [ "$BACKEND" = "vulkan" ] && [ ! -f /usr/include/spirv/unified1/spirv.hpp ] && [ ! -f "$PREFIX/include/spirv/unified1/spirv.hpp" ]; then
    checkout SPIRV-Headers "$SPIRV_HEADERS_REPO" "$SPIRV_HEADERS_COMMIT"
    log "ビルド: SPIRV-Headers（ローカル prefix）"
    cmake -S "$WORK/src/SPIRV-Headers" -B "$WORK/build/SPIRV-Headers" -G Ninja \
      -DCMAKE_INSTALL_PREFIX="$PREFIX" -DSPIRV_HEADERS_ENABLE_TESTS=OFF >"$LOGS/spirv.log" 2>&1
    cmake --install "$WORK/build/SPIRV-Headers" >>"$LOGS/spirv.log" 2>&1
  fi
  if ! pkg-config --exists sentencepiece 2>/dev/null && [ ! -f "$PREFIX/include/sentencepiece_processor.h" ]; then
    checkout sentencepiece "$SENTENCEPIECE_REPO" "$SENTENCEPIECE_COMMIT"
    log "ビルド: sentencepiece（ローカル prefix、静的）"
    cmake -S "$WORK/src/sentencepiece" -B "$WORK/build/sentencepiece" -G Ninja \
      -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" -DSPM_ENABLE_SHARED=OFF >"$LOGS/sp.log" 2>&1
    cmake --build "$WORK/build/sentencepiece" -j "$JOBS" >>"$LOGS/sp.log" 2>&1
    cmake --install "$WORK/build/sentencepiece" >>"$LOGS/sp.log" 2>&1
  fi
}

build_whisper() {
  checkout whisper.cpp "$WHISPER_CPP_REPO" "$WHISPER_CPP_COMMIT"
  local build="$WORK/build/whisper-$BACKEND" gpu=OFF
  [ "$BACKEND" = "vulkan" ] && gpu=ON
  log "ビルド: whisper.cpp（$BACKEND、静的リンク）"
  cmake -S "$WORK/src/whisper.cpp" -B "$build" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF -DGGML_VULKAN="$gpu" -DGGML_NATIVE=OFF \
    -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF >"$LOGS/whisper.log" 2>&1
  cmake --build "$build" -j "$JOBS" --target whisper-cli >>"$LOGS/whisper.log" 2>&1
  local dest="$ENGINES_DIR/whisper"
  rm -rf "$dest.tmp" && mkdir -p "$dest.tmp/bin"
  cp "$build/bin/whisper-cli" "$dest.tmp/bin/"
  cp "$WORK/src/whisper.cpp/LICENSE" "$dest.tmp/LICENSE-whisper.cpp.txt"
  printf 'whisper.cpp %s\nbackend %s\n' "$WHISPER_CPP_COMMIT" "$BACKEND" >"$dest.tmp/BUILD_INFO.txt"
  rm -rf "$dest" && mv "$dest.tmp" "$dest"
}

build_nemo() {
  checkout NeMo-Speech.cpp "$NEMO_SPEECH_REPO" "$NEMO_SPEECH_COMMIT" --recurse
  local preset="$BACKEND-diar"
  log "ビルド: NeMo-Speech.cpp（$preset）"
  (
    cd "$WORK/src/NeMo-Speech.cpp"
    rm -rf "build/$preset"
    scripts/configure.sh "$preset" -DGGML_NATIVE=OFF >"$LOGS/nemo.log" 2>&1
    cmake --build --preset "$preset" -j "$JOBS" >>"$LOGS/nemo.log" 2>&1
  )
  local out="$WORK/src/NeMo-Speech.cpp/build/$preset/bin" dest="$ENGINES_DIR/nemo"
  rm -rf "$dest.tmp" && mkdir -p "$dest.tmp/bin"
  # nemo-speech は RUNPATH=$ORIGIN なので、同じディレクトリの共有ライブラリと一緒に置く
  cp "$out/nemo-speech" "$dest.tmp/bin/"
  cp -P "$out"/*.so* "$dest.tmp/bin/" 2>/dev/null || true
  for f in LICENSE NOTICE THIRD_PARTY_NOTICES.md; do
    cp "$WORK/src/NeMo-Speech.cpp/$f" "$dest.tmp/$f-NeMo-Speech.cpp" 2>/dev/null || true
  done
  printf 'NeMo-Speech.cpp %s\npreset %s\n' "$NEMO_SPEECH_COMMIT" "$preset" >"$dest.tmp/BUILD_INFO.txt"
  rm -rf "$dest" && mv "$dest.tmp" "$dest"
}

download_models() {
  for entry in "${MODELS[@]}"; do
    IFS='|' read -r rel url sha <<<"$entry"
    local path="$MODELS_DIR/$rel"
    if [ -f "$path" ] && echo "$sha  $path" | sha256sum -c --status; then
      log "取得済み: $rel"
      continue
    fi
    log "取得: $rel"
    mkdir -p "$(dirname "$path")"
    curl -fL --retry 3 -C - -o "$path.partial" "$url"
    if ! echo "$sha  $path.partial" | sha256sum -c --status; then
      echo "SHA-256 が一致しません: $rel" >&2
      rm -f "$path.partial"
      exit 1
    fi
    mv "$path.partial" "$path"
  done
}

need git; need curl; need sha256sum
mkdir -p "$WORK/src" "$WORK/build" "$LOGS" "$ENGINES_DIR"
if [ "$SKIP_BUILD" -eq 0 ]; then
  need cmake; need ninja; need c++
  [ "$BACKEND" = "vulkan" ] && need glslc
  export CMAKE_PREFIX_PATH="$PREFIX${CMAKE_PREFIX_PATH:+:$CMAKE_PREFIX_PATH}"
  export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
  # ggml-vulkan は spirv/unified1/spirv.hpp を include パスから直接読む
  export CPLUS_INCLUDE_PATH="$PREFIX/include${CPLUS_INCLUDE_PATH:+:$CPLUS_INCLUDE_PATH}"
  build_deps
  build_whisper
  build_nemo
fi
[ "$SKIP_MODELS" -eq 0 ] && download_models

log "完了"
log "  whisper-cli : $ENGINES_DIR/whisper/bin/whisper-cli"
log "  nemo-speech : $ENGINES_DIR/nemo/bin/nemo-speech"
log "  models      : $MODELS_DIR/whisper-ggml/, $MODELS_DIR/nemotron-3-diarization/"
log "ビルドログ: $LOGS"
