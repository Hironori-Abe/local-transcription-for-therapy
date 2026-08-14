#!/usr/bin/env bash
# CachyOS/ArchホストのWebKitGTKを使うNVIDIA CUDA版pkg.tar.zstを生成する。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="$ROOT_DIR/packaging/arch"
MAKEPKG_CONFIG="$PACKAGE_DIR/makepkg-lott.conf"
VERSION="$(node -p "require('$ROOT_DIR/src-tauri/tauri.conf.json').version")"
EXPECTED_PKGVER="$(sed -n 's/^pkgver=//p' "$PACKAGE_DIR/PKGBUILD")"
PKGREL="$(sed -n 's/^pkgrel=//p' "$PACKAGE_DIR/PKGBUILD")"
CPU_TARGET="${LOTT_CPU_TARGET:-x86-64}"
BUILD_LABEL="${LOTT_BUILD_LABEL:-CachyOS/Arch native package (NVIDIA CUDA)}"
OUTPUT_DIR="${LOTT_OUTPUT_DIR:-$ROOT_DIR/dist/arch/v$VERSION}"
OUTPUT_NAME="${LOTT_OUTPUT_NAME:-LoTT-v${VERSION}-linux-x64-cuda-cachyos.pkg.tar.zst}"

case "$CPU_TARGET" in
  x86-64|x86-64-v3) ;;
  *)
    echo "[ERROR] 未対応のCPUターゲットです: $CPU_TARGET" >&2
    exit 1
    ;;
esac

if [[ ! -f /etc/arch-release ]]; then
  echo '[ERROR] このパッケージはCachyOS/Arch上でビルドしてください。' >&2
  exit 1
fi
if [[ "$VERSION" != "$EXPECTED_PKGVER" ]]; then
  echo "[ERROR] tauri.conf.json ($VERSION) とPKGBUILD ($EXPECTED_PKGVER) のバージョンが一致しません。" >&2
  exit 1
fi
for command_name in makepkg node npm cargo pkg-config bsdtar objdump readelf rg desktop-file-validate; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "[ERROR] 必要なコマンドがありません: $command_name" >&2
    exit 1
  fi
done
if ! desktop-file-validate "$PACKAGE_DIR/net.gakkousya.lott.desktop"; then
  echo '[ERROR] デスクトップエントリが不正です。' >&2
  exit 1
fi
if ! pkg-config --exists webkit2gtk-4.1 gtk+-3.0; then
  echo '[ERROR] webkit2gtk-4.1 / gtk3の開発環境がありません。' >&2
  exit 1
fi

echo "=== Build $BUILD_LABEL ==="
echo "  version: $VERSION"
echo "  CPU target: $CPU_TARGET"
echo "  WebKitGTK: $(pkg-config --modversion webkit2gtk-4.1)"
echo "  GTK: $(pkg-config --modversion gtk+-3.0)"

if rg -n -- '^[[:space:]]*(_lott_(c|cxx|rust)flags|CFLAGS|CXXFLAGS|RUSTFLAGS)=.*(-march=(native|x86-64-v4)|target-cpu=(native|x86-64-v4))' \
  "$MAKEPKG_CONFIG" "$PACKAGE_DIR/PKGBUILD"; then
  echo '[ERROR] 配布禁止のnative/x86-64-v4設定がパッケージ設定にあります。' >&2
  exit 1
fi

export LOTT_REPO_ROOT="$ROOT_DIR"
export LOTT_CPU_TARGET="$CPU_TARGET"
(
  cd "$PACKAGE_DIR"
  # cargoがrustup管理の場合、makepkgはArchのrustパッケージを未導入と判定する。
  # 必要なコマンドとpkg-configは上で検証済みなので、ここでは依存解決だけを省略する。
  makepkg --config "$MAKEPKG_CONFIG" \
    --force --cleanbuild --clean --noconfirm --nodeps
)

PACKAGE_PATH="$PACKAGE_DIR/local-transcription-for-therapy-cuda-${VERSION}-${PKGREL}-x86_64.pkg.tar.zst"
if [[ ! -f "$PACKAGE_PATH" ]]; then
  echo "[ERROR] 生成パッケージが見つかりません: $PACKAGE_PATH" >&2
  exit 1
fi

"$ROOT_DIR/scripts/verify-arch-package-cpu.sh" "$PACKAGE_PATH" "$CPU_TARGET"

PACKAGE_CONTENTS="$(bsdtar -tf "$PACKAGE_PATH")"
for icon_size in 16 32 48 64 128 256 512 1024; do
  icon_path="usr/share/icons/hicolor/${icon_size}x${icon_size}/apps/net.gakkousya.lott.png"
  if ! rg -q -x "$icon_path" <<<"$PACKAGE_CONTENTS"; then
    echo "[ERROR] パッケージに標準サイズアイコンがありません: $icon_path" >&2
    exit 1
  fi
done
if ! bsdtar -xOf "$PACKAGE_PATH" .PKGINFO \
  | rg -q -x 'depend = hicolor-icon-theme'; then
  echo '[ERROR] パッケージにhicolor-icon-theme依存がありません。' >&2
  exit 1
fi
if ! bsdtar -xOf "$PACKAGE_PATH" .PKGINFO \
  | rg -q -x 'depend = desktop-file-utils'; then
  echo '[ERROR] パッケージにdesktop-file-utils依存がありません。' >&2
  exit 1
fi
if ! rg -q -x 'usr/share/applications/net.gakkousya.lott.desktop' \
  <<<"$PACKAGE_CONTENTS"; then
  echo '[ERROR] パッケージにデスクトップエントリがありません。' >&2
  exit 1
fi
echo '[OK] デスクトップ登録・アイコン構成の検査に合格しました。'

mkdir -p "$OUTPUT_DIR"
install -m 0644 "$PACKAGE_PATH" "$OUTPUT_DIR/$OUTPUT_NAME"
CHECKSUM="$(sha256sum "$OUTPUT_DIR/$OUTPUT_NAME" | cut -d ' ' -f1)"
printf '%s  %s\n' "$CHECKSUM" "$OUTPUT_NAME" >"$OUTPUT_DIR/SHA256SUMS.txt"

echo '[OK] pacmanパッケージを生成しました。'
stat -c '  %n (%s bytes)' "$OUTPUT_DIR/$OUTPUT_NAME"
printf '%s  %s\n' "$CHECKSUM" "$OUTPUT_DIR/$OUTPUT_NAME"
