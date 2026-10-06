# Linux配布ビルド（Full / Editor）

> **状態: 一部検証済み。** Docker 経路での Full / Editor のビルド、AppImage の起動、同梱エンジンの CPU 実行はWindows 上の WSL2（Ubuntu 26.04）で確認済み（2026-09-30）。Linux 実機（GPU・各ディストリビューション）での確認はまだで、下の「未検証事項」に残しています。Windows の手順は [release-build-windows.md](release-build-windows.md) を参照してください。

## 構成

Linux は Windows と同じ2エディションを、`.deb` と `.AppImage` の形式でビルドします。**Linux 版は、利用者自身がこの手順でビルドすることを前提にしています。** ビルド済みのファイルを GitHub Release に後から添付することもありますが、毎回ではありません。

| エディション | 内容 | Tauri 設定 |
| --- | --- | --- |
| Full（引数なし） | whisper.cpp + NeMo-Speech.cpp（どちらも Vulkan ビルド）+ LGPL 構成 ffmpeg | `tauri.linux.override.json` |
| Editor（`--editor`） | whisper.cpp のみ（マイク音声入力は常に CPU 実行）。NeMo-Speech.cpp・ffmpeg は含めない | `tauri.editor.linux.override.json` |

- Python・llama.cpp・CUDA / ROCm ランタイムは同梱しません。Python はビルド用（ffmpeg 取得・ライセンス収集・成果物整理）にだけ使います。
- GPU ドライバー（ICD）は**同梱しません**。ホストのものを使います（後述）。Vulkan ローダー（`libvulkan.so.1`）もホストのものを優先し、無い PC 向けのフォールバックとして Ubuntu の `libvulkan1` の実体を `resources/speech-engines/vulkan-loader/` へ同梱します（Full / Editor 共通。エンジンの隣には置きません）。
- `--vulkan` は Full の旧称として受け付けます（引数なしと同じ）。

## 前提

- Docker（Ubuntu 24.04 コンテナでビルドします。glibc を古めに揃えるため）。Docker デーモンにアクセスできない場合は `sudo` を付けてください。
- **ビルド時はネットワークが必要です**。エンジンのソース取得（固定 commit）、Node / Rust ツールチェーン、ffmpeg（Full のみ）を取得します。取得済みの資源はスキップされます。
- 配布物の実行時は通信しません。モデルはアプリのセットアップタブから取得します（初回のみネット接続が必要）。

## コマンド

```sh
# Full 版（.deb + .AppImage）
bash scripts/build-appimage-docker.sh

# Editor 版
bash scripts/build-appimage-docker.sh --editor

# ビルドせず、選択内容と伝播する引数だけ確認する
bash scripts/build-appimage-docker.sh --dry-run
```

`build-appimage-docker.sh` は `scripts/Dockerfile.appimage-ubuntu24` のイメージ（`lott-appimage-builder:ubuntu24`）を作り、コンテナ内で `scripts/setup-build-tools-linux.sh` を実行します。ビルド用ターゲットは `src-tauri/target-ubuntu24` です。

空きメモリが少ない場合は `JOBS=6 CARGO_BUILD_JOBS=6 bash scripts/build-appimage-docker.sh` のように並列数を制限できます。`JOBS` は音声エンジン、`CARGO_BUILD_JOBS` は Rust ビルドへコンテナ内でも引き継ぎます。

`setup-build-tools-linux.sh` の手順は次のとおりです。

1. ggml 音声エンジンを Vulkan でビルドし、`src-tauri/resources/speech-engines/` へ配置する（`scripts/setup-ggml-speech-linux.sh --backend vulkan --engines-dir ... --skip-models`。Editor は `--skip-nemo` も付ける）
2. LGPL 構成 ffmpeg を固定版（BtbN の日付付き autobuild。SHA-256 照合あり）で取得する（Full のみ）。取得済みアーカイブは `~/.cache/lott-ggml-speech-build/ffmpeg-cache/` に保存し、Docker 経路では `lott-ubuntu-ggml-speech-build` ボリューム内に残るため再ビルドで再取得しない。固定先が削除された場合の更新手順は [release-build-windows.md](release-build-windows.md) の「FFmpeg 固定版の更新」
3. ライセンスを収集する（`collect_licenses.py --no-python`）
4. `tauri build`（deb + appimage）
5. AppImage を再パッケージし、下記の補正と検査を行う
6. `scripts/collect_release_artifacts.py` で規約名の成果物を `dist/v{version}/` へ集約する

