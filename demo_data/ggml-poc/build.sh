#!/usr/bin/env bash
# whisper.cpp (Vulkan) と NeMo-Speech.cpp (Vulkan, ASR+話者分離) をこのディレクトリ内に再ビルドする。
# システムに無い SPIRV-Headers / sentencepiece は ./prefix へローカル導入する（sudo 不要）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
P="$ROOT/prefix"
L="$ROOT/logs"
mkdir -p "$L"
export CMAKE_PREFIX_PATH="$P" PKG_CONFIG_PATH="$P/lib/pkgconfig"
# ggml-vulkan は spirv/unified1/spirv.hpp を include パス前提で読むため必要
export CPLUS_INCLUDE_PATH="$P/include"

echo "[1/4] SPIRV-Headers"
cmake -S "$ROOT/src/SPIRV-Headers" -B "$ROOT/src/SPIRV-Headers/build" -G Ninja \
  -DCMAKE_INSTALL_PREFIX="$P" -DSPIRV_HEADERS_ENABLE_TESTS=OFF >"$L/spirv.log" 2>&1
cmake --install "$ROOT/src/SPIRV-Headers/build" >>"$L/spirv.log" 2>&1

echo "[2/4] sentencepiece"
cmake -S "$ROOT/src/sentencepiece" -B "$ROOT/src/sentencepiece/build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$P" -DSPM_ENABLE_SHARED=OFF >"$L/sp.log" 2>&1
cmake --build "$ROOT/src/sentencepiece/build" -j 12 >>"$L/sp.log" 2>&1
cmake --install "$ROOT/src/sentencepiece/build" >>"$L/sp.log" 2>&1

echo "[3/4] whisper.cpp (Vulkan)"
cmake -S "$ROOT/src/whisper.cpp" -B "$ROOT/src/whisper.cpp/build-vk" -G Ninja \
  -DGGML_VULKAN=ON -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF >"$L/whisper.log" 2>&1
cmake --build "$ROOT/src/whisper.cpp/build-vk" -j 12 >>"$L/whisper.log" 2>&1

echo "[4/4] NeMo-Speech.cpp (vulkan-asr: ASR + 話者分離)"
cd "$ROOT/src/NeMo-Speech.cpp"
scripts/configure.sh vulkan-asr >"$L/nemo.log" 2>&1
cmake --build --preset vulkan-asr -j 12 >>"$L/nemo.log" 2>&1

echo "done:"
ls -la "$ROOT/src/whisper.cpp/build-vk/bin/whisper-cli" "$ROOT/src/NeMo-Speech.cpp/build/vulkan-asr/bin/nemo-speech"
