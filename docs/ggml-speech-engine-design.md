# ggml 音声エンジン導入 設計メモ（whisper.cpp + Nemotron-3-Diarization）

- 作成日: 2026-09-25
- ブランチ: `N3-Diarization`
- 状態: **段階2を実装中（Linux / Vulkan、Windows / CUDA・Vulkan で動作確認）**。PoC の手順と実測値は `demo_data/ggml-poc/README.md` を参照
- 開発環境の準備（ビルドとモデル取得。SHA-256 検証あり）:
  - Linux: `bash scripts/setup-ggml-speech-linux.sh --backend vulkan`
  - Windows: `powershell -ExecutionPolicy Bypass -File scripts\setup-ggml-speech-windows.ps1`（既定 `-Backend vulkan`。CUDA 版は `-Backend cuda` で、比較・切り分け用）
- 関連: `AGENTS.md`（Non-Negotiable Constraints / Stable Areas / Audio Decode Policy / 校正エンジンのライフサイクル）

---

## 1. 目的

文字起こし（faster-whisper / CTranslate2）と話者分離（pyannote.audio / PyTorch）を、ggml ベースのネイティブ実行ファイルへ置き換えられるようにする。

| 機能 | 現行 | 導入後 |
|---|---|---|
| 文字起こし | faster-whisper（Python / CTranslate2） | **whisper.cpp**（ggml） |
| 話者分離 | pyannote.audio community-1（Python / PyTorch） | **NeMo-Speech.cpp + Nemotron-3-Diarization**（ggml） |
| 校正・音声入力 | llama.cpp llama-server（ggml） | 変更なし |

狙いは、3機能すべての計算エンジンを **ggml** に揃えることにある。「llama.cpp に一本化」ではない。実行ファイルは3つ（`whisper-cli` / `nemo-speech` / `llama-server`）のまま残るが、GPU 方式（CUDA / Vulkan / CPU）・モデル形式（GGUF 系）・ビルド手順は揃う。

期待する効果:

- **Python / PyTorch / CTranslate2 を不要にする**。配布ラインごとの venv 分離（CUDA / ROCm / CPU）、初回起動後の pip セットアップ、Python embeddable の同梱をやめられる
- **長期目標である Vulkan への統一に近づく**。AMD・Intel・NVIDIA を同じ系統のバイナリで扱える
- **速度とメモリの改善**。PoC（R9700）では faster-whisper より約1.7倍速く、メモリは約1/5だった

## 2. PoC の要約（2026-09-25、AMD Radeon AI PRO R9700 / Radeon 890M、CachyOS）

詳細な数値は `demo_data/ggml-poc/README.md` を参照。比較の基準にした既存 LoTT 出力は正解データではない。faster-whisper を再実行しただけでも、既存出力とは約11%の差が出る。

| 項目 | 結果 |
|---|---|
| whisper.cpp（Vulkan、VAD、beam 3、`-mc 0`） | 50分音声 43.6秒・0.9GB。faster-whisper（ROCm）は74.9秒・4.6GB。既存出力との差は5.1%（faster-whisper再実行は10.8%） |
| Nemotron-3-Diarization（Vulkan） | 10分音声 7.3秒、50分音声 59.4秒。既存（pyannote）との話者一致率は10分 94%、50分 84% |
| 日本語 | Nemotron の対応言語一覧に日本語は無いが、実用的に動作した |
| 反復ハルシネーション | faster-whisper（ROCm）の50分出力で「お金」×15 のループが起き、約12秒分の発話が消えた。whisper.cpp では発生しなかった |
| Nemotron 3.5 ASR | 日本語の精度・速度ともに whisper.cpp に劣るため不採用 |
| NeMo の ASR+話者分離統合モード | 日本語では単語が発話単位の塊になり、話者付けに使えないため不採用 |

**未検証**: 実際のカウンセリング音声、正解ラベルに対する話者分離の誤り率（DER）、アプリ画面からの Windows 実行。Windows / NVIDIA は CUDA 版を 2.1、Vulkan 版を 2.2 で検証した。

### 2.1 Windows / NVIDIA（CUDA）での検証（2026-09-25、RTX 4060 Laptop 8GB / Ryzen 7 8845HS、Windows 11）

主配布の環境で、CUDA 版をソースからビルドして検証した（段階1の一部）。音声は `demo_data/10minutes`（約11.7分）と `demo_data/50minutes`（約58分）。比較対象の標準経路は、アプリと同じ引数・環境変数で `transcribe_cli.py` / `diarize_cli.py` を直接起動した（両音声とも 15MB 以上のため長尺安定モード: float16・beam 1）。ggml 経路はアプリと同じ引数（フィラーを残す・beam 3）。時間はモデル読み込みを含む。

| | 10分 標準 | 10分 ggml | 50分 標準 | 50分 ggml |
|---|---|---|---|---|
| 文字起こし | 19.6秒（初回 74.4秒） | **18.6秒** | 72.6秒 | **68.5秒** |
| 話者分離 | 30.9秒（初回 42.9秒） | **10.1秒** | 121.4秒 | **70.3秒** |
| 合計（順に実行） | 50.5秒 | **28.7秒** | 194.0秒 | **138.8秒** |
| 最大 RSS（文字起こし / 話者分離） | 2.0GB / 1.6GB | 0.6GB / 1.0GB | 3.6GB / 2.0GB | 1.3GB / 1.4GB |
| 最大 VRAM（文字起こし / 話者分離） | 1.9GB / 2.1GB | 2.0GB / 0.6GB | 1.9GB / 2.1GB | 2.0GB / 0.6GB |

