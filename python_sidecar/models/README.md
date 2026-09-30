# Models Directory

このディレクトリ（と `python_sidecar/speech-engines/`）は、**開発時**に ggml 音声エンジンとモデルを置く場所です。
Python のコードはありません（名前は履歴上の都合で残っています）。実体は大容量のため Git には含めません。

## 配置されるもの

| パス | 内容 |
| --- | --- |
| `whisper-ggml/ggml-large-v3-turbo.bin` | 文字起こしモデル（Whisper large-v3-turbo） |
| `whisper-ggml/ggml-silero-v6.2.0.bin` | 無音検出（Silero VAD） |
| `nemotron-3-diarization/Nemotron-3-Diarization.q8_0.gguf` | 話者分離モデル（Nemotron-3-Diarization、OpenMDW-1.1） |
| `../speech-engines/whisper/`、`../speech-engines/nemo/` | whisper.cpp / NeMo-Speech.cpp の実行ファイル |

## 取得方法

```bat
powershell -ExecutionPolicy Bypass -File scripts\setup-ggml-speech-windows.ps1
```

- エンジンを固定 commit からビルドし、モデルを固定 revision から取得して SHA-256 を検証します。Hugging Face のトークンは不要です。
- `-SkipModels` / `-SkipBuild` / `-SkipNemo` で工程を省略できます。
- ネットワークを使うのはこのセットアップ時だけです。アプリの実行時は通信しません。

## 補足

- 開発版のアプリは `python_sidecar/speech-engines` と `python_sidecar/models` を参照します（`resolve_ggml_speech_paths`）。
- リリース版のモデルは `%LOCALAPPDATA%\{identifier}\models\`、エンジンは同梱の `resources/speech-engines` です。
- モデルの取得元・revision・SHA-256 は `src-tauri/src/ggml_speech.rs` の `GGML_MODEL_FILES` が単一の基準です。
