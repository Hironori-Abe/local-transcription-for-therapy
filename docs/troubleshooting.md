# トラブルシューティング

## GPU が無い / CPU のみで動かしたい

- 本アプリは **CPU のみでの動作を想定していません**。文字起こし・話者分離・LLM 校正はいずれも GPU（CUDA / ROCm）での実行を前提としています。
- 対応 GPU（NVIDIA RTX / CUDA、または対応 AMD GPU）が無い環境では正常に動作しません。

## VRAM 不足でクラッシュ・処理が進まない

- Full CUDA 版の **最低要件は VRAM 8GB** です。文字起こし・話者分離・LLM 校正を同時に走らせると VRAM 使用量が増えます。
- VRAM が不足する場合は、他の GPU 利用アプリを終了する、話者分離や LLM 校正を分けて実行するなどで使用量を抑えてください。

## cargo が見つからない

- `cargo metadata ... program not found`
- Rustup をインストールし、ターミナル再起動後に `cargo --version` を確認してください。

## CUDA/cuDNN 関連でクラッシュ

- `exit=-1073740791` など
- CUDA 12.x / cuDNN 9.x の `bin` が PATH で見えるか確認してください:

```powershell
where.exe cublas64_12.dll
where.exe cudnn64_9.dll
```

## 話者分離モデルが見つからない

- `python_sidecar/models/pyannote-speaker-diarization-community-1` にモデル一式を配置してください（dev）。
- または `DIARIZATION_MODEL_PATH` を設定してください。
- リリースビルドでは `%LOCALAPPDATA%\{identifier}\models\` 配下を参照します。

## AMD ROCm: "no ROCm-capable device is detected"（Linux）

- GPU セレクターで device 1 以上を選択しているのに「ROCm デバイスが見つからない」エラーが出る場合、`ROCR_VISIBLE_DEVICES` と `HIP_VISIBLE_DEVICES` の二重フィルターが原因の可能性があります。
- ROCR が先にデバイスリストを絞り込んだ後、HIP が絞り込み済みのリストにアクセスするためインデックスがずれます。
- 修正済み（`src-tauri/src/lib.rs` で `ROCR_VISIBLE_DEVICES` を削除、`HIP_VISIBLE_DEVICES` のみ設定）。

## AMD ROCm: 話者分離が非常に遅い（旧世代 iGPU / Linux）

- Radeon 780M / 旧890M（gfx1103）では MIOpen の対応カーネルが未収録のため、GPU 話者分離に失敗します。
- `diarize_cli.py` が自動で CPU フォールバックするため処理は完了しますが、10 分音声で約 15〜20 分かかります（正常動作）。
- Ryzen AI 9 HX 370 内蔵の Radeon 890M（gfx1150）は PyTorch 2.11.0+rocm7.2 以降で GPU 話者分離・文字起こしともに動作します。

## AMD ROCm: 文字起こし中にクラッシュする（gfx1102 / RX 7600M XT）

- RX 7600M XT（gfx1102）では ctranslate2-rocm による文字起こし中に `CUDA failed with error an illegal memory access` でクラッシュすることがありました。
- 原因はデフォルトのメモリアロケータ（MallocAsync）が AMD GPU と非互換であること（OpenNMT/CTranslate2 issue #2012）。
- 修正済み: `transcribe_cli.py` が gfx1102 検出時に `CT2_CUDA_ALLOCATOR=cub_caching` と `HSA_OVERRIDE_GFX_VERSION=11.0.0` を自動設定します（3分・10分ファイルで完走確認済み）。
- 話者分離（pyannote + MIOpen）も gfx1102 で GPU 動作します。

## AMD: 高精度(12B)校正が ROCm にならず Vulkan（やや遅い）で動く

- 12B 校正は AMD で **ROCm 優先 → 失敗時 Vulkan フォールバック**です。ROCm 経路（約35〜37 tok/s）が選ばれず Vulkan（約28〜29 tok/s）になる主因は次のいずれか。
  - **ROCm ビルドが古い**: `lemonade backends install llamacpp:rocm` が配るビルドが b9585 未満（例 b9247）だとドラフト arch `gemma4-assistant` を読めません。**同梱 Lemonade 10.8.0** で再導入すると b9630 が入ります（`~/.cache/{app-id}/lemonade/bin/llamacpp/rocm-stable/libllama.so.0.0.<build>` で確認）。
  - **対象 GPU arch の rocBLAS が無い**: ROCm 直起動は rocBLAS を system ROCm（`/opt/rocm*/lib/rocblas/library/*<gfx>*`）から解決します。dGPU の arch（例 gfx1102）の Tensile が無いと起動前ゲート（`system_rocm_tensile_has_arch`）で弾かれ Vulkan になります。system ROCm を導入してください（lemonade の therock は iGPU arch 専用のことがあり dGPU には使えません）。
- いずれも該当しなければ Vulkan で安全に動作します（機能差はなく速度のみ）。
- 関連クラッシュ痕跡: ROCm を therock 経由で起動すると `rocBLAS error: Cannot read ... TensileLibrary.dat ... for GPU arch : gfx1102` が出ます。本アプリは therock を `LD_LIBRARY_PATH` に載せないことでこれを回避しています。
