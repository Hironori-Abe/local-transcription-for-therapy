# PyAV 非依存 + LGPL ffmpeg CLI 配布計画

本アプリを **Apache-2.0** で配布するため、文字起こし・話者分離の音声デコード経路から
GPL 構成の FFmpeg バイナリが混入しやすい `av`（PyAV）と `imageio-ffmpeg` を外す。

現在の正規方針は、**PyAV wheel を自前ビルドしない**。代わりに、`faster-whisper` は
`--no-deps` で導入し、PyAV を依存解決で入れない。音声デコードは同梱または PATH 上の
**LGPL 構成 ffmpeg CLI** で行い、numpy 配列として `WhisperModel.transcribe()` に渡す。

このファイル名は旧検討の名残だが、本書の内容を配布前の作業計画として扱う。

## 結論

- `av` / `imageio-ffmpeg` は配布用 Python 環境に入れない。
- `faster-whisper==1.2.1` は先に `pip install --no-deps` で入れる。
- `faster-whisper` がトップレベルで `import av` する問題は、`transcribe_cli.py` の
  最小スタブで import だけ通す。
- 実際のデコードは `ffmpeg` CLI で `s16le` / mono / 16kHz に変換し、float32 numpy 配列へ変換する。
- PyAV 経路は `--audio-decode-backend pyav` 指定時だけの開発・比較用経路とする。
- 話者分離の WAV 変換も同じ `FFMPEG_BIN` を使う。`imageio-ffmpeg` フォールバックは既定で無効にする。

## この作業でしないこと

- 配布用 Python 環境へ `av`（PyAV）を入れ直さない。
- 配布用 Python 環境へ `imageio-ffmpeg` を入れ直さない。
- `pip install faster-whisper` を通常依存解決つきで実行しない。必ず `--no-deps` で先に入れる。
- PyAV wheel を LGPL FFmpeg つきで自前ビルドして配布する方針には戻さない。
- GPL 構成の ffmpeg バイナリを「別プロセスだから問題ない」という扱いで配布物へ含めない。

入れる対象は Python パッケージではなく、`resources/ffmpeg/ffmpeg(.exe)` に置く
**LGPL 構成の ffmpeg CLI** だけである。通常運用時の音声・会話データは PC 外へ送らず、
この CLI もローカルの別プロセスとしてのみ使う。

## なぜこの方針にするか

- PyPI の `av` wheel は FFmpeg ライブラリを同梱し、検証環境では `libx264` / `libx265` が
  含まれていた。これは GPL 構成の FFmpeg になる。
- `imageio-ffmpeg` も同梱バイナリが GPL 構成になりうる。
- 本アプリが必要とするのは音声デコードと 16kHz mono 変換で、GPL コンポーネントの動画エンコーダは不要。
- `faster-whisper` はファイルパスの代わりに numpy 音声配列を渡せるため、PyAV の実デコード経路を使わずに済む。
- `output_m03.mp3` では、ffmpeg CLI の `s16le` 変換結果が PyAV の既存デコード結果とサンプル単位で一致することを確認済み。

## 実装方針

### 文字起こし

`python_sidecar/transcribe_cli.py`:

- 既定の `audioDecodeBackend` は `ffmpeg`。
- `FFMPEG_BIN`、PATH、サイドカー隣接 `ffmpeg/` または `bin/` の順に `ffmpeg` を探す。
- `ffmpeg -f s16le -acodec pcm_s16le -ac 1 -ar 16000 pipe:1` でデコードする。
- int16 PCM を `float32 / 32768.0` に変換する。
- normalize / highpass / noise reduction は numpy 配列に対して適用する。
- `faster-whisper` import 前に PyAV import stub を入れ、`av` パッケージなしで起動する。

### 話者分離

`python_sidecar/diarize_cli.py`:

