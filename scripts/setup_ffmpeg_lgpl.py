#!/usr/bin/env python3
"""Download and install a bundled LGPL FFmpeg CLI for LoTT builds.

The app uses FFmpeg only as a separate CLI process for audio decoding and
conversion. Keep this binary out of git; build scripts can recreate it.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import platform as platform_module
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path


BASE_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"
ASSETS = {
    ("windows", "lgpl"): "ffmpeg-master-latest-win64-lgpl.zip",
    ("windows", "lgpl-shared"): "ffmpeg-master-latest-win64-lgpl-shared.zip",
    ("linux", "lgpl"): "ffmpeg-master-latest-linux64-lgpl.tar.xz",
    ("linux", "lgpl-shared"): "ffmpeg-master-latest-linux64-lgpl-shared.tar.xz",
}
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
    with urllib.request.urlopen(url) as response, dest.open("wb") as out:
        shutil.copyfileobj(response, out)


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


def main() -> int:
    parser = argparse.ArgumentParser(description="Install bundled LGPL FFmpeg CLI")
    parser.add_argument("--platform", choices=["windows", "linux"], default=infer_platform())
    parser.add_argument("--variant", choices=["lgpl", "lgpl-shared"], default="lgpl")
    parser.add_argument("--dest", default="src-tauri/resources/ffmpeg")
    parser.add_argument("--archive", default="", help="Use an already downloaded archive")
    parser.add_argument("--force", action="store_true", help="Replace an existing binary")
    args = parser.parse_args()

    asset = ASSETS[(args.platform, args.variant)]
    url = f"{BASE_URL}/{asset}"
    dest_dir = Path(args.dest)
    dest_dir.mkdir(parents=True, exist_ok=True)
    binary_name = "ffmpeg.exe" if args.platform == "windows" else "ffmpeg"
    binary_dest = dest_dir / binary_name

    host_platform = infer_platform()
    metadata_missing = not (dest_dir / "LICENSE.txt").exists() or not (
        dest_dir / "FFMPEG_BUILD_INFO.txt"
    ).exists()
    if binary_dest.exists() and not args.force and not metadata_missing:
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

    with tempfile.TemporaryDirectory(prefix="lott-ffmpeg-") as tmp:
        archive = Path(args.archive) if args.archive else Path(tmp) / asset
        if not args.archive:
            download(url, archive)
        if not archive.exists():
            raise SystemExit(f"Archive not found: {archive}")

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
