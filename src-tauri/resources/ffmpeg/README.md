# 同梱 ffmpeg（LGPL ビルド）配置場所

このディレクトリには **LGPL ビルドの `ffmpeg` 実行ファイル**を配置します（Full 版のみ。Editor 版には同梱しません）。
アプリ（Tauri / Rust）は、ここにある `ffmpeg` を使って音声を 16kHz mono PCM の WAV にデコードし、
whisper.cpp / NeMo-Speech.cpp に渡します（`decode_audio_to_private_wav`）。`FFMPEG_BIN` 環境変数で上書きできます。
Python は使いません。

- Windows: `ffmpeg.exe` をこのフォルダ直下に置く
- Linux: `ffmpeg`（実行権限付き）をこのフォルダ直下に置く

バイナリは Git 管理外です。バイナリ・`LICENSE.txt`・`FFMPEG_BUILD_INFO.txt` は `scripts/setup_ffmpeg_lgpl.py` が生成します（`scripts/setup-build-tools.bat` / `scripts/setup-dev.sh` が呼びます）。

## なぜ LGPL か

本アプリは **Apache-2.0** で配布する方針です。Apache-2.0（permissive）の配布物に
GPL コンポーネントを結合するとライセンスが矛盾します。本アプリが ffmpeg に求めるのは
**音声デコード／WAV 変換のみ**で、GPL を強制する libx264 / libx265（動画エンコーダ）は
不要です。したがって LGPL ビルドで機能上は十分です。詳細は
リポジトリ root の `THIRD_PARTY_LICENSES.md`（F 章）を参照。

## 入手元（固定版）

- `scripts/setup_ffmpeg_lgpl.py` が BtbN/FFmpeg-Builds の `lgpl` build を、**固定リリースと SHA-256** を指定して取得する
  - 固定リリース: `PINNED_TAG`（現在 `autobuild-2026-09-30-13-08`、FFmpeg n8.1.3）。アーカイブ名と SHA-256 は同スクリプトの `ASSETS`
  - 取得したアーカイブの SHA-256 が固定値と一致しない場合はインストールしない（取得時点の最新版は使わない）
  - 版を上げるときは、配布元リリースの `checksums.sha256` から `PINNED_TAG` と `ASSETS` を更新し、デコード結果（MP3 / M4A / FLAC、音声調整フィルターあり・なし）が旧版と一致することを確認する
- `lgpl-shared` build も `--variant` で取得できるが、CLI 実行に必要な DLL / SO 一式を同梱すること
- 自前ビルドの場合は `--enable-gpl` を**付けず**、`libx264` / `libx265` /
  `libxvid` などの GPL コンポーネントを含めないこと
- BtbN の `lgpl` build は `--enable-version3` を含む。その場合は GPL ではなく
  **LGPLv3** として扱い、同梱 `LICENSE.txt` と `FFMPEG_BUILD_INFO.txt`（取得した版・URL・SHA-256 を記録）を配布物に含める

## 確認

1. NSIS ビルドで `resources/ffmpeg/` が同梱されることを確認する
2. `ffmpeg -version` に `--enable-gpl`、`--enable-nonfree`、`--enable-libx264`、`--enable-libx265`、`--enable-libxvid`、`--enable-libfdk-aac` が含まれないこと（`setup_ffmpeg_lgpl.py` が検査する）

> このディレクトリにバイナリを置かなくても、アプリは PATH 上の `ffmpeg` を探して動作します。
> Apache-2.0 配布を完成させるには LGPL バイナリの配置が必要です。
