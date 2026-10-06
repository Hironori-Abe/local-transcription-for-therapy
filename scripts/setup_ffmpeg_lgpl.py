#!/usr/bin/env python3
"""Download and install a bundled LGPL FFmpeg CLI for LoTT builds.

The app uses FFmpeg only as a separate CLI process for audio decoding and
conversion. Keep this binary out of git; build scripts can recreate it.

Supply-chain policy: every clinical recording passes through this binary, so the
build is PINNED (release tag, asset names and SHA-256 below) instead of following
BtbN's moving ``latest`` release. A download whose SHA-256 differs from the pin is
rejected and never installed. There is no silent fallback to ``latest``.

To move to a new FFmpeg build, see "FFmpeg 固定版の更新" in docs/release-build-windows.md
(short version: pick a month-end ``autobuild-YYYY-MM-DD-HH-MM`` release of the same
FFmpeg series, copy the win64 / linux64 ``lgpl`` and ``lgpl-shared`` SHA-256 values
from that release's ``checksums.sha256``, run this script, and check the result).
"""

from __future__ import annotations

import argparse
import hashlib
import os
import platform as platform_module
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, NamedTuple


RELEASES_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download"
# FFmpeg 8.1 release-branch build from BtbN's month-end autobuild (month-end builds are
# kept much longer than the daily ones). Same FFmpeg major series (libavcodec 62) as the
# previously bundled master build.
PINNED_TAG = "autobuild-2026-09-30-13-08"


class PinnedAsset(NamedTuple):
    name: str
    sha256: str


ASSETS = {
    ("windows", "lgpl"): PinnedAsset(
        "ffmpeg-n8.1.3-9-g29e619e767-win64-lgpl-8.1.zip",
        "4a7642b2264c03e8a0ce8a3825b933ee5580656f45695a086fe7e294045ffc0a",
    ),
    ("windows", "lgpl-shared"): PinnedAsset(
        "ffmpeg-n8.1.3-9-g29e619e767-win64-lgpl-shared-8.1.zip",
        "3e47bda1607740550141e37c0e49d1e5182b34699f15adfd137ee266d346811a",
    ),
    ("linux", "lgpl"): PinnedAsset(
        "ffmpeg-n8.1.3-9-g29e619e767-linux64-lgpl-8.1.tar.xz",
        "dfa863a00ca81f1bdf58a372b18cff4820f0017e55de32778de8ecd8ed92a02e",
    ),
    ("linux", "lgpl-shared"): PinnedAsset(
        "ffmpeg-n8.1.3-9-g29e619e767-linux64-lgpl-shared-8.1.tar.xz",
        "d4d7b6936f492c0b866b1cb4a29a1bbae09d6a064b4ec4eb90c95bed7969535a",
    ),
}
DOWNLOAD_TIMEOUT_SECONDS = 120
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
FORBIDDEN_CONFIG_TOKENS = (
    "--enable-gpl",
    "--enable-nonfree",
    "--enable-libx264",
    "--enable-libx265",
    "--enable-libxvid",
    "--enable-libfdk-aac",
)


