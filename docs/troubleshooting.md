# トラブルシューティング

## GPU が無い / CPU のみで動かしたい

- 対応 GPU がない場合は **LoTT CPU** を使用できます。CPU 版は文字起こし・話者分離・単純な句読点付与に対応し、全体校正は搭載しません。
- CPU 版の最低要件は RAM 16GB、AVX2 対応の4コア / 8スレッドCPUです。推奨要件は RAM 24GB以上、6コア / 12スレッド以上です。
- CPU 版は処理時間が長いためお試し用であり、日常的・継続的な常用は推奨しません。処理時間の目安は音声時間の約1.5〜2.5倍ですが、CPU性能によりさらに長くなる場合があります。
- 音声入力・区間聞き直しを使う場合は、音声入力パックを導入してください。Gemma 4 E4BもCPUで実行するため、RAM 24GB以上を推奨します。

## VRAM 不足でクラッシュ・処理が進まない

- Full CUDA 版の **最低要件は VRAM 8GB** です。文字起こし・話者分離・LLM 校正を同時に走らせると VRAM 使用量が増えます。
- VRAM が不足する場合は、他の GPU 利用アプリを終了する、話者分離や LLM 校正を分けて実行するなどで使用量を抑えてください。

## cargo が見つからない

- `cargo metadata ... program not found`
- Rustup をインストールし、ターミナル再起動後に `cargo --version` を確認してください。

## CUDA/cuDNN 関連でクラッシュ

- `exit=-1073740791` など
- CUDA 12.x / cuDNN 9.x の `bin` が PATH で見えるか確認してください:

```powershell
where.exe cublas64_12.dll
where.exe cudnn64_9.dll
```

## Linux / CachyOS NVIDIA: `nvidia-smi` が無い / CUDAが検出されない

- CachyOS / Arch向けNVIDIAパッケージでは、`nvidia-utils`（`nvidia-smi` とNVIDIAユーザー空間
  ランタイム）を必須依存にしています。古いパッケージを使用している場合は、次で補完してから
  アプリを再起動してください。

```sh
sudo pacman -S --needed nvidia-utils
```

- `nvidia-utils`はカーネルモジュールを含みません。使用中のカーネルに合うCachyOSのNVIDIA
  ドライバー（`nvidia` / `nvidia-open` / `nvidia-dkms`など）を導入し、再起動してください。
- 次の2つが成功することを確認します。`nvidia-smi`が無い場合は、まずパッケージ導入状態を確認します。

```sh
command -v nvidia-smi
nvidia-smi -L
```

- モデルのダウンロード完了はCUDA利用可能の判定ではありません。アプリの「GPUを再確認」を、
  ドライバー導入・再起動後に実行してください。
- このLinux NVIDIA版では、文字起こし・話者分離・LLM校正すべてでCUDAを使用します。Linux用
  CUDA `llama-server`は公式Linux archiveではなく、llama.cpp b10075ソースからビルドして
  配布物へ同梱しています。CUDA Toolkitは実行時には不要で、Vulkan版の取得や設定も不要です。
  `nvidia-smi -L`が成功するのに校正だけ失敗する場合は、アプリを更新し、同梱サーバーの
  `resources/llama-server/cuda/LLAMA_CPP_BUILD_INFO.txt`が存在する配布物か確認してください。

## Linux AppImage: CUDA/cuDNN 混在による cuBLAS エラー

- 原因: ユーザー導入の CUDA/cuDNN が `LD_LIBRARY_PATH` に混ざると、pip 版 `nvidia-*` と異なる版が解決されることがあります。新しい AppImage は pip 版を優先します。
- 旧版の一時回避: `env -u CUDA_HOME -u LD_LIBRARY_PATH "/path/to/Local Transcription for Therapy.AppImage"` で起動してください。
- 確認:

```bash
tr '\0' '\n' < /proc/$(pgrep -n offline-transcriber)/environ | grep -E 'CUDA_HOME|LD_LIBRARY_PATH'
```

## 文字起こしが「モデルが見つからない」「オフライン」エラーで失敗する

