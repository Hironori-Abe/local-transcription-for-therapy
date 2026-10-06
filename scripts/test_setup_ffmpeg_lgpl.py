"""Offline checks for the pinned FFmpeg fetch: python scripts/test_setup_ffmpeg_lgpl.py."""
import hashlib
import io
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

import setup_ffmpeg_lgpl as ffmpeg_setup

TAG = "autobuild-2026-01-01-00-00"
ASSET = "ffmpeg-test-win64-lgpl.zip"
PAYLOAD = b"pretend archive bytes"
PAYLOAD_SHA256 = hashlib.sha256(PAYLOAD).hexdigest()


class Downloader:
    def __init__(self, payload=PAYLOAD, error=None):
        self.payload = payload
        self.error = error
        self.calls = []

    def __call__(self, url, dest):
        self.calls.append(url)
        if self.error:
            raise self.error
        dest.write_bytes(self.payload)


def http_error(code):
    return urllib.error.HTTPError("https://example.invalid/x", code, "err", {}, io.BytesIO(b""))


class PinTableTests(unittest.TestCase):
    def test_every_platform_variant_is_pinned_to_a_dated_release(self):
        self.assertRegex(ffmpeg_setup.PINNED_TAG, r"^autobuild-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$")
        self.assertEqual(
            set(ffmpeg_setup.ASSETS),
            {("windows", "lgpl"), ("windows", "lgpl-shared"), ("linux", "lgpl"), ("linux", "lgpl-shared")},
        )
        for (platform, variant), pinned in ffmpeg_setup.ASSETS.items():
            with self.subTest(platform=platform, variant=variant):
                self.assertRegex(pinned.sha256, r"^[0-9a-f]{64}$")
                self.assertNotIn("latest", pinned.name)
                self.assertIn("-lgpl", pinned.name)
                self.assertNotIn("-gpl", pinned.name.replace("-lgpl", ""))
                self.assertIn("win64" if platform == "windows" else "linux64", pinned.name)
                self.assertEqual("-shared" in pinned.name, variant == "lgpl-shared")

    def test_pinned_url_is_not_the_moving_latest_release(self):
        pin_tag, pin_asset, _ = ffmpeg_setup.resolve_pin("windows", "lgpl")
        url = ffmpeg_setup.pinned_url(pin_tag, pin_asset)
        self.assertEqual(
            url,
            f"https://github.com/BtbN/FFmpeg-Builds/releases/download/{ffmpeg_setup.PINNED_TAG}/{pin_asset}",
        )
        self.assertNotIn("/latest/", url)

    def test_overrides_require_all_three_values(self):
        for partial in (
            {"tag": TAG},
            {"asset": ASSET},
            {"sha256": PAYLOAD_SHA256},
            {"tag": TAG, "asset": ASSET},
            {"tag": TAG, "sha256": PAYLOAD_SHA256},
        ):
            with self.subTest(partial=partial):
                with self.assertRaises(SystemExit):
                    ffmpeg_setup.resolve_pin("windows", "lgpl", **partial)

    def test_override_with_all_values_and_rejects_bad_hash(self):
        self.assertEqual(
            ffmpeg_setup.resolve_pin("windows", "lgpl", TAG, ASSET, PAYLOAD_SHA256.upper()),
            (TAG, ASSET, PAYLOAD_SHA256),
        )
        with self.assertRaises(SystemExit):
            ffmpeg_setup.resolve_pin("windows", "lgpl", TAG, ASSET, "not-a-hash")


class FetchVerifiedArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cache = Path(self.tmp.name) / "cache"

    def fetch(self, downloader, expected=PAYLOAD_SHA256):
        return ffmpeg_setup.fetch_verified_archive(TAG, ASSET, expected, self.cache, downloader)

    def test_download_is_verified_and_cached(self):
        downloader = Downloader()
        archive = self.fetch(downloader)
        self.assertEqual(archive, self.cache / ASSET)
        self.assertEqual(archive.read_bytes(), PAYLOAD)
        self.assertEqual(downloader.calls, [ffmpeg_setup.pinned_url(TAG, ASSET)])
        self.assertEqual([p.name for p in self.cache.iterdir()], [ASSET])

    def test_matching_cache_skips_the_network(self):
        self.cache.mkdir(parents=True)
        (self.cache / ASSET).write_bytes(PAYLOAD)
        downloader = Downloader()
        self.assertEqual(self.fetch(downloader), self.cache / ASSET)
        self.assertEqual(downloader.calls, [])

    def test_corrupt_cache_is_replaced_by_a_verified_download(self):
        self.cache.mkdir(parents=True)
        (self.cache / ASSET).write_bytes(b"tampered")
        downloader = Downloader()
        archive = self.fetch(downloader)
        self.assertEqual(archive.read_bytes(), PAYLOAD)
        self.assertEqual(len(downloader.calls), 1)

    def test_hash_mismatch_fails_and_leaves_no_file(self):
        with self.assertRaises(SystemExit) as raised:
            self.fetch(Downloader(payload=b"swapped release"))
        self.assertIn("SHA-256", str(raised.exception))
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_hash_mismatch_discards_a_bad_cache_too(self):
        self.cache.mkdir(parents=True)
        (self.cache / ASSET).write_bytes(b"tampered")
        with self.assertRaises(SystemExit):
            self.fetch(Downloader(payload=b"also wrong"))
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_404_reports_removed_pin_without_falling_back_to_latest(self):
        downloader = Downloader(error=http_error(404))
        with self.assertRaises(SystemExit) as raised:
            self.fetch(downloader)
        message = str(raised.exception)
        self.assertIn("削除", message)
        self.assertIn("scripts/setup_ffmpeg_lgpl.py", message)
        self.assertIn("SHA-256", message)
        self.assertEqual(len(downloader.calls), 1)
        self.assertNotIn("/latest/", downloader.calls[0])
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_server_error_asks_to_retry_and_leaves_no_file(self):
        with self.assertRaises(SystemExit) as raised:
            self.fetch(Downloader(error=http_error(503)))
        self.assertIn("数分待", str(raised.exception))
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_network_failure_asks_to_check_connection(self):
        with self.assertRaises(SystemExit) as raised:
            self.fetch(Downloader(error=urllib.error.URLError("no route")))
        self.assertIn("インターネット接続", str(raised.exception))
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_interrupted_download_removes_the_part_file(self):
        class Interrupting:
            def __call__(self, url, dest):
                dest.write_bytes(b"half")
                raise KeyboardInterrupt

        with self.assertRaises(KeyboardInterrupt):
            self.fetch(Interrupting())
        self.assertEqual(list(self.cache.iterdir()), [])


class ArchiveAndRecordTests(unittest.TestCase):
    def test_verify_archive_sha256(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / ASSET
            archive.write_bytes(PAYLOAD)
            ffmpeg_setup.verify_archive_sha256(archive, PAYLOAD_SHA256)
            with self.assertRaises(SystemExit):
                ffmpeg_setup.verify_archive_sha256(archive, "0" * 64)

    def test_recorded_sha256_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp)
            archive = dest / "a.zip"
            binary = dest / "ffmpeg.exe"
            archive.write_bytes(PAYLOAD)
            binary.write_bytes(b"bin")
            self.assertIsNone(ffmpeg_setup.read_recorded_archive_sha256(dest))
            url = ffmpeg_setup.pinned_url(TAG, ASSET)
            ffmpeg_setup.write_build_info(dest, url, archive, binary, "windows", "lgpl", None, "skipped")
            self.assertEqual(ffmpeg_setup.read_recorded_archive_sha256(dest), PAYLOAD_SHA256)
            self.assertIn(f"download_url: {url}", (dest / "FFMPEG_BUILD_INFO.txt").read_text(encoding="utf-8"))

    def test_default_cache_dir_override_and_platform_default(self):
        with patch.dict("os.environ", {"LOTT_FFMPEG_CACHE_DIR": "X:/cache"}):
            self.assertEqual(ffmpeg_setup.default_cache_dir(), Path("X:/cache"))
        with patch.dict("os.environ", {"LOTT_FFMPEG_CACHE_DIR": ""}):
            self.assertEqual(ffmpeg_setup.default_cache_dir().name, "ffmpeg-cache")

    def test_forbidden_flags_are_still_rejected(self):
        ffmpeg_setup.validate_version_output("configuration: --enable-version3 --disable-libx264\n")
        with self.assertRaises(SystemExit):
            ffmpeg_setup.validate_version_output("configuration: --enable-gpl --enable-libx264\n")


if __name__ == "__main__":
    unittest.main()