- `FFMPEG_BIN` があればそれを使って WAV へ変換する。
- PATH / サイドカー隣接の `ffmpeg` も許可する。
- `imageio-ffmpeg` は `ALLOW_GPL_FFMPEG=1` のときだけ開発用フォールバックとして使う。
- Tauri から起動する通常経路では `ALLOW_GPL_FFMPEG=0` を渡す。

### セットアップ

`setup_venv_cli.py` / `setup-dev.sh` / `setup-dev.bat` / `rebuild-runtime-venv.bat`:

1. 既存環境に残っている `av` と `imageio-ffmpeg` を uninstall する。
2. `faster-whisper` を `--no-deps` で先にインストールする。
3. requirements から `faster-whisper` 行を除いた一時ファイルを作り、残りを通常インストールする。
4. `tokenizers` / `onnxruntime` / `tqdm` など、`faster-whisper` の実行依存は requirements に明示する。

## LGPL ffmpeg の条件

同梱または案内する `ffmpeg` は次を満たすこと。

- `--enable-gpl` が含まれない。
- `libx264` / `libx265` / `libxvid` / `libpostproc` など GPL 由来コンポーネントを含めない。
- 音声入力として WAV / MP3 / M4A(AAC) / FLAC / Ogg Opus を読める。
- 配布物に LGPL 本文、FFmpeg のソース入手手段、configure オプション、取得元、バージョンを含める。
- `--enable-version3` は GPL ではないが、BtbN `lgpl` build では LGPLv3 になるため、その前提で表示・同梱する。

Windows の候補:

- BtbN/FFmpeg-Builds の `ffmpeg-master-latest-win64-lgpl.zip` または同等の LGPL build。
- 配置先: `src-tauri/resources/ffmpeg/ffmpeg.exe`

Linux の候補:

- BtbN/FFmpeg-Builds の `ffmpeg-master-latest-linux64-lgpl.tar.xz`、自前の LGPL build、
  または GPL コンポーネントを含まないことを確認できる system/bundled build。
- 配置先: `src-tauri/resources/ffmpeg/ffmpeg`

Ubuntu 標準パッケージの FFmpeg は GPL 構成の可能性があるため、配布物へ同梱する場合はそのまま採用しない。

## Tauri リソース

ASR / 話者分離を含む配布ラインでは `resources/ffmpeg/` を Tauri resources に含める。
取得・検査は `scripts/setup_ffmpeg_lgpl.py` が担当する。

- `src-tauri/tauri.conf.json`
- `tauri.build.nvidia-windows.override.json`
- `tauri.build.amd-windows.override.json`
- `tauri.build.nvidia-ubuntu.override.json`
- `tauri.build.amd-ubuntu.override.json`

Editor 版は文字起こし・話者分離を含まないため必須ではない。

## 現在の実装状況

- `transcribe_cli.py` は既定で `ffmpeg` backend を使う。
- `transcribe_cli.py` は `faster-whisper` import 前に PyAV import stub を入れる。
- `WhisperModel.transcribe()` へはファイルパスではなく 16kHz mono float32 の numpy 配列を渡す。
- `diarize_cli.py` は `FFMPEG_BIN` / PATH / サイドカー隣接 `ffmpeg` を使って WAV 変換する。
- `diarize_cli.py` の `imageio-ffmpeg` fallback は `ALLOW_GPL_FFMPEG=1` のときだけ使う。
- Tauri 側は子プロセス起動時に `ALLOW_GPL_FFMPEG=0` を渡し、同梱 ffmpeg があれば `FFMPEG_BIN` として渡す。
- `python_sidecar/requirements-runtime.txt` と `python_sidecar/requirements-amd.txt` には `av` / `imageio-ffmpeg` を入れない方針を明記済み。
- `setup_venv_cli.py` と `rebuild-runtime-venv.bat` は `av` / `imageio-ffmpeg` を uninstall し、`faster-whisper` を `--no-deps` で入れる。
- Full CUDA / Full AMD の Tauri override は `resources/ffmpeg` を resources に含める。Editor 版 override には含めない。

