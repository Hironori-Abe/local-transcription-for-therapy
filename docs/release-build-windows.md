# Release Build (Windows)

配布は NSIS インストーラー（Python embeddable 同梱・約 1GB）で行います。
venv は同梱せず、インストール後にセットアップ UI から Python パッケージをインストールする方式です。

---

## 1. NSIS インストーラー

### 前提

- Node.js / npm
- Rust / cargo
- tauri-cli（スクリプトが自動インストール）

### ビルド実行

プロジェクト直下で:

```bat
scripts\setup-build-tools.bat
```

- フロントエンドビルドと `cargo tauri build --bundles nsis` を一括実行します。
- 初回は Rust のコンパイルがあるため数十分かかります。
- エラー調査でログを残したい場合は、入力待ちを無効化してリダイレクトします。

```bat
scripts\setup-build-tools.bat --no-hold > setup-build-tools.log 2>&1
```

### 出力先

```text
src-tauri\target\release\bundle\nsis\Local Transcription for Therapy_X.Y.Z_x64-setup.exe
```

### インストール後の Python 設定

基本フロー（推奨）:

1. インストール後にアプリを起動
2. セットアップタブから「Python パッケージをインストール」を実行（インターネット接続が必要）
   - 同梱の Python embeddable（`resources/python312/python.exe`）から `setup_venv_cli.py` が実行され、`requirements-runtime.txt` のパッケージがインストールされます

カスタム venv を使う場合は環境変数で指定できます:

```powershell
setx PYTHON_BIN "C:\path\to\.venv312\Scripts\python.exe"
```

### 出力ファイル名とバージョン番号

出力ファイル名（`Local Transcription for Therapy_X.Y.Z_x64-setup.exe`）は `src-tauri/tauri.conf.json` の `version` フィールドから自動生成されます。リリース前にここを更新してください。

---

## 2. NSIS ビルド時の注意点

### ビルド中のネット接続

`setup-build-tools.bat` はビルド準備として以下をダウンロードします。各ファイルが既に存在する場合はスキップされます。

| 対象 | 保存先 | 制御変数 |
| ---- | ------ | -------- |
| Python 3.12 Embeddable zip | `src-tauri/resources/python312/` | `PYTHON_VERSION`（bat 内） |
| get-pip.py | `src-tauri/resources/python312/get-pip.py` | — |
| LGPL ffmpeg | `src-tauri/resources/ffmpeg/ffmpeg.exe` | `scripts/setup_ffmpeg_lgpl.py`（BtbN `lgpl` build） |

> NVIDIA 版は AI 校正に同梱 CUDA llama-server を直接起動するため、Lemonade（lemond / lemonade CLI）は同梱しません（撤去済み）。AMD 版は ROCm / Vulkan の llama-server をセットアップタブから後からダウンロードします。

バージョンを更新する場合は `scripts/setup-build-tools.bat` の変数を書き換えてから、対応するリソースフォルダを削除して再実行してください。

### `tauri.nvidia.windows.override.json` が必須な理由

`tauri.conf.json`（開発用）には `.venv312` や話者分離モデルが `resources` に含まれています。NSIS ビルドでこれらを同梱すると数 GB 超のインストーラーになります。`tauri.nvidia.windows.override.json` は `resources` リストを上書きして venv・モデルを除外し、代わりに embedded Python runtime（`resources/python312/`）、LGPL ffmpeg（`resources/ffmpeg/`）、セットアップスクリプト群、`LICENSE` / `NOTICE` / `THIRD_PARTY_LICENSES.md` / `licenses/` を含めます。

`setup-build-tools.bat` は `.venv312\Lib\site-packages` がある場合、`cargo tauri build` の前に次を自動実行します。

```bat
src-tauri\resources\python312\python.exe scripts\collect_licenses.py --venv .venv312 --frontend frontend --tauri src-tauri --out licenses
```

`.venv312` がない環境では自動収集をスキップし、既存の `licenses\THIRD_PARTY_FULL.txt` を同梱します。リリース前は配布相当の Python 環境で必ず再生成してください。

`setup-build-tools.bat` は `--config tauri.nvidia.windows.override.json` を自動で指定するため、**手動で `cargo tauri build` を実行する場合も必ずこのオプションを付ける**こと。

`setup-build-tools.bat` はビルド前に `src-tauri\target\release\_up_` を削除します。これは過去の dev / portable build で混入した `.venv312` や PyAV 系ファイルが staging に残る事故を避けるためです。

### NSIS フックについて

