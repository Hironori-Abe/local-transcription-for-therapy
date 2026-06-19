# AGENTS.md

## Project Mission

このプロジェクトの目的は、**臨床心理学的実践・カウンセリング会話の文字起こしを快適にする**ことです。  
対象アプリは Local Transcription for Therapy (LoTT) であり、会話データをローカル完結で扱うことを前提とします。

## Product Scope

本アプリの中核機能は次の3つです。

1. 文字起こし
2. 話者分離
3. 文章校正

上記を「実運用で使える品質」で継続改善することを開発方針とします。

## Non-Negotiable Constraints

- 通常運用時はインターネットに接続しない
- 外部APIへ会話データ・音声データを送信しない
- ネット接続を許可するのは、初回セットアップ・依存導入・モデル取得時のみ
- 個人情報保護要件を、性能要件より優先する

## Stack

- App shell: Tauri 2 (Rust)
- Frontend: Angular 21 + Angular Material
- Sidecar: Python
- ASR: faster-whisper
- Diarization: pyannote.audio (`pyannote-speaker-diarization-community-1`)
- LLM proofreading: Gemma 4 E4B（既定）/ Gemma 4 12B QAT+MTP（高精度・CUDA版のみ後付けDL）+ Lemonade / llama.cpp / local OpenAI-compatible API（loopback only）

## Runtime Defaults

- language: `ja`
- ASR model: `turbo`
- device: `cuda`（利用不可時は明示的に失敗/再試行情報を表示）
- compute_type: `auto`
- vad_filter: `true`（将来見直し候補）
- word_timestamps: `false`
- diarization: UI既定 `ON`

話者表示の初期値:

- `SPEAKER_00 -> Th`
- `SPEAKER_01 -> Cl`
- `SPEAKER_02 -> IP`
- `SPEAKER_03 -> IP2`
- `SPEAKER_04 -> IP3`
- others -> `Cl`

## Repository Map

- `frontend/`: Angular UI
- `src-tauri/`: Tauri / Rust commands
- `python_sidecar/`: transcription/diarization/proofread CLI
- `python_sidecar/models/`: local model placement
- `scripts/`: setup/build/run scripts

## Setup and Run (Windows)

推奨フロー:

```bat
scripts\setup-dev.bat
scripts\run-dev.bat
```

前提環境:

- Node.js (LTS)
- Python for Windows
- Rustup / Cargo
- Microsoft C++ Build Tools
- NVIDIA Driver, CUDA 12.x, cuDNN 9.x（GPU利用時）

話者分離モデルは UI セットアップタブまたは別PCからのローカルコピーで配置する。

## Setup and Run (Ubuntu / Linux)

推奨フロー:

```sh
bash scripts/setup-dev.sh
bash scripts/run-dev.sh
```

補足:

- `setup-dev.sh` は Rustup / Cargo、Node.js、Python venv、Tauri / WebKit 系依存、GPU検証用依存の準備を担う
- Ubuntu / Linux では Chrome / Chromium の Snap 版が WebKit / glibc と衝突することがあるため、deb 版ブラウザまたは通常のシステムライブラリ経路を優先する
- ROCm / AMD 検証は experimental。gfx1150（Radeon 890M）では文字起こし・話者分離ともに GPU 動作確認済み（50 分音声も完走）

## Diarization Model Policy

