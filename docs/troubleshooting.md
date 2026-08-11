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
  - **ROCm ビルドが古い**: ROCm ビルドが b9585 未満（例 b9247）だとドラフト arch `gemma4-assistant` を読めません。セットアップタブから ROCm バックエンド（`download_llama_backend_cli.py --backend rocm`、既定 b9631）を再取得してください（`~/.cache/{app-id}/lemonade/bin/llamacpp/rocm-stable/` に展開されます。`lemonade` は後方互換のキャッシュディレクトリ名で、Lemonade 本体は使いません）。
  - **対象 GPU arch の rocBLAS が無い**: ROCm 直起動は rocBLAS を system ROCm（`/opt/rocm*/lib/rocblas/library/*<gfx>*`）から解決します。dGPU の arch（例 gfx1102）の Tensile が無いと起動前ゲート（`system_rocm_tensile_has_arch`）で弾かれ Vulkan になります。system ROCm を導入してください（DL ビルド同梱の therock は iGPU arch 専用のことがあり dGPU には使えません）。
- いずれも該当しなければ Vulkan で安全に動作します（機能差はなく速度のみ）。
- 関連クラッシュ痕跡: ROCm を therock 経由で起動すると `rocBLAS error: Cannot read ... TensileLibrary.dat ... for GPU arch : gfx1102` が出ます。本アプリは therock を `LD_LIBRARY_PATH` に載せないことでこれを回避しています。

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
