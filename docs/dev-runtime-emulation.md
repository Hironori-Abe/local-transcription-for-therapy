# Dev Runtime Emulation

このドキュメントは、開発機で実行時条件を擬似再現する方法をまとめたものです。

## 基本方針

排他モードとして、次の 1 変数で切り替えます。

- `RUN_DEV_EMULATION_MODE`
  - `none`
  - `no_cuda`
  - `missing_community1`

`scripts/run-dev.bat` 実行時に、内部では `OFFLINE_TRANSCRIBER_DEV_EMULATION_MODE` に引き継がれます。

## 1. CUDA なし環境をエミュレート

PowerShell:

```powershell
$env:RUN_DEV_EMULATION_MODE="no_cuda"
.\scripts\run-dev.bat
```

## 2. CUDA はあるが community-1 が未配置の環境をエミュレート

PowerShell:

```powershell
$env:RUN_DEV_EMULATION_MODE="missing_community1"
.\scripts\run-dev.bat
```

## 3. エミュレーション無しで起動

PowerShell:

```powershell
$env:RUN_DEV_EMULATION_MODE="none"
.\scripts\run-dev.bat
```

## 4. 解除

PowerShell:

```powershell
Remove-Item Env:RUN_DEV_EMULATION_MODE -ErrorAction SilentlyContinue
Remove-Item Env:OFFLINE_TRANSCRIBER_DEV_EMULATION_MODE -ErrorAction SilentlyContinue
```

## 状態の保存先

- 起動時の env 保存ファイル:
  - `.dev-runtime-emulation.env`
- UI 側の設定保存（localStorage）:
  - key: `offline_transcriber_app_settings_v1`
  - field: `devEmulation`
    - `mode` (`none` / `no_cuda` / `missing_community1`)
    - `noCuda`
    - `missingCommunity1`
    - `capturedAt`
