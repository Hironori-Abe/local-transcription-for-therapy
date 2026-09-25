<#
.SYNOPSIS
    ggml 音声エンジン（whisper.cpp + NeMo-Speech.cpp / Nemotron-3-Diarization）を Windows の開発環境へ準備する。

.DESCRIPTION
    scripts/setup-ggml-speech-linux.sh の Windows 版。

      powershell -ExecutionPolicy Bypass -File scripts\setup-ggml-speech-windows.ps1 [-Backend vulkan|cuda|cpu] [-CudaArch 89] [-SkipBuild] [-SkipModels]

    - 固定 commit からソースビルドし、python_sidecar\speech-engines\<engine>\ へ配置する
    - モデルは固定 revision から取得し、SHA-256 を検証して python_sidecar\models\ へ配置する
    - ネットワークを使うのはこのセットアップ時だけ。アプリの実行時は通信しない
    - NeMo-Speech.cpp の scripts\windows\build.ps1 は使わない。PATH をレジストリから読み直すため、
      PATH に引用符入りのエントリ（例: `...\CUDA\v12.9\bin" `）があると vcvars64.bat が
      「\Microsoft was unexpected at this time.」で失敗する。本スクリプトはプロセス内で PATH を整形してから
      同じ手順（vcvars → vcpkg(sentencepiece) → ggml パッチ → cmake）を行う
    - CUDA 版は cudart / cuBLAS の DLL を実行ファイルの隣へコピーする（PATH 上の CUDA に依存しない）

    前提: Visual Studio 2022 Build Tools（C++、同梱 CMake / Ninja を使用）、Git、
          CUDA Toolkit 12.x（-Backend cuda）、LunarG Vulkan SDK（-Backend vulkan）
#>
[CmdletBinding()]
param(
    [ValidateSet('cuda', 'vulkan', 'cpu')]
    # 既定は Vulkan（NVIDIA / AMD / Intel 共通。AGENTS.md Distribution Strategy）。cuda は比較・切り分け用
    [string]$Backend = 'vulkan',
    # 手元の GPU 用。配布ビルドでは対象 GPU 世代を並べる（例: "75;86;89;120"）
    [string]$CudaArch = 'native',
    [switch]$SkipBuild,
    [switch]$SkipModels,
    [int]$Jobs = 0,
    # 配置先（既定はアプリが読む python_sidecar\speech-engines）。バックエンドを並べて比較するときに変える
    [string]$EnginesDir
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $EnginesDir) { $EnginesDir = Join-Path $RepoRoot 'python_sidecar\speech-engines' }
# SDK の導入直後は、開いているシェルに VULKAN_SDK が反映されていない
if (-not $env:VULKAN_SDK) {
    $vk = [Environment]::GetEnvironmentVariable('VULKAN_SDK', 'Machine')
    if (-not $vk) { $vk = [Environment]::GetEnvironmentVariable('VULKAN_SDK', 'User') }
    if ($vk) { $env:VULKAN_SDK = $vk }
}
$ModelsDir = Join-Path $RepoRoot 'python_sidecar\models'
$Work = Join-Path $env:LOCALAPPDATA 'lott-ggml-speech-build'
$Logs = Join-Path $Work 'logs'
if ($Jobs -le 0) { $Jobs = [Environment]::ProcessorCount }

# ---- 固定バージョン（Linux 版と同じ） ------------------------------------------
$WhisperCppRepo = 'https://github.com/ggml-org/whisper.cpp.git'
$WhisperCppCommit = 'd09f61a708f3487afa956ff578e60eae5e7a233c'
$NemoSpeechRepo = 'https://github.com/NVIDIA/NeMo-Speech.cpp.git'
$NemoSpeechCommit = '97a15afa5caa9bce5baaa86c1184103877af4101'
# NeMo-Speech.cpp の vcpkg.json の builtin-baseline と同じ（sentencepiece の取得に使う）
$VcpkgRepo = 'https://github.com/microsoft/vcpkg.git'
$VcpkgCommit = '9e593bb18ea69cc5095e012465dcd675a822ed0d' # 2026.07.29

