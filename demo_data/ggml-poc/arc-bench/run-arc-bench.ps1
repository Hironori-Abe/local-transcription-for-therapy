<#
.SYNOPSIS
    Intel Arc などの Vulkan GPU で、ggml 音声エンジンと llama-server（校正）を計測する。

.DESCRIPTION
    powershell -ExecutionPolicy Bypass -File demo_data\ggml-poc\arc-bench\run-arc-bench.ps1 [-Device N] [-Quick] [-SkipBuild]

    1. whisper.cpp / NeMo-Speech.cpp の Vulkan 版をビルドし、モデルを取得する（scripts\setup-ggml-speech-windows.ps1）
       配置先はこのフォルダの engines\（アプリの python_sidecar\speech-engines は変更しない）
    2. 公式 llama.cpp b10075 Vulkan 版を取得し、SHA-256 を検証する
    3. bench.py で計測し、results\<日時>\results.md に RTX 4060 の値と並べた表を書く

    ネットワークを使うのは 1・2 の取得時だけ。計測中の通信は無い（llama-server は 127.0.0.1 のみ）。
    前提: VS 2022 Build Tools（C++）、Git、Python 3、LunarG Vulkan SDK（無ければ winget install KhronosGroup.VulkanSDK）
#>
[CmdletBinding()]
param(
    [int]$Device = -1,
    [switch]$Quick,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$Repo = (Resolve-Path (Join-Path $Here '..\..\..')).Path
$Engines = Join-Path $Here 'engines'
$LlamaDir = Join-Path $Here 'llama-vulkan-b10075'
$LlamaZipUrl = 'https://github.com/ggml-org/llama.cpp/releases/download/b10075/llama-b10075-bin-win-vulkan-x64.zip'
$LlamaZipSha = '763A46CF514443D597E7DC04330012D4E401E40CDB4D61AF1FB6145909AD41AE'

function Log([string]$m) { Write-Host "[arc-bench] $m" }

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw 'python が見つかりません。Python 3 を導入してください。' }

if (-not $SkipBuild -or -not (Test-Path (Join-Path $Engines 'nemo\bin\nemo-speech.exe'))) {
    Log 'Vulkan 版のビルドとモデル取得'
    & powershell -ExecutionPolicy Bypass -File (Join-Path $Repo 'scripts\setup-ggml-speech-windows.ps1') -Backend vulkan -EnginesDir $Engines
    if ($LASTEXITCODE -ne 0) { throw 'セットアップに失敗しました。上のログを確認してください。' }
}

$llama = Join-Path $LlamaDir 'llama-server.exe'
if (-not (Test-Path $llama)) {
    Log 'llama.cpp b10075 Vulkan 版を取得'
    New-Item -ItemType Directory -Force $LlamaDir | Out-Null
    $zip = Join-Path $LlamaDir 'llama-vulkan.zip'
    & curl.exe -fL --retry 3 -o $zip $LlamaZipUrl
    if ($LASTEXITCODE -ne 0) { throw "ダウンロードに失敗しました: $LlamaZipUrl" }
    if ((Get-FileHash -Algorithm SHA256 $zip).Hash -ne $LlamaZipSha) {
        Remove-Item -Force $zip
        throw 'llama.cpp の zip の SHA-256 が一致しません。'
    }
    Expand-Archive -Force $zip $LlamaDir
    Remove-Item -Force $zip
}

$benchArgs = @((Join-Path $Here 'bench.py'), '--engines', $Engines, '--llama', $llama)
if ($Device -ge 0) { $benchArgs += @('--device', "$Device") }
if ($Quick) { $benchArgs += '--quick' }
& $python.Source @benchArgs
if ($LASTEXITCODE -ne 0) { throw '計測に失敗しました。' }
