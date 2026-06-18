# 開発ガイド

ソースからのビルド・開発者向けのドキュメントです。
利用者向けの情報は [README.md](../README.md)、プロジェクトの方針・規約・安定領域は [AGENTS.md](../AGENTS.md) を参照してください。

## 事前に必要なもの（Windows）

- Node.js (LTS)
- Python for Windows
- Rustup / Cargo
- Microsoft C++ Build Tools
- NVIDIA GPU Driver（GPU利用時）
- CUDA Toolkit 12.x + cuDNN 9.x（GPU利用時）

## セットアップと開発起動

### Windows

プロジェクト直下で実行:

```bat
scripts\setup-dev.bat
scripts\run-dev.bat
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

- `setup-dev.sh` は Rustup / Cargo、Node.js、Python venv、Tauri / WebKit 系依存、GPU検証用依存の準備を担います。
- Chrome / Chromium の Snap 版が WebKit / glibc と衝突することがあるため、deb 版ブラウザまたは通常のシステムライブラリ経路を優先してください。

### 実行環境エミュレーション

CUDA なし環境や話者分離モデル未配置環境を開発機で擬似再現できます。
詳細は [dev-runtime-emulation.md](dev-runtime-emulation.md) を参照してください。

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
- アプリ内セットアップタブから Hugging Face トークンでダウンロードするか、別 PC からフォルダごとコピーします。
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
  - 既定: Gemma 4 E4B / Lemonade 系のローカル実行
  - 追加: ローカルGGUF / llama.cpp 系
  - 追加: ローカル OpenAI 互換 API（`localhost` / `127.*` / `[::1]` の loopback 接続のみ）

### 外部 LLM アプリ（LM Studio / Ollama）連携のゲート

ローカル OpenAI 互換 API（LM Studio / Ollama）連携は **既定で無効**です。インストーラのオプトイン（`nvidia-hooks.nsh` / `lemonade-hooks.nsh`）で「はい」を選んだときだけ、`app_local_data_dir()` 直下に `external-llm-policy.txt`（内容 `enabled`）が書き込まれて有効になります。

- 判定の単一の真実はこのマーカーファイルです（内容が `enabled` のときだけ有効、それ以外はすべて無効＝フェイルクローズ）。
- Rust `external_llm_enabled()`（`src-tauri/src/lib.rs`）が校正コマンドとモデル一覧取得をゲートし（多層防御の要）、無効時はフロントの LLM バックエンド選択肢からも LM Studio / Ollama を除外します。
- アプリ内に再有効化トグルはありません。有効／無効の変更は再インストールで行います。
- **dev で連携を試す場合**: `app_local_data_dir()` 相当のパス（Windows は `%LOCALAPPDATA%\{identifier}\`）に `external-llm-policy.txt` を作成し、内容を `enabled` にして再起動します。
- セグメント単位の逐次校正（`proofread_llm_cli.py`）は 40 セグメントを1バッチで送信します。プロンプトには話者ラベル（例: `Th`・`Cl`）も含まれます。
- 全体一括校正（`overall_proofread_cli.py`）は全セグメントをチャンク化して一括送信します。
- ローカル OpenAI 互換 API は Base URL とモデルを登録してプロファイル化できます。モデル一覧は互換APIサーバーへ問い合わせて取得し、サーバー名（Ollama / LM Studio / llama.cpp server / Lemonade など）をベストエフォートで推定します。
- 校正システムプロンプトは、選択中のモデル / ローカルAPIプロファイルごとに保存します。既定 Gemma 4 向けの指示には影響させません。
- 氏名・地名・組織名チェックの優先順位ポリシーは [AGENTS.md](../AGENTS.md) の「Named Entity Warning Priority」を参照してください。

## 文字起こし用語辞書（initial_prompt 自動注入）

- `python_sidecar/prompt_templates/transcribe/glossary.json` が存在する場合、文字起こし時に自動で読み込みます。
- `glossary.json` は標準 JSON 形式のため、コメントは `_comment` キーで記述してください（サンプル同梱）。
- 既定以外の辞書を使う場合:
  - `TRANSCRIBE_GLOSSARY_PATH` 環境変数
  - または `transcribe_cli.py --glossary-path <path>`

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
