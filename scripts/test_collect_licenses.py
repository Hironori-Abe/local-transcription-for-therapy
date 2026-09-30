import unittest
from pathlib import Path

from scripts.collect_licenses import collect_manual


class CollectManualLicensesTest(unittest.TestCase):
    def test_excluded_manual_license_is_omitted_without_dropping_other_licenses(self) -> None:
        manual_dir = Path(__file__).resolve().parent.parent / "licenses" / "manual"
        names = {name for name, _text in collect_manual(manual_dir, {"selectors-MPL-2.0.txt"})}

        self.assertNotIn("selectors-MPL-2.0.txt", names)
        self.assertIn("Nemotron-3-Diarization-OpenMDW-1.1.txt", names)


if __name__ == "__main__":
    unittest.main()