コンテナ外で直接 `bash scripts/setup-build-tools-linux.sh [--editor]` を実行することもできますが、リリースビルドは glibc 互換のため Docker 経路を使ってください。

## Dockerfile の Vulkan 依存

エンジンの Vulkan ビルドに必要な次のパッケージをイメージへ入れています: `cmake` / `ninja-build` / `glslc` / `libvulkan-dev` / `libvulkan1` / `spirv-headers` / `patchelf` / `pkg-config`、および Tauri のビルド依存（`libwebkit2gtk-4.1-dev`、`libgtk-3-dev` ほか）。`glslc` と Vulkan / SPIR-V ヘッダーの存在はイメージのビルド時に確認します。`libvulkan1` の実体とライセンス表示（`/usr/share/doc/libvulkan1/copyright`）をフォールバック用ローダーとして配布物へ複写します（`setup-build-tools-linux.sh`。無ければビルド失敗）。イメージのビルドログには `libvulkan1` と `libwebkit2gtk-4.1-0` のバージョンが `[INFO]` で出力されます（WebKitGTK の `WEBKIT_DMABUF_RENDERER_FORCE_SHM` 対応可否の確認用）。

## AppImage の方針（要約）

詳細な方針は [AGENTS.md](../AGENTS.md) の「Audio Decode / FFmpeg License Policy」以下と「Distribution Strategy」にあります。ビルド時の要点だけ挙げます。

- **GStreamer は LGPL のみ同梱**（`bundleMediaFramework: true`。`gstreamer1.0-plugins-base` / `-good` / `-alsa` / `-pulseaudio`）。GPL の `plugins-ugly` / `gstreamer1.0-libav` / `faad` は入れません。Dockerfile と `setup-build-tools-linux.sh` の二重で、GPL プラグインの混入とプラグイン欠落を検出してビルドを落とします。
- AAC（m4a / mp4 / aac）は LGPL 側にデコーダが無いため、再生時のみ同梱 LGPL ffmpeg で FLAC へ変換して配信します（Full のみ ffmpeg を同梱）。
- GTK の表示バックエンドと IME の既定値を、AppImage の GTK フックへ補正します（Wayland では `wayland`、それ以外は `x11`。`LOTT_GDK_BACKEND` で上書き可能）。
- 同梱不要な `libwayland` 系を AppDir から除去します。
- `libreadline.so.8` が AppDir に残っていないことを検査します。Python を同梱しなくなったため通常は混入せず、これは検出のための検査です。
- **`libvulkan*` と `vulkan/icd.d/*` の検査**をします。許可するのは `.../speech-engines/vulkan-loader/libvulkan.so.1` のちょうど1ファイルだけで、それ以外の `libvulkan*` や ICD（`vulkan/icd.d`）があればビルドを落とします（ホストの ICD・新しいローダーと組み合わさって不整合を起こすため）。フォールバックローダーが無い場合も失敗します。
- `whisper-cli` の存在を検査し、Full は `nemo-speech` の存在、Editor は `nemo` ディレクトリが無いことも検査します。
- エンジンは `RUNPATH=$ORIGIN` を設定し（patchelf）、隣の ggml ライブラリと `libgomp` を読みます。`libgomp`（OpenMP ランタイム）は実行ファイルの隣へ同梱します（Windows 版が VC++ ランタイムを exe の隣へ置くのと同じ考え方）。
- `patchelf` 不在、ELF の RUNPATH 設定・検証失敗、libgomp の解決・ライセンス取得失敗はエラー終了します。libgomp のライセンスは Debian / Ubuntu の copyright、または Arch / CachyOS の GPLv3 本文と GCC Runtime Library Exception を同梱します。既存エンジンの補修には `setup-ggml-speech-linux.sh --finalize-only --engines-dir DIR` を使えます（Editor は `--skip-nemo`）。配布ビルドには上記の Ubuntu 24.04 Docker 経路を使用してください。
- アプリ側は、AppImage から起動する子プロセス（エンジンを含む）に対して `apply_host_command_env` を適用し、AppRun が設定した `LD_LIBRARY_PATH` などを取り除きます。
- CachyOS 等に必要な補正・再梱包は必須です。対象 AppDir やツール/runtime が無い場合、GTK の Wayland/X11・IME 補正を確認できない場合、再梱包に失敗した場合はエラー終了し、配布成果物へ集約しません。

