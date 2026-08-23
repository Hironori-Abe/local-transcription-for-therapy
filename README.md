# Local Transcription for Therapy (LoTT)

**日本語** | [English](README.en.md)

臨床心理・カウンセリング会話のための、ローカル完結の日本語文字起こし・逐語録作成を補助するデスクトップアプリケーションです。
文字起こし・話者分離・文章校正を、会話データを PC の外へ送ることなく実行できます。
アプリケーションが全自動で完璧な逐語録を作ることを目指してはおらず、アプリケーションはおおまかな下書きを作ります。それを人間が会話（音声ファイル）を振り返りながら逐語録を完成させることを想定しています。

![操作画面](docs/screenshots/main-window.png)
![編集画面](docs/screenshots/transcript-ui.png)

## 特徴

- **完全ローカル実行** — 運用時はインターネット接続不要。会話・音声データを PC 外の API へ送信しません
- **日本語の文字起こし** — faster-whisper（既定は Whisper turbo。高精度の large-v3 を後からダウンロードして選択可能）
- **話者分離** — pyannote.audio による話者の自動識別（既定ラベル: Th / Cl / IP …）
- **校正** — 話者分離後、Full版はGemma 4 E4B、CPU版はローカルルールで句読点を自動付与。氏名・地名など個人の特定につながりうる語も警告表示。全体校正は標準のGemma 4 E4Bに加え、分割ボタンから高精度のGemma 4 12B（NVIDIA / AMD 共通・後からダウンロード）をジョブ単位で選択可能
- **音声入力** — 編集画面の各行でマイク録音（最大15秒）すると、ローカル AI が聞き取って編集欄への挿入候補を最大3件提示（設定タブの「音声入力パック」を導入後に利用可能）
- **区間聞き直し** — 行の時間範囲の音声を AI が聞き直し、行の内容を置き換える候補を最大3件提示。文字起こしが怪しい行の修正を補助
- セグメント表の編集・句点での分割・セグメント単位の音声再生
- Word（.docx）/ Excel（.xlsx）/ SRT字幕 / JSON形式での保存。SRTは任意のパスワードでAES-256暗号化ZIPとしても保存可能
- システム設定に追従するライト / ダークテーマと、編集・再生・音声入力を操作するキーボードショートカット

## プライバシーとオフライン方針

- 文字起こし・話者分離・校正の実行時にインターネット上の API を呼びません。
- インターネット接続が必要なのは、初回セットアップ（依存パッケージ・モデル取得）のみです。
- LLM 校正の「OpenAI 互換 API」対応はプロトコル互換を意味するだけで、接続先は localhost / loopback に限定しています。クラウド推論エンドポイントには接続できない設計です。
- 本アプリ自身は通常運用時に外部へ通信しません。Windows 版では WebView2 のクラッシュダンプが Microsoft へ自動送信されないよう設定しています。ただし、OS・WebView ランタイム（WebView2 / WebKitGTK）・GPU ドライバなどのシステム側コンポーネントが行う必須診断・更新確認等の通信までは、本アプリから完全には制御できません。組織として完全なオフライン運用を求める場合は、OS やファイアウォール側の設定（ネットワーク遮断、プロキシ制限など）を併用してください。
- 技術者でない方向けの説明は [プライバシー説明（非エンジニア向け）](docs/privacy-guide.md)、利用者自身で送信がないことを確かめる手順は [オフライン動作の確認手順](docs/offline-verification.md) を参照してください。

### ローカルAIアプリ（LM Studio / Ollama）連携について

