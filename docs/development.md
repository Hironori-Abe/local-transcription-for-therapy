# 開発ガイド

ソースからのビルド・開発者向けのドキュメントです。
利用者向けの情報は [README.md](../README.md)、プロジェクトの方針・規約・安定領域は [AGENTS.md](../AGENTS.md) を参照してください。

## 事前に必要なもの（Windows）

- Node.js (LTS)
- Python for Windows
- Rustup / Cargo
- Microsoft C++ Build Tools
- NVIDIA GPU Driver（GPU利用時）
- Windows CUDA版: CUDA Toolkit 12.x + cuDNN 9.x（GPU利用時）

Linux NVIDIA版では、実行時にCUDA Toolkitを導入する必要はありません。対応するNVIDIA
ドライバーと`nvidia-utils`を用意し、Linux CUDA `llama-server`を再ビルドする場合だけ
`scripts/build-llama-server-cuda-linux.sh`（Docker + NVIDIA CUDA devel image）を使います。

## セットアップと開発起動

### Windows

プロジェクト直下で実行:

```bat
scripts\setup-dev.bat
scripts\run-dev.bat
```

CPU版の開発確認:

```bat
scripts\setup-dev.bat --cpu-torch
scripts\run-dev-cpu.bat
```

`--cpu-torch` ではCPU版の文字起こし・話者分離に不要なGemma 4の自動取得を
既定でスキップします。音声入力・LLM校正も確認する場合だけ、次のように
`--with-gemma`を追加してください。

```bat
scripts\setup-dev.bat --cpu-torch --with-gemma
```

`setup-dev.bat` の実行内容（概要）:

- npm install（ルート / frontend）
- Python依存インストール
- Rust/cargo 確認
- CUDA/cuDNN 確認
- doctor 風の環境サマリ表示

`run-dev.bat` は Angular dev server と Tauri を起動します。実行中ログが表示されたままになる設計です。

### Ubuntu / Linux

```sh
bash scripts/setup-dev.sh
bash scripts/run-dev.sh
```

Linux CPU版の開発確認:

```sh
bash scripts/setup-dev.sh --cpu-torch -y
bash scripts/run-dev-cpu.sh
```

LinuxでもCPUバックエンドではGemma 4の自動取得を既定でスキップします。
必要な場合は`--with-gemma`を追加してください。

- `setup-dev.sh` は Rustup / Cargo、Node.js、Python venv、Tauri / WebKit 系依存、GPU検証用依存の準備を担います。
- Chrome / Chromium の Snap 版が WebKit / glibc と衝突することがあるため、deb 版ブラウザまたは通常のシステムライブラリ経路を優先してください。
- CachyOS / ArchでNVIDIA版を開発する場合は、ホスト側にNVIDIAドライバーと
  `nvidia-utils`を先に導入し、`nvidia-smi -L`でGPUを確認してください。CUDA Toolkitは
  実行時には必要ありません（Linux CUDA llama-serverの再ビルドは専用Dockerスクリプトが
  CUDA develイメージ内で行います）。
  `nvidia-utils`はカーネルドライバー本体を含まないため、使用中のカーネルに合う
  `nvidia` / `nvidia-open` / `nvidia-dkms`なども必要です。
- Linux NVIDIAのASR・話者分離・LLM校正はCUDAを使います。Linux用CUDA `llama-server`は
  公式Linux archiveではなく、`scripts/build-llama-server-cuda-linux.sh`がllama.cpp
  b10075の固定commitからビルドし、`src-tauri/resources/llama-server/cuda/`へ配置します。

### 実行環境エミュレーション

CUDA なし環境や話者分離モデル未配置環境を開発機で擬似再現できます。
詳細は [dev-runtime-emulation.md](dev-runtime-emulation.md) を参照してください。

#### CPU版の起動時警告

デバッグビルドでは、環境変数 `LOTT_DEV_CPU_STARTUP_SCENARIO` に次の値を指定すると、実際のPCスペックに関係なくCPU版の起動時ダイアログを再現できます。通常版の開発起動でも有効ですが、リリースビルドではこの環境変数を無視します。

