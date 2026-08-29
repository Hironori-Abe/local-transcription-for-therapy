#!/usr/bin/env python3
"""
setup_venv_cli.py: Python 環境へのパッケージインストール。

Windows NSIS 配布: resources/python312/python.exe から直接実行される。venv は作らない。
Linux AppImage/.deb配布: 同梱Python 3.12から実行し、Rust側がPIP_TARGETで
app_local_data_dir配下のアプリ専用site-packagesへ導入する。
Linux開発環境: PYTHON_BINまたはsystem Pythonから実行される。

引数: <requirements_file> [--variant cuda|rocm]
"""
import sys
import re
import subprocess
import json
import argparse
import io
import traceback
import urllib.request
import urllib.error
import http.client
import zipfile
import tempfile
import os
import hashlib
import importlib
import importlib.util
import sysconfig
import time
from collections import OrderedDict
from functools import lru_cache
from email.parser import Parser
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit, parse_qs


CT2_ROCM_VERSION = "4.7.2"
PYTORCH_ROCM_INDEX = "https://download.pytorch.org/whl/rocm7.2"
PYTORCH_ROCM_WINDOWS_INDEX = "https://repo.amd.com/rocm/whl-multi-arch/"
PYTORCH_ROCM_WINDOWS_VERSION = "7.14.0"
PYTORCH_ROCM_WINDOWS_TORCH_VERSION = "2.12.0"
PYTORCH_ROCM_WINDOWS_TORCHVISION_VERSION = "0.27.0"
PYTORCH_ROCM_WINDOWS_TORCHAUDIO_VERSION = "2.11.0"
PYTORCH_CUDA_INDEX = "https://download.pytorch.org/whl/cu128"
PYTORCH_CPU_INDEX = "https://download.pytorch.org/whl/cpu"
PYPI_INDEX = "https://pypi.org/simple"
PYPI_NVIDIA_INDEX = "https://pypi.nvidia.com"
ROCM_WINDOWS_BUILD_REQUIREMENTS = ("setuptools>=70.2.0,<82",)

# The bundled Linux runtime and the backend-specific development venvs are
# Python 3.12 environments.  In particular, the ROCm 7.2 torch 2.11 graph
# currently exposes triton_rocm 3.6.0 as a cp312 wheel only.  Letting a
# different interpreter reach the wheel resolver produces the misleading
# "SHA-256付きwheelが公式indexにありません" error because _wheel_compatible
# correctly filters out a wheel for another Python ABI.
SUPPORTED_PYTHON_VERSION = (3, 12)

# A few official AMD/PyTorch artifacts are currently published without a
# PEP 503 ``#sha256=...`` fragment.  Keep exceptions narrowly scoped to the
# exact immutable URL/version; every other hash-less artifact remains rejected
# by the wheelhouse verifier.
KNOWN_ARTIFACT_SHA256 = {
    "https://repo.amd.com/rocm/whl-multi-arch/rocm-7.14.0.tar.gz":
        "77c622d8eef7bf7fa1af70d410a05a621abbd2baaf53e52ab268dc6d140e15b2",
    "https://download-r2.pytorch.org/whl/triton_rocm-3.6.0-cp312-cp312-linux_x86_64.whl":
        "cff15082784c7056b0af9347770e034ab0a8ccbce0642723ddc8c8de1bd6af3f",
}

# pip 25.2 introduced resumable downloads for the HTTP downloader.  The
# application still has its own wheelhouse downloader below because pip's
# temporary unpack directory is not durable across an application restart.
PIP_TIMEOUT_SECONDS = 120
PIP_RETRIES = 12
PIP_RESUME_RETRIES = 12
PIP_RESUME_MIN_VERSION = (25, 2)
PIP_UPGRADE_REQUIREMENT = "pip>=25.2,<26"
# A remote wheel's central directory and METADATA should be small.  Refuse to
# turn a missing PEP 658 endpoint into an unbounded download, even if a broken
# server advertises a very large or inconsistent range.
REMOTE_WHEEL_BLOCK_BYTES = 1024 * 1024
REMOTE_WHEEL_CACHE_BLOCKS = 8
REMOTE_WHEEL_MAX_FETCH_BYTES = 64 * 1024 * 1024
REMOTE_WHEEL_MAX_METADATA_BYTES = 8 * 1024 * 1024
PYTHON_SETUP_MARKER = ".lott-python-setup-complete.json"

_PIP_SUPPORTS_RESUME = False
_SETUP_LOG_PATH: Path | None = None
_LAST_PIP_OUTPUT: list[str] = []


class DownloadError(RuntimeError):
    """A resumable package download failed without exposing credentials."""


def _validate_python_version(version_info=None) -> None:
    """Fail before network resolution when the selected Python is unsupported.

    Keep this check independent of ``sys.version_info`` so the behavior can be
    tested without creating a second interpreter.  The setup command is used
    by both the Linux app and development launchers, all of which promise the
    Python 3.12 runtime.
    """
    actual = version_info if version_info is not None else sys.version_info
    try:
        major, minor = int(actual[0]), int(actual[1])
    except (IndexError, TypeError, ValueError) as exc:
        raise DownloadError("Pythonのバージョンを確認できませんでした。") from exc
    if (major, minor) != SUPPORTED_PYTHON_VERSION:
        actual_version = ".".join(str(part) for part in actual[:3])
        expected = ".".join(str(part) for part in SUPPORTED_PYTHON_VERSION)
        raise DownloadError(
            f"Python {expected} が必要ですが、Python {actual_version} が選択されています。"
            " backend別の .venv312-* を作成し、Python 3.12で再実行してください。"
        )


def _private_directory(path: Path) -> Path:
    """Create an application-owned cache directory with restrictive permissions."""
    if path.is_symlink():
        raise DownloadError(f"安全でないダウンロード先です（シンボリックリンク）: {path}")
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise DownloadError(f"ダウンロード先を作成できません（容量または権限を確認してください）: {path}: {exc}") from exc
    if path.is_symlink():
        raise DownloadError(f"安全でないダウンロード先です（シンボリックリンク）: {path}")
    if os.name != "nt":
        try:
            path.chmod(0o700)
        except OSError as exc:
            raise DownloadError(f"ダウンロード先の権限設定に失敗しました: {path}: {exc}") from exc
    return path


def _wheelhouse_dir() -> Path:
    """Return the durable wheelhouse configured by the Rust sidecar launcher."""
    configured = os.environ.get("LOTT_WHEELHOUSE_DIR", "").strip()
    if configured:
        return _private_directory(Path(configured).expanduser())

    # Standalone/development invocation: do not fall back to /tmp.  The pip
    # cache is normally ~/.cache/... and its parent is a suitable durable
    # location for the application-owned download state.
    pip_cache = os.environ.get("PIP_CACHE_DIR", "").strip()
    if pip_cache:
        base = Path(pip_cache).expanduser().parent / "lott-python-downloads"
    else:
        base = Path.home() / ".cache" / "local-transcription-for-therapy" / "python-downloads"
    return _private_directory(base / "wheelhouse")


def _setup_log_path(wheelhouse: Path) -> Path:
    configured = os.environ.get("LOTT_PYTHON_SETUP_LOG", "").strip()
    path = Path(configured).expanduser() if configured else wheelhouse.parent / "python-setup.log"
    _private_directory(path.parent)
    try:
        path.touch(exist_ok=True, mode=0o600)
        if os.name != "nt":
            path.chmod(0o600)
    except OSError:
        # Logging must not prevent package installation.  The in-memory error
        # details are still returned to the UI.
        return path
    return path


def _sanitize_url(value: str) -> str:
    """Remove query strings/fragments from URLs before they reach logs/metadata."""
    try:
        parsed = urlsplit(value)
        if parsed.scheme and parsed.netloc:
            # Drop HTTP basic-auth userinfo as well as query/fragment tokens.
            netloc = parsed.netloc.rsplit("@", 1)[-1]
            return urlunsplit((parsed.scheme, netloc, parsed.path, "", ""))
    except ValueError:
        pass
    return value


def _sanitize_text(value: str) -> str:
    # URL query parameters can contain temporary credentials.  Keep host/path
    # for diagnostics while removing the query and fragment.
    def redact_url(match: re.Match[str]) -> str:
        raw = match.group(0).rstrip(".,);]")
        suffix = match.group(0)[len(raw):]
        return _sanitize_url(raw) + suffix

    value = re.sub(r"https?://[^\s'\"<>]+", redact_url, value, flags=re.IGNORECASE)
    value = re.sub(r"(?i)(authorization\s*:\s*bearer\s+)[^\s]+", r"\1<redacted>", value)
    value = re.sub(r"(?i)\b(?:hf|hub)_[A-Za-z0-9_-]{12,}\b", "<redacted-token>", value)
    return value


def _record_log(line: str) -> None:
    if _SETUP_LOG_PATH is None:
        return
    try:
        with _SETUP_LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(_sanitize_text(line).rstrip() + "\n")
    except OSError:
        pass


