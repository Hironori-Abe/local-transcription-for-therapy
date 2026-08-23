# Linux配布ビルド（NVIDIA CUDA）

Linux NVIDIA版の`llama-server`は、ggml-orgが公式リリースでLinux CUDAバイナリを
配布していないため、Windows版のようにarchiveをダウンロードして同梱することはできません。
配布ビルドでは、公式llama.cppのb10075ソースを固定commitから取得し、公式NVIDIA CUDA
develイメージ内でビルドします。

## CUDA llama-serverのビルド

```sh
bash scripts/build-llama-server-cuda-linux.sh --ensure
bash scripts/build-llama-server-cuda-linux.sh --check
```

既定値は次のとおりです。

- llama.cpp: b10075 / commit `76f46ad29d61fd8c1401e8221842934bf62a6064`
- source archive SHA-256: `7ee81d765c2de832b459580a98d04045a8ed84f9829dea89d8c64528b78cea5b`
- build image: `nvidia/cuda:12.4.1-devel-ubuntu22.04@sha256:5645fec64549cc35930eee9d85aafd2b0006c0c3f22632be5a1d85e2604e9749` (linux/amd64)
- output: `src-tauri/resources/llama-server/cuda/`

`--force`で再ビルドできます。ビルドスクリプトはsource archiveのSHA-256を検証し、
`LLAMA_CPP_BUILD_INFO.txt`へcommit、ハッシュ、構成、使用イメージdigest、再ビルド方法を記録します。
公式コンテナ内のCUDA EULA/LICENSE候補（`/usr/local/cuda`配下、または
`/NGC-DL-CONTAINER-LICENSE`）を
`NVIDIA-CUDA-RUNTIME-LICENSE.txt`としてresourceへコピーし、候補が見つからない場合は
ビルドを失敗させます。
生成物はGitへコミットせず、`.gitignore`で除外します。

## Linux配布物のビルド

AppImage / `.deb` は、CUDA `llama-server`を先に作成してからUbuntu 24.04コンテナで
ビルドします。

```sh
bash scripts/build-appimage-docker.sh
```

CachyOS / Archの`pkg.tar.zst`は次のコマンドでビルドします。

```sh
bash scripts/build-arch-package.sh
```

いずれもLinux NVIDIA版では`resources/llama-server/cuda/`をパッケージへ収録し、
Vulkanバックエンドを依存・取得・実行しません。

## 実行時のCUDA要件

配布先に必要なのは、使用中のカーネルに対応したNVIDIAドライバーとユーザー空間の
`nvidia-utils`です。CUDA Toolkit（`nvcc`を含む）は、配布物の実行やLLM校正には必要
ありません。ビルド時に使ったCUDAの再頒布可能なランタイム・数学ライブラリは
`resources/llama-server/cuda/`へ同梱します。

`libcuda.so.1`はGPUドライバーの一部であり、NVIDIAドライバーから解決します。ドライバー
ライブラリやCUDA toolkitのstubは同梱しません。CachyOSパッケージでは`nvidia-utils`を
必須依存にしています。

## ライセンスとsource offer

- llama.cppのソースと`LICENSE`はMITです。ビルド時に`LLAMA_CPP_LICENSE.txt`を生成物へ
  配置し、アプリの`LICENSE` / `NOTICE` / `THIRD_PARTY_LICENSES.md`とともに配布します。
- CUDA再頒布ランタイムのライセンスは、リポジトリの
  `licenses/manual/NVIDIA-CUDA-Toolkit-EULA-12.4.txt`に収録します。さらに、ビルドに使用した
  公式CUDAコンテナから取得したライセンス文書を
  `resources/llama-server/cuda/NVIDIA-CUDA-RUNTIME-LICENSE.txt`としてresourceにも同梱します。
- `LLAMA_CPP_BUILD_INFO.txt`に固定commitとsource URLを記録しています。利用者が同じ
  ソースから再ビルドできるよう、`scripts/build-llama-server-cuda-linux.sh`をリポジトリへ
  同梱します。
- CUDAドライバー本体（`libcuda.so.1`）は配布物へ含めず、利用者がNVIDIA/CachyOSの
  パッケージから導入します。