| 値 | 再現する状態 |
| --- | --- |
| `memory` | RAM 8GBとしてメモリ不足のみを表示し、OK後に終了 |
| `avx2` | AVX2非対応のみを表示し、OK後に終了 |
| `threads` | 4論理スレッドとしてスレッド不足のみを表示し、OK後に終了 |
| `all` | 上記3項目をすべて不足として表示し、OK後に終了 |
| `notice` | 最低要件を満たす場合のお試し用注意を表示し、OK後に利用可能 |

Ubuntu / Linux:

```sh
LOTT_DEV_CPU_STARTUP_SCENARIO=memory bash scripts/run-dev.sh
```

Windows:

```bat
set LOTT_DEV_CPU_STARTUP_SCENARIO=memory
scripts\run-dev.bat
```

環境変数を設定しなければ、CPU版では実際の搭載メモリ・AVX2対応・論理スレッド数を判定し、通常版の開発起動ではこのダイアログを表示しません。

## ディレクトリ構成

- `frontend/` Angular UI
- `src-tauri/` Tauri / Rust
- `python_sidecar/` Python CLI（文字起こし・話者分離・LLM校正）
- `python_sidecar/models/` 話者分離モデル配置先（dev）
- `scripts/` セットアップ・起動・ビルドスクリプト
- `docs/` ドキュメント

## 話者分離モデルの配置（dev）

話者分離はモデル `pyannote-speaker-diarization-community-1`（pyannote.audio 4.x）がローカル配置されていると有効になります。

- 配置先（dev）: `python_sidecar/models/pyannote-speaker-diarization-community-1/`
- アプリ内セットアップタブから Hugging Face トークンでダウンロードします。
- `DIARIZATION_MODEL_PATH` 環境変数で配置先を上書きできます。

詳細は [python_sidecar/models/README.md](../python_sidecar/models/README.md) を参照してください。

## 既定動作

- 言語: `ja`
- モデル: `turbo`
- device: `cuda`（利用不可時は失敗/再試行情報を表示）
- compute_type: `auto`
- vad_filter: `true`
- word_timestamps: `false`
- 話者分離: UI既定 `ON`

話者表示の初期値:

- `SPEAKER_00 -> Th`
- `SPEAKER_01 -> Cl`
- `SPEAKER_02 -> IP`
- `SPEAKER_03 -> IP2`
- `SPEAKER_04 -> IP3`
- それ以外 -> `Cl`

## 校正機能の内部仕様

- ルールベース校正は Tauri (Rust) 内で完結します。校正ルール: `src-tauri/resources/proofread/punctuation_rules/`
- LLM校正はローカルバックエンドのみを使います。
  - 既定: Gemma 4 E4B（同梱/DL の llama.cpp llama-server 直起動）
  - 追加: ローカルGGUF / llama.cpp 系
  - 追加: ローカル OpenAI 互換 API（`localhost` / `127.*` / `[::1]` の loopback 接続のみ）
- 内蔵校正AIモデルの階層は「AI校正バックエンド」セレクタで選べます（E4B / 12B が同セレクタに並びます）。
  - 標準: Gemma 4 E4B QAT（既定。CUDA / AMD 共通）
  - 高精度: Gemma 4 12B QAT + MTP（**NVIDIA / AMD 共通**、GPU 直起動経路。Windows/Linux NVIDIA=CUDA 直起動 / AMD=ROCm 優先・Vulkan フォールバック。large-v3 と同じく後からダウンロード（約7GB））
  - 既定は常に E4B。12B はオプトインで、未ダウンロード時は自動で E4B にフォールバックして起動します。
  - 選択は `app_local_data_dir()/proofread-model-tier.txt`（`e4b` / `12b`）に保存。MTP（投機デコード）の適用範囲・FlashAttention の扱いは [AGENTS.md](../AGENTS.md) の「MTP（投機的デコード）の適用範囲」を参照してください。
- 全体校正の分割ボタンは、上記の永続選択とは別に、ジョブ単位の `proofreadTier`（`e4b` / `12b`）を `start_llm_server` へ渡します。通常ボタンは常にE4B、メニューの「全体校正（with 12B）」は常に12Bを要求し、設定ファイルを変更しません。12B未導入時はフロント側で実行を止めて設定画面へ案内します。
- Word / Excel / SRTの書き出しは結果画面の分割ボタンにまとめています。SRTはRust側の `save_transcription_srt` で生成し、パスワード指定時は `encrypt_office_cli.py srt` によりAES-256暗号化ZIPへ格納します。

### ローカルAIアプリ（LM Studio / Ollama）連携のゲート

