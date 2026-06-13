#!/usr/bin/env python3
"""download_diarization_model_cli.py — download pyannote speaker diarization model.

Usage:
    HF_TOKEN=<token> python download_diarization_model_cli.py <model_dir>

Prints JSON progress lines while downloading:
    {"type": "progress", "downloaded_bytes": N}

Prints final result as a JSON line:
    {"success": true, "message": "..."}
    {"success": false, "message": "..."}
"""

import json
import os
import sys
import threading
from pathlib import Path

_REPO_ID = "pyannote/speaker-diarization-community-1"


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


def _start_progress_reporter(model_dir: Path, stop_event: threading.Event) -> threading.Thread:
    def _run() -> None:
        while not stop_event.wait(2):
            downloaded = _get_dir_size(model_dir)
            print(json.dumps({"type": "progress", "downloaded_bytes": downloaded}), flush=True)

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return t


def main() -> int:
    force_utf8_stdio()

    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "message": "モデルディレクトリが指定されていません。"}))
        return 1

    model_dir = Path(sys.argv[1])
    token = os.environ.get("HF_TOKEN", "").strip()

    if not token:
        print(json.dumps({"success": False, "message": "HF_TOKEN 環境変数が未設定です。"}))
        return 1

    model_dir.mkdir(parents=True, exist_ok=True)

    try:
        from huggingface_hub import snapshot_download  # type: ignore

        stop_event = threading.Event()
        reporter = _start_progress_reporter(model_dir, stop_event)
        error: str | None = None
        try:
            snapshot_download(
                repo_id=_REPO_ID,
                local_dir=str(model_dir),
                token=token,
            )
        except Exception as e:
            error = str(e)
        finally:
            stop_event.set()
            reporter.join(timeout=3)

        if error is not None:
            print(json.dumps({
                "success": False,
                "message": f"ダウンロードに失敗しました。利用規約同意・トークン・ネットワークを確認してください。{error}",
            }))
            return 1

        config_path = model_dir / "config.yaml"
        if not config_path.exists():
            print(json.dumps({
                "success": False,
                "message": f"ダウンロードは完了しましたが config.yaml が見つかりません: {config_path}",
            }))
            return 1

        print(json.dumps({"success": True, "message": "話者分離モデル (community-1) をダウンロードしました。"}))
        return 0

    except Exception as e:
        print(json.dumps({"success": False, "message": f"ダウンロードに失敗しました: {e}"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
