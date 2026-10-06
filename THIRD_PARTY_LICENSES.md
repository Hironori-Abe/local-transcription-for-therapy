# Third-Party Licenses / 第三者ライセンス表示（NOTICES）

本ファイルは Local Transcription for Therapy (LoTT) が**同梱・依存・配布する第三者ソフトウェアおよびモデル**の
ライセンス表示（attribution / NOTICE）をまとめたものです。配布物（NSIS インストーラー）に同梱し、
アプリ内からも参照できるようにすることを想定しています。

> 現行の配布は Full 版（Vulkan）と Editor 版です（Windows と Linux の deb / AppImage。Linux は未検証）。
> CUDA / AMD / CPU 版、Python サイドカー、LLM（llama.cpp / Gemma）は削除済みで、配布物に含みません。
> 依存やバージョンを更新した場合は、該当行とチェックリストを再確認すること。
> 本ファイルは法的助言ではありません。

最終更新: 2026-09-29

---

## 0. アプリ本体のライセンス

- アプリ本体は **Apache License 2.0** として配布します。
- ライセンス本文はリポジトリルートの `LICENSE`、主要な帰属表示は `NOTICE` に記載しています。
- 配布ビルドでは `LICENSE` / `NOTICE` / `THIRD_PARTY_LICENSES.md` / `licenses/` を Tauri resources として同梱します。

---

## A. 同梱バイナリ（インストーラーに同梱して配布）

| コンポーネント | 用途 | ライセンス | 義務 / 注意 |
|---|---|---|---|
| **whisper.cpp / ggml**（`resources/speech-engines/whisper/`。Full 版・Editor 版） | 文字起こし | **MIT** (ggml-org/whisper.cpp) | 固定 commit のソースビルド（Vulkan 版）。`LICENSE-whisper.cpp.txt` を同梱 |
| **NeMo-Speech.cpp**（`resources/speech-engines/nemo/`。Full 版のみ） | 話者分離 | **Apache-2.0**（NVIDIA 著作分）＋ sentencepiece（Apache-2.0、静的リンク） | 固定 commit のソースビルド（Vulkan 版）。`LICENSE` / `NOTICE` / `THIRD_PARTY_NOTICES.md` を同梱。sentencepiece は `licenses/manual/sentencepiece-LICENSE.txt` |
| **Vulkan Loader**（`resources/speech-engines/vulkan-loader/vulkan-1.dll`（Windows）/ `libvulkan.so.1`（Linux）） | GPU ドライバー・ローダーが無い PC で ggml エンジンを CPU 実行で起動するためのローダー | **Apache-2.0**（Khronos Group / LunarG。Windows は LunarG Vulkan Runtime 再頒布物、Linux は Ubuntu 24.04 の `libvulkan1` パッケージの実体） | `LICENSE-Vulkan-Loader.txt`（Linux は `/usr/share/doc/libvulkan1/copyright`）と `BUILD_INFO.txt`（版・取得元）を同梱。Windows は System32 に `vulkan-1.dll` が無い場合だけ PATH 経由、Linux はホストに `libvulkan.so.1` が無い場合だけ `LD_LIBRARY_PATH` 経由で使う（エンジンの隣には置かない） |
| **Microsoft VC++ ランタイム**（各エンジン実行ファイルの隣） | C/C++ 実行時 | Visual Studio の再頒布可能ファイル（Distributable Code） | VS Build Tools の `VC\Redist\MSVC` から、変更せずにアプリローカル配置 |
| ✅ **FFmpeg CLI** (`resources/ffmpeg/ffmpeg.exe`。Full 版のみ) | 音声デコード / 話者分離前の WAV 変換 | **LGPL-3.0（BtbN `lgpl` build / `--enable-version3`）** | `--enable-gpl` / `--enable-nonfree` / GPL系encoderなし。`LICENSE.txt`、対応ソース入手手段、`FFMPEG_BUILD_INFO.txt`を同梱（F章） |
| **GStreamer core / base / good / ALSA / PulseAudio plugins**（Linux AppImage のみ） | WebKitGTKの音声再生 | **LGPL-2.1-or-later（プラグインによりLGPL互換のMIT / BSDを含む）** | `bundleMediaFramework`で同梱し、`plugins-ugly` / `gst-libav` / `faad`等は導入しない。GPL系プラグイン名の混入と必須プラグイン欠落をビルド時に拒否する（`Dockerfile.appimage-ubuntu24` と `setup-build-tools-linux.sh`）。Windows・`.deb` には同梱しない。公式licensing FAQ: `https://gstreamer.freedesktop.org/documentation/frequently-asked-questions/licensing.html` |
| **libgomp**（GCC OpenMP ランタイム。Linux の Full / Editor。エンジン実行ファイルの隣） | ggml エンジンの OpenMP 実行時（Windows の VC++ ランタイムに相当） | **GPL-3.0-or-later WITH GCC-exception-3.1**（GCC Runtime Library Exception） | ビルドホストの `libgomp.so.1` を変更せずに同梱（`setup-ggml-speech-linux.sh` が `patchelf` で `RUNPATH=$ORIGIN` を設定）。GCC Runtime Library Exception により、GPL 非互換のコードとリンクした配布でも例外条件を満たせば再配布できる。ライセンス本文（GPL-3.0 と GCC Runtime Library Exception）と対応ソースの入手先（https://gcc.gnu.org/）を配布物に含める。Linux 実機ビルドでの収録確認は未実施 |

