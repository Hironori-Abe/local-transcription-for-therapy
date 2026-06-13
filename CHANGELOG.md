# Changelog

このプロジェクトの主要な変更点を記録します。

書式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に準拠します。

各リリースの詳細・ダウンロード手順は `docs/release-notes-vX.Y.Z.md` を参照してください。

## [Unreleased]

（未リリースの変更をここに記載）

## [0.9.1] - 2026-06-13

v0.9.0 からのメンテナンスリリース。アプリの基本機能（文字起こし・話者分離・校正）は v0.9.0 と同じです。

### 改善

- GPU を再確認するボタンを押した際に UI が一時的に固まる問題を改善（GPU・ランタイム判定をワーカースレッドへ移し、判定中も UI が応答し続けます）。

### 修正

- 文字起こし・話者分離・AI 校正（句読点付与／全体校正）の**二重起動ガード**を追加。実行中に再実行されても多重に GPU 処理が走らないようにしました。
- 起動時に表示されていた huggingface_hub の非推奨警告（`resume_download` / `local_dir_use_symlinks`）を解消。

### 開発・実験的構成向け（Windows CUDA / Editor 版には影響しません）

- 同梱 Lemonade を v10.7.0 に更新。コンテキスト長などの設定を環境変数から `config.json` へ移行（Lemonade 10.7.0 での設定用環境変数廃止に対応）。
- Linux 開発セットアップ（`scripts/setup-dev.sh`）の ROCm 向け ctranslate2 導入順を修正し、セットアップが途中で止まる問題を解消。
- AMD（ROCm）開発環境で同梱 lemond / lemonade を検出できるよう改善。

## [0.9.0] - 2026-06-12

初回公開リリース。

### 追加

- **日本語の文字起こし** — faster-whisper（Whisper turbo モデル）による GPU 文字起こし。
- **話者分離** — pyannote.audio（`pyannote-speaker-diarization-community-1`）による話者の自動識別（既定ラベル: Th / Cl / IP …）。
- **校正** — ルールベース校正 + ローカル LLM 校正（Gemma 4 E4B + Lemonade / llama.cpp / ローカル OpenAI 互換 API、loopback 限定）。
- 氏名・地名など個人の特定につながりうる語の警告表示。
- セグメント表の編集・句点での分割・セグメント単位の音声再生。
- Word（.docx）/ Excel（.xlsx）/ JSON 形式での保存。

[Unreleased]: https://github.com/Hironori-Abe/local-transcription-for-therapy/compare/v0.9.1...HEAD
[0.9.1]: https://github.com/Hironori-Abe/local-transcription-for-therapy/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/Hironori-Abe/local-transcription-for-therapy/releases/tag/v0.9.0
