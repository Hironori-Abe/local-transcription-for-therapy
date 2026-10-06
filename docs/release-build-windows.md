# Release Build (Windows)

配布は NSIS インストーラーで行います。Full 版（Vulkan。GPU が無ければ CPU）と Editor 版の2系統です。
インストーラーに Python・LLM（llama-server / Gemma）は含みません。ggml 音声エンジン（whisper.cpp、Full 版は NeMo-Speech.cpp も）と LGPL 構成の ffmpeg を同梱し、モデルは初回起動後にアプリのセットアップ画面から取得します。

Linux の配布ビルドは今後対応予定です（[release-build-linux.md](release-build-linux.md) は現状旧構成の記録）。

---

## 1. NSIS インストーラー

### 前提

- Node.js / npm
- Rust / cargo
- Microsoft C++ Build Tools（Visual Studio 2022 Build Tools）、Git、LunarG Vulkan SDK（音声エンジンのビルド用）
- tauri-cli（スクリプトが自動インストール）

### ビルド実行

プロジェクト直下で:

```bat
scripts\setup-build-tools.bat
```

- 音声エンジンの準備、LGPL ffmpeg の取得、ライセンス収集、フロントエンドビルド、`cargo tauri build --bundles nsis` を一括実行します。
- 引数なしは Full 版（`src-tauri\tauri.conf.json` をそのまま使用）です。Editor 版は `scripts\setup-build-tools.bat --editor` でビルドします。`--vulkan` は Full 版の旧名称で、引き続き受け付けます。
- 選択内容だけを確認する場合は、実際のダウンロード・ビルドを行わない `scripts\setup-build-tools.bat --editor --dry-run --no-hold` を使えます。
- 初回は音声エンジンと Rust のコンパイルがあるため数十分かかります。
- エラー調査でログを残したい場合は、入力待ちを無効化してリダイレクトします。

```bat
scripts\setup-build-tools.bat --no-hold > setup-build-tools.log 2>&1
```

### 出力先

```text
src-tauri\target\release\bundle\nsis\Local Transcription for Therapy_X.Y.Z_x64-setup.exe
```

### 出力ファイル名とバージョン番号

出力ファイル名（`Local Transcription for Therapy_X.Y.Z_x64-setup.exe`）は `src-tauri/tauri.conf.json` の `version` フィールドから自動生成されます。リリース前にここを更新してください。

---

## 2. NSIS ビルド時の注意点

### ビルド中のネット接続

`setup-build-tools.bat` はビルド準備として以下を取得します。

