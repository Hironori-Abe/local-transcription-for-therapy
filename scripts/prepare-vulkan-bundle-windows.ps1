<#
.SYNOPSIS
    Vulkan 版インストーラーに同梱する音声 ggml エンジンと、ビルド用の Python を用意する。

.DESCRIPTION
    scripts\setup-build-tools.bat --vulkan から呼ばれる。単独でも実行できる。

      powershell -ExecutionPolicy Bypass -File scripts\prepare-vulkan-bundle-windows.ps1 [-SkipEngines] [-SkipPython] [-WhisperOnly]

    配置先（いずれも git 管理外）:
      src-tauri\resources\speech-engines\{whisper,nemo}\  whisper.cpp / NeMo-Speech.cpp の Vulkan 版（固定 commit からビルド）
      %LOCALAPPDATA%\lott-ggml-speech-build\python-<版>-build\  ビルド用の Python 3.12 embeddable（同梱しない）

    - Vulkan / Editor 版は LLM / Python を同梱しない。Editor は Whisper のみ、Vulkan は Whisper と NeMo を同梱する。
      ビルド用の Python は setup-build-tools.bat がライセンス収集・成果物整理に使う（標準ライブラリのみ）
    - モデルは同梱しない（初回起動後にアプリのセットアップ画面から取得する）
    - VC++ ランタイム（MSVCP140 など）を各実行ファイルの隣へ置く。VC++ 再頒布パッケージが入っていない PC でも動かすため
    - ネットワークを使うのはこのビルド準備の時だけ

    前提: scripts\setup-ggml-speech-windows.ps1 と同じ（VS 2022 Build Tools、Git、LunarG Vulkan SDK）
#>
[CmdletBinding()]
param(
    [switch]$SkipEngines,
    [switch]$SkipPython,
    [switch]$WhisperOnly
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

# Vulkan ローダー（vulkan-1.dll）。GPU ドライバーが無い PC では System32 に無いため、
# アプリが PATH 経由で同梱コピーを使う。エンジン exe の隣には置かない（新しいシステム側ローダーを隠すため）
$VulkanRuntimeVersion = '1.4.357.0'
$VulkanRuntimeSha256 = 'a14672efed15aafc7f5a16572d35cd3a3416eadf670aeee3cdf50ee32d5fbf83'
$VulkanRuntimeUrl = "https://sdk.lunarg.com/sdk/download/$VulkanRuntimeVersion/windows/VulkanRT-X64-$VulkanRuntimeVersion-Components.zip"
$VulkanLoaderDir = Join-Path $EnginesDir 'vulkan-loader'

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
    $engineLabel = if ($WhisperOnly) { 'whisper.cpp（Vulkan）' } else { 'whisper.cpp / NeMo-Speech.cpp（Vulkan）' }
    Log "ggml エンジン $engineLabel をビルドして同梱先へ配置"
    $buildArgs = @('-Backend', 'vulkan', '-EnginesDir', $EnginesDir, '-SkipModels')
    if ($WhisperOnly) { $buildArgs += '-SkipNemo' }
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'setup-ggml-speech-windows.ps1') @buildArgs
    if ($LASTEXITCODE -ne 0) { throw 'ggml エンジンのビルドに失敗しました。' }
    $enginesToCopy = @('whisper', 'nemo')
    if ($WhisperOnly) { $enginesToCopy = @('whisper') }
    foreach ($engine in $enginesToCopy) {
        Copy-VcRuntime (Join-Path $EnginesDir "$engine\bin")
    }
}

# ---- 1b. Vulkan ローダー（LunarG 公式 Runtime。-SkipEngines でも配置する） ----------
function Install-VulkanLoader {
    New-Item -ItemType Directory -Force $Work | Out-Null
    $zip = Join-Path $Work "VulkanRT-X64-$VulkanRuntimeVersion-Components.zip"
    if (-not (Test-Path $zip)) {
        Log "Vulkan Runtime $VulkanRuntimeVersion を取得: $VulkanRuntimeUrl"
        Get-File $VulkanRuntimeUrl $zip
    }
    $actual = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
    if ($actual -ne $VulkanRuntimeSha256) {
        Remove-Item -Force $zip
        throw "Vulkan Runtime の SHA-256 が一致しません（期待 $VulkanRuntimeSha256 / 実際 $actual）。キャッシュを削除しました。"
    }
    $extract = Join-Path $Work "VulkanRT-$VulkanRuntimeVersion-extract"
    if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
    Expand-Archive -Path $zip -DestinationPath $extract
    $root = Join-Path $extract "VulkanRT-X64-$VulkanRuntimeVersion-Components"
    $dll = Join-Path $root 'x64\vulkan-1.dll'
    $license = Join-Path $root 'VulkanRT-License.txt'
    if (-not (Test-Path $dll) -or -not (Test-Path $license)) { throw 'Vulkan Runtime zip に x64\vulkan-1.dll / VulkanRT-License.txt がありません。' }
    if (Test-Path $VulkanLoaderDir) { Remove-Item -Recurse -Force $VulkanLoaderDir }
    New-Item -ItemType Directory -Force $VulkanLoaderDir | Out-Null
    Copy-Item $dll (Join-Path $VulkanLoaderDir 'vulkan-1.dll')
    Copy-Item $license (Join-Path $VulkanLoaderDir 'LICENSE-Vulkan-Loader.txt')
    $info = @(
        'Vulkan Loader (vulkan-1.dll, x64) - LunarG Vulkan Runtime redistributable',
        "Version: $VulkanRuntimeVersion",
        "Source: $VulkanRuntimeUrl",
        "SHA-256 (zip): $VulkanRuntimeSha256",
        'License: Apache-2.0 (see LICENSE-Vulkan-Loader.txt)'
    ) -join "`r`n"
    [System.IO.File]::WriteAllText((Join-Path $VulkanLoaderDir 'BUILD_INFO.txt'), $info + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
    Remove-Item -Recurse -Force $extract
    Log "Vulkan ローダーを配置: $VulkanLoaderDir"
}
Install-VulkanLoader

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
