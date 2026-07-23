# Third-Party Licenses / 第三者ライセンス表示（NOTICES）

本ファイルは Local Transcription for Therapy (LoTT) が**同梱・依存・配布する第三者ソフトウェアおよびモデル**の
ライセンス表示（attribution / NOTICE）をまとめたものです。配布物（NSIS インストーラー）に
同梱し、アプリ内からも参照できるようにすることを想定しています。

> 主要項目（F章の4点・手動補完ライセンス）は確認・対応済み（2026-06-12）。
> 依存やバージョンを更新した場合は、該当行とチェックリストを再確認すること。
> 本ファイルは法的助言ではありません。

最終更新: 2026-07-09

---

## 0. アプリ本体のライセンス

- アプリ本体は **Apache License 2.0** として配布します。
- ライセンス本文はリポジトリルートの `LICENSE`、主要な帰属表示は `NOTICE` に記載しています。
- 配布ビルドでは `LICENSE` / `NOTICE` / `THIRD_PARTY_LICENSES.md` / `licenses/` を Tauri resources として同梱します。

---

## A. 同梱バイナリ（インストーラーに同梱して配布）

| コンポーネント | 用途 | ライセンス | 義務 / 注意 |
|---|---|---|---|
| **Python 3.12 embeddable** (`resources/python312/`) | Python ランタイム | PSF License Agreement | ライセンス本文の同梱（`LICENSE.txt` 同梱済み） |
| **llama.cpp** (`resources/llama-server/` の `llama-server.exe`, `ggml*.dll`, `llama*.dll` 等) | LLM 推論サーバー | **MIT** (ggml-org/llama.cpp) | 著作権表示＋MIT本文の同梱 |
| ✅ **FFmpeg CLI** (`resources/ffmpeg/ffmpeg(.exe)`) | 音声デコード / WAV 変換 | **LGPL-3.0（BtbN `lgpl` build / `--enable-version3`）** | Windows NSIS で同梱確認済み。`--enable-gpl` / `--enable-nonfree` / GPL 系 encoder なし。`LICENSE.txt`、対応ソース入手手段、`FFMPEG_BUILD_INFO.txt` を同梱 |
| ✅ **NVIDIA CUDA 再頒布 DLL** (`cublas64_12.dll`, `cublasLt64_12.dll`, `cudart64_12.dll` — CUDA 12.4 / llama.cpp 公式ビルド由来) | CUDA 実行時 | **NVIDIA CUDA Toolkit EULA（再頒布可能サブセット）** | Attachment A 収録確認済み。EULA 本文＋Attachment B（cuBLAS 第三者帰属）を `licenses/manual/NVIDIA-CUDA-Toolkit-EULA-12.4.txt` として同梱（F-3） |