def _venv_site_packages(python: Path | None) -> Path | None:
    """Return the site-packages directory belonging to a selected venv.

    The Linux bundled interpreter ships with pip in its *base* stdlib path.
    A venv made with ``--without-pip`` therefore imports that base pip before
    its own site-packages directory (the normal venv layout appends the latter
    to ``sys.path``).  Prefer the venv path explicitly for pip subprocesses so
    an upgrade is checked against, and subsequent commands use, the pip that
    was installed into the venv.

    Do not resolve the executable symlink here: the embedded runtime's venv
    ``bin/python3.12`` is intentionally a symlink back to the bundled binary,
    while the lexical parent still identifies the venv root.
    """
    if python is None:
        return None
    try:
        executable = Path(python).expanduser()
        venv_root = executable.parent.parent
        if not (venv_root / "pyvenv.cfg").is_file():
            return None
        if os.name == "nt":
            site_packages = venv_root / "Lib" / "site-packages"
        else:
            version = f"{SUPPORTED_PYTHON_VERSION[0]}.{SUPPORTED_PYTHON_VERSION[1]}"
            site_packages = venv_root / "lib" / f"python{version}" / "site-packages"
        return site_packages
    except (OSError, TypeError, ValueError):
        return None


def _pip_import_paths(python: Path | None) -> list[str]:
    """Build trusted import paths for pip subprocesses.

    ``PYTHONPATH`` inherited from the desktop/session is deliberately not
    retained: it can make pip load a foreign package tree.  Only the selected
    venv, the Rust-provided ``PIP_TARGET`` and this interpreter's normal
    purelib are considered.  The venv path comes first so an embedded base pip
    cannot shadow the venv's upgraded pip.
    """
    candidates: list[Path] = []
    venv_site = _venv_site_packages(python)
    if venv_site is not None:
        candidates.append(venv_site)

    configured_target = os.environ.get("PIP_TARGET", "").strip()
    if configured_target:
        candidates.append(Path(configured_target).expanduser())

    try:
        candidates.append(Path(sysconfig.get_path("purelib")))
    except (TypeError, ValueError):
        pass

    paths: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        try:
            # A target may not exist yet during the first bootstrap.  An
            # absent path is harmless in PYTHONPATH and will become useful as
            # soon as pip creates it, so retain it rather than silently
            # reverting to the embedded base pip.
            value = str(candidate)
        except (OSError, TypeError, ValueError):
            continue
        if value not in seen:
            seen.add(value)
            paths.append(value)
    return paths


def _pip_environment(python: Path | None = None) -> dict[str, str]:
    """Return a controlled pip environment for official package resolution.

    A user's global pip configuration may point at an untrusted mirror or
    disable TLS/hash checks.  The Rust launcher supplies only the durable
    target/cache paths; index selection remains explicit in this script.
    """
    environment = dict(os.environ)
    allowed = {"PIP_TARGET", "PIP_CACHE_DIR", "PIP_DEFAULT_TIMEOUT", "PIP_RETRIES"}
    for key in list(environment):
        if key.startswith("PIP_") and key not in allowed:
            environment.pop(key, None)
    environment["PIP_DEFAULT_TIMEOUT"] = str(PIP_TIMEOUT_SECONDS)
    environment["PIP_RETRIES"] = str(PIP_RETRIES)
    if _PIP_SUPPORTS_RESUME:
        environment["PIP_RESUME_RETRIES"] = str(PIP_RESUME_RETRIES)
    else:
        environment.pop("PIP_RESUME_RETRIES", None)
    import_paths = _pip_import_paths(python)
    if import_paths:
        environment["PYTHONPATH"] = os.pathsep.join(import_paths)
    else:
        # Do not let an ambient PYTHONPATH select pip or package code from an
        # unrelated environment when no trusted path is available.
        environment.pop("PYTHONPATH", None)
    return environment


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json_atomic(path: Path, payload: dict) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    if os.name != "nt":
        temporary.chmod(0o600)
    temporary.replace(path)


def _safe_filename(url: str, expected_hash: str | None = None) -> str:
    name = unquote(Path(urlsplit(url).path).name)
    if not name or name in {".", ".."} or any(ch in name for ch in ("/", "\\", "\x00")):
        name = f"artifact-{(expected_hash or hashlib.sha256(url.encode()).hexdigest())[:32]}"
    # Keep wheel/archive names readable while rejecting path traversal and
    # shell/control characters from a malicious index response.
    name = re.sub(r"[^A-Za-z0-9_.+@-]", "_", name)
    return name[:240]


def _artifact_hash_key(url: str) -> str:
    """Canonicalize a report URL for the narrow known-hash allowlist."""
    parsed = urlsplit(url)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))


def _download_url_resumable(
    url: str,
    destination: Path,
    expected_hash: str | None = None,
    *,
    max_bytes_for_test: int | None = None,
) -> Path:
    """Download *url* to *destination* with a durable HTTP Range checkpoint.

    ``destination + .part`` and a small metadata sidecar survive process
    termination.  ETag/Last-Modified is sent as If-Range so a changed upstream
    object cannot be appended to an old partial file.  The final rename occurs
    only after the SHA-256 check succeeds.
    """
    destination = Path(destination)
    _private_directory(destination.parent)
    part = destination.with_name(destination.name + ".part")
    metadata_path = part.with_name(part.name + ".json")
    expected_hash = expected_hash.lower() if expected_hash else None
    url_key = hashlib.sha256(url.encode("utf-8")).hexdigest()

    metadata: dict = {}
    if metadata_path.exists():
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            metadata = {}
    if metadata.get("url_key") != url_key or metadata.get("expected_sha256") != expected_hash:
        part.unlink(missing_ok=True)
        metadata_path.unlink(missing_ok=True)
        metadata = {}

    if destination.exists():
        if expected_hash is None or _hash_file(destination) == expected_hash:
            return destination
        destination.unlink(missing_ok=True)

    existing_size = part.stat().st_size if part.exists() else 0
    if existing_size:
        emit("progress", f"再開: {destination.name}（{existing_size:,} bytes）")

    headers = {"User-Agent": "Local-Transcription-for-Therapy/1 package setup"}
    if existing_size:
        headers["Range"] = f"bytes={existing_size}-"
        if metadata.get("etag"):
            headers["If-Range"] = str(metadata["etag"])
        elif metadata.get("last_modified"):
            headers["If-Range"] = str(metadata["last_modified"])

    def open_response(request_headers: dict[str, str]):
        request = urllib.request.Request(url, headers=request_headers)
        return urllib.request.urlopen(request, timeout=PIP_TIMEOUT_SECONDS)

    try:
        try:
            response = open_response(headers)
        except urllib.error.HTTPError as exc:
            # A stale checkpoint may be rejected with 416.  If it is already a
            # complete object, the hash check below can still finalize it.
            if exc.code == 416 and existing_size and expected_hash and part.exists():
                if _hash_file(part) == expected_hash:
                    exc.close()
                    part.replace(destination)
                    metadata_path.unlink(missing_ok=True)
                    return destination
            if exc.code == 416 and existing_size:
                # The object became shorter or the checkpoint was otherwise
                # stale.  Discard only the untrusted partial object and retry
                # once from byte zero; repeatedly sending the same invalid
                # Range would make an interrupted setup permanently fail.
                exc.close()
                part.unlink(missing_ok=True)
                metadata_path.unlink(missing_ok=True)
                metadata = {}
                existing_size = 0
                try:
                    response = open_response({"User-Agent": headers["User-Agent"]})
                except urllib.error.HTTPError as retry_exc:
                    code = retry_exc.code
                    retry_exc.close()
                    raise DownloadError(
                        f"{destination.name} のダウンロードに失敗しました（HTTP {code}）。"
                    ) from retry_exc
            else:
                code = exc.code
                exc.close()
                raise DownloadError(
                    f"{destination.name} のダウンロードに失敗しました（HTTP {code}）。"
                ) from exc

        status = getattr(response, "status", response.getcode())
        content_range = response.headers.get("Content-Range", "")
        resumed = existing_size > 0 and status == 206
        if resumed:
            match = re.fullmatch(r"bytes\s+(\d+)-(\d+)/(\d+|\*)", content_range.strip())
            declared_length = response.headers.get("Content-Length", "")
            range_length_ok = True
            if match and declared_length.isdigit():
                range_length_ok = int(declared_length) == int(match.group(2)) - int(match.group(1)) + 1
            if (
                not match
                or int(match.group(1)) != existing_size
                or int(match.group(2)) < int(match.group(1))
                or not range_length_ok
            ):
                response.close()
                # Refuse to append a response whose range does not exactly
                # match the checkpoint.  A fresh full response is safe.
                part.unlink(missing_ok=True)
                metadata_path.unlink(missing_ok=True)
                existing_size = 0
                response = open_response({"User-Agent": headers["User-Agent"]})
                status = getattr(response, "status", response.getcode())
                content_range = response.headers.get("Content-Range", "")
                resumed = False
        if resumed and metadata.get("etag") and response.headers.get("ETag"):
            if metadata["etag"] != response.headers.get("ETag"):
                response.close()
                part.unlink(missing_ok=True)
                metadata_path.unlink(missing_ok=True)
                existing_size = 0
                response = open_response({"User-Agent": headers["User-Agent"]})
                status = getattr(response, "status", response.getcode())
                content_range = response.headers.get("Content-Range", "")
                resumed = False
        if resumed and metadata.get("last_modified") and response.headers.get("Last-Modified"):
            if metadata["last_modified"] != response.headers.get("Last-Modified"):
                response.close()
                part.unlink(missing_ok=True)
                metadata_path.unlink(missing_ok=True)
                existing_size = 0
                response = open_response({"User-Agent": headers["User-Agent"]})
                status = getattr(response, "status", response.getcode())
                content_range = response.headers.get("Content-Range", "")
                resumed = False
        if existing_size and not resumed:
            # Server ignored Range or returned a new representation.  Starting
            # over is safe; the old checkpoint is never mixed with new bytes.
            existing_size = 0
            part.unlink(missing_ok=True)

        content_length = response.headers.get("Content-Length")
        total_size: int | None = None
        if content_range and "/" in content_range:
            try:
                total_size = int(content_range.rsplit("/", 1)[1])
            except ValueError:
                total_size = None
        elif content_length and content_length.isdigit():
            total_size = int(content_length) + (existing_size if resumed else 0)

        metadata = {
            "version": 1,
            "url": _sanitize_url(url),
            "url_key": url_key,
            "expected_sha256": expected_hash,
            "etag": response.headers.get("ETag", metadata.get("etag", "")),
            "last_modified": response.headers.get(
                "Last-Modified", metadata.get("last_modified", "")
            ),
            "total_bytes": total_size,
        }
        _write_json_atomic(metadata_path, metadata)

        mode = "ab" if resumed else "wb"
        written = existing_size
        with response, part.open(mode) as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                output.flush()
                written += len(chunk)
                if max_bytes_for_test is not None and written >= max_bytes_for_test:
                    # Deliberately retain .part + metadata for the unit test,
                    # emulating a process killed during a real download.
                    raise DownloadError("テスト用中断")
        if total_size is not None and written != total_size:
            raise DownloadError(
                f"{destination.name} のダウンロードが途中で終了しました（{written:,}/{total_size:,} bytes）。"
            )
        if expected_hash:
            actual_hash = _hash_file(part)
            if actual_hash.lower() != expected_hash:
                part.unlink(missing_ok=True)
                metadata_path.unlink(missing_ok=True)
                raise DownloadError(
                    f"{destination.name} のハッシュ検証に失敗しました。再試行してください。"
                )
        part.replace(destination)
        metadata_path.unlink(missing_ok=True)
        if os.name != "nt":
            destination.chmod(0o600)
        return destination
    except DownloadError:
        raise
    except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError) as exc:
        # Keep .part for the next application launch.  Do not include URL
        # query strings in the UI/log detail.
        raise DownloadError(
            f"{destination.name} のダウンロード中に通信またはファイルI/Oエラーが発生しました: {_sanitize_text(str(exc))}"
        ) from exc


