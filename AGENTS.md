# AGENTS.md

## Project Mission

このプロジェクトの目的は、**臨床心理学的実践・カウンセリング会話の文字起こしを快適にする**ことです。  
対象アプリは Local Transcription for Therapy (LoTT) であり、会話データをローカル完結で扱うことを前提とします。

## Product Scope

本アプリの中核機能は次の3つです。

1. 文字起こし
2. 話者分離
3. 文章校正

上記を「実運用で使える品質」で継続改善することを開発方針とします。文章校正はルールベース（句読点付与）と、氏名・地名などの注意喚起（Named Entity Warning）で構成し、LLM は使いません。

## Non-Negotiable Constraints

- 通常運用時はインターネットに接続しない
- PC外のAPIへ会話データ・音声データを送信しない
- ネット接続を許可するのは、初回セットアップ・モデル取得時のみ
- 個人情報保護要件を、性能要件より優先する
- 将来ローカルの推論エンドポイントを導入する場合も、接続先は loopback（`http://localhost:*` / `http://127.*:*` / `http://[::1]:*`）に限定する。クラウド推論、loopback以外のホスト、インターネット上のHTTPS推論エンドポイントへ会話データを送信する設計は採用しない。緩和する場合は必ず明示合意を取る

## Stack

- App shell: Tauri 2 (Rust)
- Frontend: Angular 21 + Angular Material
- ASR: whisper.cpp（ggml。Whisper large-v3-turbo + Silero VAD。Vulkan ビルドを同梱）
- Diarization: NeMo-Speech.cpp + Nemotron-3-Diarization（ggml。Vulkan ビルドを同梱）
- GPU: NVIDIA / AMD / Intel を Vulkan で共通に扱う。Vulkan の GPU が無い場合は CPU で動かす
- 校正: Rust のローカルルール（句読点付与）。LLM・llama.cpp・Gemma・Python は使わない・同梱しない
- 音声デコード: 同梱または PATH 上の LGPL 構成 ffmpeg CLI

CUDA 版・AMD (ROCm) 版・CPU 版、Python サイドカー、faster-whisper、pyannote.audio、AI（LLM）校正・全体校正、LM Studio / Ollama 連携は削除済み（2026-09-29）。

## Runtime Defaults

- language: `ja`
- ASR model: `turbo`（Whisper large-v3-turbo）
- device: 自動。Vulkan の GPU があれば GPU、無ければ CPU（起動時に CPU 要件を確認し、GPU ドライバーの問題があれば案内する）
- VAD（Silero）: 有効
- word_timestamps: 話者交代位置での分割に使う（設計は `docs/ggml-speech-engine-design.md`）
- diarization: UI既定 `ON`

話者表示の初期値:

- `SPEAKER_00 -> Th`
- `SPEAKER_01 -> Cl`
- `SPEAKER_02 -> IP`
- `SPEAKER_03 -> IP2`
- `SPEAKER_04 -> IP3`
- others -> `Cl`

## Repository Map

- `frontend/`: Angular UI
- `src-tauri/`: Tauri / Rust（`lib.rs` の Tauri commands、`ggml_speech.rs`、`gpu_select.rs`、`gpu_driver.rs`、`export_crypto.rs`）
- `src-tauri/resources/`: 同梱資源（`speech-engines/`、`ffmpeg/`、`proofread/punctuation_rules/`）
- `python_sidecar/speech-engines/`・`python_sidecar/models/`: 開発時の ggml エンジン・モデル配置先（Git 管理外。Python コードは無い。名前は履歴上の都合で残っている）
- `scripts/`: setup/build/run scripts
- `docs/`: ドキュメント

## README Localization Policy

- `README.md` は日本語のメイン画面として扱い、内容の単一の基準にする。
- 英語版は `README.en.md` に置く。英語版は補助的なサブページであり、ルートの既定 README を英語に置き換えない。
- `README.md` のユーザー向け説明、見出し、手順、画像参照、リンク、要件、プライバシー方針を変更した場合は、同じ変更単位で `README.en.md` も意味が一致するように更新する。
- README の画像を追加・変更した場合は、両 README の相対パスが有効で、リポジトリ閲覧画面で表示できることを確認する。

## Release Notes Download Warning Policy

- v0.9.6 以降の GitHub Release 本文では、CPU版を常用向けのGPU版と取り違えないよう、次の注意書きを**本文の末尾**に置く。GitHub がその下へ表示するインストーラー等のアセット一覧の直前に見える配置とし、注意書きより後へ見出し・本文・脚注を追加しない。

  > **CPU版について:** CPU版は動作確認・試用向けです。頻繁または継続的に利用する場合は、対応するGPU版の利用を推奨します。ダウンロードするファイル名と対象環境をご確認ください。

- `docs/release-notes-template.md` の末尾にある注意書きを維持し、v0.9.6 以降の `docs/release-notes-vX.Y.Z.md` を作成する際に削除・移動しない。
- v0.9.5 以前のrelease notesは当時の配布内容を示す履歴として扱い、このポリシーを遡及適用しない。

## Setup and Run (Windows)

現行の対象 OS は Windows です。推奨フロー:

```bat
rem 1. ggml 音声エンジン（whisper.cpp / NeMo-Speech.cpp）のビルドとモデル取得（固定 commit・SHA-256 検証）
powershell -ExecutionPolicy Bypass -File scripts\setup-ggml-speech-windows.ps1

rem 2. LGPL ffmpeg の取得（音声デコード用）
python scripts\setup_ffmpeg_lgpl.py

rem 3. 開発起動
scripts\run-dev.bat          rem Full 版
scripts\run-dev-editor.bat   rem Editor 版
```