- `pyannote-speaker-diarization-community-1` をローカル配置した場合に有効化
- モデル配置先（dev）: `python_sidecar/models/pyannote-speaker-diarization-community-1/`
- モデル配置先（リリース）: `%LOCALAPPDATA%\{identifier}\models\pyannote-speaker-diarization-community-1\`（`app_local_data_dir()/models/`）。NSIS アンインストーラーの `%LOCALAPPDATA%\{identifier}` 一括削除対象
- 必要に応じて `DIARIZATION_MODEL_PATH` で上書き可能
- モデル取得は UI セットアップタブまたは別PCからのローカルコピーで対応

## Audio Decode / FFmpeg License Policy

- Apache-2.0 配布方針のため、配布用 Python 環境に `av`（PyAV）と `imageio-ffmpeg` を入れない
- `faster-whisper` は `--no-deps` で先に導入し、PyAV を依存解決で入れない
- `faster-whisper` のトップレベル `import av` は `python_sidecar/transcribe_cli.py` の最小 import stub で通す
- 実際の音声デコードは同梱または PATH 上の **LGPL 構成 ffmpeg CLI** で行い、16kHz mono float32 numpy 配列として `WhisperModel.transcribe()` に渡す
- 話者分離前の WAV 変換も同じ `FFMPEG_BIN` を使う
- `imageio-ffmpeg` fallback は `ALLOW_GPL_FFMPEG=1` のときだけ開発用に許可する。Tauri 通常起動では `ALLOW_GPL_FFMPEG=0`
- 同梱 ffmpeg は `--enable-gpl`、`--enable-nonfree`、`--enable-libx264`、`--enable-libx265`、`--enable-libxvid`、`--enable-libfdk-aac` を含まないこと
- BtbN `lgpl` build は `--enable-version3` を含むため LGPLv3 として扱い、`LICENSE.txt` / `FFMPEG_BUILD_INFO.txt` / ソース入手手段を配布物に含める
- 配布 override の Tauri resources には `../LICENSE` / `../NOTICE` / `../THIRD_PARTY_LICENSES.md` / `../licenses` も含める。override を変更する場合はこれらを落とさない
- 検証用スクリプト: `scripts/verify_lgpl_ffmpeg_no_pyav.py`
- 詳細記録: `docs/lgpl-pyav-build.md`

## Proofreading Policy

- ルールベース校正は Tauri/Rust 側で完結する
- ルールベース校正定義: `src-tauri/resources/proofread/punctuation_rules/`
- LLM校正は Python sidecar からローカルバックエンド（llama-cpp / Lemonade / local OpenAI-compatible API）を利用し、外部推論APIは利用しない
- `OpenAI-compatible API` という名称はプロトコル互換を意味するだけで、接続先は `http://localhost:*` / `http://127.*:*` / `http://[::1]:*` のような loopback に限定する
- クラウド OpenAI API、外部ホスト、HTTPS の外部推論エンドポイントへ会話データを送信する設計は採用しない
- 既定の Gemma 4 E4B / Lemonade 経路は、互換APIプロファイルの追加後も従来どおりのデフォルト経路として扱う
- 校正システムプロンプトは設定単位で保存する。既定 Gemma 4 向けのプロンプトに、ローカル互換API用の変更を波及させない

### 校正エンジンのライフサイクル（VRAM解放）

基本方針: **自身が起動したモデルは、ジョブ完了時とアプリ終了時（強制終了含む）に解放する**。実装は **Rust 側に集約**しており、フロントから二重に停止しない（特に AMD で lemond を kill しない）。

- **per-job 解放（Rust）**: `proofread_transcription_llm` / `run_overall_proofread` はサイドカー終了後（成功・中止・失敗すべて）に、`backend == "lemonade"`（同梱エンジン）なら次を行う。
  - CUDA（`LemonadeServer.mode == 1`）: `try_stop_cuda_llama_server` が同梱 llama-server を kill して VRAM を解放。次回校正で `start_lemonade_server` が再起動・再ロードする。
  - AMD lemond（`mode == 0`）: `try_stop_cuda_llama_server` は false を返し、`try_unload_lemonade_cli`（`lemonade unload`）で**モデルのみ unload・lemond プロセスは維持**する。
  - 外部API（lmstudio / ollama）は `try_unload_openai_model` でアンロード。