# 配置先相対パス | URL | SHA-256
$Models = @(
    'whisper-ggml\ggml-large-v3-turbo.bin|https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo.bin|1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69'
    'whisper-ggml\ggml-silero-v6.2.0.bin|https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin|2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987'
    'nemotron-3-diarization\Nemotron-3-Diarization.q8_0.gguf|https://huggingface.co/nvidia/Nemotron-3-Diarization/resolve/f667ed73aee57d40cc39428eb768b4fd87a0a29e/Nemotron-3-Diarization.q8_0.gguf|08456d9e22cd9a323c0364d98375f3746d6e68507ebb705cd46438c534c7a3a1'
)

function Log([string]$Message) { Write-Host "[ggml-speech] $Message" }

# ネイティブコマンドを実行し、出力を UTF-8 でログへ追記する。
# Windows PowerShell 5.1 は Stop のままだと stderr への出力だけで例外にするため、ここでは Continue にして終了コードで判定する。
function Invoke-Native {
    param([string]$LogFile, [string]$Exe, [string[]]$Arguments)
    $ErrorActionPreference = 'Continue'
    "> $Exe $($Arguments -join ' ')" | Out-File -Append -Encoding utf8 $LogFile
    & $Exe @Arguments 2>&1 | ForEach-Object { "$_" } | Out-File -Append -Encoding utf8 $LogFile
    if ($LASTEXITCODE -ne 0) { throw "$Exe が失敗しました（exit=$LASTEXITCODE）。ログ: $LogFile" }
}

# 引用符や空要素を取り除いた PATH にする（vcvars64.bat を壊さないため。このプロセス内だけ）
function Repair-ProcessPath {
    $entries = $env:Path -split ';' | ForEach-Object { $_.Replace('"', '').Trim() } | Where-Object { $_ }
    $env:Path = ($entries | Select-Object -Unique) -join ';'
}