前提環境:

- Node.js (LTS)
- Rustup / Cargo
- Microsoft C++ Build Tools（Visual Studio 2022 Build Tools。エンジンのビルドに同梱の CMake / Ninja を使う）
- Git、LunarG Vulkan SDK（エンジンのビルド時のみ）
- GPU 利用時は GPU メーカーの最新ドライバー（Vulkan 対応）。CUDA Toolkit・cuDNN・Python は不要

補足:

- エンジンの配置先（dev）は `python_sidecar/speech-engines/{whisper,nemo}/`、モデルは `python_sidecar/models/`。詳細は `docs/ggml-speech-engine-design.md`
- 開発用 Angular dev server は `127.0.0.1` にだけ bind する
- Full 版（identifier `net.gakkousya.lott`）と Editor 版（`net.gakkousya.lott-editor`）はフロントの `buildVariant`（`'vulkan'` = Full、`'editor'`）と Rust の `is_vulkan_build` / `is_editor_build`（identifier に `editor` を含むか）で見分ける。Cargo feature による切り替えは無い
- 同梱物（Full）: `resources/speech-engines`（whisper.cpp / NeMo-Speech.cpp / Vulkan ローダー）、`resources/ffmpeg`、必要な VC++ ランタイム。**Python と llama-server は同梱しない**。暗号化保存・ルールベース校正・モデル取得は Rust
- 初回セットアップは whisper.cpp モデル・VAD・Nemotron のみ（Rust で固定 revision・SHA-256 検証・中断再開。トークン不要）
- 開発用の環境変数（デバッグビルドのみ有効）: `LOTT_DEV_CPU_STARTUP_SCENARIO`（`memory|avx2|threads|all|notice`。CPU 実行時の起動ダイアログの再現）、`LOTT_DEV_GPU_DRIVER_SCENARIO`（`missing|old`。GPU ドライバー案内の再現）

## Setup and Run (Ubuntu / Linux)

Linux は Full 版・Editor 版とも deb + AppImage で配布する。Docker でのビルド、AppImage の起動、同梱エンジンの CPU 実行は WSL2（Ubuntu 26.04）で確認済み（2026-09-30）。**Linux 実機での GPU 実行・各ディストリビューションでの動作は未検証**（`docs/release-build-linux.md`）。Python・LLM は使わない。

推奨フロー:

```sh
bash scripts/setup-dev.sh              # Editor 版だけなら --editor
bash scripts/run-dev.sh                # Full 版（Angular 127.0.0.1:4200 + tauri.dev.linux.override.json）
bash scripts/run-dev-editor.sh         # Editor 版（127.0.0.1:4203）
```

- `setup-dev.sh` のオプション: `-y --skip-apt --skip-rust --only-rust --skip-engines --skip-models --editor`。システムパッケージ（Tauri / WebKitGTK / GStreamer / Vulkan ヘッダー・`glslc` / ビルドツール）、npm、Rustup、ggml 音声エンジンとモデル、LGPL ffmpeg（Full のみ）を用意する。`python3` は ffmpeg 取得スクリプトを動かすためだけに使い、venv / pip は使わない
- 音声エンジンは `scripts/setup-ggml-speech-linux.sh`（`--backend vulkan|cpu`、`--engines-dir`、`--skip-nemo`、`--skip-models`）が固定 commit から Vulkan でビルドし、dev は `python_sidecar/speech-engines/{whisper,nemo}/`、モデルは `python_sidecar/models/` に置く。詳細は `docs/ggml-speech-engine-design.md`
- 配布ビルド: `bash scripts/build-appimage-docker.sh`（引数なし = Full、`--editor` = Editor、`--vulkan` は Full の旧称）。Ubuntu 24.04 の Docker イメージ（`scripts/Dockerfile.appimage-ubuntu24`）内で `scripts/setup-build-tools-linux.sh` を実行し、規約名の成果物 `LoTT-vX.Y.Z-linux-x64-{vulkan|editor}.{AppImage,deb}` を `dist/v{version}/` へ集約する。詳細は `docs/release-build-linux.md`
- Linux の環境ファイル・venv は無い。バックエンド別の `setup-dev-*.sh` / `run-dev-*.sh` 入口も存在しない（旧 CUDA / AMD / CPU 版とともに廃止）

### Linux Vulkan の方針