## 配布ビルドへの組み込み手順

### 1. LGPL ffmpeg を取得する

Windows:

```bat
python scripts\setup_ffmpeg_lgpl.py --platform windows --variant lgpl --dest src-tauri\resources\ffmpeg --force
```

Linux:

```sh
python3 scripts/setup_ffmpeg_lgpl.py --platform linux --variant lgpl --dest src-tauri/resources/ffmpeg --force
```

`scripts/setup_ffmpeg_lgpl.py` は BtbN の `lgpl` build を取得し、次を配置する。

- `ffmpeg.exe` または `ffmpeg`
- `LICENSE.txt`
- `FFMPEG_BUILD_INFO.txt`

`FFMPEG_BUILD_INFO.txt` には取得 URL、取得元、FFmpeg source URL、archive SHA-256、
binary SHA-256、`ffmpeg -version` の出力を記録する。ホスト OS と target platform が違う場合、
実行時検査は skip されるため、対象 OS 上で `ffmpeg -version` を再確認する。

### 2. 禁止 configure flag を確認する

`setup_ffmpeg_lgpl.py` は `ffmpeg -version` の `configuration:` 行に次が含まれる場合に失敗する。

- `--enable-gpl`
- `--enable-nonfree`
- `--enable-libx264`
- `--enable-libx265`
- `--enable-libxvid`
- `--enable-libfdk-aac`

配布前の手動確認でも同じ観点を見る。

### 3. Python 環境を作る

配布用・開発用ともに、依存導入は以下の順序を守る。

1. `av` / `imageio-ffmpeg` を uninstall する。
2. `faster-whisper==1.2.1` を `--no-deps` で install する。
3. `python_sidecar/requirements-runtime.txt` または `python_sidecar/requirements-amd.txt` から `faster-whisper` 行を除いて install する。
4. `python -m pip show av imageio-ffmpeg` が `Package(s) not found` になることを確認する。

この順序を崩すと `faster-whisper` の依存解決で PyAV が再導入されうる。

### 4. Tauri build を実行する

Windows CUDA 版は通常どおり次を使う。

```bat
scripts\setup-build-tools.bat
```

このスクリプトが使う `tauri.build.nvidia-windows.override.json` には `resources/ffmpeg` が含まれている。
AMD Windows / Ubuntu 版も対応する override に `resources/ffmpeg` を含める。

`tauri.conf.json` の基底 resources は dev / portable 寄りの設定を含むため、NSIS リリースでは
必ず配布ライン別 override を使う。

## 検証

### 1. GPL 系 Python パッケージがないこと

```sh
python -m pip show av imageio-ffmpeg
```

期待値:

- どちらも `Package(s) not found`。
- site-packages に `av/`、`av.libs/`、`imageio_ffmpeg/` が残っていない。

### 2. faster-whisper import はアプリ経路で通ること

PyAV なし環境では、素の `from faster_whisper import WhisperModel` は失敗しうる。
これは想定内。確認はスタブを入れたアプリ経路で行う。

```sh
python -c "import python_sidecar.transcribe_cli as t; t.install_pyav_import_stub(); from faster_whisper import WhisperModel; print('ok')"
```

### 3. 文字起こしが既定 ffmpeg backend で完走すること

```sh
python python_sidecar/transcribe_cli.py \
  --audio-path demo_data/output_m03.mp3 \
  --model <local-faster-whisper-model-path> \
  --device cpu \
  --compute-type int8
```

期待値:

- `settings.audioDecodeBackend` が `ffmpeg`。
- 3 分音声が完走する。
- normalize / highpass / noise reduction の ON/OFF でも完走する。

### 4. PyAV とのデコード同等性

開発環境に PyAV が残っている場合だけ比較する。

- 同じ音源を PyAV と ffmpeg backend で 16kHz mono float32 に変換する。
- `output_m03.mp3` では sample count / max abs diff / mean abs diff がすべて一致することを確認済み。

