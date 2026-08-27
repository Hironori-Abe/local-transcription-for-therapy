import os
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from python_sidecar import transcribe_cli


class WindowsRocmDllSearchTests(unittest.TestCase):
    def test_candidates_accept_current_and_legacy_rocm_library_layouts(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            expected = [
                root / "_rocm_sdk_core" / "bin",
                root / "_rocm_sdk_libraries" / "bin",
                root / "_rocm_sdk_libraries_custom" / "bin",
            ]
            for directory in expected:
                directory.mkdir(parents=True)

            self.assertEqual(
                transcribe_cli.windows_rocm_dll_directory_candidates([root, root]),
                expected,
            )

    @unittest.skipUnless(os.name == "nt", "Windows DLL registration only")
    def test_rocm_backend_registers_existing_dll_directories_and_keeps_handles(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            core = root / "_rocm_sdk_core" / "bin"
            libraries = root / "_rocm_sdk_libraries" / "bin"
            core.mkdir(parents=True)
            libraries.mkdir(parents=True)
            handles = []

            def fake_add_dll_directory(path: str):
                handle = object()
                handles.append((path, handle))
                return handle

            original_handles = transcribe_cli._WINDOWS_ROCM_DLL_DIRECTORY_HANDLES
            original_keys = transcribe_cli._WINDOWS_ROCM_DLL_DIRECTORY_KEYS
            transcribe_cli._WINDOWS_ROCM_DLL_DIRECTORY_HANDLES = []
            transcribe_cli._WINDOWS_ROCM_DLL_DIRECTORY_KEYS = set()
            try:
                with patch.dict(os.environ, {"LOTT_TORCH_BACKEND": "rocm"}), patch.object(
                    sys, "path", [str(root)]
                ), patch.object(os, "add_dll_directory", side_effect=fake_add_dll_directory):
                    added = transcribe_cli.configure_windows_rocm_dll_search()
                    added_again = transcribe_cli.configure_windows_rocm_dll_search()

                self.assertEqual(added, [str(core), str(libraries)])
                self.assertEqual(added_again, [])
                self.assertEqual([item[0] for item in handles], added)
                self.assertEqual(
                    len(transcribe_cli._WINDOWS_ROCM_DLL_DIRECTORY_HANDLES), 2
                )
            finally:
                transcribe_cli._WINDOWS_ROCM_DLL_DIRECTORY_HANDLES = original_handles
                transcribe_cli._WINDOWS_ROCM_DLL_DIRECTORY_KEYS = original_keys

    def test_non_rocm_backend_does_not_register_rocm_directories(self):
        with patch.dict(os.environ, {"LOTT_TORCH_BACKEND": "cuda"}):
            self.assertEqual(transcribe_cli.configure_windows_rocm_dll_search(), [])


if __name__ == "__main__":
    unittest.main()