ローカル OpenAI 互換 API（LM Studio / Ollama）連携は **公式ビルドで無効**です。Cargo feature `local-llm-apps` を付けてソースからビルドした構成だけで有効になります。

- 判定の単一の真実はコンパイル時の `local-llm-apps` feature です。実行時のファイルや設定変更では有効化できません。
- Rust `local_llm_apps_enabled()`（`src-tauri/src/lib.rs`）が校正コマンドとモデル一覧取得をゲートし（多層防御の要）、無効時はフロントの LLM バックエンド選択肢からも LM Studio / Ollama を除外します。
- 公式インストーラーに選択ダイアログはなく、アプリ内にも有効化トグルはありません。
- **dev で連携を試す場合**: `cargo tauri dev --features local-llm-apps` で起動します。
- セグメント単位の逐次校正（`proofread_llm_cli.py`）は 40 セグメントを1バッチで送信します。プロンプトには話者ラベル（例: `Th`・`Cl`）も含まれます。
- 全体一括校正（`overall_proofread_cli.py`）は全セグメントをチャンク化して一括送信します。
- ローカル OpenAI 互換 API は Base URL とモデルを登録してプロファイル化できます。モデル一覧は互換APIサーバーへ問い合わせて取得し、サーバー名（Ollama / LM Studio / llama.cpp server など）をベストエフォートで推定します。
- 校正システムプロンプトは、選択中のモデル / ローカルAPIプロファイルごとに保存します。既定 Gemma 4 向けの指示には影響させません。
- 氏名・地名・組織名チェックの優先順位ポリシーは [AGENTS.md](../AGENTS.md) の「Named Entity Warning Priority」を参照してください。

## 音声入力・区間聞き直し（編集画面のAI聞き取り）

- 編集画面のマイク音声入力と区間聞き直しは、Gemma 4 E4B + 音声 mmproj を llama.cpp llama-server（loopback 限定）で動かし、OpenAI 互換 `input_audio` で音声を渡します。
- プロンプトテンプレート: `python_sidecar/prompt_templates/voice_input/`
- ビルド別の起動経路（Editor=CPU 直起動 / Full=GPU 直起動）、サーバーの保持・解放ライフサイクル、Editor 版のメモリ警告は [AGENTS.md](../AGENTS.md) の「音声入力」「区間聞き直し」の節を参照してください。

## 文字起こし用語辞書（initial_prompt 自動注入）

- `python_sidecar/prompt_templates/transcribe/glossary.json` が存在する場合、文字起こし時に自動で読み込みます。
- `glossary.json` は標準 JSON 形式のため、コメントは `_comment` キーで記述してください（サンプル同梱）。
- 既定以外の辞書を使う場合:
  - `TRANSCRIBE_GLOSSARY_PATH` 環境変数
  - または `transcribe_cli.py --glossary-path <path>`

## サイドカー手動実行時の環境変数

- アプリは `transcribe_cli.py` / `diarize_cli.py` へ音声ファイルパスを環境変数 `LOTT_AUDIO_PATH` で渡します（argv にクライエント名を含み得るファイル名を載せないためのプライバシー対策）。手動実行では従来どおり `--audio-path <path>` も使えます（env が未設定の場合のフォールバック）。
- `transcribe_cli.py` の initial prompt も同様に環境変数 `LOTT_INITIAL_PROMPT` が優先され、`--initial-prompt` はフォールバックです。

## 主要ファイル

- UI: `frontend/src/app/app.component.ts`
- UIテンプレート: `frontend/src/app/app.component.html`
- Tauriコマンド: `src-tauri/src/lib.rs`
- 文字起こしCLI: `python_sidecar/transcribe_cli.py`
- 話者分離CLI: `python_sidecar/diarize_cli.py`
- LLM校正CLI（逐次）: `python_sidecar/proofread_llm_cli.py`
- LLM校正CLI（全体）: `python_sidecar/overall_proofread_cli.py`

## 関連ドキュメント

- 配布ビルド（Windows NSIS）: [release-build-windows.md](release-build-windows.md)
- トラブルシューティング: [troubleshooting.md](troubleshooting.md)
- FFmpeg / PyAV ライセンス方針: [lgpl-pyav-build.md](lgpl-pyav-build.md)
- 安定領域・検討課題・コーディング規約: [AGENTS.md](../AGENTS.md)
