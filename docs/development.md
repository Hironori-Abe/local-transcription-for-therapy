# 開発ガイド

ソースからのビルド・開発者向けのドキュメントです。
利用者向けの情報は [README.md](../README.md)、プロジェクトの方針・規約・安定領域は [AGENTS.md](../AGENTS.md) を参照してください。

現在の配布エディションは Full（NVIDIA / AMD / Intel を Vulkan で使う。GPU が無ければ CPU）と Editor の2つです。Windows と Linux（deb / AppImage）を対象とします（Linux は未検証。[AGENTS.md](../AGENTS.md) の Distribution Strategy を参照）。

## 事前に必要なもの（Windows）

- Node.js (LTS)
- Rustup / Cargo
- Microsoft C++ Build Tools（Visual Studio 2022 Build Tools。C++、同梱の CMake / Ninja を使用）
- Git
- LunarG Vulkan SDK（音声エンジンのビルド時のみ）
- GPU 利用時: GPU メーカーの最新ドライバー（Vulkan 対応）。CUDA Toolkit・cuDNN・Python は不要

## セットアップと開発起動

### Windows

プロジェクト直下で、次の順に実行します。

```bat
rem 1. 音声エンジン（whisper.cpp / NeMo-Speech.cpp の Vulkan ビルド）とモデルの取得
powershell -ExecutionPolicy Bypass -File scripts\setup-ggml-speech-windows.ps1

rem 2. Full 版の開発起動
scripts\run-dev.bat

rem Editor 版の開発起動
scripts\run-dev-editor.bat
```

- `setup-ggml-speech-windows.ps1` は固定 commit からエンジンをビルドし、`python_sidecar\speech-engines\{whisper,nemo}\` へ配置します。モデルは固定 revision から取得して SHA-256 を検証し、`python_sidecar\models\` へ配置します。ネットワークを使うのはこのセットアップ時だけです。詳細は [ggml-speech-engine-design.md](ggml-speech-engine-design.md) を参照してください。
- ビルド用の作業場所は `%LOCALAPPDATA%\lott-ggml-speech-build` です。
- `run-dev.bat` は Angular dev server（`127.0.0.1:4200`）と `tauri dev`（`tauri.dev.windows.override.json`）を起動します。エンジンが未配置なら案内を表示して終了します。
- `run-dev-editor.bat` は Editor 用の Angular dev server（`127.0.0.1:4203`）と `tauri.editor.windows.override.json` + `tauri.editor.dev.windows.override.json` で起動します。
- `run-dev.bat` のオプション: `--no-hold`（終了時に待機しない）/ `--cpu`（`LOTT_DEV_FORCE_CPU=1` を設定。GPU を無いものとして CPU で動かす。開発ビルドだけで有効で、リリースビルドでは無視されます。画面に「開発オプション: CPU強制」と表示されます）。`run-dev.sh` も `--cpu` を受け付けます。
- 開発用の Angular dev server は `127.0.0.1` にだけ bind します。
- 音声デコードに使う LGPL 構成 ffmpeg は、`python scripts\setup_ffmpeg_lgpl.py` で取得します（`run-dev.bat` の案内も参照）。

### Linux（未検証）

Ubuntu 24.04 を想定しています（CachyOS / Arch でも `setup-dev.sh` は pacman を使えますが、同様に未検証です）。Linux 実機での実行確認はまだ行っていません。

```sh
# 1. システムパッケージ・npm・Rust・音声エンジン（Vulkan）・モデル・LGPL ffmpeg
bash scripts/setup-dev.sh

# 2. Full 版の開発起動
bash scripts/run-dev.sh

