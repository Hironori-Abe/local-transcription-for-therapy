# Local Transcription for Therapy (LoTT) v0.9.1

臨床心理・カウンセリング会話のための、ローカル完結の日本語文字起こしデスクトップアプリです。
文字起こし・話者分離・文章校正を、会話データを PC の外へ送ることなく実行できます。

## ダウンロード

| ファイル | 対象 | 備考 |
| --- | --- | --- |
| `LoTT-v0.9.1-windows-x64-cuda-setup.exe` | NVIDIA GPU (CUDA 12.x) | 主配布・安定版 |
| `LoTT-v0.9.1-windows-x64-editor-setup.exe` | GPU 不要 | 校正中心の軽量版（文字起こし・話者分離なし） |
| `SHA256SUMS.txt` | — | 各ファイルの SHA-256 チェックサム |

ダウンロード後の検証（任意）:

```sh
sha256sum -c SHA256SUMS.txt
```

## 変更点

v0.9.0 からのメンテナンスリリースです。アプリの基本機能（文字起こし・話者分離・校正）は v0.9.0 と同じです。

### 改善

- GPU を再確認するボタンを押した際に UI が一時的に固まる問題を改善しました（GPU・ランタイム判定をワーカースレッドへ移し、判定中も UI が応答し続けます）。

### 修正

- 起動時に表示されていた huggingface_hub の非推奨警告（`resume_download` / `local_dir_use_symlinks`）を解消しました。

### 開発・実験的構成向け（Windows CUDA / Editor 版には影響しません）

- 同梱 Lemonade を v10.7.0 に更新しました。コンテキスト長などの設定を環境変数から `config.json` へ移行しています（Lemonade 10.7.0 での設定用環境変数廃止に対応）。
- Linux 開発セットアップ（`scripts/setup-dev.sh`）の ROCm 向け ctranslate2 導入順を修正し、セットアップが途中で止まる問題を解消しました。
- AMD（ROCm）開発環境で同梱 lemond / lemonade を検出できるよう改善しました。

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