def infer_platform() -> str:
    system = platform_module.system().lower()
    if system == "windows":
        return "windows"
    if system == "linux":
        return "linux"
    raise SystemExit(f"Unsupported platform: {system}")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: Path) -> None:
    print(f"[INFO] Downloading {url}")
    with urllib.request.urlopen(url, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response, dest.open("wb") as out:
        shutil.copyfileobj(response, out)


def normalize_sha256(value: str) -> str:
    digest = value.strip().lower()
    if not SHA256_RE.match(digest):
        raise SystemExit(f"SHA-256 must be 64 hex characters: {value!r}")
    return digest


def pinned_url(tag: str, asset: str) -> str:
    return f"{RELEASES_URL}/{tag}/{asset}"


def default_cache_dir() -> Path:
    """Where verified archives are kept, so the next build can skip the download.

    Same work area as the ggml engine build (setup-ggml-speech-*), which the Linux
    Docker build already mounts as a volume. LOTT_FFMPEG_CACHE_DIR overrides it.
    """
    override = os.environ.get("LOTT_FFMPEG_CACHE_DIR", "").strip()
    if override:
        return Path(override)
    if platform_module.system().lower() == "windows":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / "lott-ggml-speech-build" / "ffmpeg-cache"
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "lott-ggml-speech-build" / "ffmpeg-cache"


def unlink_quietly(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    except OSError as exc:
        print(f"[WARN] Could not remove {path}: {exc}", file=sys.stderr)


def fetch_verified_archive(
    tag: str,
    asset: str,
    expected_sha256: str,
    cache_dir: Path,
    downloader: Callable[[str, Path], None] = download,
) -> Path:
    """Return a cached/downloaded archive whose SHA-256 equals ``expected_sha256``.

    A cached file is reused only when its hash matches. A fresh download is written to
    ``.part`` and renamed into the cache only after the hash matches, so a corrupted or
    tampered file is never left where a later run could pick it up.
    """
    expected = normalize_sha256(expected_sha256)
    url = pinned_url(tag, asset)
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached = cache_dir / asset

    if cached.exists():
        if sha256_file(cached) == expected:
            print(f"[INFO] Using cached FFmpeg archive (SHA-256 verified): {cached}")
            return cached
        print(f"[WARN] Cached archive does not match the pinned SHA-256; discarding it: {cached}")
        unlink_quietly(cached)

    part = cache_dir / (asset + ".part")
    unlink_quietly(part)
    try:
        downloader(url, part)
    except urllib.error.HTTPError as exc:
        unlink_quietly(part)
        if exc.code == 404:
            raise SystemExit(
                "固定した FFmpeg が配布元から削除されています (404): "
                f"{url}\n"
                "BtbN は古い autobuild を一定期間で削除します。暗黙に latest へ切り替えることはしません。"
                "scripts/setup_ffmpeg_lgpl.py の固定値 (PINNED_TAG と ASSETS のアセット名・SHA-256) を、"
                "現存する month-end の autobuild で検証した新しい版へ更新してください"
                "(手順: docs/release-build-windows.md「FFmpeg 固定版の更新」)。"
                f"取得済みの {asset} が手元にある場合は --archive で指定できます。"
            ) from exc
        raise SystemExit(
            f"FFmpeg のダウンロードに失敗しました (HTTP {exc.code}): {url}\n"
            "配布元 (GitHub) の一時的な障害の可能性があります。数分待ってから再実行してください。"
        ) from exc
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        unlink_quietly(part)
        raise SystemExit(
            f"FFmpeg のダウンロードに失敗しました: {url}\n原因: {exc}\n"
            "ビルド時はインターネット接続が必要です。接続とプロキシ設定を確認して再実行してください。"
        ) from exc
    except BaseException:
        unlink_quietly(part)
        raise

    actual = sha256_file(part)
    if actual != expected:
        unlink_quietly(part)
        raise SystemExit(
            "ダウンロードした FFmpeg の SHA-256 が固定値と一致しません。ファイルは破棄しました。\n"
            f"  URL     : {url}\n  期待値  : {expected}\n  実際    : {actual}\n"
            "通信の途中切断・破損か、配布物の差し替えの可能性があります。再実行しても同じ場合は"
            "インストールせず、配布元の checksums.sha256 と固定値を確認してください。"
        )
    os.replace(part, cached)
    return cached


def verify_archive_sha256(archive: Path, expected_sha256: str) -> None:
    expected = normalize_sha256(expected_sha256)
    actual = sha256_file(archive)
    if actual != expected:
        raise SystemExit(
            f"指定された FFmpeg アーカイブの SHA-256 が固定値と一致しません: {archive}\n"
            f"  期待値  : {expected}\n  実際    : {actual}\n"
            "固定版のアーカイブを指定するか、別版を使う場合は --tag / --asset / --sha256 を併せて指定してください。"
        )


def read_recorded_archive_sha256(dest_dir: Path) -> str | None:
    info = dest_dir / "FFMPEG_BUILD_INFO.txt"
    try:
        text = info.read_text(encoding="utf-8")
    except OSError:
        return None
    match = re.search(r"^archive_sha256:\s*([0-9a-fA-F]{64})\s*$", text, re.MULTILINE)
    return match.group(1).lower() if match else None


def resolve_pin(
    target_platform: str,
    variant: str,
    tag: str = "",
    asset: str = "",
    sha256: str = "",
) -> tuple[str, str, str]:
    """Return (tag, asset, sha256). The three overrides must be given together."""
    given = [bool(tag), bool(asset), bool(sha256)]
    if any(given) and not all(given):
        raise SystemExit(
            "--tag / --asset / --sha256 は 3 つ全てを同時に指定してください。"
            "SHA-256 を伴わない取得元の上書きは受け付けません。"
        )
    if all(given):
        print(f"[WARN] Pinned FFmpeg overridden: {tag}/{asset}")
        return tag, asset, normalize_sha256(sha256)
    pinned = ASSETS[(target_platform, variant)]
    return PINNED_TAG, pinned.name, normalize_sha256(pinned.sha256)


def member_basename(name: str) -> str:
    return name.replace("\\", "/").rstrip("/").split("/")[-1]


def find_archive_members(archive: Path, target_platform: str) -> tuple[str, str | None]:
    exe_name = "ffmpeg.exe" if target_platform == "windows" else "ffmpeg"
    license_member: str | None = None
    binary_member: str | None = None

    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as zf:
            for name in zf.namelist():
                normalized = name.replace("\\", "/")
                if normalized.endswith(f"/bin/{exe_name}"):
                    binary_member = name
                elif member_basename(normalized).lower() == "license.txt":
                    license_member = name
    else:
        with tarfile.open(archive) as tf:
            for member in tf.getmembers():
                normalized = member.name.replace("\\", "/")
                if normalized.endswith(f"/bin/{exe_name}") and member.isfile():
                    binary_member = member.name
                elif member_basename(normalized).lower() == "license.txt" and member.isfile():
                    license_member = member.name

    if not binary_member:
        raise SystemExit(f"ffmpeg binary was not found in archive: {archive}")
    return binary_member, license_member


def copy_archive_member(archive: Path, member: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as zf, zf.open(member) as src, dest.open("wb") as out:
            shutil.copyfileobj(src, out)
    else:
        with tarfile.open(archive) as tf:
            src_file = tf.extractfile(member)
            if src_file is None:
                raise SystemExit(f"Failed to read archive member: {member}")
            with src_file, dest.open("wb") as out:
                shutil.copyfileobj(src_file, out)


def run_ffmpeg_version(binary: Path) -> str:
    result = subprocess.run(
        [str(binary), "-version"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(f"ffmpeg -version failed:\n{result.stdout}")
    return result.stdout


def validate_version_output(version_output: str) -> None:
    config_line = ""
    for line in version_output.splitlines():
        if line.startswith("configuration:"):
            config_line = line
            break
    if not config_line:
        raise SystemExit("ffmpeg -version did not include a configuration line.")

    found = [token for token in FORBIDDEN_CONFIG_TOKENS if token in config_line]
    if found:
        raise SystemExit(
            "FFmpeg build is not acceptable for Apache-2.0 distribution; "
            f"forbidden flags found: {', '.join(found)}"
        )


def write_build_info(
    dest_dir: Path,
    url: str,
    archive: Path,
    binary: Path,
    target_platform: str,
    variant: str,
    version_output: str | None,
    runtime_check_note: str,
) -> None:
    lines = [
        "LoTT bundled FFmpeg build record",
        "",
        f"generated_at_utc: {datetime.now(timezone.utc).isoformat()}",
        f"target_platform: {target_platform}",
        f"variant: {variant}",
        f"download_url: {url}",
        "source_project: https://github.com/BtbN/FFmpeg-Builds",
        "ffmpeg_source: https://github.com/FFmpeg/FFmpeg",
        f"archive_sha256: {sha256_file(archive)}",
        f"binary_sha256: {sha256_file(binary)}",
        "license_note: BtbN 'lgpl' builds must not include --enable-gpl. "
        "If --enable-version3 is present, treat the bundled FFmpeg as LGPLv3.",
        f"runtime_check: {runtime_check_note}",
        "",
    ]
    if version_output:
        lines.extend(["ffmpeg_version_output:", version_output.rstrip(), ""])
    (dest_dir / "FFMPEG_BUILD_INFO.txt").write_text("\n".join(lines), encoding="utf-8")


def use_utf8_output() -> None:
    """Keep Japanese messages readable when output is piped (logs, CI) on a cp932 Windows."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError, OSError):
            pass


def main() -> int:
    use_utf8_output()
    parser = argparse.ArgumentParser(description="Install bundled LGPL FFmpeg CLI (pinned build)")
    parser.add_argument("--platform", choices=["windows", "linux"], default=infer_platform())
    parser.add_argument("--variant", choices=["lgpl", "lgpl-shared"], default="lgpl")
    parser.add_argument("--dest", default="src-tauri/resources/ffmpeg")
    parser.add_argument(
        "--archive",
        default="",
        help="Use an already downloaded archive (its SHA-256 must still match the pin)",
    )
    parser.add_argument("--force", action="store_true", help="Replace an existing binary")
    parser.add_argument(
        "--cache-dir",
        default="",
        help="Directory for verified archives (default: per-user build cache, or LOTT_FFMPEG_CACHE_DIR)",
    )
    parser.add_argument("--tag", default="", help="Override the pinned release tag (requires --asset and --sha256)")
    parser.add_argument("--asset", default="", help="Override the pinned asset name (requires --tag and --sha256)")
    parser.add_argument("--sha256", default="", help="SHA-256 of the overridden asset (requires --tag and --asset)")
    args = parser.parse_args()

    tag, asset, expected_sha256 = resolve_pin(args.platform, args.variant, args.tag, args.asset, args.sha256)
    url = pinned_url(tag, asset)
    dest_dir = Path(args.dest)
    dest_dir.mkdir(parents=True, exist_ok=True)
    binary_name = "ffmpeg.exe" if args.platform == "windows" else "ffmpeg"
    binary_dest = dest_dir / binary_name

    host_platform = infer_platform()
    metadata_missing = not (dest_dir / "LICENSE.txt").exists() or not (
        dest_dir / "FFMPEG_BUILD_INFO.txt"
    ).exists()
    recorded_sha256 = read_recorded_archive_sha256(dest_dir)
    stale_pin = binary_dest.exists() and recorded_sha256 != expected_sha256
    if binary_dest.exists() and not args.force and not metadata_missing and not stale_pin:
        print(f"[INFO] FFmpeg already exists: {binary_dest}")
        if host_platform == args.platform:
            version_output = run_ffmpeg_version(binary_dest)
            validate_version_output(version_output)
            print("[OK] Existing FFmpeg passed LGPL/GPL flag validation.")
        else:
            print("[WARN] Existing FFmpeg target differs from host; runtime validation skipped.")
        return 0
    if binary_dest.exists() and metadata_missing and not args.force:
        print("[INFO] FFmpeg exists, but license/build metadata is missing; refreshing it.")
    elif binary_dest.exists() and stale_pin and not args.force:
        print(
            "[INFO] Existing FFmpeg is not the pinned build "
            f"(recorded archive_sha256: {recorded_sha256 or 'none'}); replacing it with {asset}."
        )

    with tempfile.TemporaryDirectory(prefix="lott-ffmpeg-") as tmp:
        if args.archive:
            archive = Path(args.archive)
            if not archive.exists():
                raise SystemExit(f"Archive not found: {archive}")
            verify_archive_sha256(archive, expected_sha256)
        else:
            cache_dir = Path(args.cache_dir) if args.cache_dir else default_cache_dir()
            try:
                archive = fetch_verified_archive(tag, asset, expected_sha256, cache_dir)
            except PermissionError as exc:
                print(f"[WARN] FFmpeg cache is not writable ({exc}); using a temporary directory instead.")
                archive = fetch_verified_archive(tag, asset, expected_sha256, Path(tmp))

        binary_member, license_member = find_archive_members(archive, args.platform)
        copy_archive_member(archive, binary_member, binary_dest)
        if args.platform != "windows":
            binary_dest.chmod(0o755)

        if license_member:
            copy_archive_member(archive, license_member, dest_dir / "LICENSE.txt")

        version_output: str | None = None
        runtime_check_note = "skipped: target platform differs from host"
        if host_platform == args.platform:
            version_output = run_ffmpeg_version(binary_dest)
            validate_version_output(version_output)
            runtime_check_note = "passed"

        write_build_info(
            dest_dir=dest_dir,
            url=url,
            archive=archive,
            binary=binary_dest,
            target_platform=args.platform,
            variant=args.variant,
            version_output=version_output,
            runtime_check_note=runtime_check_note,
        )

    print(f"[OK] Installed LGPL FFmpeg: {binary_dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
