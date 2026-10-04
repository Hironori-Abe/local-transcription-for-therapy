"""Offline integration checks: python3 scripts/test_setup_ggml_speech_linux.py."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().with_name("setup-ggml-speech-linux.sh")


@unittest.skipUnless(shutil.which("patchelf") and shutil.which("cc"), "requires patchelf and cc")
class FinalizeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="lott-finalize-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.engines = self.root / "engines"
        self.bin = self.engines / "whisper/bin"
        self.bin.mkdir(parents=True)
        self.exe = self.bin / "whisper-cli"
        source = self.root / "probe.c"
        source.write_text("#include <omp.h>\nint main(void) { return omp_get_max_threads() < 1; }\n")
        subprocess.run(["cc", "-fopenmp", str(source), "-o", str(self.exe)], check=True)
        (self.bin / "LICENSE-probe.txt").write_text("Non-ELF files must not be patched.\n")
        (self.bin / "probe-link").symlink_to("whisper-cli")
        self.env = dict(os.environ, XDG_CACHE_HOME=str(self.root / "cache"))

    def run_setup(self, env=None, extra=()):
        return subprocess.run(
            ["/bin/bash", str(SCRIPT), "--backend", "cpu", "--engines-dir", str(self.engines), *extra],
            env=env or self.env, text=True, capture_output=True,
        )

    def test_finalize_and_repeat(self):
        for _ in range(2):
            result = self.run_setup(extra=("--finalize-only", "--skip-nemo"))
            self.assertEqual(result.returncode, 0, result.stderr)
            dynamic = subprocess.check_output(["readelf", "-d", str(self.exe)], text=True)
            self.assertIn("(RUNPATH)", dynamic)
            self.assertIn("[$ORIGIN]", dynamic)
            self.assertTrue((self.bin / "libgomp.so.1").is_file())
            license_text = (self.bin / "LICENSE-libgomp.txt").read_text()
            self.assertIn("Version 3, 29 June 2007", license_text)
            self.assertIn("GCC RUNTIME LIBRARY EXCEPTION", license_text)
            self.assertTrue((self.bin / "probe-link").is_symlink())
            self.assertEqual(subprocess.run([str(self.exe)]).returncode, 0)
            deps = subprocess.check_output(["ldd", str(self.exe)], text=True)
            self.assertIn(str(self.bin / "libgomp.so.1"), deps)

    def test_missing_patchelf_stops_before_build(self):
        tools = self.root / "tools"
        tools.mkdir()
        for name in ("dirname", "nproc"):
            (tools / name).symlink_to(shutil.which(name))
        result = self.run_setup(dict(self.env, PATH=str(tools)))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("patchelf が必要", result.stderr)
        self.assertFalse((self.root / "cache").exists())

    def test_patch_failure_preserves_existing_engine(self):
        original = hashlib.sha256(self.exe.read_bytes()).digest()
        tools = self.root / "tools"
        tools.mkdir()
        patcher = tools / "patchelf"
        patcher.write_text("#!/bin/sh\nexit 1\n")
        patcher.chmod(0o755)
        result = self.run_setup(dict(self.env, PATH=f"{tools}:{self.env['PATH']}"),
                                ("--finalize-only", "--skip-nemo"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("RUNPATH の設定に失敗", result.stderr)
        self.assertEqual(hashlib.sha256(self.exe.read_bytes()).digest(), original)
        self.assertFalse((self.bin / "libgomp.so.1").exists())

    def test_missing_engine_is_an_error(self):
        self.exe.unlink()
        result = self.run_setup(extra=("--finalize-only", "--skip-nemo"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("補修対象のエンジンがありません", result.stderr)


if __name__ == "__main__":
    unittest.main()