- **アプリ終了時解放**:
  - グレースフル終了: ウィンドウ `CloseRequested` / `Destroyed` ハンドラ（`lib.rs` setup 内）が `state.child` を `kill_process_tree_by_pid` + `child.kill` し、`try_unload_lemonade_cli` / `try_unload_openai_model` も呼ぶ。CUDA llama-server・AMD lemond どちらの child も kill 対象。
  - 強制終了・クラッシュ（ハンドラが走らない）: **CUDA 同梱 llama-server・AMD lemond の両方**に `assign_to_kill_on_close_job`（Windows Job Object `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）を spawn 時に付与済み（`try_start_llama_server_cuda` / `try_start_lemonade_bin`）。アプリプロセスが死ねば OS が job を閉じ、エンジン（と配下のバックエンド）を確実に終了させる。
- **遅延起動（pre-warm 廃止）**: フロントはアプリ起動時・バックエンド/GPUモード変更時にエンジンを**起動しない**（`refreshLemonadeUiState` は状態確認のみ）。エンジンが起動するのは**実際に校正を実行したとき**（`runLlmProofread` / `runOverallProofread` 内の `startLemonade`）だけ。これにより校正していない間は VRAM を保持しない。校正後は per-job 解放で再び解放され、アイドル時は VRAM 0 に戻る。初回校正時にモデルロード（数秒）が入るトレードオフを許容する。

### 内蔵校正AIモデルの階層選択（標準 / 高精度）

設定タブ「校正用AIモデル」セクションの「AI校正バックエンド」セレクタで、内蔵校正モデルの階層を選べる。E4B（標準）と 12B（高精度）は同じ内蔵モデル経路（`backendMode = local_gguf`）の別項目としてこのセレクタに並ぶ（外部APIの LM Studio / Ollama も同じセレクタ）。専用の「校正AIモデル」セレクタは廃止し、バックエンド選択へ統合した。

| 階層 | モデル | 既定 | 対象 | 取得方法 |
| --- | --- | --- | --- | --- |
| 標準 | Gemma 4 E4B QAT（+MTP） | ✅ | CUDA / AMD 共通 | setup スクリプトで同梱取得（従来どおり） |
| 高精度 | Gemma 4 12B QAT + MTP | | **NVIDIA / AMD 共通**（GPU 直起動経路） | large-v3 と同じく**後からダウンロード**（約7GB） |

- **既定は E4B（標準）**。12B は「上位モデル」としてのオプトインで、選択しなければ従来どおり E4B 経路（デフォルトプロンプト・実行条件とも不変）。
- 12B は `unsloth/gemma-4-12B-it-qat-GGUF`（本体 `gemma-4-12B-it-qat-UD-Q4_K_XL.gguf` + ドラフト `mtp-gemma-4-12B-it.gguf`）を `download_gemma_gguf_cli.py --model 12b` で取得する。配置先は E4B と並ぶ `python_sidecar/models/llm/gemma-4-12b-it/`（リリースは `app_local_data_dir()/models/llm/gemma-4-12b-it/`）。NVIDIA・AMD いずれも本体 + MTP ドラフトの両方を取得する。
- **12B はどちらの GPU でも「llama-server 直起動」で動かす**（lemond のモデル管理は経由しない。lemond の checkpoint は HF 参照のみでローカル GGUF パスを取れないため）。
  - **NVIDIA**: 同梱 CUDA llama-server（`try_start_llama_server_cuda`、`-ngl 99` + MTP）。
  - **AMD**: Lemonade が `lemonade backends install llamacpp:vulkan` で取得する **Vulkan ビルド**の llama-server（`try_start_llama_server_vulkan`、auto-fit + MTP）。**rocm-stable の古いビルドはドラフトの arch `gemma4-assistant` を認識できない**ため Vulkan ビルド（b9585+）を使う。`-ngl` は指定せず auto-fit に任せ、8GB クラスの dGPU でも本体+ドラフトが収まるよう ctx は `AMD_12B_CTX_SIZE`(=8192) を使う。
  - どちらも `mode=1`（per-job 停止・kill-on-close の対象）。E4B は従来どおり AMD では lemond、NVIDIA では同梱 CUDA llama-server。
- 選択の単一の真実は `app_local_data_dir()/proofread-model-tier.txt`（内容 `e4b` / `12b`、既定 `e4b`）。ビルド識別子による E4b 丸めは廃止し、実際に 12B を使えるかは実行時に `resolve_effective_proofread_tier`（本体 GGUF の有無）と `amd_vulkan_12b_launch`（Vulkan バイナリの有無）で判定する。NSIS の `%LOCALAPPDATA%\{id}` 一括削除対象。
- **フェイルセーフ**: 12B 選択でも本体 GGUF 未取得なら `resolve_effective_proofread_tier` が E4b へフォールバック。AMD で Vulkan バイナリ未取得なら `amd_vulkan_12b_launch` が None を返し lemond(E4B) 経路へフォールバックする（要: `llamacpp:vulkan` バックエンドの導入）。
- 関連: `get_default_llm_model_path` / `get_default_llm_mtp_model_path`（実効階層を解決）、`check_gemma_12b_installed`、`download_gemma_12b`、`amd_vulkan_12b_launch` / `find_lemonade_vulkan_llama_server` / `try_start_llama_server_vulkan`（AMD 直起動）。

### Lemonade バックエンドバイナリの保存場所

Lemonade 10.4.0 以降、`llamacpp:rocm` / `llamacpp:vulkan` / `llamacpp:cpu` などのバックエンドは `lemond` 本体とは別にダウンロードする構成になった。

アプリは `lemond` をアプリ固有のキャッシュディレクトリ（位置引数）で起動する。これによりバックエンドバイナリがアプリ専用フォルダに保存される。

| パス | 内容 |
| --- | --- |
| `src-tauri/resources/lemonade/` | アプリ同梱の `lemond`・`lemonade` バイナリ（Tauri リソースとして配布） |
| `~/.cache/{app-id}/lemonade/bin/` | `lemonade backends install` でダウンロードされた `llama-server` などのバックエンドバイナリ（アプリ固有） |
| `~/.cache/{app-id}/lemonade/config.json` | Lemonade の実行時設定（ポート、デフォルトモデル、args など） |

`{app-id}` は Tauri の `identifier`（CUDA 版: `net.gakkousya.lott`、AMD 版: `net.gakkousya.lott-amd`）に対応する。Windows では `%LOCALAPPDATA%\{app-id}\lemonade\`。

- `lemond [cache_dir]` 形式で起動することでアプリ固有の場所に隔離される（`LEMONADE_CACHE_DIR` 環境変数は不要）
- `lemonade backends install llamacpp:rocm` は接続中の lemond サーバーへ指示を出し、lemond が自身の cache_dir 内にダウンロードする
- バックエンドバイナリは一度ダウンロードすれば以降はオフラインで動作する
- AMD GPU（ROCm）を使う場合は `llamacpp:rocm` を優先インストールする（Vulkan より高速なことが多い）
- `llamacpp:system` は OS インストール済みの llama-server を参照するため PC 依存になる。配布アプリでは使わない
- Lemonade 10.7.0 で lemond 設定用の環境変数（`LEMONADE_CTX_SIZE` / `LEMONADE_PORT` など）は廃止された。設定は `config.json`（または `lemonade config set`）で行う。アプリは `ensure_lemonade_app_port_config` が `port` / `ctx_size`(=16384、40セグメントバッチ用) / `llamacpp.prefer_system`(=false) を config.json に書き込む。**`LEMONADE_CTX_SIZE` 環境変数を再導入しないこと**（lemond 10.7.0 は参照しない）

### MTP（投機的デコード）の適用範囲

- MTP ドラフト（E4B: `mtp-gemma-4-E4B-it.gguf`、約60MB）は setup スクリプトが Gemma 本体と一緒に**無条件でダウンロード**する（CUDA/AMD 問わず）。「ダウンロードした記憶がないファイル」はこれで、正常。高精度階層の 12B ドラフト（`mtp-gemma-4-12B-it.gguf`、約242MB）は 12B 選択時に本体とまとめて後からダウンロードする（[内蔵校正AIモデルの階層選択](#内蔵校正aiモデルの階層選択標準--高精度)参照）
- MTP を使うのは **GPU 直起動経路（lemond 非経由）**。E4B・12B の両階層で `--spec-type draft-mtp` / `--spec-draft-model` / `--spec-draft-n-max 3` を渡す。**FlashAttention は MTP 配線時は `off`、MTP 非併用時のみ `on`**（`flash_attn = if mtp_model_path.is_some() { "off" } else { "on" }`）。MTP ドラフト併用時に `--flash-attn on`（および `auto`）を渡すと、一部 GPU/ビルドで CUDA FlashAttention カーネル（`ggml-cuda/fattn.cu:110`）が致命的に落ち、サーバがポートを開く前にクラッシュする（RTX 4060 Laptop + 同梱 llama.cpp build 9571 で確認）。MTP の投機的デコード自体は維持する
  - **NVIDIA**: 同梱 CUDA llama-server（`try_start_llama_server_cuda`）。`--spec-draft-ngl 99`（ドラフト全レイヤー GPU）+ `-ngl 99`。
  - **AMD**: Lemonade の **Vulkan ビルド** llama-server（`try_start_llama_server_vulkan`）。`-ngl` も `--spec-draft-ngl` も指定せず **auto-fit** に任せる（8GB クラスで本体+ドラフトを収めるため）。**rocm-stable の古いビルド（例 b9247）はドラフトの arch `gemma4-assistant` を `unknown model architecture` で拒否する**ため、新しい Vulkan ビルド（b9585+、`gemma4-assistant` 対応）を使う。実測: RX 7600M XT(8GB) で 12B+MTP・ctx 8192・約28〜29 tok/s（プレーンの約1.6倍）、VRAM 約8.0/8.5GB。
- **lemond 経由の per-model MTP は使わない**。lemond の `load --llamacpp-args` で MTP を渡す方式も検討したが、lemond のモデル管理（リクエスト単位ロード）との整合が不安定だったため、NVIDIA と同じ「llama-server 直起動」に統一した。

### Named Entity Warning Priority

- 氏名、氏名としても使われる地名、ローカルな地名など、個人の特定につながりうる候補は最優先で扱う。ある程度の誤検出は許容し、語の一部に含まれる場合も注意喚起対象にする。UI では最も強い警告として赤字表示を基本とする。
- `〜病院`、`〜学校`、`〜相談室`、`...さん` など、直前に特定可能な名称が来やすい語は正規表現や敬称ルールで拾う。これは二段目の注意喚起として扱い、UI では黄色系の警告表示を基本とする。
- `personNames` は頻度だけで判断しない。統計上は多くなくても、地名候補・駅名候補・地域名候補のうち「名字や名前として聞いたことがある」「有名人にいそう」と判断できるものは、個人名優先で積極的に `personNames` へ移す。

## AMD GPU 互換性調査（2026-05-23）

### ctranslate2-rocm v4.7.2 ビルド収録 GFX ターゲット

2026年2月に本家 OpenNMT/CTranslate2 へ ROCm 統合（v4.7.0）、最新は v4.7.2（2026-05-19）。

| GFX | 代表GPU | ホイール収録 | 文字起こし実績 |
| --- | --- | --- | --- |
| gfx1201 / gfx1200 | RX 9070 / 9060 系 | ✅ | AMD公式サポート（未検証） |
| gfx1151 / gfx1150 | Radeon 8060S / 890M（Strix Point） | ✅ | gfx1150: GPU 動作確認済み（本プロジェクト）。gfx1151: ROCm 7.2.2 で HSA_OVERRIDE 不要で動作（nabe2030 氏報告） |
| gfx1101 / gfx1100 | RX 7800/7700/7900 系 | ✅ | AMD公式サポート（未検証） |
| gfx1102 | RX 7600 / 7600M XT | ✅ | **`CT2_CUDA_ALLOCATOR=cub_caching` + `HSA_OVERRIDE_GFX_VERSION=11.0.0` で3分・10分ファイルともに完走確認済み（2026-05-23）**。`transcribe_cli.py` が gfx1102 検出時に自動設定 |
| gfx1103 | Radeon 780M / 旧890M（Phoenix APU） | **❌ 非収録** | v4.7.x ホイールに含まれない。`HSA_OVERRIDE_GFX_VERSION=11.0.0` で gfx1100 に偽装すれば動作する可能性あり（未検証）。`transcribe_cli.py` は gfx1102 と同様に自動設定する予定 |
| gfx1030 | RX 6800 / 6900 系 | ✅ | ROCm コミュニティで動作報告あり（未検証） |

### gfx1102 クラッシュ原因と解決（確認済み 2026-05-23）

ctranslate2-rocm の gfx1102 クラッシュは、**デフォルトのメモリアロケータ（MallocAsync）が AMD GPU と非互換**であることが主因（OpenNMT/CTranslate2 issue #2012 より。gfx1032 で先行確認）。

```bash
export CT2_CUDA_ALLOCATOR=cub_caching   # MallocAsync → CUB キャッシング方式へ切替
export HSA_OVERRIDE_GFX_VERSION=11.0.0  # gfx1102 → gfx1100 カーネルを使用
```

`transcribe_cli.py` がこれらを ctranslate2 インポート前に自動設定する実装を追加済み。3分・10分ファイルで完走確認済み。

---

## Stable Areas / Avoid Touching Without Explicit Request

できるだけ触れないところ:

- 文字起こし実行部分: `python_sidecar/transcribe_cli.py` と、それを呼ぶ Tauri 側の既存フロー
- PyAV 非依存の ffmpeg backend / import stub / `FFMPEG_BIN` 注入経路。Apache-2.0 配布の前提なので、PyAV や imageio-ffmpeg を戻さない
- 話者分離実行部分: `python_sidecar/diarize_cli.py`、community-1 ローカル配置ポリシー、話者表示初期値
- 既定の Gemma 4 E4B / Lemonade 校正経路。特にデフォルトプロンプトと実行条件は、互換API追加・12B階層追加の影響を受けないように保つ（既定は常に E4B）
- 高精度階層（Gemma 4 12B）はオプトインの追加機能（NVIDIA=CUDA 直起動 / AMD=Vulkan 直起動）。E4B 既定の挙動（デフォルトプロンプト・実行条件・lemond/CUDA での E4B 経路）を変えないこと
- 既存のローカルGGUFモデル探索・選択の挙動。ユーザー登録式への完全移行は、別タスクとして検討する
- 保存形式（JSON / DOCX / XLSX）と出力表カラム
- CUDA / ROCm の配布ライン分離方針
- loopback 限定バリデーション。プライバシー境界なので、緩和する場合は必ず明示合意を取る

## Output and Save Formats

- Primary runtime data is JSON
- Save options:
  - JSON file save
  - Word `.docx` save (table layout)
  - Excel `.xlsx` save (table layout)
- Output table columns:
  - 時刻（1列内で start/end を改行表示）
  - 話者
  - 内容

## Distribution Strategy

配布形態は次の3系統を維持します。

1. Full CUDA version（**主配布**）
   - 文字起こし〜話者分離〜校正をすべて含む
   - NVIDIA RTX / CUDA 主軸の安定版
   - **NSIS インストーラー配布**（`scripts/setup-build-tools.bat`）
   - `faster-whisper` / `ctranslate2` CUDA、pyannote CUDA、`llama_cpp` CUDA または Lemonade を想定
   - インストーラーに Python embeddable（`resources/python312/`）と `setup_venv_cli.py` を同梱。初回起動後にセットアップ UI からパッケージをインストールする（インターネット接続が必要）
   - または `PYTHON_BIN` 環境変数でカスタム venv を指定してもよい

1. Full ROCm / AMD version
   - AMD dGPU / iGPU / NPU 検証版
   - ROCm 向け Python venv / runtime / 必要コンポーネント同梱
   - gfx1150（Radeon 890M）では文字起こし・話者分離・LLM 校正ともに GPU 動作確認済み
   - LLM 校正は `llama_cpp` HIPBLAS / Vulkan または Lemonade を想定

1. Editor version
   - LLM部分を含まない軽量構成（校正中心）
   - ビルド済みインストーラーをWeb配布

補足:

- PyTorch は CUDA build と ROCm build を同一 venv に共存させず、配布ラインごとに venv を分ける
- 1つの配布パッケージへ CUDA / ROCm の両 runtime を同梱しない
- NSIS版は venv 非同梱のため、配布先でインストール先フォルダ直下に `.venv312\`（フォルダ全体）を配置するか、`PYTHON_BIN` 環境変数を設定する必要がある
- pyannote-speaker-diarization-community-1 はインストール後ダウンロード。NSIS ビルド（`tauri.build.nvidia-windows.override.json`）には含めない。リリースの保存先は `%LOCALAPPDATA%\{identifier}\models\`（resource_dir ではない）
- llama-server（`resources/llama-server/`）は現状 NSIS インストーラーに同梱（~1GB）。将来的にはセットアップ UI からのポストインストールダウンロードに切り替え予定

Tauri build override 方針:

- `tauri.build.nvidia-windows.override.json` は Full CUDA / Windows NSIS ビルド用（`scripts/setup-build-tools.bat` から使用）
- `tauri.build.nvidia-ubuntu.override.json` は NVIDIA / Ubuntu ビルド用（後日詳細調整予定）
- `tauri.build.amd-windows.override.json` は AMD / Windows NSIS ビルド用（後日詳細調整予定）
- `tauri.build.amd-ubuntu.override.json` は AMD experimental として、product name / identifier / resources を ROCm / AMD 版に固定する
- `tauri.editor.windows.override.json` は軽量 Editor 版 / Windows NSIS ビルド用。`identifier` を `net.gakkousya.lott-editor` に分離し、Lemonade 非搭載のため `installerHooks` を `nsis/editor-hooks.nsh`（Lemonade 促し無し）に差し替える
- `tauri.editor.ubuntu.override.json` は軽量 Editor 版 / Ubuntu deb ビルド用（GPU runtime を持たないため OS 差のみ）
- CUDA 版と ROCm 版・Editor 版は `identifier` を分け、同一 PC に併存できるようにする（CUDA: `net.gakkousya.lott`、AMD: `net.gakkousya.lott-amd`、Editor: `net.gakkousya.lott-editor`）

### NSIS ビルド時の注意点

- **ビルドは `scripts/setup-build-tools.bat` を実行するだけ**。前提確認・Python embeddable 取得・Lemonade 取得・`cargo tauri build` を一括で行う
- **ビルド時にインターネット接続が必要**（Python embeddable zip、Lemonade embeddable zip、get-pip.py の3ファイルを自動ダウンロード）。取得済みの場合はスキップされる
- **`--config tauri.build.nvidia-windows.override.json` を必ず使う**。`tauri.conf.json` の resources には `.venv312` や話者分離モデルが含まれており、NSIS ビルドで使うと venv やモデルをインストーラーに同梱してしまう
- **バージョン番号は `src-tauri/tauri.conf.json` の `version` フィールドで管理**。ビルド出力ファイル名（`*_x64-setup.exe`）に反映されるためリリース前に更新する
- **`LEMONADE_VERSION` / `PYTHON_VERSION` は `scripts/setup-build-tools.bat` 内で管理**。更新時はこのファイルの変数を書き換え、`src-tauri/resources/lemonade/` と `src-tauri/resources/python312/` を削除してから再ビルドする
- **インストーラーは llama-server 同梱で約 1GB 前後**。将来的にはポストインストールダウンロードに切り替え予定
- **NSIS フック `src-tauri/nsis/lemonade-hooks.nsh`** がインストール / アンインストール時の Lemonade プロセス管理を担う。フックを変更した場合は `tauri.build.nvidia-windows.override.json` / `tauri.build.amd-windows.override.json` 側の `nsis` ブロックにも `installerHooks` を明示して基底設定が上書きされないよう注意する
- 詳細は `docs/release-build-windows.md` を参照

## Hardware Policy

- 現行安定 Full は RTX/CUDA 主軸
- ROCm / AMD 版は当面 experimental とし、LLM 校正と pyannote / PyTorch ROCm から検証する
- AMD iGPU / dGPU / NPU の並行処理は、Lemonade や `llama_cpp` HIPBLAS / Vulkan を優先して検証する
- `faster-whisper` / `ctranslate2` の GPU ASR は CUDA 主軸。gfx1150（Radeon 890M）と gfx1102（RX 7600M XT）では GPU 動作確認済み。gfx1102 は `CT2_CUDA_ALLOCATOR=cub_caching` + `HSA_OVERRIDE_GFX_VERSION=11.0.0` を `transcribe_cli.py` が自動設定する。gfx1103 は v4.7.x ホイール非収録のため `HSA_OVERRIDE_GFX_VERSION=11.0.0` 自動設定を追加予定（未検証）
- ハードウェア拡張時も、オフライン要件とデータ保護要件を維持する

## Engineering Priorities

1. Privacy and offline integrity
2. Stable operation and recoverability
3. Clinical workflow usability
4. Performance optimization (GPU/iGPU/NPU parallelism)

## Agent Working Rules

- オフライン制約を崩す提案/実装をしない
- 外部API依存を追加しない
- 既存3機能（文字起こし/話者分離/校正）を毀損しない
- 変更は小さく段階的に実施し、検証可能な単位で提出する
- ユーザー可視仕様の変更時は影響範囲を明示する
- セキュリティ/プライバシーに関わる変更は必ず明記する

## Out of Scope (Unless Explicitly Requested)

- 常時オンライン接続が必要な機能
- クラウド推論前提の音声処理
- 会話/音声データの外部送信を伴う設計

## Frontend Patterns

### mat-icon の正しい使い方

このプロジェクトでは `material-symbols-outlined` フォントを使用している。`mat-icon` を使う際は必ず `class="material-symbols-outlined"` を付けること。付けないとアイコン名がテキストとして表示される（冒頭数文字が見える状態になる）。

```html
<!-- 静的アイコン -->
<mat-icon class="material-symbols-outlined">check_circle</mat-icon>

