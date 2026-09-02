"""校正サイドカーの Base URL 検証がループバック境界を守っているかを確認する。

Rust 側（validate_local_openai_base_url / resolve_loopback_socket_addr）と対になる、
サイドカー単体でのプライバシー境界のテスト。会話データの送信先がこの検証を通るため、
`localhost` の実接続先固定と、ループバック以外の拒否が崩れていないことを担保する。
"""

import unittest

from python_sidecar import overall_proofread_cli, proofread_llm_cli

_MODULES = (
    ("proofread_llm_cli", proofread_llm_cli),
    ("overall_proofread_cli", overall_proofread_cli),
)


class NormalizeLocalOpenAiBaseUrlTest(unittest.TestCase):
    def test_localhost_is_rewritten_to_literal_loopback(self) -> None:
        # hosts ファイルで localhost が別ホストへ向けられていても、実接続先は動かさない。
        for name, module in _MODULES:
            with self.subTest(module=name):
                normalize = module._normalize_local_openai_base_url
                self.assertEqual(
                    normalize("http://localhost:1234/v1"), "http://127.0.0.1:1234/v1"
                )
                self.assertEqual(normalize("http://localhost:1234"), "http://127.0.0.1:1234")
                self.assertEqual(normalize("http://localhost/v1"), "http://127.0.0.1/v1")

    def test_loopback_literals_are_preserved(self) -> None:
        for name, module in _MODULES:
            with self.subTest(module=name):
                normalize = module._normalize_local_openai_base_url
                for url in (
                    "http://127.0.0.1:1234/v1",
                    "http://127.5.5.5:8080",
                    "http://[::1]:1234/v1",
                ):
                    self.assertEqual(normalize(url), url)

    def test_non_loopback_and_malformed_urls_are_rejected(self) -> None:
        for name, module in _MODULES:
            with self.subTest(module=name):
                normalize = module._normalize_local_openai_base_url
                for url in (
                    "",
                    "http://example.com/v1",
                    "http://127.0.0.1.example.com/v1",
                    "https://localhost:1234/v1",
                    "http://127.0.0.1:1234/v1?leak=secret",
                    "http://127.0.0.1:1234/v1#leak",
                ):
                    with self.assertRaises(RuntimeError, msg=url):
                        normalize(url)


if __name__ == "__main__":
    unittest.main()
