#!/usr/bin/env python3
"""
setup_venv_cli.py: Python 環境へのパッケージインストール。

Windows NSIS 配布: resources/python312/python.exe から直接実行される。venv は作らない。
Linux 配布: システム Python (python3) または PYTHON_BIN で指定された Python から実行される。

引数: <requirements_file> [--variant cuda|rocm]
"""
import sys
import re
import subprocess
import json
import argparse
import traceback
import urllib.request
import zipfile
import tempfile
import os
from pathlib import Path
from urllib.parse import unquote


CT2_ROCM_VERSION = "4.7.2"
PYTORCH_ROCM_INDEX = "https://download.pytorch.org/whl/rocm7.2"
PYTORCH_ROCM_WINDOWS_INDEX = "https://repo.amd.com/rocm/whl-multi-arch/"
PYTORCH_ROCM_WINDOWS_VERSION = "7.14.0"
PYTORCH_ROCM_WINDOWS_TORCH_VERSION = "2.12.0"
PYTORCH_ROCM_WINDOWS_TORCHVISION_VERSION = "0.27.0"
PYTORCH_ROCM_WINDOWS_TORCHAUDIO_VERSION = "2.11.0"
PYTORCH_CUDA_INDEX = "https://download.pytorch.org/whl/cu128"
PYTORCH_CPU_INDEX = "https://download.pytorch.org/whl/cpu"


def emit(msg_type: str, message: str = "") -> None:
    print(json.dumps({"type": msg_type, "message": message}), flush=True)


def _trim_pip_line(line: str) -> str:
    """pip 出力からフルパス/URLを除去してファイル名のみに短縮する。"""
    # 進捗バー行（━ や ┃）: 転送量情報だけ残す
    if "━" in line or "┃" in line:
        m = re.search(r"[\d.]+\s*/\s*[\d.]+\s*[KMGT]?B", line)
        return m.group(0) if m else ""
    # "Downloading <url_or_path> (size)" → "Downloading <filename> (size)"
    m = re.match(r"(Downloading|Using cached)\s+(\S+)((?:\s+\(.+\))?)\s*$", line, re.I)
    if m:
        raw = m.group(2)
        filename = unquote(re.split(r"[/\\]", raw)[-1])
        return f"{m.group(1)} {filename}{m.group(3)}"
    return line


def run_and_stream(cmd: list) -> int:
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    for line in proc.stdout:
        line = _trim_pip_line(line.strip())
        if line:
            emit("progress", line)
    proc.stdout.close()
    proc.wait()
    return proc.returncode