- **NVIDIA では文字起こしの速度差は小さい**（CUDA の faster-whisper は十分速い。R9700 / ROCm で見た約1.7倍の差は出ない）。ggml は beam 3、標準は beam 1 で、探索量の多い ggml がやや速い。差が大きいのは話者分離（10分で約3倍）と、Python / PyTorch の初回読み込み（標準経路の初回は文字起こし 74秒・話者分離 43秒）
- Nemotron は音声長に比例しない（10分 10秒 → 50分 70秒）。Linux / R9700 と同じ傾向（12章）
- 文字起こしと話者分離を**同時に**動かすと、50分で 105.9秒（順に実行すると 138.8秒）。VRAM は合計 2.6GB で 8GB 機にも収まり、結果は順に実行した場合と同一
- 3回の繰り返しで whisper.cpp・Nemotron とも出力はビット単位で同一。20秒以上の欠落、反復ハルシネーションは無し
- 実行中に強制終了すると、両エンジンとも VRAM は即座に 0 に戻り、プロセスも残らない（Job Object を使わない `taskkill /T /F` で確認）
- nemo-speech の `--device auto` は CUDA 版では NVIDIA GPU を選ぶ（CUDA 版からは iGPU が見えない）。CPU 実行（`--device cpu`）も動作する（60秒音声で 17.7秒）

品質（既存 LoTT 出力との比較。既存出力は標準経路で作ったものなので、話者一致率は標準経路に有利に出る）:

| 条件 | 行数 | 文字差 | 話者一致率 | 行の長さ中央値 |
|---|---|---|---|---|
| 10分 標準（再実行） | 271 | 10.8% | 95.3% | 2.2秒 |
| 10分 ggml・フィラーを残す（既定） | 187 | 15.9% | 89.9% | 2.8秒 |
| 10分 ggml・フィラーを残さない | 254 | 9.7% | 93.4% | 2.4秒 |
| 50分 標準（再実行） | 1247 | 10.4% | 95.7% | 2.4秒 |
| 50分 ggml・フィラーを残す（既定） | 1007 | 16.6% | 85.5% | 2.2秒 |

- ggml の話者一致率は Linux / Vulkan（10分 89.8%、50分 85.1%）とほぼ同じ。GPU 方式による差は見られない
- フィラーを残すと既存出力に無い語が増えるため、文字差は大きく出る（5.2 の公開書き起こしでの評価では、この条件の文字誤り率が最も低い）

### 2.2 Windows / NVIDIA（Vulkan）での検証（2026-09-25、同じ PC、LunarG Vulkan SDK 1.4.357.0）

同じ固定 commit を Vulkan でビルドし（`-Backend vulkan`）、2.1 と同じ条件で計測した。時間は2回目以降（1回目はシェーダーのコンパイルが入り、whisper.cpp 26.6秒、Nemotron 22.5秒。ドライバーのキャッシュに残るため以降は速い）。

| | 10分 CUDA | 10分 Vulkan（RTX 4060） | 10分 Vulkan（Radeon 780M iGPU） | 50分 CUDA | 50分 Vulkan（RTX 4060） |
|---|---|---|---|---|---|
| 文字起こし | 18.6秒 | 20.0秒 | 87.9秒 | 68.5秒 | 71.4秒 |
| 話者分離 | 10.1秒 | 9.4秒 | 28.1秒 | 70.3秒 | 67.1秒 |
| 同時実行（50分） | - | - | - | 105.9秒 / VRAM 2.6GB | 98.1秒 / VRAM 2.1GB |
| 最大 VRAM（文字起こし / 話者分離） | 2.0GB / 0.6GB | 1.9GB / 0.2GB | - | 2.0GB / 0.6GB | 1.9GB / 0.2GB |
| 配置サイズ（2エンジン合計） | 約1.6GB（cuBLAS 込み） | **約0.1GB** | 同左 | | |

| 品質（既存 LoTT 出力比、フィラーを残す） | 行数 | 文字差 | 話者一致率 | フィラー・相づち |
|---|---|---|---|---|
| 10分 CUDA | 187 | 15.9% | 89.9% | 65 |
| 10分 Vulkan（RTX 4060） | 200 | 17.2% | 87.9% | 78 |
| 10分 Vulkan（iGPU） | 201 | 16.2% | 89.5% | - |
| 50分 CUDA | 1007 | 16.6% | 85.5% | - |
| 50分 Vulkan（RTX 4060） | 1021 | 17.1% | 84.4% | - |

- **RTX 4060 では Vulkan 版が CUDA 版とほぼ同じ速度**（12章の「NVIDIA では Vulkan が CUDA より遅いことが多い」は、この2エンジンには当てはまらなかった）。一方で配置サイズは約1/16、話者分離の VRAM は約1/3
- 出力は CUDA 版と完全には一致しない（数値計算の差で探索結果が変わる）。Vulkan 版の中では3回とも同一。品質指標は同程度で、正解データが無いためどちらが良いかは判断できない
- 20秒以上の欠落・反復ハルシネーションは無し。強制終了で VRAM は即座に解放される
- **Vulkan のデバイス番号は iGPU が 0、RTX 4060 が 1**。whisper-cli（既定 = 0）も nemo-speech（`--device auto`）も **iGPU を選ぶ**。現在のアプリは Vulkan のデバイスを指定しないため、Vulkan 版をこの構成で使うと iGPU で動き、文字起こしは約4.4倍遅くなる。Vulkan 版を採用するなら、llama-server の Linux 版（`preferred_vulkan_device_index`）と同様に dGPU を選ぶ処理が必要（whisper-cli は `GGML_VK_VISIBLE_DEVICES`、nemo-speech は `--device vulkan:N`）

### 2.3 校正（llama.cpp llama-server）の CUDA 版と Vulkan 版（2026-09-25、同じ PC）

NVIDIA 向けも Vulkan に揃えられるかを見るため、同梱の CUDA 版 b10075 と公式 Vulkan 版 b10075（`llama-b10075-bin-win-vulkan-x64.zip`、RTX 4060 を `GGML_VK_VISIBLE_DEVICES=1` で指定）を、アプリと同じ起動引数で比べた。依頼は校正用システムプロンプト（`gemma4_system.txt`）＋10分音声の書き起こし80行（入力926トークン）。プロンプトキャッシュは無効、各2回。

