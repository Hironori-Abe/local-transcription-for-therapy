#!/usr/bin/env bash
# Build the Linux NVIDIA llama-server from the pinned llama.cpp source tag.
#
# ggml-org publishes CUDA llama-server archives for Windows, but not for Linux.
# The Linux CUDA runtime therefore has to be built from source and bundled with
# the Linux NVIDIA editions.  This script deliberately uses an official NVIDIA
# CUDA devel image so the result does not depend on the host's CUDA Toolkit.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESOURCE_DIR="${LOTT_LLAMA_CUDA_RESOURCE_DIR:-$ROOT_DIR/src-tauri/resources/llama-server/cuda}"
BUILD_TAG="${LLAMA_CPP_BUILD:-b10075}"
BUILD_COMMIT="${LLAMA_CPP_COMMIT:-76f46ad29d61fd8c1401e8221842934bf62a6064}"
CUDA_IMAGE="${LLAMA_CUDA_IMAGE:-nvidia/cuda:12.4.1-devel-ubuntu22.04@sha256:5645fec64549cc35930eee9d85aafd2b0006c0c3f22632be5a1d85e2604e9749}"
SOURCE_URL="https://github.com/ggml-org/llama.cpp/archive/${BUILD_COMMIT}.tar.gz"
SOURCE_SHA256="${LLAMA_CPP_SOURCE_SHA256:-7ee81d765c2de832b459580a98d04045a8ed84f9829dea89d8c64528b78cea5b}"

usage() {
  cat <<'EOF'
Usage: scripts/build-llama-server-cuda-linux.sh [--ensure | --force | --check]

Build the Linux NVIDIA llama-server from the pinned llama.cpp source tag.

  --ensure  Keep a valid existing build, or build it when missing (default).
  --force   Rebuild even when the current resource is valid.
  --check   Check the bundled binary and build record without changing files.

Environment:
  LLAMA_CPP_BUILD             Source tag (default: b10075).
  LLAMA_CPP_COMMIT            Pinned source commit (default: 76f46ad29d61fd8c1401e8221842934bf62a6064).
  LLAMA_CPP_SOURCE_SHA256     SHA-256 of the commit tarball (default: 7ee81d...cea5b).
  LLAMA_CUDA_IMAGE            CUDA devel image (default: nvidia/cuda:12.4.1-devel-ubuntu22.04@sha256:5645fec64549cc35930eee9d85aafd2b0006c0c3f22632be5a1d85e2604e9749).
  LOTT_LLAMA_CUDA_RESOURCE_DIR  Output directory override.
EOF
}

MODE="ensure"
for arg in "$@"; do
  case "$arg" in
    --ensure) MODE="ensure" ;;
    --force) MODE="force" ;;
    --check) MODE="check" ;;
    --help|-h) usage; exit 0 ;;
    *) echo "[ERROR] Unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

server_path="$RESOURCE_DIR/llama-server"
build_info_path="$RESOURCE_DIR/LLAMA_CPP_BUILD_INFO.txt"
runtime_license_path="$RESOURCE_DIR/NVIDIA-CUDA-RUNTIME-LICENSE.txt"

resource_is_valid() {
  [[ -x "$server_path" ]] || return 1
  [[ -s "$server_path" ]] || return 1
  [[ -f "$build_info_path" ]] || return 1
  [[ -s "$runtime_license_path" ]] || return 1
  grep -Fqx "source_tag=$BUILD_TAG" "$build_info_path" \
    && grep -Fqx "source_commit=$BUILD_COMMIT" "$build_info_path" \
    && grep -Fqx "source_sha256=$SOURCE_SHA256" "$build_info_path" \
    && grep -Fqx "build_image=$CUDA_IMAGE" "$build_info_path" \
    && grep -Fq 'LLAMA_BUILD_TOOLS=ON' "$build_info_path" \
    && grep -Fq 'GGML_CUDA_NCCL=OFF' "$build_info_path" \
    && grep -Fq 'LLAMA_BUILD_UI=OFF' "$build_info_path" \
    && grep -Fq 'LLAMA_USE_PREBUILT_UI=OFF' "$build_info_path"
}

if resource_is_valid; then
  echo "[OK] Linux CUDA llama-server $BUILD_TAG is already present: $server_path"
  [[ "$MODE" != force ]] && exit 0
  echo "[INFO] --force was specified; rebuilding the pinned source."
elif [[ "$MODE" == check ]]; then
  echo "[ERROR] Linux CUDA llama-server $BUILD_TAG is missing or incomplete: $RESOURCE_DIR" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[ERROR] Docker is required to build the reproducible Linux CUDA llama-server." >&2
  echo "        Install Docker or provide a prebuilt resource directory and rerun with --check." >&2
  exit 1
