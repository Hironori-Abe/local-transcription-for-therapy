# 第三者ライセンス全文（自動収集）

このディレクトリには、配布物に同梱する**第三者依存のフルライセンス本文**を
`scripts/collect_licenses.py` で自動収集した結果を置く。

生成ファイル（`*.txt`）は **git 管理外**（`.gitignore` 済み）。
**ビルド/パッケージング時に、実際に配布する venv に対して再生成する**こと。

## 生成

```bat
python scripts/collect_licenses.py
```

出力（`licenses/`）:

| ファイル | 内容 |
| --- | --- |
| `python-third-party.txt` | venv の `*.dist-info` から収集した Python 依存のライセンス本文 |
| `rust-third-party.txt` | `cargo metadata` の依存グラフ＋crate ソースから収集 |
| `node-third-party.txt` | `frontend/package.json` の production 依存クロージャから収集 |
| `THIRD_PARTY_FULL.txt` | 上記＋`manual/` を結合した配布同梱用ファイル |
| `manual/`（**git 管理**） | 手動補完ライセンス。CUDA EULA / pywin32 / sentencepiece / selectors (MPL-2.0) |

オプション: `--venv .venv312 --frontend frontend --tauri src-tauri --out licenses`

## 仕組み・注意

- LICENSE ファイルを同梱しない permissive パッケージは、宣言された SPDX 識別子
  （MIT / BSD-2 / BSD-3 / ISC / Zlib / 0BSD / Apache-2.0）から標準本文を補完する。
  Apache-2.0 本文はリポジトリ root の `LICENSE` から取得する。
- **release venv で再生成すること**。dev の `.venv312` とはパッケージ集合が微妙に異なる。
- Node は production 依存のクロージャのみ（devDependencies のビルドツールは配布物に入らないため除外）。

## 手動補完分（`manual/`・git 管理・✅ 2026-06-12 対応済み）

自動収集で本文が取れないものは `licenses/manual/*.txt` に出典ヘッダー付きで配置済み。
`collect_licenses.py` が `THIRD_PARTY_FULL.txt` 末尾の「MANUAL ADDITIONS」節として自動結合する。

- **`NVIDIA-CUDA-Toolkit-EULA-12.4.txt`**: 同梱 CUDA ランタイム DLL（cudart / cublas / cublasLt、
  llama.cpp 公式ビルド同梱の CUDA 12.4 由来）の再頒布条件。Attachment A（再頒布可能ファイル一覧）と
  Attachment B（cuBLAS の第三者 BSD 帰属表示）を含む。CUDA バージョン更新時は対応するアーカイブ版へ差し替える。
- **`selectors-MPL-2.0.txt`**: Rust selectors 0.24.0 / 0.36.1（ツリー内唯一の弱コピーレフト）。
  未改変・ソースは crates.io から入手可能である旨をヘッダーに明記。
- **`pywin32-LICENSE.txt`**: Windows リリース venv 用（Mark Hammond の BSD 系ライセンス）。
- **`sentencepiece-LICENSE.txt`**: ホイールはメタデータ未宣言だが実体は **Apache-2.0**（Google）。

また `nvidia-*-cu12` 系ホイール（例: nvidia-cusparselt-cu12）が `dist-info` 外に置く LICENSE は、
`RECORD` 経由のフォールバックで自動収集するよう対応済み。

2026-06-12 の再生成結果（Linux dev venv）:

```text
PYTHON DEPENDENCIES: 127 本文 / 0 不明
RUST CRATES: 478 本文 / 2 不明（selectors ×2 → MANUAL ADDITIONS で補完）
NODE (frontend production) DEPENDENCIES: 19 本文 / 0 不明
MANUAL ADDITIONS: 4 本文
```

`av` / `imageio-ffmpeg` は配布想定 `.venv312` から除去済みのため、自動収集結果にも含まれない。
**リリース時は Windows release venv で再生成し、「不明」が manual/ でカバーされない項目を出していないか確認する。**

## 配布物への同梱

`THIRD_PARTY_FULL.txt`（または各 `*-third-party.txt`）をインストーラーに同梱し、
アプリの About / ライセンス表示からも参照できるようにする（`THIRD_PARTY_LICENSES.md` の要約と対で扱う）。
Tauri resources には `../licenses` を含める。生成ファイルは git 管理外なので、リリースビルド前に必ず再生成する。
