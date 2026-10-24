#!/usr/bin/env python3
"""Reject unpatched C Brotli decoders in Linux distribution artifacts.

Run only against trusted build libraries, never an uploaded/shared library.
Distribution backports need explicit review; the upstream version alone cannot
prove that a lower-version vendor library contains this fix.
"""
import ctypes
from pathlib import Path
import sys


def is_fixed(version: int) -> bool:
    major, minor, patch = version >> 24, (version >> 12) & 0xFFF, version & 0xFFF
    if major != 1:
        return False
    return (minor == 0 and patch >= 10 or minor in (1, 2) and patch >= 1
            or minor >= 3)


def check_decoder(path: Path) -> None:
    decoder = ctypes.CDLL(str(path.resolve()))
    decoder.BrotliDecoderVersion.restype = ctypes.c_uint32
    version = decoder.BrotliDecoderVersion()
    if not is_fixed(version):
        raise RuntimeError(f"CVE-2026-111497: unpatched/unreviewed Brotli: {path} "
                           f"(0x{version:08x}); use 1.0.10 / 1.1.1 / 1.2.1 or later")
    print(f"[OK] Brotli decoder: {path} (0x{version:08x})")


def main() -> None:
    root = Path(sys.argv[1])
    decoders = sorted({p.resolve() for p in root.rglob('libbrotlidec.so*')})
    if not decoders:
        raise RuntimeError(f"Brotli decoder missing from {root}")
    for decoder in decoders:
        check_decoder(decoder)


if __name__ == '__main__':
    main()
