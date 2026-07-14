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
- LLM proofreading: Gemma 4 E4B（既定）/ Gemma 4 12B QAT+MTP（高精度・後付けDL。NVIDIA=CUDA直起動 / AMD=ROCm優先・Vulkanフォールバック）。エンジンは同梱/DL の llama.cpp llama-server 直起動 + local OpenAI-compatible API（loopback only。lemond/lemonade CLI は撤去済み）

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

## README Localization Policy

- `README.md` は日本語のメイン画面として扱い、内容の単一の基準にする。
- 英語版は `README.en.md` に置く。英語版は補助的なサブページであり、ルートの既定 README を英語に置き換えない。
- `README.md` のユーザー向け説明、見出し、手順、画像参照、リンク、要件、プライバシー方針を変更した場合は、同じ変更単位で `README.en.md` も意味が一致するように更新する。
- README の画像を追加・変更した場合は、両 README の相対パスが有効で、リポジトリ閲覧画面で表示できることを確認する。

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

話者分離モデルは UI セットアップタブから配置する。

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
- モデル取得は UI セットアップタブで対応
- インストール完了判定は `config.yaml` の有無だけでなく、それが参照する実体ファイル（`segmentation/` `embedding/` `plda/`）の存在・非空サイズと、DL 中断マーカー（`.cache/.../*.incomplete`）の不在まで確認する（`diarization_model_is_complete`）。途中で切れて一部だけ揃った状態は「未完了」と判定し、セットアップで補完ダウンロードを促す。この判定は**設定タブのステータス確認専用**で、アプリ起動初期化からは呼ばない（起動を巻き込まないため）／IO エラーで panic しない（未完了側へ倒す）

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
- LLM校正は Python sidecar からローカルバックエンド（同梱/DL の llama.cpp llama-server / local OpenAI-compatible API）を利用し、外部推論APIは利用しない
- `OpenAI-compatible API` という名称はプロトコル互換を意味するだけで、接続先は `http://localhost:*` / `http://127.*:*` / `http://[::1]:*` のような loopback に限定する
- クラウド OpenAI API、外部ホスト、HTTPS の外部推論エンドポイントへ会話データを送信する設計は採用しない
- 既定の Gemma 4 E4B（同梱/DL llama.cpp llama-server 直起動）経路は、互換APIプロファイルの追加後も従来どおりのデフォルト経路として扱う
- 校正システムプロンプトは設定単位で保存する。既定 Gemma 4 向けのプロンプトに、ローカル互換API用の変更を波及させない

### 校正エンジンのライフサイクル（VRAM解放）

基本方針: **校正用に起動した llama-server はジョブ完了時に解放し、音声入力用は次の音声入力・区間再文字起こしに備えて保持する**。保持中の音声入力用サーバーは、校正・文字起こし・話者分離の開始時とアプリ終了時（強制終了含む）に解放する。実装は **Rust 側に集約**しており、フロントから二重に停止しない。配信は NVIDIA=CUDA / AMD=ROCm・Vulkan のいずれも「llama-server 直起動」で統一され、lemond デーモン・lemonade CLI は使わない（撤去済み）。Rust 側の状態管理構造体は `LlmServer`（旧 `LemonadeServer`）。`lemonade`/`llm` を含む関数・コマンド名は基本 `llm` に統一済みだが、後方互換のため一部の永続識別子（`backend == "lemonade"` タグ、`~/.cache/{app-id}/lemonade/` キャッシュ dir、保存設定の `lemonadeUrl` などのキー）は `lemonade` のまま据え置く。

- **per-job 解放（Rust）**: `proofread_transcription_llm` / `run_overall_proofread` はサイドカー終了後（成功・中止・失敗すべて）に、`backend == "lemonade"`（同梱エンジンを指す後方互換タグ）なら次を行う。
  - 同梱/DL llama-server（`LlmServer.mode == 1`）: `try_stop_cuda_llama_server` が自前起動した llama-server（NVIDIA=CUDA / AMD=ROCm・Vulkan のいずれも）を kill して VRAM を解放。次回校正で `start_llm_server` が再起動・再ロードする。
  - 外部API（lmstudio / ollama）は `try_unload_openai_model` でアンロード。