> Lemonade SDK / lemond は現在の配布物には同梱しません。`%LOCALAPPDATA%\{app-id}\lemonade\` というディレクトリ名は後方互換のキャッシュ名として残る場合がありますが、中身はダウンロード済み llama.cpp バックエンドや設定ファイルです。

---

## B. Python ランタイム依存（`requirements-runtime.txt` 等で導入・venv 同梱 or ポストインストール）

| パッケージ | ライセンス | 義務 / 注意 |
|---|---|---|
| faster-whisper | MIT (SYSTRAN) | 著作権＋本文同梱 |
| ctranslate2 | MIT (SYSTRAN) | 著作権＋本文同梱 |
| torch / torchaudio | BSD-3-Clause (+ NOTICE 同梱要) | NOTICE ファイルの保持 |
| transformers | Apache-2.0 | NOTICE 保持 |
| pyannote.audio (コード) | MIT | 著作権＋本文同梱（※モデルは別、E章参照） |
| speechbrain | Apache-2.0 | NOTICE 保持 |
| huggingface-hub | Apache-2.0 | NOTICE 保持 |
| numpy / scipy 系 | BSD-3-Clause | 著作権＋本文同梱 |
| sudachipy / sudachidict_core | Apache-2.0 | NOTICE 保持 |
| neologdn | Apache-2.0（0.5.6 の dist-info で LICENSE 同梱を確認済み） | NOTICE 保持 |
| msoffcrypto-tool | MIT | 著作権＋本文同梱 |
| pyzipper | MIT | 著作権＋本文同梱 |
| sympy | BSD-3-Clause | 著作権＋本文同梱 |
| protobuf | BSD-3-Clause | 著作権＋本文同梱 |
| llama-cpp-python（任意の direct Python backend 検証時のみ別途ビルド） | MIT | 同梱・配布する場合は著作権＋本文同梱 |

> venv 内の各パッケージは `*.dist-info/` に `LICENSE` を保持しています。これらを束ねて配布物に含めるのが確実です（自動収集スクリプトは後述）。
> 配布用 Python 環境には `av`（PyAV）と `imageio-ffmpeg` を入れません。`faster-whisper` は `--no-deps` で導入し、音声デコードは同梱 LGPL FFmpeg CLI で行います（F-4）。

---

## C. フロントエンド（Angular バンドルとしてアプリに静的同梱）

| パッケージ | ライセンス | 義務 / 注意 |
|---|---|---|
| @angular/* (core, material, cdk, cdk-experimental ほか) | MIT | 著作権＋本文同梱 |
| rxjs | Apache-2.0 | NOTICE 保持 |
| zone.js | MIT | 著作権＋本文同梱 |
| tslib | 0BSD | 表示義務ほぼ無し（任意で記載） |
| @tauri-apps/api, @tauri-apps/plugin-dialog | MIT / Apache-2.0 | 著作権＋本文同梱 |
| **@fontsource/material-symbols-outlined**（Google Material Symbols フォント） | フォント: **Apache-2.0**（パッケージング: MIT） | フォントの Apache-2.0 表示を NOTICE に記載 |

---

## D. Rust / Tauri（コンパイルしてバイナリに静的リンク）

| クレート | ライセンス | 義務 / 注意 |
|---|---|---|
| tauri / tauri-plugin-dialog / tauri-build | MIT / Apache-2.0 | 著作権＋本文同梱 |
| serde / serde_json | MIT / Apache-2.0 | 著作権＋本文同梱 |
| zip | MIT | 著作権＋本文同梱 |
| base64 / encoding_rs / regex | MIT / Apache-2.0 | 著作権＋本文同梱 |
| windows-sys | MIT / Apache-2.0 | 著作権＋本文同梱 |

> `cargo about` で Rust 依存の全ライセンスを機械生成できます（後述）。

---

## E. モデル（ポストインストールでダウンロード／ローカル配置）

| モデル | ライセンス | 義務 / 注意 |
|---|---|---|
| 🔴 **pyannote speaker-diarization-community-1** | **CC-BY-4.0** | **帰属表示が必須**。作者クレジット＋ライセンスへのリンク＋（改変した場合）変更の明示。アプリの About / NOTICE に記載 |
| **Whisper turbo**（faster-whisper / Systran 変換版） | MIT（OpenAI Whisper 由来） | 著作権＋本文同梱 |
| **Gemma 4 E4B GGUF**（`unsloth/gemma-4-E4B-it-qat-GGUF`） | ✅ **Apache-2.0**（Gemma 4 は旧 Gemma Terms / 禁止用途ポリシー非適用。確認済み） | Google DeepMind ＋ Unsloth を Apache-2.0 として帰属表示（F-2 参照） |

---

## F. 🔴 特別な注意が必要な4点（配布前に必ず確認）

### F-1. pyannote community-1 — CC-BY-4.0（帰属義務）
- **必須対応**: アプリ内 About 画面または NOTICE に以下を記載。
  - モデル名・作者（pyannote / Hervé Bredin ほか）
  - CC-BY-4.0 ライセンスへのリンク
  - モデルを改変・再学習した場合はその旨（本プロジェクトは推論利用のみなら「改変なし」）
- これは**最も確実に対処すべき**項目。表示するだけで義務を満たせます。

### F-2. Gemma — ✅ **Apache-2.0 と確認。禁止用途ポリシーは非適用（2026-06-01 調査）**

調査結果:
- 本アプリが取得・案内するモデルは `download_gemma_gguf_cli.py` の **`unsloth/gemma-4-E4B-it-qat-GGUF`**（`gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf`）。
- 当該 HF リポジトリのライセンスタグは **`apache-2.0`**（`https://ai.google.dev/gemma/docs/gemma_4_license` を参照）。著者は Google DeepMind。
- Google の Gemma 利用規約ページが明言: **「Gemma 4 は（旧）Gemma Terms of Use の対象外。Gemma 4 は Apache 2.0」**。**Prohibited Use Policy（禁止用途ポリシー）は Gemma 1 / 2 / 3 / 3n に適用され、Gemma 4 には適用されない**。
- 帰結: **Gemma 4 E4B は純粋に Apache-2.0**。Apache-2.0 は利用分野（field-of-use）の制限を持たないため、**臨床心理・カウンセリング用途に制限はかからない**。フロント About の「Apache-2.0」表記は正しい。