> Python ランタイム・Python パッケージ・llama.cpp・CUDA 再頒布ランタイムは同梱しません。

---

## B. Python ランタイム依存

なし。Python は同梱・使用しません（ビルド時のライセンス収集・成果物整理にだけ、配布物に含めないビルド用 Python の標準ライブラリを使います）。

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
| zip（読み書き・AES ZIP 書き込み） | MIT | 著作権＋本文同梱 |
| aes / cbc / hmac / cfb / sha2 / getrandom（暗号化保存・モデル検証） | MIT / Apache-2.0 | 著作権＋本文同梱 |
| ash（Vulkan の GPU 一覧。ローダーは実行時に動的読み込み） | MIT / Apache-2.0 | 著作権＋本文同梱 |
| base64 / encoding_rs / regex / chrono | MIT / Apache-2.0 | 著作権＋本文同梱 |
| windows-sys | MIT / Apache-2.0 | 著作権＋本文同梱 |

> `cargo about` で Rust 依存の全ライセンスを機械生成できます（後述）。

---

## E. モデル（ポストインストールでダウンロード）

| モデル | ライセンス | 義務 / 注意 |
|---|---|---|
| **Whisper large-v3-turbo（ggml 変換版）**（`ggerganov/whisper.cpp`） | MIT（OpenAI Whisper 由来） | 固定 revision・SHA-256 で取得 |
| **Silero VAD v6.2.0（ggml 変換版）**（`ggml-org/whisper-vad`） | **MIT**（Silero Team） | 本文は `licenses/manual/silero-vad-LICENSE.txt` |
| 🟡 **Nemotron-3-Diarization**（`nvidia/Nemotron-3-Diarization`。Full 版のみ） | **OpenMDW-1.1** | 商用利用・改変・再配布可。再配布時はライセンス文と帰属表示を残す。特許・著作権訴訟を起こすと権利が終了する条項あり。アプリには同梱せずダウンロードするが、本文を `licenses/manual/Nemotron-3-Diarization-OpenMDW-1.1.txt` に置き、セットアップ画面から表示できる |

---

## F. ffmpeg — ✅ **LGPL 構成の CLI を同梱（Windows）**

方針:
- 本アプリが ffmpeg に求めるのは**音声デコード／WAV 変換のみ**で、GPL を強制する libx264/libx265（動画エンコーダ）は**不要**。→ **LGPL ビルド**で足りる。
- 実際の音声デコードは、同梱または PATH 上の **LGPL 構成 `ffmpeg` CLI** をサブプロセスとして呼び出して行う（Rust の `decode_audio_to_private_wav`）。ライブラリとしてはリンクしない。
- PyAV（`av`）・`imageio-ffmpeg`（GPL ビルドの ffmpeg を含む）は使用しない。Python 自体を同梱しない。
- `scripts/setup_ffmpeg_lgpl.py`: BtbN `lgpl` build を取得し、`--enable-gpl` / GPL 系ライブラリの混入を検査する。