- **GPU ドライバー（ICD）は AppImage / deb に同梱しない**。ホストのものを使う。Vulkan ローダー（`libvulkan.so.1`）もホストのものを優先し、無い PC 向けのフォールバックとして Ubuntu 24.04 の `libvulkan1` の実体を `resources/speech-engines/vulkan-loader/libvulkan.so.1`（+ `LICENSE-Vulkan-Loader.txt` / `BUILD_INFO.txt`）へ同梱する（`setup-build-tools-linux.sh`。Full / Editor 共通）。**エンジンの隣や `usr/lib` には置かない**（`RUNPATH=$ORIGIN` でホストの新しいローダーを隠すため）。アプリは起動時（`ensure_bundled_vulkan_loader_on_path`）に `dlopen("libvulkan.so.1")` でホストのローダーを確認し、無い場合だけこのディレクトリを `LD_LIBRARY_PATH` の先頭へ足す。AppImage では `apply_host_command_env` が AppDir 配下を落とすため、このディレクトリだけ `BUNDLED_VULKAN_LOADER_DIR` に登録して除外する。`setup-build-tools-linux.sh` は AppDir に `libvulkan*` / `vulkan/icd.d/*` が上記の1ファイル以外に無いこと（ICD は0件）を検査し、違反や欠落があればビルドを落とす
- deb は `libvulkan1` に依存する（`tauri.linux.override.json`）。AppImage はホストにローダーが無くても同梱フォールバックで CPU 実行できる。GPU を使うにはホストの ICD（Mesa / NVIDIA ドライバー）が必要で、ICD が無い、または GPU が見えない場合は CPU で処理する。それでもエンジンが起動に失敗した場合のエラー文言は、原因と次の行動（`libvulkan1` などの導入）を示す
- エンジンの実行ファイルは `RUNPATH=$ORIGIN`（patchelf）で隣の ggml ライブラリを読む。OpenMP ランタイム `libgomp` は実行ファイルの隣へ同梱する（Windows の VC++ ランタイムと同じ考え方。libgomp が無い最小構成のホスト対策。GPL-3.0-or-later WITH GCC-exception-3.1 のため `NOTICE` / `THIRD_PARTY_LICENSES.md` に記載）。`whisper-cli` / `nemo-speech` の存在と、Editor に `nemo` が無いことはビルド時に検査する
- エンジンは `run_ggml_engine_process` から `apply_host_command_env` を通して起動し、AppImage の `LD_LIBRARY_PATH` などを持ち込まない
- Linux でも CPU 起動確認（RAM は `/proc/meminfo`、AVX2、論理スレッド数）は動く。GPU ドライバー案内（`gpu_driver.rs`）は Windows のみで、Linux では表示しない

- Ubuntu / Linux では Chrome / Chromium の Snap 版が WebKit / glibc と衝突することがあるため、deb 版ブラウザまたは通常のシステムライブラリ経路を優先する
- 以下の「Audio Decode」の Linux 節と「Linux AppImage」節は、Linux 版（deb + AppImage）の方針である

## Diarization Model Policy

