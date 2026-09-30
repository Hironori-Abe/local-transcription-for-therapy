# Linux配布ビルド（Full / Editor）

> **状態: 未検証。** ここに書いた構成・手順は Stage 3 でスクリプトを書き直したものですが、Linux 実機でのビルド・起動はまだ行っていません（Linux 環境が無いため）。実機で確認できた項目から順に、この文書の「未検証事項」を更新してください。Windows の手順は [release-build-windows.md](release-build-windows.md) を参照してください。

## 構成

Linux は Windows と同じ2エディションを配布します。形式は `.deb` と `.AppImage` です。

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

`setup-build-tools-linux.sh` の手順は次のとおりです。

1. ggml 音声エンジンを Vulkan でビルドし、`src-tauri/resources/speech-engines/` へ配置する（`scripts/setup-ggml-speech-linux.sh --backend vulkan --engines-dir ... --skip-models`。Editor は `--skip-nemo` も付ける）
2. LGPL 構成 ffmpeg を取得する（Full のみ）
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
- アプリ側は、AppImage から起動する子プロセス（エンジンを含む）に対して `apply_host_command_env` を適用し、AppRun が設定した `LD_LIBRARY_PATH` などを取り除きます。

## ホスト（利用者の PC）の前提

- **`libvulkan.so.1`（Vulkan ローダー）** は CPU 実行だけなら必須ではありません。
  - `.deb` は `libvulkan1` に依存するので、`apt` が自動で導入します。
  - ホストにローダーが無い場合、アプリが起動時に同梱のフォールバック（`resources/speech-engines/vulkan-loader/`）を `LD_LIBRARY_PATH` へ足し、エンジンは CPU で起動できます。GPU を使うには、ホストに `libvulkan1`（Ubuntu / Debian）または `vulkan-icd-loader`（Arch 系）と ICD を導入してください。
- GPU を使うには、GPU 用の ICD（Vulkan ドライバー）が必要です。Mesa（AMD / Intel の `mesa-vulkan-drivers` など）または NVIDIA プロプライエタリドライバーを導入してください。ICD が無い、または GPU が Vulkan として見えない場合は、CPU で処理します（時間がかかります）。確認方法は [トラブルシューティング](troubleshooting.md) を参照してください。
- `.deb` は `xdg-desktop-portal` / `xdg-desktop-portal-gtk` / `zenity` にも依存します（ファイル選択ダイアログをホストのポータルへ委譲するため）。AppImage では利用者が導入してください。
- Linux の起動時 CPU 確認（GPU が使えない場合の最低要件: RAM 16GB以上、AVX2、8論理スレッド以上）は Linux でも動きます（RAM は `/proc/meminfo`）。
- GPU ドライバーの導入・更新を案内するバナー（`gpu_driver.rs`）は Windows のみです。Linux では表示しません。
- 同梱の Vulkan ローダーへのフォールバックは Windows・Linux の両方にあります。Linux ではホストの `libvulkan.so.1` を `dlopen` で確認し、無い場合だけ同梱ディレクトリを `LD_LIBRARY_PATH` へ足します（AppImage の `apply_host_command_env` は、この登録済みディレクトリだけ除去対象から外します）。
- 起動時に NVIDIA プロプライエタリドライバー（`/proc/driver/nvidia/version`）を検出すると `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` を自動設定します（ユーザー指定があればそれを尊重、`LOTT_ENABLE_DMABUF_RENDERER=1` で無効化）。

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

## 未検証事項

Linux 実機でのビルド・起動は未実施です。実機で次を確認してください。

- Docker 経路で Full / Editor の deb と AppImage がビルドできること（各種検査が通ること）
- AppImage / deb の起動、ファイル選択（ポータル）、音声の再生（wav / mp3 / flac / ogg / m4a）
- `libvulkan.so.1` がある環境で、GPU（Mesa / NVIDIA）と CPU の両方でエンジンが動くこと
- `libvulkan.so.1` が無い環境の AppImage で、同梱フォールバックにより CPU 実行でエンジンが起動すること（起動ログに `同梱の libvulkan.so.1 を LD_LIBRARY_PATH に追加しました` が出ること）
- NVIDIA プロプライエタリドライバー環境で、ビルドログの `libwebkit2gtk-4.1-0` の版が `WEBKIT_DMABUF_RENDERER_FORCE_SHM` に対応し、起動・スクロールが問題ないこと
- Wayland / X11 と日本語入力（fcitx5 など）
- `libgomp` が最小構成のホストでも読まれること（`ldd` / `readelf -d` で RUNPATH を確認）