- 公式配布のインストーラーでは、同じ PC 上で動作するローカルAIアプリ（LM Studio / Ollama）との連携は **無効**です。インストール時の選択肢や、アプリ内で有効化するスイッチはありません。標準では内蔵 AI（Gemma 4 E4B）で校正できます。
- 連携が必要な場合は、ソースコードから Cargo feature `local-llm-apps` を付けて専用インストーラーをビルドしてください。手順は [Windows リリースビルド](docs/release-build-windows.md#ローカルaiアプリ連携を有効にした専用ビルド) を参照してください。
- 連携を有効にした場合でも接続先は loopback に限定されますが、**接続先アプリ（LM Studio / Ollama）自体の挙動は本アプリの管理外**です。これらのアプリの設定によっては会話データが PC 外へ送信される可能性があります。通常運用では有効化しないことを推奨します。

## エディション

| エディション | 内容 |
| --- | --- |
| **LoTT Full CUDA** | 主配布。NVIDIA RTX / CUDA 向け。文字起こし・話者分離後にGemma 4 E4Bで句読点を自動付与し、校正機能も利用可能 |
| LoTT Full AMD (ROCm / Vulkan) | experimental / 自己ビルド向け。AMD GPU 向け。話者分離後にGemma 4 E4Bで句読点を自動付与（LLM は ROCm 優先・Vulkan フォールバック） |
| LoTT CPU | お試し版。CPUで文字起こし・話者分離を行い、その後に単純な句読点を自動付与する。全体校正は非搭載。音声入力パックを導入すると音声入力・区間聞き直しも利用可能。処理時間の目安は音声時間の約1.5〜2.5倍 |
| LoTT Editor | JSONの校正・編集に特化した軽量版。文字起こし・話者分離・自動句読点付与・LLM 校正ランタイムは非搭載。音声入力パック（任意ダウンロード）を導入すると CPU 版ローカル AI による音声入力・区間聞き直しを利用可能（メモリ 16GB 未満では非推奨） |

### AMD GPU版について

AMD GPU版は、GPU世代・OS・ROCm/ドライバーの組み合わせによる互換性差が大きく、現時点では一般向けインストーラーを配布しません。**AMD GPUで利用する場合は、ソースコードから使用するGPUに対応した環境を用意し、自身でビルドしてください。** experimental扱いであり、すべてのAMD GPUでの動作は保証していません。Windowsでの開発セットアップとビルド構成は [Windows リリースビルド](docs/release-build-windows.md) を参照してください。

AMD GPU版の文字起こし・話者分離・内蔵AI処理はGPU実行を必須とし、GPU処理に失敗した場合はCPUへフォールバックせず、そのジョブを終了してダイアログで通知します。内蔵LLMのROCm経路だけは、ROCmで起動できない場合にVulkanへフォールバックします。

WindowsのAMD開発環境は、NVIDIA用`.venv312`と分離された`.venv312-amd`へROCmを導入します。

```bat
scripts\setup-dev-amd.bat
scripts\run-dev-amd.bat
```

## 動作環境（Full CUDA 版）

- Windows 10 / 11 64bit（Windows版）
- Windows版: NVIDIA GPU（RTX 推奨）+ CUDA Toolkit 12.x（13以上は不可） + cuDNN 9.x
- Linux版: NVIDIA GPU + 対応するNVIDIAドライバー（CUDA Toolkitは実行時不要）
- **VRAM 8GB 以上（最低要件）**
- インストーラー約 1GB 前後 + モデルダウンロード分の空き容量

### Linux / CachyOS NVIDIA版

CachyOS / Arch向けのNVIDIA版は、ホストのNVIDIAドライバーとCUDAドライバーランタイムを使用します。
`nvidia-utils`（`nvidia-smi`・NVIDIAユーザー空間ランタイム）を必須とし、使用中のカーネルに合う
NVIDIAドライバーも別途導入してください。CUDA Toolkitは実行時には必要ありません。
導入後、次でGPU名が表示されることを確認します。

```sh
nvidia-smi -L
```

このLinux版の文字起こし・話者分離・LLM校正はCUDAで実行します。Linux用のCUDA `llama-server`は
公式Linux CUDAアーカイブが存在しないため、配布ビルド時に公式のllama.cpp b10075ソースから再現ビルドし、
CUDA再頒布ランタイムとともにパッケージへ同梱します。実行時に必要なのはNVIDIAドライバーだけで、
Vulkanへのフォールバックは行いません。詳しい導入手順は
[CachyOS / Arch向け配布README](packaging/arch/README.md)を参照してください。

## CPU 版（お試し用）

LoTT CPU は、対応 GPU がない PC でもローカル完結の文字起こしを試せるエディションです。文字起こしと話者分離の完了後、ローカルルールによる単純な句読点付与を自動的に行います。全体校正は搭載しません。音声入力パックを追加すると、CPU による音声入力と区間聞き直しも利用できます。

**処理時間が長くなるため、日常的・継続的な常用は推奨しません。** 少量の音声で動作や文字起こし品質を確認するお試し用途、または対応 GPU を用意できない場合の補助的な利用を想定しています。

| 項目 | 最低要件 | 推奨要件 |
| --- | --- | --- |
| OS | Windows 10 / 11 64bit | Windows 11 64bit |
| CPU | AVX2 対応、4コア / 8スレッド | 6コア / 12スレッド以上 |
| RAM | **16GB** | **24GB 以上** |
| ディスク空き容量 | 約10GB | 約15GB以上 |
| GPU | 不要 | 不要 |

- RAM 16GB は文字起こし・話者分離・単純な句読点付与を行うための実用上の下限です。他のアプリを同時に多数起動すると、処理速度低下やメモリ不足が発生する可能性があります。
- 音声入力・区間聞き直しでは Gemma 4 E4B 本体と音声 mmproj も使用するため、RAM 24GB以上を推奨します。16GB環境では他のアプリを終了してから利用してください。
- RAM 16GB未満はサポート対象外とします。スワップによる大幅な速度低下や、メモリ不足による失敗が想定されます。
- CPU版は起動時に最低要件（RAM 16GB以上、AVX2、8論理スレッド以上）を確認します。満たさない場合は不足項目を表示して終了し、満たす場合もお試し用である旨と処理時間の注意を毎回表示します。
- 処理時間の目安は音声時間の約1.5〜2.5倍ですが、CPU性能や音声内容によりさらに長くなる場合があります。開発機では、約12分の音声に対して約20分かかりました。

## インストールと初回セットアップ

1. NSIS インストーラー（`*_x64-setup.exe`）を実行します
2. アプリ起動後、セットアップタブから「Python パッケージをインストール」を実行します（要ネット接続）
3. 同じセットアップタブから必要なモデルをダウンロードします
   - 文字起こしモデル（Whisper turbo。高精度の large-v3 は任意で後から追加可能）
   - 話者分離モデル（`pyannote-speaker-diarization-community-1`、Hugging Face トークンが必要）
   - 校正用 LLM（Gemma 4 E4B GGUF。Full 版のみ）
   - 高精度校正用 LLM（Gemma 4 12B QAT+MTP、約7GB。Full版で12B校正を使う場合のみ）
   - 音声入力パック（任意。音声入力・区間聞き直しを使う場合）

モデル取得後はオフラインで運用できます。

## 使い方

1. 音声ファイルを選択して文字起こしを実行
2. 音声ファイルを聞きながら、結果の会話内容・話者を編集（話者ラベル既定値: `SPEAKER_00 → Th`、`SPEAKER_01 → Cl` など）
   - 編集中は、マイクからの音声入力や、行の時間範囲を AI に聞き直させる「区間聞き直し」も利用できます（要・音声入力パック）
   - `Ctrl+Shift+Space`（連続再生 / 停止）、`Ctrl+Shift+A` / `D`（5秒戻す / 進める）、`Ctrl+Shift+E`（話者切替）、`Ctrl+Shift+M`（音声入力）を利用できます
3. 必要に応じて全体校正を実行します。通常のボタンはGemma 4 E4B、右側のメニューは後付けのGemma 4 12Bを、その実行だけに使用します（Full版のみ）
4. Word / Excel / SRT字幕 / JSON形式で保存

表示テーマはタブ行左端のボタンで「システムに合わせる」（初期値）/ ライト / ダークを切り替えられ、選択内容は次回起動時にも引き継がれます。

## 技術スタック

- Desktop: Tauri 2 (Rust) / Frontend: Angular 21 + Angular Material / Sidecar: Python
- ASR: faster-whisper（turbo 既定 / large-v3 高精度・後付けダウンロード） / Diarization: pyannote.audio / 音声デコード: LGPL 構成 ffmpeg CLI
- 音声入力・区間聞き直し: Gemma 4 E4B + 音声 mmproj（llama.cpp llama-server、OpenAI 互換 `input_audio`、loopback 限定）
- LLM 校正: Gemma 4 E4B（既定）/ Gemma 4 12B QAT+MTP（高精度・後付けダウンロード。Windows/Linux NVIDIA=CUDA 直起動 / AMD=ROCm 優先・Vulkan フォールバック）+ 同梱/DL llama.cpp llama-server / ローカル OpenAI 互換 API（loopback 限定）

## ドキュメント

- 最新のリリースノート: [v0.9.8](docs/release-notes-v0.9.8.md)
- プライバシー説明（非エンジニア向け）: [docs/privacy-guide.md](docs/privacy-guide.md)
- オフライン動作の確認手順: [docs/offline-verification.md](docs/offline-verification.md)
- 倫理審査向け資料テンプレート: [docs/irb-template.md](docs/irb-template.md)
- 開発環境セットアップ・内部仕様: [docs/development.md](docs/development.md)
- Linux NVIDIA CUDA配布ビルド: [docs/release-build-linux.md](docs/release-build-linux.md)
- トラブルシューティング（CUDA / AMD ROCm 含む）: [docs/troubleshooting.md](docs/troubleshooting.md)
- 配布ビルド（Windows NSIS）: [docs/release-build-windows.md](docs/release-build-windows.md)
- FFmpeg / PyAV ライセンス方針: [docs/lgpl-pyav-build.md](docs/lgpl-pyav-build.md)

## ライセンス

本アプリは [Apache License 2.0](LICENSE) で配布します。
同梱の FFmpeg は LGPL 構成のビルドを使用しています。第三者ライセンスの一覧は [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) を参照してください。

## 免責事項

- 本ソフトウェアは、文字起こしと記録作成を補助するためのツールです。医療機器ではなく、診断、治療、臨床判断、緊急時の対応、その他の専門的判断を代替するものではありません。
- 文字起こし、話者分離、校正、音声入力、区間聞き直しなどの出力には、誤認識、欠落、話者の取り違え、不適切な修正が含まれる可能性があります。重要な記録や判断に使用する前に、必ず利用者または適切な有資格者が原音と照合し、内容を確認・修正してください。
- 音声や会話データを取り扱う前に、必要な説明・同意を得て、適用される法令、職業倫理、所属組織の規程に従ってください。端末、出力ファイル、バックアップ、モデルおよび認証情報の安全な管理は利用者の責任です。
- 本ソフトウェアは [Apache License 2.0](LICENSE) に基づき、明示または黙示の保証なく提供されます。法令で認められる範囲において、本ソフトウェアの利用または利用不能から生じる判断、記録、損失その他の結果について、開発者およびコントリビューターは責任を負いません。