- **アプリ終了時解放**:
  - グレースフル終了: ウィンドウ `CloseRequested` / `Destroyed` ハンドラ（`lib.rs` setup 内）が `state.child` を `kill_process_tree_by_pid` + `child.kill` し、`try_unload_openai_model` も呼ぶ。CUDA / ROCm / Vulkan いずれの llama-server child も kill 対象。
  - 強制終了・クラッシュ（ハンドラが走らない）: 自前起動した llama-server（CUDA / ROCm / Vulkan）に `assign_to_kill_on_close_job`（Windows Job Object `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）を spawn 時に付与済み（`try_start_llama_server_cuda` / `try_start_llama_server_rocm` / `try_start_llama_server_vulkan`）。アプリプロセスが死ねば OS が job を閉じ、エンジンを確実に終了させる。
- **遅延起動（pre-warm 廃止）**: フロントはアプリ起動時・バックエンド/GPUモード変更時に校正エンジンを**起動しない**（`refreshLlmUiState` は状態確認のみ）。校正用エンジンが起動するのは**実際に校正を実行したとき**（`runLlmProofread` / `runOverallProofread` 内の `startLlm`）だけ。校正後は per-job 解放する。音声入力用エンジンは最初の音声処理時に遅延起動し、その後は別のGPU処理またはアプリ終了まで保持する。

### 内蔵校正AIモデルの階層選択（標準 / 高精度）

設定タブ「校正用AIモデル」セクションの「AI校正バックエンド」セレクタで、内蔵校正モデルの階層を選べる。E4B（標準）と 12B（高精度）は同じ内蔵モデル経路（`backendMode = local_gguf`）の別項目としてこのセレクタに並ぶ（外部APIの LM Studio / Ollama も同じセレクタ）。専用の「校正AIモデル」セレクタは廃止し、バックエンド選択へ統合した。

| 階層 | モデル | 既定 | 対象 | 取得方法 |
| --- | --- | --- | --- | --- |
| 標準 | Gemma 4 E4B QAT（+MTP） | ✅ | CUDA / AMD 共通 | setup スクリプトで同梱取得（従来どおり） |
| 高精度 | Gemma 4 12B QAT + MTP | | **NVIDIA / AMD 共通**（GPU 直起動経路） | large-v3 と同じく**後からダウンロード**（約7GB） |

- **既定は E4B（標準）**。12B は「上位モデル」としてのオプトインで、選択しなければ従来どおり E4B 経路（デフォルトプロンプト・実行条件とも不変）。
- 12B は `unsloth/gemma-4-12B-it-qat-GGUF`（本体 `gemma-4-12B-it-qat-UD-Q4_K_XL.gguf` + ドラフト `mtp-gemma-4-12B-it.gguf`）を `download_gemma_gguf_cli.py --model 12b` で取得する。配置先は E4B と並ぶ `python_sidecar/models/llm/gemma-4-12b-it/`（リリースは `app_local_data_dir()/models/llm/gemma-4-12b-it/`）。NVIDIA・AMD いずれも本体 + MTP ドラフトの両方を取得する。
- **12B はどちらの GPU でも「llama-server 直起動」で動かす**（E4B も同様。lemond は撤去済みのため経由しない）。
  - **NVIDIA**: 同梱 CUDA llama-server（`try_start_llama_server_cuda`、`-ngl 99` + MTP）。
  - **AMD**: **ROCm 優先 → 失敗時 Vulkan フォールバック**（`amd_12b_launch_plan` → `start_amd_12b_blocking`）。どちらも `-ngl` 無し `--fit on`/auto-fit + MTP、ctx は `AMD_12B_CTX_SIZE`(=8192)。
    - **ROCm（高速・優先）**: `download_llama_backend_cli.py --backend rocm` で取得した ROCm ビルド llama-server（`bin/llamacpp/rocm-stable/`、`find_llm_rocm_llama_server` / `try_start_llama_server_rocm`）。`gemma4-assistant`（MTPドラフト arch）対応の **b9585+** が条件で旧 b9247 は弾く。**rocBLAS は LD_LIBRARY_PATH に同梱 therock を載せず、システム ROCm（/opt/rocm。対象 GPU arch の Tensile を含む）から解決**する（DL ビルドに同梱されることのある therock は iGPU 専用 arch のことがあり dGPU で推論時に落ちるため）。warmup は無効化せず起動時 forward で arch 不整合を表面化させ Vulkan へ退避する。実測 RX 7600M XT(gfx1102,8GB)・ctx 8192・**約35〜37 tok/s**（Vulkan比 約25%高速、draft採択 0.7前後）。
    - **Vulkan（フォールバック）**: `download_llama_backend_cli.py --backend vulkan` で取得した Vulkan ビルド（`bin/llamacpp/vulkan/`、`find_llm_vulkan_llama_server` / `try_start_llama_server_vulkan`、b9585+）。ROCm 不可（旧ビルド / 対象 arch の system rocBLAS 無し / 起動失敗）のとき使う。約28〜29 tok/s。
  - どちらも `mode=1`（per-job 停止・kill-on-close の対象）。E4B も AMD では ROCm 直起動（`amd_e4b_rocm_launch` → 失敗時 `amd_e4b_vulkan_launch`）、NVIDIA では同梱 CUDA llama-server。
- 選択の単一の真実は `app_local_data_dir()/proofread-model-tier.txt`（内容 `e4b` / `12b`、既定 `e4b`）。ビルド識別子による E4b 丸めは廃止し、実際に 12B を使えるかは実行時に `resolve_effective_proofread_tier`（本体 GGUF の有無）と `amd_12b_launch_plan`（ROCm/Vulkan バイナリ・arch の有無）で判定する。NSIS の `%LOCALAPPDATA%\{id}` 一括削除対象。
- **フェイルセーフ**: 12B 選択でも本体 GGUF 未取得なら `resolve_effective_proofread_tier` が E4b へフォールバック。AMD は `amd_12b_launch_plan` が **ROCm（`amd_rocm_12b_launch`）→ Vulkan（`amd_vulkan_12b_launch`）** の順に試し、どちらも不可なら E4B 経路（AMD は ROCm→Vulkan 直起動）へフォールバックする。ROCm は build≥9585 ∧ system ROCm に対象 GPU arch の rocBLAS Tensile がある場合のみ採用（`system_rocm_tensile_has_arch`）。起動後も warmup/即死/rocBLAS エラーを検出したら `start_amd_12b_blocking` が Vulkan へ退避する。
- **既知の制約 / フォローアップ**: v1 の ROCm 高速経路は「system ROCm（対象 GPU arch の rocBLAS Tensile を含む）」が前提（DL ビルド同梱の therock は iGPU arch のことがあり dGPU で使えない）。system ROCm が無い AMD 機は Vulkan に安全フォールバック。therock ベースの自己完結 ROCm 化（system ROCm 不要）は別タスク。
- 関連: `get_default_llm_model_path` / `get_default_llm_mtp_model_path`（実効階層を解決）、`check_gemma_12b_installed`、`download_gemma_12b`。AMD 直起動: `amd_12b_launch_plan` / `start_amd_12b_blocking`（ROCm優先・Vulkanフォールバック制御）、`amd_rocm_12b_launch` / `find_llm_rocm_llama_server` / `rocm_build_supports_gemma4_assistant` / `amd_gpu_priority_list` / `system_rocm_tensile_has_arch` / `try_start_llama_server_rocm`（ROCm）、`amd_vulkan_12b_launch` / `find_llm_vulkan_llama_server` / `try_start_llama_server_vulkan`（Vulkan）。AMD E4B 直起動: `amd_e4b_rocm_launch` / `amd_e4b_vulkan_launch`。バックエンドバイナリ取得: `install_llm_backend`（Tauri command）/ `download_llama_backend_cli.py`。

### LLM バックエンドバイナリの保存場所

AMD 用 llama.cpp `llama-server`（ROCm / Vulkan / CPU ビルド）は、本体アプリとは別に**上流リリースから直接ダウンロード**する（`download_llama_backend_cli.py`、`ggml-org/llama.cpp` の Releases。既定 `DEFAULT_BUILD = b9631`）。lemond デーモン・lemonade CLI は撤去済みで、取得にも配信にも使わない。NVIDIA の CUDA llama-server は従来どおりインストーラー同梱（`resources/llama-server/`）。

| パス | 内容 |
| --- | --- |
| `~/.cache/{app-id}/lemonade/bin/llamacpp/rocm-stable/llama-server` | DL した AMD ROCm ビルド（`--backend rocm` → `llama-{b}-bin-ubuntu-rocm-7.2-x64`） |
| `~/.cache/{app-id}/lemonade/bin/llamacpp/vulkan/llama-server` | DL した Vulkan ビルド（`--backend vulkan`） |
| `~/.cache/{app-id}/lemonade/bin/llamacpp/cpu/llama-server` | DL した CPU ビルド（`--backend cpu`） |
| `~/.cache/{app-id}/lemonade/config.json` | アプリが書く実行時設定（現状 `port` のみ） |

`{app-id}` は Tauri の `identifier`（CUDA 版: `net.gakkousya.lott`、AMD 版: `net.gakkousya.lott-amd`）。Windows では `%LOCALAPPDATA%\{app-id}\lemonade\`。

- **キャッシュ dir 名 `lemonade` は後方互換のため据え置き**（DL 済みバイナリを孤立させないため。`get_llm_engine_cache_dir` が `app_cache_dir()/lemonade` を返す）。
- 取得は UI セットアップタブ（`install_llm_backend` Tauri command → `download_llama_backend_cli.py`）。`llamacpp:rocm`→`rocm-stable`、`llamacpp:vulkan`→`vulkan`、`llamacpp:cpu`→`cpu` のサブディレクトリへ展開する。進捗は `llm-backend-install-progress` イベントで通知。`find_llm_rocm_llama_server` / `find_llm_vulkan_llama_server` が起動時に解決する。
- バックエンドバイナリは一度ダウンロードすれば以降はオフラインで動作する。
- AMD GPU では `rocm` を優先取得する（Vulkan より高速なことが多い）。`gemma4-assistant`（MTPドラフト arch）対応の **b9585+** が必須（旧 b9247 は非対応）。ROCm ビルドは system ROCm（/opt/rocm）の rocBLAS を参照する。
- `config.json` は `ensure_llm_server_port_config` が `port` のみ書き込む（lemond 用の `ctx_size` / `no_broadcast` / `prefer_system` などは廃止）。**`LEMONADE_*` 環境変数は使わない。**
- **プライバシー**: 取得元は GitHub Releases のバイナリのみ。LAN ビーコンやクラウド offload の経路は持たず、会話/音声データの外部送信は一切行わない。

### MTP（投機的デコード）の適用範囲

- MTP ドラフト（E4B: `mtp-gemma-4-E4B-it.gguf`、約60MB）は setup スクリプトが Gemma 本体と一緒に**無条件でダウンロード**する（CUDA/AMD 問わず）。「ダウンロードした記憶がないファイル」はこれで、正常。高精度階層の 12B ドラフト（`mtp-gemma-4-12B-it.gguf`、約242MB）は 12B 選択時に本体とまとめて後からダウンロードする（[内蔵校正AIモデルの階層選択](#内蔵校正aiモデルの階層選択標準--高精度)参照）
- MTP を使うのは **GPU 直起動経路**（lemond は撤去済み）。E4B・12B の両階層で `--spec-type draft-mtp` / `--spec-draft-model` / `--spec-draft-n-max 3` を渡す。**FlashAttention は MTP 配線時は `off`、MTP 非併用時のみ `on`**（`flash_attn = if mtp_model_path.is_some() { "off" } else { "on" }`）。MTP ドラフト併用時に `--flash-attn on`（および `auto`）を渡すと、一部 GPU/ビルドで CUDA FlashAttention カーネル（`ggml-cuda/fattn.cu:110`）が致命的に落ち、サーバがポートを開く前にクラッシュする（RTX 4060 Laptop + 同梱 llama.cpp build 9571 で確認）。MTP の投機的デコード自体は維持する
  - **NVIDIA**: 同梱 CUDA llama-server（`try_start_llama_server_cuda` / 制御は `start_cuda_llama_blocking`）。階層で起動方式を分ける（`autofit` 引数 = `resolve_effective_proofread_tier == B12`）。
    - **E4B**: `-ngl 99`（本体全 GPU）+ `--spec-draft-ngl 99`（ドラフトも GPU）。従来どおり・無変更。ctx/np は `choose_llm_parallelism` の自動値。
    - **12B**: **auto-fit 起動**（`--fit on`、`-ngl` も `--spec-draft-ngl` も指定しない）。本体・MTP ドラフトの GPU/CPU 配置を llama.cpp の auto-fit に委ね、VRAM に収まる分だけ GPU、残りは CPU へ自動配置する。AMD 経路と同方式。ctx/np は **AMD 12B と同じ単一スロット・`AMD_12B_CTX_SIZE`(=8192)** に固定する（`ctx16384/np2` だと KV が大きく本体が CPU に逃げて遅くなる。`8192/np1` は約24 tok/s 実測で、本体全 GPU+CPU ドラフトの旧方式 ~22 tok/s より速い）。
      - 背景: **`-ngl` 明示（auto-fit 無効）下で 12B の `gemma4-assistant` ドラフトを GPU レイヤーへオフロードすると、Windows CUDA 公式ビルド（b9571 / b9630 / b9754 すべてで確認）が `invalid vector subscript` → `failed to load draft model` でサーバごとクラッシュする**。クラッシュ条件は「auto-fit 無効 + ドラフト GPU」であり、**auto-fit 有効なら同じドラフトを GPU に載せても正常に動く**（`gpu_layers=-1`・draft 採択 ~0.66 実測）。そのため 12B は auto-fit に統一した（旧バージョンの GPU/CPU プローブ＋`cuda-12b-draft-placement.txt` キャッシュは廃止）。VRAM に余裕がある GPU ではドラフトも本体も GPU に載って高速化し、8GB クラスでは auto-fit が本体の一部を CPU へ逃がして収める。
  - **AMD**: **ROCm 優先（`try_start_llama_server_rocm`）→ 失敗時 Vulkan（`try_start_llama_server_vulkan`）**。どちらも `-ngl` も `--spec-draft-ngl` も指定せず **auto-fit**（8GB クラスで本体+ドラフトを収めるため）。**古いビルド（例 b9247）はドラフト arch `gemma4-assistant` を `unknown model architecture` で拒否する**ため、新ビルド（b9585+、`gemma4-assistant` 対応。10.8.0 の `llamacpp:rocm` は b9630 を配る）を使う。ROCm の rocBLAS は therock 非経由で system ROCm から解決（therock は iGPU arch 専用のことがある）。実測 RX 7600M XT(gfx1102,8GB)・ctx 8192: **ROCm+MTP 約35〜37 tok/s**、Vulkan+MTP 約28〜29 tok/s、VRAM 約8.0/8.5GB。
- **（履歴）lemond 経由の per-model MTP は採用しなかった**。lemond の `load --llamacpp-args` で MTP を渡す方式も検討したが、lemond のモデル管理（リクエスト単位ロード）との整合が不安定だったため「llama-server 直起動」に統一し、最終的に lemond 自体を撤去した。

### 音声入力（編集画面のマイク入力候補生成）

編集画面の各行の編集欄右側（matSuffix）にあるマイクボタンで最大15秒録音し、Gemma 4 E4B + 音声 mmproj で「編集欄へ挿入できる候補（最大3件）」を生成する機能。**全ビルド（Editor / Full CUDA / Full AMD）で利用可能**（2026-07 に Editor 専用から Full 版へ展開）。

- **方式は保持・再利用**: 最初のリクエストで `--mmproj` 付き llama-server を起動し、OpenAI 互換 `/v1/chat/completions` に `input_audio`（base64 WAV, 16kHz mono）を送る。応答後もサーバーを保持し、次のマイク音声入力・区間再文字起こしで再利用する。校正と同じ `LlmServer` 状態（child/port/mode/parallel/purpose）を共有し、`purpose` で用途を識別、`LLM_PROOFREAD_ACTIVE` で校正と相互排他する。校正・通常の文字起こし・話者分離の開始時とアプリ終了時に解放する。
- **モデルは常に E4B + mmproj 固定**（校正AIモデル階層で 12B を選択中でも音声入力は E4B。`resolve_effective_proofread_tier` は参照しない）。MTP は使わない。ctx 8192 / np 1。FlashAttention は既存ロジックどおり MTP 無しのため `on`。
- **起動経路の分岐**（`generate_editor_voice_input_candidates_blocking` が `editor_voice_input_allowed`＝identifier に "editor" を含むかで分岐）:
  - Editor 版: 従来どおり CPU llama.cpp 直起動（`try_start_llama_server_cpu_audio`、`--device none -ngl 0 --no-mmproj-offload`）。無変更。
  - Full 版: **GPU 直起動のみ・CPU フォールバック無し**（`start_full_voice_input_server_blocking`）。NVIDIA=同梱 CUDA llama-server を **auto-fit**（`--fit on`、12B 校正と同方式。小 VRAM 機は本体の一部が CPU へ逃げる）／AMD=**ROCm 優先 → Vulkan フォールバック**（`voice_amd_rocm_launch` / `voice_amd_vulkan_launch`。ROCm は音声プロジェクタ `gemma4a` 対応の **b9585+ ゲート**あり）。mmproj は GPU オフロード（`--no-mmproj-offload` を付けない）。
- **必要アセット**: E4B 本体 GGUF は校正用と同一ファイルを共有（追加DL不要）。新規に必要なのは `mmproj-BF16.gguf`（約992MB、`unsloth/gemma-4-E4B-it-qat-GGUF`、`clip.audio.projector_type=gemma4a`）のみで、設定タブ「音声入力パック」から**後付けDL**（E4B と同じモデルディレクトリへ配置）。Full 版のパック導入判定は本体+mmproj のみ（`cpu_backend_required=false`）。Editor 版は CPU バックエンドに加え、区間聞き直し用 LGPL ffmpeg（約95MB）も同パックで導入する（[区間聞き直し](#区間聞き直し編集画面編集欄左側のai聞き直しボタン)参照）。
- **llama.cpp の音声対応根拠**: Gemma 4 audio conformer 対応は PR #21421（2026-04-12 マージ）+ 修正 #24091/#24118（06-04）で、同梱 CUDA **b9571（06-09）に含まれる**（libmtmd の `gemma4a` 実装を静的確認済み）。AMD 実測（RX 7600M XT gfx1102・ctx 8192）: ROCm b9630 起動7.5s・リクエスト0.6〜1.4s／Vulkan b9632 起動6.7s・1.9〜2.0s、いずれもクラッシュなし。
- プロンプト: `python_sidecar/prompt_templates/voice_input/gemma4_e4b_candidates_system.txt`（全ビルドの resources に同梱済み）。

### 区間聞き直し（編集画面・編集欄左側のAI聞き直しボタン）

編集画面の各行の編集欄左側（matPrefix）のボタン（`graphic_eq`。v0.9.4 のレイアウト整理で行下部から移動）で、その行の時間範囲（`segment.start`〜`segment.end`）を LGPL ffmpeg で 16kHz mono WAV に切り出し、音声入力と同じ E4B + mmproj 経路で「**行の内容を置き換える候補**（最大3件）」を生成する機能（2026-07 追加）。

- **全ビルド（Editor / Full CUDA / Full AMD）対応**。ffmpeg の解決順は `resolve_ffmpeg_bin_for_segment_cut`＝「`FFMPEG_BIN` 環境変数 → 同梱（Full版 `resources/ffmpeg`）→ DL済み（Editor版 `app_local_data_dir()/ffmpeg/`）→ PATH 上の ffmpeg」。可用性は `check_segment_retranscribe_available`（ffmpeg 解決可否）で起動時・パック導入/削除後に判定。
- **Editor 版の ffmpeg は音声入力パックで後付けDL**（`install_editor_voice_ffmpeg_blocking`、進捗コンポーネント `voice_ffmpeg`、約95MB）。取得元は Full 版の `setup_ffmpeg_lgpl.py` と同じ BtbN latest LGPL ビルド（GitHub Releases のみ）。展開時に `ffmpeg -buildconf` を実行して **GPL 禁止トークン（`--enable-gpl` 等、`FFMPEG_FORBIDDEN_CONFIG_TOKENS`）の不在を検証**し、違反時は配置を取り消す。`LICENSE.txt`（LGPLv3）と `FFMPEG_BUILD_INFO.txt` を並置。パック installed 判定に Editor 版のみ ffmpeg を含める（`ffmpeg_required`）。PATH フォールバックにより Ubuntu の Editor ユーザーは `apt install ffmpeg` でも利用可能。
- **マイク音声入力とサーバ起動・排他・保持を共有**: 共通部は `run_editor_voice_audio_llm_blocking`（初回起動→`input_audio`→サーバー保持、次回再利用）。`LLM_PROOFREAD_ACTIVE` で校正・音声入力と相互排他。フロントも `voiceInputProcessingSegmentId` 等の状態を共用。
- **候補は挿入ではなく置換**: `voiceInputCandidates` に `mode: 'insert' | 'replace'` を追加し、`replace` では `setEditableText` で行全体を置換。候補パネル先頭に「内容全体が置き換わります」の注意書きを常時表示。
- **区間の制約**: 0.2 秒未満はエラー、30 秒超（`SEGMENT_RETRANSCRIBE_MAX_SECONDS`）は snackbar「開始30秒のみ読み取ります」を出して先頭 30 秒のみ処理。切り出し対象パスは `set_audio_allowed_path` で許可済みのものだけ受け付ける。
- **プロンプト**: `python_sidecar/prompt_templates/voice_input/gemma4_e4b_retranscribe_system.txt`（新規・`prompt_templates` ディレクトリ同梱で全ビルドに入る）。「入力行」は以前の文字起こし結果で誤りを含む可能性が高い、音声優先、と明示。前後行の文脈もマイク音声入力と同じ形式で送る。
- 関連: Rust `generate_segment_retranscribe_candidates`（Tauri command）/ `generate_segment_retranscribe_candidates_blocking` / `extract_segment_wav_base64`（ffmpeg 切り出し）/ `resolve_ffmpeg_bin_for_segment_cut`。フロント `retranscribeSegment` / `segmentRetranscribeTooltip`。

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
- 既定の Gemma 4 E4B 校正経路（同梱/DL llama-server 直起動）。特にデフォルトプロンプトと実行条件は、互換API追加・12B階層追加の影響を受けないように保つ（既定は常に E4B）
- 高精度階層（Gemma 4 12B）はオプトインの追加機能（NVIDIA=CUDA 直起動 / AMD=ROCm 優先・Vulkan フォールバック）。E4B 既定の挙動（デフォルトプロンプト・実行条件・CUDA / AMD ROCm・Vulkan での E4B 直起動経路）を変えないこと
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
   - `faster-whisper` / `ctranslate2` CUDA、pyannote CUDA、AI校正は同梱 CUDA llama-server 直起動を想定
   - インストーラーに Python embeddable（`resources/python312/`）と `setup_venv_cli.py` を同梱。初回起動後にセットアップ UI からパッケージをインストールする（インターネット接続が必要）
   - または `PYTHON_BIN` 環境変数でカスタム venv を指定してもよい

1. Full ROCm / AMD version
   - AMD dGPU / iGPU / NPU 検証版
   - ROCm 向け Python venv / runtime / 必要コンポーネント同梱
   - gfx1150（Radeon 890M）では文字起こし・話者分離・LLM 校正ともに GPU 動作確認済み
   - LLM 校正は DL した llama.cpp ROCm / Vulkan llama-server 直起動を想定

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
- `tauri.editor.windows.override.json` は軽量 Editor 版 / Windows NSIS ビルド用。`identifier` を `net.gakkousya.lott-editor` に分離し、LLM 校正ランタイム非搭載のため `installerHooks` を `nsis/editor-hooks.nsh` に差し替える（Full 版は `nsis/nvidia-hooks.nsh`）
- `tauri.editor.ubuntu.override.json` は軽量 Editor 版 / Ubuntu deb ビルド用（GPU runtime を持たないため OS 差のみ）
- CUDA 版と ROCm 版・Editor 版は `identifier` を分け、同一 PC に併存できるようにする（CUDA: `net.gakkousya.lott`、AMD: `net.gakkousya.lott-amd`、Editor: `net.gakkousya.lott-editor`）

### NSIS ビルド時の注意点

- **ビルドは `scripts/setup-build-tools.bat` を実行するだけ**。前提確認・Python embeddable 取得・`cargo tauri build` を一括で行う（NVIDIA 版は AI 校正に同梱 CUDA llama-server を使うため Lemonade は同梱しない）
- **ビルド時にインターネット接続が必要**（Python embeddable zip と get-pip.py を自動ダウンロード）。取得済みの場合はスキップされる
- **`--config tauri.build.nvidia-windows.override.json` を必ず使う**。`tauri.conf.json` の resources には `.venv312` や話者分離モデルが含まれており、NSIS ビルドで使うと venv やモデルをインストーラーに同梱してしまう
- **バージョン番号は `src-tauri/tauri.conf.json` の `version` フィールドで管理**。ビルド出力ファイル名（`*_x64-setup.exe`）に反映されるためリリース前に更新する
- **`PYTHON_VERSION` は `scripts/setup-build-tools.bat` 内で管理**。更新時はこのファイルの変数を書き換え、`src-tauri/resources/python312/` を削除してから再ビルドする
- **インストーラーは llama-server 同梱で約 1GB 前後**。将来的にはポストインストールダウンロードに切り替え予定
- **NSIS フックは `src-tauri/nsis/nvidia-hooks.nsh`**（Full 版）/ `editor-hooks.nsh`（Editor 版）。`lemonade-hooks.nsh` は撤去済み。現フックは Lemonade のインストール促しを行わず、外部LLMアプリ（LM Studio / Ollama）連携のオプトイン（`external-llm-policy.txt`）等を担う。フックを変更した場合は `tauri.build.nvidia-windows.override.json` / `tauri.build.amd-windows.override.json` 側の `nsis` ブロックにも `installerHooks` を明示して基底設定が上書きされないよう注意する
- 詳細は `docs/release-build-windows.md` を参照

## Hardware Policy

- 現行安定 Full は RTX/CUDA 主軸
- ROCm / AMD 版は当面 experimental とし、LLM 校正と pyannote / PyTorch ROCm から検証する
- AMD iGPU / dGPU / NPU の並行処理は、DL した llama.cpp ROCm / Vulkan llama-server や `llama_cpp` HIPBLAS / Vulkan を優先して検証する
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
- コミットメッセージに AI ツール名の `Co-authored-by` / `Co-Authored-By` trailer（例: Claude など）を追加しない。GitHub 上で共同編集者表示になるため、必要な場合でも明示合意を取る。

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