function Import-MsvcEnvironment {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path $vswhere)) { throw 'vswhere が見つかりません。Visual Studio 2022 Build Tools（C++）を導入してください。' }
    $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $vsPath) { throw 'C++ ツールセット入りの Visual Studio が見つかりません。' }
    $vcvars = Join-Path $vsPath 'VC\Auxiliary\Build\vcvars64.bat'
    Log "MSVC 環境を取り込み: $vsPath"
    $lines = cmd /c "`"$vcvars`" >NUL 2>&1 && set"
    if ($LASTEXITCODE -ne 0) { throw "vcvars64.bat の実行に失敗しました: $vcvars" }
    foreach ($line in $lines) {
        if ($line -match '^([^=]+)=(.*)$') { Set-Item -Path "env:$($matches[1])" -Value $matches[2] }
    }
    Repair-ProcessPath
    foreach ($tool in 'cl', 'cmake', 'ninja', 'git') {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool が見つかりません（MSVC 環境の取り込み後）。" }
    }
}

function Sync-Checkout {
    param([string]$Name, [string]$Repo, [string]$Commit)
    $dir = Join-Path $Work "src\$Name"
    if (-not (Test-Path (Join-Path $dir '.git'))) {
        Log "取得: $Name"
        & git clone --quiet $Repo $dir
        if ($LASTEXITCODE -ne 0) { throw "git clone に失敗しました: $Repo" }
    }
    $head = & git -C $dir rev-parse HEAD
    if ($head -ne $Commit) {
        & git -C $dir fetch --quiet origin $Commit
        if ($LASTEXITCODE -ne 0) { & git -C $dir fetch --quiet origin }
        & git -C $dir checkout --quiet --detach $Commit
        if ($LASTEXITCODE -ne 0) { throw "$Name を $Commit に切り替えられませんでした。" }
    }
    return $dir
}

function Copy-CudaRuntime([string]$Dest) {
    if ($Backend -ne 'cuda') { return }
    $cudaBin = Join-Path $env:CUDA_PATH 'bin'
    foreach ($pattern in 'cudart64_*.dll', 'cublas64_*.dll', 'cublasLt64_*.dll') {
        $found = @(Get-ChildItem -Path $cudaBin -Filter $pattern -File)
        if ($found.Count -eq 0) { throw "CUDA ランタイムが見つかりません: $cudaBin\$pattern" }
        $found | Copy-Item -Destination $Dest
    }
}

# 生成物を一時ディレクトリへ組み立ててから差し替える（途中失敗で既存の配置を壊さない）
function Publish-Engine([string]$Name, [scriptblock]$Fill) {
    $dest = Join-Path $EnginesDir $Name
    $tmp = "$dest.tmp"
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    New-Item -ItemType Directory -Force (Join-Path $tmp 'bin') | Out-Null
    & $Fill $tmp
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Move-Item $tmp $dest
}

# LoTT 独自パッチ（Windows で日本語などを含むモデルパスを開けるようにする）を当てる。適用済みなら何もしない。
function Install-LottPatches([string]$Src, [string]$Filter) {
    foreach ($patch in Get-ChildItem -Path (Join-Path $PSScriptRoot 'patches') -Filter $Filter -File) {
        $ErrorActionPreference = 'Continue'
        & git -C $Src apply --reverse --check --ignore-whitespace $patch.FullName 2>$null
        if ($LASTEXITCODE -ne 0) {
            Log "LoTT パッチ適用: $($patch.Name)"
            & git -C $Src apply --ignore-whitespace $patch.FullName
            if ($LASTEXITCODE -ne 0) { throw "パッチを適用できませんでした: $($patch.FullName)" }
        }
        $ErrorActionPreference = 'Stop'
    }
}

function Build-Whisper {
    $src = Sync-Checkout 'whisper.cpp' $WhisperCppRepo $WhisperCppCommit
    Install-LottPatches $src 'whisper-cpp-*.patch'
    $build = Join-Path $Work "build\whisper-$Backend"
    $log = Join-Path $Logs "whisper-$Backend.log"
    Set-Content -Path $log -Value "" -Encoding utf8
    Log "ビルド: whisper.cpp（$Backend、静的リンク）"
    $cmakeArgs = @('-S', $src, '-B', $build, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
        '-DBUILD_SHARED_LIBS=OFF', '-DGGML_NATIVE=OFF', '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_BUILD_SERVER=OFF')
    switch ($Backend) {
        'cuda' { $cmakeArgs += '-DGGML_CUDA=ON'; $cmakeArgs += "-DCMAKE_CUDA_ARCHITECTURES=$CudaArch" }
        'vulkan' {
            if (-not $env:VULKAN_SDK) { throw 'VULKAN_SDK が未設定です。LunarG Vulkan SDK を導入してください。' }
            # ggml-vulkan は SPIRV-Headers の CMake パッケージを必須とする（SDK 同梱だが既定の探索先に無い）
            $cmakeArgs += @('-DGGML_VULKAN=ON', "-DSPIRV-Headers_DIR=$env:VULKAN_SDK\Lib\cmake\SPIRV-Headers")
        }
    }
    Invoke-Native $log cmake $cmakeArgs
    Invoke-Native $log cmake @('--build', $build, '-j', $Jobs, '--target', 'whisper-cli')
    Publish-Engine 'whisper' {
        param($dir)
        Copy-Item (Join-Path $build 'bin\whisper-cli.exe') (Join-Path $dir 'bin')
        Copy-CudaRuntime (Join-Path $dir 'bin')
        Copy-Item (Join-Path $src 'LICENSE') (Join-Path $dir 'LICENSE-whisper.cpp.txt')
        Set-Content -Path (Join-Path $dir 'BUILD_INFO.txt') -Encoding utf8 `
            -Value "whisper.cpp $WhisperCppCommit`nbackend $Backend`ncuda-arch $CudaArch"
    }
}

