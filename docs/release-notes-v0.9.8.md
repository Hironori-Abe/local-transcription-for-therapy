# Local Transcription for Therapy (LoTT) v0.9.8

臨床心理・カウンセリング会話の文字起こし、話者分離、文章校正を、会話データをPCの外へ送らずに実行するデスクトップアプリです。

v0.9.8では、Linux NVIDIA版の配布を開始しました。あわせて、文字起こしから句読点付与までの操作、初回セットアップとGPU検出、Linuxでの音声再生・ファイル選択・画面描画を見直しています。Windows版でも、CPU版の案内、大容量パッケージの取得、バックエンド管理などを改善しました。

## ダウンロード

| ファイル | 対象 | 備考 |
| --- | --- | --- |
| `LoTT-v0.9.8-windows-x64-cuda-setup.exe` | Windows 10 / 11・NVIDIA GPU | 主配布。CUDA 12.x / cuDNN 9.xが必要 |
| `LoTT-v0.9.8-windows-x64-cpu-setup.exe` | Windows 10 / 11・GPU不要 | 動作確認・試用向け |
| `LoTT-v0.9.8-windows-x64-editor-setup.exe` | Windows 10 / 11・GPU不要 | JSONの読込・編集・書き出しに特化 |
| `LoTT-v0.9.8-linux-x64-cuda.AppImage` | Linux x86-64・NVIDIA GPU | NVIDIAドライバーが必要。CUDA Toolkitは実行時不要 |
| `LoTT-v0.9.8-linux-x64-cuda.deb` | Ubuntu系 x86-64・NVIDIA GPU | NVIDIAドライバーが必要。CUDA Toolkitは実行時不要 |
| `LoTT-v0.9.8-linux-x64-cuda-cachyos.pkg.tar.zst` | CachyOS / Arch x86-64・NVIDIA GPU | ホストのWebKitGTK / GStreamerを利用する汎用版 |
| `LoTT-v0.9.8-linux-x64-v3-cuda-cachyos-experimental.pkg.tar.zst` | CachyOS・x86-64-v3対応CPU・NVIDIA GPU | AVX2 / BMI2対応CPU用の実験版 |
| `SHA256SUMS.txt` | — | 配布ファイルのSHA-256チェックサム |

AMD GPU版は引き続きexperimental／自己ビルド向けで、一般向けReleaseには添付しません。

ダウンロード後は、配布ディレクトリにあるチェックサムを任意で確認できます。

```sh
sha256sum -c SHA256SUMS.txt
```

## 主な変更点

### Linux NVIDIA版を追加

- NVIDIA GPU向けのAppImage、`.deb`、CachyOS / Archパッケージを追加しました。
- Linux版も、文字起こし、話者分離、Gemma 4による句読点付与・校正をCUDAで実行します。CUDAが使えない場合にVulkanへ暗黙に切り替えることはありません。
- 校正用CUDA `llama-server`は、llama.cpp b10075の固定commitから再現ビルドして同梱します。実行時にCUDA Toolkitは不要で、ホストのNVIDIAドライバーを利用します。
- Python 3.12基本ランタイム、LGPL構成のffmpeg、必要なCUDA再頒布ランタイムを配布物へ同梱し、ホスト環境への依存を抑えました。
- Ubuntu 24.04コンテナによるAppImage / `.deb`作成と、CachyOS / Arch上でのネイティブパッケージ作成に対応しました。

### 文字起こし後の流れを簡素化

- 句読点付与方式を手動で選んで実行する操作を廃止しました。Full GPU版は話者分離後にGemma 4 E4B、CPU版はローカルルールで自動的に句読点を付与します。
- Editor版は既存JSONの読込・編集・書き出しに整理しました。Editor版単体では文字起こし・話者分離・自動句読点付与を行いません。
- 文字起こし、話者分離、句読点付与の一括処理を、実行中の同じボタンから途中で中止できるようにしました。
- 結果画面の重複した説明と操作を削除し、話者名設定を2列化しました。「計算方式」と「再試行の理由」は関連する設定の近くへ移動しています。

### 初回セットアップとGPU検出を堅牢化