- 話者分離は Nemotron-3-Diarization（`Nemotron-3-Diarization.q8_0.gguf`、OpenMDW-1.1）を NeMo-Speech.cpp（`nemo-speech diarize`）で動かす。モデルは初回セットアップで取得する
- モデル配置先（dev）: `python_sidecar/models/nemotron-3-diarization/`
- モデル配置先（リリース）: `%LOCALAPPDATA%\{identifier}\models\nemotron-3-diarization\`（`app_local_data_dir()/models/`）。NSIS アンインストーラーの `%LOCALAPPDATA%\{identifier}` 一括削除対象
- 取得は固定 revision・SHA-256 検証・`.part` からの再開（`ggml_speech::GGML_MODEL_FILES`）。トークンは不要
- ライセンス本文（`licenses/manual/Nemotron-3-Diarization-OpenMDW-1.1.txt`）はセットアップ画面から表示できる（`read_bundled_license`）
- Nemotron には話者数の指定が無い。UI の話者数の扱いと重なり発話の扱いは `docs/ggml-speech-engine-design.md` の 6 章を参照

## Audio Decode / FFmpeg License Policy

- Apache-2.0 配布方針のため、GPL 構成の ffmpeg・PyAV・`imageio-ffmpeg` を配布物に含めない
- 音声デコードは同梱または PATH 上の **LGPL 構成 ffmpeg CLI** で行い、16kHz mono WAV を一時ディレクトリへ作って whisper.cpp / NeMo-Speech.cpp へ渡す（`decode_audio_to_private_wav`）。`FFMPEG_BIN` 環境変数で上書きできる
- 文字起こしタブの「音声調整」は、文字起こし（whisper.cpp）用の WAV を作るときだけ ffmpeg の `-af` を付ける（`audio_preprocess_filter`。low_noise=`highpass=f=80`、strong_noise=＋`afftdn=nr=12:nf=-40`、volume_boost=＋`dynaudnorm=f=250:g=15`、general_improvement=全部）。話者分離には元の音声を渡す。既定 none では従来と同一のコマンド。結果 JSON の settings に `audioPreprocess` を記録する
- 同梱 ffmpeg は `--enable-gpl`、`--enable-nonfree`、`--enable-libx264`、`--enable-libx265`、`--enable-libxvid`、`--enable-libfdk-aac` を含まないこと
- BtbN `lgpl` build は `--enable-version3` を含むため LGPLv3 として扱い、`LICENSE.txt` / `FFMPEG_BUILD_INFO.txt` / ソース入手手段を配布物に含める
- 配布用 Tauri resources には `../LICENSE` / `../NOTICE` / `../THIRD_PARTY_LICENSES.md` / `../licenses` も含める。設定を変更する場合はこれらを落とさない
- ffmpeg の取得・検査: `scripts/setup_ffmpeg_lgpl.py`

### Linux 再生バックエンド（GStreamer）と AAC 変換

Linux の WebKitGTK は `<audio>` の再生・メタデータ取得を **GStreamer** に委譲する。AppImage は自己完結が前提のため、プラグインを同梱しないとホスト側（Ubuntu 以外、例 CachyOS）でデコーダがゼロになり、音声ファイルを開いた時点で固まる。

- AppImage には GStreamer プラグインを同梱する。Linux の override の `bundle.linux.appimage.bundleMediaFramework: true` で `linuxdeploy-plugin-gstreamer` が動く。この設定を外さない
- 同梱するのは **LGPL のみ**（`gstreamer1.0-plugins-base` / `-good` / `-alsa` / `-pulseaudio`）。GPL の `gstreamer1.0-plugins-ugly` / `gstreamer1.0-libav` / `faad` は入れない。`GSTREAMER_INCLUDE_BAD_PLUGINS=0` を維持する
- 検証は二重にかける。`scripts/Dockerfile.appimage-ubuntu24` がビルドホストのプラグイン構成を、`scripts/setup-build-tools-linux.sh` が再パッケージ前に AppDir を検査し、GPL プラグイン混入・プラグイン欠落があればビルドを落とす
- LGPL だけで再生できる形式: wav / mp3 / flac / ogg(vorbis, opus) / webm。いずれも seek 可能なことを確認済み
- **AAC（m4a / mp4 / aac）は LGPL 側にデコーダが無い**ため、再生時に同梱 LGPL ffmpeg で 16bit FLAC へ変換したキャッシュを配信する（`prepare_playback_source` / `transcode_for_playback`）。変換キャッシュは `app_cache_dir()/private-temp/lott-playback-*.flac`（0700・`PRIVATE_TEMP_MAX_AGE` で自動削除）。**再生専用**であり、文字起こしには元ファイルを使う
- 変換は Linux のみ。Windows(WebView2) は AAC をデコードできるため従来どおり元ファイルを直接配信する
- 再生時間（推定時間表示）は WebView ではなく同梱 ffmpeg で取得する（`get_audio_duration_seconds`）。メディアバックエンドの可否に文字起こし機能を依存させない
- `AudioStreamServer` の `playback_path` は実際に HTTP 配信するファイル（元ファイルまたは変換キャッシュ）を指す。HTTP サーバーはこのパスを配信する
- WebView 側で再生時間を読むフォールバック経路（`loadAudioDurationFromSrc`）には必ずタイムアウトを残す。デコーダが無いと `loadedmetadata` も `error` も発火せず、Promise が未解決のまま UI が固まる

### Linux AppImage の GTK 表示バックエンドと IME

linuxdeploy が生成する `apprun-hooks/linuxdeploy-plugin-gtk.sh` は、ビルド後に `scripts/setup-build-tools-linux.sh` が表示バックエンドと GTK IME の既定値を補正する。AppDir の `immodules.cache` には `im-wayland.so` / `im-xim.so` はあるが fcitx GTK module は無いため、Wayland セッションを X11 に固定すると、fcitx5 の日本語入力経路が暗黙的になりやすい。

- `LOTT_GDK_BACKEND` があれば最優先で `GDK_BACKEND` に設定する（診断用の逃げ道）。無ければ、既存の `GDK_BACKEND` を尊重し、未設定時だけ Wayland セッションでは `wayland`、それ以外では `x11` を既定にする
- `GTK_IM_MODULE` と `XMODIFIERS` の既存値は原則尊重する。AppDir cache に存在する GTK module はそのまま使い、存在しない GTK module の指定だけは、`XMODIFIERS` が空でない場合に限り `xim` へ救済する。`XMODIFIERS` が空の環境では `xim` を強制しない
- Wayland では `GTK_IM_MODULE` が未設定、または AppDir cache に存在しない場合に、cache にある `im-wayland` へ救済する。cache に存在する指定は尊重する。X11 の未設定・不明な指定は `XMODIFIERS` がある場合だけ `im-xim` へ救済する。`GTK_IM_MODULE_FILE` は AppDir 同梱 GTK 用 cache を使い、ホスト GTK module との ABI 混在を避ける
- 従来の X11 経路を試す場合は `LOTT_GDK_BACKEND=x11 /path/to/Local\ Transcription\ for\ Therapy.AppImage` とする。ユーザーが明示した `GDK_BACKEND` / `GTK_IM_MODULE` / `XMODIFIERS` は通常の起動では上書きしない
- テキスト欄クリックで固まる場合は、まず `pgrep -af lott` で PID を確認し、`tr '\0' '\n' < /proc/<pid>/environ | rg 'GDK_BACKEND|GTK_IM_MODULE|GTK_IM_MODULE_FILE|XMODIFIERS'` で実効値を記録する。Wayland と X11 の両方を `LOTT_GDK_BACKEND` で比較し、`journalctl --user` の `webkit` / `gtk` / `ime` / `wayland` 関連ログを採取する。合成クリック・キー注入を検証手順に使わず、物理操作で再現した場合だけ必要に応じてメインプロセスと WebKit 子プロセスを gdb attach する
- CachyOS / Arch 向けのホスト側パッケージ（`packaging/arch`）は削除した。CachyOS / NVIDIA 実機（RTX 2070 SUPER）ではDMA-BUF renderer有効時に起動できなかった記録があるため、**アプリ自身が `run()` の冒頭（GTK / WebKit 初期化前。`configure_webkit_dmabuf_workaround`）で、NVIDIA プロプライエタリカーネルドライバー（`/proc/driver/nvidia/version` が存在）を検出した場合に `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` を自動設定する**（AppImage / deb 共通）。ユーザーが `WEBKIT_DMABUF_RENDERER_FORCE_SHM` / `WEBKIT_DISABLE_DMABUF_RENDERER` を設定済みなら尊重し、`LOTT_ENABLE_DMABUF_RENDERER=1` ならなにもしない（DMA-BUFのハードウェア経路の再検証用）。X11は強制しない。判定は純粋関数 `should_force_webkit_shm`。同梱 WebKitGTK（Ubuntu 24.04 の `libwebkit2gtk-4.1`）が FORCE_SHM に対応するかは未確認で、版はビルドログ（Dockerfile が `dpkg-query` で出力）で確認する
- **`WEBKIT_DISABLE_DMABUF_RENDERER=1` を既定に戻さないこと。** この変数はtransport modeを空にするため、DMA-BUFだけでなく `AcceleratedBackingStore`（合成器）ごと無効化し、非アクセラレーション経路へ落ちてスクロールが目に見えてカクつく。`WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` はDMA-BUFだけを避けて合成器を維持するため、起動不能なGBM経路を通らずに描画性能を保てる（2026-08-28にRTX 2070 SUPER実機で確認）。非アクセラレーション経路では `WEBKIT_SKIA_CPU_PAINTING_THREADS` / `WEBKIT_FORCE_VBLANK_TIMER` / `WEBKIT_SHOW_DAMAGE` が軒並み無効になるため、これらが無反応でも仮説の否定と読まないこと。`WEBKIT_SHOW_DAMAGE=1` で赤い矩形が出るかどうかが合成器の生存確認になる

### AppImage とホストコマンドの分離（LD_LIBRARY_PATH 漏れ）

linuxdeploy 製 AppRun は `LD_LIBRARY_PATH` の先頭へ `$APPDIR/usr/lib` を入れる。これは**子・孫プロセスにも継承される**ため、AppImage から起動したホスト側コマンドが同梱ライブラリを掴んで壊れる。実害として、Ubuntu 24.04 の `libreadline.so.8`（8.2）は Arch 系ホストの bash 5.3（readline 8.3 リンク）が要求する `rl_print_keybinding` を持たず、`/bin/sh` が

```text
/bin/sh: symbol lookup error: /bin/sh: undefined symbol: rl_print_keybinding
```

で即死する。`/usr/bin/xdg-open` は `#!/bin/sh` スクリプトなので、外部リンク・フォルダを開く操作が丸ごと失敗する（0.9.8 の AppImage で確認）。

