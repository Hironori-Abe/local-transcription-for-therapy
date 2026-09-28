<#
.SYNOPSIS
    Vulkan 版インストーラーに同梱する音声 ggml エンジンと、ビルド用の Python を用意する。

.DESCRIPTION
    scripts\setup-build-tools.bat --vulkan から呼ばれる。単独でも実行できる。

      powershell -ExecutionPolicy Bypass -File scripts\prepare-vulkan-bundle-windows.ps1 [-SkipEngines] [-SkipPython]

    配置先（いずれも git 管理外）:
      src-tauri\resources\speech-engines\{whisper,nemo}\  whisper.cpp / NeMo-Speech.cpp の Vulkan 版（固定 commit からビルド）
      %LOCALAPPDATA%\lott-ggml-speech-build\python-<版>-build\  ビルド用の Python 3.12 embeddable（同梱しない）

    - Vulkan 版は LLM / Python を同梱しない。句読点付与はローカルルールを使い、暗号化保存・モデル取得は Rust で行う。
      ビルド用の Python は setup-build-tools.bat が ffmpeg 取得・ライセンス収集・成果物整理に使う（標準ライブラリのみ）
    - モデルは同梱しない（初回起動後にアプリのセットアップ画面から取得する）
    - VC++ ランタイム（MSVCP140 など）を各実行ファイルの隣へ置く。VC++ 再頒布パッケージが入っていない PC でも動かすため
    - ネットワークを使うのはこのビルド準備の時だけ

    前提: scripts\setup-ggml-speech-windows.ps1 と同じ（VS 2022 Build Tools、Git、LunarG Vulkan SDK）
#>
[CmdletBinding()]
param(
    [switch]$SkipEngines,
    [switch]$SkipPython
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Resources = Join-Path $RepoRoot 'src-tauri\resources'
$EnginesDir = Join-Path $Resources 'speech-engines'
$Work = Join-Path $env:LOCALAPPDATA 'lott-ggml-speech-build'
# 旧版で同梱していた Python（v0.9.9 開発中まで）。残っていれば消す
$LegacyPythonDir = Join-Path $Resources 'python312-vulkan'
$LegacyLlamaDir = Join-Path $Resources 'llama-server-vulkan'

$PythonVersion = '3.12.10'
$PythonZipUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
# setup-build-tools.bat がこのパスを参照する。変えるときは両方を直す
$BuildPythonDir = Join-Path $Work "python-$PythonVersion-build"

function Log([string]$Message) { Write-Host "[vulkan-bundle] $Message" }

function Get-File([string]$Url, [string]$Dest) {
    & curl.exe -fL --retry 3 --retry-delay 5 -o $Dest $Url
    if ($LASTEXITCODE -ne 0) { throw "ダウンロードに失敗しました: $Url" }
}

# VS Build Tools に入っている VC++ ランタイム（再頒布可能ファイル）の場所
function Get-VcRedistDirs {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) { throw 'vswhere.exe が見つかりません。Visual Studio 2022 Build Tools を導入してください。' }
    $vs = & $vswhere -latest -products * -property installationPath
    $redist = Get-ChildItem (Join-Path $vs 'VC\Redist\MSVC') -Directory |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
    if (-not $redist) { throw 'VC++ 再頒布ファイル（VC\Redist\MSVC）が見つかりません。' }
    $crt = Get-ChildItem (Join-Path $redist.FullName 'x64') -Directory -Filter 'Microsoft.VC*.CRT' | Select-Object -First 1
    $omp = Get-ChildItem (Join-Path $redist.FullName 'x64') -Directory -Filter 'Microsoft.VC*.OpenMP' | Select-Object -First 1
    if (-not $crt -or -not $omp) { throw "VC++ ランタイムが見つかりません: $($redist.FullName)\x64" }
    return @($crt.FullName, $omp.FullName)
}

function Copy-VcRuntime([string]$Dest) {
    foreach ($dir in (Get-VcRedistDirs)) {
        Copy-Item (Join-Path $dir '*.dll') $Dest -Force
    }
}

# ---- 1. whisper.cpp / NeMo-Speech.cpp（Vulkan） ---------------------------------
if (-not $SkipEngines) {
    Log 'ggml エンジン（Vulkan）をビルドして同梱先へ配置'
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'setup-ggml-speech-windows.ps1') `
        -Backend vulkan -EnginesDir $EnginesDir -SkipModels
    if ($LASTEXITCODE -ne 0) { throw 'ggml エンジンのビルドに失敗しました。' }
    foreach ($engine in 'whisper', 'nemo') {
        Copy-VcRuntime (Join-Path $EnginesDir "$engine\bin")
    }
}

# ---- 2. ビルド用 Python（同梱しない。標準ライブラリのみ） ------------------------
if (Test-Path $LegacyLlamaDir) {
    Log "旧版で同梱していた $LegacyLlamaDir を削除"
    Remove-Item -Recurse -Force $LegacyLlamaDir
}
if (Test-Path $LegacyPythonDir) {
    Log "旧版で同梱していた $LegacyPythonDir を削除"
    Remove-Item -Recurse -Force $LegacyPythonDir
}
if (-not $SkipPython -and -not (Test-Path (Join-Path $BuildPythonDir 'python.exe'))) {
    Log "ビルド用 Python $PythonVersion embeddable を配置: $BuildPythonDir"
    $tmp = "$BuildPythonDir.tmp"
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    New-Item -ItemType Directory -Force $tmp | Out-Null
    $zip = Join-Path $Work "python-$PythonVersion-embed-amd64.zip"
    if (-not (Test-Path $zip)) { Get-File $PythonZipUrl $zip }
    Expand-Archive -Path $zip -DestinationPath $tmp
    Move-Item $tmp $BuildPythonDir
}

Log '完了'
if (Test-Path $EnginesDir) {
    $size = (Get-ChildItem -Recurse -File $EnginesDir | Measure-Object Length -Sum).Sum / 1MB
    Log ('{0}: {1:N0} MB' -f $EnginesDir, $size)
}
