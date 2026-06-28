#!/usr/bin/env python3
"""download_llama_backend_cli.py — download a llama.cpp server backend (ROCm / Vulkan / CPU)
directly from the upstream ggml-org/llama.cpp GitHub releases.

This replaces `lemonade backends install` so the app no longer depends on the Lemonade
CLI/daemon to obtain the GPU llama-server binaries. The downloaded binaries are the same
builds Lemonade's `rocm-stable` / `vulkan` channels fetch (upstream b96xx releases).

The ROCm build (`ubuntu-rocm-7.2`) links the *system* ROCm runtime (/opt/rocm), which is the
configuration the app's direct-launch and 12B paths already rely on. MIT-licensed binaries;
this is a setup-time download only (no conversation/audio data is sent anywhere).

Usage:
    python download_llama_backend_cli.py --backend rocm|vulkan|cpu --dest <dir> [--build b9631]

Extracts the archive's top-level `llama-b<N>/` contents (llama-server + lib*.so/.dll) directly
into <dest>, so find_lemonade_rocm/vulkan_llama_server resolve them unchanged. Prints
human-readable progress lines to stdout (relayed to the UI by the Rust caller).
"""

import argparse
import os
import shutil
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path

# Pinned upstream llama.cpp build. b9631 ships ubuntu-rocm-7.2 / ubuntu-vulkan / ubuntu-x64
# and the matching win-hip-radeon / win-vulkan assets (verified). Bump in lockstep with the
# bundled backend version when updating llama.cpp.
DEFAULT_BUILD = "b9631"
REPO = "ggml-org/llama.cpp"

# (backend, os) -> release asset filename template ({b} = build tag, e.g. b9631)
_ASSETS = {
    ("rocm", "linux"): "llama-{b}-bin-ubuntu-rocm-7.2-x64.tar.gz",
    ("rocm", "windows"): "llama-{b}-bin-win-hip-radeon-x64.zip",
    ("vulkan", "linux"): "llama-{b}-bin-ubuntu-vulkan-x64.tar.gz",
    ("vulkan", "windows"): "llama-{b}-bin-win-vulkan-x64.zip",
    ("cpu", "linux"): "llama-{b}-bin-ubuntu-x64.tar.gz",
    ("cpu", "windows"): "llama-{b}-bin-win-cpu-x64.zip",
}

_LABELS = {"rocm": "ROCm バックエンド", "vulkan": "Vulkan バックエンド", "cpu": "CPU バックエンド"}


def _emit(msg: str) -> None:
    print(msg, flush=True)


def _os_key() -> str:
    return "windows" if sys.platform.startswith("win") else "linux"


def _download(url: str, dest_file: Path, label: str) -> None:
    try:
        import requests  # huggingface_hub の依存。certifi 経由で SSL 検証される。
    except Exception:
        requests = None

    if requests is not None:
        with requests.get(url, stream=True, timeout=(15, 300)) as r:
            r.raise_for_status()
            total = int(r.headers.get("Content-Length", 0) or 0)
            done = 0
            last_pct = -5
            with open(dest_file, "wb") as f:
                for chunk in r.iter_content(chunk_size=256 * 1024):
                    if not chunk:
                        continue
                    f.write(chunk)
                    done += len(chunk)
                    if total > 0:
                        pct = done * 100 // total
                        if pct >= last_pct + 5:
                            last_pct = pct
                            _emit(f"{label} をダウンロード中... {pct}%")
        return

    # フォールバック: urllib（既定でリダイレクト追従）。
    import urllib.request

    with urllib.request.urlopen(url, timeout=300) as resp, open(dest_file, "wb") as f:
        shutil.copyfileobj(resp, f)


def _extract_flatten(archive: Path, dest: Path) -> None:
    tmp = Path(tempfile.mkdtemp(prefix="llbk_x_"))
    try:
        if archive.name.endswith(".zip"):
            with zipfile.ZipFile(archive) as z:
                z.extractall(tmp)
        else:
            with tarfile.open(archive, "r:gz") as t:
                t.extractall(tmp)
        # アーカイブはトップに `llama-b<N>/` を持つ。その中身を dest 直下へ移す。
        roots = [p for p in tmp.iterdir() if p.is_dir() and p.name.startswith("llama-")]
        src = roots[0] if roots else tmp
        dest.mkdir(parents=True, exist_ok=True)
        for item in src.iterdir():
            target = dest / item.name
            if target.is_dir():
                shutil.rmtree(target, ignore_errors=True)
            elif target.exists():
                target.unlink()
            shutil.move(str(item), str(target))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", required=True, choices=["rocm", "vulkan", "cpu"])
    ap.add_argument("--dest", required=True)
    ap.add_argument("--build", default=DEFAULT_BUILD)
    args = ap.parse_args()

    os_key = _os_key()
    tmpl = _ASSETS.get((args.backend, os_key))
    if not tmpl:
        _emit(f"未対応の組み合わせです: backend={args.backend} os={os_key}")
        return 2

    asset = tmpl.format(b=args.build)
    url = f"https://github.com/{REPO}/releases/download/{args.build}/{asset}"
    dest = Path(args.dest)
    label = f"{_LABELS[args.backend]} (llama.cpp {args.build})"
    exe = "llama-server.exe" if os_key == "windows" else "llama-server"

    work = Path(tempfile.mkdtemp(prefix="llbk_dl_"))
    archive = work / asset
    try:
        _emit(f"{label} をダウンロード中...")
        _download(url, archive, label)
        _emit(f"{label} を展開中...")
        _extract_flatten(archive, dest)
        server = dest / exe
        if not server.exists():
            _emit(f"展開後に {exe} が見つかりません: {dest}")
            return 3
        if os_key != "windows":
            try:
                os.chmod(server, 0o755)
            except OSError:
                pass
        _emit(f"{label} のインストールが完了しました。")
        return 0
    except Exception as e:  # noqa: BLE001 - ユーザー向けに簡潔なメッセージへ集約する
        _emit(f"ダウンロードに失敗しました: {e}")
        return 1
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