| | CUDA | Vulkan |
|---|---|---|
| E4B + MTP（`-ngl 99`、FA on）: 1回の所要 / 生成速度 | 10.0秒 / 193 tok/s | 12.1秒 / 161 tok/s |
| 12B + MTP（`--fit on`、ctx 8192、FA on） | 57〜60秒 / 35〜37 tok/s | 63.3秒 / 33.2 tok/s |
| 音声入力（E4B + mmproj、15秒音声） | 4.0秒 | 4.1秒 |
| VRAM（E4B / 12B / 音声） | 3.0 / 6.5 / 4.1GB | 2.9 / 6.4 / 4.0GB |

- Vulkan は E4B で約2割、12B で約1割遅い。音声入力は同じ。MTP の採択数はほぼ同じ
- b10075 の Vulkan 版では、MTP 併用時の FlashAttention on も問題なく動いた（off にすると E4B の生成は 161 → 147 tok/s に落ちる）
- 1回目だけシェーダーのコンパイルで遅い（E4B で入力処理 25 tok/s）。ドライバーのキャッシュに残るため2回目以降は速い

Windows 固有の問題（いずれも対処済み。7.1・8章）:

- **フィラー用プロンプトが化けていた**。Windows の whisper-cli は argv をシステムのコードページ（cp932）で受け取り、プロンプトは UTF-8 としてトークン化するため、55トークンの例文が152トークンの文字化けになる。10分音声でフィラー・相づちの数は、化けた状態で 19（プロンプト無しは 15）、正しく渡すと 65。**修正前は Windows で「フィラー・相づちを残す」が実質的に効いていなかった**
- **ユーザー名などに日本語を含むパスで失敗する**。リリース版はモデルも一時ファイルも `%LOCALAPPDATA%\<identifier>\` 配下にあるため、日本語のユーザー名では両エンジンとも起動できなかった
- **日本語版 Windows で NeMo-Speech.cpp がビルドできない**（MSVC が BOM 無し UTF-8 のソースを cp932 として読む）
- **PATH に引用符付きのエントリがあると MSVC 環境の取り込みが失敗する**（この PC の CUDA のエントリ `...\CUDA\v12.9\bin" `。NeMo 公式の `build.ps1` は PATH をレジストリから読み直すため回避できない）

## 3. 採用・不採用の判断

- **採用**: whisper.cpp（文字起こし）。Whisper turbo をそのまま使えるため、モデルの性質は現行と変わらない
- **採用**: NeMo-Speech.cpp の `diarize` サブコマンドのみ（話者分離）
- **不採用**: Nemotron 3.5 ASR / Parakeet 系（日本語品質が不足）
- **不採用**: NeMo の `transcribe --diarize` 統合モード（日本語の単語区切りの問題）
- **保留**: Gemma 4 E4B の音声入力による文字起こし（タイムスタンプが無く、長尺に不向き）

## 4. 全体構成

```text
[音声ファイル]
   │ 同梱 LGPL ffmpeg（現行の FFMPEG_BIN と同じ）
   ▼
16kHz mono PCM WAV（app_cache_dir()/private-temp/、0700、自動削除）
   ├─▶ whisper-cli  ── JSON ─▶ Rust: 現行の文字起こし結果形式へ変換
   └─▶ nemo-speech diarize ── JSON ─▶ Rust: 後処理 → 現行の話者分離区間形式へ変換
                                          ▼
                     assign_speakers_to_segments（既存・変更なし）
```

- **サーバーではなく単発の CLI として起動する**。処理が終われば終了し、VRAM を解放する。常駐型 llama-server の保持・解放の仕組みは不要
- 変換後の結果形式は現行と同じにする。フロントエンド・保存形式（JSON / DOCX / XLSX）・校正経路には手を入れない
  - 文字起こし: `{ id, start, end, text, speaker: null }` の配列（`transcribe_cli.py` の出力と同じ）
  - 話者分離: `{ start, end, speaker: "SPEAKER_00" }` の配列（`diarize_cli.py` の出力と同じ）
- 話者の割り当ては、既存の `assign_speakers_to_segments`（重なりが最大の話者を採用）をそのまま使う。PoC の統合方式と同じ
- WAV の変換は1回だけ行い、2つのエンジンで共有する

## 5. 文字起こし（whisper.cpp）

### 5.1 設定の対応

| 現行（faster-whisper） | whisper.cpp | 備考 |
|---|---|---|
| `language=ja` | `-l ja` | |
| `vad_filter=true`、threshold 0.5 / min_speech 200ms / min_silence 800ms / speech_pad 400ms（既定） | `--vad -vm ggml-silero-v6.2.0.bin -vt 0.5 -vspd 200 -vsd 800 -vp 400` | whisper.cpp の既定値は faster-whisper と異なる（speech_pad 30ms など）。**必ず明示する** |
| `beam_size=3, best_of=3`（低メモリモードでは1/1） | `-bs 3 -bo 3`（**低メモリモードでも 3/3 のまま**） | whisper-cli の既定値は 5/5。5.4 参照 |
| `condition_on_previous_text=False` | `-mc 0` | whisper.cpp は既定で直前のテキストを引き継ぐ。雪崩型ハルシネーション防止の方針に合わせて無効化する |
| `initial_prompt`（用語辞書・利用者の追加指示） | **渡さない**。「フィラー・相づちを残す」がオン（既定）のときだけ、固定の中立例文を `--prompt` `--carry-initial-prompt` `-mc 56` で毎回の窓に付ける | 5.2 参照 |
| `log_prob_threshold=-1.0` | `-lpt -1.0` | 既定値と同じだが明示する |
| `word_timestamps=false` | 指定しない（`-ojf` は不要） | |
| `compute_type=auto` | 該当なし | モデルファイルの量子化で決まる |
| 出力 | `-oj -of <一時パス>` | JSON をファイルに出力し、Rust で読む |

### 5.2 初期プロンプトの扱い

PoC で次のことが分かった。

- 現行アプリの初期プロンプトは約380トークンある。faster-whisper も whisper.cpp も**末尾の約223トークンしか使わない**ため、先頭の話し言葉の例文と用語リストの前半は、現行でも使われていない
- faster-whisper は `condition_on_previous_text=False` のため、プロンプトが効くのは**最初の30秒の窓だけ**
- whisper.cpp では、プロンプトなし・引き継ぎなし（`-mc 0`）の条件が既存出力に最も近かった

