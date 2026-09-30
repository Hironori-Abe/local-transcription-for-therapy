# トラブルシューティング

現在の配布は Full 版（Vulkan。GPU が無ければ CPU）と Editor 版です。Windows と Linux（deb / AppImage。Linux は未検証）を対象とし、後半に Linux 向けの項目があります。

## 「GPU のドライバーを確認してください」と表示された

- Full 版は起動時に Vulkan の GPU を探します。NVIDIA / AMD / Intel の GPU が PC にあるのに、ドライバーが入っていない・Windows 標準の表示ドライバー（Microsoft 基本ディスプレイ アダプター）で動いている・ドライバーが古くて Vulkan の GPU として見つからない場合に、起動時ダイアログと画面上のバナーでドライバーの導入・更新を案内します。
- GPU メーカー（NVIDIA / AMD / Intel）の公式サイトから、この GPU 用の最新ドライバーを入れてアプリを起動し直してください。ノート PC で GPU が2つある場合は、両方のドライバーを確認してください。
- ドライバーを入れなくても、そのまま CPU で処理できます。ただし時間がかかります（下記）。仮想マシンの表示装置（Hyper-V・VMware など）は案内の対象外です。
- 案内文を開発環境で再現するには、デバッグビルドで環境変数 `LOTT_DEV_GPU_DRIVER_SCENARIO=missing`（未導入）または `old`（古い）を指定します（[開発ガイド](development.md#実行環境エミュレーション)）。

## GPU が無い / CPU のみで動かしたい

- Full 版は、Vulkan の GPU が見つからない場合に自動で CPU で処理します。CPU 用の別エディションはありません。
- GPU が使えず CPU で処理する場合の最低要件は、RAM 16GB以上、AVX2 対応 CPU、8論理スレッド以上（4コア / 8スレッド以上）です。起動時に確認し、満たさない場合は不足項目を表示してアプリを終了します。満たす場合も、CPU で処理する旨と処理時間の注意を毎回表示します。
- CPU 処理は時間が長いため、お試し用途向けです。処理時間の目安は音声時間の約1.5〜2.5倍ですが、CPU 性能によりさらに長くなる場合があります。日常的・継続的な利用には GPU 搭載 PC をお勧めします。
- Editor 版の音声入力は常に CPU で動かします。GPU は不要です。

## GPU ドライバーが全く入っていない PC で動くか

- whisper.cpp / NeMo-Speech.cpp の実行ファイルは Vulkan のローダー（`vulkan-1.dll`）を読み込みます。GPU ドライバーが無く System32 にローダーが無い PC では、同梱のローダー（`resourcesspeech-enginesulkan-loader`）を使って CPU 実行で起動します。それでもエンジンが起動しない場合は、GPU メーカーのドライバーを導入してから再試行してください。

## VRAM 不足・処理が進まない

- 他の GPU 利用アプリ（ゲーム、動画編集、ブラウザのハードウェアアクセラレーションなど）を終了してから再試行してください。
- 複数の GPU がある PC では、設定タブで使う GPU を切り替えられます。VRAM が小さい GPU が選ばれている場合は、VRAM の大きい GPU を選んでください。

## 意図しない GPU が使われる

- 複数の GPU がある PC では、内蔵 GPU 以外で VRAM が最大の GPU を自動選択します。設定タブで別の GPU を選べます。選択は GPU の UUID で保存されます。

## cargo が見つからない

- `cargo metadata ... program not found`
- Rustup をインストールし、ターミナル再起動後に `cargo --version` を確認してください。

## 文字起こしが「モデルが見つからない」エラーで失敗する

- 本アプリは通常運用時に自動でモデルをダウンロードしません（意図しないインターネット接続を防ぐためのフェイルクローズ設計）。文字起こしモデル（Whisper large-v3-turbo）や Silero VAD が未取得だと、不足しているファイルを示してエラーになります。
- セットアップタブから**文字起こしモデルを事前にダウンロード**してください。モデル取得はネット接続が必要な工程で、ダウンロード後はオフラインで動作します。
- ダウンロードが途中で切れた場合は、セットアップを再実行すると続きから取得します（固定 revision・SHA-256 検証）。
- 開発環境では、`scripts\setup-ggml-speech-windows.ps1` が `python_sidecar\models\` へモデルを配置します。

## 話者分離モデルが見つからない

- セットアップタブから話者分離モデル（Nemotron-3-Diarization）をダウンロードしてください。Hugging Face のアカウントやトークンは不要です。
- 開発環境では `python_sidecar\models\nemotron-3-diarization\` を参照します（`scripts\setup-ggml-speech-windows.ps1`）。
- リリースビルドでは `%LOCALAPPDATA%\{identifier}\models\` 配下を参照します。

## 旧版のデータが残っている

- CUDA / AMD / CPU 版から上書きインストールした PC では、旧版の実行資源（旧 Gemma モデル、旧 Python 環境、旧校正エンジンのキャッシュなど）が残ることがあります。リリース版の設定タブに一覧が表示され、そこから削除できます。会話データは対象に含まれません。
- NSIS のバックグラウンド更新（`/UPDATE`）は旧版のアンインストールを省略するため、削除済みの資源が残ることがあります。

## Linux 向けの項目

以下は Linux 版（deb / AppImage）の項目です。Linux 実機でのビルド・起動は未検証で、過去の調査記録を含みます。

## Linux: `libvulkan.so.1` が無くてエンジンが起動しない

- 症状: 文字起こし・話者分離を始めるとエンジン（whisper.cpp / NeMo-Speech.cpp）の起動に失敗する。エラーに `libvulkan.so.1: cannot open shared object file` が含まれる。
- 原因: Linux 版はホストの Vulkan ローダー（`libvulkan.so.1`）を優先します。ホストに無い場合は、同梱のフォールバック（`resources/speech-engines/vulkan-loader/`）をアプリが起動時に `LD_LIBRARY_PATH` へ足すため、通常はこの症状は出ません。それでも出る場合は、同梱ディレクトリが欠けている（deb 以外の手動配置など）か、ライブラリ探索の環境が上書きされている可能性があります。起動ログの `同梱の libvulkan.so.1 を LD_LIBRARY_PATH に追加しました` の有無も確認してください。GPU を使うにはホストのローダーと ICD が必要です。
- 確認方法:

```sh
ldconfig -p | grep libvulkan
```

- 対策: ローダーを導入してから、アプリを起動し直します。GPU を使う場合は、次の項目の ICD も確認してください。

```sh
# Ubuntu / Debian
sudo apt-get install libvulkan1
# Arch / CachyOS
sudo pacman -S --needed vulkan-icd-loader
```

## Linux: GPU が使われず CPU で処理される

- Full 版は、Vulkan の GPU が見つからない場合に自動で CPU で処理します（時間がかかります）。Linux では GPU ドライバー案内のバナーやダイアログは表示しません（Windows のみ）。
- 確認方法: `vulkaninfo --summary`（Ubuntu では `vulkan-tools` パッケージ）に GPU が表示されるか確認します。表示されない場合は、GPU 用の Vulkan ドライバー（ICD）が入っていません。
  - AMD / Intel: Mesa の Vulkan ドライバー（Ubuntu / Debian: `mesa-vulkan-drivers`。Arch 系: `vulkan-radeon` / `vulkan-intel`）
  - NVIDIA: NVIDIA プロプライエタリドライバー（Vulkan ICD を含む。`/usr/share/vulkan/icd.d/nvidia_icd.json` などを確認）
- ノート PC で GPU が2つある場合は、設定タブで使う GPU を選べます（内蔵 GPU 以外で VRAM が最大の GPU を自動選択します）。
- ドライバーを入れなくても CPU で処理できます。最低要件は RAM 16GB以上、AVX2、8論理スレッド以上です（Linux でも起動時に確認します）。

## Linux 開発環境: MP3の再生開始時に固まる

- 症状: `scripts/run-dev.sh` で起動した開発版へMP3を読み込み、区間再生を開始すると応答しなくなる。
- 原因: WebKitGTKが利用するホストGStreamerに `gst-plugins-good` がなく、MP3先頭のID3タグを処理する `id3demux` や、配布方針で利用するLGPLデコーダが欠落している。MP3デコーダ単体が存在してもID3タグを剥がせず、WebKitGTKが `loadedmetadata` / `error` のどちらも返さない場合がある。
- 確認方法:

```sh
gst-inspect-1.0 id3demux mpg123audiodec flacdec
```

- 対策: ディストリビューションに応じて、以下のシステムパッケージを明示的に導入する。その後、`scripts/setup-dev.sh` を再実行し、`[OK] Verified Linux audio playback dependencies` が表示されてから`run-dev.sh` を起動する。セットアップは不足を検出した場合、システムを自動変更せず、必要なコマンドを表示して停止する。

```sh
# CachyOS / Arch
sudo pacman -S --needed gst-plugins-base gst-plugins-good

# Ubuntu / Debian
sudo apt-get install gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-pulseaudio
```

### `sudo: no new privileges` でセットアップが停止する場合

CodexやVS Codeなど、権限昇格を禁止したサンドボックス内から端末を起動すると、子プロセスへLinuxの `NoNewPrivs=1` が継承される。この状態では正しいパスワードを入力しても `sudo` / `pkexec` はrootになれず、スクリプト内から制約を解除することもできない。

デスクトップのアプリケーションランチャーから独立したKonsole等を起動し、次の値が `0` であることを確認してからセットアップを実行する。

```sh
grep NoNewPrivs /proc/self/status
cd /home/seitoku/Code/local-transcription-for-therapy
bash scripts/setup-dev.sh
```

`setup-dev.sh` は `NoNewPrivs=1` を `sudo` 実行前に検出し、実行可能な端末へ移るよう案内して停止する。

## Linux AppImage: 音声ファイルを選んだ直後に固まる

- 症状: AppImage を起動してモデル等のダウンロードまでは正常。ファイル選択ダイアログで音声ファイルを選んだ直後に、進捗バーが出たまま操作できなくなる。Ubuntu では再現せず、CachyOS など Ubuntu 以外のディストロで発生する。
- 原因: Linux の WebKitGTK は `<audio>` の再生・メタデータ取得を GStreamer に委譲します。AppImage に GStreamer プラグインを同梱していないと、同梱された GStreamer コアがホストのプラグインを見つけられず（コンパイル時の既定パスが Ubuntu の multiarch のため。Arch 系は `/usr/lib/gstreamer-1.0`）、さらにバージョンも一致しないため、**利用可能な要素がゼロ**になります。`playbin` すら作れず `loadedmetadata` も `error` も返らないので、再生時間取得の Promise が未解決のまま UI が固まります。
- 確認方法（AppDir に対して実行）:

```python
# 同梱 GStreamer コアで要素を探す。すべて MISSING ならこの問題。
import ctypes, os, sys
appdir = sys.argv[1]
lib = ctypes.CDLL(os.path.join(appdir, "usr/lib/libgstreamer-1.0.so.0"))
lib.gst_init(None, None)
lib.gst_element_factory_find.restype = ctypes.c_void_p
lib.gst_element_factory_find.argtypes = [ctypes.c_char_p]
for name in (b"playbin3", b"filesrc", b"wavparse"):
    print(name, "FOUND" if lib.gst_element_factory_find(name) else "MISSING")
```

- 対策（実施済み）:
  - `tauri.*.linux.override.json` に `bundle.linux.appimage.bundleMediaFramework: true` を設定し、LGPL の GStreamer プラグインを AppImage へ同梱する。
  - 再生時間の取得を同梱 LGPL ffmpeg（`get_audio_duration_seconds`）に切り替え、WebView のメディア再生可否に依存させない。
  - WebView 側で読むフォールバック経路にタイムアウトを入れ、どの環境でも固まらないようにする。
  - AAC（m4a / mp4 / aac）は LGPL プラグインにデコーダが無いため、再生時のみ同梱 ffmpeg で FLAC へ変換して配信する。初回だけ「再生用に音声を変換しています」と表示され、以降はキャッシュを使う。
- ビルド時に `[ERROR] AppDir に GStreamer プラグインがありません` で失敗する場合は、ビルドホスト（Docker イメージ）に `gstreamer1.0-plugins-base` / `-good` が入っているか確認してください。GPL の `gstreamer1.0-plugins-ugly` / `gstreamer1.0-libav` は配布ライセンス方針により追加してはいけません。

## Linux AppImage: リンクやフォルダを開く操作が無反応になる / `rl_print_keybinding` エラー

- 症状: AppImage を起動でき、ウィンドウも出るが、外部リンクや「フォルダを開く」を押しても何も起きない。`journalctl --user` に次が出る。

```text
/bin/sh: symbol lookup error: /bin/sh: undefined symbol: rl_print_keybinding
```

  同時に `xdg-open` のゾンビプロセスがアプリの子として残る。CachyOS / Arch 系ホストで再現し、Ubuntu では再現しない。
- 原因: linuxdeploy 製の `AppRun` が `LD_LIBRARY_PATH` の先頭に `$APPDIR/usr/lib` を入れ、それが子・孫プロセスまで継承されます。ビルドホスト（Ubuntu 24.04）の `libreadline.so.8` は 8.2 で、Arch 系ホストの bash 5.3 が要求する `rl_print_keybinding` を持ちません。`/usr/bin/xdg-open` は `#!/bin/sh` スクリプトなので、ホストの `/bin/sh`（= bash）が同梱 readline を掴んだ時点で起動に失敗します。同梱 readline は、当時同梱していた Python の `readline` 拡張モジュールに引っ張られて AppDir に入っていました。現在は Python を同梱しないため通常は混入しません。
- 手元での再現（GPU 不要）:

```bash
# 実行中の LoTT の環境をそのまま使う
APP_PID=$(pgrep -n lott)
APP_LD=$(tr '\0' '\n' < "/proc/$APP_PID/environ" | sed -n 's/^LD_LIBRARY_PATH=//p')
LD_LIBRARY_PATH="$APP_LD" /bin/sh -c 'echo shell-ok'
```

- 対策（実施済み）:
  - ホスト側コマンド（`xdg-open` / `kill` / `curl` / `wget` / `tar` / PATH 上の ffmpeg など）と、ggml 音声エンジン（`RUNPATH=$ORIGIN` の自前ビルドで、隣のライブラリとホストの GPU ドライバーだけを使う）の起動時に、`$APPDIR` 配下を指す `LD_LIBRARY_PATH` / `PATH` / `GST_*` などを子プロセス環境から取り除く（`apply_host_command_env`）。同梱 ffmpeg には適用しない。
  - Python を同梱しなくなったため readline は通常混入しない。ビルド時に `libreadline.so.8` が AppDir に残っていないことを検査し、残っていればビルドを落とす（検出のみ）。
  - `xdg-open` の子プロセスを回収し、ゾンビを残さない。
- 補足: この症状は「外部リンク・フォルダオープンが効かない」ものです。音声ファイルを選んだ直後のフリーズは別原因（上の GStreamer の項目）です。

## Linux: 音声ファイルの選択ダイアログが英語になる / 日本語の場所へ移動できない

- 原因: Linux の `tauri-plugin-dialog` は既定では GTK3 のファイル選択を使います。AppImage
  は GTK ランタイムを同梱しますが、ホストの GTK 翻訳カタログや `~/.config/user-dirs.dirs`
  の表示環境とは別になります。`LANG` / `LC_MESSAGES` と日本語の `xdg-user-dirs` が一致しない
  と、ダイアログが英語表示になったり、サイドバーの表示名と実パスが食い違ったりします。
- 対策: Linux ビルドだけ `tauri-plugin-dialog` の `xdg-portal` feature を有効にし、ホストの
  XDG Desktop Portal にファイル選択を委譲します。Windows/macOS の依存・ネイティブダイアログ
  経路は変更していません。
- AppImage の実行前提: ホストに `xdg-desktop-portal` と、デスクトップ環境に対応する
  backend（標準のGTK環境では `xdg-desktop-portal-gtk`）を導入してください。ポータル呼び出し
  が失敗した場合の rfd fallback に使う `zenity` も必要です。`.deb` と開発セットアップ
  （`setup-dev.sh`）ではこれらを依存・導入対象にしています。KDE では `xdg-desktop-portal-kde`
  があれば KDE のポータル backend が選ばれます。
- 確認方法:

```sh
pacman -Q xdg-desktop-portal xdg-desktop-portal-gtk zenity  # Arch/CachyOS
systemctl --user --no-pager status xdg-desktop-portal.service
cat "${XDG_CONFIG_HOME:-$HOME/.config}/user-dirs.dirs"
```

## Linux AppImage: テキスト欄をクリックすると固まる / 日本語入力ができない

- 原因: AppImage のビルドツール（linuxdeploy）が生成する GTK フックは、Wayland セッションでも一律に `GDK_BACKEND=x11` を強制していました。さらに AppImage 同梱の GTK には fcitx 用モジュールが無いため、X11 に固定されると日本語入力の経路がありませんでした。
- 対策: ビルド時にこの強制を外し、Wayland セッションでは Wayland、それ以外では X11 を既定にします。日本語入力は Wayland では fcitx5 の Wayland 経路、X11 では XIM 経由になります。
- Wayland での起動・表示に問題が出る環境では、従来の X11 経路に戻して比較できます。

```bash
LOTT_GDK_BACKEND=x11 "/path/to/Local Transcription for Therapy_0.9.8_amd64.AppImage"
```

- これで直る場合は表示バックエンド側の問題です。X11 に戻しても直らない場合は、実行中の設定を控えて報告してください。

```bash
tr '\0' '\n' < /proc/$(pgrep -n lott)/environ | grep -E 'GDK_BACKEND|GTK_IM_MODULE|XMODIFIERS'
```

## Linux / CachyOS NVIDIA: 結果一覧のスクロールがカクつく（原因確定済み）

> **注記:** この節は CUDA 版と Arch / CachyOS 向けホストパッケージ（`packaging/arch`）があった当時の調査記録です。Arch パッケージは削除済みで、以下に出てくるランチャー（`packaging/arch/lott`）の設定 `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` は削除済みです。現在はアプリ自身が、NVIDIA プロプライエタリカーネルドライバー（`/proc/driver/nvidia/version`）を検出したときに起動冒頭で `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` を自動設定します（AppImage / deb 共通。ユーザーが `WEBKIT_DMABUF_RENDERER_FORCE_SHM` / `WEBKIT_DISABLE_DMABUF_RENDERER` を設定済みなら尊重し、`LOTT_ENABLE_DMABUF_RENDERER=1` なら設定しません）。`WEBKIT_DISABLE_DMABUF_RENDERER=1` は既定にしないでください。同梱 WebKitGTK が FORCE_SHM に対応する版かは、ビルドログの `libwebkit2gtk-4.1-0` の版で確認します（対応版は未確認）。

> **結論から読む場合:** 原因と恒久対策は本節末尾の[原因の確定と恒久対策](#原因の確定と恒久対策2026-08-28確定)にあります。以下は確定に至るまでの履歴で、当時「可能性が低い」と判断した候補の記録として残しています。

> **暫定結果（2026-08-14の履歴）:** 以下は Ryzen 7 3700X / RTX 2070 Super / CachyOS / KDE Plasma Wayland の1環境を中心に行った比較結果です。当時その実機で最も良かった条件と、可能性が低くなった原因候補を記録したもので、現在の通常起動設定を示すものではありません。根本原因を確定した最終結論でもなく、`x86-64-v3`での改善も利用者による体感比較で、フレーム時間を計測した定量結果ではありません。

### 症状と切り分け条件

- 文字起こし結果の行・セグメントをスクロールすると、描画が周期的に引っ掛かる。
- 約10分・約273行のJSONを起動直後に読み込んだだけでも再現し、文字起こし、話者分離、校正の実行中に限らない。
- 症状発生時のGPU使用率は約4%で、校正等が使用したVRAMも解放済みだった。
- 同じCachyOSでも Radeon 7600M XT の開発機では滑らかだったため、データ量やディストリビューション名だけでは再現条件を説明できない。

### 比較結果

| 比較内容 | 結果 | 当時の解釈 |
| --- | --- | --- |
| `cdkTextareaAutosize`だけを外す | 変化なし | autosize単独が主因とは考えにくい |
| 固定高さvirtual scrollへ変更 | 変化なし | 可変行高や通常の行描画だけでは説明できない |
| `OnPush`変更だけを適用 | 変化なし | Angularの変更検知方式だけでは解消しない |
| 「要注意行」のみ表示 | 変化なし | 表示行数や校正ヒントの有無は主因ではなさそう |
| 直近リファクタリング前のフロントエンドを、現在のネイティブ側と組み合わせる | 変化なし | 2026-08-12〜13頃のフロントエンド変更は主因ではなさそう。旧成果物の`main-O57AABPQ.js`と一致するビルドでも確認した |
| AppImageではなくホストWebKitGTKへリンクしたpacman版 | AppImageより改善したが、カクつきは残った | AppImage同梱ランタイムの影響はあるが、WebKitGTKの同梱有無だけが原因ではない |
| `LOTT_GDK_BACKEND=wayland` | X11より悪化 | この環境ではGTK WaylandよりXWayland経路の方が良い |
| DMA-BUF rendererを有効化 | `Failed to create GBM buffer ...: 無効な引数です`が再発 | このNVIDIA環境ではDMA-BUFのハードウェア経路を使えない（後述の確定内容のとおり、回避策は`WEBKIT_DISABLE_DMABUF_RENDERER`ではなく`WEBKIT_DMABUF_RENDERER_FORCE_SHM`が正しい） |
| 互換性優先の`x86-64`から、AVX-512を含まない`x86-64-v3`へ変更 | 完全には消えないが「これまでよりだいぶマシ」 | CPU最適化レベルが描画応答へ影響している可能性が高まった。ただし単独の根本原因とは未確定 |

JSONの大きさ、GPU負荷、校正後のVRAM残留、表示行数、および上記のAngular実装3点は、少なくともこの再現条件における主因としては可能性が低くなりました。一方、ホストWebKitGTK、NVIDIAドライバー、KDE Plasma Wayland/XWayland、DMA-BUFを無効にした共有メモリ描画、CPU最適化レベルの組み合わせには未分離の要因が残っています。

### 当時の単一実機で最も良かった構成（履歴）

次の組み合わせが、2026-08-14時点のこの実機で確認できた範囲では最も良好でした。
これは後述する2026-08-23更新前の比較結果です。

- ホストWebKitGTKを使うCachyOS向けpacmanパッケージ
- CPUターゲット: `x86-64-v3`（AVX-512は不使用）
- GTK表示バックエンド: `GDK_BACKEND=x11`（Plasma Waylandセッション上ではXWayland）
- WebKit renderer: `WEBKIT_DISABLE_DMABUF_RENDERER=1`

experimental版は次のコマンドでビルドします。

```sh
bash scripts/build-cachyos-experimental-package.sh
```

成果物名は通常版と区別されます。

```text
dist/cachyos/experimental/v0.9.8/LoTT-v0.9.8-linux-x64-v3-cuda-cachyos-experimental.pkg.tar.zst
```

インストール後は通常どおり起動します。パッケージのランチャーは表示バックエンドに
ホストのデスクトップ環境の既定値を使用し、DMA-BUF rendererだけを無効化します。

```sh
lott
```

`x86-64-v3`版はAVX2 / BMI2等に対応するCPU専用です。非対応CPUでは、互換性優先の通常版を`bash scripts/build-arch-package.sh`で生成してください。以前確認したCachyOS x86-64-v4由来のAVX-512 `SIGILL`を避けるため、experimental版もAVX-512命令を静的検査で拒否します。

### 関連した別症状

- 文字起こし後半（句読点追加付近）のUI停止は、結果表示直後に先頭の話者名入力へ自動フォーカスしていた処理を外し、段階ログを追加した版で、文字起こしから句読点追加まで完走を確認した。これはスクロールのカクつきとは別問題として扱う。
- pacmanインストール後にアプリアイコンが出ない問題は、hicolorテーマの標準サイズへアイコンを配置し、ウィンドウアイコンも設定することで修正した。これも描画性能とは直接関係しない。

### 未確定事項と今後の確認候補（当時）

> このリストは2026-08-14時点のものです。主要な項目は後述の確定内容で解決しました。`x86-64-v3`で改善した理由も、非アクセラレーション経路がCPU側の処理に強く依存していたためと説明がつきます（ただしArchパッケージはホストのWebKitGTKにリンクするため、`x86-64-v3`が変えたのはLoTT本体のコードだけである点に注意）。

- `x86-64-v3`のどの最適化が差を生んだかは未特定。Rust本体、WebKitとのイベント処理、タイマー精度などを分離できていない。
- ネイティブのPlasma X11セッションは未比較。現在の`GDK_BACKEND=x11`はWaylandセッション上のXWaylandである。
- WebKitGTK、NVIDIAドライバー、Plasmaの更新で結果が変わる可能性がある。
- フレーム時間、main/WebKitプロセス別CPU時間、描画イベントの長時間タスクを計測していないため、残るカクつきのボトルネックは未確定。
- 別のNVIDIA機、別CPU、ネイティブX11セッションで同じA/B比較を行い、再現性を確認するまでは一般化しない。

当時の運用上の暫定回答は「対象のCachyOS / NVIDIA機では、ホストWebKitGTK + X11 + DMA-BUF無効 + `x86-64-v3`が最も良かった」でした。ただし、これは**単一実機での暫定的な回避構成であり、カクつきの根本原因や恒久対策を確定したものではありません**。現在の通常運用は、次の更新に記載したOS・デスクトップ環境の既定値です。

### Archパッケージの通常起動設定（履歴。現在の既定は次節）

2026-08-23の実機確認で、NVIDIA向けにランチャーが設定していたファイルや環境変数が
カクつきの一因になり得ることが分かりました。Arch/CachyOSパッケージのランチャーは現在も、
`GDK_BACKEND`と`GTK_IM_MODULE`を追加せず、OS・デスクトップ環境の既定値を使用します。
当時の確認では、`WEBKIT_DISABLE_DMABUF_RENDERER=1 lott`だけなら起動する一方、
DMA-BUF rendererが有効な通常起動は失敗し、`LOTT_GDK_BACKEND=x11`を加えるとGTK初期化に
失敗しました。このため当時は通常起動でDMA-BUF rendererを無効化していました。

> **この`WEBKIT_DISABLE_DMABUF_RENDERER=1`は現在の既定ではありません。** 次節のとおり、
> これ自体がカクつきの原因だったため、既定は`WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`へ
> 変更しました。X11を強制しない方針は変わりません。

X11/XWaylandが利用可能な別環境で比較が必要な場合だけ、次を使ってください。

```sh
LOTT_GDK_BACKEND=x11 lott
```

DMA-BUFのハードウェア経路を再検証する場合だけ、次を使って既定の設定を抑止できます。

```sh
LOTT_ENABLE_DMABUF_RENDERER=1 lott
```

旧来の非アクセラレーション経路と比較したい場合だけ、次を使います。ランチャーは利用者が
明示した`WEBKIT_*`を尊重します。

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 lott
```

この変更はCachyOS/ArchのホストGTK/WebKitGTKパッケージのランチャーだけが対象です。
AppImageのGTKフック、Windows版、CUDAの検出・推論経路は変更しません。

### 原因の確定と恒久対策（2026-08-28確定）

**カクつきの原因は、起動不能を避けるための回避策そのものでした。** 対象実機（CachyOS /
RTX 2070 SUPER / nvidia-open 610.57.04 / KDE Plasma Wayland / webkit2gtk-4.1 2.52.6）で
確定しています。

原因は2段構えです。

1. **この環境ではWebKitのDMA-BUF経路が動作しない。** GUIセッションの通常ユーザーで起動すると
   `AcceleratedSurface was unable to construct a complete framebuffer` と
   `Error 71 dispatching to Wayland display`（EPROTO）が出る。失敗しているのはGBMの
   バッファ確保そのものではなく、確保したバッファをGLのフレームバッファへ結びつける段階。
   `nvidia-drm_gbm.so` の存在、`/sys/module/nvidia_drm/parameters/modeset=Y`、
   カーネルモジュールとユーザー空間のバージョン一致（`/proc/driver/nvidia/version`・
   `modinfo`・`nvidia-utils`・`nvidia-smi` すべて 610.57.04）はいずれも正常で、
   `WEBKIT_DMABUF_RENDERER_BUFFER_FORMAT` でFourCC（`XR24` / `AR24` / `XB24` / `AB24`）を
   総当たりしても回避できない。
2. **その回避に使っていた `WEBKIT_DISABLE_DMABUF_RENDERER=1` が広すぎた。** この変数は
   WebKitのtransport modeを空にするため、DMA-BUFだけでなく `AcceleratedBackingStore`
   （合成器）ごと生成しない。結果として非アクセラレーション経路へ落ち、スクロールが
   「一旦止まってから一気に飛ぶ」挙動になっていた。

**なぜこの変数がここまで効くのか:** WebKitは**2.43.xでX11 / Wayland用の
accelerated backing storeを削除**しました。それ以前は、DMA-BUFを切っても別の加速経路が
残っていたため、この変数は比較的無害でした。削除後はDMA-BUFが唯一の加速経路になったため、
**同じ変数が「加速合成をすべて切る」意味に変わりました**。ネット上で広く推奨されている
`WEBKIT_DISABLE_DMABUF_RENDERER=1` は、この変更以前に確立された回避策です。

#### 段階の整理

| 段階 | 設定 | この実機での結果 |
| --- | --- | --- |
| 1 ハードウェアDMA-BUF | `LOTT_ENABLE_DMABUF_RENDERER=1` + `__NV_DISABLE_EXPLICIT_SYNC=1` | 起動する・滑らか・描画の乱れなし |
| 2 SHM転送 | `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` | 起動する・滑らか（**採用**） |
| 3 非アクセラレーション | `WEBKIT_DISABLE_DMABUF_RENDERER=1` | 起動するがカクつく（修正前の状態） |
| — | 設定なし | 起動しない（framebuffer不完全 → Error 71） |

**段階1と2に体感差はありませんでした。** 共有メモリへのreadbackコストは、通常のデスクトップ
UIでは知覚できるレベルではありません。そのうえで段階2を採用した理由は次のとおりです。

- **ベンダー非依存**。`FORCE_SHM` はWebKit側の設定なので、NVIDIA以外でDMA-BUFが壊れている
  環境でも同じように効く。`__NV_DISABLE_EXPLICIT_SYNC` はNVIDIA専用で他を救わない
- **副作用の報告がある**。`__NV_DISABLE_EXPLICIT_SYNC=1` はゴースト（前の描画が残る）の
  報告があり、得るものが無いのにリスクだけ取る形になる
- 段階1は `LOTT_ENABLE_DMABUF_RENDERER=1 __NV_DISABLE_EXPLICIT_SYNC=1 lott` でいつでも
  再検証できる

`packaging/arch/lott` の既定を `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` に変更しました。通常版と
x86-64-v3 experimental版は同じPKGBUILDを使うため、この1箇所で両方に反映されます。利用者が
`WEBKIT_*` を明示した場合はそれを尊重します。

### 調査時の注意点

同じ調査を繰り返さないために、今回つまずいた点を残します。

- **非アクセラレーション経路では、WebKitのチューニング・計測用変数が軒並み無効になる。**
  `WEBKIT_SKIA_CPU_PAINTING_THREADS`、`WEBKIT_FORCE_VBLANK_TIMER`、`WEBKIT_SHOW_DAMAGE` は
  いずれも合成器側の機能で、合成器が動いていなければ無反応になる。**「変化がない」ことを
  仮説の否定と読んではいけない。** どのツマミも効かないため、原因の切り分けが著しく
  難しくなる
- **`WEBKIT_SHOW_DAMAGE=1` で赤い矩形が出るかどうかが、合成器が生きているかの判定になる。**
  出なければ非アクセラレーション経路。最初にこれを確認するとよい
- **`su -` したrootシェルでアプリを起動しない。** `XDG_RUNTIME_DIR` が引き継がれないため、
  描画に到達する前に一時領域の作成に失敗して終了する。WebKitのエラーではなくアプリ側の
  エラーが出る。起動テストはGUIセッション内の通常ユーザーで行い、**毎回まず素の起動が
  成功することを基準値として確認する**
- **WebKitGTKの環境変数は記憶や推測に頼らず、実在を確認してから使う。**
  `strings /usr/lib/libwebkit2gtk-4.1.so.0 | grep -E '^WEBKIT_[A-Z_]+$'` で列挙できる
- Angular側（CDK autosizeの除去、固定高さvirtual scroll、`OnPush`、表示行数削減）は
  いずれも症状を変えなかった。フロントエンドのコード上も、仮想スクロールのビューポートに
  紐づく毎フレーム処理は存在しない。今回の症状の原因ではない

参考リンク:

- [unslothai/unsloth #9393](https://github.com/unslothai/unsloth/issues/9393) —
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` がWebKitGTK 2.44+では完全なソフトウェア描画になる、
  という同趣旨の指摘
- [Linux Graphics Issues | Tauri](https://v2.tauri.app/develop/debug/linux-graphics/) —
  公式の回避策一覧。`WEBKIT_DISABLE_DMABUF_RENDERER=1` を推奨しつつ性能低下を明記
- [WebKit Bug 262607](https://bugs.webkit.org/show_bug.cgi?id=262607) —
  NVIDIA向けにDMA-BUF rendererを無効化する提案。RESOLVED WONTFIX