### 5. ffmpeg 構成確認

```sh
ffmpeg -version
```

期待値:

- `--enable-gpl` が含まれない。
- `--enable-libx264` / `--enable-libx265` / `--enable-libxvid` が含まれない。

### 6. 配布物検査

NSIS インストール後、または portable zip 展開後に確認する。

- `FFMPEG_BIN` が同梱 LGPL ffmpeg を指す。
- `av` / `imageio-ffmpeg` が Python 環境に入っていない。
- `ALLOW_GPL_FFMPEG=0` の通常起動で文字起こし・話者分離が動く。
- `THIRD_PARTY_LICENSES.md`、NOTICE、LGPL 本文、FFmpeg ソース入手手段が同梱されている。
- `FFMPEG_BUILD_INFO.txt` に URL、SHA-256、`ffmpeg -version` の configure 行が記録されている。

### 7. Windows no-PyAV smoke test

Windows では以下の検証スクリプトを使う。これはパッケージの install / uninstall やモデル取得を行わない。

```bat
.venv312\Scripts\python.exe scripts\verify_lgpl_ffmpeg_no_pyav.py ^
  --ffmpeg src-tauri\resources\ffmpeg\ffmpeg.exe ^
  --sample demo_data\output_m03.mp3
```

確認内容:

- `av` / `imageio-ffmpeg` package が存在しないこと。
- site-packages に `av/`、`av.libs/`、`imageio_ffmpeg/` が存在しないこと。
- `ffmpeg -version` の configure 行に GPL / nonfree / GPL 系 encoder が含まれないこと。
- `transcribe_cli.py` の ffmpeg decode が 16kHz mono float32 配列を返すこと。
- `faster-whisper` import が LoTT の PyAV stub 経由で通ること。
- `diarize_cli.py` が `ALLOW_GPL_FFMPEG=0` のまま同梱 ffmpeg で MP3 -> WAV 変換できること。

2026-06-02 Windows 検証結果:

- `.venv312` から `av 17.0.1` / `imageio-ffmpeg 0.6.0` を uninstall 済み。
- `scripts/setup_ffmpeg_lgpl.py --platform windows --variant lgpl` で `src-tauri/resources/ffmpeg/ffmpeg.exe` を配置済み。
- BtbN build: `ffmpeg version N-124724-g6f1de91492-20260601`。
- configure 行は `--enable-gpl` なし、`--disable-libx264` / `--disable-libx265` / `--disable-libxvid`。
- `verify_lgpl_ffmpeg_no_pyav.py` は pass。
- ローカル faster-whisper モデル実体が見つからなかったため、実 ASR モデル推論までは未実施。音声デコード、import stub、話者分離前 WAV 変換まで確認済み。
- 既存 `dist/portable-full` は古い成果物で `av` / `av.libs` / `imageio_ffmpeg` が残っており、同梱 LGPL ffmpeg もない。Apache-2.0 配布候補としては使わず、再生成する。
- `scripts/setup-build-tools.bat --no-hold` で NSIS build 完走済み。生成物:
  `src-tauri/target/release/bundle/nsis/Local Transcription for Therapy_0.3.0_x64-setup.exe`
- build staging では `.venv312` は含まれず、`av` / `av.libs` / `imageio_ffmpeg` の残存も 0 件。
- 同梱 ffmpeg は `src-tauri/target/release/resources/ffmpeg/ffmpeg.exe` に配置され、Tauri 側の `executable_dir/resources/ffmpeg` 探索候補と一致する。

2026-06-02 NSIS インストール後検証結果:

- NSIS インストーラーでインストールしたアプリで句読点校正まで完了。
- インストール先 Python runtime:
  `C:\Users\abehi\AppData\Local\Local Transcription for Therapy\resources\python312`