その後、公開書き起こし（フィラーを含む）を正解として条件を比べた（`demo_data/ggml-poc/README.md`「初期プロンプトとフィラーの検証」）。

| 条件（10分音声） | 文字誤り率 | フィラー再現 |
|---|---|---|
| faster-whisper・現行プロンプト / 例文の有無 / 頻出語の有無 | 20.1〜20.3% | 22%（どれも同じ） |
| whisper.cpp・プロンプトなし | 18.6% | 19% |
| **whisper.cpp・中立なフィラー例文を毎回の窓に付ける** | **16.5%** | **68%** |
| whisper.cpp・フィラー例文＋頻出語を毎回の窓に付ける | 18.0% | 70%（「辛いもの」→「自傷」の誤認識あり） |

これを受けて次のように決めた（2026-09-25）。

- **ggml 経路**: 設定「フィラー・相づちを残す」（既定オン）を追加。オンのときは臨床内容・固有名詞を含まない固定の例文（`ggml_speech::FILLER_PROMPT`、55トークン）を毎回の窓に付ける。`-mc` を例文のトークン数 + 1 にして、直前テキストは引き継がない
- **用語辞書（頻出語）は ggml 経路に渡さない**。毎回の窓に付けると、話されていない臨床用語が出力される
- **標準経路**: 用語辞書 `glossary.json` から、臨床内容（「眠れてない」「薬も合わない」等）を含む例文を削除した。faster-whisper では最初の30秒窓にしか効かず、削除前後で認識結果は同一だった
  - 残る標準プロンプト（「以下は日本語の会話です。」＋頻出語70語）も314トークンあり、先頭側は切り捨てられている。扱いは未決

### 5.2.1 話者交代位置でのセグメント分割

例文を付けると Whisper はセグメントを長くまとめる（中央値 2.2秒→9秒）。1行に2人の発話が混ざり、行単位の話者割り当てが崩れる（10分音声で一致率 92.6%→68.8%）。

- whisper.cpp のトークン時刻（`-ojf`）をセグメントに `words: [{word, start, end}]` として持たせる
- 話者の割り当て（`assign_speakers_to_segments`）で、`words` を持つ結果は**1文1行**に分け、文ごとに話者を決める（`ggml_speech::split_segments_by_speaker`）。文の区切りは文末記号（。？！）の直後と、空白で始まるトークンの直前。`words` の無い結果（標準経路）は従来どおり
- これで一致率は 89.8%（10分）に戻り、行の長さも中央値 2.4 秒と標準エンジン（2.3 秒）並みになる（プロンプトなし・分割なしは 92.6%）
- 当初は単語ごとに話者を決めて話者交代位置で切っていたが、トークン時刻の誤差（数百ミリ秒）で「言い／訳に」のような単語の途中や句点だけの行ができ、画面で見ると文字起こしが壊れたように見えた（2026-09-25 に利用者が確認）。行の中央時刻での一致率という評価指標ではこの読みにくさを捉えられなかった。そのため文の途中では切らない方式にした
- **whisper.cpp は VAD 使用時、トークン時刻を無音を詰めた時間軸のまま出力する**（セグメント時刻だけ元に戻す。10分音声の末尾で約12秒ずれる）。セグメント内でトークン時刻を [start, end] へ線形に写像し直している
- 1秒未満の行（大半は「うん。」「そう。」などの相づち）は、間隔 1 秒以内の同じ話者の前の行（無ければ次の行）へつなぐ（`merge_short_rows`）。つなげない行（相手の発話中の相づちなど）は**消さずに残す**。削除すると残したいフィラー・相づちの大半と一部の発話（50分音声で58行）が消えるため。50分音声で短い行は 272→86 行、話者一致率は 83.4%→85.1%
- 行を1つだけ繰り返し再生するときは、1.5 秒未満の行の前後を均等に足して流す（フロント `expandShortPlaybackRange`。行の時刻は変えない。「ここから再生」は次の行へ続くので広げない）
- トークンをつないだ文字列がセグメントのテキストと一致しない場合（漢字がバイト断片のトークンに分かれた場合など）は、そのセグメントは分割しない
- DTW（`--dtw`）は FlashAttention 無効化が必要で遅く、分割精度も改善しなかったため使わない

### 5.3 モデル

| ファイル | サイズ | 取得元 |
|---|---|---|
| `ggml-large-v3-turbo.bin` | 約1.6GB | `ggerganov/whisper.cpp`（Hugging Face） |
| `ggml-silero-v6.2.0.bin` | 約0.9MB | `ggml-org/whisper-vad`（Hugging Face） |

量子化版（q5_0 / q8_0）は容量と精度のトレードオフを別途評価する。large-v3 を選べる現行 UI との対応も、同じく別途決める。

### 5.4 探索幅を 1 に下げない理由（実機で確認した欠落）

faster-whisper の長尺安定モード（音声ファイル 15MB 以上で自動有効）は、CTranslate2 の VRAM 対策として探索幅を 1/1 に下げる。whisper.cpp に同じ値を渡したところ、10分音声の冒頭 1.94〜30.63 秒がまるごと欠落した（2026-09-25、アプリ上で再現）。

- 原因: 貪欲探索（beam 1）で、最初の窓が「日本語雑談`[_TT_97]`」のように**単独のタイムスタンプで終わった**。Whisper の仕様では、この場合は窓の残りを無音とみなして 30 秒の窓を丸ごと進める
- VAD を切っても同じく起きるため、VAD は原因ではない
- beam 3 では同じ位置で次の発話を続けて出力し、欠落しない。手元の 5 本（3〜58分）で 20 秒以上の空白は発生しなかった
- whisper.cpp は 50 分音声を beam 3 で処理しても約 0.9GB で、VRAM 対策は不要

そのため ggml 経路では、長尺安定モードでも探索幅を 3 に固定する（`ggml_speech::WHISPER_BEAM_SIZE`）。

### 5.5 進捗表示

`-pp`（print-progress）の標準エラー出力を解析し、既存の進捗イベントへ変換する。VAD 有効時の進捗の意味（VAD 後の音声長が基準になる）は実装時に確認する。