`src-tauri/nsis/nvidia-hooks.nsh`（Full 版）/ `editor-hooks.nsh`（Editor 版）が Tauri の NSIS インストーラーフックです。Lemonade のインストール促し・プロセス管理を担っていた `lemonade-hooks.nsh` は撤去済みです。公式インストーラーはローカルAIアプリ（LM Studio / Ollama）連携の選択ダイアログを表示しません。

`tauri.nvidia.windows.override.json` の `bundle.windows.nsis` ブロックは `tauri.conf.json` の同ブロックをシャロー上書きするため、`tauri.conf.json` 側の `installerHooks` 指定が失われる可能性があります。Windows 向け override の `nsis` ブロックを追加・変更する際は `installerHooks` を明示してください。

```json
"nsis": {
  "installerHooks": "nsis/nvidia-hooks.nsh",
  "languages": ["Japanese"],
  "displayLanguageSelector": false
}
```

### ローカルAIアプリ連携を有効にした専用ビルド

公式配布は `local-llm-apps` feature を付けず、LM Studio / Ollama 連携を常に無効にします。連携が必要な利用者は、ソースから専用インストーラーをビルドします。

```powershell
# Full CUDA版
npm.cmd run tauri:build:nvidia:local-llm-apps

# Editor版
npm.cmd run tauri:build:editor:local-llm-apps
```

直接実行する場合:

```powershell
cargo tauri build --bundles nsis --features local-llm-apps --config tauri.nvidia.windows.override.json
```

このfeatureは、既存のローカルAIアプリ接続コードとloopback制限を有効にするだけです。LM Studio / Ollama本体やモデルは同梱しません。接続先アプリの設定とデータの取り扱いはビルド・利用する人の責任で確認してください。専用ビルドは公式Releaseへ添付しません。

### インストーラーサイズ

`resources/llama-server/` に llama-server と CUDA DLL が含まれるため、インストーラーは約 1 GB 前後になります。将来的にはセットアップ UI からのポストインストールダウンロードに切り替える予定です。

NVIDIA版の同梱 llama.cpp と、Editor版・CPU版が後から取得するCPUバックエンドは **b10075** を使用します。`scripts/setup-dev.bat` はNVIDIA同梱版の既存 `llama-server.exe --version` を確認し、b10075以外なら同じ公式リリースのCUDAバイナリとCUDA 12.4ランタイムを再取得します。音声入力パックもCPUバックエンドのビルド番号を確認し、旧版ならb10075へ更新します。AMD版のダウンロード型ROCm / Vulkanバックエンドはb9631のまま維持します。

### インストール後の Python 環境（venv）

NSIS インストーラーには venv が含まれません。代わりに Python embeddable と `setup_venv_cli.py` を同梱し、初回起動後にセットアップ UI からパッケージをインストールします（詳細は前節「インストール後の Python 設定」参照）。

### リリース前チェックリスト

- [ ] `src-tauri/tauri.conf.json` の `version` をリリース番号に更新
- [ ] `scripts/setup-build-tools.bat` の `PYTHON_VERSION` が最新か確認
- [ ] `src-tauri/resources/ffmpeg/ffmpeg.exe` が LGPL build で、`--enable-gpl` を含まないことを確認
- [ ] `src-tauri/resources/ffmpeg/FFMPEG_BUILD_INFO.txt` と `LICENSE.txt` が生成されていることを確認
- [ ] `src-tauri/resources/llama-server/llama-server.exe --version` が `10075` で、CUDA 12.4公式アセット一式から配置されていることを確認
- [ ] `av` / `imageio-ffmpeg` が配布用 Python 環境に入っていないことを確認
- [ ] `scripts\verify_lgpl_ffmpeg_no_pyav.py` が配布用 Python 環境で pass することを確認
- [ ] `scripts\collect_licenses.py --venv .venv312 --frontend frontend --tauri src-tauri --out licenses` が実行され、`licenses\THIRD_PARTY_FULL.txt` が更新されていることを確認（「不明」が `licenses/manual/` でカバーされない項目を出していないこと）
- [ ] `LICENSE` / `NOTICE` / `THIRD_PARTY_LICENSES.md` / `licenses\`（`licenses\manual\` の CUDA EULA 含む）が Tauri resources に含まれ、インストール後に参照できることを確認
- [ ] `setup-build-tools.bat` でビルドが完走することを確認
- [ ] インストーラーを別 PC でテストインストールして動作確認

---

## 4. GitHub Release 公開手順

### 配布ファイル名

Tauri の出力名（`Local Transcription for Therapy_X.Y.Z_x64-setup.exe`）は空白・括弧を含み URL に不向きなため、
Release へのアップロード時に以下へリネームする（NSIS インストーラーはファイル名変更で動作に影響しない）。

| 配布ライン | アセット名 | 扱い |
| --- | --- | --- |
| Full CUDA 版 | `LoTT-vX.Y.Z-windows-x64-cuda-setup.exe` | 主配布（安定版） |
| Full AMD 版 | `LoTT-vX.Y.Z-windows-x64-rocm-setup.exe` | **pre-release**（experimental。安定版とリリースを分けるか、本文で experimental を明記） |
| CPU 版 | `LoTT-vX.Y.Z-windows-x64-cpu-setup.exe` | 動作確認・試用向け（常用非推奨） |
| Editor 版 | `LoTT-vX.Y.Z-windows-x64-editor-setup.exe` | 軽量版 |

- GitHub Release のアセット上限は 1 ファイル 2 GiB。llama-server 同梱の約 1GB インストーラーは添付可能
- AMD 版を同時に出す場合は、Release を分けて AMD 側を「Set as a pre-release」にするのが分かりやすい

### SHA256SUMS.txt の生成

アップロードする全アセットに対して生成し、Release に添付する（`sha256sum -c SHA256SUMS.txt` で検証可能な形式）。

```powershell
# リネーム後のアセットを置いたフォルダで
Get-FileHash *.exe -Algorithm SHA256 |
  ForEach-Object { "{0}  {1}" -f $_.Hash.ToLower(), (Split-Path $_.Path -Leaf) } |
  Set-Content SHA256SUMS.txt -Encoding ascii