- **ホスト側コマンド（`xdg-open` / `curl` / `tar` / `kill` / PATH 上の ffmpeg など）を起動するときは `apply_host_command_env` を必ず呼ぶ**。`$APPDIR` 配下を指す `LD_LIBRARY_PATH` / `PATH` / `GST_*` / `G*_MODULE*` / `PYTHONHOME` 等を子プロセス環境から取り除く（AppImage 以外では no-op）。ライブラリ単位のもぐら叩きにせず、この境界で塞ぐ
- **同梱バイナリ（同梱 ffmpeg・ggml 音声エンジン）には適用しない**。AppDir 内のライブラリが必要で、剥がすと動かなくなる
- 過去の 0.9.8 では同梱 Python の `readline` 拡張モジュールが `libreadline.so.8` を AppDir へ引き込んでいた。Python を同梱しなくなったため通常は混入しない。`setup-build-tools-linux.sh` の `libreadline.so.8` チェックは、もう除外処理ではなく**検出のための検査**（残っていればビルドを落とす）
- 外部リンクを開く `xdg-open` の呼び出しは、外部サイトを開くボタンの削除とともに無くなった。今後 `spawn()` して待たない子プロセスを足す場合は、ゾンビが積もらないよう回収用スレッドで `wait()` する

## Proofreading Policy

- 校正はルールベースで、Tauri/Rust 側で完結する。LLM による校正・全体校正は無い
- 句読点付与は LLM を使わずルールだけで行う（文字起こし直後・話者分離のやり直し後とも `runProofread(..., 'punct')`）。カウンセリング会話のフィラー・相づちは常に保持する。whisper.cpp には句読点入りの例文（`ggml_speech::FILLER_PROMPT`）を毎回渡しており、Whisper がその書き方をまねて句読点を付けるため（実測で99%以上の行が句読点で終わる）。ルールがするのは、日本語の直後の半角「?」「!」の全角化（`normalize_ja_symbol_width`）と、句読点で終わらない行の末尾の補完だけ。「まあ」「ので」などの後に読点を足す規則（`force_comma_after`）は、句読点を含む行には適用しない
- ルールベース校正定義: `src-tauri/resources/proofread/punctuation_rules/`
- 校正・推論のために会話データを PC 外へ送る経路を作らない。将来ローカル推論を再導入する場合も、loopback限定バリデーションを必須とする（Non-Negotiable Constraints 参照）

### Named Entity Warning Priority

- 氏名、氏名としても使われる地名、ローカルな地名など、個人の特定につながりうる候補は最優先で扱う。ある程度の誤検出は許容し、語の一部に含まれる場合も注意喚起対象にする。UI では最も強い警告として赤字表示を基本とする。
- `〜病院`、`〜学校`、`〜相談室`、`...さん` など、直前に特定可能な名称が来やすい語は正規表現や敬称ルールで拾う。これは二段目の注意喚起として扱い、UI では黄色系の警告表示を基本とする。
- `personNames` は頻度だけで判断しない。統計上は多くなくても、地名候補・駅名候補・地域名候補のうち「名字や名前として聞いたことがある」「有名人にいそう」と判断できるものは、個人名優先で積極的に `personNames` へ移す。

## 音声入力（編集画面のマイク入力候補生成）

編集画面の各行の編集欄右側（matSuffix）にあるマイクボタンで最大15秒録音し、編集欄へ挿入する候補を作る。Full 版・Editor 版とも whisper.cpp を使い、Gemma / llama-server / mmproj は使わない。