## 6. 話者分離（NeMo-Speech.cpp + Nemotron-3-Diarization）

### 6.1 起動

```text
nemo-speech diarize <wav> --model <ローカルGGUFの絶対パス> --device <vulkan:N|cuda:N|cpu> --format json -o <一時パス>
```

- **`--model` には必ずローカルのファイルパスを渡す**。リポジトリ ID や短縮名を渡すと、NeMo-Speech.cpp は `curl` で自動ダウンロードを試みる。通常運用時にネットワークへ出ない制約に反するため、実装とテストで防ぐ（7章）
- 既定のストリーミングモードを使う。`--offline` は約6.6分が上限のため使わない
- 出力はチャンネル番号（1始まり、登場順）。重なり区間を含む

### 6.2 話者数の指定（現行 UI との差分）

現行の `run_diarization_blocking` は `speaker_count`（1〜5、既定2）を pyannote に `num_speakers` として渡している。**Nemotron には話者数を指定する手段が無い**（出力は常に8チャンネル。`max_speaker_count` は API 上「受け付けるが無視する」と明記されている）。

そのため Rust 側の後処理で話者数を揃える。

1. 話者ごとの合計発話時間を求め、上位 N 人（N = `speaker_count`）を残す
2. 残らなかった話者の区間は捨てる。多くは相づちや重なり発話で、文字起こしの行への割り当ては、重なりが最大の話者を採る既存処理が補う
3. 残った話者を**最初の発話順**に `SPEAKER_00`, `SPEAKER_01`, … へ振り直す。既存の表示名の既定値（`SPEAKER_00 → Th` など）と組み合わせるため
4. 現行の `filter_short_segments` と同等の処理（0.3秒未満の除去、同一話者の0.5秒以内の結合）を適用する

PoC のデータで後処理の組み合わせを比べた（既存 LoTT 出力との話者一致率）。

| 後処理 | 10分 | 50分 |
|---|---|---|
| 重なりを残す（処理なし） | 94.8% | 84.7% |
| 上位2人 | 95.2% | 84.7% |
| 上位2人 + 短区間除去・結合 | **95.2%** | **84.7%** |
| 上位2人 + 重なり除去 | 91.1% | 82.4% |
| 上位2人 + 重なり除去 + 短区間除去・結合 | 91.1% | 82.6% |

重なりを除くと一致率が下がるため、区間は重なりを残したまま返す（6.3）。

`speaker_count` を「上限」として扱い、実際に検出された人数が少なければそのまま返す案もある。UI の文言と合わせて決める。

将来の改善として、C API（`nemo_speech_diar_*`）で 10ms ごとの話者確率を取得し、捨てた話者のフレームを上位 N 人のうち最も確率の高い話者へ振り直す方式がある。CLI の区間出力では確率が取れないため、第2段階とする。

### 6.3 重なり発話

pyannote 経路は exclusive 出力（重なりの無い区間）を使っている。Nemotron は重なりを含む区間を返す（PoC では10分中91秒）。文字起こしの行への割り当ては重なり最大で決まるため、**区間は重なりを残したまま返す**（重なりを除くと一致率が下がる。6.2 の表）。`summary.speakers[].duration` だけは、重なり分を二重に数えないよう、重なり区間を後から話し始めた話者へ帰属させて集計する。

### 6.4 モデル

| ファイル | サイズ | ライセンス |
|---|---|---|
| `Nemotron-3-Diarization.q8_0.gguf` | 約107MB | OpenMDW-1.1 |

pyannote community-1 と同様に、UI のセットアップタブからダウンロードする。保存先は `app_local_data_dir()/models/nemotron-3-diarization/` とする。

## 7. プライバシー・オフライン

- 通常運用時の通信は無い。ダウンロードはセットアップ時のみで、取得元は Hugging Face と GitHub Releases
- ダウンロードしたファイルは、固定した revision・サイズ・SHA-256 で検証する
- **NeMo-Speech.cpp の自動ダウンロードを確実に止める**
  - `model_pull` はビルドオプションで無効化できない（`app/doctor.cpp` で常に true）。そのため引数の渡し方で防ぐ
  - 常にローカルの絶対パスを渡す（6.1）。PoC で確認したところ、パスの形をした引数はファイルが無くてもダウンロードせず、`diarization model file does not exist` を出して終了コード 3 で止まる
  - 念のため、起動前に Rust 側でもモデルファイルの存在を確認し、無ければ明示エラーにする
  - オフライン検証（`docs/offline-verification.md`）の対象に追加する
- 一時 WAV・JSON は `private-temp`（0700、`PRIVATE_TEMP_MAX_AGE` で自動削除）に置く
- 同梱バイナリなので `apply_host_command_env` は適用しない（AGENTS.md の方針どおり）

### 6.5 GPU の選択（Vulkan 版）

Vulkan 版の ggml は既定で Vulkan の 0 番の GPU を使い、iGPU を併載した機種では 0 番が iGPU のことがある（2.2）。そのため Rust 側で GPU を決めて渡す（`src-tauri/src/gpu_select.rs`）。

