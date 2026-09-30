# 第三者ライセンス全文（自動収集）

このディレクトリには、配布物に同梱する**第三者依存のフルライセンス本文**を
`scripts/collect_licenses.py` で収集した結果を置く。一覧・帰属の要約は `THIRD_PARTY_LICENSES.md` を参照。

生成ファイル（`*.txt`。`manual/` を除く）は **git 管理外**。
**リリースビルド時に `scripts/setup-build-tools.bat` が再生成する**（下記コマンド）。

## 生成

```bat
python scripts/collect_licenses.py --no-python --frontend frontend --tauri src-tauri --out licenses
```

Python パッケージは同梱しないため `--no-python` を付ける（前回の `python-third-party.txt` が残っていれば削除される）。

出力（`licenses/`）:

| ファイル | 内容 |
| --- | --- |
| `rust-third-party.txt` | `cargo metadata` の依存グラフ＋crate ソースから収集 |
| `node-third-party.txt` | `frontend/package.json` の production 依存クロージャから収集 |
| `THIRD_PARTY_FULL.txt` | 上記＋`manual/` を結合した配布同梱用ファイル |
| `manual/`（**git 管理**） | 手動補完ライセンス |

## 仕組み・注意

- LICENSE ファイルを同梱しない permissive な依存は、宣言された SPDX 識別子
  （MIT / BSD-2 / BSD-3 / ISC / Zlib / 0BSD / Apache-2.0）から標準本文を補完する。
  Apache-2.0 本文はリポジトリ root の `LICENSE` から取得する。
- Node は production 依存のクロージャのみ（devDependencies のビルドツールは配布物に入らないため除外）。
- リリースビルド時に「不明」が `manual/` でカバーされない項目を出していないか確認する。

## 手動補完分（`manual/`・git 管理）

自動収集で本文が取れないものは `licenses/manual/*.txt` に配置する。
`collect_licenses.py` が `THIRD_PARTY_FULL.txt` 末尾の「MANUAL ADDITIONS」節として自動結合する。

- **`Nemotron-3-Diarization-OpenMDW-1.1.txt`**: 話者分離モデル Nemotron-3-Diarization の OpenMDW-1.1。
  セットアップ画面から表示できる（`read_bundled_license`）。
- **`silero-vad-LICENSE.txt`**: Silero VAD（MIT）。
- **`sentencepiece-LICENSE.txt`**: NeMo-Speech.cpp に静的リンクされる sentencepiece（Apache-2.0、Google）。
- **`selectors-MPL-2.0.txt`**: Rust selectors 0.24.0 / 0.36.1（ツリー内唯一の弱コピーレフト）。
  未改変・ソースは crates.io から入手可能である旨をヘッダーに明記。

`--exclude-manual <ファイル名>` で、特定の手動補完ファイルを結合対象から外せる。
