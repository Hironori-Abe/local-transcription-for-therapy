# CachyOS / Arch NVIDIA CUDA版

このパッケージはAppImageへGUIライブラリを同梱せず、CachyOS / Archホストの
WebKitGTK、GTK、GLib、GStreamerを使用します。

## インストール

```sh
sudo pacman -U LoTT-v0.9.8-linux-x64-cuda-cachyos.pkg.tar.zst
```

インストール後はアプリケーションメニューの「Local Transcription for Therapy」、
または次のコマンドで起動できます。

```sh
lott
```

NVIDIAとWebKitGTKのGBM問題を避けるため、ランチャーは既定で
`GDK_BACKEND=x11`と`WEBKIT_DISABLE_DMABUF_RENDERER=1`を設定します。
明示した環境変数は尊重されます。診断目的でWaylandへ戻す場合は次のようにします。

```sh
LOTT_GDK_BACKEND=wayland WEBKIT_DISABLE_DMABUF_RENDERER=0 lott
```

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
