# Local Transcription for Therapy (LoTT) v0.9.8

臨床心理・カウンセリング会話のための、ローカル完結の日本語文字起こしデスクトップアプリです。
文字起こし・話者分離・文章校正を、会話データをPCの外へ送ることなく実行できます。

v0.9.8では、文字起こし後の操作を整理するとともに、Linux NVIDIA版の配布を追加しました。
また、LinuxでのCUDA初期化、音声再生、ファイル選択、デスクトップ環境との互換性と、
大容量セットアップの再開性を重点的に改善しています。

## ダウンロード

| ファイル | 対象 | 備考 |
| --- | --- | --- |
| `LoTT-v0.9.8-windows-x64-cuda-setup.exe` | Windows 10 / 11・NVIDIA GPU | 主配布。CUDA 12.x / cuDNN 9.xが必要 |
| `LoTT-v0.9.8-windows-x64-cpu-setup.exe` | Windows 10 / 11・GPU不要 | 動作確認・試用向け（常用非推奨） |
| `LoTT-v0.9.8-windows-x64-editor-setup.exe` | Windows 10 / 11・GPU不要 | JSONの読込・編集・書き出しに特化 |
| `LoTT-v0.9.8-linux-x64-cuda.AppImage` | Linux x86-64・NVIDIA GPU | NVIDIAドライバーが必要。CUDA Toolkitは実行時不要 |
| `LoTT-v0.9.8-linux-x64-cuda.deb` | Ubuntu系 x86-64・NVIDIA GPU | NVIDIAドライバーが必要。CUDA Toolkitは実行時不要 |
| `LoTT-v0.9.8-linux-x64-cuda-cachyos.pkg.tar.zst` | CachyOS / Arch x86-64・NVIDIA GPU | ホストのWebKitGTK / GStreamerを利用する汎用x86-64版 |
| `LoTT-v0.9.8-linux-x64-v3-cuda-cachyos-experimental.pkg.tar.zst` | CachyOS・x86-64-v3対応CPU・NVIDIA GPU | スクロール応答を優先した実験版。AVX2 / BMI2対応CPU専用 |
| `SHA256SUMS.txt` | — | 各配布ディレクトリ内のファイルに対応するSHA-256チェックサム |

AMD GPU版は引き続きexperimental／自己ビルド向けで、一般向けReleaseには添付しません。

ダウンロード後の検証（任意）:

```sh
sha256sum -c SHA256SUMS.txt
```

## 主な変更点

### Linux NVIDIA CUDA版を追加

- NVIDIA GPU向けのAppImage、`.deb`、CachyOS / Archパッケージを追加しました。
- Linux用CUDA `llama-server`は、公式llama.cpp b10075の固定commitから再現ビルドし、CUDA再頒布ランタイムとともにアプリへ同梱します。実行時にCUDA Toolkitは不要で、ホストのNVIDIAドライバーと`nvidia-utils`を使用します。
- Linux NVIDIA版は文字起こし・話者分離・Gemma 4による校正をCUDAで実行し、Vulkanへ暗黙にフォールバックしません。
- Python 3.12基本ランタイムとLGPL構成のffmpegを配布物へ同梱し、ホストのPython環境への依存を減らしました。
- Ubuntu 24.04コンテナによるAppImage / `.deb`ビルド、CachyOS / Arch向けの再現可能なパッケージ作成、成果物名の統一と`SHA256SUMS.txt`生成に対応しました。

### LinuxでのCUDA検出と初回セットアップを改善

- CTranslate2とPyTorchのCUDA初期化を個別に確認し、片方の失敗を別のランタイムの失敗として誤表示しないようにしました。
- セットアップ直後にCUDA初期化が間に合わない場合は、短い再試行と約1分後の遅延再確認を行います。「GPUを再確認」ボタンでも、画面を再読み込みせず状態を更新できます。
- Linux NVIDIA環境では、NVIDIAカーネルモジュール、`nvidia_uvm`、`/dev/nvidia-uvm`を個別に診断します。可能な場合はNVIDIA標準ヘルパーによるUVM初期化を試し、直らない場合はドライバーとカーネルの不整合を具体的に案内します。
- モデルのダウンロード完了とCUDA利用可能状態を分離し、モデルだけ取得できた状態を「GPU準備完了」と誤判定しないようにしました。
- Gemma 4の初回ロードでは、TCPポートが開いただけで準備完了とせず、Linuxでは`llama-server`のhealth状態がreadyになるまで待機します。ロード中の短間隔なAPI再試行を抑えました。

### Linuxの音声再生・ファイル選択・デスクトップ互換性を改善

