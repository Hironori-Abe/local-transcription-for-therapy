# Models Directory

このディレクトリには、話者分離で使うローカルモデルを配置します。
実体モデルは大容量のため Git には含めません。

## 対象パス

- `python_sidecar/models/pyannote-speaker-diarization-community-1/`

## 取得方法（概要）

1. Hugging Face で以下モデルの利用規約に同意
   - `pyannote/speaker-diarization-community-1`

2. アプリ内セットアップからダウンロード

3. `python_sidecar/models/pyannote-speaker-diarization-community-1/config.yaml` が存在することを確認

## 補足

- このアプリは `DIARIZATION_MODEL_PATH` が未設定の場合、
  `python_sidecar/models/pyannote-speaker-diarization-community-1` を優先して参照します。
- インターネット不要運用にする場合は、事前にこのディレクトリへモデル一式を配置してください。
- `community-1` は `pyannote.audio 4.x` が必要です。
