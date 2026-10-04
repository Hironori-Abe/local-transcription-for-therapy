import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from collect_release_artifacts import install_artifact, write_checksums


class ArtifactCollectionTests(unittest.TestCase):
    def test_repeated_collection_leaves_only_the_release_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.deb"
            source.write_bytes(b"release artifact")
            output = root / "dist"
            destination = output / "release.deb"
            install_artifact(source, destination)
            install_artifact(source, destination)
            self.assertEqual(list(output.iterdir()), [destination])
            self.assertEqual(destination.read_bytes(), source.read_bytes())
            lines = write_checksums(output).read_text().splitlines()
            self.assertEqual(len(lines), 1)
            self.assertTrue(lines[0].endswith("  release.deb"))

    def test_copy_fallback_also_cleans_up_the_temporary_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.AppImage"
            source.write_bytes(b"appimage artifact")
            destination = root / "dist/release.AppImage"
            with patch("collect_release_artifacts.os.link", side_effect=OSError("different filesystem")):
                self.assertEqual(install_artifact(source, destination), "copy")
            self.assertEqual(destination.read_bytes(), source.read_bytes())
            self.assertEqual(list(destination.parent.iterdir()), [destination])


if __name__ == "__main__":
    unittest.main()