| 対象 | 保存先 | 備考 |
| ---- | ------ | ---- |
| whisper.cpp / NeMo-Speech.cpp の Vulkan ビルド | `src-tauri/resources/speech-engines/{whisper,nemo}/` | `scripts/prepare-vulkan-bundle-windows.ps1`。固定 commit からビルド。Editor 版は `-WhisperOnly`（whisper.cpp のみ） |
| ビルド用 Python 3.12 embeddable | `%LOCALAPPDATA%\lott-ggml-speech-build\python-3.12.10-build\` | **アプリには同梱しない**。ffmpeg 取得・ライセンス収集・成果物整理に標準ライブラリだけを使う |
| LGPL ffmpeg（Full 版のみ） | `src-tauri/resources/ffmpeg/ffmpeg.exe` | `scripts/setup_ffmpeg_lgpl.py`（BtbN `lgpl` build の**固定版**。タグ・アセット名・SHA-256 を固定し、一致しなければ失敗する。取得済みアーカイブは `%LOCALAPPDATA%\lott-ggml-speech-build\ffmpeg-cache\` に保存して再利用） |
| VC++ ランタイム | 各エンジン実行ファイルの隣 | VC++ 再頒布パッケージが未導入の PC でも動かすため |

モデルは同梱しません。既存のファイルがある場合、取得はスキップされます。

### FFmpeg 固定版の更新

全ての音声を処理する ffmpeg だけが「その日の最新」にならないよう、`scripts/setup_ffmpeg_lgpl.py` は BtbN の日付付き autobuild（`autobuild-YYYY-MM-DD-HH-MM`）のタグ・アセット名・SHA-256 を定数で固定しています（`PINNED_TAG` と `ASSETS`）。`latest` へは暗黙にフォールバックしません。

- ダウンロード後に SHA-256 を照合し、不一致ならファイルを破棄して失敗します。キャッシュ済みアーカイブはハッシュが一致するときだけ再利用します（キャッシュ場所は `LOTT_FFMPEG_CACHE_DIR` または `--cache-dir` で変更可）。
- `src-tauri/resources/ffmpeg/FFMPEG_BUILD_INFO.txt` の `archive_sha256` が固定値と異なる（旧版が入っている）場合は、次回実行時に固定版へ置き換えます。
- 固定先が BtbN から削除されると 404 で失敗し、「固定版が削除された」旨のエラーを出します。キャッシュに固定版が残っていればネット取得なしで通ります。
- BtbN は日次の autobuild を一定期間で削除しますが、**月末の autobuild は長く残ります**。更新するときは月末（その月で最後）のタグを選んでください。

更新手順（固定版が消えたとき、または意図して版を上げるとき）:

1. `curl -s "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases?per_page=30"` などで、現存する月末の `autobuild-*` を選ぶ。現行と同じ系統（`n8.1.x` の `...-lgpl-8.1`）を優先し、系統を変える場合は音声調整（`highpass` / `afftdn` / `dynaudnorm`）と各形式のデコードを確認する。
2. そのリリースの `checksums.sha256` から、`win64-lgpl` / `win64-lgpl-shared` / `linux64-lgpl` / `linux64-lgpl-shared` の 4 件のアセット名と SHA-256 を `scripts/setup_ffmpeg_lgpl.py` の `PINNED_TAG` と `ASSETS` へ写す（`--enable-gpl` 系ではなく `-lgpl` のアセットであること）。
3. `python scripts\setup_ffmpeg_lgpl.py --force` を実行し、SHA-256 照合・`--enable-gpl` / `--enable-nonfree` / `--enable-libx264` / `--enable-libx265` / `--enable-libxvid` / `--enable-libfdk-aac` が無いことの検査・`FFMPEG_BUILD_INFO.txt` の `download_url` が固定 URL になっていることを確認する。
4. `python -m unittest test_setup_ffmpeg_lgpl`（`scripts` ディレクトリで実行）を通す。
5. 一時的に別版を試すだけなら、定数を書き換えずに `--tag` / `--asset` / `--sha256` を **3 つ全て**指定する（SHA-256 無しの上書きは受け付けない）。

### Tauri 設定ファイル

Full 版は `src-tauri/tauri.conf.json` がそのまま配布設定です（`resources` は `LICENSE` / `NOTICE` / `THIRD_PARTY_LICENSES.md` / `licenses` / `resources/proofread/punctuation_rules` / `resources/ffmpeg` / `resources/speech-engines`）。

Editor 版は `tauri.editor.windows.override.json` を使い、`setup-build-tools.bat --editor` が自動で指定します。手動で `cargo tauri build` を実行する場合も、同じ配布ラインの設定を必ず指定してください。

`setup-build-tools.bat` はビルド前に `src-tauri\target\release\_up_` を削除します。過去の dev build で混入したファイルが staging に残る事故を避けるためです。

### NSIS フックについて

`src-tauri/nsis/full-hooks.nsh`（Full 版）/ `editor-hooks.nsh`（Editor 版）が Tauri の NSIS インストーラーフックです。公式インストーラーは外部ランタイムの導入や選択ダイアログを表示しません。

Windows 向け override の `nsis` ブロックは `tauri.conf.json` の同ブロックをシャロー上書きするため、`installerHooks` が失われる可能性があります。override の `nsis` ブロックを追加・変更する際は `installerHooks` を明示してください。

```json
"nsis": {
  "installerHooks": "nsis/editor-hooks.nsh",
  "languages": ["Japanese"],
  "displayLanguageSelector": false
}
```

### リリース前チェックリスト

- [ ] `src-tauri/tauri.conf.json` の `version` をリリース番号に更新
- [ ] `src-tauri/resources/ffmpeg/ffmpeg.exe` が LGPL build で、`--enable-gpl` を含まないことを確認（Full 版）
- [ ] `src-tauri/resources/ffmpeg/FFMPEG_BUILD_INFO.txt` と `LICENSE.txt` が生成されていることを確認（Full 版）
- [ ] `src-tauri/resources/speech-engines/` に whisper.cpp（Full 版は NeMo-Speech.cpp も）の Vulkan ビルドと VC++ ランタイムがあることを確認
- [ ] `scripts\collect_licenses.py --no-python --frontend frontend --tauri src-tauri --out licenses` が実行され、`licenses\THIRD_PARTY_FULL.txt` が更新されていることを確認（「不明」が `licenses/manual/` でカバーされない項目を出していないこと）
- [ ] `LICENSE` / `NOTICE` / `THIRD_PARTY_LICENSES.md` / `licenses\`（`licenses\manual\` の Nemotron・Silero VAD・sentencepiece 等を含む）が Tauri resources に含まれ、インストール後に参照できることを確認
- [ ] `setup-build-tools.bat` でビルドが完走することを確認
- [ ] インストーラーを別 PC でテストインストールして動作確認（GPU あり / GPU 無しの両方が望ましい）

---

## 3. GitHub Release 公開手順

### 配布ファイル名

Tauri の出力名（Windows では `Local Transcription for Therapy_X.Y.Z_x64-setup.exe`）は空白・括弧を含みます。
ビルドスクリプトは、ビルド後に `scripts/collect_release_artifacts.py` を呼び出し、
手作業のリネームなしで `dist/vX.Y.Z/` へ以下の規約名の成果物を作成します。

| 配布ライン | Windows アセット名 | 扱い |
| --- | --- | --- |
| Full 版 | `LoTT-vX.Y.Z-windows-x64-vulkan-setup.exe` | 主配布 |
| Editor 版 | `LoTT-vX.Y.Z-windows-x64-editor-setup.exe` | 軽量版 |

Full 版のファイル名に含まれる `vulkan` は、GPU バックエンドの名称です。

### SHA256SUMS.txt の生成

`scripts/collect_release_artifacts.py` が、`dist/vX.Y.Z/` の全アセット（`SHA256SUMS.txt` 自身を除く）を対象に
小文字ハッシュ・半角スペース2つ・ファイル名の形式で `SHA256SUMS.txt` を生成します。
配布ラインを続けてビルドした場合も、同じ出力先にある全アセットを一覧へ反映します。
生成したフォルダで `sha256sum -c SHA256SUMS.txt` を実行して検証できます。

### リリースノート

`docs/release-notes-template.md` を `release-notes-vX.Y.Z.md` としてコピーして記入し、Release 本文に貼り付ける。
v0.9.6 以降は、CPU版が試用向けである旨の注意書きを本文の末尾に残し、その後へ文章を追加しない。これにより、GitHub Release 画面で注意書きがインストーラー等のアセット一覧の直前に表示される。

### 公開後チェック

- [ ] アセット名がリネーム規約どおりか（空白・括弧が残っていないか）
- [ ] `SHA256SUMS.txt` のハッシュがアップロード済みアセットと一致するか（ダウンロードして `sha256sum -c` で確認）
- [ ] Release 本文に「初回セットアップ時のみインターネット接続が必要」「会話・音声データは PC 外へ送信しない」の注記があるか
- [ ] SmartScreen 警告についての案内（未署名の場合）が本文にあるか
- [ ] v0.9.6 以降では、CPU版が試用向けである旨の注意書きがRelease本文の最後（アセット一覧の直前）にあるか

---

## 4. 配布ラインと Tauri 設定の一覧

| 設定ファイル（override はリポジトリ直下） | 用途 |
| --- | --- |
| `src-tauri/tauri.conf.json` | Full 版 / Windows NSIS（`setup-build-tools.bat` の既定。フック `nsis/full-hooks.nsh`） |
| `tauri.editor.windows.override.json` | Editor 版 / Windows NSIS（`--editor`。フック `nsis/editor-hooks.nsh`。`resources/speech-engines/whisper` のみ同梱） |
| `tauri.dev.windows.override.json` | Full 版の開発起動（`scripts\run-dev.bat`） |
| `tauri.editor.dev.windows.override.json` | Editor 版の開発起動（`scripts\run-dev-editor.bat`） |
| `tauri.dev.linux.override.json` / `tauri.editor.linux.override.json` / `tauri.editor.dev.linux.override.json` | Linux 対応（Stage 3）用。現構成には未更新 |

Full 版と Editor 版は `identifier` を分け、同一 PC に併存できます。

- Full: `net.gakkousya.lott`
- Editor: `net.gakkousya.lott-editor`

Editor 版のビルド例:

```bat
scripts\setup-build-tools.bat --editor
```

Editor 版は `prepare-vulkan-bundle-windows.ps1 -WhisperOnly` で whisper.cpp だけをビルドし、`resources/speech-engines/whisper` と関連ライセンスを配置します。NeMo / Nemotron・ffmpeg は含めず、初回セットアップで Whisper turbo と VAD を取得します。Editor の音声入力は llama-server・Gemma・Python に依存しません。