fi

mkdir -p "$RESOURCE_DIR"
owner_uid="${SUDO_UID:-$(id -u)}"
owner_gid="${SUDO_GID:-$(id -g)}"

echo "[INFO] Building llama.cpp $BUILD_TAG with CUDA in $CUDA_IMAGE ..."
docker run --rm --interactive --platform linux/amd64 \
  --volume "$RESOURCE_DIR:/lott-output" \
  --env "BUILD_TAG=$BUILD_TAG" \
  --env "BUILD_COMMIT=$BUILD_COMMIT" \
  --env "SOURCE_SHA256=$SOURCE_SHA256" \
  --env "CUDA_IMAGE=$CUDA_IMAGE" \
  --env "SOURCE_URL=$SOURCE_URL" \
  --env "OUTPUT_UID=$owner_uid" \
  --env "OUTPUT_GID=$owner_gid" \
  "$CUDA_IMAGE" bash -s <<'CONTAINER_SCRIPT'
set -Eeuo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl cmake ninja-build patchelf pkg-config tar
rm -rf /var/lib/apt/lists/*

work=/tmp/lott-llama-cuda
src_archive="$work/llama.cpp.tar.gz"
src_dir="$work/source"
build_dir="$work/build"
install_dir="$work/install"
rm -rf "$work"
mkdir -p "$work" "$src_dir"
curl --fail --location --retry 3 --output "$src_archive" "$SOURCE_URL"
echo "$SOURCE_SHA256  $src_archive" | sha256sum --check --status
tar -xzf "$src_archive" --strip-components=1 -C "$src_dir"

cmake -S "$src_dir" -B "$build_dir" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$install_dir" \
  -DCMAKE_INSTALL_RPATH='$ORIGIN' \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_BACKEND_DL=OFF \
  -DGGML_CUDA=ON \
  -DGGML_CUDA_NCCL=OFF \
  -DGGML_NATIVE=OFF \
  -DLLAMA_BUILD_SERVER=ON \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_TOOLS=ON \
  -DLLAMA_BUILD_UI=OFF \
  -DLLAMA_USE_PREBUILT_UI=OFF \
  -DLLAMA_CURL=OFF
cmake --build "$build_dir" --target llama-server --parallel "$(nproc)"

server="$(find "$build_dir" -type f -name llama-server -perm -u+x -print -quit)"
if [[ -z "$server" ]]; then
  echo "[ERROR] llama-server was not produced by the b10075 source build." >&2
  exit 1
fi

rm -rf /lott-output/*
install -Dm755 "$server" /lott-output/llama-server
strip --strip-unneeded /lott-output/llama-server
patchelf --set-rpath '$ORIGIN' /lott-output/llama-server

# CUDA's driver library (libcuda.so.1) is supplied by the host NVIDIA driver
# and must never be copied from the toolkit's stub directory.  The CUDA runtime
# and math libraries below are redistributable runtime components of the CUDA
# Toolkit and are bundled beside llama-server for a host-toolkit-free install.
cuda_lib_dirs=(
  /usr/local/cuda/targets/x86_64-linux/lib
  /usr/local/cuda/lib64
)
for pattern in 'libcudart.so.*' 'libcublas.so.*' 'libcublasLt.so.*'; do
  found_dir=""
  for dir in "${cuda_lib_dirs[@]}"; do
    candidate="$(find "$dir" -maxdepth 1 -type f -name "$pattern" ! -path '*/stubs/*' -print -quit 2>/dev/null || true)"
    if [[ -n "$candidate" ]]; then
      found_dir="$dir"
      break
    fi
  done
  if [[ -n "$found_dir" ]]; then
    # Keep both SONAME symlinks and their real targets (e.g. libcublas.so.12
    # -> libcublas.so.12.4.5), otherwise the dynamic loader cannot resolve the
    # library using its embedded SONAME.
    while IFS= read -r candidate; do
      cp -a "$candidate" /lott-output/
    done < <(find "$found_dir" -maxdepth 1 \( -type f -o -type l \) -name "$pattern" ! -path '*/stubs/*' -print)
  fi
done

for required_pattern in 'libcudart.so.*' 'libcublas.so.*' 'libcublasLt.so.*'; do
  if ! compgen -G "/lott-output/$required_pattern" >/dev/null 2>&1; then
    echo "[ERROR] Required CUDA redistributable library is missing: $required_pattern" >&2
    exit 1
  fi
done

# Keep a license document from the exact official CUDA container used for the
# build beside the redistributable runtime.  CUDA images have used both a
# toolkit EULA path and /NGC-DL-CONTAINER-LICENSE over time, so prefer the
# toolkit EULA/LICENSE candidates and retain the NGC license as a fallback.
cuda_license_source=""
for candidate in \
  /usr/local/cuda/EULA.txt \
  /usr/local/cuda/EULA \
  /usr/local/cuda/LICENSE.txt \
  /usr/local/cuda/LICENSE \
  /usr/local/cuda/doc/EULA.txt \
  /usr/local/cuda/doc/LICENSE.txt \
  /NGC-DL-CONTAINER-LICENSE; do
  if [[ -s "$candidate" ]]; then
    cuda_license_source="$candidate"
    break
  fi
done
if [[ -z "$cuda_license_source" ]]; then
  while IFS= read -r candidate; do
    if [[ -s "$candidate" ]]; then
      cuda_license_source="$candidate"
      break
    fi
  done < <(
    find /usr/local -maxdepth 4 -type f \
      \( -iname 'EULA*' -o -iname 'LICENSE*' \) -print 2>/dev/null \
      | sort
  )
fi
if [[ -z "$cuda_license_source" ]]; then
  echo '[ERROR] No CUDA EULA/LICENSE was found in the official CUDA container.' >&2
  echo '        Expected /NGC-DL-CONTAINER-LICENSE or a CUDA EULA/LICENSE under /usr/local/cuda.' >&2
  exit 1
fi
install -Dm644 "$cuda_license_source" /lott-output/NVIDIA-CUDA-RUNTIME-LICENSE.txt

license_file=""
for candidate in "$src_dir/LICENSE" "$src_dir/LICENSE.md"; do
  if [[ -f "$candidate" ]]; then license_file="$candidate"; break; fi
done
if [[ -n "$license_file" ]]; then
  install -Dm644 "$license_file" /lott-output/LLAMA_CPP_LICENSE.txt
fi

cat > /lott-output/LLAMA_CPP_BUILD_INFO.txt <<EOF
source_project=ggml-org/llama.cpp
source_tag=$BUILD_TAG
source_commit=$BUILD_COMMIT
source_url=$SOURCE_URL
source_sha256=$SOURCE_SHA256
build_image=$CUDA_IMAGE
configure=GGML_CUDA=ON;GGML_CUDA_NCCL=OFF;GGML_NATIVE=OFF;BUILD_SHARED_LIBS=OFF;GGML_BACKEND_DL=OFF;LLAMA_BUILD_SERVER=ON;LLAMA_BUILD_TOOLS=ON;LLAMA_BUILD_UI=OFF;LLAMA_USE_PREBUILT_UI=OFF;LLAMA_CURL=OFF
cuda_driver=host NVIDIA driver (libcuda.so.1 is not bundled)
cuda_runtime=bundled CUDA 12.4 redistributable runtime/math libraries from the official NVIDIA devel image
cuda_license_source=$cuda_license_source (copied to NVIDIA-CUDA-RUNTIME-LICENSE.txt)
source_offer=Source is available from source_url; rebuild with scripts/build-llama-server-cuda-linux.sh
EOF

if readelf -d /lott-output/llama-server | grep -Fq 'libnccl.so'; then
  echo '[ERROR] The bundled Linux CUDA llama-server unexpectedly depends on NCCL.' >&2
  exit 1
fi
if ! readelf -d /lott-output/llama-server | grep -Fq 'Library runpath: [$ORIGIN]'; then
  echo '[ERROR] The bundled Linux CUDA llama-server does not use an origin-relative RUNPATH.' >&2
  exit 1
fi
if LD_LIBRARY_PATH=/lott-output ldd /lott-output/llama-server \
    | grep -E '=>[[:space:]]+not found$' \
    | grep -v 'libcuda[.]so[.]1' \
    | grep -q .; then
  echo '[ERROR] The bundled Linux CUDA llama-server has unresolved shared libraries.' >&2
  ldd /lott-output/llama-server >&2 || true
  exit 1
fi

# The container runs as root to install build dependencies. Return generated
# resources to the invoking workspace user so subsequent checks and packaging
# never depend on root-owned files.
chown -R "$OUTPUT_UID:$OUTPUT_GID" /lott-output
CONTAINER_SCRIPT

chown -R "$owner_uid:$owner_gid" "$RESOURCE_DIR" 2>/dev/null || true
chmod 0755 "$server_path"

echo "[OK] Linux CUDA llama-server $BUILD_TAG built from source: $server_path"
echo "[OK] CUDA Toolkit is not required on the target host; the NVIDIA driver remains required."
