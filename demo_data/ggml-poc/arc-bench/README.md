# Intel Arc（Vulkan）計測パッケージ

GPU 実行を Vulkan へ統一する前に、Intel Arc でも RTX 4060 と同程度の遅さで動くかを確かめるためのもの。
方針は `AGENTS.md`（Distribution Strategy）、RTX 4060 の結果は `docs/ggml-speech-engine-design.md` 2.2・2.3。

## 用意するもの

- Windows 11、Intel Arc（dGPU / 内蔵 Arc どちらでも可）と最新の Intel グラフィックスドライバー
- このリポジトリ（`N3-Diarization` ブランチ）
- Visual Studio 2022 Build Tools（C++）、Git、Python 3
- LunarG Vulkan SDK: `winget install KhronosGroup.VulkanSDK`
- 音声: `demo_data/10minutes/` と `demo_data/50minutes/`（mp3 と既存の `lott_*.json`）をこの PC からコピーする
- 校正モデル（任意）: `python_sidecar/models/llm/gemma-4-e4b-it/`（本体・MTP・mmproj）と `gemma-4-12b-it/`。無ければ校正は飛ばす

## 実行

```bat
powershell -ExecutionPolicy Bypass -File demo_data\ggml-poc\arc-bench\run-arc-bench.ps1
```

- 初回はビルド（vcpkg の依存を含む）とモデル取得で時間がかかる。2回目以降は `-SkipBuild`
- 短く試すなら `-Quick`（10分音声・各1回、50分音声と 12B を飛ばす）
- GPU は自動選択（内蔵 GPU 以外で容量最大。アプリと同じ規則）。指定するなら `-Device <Vulkan の番号>`（`engines\nemo\bin\nemo-speech.exe doctor` の番号）

## 結果

`results\<日時>\results.md` に、各項目の秒数と RTX 4060（Vulkan）に対する比を書く。`results.json` は詳細。
音声や書き起こしの本文は書き出さない（文字数・セグメント数・既存出力との文字差だけ）。

判断の目安: RTX 4060 では CUDA に対して、音声エンジンは同等、校正は約1〜2割遅かった。
Arc の GPU 性能差もあるので、比そのものより「失敗・欠落・反復が無いこと」と「実用的な所要時間か」を見る。

## 注意

- 1回目はシェーダーのコンパイルで遅い（表では「1回目」と「2回目以降」を分けている）
- ビルド物（`engines\`、`llama-vulkan-b10075\`）と `results\` は git 管理外
- 計測中の通信は無い（llama-server は 127.0.0.1 のみで起動する）
- この PC（RTX 4060 Laptop）で `-Quick` を実行し、参考値と一致することを確認済み（2026-09-25）