残対応（軽微・帰属のみ）:
1. NOTICE / About に **Google DeepMind（原モデル）＋ Unsloth（GGUF 量子化）** を Apache-2.0 として明記（対応済み: NOTICE 更新）。
2. （任意・保険）`gemma_4_license` ページを一度通読し、純 Apache-2.0 であることを最終確認。
3. ⚠️ 注意: 旧 Gemma（1/2/3/3n）モデルに切り替える場合は禁止用途ポリシーが復活するため、**Gemma 4 系に固定**しておくのが安全。

### F-3. NVIDIA CUDA 再頒布 DLL — ✅ **再頒布可能と確認。第三者帰属が必要（2026-06-01 調査）**

調査結果:
- 同梱: `cudart64_12.dll`（CUDA Runtime）/ `cublas64_12.dll` / `cublasLt64_12.dll`（cuBLAS）。
- NVIDIA Full CUDA版の llama.cpp は公式リリース **b10075** の `llama-b10075-bin-win-cuda-12.4-x64.zip`（SHA-256 `acb782eb7d82b7aefaab4ea4f92f84793d11fdddacf888299ef3af9a63054744`）と `cudart-llama-bin-win-cuda-12.4-x64.zip`（SHA-256 `8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6`）から配置する。Editor版・CPU版のCPUバックエンドも同じ公式リリースの `llama-b10075-bin-win-cpu-x64.zip`（SHA-256 `67ccd320365193e5fa5e2778773a30ee3fc19802b2a9f324023641d160a1e802`）を取得する。AMD版のダウンロード型ROCm / Vulkanバックエンドはb9631のまま別管理とする。
- CUDA Toolkit EULA の **Attachment A（再頒布可能ファイル一覧）に cudart・cublas・cublasLt はすべて収録**。→ 同梱・再頒布は許可される。
- ただし cuBLAS には EULA **Attachment B** の **第三者 BSD 系帰属表示**が必要。代表例:
  - UC Regents（Vasily Volkov 由来コード）: `Copyright (c) 2007-2009, Regents of the University of California. All rights reserved.` ＋ BSD 系条件・免責。
  - 他に Davide Barbieri、University of Tennessee、Jonathan Hogg（STFC）等の各 BSD 系表示。
- **必須対応**:
  1. ✅ EULA 本文＋ Attachment A/B を `licenses/manual/NVIDIA-CUDA-Toolkit-EULA-12.4.txt` として同梱（2026-06-12 対応。出典: `docs.nvidia.com/cuda/archive/12.4.1/eula/`。同梱 DLL は llama.cpp 公式ビルド付属の CUDA 12.4 由来）。
  2. ✅ NOTICE に「NVIDIA CUDA ランタイムライブラリを CUDA Toolkit EULA に基づき再頒布」「cuBLAS は UC Regents ほかの第三者 BSD 表示を含む」と記載（対応済み: NOTICE 更新）。
  3. CUDA バージョン更新時（`scripts/setup-dev.bat` の `LLAMA_CUDA_ZIP` の CUDA 版数変更時）は、対応するアーカイブ版 EULA へ差し替え、Attachment A/B の収録・文言を再確認。