- 文字起こし用CTranslate2と話者分離用PyTorchのGPU初期化を別プロセスで確認し、一方の初期化がもう一方へ影響しないようにしました。
- Linux GPU版では、セットアップ直後の初期化遅延に対して短い再試行と一度だけの遅延再確認を行います。「GPUを再確認」から画面を再読み込みせずに状態を更新できます。
- Linux NVIDIA版では、NVIDIAカーネルモジュール、`nvidia_uvm`、デバイスノードを個別に診断し、ドライバーとカーネルの不整合を具体的に案内します。
- モデルの取得完了とGPUの利用可否を分離し、モデルがあるだけで「GPU準備完了」と判定しないようにしました。
- CPU版でPythonランタイムが未導入の場合、JSONの読込・編集は利用できることと、文字起こしにはセットアップが必要なことを画面上に表示します。
- Gemma 4の初回起動は、ポートが開いただけでなく`llama-server`のhealth状態がreadyになるまで待機します。

### 大容量ダウンロードとバックエンド管理を改善

- 大容量Python wheelを、Range / ETag / Last-Modifiedを使って中断位置から再開できるようにしました。取得後はSHA-256を検証し、認証情報を含みうるURL情報をログへ残しません。
- 依存メタデータの確認だけのために巨大wheel本体を先に取得する処理を避け、再試行時のダウンロード量を抑えました。Windows CUDA / CPUでも、汎用依存はハッシュ付きのPyPI公式wheelを選びます。
- llama.cppのROCm / Vulkan / CPUバックエンド取得をRust側へ移しました。一時領域で`llama-server`を検証してから差し替えるため、取得や展開に失敗しても導入済みのバックエンドを保持します。
- 新しいバックエンド保存先は`llm-engine`です。旧`lemonade`キャッシュは、以前に取得したllama.cppバイナリを再利用する場合だけ読み取ります。
- Hugging Faceトークン欄に表示／非表示ボタンを追加し、セットアップ処理へ渡した直後に入力値と表示状態をリセットするようにしました。
- 12B全体校正を選んだときにモデルが未導入なら、その場で約7GBのダウンロードを開始できます。進捗を表示し、完了後は選択していた処理を自動的に開始します。

### Linuxの音声再生とデスクトップ互換性を改善

- AppImageへLGPLのGStreamer base / good / ALSA / PulseAudioプラグインを同梱しました。WAV / MP3 / FLAC / Ogg / WebMを、ホスト側のデコーダー構成に依存せず再生できます。GPL系プラグインは同梱しません。
- M4A / MP4 / AACは、再生時だけ同梱LGPL ffmpegでFLACキャッシュへ変換します。文字起こしと区間聞き直しには常に元ファイルを使用します。
- 音声時間をffmpegから取得し、WebView側にデコーダーがない場合にも音声選択後の画面が待ち続けないようにしました。
- ファイル選択をXDG Desktop Portal経由に変更し、ホストの言語設定と`xdg-user-dirs`を利用します。
- AppImageから`xdg-open`や`nvidia-smi`等を起動するとき、AppImage内のライブラリ環境をホストコマンドへ引き継がないようにし、Arch系ホストでのreadline競合を防ぎました。
- Wayland / X11とGTK IMEは、利用者の環境変数とデスクトップセッションを尊重します。CachyOS / Arch版はX11を強制しません。
- CachyOS / Archの一部NVIDIA環境では、`WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`を既定にしました。動作しないDMA-BUF経路を避けながらWebKitGTKの合成器を維持し、起動不能と結果一覧のカクつきを同時に回避します。

### 編集・再生画面を改善

- 連続再生の操作を完全停止から一時停止へ変更し、再生位置、対象行、残りの再生キューを保持するようにしました。
- 一時停止中に通知を閉じた後、ショートカットで再開しても通知が戻らない問題を修正しました。
- ライトモードで再生速度の選択肢が読みにくい問題を修正し、音声再生アイコンの説明を追加しました。
- フォントをOS既定の`system-ui`へ変更し、ショートカットヒントの更新と大きな結果表の描画負荷を軽減しました。

## 動作要件

### Windows NVIDIA GPU版

- Windows 10 / 11 64bit
- NVIDIA GPU（RTX推奨、VRAM 8GB以上）
- CUDA Toolkit 12.x（13以上は非対応）
- cuDNN 9.x

### Linux NVIDIA GPU版

