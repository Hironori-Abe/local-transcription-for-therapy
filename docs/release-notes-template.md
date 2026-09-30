# Local Transcription for Therapy (LoTT) vX.Y.Z

<!-- このファイルを release-notes-vX.Y.Z.md としてコピーして記入し、GitHub Release 本文に貼り付ける。 -->
<!-- アセット名・SHA256SUMS の手順は docs/release-build-windows.md「3. GitHub Release 公開手順」を参照。 -->

臨床心理・カウンセリング会話のための、ローカル完結の日本語文字起こしデスクトップアプリです。
文字起こし・話者分離・文章校正を、会話データを PC の外へ送ることなく実行できます。

## ダウンロード

| ファイル | 対象 | 備考 |
| --- | --- | --- |
| `LoTT-vX.Y.Z-windows-x64-vulkan-setup.exe` | Windows x64・NVIDIA / AMD / Intel GPU（GPU が無ければ CPU で動作） | Full 版・主配布 |
| `LoTT-vX.Y.Z-windows-x64-editor-setup.exe` | GPU 不要 | 校正中心の軽量版（文字起こし・話者分離なし） |
| `SHA256SUMS.txt` | — | 各配布ディレクトリ内のファイルに対応するSHA-256チェックサム |

<!-- Linux 版は Stage 3 で対応予定。対応後にアセット名を追記する。 -->

ダウンロード後の検証（任意）:

```sh
sha256sum -c SHA256SUMS.txt
```

## 変更点

### 新機能

- （記入）

### 改善

- （記入）

### 修正

- （記入）

## 動作要件

### Full 版

- Windows 10 / 11 (x64)
- GPU 利用時: NVIDIA / AMD / Intel の GPU と、Vulkan 対応の最新ドライバー
- GPU が無い場合（CPU 処理）: RAM 16GB 以上、AVX2 対応 CPU、8論理スレッド以上
- ディスク空き容量: 約 XX GB（モデルダウンロード含む）

### Editor 版

- Windows 10 / 11 (x64)
- 音声入力を使う場合は、音声入力パック（約1.6GB）の空き容量

## インストールと初回セットアップ

1. 対応するインストーラーを導入する
2. アプリを起動し、セットアップタブからモデルをダウンロードする
   - **初回セットアップ時のみインターネット接続が必要です**（モデルの取得）
3. セットアップ完了後はオフラインで動作します

> **SmartScreen について**: 本インストーラーはコード署名されていないため、初回実行時に
> Windows SmartScreen の警告が表示されることがあります。「詳細情報」→「実行」で続行できます。
> 配布元（本 GitHub Release）からダウンロードしたファイルか、SHA-256 で確認してください。

## プライバシー

- 通常運用時はインターネットに接続しません
- 会話データ・音声データを PC 外の API へ送信しません
- 推論はすべて PC 内の whisper.cpp / NeMo-Speech.cpp で完結します（LLM は使用しません）

## 既知の問題

- （記入）

## ライセンス

- 本体: Apache-2.0（同梱の `LICENSE` / `NOTICE` 参照）
- 第三者ライセンス: 同梱の `THIRD_PARTY_LICENSES.md` / `licenses/` 参照

> **CPU版について:** CPU版は動作確認・試用向けです。頻繁または継続的に利用する場合は、対応するGPU版の利用を推奨します。ダウンロードするファイル名と対象環境をご確認ください。
