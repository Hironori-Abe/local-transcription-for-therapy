#!/usr/bin/env python3
"""download_whisper_model_cli.py — download a faster-whisper model from HuggingFace Hub.

Prints JSON progress lines while downloading:
    {"type": "progress", "downloaded_bytes": N, "total_bytes": N_or_null}

Prints final result as a JSON line:
    {"success": true, "message": "..."}
    {"success": false, "message": "..."}
"""

import json
import os
import shutil
import sys
import threading
from pathlib import Path

# The turbo repository is Xet-backed. On Windows, hf-xet can stall for a long
# time while reconstructing the large model.bin, so use the regular Hub
# downloader for this setup path. huggingface_hub reads env vars at import time.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "60")


def _install_symlink_copy_fallback() -> None:
    """Windows でシンボリックリンク作成権限が無い環境（WinError 1314）への保険。

    huggingface_hub は HF キャッシュの snapshots → blobs を symlink で配置するが、
    Windows で管理者権限 / 開発者モードが無いと os.symlink が WinError 1314 で失敗する。
    huggingface_hub 0.36 系でも環境によっては自動コピーフォールバックが働かないため、
    os.symlink を「失敗したらコピー」に差し替え、権限なしでもモデル取得を完了させる。
    huggingface_hub を import する前にモジュールレベルで適用する必要がある。
    """
    if os.name != "nt":
        return
    _orig_symlink = os.symlink

    def _symlink_or_copy(src, dst, *args, **kwargs):  # type: ignore[no-untyped-def]
        try:
            _orig_symlink(src, dst, *args, **kwargs)
        except OSError:
            src_str = os.fspath(src)
            dst_str = os.fspath(dst)
            abs_src = src_str if os.path.isabs(src_str) else os.path.normpath(
                os.path.join(os.path.dirname(dst_str), src_str)
            )
            if os.path.isdir(abs_src):
                shutil.copytree(abs_src, dst_str, dirs_exist_ok=True)
            else:
                shutil.copyfile(abs_src, dst_str)

    os.symlink = _symlink_or_copy  # type: ignore[assignment]


_install_symlink_copy_fallback()


def force_utf8_stdio() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")


_ALLOWED_MODELS = {"large-v3", "turbo"}

_MODEL_REPO = {
    "large-v3": "Systran/faster-whisper-large-v3",
    "turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
}

_MODEL_CACHE_CANDIDATES = {
    "large-v3": ["models--Systran--faster-whisper-large-v3"],
    "turbo": [
        "models--mobiuslabsgmbh--faster-whisper-large-v3-turbo",
        "models--Systran--faster-whisper-turbo",
    ],
}

_REQUIRED_MODEL_FILES = ("model.bin", "config.json", "tokenizer.json")


def _get_blobs_size(repo_cache: Path) -> int:
    """Measure the entire repo_cache recursively, skipping symlinks.

    Scanning only blobs/ misses in-progress files that huggingface_hub writes
    outside of blobs/ (e.g. staging areas) until the download completes.
    """
    if not repo_cache.exists():
        return 0
    total = 0
    for p in repo_cache.rglob("*"):
        if p.is_file() and not p.is_symlink():
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
    hub_cache = os.environ.get("HF_HUB_CACHE") or os.environ.get("HUGGINGFACE_HUB_CACHE")
    if hub_cache:
        return Path(hub_cache)
    hf_home = os.environ.get("HF_HOME")
    if hf_home:
        return Path(hf_home) / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"


def _snapshot_has_required_files(snapshot: Path) -> bool:
    if not snapshot.is_dir():
        return False
    return all((snapshot / name).is_file() for name in _REQUIRED_MODEL_FILES)


def _has_complete_snapshot(repo_cache: Path) -> bool:
    snapshots = repo_cache / "snapshots"
    if not snapshots.is_dir():
        return False
    try:
        return any(_snapshot_has_required_files(snapshot) for snapshot in snapshots.iterdir())
    except OSError:
        return False


