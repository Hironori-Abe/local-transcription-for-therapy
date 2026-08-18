"""Offline tests for the durable Python package downloader."""

from __future__ import annotations

import hashlib
import http.server
import os
import sys
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

try:
    from . import setup_venv_cli as setup
except ImportError:  # direct ``python python_sidecar/test_*.py`` convenience
    import setup_venv_cli as setup


class _RangeHandler(http.server.BaseHTTPRequestHandler):
    payload = b""
    etag = '"lott-test-object-v1"'
    ranges: list[str] = []

    def do_GET(self):  # noqa: N802 - stdlib handler API
        start = 0
        range_header = self.headers.get("Range", "")
        if range_header.startswith("bytes="):
            start = int(range_header.removeprefix("bytes=").split("-", 1)[0])
            self.__class__.ranges.append(range_header)
            if start >= len(self.payload):
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{len(self.payload)}")
                self.end_headers()
                return
        body = self.payload[start:]
        status = 206 if start else 200
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Range", f"bytes {start}-{len(self.payload) - 1}/{len(self.payload)}")
        self.send_header("ETag", self.etag)
        self.send_header("Last-Modified", "Tue, 01 Jan 2030 00:00:00 GMT")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        return


class ResumableDownloadTests(unittest.TestCase):
    def test_interrupted_download_resumes_with_range_and_hash(self):
        payload = bytes((index % 251 for index in range(3 * 1024 * 1024 + 17)))
        _RangeHandler.payload = payload
        _RangeHandler.ranges = []
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _RangeHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with TemporaryDirectory() as temporary:
                destination = Path(temporary) / "torch-test.whl"
                url = f"http://127.0.0.1:{server.server_port}/torch-test.whl?token=redacted"
                expected = hashlib.sha256(payload).hexdigest()
                with self.assertRaises(setup.DownloadError):
                    setup._download_url_resumable(
                        url,
                        destination,
                        expected,
                        max_bytes_for_test=1024 * 1024,
                    )
                self.assertTrue(destination.with_name(destination.name + ".part").exists())

                # A fresh call, equivalent to a new application process, uses
                # the persisted .part and sends an exact byte range.
                setup._download_url_resumable(url, destination, expected)
                self.assertEqual(destination.read_bytes(), payload)
                self.assertTrue(_RangeHandler.ranges)
                self.assertEqual(_RangeHandler.ranges[0], "bytes=1048576-")
                self.assertFalse(destination.with_name(destination.name + ".part").exists())
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_pip_environment_removes_untrusted_index_overrides(self):
        previous = {
            "PIP_EXTRA_INDEX_URL": os.environ.get("PIP_EXTRA_INDEX_URL"),
            "PIP_FIND_LINKS": os.environ.get("PIP_FIND_LINKS"),
            "PIP_NO_INDEX": os.environ.get("PIP_NO_INDEX"),
            "PIP_TRUSTED_HOST": os.environ.get("PIP_TRUSTED_HOST"),
        }
        try:
            os.environ["PIP_EXTRA_INDEX_URL"] = "https://evil.invalid/simple"
            os.environ["PIP_FIND_LINKS"] = "/tmp/evil"
            os.environ["PIP_NO_INDEX"] = "1"
            os.environ["PIP_TRUSTED_HOST"] = "evil.invalid"
            environment = setup._pip_environment()
            for key in previous:
                self.assertNotIn(key, environment)
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_old_pip_upgrade_is_pinned_to_supported_range(self):
        self.assertTrue(setup._pip_requires_upgrade((24, 0, 0)))
        self.assertFalse(setup._pip_requires_upgrade((25, 2, 0)))
        self.assertTrue(setup._pip_requires_upgrade((26, 0, 0)))
        command = setup._pip_upgrade_command(Path("python"))
        self.assertIn("--index-url", command)
        self.assertIn(setup.PYPI_INDEX, command)
        self.assertIn(setup.PIP_UPGRADE_REQUIREMENT, command)
        self.assertNotIn("--resume-retries", command)

    def test_pip_failure_categories_are_actionable(self):
        self.assertEqual(setup._classify_pip_failure("No space left on device"), "容量不足")
        self.assertEqual(
            setup._classify_pip_failure("Temporary failure in name resolution"),
            "DNS/名前解決エラー",
        )
        self.assertEqual(
            setup._classify_pip_failure("Connection reset by peer"),
            "接続切断エラー",
        )
        self.assertEqual(setup._classify_pip_failure("HTTP error 503"), "HTTPエラー")
        self.assertEqual(setup._classify_pip_failure("Read timed out"), "タイムアウト")
        self.assertEqual(setup._classify_pip_failure("Permission denied: wheelhouse"), "権限エラー")
        self.assertEqual(
            setup._classify_pip_failure(
                "ResolutionImpossible: Cannot install package because these package versions have conflicting dependencies"
            ),
            "依存関係の衝突",
        )
        self.assertEqual(setup._classify_pip_failure("No matching distribution found"), "対応する配布物なし")
        self.assertEqual(
            setup._classify_pip_failure("/usr/bin/python3: No module named pip"),
            "Python/pip起動エラー",
        )
        self.assertEqual(
            setup._sanitize_text("https://user:secret@example.test/pkg.whl?token=secret"),
            "https://example.test/pkg.whl",
        )

    def test_wheel_compatibility_accepts_platform_independent_wheels(self):
        # Most metadata-only dependencies (filelock, typing-extensions, etc.)
        # are published as pure Python wheels and must remain in the CUDA
        # resolver graph on every host platform.
        self.assertTrue(setup._wheel_compatible("filelock-3.19.1-py3-none-any.whl"))
        self.assertTrue(setup._wheel_compatible("typing_extensions-4.15.0-py2.py3-none-any.whl"))

    def test_wheel_compatibility_rejects_foreign_linux_architecture(self):
        python_tag = f"cp{sys.version_info.major}{sys.version_info.minor}"
        self.assertTrue(
            setup._wheel_compatible(
                f"MarkupSafe-3.0.2-{python_tag}-{python_tag}-manylinux_2_17_x86_64.whl"
            )
        )
        self.assertFalse(
            setup._wheel_compatible(
                f"MarkupSafe-3.0.2-{python_tag}-{python_tag}-manylinux_2_17_aarch64.whl"
            )
        )

    def test_wheel_compatibility_decodes_url_encoded_local_version(self):
        python_tag = f"cp{sys.version_info.major}{sys.version_info.minor}"
        filename = (
            "torch-2.10.0%2Bcu128-"
            f"{python_tag}-{python_tag}-manylinux_2_28_x86_64.whl"
        )
        self.assertTrue(setup._wheel_compatible(filename))
        try:
            from pip._vendor.packaging.version import Version
        except ImportError:
            return
        self.assertEqual(setup._candidate_version(filename), Version("2.10.0+cu128"))

    def test_unselected_requirement_extra_marker_is_false(self):
        class _ExtraMarker:
            def __init__(self):
                self.environment = None

            def evaluate(self, environment):
                self.environment = environment
                return environment["extra"] == "optional-feature"

        marker = _ExtraMarker()
        self.assertFalse(
            setup._requirement_marker_matches(marker, {"platform_system": "Linux"})
        )
        self.assertEqual(marker.environment["extra"], "")

    def test_direct_resolver_does_not_fetch_unselected_extra_dependencies(self):
        # The repository's system test Python may intentionally have no pip;
        # the bundled runtime run below exercises this same test with pip 24.
        try:
            import pip  # noqa: F401
        except ImportError:
            self.skipTest("pip vendor packaging is unavailable")

        from unittest.mock import patch

        def fake_link(package: str, digest: str):
            filename = f"{package}-1.0.0-cp312-cp312-manylinux_2_17_x86_64.whl"
            return {
                "filename": filename,
                "url": f"https://example.test/{filename}#sha256={digest * 64}",
                "requires_python": "",
                "metadata": "",
            }

        torch_link = fake_link("torch", "a")
        optree_link = fake_link("optree", "b")
        metadata = {
            torch_link["filename"]: (
                "Metadata-Version: 2.1\n"
                "Name: torch\n"
                "Version: 1.0.0\n"
                "Requires-Dist: optree>=0.1\n"
                "Requires-Dist: MarkupSafe>=1.0\n"
                "Requires-Dist: sphinx>=7; extra == 'docs'\n"
                "Requires-Dist: pytest>=8; extra == 'test'\n"
            ),
            optree_link["filename"]: "Metadata-Version: 2.1\nName: optree\nVersion: 1.0.0\n",
        }
        markupsafe_link = fake_link("MarkupSafe", "c")
        metadata[markupsafe_link["filename"]] = (
            "Metadata-Version: 2.1\nName: MarkupSafe\nVersion: 1.0.0\n"
        )
        links = {"torch": [torch_link], "optree": [optree_link]}
        links["markupsafe"] = [markupsafe_link]
        fetched: list[tuple[str, str]] = []

        def fake_simple(package: str, index_url: str):
            normalized = package.lower()
            fetched.append((normalized, index_url))
            # MarkupSafe is deliberately available only from the generic PyPI
            # path in this fixture; a CUDA mirror must not win first.
            if normalized == "markupsafe" and index_url != setup.PYPI_INDEX:
                return []
            return links.get(normalized, [])

        with patch.object(setup, "_fetch_simple_links", side_effect=fake_simple), patch.object(
            setup,
            "_fetch_wheel_metadata",
            side_effect=lambda link: metadata[link["filename"]],
        ):
            artifacts = setup._resolve_direct_wheels(
                ["torch==1.0.0"],
                primary_index="https://example.test/simple",
                label="test",
            )

        self.assertEqual({Path(item["url"].split("#", 1)[0]).name for item in artifacts}, {
            torch_link["filename"],
            optree_link["filename"],
            markupsafe_link["filename"],
        })
        self.assertNotIn("sphinx", {package for package, _ in fetched})
        self.assertNotIn("pytest", {package for package, _ in fetched})
        markupsafe_queries = [index for package, index in fetched if package == "markupsafe"]
        self.assertEqual(markupsafe_queries[0], setup.PYPI_INDEX)

    def test_sensitive_query_is_not_written_to_checkpoint_metadata(self):
        payload = b"small test wheel"
        _RangeHandler.payload = payload
        _RangeHandler.ranges = []
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _RangeHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with TemporaryDirectory() as temporary:
                destination = Path(temporary) / "small.whl"
                url = f"http://127.0.0.1:{server.server_port}/small.whl?token=secret"
                expected = hashlib.sha256(payload).hexdigest()
                with self.assertRaises(setup.DownloadError):
                    setup._download_url_resumable(
                        url,
                        destination,
                        expected,
                        max_bytes_for_test=1,
                    )
                checkpoint = destination.with_name(destination.name + ".part.json")
                self.assertNotIn("secret", checkpoint.read_text(encoding="utf-8"))
                setup._download_url_resumable(url, destination, expected)
                self.assertEqual(destination.read_bytes(), payload)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_stale_range_416_restarts_from_zero(self):
        payload = b"current upstream object"
        _RangeHandler.payload = payload
        _RangeHandler.ranges = []
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _RangeHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with TemporaryDirectory() as temporary:
                destination = Path(temporary) / "stale.whl"
                url = f"http://127.0.0.1:{server.server_port}/stale.whl"
                expected = hashlib.sha256(payload).hexdigest()
                part = destination.with_name(destination.name + ".part")
                part.write_bytes(payload + b"old bytes")
                setup._write_json_atomic(
                    part.with_name(part.name + ".json"),
                    {
                        "url_key": hashlib.sha256(url.encode("utf-8")).hexdigest(),
                        "expected_sha256": expected,
                        "etag": _RangeHandler.etag,
                    },
                )
                setup._download_url_resumable(url, destination, expected)
                self.assertEqual(destination.read_bytes(), payload)
                self.assertIn(f"bytes={len(payload) + len(b'old bytes')}-", _RangeHandler.ranges)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
