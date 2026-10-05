# Local Transcription for Therapy (LoTT) v0.9.9

臨床心理・カウンセリング会話の文字起こし、話者分離、文章校正を、会話データをPCの外へ送らずに実行するデスクトップアプリです。

v0.9.9は、音声エンジンを全面的に入れ替えた大きな更新です。文字起こしは whisper.cpp、話者分離は NeMo-Speech.cpp + Nemotron-3-Diarization になり、NVIDIA / AMD / Intel のGPUを1つのインストーラーで扱えるようになりました（Vulkan）。GPUが無いPCではCPUで処理します。Python、Gemma 4によるAI校正・全体校正、CUDA版・AMD版・CPU版は廃止し、配布は **Full版** と **Editor版** の2つになりました。

## ダウンロード

| ファイル | 対象 | 備考 |
| --- | --- | --- |
| `LoTT-v0.9.9-windows-x64-vulkan-setup.exe` | Windows 10 / 11・NVIDIA / AMD / Intel GPU（GPUが無ければCPUで動作） | **Full版・主配布** |
| `LoTT-v0.9.9-windows-x64-editor-setup.exe` | Windows 10 / 11・GPU不要 | JSONの読込・編集・書き出しに特化（文字起こし・話者分離なし） |
| `LoTT-v0.9.9-linux-x64-vulkan.AppImage` | Linux x86-64・NVIDIA / AMD / Intel GPU（GPUが無ければCPUで動作） | Full版・試験的 |
| `LoTT-v0.9.9-linux-x64-vulkan.deb` | Ubuntu系 x86-64・NVIDIA / AMD / Intel GPU（GPUが無ければCPUで動作） | Full版・試験的 |
| `LoTT-v0.9.9-linux-x64-editor.AppImage` | Linux x86-64・GPU不要 | Editor版・試験的 |
| `LoTT-v0.9.9-linux-x64-editor.deb` | Ubuntu系 x86-64・GPU不要 | Editor版・試験的 |
| `SHA256SUMS.txt` | — | 各配布ディレクトリ内のファイルに対応するSHA-256チェックサム |

ファイル名の `vulkan` はFull版を表します。NVIDIAのPCでもこのファイルを使ってください（CUDA版はありません）。

ダウンロード後は、配布ディレクトリにあるチェックサムを任意で確認できます。

```sh
sha256sum -c SHA256SUMS.txt
```

## v0.9.8からの更新について

| v0.9.8で使っていた版 | v0.9.9で導入する版 | 注意 |
| --- | --- | --- |
| Windows NVIDIA（CUDA）版 | Full版（`vulkan`） | 上書きインストールされます。初回セットアップでモデル（約1.7GB）を取得し直してください。CUDA Toolkit・cuDNNは不要になりました |
| Windows CPU版 / AMD版 | Full版（`vulkan`） | 別アプリとして追加されます。旧版はWindowsの「インストールされているアプリ」からアンインストールしてください |
| Windows Editor版 | Editor版 | 上書きインストールされます。音声入力を使う場合は、設定タブから新しい音声入力パック（約1.6GB）を取得してください |
| Linux NVIDIA（CUDA）版 | Linux Full版（`vulkan`） | CachyOS / Arch向けパッケージは廃止しました。AppImageまたは`.deb`を使ってください |

- 旧版が残したモデルやキャッシュ（Gemma 4、Python環境、faster-whisper・pyannoteのモデルなど）は、設定タブの一覧から確認して削除できます。会話データではありません。
- 保存済みのJSONは、Full版・Editor版のどちらでも読み込めます。

## 主な変更点

### 校正の仕組みを作り直しました

- Gemma 4 E4Bによる自動句読点付与と、Gemma 4 E4B / 12Bによる全体校正（提案の採用・却下）を廃止しました。AI（LLM）の推論はアプリから無くなりました。
- 日本語の文字起こしでは、句読点とフィラーを含む中立な例文をwhisper.cppへ毎回渡し、Whisperがその書き方をまねて句読点を付けます。計測では99%以上の行が句読点で終わりました。カウンセリング会話の「えーと」「うん」などのフィラー・相づちも残りやすくなっています。
- 文字起こしの後は、日本語のローカルルールで、日本語直後の半角「?」「!」の全角化と、句読点で終わらない行末の補完だけを行います。
- 氏名・地名など個人の特定につながりうる語の注意喚起（赤字）と、「〜病院」「〜さん」などの注意喚起（黄色）は従来どおりです。
- 結果は1文1行に分け、文ごとに話者を割り当てます。1秒未満の相づち行は、近い同じ話者の行へつなぎます。

### 音声エンジンをwhisper.cppとNemotron-3-Diarizationへ

