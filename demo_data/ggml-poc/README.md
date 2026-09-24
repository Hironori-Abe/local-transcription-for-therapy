# ggml / Vulkan 文字起こし + 話者分離 PoC（2026-09-25）

アプリ未組み込みの検証用作業場所。`demo_data/` 配下は git 管理外で、このフォルダの手順ファイルだけを明示的に追加している。
導入の設計は `docs/ggml-speech-engine-design.md` を参照。

## 構成

- 文字起こし: whisper.cpp（Vulkan）+ `ggml-large-v3-turbo.bin`
- 話者分離: NeMo-Speech.cpp（Vulkan）+ Nemotron-3-Diarization q8_0
- 比較対象: Nemotron 3.5 ASR 0.6B（NeMo-Speech.cpp）
- 比較基準: 既存の LoTT 出力（faster-whisper turbo + pyannote community-1）。**正解データではない**

## 使い方

```sh
./build.sh      # ソースから再ビルド（SPIRV-Headers / sentencepiece は ./prefix へローカル導入）
./run.sh ../10minutes/f2f5a6da-bf48-9892-0c61-861f961ec77d.mp3 ../10minutes/lott_20260425_173947.json 10min [vulkanデバイス番号]
```

Nemotron のモデルは `~/.cache/nemo-speech/models/` に保存される（`nemo-speech pull` で取得）。

## 結果（R9700 = vulkan:0、890M = vulkan:1、モデル読み込み込み）

| | 10分 R9700 | 10分 890M | 50分 R9700 |
|---|---|---|---|
| whisper.cpp 文字起こし | 16.1s | 53.5s | 64.6s |
| Nemotron 話者分離 | 7.3s | 30.2s | 59.4s |
| 既存との話者一致率 | 94.1% | - | 83.8% |
| 既存との文字差（編集距離） | 12.0% | - | 17.3% |

- whisper.cpp（VAD 無し）は既存より相づちを多く拾う。長尺でもハルシネーションによる繰り返しループは無し
- 話者の不一致は短い発話に偏る（50分: 1.5s未満 78.5% / 6s以上 91.7%）。相づちを Nemotron のほうが自然に分けている箇所もある

### Nemotron 3.5 ASR 0.6B（10分、R9700、`--language ja-JP`）

| 設定 | 時間 | 既存との文字差 |
|---|---|---|
| 既定 | 37.6s | 25.3% |
| `--asr.streaming.rnnt_right_context=-1` | 20.3s | 23.9% |
| 上記 + `--diarize`（統合モード） | 28.4s | - |

- 誤認識が目立つ（「仲良し夫婦」→「中休」、「日常日本語会話」→「日常に保護会話」など）。whisper.cpp より精度・速度とも劣る
- 統合モードは日本語で実用にならない。単語区切りが無いため「word」が発話単位の塊になり（10分で16個）、話者が塊ごとにしか付かない

## ファイル

- `out/whisper_*.json` / `out/diar_*.json`: 各ツールの生出力
- `out/merged_*.json`: 統合結果（`mappedSpeaker` は既存ラベルへ対応付けた話者）
- `out/n35*_10min.json`: Nemotron 3.5 ASR の出力
- `analyze.py`（統合・比較）、`cer.py`（文字差）、`difftop.py`（大きな差分の表示）、`timeit.py`（時間・メモリ計測）

## アプリ同等条件での比較（VAD + 初期プロンプト、beam 3 / best-of 3、R9700）

VAD はアプリと同じ値（`-vt 0.5 -vspd 200 -vsd 800 -vp 400`、Silero v6.2 `models/ggml-silero-v6.2.0.bin`）。
アプリの初期プロンプトは `app_initial_prompt.txt`（380トークン）。**faster-whisper も whisper.cpp も末尾の約223トークンしか使わない**ため、
先頭の「以下は日本語の会話です。えーとですね…」と用語前半は現行アプリでも捨てられている。
また faster-whisper は `condition_on_previous_text=False` のため、プロンプトが効くのは最初の30秒の窓だけ。

| 条件 | 10分 時間 | 10分 既存比 | 50分 時間 | 50分 既存比 |
|---|---|---|---|---|
| faster-whisper（アプリの transcribe_cli.py、ROCm） | 23.4s | 11.4% | 74.9s（4.6GB RSS） | 10.8% |
| whisper.cpp A: プロンプト最初の窓 + 文脈引継ぎ | 14.3s | 11.8% | - | - |
| whisper.cpp B: `--carry-initial-prompt`（毎窓） | 11.9s | 11.5% | - | - |
| **whisper.cpp C: `-mc 0`（プロンプト無・引継ぎ無）** | **12.1s** | **8.8%** | **43.6s（0.9GB）** | **5.1%** |

- B はセグメントが長すぎる（10分で154個）ため話者分離との統合に不向き
- プロンプト用語の混入（音声に無い専門用語の出現）はどの条件でも見られない
- faster-whisper の 50分出力で「お金」×15 の反復ループが発生し、2476〜2488秒の実発話が消失。whisper.cpp C は同区間を正しく認識（4月の既存出力には無いので ROCm 実行時の偶発の可能性）
- 既存出力自体が正解ではない点に注意（faster-whisper の再実行でも既存と 11% 違う）

スクリプト: `cmp_prompt.py`（10分）、`cmp50.py`（50分）