function Initialize-Vcpkg {
    $root = Join-Path $Work 'vcpkg'
    if (-not (Test-Path (Join-Path $root '.git'))) {
        Log '取得: vcpkg'
        & git clone --quiet $VcpkgRepo $root
        if ($LASTEXITCODE -ne 0) { throw 'vcpkg の取得に失敗しました。' }
    }
    if ((& git -C $root rev-parse HEAD) -ne $VcpkgCommit) {
        & git -C $root fetch --quiet origin $VcpkgCommit
        & git -C $root checkout --quiet --detach $VcpkgCommit
        if ($LASTEXITCODE -ne 0) { throw "vcpkg を $VcpkgCommit に切り替えられませんでした。" }
        Remove-Item -Force (Join-Path $root 'vcpkg.exe') -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path (Join-Path $root 'vcpkg.exe'))) {
        Log 'ビルド: vcpkg'
        & (Join-Path $root 'bootstrap-vcpkg.bat') -disableMetrics *>> (Join-Path $Logs 'vcpkg.log')
        if ($LASTEXITCODE -ne 0) { throw 'vcpkg の bootstrap に失敗しました。' }
    }
    $env:VCPKG_ROOT = $root
    $env:VCPKG_DISABLE_METRICS = '1'
    return $root
}

function Build-Nemo {
    $src = Sync-Checkout 'NeMo-Speech.cpp' $NemoSpeechRepo $NemoSpeechCommit
    & git -C $src submodule update --init --quiet ggml
    if ($LASTEXITCODE -ne 0) { throw 'ggml サブモジュールの取得に失敗しました。' }
    $vcpkgRoot = Initialize-Vcpkg
    $build = Join-Path $Work "build\nemo-$Backend"
    $log = Join-Path $Logs "nemo-$Backend.log"
    Set-Content -Path $log -Value "" -Encoding utf8
    Install-LottPatches $src 'nemo-speech-*.patch'
    if ($Backend -eq 'cuda') {
        Log 'ggml パッチ適用（CUDA）'
        Invoke-Native $log powershell @('-ExecutionPolicy', 'Bypass', '-File', (Join-Path $src 'scripts\windows\apply-ggml-patches.ps1'))
    }
    Log "ビルド: NeMo-Speech.cpp（$Backend-diar）"
    # 話者分離のみ（Linux の <backend>-diar プリセット相当）。sentencepiece は vcpkg の asr feature で静的リンク。
    $cmakeArgs = @('-S', $src, '-B', $build, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
        '-DNEMO_SPEECH_BUILD_ASR=OFF', '-DNEMO_SPEECH_BUILD_DIAR=ON', '-DNEMO_SPEECH_BUILD_TTS=OFF',
        '-DNEMO_SPEECH_BUILD_NMT=OFF', '-DNEMO_SPEECH_WITH_NMT=OFF', '-DNEMO_SPEECH_BUILD_HTTP=OFF',
        '-DNEMO_SPEECH_BUILD_GRPC=OFF', '-DNEMO_SPEECH_WITH_GRPC=OFF', '-DNEMO_SPEECH_WITH_NORM=OFF',
        '-DNEMO_SPEECH_BUILD_TESTS=OFF', '-DBUILD_TESTING=OFF', '-DNEMO_SPEECH_BUILD_EXAMPLES=OFF',
        '-DNEMO_SPEECH_BUILD_TOOLS=OFF', '-DGGML_NATIVE=OFF',
        "-DCMAKE_TOOLCHAIN_FILE=$vcpkgRoot\scripts\buildsystems\vcpkg.cmake",
        '-DVCPKG_TARGET_TRIPLET=x64-windows-static-md', '-DVCPKG_MANIFEST_FEATURES=asr',
        "-DVCPKG_INSTALLED_DIR=$build\vcpkg_installed")
    switch ($Backend) {
        'cuda' { $cmakeArgs += @('-DGGML_CUDA=ON', '-DGGML_VULKAN=OFF', "-DCMAKE_CUDA_ARCHITECTURES=$CudaArch") }
        'vulkan' {
            if (-not $env:VULKAN_SDK) { throw 'VULKAN_SDK が未設定です。LunarG Vulkan SDK を導入してください。' }
            $cmakeArgs += @('-DGGML_CUDA=OFF', '-DGGML_VULKAN=ON', '-DNEMO_SPEECH_GGML_PATCHED=OFF',
                "-DSPIRV-Headers_DIR=$env:VULKAN_SDK\Lib\cmake\SPIRV-Headers")
        }
        'cpu' { $cmakeArgs += @('-DGGML_CUDA=OFF', '-DGGML_VULKAN=OFF', '-DNEMO_SPEECH_GGML_PATCHED=OFF') }
    }
    # 日本語版 Windows（コードページ 932）の MSVC は BOM 無し UTF-8 のソースを cp932 として読み、
    # 全角文字の文字列リテラルを含む src/common/subtitles.cpp がコンパイルエラーになる。
    # ソースを UTF-8 として読ませる（whisper.cpp は ggml 側で自前で付けている）。
    # CMAKE_CXX_FLAGS を直接指定すると既定の /EHsc などが消えるため、初期値に足される環境変数で渡す。
    $env:CFLAGS = '/utf-8'
    $env:CXXFLAGS = '/utf-8'
    $env:CUDAFLAGS = '-Xcompiler=/utf-8'
    $cache = Join-Path $build 'CMakeCache.txt'
    if ((Test-Path $cache) -and -not (Select-String -Path $cache -Pattern '/utf-8' -SimpleMatch -Quiet)) {
        Remove-Item -Force $cache  # 環境変数のフラグは初回 configure でしか読まれない
    }
    Invoke-Native $log cmake $cmakeArgs
    Invoke-Native $log cmake @('--build', $build, '-j', $Jobs)
    Publish-Engine 'nemo' {
        param($dir)
        $bin = Join-Path $build 'bin'
        # nemo-speech.exe は同じディレクトリの ggml / nemo_speech DLL を読む
        Copy-Item (Join-Path $bin 'nemo-speech.exe') (Join-Path $dir 'bin')
        Get-ChildItem -Path $bin -Filter '*.dll' -File | Copy-Item -Destination (Join-Path $dir 'bin')
        Copy-CudaRuntime (Join-Path $dir 'bin')
        foreach ($f in 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md') {
            $p = Join-Path $src $f
            if (Test-Path $p) { Copy-Item $p (Join-Path $dir "$f-NeMo-Speech.cpp") }
        }
        Set-Content -Path (Join-Path $dir 'BUILD_INFO.txt') -Encoding utf8 `
            -Value "NeMo-Speech.cpp $NemoSpeechCommit`npreset $Backend-diar`ncuda-arch $CudaArch"
    }
}

function Get-Models {
    foreach ($entry in $Models) {
        $rel, $url, $sha = $entry -split '\|'
        $path = Join-Path $ModelsDir $rel
        if ((Test-Path $path) -and ((Get-FileHash -Algorithm SHA256 $path).Hash -eq $sha.ToUpper())) {
            Log "取得済み: $rel"
            continue
        }
        Log "取得: $rel"
        New-Item -ItemType Directory -Force (Split-Path -Parent $path) | Out-Null
        $partial = "$path.partial"
        & curl.exe -fL --retry 3 -o $partial $url
        if ($LASTEXITCODE -ne 0) { throw "ダウンロードに失敗しました: $url" }
        if ((Get-FileHash -Algorithm SHA256 $partial).Hash -ne $sha.ToUpper()) {
            Remove-Item -Force $partial
            throw "SHA-256 が一致しません: $rel"
        }
        Move-Item -Force $partial $path
    }
}

Repair-ProcessPath
New-Item -ItemType Directory -Force (Join-Path $Work 'src'), (Join-Path $Work 'build'), $Logs, $EnginesDir | Out-Null
if (-not $SkipBuild) {
    if ($Backend -eq 'cuda') {
        if (-not $env:CUDA_PATH) { throw 'CUDA_PATH が未設定です。CUDA Toolkit 12.x を導入してください。' }
        $env:Path = "$(Join-Path $env:CUDA_PATH 'bin');$env:Path"
    }
    Import-MsvcEnvironment
    Build-Whisper
    Build-Nemo
}
if (-not $SkipModels) { Get-Models }

Log '完了'
Log "  whisper-cli : $EnginesDir\whisper\bin\whisper-cli.exe"
Log "  nemo-speech : $EnginesDir\nemo\bin\nemo-speech.exe"
Log "  models      : $ModelsDir\whisper-ggml\, $ModelsDir\nemotron-3-diarization\"
Log "ビルドログ: $Logs"