- 文字起こしはwhisper.cpp（Whisper large-v3-turbo + Silero VAD）、話者分離はNeMo-Speech.cpp + Nemotron-3-Diarizationで行います。どちらもVulkanビルドを同梱し、NVIDIA / AMD / IntelのGPUで動きます。
- 初回セットアップで取得するのは、音声認識モデル（約1.6GB）と話者分離モデル（約0.1GB）だけです。Hugging Faceのアカウント・トークン、CUDA Toolkit、cuDNN、Pythonは不要になりました。ダウンロードは固定版・SHA-256検証・中断後の再開に対応しています。
- 話者分離は録音ファイル向けの設定で実行します。RTX 4060 Laptopでは、58分の音声の話者分離が約14秒で終わりました（モデル読み込みを含む）。
- 必要なVRAMが大きく減りました。RTX 4060 Laptopでの実測の最大使用量は、文字起こし約1.9GB、話者分離約0.15GBです（2つは順に実行します）。動作要件の目安は「VRAM 4GB以上」です。

### GPUが無いPCでも動作

- Full版は、VulkanのGPUが見つからない場合にCPUで処理します。CPUで処理するときだけ、起動時にRAM 16GB以上・AVX2・論理スレッド8以上を確認し、処理時間の注意を表示します。
- 文字起こし画面には、使用するGPUの名前、またはCPUで処理する理由を常に表示します。話者分離がGPUで失敗してCPUへ切り替わった場合は、結果画面でお知らせします。
- 複数のGPUがあるPCでは、内蔵GPU以外でVRAMが最大のGPUを自動で選びます。設定タブの「音声エンジンの GPU」で変更できます。
- Windowsでは、GPUドライバーが入っていない・古い場合に、起動時のダイアログとバナーで導入・更新を案内します。

### 対象言語を選べるように

- 設定タブの「対象言語」で、文字起こしの言語を24言語から選べます。既定は日本語で、自動検出はしません。
- 日本語以外の言語には、日本語の例文・句読点ルール・記号の全角化を適用しません。
- 話者分離の対応を公式資料で確認できない言語には「話者分離非対応」と表示しますが、話者分離は全言語で実行します。日本語以外の精度は検証していません。
- 結果のJSONに言語を記録し、読み込んだときに復元します。

### 音声入力

- 編集画面のマイク入力（最大15秒）は、whisper.cppで1回だけ文字起こしし、候補を1件示します。
- Full版はセットアップ済みのモデルを使い、GPUがあればGPU、無ければCPUで動きます。追加パックは不要です。
- Editor版は常にCPUで動きます。設定タブの「音声入力パック」（Whisper large-v3-turbo + Silero VAD、約1.6GB）を取得すると使えます。

### 編集・再生

- 連続再生・一時停止・再開のショートカットに `Ctrl+Shift+P` を追加しました。IMEが `Ctrl+Shift+Space` を使う環境で使えます。`Ctrl+Shift+Space` も引き続き使えます。
- 行ごとの連続再生・ループ再生、ショートカット、画面下部の再生コントロールが同じ再生状態を共有するようになりました。再生中は一時停止、一時停止中は同じ位置から再開し、行のボタンの表示も状態に合わせて切り替わります。

### 音声調整

- 「音声調整」（低域ノイズの処理・強いノイズの処理・音量拡大・全般的な改善）は、同梱のLGPL ffmpegのフィルターで行うようになりました。調整は文字起こしに使う音声だけにかけ、話者分離には元の音声を使います。既定は「何もしない」です。良質な録音では、調整するとかえって精度が下がることがあります。

### Linux版

- Linux版はFull版・Editor版とも、AppImageと`.deb`で配布します。Ubuntu 24.04のDocker環境でビルドしています。
- GPUのドライバー（ICD）は同梱せず、ホストのものを使います。Vulkanローダーがホストに無い場合だけ、同梱のフォールバックを使ってCPUで処理します。
- NVIDIAのプロプライエタリドライバーを検出したときは、画面の描画が止まったりスクロールがカクついたりしないよう、WebKitGTKの描画設定を自動で調整します（`LOTT_ENABLE_DMABUF_RENDERER=1` で無効化できます）。
- Docker・WSL2上で、ビルド、AppImage / `.deb`の起動、同梱エンジンのCPU実行を確認しました。**Linux実機でのGPU実行と、各ディストリビューションでの動作は未検証です。**

### 削除した機能・設定

- Gemma 4 E4B / 12B、LM Studio / Ollama連携、区間聞き直し
- 文字起こし用モデル、実行デバイス、話者分離デバイス、計算方式の選択（自動で決まります）
- AI校正の各設定、Hugging Faceアクセストークン欄、「頻出語・注目語」、「再試行の理由」
- 外部サイト（CUDA / ROCmの導入案内、Hugging Faceの同意ページなど）を開くボタン

