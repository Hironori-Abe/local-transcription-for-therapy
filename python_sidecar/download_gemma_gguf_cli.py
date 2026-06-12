#!/usr/bin/env python3
"""download_gemma_gguf_cli.py — download Gemma 4 E4B QAT GGUF + MTP from Hugging Face Hub.

Usage:
    python download_gemma_gguf_cli.py <target_dir> [--skip-mtp]

Prints JSON progress lines while downloading:
    {"type": "progress", "downloaded_bytes": N}

Prints final result as a JSON line:
    {"success": true, "message": "...", "skipped": false}
    {"success": false, "message": "..."}
"""

import json
import os
import sys
import threading
from pathlib import Path

_REPO_ID = "unsloth/gemma-4-E4B-it-qat-GGUF"
_MAIN_FILENAME = "gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf"
_MTP_FILENAME = "mtp-gemma-4-E4B-it.gguf"
_MTP_FALLBACK_FILENAME = "MTP/gemma-4-E4B-it-BF16-MTP.gguf"
_MIN_SIZE_BYTES = 1024 * 1024  # 1 MB: zero-byte partial is not "done"

_FILES = [
    {
        "component": "gemma_gguf",
        "filenames": [_MAIN_FILENAME],
        "label": "Gemma 4 E4B QAT UD-Q4_K_XL",
        "total_bytes": 4_215_693_760,
        "use_cache_progress": True,
    },
    {
        "component": "gemma_mtp_gguf",
        "filenames": [_MTP_FILENAME, _MTP_FALLBACK_FILENAME],
        "label": "Gemma 4 E4B MTP",
        "total_bytes": 63_000_000,
        "use_cache_progress": False,
    },
]


def force_utf8_stdio() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")


def _get_dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for p in path.rglob("*"):
        if p.is_file():
            try:
                total += p.stat().st_size
            except OSError:
                pass
    return total


def _get_hf_cache_dir() -> Path:
    try:
        from huggingface_hub import constants  # type: ignore
        return Path(constants.HF_HUB_CACHE)
    except Exception:
        pass
    hf_home = os.environ.get("HF_HOME") or os.environ.get("HUGGINGFACE_HUB_CACHE")
    if hf_home:
        return Path(hf_home)
    return Path.home() / ".cache" / "huggingface" / "hub"


def _start_progress_reporter(
    repo_id: str,
    target_dir: Path,
    target_file: Path,
    component: str,
    total_bytes: int | None,
    use_cache_progress: bool,
    stop_event: threading.Event,
) -> threading.Thread:
    global_cache_dir = _get_hf_cache_dir()
    repo_folder = "models--" + repo_id.replace("/", "--")
    global_repo_cache = global_cache_dir / repo_folder
    # 新しい HF Hub はグローバルキャッシュではなくローカル .cache に一時ファイルを置く
    local_cache = target_dir / ".cache"

    def _run() -> None:
        while not stop_event.wait(2):
            target_size = target_file.stat().st_size if target_file.is_file() else 0
            if use_cache_progress:
                global_size = _get_dir_size(global_repo_cache)
                local_size = _get_dir_size(local_cache)
                downloaded = max(global_size, local_size, target_size)
            else:
                downloaded = target_size
            print(json.dumps({
                "type": "progress",
                "component": component,
                "downloaded_bytes": downloaded,
                "total_bytes": total_bytes,
            }), flush=True)

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return t


def _download_one(
    *,
    repo_id: str,
    target_dir: Path,
    component: str,
    filenames: list[str],
    label: str,
    total_bytes: int | None,
    use_cache_progress: bool,
) -> tuple[bool, str, bool]:
    from huggingface_hub import hf_hub_download  # type: ignore

    for filename in filenames:
        target_file = target_dir / filename
        if target_file.is_file() and target_file.stat().st_size >= _MIN_SIZE_BYTES:
            return True, f"{label} はすでにダウンロード済みです。", True

    errors: list[str] = []
    for filename in filenames:
        target_file = target_dir / filename
        target_file.parent.mkdir(parents=True, exist_ok=True)

        stop_event = threading.Event()
        reporter = _start_progress_reporter(
            repo_id,
            target_dir,
            target_file,
            component,
            total_bytes,
            use_cache_progress,
            stop_event,
        )
        try:
            hf_hub_download(
                repo_id=repo_id,
                filename=filename,
                local_dir=str(target_dir),
                local_dir_use_symlinks=False,
                resume_download=True,
            )
            print(json.dumps({
                "type": "progress",
                "component": component,
                "downloaded_bytes": target_file.stat().st_size if target_file.is_file() else total_bytes,
                "total_bytes": total_bytes,
            }), flush=True)
            return True, f"{filename} のダウンロードが完了しました。", False
        except Exception as e:
            errors.append(f"{filename}: {e}")
        finally:
            stop_event.set()
            reporter.join(timeout=3)

    return False, " / ".join(errors) if errors else f"{label} のダウンロードに失敗しました。", False


def main() -> int:
    force_utf8_stdio()
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "message": "出力先ディレクトリが指定されていません。"}))
        return 1

    target_dir = Path(sys.argv[1])
    skip_mtp = "--skip-mtp" in sys.argv[2:]

    target_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Import early so missing dependency is reported before any partial progress.
        from huggingface_hub import hf_hub_download as _hf_hub_download_probe  # type: ignore
        _ = _hf_hub_download_probe

        messages: list[str] = []
        all_skipped = True
        for spec in _FILES:
            if skip_mtp and spec["component"] == "gemma_mtp_gguf":
                continue
            ok, message, skipped = _download_one(
                repo_id=_REPO_ID,
                target_dir=target_dir,
                component=str(spec["component"]),
                filenames=list(spec["filenames"]),
                label=str(spec["label"]),
                total_bytes=int(spec["total_bytes"]) if spec["total_bytes"] is not None else None,
                use_cache_progress=bool(spec["use_cache_progress"]),
            )
            messages.append(message)
            all_skipped = all_skipped and skipped
            if not ok:
                print(json.dumps({"success": False, "message": f"ダウンロードに失敗しました: {message}"}))
                return 1

        print(json.dumps({"success": True, "message": " / ".join(messages), "skipped": all_skipped}))
        return 0

    except Exception as e:
        print(json.dumps({"success": False, "message": f"ダウンロードに失敗しました: {e}"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