def _download_report_artifact(artifact: dict, wheelhouse: Path) -> Path:
    url = str(artifact.get("url", ""))
    expected_hash = artifact.get("sha256")
    if not expected_hash:
        expected_hash = KNOWN_ARTIFACT_SHA256.get(_artifact_hash_key(url))
    if not url.startswith("https://"):
        raise DownloadError(f"安全性を確認できないパッケージURLです: {_sanitize_url(url)}")
    if not expected_hash or not re.fullmatch(r"[0-9a-fA-F]{64}", str(expected_hash)):
        raise DownloadError(
            f"{_safe_filename(url)} のSHA-256ハッシュが配布元から提供されませんでした。"
        )
    destination = wheelhouse / _safe_filename(url, str(expected_hash))
    return _download_url_resumable(url, destination, str(expected_hash))


def emit(msg_type: str, message: str = "") -> None:
    print(json.dumps({"type": msg_type, "message": message}), flush=True)
    if msg_type in {"progress", "error", "done"}:
        _record_log(f"[{msg_type}] {_sanitize_text(message)}")


def _pip_prefix(python: Path, *, include_resume: bool = True) -> list[str]:
    """Common pip network policy used by every setup_venv_cli pip command."""
    args = [
        str(python),
        "-m",
        "pip",
        "--disable-pip-version-check",
        "--timeout",
        str(PIP_TIMEOUT_SECONDS),
        "--retries",
        str(PIP_RETRIES),
    ]
    if include_resume and _PIP_SUPPORTS_RESUME:
        args.extend(["--resume-retries", str(PIP_RESUME_RETRIES)])
    return args


def _parse_pip_version(output: str) -> tuple[int, int, int]:
    match = re.search(r"\bpip\s+(\d+)(?:\.(\d+))?(?:\.(\d+))?\b", output)
    if not match:
        return (0, 0, 0)
    return tuple(int(match.group(index) or 0) for index in (1, 2, 3))


def _pip_requires_upgrade(version: tuple[int, int, int]) -> bool:
    return version < PIP_RESUME_MIN_VERSION + (0,) or version >= (26, 0, 0)


def _pip_upgrade_command(python: Path) -> list[str]:
    """Build the official-index pip upgrade command before resume is enabled."""
    return _pip_prefix(python, include_resume=False) + [
        "install",
        "--upgrade",
        "--index-url",
        PYPI_INDEX,
        PIP_UPGRADE_REQUIREMENT,
    ]


