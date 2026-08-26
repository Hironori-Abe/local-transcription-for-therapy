"""Offline tests for the durable Python package downloader."""

from __future__ import annotations

import hashlib
import http.server
import io
import os
import sys
import threading
import unittest
import urllib.request
import zipfile
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


class _WheelMetadataRangeHandler(_RangeHandler):
    def do_HEAD(self):  # noqa: N802 - explicitly exercise GET Range fallback
        self.send_response(405)
        self.end_headers()

    def do_GET(self):  # noqa: N802 - stdlib handler API
        if self.path.split("?", 1)[0].endswith(".whl.metadata"):
            self.send_response(404)
            self.end_headers()
            return
        range_header = self.headers.get("Range", "")
        if range_header.startswith("bytes="):
            start_text, end_text = range_header.removeprefix("bytes=").split("-", 1)
            start = int(start_text)
            end = min(int(end_text), len(self.payload) - 1) if end_text else len(self.payload) - 1
            if start >= len(self.payload) or end < start:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{len(self.payload)}")
                self.end_headers()
                return
            body = self.payload[start : end + 1]
            self.__class__.ranges.append(range_header)
            self.send_response(206)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(self.payload)}")
            self.send_header("ETag", self.etag)
            self.send_header("Last-Modified", "Tue, 01 Jan 2030 00:00:00 GMT")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


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

    def test_pip_environment_puts_selected_venv_before_ambient_pythonpath(self):
        previous_pythonpath = os.environ.get("PYTHONPATH")
        previous_target = os.environ.get("PIP_TARGET")
        try:
            os.environ["PYTHONPATH"] = "/tmp/untrusted-user-packages"
            os.environ.pop("PIP_TARGET", None)
            with TemporaryDirectory() as tmp:
                venv = Path(tmp) / ".venv312-amd"
                executable = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
                executable.parent.mkdir(parents=True)
                (venv / "pyvenv.cfg").write_text("version = 3.12.3\n", encoding="utf-8")

                environment = setup._pip_environment(executable)
                expected = (
                    venv / "Lib/site-packages"
                    if os.name == "nt"
                    else venv / "lib/python3.12/site-packages"
                )
                paths = environment["PYTHONPATH"].split(os.pathsep)
                self.assertEqual(paths[0], str(expected))
                self.assertNotIn("/tmp/untrusted-user-packages", paths)
        finally:
            if previous_pythonpath is None:
                os.environ.pop("PYTHONPATH", None)
            else:
                os.environ["PYTHONPATH"] = previous_pythonpath
            if previous_target is None:
                os.environ.pop("PIP_TARGET", None)
            else:
                os.environ["PIP_TARGET"] = previous_target

    def test_old_pip_upgrade_is_pinned_to_supported_range(self):
        self.assertTrue(setup._pip_requires_upgrade((24, 0, 0)))
        self.assertFalse(setup._pip_requires_upgrade((25, 2, 0)))
        self.assertTrue(setup._pip_requires_upgrade((26, 0, 0)))
        command = setup._pip_upgrade_command(Path("python"))
        self.assertIn("--index-url", command)
        self.assertIn(setup.PYPI_INDEX, command)
        self.assertIn(setup.PIP_UPGRADE_REQUIREMENT, command)
        self.assertNotIn("--resume-retries", command)

    def test_known_amd_rocm_archive_hash_fills_hashless_report(self):
        url = "https://repo.amd.com/rocm/whl-multi-arch/rocm-7.14.0.tar.gz"
        report = {
            "install": [
                {
                    "download_info": {
                        "url": url,
                        "archive_info": {},
                    }
                }
            ]
        }
        artifacts = setup._report_artifacts(report, Path("/tmp/wheelhouse"))
        self.assertEqual(
            artifacts[0]["sha256"],
            "77c622d8eef7bf7fa1af70d410a05a621abbd2baaf53e52ab268dc6d140e15b2",
        )

        unknown = {
            "install": [
                {
                    "download_info": {
                        "url": "https://repo.amd.com/rocm/whl-multi-arch/unknown.tar.gz",
                        "archive_info": {},
                    }
                }
            ]
        }
        self.assertIsNone(setup._report_artifacts(unknown, Path("/tmp/wheelhouse"))[0]["sha256"])

    def test_known_rocm_triton_wheel_hash_fills_hashless_index_link(self):
        link = {
            "url": "https://download-r2.pytorch.org/whl/"
            "triton_rocm-3.6.0-cp312-cp312-linux_x86_64.whl",
            "filename": "triton_rocm-3.6.0-cp312-cp312-linux_x86_64.whl",
        }
        self.assertEqual(
            setup._wheel_hash(link),
            "cff15082784c7056b0af9347770e034ab0a8ccbce0642723ddc8c8de1bd6af3f",
        )

    def test_setup_requires_python312_before_wheel_resolution(self):
        setup._validate_python_version((3, 12, 8))
        with self.assertRaisesRegex(
            setup.DownloadError,
            r"Python 3\.12.*Python 3\.14.*\.venv312",
        ):
            setup._validate_python_version((3, 14, 7))

    def test_rocm_triton_cp312_wheel_is_not_accepted_by_python314(self):
        # The official ROCm 7.2 index currently has triton_rocm 3.6.0 only as
        # cp312 on Linux.  Python 3.14 must fail the interpreter contract
        # instead of surfacing the lower-level hashless-candidate message.
        filename = "triton_rocm-3.6.0-cp312-cp312-linux_x86_64.whl"
        running_python312 = tuple(sys.version_info[:2]) == setup.SUPPORTED_PYTHON_VERSION
        self.assertEqual(setup._wheel_compatible(filename), running_python312)
        with self.assertRaises(setup.DownloadError):
            setup._validate_python_version((3, 14, 7))

    def test_windows_rocm_build_dependency_is_version_bounded(self):
        self.assertEqual(
            setup.ROCM_WINDOWS_BUILD_REQUIREMENTS,
            ("setuptools>=70.2.0,<82",),
        )

    def test_missing_pep658_metadata_reads_only_remote_wheel_metadata(self):
        metadata = (
            "Metadata-Version: 2.1\n"
            "Name: torch\n"
            "Version: 2.11.0\n"
            "Requires-Dist: pytorch-triton-rocm==3.3.0\n"
        ).encode("utf-8")
        wheel_buffer = io.BytesIO()
        with zipfile.ZipFile(wheel_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            # Keep the object larger than one Range block so the test proves
            # central-directory + METADATA reads do not fetch the whole wheel.
            archive.writestr("torch/payload.bin", os.urandom(2 * 1024 * 1024), zipfile.ZIP_STORED)
            archive.writestr("torch-2.11.0.dist-info/METADATA", metadata)
        payload = wheel_buffer.getvalue()
        _WheelMetadataRangeHandler.payload = payload
        _WheelMetadataRangeHandler.ranges = []
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _WheelMetadataRangeHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f"http://127.0.0.1:{server.server_port}/torch-2.11.0.whl"
            link = {
                "url": url + "#sha256=" + hashlib.sha256(payload).hexdigest(),
                "filename": "torch-2.11.0.whl",
                "metadata": "",
            }
            # The local test server is HTTP-only; patch the reader URL guard
            # at the request boundary while preserving the HTTPS policy in
            # production and exercising the complete Range/ZIP path.
            original_reader_init = setup._HTTPRangeReader.__init__
            original_urlopen = setup.urllib.request.urlopen

            def local_reader_init(reader, reader_url, **kwargs):
                return original_reader_init(reader, reader_url.replace("http://", "https://", 1), **kwargs)

            def local_urlopen(request, *args, **kwargs):
                if isinstance(request, urllib.request.Request) and request.full_url.startswith("https://127.0.0.1:"):
                    request = urllib.request.Request(
                        request.full_url.replace("https://", "http://", 1),
                        headers=dict(request.header_items()),
                        method=request.get_method(),
                    )
                return original_urlopen(request, *args, **kwargs)

            from unittest.mock import patch

            with patch.object(setup._HTTPRangeReader, "__init__", local_reader_init), patch.object(
                setup.urllib.request, "urlopen", side_effect=local_urlopen
            ):
                result = setup._fetch_wheel_metadata(link)
            self.assertIn("Requires-Dist: pytorch-triton-rocm==3.3.0", result)
            requested = sum(
                int(item.split("=", 1)[1].split("-", 1)[1])
                - int(item.split("=", 1)[1].split("-", 1)[0])
                + 1
                for item in _WheelMetadataRangeHandler.ranges
                if item.startswith("bytes=")
            )
            self.assertLess(requested, len(payload))
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_rocm_triton_uses_backend_index_before_pypi(self):
        candidates = setup._index_candidates_for_package(
            "pytorch-triton-rocm", setup.PYTORCH_ROCM_INDEX
        )
        self.assertEqual(candidates[0], setup.PYTORCH_ROCM_INDEX)
        self.assertEqual(
            setup._index_candidates_for_package("MarkupSafe", setup.PYTORCH_ROCM_INDEX),
            [setup.PYPI_INDEX],
        )

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