- **番号**: `vkEnumeratePhysicalDevices` の並び。ggml-vulkan の `GGML_VK_VISIBLE_DEVICES` はこの並びを指すので、版の異なる ggml を持つ whisper-cli / nemo-speech（将来は llama-server も）に同じ番号を渡せる
- **渡し方**: `GGML_VK_VISIBLE_DEVICES=<番号>` で1台だけ見せる。nemo-speech には `--device vulkan:0` を併せて渡す（`auto` は iGPU を選ぶことがある）。環境変数が既に設定されていればそれを尊重する
- **自動選択**: 単体 GPU があればその中で VRAM 最大、無ければ iGPU、それも無ければ仮想 GPU。VRAM が同じなら番号の小さい方。CPU 実装（llvmpipe 等）は選ばない。iGPU の device-local ヒープは共有メモリの大きさ（780M で約10〜16GB）で VRAM として比べられないため、種別を先に見る
- **設定**: 設定タブの「音声エンジンの GPU」（Vulkan 版の ggml エンジンを選んでいるときだけ表示）。「自動（<選ばれる GPU 名>）」と各 GPU を選べる。保存は GPU の UUID で行い、GPU の抜き差しで番号が変わっても追従する。保存した GPU が見つからなければ自動に戻る
- **列挙**: Vulkan の初期化は全 GPU ドライバーを読み込むため、アプリ本体ではなく、アプリ自身を `--lott-list-vulkan-devices` 付きの子プロセスで起動して列挙する（15秒でタイムアウト。失敗時は空の一覧 = ggml の既定に任せる）。結果はアプリ起動中キャッシュする。この PC で約0.4秒
- **ビルド種別の判定**: エンジンの `BUILD_INFO.txt`（セットアップスクリプトが書く `backend vulkan` / `preset vulkan-diar`）。CUDA 版では何もしない（従来どおり）
- 進捗表示と結果の `settings.gpu` / `gpu` に、使った GPU の名前を残す
- 校正の llama-server は未対応（従来の `preferred_vulkan_device_index`（Linux のみ、名前に nvidia を含む GPU を優先）のまま）。Vulkan へ揃える場合に同じ選択処理へ寄せる

### 7.1 Windows のパスと文字コード

Windows の whisper-cli / nemo-speech は argv をシステムのコードページ（日本語環境では cp932）で受け取る。一方、ファイルの開き方は箇所ごとに異なる。

| 対象 | 開き方 | ASCII 以外を含むパス |
|---|---|---|
| whisper-cli のモデル・VAD モデル | UTF-8 として解釈 → ワイド文字 | argv では失敗 |
| whisper-cli のモデルの存在確認（引数解析時） | ANSI（cp932） | UTF-8 では失敗（パッチで UTF-8 に揃えた） |
| whisper-cli の入力音声（miniaudio）・出力 JSON | ANSI | UTF-8 では失敗 |
| whisper-cli のプロンプト | UTF-8 としてトークン化 | argv では化ける |
| nemo-speech のモデル（`ggml_fopen`） | UTF-8 として解釈 | argv では失敗（パッチで UTF-8 のまま渡すようにした） |
| nemo-speech の入力音声・出力 JSON | ANSI | cp932 で表せる文字なら可 |

対処（`execute_ggml_transcription` / `execute_ggml_diarization`）:

- whisper-cli へは、引数を UTF-8 の**応答ファイル**（`whisper-cli @<file>`、1行1引数、BOM 無し）で渡す（`ggml_speech::whisper_response_file`）。プロンプトとモデルパスが UTF-8 のまま届く
- 音声と出力先は、**作業ディレクトリを一時ディレクトリにして生成名（ASCII）だけ**で渡す。応答ファイル自体も同じ
- ソースに当てる LoTT 独自パッチ（`scripts/patches/`、セットアップスクリプトが冪等に適用）:
  - `whisper-cpp-cli-utf8-model-path.patch`: モデルの存在確認を UTF-8 で行う
  - `nemo-speech-diarize-utf8-model-path.patch`: モデルパスを `u8string()` で渡す（Linux では値が変わらない）
- 日本語のフォルダ名にモデル・音声を置いて、両エンジンとも ASCII のパスと同一の結果になることを確認した
- 応答ファイルにはモデルの絶対パスと固定の例文だけが入り、音声のファイル名は入らない。一時ディレクトリに置き、処理後に削除する（異常終了時は `PRIVATE_TEMP_MAX_AGE` で回収）
- nemo-speech はモデルの読み込みに失敗しても、パスの形をした引数ではダウンロードを試みない（日本語パスで失敗させた際にも確認）

## 8. 配布とビルド

どちらのプロジェクトも、Vulkan 版の公式バイナリを配布していない（whisper.cpp の公式リリースは CPU / BLAS / cuBLAS のみ）。Linux CUDA 版 llama-server と同様に、**commit を固定してソースからビルドする**。

| 配布ライン | whisper.cpp | NeMo-Speech.cpp | 備考 |
|---|---|---|---|
| NVIDIA Windows（主配布） | CUDA 版（公式 cuBLAS 版の利用可否を確認）または Vulkan 版 | `cuda-diar` または `vulkan-diar` | **CUDA と Vulkan の速度差を測ってから決める**。当面は CUDA が本命 |
| NVIDIA Linux | CUDA 版（固定 commit のソースビルド） | `cuda-diar` | `scripts/build-llama-server-cuda-linux.sh` と同じ方式 |
| AMD（Windows / Linux） | Vulkan 版 | `vulkan-diar` | ROCm 版の whisper.cpp は必要性が出たら検討 |
| CPU / Editor | CPU 版 | `cpu-diar` | Editor 版には文字起こし・話者分離が無いため対象外 |

ビルド時の注意（PoC で確認）:

- Vulkan ビルドには SPIRV-Headers が必要。ggml-vulkan は `spirv/unified1/spirv.hpp` を include パスから読むため、`CMAKE_PREFIX_PATH` に加えて include パスも通す
- NeMo-Speech.cpp は sentencepiece の開発ファイルが必要（ビルド時のみ、静的リンク可）
- NeMo-Speech.cpp の CUDA プリセットは `ggml-patches/` のパッチを当てる。必ず `scripts/configure.sh` 経由で configure する
- 3つの実行ファイルは、それぞれ別バージョンの ggml を持つ。別プロセスとして動かすので衝突はしないが、共有ライブラリ（`libggml*.so` / `ggml*.dll`）は**バイナリごとに別ディレクトリへ置く**

Windows（`scripts/setup-ggml-speech-windows.ps1`）で確認した注意点:

- 必要なもの: VS 2022 Build Tools（C++。同梱の CMake / Ninja を使う）、Git、CUDA Toolkit 12.x（CUDA 版）、LunarG Vulkan SDK（Vulkan 版）。sentencepiece は vcpkg（NeMo-Speech.cpp の `builtin-baseline` と同じ commit に固定）で静的リンクする。初回は vcpkg が protobuf 等をビルドするため時間がかかる
- NeMo 公式の `scripts\windows\build.ps1` は使わない。PATH をレジストリから読み直すため、引用符付きの PATH エントリがあると `vcvars64.bat` が「\Microsoft was unexpected at this time.」で失敗する。セットアップスクリプトはプロセス内で PATH を整形してから、同じ手順（vcvars → vcpkg → ggml パッチ → cmake）を行う
- 日本語版 Windows では NeMo-Speech.cpp に `/utf-8` が必要（`src/common/subtitles.cpp` が C3688 で失敗する）。`CMAKE_CXX_FLAGS` を直接指定すると既定の `/EHsc` が消えるため、`CFLAGS` / `CXXFLAGS` / `CUDAFLAGS` 環境変数で渡す。whisper.cpp は ggml 側で付いている
- whisper.cpp の examples は C++11 でコンパイルされる。パッチを直すときは C++17 の機能（非 const の `std::wstring::data()` など）を使わない
- CUDA 版は `cudart64_12.dll` / `cublas64_12.dll` / `cublasLt64_12.dll` を実行ファイルの隣へ置く（PATH 上の CUDA に依存しない）。**1エンジンあたり約0.8GB**になり、2エンジンで約1.6GB。同梱の llama-server も CUDA 12.4 の同じ DLL を持つため、配布時は共有・cuBLAS シム（NeMo の `-DNEMO_SPEECH_CUBLAS_SHIM=ON`）・CUDA バージョンの統一を検討する（12章）
- `-CudaArch` の既定 `native` は手元の GPU だけを対象にする。配布ビルドでは対象世代を並べる（例: `75;86;89;120`）
- Vulkan 版は LunarG Vulkan SDK が必要（`winget install KhronosGroup.VulkanSDK`。導入直後のシェルには `VULKAN_SDK` が反映されないため、スクリプトはレジストリからも読む）。whisper.cpp にも `SPIRV-Headers_DIR` を渡す。実行時は OS の `vulkan-1.dll` だけを使い、追加の DLL は不要
- NeMo の ggml サブモジュールに CUDA 用パッチが当たったままでも、Vulkan 版（`NEMO_SPEECH_GGML_PATCHED=OFF`）はビルド・動作した
- バックエンドを並べて比較するときは `-EnginesDir` で配置先を変える（既定はアプリが読む `python_sidecar\speech-engines`）



配置先の案（`resources/` 同梱）:

```text
resources/speech-engines/whisper/<backend>/whisper-cli(.exe) + ggml ライブラリ
resources/speech-engines/nemo/<backend>/nemo-speech(.exe)   + ggml ライブラリ
```

サイズは Vulkan 版でそれぞれ約50〜60MB（PoC、Linux）。サイズが問題になる場合は、`install_llm_backend` と同様のセットアップ後ダウンロードに切り替える。

### 8.1 Vulkan 版インストーラー（2026-09-25 実装、開発モードで動作確認）

方針（AGENTS.md Distribution Strategy）に沿って、NVIDIA / AMD / Intel 共通の Vulkan 版を追加した。

- 判定: Rust の feature `vulkan`（identifier は CUDA 版の `net.gakkousya.lott` を引き継ぐ）。文字起こし・話者分離は常に ggml、標準（Python）経路は持たない
- ビルド: `scripts\setup-build-tools.bat --vulkan` → `scripts\prepare-vulkan-bundle-windows.ps1`（エンジン 109MB・llama-server 89MB・最小 Python 44MB。CUDA 版の llama-server 約1.1GB は不要）
- 初回セットアップ: モデルは `ggml_speech::GGML_MODEL_FILES`（固定 revision・SHA-256・サイズ）を Rust で取得（`.part` から続きを再開、検証一致後に配置）。Gemma は従来どおり同梱 Python で取得
- GPU: 設定タブの1つの欄で、文字起こし・話者分離・校正・音声入力に同じ GPU を使う（`set_preferred_vulkan_gpu`）。GPU が無いときは CPU で動き、その旨を表示する

未完了（次の作業）:

1. インストーラーを実際にビルドし、別フォルダ・別 PC・オフラインで起動確認する
2. ライセンス: Nemotron（OpenMDW-1.1）・Silero VAD・llama.cpp の本文は `licenses/manual/` に配置済み、`THIRD_PARTY_LICENSES.md` にも追記済み（2026-09-25）。セットアップ画面の話者分離の行から Nemotron の本文を表示できる（`read_bundled_license`）。残りは配布前の`collect_licenses.py --venv src-tauri\resources\python312-vulkan` で Python 分を再生成する
3. ~~不要データの削除ボタン~~ 実装済み（設定タブ。`list_legacy_cuda_data` / `delete_legacy_cuda_data`。リリース版の Vulkan 版のみ、対象は Rust 側で決め直す）。インストーラーでの実機確認が残り
4. README（日本語・英語）に Vulkan 版の説明を追記済み（v0.9.9）。AGENTS.md の Proofreading Policy には Vulkan 版の起動方法を追記済み（CUDA / ROCm の記述は現行実装の説明として残している）
5. Editor 版の llama-server を Vulkan 版へ差し替える（音声入力の Vulkan 起動処理は実装済み）

## 9. ライセンス

| コンポーネント | ライセンス | 配布時の対応 |
|---|---|---|
| whisper.cpp / ggml | MIT | 著作権表示と本文を同梱 |
| NeMo-Speech.cpp | Apache-2.0（NVIDIA 著作分） | LICENSE / NOTICE / THIRD_PARTY_NOTICES を同梱 |
| sentencepiece（静的リンク） | Apache-2.0 | 本文を同梱 |
| Whisper turbo（ggml 変換版） | MIT | 現行と同じ |
| Silero VAD | MIT | 著作権表示と本文を同梱 |
| Nemotron-3-Diarization | OpenMDW-1.1 | 商用利用・改変・再配布可。再配布時はライセンス文と帰属表示を残す。出力物には制約なし。特許・著作権訴訟を起こすと権利が終了する条項あり。**同梱せずダウンロードにする場合も、ライセンス文を `licenses/` に置き、セットアップ画面から参照できるようにする** |