- AppImageへLGPLのGStreamer base / good / ALSA / PulseAudioプラグインを同梱し、ホスト側にデコーダーがない環境でもWAV / MP3 / FLAC / Ogg / WebMを再生できるようにしました。GPLプラグインは同梱しません。
- AAC系のM4A / MP4 / AACは、再生時だけ同梱LGPL ffmpegでFLACキャッシュへ変換します。文字起こしと区間聞き直しには常に元ファイルを使用します。
- 音声時間をffmpegから取得し、WebViewのメディアメタデータが返らない場合にも画面が待ち続けないようにしました。
- Linuxのファイル選択をXDG Desktop Portal経由にし、ホストの言語設定と`xdg-user-dirs`の日本語フォルダー名を利用します。
- AppImageから`xdg-open`、`nvidia-smi`などのホストコマンドを起動するとき、AppImage内の`LD_LIBRARY_PATH`等を引き継がないようにし、Arch系ホストでのreadline競合を修正しました。
- Wayland / X11とGTK IMEは、ユーザーの環境変数と実行中のデスクトップ環境を尊重します。CachyOSランチャーはX11を強制せず、実機で起動障害を起こしたWebKitGTKのDMA-BUF rendererだけを既定で無効化します。

### 文字起こし後の処理と画面を整理

- 句読点付与の手動選択・実行を廃止しました。Full GPU版は話者分離後にGemma 4 E4Bで、CPU版はローカルルールで句読点を自動付与します。
- Editor版は既存JSONの読込・編集・書き出しに整理し、文字起こし・話者分離・自動句読点付与は行いません。
- 文字起こし、話者分離、AI句読点付与の一括パイプラインを、同じ実行ボタンから途中で中止できるようにしました。
- 結果画面上部の重複した校正操作を削除し、話者名設定を2列化しました。「計算方式」と「再試行の理由」も関連する設定の近くへ移動しました。
- フォントをOS既定の`system-ui`へ変更し、ショートカットヒントの更新処理やAngularのイベント集約を見直して、大きな結果表のスクロール負荷を軽減しました。

### Gemma 4 12Bと音声再生操作を改善

- 「全体校正（with 12B）」の選択時に12Bモデルが未導入なら、その画面で約7GBのダウンロードを確認・開始できるようにしました。
- ダウンロード進捗を全体校正ボタンの下と設定タブへ表示し、完了後は選択していた12B全体校正を自動開始します。
- 連続再生スナックバーの操作を完全停止から一時停止へ変更し、再生位置・対象行・残りの再生キューを保持します。
- 一時停止中にスナックバーを閉じた後、ショートカットで再開しても表示が戻らない問題を修正しました。
- ライトモードで再生速度の選択肢が読みにくい問題を修正し、各音声再生アイコンへ「ループ再生」「連続再生」の説明を追加しました。

### セットアップとバックエンド取得を堅牢化

- 大容量Python wheelの取得を、Range / ETag / Last-Modifiedを使って中断位置から再開できるようにしました。取得後はSHA-256を検証し、URLのqueryや認証情報をログへ残しません。
- pipの依存メタデータ確認時に巨大wheel本体を先に取得しないようにし、セットアップ失敗時の再ダウンロード量を抑えました。
- Hugging Faceトークン欄に表示／非表示ボタンを追加し、セットアップ処理へ渡した直後に入力値と表示状態をリセットするようにしました。
- CPU版は配布識別子からCPU専用構成を確定し、初回セットアップで不要なGemmaモデルやGPU用バックエンドを要求しないようにしました。
- llama.cppのROCm / Vulkan / CPUバックエンド取得をPythonサイドカーからRustへ移しました。一時展開先で`llama-server`を検証してから差し替え、失敗時は導入済みのバックエンドを保持します。
- 内蔵校正エンジンの内部名を`llama_server`へ統一し、旧ランタイム向け設定・UI・誤ったライセンス表示と生成済みバイナリの残骸を削除しました。
- 新しいバックエンド保存先を`llm-engine`へ変更しました。旧`lemonade`キャッシュは、旧版で取得済みのllama.cppバイナリを再利用する読み取り互換としてだけ参照します。

### 内部品質と診断性を改善

- 文字起こし実行ごとにrun IDを付け、各処理段階の時間とエラーを追跡しやすくしました。
- 既存の所要時間ログについて、日時の検証、並べ替え、CSV組み立て、Shift-JIS保存をRust側へ集約しました。
- 設定、セットアップ状態、音声再生、編集、音声入力、入出力、校正メタデータ等の処理をAngularコンポーネントから純粋関数へ分離し、オフラインで実行できるフロントエンド単体テストを追加しました。
- Rust側にもCUDA診断、バックエンド取得・展開、旧キャッシュ互換、所要時間CSV等のテストを追加し、Python側には再開可能ダウンロードとpip環境分離のテストを追加しました。

