# Local Transcription for Therapy (LoTT)

臨床心理・カウンセリング会話のための、ローカル完結の日本語文字起こしデスクトップアプリです。
文字起こし・話者分離・文章校正を、会話データを PC の外へ送ることなく実行できます。

![メイン画面](docs/screenshots/main-window.png)

## 特徴

- **完全ローカル実行** — 運用時はインターネット接続不要。会話・音声データを外部 API へ送信しません
- **日本語の文字起こし** — faster-whisper（Whisper turbo モデル）
- **話者分離** — pyannote.audio による話者の自動識別（既定ラベル: Th / Cl / IP …）
- **校正** — ルールベース + ローカル LLM。氏名・地名など個人の特定につながりうる語の警告表示。校正AIは標準（Gemma 4 E4B）に加え、高精度モデル（Gemma 4 12B、NVIDIA / CUDA 版のみ・後からダウンロード）を選択可能
- セグメント表の編集・句点での分割・セグメント単位の音声再生
- Word（.docx）/ Excel（.xlsx）/ JSON 形式での保存

## プライバシーとオフライン方針

- 文字起こし・話者分離・校正の実行時に外部 API を呼びません。
- インターネット接続が必要なのは、初回セットアップ（依存パッケージ・モデル取得）のみです。
- LLM 校正の「OpenAI 互換 API」対応はプロトコル互換を意味するだけで、接続先は localhost / loopback に限定しています。クラウド推論エンドポイントには接続できない設計です。

### 外部 LLM アプリ（LM Studio / Ollama）連携について

- 外部 LLM アプリ（LM Studio / Ollama）との連携は **既定で無効**です。標準では内蔵 AI（Gemma 4 E4B）で校正でき、外部アプリ連携は不要です。
- 連携を有効化できるのは **インストール時に明示的に選択した場合のみ**です。アプリ内に再有効化のスイッチは設けていません（有効／無効の変更には再インストールが必要です）。
- 連携を有効にした場合でも接続先は loopback に限定されますが、**接続先アプリ（LM Studio / Ollama）自体の挙動は本アプリの管理外**です。これらのアプリの設定によっては会話データが外部に送信される可能性があります。通常運用では有効化しないことを推奨します。

## エディション

| エディション | 内容 |
| --- | --- |
| **LoTT Full CUDA** | 主配布。NVIDIA RTX / CUDA 向け。文字起こし・話者分離・校正のすべてを含む |
| LoTT Full AMD (ROCm) | experimental。AMD GPU 向け。文字起こし・話者分離・LLM 校正の GPU 動作確認済み |
| LoTT Editor | 校正・編集中心の軽量版（文字起こし / LLM ランタイムを省いた構成） |

## 動作環境（Full CUDA 版）

- Windows 10 / 11 64bit
- NVIDIA GPU（RTX 推奨）+ CUDA Toolkit 12.x + cuDNN 9.x
- **VRAM 8GB 以上（最低要件）**
- インストーラー約 400MB + モデルダウンロード分の空き容量

> **CPU のみでの動作は想定していません。** 文字起こし・話者分離・LLM 校正はいずれも GPU（CUDA / ROCm）での実行を前提としており、対応 GPU が無い環境では正常に動作しません。

## インストールと初回セットアップ

1. NSIS インストーラー（`*_x64-setup.exe`）を実行します
2. アプリ起動後、セットアップタブから「Python パッケージをインストール」を実行します（要ネット接続）
3. 同じセットアップタブから必要なモデルをダウンロードします
   - 文字起こしモデル（Whisper turbo）
   - 話者分離モデル（`pyannote-speaker-diarization-community-1`、Hugging Face トークンが必要）
   - 校正用 LLM（Gemma 4 E4B GGUF）

モデル取得後はオフラインで運用できます。話者分離モデルは別 PC からのローカルコピーでも配置できます。

## 使い方

1. 音声ファイルを選択して文字起こしを実行
2. 結果表で内容・話者表示名を編集（話者ラベル既定値: `SPEAKER_00 → Th`、`SPEAKER_01 → Cl` など）
3. 必要に応じて校正（名前チェック・句読点補正・LLM 校正）を実行
4. Word / Excel / JSON 形式で保存

## 技術スタック

- Desktop: Tauri 2 (Rust) / Frontend: Angular 21 + Angular Material / Sidecar: Python
- ASR: faster-whisper / Diarization: pyannote.audio
- LLM 校正: Gemma 4 E4B（既定）/ Gemma 4 12B QAT+MTP（高精度・CUDA 版のみ後付けダウンロード）+ Lemonade / llama.cpp / ローカル OpenAI 互換 API（loopback 限定）

## ドキュメント

- 開発環境セットアップ・内部仕様: [docs/development.md](docs/development.md)
- トラブルシューティング（CUDA / AMD ROCm 含む）: [docs/troubleshooting.md](docs/troubleshooting.md)
- 配布ビルド（Windows NSIS）: [docs/release-build-windows.md](docs/release-build-windows.md)
- FFmpeg / PyAV ライセンス方針: [docs/lgpl-pyav-build.md](docs/lgpl-pyav-build.md)

## ライセンス

本アプリは [Apache License 2.0](LICENSE) で配布します。
同梱の FFmpeg は LGPL 構成のビルドを使用しています。第三者ライセンスの一覧は [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) を参照してください。
