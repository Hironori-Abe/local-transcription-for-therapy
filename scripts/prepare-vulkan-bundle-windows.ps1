<#
.SYNOPSIS
    Vulkan 版インストーラーに同梱するもの（ggml エンジン・llama-server・最小限の Python）を用意する。

.DESCRIPTION
    scripts\setup-build-tools.bat --vulkan から呼ばれる。単独でも実行できる。

      powershell -ExecutionPolicy Bypass -File scripts\prepare-vulkan-bundle-windows.ps1 [-SkipEngines] [-SkipLlama] [-SkipPython]

    配置先（いずれも git 管理外）:
      src-tauri\resources\speech-engines\{whisper,nemo}\  whisper.cpp / NeMo-Speech.cpp の Vulkan 版（固定 commit からビルド）
      src-tauri\resources\llama-server-vulkan\            公式 llama.cpp b10075 Vulkan 版（SHA-256 検証）から llama-server に必要なファイルだけ
      src-tauri\resources\python312-vulkan\               Python 3.12 embeddable と、校正・暗号化保存・Gemma 取得に使うパッケージ

    - モデルは同梱しない（初回起動後にアプリのセットアップ画面から取得する）
    - VC++ ランタイム（MSVCP140 など）を各実行ファイルの隣へ置く。VC++ 再頒布パッケージが入っていない PC でも動かすため
    - ネットワークを使うのはこのビルド準備の時だけ

    前提: scripts\setup-ggml-speech-windows.ps1 と同じ（VS 2022 Build Tools、Git、LunarG Vulkan SDK）、Python 3.12（py -3.12）
#>
[CmdletBinding()]
param(
    [switch]$SkipEngines,
    [switch]$SkipLlama,
    [switch]$SkipPython
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Resources = Join-Path $RepoRoot 'src-tauri\resources'
$EnginesDir = Join-Path $Resources 'speech-engines'
$LlamaDir = Join-Path $Resources 'llama-server-vulkan'
$PythonDir = Join-Path $Resources 'python312-vulkan'
$Work = Join-Path $env:LOCALAPPDATA 'lott-ggml-speech-build'

# 公式 llama.cpp b10075 Vulkan 版（CUDA 版の同梱・CPU 版と同じビルド番号）
$LlamaBuild = 'b10075'
$LlamaZipUrl = "https://github.com/ggml-org/llama.cpp/releases/download/$LlamaBuild/llama-$LlamaBuild-bin-win-vulkan-x64.zip"
$LlamaZipSha = '763A46CF514443D597E7DC04330012D4E401E40CDB4D61AF1FB6145909AD41AE'
# llama-server が読み込むもの（dumpbin /dependents で確認）。ggml-cpu-*.dll は CPU に合わせて実行時に選ばれる
$LlamaFiles = @('llama-server.exe', 'llama-server-impl.dll', 'llama-common.dll', 'llama.dll', 'mtmd.dll',
    'ggml.dll', 'ggml-base.dll', 'ggml-vulkan.dll', 'libomp140.x86_64.dll')

$PythonVersion = '3.12.10'
$PythonZipUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"

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

# ---- 2. llama-server（公式 Vulkan 版） ------------------------------------------
if (-not $SkipLlama) {
    Log "llama.cpp $LlamaBuild Vulkan 版を取得"
    $cache = Join-Path $Work "llama-$LlamaBuild-bin-win-vulkan-x64.zip"
    New-Item -ItemType Directory -Force $Work | Out-Null
    if (-not (Test-Path $cache) -or (Get-FileHash -Algorithm SHA256 $cache).Hash -ne $LlamaZipSha) {
        Get-File $LlamaZipUrl "$cache.partial"
        if ((Get-FileHash -Algorithm SHA256 "$cache.partial").Hash -ne $LlamaZipSha) {
            Remove-Item -Force "$cache.partial"
            throw 'llama.cpp の zip の SHA-256 が一致しません。'
        }
        Move-Item -Force "$cache.partial" $cache
    }
    $extract = Join-Path $Work "llama-$LlamaBuild-vulkan-extract"
    if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
    Expand-Archive -Path $cache -DestinationPath $extract
    $tmp = "$LlamaDir.tmp"
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    New-Item -ItemType Directory -Force $tmp | Out-Null
    foreach ($name in $LlamaFiles) {
        $src = Join-Path $extract $name
        if (-not (Test-Path $src)) { throw "llama.cpp の zip に $name がありません。" }
        Copy-Item $src $tmp
    }
    Copy-Item (Join-Path $extract 'ggml-cpu-*.dll') $tmp
    Copy-VcRuntime $tmp
    Set-Content -Path (Join-Path $tmp 'LLAMA_CPP_BUILD_INFO.txt') -Encoding utf8 `
        -Value "source_tag=$LlamaBuild`nasset=llama-$LlamaBuild-bin-win-vulkan-x64.zip`nsha256=$LlamaZipSha`nbackend=vulkan"
    if (Test-Path $LlamaDir) { Remove-Item -Recurse -Force $LlamaDir }
    Move-Item $tmp $LlamaDir
    Remove-Item -Recurse -Force $extract
}

# ---- 3. Python（校正・暗号化保存・Gemma 取得用の最小構成） ----------------------
if (-not $SkipPython) {
    Log "Python $PythonVersion embeddable と最小限のパッケージを配置"
    $tmp = "$PythonDir.tmp"
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    New-Item -ItemType Directory -Force $tmp | Out-Null
    $zip = Join-Path $Work "python-$PythonVersion-embed-amd64.zip"
    if (-not (Test-Path $zip)) { Get-File $PythonZipUrl $zip }
    Expand-Archive -Path $zip -DestinationPath $tmp
    # site-packages を使えるようにする（BOM を付けると python312.zip の解決に失敗する）
    $pth = Join-Path $tmp 'python312._pth'
    $lines = [IO.File]::ReadAllLines($pth) -replace '^#import site$', 'import site'
    [IO.File]::WriteAllLines($pth, $lines, [Text.UTF8Encoding]::new($false))
    # 配布先の Python 3.12 / Windows x64 向けの wheel だけを入れる（ビルド PC の環境に左右されない）
    $site = Join-Path $tmp 'Lib\site-packages'
    New-Item -ItemType Directory -Force $site | Out-Null
    & py -3.12 -m pip install --disable-pip-version-check --no-compile --only-binary=:all: `
        --platform win_amd64 --python-version 3.12 --implementation cp `
        --target $site -r (Join-Path $RepoRoot 'python_sidecar\requirements-vulkan.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Python パッケージの導入に失敗しました（py -3.12 が必要です）。' }
    if (Test-Path $PythonDir) { Remove-Item -Recurse -Force $PythonDir }
    Move-Item $tmp $PythonDir
}

Log '完了'
foreach ($dir in $EnginesDir, $LlamaDir, $PythonDir) {
    if (Test-Path $dir) {
        $size = (Get-ChildItem -Recurse -File $dir | Measure-Object Length -Sum).Sum / 1MB
        Log ('{0}: {1:N0} MB' -f $dir, $size)
    }
}