「頻出語・注目語」は、whisper.cppでは話されていない語（臨床用語など）が出力される誤認識が確認されたため削除しました。

## 動作要件

### Full版

- Windows 10 / 11 64bit、またはLinux x86-64（試験的）
- GPUで処理する場合: NVIDIA / AMD / IntelのGPU（VRAM 4GB以上を目安）と、Vulkanに対応した最新のGPUドライバー。CUDA Toolkit・cuDNNは不要です
- GPUが無い場合（CPU処理）: RAM 16GB以上、AVX2対応CPU、8論理スレッド以上。処理時間は音声時間の約1.5〜2.5倍が目安です
- ディスク空き容量: アプリ本体に加えて、モデル用に約1.7GB
- Linuxでは、GPUで処理するためにホストのVulkanローダー（Ubuntuでは`libvulkan1`。`.deb`は自動で導入）と、MesaまたはNVIDIAのVulkanドライバーが必要です

### Editor版

- Windows 10 / 11 64bit、またはLinux x86-64（試験的）
- GPU不要
- 音声入力を使う場合は、音声入力パック用に約1.6GBの空き容量

## インストールと初回セットアップ

1. 使用するOSに合うインストーラーまたはパッケージを導入します。
2. Full版は、アプリのセットアップタブから文字起こしモデル（Whisper large-v3-turbo・Silero VAD）と話者分離モデル（Nemotron-3-Diarization）をダウンロードします。
   - インターネット接続が必要なのは、このモデル取得のときだけです。
   - Nemotron-3-DiarizationのライセンスはNVIDIA OpenMDW-1.1です。本文はセットアップ画面から確認できます。
   - ダウンロードが中断した場合は、セットアップを再実行すると続きから取得します。
3. Editor版は、JSONの読込・編集・書き出しだけならモデルは不要です。音声入力を使う場合は、設定タブから音声入力パックを取得します。
4. モデル取得の後は、文字起こし・話者分離・校正をオフラインで使えます。

> **SmartScreenについて:** Windowsインストーラーはコード署名されていないため、初回実行時にWindows SmartScreenの警告が表示されることがあります。「詳細情報」→「実行」で続行できます。配布元から取得したファイルか、SHA-256で確認してください。

## プライバシー

- 通常運用時はインターネット上のサービスへ接続しません。
- 会話データ・音声データをPC外のAPIへ送信しません。
- 文字起こし、話者分離、校正、音声入力は、PC内のwhisper.cpp / NeMo-Speech.cppとローカルのルールで完結します。AI（LLM）は使いません。
- インターネット接続を使うのは、初回セットアップと音声入力パックのモデル取得時だけです。取得元はHugging Faceで、固定版のファイルをSHA-256で検証します。

## 既知の注意事項

- Linux版は試験的な配布です。Linux実機でのGPU実行、Wayland / IMEでの日本語入力、スクロール性能は未検証です。
- 最小構成のLinux（WSLなど）では、`libwayland-server0`、`libgles2`、日本語フォント（例: `fonts-noto-cjk`）などを別途導入しないと起動できない、または日本語が表示されない場合があります。
- 話者分離モデル（Nemotron-3-Diarization）自体には話者数を指定できません。画面で選んだ話者数は後処理に使い、発話時間の長い話者から順にその人数だけ残します。
- whisper.cppの初回実行では、GPUドライバーがシェーダーを準備するため、2回目以降より時間がかかることがあります。

## ライセンス

- 本体: Apache-2.0（同梱の`LICENSE` / `NOTICE`参照）
- 第三者ライセンス: 同梱の`THIRD_PARTY_LICENSES.md` / `licenses/`参照
- 文字起こし: whisper.cpp（MIT）、Whisper large-v3-turbo（MIT）、Silero VAD（MIT）
- 話者分離: NeMo-Speech.cpp（Apache-2.0）、Nemotron-3-Diarization（NVIDIA OpenMDW-1.1）
- 音声デコードとLinuxのAAC再生変換: LGPLv3構成のffmpeg
- Linux AppImageのメディア再生: LGPLのGStreamer core / base / goodプラグイン（GPL系プラグインは非同梱）
- Linuxのエンジン用OpenMPランタイム: libgomp（GPL-3.0-or-later WITH GCC-exception-3.1）

> **CPU版について:** CPU版は動作確認・試用向けです。頻繁または継続的に利用する場合は、対応するGPU版の利用を推奨します。ダウンロードするファイル名と対象環境をご確認ください。