## ホスト（利用者の PC）の前提

- **`libvulkan.so.1`（Vulkan ローダー）** は CPU 実行だけなら必須ではありません。
  - `.deb` は `libvulkan1` に依存するので、`apt` が自動で導入します。
  - ホストにローダーが無い場合、アプリが起動時に同梱のフォールバック（`resources/speech-engines/vulkan-loader/`）を `LD_LIBRARY_PATH` へ足し、エンジンは CPU で起動できます。GPU を使うには、ホストに `libvulkan1`（Ubuntu / Debian）または `vulkan-icd-loader`（Arch 系）と ICD を導入してください。
- GPU を使うには、GPU 用の ICD（Vulkan ドライバー）が必要です。Mesa（AMD / Intel の `mesa-vulkan-drivers` など）または NVIDIA プロプライエタリドライバーを導入してください。ICD が無い、または GPU が Vulkan として見えない場合は、CPU で処理します（時間がかかります）。確認方法は [トラブルシューティング](troubleshooting.md) を参照してください。
- `.deb` は `xdg-desktop-portal` / `xdg-desktop-portal-gtk` / `zenity` にも依存します（ファイル選択ダイアログをホストのポータルへ委譲するため）。AppImage では利用者が導入してください。
- Linux の起動時 CPU 確認（GPU が使えない場合の最低要件: RAM 16GB以上、AVX2、8論理スレッド以上）は Linux でも動きます（RAM は `/proc/meminfo`）。
- GPU ドライバーの導入・更新を案内するバナー（`gpu_driver.rs`）は Windows のみです。Linux では表示しません。
- 同梱の Vulkan ローダーへのフォールバックは Windows・Linux の両方にあります。Linux ではホストの `libvulkan.so.1` を `dlopen` で確認し、無い場合だけ同梱ディレクトリを `LD_LIBRARY_PATH` へ足します（AppImage の `apply_host_command_env` は、この登録済みディレクトリだけ除去対象から外します）。
- 起動時に NVIDIA プロプライエタリドライバー（`/proc/driver/nvidia/version`）を検出すると、GTK / WebKit 初期化前に `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` と `WEBKIT_FORCE_DMABUF_RENDERER=1` を組み合わせて設定します（ユーザー指定があればそれを尊重、`LOTT_ENABLE_DMABUF_RENDERER=1` で無効化）。後者は Ubuntu の NVIDIA 判定による早期終了を回避するためで、前者により実際の hardware DMA-BUF transport は有効になりません。`WEBKIT_DISABLE_DMABUF_RENDERER=1` は既定にしません。

