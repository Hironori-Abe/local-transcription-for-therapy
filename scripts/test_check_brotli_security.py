import unittest
from check_brotli_security import is_fixed


class BrotliVersionTests(unittest.TestCase):
    def test_vulnerable_branches(self):
        for version in (0x1000003, 0x1000009, 0x1001000, 0x1002000, 0x2000000):
            with self.subTest(version=version):
                self.assertFalse(is_fixed(version))

    def test_fixed_branches(self):
        for version in (0x100000A, 0x1001001, 0x1002001, 0x1002002, 0x1003000):
            with self.subTest(version=version):
                self.assertTrue(is_fixed(version))
