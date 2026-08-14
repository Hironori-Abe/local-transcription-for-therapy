#!/usr/bin/env bash
# pacmanパッケージ内のLoTT本体が配布禁止のAVX-512命令を含まないことを確認する。
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <package.pkg.tar.zst> [x86-64|x86-64-v3]" >&2
  exit 2
fi

PACKAGE_PATH="$(realpath "$1")"
EXPECTED_CPU_TARGET="${2:-x86-64}"
case "$EXPECTED_CPU_TARGET" in
  x86-64|x86-64-v3) ;;
  *)
    echo "[ERROR] 未対応の検証対象です: $EXPECTED_CPU_TARGET" >&2
    exit 2
    ;;
esac
if [[ ! -f "$PACKAGE_PATH" ]]; then
  echo "[ERROR] パッケージが見つかりません: $PACKAGE_PATH" >&2
  exit 1
fi
for command_name in bsdtar objdump readelf rg; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "[ERROR] 検証に必要なコマンドがありません: $command_name" >&2
    exit 1
  fi
done

VERIFY_DIR="$(mktemp -d /tmp/lott-arch-cpu-verify.XXXXXX)"
cleanup() {
  if [[ "$VERIFY_DIR" == /tmp/lott-arch-cpu-verify.* ]]; then
    rm -rf -- "$VERIFY_DIR"
  fi
}
trap cleanup EXIT

bsdtar -xf "$PACKAGE_PATH" -C "$VERIFY_DIR"
LOTT_BIN="$VERIFY_DIR/usr/lib/Local Transcription for Therapy/lott-bin"
BUILD_RECORD="$VERIFY_DIR/usr/share/doc/local-transcription-for-therapy-cuda/BUILD_CPU_TARGET.txt"
if [[ ! -x "$LOTT_BIN" ]]; then
  echo '[ERROR] パッケージ内にlott-binがありません。' >&2
  exit 1
fi

DISASSEMBLY="$VERIFY_DIR/lott-bin.disassembly.txt"
LC_ALL=C objdump -d --no-show-raw-insn "$LOTT_BIN" >"$DISASSEMBLY"
if rg -n -m 20 '%zmm[0-9]+|%k[0-7]([^[:alnum:]_]|$)|\{1to(8|16)\}' \
  "$DISASSEMBLY"; then
  echo '[ERROR] lott-binにAVX-512命令の特徴（ZMM/mask/broadcast）が見つかりました。' >&2
  exit 1
fi

ELF_NOTES="$VERIFY_DIR/lott-bin.notes.txt"
LC_ALL=C readelf --notes "$LOTT_BIN" >"$ELF_NOTES"
if rg -i 'x86 ISA needed:.*(x86-64-v4|AVX512)' "$ELF_NOTES"; then
  echo '[ERROR] ELF属性がx86-64-v4/AVX-512を要求しています。' >&2
  exit 1
fi

if [[ ! -f "$BUILD_RECORD" ]]; then
  echo '[ERROR] CPUターゲットのビルド記録がありません。' >&2
  exit 1
fi
if rg -n '^(cflags|cxxflags|rustflags)=.*(-march=native|target-cpu=native|x86-64-v4)' \
  "$BUILD_RECORD"; then
  echo '[ERROR] 配布禁止のnative/x86-64-v4設定がビルド記録に残っています。' >&2
  exit 1
fi
if ! rg -q "^cpu_target=${EXPECTED_CPU_TARGET}$" "$BUILD_RECORD"; then
  echo "[ERROR] CPUターゲットが期待値（$EXPECTED_CPU_TARGET）と一致しません。" >&2
  sed -n '1,20p' "$BUILD_RECORD" >&2
  exit 1
fi
if ! rg -q "^cflags=-march=${EXPECTED_CPU_TARGET}([[:space:]]|$)" "$BUILD_RECORD"; then
  echo "[ERROR] CFLAGSが期待値（$EXPECTED_CPU_TARGET）と一致しません。" >&2
  exit 1
fi
if ! rg -q "^rustflags=.*target-cpu=${EXPECTED_CPU_TARGET}([[:space:]]|$)" "$BUILD_RECORD"; then
  echo "[ERROR] RUSTFLAGSが期待値（$EXPECTED_CPU_TARGET）と一致しません。" >&2
  exit 1
fi

echo '[OK] CPU互換性の静的検査に合格しました。'
sed -n '1,20p' "$BUILD_RECORD"