# Editor 版の開発起動（whisper.cpp のみ。NeMo・ffmpeg は不要）
bash scripts/setup-dev.sh --editor
bash scripts/run-dev-editor.sh
```

- `setup-dev.sh` のオプション: `-y`（確認なしで導入）/ `--skip-apt` / `--skip-rust` / `--only-rust` / `--skip-engines` / `--skip-models` / `--editor`。Python の venv・pip・PyTorch・llama.cpp は使いません（`python3` は ffmpeg 取得スクリプトを動かすためだけに使います）。
- 導入するのは Tauri / WebKitGTK / GStreamer（再生用）/ Vulkan ヘッダーと `glslc` / ビルドツール、npm 依存、Rustup です。`sudo` が必要です。権限昇格を禁止した端末（Codex / VS Code の統合端末など）では `NoNewPrivs=1` で止まるため、独立した端末で実行してください。
- 音声エンジンは `scripts/setup-ggml-speech-linux.sh` が固定 commit から Vulkan でビルドし、`python_sidecar/speech-engines/{whisper,nemo}/` へ配置します（オプション: `--backend vulkan|cpu`、`--engines-dir`、`--skip-nemo`、`--skip-models`）。モデルは固定 revision・SHA-256 検証で `python_sidecar/models/` へ取得します。詳細は [ggml-speech-engine-design.md](ggml-speech-engine-design.md) を参照してください。
- `run-dev.sh` は Angular dev server（`127.0.0.1:4200`）と `tauri dev`（`tauri.dev.linux.override.json`）を起動します。`run-dev-editor.sh` は `127.0.0.1:4203` と `tauri.editor.linux.override.json` + `tauri.editor.dev.linux.override.json` で起動します。
- 実行時には、ホストの `libvulkan.so.1`（Ubuntu では `libvulkan1`）と、GPU 用の Vulkan ドライバー（Mesa または NVIDIA）が必要です。GPU が見えない場合は CPU で処理します（[トラブルシューティング](troubleshooting.md)）。
- 配布物（deb / AppImage）のビルドは [release-build-linux.md](release-build-linux.md) を参照してください。

### 実行環境エミュレーション

デバッグビルドでは、次の環境変数で起動時の警告を実機の状態と無関係に再現できます。リリースビルドでは無視されます。

#### CPU 実行時の起動時警告（`LOTT_DEV_CPU_STARTUP_SCENARIO`）

GPU が使えず CPU で処理する場合の起動時ダイアログを再現します。

| 値 | 再現する状態 |
| --- | --- |
| `memory` | RAM 8GBとしてメモリ不足のみを表示し、OK後に終了 |
| `avx2` | AVX2非対応のみを表示し、OK後に終了 |
| `threads` | 4論理スレッドとしてスレッド不足のみを表示し、OK後に終了 |
| `all` | 上記3項目をすべて不足として表示し、OK後に終了 |
| `notice` | 最低要件を満たす場合の CPU 処理の注意を表示し、OK後に利用可能 |

```bat
set LOTT_DEV_CPU_STARTUP_SCENARIO=memory
scripts\run-dev.bat
```

環境変数を設定しなければ、GPU が使える場合はこのダイアログを表示しません。GPU が使えない場合は実際の搭載メモリ・AVX2対応・論理スレッド数を判定します（最低要件は RAM 16GB以上、AVX2、8論理スレッド以上）。

#### GPU ドライバー案内（`LOTT_DEV_GPU_DRIVER_SCENARIO`）

`missing`（ドライバー未導入）または `old`（ドライバーが古い）を指定すると、GPU ドライバーの案内文（起動ダイアログとバナー）を再現します。

```bat
set LOTT_DEV_GPU_DRIVER_SCENARIO=missing
scripts\run-dev.bat
```

## ディレクトリ構成

- `frontend/` Angular UI
- `src-tauri/` Tauri / Rust（文字起こし・話者分離の起動、ルールベース校正、保存、モデル取得）
- `python_sidecar/speech-engines/` ggml 音声エンジンの配置先（dev。Git 管理外）
- `python_sidecar/models/` whisper.cpp / Nemotron のモデル配置先（dev。Git 管理外）
- `scripts/` セットアップ・起動・ビルドスクリプト
- `docs/` ドキュメント

Python のコードは持ちません。`python_sidecar/` の名前は、開発時のエンジン・モデル配置先として残っています。リリース版のエンジンは `resources/speech-engines`、モデルは `app_local_data_dir()/models/` に置かれます。

## 既定動作

- 言語: `ja`
- モデル: `turbo`（Whisper large-v3-turbo）
- device: Vulkan GPU があれば GPU、無ければ CPU（起動時に確認し、GPU ドライバーの問題があれば案内する）
- VAD（Silero）: 有効
- 話者分離: UI既定 `ON`

複数 GPU の PC では、内蔵 GPU 以外で VRAM が最大の GPU を自動選択します。設定タブで変更でき、選択は GPU の UUID で保存します（`src-tauri/src/gpu_select.rs`）。

話者表示の初期値:

- `SPEAKER_00 -> Th`
- `SPEAKER_01 -> Cl`
- `SPEAKER_02 -> IP`
- `SPEAKER_03 -> IP2`
- `SPEAKER_04 -> IP3`
- それ以外 -> `Cl`

## 校正機能の内部仕様

- 校正はすべてルールベースで、Tauri (Rust) 内で完結します。LLM による校正・全体校正はありません。
- 句読点ルール: `src-tauri/resources/proofread/punctuation_rules/`
- whisper.cpp の文字起こし直後と話者分離のやり直し後に、句読点で終わらない行の末尾補完と、日本語の直後の半角「?」「!」の全角化を行います。カウンセリング会話のフィラー・相づちは常に保持します。
- 氏名・地名・組織名チェックの優先順位ポリシーは [AGENTS.md](../AGENTS.md) の「Named Entity Warning Priority」を参照してください。
- Word / Excel / SRTの書き出しは結果画面の分割ボタンにまとめています。暗号化保存（DOCX / XLSX / AES-256 ZIP）は Rust の `src-tauri/src/export_crypto.rs` が担当します。

## 音声入力（編集画面のマイク録音）

- 編集画面の各行のマイクボタンで最大15秒録音し、whisper.cpp（Whisper turbo）で書き起こして候補を1件挿入します。フィラー例文付きの1回だけ実行し、前後行の文脈は渡しません。
- Full 版はセットアップ済みの whisper.cpp を使い、GPU があれば GPU、無ければ CPU（`-ng`）で動かします。
- Editor 版は常に CPU（`-ng`）で動かします。Whisper turbo と Silero VAD（約1.6GB）は設定タブの「音声入力パック」から取得します。
- 実装: `generate_whisper_voice_input_candidates_blocking`（`src-tauri/src/lib.rs`）

## 主要ファイル

- UI: `frontend/src/app/app.component.ts`
- UIテンプレート: `frontend/src/app/app.component.html`
- Tauriコマンド: `src-tauri/src/lib.rs`
- ggml 音声エンジン: `src-tauri/src/ggml_speech.rs`
- GPU 選択: `src-tauri/src/gpu_select.rs`
- GPU ドライバー案内: `src-tauri/src/gpu_driver.rs`
- 暗号化保存: `src-tauri/src/export_crypto.rs`

## 関連ドキュメント

- ggml 音声エンジンの設計: [ggml-speech-engine-design.md](ggml-speech-engine-design.md)
- 配布ビルド（Windows NSIS）: [release-build-windows.md](release-build-windows.md)
- トラブルシューティング: [troubleshooting.md](troubleshooting.md)
- 安定領域・検討課題・コーディング規約: [AGENTS.md](../AGENTS.md)
