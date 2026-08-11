#!/usr/bin/env bash
# CachyOS/ArchホストのWebKitGTKを使うNVIDIA CUDA版pkg.tar.zstを生成する。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="$ROOT_DIR/packaging/arch"
VERSION="$(node -p "require('$ROOT_DIR/src-tauri/tauri.conf.json').version")"
EXPECTED_PKGVER="$(sed -n 's/^pkgver=//p' "$PACKAGE_DIR/PKGBUILD")"
PKGREL="$(sed -n 's/^pkgrel=//p' "$PACKAGE_DIR/PKGBUILD")"
OUTPUT_DIR="$ROOT_DIR/dist/arch/v$VERSION"
OUTPUT_NAME="LoTT-v${VERSION}-linux-x64-cuda-cachyos.pkg.tar.zst"

if [[ ! -f /etc/arch-release ]]; then
  echo '[ERROR] このパッケージはCachyOS/Arch上でビルドしてください。' >&2
  exit 1
fi
if [[ "$VERSION" != "$EXPECTED_PKGVER" ]]; then
  echo "[ERROR] tauri.conf.json ($VERSION) とPKGBUILD ($EXPECTED_PKGVER) のバージョンが一致しません。" >&2
  exit 1
fi
for command_name in makepkg node npm cargo pkg-config; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "[ERROR] 必要なコマンドがありません: $command_name" >&2
    exit 1
  fi
done
if ! pkg-config --exists webkit2gtk-4.1 gtk+-3.0; then
  echo '[ERROR] webkit2gtk-4.1 / gtk3の開発環境がありません。' >&2
  exit 1
fi

echo '=== Build CachyOS/Arch native package (NVIDIA CUDA) ==='
echo "  version: $VERSION"
echo "  WebKitGTK: $(pkg-config --modversion webkit2gtk-4.1)"
echo "  GTK: $(pkg-config --modversion gtk+-3.0)"

export LOTT_REPO_ROOT="$ROOT_DIR"
(
  cd "$PACKAGE_DIR"
  # cargoがrustup管理の場合、makepkgはArchのrustパッケージを未導入と判定する。
  # 必要なコマンドとpkg-configは上で検証済みなので、ここでは依存解決だけを省略する。
  makepkg --force --cleanbuild --noconfirm --nodeps
)

PACKAGE_PATH="$PACKAGE_DIR/local-transcription-for-therapy-cuda-${VERSION}-${PKGREL}-x86_64.pkg.tar.zst"
if [[ ! -f "$PACKAGE_PATH" ]]; then
  echo "[ERROR] 生成パッケージが見つかりません: $PACKAGE_PATH" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
install -m 0644 "$PACKAGE_PATH" "$OUTPUT_DIR/$OUTPUT_NAME"
CHECKSUM="$(sha256sum "$OUTPUT_DIR/$OUTPUT_NAME" | cut -d ' ' -f1)"
printf '%s  %s\n' "$CHECKSUM" "$OUTPUT_NAME" >"$OUTPUT_DIR/SHA256SUMS.txt"

echo '[OK] Archパッケージを生成しました。'
stat -c '  %n (%s bytes)' "$OUTPUT_DIR/$OUTPUT_NAME"
printf '%s  %s\n' "$CHECKSUM" "$OUTPUT_DIR/$OUTPUT_NAME"
