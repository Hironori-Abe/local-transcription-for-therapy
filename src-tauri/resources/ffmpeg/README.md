# 同梱 ffmpeg（LGPL ビルド）配置場所

このディレクトリには **LGPL ビルドの `ffmpeg` 実行ファイル**を配置します。
アプリ（Tauri）は起動時にここを探し、見つかれば `FFMPEG_BIN` 環境変数として
Python サイドカー（`transcribe_cli.py` / `diarize_cli.py`）へ渡します。

`transcribe_cli.py` は PyAV を使わず、この `ffmpeg` CLI で音声を 16kHz mono PCM に
デコードして `faster-whisper` に渡します。`diarize_cli.py` も同じ `ffmpeg` で
WAV 変換します。

- Windows: `ffmpeg.exe` をこのフォルダ直下に置く
- Linux: `ffmpeg`（実行権限付き）をこのフォルダ直下に置く

## なぜ LGPL か

本アプリは **Apache-2.0** で配布する方針です。Apache-2.0（permissive）の配布物に
GPL コンポーネントを結合するとライセンスが矛盾します。本アプリが ffmpeg に求めるのは
**音声デコード／WAV 変換のみ**で、GPL を強制する libx264 / libx265（動画エンコーダ）は
不要です。したがって LGPL ビルドで機能上は十分です。詳細は
リポジトリ root の `THIRD_PARTY_LICENSES.md`（F-4）を参照。

## 推奨ビルド入手元

- `scripts/setup_ffmpeg_lgpl.py` で BtbN/FFmpeg-Builds の `lgpl` build を取得する
  - Windows: `ffmpeg-master-latest-win64-lgpl.zip`
  - Linux: `ffmpeg-master-latest-linux64-lgpl.tar.xz`
- `lgpl-shared` build も利用可能だが、CLI 実行に必要な DLL / SO 一式を同梱すること
- 自前ビルドの場合は `--enable-gpl` を**付けず**、`libx264` / `libx265` /
  `libxvid` などの GPL コンポーネントを含めないこと
- `--enable-version3` を付ける場合は LGPLv3 として扱い、ライセンス表示もそれに合わせる
- BtbN の `lgpl` build は `--enable-version3` を含むことがある。その場合は GPL ではなく
  **LGPLv3** として扱い、同梱 `LICENSE.txt` と `FFMPEG_BUILD_INFO.txt` を配布物に含める

## 残作業（このディレクトリに置いた後）

1. `scripts/setup_ffmpeg_lgpl.py` で `ffmpeg(.exe)` / `LICENSE.txt` / `FFMPEG_BUILD_INFO.txt` を生成する
2. NSIS ビルドで `resources/ffmpeg/` が同梱されることを確認する
3. `python -m pip show av imageio-ffmpeg` が見つからないことを確認する
4. `ffmpeg -version` に `--enable-gpl` と GPL 系ライブラリが含まれないことを確認する

> ⚠️ このディレクトリにバイナリを置かなくてもアプリは動作します
> （その場合 Python サイドカーは PATH 上の `ffmpeg` を探します）。
> Apache-2.0 配布を完成させるには LGPL バイナリの配置が必要です。