## 動作要件

### Windows NVIDIA GPU版

- Windows 10 / 11 64bit
- NVIDIA GPU（RTX推奨）
- CUDA Toolkit 12.x（13以上は非対応）とcuDNN 9.x
- VRAM 8GB以上

### Linux NVIDIA GPU版

- x86-64 Linux
- 使用中のカーネルに対応するNVIDIAドライバー
- `nvidia-utils`（`nvidia-smi`と`libcuda.so.1`）
- CUDA Toolkitは実行時不要
- AppImageでは、ホストに`xdg-desktop-portal`、対応するportal backend、`zenity`が必要
- CachyOS / Archパッケージでは必要なWebKitGTK、GStreamer、Portal関連パッケージを依存として導入

導入後、次のコマンドでGPU名が表示されることを確認してください。

```sh
nvidia-smi -L
```

### CPU版

| 項目 | 最低要件 | 推奨要件 |
| --- | --- | --- |
| OS | Windows 10 / 11 64bit | Windows 11 64bit |
| CPU | AVX2対応、4コア / 8スレッド | 6コア / 12スレッド以上 |
| RAM | 16GB | 24GB以上 |
| ディスク空き容量 | 約10GB | 約15GB以上 |
| GPU | 不要 | 不要 |

## インストールと初回セットアップ

1. 使用する環境に対応するインストーラーまたはパッケージを導入します。
2. アプリを起動し、セットアップタブからPythonパッケージと必要なモデルをインストールします。
   - 初回セットアップ、追加モデル、AMD / CPU用バックエンドの取得時だけインターネット接続が必要です。
   - 話者分離モデルの取得にはHugging Faceトークンが必要です。
   - 大容量Pythonパッケージのダウンロードは、中断後の再実行時に可能な範囲で続きから再開します。
3. セットアップ完了後はオフラインで動作します。
4. Linux NVIDIA版でCUDA未検出の表示が残る場合は、`nvidia-smi -L`を確認してから「GPUを再確認」を押してください。モデル取得の完了だけではCUDA利用可能とは判定されません。

> **SmartScreenについて:** Windowsインストーラーはコード署名されていないため、初回実行時に
> Windows SmartScreenの警告が表示されることがあります。「詳細情報」→「実行」で続行できます。
> 配布元から取得したファイルか、SHA-256で確認してください。

## プライバシー

- 通常運用時はインターネット上のサービスへ接続しません。
- 会話データ・音声データをPC外のAPIへ送信しません。
- 文字起こし、話者分離、校正、音声入力、区間聞き直しを含む推論はPC内で完結します。
- 内蔵`llama-server`の接続先はRustが管理する`127.0.0.1`へ固定し、保存設定や画面から外部URLへ変更できません。
- インターネット接続を使用するのは、初回セットアップや追加モデル・バックエンドの取得時だけです。取得元はHugging Face、PyPI、ggml-orgのGitHub Releases等です。

## 既知の注意事項

- Linux NVIDIA版では、NVIDIAユーザー空間ライブラリとカーネルモジュールの組み合わせが一致している必要があります。ドライバー更新後に`nvidia_uvm`が準備できない場合は、OS再起動が必要になることがあります。
- CachyOS実機では`WEBKIT_DISABLE_DMABUF_RENDERER=1`を既定にしています。`LOTT_GDK_BACKEND=x11`はX11/XWaylandが利用可能と確認できた環境での診断時だけ使用してください。
- CachyOS experimental x86-64-v3版は、AVX2 / BMI2に対応しないCPUでは起動できません。互換性を優先する場合は汎用x86-64版を使用してください。

## ライセンス

- 本体: Apache-2.0（同梱の`LICENSE` / `NOTICE`参照）
- 第三者ライセンス: 同梱の`THIRD_PARTY_LICENSES.md` / `licenses/`参照
- 音声デコードとLinuxのAAC再生変換: LGPLv3構成のffmpeg
- Linux AppImageのメディア再生: LGPLのGStreamer core / base / goodプラグイン（GPL系プラグインは非同梱）
- Linux CUDA校正エンジン: MITのllama.cpp固定ソースからビルド。CUDA再頒布ランタイムはNVIDIA CUDA Toolkit EULAに従って同梱

> **CPU版について:** CPU版は動作確認・試用向けです。頻繁または継続的に利用する場合は、対応するGPU版の利用を推奨します。ダウンロードするファイル名と対象環境をご確認ください。