- 実装: `generate_whisper_voice_input_candidates_blocking`（`src-tauri/src/lib.rs`）。モデルは `VOICE_INPUT_WHISPER_MODEL = turbo`（文字起こしの既定と同じ）
- フィラー例文（`FILLER_PROMPT`）付きの**1回だけ**実行し、候補は**1件**。以前は例文なしの2回目も実行して候補2件にしていたが、待ち時間を優先して1回にした。前後行の文脈は渡さない（Whisper のプロンプトに入れると、話していない語が紛れ込むため）
- **Full 版**: セットアップ済みの文字起こし用 whisper.cpp を使う。GPU（Vulkan）が選べれば GPU、無ければ `-ng` で CPU 実行する。文字起こしモデルが未準備ならセットアップ完了を案内する。追加パックは不要
- **Editor 版**: 同じ whisper.cpp の Vulkan ビルドを `-ng` 付きで常に CPU 実行し、GPU 列挙や Vulkan ドライバーに依存しない。開発版では `python_sidecar/speech-engines/whisper/`、Windows リリース版では同梱 `resources/speech-engines/whisper/` を使う。設定タブの「音声入力パック」は Whisper large-v3-turbo と Silero VAD（約1.6GB）のみを固定 revision・SHA-256検証・中断再開で取得し、モデルは `app_local_data_dir()/models/` に置く。Editor 版に NeMo・Python・llama-server・ffmpeg は同梱しない
- 音声入力は `WHISPER_VOICE_INPUT_ACTIVE` で同時実行を1つに制限する

## 旧エディションのデータ削除（設定タブ）

リリース版の設定タブは、旧エディション（CUDA / AMD / CPU 版）が残したデータを一覧・削除できる（`legacy_cuda_data_items` / `list_legacy_cuda_data` / `delete_legacy_cuda_data`）。

- Full 版の対象: 旧 pyannote モデル、旧 Gemma 4 E4B / 12B（`gemma-4-12b-it` ディレクトリ全体を含む）、faster-whisper の HF キャッシュ、旧 `resources/python312`・`resources/llama-server`・`resources/llama-server-vulkan`、旧 pip 作業キャッシュ、`proofread-model-tier.txt`、`python312-site-packages`、`llm-engine` / `lemonade` キャッシュ
- Editor 版の対象: 旧 E4B 本体・MTP・mmproj、`llm-engine` 内の CPU llama.cpp と `downloads`、旧 `lemonade` キャッシュ、旧ダウンロード版 ffmpeg
- whisper.cpp / Nemotron / Silero VAD のモデルは削除対象にしない。開発ビルドには一覧を表示しない
- 削除はサーバー側（Rust）で対象を決め直し、画面から渡されたパスは使わない（任意のフォルダを消せる経路を作らない）
- NSIS のバックグラウンド更新（`/UPDATE`）は旧版アンインストールを省略するため、削除済み資源が残る場合がある

## GPU の選択と CPU 要件

- 複数 GPU の機種では、iGPU 以外を優先し、その中で VRAM が最大の GPU を自動選択する。設定タブでユーザーが選べる形式を残す（`src-tauri/src/gpu_select.rs`。Vulkan の並び = `GGML_VK_VISIBLE_DEVICES` の番号を whisper.cpp / NeMo-Speech.cpp に渡し、設定は GPU の UUID で保存する）
- Vulkan の GPU が無い場合は CPU で動かす。この場合だけ起動時（`cpu_startup_check`）に最低要件を確認する: RAM 16GB以上（`CPU_MINIMUM_MEMORY_BYTES`）、AVX2、論理スレッド8以上（`CPU_MINIMUM_LOGICAL_THREADS`）。満たさなければ不足項目を示して終了し、満たす場合も CPU 処理と処理時間（音声時間の約1.5〜2.5倍）の注意を毎回表示する
- CPU 処理は利用者に必ず分かるようにする。文字起こし画面に「処理装置: GPU（名前）/ CPU（理由）」を常時表示し、処理中は状況表示に「（CPUで処理中）」を添え、話者分離が GPU 失敗で CPU に切り替わったときは結果画面に案内する（結果の `diarization.gpuFallback`）。開発ビルドでは `LOTT_DEV_FORCE_CPU=1`（`scripts/run-dev.bat --cpu` / `run-dev.sh --cpu`）で GPU を無いものとして扱い（`gpu_select::dev_force_cpu`。リリースビルドでは無視）、画面に「開発オプション: CPU強制」を表示する
- GPU ドライバー案内（`src-tauri/src/gpu_driver.rs`）: Windows で NVIDIA / AMD / Intel の表示装置があるのにドライバーの問題（問題コード・Microsoft 基本ディスプレイ アダプター）がある、または Vulkan の GPU が見つからない場合に、ドライバーの導入・更新を案内する（起動ダイアログとバナー）。仮想マシンの表示装置は対象外
- GPU ドライバーが無く System32 に `vulkan-1.dll` が無い PC でも CPU 実行できるよう、同梱の Vulkan ローダー（`resources/speech-engines/vulkan-loader`）を PATH 経由で使う（`ensure_bundled_vulkan_loader_on_path`）。エンジン exe の隣には置かない（新しいシステム側ローダーを隠さないため）

## Stable Areas / Avoid Touching Without Explicit Request

できるだけ触れないところ:

