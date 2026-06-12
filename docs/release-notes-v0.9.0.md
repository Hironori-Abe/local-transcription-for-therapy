# Local Transcription for Therapy (LoTT) v0.9.0

臨床心理・カウンセリング会話のための、ローカル完結の日本語文字起こしデスクトップアプリです。
文字起こし・話者分離・文章校正を、会話データを PC の外へ送ることなく実行できます。

## ダウンロード

| ファイル | 対象 | 備考 |
| --- | --- | --- |
| `LoTT-v0.9.0-windows-x64-cuda-setup.exe` | NVIDIA GPU (CUDA 12.x) | 主配布・安定版 |
| `LoTT-v0.9.0-windows-x64-editor-setup.exe` | GPU 不要 | 校正中心の軽量版（文字起こし・話者分離なし） |
| `SHA256SUMS.txt` | — | 各ファイルの SHA-256 チェックサム |

ダウンロード後の検証（任意）:

```sh
sha256sum -c SHA256SUMS.txt
```

## 変更点

### v0.9.0 — 初回公開リリース

- **日本語の文字起こし** — faster-whisper（Whisper turbo モデル）による GPU 文字起こし
- **話者分離** — pyannote.audio（`pyannote-speaker-diarization-community-1`）による話者の自動識別（既定ラベル: Th / Cl / IP …）
- **校正** — ルールベース校正 + ローカル LLM 校正（Gemma 4 E4B + Lemonade / llama.cpp / ローカル OpenAI 互換 API、loopback 限定）
- 氏名・地名など個人の特定につながりうる語の警告表示
- セグメント表の編集・句点での分割・セグメント単位の音声再生
- Word（.docx）/ Excel（.xlsx）/ JSON 形式での保存

## 動作要件

- Windows 10 / 11 (x64)
- NVIDIA GPU + CUDA 12.x + cuDNN 9.x（CUDA 版。Editor 版は GPU 不要）
- ディスク空き容量: インストーラー約 1GB + モデルダウンロード分

## インストールと初回セットアップ

1. インストーラーを実行する
2. アプリを起動し、セットアップタブから Python パッケージ・モデルをインストールする
   - **初回セットアップ時のみインターネット接続が必要です**（依存パッケージ・モデルの取得）
   - 話者分離モデルの取得には Hugging Face トークンが必要です（別 PC からのローカルコピーでも配置可能）
3. セットアップ完了後はオフラインで動作します

> **SmartScreen について**: 本インストーラーはコード署名されていないため、初回実行時に
> Windows SmartScreen の警告が表示されることがあります。「詳細情報」→「実行」で続行できます。
> 配布元（本 GitHub Release）からダウンロードしたファイルか、SHA-256 で確認してください。

## プライバシー

- 通常運用時はインターネットに接続しません
- 会話データ・音声データを外部 API へ送信しません
- LLM 校正を含むすべての推論はローカル（loopback）で完結します

## 既知の問題

- AMD GPU（ROCm）版は experimental です。本リリースには含まれません
- インストーラーはコード署名されていないため SmartScreen 警告が表示されます（上記参照）

## ライセンス

- 本体: Apache-2.0（同梱の `LICENSE` / `NOTICE` 参照）
- 第三者ライセンス: 同梱の `THIRD_PARTY_LICENSES.md` / `licenses/` 参照
