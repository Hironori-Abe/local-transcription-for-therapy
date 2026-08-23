# CachyOS / Arch NVIDIA CUDA版

このパッケージはAppImageへGUIライブラリを同梱せず、CachyOS / Archホストの
WebKitGTK、GTK、GLib、GStreamerを使用します。

## NVIDIAランタイム（必須）

このパッケージはNVIDIA GPU向けです。実行時に次のホストパッケージを使用するため、
PKGBUILDでも必須依存として宣言しています。

- `nvidia-utils`: `nvidia-smi` と NVIDIAユーザー空間ランタイム（`libcuda.so` など）
- `vulkan-icd-loader`: セットアップタブから取得するLLM用Vulkan `llama-server` の実行基盤

`nvidia-utils`だけではカーネル側のNVIDIAドライバーは入りません。CachyOSの使用カーネルに
合う `nvidia` / `nvidia-open` / `nvidia-dkms` などを環境に合わせて導入し、再起動後に
次がGPU名を表示することを確認してください。

```sh
command -v nvidia-smi
nvidia-smi -L
```

既存の古いパッケージから更新する場合や、依存解決を省略して導入した場合は、次で補完できます。

```sh
sudo pacman -S --needed nvidia-utils vulkan-icd-loader
```

モデルのダウンロードはGPUドライバーが無くても完了することがあります。モデル取得完了は
CUDA利用可能の判定ではないため、ドライバーを導入・再起動した後にアプリの「GPUを再確認」を
実行してください。

## Linux NVIDIA版のLLM実行経路（暫定）

Linux NVIDIA版は、文字起こし・話者分離をCUDAで実行します。LLM校正は現行のLinux配布構成で
CUDA版 `llama-server` を同梱していないため、セットアップタブからダウンロードしたVulkan版
`llama-server`を使用します。これはLinux NVIDIAでの起動を成立させるための暫定経路です。
Windows NVIDIA版のCUDA直起動、およびプロジェクト方針であるNVIDIA CUDA直起動へLinux LLMを
移行することは、別の恒久対応課題です。AMD版のROCm優先・Vulkanフォールバックとは別の話です。

## インストール

```sh
sudo pacman -U LoTT-v0.9.8-linux-x64-cuda-cachyos.pkg.tar.zst
```

インストール後はアプリケーションメニューの「LoTT（ローカル文字起こし）」、
または次のコマンドで起動できます。

```sh
lott
```

デスクトップエントリは`/usr/share/applications/net.gakkousya.lott.desktop`へ
インストールします。アプリケーションメニューでは「LoTT」または「文字起こし」で
検索できます。`desktop-file-utils`を必須依存にしているため、インストール・更新時に
pacmanの標準フックがデスクトップ情報キャッシュを更新します。

アイコンはhicolorテーマの標準サイズ一式と実ウィンドウの両方へ設定します。
インストール・更新時はpacmanのフックがアイコンテーマキャッシュを更新します。

NVIDIAとWebKitGTKのGBM問題を避けるため、ランチャーは既定で
`GDK_BACKEND=x11`と`WEBKIT_DISABLE_DMABUF_RENDERER=1`を設定します。
明示した環境変数は尊重されます。診断目的でWaylandへ戻す場合は次のようにします。

```sh
LOTT_GDK_BACKEND=wayland lott
```

DMA-BUF無効化を外すと、確認済みのNVIDIA環境では
`Failed to create GBM buffer`が発生するため、通常起動では維持します。

## アンインストール

```sh
sudo pacman -R local-transcription-for-therapy-cuda
```

アプリのローカルデータとダウンロード済みモデルはユーザーディレクトリに残ります。

## 再ビルド

リポジトリのルートで次を実行します。

```sh
bash scripts/build-arch-package.sh
```

成果物は`dist/arch/vX.Y.Z/`へ配置されます。

配布用ビルドは`packaging/arch/makepkg-lott.conf`を使い、開発機の
`/etc/makepkg.conf(.d)`にある`-march=native`や`target-cpu=native`を
読み込みません。LoTT本体は互換性を優先して`x86-64`へ固定し、毎回クリーンな
Cargoビルド領域を使用します。生成後は次の検査も自動実行され、AVX-512命令が
検出された場合は失敗します。

```sh
bash scripts/verify-arch-package-cpu.sh \
  dist/arch/v0.9.8/LoTT-v0.9.8-linux-x64-cuda-cachyos.pkg.tar.zst
```

CachyOSのv4ホストで作成した場合、`.BUILDINFO`の`installed`欄にはビルドホストの
パッケージ名として`x86_64_v4`が記録されます。これは共有ライブラリを配布物へ
同梱したという意味ではありません。実際のコンパイル指定はパッケージ内の
`/usr/share/doc/local-transcription-for-therapy-cuda/BUILD_CPU_TARGET.txt`で確認し、
上記スクリプトで本体の命令も検査します。

## CachyOS experimental x86-64-v3版

Ryzen 7 3700X / RTX 2070 SuperのCachyOS実機では、互換性優先の`x86-64`版より
`x86-64-v3`版のスクロール応答が明確に改善しました。この最適化版はArch一般向けと
せず、**CachyOS experimental**として別名で生成します。

```sh
bash scripts/build-cachyos-experimental-package.sh
```

成果物:

```text
dist/cachyos/experimental/v0.9.8/
  LoTT-v0.9.8-linux-x64-v3-cuda-cachyos-experimental.pkg.tar.zst
```

この版は`x86-64-v3`（AVX2 / BMI2等）対応CPU専用です。AVX-512は使用せず、生成後の
静的検査でもZMM・mask・AVX-512 broadcast命令を拒否します。未対応CPU向けには
`scripts/build-arch-package.sh`で生成する汎用`x86-64`版を使用してください。

表示バックエンドは検証結果に合わせてX11、DMA-BUF renderer無効を既定とします。
Waylandではカクつきが増え、DMA-BUF rendererを有効にするとGBM buffer作成エラーが
再現したため、experimental版でもこの安全側の起動設定は変更しません。