```

### リリースノート

`docs/release-notes-template.md` を `release-notes-vX.Y.Z.md` としてコピーして記入し、Release 本文に貼り付ける。
v0.9.6 以降は、CPU版が試用向けである旨の注意書きを本文の末尾に残し、その後へ文章を追加しない。これにより、GitHub Release 画面で注意書きがインストーラー等のアセット一覧の直前に表示される。

### 公開後チェック

- [ ] アセット名がリネーム規約どおりか（空白・括弧が残っていないか）
- [ ] `SHA256SUMS.txt` のハッシュがアップロード済みアセットと一致するか（ダウンロードして `sha256sum -c` で確認）
- [ ] AMD 版が pre-release 扱いになっているか
- [ ] Release 本文に「初回セットアップ時のみインターネット接続が必要」「会話・音声データは PC 外へ送信しない」の注記があるか
- [ ] SmartScreen 警告についての案内（未署名の場合）が本文にあるか
- [ ] v0.9.6 以降では、CPU版が試用向けである旨の注意書きがRelease本文の最後（アセット一覧の直前）にあるか

---

## 3. 配布ラインと Tauri build override 一覧

Full 版は GPU ランタイム差分を同梱しやすくするため **CUDA 版** と **ROCm / AMD 版** を分けます。
PyTorch は CUDA build と ROCm build を同一 Python 環境に共存させる運用が難しいため、配布パッケージも runtime ごとに分離し、1つのパッケージへ両 runtime を同梱しません。

| override | 用途 |
| --- | --- |
| `tauri.nvidia.windows.override.json` | 安定版 / NVIDIA RTX 主軸 / Windows NSIS（`setup-build-tools.bat` が使用） |
| `tauri.nvidia.linux.override.json` | Full CUDA / Linux（deb + AppImage）。venv 非同梱・LLM ランタイム未同梱 |
| `tauri.amd.windows.override.json` | AMD / Windows NSIS ビルド用（詳細調整予定） |
| `tauri.amd.linux.override.json` | AMD experimental / ROCm・Vulkan llama-server 直起動検証用 / Linux（詳細調整予定） |
| `tauri.editor.windows.override.json` | 軽量 Editor 版 / Windows NSIS（LLM 校正ランタイム非搭載のため `nsis/editor-hooks.nsh` を使用） |
| `tauri.editor.linux.override.json` | 軽量 Editor 版 / Linux（deb + AppImage） |

CUDA 版・ROCm 版・Editor 版は `identifier` を分け、同一 PC に併存できます。

- CUDA: `net.gakkousya.lott`
- AMD: `net.gakkousya.lott-amd`
- Editor: `net.gakkousya.lott-editor`

Editor 版のビルド例:

```bat
:: Windows (NSIS)
cargo tauri build --bundles nsis --config tauri.editor.windows.override.json
```

```sh
# Linux (deb + AppImage)
cargo tauri build --bundles deb appimage --config tauri.editor.linux.override.json
```