Ubuntu 24.04 の WebKitGTK 2.52.6 の `disable-nvidia-dmabuf.patch` は NVIDIA を検出すると SHM の追加前に戻るため、`FORCE_SHM` 単独では合成器を維持できません。[Debian #1142771](https://bugs.debian.org/cgi-bin/bugreport.cgi?bug=1142771) と [同じパッチの公式ソース](https://sources.debian.org/patches/webkit2gtk/2.52.6-1/disable-nvidia-dmabuf.patch/) を確認し、2つの設定を組み合わせます。上流の [AcceleratedBackingStore.cpp](https://github.com/WebKit/WebKit/blob/webkitgtk-2.52.6/Source/WebKit/UIProcess/gtk/AcceleratedBackingStore.cpp) では SHM を追加してから `FORCE_SHM` を判定するので、hardware transport を避けながら合成器を利用できる構成です。実際の描画性能はホストの EGL / GTK GL 初期化、ドライバー、デスクトップ環境にも依存し、実機での確認が必要です。

## 成果物名

`dist/v{version}/` に次の名前で集約されます。

```text
LoTT-vX.Y.Z-linux-x64-vulkan.AppImage
LoTT-vX.Y.Z-linux-x64-vulkan.deb
LoTT-vX.Y.Z-linux-x64-editor.AppImage
LoTT-vX.Y.Z-linux-x64-editor.deb
```

Full のトークンは Windows と同じく `vulkan` です。

## ライセンス

- Linux の配布物には次の第三者コンポーネントが入ります。表示は `NOTICE` / `THIRD_PARTY_LICENSES.md` にあります。
  - whisper.cpp / ggml（MIT）、NeMo-Speech.cpp（Apache-2.0。Full のみ）
  - `libgomp`（GCC OpenMP ランタイム。GPL-3.0-or-later WITH GCC-exception-3.1）: エンジンの隣に同梱
  - GStreamer の LGPL プラグイン（AppImage のみ）
  - LGPL 構成 ffmpeg（Full のみ）
- `--enable-gpl` / `--enable-nonfree` などを含む ffmpeg、GPL の GStreamer プラグインは配布物に含めません。

## 確認済み事項（Windows 上の WSL2（Ubuntu 26.04）（2026-09-30））

- Docker 経路で Full / Editor の deb と AppImage がビルドでき、GStreamer・libreadline・Vulkan ローダーの各検査が通ること
- 同梱の libvulkan1 は 1.3.275、WebKitGTK は 2.52.6（CachyOS / NVIDIA で FORCE_SHM の効果を確かめた版と同じ）
- 展開した AppImage の whisper-cli / nemo-speech / ffmpeg が、共有ライブラリの不足なく CPU で動くこと（15秒の音声で文字起こし・話者分離）
- AppImage のアプリが起動し、GPU が無い場合の CPU 案内と初回セットアップ画面が表示されること

WSL の最小構成の Ubuntu には、通常のデスクトップ環境なら入っている次の部品が無く、そのままでは起動できなかった（試験のときだけ別途用意した）。AppImage はこれらを同梱しない方針（ホストの Mesa・グラフィックスと衝突させないため）なので、最小構成のホストでは導入が必要になる。

- `libwayland-server.so.0`（Ubuntu: `libwayland-server0`）
- `libGLESv2.so.2`（Ubuntu: `libgles2`）
- 日本語フォント（例: `fonts-noto-cjk`）。無いと画面の日本語が □ になる

## CachyOS 上での Full 版ビルド・静的検証（2026-10-04）

Ubuntu 24.04 Docker 経路で v0.9.9 の Full 版 AppImage / deb を作成しました。検証ホストは CachyOS / AMD GPU で、NVIDIA 実機の画面操作・GPU 推論は行っていません。

| 確認対象 | 結果 |
| --- | --- |
| 最終 AppImage の展開と SHA-256 | AppImage / deb とも `SHA256SUMS.txt` が一致 |
| NVIDIA の描画設定 | 同梱 WebKitGTK 2.52.6 とアプリに2つの設定が存在。Rust の設定判定2テストが通過。Ubuntu の早期終了回避と SHM 合成器維持をソースで確認 |
| ホストのグラフィックスとの分離 | Wayland / EGL / GL / GBM / DRM / NVIDIA ライブラリを同梱せず、ホストのものを使う。ICD は0件、Vulkan ローダーは専用フォールバックの1ファイルのみ |
| 音声エンジン | Whisper の ELF 2ファイル、NeMo の ELF 17ファイルで `RUNPATH=$ORIGIN`。ローカルの libgomp を読み、CachyOS 上で両エンジンの `--help` が成功。GPLv3 本文・GCC Runtime Library Exception も収録 |
| 音声再生の同梱物 | GStreamer 106プラグイン、必要な13プラグインの存在・禁止プラグインの不在・専用 registry を確認。同梱 LGPL ffmpeg で合成音声の AAC → 16bit FLAC 変換が成功 |
| GTK の表示・IME 設定 | 最終 AppImage の hook と cache を使い、Wayland / X11 / 未同梱 fcitx 指定の救済 / 同梱 module 指定の尊重 / ユーザーの表示バックエンド指定の計7条件を確認 |
| 失敗時の配布防止 | 一時 fixture で再梱包の正常系・ツール失敗・runtime 不在・GTK hook 不在・AppDir 不在を検証。失敗時は成果物集約へ進まない |
| ホストコマンドの環境分離 | AppDir の環境除去・空 PATH の救済・専用 Vulkan ローダーの保持の既存 Rust テストが通過 |

最終 AppImage の SHA-256: `010cfbc65746fa1dc3bf98ad9f11fae429fc6b38629ede1da5c0c963f0efeaa6`。生成先は `dist/v0.9.9/LoTT-v0.9.9-linux-x64-vulkan.AppImage`（162,093,560 bytes）です。実機の起動・スクロール速度、物理操作での日本語入力、GPU での文字起こし・話者分離は下記の確認事項に残ります。

## Ubuntu 24.04 Docker での実行検証（2026-10-04）

上記と同じ v0.9.9 Full AppImage を、ビルド用イメージとは別の Ubuntu 24.04.4 LTS コンテナーで実行しました。`--network none` で通信を遮断し、GPU デバイスは渡していません。モデルはホストから読み取り専用で渡し、会話データではなく espeak-ng で生成した約10.6秒の英文音声を使いました。

| 確認対象 | 結果 |
| --- | --- |
| AppImage の画面起動 | Xvfb の X11 仮想画面で、初回セットアップ画面・CPU 案内バナー・日本語の正常表示をスクリーンショットで確認。LoTT / WebKitWebProcess の生存も確認 |
| CPU 文字起こし | 同梱 whisper.cpp + large-v3-turbo + Silero VAD で JSON 出力まで完了。生成した3文と文字起こしが完全一致。初回実行のエンジン計測は約9.7秒 |
| CPU 話者分離 | 同梱 NeMo-Speech.cpp + Nemotron を `--device cpu --preset v3-offline` で実行し JSON 出力まで完了。1話者の合成音声について、0〜10.189秒の区間を出力 |
| 同梱 GStreamer | WAV / MP3 / FLAC / OGG と、同梱 LGPL ffmpeg で AAC から変換した16bit FLACを `decodebin ! audioconvert ! fakesink` で正常デコード |
| ホストの Vulkan / OpenMP 不在 | 検証専用イメージからホストの `libvulkan.so.1` / `libgomp.so.1` を除去。AppImage の同梱ローダー自動追加ログ、画面表示、両エンジンの CPU 推論、音声デコードを確認。`ldd` で専用 Vulkan ローダーと各エンジン隣の libgomp を使用 |

AppImage は Docker の FUSE を必要としない `APPIMAGE_EXTRACT_AND_RUN=1` で起動しました。仮想画面の描画には検証環境だけで `LIBGL_ALWAYS_SOFTWARE=1` を設定し、配布アプリの既定値や WebKit の sandbox は変更していません。コンテナーには WebKitGTK を別途インストールせず、AppImage の同梱版を使っています。通常の Ubuntu デスクトップにあるフォント・描画ライブラリは検証環境に用意しました。最小構成では `libfribidi0` / `libharfbuzz0b` / `libwayland-cursor0` / `libwayland-egl1` も必要でした。

検証用 Dockerfile・スクリプト・JSON・ログ・画面画像は `src-tauri/target-ubuntu24/ubuntu-runtime-validation-v0.9.9/` に保存しています（Git 管理外）。これらの確認は GUI 起動とエンジン単体実行・デコードまでで、画面操作による一連の文字起こし、音声出力、NVIDIA GPU 実行、Wayland / IME / スクロール性能の検証ではありません。

## deb の Ubuntu 24.04 Docker 実行検証（2026-10-04）

`dist/v0.9.9/LoTT-v0.9.9-linux-x64-vulkan.deb` を、クリーンな `ubuntu:24.04` に `apt-get install --no-install-recommends /tmp/lott.deb` でインストールしました。パッケージは `local-transcription-for-therapy`、バージョンは `0.9.9`、アーキテクチャは `amd64` です。

| 確認対象 | 結果 |
| --- | --- |
| インストールと依存関係 | `apt-get check` が成功。検証用ツールを追加する前に `/usr/bin/lott` の `ldd` で不足が無いことを確認。依存関係から WebKitGTK 2.52.6、GTK 3、libvulkan1 と GStreamer base / good プラグインが導入された |
| 配置と整合性 | `dpkg --verify local-transcription-for-therapy` が差分なし。デスクトップエントリーの `Exec=lott`、アプリ・同梱 ffmpeg・両エンジンの配置と実行権限を確認 |
| 画面起動 | インストール済み `/usr/bin/lott` を Xvfb の X11 仮想画面で起動。初回セットアップ・CPU 案内バナー・日本語の正常表示と LoTT / WebKitWebProcess の生存を確認 |
| CPU 文字起こし・話者分離 | `/usr/lib/Local Transcription for Therapy/resources/` の同梱エンジンで約10.6秒の合成英文音声を処理し、両方の JSON 出力が成功。文字起こしは生成した3文と完全一致。話者分離は1話者の0〜10.189秒の区間を出力 |
| ライブラリの解決 | `LD_LIBRARY_PATH` を指定せず、両エンジンの `ldd` で各エンジン隣の同梱 libgomp とシステムの `/lib/x86_64-linux-gnu/libvulkan.so.1` を使用。共有ライブラリ不足は無し |
| 音声デコード | システムの GStreamer base / good で WAV / MP3 / FLAC / OGG と、同梱 LGPL ffmpeg で AAC から変換した16bit FLACを正常デコード |
| アンインストール | 別の使い捨てコンテナーで `apt-get remove local-transcription-for-therapy` と `apt-get check` が成功。アプリ実行ファイルと資源ディレクトリが除去され、システム WebKitGTK が維持されることを確認 |

依存関係・検証ツールの導入時だけ通信し、起動・推論・デコード・アンインストールは `--network none`、GPU デバイスなしで実行しました。モデルは読み取り専用マウント、音声は espeak-ng の合成音声です。GUI の検証環境だけで `LIBGL_ALWAYS_SOFTWARE=1` を設定し、配布アプリや WebKit の sandbox は変更していません。デコードは `fakesink` までの確認で、音声出力や画面操作による一連の処理は未検証です。

検証用 Dockerfile・スクリプト・JSON・ログ・画面画像は `src-tauri/target-ubuntu24/deb-runtime-validation-v0.9.9/` に保存しています（Git 管理外）。SHA-256 は `d9b8008f18fae77995eb954a95f411c169dcce74cf8ccf6df84368c7b88f9d0b` で、配布済みの `SHA256SUMS.txt` と一致しています。成果物の変更・再ビルドはしていません。

## Full 版の再ビルド（2026-10-05）

v0.9.9 の AppImage / deb を Ubuntu 24.04 Docker 経路で再ビルドしました。再生状態の共有化、旧データの容量表示修正、`Ctrl+Shift+P` の追加と5秒ごとのヒントの `Ctrl+Shift+Space or P` 表示を含みます。

- AppImage: `da8edbc1d51e977ca495dfc3d015b5232f5908a1309c6dce46814e3d73ed718e`（162,097,656 bytes）
- deb: `df3c990bf0ce54e96294f54564d34cfbd0ac92d19f8b012581c6875fb9e58255`（118,088,222 bytes）

成果物は `dist/v0.9.9/` に配置し、旧成果物は同ディレクトリの `previous-builds/20261005-014625/` に退避しました。ビルド時の GTK/IME・GStreamer・Vulkan ローダー等の検査と SHA-256 の照合が成功しました。通信を遮断した Ubuntu 24.04 コンテナで新 AppImage と新 deb の画面起動・日本語表示を確認し、deb のインストール・ファイル整合性・共有ライブラリの解決も確認しました。今回、NVIDIA 実機での IME 操作・GPU 実行や音声推論は再検証していません。

検証ログ・画面画像・スクリプトは `src-tauri/target-ubuntu24/linux-rebuild-validation-20261005/`（Git 管理外）にあります。ISO プロジェクトの AppImage 入力や manifest は変更していません。新しい ISO へ取り込む場合は、今回の AppImage とその SHA-256 を入力として更新してください。

## 未検証事項

実機で次を確認してください。

- AppImage / deb の、実機のデスクトップ環境での起動、ファイル選択（ポータル）、音声の再生（wav / mp3 / flac / ogg / m4a）
- `libvulkan.so.1` がある環境で、GPU（Mesa / NVIDIA）でエンジンが動くこと（WSL には GPU 用の Vulkan ドライバーが無く、CPU でしか確認できていない）
- NVIDIA プロプライエタリドライバー環境で、ビルドログの `libwebkit2gtk-4.1-0` の版が `WEBKIT_DMABUF_RENDERER_FORCE_SHM` に対応し、起動・スクロールが問題ないこと
- Wayland / X11 と日本語入力（fcitx5 など）