### F-4. ffmpeg / PyAV 非依存化 — ✅ **Windows NSIS 検証済み（2026-06-02）**

調査結果:

| 経路 | 使用箇所 | パッケージ自体 | 実バイナリ | リンク形態 |
|---|---|---|---|---|
| **imageio-ffmpeg 0.6.0** | `diarize_cli.py` の `resolve_ffmpeg_bin()` → ffmpeg CLI で WAV 変換 | BSD-2-Clause | `ffmpeg-win-x86_64-v7.1.exe`（gyan.dev essentials, **`--enable-gpl --enable-version3`** + libx264/x265）= **GPLv3** | **サブプロセス呼び出し**（別プロセス実行） |
| **PyAV (av 17.0.0)** | `transcribe_cli.py` の音声前処理 ＋ **faster-whisper 内部のデコード** | BSD-3-Clause | `av.libs/` に **libx264 / libx265 同梱** = ffmpeg は **GPL ビルド** | **動的リンク**（C 拡張がライブラリにリンク） |

ポイント:
- **パッケージのライセンス（BSD）≠ 同梱 ffmpeg バイナリのライセンス（GPL）**。混同に注意。
- 本アプリが ffmpeg に求めるのは**音声デコード／WAV 変換のみ**で、GPL を強制する libx264/libx265（動画エンコーダ）は**不要**。→ **LGPL ビルドで完全に代替可能**。

採用方針:
- **配布用 Python 環境に `av` と `imageio-ffmpeg` を入れない**。
- `faster-whisper` は `--no-deps` で導入し、`av` を依存解決で入れない。
- `faster-whisper` のトップレベル `import av` は、`transcribe_cli.py` の最小 stub で import だけ通す。
- 実際の音声デコードは、同梱または PATH 上の **LGPL 構成 `ffmpeg` CLI** で行い、numpy 配列として `WhisperModel.transcribe()` に渡す。
- `diarize_cli.py` の `imageio-ffmpeg` フォールバックは既定で無効。開発時に必要な場合だけ `ALLOW_GPL_FFMPEG=1` で明示許可する。

実装状況:
- ✅ `transcribe_cli.py`: 既定 backend を `ffmpeg` に変更。`--audio-decode-backend pyav` は開発・比較用。
- ✅ `setup_venv_cli.py` / dev scripts: `av` / `imageio-ffmpeg` を削除し、`faster-whisper` を `--no-deps` で導入。
- ✅ `requirements-runtime.txt` / `requirements-amd.txt`: `faster-whisper` 実行依存を明示し、`av` / `imageio-ffmpeg` を追加禁止。
- ✅ `diarize_cli.py`: `imageio-ffmpeg` は明示許可時のみ。
- ✅ Tauri: 同梱 LGPL ffmpeg があれば `FFMPEG_BIN` として Python サイドカーへ渡す。
- ✅ `scripts/setup_ffmpeg_lgpl.py`: BtbN `lgpl` build を取得し、`--enable-gpl` / GPL 系ライブラリの混入を検査する。
- ✅ Windows: `resources/ffmpeg/ffmpeg.exe`、`LICENSE.txt`、`FFMPEG_BUILD_INFO.txt` を生成し、NSIS インストール後の配置まで確認済み。
- 🟡 残: Linux 配布ライン用の `resources/ffmpeg/ffmpeg` 生成と実機検証。

Windows 同梱 FFmpeg の記録:
- 取得元: `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip`
- build project: `https://github.com/BtbN/FFmpeg-Builds`
- FFmpeg source: `https://github.com/FFmpeg/FFmpeg`
- version: `N-124724-g6f1de91492-20260601`
- `FFMPEG_BUILD_INFO.txt` に download URL、SHA-256、`ffmpeg -version` / configure 行を記録済み。
- configure 行は `--enable-version3` を含むため LGPLv3 として扱う。`--enable-gpl` は含まず、`--disable-libx264` / `--disable-libx265` / `--disable-libxvid` を確認済み。