`THIRD_PARTY_LICENSES.md` と `licenses/` への追記は実装時に行う。FFmpeg の LGPL 方針は変わらない（デコードは現行の同梱 ffmpeg で行う）。

## 10. 導入の段階

AGENTS.md は `transcribe_cli.py` と `diarize_cli.py` を触れないところとしている。そのため**既存経路を残したまま、新エンジンを選択式で追加する**。

| 段階 | 内容 | 既定 |
|---|---|---|
| 0 | PoC（完了）と本設計メモ | - |
| 1 | Windows / NVIDIA での検証（CUDA 版と Vulkan 版の両方）、正解ラベル付き区間での DER 測定 | - |
| 2 | Rust に新エンジンの実行経路を追加。設定タブに「音声エンジン: 標準（faster-whisper / pyannote）／ggml（試験的）」を追加 | 標準 |
| 3 | バイナリ・モデルのセットアップ（ダウンロード・検証）、ライセンス同梱、オフライン検証 | 標準 |
| 4 | 実運用で評価（カウンセリング音声、Windows / Linux、NVIDIA / AMD） | 標準 |
| 5 | 既定を ggml に切り替え、Python 経路は保守モードへ | ggml |
| 6 | Python / PyTorch 依存の削除、配布ラインの簡素化 | ggml |

文字起こしと話者分離は、それぞれ独立に切り替えられるようにする（例: whisper.cpp + pyannote）。一方だけを先に既定化できるようにするため。

## 11. 受け入れ基準（段階5で既定を切り替える条件）

- 文字起こし: 正解テキスト付きの評価区間で、文字誤り率が faster-whisper と同等以下。反復ハルシネーションが無い
- 話者分離: 正解ラベル付きの評価区間で、DER が pyannote community-1 と同等以下。短い相づちの扱いを目視で確認する
- 速度: 主配布（Windows + NVIDIA）で、文字起こしと話者分離の合計時間が現行以下
- 実行時にネットワーク通信が発生しない（オフライン検証で確認）
- キャンセル・異常終了時に子プロセスが残らない（Windows Job Object、Linux の kill_process_tree）
- 既存の保存形式・表示名マッピングが変わらない

## 12. リスクと未解決事項

| 項目 | 内容 | 対応 |
|---|---|---|
| NVIDIA での性能 | 実測（2.1）: 文字起こしはほぼ同等（10分 18.6秒 vs 19.6秒）、話者分離は約3倍速い。合計は10分で約43%、50分で約28%短い。Python の初回読み込みが無い分、初回実行の差はさらに大きい | 速度だけでは置き換えの決め手にならない。依存削減・メモリ・安定性と合わせて判断する |
| Windows の CUDA DLL の容量 | cuBLAS 一式を各エンジンの隣へ置くと約1.6GB。llama-server の CUDA 12.4 DLL とも重複する | 配布前に、DLL の共有・cuBLAS シム・CUDA バージョンの統一を比較する |
| Windows / Vulkan のデバイス選択 | 実測（2.2）: RTX 4060 では CUDA 版と同等の速度だが、iGPU 併載機では両エンジンとも既定で iGPU を選ぶ | 音声エンジンは自動選択と設定での指定を実装した（6.5）。校正の llama-server は未対応 |
| NVIDIA を Vulkan に統一する場合の校正速度 | 実測（2.3）: E4B で約2割、12B で約1割遅い。音声入力は同じ | 容量（CUDA 版は cuBLAS 込みで音声エンジンだけで約1.6GB、llama-server も約1GB）・インストーラーの一本化と比べて決める。文字起こし・話者分離の標準経路（faster-whisper / pyannote）が残る間は、NVIDIA 版の PyTorch CUDA がどのみち必要 |
| Vulkan on NVIDIA | NVIDIA では Vulkan が CUDA より遅いことが多い | NVIDIA は CUDA 版を当面の本命とする |
| Nemotron の成熟度 | 2026-09-23 公開、NeMo-Speech.cpp 対応は 09-24 マージ（v0.1.0）。レビューで「話者ラベル・タイムスタンプが誤る可能性」が指摘されている | commit を固定し、更新は検証後に行う |
| 日本語の話者分離 | 対応言語に日本語が無い | 実際のカウンセリング音声で DER を測る |
| 短い発話の話者 | 1.5秒未満の発話で既存との一致率が低い（78.5%） | 正解ラベルでどちらが正しいかを判定する |
| 話者数の指定 | モデル側で指定できない | 6.2 の後処理。精度が不足すれば C API の確率を使う方式へ進む |
| 長尺の話者分離時間 | 10分で7秒に対し50分で59秒と、長さに比例しない伸び方をした | プリセット（`v3-streaming` / `v3-offline`）を比較する |
| RADV の警告 | 「non-conformant」と表示されるが動作に問題は無かった | 表示だけの警告として扱う。ログで抑制するかは実装時に判断 |
| Windows ビルド | CUDA 版・Vulkan 版は確認済み（8章）。日本語版 Windows 特有の問題（`/utf-8`、PATH の引用符）と、日本語パスの問題（7.1）に対処した | CPU 版のビルドは未確認 |
| 初期プロンプト | 現行アプリでもほぼ効いていない（5.2） | ggml 導入とは別に、現行経路の改善課題として扱う |

## 13. 参考

- PoC: `demo_data/ggml-poc/README.md`（`build.sh` / `run.sh` で再現可能）
- whisper.cpp: <https://github.com/ggml-org/whisper.cpp>（PoC commit `d09f61a`）
- NeMo-Speech.cpp: <https://github.com/NVIDIA/NeMo-Speech.cpp>（PoC commit `97a15af`）
- Nemotron-3-Diarization: <https://huggingface.co/nvidia/Nemotron-3-Diarization>
- OpenMDW-1.1: <https://openmdw.ai/license/1-1/>
- 現行の関連実装: `run_transcription_blocking` / `run_diarization_blocking` / `assign_speakers_to_segments`（`src-tauri/src/lib.rs`）、`python_sidecar/transcribe_cli.py`、`python_sidecar/diarize_cli.py`