def _pip_version_check(python: Path):
    try:
        result = subprocess.run(
            _pip_prefix(python, include_resume=False) + ["--version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
            env=_pip_environment(python),
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return (0, 0, 0), 127, str(exc)
    output = (result.stdout or "") + (result.stderr or "")
    return _parse_pip_version(output), result.returncode, output


def _remember_pip_output(output: str) -> None:
    global _LAST_PIP_OUTPUT
    lines = [_sanitize_text(line) for line in output.splitlines() if line.strip()]
    _LAST_PIP_OUTPUT = lines[-2000:]
    for line in _LAST_PIP_OUTPUT:
        _record_log(line)


def _detect_pip_capabilities(python: Path) -> None:
    """Detect pip's native resume support without making setup network-dependent."""
    global _PIP_SUPPORTS_RESUME
    try:
        result = subprocess.run(
            _pip_prefix(python, include_resume=False) + ["--version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
            env=_pip_environment(python),
        )
        version = _parse_pip_version(result.stdout + result.stderr)
        help_result = subprocess.run(
            _pip_prefix(python, include_resume=False) + ["install", "--help"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
            env=_pip_environment(python),
        )
        download_help = subprocess.run(
            _pip_prefix(python, include_resume=False) + ["download", "--help"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
            env=_pip_environment(python),
        )
        supports_resume_option = "--resume-retries" in (
            help_result.stdout
            + help_result.stderr
            + download_help.stdout
            + download_help.stderr
        )
    except (OSError, subprocess.SubprocessError):
        version = (0, 0, 0)
        supports_resume_option = False
    _PIP_SUPPORTS_RESUME = (
        version >= PIP_RESUME_MIN_VERSION
        and version < (26, 0, 0)
        and supports_resume_option
    )
    if _PIP_SUPPORTS_RESUME:
        emit("progress", f"pip {'.'.join(map(str, version))}（再開オプションを有効化）")
    else:
        emit(
            "progress",
            f"pip {'.'.join(map(str, version))}（組み込み再開なし。LoTTのwheelhouse再開を使用）",
        )


def _classify_pip_failure(output: str) -> str:
    lowered = output.lower()
    if "no space left on device" in lowered or "disk quota" in lowered:
        return "容量不足"
    if any(
        token in lowered
        for token in (
            "could not resolve host",
            "name or service not known",
            "temporary failure in name resolution",
            "nodename nor servname provided",
            "getaddrinfo failed",
        )
    ):
        return "DNS/名前解決エラー"
    if any(
        token in lowered
        for token in (
            "connection reset",
            "connection aborted",
            "remote end closed connection",
            "broken pipe",
            "incompleteread",
        )
    ):
        return "接続切断エラー"
    if any(token in lowered for token in ("read timed out", "connect timeout", "timed out", "timeout")):
        return "タイムアウト"
    if re.search(r"(?:http|status)\s*(?:error\s*)?(?:code\s*)?(?:4|5)\d\d", lowered):
        return "HTTPエラー"
    if any(
        token in lowered
        for token in (
            "permission denied",
            "access is denied",
            "operation not permitted",
            "errno 13",
        )
    ):
        return "権限エラー"
    if "hash mismatch" in lowered or "hashes do not match" in lowered or "hash" in lowered and "mismatch" in lowered:
        return "ハッシュ検証エラー"
    if any(
        token in lowered
        for token in (
            "resolutionimpossible",
            "dependencyconflict",
            "conflictingdependencies",
            "conflicting dependencies",
            "have conflicting dependencies",
            "cannot install",
        )
    ) and ("depend" in lowered or "resolution" in lowered or "conflict" in lowered):
        return "依存関係の衝突"
    if "no matching distribution" in lowered or "could not find a version" in lowered:
        return "対応する配布物なし"
    if "certificate verify failed" in lowered or "ssl" in lowered and "certificate" in lowered:
        return "TLS証明書エラー"
    if any(
        token in lowered
        for token in (
            "no module named pip",
            "pip is not recognized",
            "python is not recognized",
            "python: command not found",
            "python3: command not found",
            "can't open file",
            "cannot open file",
            "executable file not found",
            "failed to launch",
            "createprocess",
        )
    ):
        return "Python/pip起動エラー"
    return "pipエラー"


def _pip_failure_message(context: str, returncode: int) -> str:
    details = "\n".join(_LAST_PIP_OUTPUT[-12:]).strip()
    category = _classify_pip_failure(details)
    log_suffix = f" 詳細ログ: {_SETUP_LOG_PATH}" if _SETUP_LOG_PATH else ""
    if not details:
        details = "pipから詳細な出力がありませんでした。"
    return (
        f"{context}に失敗しました（原因分類: {category}）。\n"
        f"対処: ディスク空き容量・接続先への接続・Python環境を確認し、再実行してください。\n"
        f"技術詳細（終了コード {returncode}）:\n{_sanitize_text(details)}{log_suffix}"
    )


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


def run_and_stream(cmd: list, *, label: str = "pip") -> int:
    global _LAST_PIP_OUTPUT
    _LAST_PIP_OUTPUT = []
    _record_log(f"--- {label}: {_sanitize_text(' '.join(map(str, cmd)))} ---")
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        # All production callers pass a command built by ``_pip_prefix``;
        # deriving the interpreter here keeps the streaming helper's public
        # call shape small while still selecting the venv-local pip.
        env=_pip_environment(Path(cmd[0]) if cmd else None),
    )
    for raw_line in proc.stdout:
        raw_line = _sanitize_text(raw_line.rstrip("\r\n"))
        if len(_LAST_PIP_OUTPUT) < 2000:
            _LAST_PIP_OUTPUT.append(raw_line)
        _record_log(raw_line)
        line = _trim_pip_line(raw_line.strip())
        if line:
            emit("progress", line)
    proc.stdout.close()
    proc.wait()
    return proc.returncode


def _bootstrap_pip(python: Path) -> None:
    """Ensure the selected target environment uses the supported pip range."""
    version, returncode, output = _pip_version_check(python)

    if returncode != 0:
        # Windows NSIS 環境: 同梱の get-pip.py を使う
        get_pip = python.parent / "get-pip.py"
        if get_pip.exists():
            emit("progress", "pip をインストール中...")
            result = subprocess.run(
                [
                    str(python),
                    str(get_pip),
                    "--no-warn-script-location",
                    PIP_UPGRADE_REQUIREMENT,
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=_pip_environment(python),
            )
            if result.returncode != 0:
                _remember_pip_output((result.stdout or "") + (result.stderr or ""))
                raise DownloadError(_pip_failure_message("pipのインストール", result.returncode))
            emit("progress", "pip のインストールが完了しました")
        else:
            # Linux / その他: ensurepip を試みる
            ensurepip = subprocess.run(
                [str(python), "-m", "ensurepip", "--upgrade"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=_pip_environment(python),
            )
            if ensurepip.returncode != 0:
                _remember_pip_output((ensurepip.stdout or "") + (ensurepip.stderr or ""))
                raise DownloadError(
                    _pip_failure_message("pipのブートストラップ", ensurepip.returncode)
                )
            emit("progress", "pip を ensurepip でインストールしました")

        version, returncode, output = _pip_version_check(python)
        if returncode != 0:
            _remember_pip_output(output)
            raise DownloadError(_pip_failure_message("pipの起動確認", returncode))

    if _pip_requires_upgrade(version):
        emit(
            "progress",
            f"pip {'.'.join(map(str, version))} を {PIP_UPGRADE_REQUIREMENT} へ更新中...",
        )
        rc = run_and_stream(_pip_upgrade_command(python), label="pip更新")
        if rc != 0:
            raise DownloadError(_pip_failure_message("pipの更新", rc))
        version, returncode, output = _pip_version_check(python)
        if returncode != 0 or _pip_requires_upgrade(version):
            _remember_pip_output(output)
            raise DownloadError(_pip_failure_message("pipの更新後確認", returncode or 1))

    # If site-packages itself was removed by the development runtime reset,
    # it did not exist when this interpreter ran site.py and is therefore not
    # present in sys.path.  ensurepip/get-pip run in a child process and can
    # recreate the directory, but this long-lived setup process must publish
    # that newly-created import path before the direct resolver imports pip's
    # vendored packaging metadata helpers.
    _refresh_current_python_packages(python)
    emit("progress", f"pip {'.'.join(map(str, version))} を確認しました")


def _refresh_current_python_packages(python: Path) -> None:
    """Make packages installed by a bootstrap child visible in this process."""
    try:
        selected = python.resolve()
        current = Path(sys.executable).resolve()
    except OSError:
        selected = python.absolute()
        current = Path(sys.executable).absolute()
    if selected != current:
        return
    package_dir = Path(
        sysconfig.get_paths().get("purelib", sysconfig.get_paths()["platlib"])
    )
    package_text = str(package_dir)
    if package_text not in sys.path:
        sys.path.insert(0, package_text)
    importlib.invalidate_caches()


def _report_artifacts(report: dict, wheelhouse: Path) -> list[dict]:
    """Extract immutable, hash-pinned download URLs from a pip report."""
    artifacts: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for item in report.get("install", []):
        if not isinstance(item, dict):
            continue
        info = item.get("download_info")
        if not isinstance(info, dict):
            # Already-installed packages do not need a second download.
            continue
        url = str(info.get("url", ""))
        if not url.startswith(("http://", "https://")):
            continue
        archive = info.get("archive_info")
        hashes = archive.get("hashes", {}) if isinstance(archive, dict) else {}
        sha256 = hashes.get("sha256") if isinstance(hashes, dict) else None
        if not sha256:
            fragment = parse_qs(urlsplit(url).fragment).get("sha256", [""])[0]
            sha256 = fragment or None
        if not sha256:
            sha256 = KNOWN_ARTIFACT_SHA256.get(_artifact_hash_key(url))
        filename = _safe_filename(url, str(sha256) if sha256 else None)
        key = (filename, str(sha256 or ""))
        if key in seen:
            continue
        seen.add(key)
        artifacts.append({"url": url, "sha256": sha256, "filename": filename})
    return artifacts


class _SimpleIndexParser(HTMLParser):
    """Small PEP 503/658 parser; no third-party HTML dependency is required."""

    def __init__(self) -> None:
        super().__init__()
        self.links: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        values = {key.lower(): value or "" for key, value in attrs}
        href = values.get("href", "")
        if href:
            self.links.append(
                {
                    "href": href,
                    # PEP 658 originally used data-dist-info-metadata;
                    # newer indexes may expose the same digest as
                    # data-core-metadata.
                    "metadata": values.get("data-core-metadata", "")
                    or values.get("data-dist-info-metadata", ""),
                    "requires_python": values.get("data-requires-python", ""),
                }
            )


def _package_name_normalized(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


@lru_cache(maxsize=1)
def _supported_wheel_tags():
    """Return tags accepted by this exact Python/OS/CPU combination."""
    try:
        from pip._vendor.packaging.tags import sys_tags

        return frozenset(sys_tags())
    except ImportError:
        return frozenset()


def _wheel_compatible(filename: str) -> bool:
    lower = filename.lower()
    if not lower.endswith(".whl"):
        return False
    filename_only = unquote(Path(urlsplit(filename).path).name)
    try:
        from pip._vendor.packaging.utils import parse_wheel_filename

        _, _, _, wheel_tags = parse_wheel_filename(filename_only)
        supported = _supported_wheel_tags()
        if supported:
            # This rejects e.g. a manylinux_aarch64 wheel on the supported
            # x86_64 Linux build while accepting py3-none-any naturally.
            return bool(wheel_tags & supported)
    except ImportError:
        # pip is bootstrapped before the production resolver runs, but keep a
        # small fallback for standalone diagnostics/unit tests.
        pass
    except ValueError:
        return False

    # Fallback for an early/bootstrap interpreter without pip's vendored
    # packaging library.  Linux distribution artifacts are x86_64-only; pure
    # Python wheels were handled by the tags path above and remain portable.
    if "-py3-none-any.whl" in lower or "-py2.py3-none-any.whl" in lower:
        return True
    python_tag = f"cp{sys.version_info.major}{sys.version_info.minor}"
    if os.name == "nt":
        return (python_tag in lower or "py3-none" in lower) and (
            "win_amd64" in lower or "win32" in lower
        )
    return (python_tag in lower or "py3-none" in lower) and (
        ("manylinux" in lower or "musllinux" in lower or "linux_x86_64" in lower)
        and "x86_64" in lower
    )


def _candidate_version(filename: str):
    try:
        from pip._vendor.packaging.utils import parse_wheel_filename

        _, version, _, _ = parse_wheel_filename(unquote(Path(urlsplit(filename).path).name))
        return version
    except Exception:
        # This fallback covers the normal torch/nvidia wheel spelling if a
        # vendor packaging module is unavailable during bootstrap.
        stem = unquote(Path(urlsplit(filename).path).name).rsplit(".whl", 1)[0]
        match = re.search(
            r"-(\d+(?:\.\d+)+(?:[+._-][A-Za-z0-9.]+)?)-(?:cp\d+|py\d+)",
            stem,
        )
        if not match:
            match = re.search(r"-(\d+(?:\.\d+)+(?:[+._-][A-Za-z0-9.]+)?)", stem)
        if not match:
            return None
        try:
            from pip._vendor.packaging.version import Version

            return Version(match.group(1))
        except Exception:
            return None


def _parse_requirement(line: str):
    try:
        from pip._vendor.packaging.requirements import Requirement

        return Requirement(line)
    except Exception as exc:
        raise DownloadError(f"依存関係の解析に失敗しました: {_sanitize_text(line)}") from exc


def _requirement_marker_matches(marker, environment: dict[str, str]) -> bool:
    """Evaluate a dependency marker with no implicitly selected extra.

    ``packaging`` raises ``UndefinedEnvironmentName`` when an index metadata
    line contains ``extra == ...`` but the environment does not define the
    PEP 508 ``extra`` variable.  The direct resolver installs the base
    requirement (it never selects an optional extra), so an empty value is
    the correct fail-closed value: ``extra == \"foo\"`` evaluates false.
    """
    marker_environment = dict(environment)
    marker_environment.setdefault("extra", "")
    return marker.evaluate(marker_environment)


def _index_candidates_for_package(package: str, primary_index: str) -> list[str]:
    """Choose an official index order without mixing generic PyPI wheels.

    The CUDA/ROCm simple indexes mirror some generic packages (for example
    MarkupSafe) but may not expose their PEP 658 metadata endpoint.  Only
    backend-specific packages are resolved from that index first; ordinary
    Python dependencies are intentionally queried from PyPI first and do not
    fall back to a backend mirror.
    """
    name = _package_name_normalized(package)
    if name.startswith("nvidia-"):
        return list(dict.fromkeys([primary_index, PYPI_NVIDIA_INDEX, PYPI_INDEX]))
    if name in {"pytorch-triton-rocm", "triton-rocm"}:
        return list(dict.fromkeys([primary_index, PYPI_INDEX]))
    if name in {"torch", "torchaudio", "torchvision", "triton"}:
        if name == "triton":
            return list(dict.fromkeys([primary_index, PYPI_NVIDIA_INDEX, PYPI_INDEX]))
        return list(dict.fromkeys([primary_index, PYPI_INDEX]))
    return [PYPI_INDEX]


def _use_direct_backend_resolver(variant: str, platform_name: str | None = None) -> bool:
    """Select backend graphs that must keep generic wheels on PyPI.

    The PyTorch CUDA/CPU indexes mirror ordinary dependencies such as Jinja2,
    MarkupSafe, and setuptools, but their mirrored wheel links may omit the
    PEP 503 SHA-256 fragment.  The direct resolver queries backend wheels from
    the selected PyTorch index and ordinary dependencies from PyPI, preserving
    the resumable wheelhouse's hash requirement on Windows as well as Linux.

    Windows ROCm remains on its dedicated pip-report path because its package
    graph uses backend-specific extras and a source archive.
    """
    platform_name = os.name if platform_name is None else platform_name
    if platform_name == "nt":
        return variant in {"cuda", "cpu"}
    return variant in {"cuda", "rocm"}


def _fetch_simple_links(package: str, index_url: str) -> list[dict[str, str]]:
    normalized = _package_name_normalized(package)
    page_url = index_url.rstrip("/") + "/" + normalized + "/"
    request = urllib.request.Request(
        page_url,
        headers={"User-Agent": "Local-Transcription-for-Therapy/1 package metadata"},
    )
    try:
        with urllib.request.urlopen(request, timeout=PIP_TIMEOUT_SECONDS) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return []
        raise DownloadError(f"{package} の公式パッケージ一覧取得に失敗しました（HTTP {exc.code}）。") from exc
    except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError) as exc:
        raise DownloadError(
            f"{package} の公式パッケージ一覧取得中に通信エラーが発生しました: {_sanitize_text(str(exc))}"
        ) from exc

    parser = _SimpleIndexParser()
    parser.feed(body)
    links: list[dict[str, str]] = []
    for link in parser.links:
        href = urljoin(page_url, link["href"])
        filename = Path(urlsplit(href).path).name
        if not _wheel_compatible(filename):
            continue
        link["url"] = href
        link["filename"] = filename
        links.append(link)
    return links


def _metadata_url_for_wheel(url: str) -> str:
    parsed = urlsplit(url)
    clean = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
    return clean + ".metadata"


class _HTTPRangeReader(io.RawIOBase):
    """Small seekable remote file backed by strict HTTP byte ranges.

    ``zipfile.ZipFile`` seeks to the end of a wheel to read its central
    directory and then seeks back to the selected ``.dist-info/METADATA``
    member.  This reader fetches only fixed-size blocks for those seeks; it
    never hands a multi-gigabyte wheel to ``zipfile`` or to the pip temp dir.
    The cache is deliberately small because it is metadata plumbing, not a
    second package cache.
    """

    def __init__(
        self,
        url: str,
        *,
        block_size: int = REMOTE_WHEEL_BLOCK_BYTES,
        max_fetch_bytes: int = REMOTE_WHEEL_MAX_FETCH_BYTES,
    ) -> None:
        super().__init__()
        parsed = urlsplit(url)
        if parsed.scheme.lower() != "https" or not parsed.netloc:
            raise DownloadError("remote wheel metadataはHTTPS URLだけを許可しています。")
        self._url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
        self._block_size = max(4096, int(block_size))
        self._max_fetch_bytes = max(self._block_size, int(max_fetch_bytes))
        self._position = 0
        self._fetched_bytes = 0
        self._etag: str | None = None
        self._last_modified: str | None = None
        self._blocks: OrderedDict[int, bytes] = OrderedDict()
        self._size = self._discover_size()
        if self._size <= 0:
            raise DownloadError("remote wheelのサイズを確認できませんでした。")

    @staticmethod
    def _response_status(response) -> int:
        return int(getattr(response, "status", response.getcode()))

    @staticmethod
    def _content_length(headers) -> int | None:
        value = headers.get("Content-Length", "")
        if value.isdigit():
            return int(value)
        return None

    @staticmethod
    def _content_range(value: str) -> tuple[int, int, int] | None:
        match = re.fullmatch(r"bytes\s+(\d+)-(\d+)/(\d+)", value.strip())
        if not match:
            return None
        start, end, total = (int(match.group(index)) for index in (1, 2, 3))
        if end < start or total <= end:
            return None
        return start, end, total

    def _request(self, headers: dict[str, str]):
        request = urllib.request.Request(self._url, headers=headers)
        try:
            return urllib.request.urlopen(request, timeout=PIP_TIMEOUT_SECONDS)
        except urllib.error.HTTPError as exc:
            exc.close()
            raise DownloadError(
                f"remote wheelメタデータ取得中のHTTPエラー: HTTP {exc.code}"
            ) from exc
        except (urllib.error.URLError, http.client.HTTPException, OSError) as exc:
            raise DownloadError(
                f"remote wheelメタデータ取得中の通信エラー: {_sanitize_text(str(exc))}"
            ) from exc

    def _remember_validator(self, headers) -> None:
        etag = headers.get("ETag")
        last_modified = headers.get("Last-Modified")
        if self._etag and etag and self._etag != etag:
            raise DownloadError("remote wheelのETagが取得途中で変化しました。")
        if self._last_modified and last_modified and self._last_modified != last_modified:
            raise DownloadError("remote wheelのLast-Modifiedが取得途中で変化しました。")
        if etag:
            self._etag = etag
        if last_modified:
            self._last_modified = last_modified

    def _discover_size(self) -> int:
        # HEAD is cheap, but several package indexes disable it.  Fall back to
        # a one-byte GET range and require Content-Range/Content-Length.
        try:
            request = urllib.request.Request(self._url, method="HEAD")
            with urllib.request.urlopen(request, timeout=PIP_TIMEOUT_SECONDS) as response:
                status = self._response_status(response)
                if 200 <= status < 300:
                    length = self._content_length(response.headers)
                    if length is not None:
                        self._remember_validator(response.headers)
                        return length
        except urllib.error.HTTPError as exc:
            exc.close()
        except (urllib.error.URLError, http.client.HTTPException, OSError):
            pass

        response = self._request(
            {
                "Range": "bytes=0-0",
                "User-Agent": "Local-Transcription-for-Therapy/1 package metadata",
            }
        )
        try:
            status = self._response_status(response)
            self._remember_validator(response.headers)
            content_range = self._content_range(response.headers.get("Content-Range", ""))
            if status == 206 and content_range and content_range[:2] == (0, 0):
                body = response.read(1)
                if len(body) != 1:
                    raise DownloadError("remote wheelの先頭Range応答が不完全です。")
                self._fetched_bytes += 1
                return content_range[2]
            if status == 200:
                # A server ignoring Range is acceptable only when its
                # Content-Length identifies the object.  Read one byte and
                # close immediately; never buffer the whole wheel.
                length = self._content_length(response.headers)
                if length is not None and length > 0:
                    body = response.read(1)
                    if len(body) != 1:
                        raise DownloadError("remote wheelの応答が空です。")
                    self._fetched_bytes += 1
                    return length
            raise DownloadError("remote wheelのサイズ応答がHTTP Range仕様に適合しません。")
        finally:
            response.close()

    def _fetch_block(self, start: int) -> bytes:
        end = min(self._size - 1, start + self._block_size - 1)
        expected = end - start + 1
        if self._fetched_bytes + expected > self._max_fetch_bytes:
            raise DownloadError(
                "remote wheelのメタデータ取得量が上限を超えました。"
                " PEP658対応indexまたは別の配布元を確認してください。"
            )
        headers = {
            "Range": f"bytes={start}-{end}",
            "User-Agent": "Local-Transcription-for-Therapy/1 package metadata",
        }
        if self._etag:
            headers["If-Range"] = self._etag
        elif self._last_modified:
            headers["If-Range"] = self._last_modified
        response = self._request(headers)
        try:
            status = self._response_status(response)
            self._remember_validator(response.headers)
            if status == 206:
                content_range = self._content_range(response.headers.get("Content-Range", ""))
                if (
                    content_range is None
                    or content_range[0] != start
                    or content_range[1] != end
                    or content_range[2] != self._size
                ):
                    raise DownloadError("remote wheelのContent-Rangeが要求範囲と一致しません。")
                content_length = self._content_length(response.headers)
                if content_length is not None and content_length != expected:
                    raise DownloadError("remote wheelのContent-Lengthが要求範囲と一致しません。")
            elif status == 200 and start == 0 and end == self._size - 1:
                # Only a complete response for a complete request is safe if
                # the server ignores Range.  Normal large wheels take the
                # 206 branch above.
                pass
            else:
                raise DownloadError("remote wheelが206 Partial Contentを返しませんでした。")

            chunks: list[bytes] = []
            remaining = expected
            while remaining:
                chunk = response.read(remaining)
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            body = b"".join(chunks)
            if len(body) != expected:
                raise DownloadError("remote wheelのRange応答が途中で終了しました。")
            self._fetched_bytes += len(body)
            return body
        finally:
            response.close()

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._position

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            position = offset
        elif whence == io.SEEK_CUR:
            position = self._position + offset
        elif whence == io.SEEK_END:
            position = self._size + offset
        else:
            raise ValueError(f"unsupported seek mode: {whence}")
        if position < 0:
            raise ValueError("negative seek position")
        self._position = position
        return position

    def read(self, size: int = -1) -> bytes:
        if self.closed:
            raise ValueError("I/O operation on closed remote wheel")
        if self._position >= self._size:
            return b""
        if size is None or size < 0:
            size = self._size - self._position
        size = min(size, self._size - self._position)
        if size <= 0:
            return b""

        chunks: list[bytes] = []
        remaining = size
        while remaining:
            block_start = (self._position // self._block_size) * self._block_size
            block = self._blocks.get(block_start)
            if block is None:
                block = self._fetch_block(block_start)
                self._blocks[block_start] = block
                self._blocks.move_to_end(block_start)
                while len(self._blocks) > REMOTE_WHEEL_CACHE_BLOCKS:
                    self._blocks.popitem(last=False)
            else:
                self._blocks.move_to_end(block_start)
            offset = self._position - block_start
            chunk = block[offset : offset + remaining]
            if not chunk:
                break
            chunks.append(chunk)
            self._position += len(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)


def _fetch_wheel_metadata_from_range(link: dict[str, str]) -> str:
    """Read a wheel's METADATA member without downloading its full payload."""
    wheel_hash = _wheel_hash(link)
    if not wheel_hash:
        raise DownloadError(
            f"{link['filename']} はSHA-256付きwheel URLではないため、remote metadataを安全に読めません。"
        )
    reader = _HTTPRangeReader(link["url"])
    try:
        with zipfile.ZipFile(reader) as archive:
            metadata_info = next(
                (
                    info
                    for info in archive.infolist()
                    if info.filename.replace("\\", "/").lower().endswith(".dist-info/metadata")
                ),
                None,
            )
            if metadata_info is None:
                raise DownloadError(f"{link['filename']}にdist-info/METADATAがありません。")
            if metadata_info.file_size > REMOTE_WHEEL_MAX_METADATA_BYTES:
                raise DownloadError(f"{link['filename']}のMETADATAが大きすぎます。")
            with archive.open(metadata_info) as metadata_file:
                content = metadata_file.read(REMOTE_WHEEL_MAX_METADATA_BYTES + 1)
            if len(content) > REMOTE_WHEEL_MAX_METADATA_BYTES:
                raise DownloadError(f"{link['filename']}のMETADATAが大きすぎます。")
            return content.decode("utf-8", errors="replace")
    except DownloadError:
        raise
    except (EOFError, OSError, KeyError, RuntimeError, ValueError, zipfile.BadZipFile) as exc:
        raise DownloadError(
            f"{link['filename']}のremote wheel metadataを読み取れませんでした: {_sanitize_text(str(exc))}"
        ) from exc
    finally:
        reader.close()


def _fetch_wheel_metadata(link: dict[str, str]) -> str:
    metadata_url = _metadata_url_for_wheel(link["url"])
    request = urllib.request.Request(
        metadata_url,
        headers={"User-Agent": "Local-Transcription-for-Therapy/1 package metadata"},
    )
    try:
        with urllib.request.urlopen(request, timeout=PIP_TIMEOUT_SECONDS) as response:
            content = response.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            exc.close()
            return _fetch_wheel_metadata_from_range(link)
        raise DownloadError(
            f"{link['filename']} のwheelメタデータを取得できませんでした（HTTP {exc.code}）。"
        ) from exc
    except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError) as exc:
        raise DownloadError(
            f"{link['filename']} のwheelメタデータ取得中に通信エラーが発生しました: {_sanitize_text(str(exc))}"
        ) from exc

    metadata_hash = link.get("metadata", "")
    if metadata_hash.startswith("sha256="):
        expected = metadata_hash.split("=", 1)[1]
        if hashlib.sha256(content).hexdigest().lower() != expected.lower():
            raise DownloadError(f"{link['filename']} のメタデータハッシュ検証に失敗しました。")
    return content.decode("utf-8", errors="replace")


def _wheel_hash(link: dict[str, str]) -> str | None:
    fragment = parse_qs(urlsplit(link["url"]).fragment).get("sha256", [""])[0]
    if re.fullmatch(r"[0-9a-fA-F]{64}", fragment):
        return fragment
    return KNOWN_ARTIFACT_SHA256.get(_artifact_hash_key(link["url"]))


def _resolve_direct_wheels(
    requirements: list[str],
    *,
    primary_index: str,
    label: str,
) -> list[dict[str, str]]:
    """Resolve a backend's wheel dependency graph from PEP 503/658 metadata.

    ``pip install --dry-run`` may download an entire wheel merely to inspect
    ``Requires-Dist`` when an index lacks PEP 658 metadata.  Full CUDA torch
    setup cannot use that path: NVIDIA wheels are the files that need durable
    Range checkpoints.  This resolver reads only small ``.whl.metadata`` files,
    then hands the hash-pinned wheel URLs to the durable downloader.
    """
    try:
        from pip._vendor.packaging.markers import default_environment
        from pip._vendor.packaging.specifiers import SpecifierSet
        from pip._vendor.packaging.version import Version
    except ImportError as exc:
        raise DownloadError("同梱pipの依存メタデータ機能を読み込めませんでした。") from exc

    selected: dict[str, dict] = {}
    constraints: dict[str, list] = {}
    pending = list(requirements)
    environment = default_environment()
    while pending:
        raw_requirement = pending.pop(0)
        requirement = _parse_requirement(raw_requirement)
        if requirement.marker is not None and not _requirement_marker_matches(
            requirement.marker, environment
        ):
            continue
        emit("progress", f"{label}: {requirement.name} の依存メタデータを確認中...")
        name = _package_name_normalized(requirement.name)
        specifier = SpecifierSet(str(requirement.specifier))
        constraints.setdefault(name, []).append(specifier)
        existing = selected.get(name)
        if existing is not None:
            version = existing["version"]
            if all(spec.contains(version, prereleases=True) for spec in constraints[name]):
                continue
            raise DownloadError(
                f"{label}の依存関係が衝突しました: {requirement.name}{requirement.specifier}"
            )

        links: list[dict[str, str]] = []
        for index_url in _index_candidates_for_package(name, primary_index):
            links = _fetch_simple_links(requirement.name, index_url)
            if links:
                break
        candidates = []
        for link in links:
            version = _candidate_version(link["filename"])
            if version is None or not specifier.contains(version, prereleases=True):
                continue
            requires_python = link.get("requires_python", "")
            if requires_python:
                try:
                    if not SpecifierSet(requires_python).contains(
                        Version(".".join(map(str, sys.version_info[:3])))
                    ):
                        continue
                except Exception:
                    pass
            wheel_hash = _wheel_hash(link)
            if not wheel_hash:
                # Installing a wheel without a PEP 503 sha256 would defeat the
                # integrity guarantee of the durable wheelhouse.
                continue
            candidates.append((version, link, wheel_hash))
        if not candidates:
            raise DownloadError(
                f"{requirement.name}{requirement.specifier} に対応するSHA-256付きwheelが公式indexにありません。"
            )
        candidates.sort(key=lambda item: item[0], reverse=True)
        version, link, wheel_hash = candidates[0]
        try:
            metadata = _fetch_wheel_metadata(link)
        except DownloadError:
            # NVIDIA runtime wheels are leaf binary payloads in the CUDA
            # graph.  Some pypi.nvidia mirrors do not publish PEP658 metadata
            # even though the wheel link itself is hash-pinned; no additional
            # Requires-Dist edges are needed for these packages.  Keep strict
            # metadata requirements for torch and ordinary Python packages.
            if name.startswith("nvidia-"):
                metadata = ""
            else:
                raise
        selected[name] = {
            "version": version,
            "url": link["url"],
            "sha256": wheel_hash,
        }
        for dependency in Parser().parsestr(metadata).get_all("Requires-Dist", []):
            pending.append(dependency)

    return [
        {"url": item["url"], "sha256": item["sha256"]}
        for item in selected.values()
    ]


def _write_report_path(wheelhouse: Path) -> Path:
    fd, name = tempfile.mkstemp(prefix=".pip-report-", suffix=".json", dir=wheelhouse)
    os.close(fd)
    path = Path(name)
    if os.name != "nt":
        path.chmod(0o600)
    return path


def _resolve_report(
    python: Path,
    wheelhouse: Path,
    pip_args: list[str],
    *,
    label: str,
) -> dict:
    """Resolve package versions using pip metadata without downloading wheels."""
    report_path = _write_report_path(wheelhouse)
    try:
        rc = run_and_stream(
            _pip_prefix(python) + [
                "install",
                "--dry-run",
                "--report",
                str(report_path),
                *pip_args,
            ],
            label=f"{label}（依存解決）",
        )
        if rc != 0:
            raise DownloadError(_pip_failure_message(label, rc))
        try:
            return json.loads(report_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise DownloadError(f"{label}の依存解決レポートを読み取れませんでした。") from exc
    finally:
        # Reports contain full URLs.  They are useful only while this phase is
        # running, so never leave them in the durable cache.
        report_path.unlink(missing_ok=True)


def _install_report_artifacts(
    python: Path,
    wheelhouse: Path,
    report: dict,
    *,
    label: str,
    force_reinstall: bool = False,
) -> None:
    artifacts = _report_artifacts(report, wheelhouse)
    paths: list[Path] = []
    for artifact in artifacts:
        path = _download_report_artifact(artifact, wheelhouse)
        paths.append(path)
        emit("progress", f"取得済みwheelを確認: {path.name}")
    if not paths:
        emit("progress", f"{label}: 取得済みパッケージを再利用します")
        return

    install_args = [
        "install",
        "--no-index",
        "--no-deps",
        "--prefer-binary",
        "--find-links",
        str(wheelhouse),
    ]
    if force_reinstall:
        install_args.append("--force-reinstall")
    install_args.extend(str(path) for path in paths)
    rc = run_and_stream(_pip_prefix(python) + install_args, label=f"{label}（ローカルwheelhouse）")
    if rc != 0:
        raise DownloadError(_pip_failure_message(label, rc))


def _install_direct_artifacts(
    python: Path,
    wheelhouse: Path,
    artifacts: list[dict[str, str]],
    *,
    label: str,
    force_reinstall: bool = True,
) -> None:
    paths: list[Path] = []
    for artifact in artifacts:
        path = _download_report_artifact(artifact, wheelhouse)
        paths.append(path)
        emit("progress", f"取得済みwheelを確認: {path.name}")
    if not paths:
        raise DownloadError(f"{label}のwheelが解決されませんでした。")
    install_args = [
        "install",
        "--no-index",
        "--no-deps",
        "--prefer-binary",
        "--find-links",
        str(wheelhouse),
    ]
    if force_reinstall:
        install_args.append("--force-reinstall")
    install_args.extend(str(path) for path in paths)
    rc = run_and_stream(
        _pip_prefix(python) + install_args,
        label=f"{label}（ローカルwheelhouse）",
    )
    if rc != 0:
        raise DownloadError(_pip_failure_message(label, rc))


def _install_resolved_phase(
    python: Path,
    wheelhouse: Path,
    pip_args: list[str],
    *,
    label: str,
    force_reinstall: bool = False,
) -> None:
    report = _resolve_report(python, wheelhouse, pip_args, label=label)
    _install_report_artifacts(
        python,
        wheelhouse,
        report,
        label=label,
        force_reinstall=force_reinstall,
    )


def _filtered_requirements(req_file: Path, excluded_names: set[str]) -> Path:
    """Create a short-lived requirements file excluding separately resolved wheels."""
    fd, tmp_name = tempfile.mkstemp(prefix="lott-requirements-", suffix=".txt", dir=_wheelhouse_dir())
    os.close(fd)
    path = Path(tmp_name)
    package_line = re.compile(r"^\s*([A-Za-z0-9_.-]+)")
    kept: list[str] = []
    for line in req_file.read_text(encoding="utf-8").splitlines():
        match = package_line.match(line)
        if match and match.group(1).lower().replace("_", "-") in excluded_names:
            continue
        kept.append(line)
    path.write_text("\n".join(kept) + "\n", encoding="utf-8")
    if os.name != "nt":
        path.chmod(0o600)
    return path


def _package_target_dir() -> Path:
    configured = os.environ.get("PIP_TARGET", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path(sysconfig.get_paths().get("purelib", sysconfig.get_paths()["platlib"]))


def _validate_python_environment(python: Path, variant: str, req_file: Path) -> None:
    """Verify essential imports before publishing the completion marker."""
    target = _package_target_dir()
    if target.exists() and str(target) not in sys.path:
        sys.path.insert(0, str(target))
    # faster-whisper intentionally has no PyAV dependency.  Reuse the same
    # import stub as the transcription sidecar for this validation process.
    try:
        sidecar_dir = Path(__file__).resolve().parent
        if str(sidecar_dir) not in sys.path:
            sys.path.insert(0, str(sidecar_dir))
        from transcribe_cli import install_pyav_import_stub

        install_pyav_import_stub()
        from diarize_cli import install_torchcodec_import_stub

        install_torchcodec_import_stub()
    except Exception:
        pass

    required_imports = [
        "torch",
        "torchaudio",
        "requests",
        "faster_whisper",
        "ctranslate2",
        "pyannote.audio",
    ]
    required_specs = [
        "huggingface_hub",
        "tokenizers",
        "numpy",
        "pyannote.audio",
        "transformers",
        "pyzipper",
        "msoffcrypto",
    ]
    failures: list[str] = []
    for name in required_imports:
        try:
            importlib.import_module(name)
        except Exception as exc:
            failures.append(f"{name}: {type(exc).__name__}: {exc}")
    for name in required_specs:
        try:
            if importlib.util.find_spec(name) is None:
                failures.append(f"{name}: module not found")
        except Exception as exc:
            failures.append(f"{name}: {type(exc).__name__}: {exc}")
    for forbidden in ("av", "imageio_ffmpeg"):
        if (target / forbidden).exists() or any(target.glob(f"{forbidden}-*.dist-info")):
            failures.append(f"{forbidden}: Apache-2.0配布方針に反するパッケージが残っています")
    if failures:
        detail = _sanitize_text("; ".join(failures[-8:]))
        raise DownloadError(f"Python主要モジュールの検証に失敗しました。{detail}")

    marker = target / PYTHON_SETUP_MARKER
    payload = {
        "format": 1,
        "variant": variant,
        "python": ".".join(map(str, sys.version_info[:3])),
        "requirements_sha256": hashlib.sha256(req_file.read_bytes()).hexdigest(),
        "created_at": int(time.time()),
    }
    target.mkdir(parents=True, exist_ok=True)
    _write_json_atomic(marker, payload)
    if os.name != "nt":
        marker.chmod(0o600)


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
        wheelhouse = _wheelhouse_dir()
        zip_path = wheelhouse / f"ctranslate2-{CT2_ROCM_VERSION}-{platform_name}.zip"
        # The GitHub release does not expose a pip report hash.  The durable
        # downloader still provides Range/ETag restart; ZIP validation and the
        # extracted wheel's pip hash/check are performed before installation.
        if zip_path.exists():
            try:
                with zipfile.ZipFile(zip_path) as existing_zip:
                    existing_zip.testzip()
            except (OSError, zipfile.BadZipFile):
                zip_path.unlink(missing_ok=True)
        _download_url_resumable(zip_url, zip_path)

        whl_path: Path | None = None
        with zipfile.ZipFile(zip_path) as archive:
            names = archive.namelist()
            # Python バージョン一致を優先、次にバージョン問わず
            selected = None
            for pattern in [
                lambda n: f"ctranslate2-{CT2_ROCM_VERSION}-{py_tag}-" in n,
                lambda n: f"ctranslate2-{CT2_ROCM_VERSION}-" in n,
            ]:
                selected = next((n for n in names if n.endswith(".whl") and pattern(n)), None)
                if selected:
                    break
            if selected is not None:
                whl_path = wheelhouse / _safe_filename(selected)
                temporary = whl_path.with_name(whl_path.name + ".extracting")
                with archive.open(selected) as source, temporary.open("wb") as target:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        target.write(chunk)
                temporary.replace(whl_path)

        if whl_path is None:
            emit("progress", "[WARN] CTranslate2 ROCm ホイールが見つかりません。GPU 文字起こしは利用できません。")
            return

        emit("progress", f"CTranslate2 ROCm をインストール中: {whl_path.name}")
        rc = run_and_stream(
            _pip_prefix(python) + ["install", "--force-reinstall", "--no-deps", str(whl_path)],
            label="CTranslate2 ROCm",
        )
        if rc != 0:
            emit("progress", f"[WARN] {_pip_failure_message('CTranslate2 ROCm', rc)}")
        else:
            emit("progress", "CTranslate2 ROCm のインストールが完了しました")

    except (DownloadError, OSError, zipfile.BadZipFile) as exc:
        emit("progress", f"[WARN] CTranslate2 ROCm のダウンロード中にエラーが発生しました: {_sanitize_text(str(exc))}")


def _find_faster_whisper_requirement(req_file: Path) -> str | None:
    pattern = re.compile(r"^\s*faster-whisper(?:\s|[<>=!~]=?|$)", re.IGNORECASE)
    for line in req_file.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if pattern.match(stripped):
            return stripped
    return None


def _install_faster_whisper_without_pyav(python: Path, req_file: Path) -> None:
    requirement = _find_faster_whisper_requirement(req_file)
    if not requirement:
        return
    emit("progress", "faster-whisper を PyAV なしでインストール中...")
    _install_resolved_phase(
        python,
        _wheelhouse_dir(),
        ["--prefer-binary", "--no-deps", "--ignore-installed", "--index-url", PYPI_INDEX, requirement],
        label="faster-whisper",
        force_reinstall=True,
    )


def _remove_gpl_ffmpeg_packages(python: Path) -> None:
    emit("progress", "PyAV / imageio-ffmpeg を除去中...")
    run_and_stream(
        _pip_prefix(python, include_resume=False) + ["uninstall", "-y", "av", "imageio-ffmpeg"],
        label="PyAV除去",
    )


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
    # Resolve the interpreter contract before touching pip or the network.
    # Otherwise an accidental Python 3.14 venv reaches the ROCm resolver and
    # reports the cp312-only triton_rocm wheel as a hash problem.
    _validate_python_version()

    # Durable state is initialized before any output is emitted so diagnostics
    # from bootstrap/pip are available even when the first network step fails.
    wheelhouse = _wheelhouse_dir()
    global _SETUP_LOG_PATH
    _SETUP_LOG_PATH = _setup_log_path(wheelhouse)
    _record_log(f"setup started: variant={args.variant}, python={python}")

    if not req_file.exists():
        emit("error", f"requirements ファイルが見つかりません: {req_file}")
        sys.exit(1)

    # pip の確認・ブートストラップ
    _bootstrap_pip(python)
    _detect_pip_capabilities(python)
    _remove_gpl_ffmpeg_packages(python)

    # PyTorch とその backend runtime 依存をPEP 503/658のメタデータ
    # （ROCm wheelに658が無い場合はremote ZIP metadata）から先に固定し、
    # wheelhouseへ取得する。アプリ再起動後は各ファイルの.partから再開する。
    # Windows CUDA/CPUでもこの経路を使い、PyTorch index上のハッシュ無し
    # 汎用wheelではなく、SHA-256付きのPyPI公式wheelを選ぶ。
    if args.variant == "rocm" and os.name == "nt":
        gfx_target = os.environ.get("LOTT_ROCM_GFX_TARGET", "gfx1103").strip() or "gfx1103"
        rocm_index = os.environ.get(
            "LOTT_PYTORCH_ROCM_INDEX_URL", PYTORCH_ROCM_WINDOWS_INDEX
        ).strip() or PYTORCH_ROCM_WINDOWS_INDEX
        # ROCm Core 7.14.0 is published as a source archive whose isolated
        # build requires setuptools>=70.2.  Resolve that small build wheel
        # from PyPI first so the subsequent --no-index installation remains
        # offline and deterministic.  Do not mix PyPI into AMD's package
        # index with --extra-index-url.
        _install_resolved_phase(
            python,
            wheelhouse,
            [
                "--prefer-binary",
                "--index-url",
                PYPI_INDEX,
                *ROCM_WINDOWS_BUILD_REQUIREMENTS,
            ],
            label="ROCm Windows build dependency",
            force_reinstall=False,
        )
        emit(
            "progress",
            f"ROCm Core {PYTORCH_ROCM_WINDOWS_VERSION} ({gfx_target}, Windows) をインストール中...",
        )
        _install_resolved_phase(
            python,
            wheelhouse,
            [
                "--upgrade",
                "--prefer-binary",
                "--ignore-installed",
                "--index-url",
                rocm_index,
                f"rocm[libraries,device-{gfx_target}]=={PYTORCH_ROCM_WINDOWS_VERSION}",
            ],
            label="ROCm Core",
            force_reinstall=True,
        )
        torch_specs = [
            "--upgrade",
            "--prefer-binary",
            "--ignore-installed",
            "--index-url",
            rocm_index,
            f"torch[device-{gfx_target}]=={PYTORCH_ROCM_WINDOWS_TORCH_VERSION}+rocm{PYTORCH_ROCM_WINDOWS_VERSION}",
            f"torchvision[device-{gfx_target}]=={PYTORCH_ROCM_WINDOWS_TORCHVISION_VERSION}+rocm{PYTORCH_ROCM_WINDOWS_VERSION}",
            f"torchaudio=={PYTORCH_ROCM_WINDOWS_TORCHAUDIO_VERSION}+rocm{PYTORCH_ROCM_WINDOWS_VERSION}",
        ]
        label = "PyTorch (ROCm Windows)"
    elif args.variant == "rocm":
        emit("progress", "PyTorch (ROCm 7.2) をインストール中... 数分かかります")
        torch_specs = [
            "--prefer-binary",
            "--ignore-installed",
            "--index-url",
            PYTORCH_ROCM_INDEX,
            "torch==2.11.0",
            "torchaudio==2.11.0",
        ]
        label = "PyTorch (ROCm)"
    elif args.variant == "cuda":
        emit("progress", "PyTorch (CUDA 12.8) をインストール中... 数分かかります")
        torch_specs = [
            "--prefer-binary",
            "--ignore-installed",
            "--index-url",
            PYTORCH_CUDA_INDEX,
            "torch==2.10.0",
            "torchaudio==2.10.0",
        ]
        label = "PyTorch (CUDA)"
    else:
        emit("progress", "PyTorch (CPU) をインストール中... 数分かかります")
        torch_specs = [
            "--prefer-binary",
            "--ignore-installed",
            "--index-url",
            PYTORCH_CPU_INDEX,
            "torch==2.10.0",
            "torchaudio==2.10.0",
        ]
        label = "PyTorch (CPU)"

    if _use_direct_backend_resolver(args.variant):
        # Do not let pip inspect backend wheels in /tmp while generating a
        # report.  CUDA generally has PEP658 metadata; ROCm torch 2.11 wheels
        # are multi-gigabyte files without it, so _fetch_wheel_metadata falls
        # back to reading only the remote ZIP METADATA member via HTTP Range.
        direct_requirements = (
            ["torch==2.11.0", "torchaudio==2.11.0"]
            if args.variant == "rocm"
            else ["torch==2.10.0", "torchaudio==2.10.0"]
        )
        direct_index = {
            "cuda": PYTORCH_CUDA_INDEX,
            "rocm": PYTORCH_ROCM_INDEX,
            "cpu": PYTORCH_CPU_INDEX,
        }[args.variant]
        direct_artifacts = _resolve_direct_wheels(
            direct_requirements,
            primary_index=direct_index,
            label=label,
        )
        _install_direct_artifacts(
            python,
            wheelhouse,
            direct_artifacts,
            label=label,
            force_reinstall=True,
        )
    else:
        _install_resolved_phase(python, wheelhouse, torch_specs, label=label, force_reinstall=True)
    emit("progress", f"{label} のインストールが完了しました")

    if args.variant == "rocm":
        # CTranslate2 ROCm（警告のみ、失敗しても既存方針どおり続行）
        _install_ctranslate2_rocm(python)

    _install_faster_whisper_without_pyav(python, req_file)

    # PyTorch/faster-whisperは上の解決フェーズで固定済みなので、一般依存は
    # それらを要件ファイルから除外して同じ二段階方式で取得・導入する。
    excluded = {"faster-whisper", "torch", "torchaudio", "torchvision"}
    filtered_req_file = _filtered_requirements(req_file, excluded)
    emit("progress", "依存パッケージをインストール中... 数分かかります")
    try:
        _install_resolved_phase(
            python,
            wheelhouse,
            [
                "--prefer-binary",
                "--only-binary=contourpy",
                "--index-url",
                PYPI_INDEX,
                "-r",
                str(filtered_req_file),
            ],
            label="Python依存パッケージ",
            force_reinstall=False,
        )
    finally:
        filtered_req_file.unlink(missing_ok=True)

    _validate_python_environment(python, args.variant, req_file)
    emit("done", "Python 環境のセットアップが完了しました")


if __name__ == "__main__":
    try:
        main()
    except DownloadError as e:
        emit("error", _sanitize_text(str(e)))
        sys.exit(1)
    except Exception as e:
        emit("error", _sanitize_text(f"予期しないエラー: {e}\n{traceback.format_exc()}"))
        sys.exit(1)