- x86-64 Linux
- 使用中のカーネルに対応するNVIDIAドライバー
- `nvidia-utils`（`nvidia-smi`と`libcuda.so.1`）
- AppImageでは、ホストに`xdg-desktop-portal`、対応するportal backend、`zenity`が必要
- CachyOS / Archパッケージでは、WebKitGTK、GStreamer、Portal関連パッケージを依存として導入

CUDA Toolkitは実行時には不要です。導入後、次のコマンドでGPU名が表示されることを確認してください。

```sh
nvidia-smi -L
```

### Windows CPU版

| 項目 | 最低要件 | 推奨要件 |
| --- | --- | --- |
| OS | Windows 10 / 11 64bit | Windows 11 64bit |
| CPU | AVX2対応、4コア / 8スレッド | 6コア / 12スレッド以上 |
| RAM | 16GB | 24GB以上 |
| ディスク空き容量 | 約10GB | 約15GB以上 |
| GPU | 不要 | 不要 |

### Windows Editor版

- Windows 10 / 11 64bit
- JSONの読込・編集・書き出しにはGPUとPythonセットアップは不要
- 後付けの音声入力・区間聞き直しを利用する場合は、設定タブから音声入力パックの導入が必要

## インストールと初回セットアップ

1. 使用するOSとGPUに対応するインストーラーまたはパッケージを導入します。
2. Full版またはCPU版では、アプリのセットアップタブからPythonパッケージと必要なモデルを導入します。
   - 初回セットアップ、追加モデル、AMD / CPU用バックエンドの取得時だけインターネット接続が必要です。
   - 話者分離モデルの取得にはHugging Faceトークンが必要です。
   - 大容量Pythonパッケージは、中断後にセットアップを再実行すると可能な範囲で続きから取得します。
3. セットアップ完了後の文字起こし・話者分離・校正はオフラインで動作します。
4. Linux NVIDIA版でCUDA未検出の表示が残る場合は、`nvidia-smi -L`を確認してから「GPUを再確認」を押してください。

> **SmartScreenについて:** Windowsインストーラーはコード署名されていないため、初回実行時にWindows SmartScreenの警告が表示されることがあります。「詳細情報」→「実行」で続行できます。配布元から取得したファイルか、SHA-256で確認してください。

## プライバシー

- 通常運用時はインターネット上のサービスへ接続しません。
- 会話データ・音声データをPC外のAPIへ送信しません。
- 文字起こし、話者分離、校正、音声入力、区間聞き直しを含む推論はPC内で完結します。
- 内蔵`llama-server`はRustが管理する`127.0.0.1`へだけ接続し、画面や保存設定から外部URLへ変更できません。
- インターネット接続を使用するのは、初回セットアップや追加モデル・バックエンドの取得時だけです。取得元はHugging Face、PyPI、ggml-orgのGitHub Releases等です。

## 既知の注意事項

- Linux NVIDIA版では、NVIDIAユーザー空間ライブラリとカーネルモジュールの版が一致している必要があります。ドライバー更新後に`nvidia_uvm`が準備できない場合は、OS再起動が必要になることがあります。
- CachyOS / Arch版でDMA-BUFのハードウェア経路を再検証する場合だけ、`LOTT_ENABLE_DMABUF_RENDERER=1 lott`を使用してください。通常起動では共有メモリ経路を使い、WebKitGTKの合成器を維持します。
- CachyOS x86-64-v3 experimental版は、AVX2 / BMI2に対応しないCPUでは起動できません。互換性を優先する場合は汎用x86-64版を使用してください。

## ライセンス

- 本体: Apache-2.0（同梱の`LICENSE` / `NOTICE`参照）
- 第三者ライセンス: 同梱の`THIRD_PARTY_LICENSES.md` / `licenses/`参照
- 音声デコードとLinuxのAAC再生変換: LGPLv3構成のffmpeg
- Linux AppImageのメディア再生: LGPLのGStreamer core / base / goodプラグイン（GPL系プラグインは非同梱）
- Linux CUDA校正エンジン: MITのllama.cpp固定ソースからビルド。CUDA再頒布ランタイムはNVIDIA CUDA Toolkit EULAに従って同梱

> **CPU版について:** CPU版は動作確認・試用向けです。頻繁または継続的に利用する場合は、対応するGPU版の利用を推奨します。ダウンロードするファイル名と対象環境をご確認ください。