検証観点:
- `python -m pip show av imageio-ffmpeg` が見つからないこと。
- `site-packages` に `av/`、`av.libs/`、`imageio_ffmpeg/` が残っていないこと。
- `python_sidecar/transcribe_cli.py` が既定 `ffmpeg` backend で 3分・10分音声を完走すること。
- `ffmpeg -version` に `--enable-gpl`、`--enable-libx264`、`--enable-libx265`、`--enable-libxvid` が含まれないこと。
- 詳細手順: `docs/lgpl-pyav-build.md`。

---

## 配布物への組み込み（推奨フロー）

1. `LICENSE` / `NOTICE` / `THIRD_PARTY_LICENSES.md` / `licenses/` を**インストーラーに同梱**（Tauri resources に追加済み）
2. アプリの **About / 設定タブに「ライセンス表示」項目**を表示し、本ファイル（または各ライセンス本文）を参照できるようにする
3. 各依存の**フルライセンス本文**を機械的に収集して結合（下記コマンド）
   - Rust: `cargo install cargo-about && cargo about generate about.hbs > rust-licenses.html`
   - Python: 各 `.venv*/Lib/site-packages/*.dist-info/LICENSE*` を結合（`pip-licenses` でも可）
   - Node: `npx license-checker --production --out frontend-licenses.txt`
4. F章の4項目を個別に確認・記載

2026-06-12 時点の自動収集結果:
- `scripts/collect_licenses.py --venv .venv312 --frontend frontend --tauri src-tauri --out licenses` を実行済み。
- 生成物: `licenses/python-third-party.txt`、`licenses/rust-third-party.txt`、`licenses/node-third-party.txt`、`licenses/THIRD_PARTY_FULL.txt`。
- 収集サマリ: Python 127 本文 / 0 不明、Rust 478 本文 / 2 不明、Node 19 本文 / 0 不明、手動補完 4 本文。
- ✅ 手動補完は `licenses/manual/`（git 管理）に配置済み: `pywin32`、`sentencepiece`（Apache-2.0）、Rust `selectors` 0.24.0 / 0.36.1（MPL-2.0）、NVIDIA CUDA EULA。`collect_licenses.py` が `THIRD_PARTY_FULL.txt` へ自動結合する。
- リリースビルド時は Windows release venv で再生成し、「不明」に新規項目が出ていないか確認する（`nvidia-*-cu12` 系の dist-info 外 LICENSE は RECORD フォールバックで自動収集される）。

---

## チェックリスト（配布前）

- [x] アプリ本体の `LICENSE` を決定・追加（Apache-2.0 / 著作権=合同会社学幸社）
- [x] pyannote community-1 の CC-BY 帰属を About に表示（F-1）
- [x] Gemma の正確なライセンス／禁止用途ポリシーを確認（F-2: Gemma 4 = Apache-2.0、禁止用途ポリシー非適用）
- [x] CUDA 再頒布 DLL が EULA の再頒布可能リストに含まれることを確認（F-3: Attachment A 収録。cuBLAS の第三者帰属が必要）
- [x] CUDA EULA 本文＋ Attachment B（cuBLAS 第三者通知）を配布物に同梱（F-3: `licenses/manual/NVIDIA-CUDA-Toolkit-EULA-12.4.txt`）
- [x] 同梱 ffmpeg を LGPL ビルドへ差し替え、`av` / `imageio-ffmpeg` 不在を確認（F-4: Windows NSIS）
- [x] 各依存のフルライセンス本文を収集・同梱（自動収集＋ `licenses/manual/` で pywin32 / sentencepiece / selectors / CUDA EULA を補完）
- [ ] リリースビルド時に Windows release venv で `collect_licenses.py` を再生成し、「不明」ゼロ（または manual/ でカバー済み）を確認
- [x] 本ファイルと `licenses/` をインストーラー同梱物に追加（Tauri resources）
