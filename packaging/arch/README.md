# CachyOS / Arch NVIDIA CUDA版

このパッケージはAppImageへGUIライブラリを同梱せず、CachyOS / Archホストの
WebKitGTK、GTK、GLib、GStreamerを使用します。

ファイル選択ダイアログは、ホストの日本語ロケールと `xdg-user-dirs`（`~/デスクトップ`
など）をそのまま利用する XDG Desktop Portal 経由で開きます。`xdg-desktop-portal`、
`xdg-desktop-portal-gtk`、`zenity` はパッケージの必須依存です。KDE環境では
`xdg-desktop-portal-kde` がインストール済みなら、ポータルの標準選択によりKDE側の
ファイル選択UIが優先されます。

## NVIDIAランタイム（必須）

このパッケージはNVIDIA GPU向けです。実行時に次のホストパッケージを使用するため、
PKGBUILDでも必須依存として宣言しています。

- `nvidia-utils`: `nvidia-smi` と NVIDIAユーザー空間ランタイム（`libcuda.so` など）

Linux CUDA版のLLM `llama-server` は、公式のLinux CUDA archiveが存在しないため、
llama.cpp b10075ソースからビルドしたCUDA版をアプリへ同梱します。CUDA Toolkit本体は
実行時には必要ありません。ホストのNVIDIAドライバー（`libcuda.so.1`）だけを使用し、
CUDAの再頒布可能なランタイム・数学ライブラリはアプリ側へ同梱します。

`nvidia-utils`だけではカーネル側のNVIDIAドライバーは入りません。CachyOSの使用カーネルに
合う `nvidia` / `nvidia-open` / `nvidia-dkms` などを環境に合わせて導入し、再起動後に
次がGPU名を表示することを確認してください。

```sh
command -v nvidia-smi
nvidia-smi -L
```

既存の古いパッケージから更新する場合や、依存解決を省略して導入した場合は、次で補完できます。

```sh
sudo pacman -S --needed nvidia-utils
```

モデルのダウンロードはGPUドライバーが無くても完了することがあります。モデル取得完了は
CUDA利用可能の判定ではないため、ドライバーを導入・再起動した後にアプリの「GPUを再確認」を
実行してください。

## Linux NVIDIA版のLLM実行経路

Linux NVIDIA版は、文字起こし・話者分離・LLM校正をCUDAで実行します。Linux用CUDA版
`llama-server`は公式リリースのバイナリarchiveではなく、ビルド時に公式llama.cppの
commit `76f46ad29d61fd8c1401e8221842934bf62a6064`（b10075）から再現ビルドし、
`resources/llama-server/cuda/`へ配置してパッケージへ同梱します。公式コンテナから取得した
`NVIDIA-CUDA-RUNTIME-LICENSE.txt`も同じresourceへ同梱します。Vulkanは使用しません。
ビルド方法とsource offerは `scripts/build-llama-server-cuda-linux.sh` と
`docs/release-build-linux.md` に記載しています。

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

ランチャーはホストのデスクトップ環境、`GDK_BACKEND`、`GTK_IM_MODULE`、
`WEBKIT_DISABLE_DMABUF_RENDERER`などの既定値を変更しません。これにより、KDE/GNOMEなど
実行中のデスクトップ環境が選んだWayland/X11とWebKitGTKの描画経路をそのまま使います。

表示の切り分けでX11/XWaylandを明示する場合は、次のように起動します。

```sh
LOTT_GDK_BACKEND=x11 lott
```

以前のNVIDIA向け回避策を比較する場合だけ、DMA-BUF rendererの無効化も明示します。

```sh
LOTT_GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 lott
```

これは診断用の組み合わせであり、通常起動時にはランチャーが設定しません。

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

このスクリプトは、パッケージ作成前にDocker上でllama.cpp b10075のLinux CUDA版を
ソースからビルドします。初回はNVIDIA CUDA develイメージとソース取得のため、ビルド時だけ
インターネット接続が必要です。Dockerを使わずに事前ビルド済みresourceを用意する場合は、
`scripts/build-llama-server-cuda-linux.sh --check` が成功する状態にしてください。

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

表示バックエンドとDMA-BUF rendererは、experimental版でもホストのデスクトップ環境と
WebKitGTKの既定値を使用します。以前のX11/DMA-BUF無効構成を比較する場合は、上記の
診断用環境変数を明示してください。