同梱 FFmpeg の記録（固定版）:
- `scripts/setup_ffmpeg_lgpl.py` が BtbN の固定リリース `autobuild-2026-09-30-13-08`（FFmpeg 8.1 リリースブランチの n8.1.3 ビルド）を取得し、アーカイブの SHA-256 が固定値と一致しなければインストールしない（以前は取得時点の最新版を取得していた）。
- 取得元: `https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/` 配下の次のファイル。
  - Windows: `ffmpeg-n8.1.3-9-g29e619e767-win64-lgpl-8.1.zip`
  - Linux: `ffmpeg-n8.1.3-9-g29e619e767-linux64-lgpl-8.1.tar.xz`
- build project: `https://github.com/BtbN/FFmpeg-Builds`
- FFmpeg source: `https://github.com/FFmpeg/FFmpeg`（n8.1.3）
- 実際に同梱するバイナリの version・download URL・SHA-256・configure 行は、ビルド時に `FFMPEG_BUILD_INFO.txt` へ記録され、配布物に同梱される（本ファイルにはビルドごとの値を書かない）。
- configure 行は `--enable-version3` を含むため LGPLv3 として扱う。`--enable-gpl` は含まず、`--disable-libx264` / `--disable-libx265` / `--disable-libxvid` を確認する。

検証観点:
- `ffmpeg -version` に `--enable-gpl`、`--enable-nonfree`、`--enable-libx264`、`--enable-libx265`、`--enable-libxvid`、`--enable-libfdk-aac` が含まれないこと。
- `LICENSE.txt` / `FFMPEG_BUILD_INFO.txt` が配布物に含まれること。

---

## 配布物への組み込み（推奨フロー）

1. `LICENSE` / `NOTICE` / `THIRD_PARTY_LICENSES.md` / `licenses/` を**インストーラーに同梱**（Tauri resources に追加済み）
2. アプリの **セットアップ画面などからライセンス本文を参照**できるようにする（Nemotron の本文は `read_bundled_license` で表示）
3. 各依存の**フルライセンス本文**を機械的に収集して結合（`scripts/setup-build-tools.bat` が自動実行）
   - `python scripts/collect_licenses.py --no-python --frontend frontend --tauri src-tauri --out licenses`
   - Rust: `cargo metadata` の依存グラフ＋crate ソースから収集（`cargo about` でも可）
   - Node: `frontend/package.json` の production 依存クロージャから収集
   - 手動補完: `licenses/manual/`（Nemotron OpenMDW-1.1、Silero VAD、sentencepiece、Rust `selectors` MPL-2.0）が `THIRD_PARTY_FULL.txt` 末尾へ自動結合される
4. リリースビルド時に「不明」に新規項目が出ていないか確認する

---

## チェックリスト（配布前）

- [x] アプリ本体の `LICENSE` を決定・追加（Apache-2.0 / 著作権=合同会社学幸社）
- [x] 同梱 ffmpeg を LGPL ビルドとし、`LICENSE.txt` / `FFMPEG_BUILD_INFO.txt` を同梱
- [x] Nemotron-3-Diarization（OpenMDW-1.1）・Silero VAD（MIT）の本文を `licenses/manual/` に配置
- [x] whisper.cpp / NeMo-Speech.cpp / Vulkan Loader のライセンス文書をエンジンの隣に同梱
- [x] 本ファイルと `licenses/` をインストーラー同梱物に追加（Tauri resources）
- [ ] リリースビルド時に `collect_licenses.py --no-python` を再生成し、「不明」ゼロ（または manual/ でカバー済み）を確認
- [ ] Linux ビルド（未検証）で、GStreamer 構成・`libgomp` と、ICD を同梱せず libvulkan がフォールバック用ローダー1ファイルだけであることを再確認し、`libgomp` のライセンス本文が配布物に含まれることを確認
