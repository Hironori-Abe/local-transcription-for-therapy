#!/usr/bin/env bash
# 使い方: ./run.sh <音声ファイル> <既存LoTT JSON> <名前> [vulkanデバイス番号(既定0)]
# whisper.cpp(turbo) で文字起こし → Nemotron-3-Diarization で話者分離 → 統合して既存出力と比較する。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
IN="$1"; REF="$2"; NAME="$3"; DEV="${4:-0}"
W="$ROOT/src/whisper.cpp/build-vk/bin/whisper-cli"
N="$ROOT/src/NeMo-Speech.cpp/build/vulkan-asr/bin/nemo-speech"
mkdir -p "$ROOT/audio" "$ROOT/out"
WAV="$ROOT/audio/$NAME.wav"
[ -f "$WAV" ] || ffmpeg -hide_banner -loglevel error -y -i "$IN" -ar 16000 -ac 1 -c:a pcm_s16le "$WAV"
[ -f "$ROOT/models/ggml-large-v3-turbo.bin" ] || curl -sSL -o "$ROOT/models/ggml-large-v3-turbo.bin" \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin

echo "== whisper.cpp (vulkan:$DEV)"
GGML_VK_VISIBLE_DEVICES="$DEV" python3 "$ROOT/timeit.py" "$ROOT/out/$NAME.whisper.stdout" "$ROOT/out/$NAME.whisper.stderr" \
  "$W" -m "$ROOT/models/ggml-large-v3-turbo.bin" -l ja -f "$WAV" -oj -ojf -of "$ROOT/out/whisper_$NAME" -np -t 8
echo "== Nemotron-3-Diarization (vulkan:$DEV)"
python3 "$ROOT/timeit.py" "$ROOT/out/diar_$NAME.json" "$ROOT/out/diar_$NAME.stderr" \
  "$N" diarize "$WAV" --device "vulkan:$DEV" --format json
echo "== 統合・比較"
uv run -q --no-project --with rapidfuzz,numpy,scipy python "$ROOT/analyze.py" \
  "$ROOT/out/whisper_$NAME.json" "$ROOT/out/diar_$NAME.json" "$REF" "$ROOT/out/merged_$NAME.json"