<!-- 動的アイコン（1行で書く・改行を入れない） -->
<mat-icon class="material-symbols-outlined">{{ condition ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>

<!-- サイズ指定する場合（SCSS側） -->
.my-icon {
  font-size: 18px;
  width: 18px;
  height: 18px;
  line-height: 18px;  /* font-size と揃える */
}
```

- `[fontIcon]` バインディングは使わない（クラスベースのフォント設定と相性が悪い）
- テキスト補間 `{{ }}` 内に改行・インデントを入れない（リガチャが解決されなくなる）

## Important References

- Main UI: `frontend/src/app/app.component.ts`
- Main template: `frontend/src/app/app.component.html`
- Tauri commands: `src-tauri/src/lib.rs`
- ASR CLI: `python_sidecar/transcribe_cli.py`
- Diarization CLI: `python_sidecar/diarize_cli.py`
- LLM proofreading CLI (segment-by-segment): `python_sidecar/proofread_llm_cli.py`
- LLM proofreading CLI (overall): `python_sidecar/overall_proofread_cli.py`
- Post-install package setup: `python_sidecar/setup_venv_cli.py`
- Build guide: `docs/release-build-windows.md`
- Runtime emulation: `docs/dev-runtime-emulation.md`
- Development guide (human-facing): `docs/development.md`
- Troubleshooting (human-facing): `docs/troubleshooting.md`