- 文字起こし・話者分離の実行部分（Rust）: `execute_ggml_transcription` / `execute_ggml_diarization` / `run_ggml_engine_process` / `decode_audio_to_private_wav`（`src-tauri/src/lib.rs`）と `src-tauri/src/ggml_speech.rs`。whisper.cpp の引数（探索幅・VAD・フィラー例文）や NeMo の呼び出しは実測に基づく（`docs/ggml-speech-engine-design.md`）
- LGPL 構成の ffmpeg CLI 経路・`FFMPEG_BIN` 注入。Apache-2.0 配布の前提なので、GPL ffmpeg・PyAV・imageio-ffmpeg を戻さない
- 話者分離の Nemotron 配置ポリシー、話者表示初期値
- 保存形式（JSON / DOCX / XLSX）と出力表カラム
- loopback 限定の原則。プライバシー境界なので、緩和する場合は必ず明示合意を取る

## Output and Save Formats

- Primary runtime data is JSON
- Save options:
  - JSON file save
  - Word `.docx` save (table layout)
  - Excel `.xlsx` save (table layout)
- Output table columns:
  - 時刻（1列内で start/end を改行表示）
  - 話者
  - 内容

## Distribution Strategy

**現行方針（2026-09-29）: 配布は Full 版と Editor 版の2つ。Windows（NSIS）と Linux（deb + AppImage）を対象とする。Linux は Docker 経路でのビルドと AppImage の起動を WSL2 で確認済み。実機での GPU 実行は未検証。** 音声エンジンは Vulkan（NVIDIA / AMD / Intel 共通）で動かし、GPU が無い PC では CPU で動かす。LLM・Python は含めない。CUDA 版・AMD (ROCm) 版・CPU 版は削除した。

1. Full version（**主配布**。旧称「Vulkan 版」）
   - identifier `net.gakkousya.lott`。文字起こし（whisper.cpp）・話者分離（NeMo-Speech.cpp + Nemotron-3-Diarization）・ルールベース句読点付与・音声入力を含む
   - NSIS インストーラー配布（`scripts/setup-build-tools.bat`。`--vulkan` は旧名として受け付ける）
   - 同梱: `resources/speech-engines`（whisper.cpp / NeMo-Speech.cpp の Vulkan ビルドと Vulkan ローダー）、`resources/ffmpeg`（LGPL）、VC++ ランタイム、ルールベース校正定義
   - 配布ファイル名のトークンは `vulkan`（`LoTT-vX.Y.Z-windows-x64-vulkan-setup.exe`）
   - Linux: deb + AppImage（`scripts/build-appimage-docker.sh`。`LoTT-vX.Y.Z-linux-x64-vulkan.{AppImage,deb}`）。同梱物は whisper.cpp / NeMo-Speech.cpp（Vulkan）と LGPL ffmpeg。Vulkan ローダーはホストに無い場合だけ使うフォールバックとして専用ディレクトリに同梱し、ICD は同梱せずホストのものを使う
2. Editor version
   - identifier `net.gakkousya.lott-editor`。JSONの校正・編集向けの軽量構成。文字起こしタブは無い。マイク音声入力は whisper.cpp を常にCPU実行
   - Windowsリリースには `resources/speech-engines/whisper/` のみを同梱する（NeMo・ffmpegは含めない）。WhisperモデルとSilero VAD（約1.6GB）は設定タブから取得する
   - `scripts/setup-build-tools.bat --editor` が `prepare-vulkan-bundle-windows.ps1 -WhisperOnly` を呼ぶ
   - ビルド済みインストーラーをWeb配布
   - Linux: deb + AppImage（`build-appimage-docker.sh --editor`。`LoTT-vX.Y.Z-linux-x64-editor.{AppImage,deb}`）。whisper.cpp のみ同梱し、NeMo・ffmpeg は含めない。音声入力は常にCPU実行

Tauri build 設定:

- `src-tauri/tauri.conf.json` が Full 版 / Windows NSIS の配布設定（フック `nsis/full-hooks.nsh`）
- リポジトリ直下の override: `tauri.dev.windows.override.json`（Full の dev）、`tauri.editor.windows.override.json`（Editor 配布。`nsis/editor-hooks.nsh`）、`tauri.editor.dev.windows.override.json`（Editor の dev）。Linux 用は `tauri.linux.override.json`（Full の deb + AppImage 配布。deb の依存に `libvulkan1` を含む）、`tauri.editor.linux.override.json`（Editor 配布）、`tauri.dev.linux.override.json`（Full の dev）、`tauri.editor.dev.linux.override.json`（Editor の dev）
- Full と Editor は `identifier` を分け、同一PCに併存できるようにする
- override の `nsis` ブロックは基底設定をシャロー上書きするため、`installerHooks` を明示する
- Linux の配布ビルドは Ubuntu 24.04 Docker 経路（`scripts/build-appimage-docker.sh`。引数なし = Full、`--editor` = Editor）。両スクリプトは不明なオプションをエラー終了する。実機検証は未実施
- Windows / Linux とも、規約名の成果物は `dist/v{version}/` に揃う（`scripts/collect_release_artifacts.py`）

### NSIS ビルド時の注意点