- `python.exe -m pip show av imageio-ffmpeg` は `Package(s) not found`。
- `site-packages` に `av/`、`av.libs/`、`imageio_ffmpeg/` は存在しない。
- `av-*.dist-info` / `imageio_ffmpeg*` / `imageio-ffmpeg*` の残骸も 0 件。
- インストール先 resources には `ffmpeg/`、`llama-server/`、`proofread/`、`python312/` が配置されている（Lemonade/lemond は現在の配布物には同梱しない）。
- `resources/ffmpeg/` には `ffmpeg.exe`、`LICENSE.txt`、`FFMPEG_BUILD_INFO.txt`、`README.md` が配置されている。
- インストール先 `ffmpeg.exe -version` でも `--enable-gpl` なし、`--disable-libx264` / `--disable-libx265` / `--disable-libxvid` を確認済み。

### 8. setup-build-tools.bat の注意点

2026-06-02 の Windows NSIS ビルドで以下を修正済み。

- `src-tauri/resources/python312/python312._pth` に UTF-8 BOM が入ると、Python embeddable が
  `python312.zip` を正しく認識できず、`No module named 'encodings'` で起動不能になる。
  `setup-build-tools.bat` は毎回 `python312._pth` を UTF-8 BOM なしに正規化する。
- batch の `if (...) else (...)` ブロック内に PowerShell の括弧や複数行 `^` を置くと、
  `else was unexpected at this time` / `exit was unexpected at this time` のような構文エラーを起こしやすい。
  既存スクリプトでは分岐を `goto` に寄せ、PowerShell 呼び出しを 1 行にしている。
- ビルド前に `src-tauri/target/release/_up_` を削除する。過去の dev / portable build の
  `.venv312`、`av`、`av.libs`、`imageio_ffmpeg` が stale resources として残る事故を防ぐため。
- エラー調査時は `scripts\setup-build-tools.bat --no-hold > setup-build-tools.log 2>&1` でログを取る。
- `--trace` を第2引数に渡すと batch のコマンド echo を有効化できる。

## 完了条件

- Windows / Linux の両方で `av` / `imageio-ffmpeg` なしのセットアップができる。
- 同梱 LGPL ffmpeg を Tauri resources に含められる。
- 文字起こし、話者分離、音声前処理の主要フローが既存品質で動作する。
- 配布物から `av.libs`、`imageio_ffmpeg`、GPL 構成 ffmpeg が消えている。
- ライセンス本文、NOTICE、ソース入手手段、configure オプション記録が配布物に含まれている。

## 残タスク

- Windows の実 ASR モデル推論まで確認する。ローカル faster-whisper モデルが必要。
- Linux 配布ライン用に Linux 上で同じスクリプトを実行し、`resources/ffmpeg/ffmpeg` とメタデータを生成する。
- インストール済みアプリ上で実 ASR と話者分離まで通し確認する。
- `scripts/collect_licenses.py` の自動収集で残る `pywin32`（PSF-2.0）、`sentencepiece`（Apache-2.0）、Rust `selectors`（MPL-2.0）のライセンス本文を手動補完する。
- CUDA EULA 本文と Attachment B（cuBLAS 第三者通知）を配布物へ同梱する。

2026-06-02 追加対応:

- `THIRD_PARTY_LICENSES.md` / `NOTICE` / About 側に FFmpeg LGPL、ソース入手手段、BtbN build 情報、no-PyAV 方針を反映済み。
- `LICENSE` / `NOTICE` / `THIRD_PARTY_LICENSES.md` / `licenses/` を Full CUDA / Full AMD / Editor の Tauri resources に追加済み。
- `scripts/collect_licenses.py --venv .venv312 --frontend frontend --tauri src-tauri --out licenses` を実行済み。収集結果は Python 147 本文 / 2 不明、Rust 478 本文 / 2 不明、Node 19 本文 / 0 不明。
- `scripts/setup-build-tools.bat` と `scripts/setup-build-tools-ubuntu.sh` は `.venv312` がある場合、ビルド前に `licenses/` を再生成する。