def _is_model_cached(model_name: str) -> bool:
    cache_dir = _get_hf_cache_dir()
    return any(
        _has_complete_snapshot(cache_dir / repo_folder)
        for repo_folder in _MODEL_CACHE_CANDIDATES.get(model_name, [])
    )


def _get_total_bytes(repo_id: str) -> int | None:
    try:
        from huggingface_hub import list_repo_tree  # type: ignore
        total = 0
        for item in list_repo_tree(repo_id, recursive=True):
            size = getattr(item, "size", None)
            if size:
                total += size
        return total if total > 0 else None
    except Exception:
        pass
    try:
        from huggingface_hub import model_info  # type: ignore
        info = model_info(repo_id, files_metadata=True)
        siblings = getattr(info, "siblings", None) or []
        total = sum(getattr(s, "size", 0) or 0 for s in siblings)
        return total if total > 0 else None
    except Exception:
        return None


def _start_progress_reporter(
    repo_id: str, total_bytes: int | None, stop_event: threading.Event
) -> threading.Thread:
    cache_dir = _get_hf_cache_dir()
    repo_folder = "models--" + repo_id.replace("/", "--")
    repo_cache = cache_dir / repo_folder

    def _run() -> None:
        while not stop_event.wait(2):
            downloaded = _get_blobs_size(repo_cache)
            print(
                json.dumps({"type": "progress", "downloaded_bytes": downloaded, "total_bytes": total_bytes}),
                flush=True,
            )

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return t


def main() -> int:
    force_utf8_stdio()
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "message": "モデル名が指定されていません。"}))
        return 1

    model_name = sys.argv[1]
    if model_name not in _ALLOWED_MODELS:
        print(json.dumps({"success": False, "message": f"未対応のモデル名です: {model_name}"}))
        return 1

    repo_id = _MODEL_REPO.get(model_name, f"Systran/faster-whisper-{model_name}")

    try:
        from huggingface_hub import snapshot_download  # type: ignore

        total_bytes = _get_total_bytes(repo_id)
        stop_event = threading.Event()
        reporter = _start_progress_reporter(repo_id, total_bytes, stop_event)
        error: str | None = None
        local_path: Path | None = None
        try:
            local_path = Path(snapshot_download(repo_id, resume_download=True))
        except Exception as e:
            error = str(e)
        finally:
            stop_event.set()
            reporter.join(timeout=3)

        if error is None:
            if local_path is None or not _snapshot_has_required_files(local_path) or not _is_model_cached(model_name):
                cache_dir = _get_hf_cache_dir()
                print(json.dumps({
                    "success": False,
                    "message": f"ダウンロード後の確認に失敗しました。model.bin を含む完全な snapshot が見つかりません: {cache_dir}",
                }))
                return 1
            print(json.dumps({"success": True, "message": f"{model_name} のダウンロードが完了しました。"}))
            return 0
        else:
            print(json.dumps({"success": False, "message": f"ダウンロードに失敗しました: {error}"}))
            return 1

    except ImportError:
        pass
    except Exception as e:
        print(json.dumps({"success": False, "message": f"ダウンロードに失敗しました: {e}"}))
        return 1

    # huggingface_hub が使えない場合は faster_whisper 経由でモデルをロードしてキャッシュさせる
    try:
        try:
            from transcribe_cli import install_pyav_import_stub  # type: ignore

            install_pyav_import_stub()
        except Exception:
            pass
        from faster_whisper import WhisperModel  # type: ignore

        WhisperModel(model_name, device="cpu", compute_type="int8")
        if not _is_model_cached(model_name):
            cache_dir = _get_hf_cache_dir()
            print(json.dumps({
                "success": False,
                "message": f"ダウンロード後の確認に失敗しました。model.bin を含む完全な snapshot が見つかりません: {cache_dir}",
            }))
            return 1
        print(json.dumps({"success": True, "message": f"{model_name} のダウンロードが完了しました。"}))
        return 0
    except Exception as e:
        print(json.dumps({"success": False, "message": f"ダウンロードに失敗しました: {e}"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