- **ビルドは `scripts/setup-build-tools.bat` を実行するだけ**。前提確認・音声エンジンの準備・LGPL ffmpeg 取得・ライセンス収集・`cargo tauri build` を一括で行う
- **ビルド時にインターネット接続が必要**（エンジンのソース取得、ビルド用 Python、ffmpeg）。取得済みの場合はスキップされる
- ビルド用 Python（3.12 embeddable）は `%LOCALAPPDATA%\lott-ggml-speech-build\python-3.12.10-build\` に置く。アプリには同梱せず、`setup_ffmpeg_lgpl.py`・`collect_licenses.py --no-python`・`collect_release_artifacts.py` にだけ使う。`PYTHON_VERSION` は `scripts/prepare-vulkan-bundle-windows.ps1` で管理し、`setup-build-tools.bat` の参照パスと同時に直す
- **バージョン番号は `src-tauri/tauri.conf.json` の `version` フィールドで管理**。ビルド出力ファイル名（`*_x64-setup.exe`）に反映されるためリリース前に更新する
- **NSIS フックは `src-tauri/nsis/full-hooks.nsh`**（Full 版）/ `editor-hooks.nsh`（Editor 版）。旧版が作った実行時ポリシーマーカーや旧実行ファイルは上書きインストール時に削除する。バックグラウンド更新（`/UPDATE`）ではアンインストール時のクリーンアップを省略する
- 詳細は `docs/release-build-windows.md` を参照

## Hardware Policy

- 音声エンジンは Vulkan（NVIDIA / AMD / Intel 共通）。GPU が無い場合は CPU（最低要件を満たすときのみ）
- ハードウェア拡張時も、オフライン要件とデータ保護要件を維持する

## Engineering Priorities

1. Privacy and offline integrity
2. Stable operation and recoverability
3. Clinical workflow usability
4. Performance optimization (GPU/CPU)

## Agent Working Rules

- オフライン制約を崩す提案/実装をしない
- PC外のAPI依存を追加しない
- 既存3機能（文字起こし/話者分離/校正）を毀損しない
- 変更は小さく段階的に実施し、検証可能な単位で提出する
- ユーザー可視仕様の変更時は影響範囲を明示する
- セキュリティ/プライバシーに関わる変更は必ず明記する
- コミットメッセージに AI ツール名の `Co-authored-by` / `Co-Authored-By` trailer（例: Claude など）を追加しない。GitHub 上で共同編集者表示になるため、必要な場合でも明示合意を取る。

## Out of Scope (Unless Explicitly Requested)

- 常時オンライン接続が必要な機能
- クラウド推論前提の音声処理
- 会話/音声データを PC 外へ送信する設計

## Frontend Patterns

### mat-icon の正しい使い方

このプロジェクトでは `material-symbols-outlined` フォントを使用している。`mat-icon` を使う際は必ず `class="material-symbols-outlined"` を付けること。付けないとアイコン名がテキストとして表示される（冒頭数文字が見える状態になる）。

```html
<!-- 静的アイコン -->
<mat-icon class="material-symbols-outlined">check_circle</mat-icon>

<!-- 動的アイコン（1行で書く・改行を入れない） -->
<mat-icon class="material-symbols-outlined">{{ condition ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>

<!-- サイズ指定する場合（SCSS側） -->
.my-icon {
  font-size: 18px;
  width: 18px;
  height: 18px;
  line-height: 18px;  /* font-size と揃える */
}
```

- `[fontIcon]` バインディングは使わない（クラスベースのフォント設定と相性が悪い）
- テキスト補間 `{{ }}` 内に改行・インデントを入れない（リガチャが解決されなくなる）

### キーボードショートカットの追加方法

**同じイベント名の `@HostListener` を複数のメソッドに付けてはいけない。** Angular はホストリスナーをイベント名をキーにしたマップで保持するため、`@HostListener('window:keydown')` を2つ以上宣言すると**最後の1つだけが登録され、それ以前のものはエラーも警告も出さずに無効化される**。「実装したのにキーが効かない」の主因はこれ。

- keydown の入口は `app.component.ts` の `onWindowKeydown` **1つだけ**。ショートカットを増やすときは、そこから呼ぶハンドラを足す（`onWindowFindShortcut` / `onWindowTextUndoRedo` / `onWindowPlaybackShortcut` と同じ形）。先行ハンドラが `preventDefault()` したら後続は動かさない。
- 判定は **`event.code` を優先**し、取れないときだけ `event.key`（小文字化）へフォールバックする。Ctrl+Shift 押下中や IME 変換中は `event.key` が大文字化・`Process`・`Unidentified` になることがあり、`key` だけ見ていると無反応になる。
- 再生操作など文字入力でないショートカットは **`event.isComposing` で早期 return しない**。日本語変換中に効かなくなる。
- 反応しないケースを作らない。条件を満たさないときは snackbar で理由を出す。ただし**再生中は再生コントロールの snackbar が出しっぱなし**（`PlaybackControlSnackbarComponent`、`duration: 0`）で、`MatSnackBar` は同時に1つしか表示しないため、再生中に発火しうるハンドラから `snackBar.open()` を呼ぶと再生コントロールが消える。
- 動作確認用のプローブ: `demo_data/key-probe/`（コミット対象外）。Windows / Linux 両方で届くキーだけを採用する。

## Important References

- Main UI: `frontend/src/app/app.component.ts`
- Main template: `frontend/src/app/app.component.html`
- Tauri commands: `src-tauri/src/lib.rs`
- ggml speech engines (transcription / diarization runner): `src-tauri/src/ggml_speech.rs`、`execute_ggml_transcription` / `execute_ggml_diarization`（`lib.rs`）
- GPU selection: `src-tauri/src/gpu_select.rs`
- GPU driver hint: `src-tauri/src/gpu_driver.rs`
- Encrypted export (DOCX / XLSX / AES ZIP): `src-tauri/src/export_crypto.rs`
- Punctuation rules: `src-tauri/resources/proofread/punctuation_rules/`
- ggml speech engine design (measurements, decisions): `docs/ggml-speech-engine-design.md`
- Build guide: `docs/release-build-windows.md`
- Development guide (human-facing): `docs/development.md`
- Troubleshooting (human-facing): `docs/troubleshooting.md`