- 本アプリは通常運用時、モデル取得ライブラリ（Hugging Face Hub）を**オフラインモードに固定**しています（意図しないインターネット接続を防ぐためのフェイルクローズ設計）。そのため、文字起こしモデル（Whisper）が未取得の状態では実行時に自動ダウンロードされず、`LocalEntryNotFoundError` / "outgoing traffic has been disabled" のようなエラーになります。
- セットアップタブから**文字起こしモデル（Whisper turbo）を事前にダウンロード**してください。モデル取得はネット接続が必要な工程で、ダウンロード後はオフラインで動作します。
- ダウンロードと文字起こしは同じアプリ専用キャッシュを参照します。セットアップで取得済みであれば、オフラインのままでも読み込めます。

## 話者分離モデルが見つからない

- `python_sidecar/models/pyannote-speaker-diarization-community-1` にモデル一式を配置してください（dev）。
- または `DIARIZATION_MODEL_PATH` を設定してください。
- リリースビルドでは `%LOCALAPPDATA%\{identifier}\models\` 配下を参照します。

## AMD ROCm: "no ROCm-capable device is detected"（Linux）

- GPU セレクターで device 1 以上を選択しているのに「ROCm デバイスが見つからない」エラーが出る場合、`ROCR_VISIBLE_DEVICES` と `HIP_VISIBLE_DEVICES` の二重フィルターが原因の可能性があります。
- ROCR が先にデバイスリストを絞り込んだ後、HIP が絞り込み済みのリストにアクセスするためインデックスがずれます。
- 修正済み（`src-tauri/src/lib.rs` で `ROCR_VISIBLE_DEVICES` を削除、`HIP_VISIBLE_DEVICES` のみ設定）。

## AMD ROCm: 話者分離が非常に遅い（旧世代 iGPU / Linux）

- Radeon 780M / 旧890M（gfx1103）では MIOpen の対応カーネルが未収録のため、GPU 話者分離に失敗します。
- `diarize_cli.py` が自動で CPU フォールバックするため処理は完了しますが、10 分音声で約 15〜20 分かかります（正常動作）。
- Ryzen AI 9 HX 370 内蔵の Radeon 890M（gfx1150）は PyTorch 2.11.0+rocm7.2 以降で GPU 話者分離・文字起こしともに動作します。

## AMD ROCm: 文字起こし中にクラッシュする（gfx1102 / RX 7600M XT）

- RX 7600M XT（gfx1102）では ctranslate2-rocm による文字起こし中に `CUDA failed with error an illegal memory access` でクラッシュすることがありました。
- 原因はデフォルトのメモリアロケータ（MallocAsync）が AMD GPU と非互換であること（OpenNMT/CTranslate2 issue #2012）。
- 修正済み: `transcribe_cli.py` が ROCm 検出時に `CT2_CUDA_ALLOCATOR=cub_caching` を自動設定します。公式 ctranslate2-rocm v4.7.1 / v4.7.2 ホイールは gfx1102 をネイティブ収録しており、RX 7600M XT で `HSA_OVERRIDE_GFX_VERSION` なしの10分文字起こしが完走することを確認済みです。
- `HSA_OVERRIDE_GFX_VERSION=11.0.0`（gfx1102 を gfx1100 として扱わせる設定）は通常運用では使用しません。`demo_data/10minutes` では、設定なしの方が既存JSONに対する文字編集距離が420から356へ約15%減り、セグメント数も既存JSONに近づきました。
- **今後、CTranslate2 / ROCm / GPUドライバー更新後に gfx1102 でクラッシュ、著しい欠落、異常な文字起こしが発生した場合は、gfx1102ネイティブ経路の互換性を最初に疑ってください。** 最初の切り分けとして、同じ音声を次の一時設定で再実行し、症状が変化するか確認します。恒久設定にはせず、確認後は必ず解除してください。

```bash
export HSA_OVERRIDE_GFX_VERSION=11.0.0
bash scripts/run-dev.sh
# 切り分け後
unset HSA_OVERRIDE_GFX_VERSION
```

- 一時設定でだけ改善する場合は、使用中のCTranslate2ホイールにgfx1102コードが含まれるか、ROCm/hipBLASLtの対象archサポートに回帰がないかを確認します。ただし、このoverrideは認識結果を変え、品質を下げる可能性があるため、互換性問題の恒久対策にはしません。
- 話者分離（pyannote + MIOpen）も gfx1102 で GPU 動作します。

## AMD: 高精度(12B)校正が ROCm にならず Vulkan（やや遅い）で動く

- 12B 校正は AMD で **ROCm 優先 → 失敗時 Vulkan フォールバック**です。ROCm 経路（約35〜37 tok/s）が選ばれず Vulkan（約28〜29 tok/s）になる主因は次のいずれか。
  - **ROCm ビルドが古い**: ROCm ビルドが b9585 未満（例 b9247）だとドラフト arch `gemma4-assistant` を読めません。セットアップタブから ROCm バックエンド（Rust 側の `install_llm_backend`、既定 b9631）を再取得してください（`~/.cache/{app-id}/lemonade/bin/llamacpp/rocm-stable/` に展開されます。`lemonade` は後方互換のキャッシュディレクトリ名で、Lemonade 本体は使いません）。
  - **対象 GPU arch の rocBLAS が無い**: ROCm 直起動は rocBLAS を system ROCm（`/opt/rocm*/lib/rocblas/library/*<gfx>*`）から解決します。dGPU の arch（例 gfx1102）の Tensile が無いと起動前ゲート（`system_rocm_tensile_has_arch`）で弾かれ Vulkan になります。system ROCm を導入してください（DL ビルド同梱の therock は iGPU arch 専用のことがあり dGPU には使えません）。
- いずれも該当しなければ Vulkan で安全に動作します（機能差はなく速度のみ）。
- 関連クラッシュ痕跡: ROCm を therock 経由で起動すると `rocBLAS error: Cannot read ... TensileLibrary.dat ... for GPU arch : gfx1102` が出ます。本アプリは therock を `LD_LIBRARY_PATH` に載せないことでこれを回避しています。

## Linux 開発環境: MP3の再生開始時に固まる

- 症状: `scripts/run-dev.sh` で起動した開発版へMP3を読み込み、区間再生を開始すると応答しなくなる。
- 原因: WebKitGTKが利用するホストGStreamerに `gst-plugins-good` がなく、MP3先頭のID3タグを処理する `id3demux` や、配布方針で利用するLGPLデコーダが欠落している。MP3デコーダ単体が存在してもID3タグを剥がせず、WebKitGTKが `loadedmetadata` / `error` のどちらも返さない場合がある。
- 確認方法:

```sh
gst-inspect-1.0 id3demux mpg123audiodec flacdec
```

- 対策: ディストリビューションに応じて、以下のシステムパッケージを明示的に導入する。その後 `scripts/setup-dev.sh` を再実行し、`[OK] Verified Linux audio playback dependencies` が表示されてから `scripts/run-dev.sh` を起動する。セットアップは不足を検出した場合、システムを自動変更せず、必要なコマンドを表示して停止する。

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
- 原因: linuxdeploy 製の `AppRun` が `LD_LIBRARY_PATH` の先頭に `$APPDIR/usr/lib` を入れ、それが子・孫プロセスまで継承されます。ビルドホスト（Ubuntu 24.04）の `libreadline.so.8` は 8.2 で、Arch 系ホストの bash 5.3 が要求する `rl_print_keybinding` を持ちません。`/usr/bin/xdg-open` は `#!/bin/sh` スクリプトなので、ホストの `/bin/sh`（= bash）が同梱 readline を掴んだ時点で起動に失敗します。同梱 readline は、同梱 Python の `readline` 拡張モジュールに引っ張られて AppDir に入っていました。
- 手元での再現（GPU 不要）:

```bash
# 実行中の offline-transcriber の環境をそのまま使う
APP_PID=$(pgrep -n offline-transcriber)
APP_LD=$(tr '\0' '\n' < "/proc/$APP_PID/environ" | sed -n 's/^LD_LIBRARY_PATH=//p')
LD_LIBRARY_PATH="$APP_LD" /bin/sh -c 'echo shell-ok'
```

- 対策（実施済み）:
  - ホスト側コマンド（`xdg-open` / `nvidia-smi` / `rocm-smi` / `rocminfo` / `kill` / `curl` / `wget` / `tar` / PATH 上の ffmpeg）の起動時に、`$APPDIR` 配下を指す `LD_LIBRARY_PATH` / `PATH` / `GST_*` などを子プロセス環境から取り除く（`apply_host_command_env`）。同梱バイナリ（同梱 Python / llama-server / 同梱 ffmpeg）には適用しない。
  - 同梱 Python の `readline` 拡張モジュールをビルド時に除外し、`libreadline.so.8` / `libhistory.so.8` を AppDir から除去する。残っていればビルドを落とす。
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
  が失敗した場合の rfd fallback に使う `zenity` も必要です。CachyOS / Arch パッケージおよび
  開発セットアップではこれらを依存・導入対象にしています。KDE では `xdg-desktop-portal-kde`
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
tr '\0' '\n' < /proc/$(pgrep -n offline-transcriber)/environ | grep -E 'GDK_BACKEND|GTK_IM_MODULE|XMODIFIERS'
```

## Linux / CachyOS NVIDIA: 結果一覧のスクロールがカクつく（履歴・暫定調査）

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
| DMA-BUF rendererを有効化 | `Failed to create GBM buffer ...: 無効な引数です`が再発 | このNVIDIA環境では`WEBKIT_DISABLE_DMABUF_RENDERER=1`を維持する必要がある |
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

インストール後は通常どおり起動します。パッケージのランチャーはホストのデスクトップ環境の
既定値を使用し、X11やDMA-BUF無効化を自動設定しません。

```sh
lott
```

`x86-64-v3`版はAVX2 / BMI2等に対応するCPU専用です。非対応CPUでは、互換性優先の通常版を`bash scripts/build-arch-package.sh`で生成してください。以前確認したCachyOS x86-64-v4由来のAVX-512 `SIGILL`を避けるため、experimental版もAVX-512命令を静的検査で拒否します。

### 関連した別症状

- 文字起こし後半（句読点追加付近）のUI停止は、結果表示直後に先頭の話者名入力へ自動フォーカスしていた処理を外し、段階ログを追加した版で、文字起こしから句読点追加まで完走を確認した。これはスクロールのカクつきとは別問題として扱う。
- pacmanインストール後にアプリアイコンが出ない問題は、hicolorテーマの標準サイズへアイコンを配置し、ウィンドウアイコンも設定することで修正した。これも描画性能とは直接関係しない。

### 未確定事項と今後の確認候補

- `x86-64-v3`のどの最適化が差を生んだかは未特定。Rust本体、WebKitとのイベント処理、タイマー精度などを分離できていない。
- ネイティブのPlasma X11セッションは未比較。現在の`GDK_BACKEND=x11`はWaylandセッション上のXWaylandである。
- WebKitGTK、NVIDIAドライバー、Plasmaの更新で結果が変わる可能性がある。
- フレーム時間、main/WebKitプロセス別CPU時間、描画イベントの長時間タスクを計測していないため、残るカクつきのボトルネックは未確定。
- 別のNVIDIA機、別CPU、ネイティブX11セッションで同じA/B比較を行い、再現性を確認するまでは一般化しない。

当時の運用上の暫定回答は「対象のCachyOS / NVIDIA機では、ホストWebKitGTK + X11 + DMA-BUF無効 + `x86-64-v3`が最も良かった」でした。ただし、これは**単一実機での暫定的な回避構成であり、カクつきの根本原因や恒久対策を確定したものではありません**。現在の通常運用は、次の更新に記載したOS・デスクトップ環境の既定値です。

### Archパッケージの通常起動設定（2026-08-23更新）

その後の実機確認で、NVIDIA向けにランチャーが設定していたファイルや環境変数が
カクつきの一因になり得ることが分かりました。Arch/CachyOSパッケージのランチャーは現在、
`GDK_BACKEND`、`GTK_IM_MODULE`、`WEBKIT_DISABLE_DMABUF_RENDERER`を未設定時に追加せず、
OS・デスクトップ環境・ホストWebKitGTKの既定値を使用します。ユーザーが既に設定している
環境変数も上書きしません。

旧構成との比較が必要な場合だけ、次の診断用起動を使ってください。

```sh
LOTT_GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 lott
```

この変更はCachyOS/ArchのホストGTK/WebKitGTKパッケージのランチャーだけが対象です。
AppImageのGTKフック、Windows版、CUDAの検出・推論経路は変更しません。
