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


def _http_status(e: BaseException) -> "int | None":
    """例外から HTTP ステータスコードを取り出す（取れなければ None）。"""
    resp = getattr(e, "response", None)
    if resp is not None:
        code = getattr(resp, "status_code", None)
        if isinstance(code, int):
            return code
    code = getattr(e, "status_code", None)
    return code if isinstance(code, int) else None


def _exception_chain_names(e: BaseException) -> "set[str]":
    """例外チェーン（__cause__/__context__）のクラス名を集める。

    requests/urllib3 のネットワーク例外は huggingface_hub の例外に
    ラップされて飛んでくることがあるため、チェーン全体を見る。
    """
    names: "set[str]" = set()
    cur: "BaseException | None" = e
    seen = 0
    while cur is not None and seen < 12:
        names.add(type(cur).__name__)
        cur = cur.__cause__ or cur.__context__
        seen += 1
    return names


def classify_download_error(e: BaseException) -> str:
    """ダウンロード例外を、ユーザーが次に何をすればよいか分かる日本語へ翻訳する。

    待てば直る種類のエラー（規約反映待ち・ネットワーク不調・レート制限・
    HF 側障害）では「数分待ってから再試行」を明示的に促す。
    """
    status = _http_status(e)
    chain = _exception_chain_names(e)
    detail = str(e).strip()
    if len(detail) > 500:
        detail = detail[:500] + " …"
    tail = f"\n\n技術的な詳細: {detail}" if detail else ""

    def chain_has(*needles: str) -> bool:
        return any(needle in cn for needle in needles for cn in chain)

    # --- ネットワークに到達できない（HTTP レスポンスが無い） ---
    network_markers = (
        "ConnectionError", "ConnectTimeout", "ReadTimeout", "Timeout",
        "SSLError", "ProxyError", "MaxRetryError", "NewConnectionError",
        "NameResolutionError",
    )
    if status is None and chain_has(*network_markers):
        return (
            "インターネットに接続できませんでした（ネットワークエラー）。\n"
            "● 通常運用はオフラインですが、モデルの初回ダウンロードにはインターネット接続が必要です。接続状態を確認してください。\n"
            "● 社内ネットワークやプロキシ／ファイアウォール環境では huggingface.co への通信がブロックされることがあります。\n"
            "● 一時的な不調の可能性もあります。1〜2分ほど待ってから、もう一度お試しください。"
            + tail
        )

    # --- 403 / ゲート（規約未同意 もしくは 同意の反映待ち） ---
    if status == 403 or chain_has("GatedRepoError"):
        return (
            "このモデルはゲート（利用条件付き）です。トークンにアクセス権がありません（403 / Gated）。\n"
            "● まだ同意していない場合: 「同意ページを開く」から pyannote/speaker-diarization-community-1 の利用条件に同意してください。\n"
            "● すでに同意済みの場合: 同意が Hugging Face 側に反映されるまで数分かかることがあります。"
            "3〜5分ほど待ってから、もう一度「不足しているファイルをすべてダウンロード」を押してください。\n"
            "● 同意したアカウントと、入力したトークンのアカウントが一致しているか確認してください。"
            + tail
        )

    # --- 401（トークン不正・期限切れ） ---
    if status == 401:
        return (
            "アクセストークンが正しくないか、有効期限が切れています（認証エラー 401）。\n"
            "● 手入力したトークンは打ち間違いが起こりやすいため、コピー＆ペーストでの入力を強くおすすめします。\n"
            "● トークンは「hf_」で始まる文字列です。前後や途中に空白・改行が混ざっていないか確認してください。\n"
            "● それでも失敗する場合は「トークン作成ページを開く」から read 権限の新しいトークンを発行し直してください。"
            + tail
        )

    # --- 404（リポジトリ/権限・名称） ---
    if status == 404 or chain_has(
        "RepositoryNotFoundError", "EntryNotFoundError", "RevisionNotFoundError"
    ):
        return (
            "モデルにアクセスできませんでした（404 Not Found）。\n"
            "● トークンに community-1 へのアクセス権が無い場合に起こります。「同意ページを開く」から利用条件に同意済みか確認してください。\n"
            "● 同意したアカウントと、入力したトークンのアカウントが一致しているか確認してください。\n"
            "● 同意直後の場合は反映まで数分かかることがあります。少し待ってから再試行してください。"
            + tail
        )

    # --- 429（レート制限） ---
    if status == 429:
        return (
            "Hugging Face へのアクセスが一時的に制限されています（レート制限 429）。\n"
            "5〜10分ほど時間をおいてから、もう一度お試しください。"
            + tail
        )

    # --- ディスク容量不足 ---
    if isinstance(e, OSError) and getattr(e, "errno", None) == 28:
        return (
            "ディスクの空き容量が不足している可能性があります。\n"
            "保存先の空き容量を確認し、不要なファイルを整理してから再試行してください。"
            + tail
        )

    # --- 5xx（HF 側の一時障害） ---
    if status is not None and 500 <= status < 600:
        return (
            f"Hugging Face 側で一時的なエラーが発生しています（サーバーエラー {status}）。\n"
            "一時的なことが多いため、数分待ってからもう一度お試しください。"
            + tail
        )

    # --- フォールバック ---
    return (
        "ダウンロード中にエラーが発生しました。\n"
        "利用条件への同意、トークンの正しさ、インターネット接続を確認し、数分待ってからもう一度お試しください。"
        + tail
    )


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
        error_exc: "Exception | None" = None
        try:
            snapshot_download(
                repo_id=_REPO_ID,
                local_dir=str(model_dir),
                token=token,
            )
        except Exception as e:
            error_exc = e
        finally:
            stop_event.set()
            reporter.join(timeout=3)

        if error_exc is not None:
            print(json.dumps({
                "success": False,
                "message": classify_download_error(error_exc),
            }))
            return 1

        config_path = model_dir / "config.yaml"
        if not config_path.exists():
            print(json.dumps({
                "success": False,
                "message": (
                    "ダウンロード処理は終了しましたが、設定ファイル（config.yaml）が見つかりません。\n"
                    "途中で通信が切れて一部のファイルが取得できなかった可能性があります。\n"
                    "もう一度「不足しているファイルをすべてダウンロード」を押して再取得してください。\n\n"
                    f"確認した場所: {config_path}"
                ),
            }))
            return 1

        print(json.dumps({"success": True, "message": "話者分離モデル (community-1) をダウンロードしました。"}))
        return 0

    except Exception as e:
        print(json.dumps({"success": False, "message": classify_download_error(e)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
