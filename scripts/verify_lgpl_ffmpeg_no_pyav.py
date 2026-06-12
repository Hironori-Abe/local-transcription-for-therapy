#!/usr/bin/env python3
"""Verify the no-PyAV LGPL FFmpeg runtime path.

Run this with the same Python interpreter that will be used by the app.
It does not install packages, download models, or run an ASR model.
"""

from __future__ import annotations

import argparse
import importlib.metadata
import os
import site
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

FORBIDDEN_CONFIG_TOKENS = (
    "--enable-gpl",
    "--enable-nonfree",
    "--enable-libx264",
    "--enable-libx265",
    "--enable-libxvid",
    "--enable-libfdk-aac",
)


def fail(message: str) -> None:
    print(f"[FAIL] {message}", file=sys.stderr)
    raise SystemExit(1)


def ok(message: str) -> None:
    print(f"[OK] {message}")


def package_absent(name: str) -> None:
    try:
        version = importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        ok(f"package absent: {name}")
        return
    fail(f"package must not be installed: {name} {version}")


def path_absent(path: Path) -> None:
    if path.exists():
        fail(f"path must not exist: {path}")
    ok(f"path absent: {path}")


def run_ffmpeg_version(ffmpeg: Path) -> str:
    if not ffmpeg.exists():
        fail(f"ffmpeg not found: {ffmpeg}")
    result = subprocess.run(
        [str(ffmpeg), "-version"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        fail(f"ffmpeg -version failed:\n{result.stdout}")
    return result.stdout


def validate_ffmpeg_config(version_output: str) -> None:
    config_line = ""
    for line in version_output.splitlines():
        if line.startswith("configuration:"):
            config_line = line
            break
    if not config_line:
        fail("ffmpeg -version did not include a configuration line")

    found = [token for token in FORBIDDEN_CONFIG_TOKENS if token in config_line]
    if found:
        fail(f"forbidden ffmpeg configure flags found: {', '.join(found)}")
    ok("ffmpeg configure flags are LGPL-compatible for this policy")


def verify_transcribe_path(sample: Path) -> None:
    import python_sidecar.transcribe_cli as transcribe_cli

    audio = transcribe_cli.decode_audio_with_ffmpeg(str(sample))
    if getattr(audio, "dtype", None).name != "float32":
        fail(f"decoded audio dtype must be float32, got {getattr(audio, 'dtype', None)}")
    if int(audio.shape[0]) <= 0:
        fail("decoded audio is empty")
    ok(f"transcribe ffmpeg decode succeeded: samples={int(audio.shape[0])}")

    transcribe_cli.install_pyav_import_stub()
    from faster_whisper import WhisperModel  # noqa: F401

    av_mod = sys.modules.get("av")
    if not getattr(av_mod, "__lott_stub__", False):
        fail("faster-whisper import did not use LoTT PyAV stub")
    if getattr(av_mod, "__file__", None):
        fail(f"real PyAV module was imported: {av_mod.__file__}")
    ok("faster-whisper imports with LoTT PyAV stub")


def verify_diarize_path(sample: Path) -> None:
    from python_sidecar import diarize_cli

    resolved = diarize_cli.resolve_ffmpeg_bin()
    expected = str(Path(os.environ["FFMPEG_BIN"]))
    if str(resolved) != expected:
        fail(f"diarize ffmpeg mismatch: resolved={resolved!r}, expected={expected!r}")

    wav_path = diarize_cli.to_wav_if_possible(sample)
    try:
        if wav_path == sample:
            fail("diarize MP3->WAV conversion returned original path")
        if not wav_path.exists() or wav_path.suffix.lower() != ".wav":
            fail(f"diarize WAV conversion failed: {wav_path}")
        ok("diarize ffmpeg WAV conversion succeeded")
    finally:
        if wav_path != sample:
            wav_path.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify no-PyAV LGPL FFmpeg runtime")
    parser.add_argument("--ffmpeg", required=True, help="Path to bundled LGPL ffmpeg")
    parser.add_argument("--sample", required=True, help="Audio sample for decode smoke tests")
    args = parser.parse_args()

    ffmpeg = Path(args.ffmpeg).resolve()
    sample = Path(args.sample).resolve()
    if not sample.exists():
        fail(f"sample not found: {sample}")

    package_absent("av")
    package_absent("imageio-ffmpeg")

    site_package_dirs = [Path(p) for p in site.getsitepackages()]
    user_site = site.getusersitepackages()
    if user_site:
        site_package_dirs.append(Path(user_site))
    for site_packages in sorted(set(site_package_dirs)):
        if not site_packages.exists():
            continue
        path_absent(site_packages / "av")
        path_absent(site_packages / "av.libs")
        path_absent(site_packages / "imageio_ffmpeg")

    version_output = run_ffmpeg_version(ffmpeg)
    validate_ffmpeg_config(version_output)

    os.environ["FFMPEG_BIN"] = str(ffmpeg)
    os.environ["ALLOW_GPL_FFMPEG"] = "0"

    verify_transcribe_path(sample)
    verify_diarize_path(sample)
    ok("no-PyAV LGPL FFmpeg verification passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