def _bootstrap_pip(python: Path) -> None:
    """pip が未導入の場合にブートストラップする。"""
    pip_check = subprocess.run(
        [str(python), "-m", "pip", "--version"],
        capture_output=True,
    )
    if pip_check.returncode == 0:
        emit("progress", "pip を確認しました")
        return

    # Windows NSIS 環境: 同梱の get-pip.py を使う
    get_pip = python.parent / "get-pip.py"
    if get_pip.exists():
        emit("progress", "pip をインストール中...")
        result = subprocess.run(
            [str(python), str(get_pip), "--no-warn-script-location"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode != 0:
            emit("error", f"pip のインストールに失敗しました: {result.stderr.strip()}")
            sys.exit(1)
        emit("progress", "pip のインストールが完了しました")
        return

    # Linux / その他: ensurepip を試みる
    ensurepip = subprocess.run(
        [str(python), "-m", "ensurepip", "--upgrade"],
        capture_output=True,
    )
    if ensurepip.returncode == 0:
        emit("progress", "pip を ensurepip でインストールしました")
        return

    emit(
        "error",
        f"pip が見つからず、get-pip.py もありません: {get_pip}\n"
        "pip を手動でインストールしてください: sudo apt install python3-pip",
    )
    sys.exit(1)


def _install_ctranslate2_rocm(python: Path) -> None:
    """CTranslate2 ROCm ホイールを GitHub Releases からダウンロードしてインストールする。"""
    py_tag = f"cp{sys.version_info.major}{sys.version_info.minor}"
    platform_name = "Windows" if os.name == "nt" else "Linux"
    zip_url = (
        f"https://github.com/OpenNMT/CTranslate2/releases/download/"
        f"v{CT2_ROCM_VERSION}/rocm-python-wheels-{platform_name}.zip"
    )

    emit("progress", f"CTranslate2 ROCm {CT2_ROCM_VERSION} ホイールをダウンロード中...")

    try:
        with tempfile.TemporaryDirectory() as tmp:
            zip_path = os.path.join(tmp, "ct2-rocm.zip")
            urllib.request.urlretrieve(zip_url, zip_path)

            whl_path = None
            with zipfile.ZipFile(zip_path) as z:
                names = z.namelist()
                # Python バージョン一致を優先、次にバージョン問わず
                for pattern in [
                    lambda n: f"ctranslate2-{CT2_ROCM_VERSION}-{py_tag}-" in n,
                    lambda n: f"ctranslate2-{CT2_ROCM_VERSION}-" in n,
                ]:
                    for name in names:
                        if name.endswith(".whl") and pattern(name):
                            dest = os.path.join(tmp, os.path.basename(name))
                            with z.open(name) as src, open(dest, "wb") as dst:
                                dst.write(src.read())
                            whl_path = dest
                            break
                    if whl_path:
                        break

            if whl_path is None:
                emit("progress", "[WARN] CTranslate2 ROCm ホイールが見つかりません。GPU 文字起こしは利用できません。")
                return

            emit("progress", f"CTranslate2 ROCm をインストール中: {os.path.basename(whl_path)}")
            rc = run_and_stream([str(python), "-m", "pip", "install", "--force-reinstall", whl_path])
            if rc != 0:
                emit("progress", "[WARN] CTranslate2 ROCm のインストールに失敗しました。GPU 文字起こしは利用できません。")
            else:
                emit("progress", "CTranslate2 ROCm のインストールが完了しました")

    except Exception as e:
        emit("progress", f"[WARN] CTranslate2 ROCm のダウンロード中にエラーが発生しました: {e}")


def _find_faster_whisper_requirement(req_file: Path) -> str | None:
    pattern = re.compile(r"^\s*faster-whisper(?:\s|[<>=!~]=?|$)", re.IGNORECASE)
    for line in req_file.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if pattern.match(stripped):
            return stripped
    return None


def _write_requirements_without_faster_whisper(req_file: Path) -> Path:
    pattern = re.compile(r"^\s*faster-whisper(?:\s|[<>=!~]=?|$)", re.IGNORECASE)
    fd, tmp_name = tempfile.mkstemp(prefix="lott-requirements-no-fw-", suffix=".txt")
    os.close(fd)
    tmp_path = Path(tmp_name)
    filtered = [
        line
        for line in req_file.read_text(encoding="utf-8").splitlines()
        if not pattern.match(line.strip())
    ]
    tmp_path.write_text("\n".join(filtered) + "\n", encoding="utf-8")
    return tmp_path


def _install_faster_whisper_without_pyav(python: Path, req_file: Path) -> None:
    requirement = _find_faster_whisper_requirement(req_file)
    if not requirement:
        return

    emit("progress", "faster-whisper を PyAV なしでインストール中...")
    rc = run_and_stream([
        str(python), "-m", "pip", "install",
        "--prefer-binary",
        "--no-deps",
        requirement,
    ])
    if rc != 0:
        emit("error", "faster-whisper のインストールに失敗しました。")
        sys.exit(1)


def _remove_gpl_ffmpeg_packages(python: Path) -> None:
    emit("progress", "PyAV / imageio-ffmpeg を除去中...")
    run_and_stream([
        str(python), "-m", "pip", "uninstall", "-y",
        "av", "imageio-ffmpeg",
    ])


def main() -> None:
    parser = argparse.ArgumentParser(description="Python 環境セットアップ")
    parser.add_argument("requirements", help="requirements ファイルのパス")
    parser.add_argument(
        "--variant",
        default="cuda",
        choices=["cuda", "rocm", "cpu"],
        help="PyTorch バリアント: cuda (デフォルト)、rocm、cpu",
    )
    args = parser.parse_args()

    req_file = Path(args.requirements)
    python = Path(sys.executable)

    # pip の確認・ブートストラップ
    _bootstrap_pip(python)
    _remove_gpl_ffmpeg_packages(python)

    # PyTorch インストール
    if args.variant == "rocm":
        if os.name == "nt":
            # Windows AMD はLinux用rocm7.2 indexを使わない。ROCm 7.14で
            # 公式対象になったRyzen APU (Radeon 780M = gfx1103) 向けwheelを
            # AMDのmulti-arch indexから導入する。別GPUは環境変数で上書き可能。
            gfx_target = os.environ.get("LOTT_ROCM_GFX_TARGET", "gfx1103").strip() or "gfx1103"
            rocm_index = os.environ.get(
                "LOTT_PYTORCH_ROCM_INDEX_URL",
                PYTORCH_ROCM_WINDOWS_INDEX,
            ).strip() or PYTORCH_ROCM_WINDOWS_INDEX
            emit(
                "progress",
                f"PyTorch (ROCm {PYTORCH_ROCM_WINDOWS_VERSION}, {gfx_target}, Windows) "
                "をインストール中... 数分かかります",
            )
            rc = run_and_stream([
                str(python), "-m", "pip", "install",
                "--prefer-binary",
                "--index-url", rocm_index,
                (
                    f"torch[device-{gfx_target}]=="
                    f"{PYTORCH_ROCM_WINDOWS_TORCH_VERSION}+rocm{PYTORCH_ROCM_WINDOWS_VERSION}"
                ),
                (
                    f"torchvision[device-{gfx_target}]=="
                    f"{PYTORCH_ROCM_WINDOWS_TORCHVISION_VERSION}+rocm{PYTORCH_ROCM_WINDOWS_VERSION}"
                ),
                (
                    f"torchaudio=={PYTORCH_ROCM_WINDOWS_TORCHAUDIO_VERSION}"
                    f"+rocm{PYTORCH_ROCM_WINDOWS_VERSION}"
                ),
            ])
        else:
            # 実績のあるLinux ROCm経路は従来どおり維持する。
            emit("progress", "PyTorch (ROCm 7.2) をインストール中... 数分かかります")
            rc = run_and_stream([
                str(python), "-m", "pip", "install",
                "--prefer-binary",
                "--index-url", PYTORCH_ROCM_INDEX,
                "torch==2.11.0", "torchaudio==2.11.0",
            ])
        if rc != 0:
            emit("error", "PyTorch (ROCm) のインストールに失敗しました。インターネット接続を確認してください。")
            sys.exit(1)
        emit("progress", "PyTorch (ROCm) のインストールが完了しました")

        # CTranslate2 ROCm（警告のみ、失敗しても続行）
        _install_ctranslate2_rocm(python)
    elif args.variant == "cuda":
        emit("progress", "PyTorch (CUDA 12.8) をインストール中... 数分かかります")
        rc = run_and_stream([
            str(python), "-m", "pip", "install",
            "--prefer-binary",
            "--index-url", PYTORCH_CUDA_INDEX,
            "torch==2.10.0", "torchaudio==2.10.0",
        ])
        if rc != 0:
            emit("error", "PyTorch のインストールに失敗しました。インターネット接続を確認してください。")
            sys.exit(1)
        emit("progress", "PyTorch のインストールが完了しました")
    else:
        emit("progress", "PyTorch (CPU) をインストール中... 数分かかります")
        rc = run_and_stream([
            str(python), "-m", "pip", "install",
            "--prefer-binary",
            "--index-url", PYTORCH_CPU_INDEX,
            "torch==2.10.0", "torchaudio==2.10.0",
        ])
        if rc != 0:
            emit("error", "PyTorch (CPU) のインストールに失敗しました。インターネット接続を確認してください。")
            sys.exit(1)
        emit("progress", "PyTorch (CPU) のインストールが完了しました")

    # requirements ファイル
    if not req_file.exists():
        emit("error", f"requirements ファイルが見つかりません: {req_file}")
        sys.exit(1)

    _install_faster_whisper_without_pyav(python, req_file)
    filtered_req_file = _write_requirements_without_faster_whisper(req_file)

    emit("progress", "依存パッケージをインストール中... 数分かかります")
    try:
        rc = run_and_stream([
            str(python), "-m", "pip", "install",
            "--prefer-binary",
            "--only-binary=contourpy",
            "-r", str(filtered_req_file),
        ])
        if rc != 0:
            emit("error", "依存パッケージのインストールに失敗しました。")
            sys.exit(1)
    finally:
        try:
            filtered_req_file.unlink(missing_ok=True)
        except Exception:
            pass

    emit("done", "Python 環境のセットアップが完了しました")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        emit("error", f"予期しないエラー: {e}\n{traceback.format_exc()}")
        sys.exit(1)
