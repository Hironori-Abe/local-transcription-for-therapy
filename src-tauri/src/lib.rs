use chrono::{DateTime, FixedOffset, Utc};
use encoding_rs::SHIFT_JIS;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    env,
    ffi::OsStr,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use zip::{write::FileOptions, CompressionMethod, ZipWriter};

mod ggml_speech;
use ggml_speech::GgmlSpeechPaths;
mod gpu_driver;
mod gpu_select;
mod export_crypto;
pub use gpu_select::{print_vulkan_devices, LIST_VULKAN_DEVICES_ARG};


#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;


#[derive(Clone)]
struct DevWindowFocusState {
    generation: Arc<AtomicU64>,
}

impl Default for DevWindowFocusState {
    fn default() -> Self {
        Self {
            generation: Arc::new(AtomicU64::new(0)),
        }
    }
}

fn dev_window_focus_debounce_duration() -> Option<Duration> {
    if !cfg!(debug_assertions) {
        return None;
    }

    let raw = env::var("LOTT_DEV_WINDOW_FOCUS_DEBOUNCE_MS").ok()?;
    let ms = raw.trim().parse::<u64>().ok()?;
    if ms == 0 {
        return None;
    }

    Some(Duration::from_millis(ms.min(30_000)))
}

fn schedule_dev_window_focus(app: &AppHandle, window: &tauri::WebviewWindow) -> bool {
    let Some(delay) = dev_window_focus_debounce_duration() else {
        return false;
    };

    let state = app.state::<DevWindowFocusState>();
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let generation_counter = Arc::clone(&state.generation);
    let app_handle = app.clone();

    let _ = window.minimize();
    thread::spawn(move || {
        thread::sleep(delay);
        if generation_counter.load(Ordering::SeqCst) != generation {
            return;
        }

        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.maximize();
            let _ = window.set_focus();
        }
    });

    true
}

#[tauri::command]
fn debounce_dev_window_focus(app: AppHandle) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };

    schedule_dev_window_focus(&app, &window)
}



























/// 同梱リソース `resources/<name>/` の候補ディレクトリを、見つけやすい順に返す。
fn bundled_resource_dir_candidates(app: &AppHandle, name: &str) -> Vec<PathBuf> {
    let path_api = app.path();
    let mut search_dirs: Vec<PathBuf> = Vec::new();

    if let Ok(rd) = path_api.resource_dir() {
        search_dirs.push(rd.join("resources").join(name));
        search_dirs.push(rd.join(name));
    }

    if let Ok(ed) = path_api.executable_dir() {
        search_dirs.push(ed.join("resources").join(name));
        search_dirs.push(ed.join(name));
        search_dirs.push(ed.join("_up_").join("resources").join(name));
        search_dirs.push(ed.join("_up_").join(name));
    }

    // dev ビルドではリソースが target/debug 配下にコピーされず resource_dir() からも
    // 解決できないため、ソースツリーの src-tauri/resources/<name> を直接参照する。
    // これにより NVIDIA dev でも CUDA 版 llama-server が見つかり、Vulkan 経路を
    // 介さず CUDA で AI 校正が動く。cfg(debug_assertions) ガードのためリリース挙動・配布物・
    // ライセンス前提は不変で、AMD リリースにも影響しない。
    #[cfg(debug_assertions)]
    search_dirs.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(name),
    );
    search_dirs
}



















/// 子プロセス用 Job Object の LimitFlags。
/// - KILL_ON_JOB_CLOSE: 親の終了時に子を確実に終了させる。
/// - DIE_ON_UNHANDLED_EXCEPTION: 子の未処理例外で WER（Windows エラー報告）のダンプ作成・
///   送信ダイアログを出さず、そのまま終了させる。子（whisper-cli / nemo-speech / ffmpeg）の
///   メモリには会話音声と文字起こし本文があり、クラッシュダンプに載りうるため。
#[cfg(target_os = "windows")]
fn child_job_limit_flags() -> u32 {
    use windows_sys::Win32::System::JobObjects::{
        JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION
}

/// 子プロセスを Job Object に紐付け、親プロセス終了時に自動 kill させる（Windows のみ）。
/// CloseRequested ハンドラーが走らないクラッシュ・強制終了時も、管理下の子プロセス
/// （whisper.cpp / NeMo-Speech.cpp / ffmpeg）を確実に終了させ VRAM を解放する。
/// あわせて子の未処理例外でクラッシュダンプを作らせない（`child_job_limit_flags`）。
#[cfg(target_os = "windows")]
fn assign_to_kill_on_close_job(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::{
        Foundation::HANDLE,
        System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        },
    };
    unsafe {
        let job: HANDLE = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = child_job_limit_flags();
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &raw const info as *const _,
            std::mem::size_of_val(&info) as u32,
        );
        AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE);
        // job handle は意図的にリークさせる（プロセス終了まで JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE を保持するため）
    }
}

#[cfg(not(target_os = "windows"))]
fn assign_to_kill_on_close_job(_child: &Child) {}

/// `Command::output()` の代わり。spawn 直後に子を Job Object へ入れてから出力を集める
/// （`output()` は spawn と待機が一体で、間にジョブへ入れられないため）。
/// stdin は `output()` と同じく null、stdout / stderr はパイプにする。
fn output_in_kill_job(cmd: &mut Command) -> std::io::Result<std::process::Output> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = cmd.spawn()?;
    assign_to_kill_on_close_job(&child);
    child.wait_with_output()
}

// ---- クラッシュダンプ（会話データを含みうる）を OS の報告機構に作らせない ----------------------
//
// 子プロセス（whisper-cli / nemo-speech / ffmpeg）と本体のメモリには会話音声と文字起こし本文がある。
// クラッシュ時に Windows のエラー報告（WER）や Linux の apport / systemd-coredump がダンプ・コアを
// 作成・送信しうるため、起動直後に次の対策を入れる（WebView2 側は vendor/wry のパッチで対処済み）。

/// WER の除外登録（`WerAddExcludedApplication`）に載せる子プロセスの exe 名。
/// `ffmpeg.exe` は意図的に入れない: 名前が汎用的で、この PC の他のアプリの ffmpeg.exe まで
/// WER の対象外にしてしまうため。ffmpeg はエラーモード（`SetErrorMode`）と Job Object
/// （DIE_ON_UNHANDLED_EXCEPTION）だけで守る。
/// 登録は per-user（HKCU）で、アンインストール時にも削除しない。Full 版と Editor 版は同じ
/// exe 名を共有し、片方を消しても他方が使い続けるため。残っても無害な空の除外エントリだけ。
#[cfg(any(target_os = "windows", test))]
const WER_EXCLUDED_CHILD_EXES: &[&str] = &["whisper-cli.exe", "nemo-speech.exe"];

/// 除外登録する exe 名の一覧（子プロセス + 本体）。重複は除く。
#[cfg(any(target_os = "windows", test))]
fn wer_excluded_exe_names(current_exe_name: Option<&str>) -> Vec<String> {
    let mut names: Vec<String> = WER_EXCLUDED_CHILD_EXES
        .iter()
        .map(|name| (*name).to_string())
        .collect();
    if let Some(own) = current_exe_name.filter(|name| !name.is_empty()) {
        if !names.iter().any(|name| name.eq_ignore_ascii_case(own)) {
            names.push(own.to_string());
        }
    }
    names
}

/// 現在のエラーモードに「重大エラー／GP フォールトのダイアログを出さない」を足した値。
#[cfg(any(target_os = "windows", test))]
fn error_mode_without_fault_ui(current: u32) -> u32 {
    // SEM_FAILCRITICALERRORS = 0x0001, SEM_NOGPFAULTERRORBOX = 0x0002
    current | 0x0001 | 0x0002
}

/// 自プロセスのエラーモードに SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX を足す。
/// エラーモードは子プロセスへ継承される（`CREATE_DEFAULT_ERROR_MODE` を使う起動は無く、
/// `apply_windows_no_window` も CREATE_NO_WINDOW だけを指定する）ので、以後に起動する
/// whisper-cli / nemo-speech / ffmpeg にも効く。
#[cfg(target_os = "windows")]
fn suppress_windows_fault_reporting_ui() {
    use windows_sys::Win32::System::Diagnostics::Debug::{GetErrorMode, SetErrorMode};
    unsafe {
        SetErrorMode(error_mode_without_fault_ui(GetErrorMode()));
    }
}

/// `WerAddExcludedApplication`（per-user）で exe 名を除外登録する。成功で Ok(())、失敗は HRESULT。
/// 登録先は HKCU\Software\Microsoft\Windows\Windows Error Reporting\ExcludedApplications
/// （管理者権限は不要。同じ名前の再登録は冪等）。
#[cfg(target_os = "windows")]
fn wer_add_excluded_application(exe_name: &str) -> Result<(), i32> {
    use windows_sys::Win32::System::ErrorReporting::WerAddExcludedApplication;
    let wide: Vec<u16> = exe_name.encode_utf16().chain(std::iter::once(0)).collect();
    let hr = unsafe { WerAddExcludedApplication(wide.as_ptr(), 0) };
    if hr >= 0 {
        Ok(())
    } else {
        Err(hr)
    }
}

/// テスト用の後始末。テストが自分で登録した名前だけを消す。
#[cfg(all(target_os = "windows", test))]
fn wer_remove_excluded_application(exe_name: &str) -> Result<(), i32> {
    use windows_sys::Win32::System::ErrorReporting::WerRemoveExcludedApplication;
    let wide: Vec<u16> = exe_name.encode_utf16().chain(std::iter::once(0)).collect();
    let hr = unsafe { WerRemoveExcludedApplication(wide.as_ptr(), 0) };
    if hr >= 0 {
        Ok(())
    } else {
        Err(hr)
    }
}

/// 子プロセスと本体を WER の除外対象に登録する。`abort()` / `__fastfail` はエラーモードと
/// Job Object を迂回して WER に届くため、その経路の対策。失敗しても動作は続ける。
/// 本体の exe 名は実行中の exe のファイル名から取る（dev ビルドでも実名になる）。
#[cfg(target_os = "windows")]
fn register_wer_exclusions() {
    let own = std::env::current_exe().ok().and_then(|path| {
        path.file_name()
            .map(|name| name.to_string_lossy().into_owned())
    });
    for name in wer_excluded_exe_names(own.as_deref()) {
        if let Err(hr) = wer_add_excluded_application(&name) {
            eprintln!(
                "WER 除外登録に失敗しました（{name}, HRESULT=0x{:08X}）。",
                hr as u32
            );
        }
    }
}

/// `run()` の最初に呼ぶ（Windows）。以後に作る子プロセスにもエラーモードが継承される。
#[cfg(target_os = "windows")]
fn configure_crash_dump_protection() {
    suppress_windows_fault_reporting_ui();
    register_wer_exclusions();
}

/// 自プロセスの RLIMIT_CORE を 0 にする（Linux）。rlimit は fork / exec 後も子へ継承されるため、
/// whisper-cli / nemo-speech / ffmpeg / WebKit の子プロセスでも apport / systemd-coredump が
/// コアダンプ（会話データを含む）を作らない。ハードリミットも 0 にするので子から戻せない。
/// `prctl(PR_SET_DUMPABLE, 0)` は通常の execve で 1 に戻り子の対策にならず、本体では
/// /proc/self の所有者が変わる副作用もあるため使わない。失敗は無視してよい（戻り値は確認用）。
#[cfg(target_os = "linux")]
fn disable_core_dumps() -> bool {
    let limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    unsafe { libc::setrlimit(libc::RLIMIT_CORE, &limit) == 0 }
}


const LLM_ENGINE_CACHE_DIR_NAME: &str = "llm-engine";
const LEGACY_LLM_ENGINE_CACHE_DIR_NAME: &str = "lemonade";





// AMD GPU で 12B + MTP を Vulkan llama-server 直起動する際の総コンテキスト長。
// 8GB クラスの AMD dGPU（例: RX 7600M XT, 8176MiB）でも 12B(Q4) + MTP ドラフトが
// auto-fit で収まる安全値（実測で 8192 は VRAM 約8.0GB/8.5GB に収まり MTP も有効）。
// 校正は話者ごと最大40セグメントのバッチで、短い発話なら 8192 トークンに十分収まる。
// 既定（標準）モデル: Gemma 4 E4B QAT。従来どおりのデフォルト経路。
const GEMMA_LLM_MODEL_DIR: &str = "gemma-4-e4b-it";
const GEMMA_MAIN_GGUF_FILENAME: &str = "gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf";
const GEMMA_MTP_GGUF_FILENAME: &str = "mtp-gemma-4-E4B-it.gguf";
const GEMMA_MMPROJ_GGUF_FILENAME: &str = "mmproj-BF16.gguf";
const LLAMA_CPP_CPU_BUILD: &str = "b10075";
const EDITOR_VOICE_INPUT_MAX_BASE64_CHARS: usize = 2_000_000;

// 上位（高精度）モデル: Gemma 4 12B QAT + MTP。NVIDIA=CUDA 直起動 / AMD=ROCm 優先・Vulkan
// フォールバックの llama-server 直起動経路で提供し、large-v3 と同じく後からダウンロードする。
const GEMMA_12B_LLM_MODEL_DIR: &str = "gemma-4-12b-it";


/// Gemma と ggml 音声モデルの取得で共用する固定ファイル定義。
#[derive(Clone, Copy)]
struct PinnedDownloadFile {
    component: &'static str,
    label: &'static str,
    file: &'static str,
    url: &'static str,
    sha256: &'static str,
    size: u64,
}
























// E4B(標準) を AMD で直起動する際の ctx。校正の話者別バッチ（最大40セグメント）を
// 単一スロットで処理するため 16384 とする。










// LLM バックエンドが現在ロードしているデバイスを返す: gpu / stopped









// Full版（CUDA/AMD）の音声入力サーバー起動 ctx。校正の AMD_E4B_CTX_SIZE(16384) と異なり、
// 8GB クラスの AMD ノート GPU でも mmproj 込みで安全に収まるサイズに絞る
// （実測: RX 7600M XT gfx1102・ctx 8192 で ROCm/Vulkan とも安定動作、VRAM 4.2GiB 程度）。










#[tauri::command]
fn get_installed_memory_bytes() -> Option<u64> {
    installed_memory_bytes()
}

#[cfg(target_os = "windows")]
fn installed_memory_bytes() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::GetPhysicallyInstalledSystemMemory;
    let mut total_kib = 0u64;
    let ok = unsafe { GetPhysicallyInstalledSystemMemory(&mut total_kib) };
    if ok != 0 {
        return total_kib.checked_mul(1024);
    }
    None
}

#[cfg(target_os = "linux")]
fn installed_memory_bytes() -> Option<u64> {
    // /proc/meminfo の MemTotal は予約領域を除いた値なので、搭載量として一般的な
    // GiB 単位へ切り上げる（16GB機を15.xGiBとして誤判定しないため）。
    let meminfo = fs::read_to_string("/proc/meminfo").ok()?;
    let total_kib = meminfo.lines().find_map(|line| {
        let value = line.strip_prefix("MemTotal:")?.trim();
        value.split_whitespace().next()?.parse::<u64>().ok()
    })?;
    let bytes = total_kib.checked_mul(1024)?;
    let gib = 1024_u64.pow(3);
    bytes.checked_add(gib - 1).map(|value| (value / gib) * gib)
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn installed_memory_bytes() -> Option<u64> {
    None
}

const CPU_MINIMUM_MEMORY_BYTES: u64 = 16 * 1024_u64.pow(3);
const CPU_MINIMUM_LOGICAL_THREADS: usize = 8;

#[derive(Debug, PartialEq)]
enum CpuStartupRequirementFailure {
    Memory { installed_bytes: u64 },
    Avx2,
    LogicalThreads { detected: usize },
}

#[cfg(any(debug_assertions, test))]
#[derive(Clone, Copy, Debug, PartialEq)]
enum DevCpuStartupScenario {
    Memory,
    Avx2,
    Threads,
    All,
    Notice,
}

#[cfg(any(debug_assertions, test))]
fn parse_dev_cpu_startup_scenario(value: &str) -> Option<DevCpuStartupScenario> {
    match value.trim().to_ascii_lowercase().as_str() {
        "memory" => Some(DevCpuStartupScenario::Memory),
        "avx2" => Some(DevCpuStartupScenario::Avx2),
        "threads" => Some(DevCpuStartupScenario::Threads),
        "all" => Some(DevCpuStartupScenario::All),
        "notice" => Some(DevCpuStartupScenario::Notice),
        _ => None,
    }
}

fn dev_cpu_startup_scenario_inputs_from_env() -> Option<(Option<u64>, bool, usize)> {
    #[cfg(debug_assertions)]
    {
        env::var("LOTT_DEV_CPU_STARTUP_SCENARIO")
            .ok()
            .and_then(|value| parse_dev_cpu_startup_scenario(&value))
            .map(dev_cpu_startup_scenario_inputs)
    }
    #[cfg(not(debug_assertions))]
    {
        None
    }
}

#[cfg(any(debug_assertions, test))]
fn dev_cpu_startup_scenario_inputs(scenario: DevCpuStartupScenario) -> (Option<u64>, bool, usize) {
    let supported_memory = Some(CPU_MINIMUM_MEMORY_BYTES);
    match scenario {
        DevCpuStartupScenario::Memory => (Some(8 * 1024_u64.pow(3)), true, 8),
        DevCpuStartupScenario::Avx2 => (supported_memory, false, 8),
        DevCpuStartupScenario::Threads => (supported_memory, true, 4),
        DevCpuStartupScenario::All => (Some(8 * 1024_u64.pow(3)), false, 4),
        DevCpuStartupScenario::Notice => (supported_memory, true, 8),
    }
}

fn cpu_avx2_supported() -> bool {
    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    {
        std::is_x86_feature_detected!("avx2")
    }
    #[cfg(not(any(target_arch = "x86", target_arch = "x86_64")))]
    {
        false
    }
}

fn cpu_startup_requirement_failures(
    installed_memory: Option<u64>,
    avx2_supported: bool,
    logical_threads: usize,
) -> Vec<CpuStartupRequirementFailure> {
    let mut failures = Vec::new();
    if let Some(installed_bytes) = installed_memory {
        if installed_bytes < CPU_MINIMUM_MEMORY_BYTES {
            failures.push(CpuStartupRequirementFailure::Memory { installed_bytes });
        }
    }
    if !avx2_supported {
        failures.push(CpuStartupRequirementFailure::Avx2);
    }
    if logical_threads < CPU_MINIMUM_LOGICAL_THREADS {
        failures.push(CpuStartupRequirementFailure::LogicalThreads {
            detected: logical_threads,
        });
    }
    failures
}

/// Vulkan で GPU が見つからないときの案内文（GPU はあるのにドライバーが無い・古い場合）。
/// 開発時は `LOTT_DEV_GPU_DRIVER_SCENARIO=missing|old` で表示を確かめられる。
fn gpu_driver_hint() -> Option<String> {
    #[cfg(debug_assertions)]
    {
        if let Ok(value) = env::var("LOTT_DEV_GPU_DRIVER_SCENARIO") {
            let missing = value.trim().eq_ignore_ascii_case("missing");
            return gpu_driver::driver_hint(&[gpu_driver::DisplayAdapter {
                name: "NVIDIA GeForce RTX 4060 Laptop GPU".to_string(),
                vendor: Some("NVIDIA"),
                driver_missing: missing,
            }]);
        }
    }
    gpu_driver::driver_hint(&gpu_driver::display_adapters())
}

/// 画面用: Vulkan で GPU が見つからないときの、ドライバーについての案内（無ければ None）。
#[tauri::command]
async fn get_gpu_driver_hint() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        if gpu_select::resolve_preferred(None).is_some() {
            None
        } else {
            gpu_driver_hint()
        }
    })
    .await
    .ok()
    .flatten()
}

/// フル機能版で GPU が見つからず CPU で処理するときだけ、起動時に動作要件を確かめて案内する。
/// GPU の列挙は別プロセスで数秒かかることがあるため、ウィンドウの表示を止めないよう裏で調べる。
fn show_cpu_startup_dialog(app: &tauri::App, window: &tauri::WebviewWindow) {
    if is_editor_build(app.handle()) {
        return;
    }
    let app_handle = app.handle().clone();
    let window = window.clone();
    thread::spawn(move || cpu_startup_check(&app_handle, &window));
}

fn cpu_startup_check(app: &AppHandle, window: &tauri::WebviewWindow) {
    let dev_inputs = dev_cpu_startup_scenario_inputs_from_env();
    let dev_driver =
        cfg!(debug_assertions) && env::var_os("LOTT_DEV_GPU_DRIVER_SCENARIO").is_some();
    if dev_inputs.is_none() && !dev_driver && gpu_select::resolve_preferred(None).is_some() {
        return;
    }
    let driver_hint = gpu_driver_hint();
    let hint_section = driver_hint
        .as_deref()
        .map(|hint| format!("{hint}\n\n"))
        .unwrap_or_default();

    let real_inputs = (
        installed_memory_bytes(),
        cpu_avx2_supported(),
        std::thread::available_parallelism()
            .map(|count| count.get())
            .unwrap_or(1),
    );
    let (installed_memory, avx2_supported, logical_threads) = dev_inputs.unwrap_or(real_inputs);
    let failures =
        cpu_startup_requirement_failures(installed_memory, avx2_supported, logical_threads);

    if failures.is_empty() {
        let (title, cpu_text) = if driver_hint.is_some() {
            (
                "GPUのドライバーを確認してください",
                "このままでは GPU を使えないため、CPUで処理します。\n\
一連の作業のために、音声ファイルの1.5〜2.5倍程度の処理時間がかかります（1時間音声なら1.5〜2.5時間）。",
            )
        } else {
            (
                "CPUでの処理について",
                "GPUが見つからないため、CPUで処理します。\n\
一連の作業のために、音声ファイルの1.5〜2.5倍程度の処理時間がかかります（1時間音声なら1.5〜2.5時間）。\n\
頻繁・継続的な利用には、GPU（NVIDIA / AMD / Intel）を搭載したPCをお勧めします。",
            )
        };
        app.dialog()
            .message(format!("{hint_section}{cpu_text}"))
            .title(title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCustom("OK".to_string()))
            .parent(window)
            .show(|_| {});
        return;
    }

    let memory_is_insufficient = failures
        .iter()
        .any(|failure| matches!(failure, CpuStartupRequirementFailure::Memory { .. }));
    let details = failures
        .iter()
        .map(|failure| match failure {
            CpuStartupRequirementFailure::Memory { installed_bytes } => format!(
                "・搭載メモリが16GB未満（検出値: {:.1}GB）",
                *installed_bytes as f64 / 1024_f64.powi(3)
            ),
            CpuStartupRequirementFailure::Avx2 => "・CPUがAVX2に対応していません".to_string(),
            CpuStartupRequirementFailure::LogicalThreads { detected } => {
                format!("・CPUの論理スレッド数が8未満（検出値: {detected}）")
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    let opening = if memory_is_insufficient {
        "搭載されているメモリが不足しています。"
    } else {
        "このPCはCPUで処理するための最低要件を満たしていません。"
    };
    let driver_note = if driver_hint.is_some() {
        "\n\nGPUのドライバーを入れて GPU で処理できるようにすれば、この要件は不要です。"
    } else {
        ""
    };
    let message = format!(
        "{hint_section}{opening}\n\n\
GPUを使わずCPUで処理する場合の最低要件は、メモリ16GB以上、AVX2対応CPU（4コア／8スレッド以上）です。\n\n\
不足している項目:\n{details}{driver_note}\n\n\
OKを押すとアプリを終了します。"
    );
    let app_handle = app.clone();
    app.dialog()
        .message(message)
        .title("動作要件を満たしていません")
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::OkCustom("OK".to_string()))
        .parent(window)
        .show(move |_| app_handle.exit(0));
}

fn generate_editor_voice_input_candidates_blocking(
    app: AppHandle,
    request: EditorVoiceInputRequest,
) -> Result<EditorVoiceInputResponse, String> {
    if request.wav_base64.len() > EDITOR_VOICE_INPUT_MAX_BASE64_CHARS {
        return Err("音声入力が長すぎます。最大15秒まで録音してください。".to_string());
    }
    let _run_guard = match TaskRunGuard::try_acquire(&WHISPER_VOICE_INPUT_ACTIVE) {
        Some(g) => g,
        None => {
            return Err("別の音声入力が実行中です。完了してから再試行してください。".to_string())
        }
    };
    generate_whisper_voice_input_candidates_blocking(&app, &request)
}

/// Editor / Vulkan 版の音声入力に使う Whisper モデル（文字起こしの既定と同じ）。
const VOICE_INPUT_WHISPER_MODEL: &str = "turbo";

/// 文字起こしと同じ言語設定で1回だけ書き起こし、候補1件として返す。
/// 日本語のみフィラー例文を使い、他言語には日本語の例文を渡さない。
/// 以前は例文なしの2回目も実行して候補を2件にしていたが、待ち時間の短さを優先して1回にした。
/// 前後行の文脈は使わない（Whisper のプロンプトに入れると、話していない語が紛れ込むため）。
fn generate_whisper_voice_input_candidates_blocking(
    app: &AppHandle,
    request: &EditorVoiceInputRequest,
) -> Result<EditorVoiceInputResponse, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let paths = resolve_ggml_speech_paths(app)?;
    let missing = paths.missing_for_transcription(VOICE_INPUT_WHISPER_MODEL);
    if !missing.is_empty() {
        return Err(format!(
            "音声入力に使う文字起こしモデル（whisper.cpp）の準備が済んでいません。設定画面のセットアップを完了してから、もう一度お試しください。\n不足: {}",
            missing.join(" / ")
        ));
    }
    let model_path = paths
        .whisper_model(VOICE_INPUT_WHISPER_MODEL)
        .expect("checked above");
    let wav_bytes = STANDARD
        .decode(request.wav_base64.trim())
        .map_err(|_| "録音データを読み取れませんでした。もう一度録音してください。".to_string())?;
    let temp_dir = private_llm_temp_dir(app)?;
    let mut guard = TempFileGuard::new();
    // whisper-cli には一時ディレクトリからの ASCII のファイル名だけを渡す（execute_ggml_transcription 参照）。
    let wav_name = format!("{}.wav", private_temp_name("voice-input"));
    let wav = temp_dir.join(&wav_name);
    write_private_temp_file(&wav, &wav_bytes)?;
    guard.push(wav);
    let threads = thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(8);
    // Editor 版は常に CPU で動かし、GPU 列挙や Vulkan ドライバーにも依存させない。
    // Vulkan 版は選択可能な GPU があれば GPU、無ければ CPU で動かす。
    let use_gpu = !is_editor_build(app)
        && paths.whisper_backend() == Some("vulkan")
        && gpu_select::resolve_preferred(None).is_some();
    let language = normalize_transcription_language(request.language.as_deref())?;

    let text = {
        let out_name = private_temp_name("voice-input-asr");
        let out_json = temp_dir.join(format!("{out_name}.json"));
        guard.push(out_json.clone());
        let args = ggml_speech::whisper_cli_args(
            &model_path,
            &paths.vad_model,
            Path::new(&wav_name),
            Path::new(&out_name),
            &language,
            use_gpu,
            true, // フィラー保持の単語時刻を出す。日本語のみ例文を付ける。
            threads,
        );
        let mut cmd = Command::new(&paths.whisper_cli);
        cmd.current_dir(&temp_dir);
        if cfg!(target_os = "windows") {
            let contents = ggml_speech::whisper_response_file(&args)?;
            let rsp_name = format!("{}.args", private_temp_name("voice-input-args"));
            let rsp = temp_dir.join(&rsp_name);
            write_private_temp_file(&rsp, contents.as_bytes())?;
            guard.push(rsp);
            cmd.arg(format!("@{rsp_name}"));
        } else {
            cmd.args(args);
        }
        // Editor 版は -ng でGPUを使わない。Vulkan版は選択したGPUだけを見せる。
        if use_gpu {
            apply_ggml_vulkan_device(&mut cmd, paths.whisper_backend(), None);
        }
        apply_host_command_env(&mut cmd);
        apply_windows_no_window(&mut cmd);
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        let child = cmd
            .spawn()
            .map_err(|e| format!("音声入力の文字起こし（whisper.cpp）を起動できませんでした: {e}"))?;
        assign_to_kill_on_close_job(&child);
        let output = child
            .wait_with_output()
            .map_err(|e| format!("音声入力の文字起こし（whisper.cpp）の終了待機に失敗しました: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "音声入力の文字起こし（whisper.cpp）に失敗しました（exit={:?}）。\n{}",
                output.status.code(),
                ggml_speech::tail_chars(stderr.trim(), 800)
            ));
        }
        let raw = fs::read(&out_json)
            .map(|b| String::from_utf8_lossy(&b).into_owned())
            .map_err(|e| format!("whisper.cpp の出力を読み込めませんでした: {e}"))?;
        let parsed: Value = serde_json::from_str(&raw)
            .map_err(|e| format!("whisper.cpp の出力 JSON を解析できませんでした: {e}"))?;
        let (_, text) = ggml_speech::convert_whisper_output(&parsed, &language, false)?;
        text
    };

    let text = normalize_transcription_output_text(text.trim(), &language);
    if text.is_empty() {
        return Err(
            "音声を聞き取れませんでした。マイクの位置や音量を確かめて、もう一度録音してください。"
                .to_string(),
        );
    }
    Ok(EditorVoiceInputResponse {
        candidates: vec![text],
    })
}

/// CPU版の音声入力パックに含める ffmpeg の配置先。
fn cpu_voice_ffmpeg_install_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|d| d.join("ffmpeg"))
}

fn find_downloaded_ffmpeg_bin(app: &AppHandle) -> Option<String> {
    let dir = cpu_voice_ffmpeg_install_dir(app)?;
    let path = dir.join(format!("ffmpeg{}", std::env::consts::EXE_SUFFIX));
    if path_is_nonempty_file(&path, 1024 * 1024) {
        Some(path.to_string_lossy().into_owned())
    } else {
        None
    }
}

/// PATH 上の ffmpeg CLI。AGENTS.md の「同梱または PATH 上の ffmpeg CLI」方針の範囲内
/// （別プロセス起動のみで、GPL 構成でも配布物のライセンスには影響しない）。
fn find_path_ffmpeg_bin() -> Option<String> {
    let mut cmd = Command::new("ffmpeg");
    apply_windows_no_window(&mut cmd);
    apply_host_command_env(&mut cmd);
    cmd.arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    match cmd.status() {
        Ok(status) if status.success() => Some("ffmpeg".to_string()),
        _ => None,
    }
}

/// 解決順: FFMPEG_BIN 環境変数 → 同梱（Full版）→ DL済み（CPU版の音声入力パック）→ PATH。
fn resolve_ffmpeg_bin_for_segment_cut(app: &AppHandle) -> Option<String> {
    if let Ok(bin) = env::var("FFMPEG_BIN") {
        if !bin.trim().is_empty() {
            return Some(bin);
        }
    }
    if let Some(bin) = find_bundled_ffmpeg_bin(app) {
        return Some(bin);
    }
    if let Some(bin) = find_downloaded_ffmpeg_bin(app) {
        return Some(bin);
    }
    find_path_ffmpeg_bin()
}

#[tauri::command]
async fn generate_editor_voice_input_candidates(
    app: AppHandle,
    request: EditorVoiceInputRequest,
) -> Result<EditorVoiceInputResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        generate_editor_voice_input_candidates_blocking(app, request)
    })
    .await
    .map_err(|e| format!("音声入力候補生成タスクエラー: {e}"))?
}

static TRANSCRIPTION_PID: AtomicU32 = AtomicU32::new(0);
static PROOFREAD_PID: AtomicU32 = AtomicU32::new(0);
static DIARIZATION_PID: AtomicU32 = AtomicU32::new(0);
static TRANSCRIPTION_RUN_COUNTER: AtomicU64 = AtomicU64::new(0);
static TRANSCRIPTION_CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);
static PROOFREAD_CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);
static DIARIZATION_CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

// 二重起動ガード用フラグ。
// GPU/モデルを多重ロードしないよう、コマンド単位で同種タスクの同時実行を排他する。
static TRANSCRIPTION_ACTIVE: AtomicBool = AtomicBool::new(false);
static DIARIZATION_ACTIVE: AtomicBool = AtomicBool::new(false);
static WHISPER_VOICE_INPUT_ACTIVE: AtomicBool = AtomicBool::new(false);
static SETUP_ACTIVE: AtomicBool = AtomicBool::new(false);

/// 二重起動ガードの RAII ハンドル。
/// `try_acquire` 成功時のみ生成され、Drop 時にフラグを解放する。
/// これにより早期 return・パニック・タスクキャンセルのいずれでもフラグが残らない。
struct TaskRunGuard {
    flag: &'static AtomicBool,
}

impl TaskRunGuard {
    /// フラグを false -> true へ CAS で確保する。既に実行中なら `None`。
    fn try_acquire(flag: &'static AtomicBool) -> Option<TaskRunGuard> {
        match flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst) {
            Ok(_) => Some(TaskRunGuard { flag }),
            Err(_) => None,
        }
    }
}

impl Drop for TaskRunGuard {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::SeqCst);
    }
}

fn apply_windows_no_window(_cmd: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        _cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

/// AppImage 実行中なら AppDir のマウント先を返す。
///
/// linuxdeploy 製 AppRun は `APPDIR` を export する。古い/自作 AppRun で無い場合に備え、
/// 実行ファイルパスの `/tmp/.mount_xxxx` 祖先からも解決する。
#[cfg(target_os = "linux")]
fn appimage_dir() -> Option<&'static Path> {
    use std::sync::OnceLock;
    static APPDIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    APPDIR
        .get_or_init(|| {
            if let Some(value) = env::var_os("APPDIR") {
                let path = PathBuf::from(value);
                if path.is_dir() {
                    return Some(path);
                }
            }
            let exe = env::current_exe().ok()?;
            exe.ancestors()
                .find(|dir| {
                    dir.file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| name.starts_with(".mount_"))
                })
                .map(|dir| dir.to_path_buf())
        })
        .as_deref()
}

/// AppDir 内を指す探索パス（`:` 区切りの複数値）。ホストコマンドへ渡すと同梱ライブラリや
/// 同梱モジュールを掴ませてしまう。AppDir 配下のエントリだけを落とし、ホスト側の値は残す。
///
/// 実際の設定元: linuxdeploy の `AppRun.wrapped`（`LD_LIBRARY_PATH` / `PATH` / `PYTHONPATH` /
/// `PERLLIB` / `QT_PLUGIN_PATH` / `XDG_DATA_DIRS` / `GSETTINGS_SCHEMA_DIR`）、
/// `apprun-hooks/linuxdeploy-plugin-gtk.sh`（`GTK_PATH` / `GIO_EXTRA_MODULES` ほか）、
/// `apprun-hooks/linuxdeploy-plugin-gstreamer.sh`（`GST_PLUGIN_*`）。
#[cfg(target_os = "linux")]
const APPDIR_PATH_LIST_VARS: &[&str] = &[
    "LD_LIBRARY_PATH",
    "PATH",
    "XDG_DATA_DIRS",
    "XDG_CONFIG_DIRS",
    "GI_TYPELIB_PATH",
    "GTK_PATH",
    "GSETTINGS_SCHEMA_DIR",
    "GIO_EXTRA_MODULES",
    "GIO_MODULE_DIR",
    "GST_PLUGIN_PATH",
    "GST_PLUGIN_PATH_1_0",
    "GST_PLUGIN_SYSTEM_PATH",
    "GST_PLUGIN_SYSTEM_PATH_1_0",
    "PYTHONPATH",
    "PERLLIB",
    "QT_PLUGIN_PATH",
];

/// AppDir 内を指す単一値の環境変数。値そのものが AppDir 配下なら削除する。
#[cfg(target_os = "linux")]
const APPDIR_SCALAR_VARS: &[&str] = &[
    "LD_PRELOAD",
    "GTK_EXE_PREFIX",
    "GTK_DATA_PREFIX",
    "GTK_IM_MODULE_FILE",
    "GDK_PIXBUF_MODULE_FILE",
    "GDK_PIXBUF_MODULEDIR",
    "GST_PLUGIN_SCANNER",
    "GST_PLUGIN_SCANNER_1_0",
    "GST_PTP_HELPER_1_0",
    "GST_REGISTRY_1_0",
    "FONTCONFIG_FILE",
    "FONTCONFIG_PATH",
    "PYTHONHOME",
];

/// ホスト側コマンド（`xdg-open` / `nvidia-smi` / `curl` など、OS 側にインストール済みの
/// 実行ファイル）を起動する `Command` から、AppImage 由来のライブラリ探索環境を取り除く。
///
/// AppRun は `LD_LIBRARY_PATH` の先頭へ `$APPDIR/usr/lib` を入れ、これが子・孫プロセスまで
/// 継承される。その結果、ホストの `/bin/sh`（Arch 系では readline 8.3 にリンク）が AppDir 同梱の
/// 古い `libreadline.so.8`（Ubuntu 24.04 = 8.2）を掴み、
/// `symbol lookup error: undefined symbol: rl_print_keybinding` で即死する。
/// `/usr/bin/xdg-open` は `#!/bin/sh` スクリプトなので、外部リンク/フォルダを開く操作が
/// 丸ごと失敗していた。同種の不整合は libstdc++ / libcurl など他のライブラリでも起こりうるため、
/// ライブラリ単位ではなく「ホストコマンドには AppDir の環境を渡さない」で根本を塞ぐ。
///
/// 同梱バイナリ（同梱 Python・同梱 llama-server 等）は AppDir 内のライブラリに依存するため、
/// この関数を適用してはならない。
fn apply_host_command_env(_cmd: &mut Command) {
    #[cfg(target_os = "linux")]
    {
        let Some(appdir) = appimage_dir() else {
            return;
        };
        let keep_dir = BUNDLED_VULKAN_LOADER_DIR.get().map(PathBuf::as_path);
        for (var, action) in host_command_env_overrides(appdir, keep_dir, |name| env::var_os(name)) {
            match action {
                Some(value) => _cmd.env(&var, value),
                None => _cmd.env_remove(&var),
            };
        }
    }
}

/// ホストに Vulkan ローダーが無いとき、フォールバックとして有効化した同梱ローダーの
/// ディレクトリ（AppDir 内）。ggml エンジンの子プロセスには `LD_LIBRARY_PATH` 経由で
/// これを渡す必要があるため、`apply_host_command_env` の AppDir 除去から除外する。
#[cfg(target_os = "linux")]
static BUNDLED_VULKAN_LOADER_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// パス区切りリストから AppDir 配下のエントリを除く。ただし `keep_dir` と一致するものは残す。
/// 戻り値は (元のエントリ数, 残すエントリ)。
#[cfg(any(target_os = "linux", test))]
fn filter_appdir_entries(
    value: &std::ffi::OsStr,
    appdir: &Path,
    keep_dir: Option<&Path>,
) -> (usize, Vec<PathBuf>) {
    let entries: Vec<PathBuf> = env::split_paths(value).collect();
    let total = entries.len();
    let kept = entries
        .into_iter()
        .filter(|entry| !entry.starts_with(appdir) || keep_dir == Some(entry.as_path()))
        .collect();
    (total, kept)
}

/// `apply_host_command_env` の純粋部分。AppDir 配下を指す環境変数について
/// 「置き換える値（Some）／削除する（None）」を返す。変更不要な変数は返さない。
/// `keep_dir` は AppDir 内でも残すディレクトリ（同梱フォールバック Vulkan ローダー）。
#[cfg(target_os = "linux")]
fn host_command_env_overrides<F>(
    appdir: &Path,
    keep_dir: Option<&Path>,
    read_env: F,
) -> Vec<(std::ffi::OsString, Option<std::ffi::OsString>)>
where
    F: Fn(&str) -> Option<std::ffi::OsString>,
{
    let mut overrides = Vec::new();

    for var in APPDIR_PATH_LIST_VARS {
        let Some(value) = read_env(var) else {
            continue;
        };
        let (total, kept) = filter_appdir_entries(&value, appdir, keep_dir);
        if kept.len() == total {
            continue;
        }
        let replacement = match env::join_paths(&kept) {
            Ok(joined) if !joined.is_empty() => Some(joined),
            // PATH を空にするとホストコマンド自体を解決できなくなるため、標準パスへ戻す。
            _ if *var == "PATH" => Some(std::ffi::OsString::from("/usr/local/bin:/usr/bin:/bin")),
            _ => None,
        };
        overrides.push((std::ffi::OsString::from(*var), replacement));
    }

    for var in APPDIR_SCALAR_VARS {
        let Some(value) = read_env(var) else {
            continue;
        };
        if Path::new(&value).starts_with(appdir) {
            overrides.push((std::ffi::OsString::from(*var), None));
        }
    }

    // linuxdeploy-plugin-gtk の hook がアプリ自身のために入れる値。パスではないので
    // 上の判定では拾えないが、ホスト側アプリ（xdg-open が起動するブラウザ等）へ
    // 引き継ぐ理由はないため外す。
    for var in ["GDK_BACKEND", "GTK_THEME"] {
        if read_env(var).is_some() {
            overrides.push((std::ffi::OsString::from(var), None));
        }
    }

    overrides
}

#[derive(Copy, Clone)]
enum RunningTaskKind {
    Transcription,
    Proofread,
    Diarization,
}

fn set_running_pid(kind: RunningTaskKind, pid: u32) {
    match kind {
        RunningTaskKind::Transcription => TRANSCRIPTION_PID.store(pid, Ordering::SeqCst),
        RunningTaskKind::Proofread => PROOFREAD_PID.store(pid, Ordering::SeqCst),
        RunningTaskKind::Diarization => DIARIZATION_PID.store(pid, Ordering::SeqCst),
    }
}

fn clear_running_pid(kind: RunningTaskKind) {
    match kind {
        RunningTaskKind::Transcription => TRANSCRIPTION_PID.store(0, Ordering::SeqCst),
        RunningTaskKind::Proofread => PROOFREAD_PID.store(0, Ordering::SeqCst),
        RunningTaskKind::Diarization => DIARIZATION_PID.store(0, Ordering::SeqCst),
    }
}

fn get_running_pid(kind: RunningTaskKind) -> u32 {
    match kind {
        RunningTaskKind::Transcription => TRANSCRIPTION_PID.load(Ordering::SeqCst),
        RunningTaskKind::Proofread => PROOFREAD_PID.load(Ordering::SeqCst),
        RunningTaskKind::Diarization => DIARIZATION_PID.load(Ordering::SeqCst),
    }
}

fn set_cancel_requested(kind: RunningTaskKind, requested: bool) {
    match kind {
        RunningTaskKind::Transcription => {
            TRANSCRIPTION_CANCEL_REQUESTED.store(requested, Ordering::SeqCst)
        }
        RunningTaskKind::Proofread => PROOFREAD_CANCEL_REQUESTED.store(requested, Ordering::SeqCst),
        RunningTaskKind::Diarization => {
            DIARIZATION_CANCEL_REQUESTED.store(requested, Ordering::SeqCst)
        }
    }
}

fn take_cancel_requested(kind: RunningTaskKind) -> bool {
    match kind {
        RunningTaskKind::Transcription => {
            TRANSCRIPTION_CANCEL_REQUESTED.swap(false, Ordering::SeqCst)
        }
        RunningTaskKind::Proofread => PROOFREAD_CANCEL_REQUESTED.swap(false, Ordering::SeqCst),
        RunningTaskKind::Diarization => DIARIZATION_CANCEL_REQUESTED.swap(false, Ordering::SeqCst),
    }
}

fn kill_process_tree_by_pid(pid: u32) -> Result<(), String> {
    if cfg!(target_os = "windows") {
        let mut cmd = Command::new("taskkill");
        apply_windows_no_window(&mut cmd);
        let output = cmd
            .arg("/PID")
            .arg(pid.to_string())
            .arg("/T")
            .arg("/F")
            .output()
            .map_err(|e| format!("taskkill 実行に失敗しました: {e}"))?;
        if output.status.success() {
            return Ok(());
        }
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "taskkill が失敗しました。".to_string()
        } else {
            detail
        });
    }

    let mut cmd = Command::new("kill");
    apply_windows_no_window(&mut cmd);
    apply_host_command_env(&mut cmd);
    let output = cmd
        .arg("-TERM")
        .arg(pid.to_string())
        .output()
        .map_err(|e| format!("kill 実行に失敗しました: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if detail.is_empty() {
            "kill が失敗しました。".to_string()
        } else {
            detail
        })
    }
}

fn request_cancel(kind: RunningTaskKind) -> Result<bool, String> {
    let pid = get_running_pid(kind);
    if pid == 0 {
        return Ok(false);
    }
    set_cancel_requested(kind, true);
    kill_process_tree_by_pid(pid)?;
    Ok(true)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunTranscriptionRequest {
    run_id: Option<u64>,
    audio_path: String,
    diarization: bool,
    speaker_count: Option<u8>,
    device: Option<String>,
    compute_type: Option<String>,
    model: Option<String>,
    language: Option<String>,
    parallel_diarization: Option<bool>,
    /// ggml エンジンに使わせる GPU の UUID。省略・見つからない場合は自動選択。
    ggml_gpu_uuid: Option<String>,
    /// 文字起こし用音声の調整プリセット（none / low_noise / strong_noise / volume_boost /
    /// general_improvement）。省略・不明値は none。話者分離には適用しない。
    audio_preprocess: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunTranscriptionResponse {
    success: bool,
    result: Option<Value>,
    error_message: Option<String>,
}


/// LoTTの文字起こし対象コードを小文字へ正規化する。未指定・空欄は既定の `ja`、
/// 対象外コードはWhisperへ渡さずエラーにする。
fn normalize_transcription_language(value: Option<&str>) -> Result<String, String> {
    ggml_speech::normalize_asr_language(value)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunDiarizationRequest {
    audio_path: String,
    speaker_count: Option<u8>,
    device: Option<String>,
    result: Value,
    /// ggml エンジンに使わせる GPU の UUID。省略・見つからない場合は自動選択。
    ggml_gpu_uuid: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunDiarizationResponse {
    success: bool,
    result: Option<Value>,
    error_message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProofreadSegmentInput {
    id: i64,
    text: String,
    speaker: Option<String>,
    start: Option<f64>,
    end: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProofreadTranscriptionRequest {
    segments: Vec<ProofreadSegmentInput>,
    /// 文字起こし言語。省略時は既存動作との互換性のため日本語として扱う。
    language: Option<String>,
    chunk_size: Option<i64>,
    chunk_max_chars: Option<i64>,
    /// "entity" | "punct" | "all" (default)
    mode: Option<String>,
    location_detection_scope: Option<LocationDetectionScopeRequest>,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct LocationDetectionScopeRequest {
    mode: Option<String>,
    prefectures: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProofreadTranscriptionResponse {
    success: bool,
    result: Option<Value>,
    error_message: Option<String>,
}



#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PunctRulesFile {
    #[serde(default)]
    force_comma_after: Vec<String>,
    #[serde(default)]
    remove_comma_after: Vec<String>,
    #[serde(default)]
    add_sentence_final_period: Option<bool>,
    #[serde(default)]
    use_speaker_group_punctuation: Option<bool>,
    #[serde(default)]
    speaker_group_max_gap_sec: Option<f64>,
    #[serde(default)]
    speaker_mid_comma_min_chars: Option<usize>,
    #[serde(default)]
    speaker_mid_short_comma_max_chars: Option<usize>,
    #[serde(default)]
    speaker_connective_endings: Option<Vec<String>>,
    #[serde(default)]
    speaker_last_period_min_chars: Option<usize>,
    #[serde(default)]
    speaker_join_use_question_mark: Option<bool>,
    #[serde(default)]
    speaker_question_endings: Vec<String>,
    #[serde(default)]
    speaker_short_utterances_no_comma: Vec<String>,
}

#[derive(Debug, Clone)]
struct PunctRules {
    force_comma_after: Vec<String>,
    remove_comma_after: Vec<String>,
    add_sentence_final_period: bool,
    use_speaker_group_punctuation: bool,
    speaker_group_max_gap_sec: f64,
    speaker_mid_comma_min_chars: usize,
    speaker_mid_short_comma_max_chars: usize,
    speaker_connective_endings: Vec<String>,
    speaker_last_period_min_chars: usize,
    speaker_join_use_question_mark: bool,
    speaker_question_endings: Vec<String>,
    speaker_short_utterances_no_comma: HashSet<String>,
}

impl Default for PunctRules {
    fn default() -> Self {
        Self {
            force_comma_after: vec![
                "けれど".to_string(),
                "ですが".to_string(),
                "なので".to_string(),
                "というか".to_string(),
                "まあ".to_string(),
                "ので".to_string(),
            ],
            remove_comma_after: vec![],
            add_sentence_final_period: false,
            use_speaker_group_punctuation: true,
            speaker_group_max_gap_sec: 1.2,
            speaker_mid_comma_min_chars: 8,
            speaker_mid_short_comma_max_chars: 5,
            speaker_connective_endings: [
                "けれども",
                "けれど",
                "けども",
                "けど",
                "が",
                "して",
                "くて",
                "って",
                "て",
                "で",
                "し",
                "から",
                "ので",
                "のに",
                "とか",
                "たり",
                "たら",
                "ば",
                "なら",
                "ながら",
                "つつ",
                "と",
                "に",
                "を",
                "は",
                "も",
                "や",
                "へ",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect(),
            speaker_last_period_min_chars: 4,
            speaker_join_use_question_mark: true,
            speaker_question_endings: vec![],
            speaker_short_utterances_no_comma: HashSet::new(),
        }
    }
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct PersonHonorificRuleFile {
    named_person_honorific_pattern: Option<String>,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct UniversityRuleFile {
    named_university_pattern: Option<String>,
    named_elementary_school_pattern: Option<String>,
    named_middle_school_pattern: Option<String>,
    named_high_school_pattern: Option<String>,
    named_nursery_pattern: Option<String>,
    named_kindergarten_pattern: Option<String>,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct HospitalRuleFile {
    named_hospital_pattern: Option<String>,
    named_clinic_pattern: Option<String>,
    named_medical_office_pattern: Option<String>,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct OrganizationRuleFile {
    #[serde(default)]
    named_institution_patterns: Vec<String>,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct EntityRulesFile {
    #[serde(default)]
    person_names: Vec<String>,
    #[serde(default)]
    organization_names: Vec<String>,
    #[serde(default)]
    location_names: Vec<String>,
    #[serde(default)]
    station_names: Vec<String>,
    #[serde(default)]
    station_like_location_patterns: Vec<String>,
    #[serde(default)]
    regional_location_names: HashMap<String, RegionalLocationRuleFile>,
    person_honorific_rule: Option<PersonHonorificRuleFile>,
    university_rule: Option<UniversityRuleFile>,
    hospital_rule: Option<HospitalRuleFile>,
    organization_rule: Option<OrganizationRuleFile>,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct RegionalLocationRuleFile {
    #[serde(default)]
    location_names: Vec<String>,
    #[serde(default)]
    station_names: Vec<String>,
}

#[derive(Debug, Clone)]
struct PersonHonorificRule {
    pattern: Regex,
    excludes: HashSet<String>,
    candidate_patterns: Vec<Regex>,
    honorific_suffixes: Vec<String>,
    dictionary_name_continuation_pattern: Regex,
}

#[derive(Debug, Clone)]
struct UniversityRule {
    named_university_pattern: Regex,
    named_elementary_school_pattern: Regex,
    named_middle_school_pattern: Regex,
    named_high_school_pattern: Regex,
    named_nursery_pattern: Regex,
    named_kindergarten_pattern: Regex,
}

#[derive(Debug, Clone)]
struct HospitalRule {
    named_hospital_pattern: Regex,
    named_clinic_pattern: Regex,
    named_medical_office_pattern: Regex,
}

#[derive(Debug, Clone, Default)]
struct OrganizationRule {
    named_institution_patterns: Vec<Regex>,
}

#[derive(Debug, Clone)]
struct EntityRules {
    person_names: Vec<String>,
    person_name_set: HashSet<String>,
    organization_names: Vec<String>,
    location_names: HashSet<String>,
    station_names: HashSet<String>,
    station_like_location_patterns: Vec<Regex>,
    regional_location_names: HashMap<String, HashSet<String>>,
    regional_station_names: HashMap<String, HashSet<String>>,
    person_honorific_rule: PersonHonorificRule,
    university_rule: UniversityRule,
    hospital_rule: HospitalRule,
    organization_rule: OrganizationRule,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum LocationDetectionMode {
    CommonOnly,
    SelectedRegions,
}

#[derive(Debug, Clone)]
struct EntityLocationScope {
    mode: LocationDetectionMode,
    prefectures: HashSet<String>,
}

impl Default for EntityLocationScope {
    fn default() -> Self {
        Self {
            mode: LocationDetectionMode::CommonOnly,
            prefectures: HashSet::new(),
        }
    }
}

impl EntityLocationScope {
    fn from_request(request: Option<&LocationDetectionScopeRequest>) -> Self {
        let Some(request) = request else {
            return Self::default();
        };
        let mode = match request
            .mode
            .as_deref()
            .unwrap_or("commonOnly")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "selectedregions" | "selected_regions" => LocationDetectionMode::SelectedRegions,
            _ => LocationDetectionMode::CommonOnly,
        };
        let prefectures = request
            .prefectures
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .map(|v| v.trim().to_string())
            .filter(|v| is_valid_prefecture_code(v))
            .collect::<HashSet<_>>();
        Self { mode, prefectures }
    }

    fn selected_regions_enabled(&self) -> bool {
        self.mode == LocationDetectionMode::SelectedRegions && !self.prefectures.is_empty()
    }
}

fn is_valid_prefecture_code(value: &str) -> bool {
    value.len() == 2
        && value.chars().all(|c| c.is_ascii_digit())
        && value
            .parse::<u8>()
            .map(|n| (1..=47).contains(&n))
            .unwrap_or(false)
}

impl Default for EntityRules {
    fn default() -> Self {
        let hospital = Regex::new(r"$^").expect("default hospital regex");
        let clinic = Regex::new(r"$^").expect("default clinic regex");
        let medical_office = Regex::new(r"$^").expect("default medical office regex");
        let honorific_pattern = Regex::new(
            r"^(?:[一-龥々ァ-ヶー]{1,4}|[ぁ-ゖ]{2,4})(?:さん|氏|くん|君|ちゃん|先生|様)$",
        )
        .expect("default honorific regex");
        let uni = Regex::new(r"^[一-龥々ぁ-ゖァ-ヶーA-Za-z0-9０-９・･]{1,8}大学$")
            .expect("default university regex");
        let el =
            Regex::new(r"^[一-龥々ぁ-ゖァ-ヶーA-Za-z0-9０-９・･]{1,8}(?:小学校|義務教育学校)$")
                .expect("default elementary regex");
        let mid =
            Regex::new(r"^[一-龥々ぁ-ゖァ-ヶーA-Za-z0-9０-９・･]{1,8}(?:中学校|中等教育学校)$")
                .expect("default middle regex");
        let hi = Regex::new(r"^[一-龥々ぁ-ゖァ-ヶーA-Za-z0-9０-９・･]{1,8}(?:高校|高等学校)$")
            .expect("default high regex");
        let nu = Regex::new(
            r"^[一-龥々ぁ-ゖァ-ヶーA-Za-z0-9０-９・･]{1,8}(?:保育園|保育所|認定こども園|こども園)$",
        )
        .expect("default nursery regex");
        let kg = Regex::new(r"^[一-龥々ぁ-ゖァ-ヶーA-Za-z0-9０-９・･]{1,8}幼稚園$")
            .expect("default kindergarten regex");
        Self {
            person_names: vec![],
            person_name_set: HashSet::new(),
            organization_names: vec![],
            location_names: HashSet::new(),
            station_names: HashSet::new(),
            station_like_location_patterns: vec![],
            regional_location_names: HashMap::new(),
            regional_station_names: HashMap::new(),
            person_honorific_rule: PersonHonorificRule {
                pattern: honorific_pattern,
                excludes: HashSet::from_iter(
                    [
                        "みな",
                        "みんな",
                        "あなた",
                        "わたし",
                        "私",
                        "ぼく",
                        "僕",
                        "おれ",
                        "俺",
                    ]
                    .iter()
                    .map(|v| (*v).to_string()),
                ),
                candidate_patterns: vec![
                    Regex::new(r"([一-龥々ァ-ヶー]{1,4})(さん|氏|くん|君|ちゃん|先生|様)")
                        .expect("default honorific candidate regex 1"),
                    Regex::new(r"([ぁ-ゖ]{2,4})(さん|氏|くん|君|ちゃん|先生|様)")
                        .expect("default honorific candidate regex 2"),
                ],
                honorific_suffixes: vec![
                    "さん".to_string(),
                    "氏".to_string(),
                    "くん".to_string(),
                    "君".to_string(),
                    "ちゃん".to_string(),
                    "先生".to_string(),
                    "様".to_string(),
                ],
                dictionary_name_continuation_pattern: Regex::new(r"[A-Za-z0-9一-龥々ァ-ヶー]")
                    .expect("default dictionary continuation regex"),
            },
            university_rule: UniversityRule {
                named_university_pattern: uni,
                named_elementary_school_pattern: el,
                named_middle_school_pattern: mid,
                named_high_school_pattern: hi,
                named_nursery_pattern: nu,
                named_kindergarten_pattern: kg,
            },
            hospital_rule: HospitalRule {
                named_hospital_pattern: hospital,
                named_clinic_pattern: clinic,
                named_medical_office_pattern: medical_office,
            },
            organization_rule: OrganizationRule::default(),
        }
    }
}

#[derive(Debug, Default, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PunctuationRuntimeStats {
    calls: usize,
    model_unavailable: usize,
    model_load_errors: usize,
    inference_errors: usize,
    changed: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SensitiveEntityMeta {
    has_sensitive_entity: bool,
    kinds: Vec<String>,
    names: Vec<String>,
    person_names: Vec<String>,
    organization_names: Vec<String>,
    location_names: Vec<String>,
    person_detection_source: String,
}

#[derive(Debug, Clone, Copy)]
enum SensitiveEntitySourceList {
    None,
    PersonName,
    OrganizationName,
    LocationName,
}

#[derive(Debug, Default)]
struct SensitiveEntityCollector {
    names: Vec<String>,
    seen_names: HashSet<String>,
    kinds: HashSet<String>,
    person_sources: HashSet<String>,
    person_names: Vec<String>,
    seen_person_names: HashSet<String>,
    organization_names: Vec<String>,
    seen_organization_names: HashSet<String>,
    location_names: Vec<String>,
    seen_location_names: HashSet<String>,
}

impl SensitiveEntityCollector {
    fn add(
        &mut self,
        name: &str,
        kind: &str,
        person_source: Option<&str>,
        source_list: SensitiveEntitySourceList,
    ) {
        let normalized = name.trim().to_string();
        if normalized.is_empty() {
            return;
        }
        if self.seen_names.insert(normalized.clone()) {
            self.names.push(normalized.clone());
        }
        self.kinds.insert(kind.to_string());
        if kind == "person" {
            if let Some(source) = person_source {
                if !source.is_empty() {
                    self.person_sources.insert(source.to_string());
                }
            }
        }
        match source_list {
            SensitiveEntitySourceList::None => {}
            SensitiveEntitySourceList::PersonName => {
                if self.seen_person_names.insert(normalized.clone()) {
                    self.person_names.push(normalized);
                }
            }
            SensitiveEntitySourceList::OrganizationName => {
                if self.seen_organization_names.insert(normalized.clone()) {
                    self.organization_names.push(normalized);
                }
            }
            SensitiveEntitySourceList::LocationName => {
                if self.seen_location_names.insert(normalized.clone()) {
                    self.location_names.push(normalized);
                }
            }
        }
    }

    fn insert_kind(&mut self, kind: &str) {
        self.kinds.insert(kind.to_string());
    }

    fn finish(self) -> SensitiveEntityMeta {
        let person_detection_source = if self.person_sources.contains("dictionary")
            && self.person_sources.contains("honorific")
        {
            "mixed".to_string()
        } else if self.person_sources.contains("dictionary") {
            "dictionary".to_string()
        } else if self.person_sources.contains("honorific") {
            "honorific".to_string()
        } else {
            String::new()
        };
        let kind_order = ["person", "organization", "corporation", "location"];
        let mut ordered_kinds = Vec::new();
        for kind in kind_order {
            if self.kinds.contains(kind) {
                ordered_kinds.push(kind.to_string());
            }
        }
        SensitiveEntityMeta {
            has_sensitive_entity: !self.names.is_empty() && !ordered_kinds.is_empty(),
            kinds: ordered_kinds,
            names: self.names,
            person_names: self.person_names,
            organization_names: self.organization_names,
            location_names: self.location_names,
            person_detection_source,
        }
    }
}

#[derive(Debug, Deserialize)]
struct SaveTranscriptionJsonRequest {
    path: String,
    content: String,
    #[serde(default)]
    password: Option<String>,
}


#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AllSetupStatus {
    whisper_turbo: bool,
    diarization: bool,
    diarization_expected_path: String,
    gemma_gguf: bool,
    gemma_gguf_expected_path: String,
    gemma_mtp_gguf: bool,
    gemma_mtp_gguf_expected_path: String,
    llm_backend: bool,
    python_env: bool,
    python_env_expected_path: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EditorVoiceInputPackStatus {
    installed: bool,
    // Editor版・CPU版では true。CPU バックエンド（llama.cpp CPU ビルド）の導入が installed 判定に
    // 必要かどうかをフロントに伝える（Full版は GPU 直起動のため CPU バックエンド不要）。
    cpu_backend_required: bool,
    cpu_backend: bool,
    cpu_backend_expected_path: String,
    gemma_gguf: bool,
    gemma_gguf_expected_path: String,
    mmproj_gguf: bool,
    mmproj_gguf_expected_path: String,
    // Editor版・CPU版で音声入力パックに含める ffmpeg（LGPL・後付けDL）の状態。
    // 区間聞き直し削除後もこのパック項目は残しており、Full版は同梱 ffmpeg を使う。
    ffmpeg_required: bool,
    ffmpeg: bool,
    ffmpeg_expected_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorVoiceInputPackDeleteResponse {
    deleted: Vec<String>,
    not_found: Vec<String>,
    errors: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditorVoiceInputRequest {
    wav_base64: String,
    /// 文字起こし画面で選ばれた言語。旧フロントエンドからの呼び出しは日本語扱い。
    language: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorVoiceInputResponse {
    candidates: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SetupProgressPayload {
    component: String,
    status: String,
    message: String,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeEstimateLogSample {
    audio_seconds: f64,
    elapsed_seconds: f64,
    diarization: bool,
    device: String,
    compute_type: String,
    created_at: f64,
    #[serde(default)]
    file_size_bytes: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct SaveRuntimeEstimateCsvRequest {
    path: String,
    samples: Vec<RuntimeEstimateLogSample>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveTranscriptionDocxRow {
    time: String,
    speaker: String,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveTranscriptionDocxRequest {
    path: String,
    rows: Vec<SaveTranscriptionDocxRow>,
    #[serde(default)]
    password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveTranscriptionXlsxRequest {
    path: String,
    rows: Vec<SaveTranscriptionXlsxRow>,
    #[serde(default)]
    password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveTranscriptionXlsxRow {
    start: String,
    end: String,
    speaker: String,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveTranscriptionSrtRequest {
    path: String,
    rows: Vec<SaveTranscriptionSrtRow>,
    #[serde(default)]
    password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveTranscriptionSrtRow {
    start_seconds: f64,
    end_seconds: f64,
    speaker: String,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadTextFileRequest {
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadTextFileResponse {
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadFileSizeRequest {
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadFileSizeResponse {
    size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptionRuntimeStatusResponse {
    available: bool,
    reason: String,
}


struct SidecarExecResult {
    status: std::process::ExitStatus,
    stdout: String,
    stderr: String,
}




#[tauri::command]
fn save_transcription_json(
    request: SaveTranscriptionJsonRequest,
) -> Result<(), String> {
    write_transcription_json(&request)
}

/// パスワードがある場合は、メモリ上の JSON から直接 AES-256 ZIP を作って暗号文だけを書く
/// （平文の一時ファイルをディスクへ書かない）。
fn write_transcription_json(request: &SaveTranscriptionJsonRequest) -> Result<(), String> {
    if let Some(pw) = request.password.as_deref().filter(|p| !p.is_empty()) {
        let arcname = encrypted_export_arcname(&request.path, ".json")?;
        export_crypto::write_aes_zip_bytes(
            request.content.as_bytes(),
            Path::new(&request.path),
            &arcname,
            pw,
        )
    } else {
        fs::write(&request.path, &request.content)
            .map_err(|e| format!("JSON 保存に失敗しました: {e}"))
    }
}

/// メモリ上で組み立てた OOXML（DOCX / XLSX）を保存する。パスワードがある場合は
/// メモリ上で暗号化し、暗号文だけをディスクへ書く（平文をディスクへ書かない）。
fn write_ooxml_output(
    bytes: &[u8],
    path: &str,
    password: Option<&str>,
    label: &str,
) -> Result<(), String> {
    if let Some(pw) = password.filter(|p| !p.is_empty()) {
        export_crypto::write_encrypted_ooxml(bytes, Path::new(path), pw)
    } else {
        fs::write(path, bytes).map_err(|e| {
            format!("{label} ファイルの保存に失敗しました。保存先のフォルダと書き込み権限を確認してください: {e}")
        })
    }
}

fn runtime_csv_value_is_numeric(value: &str) -> bool {
    let bytes = value.trim().as_bytes();
    let mut index = usize::from(bytes.first() == Some(&b'-'));
    let integer_start = index;
    while bytes.get(index).is_some_and(u8::is_ascii_digit) {
        index += 1;
    }
    if index == integer_start {
        return false;
    }
    if bytes.get(index) == Some(&b'.') {
        index += 1;
        let fraction_start = index;
        while bytes.get(index).is_some_and(u8::is_ascii_digit) {
            index += 1;
        }
        if index == fraction_start {
            return false;
        }
    }
    index == bytes.len()
}

fn escape_runtime_csv_value(value: &str) -> String {
    let escaped = value.replace('"', "\"\"");
    if runtime_csv_value_is_numeric(value) {
        escaped
    } else {
        format!("\"{escaped}\"")
    }
}

fn format_runtime_log_japan_datetime(epoch_ms: f64) -> Result<String, String> {
    if !epoch_ms.is_finite() {
        return Err("所要時間ログの日時が不正です。".to_string());
    }
    // JavaScript の Date と同様に、ミリ秒の小数部はゼロ方向へ丸める。
    let epoch_ms = epoch_ms.trunc();
    if epoch_ms < i64::MIN as f64 || epoch_ms > i64::MAX as f64 {
        return Err("所要時間ログの日時が範囲外です。".to_string());
    }
    let utc = DateTime::<Utc>::from_timestamp_millis(epoch_ms as i64)
        .ok_or_else(|| "所要時間ログの日時が範囲外です。".to_string())?;
    let japan = FixedOffset::east_opt(9 * 60 * 60)
        .ok_or_else(|| "日本時間の設定に失敗しました。".to_string())?;
    Ok(utc
        .with_timezone(&japan)
        .format("%Y/%m/%d %H:%M:%S")
        .to_string())
}

fn format_runtime_log_duration(total_seconds: f64) -> String {
    let seconds = if total_seconds.is_finite() {
        total_seconds.max(0.0).round() as u64
    } else {
        0
    };
    format!("{}分{}秒", seconds / 60, seconds % 60)
}

fn format_runtime_log_file_size(bytes: Option<f64>) -> String {
    match bytes.filter(|value| value.is_finite() && *value >= 0.0) {
        Some(value) => format!("{:.2} MB", value / (1024.0 * 1024.0)),
        None => String::new(),
    }
}

fn build_runtime_estimate_csv(
    mut samples: Vec<RuntimeEstimateLogSample>,
) -> Result<String, String> {
    samples.sort_by(|a, b| a.created_at.total_cmp(&b.created_at));
    let mut rows = vec![vec![
        "日時".to_string(),
        "ファイル音声長".to_string(),
        "AI句読点付与までの所要時間".to_string(),
        "ファイルサイズ".to_string(),
        "話者分離".to_string(),
        "実行デバイス".to_string(),
        "計算方式".to_string(),
    ]];
    for sample in samples {
        rows.push(vec![
            format_runtime_log_japan_datetime(sample.created_at)?,
            format_runtime_log_duration(sample.audio_seconds),
            format_runtime_log_duration(sample.elapsed_seconds),
            format_runtime_log_file_size(sample.file_size_bytes),
            if sample.diarization {
                "あり"
            } else {
                "なし"
            }
            .to_string(),
            sample.device.to_uppercase(),
            sample.compute_type,
        ]);
    }
    Ok(rows
        .iter()
        .map(|row| {
            row.iter()
                .map(|value| escape_runtime_csv_value(value))
                .collect::<Vec<_>>()
                .join(",")
        })
        .collect::<Vec<_>>()
        .join("\n"))
}

#[tauri::command]
fn save_runtime_estimate_csv(request: SaveRuntimeEstimateCsvRequest) -> Result<(), String> {
    let content = build_runtime_estimate_csv(request.samples)?;
    let (bytes, _, _) = SHIFT_JIS.encode(&content);
    fs::write(&request.path, bytes.as_ref())
        .map_err(|e| format!("所要時間ログの保存に失敗しました: {e}"))
}

fn format_srt_timestamp(seconds: f64) -> String {
    let total_millis = if seconds.is_finite() {
        (seconds.max(0.0) * 1000.0).round() as u64
    } else {
        0
    };
    let hours = total_millis / 3_600_000;
    let minutes = (total_millis / 60_000) % 60;
    let secs = (total_millis / 1_000) % 60;
    let millis = total_millis % 1_000;
    format!("{hours:02}:{minutes:02}:{secs:02},{millis:03}")
}

fn build_transcription_srt(rows: &[SaveTranscriptionSrtRow]) -> String {
    let mut output = String::new();
    let mut cue_index = 1usize;
    for row in rows {
        let text = row.text.replace("\r\n", "\n").replace('\r', "\n");
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        let start_seconds = if row.start_seconds.is_finite() {
            row.start_seconds.max(0.0)
        } else {
            0.0
        };
        let end_seconds = if row.end_seconds.is_finite() {
            row.end_seconds.max(start_seconds)
        } else {
            start_seconds
        };
        let speaker = row.speaker.split_whitespace().collect::<Vec<_>>().join(" ");
        let cue_text = if speaker.is_empty() || speaker == "-" {
            text.to_string()
        } else {
            format!("{speaker}：{text}")
        };
        output.push_str(&format!(
            "{cue_index}\n{} --> {}\n{cue_text}\n\n",
            format_srt_timestamp(start_seconds),
            format_srt_timestamp(end_seconds),
        ));
        cue_index += 1;
    }
    output
}

#[tauri::command]
fn save_transcription_srt(
    request: SaveTranscriptionSrtRequest,
) -> Result<(), String> {
    write_transcription_srt(&request)
}

fn write_transcription_srt(request: &SaveTranscriptionSrtRequest) -> Result<(), String> {
    let content = build_transcription_srt(&request.rows);
    if let Some(pw) = request.password.as_deref().filter(|p| !p.is_empty()) {
        // JSON と同様に、メモリ上の SRT から直接 AES-256 暗号化 ZIP を作る（平文をディスクへ書かない）。
        let arcname = encrypted_export_arcname(&request.path, ".srt")?;
        export_crypto::write_aes_zip_bytes(
            content.as_bytes(),
            Path::new(&request.path),
            &arcname,
            pw,
        )
    } else {
        fs::write(&request.path, content.as_bytes())
            .map_err(|e| format!("SRT 保存に失敗しました: {e}"))
    }
}

#[tauri::command]
fn save_transcription_docx(
    request: SaveTranscriptionDocxRequest,
) -> Result<(), String> {
    write_transcription_docx(&request)
}

fn write_transcription_docx(request: &SaveTranscriptionDocxRequest) -> Result<(), String> {
    const DOCX_TIME_COL_W: usize = 1200;
    const DOCX_SPEAKER_COL_W: usize = 1400;
    const DOCX_TEXT_COL_W: usize = 7038;
    const DOCX_TABLE_TOTAL_W: usize = DOCX_TIME_COL_W + DOCX_SPEAKER_COL_W + DOCX_TEXT_COL_W;

    let content_types_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"#;

    let rels_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"#;

    let document_rels_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"#;

    let styles_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
</w:styles>"#;

    let core_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:dcmitype="http://purl.org/dc/dcmitype/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>文字起こし結果</dc:title>
  <dc:creator>Local Transcription for Therapy</dc:creator>
</cp:coreProperties>"#;

    let app_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Local Transcription for Therapy</Application>
</Properties>"#;

    let header_row = docx_table_row(
        ["時刻", "話者", "内容"],
        [DOCX_TIME_COL_W, DOCX_SPEAKER_COL_W, DOCX_TEXT_COL_W],
    );
    let body_rows = request
        .rows
        .iter()
        .map(|r| {
            let time_cell = docx_table_cell(&r.time, DOCX_TIME_COL_W, Some("bottom"));
            let speaker_cell = docx_table_cell(&r.speaker, DOCX_SPEAKER_COL_W, None);
            let text_cell = docx_table_cell(&r.text, DOCX_TEXT_COL_W, None);
            format!(r#"<w:tr>{time_cell}{speaker_cell}{text_cell}</w:tr>"#)
        })
        .collect::<Vec<_>>()
        .join("");

    let document_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>文字起こし結果</w:t></w:r>
    </w:p>
    <w:tbl>
      <w:tblPr>
        <w:tblStyle w:val="TableGrid"/>
        <w:tblW w:w="{DOCX_TABLE_TOTAL_W}" w:type="dxa"/>
        <w:tblLayout w:type="fixed"/>
      </w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w="{DOCX_TIME_COL_W}"/>
        <w:gridCol w:w="{DOCX_SPEAKER_COL_W}"/>
        <w:gridCol w:w="{DOCX_TEXT_COL_W}"/>
      </w:tblGrid>
      {header_row}
      {body_rows}
    </w:tbl>
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>
    </w:sectPr>
  </w:body>
</w:document>"#
    );

    // ZIP はメモリ上で組み立てる。保存先へは完成後に（パスワードがあれば暗号文だけを）書く。
    let mut zip = ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = FileOptions::default().compression_method(CompressionMethod::Deflated);

    zip.start_file("[Content_Types].xml", options)
        .map_err(|e| format!("DOCX 書き込みに失敗しました: {e}"))?;
    std::io::Write::write_all(&mut zip, content_types_xml.as_bytes())
        .map_err(|e| format!("DOCX 書き込みに失敗しました: {e}"))?;

    zip.start_file("_rels/.rels", options)
        .map_err(|e| format!("DOCX 書き込みに失敗しました: {e}"))?;
    std::io::Write::write_all(&mut zip, rels_xml.as_bytes())
        .map_err(|e| format!("DOCX 書き込みに失敗しました: {e}"))?;

    zip.start_file("docProps/core.xml", options)
        .map_err(|e| format!("DOCX 書き込みに失敗しました: {e}"))?;
    std::io::Write::write_all(&mut zip, core_xml.as_bytes())
        .map_err(|e| format!("DOCX 書き込みに失敗しました: {e}"))?;

    zip.start_file("docProps/app.xml", options)
        .map_err(|e| format!("DOCX 書き込みに失敗しました: {e}"))?;
    std::io::Write::write_all(&mut zip, app_xml.as_bytes())
        .map_err(|e| format!("DOCX 書き込みに失敗しました: {e}"))?;

    zip.start_file("word/document.xml", options)
        .map_err(|e| format!("DOCX 書き込みに失敗しました: {e}"))?;
    std::io::Write::write_all(&mut zip, document_xml.as_bytes())
        .map_err(|e| format!("DOCX 書き込みに失敗しました: {e}"))?;

    zip.start_file("word/styles.xml", options)
        .map_err(|e| format!("DOCX 書き込みに失敗しました: {e}"))?;
    std::io::Write::write_all(&mut zip, styles_xml.as_bytes())
        .map_err(|e| format!("DOCX 書き込みに失敗しました: {e}"))?;

    zip.start_file("word/_rels/document.xml.rels", options)
        .map_err(|e| format!("DOCX 書き込みに失敗しました: {e}"))?;
    std::io::Write::write_all(&mut zip, document_rels_xml.as_bytes())
        .map_err(|e| format!("DOCX 書き込みに失敗しました: {e}"))?;

    let bytes = zip
        .finish()
        .map_err(|e| format!("DOCX 生成の完了に失敗しました: {e}"))?
        .into_inner();

    write_ooxml_output(&bytes, &request.path, request.password.as_deref(), "Word")
}

#[tauri::command]
fn save_transcription_xlsx(
    request: SaveTranscriptionXlsxRequest,
) -> Result<(), String> {
    write_transcription_xlsx(&request)
}

fn write_transcription_xlsx(request: &SaveTranscriptionXlsxRequest) -> Result<(), String> {
    let content_types_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>"#;

    let rels_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#;

    let workbook_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="transcription" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>"#;

    let workbook_rels_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"#;

    let styles_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1">
    <font><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="2">
    <border/>
    <border>
      <left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
  </cellXfs>
</styleSheet>"#;

    let mut rows_xml = String::new();
    rows_xml.push_str(&xlsx_row_xml(1, ["開始時間", "終了時間", "話者", "内容"]));
    for (idx, row) in request.rows.iter().enumerate() {
        rows_xml.push_str(&xlsx_row_xml(
            (idx + 2) as u32,
            [&row.start, &row.end, &row.speaker, &row.text],
        ));
    }

    let sheet_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    <col min="4" max="4" width="50" customWidth="1"/>
  </cols>
  <sheetData>
    {rows_xml}
  </sheetData>
</worksheet>"#
    );

    // ZIP はメモリ上で組み立てる。保存先へは完成後に（パスワードがあれば暗号文だけを）書く。
    let mut zip = ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = FileOptions::default().compression_method(CompressionMethod::Deflated);

    zip.start_file("[Content_Types].xml", options)
        .map_err(|e| format!("XLSX 書き込みに失敗しました: {e}"))?;
    std::io::Write::write_all(&mut zip, content_types_xml.as_bytes())
        .map_err(|e| format!("XLSX 書き込みに失敗しました: {e}"))?;

    zip.start_file("_rels/.rels", options)
        .map_err(|e| format!("XLSX 書き込みに失敗しました: {e}"))?;
    std::io::Write::write_all(&mut zip, rels_xml.as_bytes())
        .map_err(|e| format!("XLSX 書き込みに失敗しました: {e}"))?;

    zip.start_file("xl/workbook.xml", options)
        .map_err(|e| format!("XLSX 書き込みに失敗しました: {e}"))?;
    std::io::Write::write_all(&mut zip, workbook_xml.as_bytes())
        .map_err(|e| format!("XLSX 書き込みに失敗しました: {e}"))?;

    zip.start_file("xl/_rels/workbook.xml.rels", options)
        .map_err(|e| format!("XLSX 書き込みに失敗しました: {e}"))?;
    std::io::Write::write_all(&mut zip, workbook_rels_xml.as_bytes())
        .map_err(|e| format!("XLSX 書き込みに失敗しました: {e}"))?;

    zip.start_file("xl/styles.xml", options)
        .map_err(|e| format!("XLSX 書き込みに失敗しました: {e}"))?;
    std::io::Write::write_all(&mut zip, styles_xml.as_bytes())
        .map_err(|e| format!("XLSX 書き込みに失敗しました: {e}"))?;

    zip.start_file("xl/worksheets/sheet1.xml", options)
        .map_err(|e| format!("XLSX 書き込みに失敗しました: {e}"))?;
    std::io::Write::write_all(&mut zip, sheet_xml.as_bytes())
        .map_err(|e| format!("XLSX 書き込みに失敗しました: {e}"))?;

    let bytes = zip
        .finish()
        .map_err(|e| format!("XLSX 生成の完了に失敗しました: {e}"))?
        .into_inner();

    write_ooxml_output(&bytes, &request.path, request.password.as_deref(), "Excel")
}

/// スコープ離脱時（早期 return・`?`・panic を含む）に登録済みの一時ファイルを
/// 必ず削除する RAII ガード。会話本文や校正プロンプトなど PII を含む一時ファイルの
/// 取り残しを防ぐ。
struct TempFileGuard {
    paths: Vec<PathBuf>,
}

const PRIVATE_TEMP_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// 専用一時領域のパス（作成はしない）。Windows では `%LOCALAPPDATA%\{identifier}\private-temp`
/// になる（NSIS のアンインストールフックが同じ場所を削除する）。
fn private_temp_dir_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("一時ファイル保存先を解決できませんでした: {e}"))?
        .join("private-temp"))
}

fn private_llm_temp_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = private_temp_dir_path(app)?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("一時ファイル保存先を作成できませんでした: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("一時ファイル保存先の権限設定に失敗しました: {e}"))?;
    }
    Ok(dir)
}

fn write_private_temp_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|e| format!("一時ファイルを安全に作成できませんでした: {e}"))?;
    file.write_all(contents)
        .map_err(|e| format!("一時ファイルの書き込みに失敗しました: {e}"))
}

/// 一時ファイル名の固定プレフィックス。直後に作成プロセスの PID と `-` が続く
/// （`lott-p{pid}-{tag}-{nanos}`）。
const PRIVATE_TEMP_PID_PREFIX: &str = "lott-p";

fn private_temp_name_for_pid(pid: u32, tag: &str) -> String {
    format!(
        "{PRIVATE_TEMP_PID_PREFIX}{pid}-{tag}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    )
}

/// 専用一時領域のファイル名。作成プロセスの PID を `lott-p{pid}-` の固定位置へ入れ、
/// 異常終了後の次回起動時に「持ち主が居なくなったファイル」を判定できるようにする。
fn private_temp_name(tag: &str) -> String {
    private_temp_name_for_pid(std::process::id(), tag)
}

/// `private_temp_name` が作ったファイル名から作成プロセスの PID を取り出す。
/// 旧形式（`lott-{tag}-{pid}-{nanos}` や `lott-playback-{hash}.flac`）や不正な形式は `None`。
fn private_temp_owner_pid(file_name: &str) -> Option<u32> {
    let rest = file_name.strip_prefix(PRIVATE_TEMP_PID_PREFIX)?;
    let digits = rest.find(|c: char| !c.is_ascii_digit())?;
    if digits == 0 || !rest[digits..].starts_with('-') {
        return None;
    }
    rest[..digits].parse().ok()
}

/// プロセスが生きているか。判定できないときは「生きている」側へ倒す（消しすぎない）。
#[cfg(windows)]
fn process_is_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_ACCESS_DENIED, STILL_ACTIVE,
    };
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    if pid == 0 {
        return false;
    }
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            // 権限不足は「存在するが開けない」。それ以外（引数不正など）は存在しない。
            return GetLastError() == ERROR_ACCESS_DENIED;
        }
        let mut exit_code = 0u32;
        let ok = GetExitCodeProcess(handle, &mut exit_code);
        CloseHandle(handle);
        ok == 0 || exit_code == STILL_ACTIVE as u32
    }
}

#[cfg(target_os = "linux")]
fn process_is_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    // /proc が無い環境では判定できないので、生きている扱いにする。
    if !Path::new("/proc/self").exists() {
        return true;
    }
    Path::new(&format!("/proc/{pid}")).exists()
}

#[cfg(all(unix, not(target_os = "linux")))]
fn process_is_alive(pid: u32) -> bool {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    // 0 や負値は kill(2) ではプロセスグループ指定になるため渡さない。
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    // SAFETY: シグナル 0 は存在確認だけで何も送らない。
    let rc = unsafe { kill(pid as i32, 0) };
    // EPERM（= 1）は「存在するが権限が無い」。
    rc == 0 || std::io::Error::last_os_error().raw_os_error() == Some(1)
}

/// 起動時クリーンアップで専用一時領域のファイルを消すか。
/// 次のいずれかなら消す: 24時間以上経過 / 所有 PID が取れない（旧形式）/ 所有プロセスが存在しない。
/// 自プロセスや、生きている別インスタンスのファイルは（24時間超を除き）残す。
/// PID の再利用で残ることは許容する（24時間経過の規則が最終的に回収する）。
fn should_remove_private_temp_file(
    owner_pid: Option<u32>,
    own_pid: u32,
    age: Option<Duration>,
    is_alive: impl Fn(u32) -> bool,
) -> bool {
    if age.is_some_and(|age| age >= PRIVATE_TEMP_MAX_AGE) {
        return true;
    }
    match owner_pid {
        None => true,
        Some(pid) if pid == own_pid => false,
        Some(pid) => !is_alive(pid),
    }
}

/// 通常ファイルとシンボリックリンク（ffmpeg 入力用リンク）だけを対象にする。
/// `DirEntry::file_type` はリンクを辿らないので、リンク先の元音声は消さない。
fn private_temp_entry_is_removable_kind(entry: &fs::DirEntry) -> bool {
    entry
        .file_type()
        .map(|kind| kind.is_file() || kind.is_symlink())
        .unwrap_or(false)
}

fn cleanup_stale_private_temp_dir(dir: &Path, own_pid: u32, is_alive: impl Fn(u32) -> bool) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if !private_temp_entry_is_removable_kind(&entry) {
            continue;
        }
        let name = entry.file_name();
        let age = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| modified.elapsed().ok());
        if should_remove_private_temp_file(
            private_temp_owner_pid(&name.to_string_lossy()),
            own_pid,
            age,
            &is_alive,
        ) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// 旧版が OS の一時フォルダへ作った会話データのファイルの既知プレフィックス。
const LEGACY_OS_TEMP_PREFIXES: &[&str] = &[
    "lott_llm_segments_",
    "lott_llm_system_prompt_",
    "lott_overall_segments_",
    "lott_overall_system_prompt_",
    "lott-playback-",
    "lott_diar_",
];

/// 旧版が OS の一時フォルダへ残した会話データのファイルを、経過時間に関係なく消す。
/// 現行版はこの場所へ会話データを置かない（専用一時領域だけを使う）。
fn cleanup_legacy_os_temp_files(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let is_regular_file = entry
            .file_type()
            .map(|kind| kind.is_file())
            .unwrap_or(false);
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if is_regular_file
            && LEGACY_OS_TEMP_PREFIXES
                .iter()
                .any(|prefix| name.starts_with(prefix))
        {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// 起動時に、異常終了などで残った一時ファイルを回収する。
fn cleanup_stale_private_temp_files(app: &AppHandle) {
    if let Ok(dir) = private_llm_temp_dir(app) {
        cleanup_stale_private_temp_dir(&dir, std::process::id(), process_is_alive);
    }
    cleanup_legacy_os_temp_files(&env::temp_dir());
}

/// 自プロセスが作った専用一時領域のファイル（再生用キャッシュを含む）を消す。
fn cleanup_own_private_temp_dir(dir: &Path, own_pid: u32) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if private_temp_entry_is_removable_kind(&entry)
            && private_temp_owner_pid(&entry.file_name().to_string_lossy()) == Some(own_pid)
        {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// アプリ終了時の後始末。
fn cleanup_own_private_temp_files(app: &AppHandle) {
    if let Ok(dir) = private_temp_dir_path(app) {
        cleanup_own_private_temp_dir(&dir, std::process::id());
    }
}

impl TempFileGuard {
    fn new() -> Self {
        Self { paths: Vec::new() }
    }

    fn push(&mut self, path: PathBuf) {
        self.paths.push(path);
    }
}

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        for path in &self.paths {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn encrypted_export_arcname(output_path: &str, extension: &str) -> Result<String, String> {
    let stem = Path::new(output_path)
        .file_stem()
        .and_then(OsStr::to_str)
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "保存先のファイル名から ZIP 内のファイル名を決められませんでした。ファイル名を確認してください。".to_string())?;
    Ok(format!("{stem}{extension}"))
}

// A minimal HTTP/1.1 server bound to 127.0.0.1 that serves local audio files
// with Range request support. This lets GStreamer (WebKitGTK media backend)
// seek by making byte-range requests, which blob URLs cannot provide.

struct AudioStreamServer {
    port: u16,
    token: String,
    /// 実際に HTTP 配信するファイル。元ファイルと同じか、再生用に変換したキャッシュ。
    playback_path: Arc<Mutex<Option<String>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioStreamInfo {
    port: u16,
    token: String,
}

fn generate_audio_stream_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Security::Cryptography::{
            BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        };
        let status = unsafe {
            BCryptGenRandom(
                std::ptr::null_mut(),
                bytes.as_mut_ptr(),
                bytes.len() as u32,
                BCRYPT_USE_SYSTEM_PREFERRED_RNG,
            )
        };
        if status < 0 {
            return Err(format!(
                "音声配信用トークンを生成できませんでした: {status}"
            ));
        }
    }
    #[cfg(unix)]
    {
        let mut source = fs::File::open("/dev/urandom")
            .map_err(|e| format!("音声配信用乱数を取得できませんでした: {e}"))?;
        source
            .read_exact(&mut bytes)
            .map_err(|e| format!("音声配信用乱数を読み取れませんでした: {e}"))?;
    }
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn constant_time_token_eq(actual: &str, expected: &str) -> bool {
    if actual.len() != expected.len() {
        return false;
    }
    actual
        .as_bytes()
        .iter()
        .zip(expected.as_bytes())
        .fold(0u8, |diff, (left, right)| diff | (left ^ right))
        == 0
}

fn audio_mime(ext: &str) -> &'static str {
    match ext {
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" | "mp4" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "ogg" => "audio/ogg",
        "webm" => "audio/webm",
        _ => "application/octet-stream",
    }
}

fn url_decode_path(s: &str) -> String {
    let mut out = Vec::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (
                (bytes[i + 1] as char).to_digit(16),
                (bytes[i + 2] as char).to_digit(16),
            ) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn serve_audio_connection(
    mut stream: std::net::TcpStream,
    playback_path: Arc<Mutex<Option<String>>>,
    expected_token: Arc<String>,
) {
    use std::io::{Read, Seek, SeekFrom, Write};

    let mut buf = vec![0u8; 8192];
    let n = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return,
    };
    let request = String::from_utf8_lossy(&buf[..n]);

    // ── Parse request line ──
    let first_line = request.lines().next().unwrap_or("");
    let parts: Vec<&str> = first_line.splitn(3, ' ').collect();

    let request_target = parts.get(1).copied().unwrap_or("");
    let (encoded_path, query) = request_target
        .split_once('?')
        .unwrap_or((request_target, ""));
    let supplied_token = query
        .split('&')
        .find_map(|part| part.strip_prefix("token="))
        .unwrap_or("");
    if !constant_time_token_eq(supplied_token, expected_token.as_str()) {
        let _ = stream.write_all(b"HTTP/1.1 403 Forbidden\r\nCache-Control: no-store\r\n\r\n");
        return;
    }

    // Respond to CORS preflight after authenticating the request URL.
    if parts.first().copied() == Some("OPTIONS") {
        let _ = stream.write_all(
            b"HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Range\r\n\r\n",
        );
        return;
    }
    if parts.first().copied() != Some("GET") || parts.len() < 2 {
        let _ = stream.write_all(b"HTTP/1.1 405 Method Not Allowed\r\n\r\n");
        return;
    }

    let url_path = encoded_path.trim_start_matches('/');
    let file_path = url_decode_path(url_path);

    // 登録済みパスと一致するか確認（パストラバーサル防止）
    let allowed = {
        let guard = playback_path.lock().unwrap_or_else(|e| e.into_inner());
        guard.clone()
    };
    let is_allowed = allowed
        .as_deref()
        .map(|a| {
            let req = std::fs::canonicalize(&file_path).ok();
            let all = std::fs::canonicalize(a).ok();
            req.is_some() && req == all
        })
        .unwrap_or(false);
    if !is_allowed {
        let _ = stream.write_all(b"HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
    }

    let metadata = match fs::metadata(&file_path) {
        Ok(m) if m.is_file() => m,
        _ => {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\n\r\n");
            return;
        }
    };
    let total_len = metadata.len();

    // ── Parse Range header ──
    let range_opt = request
        .lines()
        .find(|l| l.to_ascii_lowercase().starts_with("range:"))
        .and_then(|l| {
            let val = l.splitn(2, ':').nth(1)?.trim();
            let val = val.strip_prefix("bytes=")?;
            let mut it = val.splitn(2, '-');
            let start: u64 = it.next()?.trim().parse().ok()?;
            let end_str = it.next().unwrap_or("").trim();
            let end: u64 = if end_str.is_empty() {
                total_len.saturating_sub(1)
            } else {
                end_str.parse().ok()?
            };
            Some((start, end.min(total_len.saturating_sub(1))))
        });

    if let Some((s, _)) = range_opt {
        if s >= total_len {
            let _ = stream.write_all(
                format!("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{total_len}\r\n\r\n")
                    .as_bytes(),
            );
            return;
        }
    }

    let (start, end) = range_opt.unwrap_or((0, total_len.saturating_sub(1)));
    let content_len = end.saturating_sub(start) + 1;

    let ext = Path::new(&file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = audio_mime(&ext);
    let status = if range_opt.is_some() {
        "206 Partial Content"
    } else {
        "200 OK"
    };

    let header = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: {mime}\r\n\
         Content-Length: {content_len}\r\n\
         Content-Range: bytes {start}-{end}/{total_len}\r\n\
         Accept-Ranges: bytes\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Cache-Control: no-store\r\n\
         \r\n"
    );

    if stream.write_all(header.as_bytes()).is_err() {
        return;
    }

    let mut file = match fs::File::open(&file_path) {
        Ok(f) => f,
        Err(_) => return,
    };
    if file.seek(SeekFrom::Start(start)).is_err() {
        return;
    }

    let mut remaining = content_len as usize;
    let mut chunk = vec![0u8; 65536];
    while remaining > 0 {
        let to_read = remaining.min(chunk.len());
        match file.read(&mut chunk[..to_read]) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if stream.write_all(&chunk[..n]).is_err() {
                    break;
                }
                remaining -= n;
            }
        }
    }
}

fn start_audio_stream_server(playback_path: Arc<Mutex<Option<String>>>, token: Arc<String>) -> u16 {
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0").expect("audio stream server bind failed");
    let port = listener
        .local_addr()
        .expect("audio stream server addr")
        .port();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let ap = Arc::clone(&playback_path);
            let request_token = Arc::clone(&token);
            thread::spawn(move || serve_audio_connection(stream, ap, request_token));
        }
    });
    port
}

#[tauri::command]
fn get_audio_stream_info(state: tauri::State<'_, AudioStreamServer>) -> AudioStreamInfo {
    AudioStreamInfo {
        port: state.port,
        token: state.token.clone(),
    }
}

// ─── Audio probing / playback transcoding ────────────────────────────────────
// WebKitGTK（Linux）のメディア再生は GStreamer に依存し、配布 AppImage には
// LGPL のプラグインしか同梱しない（AGENTS.md のライセンス方針）。そのため AAC 等
// LGPL 側にデコーダが無いコーデックは、同梱 LGPL ffmpeg で FLAC へ変換してから配信する。
// また再生時間の取得も WebView のメディアバックエンドに依存させず ffmpeg で行う。

#[derive(Default)]
struct FfmpegAudioProbe {
    duration_seconds: Option<f64>,
    audio_codec: Option<String>,
}

/// GStreamer の base/good（LGPL）だけで確実にデコードできるコーデック。
fn codec_is_directly_playable(codec: &str) -> bool {
    codec.starts_with("pcm_")
        || matches!(
            codec,
            "mp3" | "mp3float" | "flac" | "vorbis" | "opus" | "wavpack"
        )
}

fn parse_ffmpeg_duration_line(line: &str) -> Option<f64> {
    let rest = line.trim().strip_prefix("Duration:")?.trim_start();
    let value = rest.split(',').next()?.trim();
    if value.starts_with("N/A") {
        return None;
    }
    let mut parts = value.split(':');
    let hours: f64 = parts.next()?.trim().parse().ok()?;
    let minutes: f64 = parts.next()?.trim().parse().ok()?;
    let seconds: f64 = parts.next()?.trim().parse().ok()?;
    let total = hours * 3600.0 + minutes * 60.0 + seconds;
    (total.is_finite() && total > 0.0).then_some(total)
}

fn parse_ffmpeg_audio_codec_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if !trimmed.starts_with("Stream #") {
        return None;
    }
    let after = trimmed.split_once("Audio: ")?.1;
    let codec = after
        .split([' ', ','])
        .find(|token| !token.is_empty())?
        .to_ascii_lowercase();
    (!codec.is_empty()).then_some(codec)
}

/// ffmpeg の入力指定（`-protocol_whitelist file -i <入力>`）。
/// 利用者が選んだ音声はローカルファイルだけを開かせる。`-protocol_whitelist` は入力オプション
/// なので `-i` の直前に置く（出力側の `-progress pipe:1` には影響しない）。同梱 ffmpeg は既定でも
/// ローカルのプレイリストから http を開かないが、PATH 上の古い ffmpeg に備えた多層防御。
fn ffmpeg_input_args(input: &Path) -> Vec<std::ffi::OsString> {
    vec![
        "-protocol_whitelist".into(),
        "file".into(),
        "-i".into(),
        input.as_os_str().to_os_string(),
    ]
}

const REDACTED_AUDIO_PATH: &str = "<音声ファイル>";

/// ffmpeg の stderr に含まれる入力パス（元のパス・ffmpeg へ渡したリンクのパス。Windows では
/// `\` と `/` の両表記）を伏せる。ファイル名にクライアントの氏名が入りうるため、
/// 画面やログへ出すエラー文に元の音声のパスを残さない。
fn redact_audio_paths(text: &str, paths: &[&str]) -> String {
    let mut variants: Vec<String> = Vec::new();
    for path in paths.iter().filter(|path| !path.is_empty()) {
        for variant in [
            path.to_string(),
            path.replace('\\', "/"),
            path.replace('/', "\\"),
        ] {
            if !variants.contains(&variant) {
                variants.push(variant);
            }
        }
    }
    // 長い方を先に置換し、短いパスが長いパスの一部だけを置換して残骸を作らないようにする。
    variants.sort_by_key(|variant| std::cmp::Reverse(variant.len()));
    variants
        .iter()
        .fold(text.to_string(), |acc, variant| {
            acc.replace(variant.as_str(), REDACTED_AUDIO_PATH)
        })
}

/// 中立なリンク名。拡張子は ffmpeg の形式判定のために残すが、英数字だけを許可する。
#[cfg(any(unix, test))]
fn neutral_input_link_name(base_name: &str, audio_path: &str) -> String {
    let extension = Path::new(audio_path)
        .extension()
        .and_then(OsStr::to_str)
        .filter(|ext| {
            !ext.is_empty() && ext.len() <= 8 && ext.chars().all(|c| c.is_ascii_alphanumeric())
        });
    match extension {
        Some(ext) => format!("{base_name}.{ext}"),
        None => base_name.to_string(),
    }
}

/// ffmpeg に渡す入力パスを用意する。
///
/// Unix: 専用一時領域（0700）に中立な名前のシンボリックリンク `lott-p{pid}-input-{nanos}.{ext}`
/// を作って元ファイルを指させ、そのリンクのパスを返す。ffmpeg の引数は `ps` や
/// /proc/*/cmdline から他ユーザーにも見えるため、クライアントの氏名が入りうる元のパスを
/// 引数に出さない。リンクは `guard` が必ず消す。作れないときは元のパスへ戻す。
#[cfg(unix)]
fn prepare_ffmpeg_input_in(dir: &Path, audio_path: &str, guard: &mut TempFileGuard) -> PathBuf {
    let original = PathBuf::from(audio_path);
    let Ok(target) = fs::canonicalize(&original) else {
        return original;
    };
    let link = dir.join(neutral_input_link_name(
        &private_temp_name("input"),
        audio_path,
    ));
    match std::os::unix::fs::symlink(&target, &link) {
        Ok(()) => {
            guard.push(link.clone());
            link
        }
        Err(_) => original,
    }
}

/// Windows: 元のパスのまま渡す。他ユーザーのプロセスのコマンドラインは通常の権限では読めず、
/// シンボリックリンクの作成には特権（開発者モードや管理者）が要るため、一般の利用者環境では
/// リンクを使えない。
#[cfg(not(unix))]
fn prepare_ffmpeg_input_in(_dir: &Path, audio_path: &str, _guard: &mut TempFileGuard) -> PathBuf {
    PathBuf::from(audio_path)
}

fn prepare_ffmpeg_input(app: &AppHandle, audio_path: &str, guard: &mut TempFileGuard) -> PathBuf {
    match private_llm_temp_dir(app) {
        Ok(dir) => prepare_ffmpeg_input_in(&dir, audio_path, guard),
        Err(_) => PathBuf::from(audio_path),
    }
}

/// ffmpeg の stderr を、元の音声のパスを伏せたうえでエラー文へ載せられる形にする。
fn redacted_ffmpeg_stderr(stderr: &str, audio_path: &str, ffmpeg_input: &Path) -> String {
    redact_audio_paths(stderr, &[audio_path, &ffmpeg_input.to_string_lossy()])
}

/// `ffmpeg -i <path>` の stderr から再生時間と音声コーデックを読む。
/// 入力のみ指定した ffmpeg は "At least one output file must be specified" で
/// 非ゼロ終了するが、その前にストリーム情報を出力するので終了コードは見ない。
fn probe_audio_with_ffmpeg(app: &AppHandle, path: &str) -> Result<FfmpegAudioProbe, String> {
    let ffmpeg = resolve_ffmpeg_bin_for_segment_cut(app)
        .ok_or_else(|| "音声情報の取得に必要な ffmpeg が見つかりませんでした。".to_string())?;
    if !Path::new(path).exists() {
        return Err("音声ファイルが見つかりません。".to_string());
    }
    let mut link_guard = TempFileGuard::new();
    let input = prepare_ffmpeg_input(app, path, &mut link_guard);
    let mut cmd = Command::new(&ffmpeg);
    // 同梱 ffmpeg は libc/libm しか要求しないため、AppDir 環境を渡さない方が安全
    // （PATH 解決した場合はホスト ffmpeg なので必須）。
    apply_host_command_env(&mut cmd);
    // -nostdin: 端末が無い状況で入力待ちに落ちて固まらないようにする。
    cmd.arg("-hide_banner")
        .arg("-nostdin")
        .args(ffmpeg_input_args(&input));
    apply_windows_no_window(&mut cmd);
    let output = output_in_kill_job(&mut cmd)
        .map_err(|e| format!("ffmpeg の起動に失敗しました: {e}"))?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut probe = FfmpegAudioProbe::default();
    for line in stderr.lines() {
        if probe.duration_seconds.is_none() {
            probe.duration_seconds = parse_ffmpeg_duration_line(line);
        }
        if probe.audio_codec.is_none() {
            probe.audio_codec = parse_ffmpeg_audio_codec_line(line);
        }
    }
    if probe.duration_seconds.is_none() && probe.audio_codec.is_none() {
        let stderr = redacted_ffmpeg_stderr(&stderr, path, &input);
        return Err(format!(
            "音声情報を読み取れませんでした: {}",
            stderr.lines().last().unwrap_or("").trim()
        ));
    }
    Ok(probe)
}

/// 再生時間（秒）を同梱 LGPL ffmpeg で取得する。WebView のメディア再生可否に依存しない。
#[tauri::command]
async fn get_audio_duration_seconds(app: AppHandle, path: String) -> Result<f64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        probe_audio_with_ffmpeg(&app, &path)?
            .duration_seconds
            .ok_or_else(|| "再生時間を取得できませんでした。".to_string())
    })
    .await
    .map_err(|e| format!("再生時間の取得タスクエラー: {e}"))?
}

fn playback_cache_path(app: &AppHandle, source: &str) -> Result<PathBuf, String> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let metadata = fs::metadata(source).map_err(|e| format!("音声ファイルを読めません: {e}"))?;
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    if let Ok(modified) = metadata.modified() {
        if let Ok(epoch) = modified.duration_since(std::time::UNIX_EPOCH) {
            epoch.as_secs().hash(&mut hasher);
        }
    }
    // 名前に作成プロセスの PID を入れる。同じセッション内では同じパスなので再利用でき、
    // 異常終了後は次回起動時に持ち主不在として回収され、通常終了時は終了処理が消す。
    Ok(private_llm_temp_dir(app)?.join(format!(
        "{PRIVATE_TEMP_PID_PREFIX}{}-playback-{:016x}.flac",
        std::process::id(),
        hasher.finish()
    )))
}

/// 再生用に FLAC へ変換する。FLAC は可逆・シーク可能で、デコーダが LGPL の
/// gst-plugins-good に含まれるため、配布方針を崩さずに AAC 等を再生できる。
fn transcode_for_playback(
    app: &AppHandle,
    source: &str,
    dest: &Path,
    duration_seconds: Option<f64>,
) -> Result<(), String> {
    let ffmpeg = resolve_ffmpeg_bin_for_segment_cut(app)
        .ok_or_else(|| "再生用の変換に必要な ffmpeg が見つかりませんでした。".to_string())?;
    let partial = dest.with_extension("flac.part");
    let _ = fs::remove_file(&partial);
    let mut guard = TempFileGuard::new();
    guard.push(partial.clone());
    // 変換先を 0600 で先に作ってから ffmpeg に上書きさせる。ffmpeg 任せだと umask 次第で
    // 0644 になり、臨床音声のデコード済みコピーが
    // 他ユーザーから読める権限で残りうる。
    // ここは best-effort。前回のクラッシュで残った .part を消せない等で作成に失敗しても、
    // ffmpeg の `-y` で上書きできるので変換自体は止めない（最終ファイルの権限はリネーム前に
    // もう一度 0600 へ寄せる）。
    let _ = write_private_temp_file(&partial, b"");

    // リンクは成功時に `guard.paths.clear()` で空にされる guard とは別に持ち、必ず消す。
    let mut link_guard = TempFileGuard::new();
    let input = prepare_ffmpeg_input(app, source, &mut link_guard);
    let mut cmd = Command::new(&ffmpeg);
    // 同梱 ffmpeg は libc/libm しか要求しないため、AppDir 環境を渡さない方が安全
    // （PATH 解決した場合はホスト ffmpeg なので必須）。
    apply_host_command_env(&mut cmd);
    cmd.arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-nostdin")
        .arg("-y")
        .args(ffmpeg_input_args(&input))
        .arg("-vn")
        .arg("-map")
        .arg("0:a:0")
        .arg("-c:a")
        .arg("flac")
        // AAC などは fltp でデコードされ、既定では 24bit FLAC になってキャッシュが無駄に太る。
        // このキャッシュは再生専用（文字起こしは常に元ファイルを使う）なので 16bit で足りる。
        .arg("-sample_fmt")
        .arg("s16")
        .arg("-compression_level")
        .arg("5")
        .arg("-progress")
        .arg("pipe:1")
        .arg("-nostats")
        .arg("-f")
        .arg("flac")
        .arg(&partial)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_windows_no_window(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("ffmpeg の起動に失敗しました: {e}"))?;
    assign_to_kill_on_close_job(&child);

    let _ = app.emit(
        "playback-transcode-progress",
        serde_json::json!({"state": "start", "percent": 0}),
    );
    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        let mut last_percent = -1i64;
        for line in reader.lines().map_while(Result::ok) {
            let Some(micros) = line.trim().strip_prefix("out_time_ms=") else {
                continue;
            };
            let Ok(micros) = micros.trim().parse::<i64>() else {
                continue;
            };
            // out_time_ms は名前に反してマイクロ秒。
            let Some(total) = duration_seconds.filter(|d| *d > 0.0) else {
                continue;
            };
            let percent = (((micros as f64 / 1_000_000.0) / total) * 100.0).clamp(0.0, 99.0) as i64;
            if percent > last_percent {
                last_percent = percent;
                let _ = app.emit(
                    "playback-transcode-progress",
                    serde_json::json!({"state": "progress", "percent": percent}),
                );
            }
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("ffmpeg の実行に失敗しました: {e}"))?;
    let finish = |result: &Result<(), String>| {
        let _ = app.emit(
            "playback-transcode-progress",
            serde_json::json!({
                "state": if result.is_ok() { "done" } else { "error" },
                "percent": 100,
            }),
        );
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let result = Err(format!(
            "再生用の音声変換に失敗しました: {}",
            redacted_ffmpeg_stderr(&stderr, source, &input).trim()
        ));
        finish(&result);
        return result;
    }
    // ffmpeg が出力先を作り直した場合に備え、リネーム前にもう一度 0600 へ寄せる。
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&partial, fs::Permissions::from_mode(0o600));
    }
    let result =
        fs::rename(&partial, dest).map_err(|e| format!("変換した音声の保存に失敗しました: {e}"));
    if result.is_ok() {
        guard.paths.clear();
    }
    finish(&result);
    result
}

/// 再生に使うファイルパスを決めて配信を許可する。必要なら FLAC へ変換したキャッシュを返す。
/// 長時間ファイルの変換で UI を止めないよう、実処理は blocking スレッドで動かす。
#[tauri::command]
async fn prepare_playback_source(
    app: AppHandle,
    path: String,
    state: tauri::State<'_, AudioStreamServer>,
) -> Result<String, String> {
    let playback_path_arc = Arc::clone(&state.playback_path);
    tauri::async_runtime::spawn_blocking(move || {
        prepare_playback_source_blocking(app, path, playback_path_arc)
    })
    .await
    .map_err(|e| format!("再生準備タスクエラー: {e}"))?
}

fn prepare_playback_source_blocking(
    app: AppHandle,
    path: String,
    playback_path_arc: Arc<Mutex<Option<String>>>,
) -> Result<String, String> {
    if path.is_empty() {
        return Err("音声ファイルが指定されていません。".to_string());
    }
    let mut served = path.clone();
    // Windows(WebView2) と macOS は AAC を含めて WebView 側でデコードできるため変換しない。
    // 変換が要るのは GStreamer に LGPL プラグインしか無い Linux だけ。
    if cfg!(target_os = "linux") {
        // 判定できないとき（ffmpeg 不在・解析失敗）は従来どおり元ファイルをそのまま配信する。
        if let Ok(probe) = probe_audio_with_ffmpeg(&app, &path) {
            let needs_transcode = probe
                .audio_codec
                .as_deref()
                .map(|codec| !codec_is_directly_playable(codec))
                .unwrap_or(false);
            if needs_transcode {
                let cache = playback_cache_path(&app, &path)?;
                let cached_ready = fs::metadata(&cache).map(|m| m.len() > 0).unwrap_or(false);
                if !cached_ready {
                    transcode_for_playback(&app, &path, &cache, probe.duration_seconds)?;
                }
                served = cache.to_string_lossy().into_owned();
            }
        }
    }

    let mut guard = playback_path_arc.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(served.clone());
    Ok(served)
}

#[tauri::command]
fn get_dev_demo_data_dir() -> Option<String> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("demo_data");
    if candidate.exists() {
        candidate
            .canonicalize()
            .ok()
            .map(|p| p.to_string_lossy().into_owned())
    } else {
        None
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DevDeleteModelsResponse {
    deleted: Vec<String>,
    not_found: Vec<String>,
    errors: Vec<String>,
}

#[tauri::command]
fn dev_delete_downloaded_models(app: AppHandle, target: Option<String>) -> DevDeleteModelsResponse {
    if !cfg!(debug_assertions) {
        return DevDeleteModelsResponse {
            deleted: vec![],
            not_found: vec![],
            errors: vec!["dev ビルドでのみ使用できます".to_string()],
        };
    }

    // セットアップの動きを確かめるため、取得済みの ggml モデル（音声認識・話者分離）を消す。
    let target = target.as_deref().unwrap_or("all");
    let mut deleted: Vec<String> = vec![];
    let mut not_found: Vec<String> = vec![];
    let mut errors: Vec<String> = vec![];
    let models_root = match resolve_ggml_models_root(&app) {
        Ok(root) => root,
        Err(e) => {
            errors.push(e);
            return DevDeleteModelsResponse {
                deleted,
                not_found,
                errors,
            };
        }
    };
    for model in ggml_speech::GGML_MODEL_FILES.iter() {
        if target != "all" && target != model.component {
            continue;
        }
        let path = model.path(&models_root);
        if path.exists() {
            match fs::remove_file(&path) {
                Ok(_) => deleted.push(path.to_string_lossy().into_owned()),
                Err(e) => errors.push(format!("{}: {e}", path.display())),
            }
        } else {
            not_found.push(path.to_string_lossy().into_owned());
        }
    }

    DevDeleteModelsResponse {
        deleted,
        not_found,
        errors,
    }
}

// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn read_text_file(request: ReadTextFileRequest) -> Result<ReadTextFileResponse, String> {
    let content = read_text_file_content(Path::new(&request.path))?;
    Ok(ReadTextFileResponse { content })
}

fn read_text_file_content(path: &Path) -> Result<String, String> {
    let bytes =
        fs::read(path).map_err(|e| format!("テキストファイル読み込みに失敗しました: {e}"))?;
    let content = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        String::from_utf8_lossy(&bytes[3..]).to_string()
    } else {
        String::from_utf8_lossy(&bytes).to_string()
    };
    Ok(content)
}





#[tauri::command]
fn read_file_size(request: ReadFileSizeRequest) -> Result<ReadFileSizeResponse, String> {
    let metadata = fs::metadata(&request.path)
        .map_err(|e| format!("ファイルサイズ取得に失敗しました: {e}"))?;
    Ok(ReadFileSizeResponse {
        size_bytes: metadata.len(),
    })
}

#[tauri::command]
async fn check_transcription_runtime_support(
    app: AppHandle,
    retry: Option<bool>,
) -> Result<TranscriptionRuntimeStatusResponse, String> {
    // CTranslate2/PyTorch の import + GPU 初期化を伴う Python サブプロセスは数秒かかる
    // ため、メインスレッド（UI スレッド）で実行すると UI が固まる。spawn_blocking で
    // ワーカースレッドへ逃がし、UI を止めずに再確認できるようにする。
    tauri::async_runtime::spawn_blocking(move || {
        check_transcription_runtime_support_blocking(app, retry.unwrap_or(false))
    })
    .await
    .map_err(|e| format!("GPU ランタイム確認タスクの実行に失敗しました: {e}"))?
}








fn check_transcription_runtime_support_blocking(
    app: AppHandle,
    _retry: bool,
) -> Result<TranscriptionRuntimeStatusResponse, String> {
    // 同梱の ggml エンジンで動く（GPU が無ければ CPU）。ファイルの有無だけを確かめる。
    let paths = resolve_ggml_speech_paths(&app)?;
    let mut missing = Vec::new();
    if !paths.whisper_cli.is_file() {
        missing.push(paths.whisper_cli.display().to_string());
    }
    if !paths.nemo_speech.is_file() {
        missing.push(paths.nemo_speech.display().to_string());
    }
    Ok(if missing.is_empty() {
        TranscriptionRuntimeStatusResponse {
            available: true,
            reason: String::new(),
        }
    } else {
        TranscriptionRuntimeStatusResponse {
            available: false,
            reason: format!(
                "文字起こし・話者分離のエンジンが見つかりません。アプリを再インストールしてください。\n不足: {}",
                missing.join(" / ")
            ),
        }
    })
}

fn xml_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}



/// 旧 LoTT リリース（faster-whisper 版）が HF Hub キャッシュを置いていたアプリ専用ディレクトリ。
/// 旧データの一覧・削除はここだけを対象にする。`HF_HUB_CACHE` / `HF_HOME` は見ない:
/// それらは他のアプリと共用のキャッシュを指すことが多く、削除ボタンで他アプリのモデルまで
/// 消してしまうため。
fn legacy_app_hf_hub_dir(app_local_data_dir: &Path) -> PathBuf {
    app_local_data_dir.join("hf_cache").join("hub")
}

/// 旧データ候補のうち、アプリ専用 HF Hub キャッシュ内の旧 faster-whisper モデルのディレクトリ。
fn legacy_faster_whisper_model_dirs(hub: &Path) -> Vec<(String, PathBuf)> {
    let Ok(entries) = fs::read_dir(hub) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            (name.starts_with("models--") && name.contains("faster-whisper")).then(|| {
                (
                    format!("音声認識モデル（{}）", name.trim_start_matches("models--")),
                    entry.path(),
                )
            })
        })
        .collect()
}

/// リリースビルドでモデルを置くアプリ固有データのルート（%LOCALAPPDATA%\{id}\models）。
/// dev ビルドでは None を返し、呼び出し側が従来のプロジェクト/resource 相対パスを使う。
/// pyannote 話者分離モデルと Gemma GGUF をここへ集約し、
/// NSIS アンインストーラーの %LOCALAPPDATA%\{id} 一括削除で確実に消えるようにする。
fn release_models_root(app: &AppHandle) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return None;
    }
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|d| d.join("models"))
}






fn path_is_nonempty_file(path: &Path, min_bytes: u64) -> bool {
    path.is_file()
        && path
            .metadata()
            .map(|m| m.len() >= min_bytes)
            .unwrap_or(false)
}





/// フル機能版（Vulkan。identifier `net.gakkousya.lott`）かどうか。配布はフル機能版と Editor 版だけで、
/// Editor 版でなければフル機能版。文字起こし・話者分離は ggml エンジン、校正はルールベースのみ。
/// identifier は旧 CUDA 版から引き継いでいる（上書きインストールで音声モデルを再利用するため）。
fn is_vulkan_build(app: &AppHandle) -> bool {
    !is_editor_build(app)
}

/// 実行時のビルド種別（画面に渡す。"vulkan" = フル機能版、"editor" = Editor 版）。
fn app_build_variant(app: &AppHandle) -> &'static str {
    if is_vulkan_build(app) {
        "vulkan"
    } else {
        "editor"
    }
}

fn is_editor_build(app: &AppHandle) -> bool {
    app.config().identifier.contains("editor")
}

fn editor_whisper_voice_input_pack_installed(
    whisper_cli_present: bool,
    whisper_models_installed: bool,
) -> bool {
    whisper_cli_present && whisper_models_installed
}

fn whisper_voice_input_pack_total_bytes() -> u64 {
    ggml_speech::GGML_MODEL_FILES
        .iter()
        .filter(|model| model.component == "whisper_turbo")
        .map(|model| model.size)
        .sum()
}

fn check_editor_voice_input_pack_status_impl(app: &AppHandle) -> EditorVoiceInputPackStatus {
    if is_editor_build(app) {
        let paths = resolve_ggml_speech_paths(app).ok();
        let whisper_cli_present = paths
            .as_ref()
            .map(|p| p.whisper_cli.is_file())
            .unwrap_or(false);
        let whisper_models_installed = resolve_ggml_models_root(app)
            .map(|root| ggml_speech::ggml_models_installed(&root, "whisper_turbo"))
            .unwrap_or(false);
        let installed = editor_whisper_voice_input_pack_installed(
            whisper_cli_present,
            whisper_models_installed,
        );
        return EditorVoiceInputPackStatus {
            installed,
            cpu_backend_required: false,
            cpu_backend: false,
            cpu_backend_expected_path: String::new(),
            gemma_gguf: false,
            gemma_gguf_expected_path: String::new(),
            mmproj_gguf: false,
            mmproj_gguf_expected_path: String::new(),
            ffmpeg_required: false,
            ffmpeg: true,
            ffmpeg_expected_path: String::new(),
        };
    }
    // Vulkan 版の音声入力は whisper.cpp（文字起こしと同じモデル）を使うため、
    // 追加のパックは無い。文字起こしの準備が済んでいれば使える。
    let installed = resolve_ggml_speech_paths(app)
        .map(|p| {
            p.missing_for_transcription(VOICE_INPUT_WHISPER_MODEL)
                .is_empty()
        })
        .unwrap_or(false);
    EditorVoiceInputPackStatus {
        installed,
        cpu_backend_required: false,
        cpu_backend: true,
        cpu_backend_expected_path: String::new(),
        gemma_gguf: true,
        gemma_gguf_expected_path: String::new(),
        mmproj_gguf: true,
        mmproj_gguf_expected_path: String::new(),
        ffmpeg_required: false,
        ffmpeg: true,
        ffmpeg_expected_path: String::new(),
    }
}

#[tauri::command]
fn check_editor_voice_input_pack_status(
    app: AppHandle,
) -> Result<EditorVoiceInputPackStatus, String> {
    // 音声入力は Full 版（CUDA/AMD）にも展開済み。ビルド判定は cpu_backend_required 経由で
    // フロントに伝える（本コマンド自体は全ビルドで許可）。
    Ok(check_editor_voice_input_pack_status_impl(&app))
}

fn emit_voice_input_pack_progress(
    app: &AppHandle,
    component: &str,
    status: &str,
    message: &str,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
) {
    let _ = app.emit(
        "voice-input-pack-progress",
        SetupProgressPayload {
            component: component.to_string(),
            status: status.to_string(),
            message: message.to_string(),
            downloaded_bytes,
            total_bytes,
        },
    );
}


fn llama_cpu_backend_asset_name() -> Result<String, String> {
    if cfg!(target_os = "windows") {
        Ok(format!("llama-{LLAMA_CPP_CPU_BUILD}-bin-win-cpu-x64.zip"))
    } else if cfg!(target_os = "linux") {
        Ok(format!("llama-{LLAMA_CPP_CPU_BUILD}-bin-ubuntu-x64.tar.gz"))
    } else {
        Err("このOSのCPU版 llama.cpp バックエンド取得は未対応です。".to_string())
    }
}











fn powershell_single_quoted(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn spawn_file_download(url: &str, dest_file: &Path) -> Result<Child, String> {
    if cfg!(target_os = "windows") {
        let mut curl = Command::new("curl.exe");
        apply_windows_no_window(&mut curl);
        curl.args([
            "-fL",
            "--retry",
            "3",
            "--retry-delay",
            "5",
            "--silent",
            "--show-error",
            "-o",
        ])
        .arg(dest_file)
        .arg(url)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
        match curl.spawn() {
            Ok(child) => return Ok(child),
            Err(curl_err) => {
                let out_file = dest_file.to_string_lossy();
                let script = format!(
                    "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri {} -OutFile {} -UseBasicParsing",
                    powershell_single_quoted(url),
                    powershell_single_quoted(out_file.as_ref())
                );
                let mut cmd = Command::new("powershell");
                apply_windows_no_window(&mut cmd);
                cmd.arg("-NoProfile")
                    .arg("-NonInteractive")
                    .arg("-ExecutionPolicy")
                    .arg("Bypass")
                    .arg("-Command")
                    .arg(script)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                return cmd.spawn().map_err(|powershell_err| {
                    format!(
                        "ダウンロード処理の起動に失敗しました: curl={curl_err}; powershell={powershell_err}"
                    )
                });
            }
        }
    }

    let mut curl = Command::new("curl");
    apply_windows_no_window(&mut curl);
    apply_host_command_env(&mut curl);
    curl.args([
        "-fL",
        "--retry",
        "3",
        "--retry-delay",
        "5",
        "--silent",
        "--show-error",
        "-o",
    ])
    .arg(dest_file)
    .arg(url)
    .stdout(Stdio::null())
    .stderr(Stdio::null());
    match curl.spawn() {
        Ok(child) => Ok(child),
        Err(curl_err) => {
            let mut wget = Command::new("wget");
            apply_windows_no_window(&mut wget);
            apply_host_command_env(&mut wget);
            wget.arg("-O")
                .arg(dest_file)
                .arg(url)
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            wget.spawn().map_err(|wget_err| {
                format!("curl/wget の起動に失敗しました: curl={curl_err}; wget={wget_err}")
            })
        }
    }
}









fn ffmpeg_lgpl_asset_name() -> Result<String, String> {
    // setup_ffmpeg_lgpl.py（Full版の同梱ffmpeg取得スクリプト）と同じ BtbN latest LGPL ビルド。
    if cfg!(target_os = "windows") {
        Ok("ffmpeg-master-latest-win64-lgpl.zip".to_string())
    } else if cfg!(target_os = "linux") {
        Ok("ffmpeg-master-latest-linux64-lgpl.tar.xz".to_string())
    } else {
        Err("このOSの ffmpeg 取得は未対応です。".to_string())
    }
}







fn install_editor_voice_input_pack_blocking(app: AppHandle) -> Result<bool, String> {
    let total_bytes = whisper_voice_input_pack_total_bytes();
    let result = install_ggml_models_blocking_with_event(
        &app,
        "whisper_turbo",
        "voice-input-pack-progress",
    );
    if let Err(error) = result {
        emit_voice_input_pack_progress(
            &app,
            "whisper_turbo",
            "error",
            &error,
            None,
            Some(total_bytes),
        );
        return Err(error);
    }
    emit_voice_input_pack_progress(
        &app,
        "whisper_turbo",
        "done",
        "インストール完了",
        Some(total_bytes),
        Some(total_bytes),
    );
    Ok(check_editor_voice_input_pack_status_impl(&app).installed)
}

#[tauri::command]
async fn install_editor_voice_input_pack(app: AppHandle) -> Result<bool, String> {
    if is_vulkan_build(&app) {
        return Err(
            "この版の音声入力は whisper.cpp を使用します。追加の音声入力パックはありません。"
                .to_string(),
        );
    }
    tauri::async_runtime::spawn_blocking(move || install_editor_voice_input_pack_blocking(app))
        .await
        .map_err(|e| format!("音声入力パックの導入タスクエラー: {e}"))?
}


fn delete_file_recording(
    path: &Path,
    deleted: &mut Vec<String>,
    not_found: &mut Vec<String>,
    errors: &mut Vec<String>,
) {
    if path.exists() {
        match fs::remove_file(path) {
            Ok(_) => deleted.push(path.to_string_lossy().into_owned()),
            Err(e) => errors.push(format!("{}: {e}", path.display())),
        }
    } else {
        not_found.push(path.to_string_lossy().into_owned());
    }
}

fn editor_whisper_model_file_paths(models_root: &Path) -> Vec<PathBuf> {
    ggml_speech::GGML_MODEL_FILES
        .iter()
        .filter(|model| model.component == "whisper_turbo")
        .map(|model| model.path(models_root))
        .collect()
}

#[tauri::command]
fn dev_delete_editor_voice_input_pack(app: AppHandle) -> EditorVoiceInputPackDeleteResponse {
    if !cfg!(debug_assertions) {
        return EditorVoiceInputPackDeleteResponse {
            deleted: vec![],
            not_found: vec![],
            errors: vec!["dev ビルドでのみ使用できます".to_string()],
        };
    }
    let mut deleted = Vec::new();
    let mut not_found = Vec::new();
    let mut errors = Vec::new();

    // Editor版の開発用削除はダウンロード済みWhisperモデルだけを対象にする。
    // フル機能版の音声入力は文字起こしと同じモデルを使うため、ここでは消さない。
    if is_editor_build(&app) {
        if let Ok(models_root) = resolve_ggml_models_root(&app) {
            for path in editor_whisper_model_file_paths(&models_root) {
                delete_file_recording(&path, &mut deleted, &mut not_found, &mut errors);
                delete_file_recording(
                    &path.with_file_name(format!(
                        "{}.part",
                        path.file_name().unwrap_or_default().to_string_lossy()
                    )),
                    &mut deleted,
                    &mut not_found,
                    &mut errors,
                );
            }
        }
    }
    EditorVoiceInputPackDeleteResponse {
        deleted,
        not_found,
        errors,
    }
}

#[tauri::command]
fn check_all_setup_status(app: AppHandle) -> Result<AllSetupStatus, String> {
    check_all_setup_status_vulkan(&app)
}

/// Vulkan 版のセットアップ状態。項目は CUDA 版と同じ構造体に載せ、画面の行をそのまま使う
/// （whisper_turbo = whisper.cpp のモデルと VAD、diarization = Nemotron）。
/// LLM/Gemma 4 は含まず、Python も同梱しない。LLM 関連の状態項目は false/空で返して
/// Vulkan のセットアップ画面に校正モデルやバックエンドの行を出さない。
fn check_all_setup_status_vulkan(app: &AppHandle) -> Result<AllSetupStatus, String> {
    let models_root = resolve_ggml_models_root(app)?;
    let whisper_turbo = !should_emulate_missing_community_1()
        && ggml_speech::ggml_models_installed(&models_root, "whisper_turbo");
    let diarization = !should_emulate_missing_community_1()
        && ggml_speech::ggml_models_installed(&models_root, "diarization");
    Ok(AllSetupStatus {
        whisper_turbo,
        diarization,
        diarization_expected_path: models_root
            .join(ggml_speech::DIAR_MODELS_SUBDIR)
            .to_string_lossy()
            .to_string(),
        gemma_gguf: false,
        gemma_gguf_expected_path: String::new(),
        gemma_mtp_gguf: false,
        gemma_mtp_gguf_expected_path: String::new(),
        llm_backend: false,
        python_env: true,
        python_env_expected_path: String::new(),
    })
}


#[tauri::command]
async fn check_gpu_availability(app: AppHandle, retry: Option<bool>) -> serde_json::Value {
    // nvidia-smi / rocm-smi の起動は数百ms〜秒オーダーになりうるため、メインスレッドを
    // 塞がないよう spawn_blocking でワーカースレッドへ逃がす。
    tauri::async_runtime::spawn_blocking(move || {
        check_gpu_availability_blocking(app, retry.unwrap_or(false))
    })
    .await
    .unwrap_or_else(|_| {
        serde_json::json!({
            "cudaAvailable": false,
            "rocmAvailable": false,
            "buildVariant": "cuda",
            "runtimePlatform": std::env::consts::OS,
        })
    })
}

fn check_gpu_availability_blocking(app: AppHandle, retry: bool) -> serde_json::Value {
    let build_variant = app_build_variant(&app);

    // Editor 版は GPU を使わない（音声入力も CPU の whisper.cpp）。GPU の列挙もしない。
    if build_variant == "editor" {
        return serde_json::json!({
            "cudaAvailable": false,
            "rocmAvailable": false,
            "vulkanAvailable": false,
            "buildVariant": build_variant,
            "runtimePlatform": std::env::consts::OS,
            "localLlmAppsEnabled": false,
        });
    }

    // Vulkan の GPU 一覧で判定する（NVIDIA / AMD / Intel 共通）。GPU が無くても ggml エンジンは
    // CPU で動くため、vulkanAvailable=false は「遅いが使える」を意味し、機能を止める理由にはしない。
    let devices = gpu_select::vulkan_devices(retry);
    let auto = gpu_select::choose_auto(&devices);
    serde_json::json!({
        "cudaAvailable": false,
        "rocmAvailable": false,
        "vulkanAvailable": auto.is_some(),
        "vulkanGpuName": auto.map(|d| d.name.clone()),
        "devForceCpu": gpu_select::dev_force_cpu(),
        "buildVariant": build_variant,
        "runtimePlatform": std::env::consts::OS,
        "localLlmAppsEnabled": false,
    })
}






#[tauri::command]
async fn proofread_transcription(
    app: AppHandle,
    request: ProofreadTranscriptionRequest,
) -> Result<ProofreadTranscriptionResponse, String> {
    tauri::async_runtime::spawn_blocking(move || proofread_transcription_blocking(app, request))
        .await
        .map_err(|e| format!("校正タスクの実行に失敗しました: {e}"))?
}













#[tauri::command]
fn cancel_transcription() -> Result<String, String> {
    // 並行実行中の話者分離も停止する
    let diar_pid = DIARIZATION_PID.load(Ordering::SeqCst);
    if diar_pid > 0 {
        let _ = kill_process_tree_by_pid(diar_pid);
    }
    match request_cancel(RunningTaskKind::Transcription)? {
        true => Ok("文字起こし処理の中止要求を送信しました。".to_string()),
        false => Ok("中止対象の文字起こし処理は実行されていません。".to_string()),
    }
}

#[tauri::command]
fn cancel_proofread() -> Result<String, String> {
    match request_cancel(RunningTaskKind::Proofread)? {
        true => Ok("校正処理の中止要求を送信しました。".to_string()),
        false => Ok("中止対象の校正処理は実行されていません。".to_string()),
    }
}

#[tauri::command]
fn cancel_diarization() -> Result<String, String> {
    match request_cancel(RunningTaskKind::Diarization)? {
        true => Ok("話者分離処理の中止要求を送信しました。".to_string()),
        false => Ok("中止対象の話者分離処理は実行されていません。".to_string()),
    }
}

fn proofread_transcription_blocking(
    app: AppHandle,
    request: ProofreadTranscriptionRequest,
) -> Result<ProofreadTranscriptionResponse, String> {
    set_cancel_requested(RunningTaskKind::Proofread, false);
    if request.segments.is_empty() {
        return Ok(ProofreadTranscriptionResponse {
            success: false,
            result: None,
            error_message: Some("校正対象のセグメントがありません。".to_string()),
        });
    }

    let language = request
        .language
        .as_deref()
        .map(str::trim)
        .filter(|language| !language.is_empty())
        .unwrap_or("ja");
    let chunk_size = request.chunk_size.unwrap_or(12).clamp(1, 64);
    let chunk_max_chars = request.chunk_max_chars.unwrap_or(1200).clamp(200, 6000);
    let mode = request.mode.as_deref().unwrap_or("all");
    let run_punct = should_run_japanese_punctuation(language, mode);
    let run_entity = mode == "all" || mode == "entity" || mode == "punct";

    emit_progress(&app, "proofread_start", "校正を開始します...", Some(96.0));

    let punct_rules = load_punct_rules_from_app(&app);
    let entity_rules = load_entity_rules_from_app(&app);
    let location_scope =
        EntityLocationScope::from_request(request.location_detection_scope.as_ref());
    let mut punct_stats = PunctuationRuntimeStats::default();
    let punctuated_map = if run_punct {
        punctuate_segments_by_speaker_group_rust(&request.segments, &punct_rules, &mut punct_stats)
    } else {
        std::collections::HashMap::new()
    };
    let total_segments = request.segments.len();
    let mut items = Vec::with_capacity(total_segments);
    let mut changed_count = 0usize;
    let mut changed_conf_sum = 0.0f64;

    for (seg_idx, segment) in request.segments.iter().enumerate() {
        if take_cancel_requested(RunningTaskKind::Proofread) {
            return Ok(ProofreadTranscriptionResponse {
                success: false,
                result: None,
                error_message: Some("校正処理を中止しました。".to_string()),
            });
        }
        let original = segment.text.clone();
        let normalized = safe_normalize_text(&original);
        let punctuated = if run_punct {
            punctuated_map
                .get(&segment.id)
                .cloned()
                .unwrap_or_else(|| punctuate_text_rust(&normalized, &punct_rules, &mut punct_stats))
        } else {
            original.clone()
        };
        let sensitive = if run_entity {
            detect_sensitive_entities_rust_with_scope(
                &format!("{original}\n{punctuated}"),
                &entity_rules,
                &location_scope,
            )
        } else {
            SensitiveEntityMeta {
                has_sensitive_entity: false,
                kinds: vec![],
                names: vec![],
                person_names: vec![],
                organization_names: vec![],
                location_names: vec![],
                person_detection_source: String::new(),
            }
        };
        let (reason, confidence) = classify_proofread_reason(&original, &punctuated);
        if original != punctuated {
            changed_count += 1;
            changed_conf_sum += confidence;
        }
        items.push(serde_json::json!({
            "id": segment.id,
            "originalText": original,
            "revisedText": punctuated,
            "confidence": confidence,
            "reason": reason,
            "sensitiveEntity": sensitive,
            "typoFixes": [],
            "typoCandidates": []
        }));
        let current = seg_idx + 1;
        let _ = app.emit(
            "transcription-progress",
            serde_json::json!({
                "stage": "proofread_segment_progress",
                "current": current,
                "total": total_segments,
            }),
        );
    }

    let avg_conf_changed = if changed_count > 0 {
        changed_conf_sum / changed_count as f64
    } else {
        0.0
    };
    let summary = serde_json::json!({
        "segmentCount": items.len(),
        "batchCount": ((items.len() as i64 + chunk_size - 1) / chunk_size),
        "changedSegments": changed_count,
        "changedRatio": if items.is_empty() { 0.0 } else { changed_count as f64 / items.len() as f64 },
        "averageConfidenceChangedOnly": avg_conf_changed,
        "typoFixedSegments": 0,
        "oovCandidateSegments": 0,
        "engine": "lightweight_rust",
        "punctuationRuntime": punct_stats,
        "chunkSize": chunk_size,
        "chunkMaxChars": chunk_max_chars,
    });

    emit_progress(&app, "proofread_done", "校正が完了しました。", Some(99.0));
    Ok(ProofreadTranscriptionResponse {
        success: true,
        result: Some(serde_json::json!({
            "items": items,
            "summary": summary
        })),
        error_message: None,
    })
}

fn classify_proofread_reason(original: &str, revised: &str) -> (String, f64) {
    if original == revised {
        return (String::new(), 0.0);
    }
    let strip_punct = |s: &str| -> String {
        s.chars()
            .filter(|c| {
                !matches!(
                    *c,
                    '、' | '。' | '！' | '？' | '!' | '?' | ' ' | '\t' | '\r' | '\n'
                )
            })
            .collect::<String>()
    };
    if strip_punct(original) == strip_punct(revised) {
        if revised.ends_with('。') && !ends_with_japanese_punctuation(original) {
            return ("sentence_final_period_added".to_string(), 0.9);
        }
        return ("punctuation_adjustment".to_string(), 0.85);
    }
    ("light_normalization".to_string(), 0.7)
}



/// 日本語の直後の半角「?」「!」を全角にする（Whisper は半角で出すことが多い）。
/// 表記の統一はルールで確実にでき、LLM の句読点校正に任せると処理時間の多くをこれに使うため。
/// 英字・数字の直後（例: 「OK?」）は英語の表記として残す。
fn normalize_ja_symbol_width(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    // 直前が英字・数字、または半角のまま残した ? ! なら、続く ? ! も半角のままにする（「OK?!」）
    let mut keep_ascii = false;
    for c in text.chars() {
        match c {
            '?' | '!' if keep_ascii => out.push(c),
            '?' => out.push('？'),
            '!' => out.push('！'),
            _ => {
                keep_ascii = c.is_ascii_alphanumeric();
                out.push(c);
            }
        }
    }
    out
}

fn normalize_transcription_output_text(text: &str, language: &str) -> String {
    if language.eq_ignore_ascii_case("ja") {
        normalize_ja_symbol_width(text)
    } else {
        text.to_string()
    }
}

fn should_run_japanese_punctuation(language: &str, mode: &str) -> bool {
    language.eq_ignore_ascii_case("ja") && (mode == "all" || mode == "punct")
}


fn safe_normalize_text(text: &str) -> String {
    let mut out = text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .to_string();
    out = out.replace('\t', " ");
    while out.contains("  ") {
        out = out.replace("  ", " ");
    }
    out
}

fn ends_with_any_suffix(text: &str, suffixes: &[String]) -> bool {
    let trimmed = text.trim_end();
    suffixes
        .iter()
        .any(|sfx| !sfx.is_empty() && trimmed.ends_with(sfx.as_str()))
}

fn matches_question_ending(text: &str, rules: &PunctRules) -> bool {
    rules.speaker_join_use_question_mark
        && !rules.speaker_question_endings.is_empty()
        && ends_with_any_suffix(text, &rules.speaker_question_endings)
}

fn ends_with_japanese_punctuation(text: &str) -> bool {
    text.trim_end()
        .chars()
        .last()
        .map(|c| matches!(c, '、' | '。' | '！' | '？' | '!' | '?'))
        .unwrap_or(false)
}

fn punctuate_text_rust(
    text: &str,
    rules: &PunctRules,
    stats: &mut PunctuationRuntimeStats,
) -> String {
    stats.calls += 1;
    let src = safe_normalize_text(text);
    if src.is_empty() {
        return src;
    }
    let mut out = replace_inner_half_space_with_comma(&src);
    // 「まあ」「ので」などの後に読点を入れる規則は、句読点の無い文字起こし（faster-whisper）向け。
    // whisper.cpp のように句読点を付けて出した行は、その読点を信頼して触らない
    // （語の一部にも当たるため「あのですね」を「あので、すね」にしてしまう）。
    let already_punctuated = src.contains(['、', '。', '？', '！', '?', '!']);
    for phrase in &rules.force_comma_after {
        if phrase.is_empty() || already_punctuated {
            continue;
        }
        out = insert_comma_after_phrase(&out, phrase);
    }
    for phrase in &rules.remove_comma_after {
        if phrase.is_empty() {
            continue;
        }
        out = out.replace(&format!("{phrase}、"), phrase);
    }
    if rules.add_sentence_final_period && !ends_with_japanese_punctuation(&out) {
        out.push('。');
    }
    if out != src {
        stats.changed += 1;
    }
    out
}

/// phrase の直後に読点を入れる。すでに句読点・閉じ括弧が続く所と文末には入れない
/// （whisper.cpp は句読点を付けて出すので、「まあ、」を「まあ、、」、「ので。」を「ので、。」にしない）。
fn insert_comma_after_phrase(text: &str, phrase: &str) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    let mut rest = text;
    while let Some(pos) = rest.find(phrase) {
        let end = pos + phrase.len();
        out.push_str(&rest[..end]);
        rest = &rest[end..];
        let next = rest.chars().next();
        if next.is_some_and(|c| !matches!(c, '、' | '。' | '！' | '？' | '!' | '?' | '…' | '」' | '』' | '）' | ')' | '，' | ',')) {
            out.push('、');
        }
    }
    out.push_str(rest);
    out
}

fn replace_inner_half_space_with_comma(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() < 3 {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    for i in 0..chars.len() {
        let ch = chars[i];
        if ch == ' ' && i > 0 && i + 1 < chars.len() {
            let prev = chars[i - 1];
            let next = chars[i + 1];
            if is_japanese_script_char(prev) && is_japanese_script_char(next) {
                out.push('、');
                continue;
            }
        }
        out.push(ch);
    }
    out
}

fn is_japanese_script_char(c: char) -> bool {
    ('\u{3041}'..='\u{3096}').contains(&c) // ひらがな
        || ('\u{30A1}'..='\u{30FA}').contains(&c) // カタカナ
        || ('\u{4E00}'..='\u{9FFF}').contains(&c) // 漢字
        || c == '々'
        || c == 'ー'
}

fn punctuate_segments_by_speaker_group_rust(
    segments: &[ProofreadSegmentInput],
    rules: &PunctRules,
    stats: &mut PunctuationRuntimeStats,
) -> std::collections::HashMap<i64, String> {
    let mut revised = std::collections::HashMap::<i64, String>::new();
    if !rules.use_speaker_group_punctuation || segments.is_empty() {
        return revised;
    }
    let n = segments.len();
    let mut i = 0usize;
    while i < n {
        let speaker = segments[i]
            .speaker
            .clone()
            .unwrap_or_default()
            .trim()
            .to_string();
        if speaker.is_empty() {
            revised.insert(
                segments[i].id,
                punctuate_text_rust(&segments[i].text, rules, stats),
            );
            i += 1;
            continue;
        }
        let mut j = i;
        while j + 1 < n {
            let next_speaker = segments[j + 1]
                .speaker
                .clone()
                .unwrap_or_default()
                .trim()
                .to_string();
            if next_speaker != speaker {
                break;
            }
            let cur_end = segments[j].end;
            let nxt_start = segments[j + 1].start;
            if let (Some(cur_end), Some(nxt_start)) = (cur_end, nxt_start) {
                if (nxt_start - cur_end) > rules.speaker_group_max_gap_sec {
                    break;
                }
            }
            j += 1;
        }
        for k in i..=j {
            let mut out = punctuate_text_rust(&segments[k].text, rules, stats);
            if out.is_empty() || ends_with_japanese_punctuation(&out) {
                revised.insert(segments[k].id, out);
                continue;
            }
            if k < j {
                let chars = out.chars().count();
                if chars < rules.speaker_mid_comma_min_chars
                    || rules.speaker_short_utterances_no_comma.contains(out.trim())
                {
                    revised.insert(segments[k].id, out);
                } else if chars <= rules.speaker_mid_short_comma_max_chars
                    || ends_with_any_suffix(&out, &rules.speaker_connective_endings)
                {
                    out.push('、');
                    stats.changed += 1;
                    revised.insert(segments[k].id, out);
                } else {
                    if matches_question_ending(&out, rules) {
                        out.push('？');
                    } else {
                        out.push('。');
                    }
                    stats.changed += 1;
                    revised.insert(segments[k].id, out);
                }
            } else {
                let chars = out.chars().count();
                if chars < rules.speaker_last_period_min_chars
                    || ends_with_japanese_punctuation(&out)
                {
                    revised.insert(segments[k].id, out);
                    continue;
                }
                if matches_question_ending(&out, rules) {
                    out.push('？');
                } else {
                    out.push('。');
                }
                stats.changed += 1;
                revised.insert(segments[k].id, out);
            }
        }
        i = j + 1;
    }
    revised
}

fn load_punct_rules_from_app(app: &AppHandle) -> PunctRules {
    let Some(path) = resolve_proofread_rule_file_candidates(app, "punctuation_addition.json")
        .into_iter()
        .find(|p| p.exists())
    else {
        return PunctRules::default();
    };
    let Ok(text) = fs::read_to_string(path) else {
        return PunctRules::default();
    };
    punct_rules_from_json(&text)
}

fn punct_rules_from_json(text: &str) -> PunctRules {
    let mut rules = PunctRules::default();
    let Ok(raw) = serde_json::from_str::<PunctRulesFile>(text) else {
        return rules;
    };
    if !raw.force_comma_after.is_empty() {
        rules.force_comma_after = raw.force_comma_after;
    }
    rules.remove_comma_after = raw.remove_comma_after;
    if let Some(v) = raw.add_sentence_final_period {
        rules.add_sentence_final_period = v;
    }
    if let Some(v) = raw.use_speaker_group_punctuation {
        rules.use_speaker_group_punctuation = v;
    }
    if let Some(v) = raw.speaker_group_max_gap_sec {
        rules.speaker_group_max_gap_sec = v.clamp(0.0, 10.0);
    }
    if let Some(v) = raw.speaker_mid_comma_min_chars {
        rules.speaker_mid_comma_min_chars = v.clamp(1, 40);
    }
    if let Some(v) = raw.speaker_mid_short_comma_max_chars {
        rules.speaker_mid_short_comma_max_chars = v.clamp(0, 40);
    }
    if let Some(v) = raw.speaker_connective_endings {
        rules.speaker_connective_endings = v
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
    }
    if let Some(v) = raw.speaker_last_period_min_chars {
        rules.speaker_last_period_min_chars = v.clamp(1, 40);
    }
    if let Some(v) = raw.speaker_join_use_question_mark {
        rules.speaker_join_use_question_mark = v;
    }
    rules.speaker_question_endings = raw
        .speaker_question_endings
        .into_iter()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .collect();
    rules.speaker_short_utterances_no_comma = raw
        .speaker_short_utterances_no_comma
        .into_iter()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .collect::<HashSet<_>>();
    rules
}

fn normalize_named_entity_list(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty() && !v.starts_with("_comment_"))
        .filter(|v| seen.insert(v.clone()))
        .collect()
}

fn contains_embedded_person_name(value: &str, person_name_set: &HashSet<String>) -> bool {
    person_name_set
        .iter()
        .any(|name| name.chars().count() >= 2 && value.contains(name))
}

fn normalize_location_name_set(
    values: Vec<String>,
    person_name_set: &HashSet<String>,
) -> HashSet<String> {
    normalize_named_entity_list(values)
        .into_iter()
        .filter(|v| !contains_embedded_person_name(v, person_name_set))
        .collect()
}

fn load_entity_rules_from_app(app: &AppHandle) -> EntityRules {
    let mut rules = EntityRules::default();
    let Some(path) = resolve_proofread_rule_file_candidates(app, "named_entity_detection.json")
        .into_iter()
        .find(|p| p.exists())
    else {
        return rules;
    };
    let Ok(text) = fs::read_to_string(path) else {
        return rules;
    };
    let Ok(raw) = serde_json::from_str::<EntityRulesFile>(&text) else {
        return rules;
    };

    let person_names = normalize_named_entity_list(raw.person_names);
    if !person_names.is_empty() {
        rules.person_names = person_names;
    }
    rules.person_name_set = rules.person_names.iter().cloned().collect();

    let organization_names = normalize_named_entity_list(raw.organization_names);
    if !organization_names.is_empty() {
        rules.organization_names = organization_names;
    }
    rules.location_names = normalize_location_name_set(raw.location_names, &rules.person_name_set);
    rules.station_names = normalize_location_name_set(raw.station_names, &rules.person_name_set);
    rules.station_like_location_patterns = raw
        .station_like_location_patterns
        .into_iter()
        .filter_map(|pattern_raw| Regex::new(pattern_raw.trim()).ok())
        .collect();
    for (region_code, region) in raw.regional_location_names {
        let code = region_code.trim().to_string();
        if !is_valid_prefecture_code(&code) {
            continue;
        }
        let location_names =
            normalize_location_name_set(region.location_names, &rules.person_name_set);
        if !location_names.is_empty() {
            rules
                .regional_location_names
                .insert(code.clone(), location_names);
        }
        let station_names =
            normalize_location_name_set(region.station_names, &rules.person_name_set);
        if !station_names.is_empty() {
            rules.regional_station_names.insert(code, station_names);
        }
    }

    if let Some(h) = raw.person_honorific_rule {
        if let Some(pattern_raw) = h.named_person_honorific_pattern {
            if let Ok(re) = Regex::new(pattern_raw.trim()) {
                rules.person_honorific_rule.pattern = re;
            }
        }
    }

    if let Some(ur) = raw.university_rule {
        if let Some(v) = ur.named_university_pattern {
            if let Ok(re) = Regex::new(v.trim()) {
                rules.university_rule.named_university_pattern = re;
            }
        }
        if let Some(v) = ur.named_elementary_school_pattern {
            if let Ok(re) = Regex::new(v.trim()) {
                rules.university_rule.named_elementary_school_pattern = re;
            }
        }
        if let Some(v) = ur.named_middle_school_pattern {
            if let Ok(re) = Regex::new(v.trim()) {
                rules.university_rule.named_middle_school_pattern = re;
            }
        }
        if let Some(v) = ur.named_high_school_pattern {
            if let Ok(re) = Regex::new(v.trim()) {
                rules.university_rule.named_high_school_pattern = re;
            }
        }
        if let Some(v) = ur.named_nursery_pattern {
            if let Ok(re) = Regex::new(v.trim()) {
                rules.university_rule.named_nursery_pattern = re;
            }
        }
        if let Some(v) = ur.named_kindergarten_pattern {
            if let Ok(re) = Regex::new(v.trim()) {
                rules.university_rule.named_kindergarten_pattern = re;
            }
        }
    }

    if let Some(hr) = raw.hospital_rule {
        if let Some(v) = hr.named_hospital_pattern {
            if let Ok(re) = Regex::new(v.trim()) {
                rules.hospital_rule.named_hospital_pattern = re;
            }
        }
        if let Some(v) = hr.named_clinic_pattern {
            if let Ok(re) = Regex::new(v.trim()) {
                rules.hospital_rule.named_clinic_pattern = re;
            }
        }
        if let Some(v) = hr.named_medical_office_pattern {
            if let Ok(re) = Regex::new(v.trim()) {
                rules.hospital_rule.named_medical_office_pattern = re;
            }
        }
    }

    if let Some(or) = raw.organization_rule {
        rules.organization_rule.named_institution_patterns = or
            .named_institution_patterns
            .into_iter()
            .filter_map(|v| Regex::new(v.trim()).ok())
            .collect();
    }

    rules
}

fn resolve_proofread_rule_file_candidates(app: &AppHandle, file_name: &str) -> Vec<PathBuf> {
    let mut out = Vec::<PathBuf>::new();
    let new_relative = PathBuf::from("src-tauri")
        .join("resources")
        .join("proofread")
        .join("punctuation_rules")
        .join(file_name);
    let new_relative_alt = PathBuf::from("resources")
        .join("proofread")
        .join("punctuation_rules")
        .join(file_name);
    let old_relative = PathBuf::from("python_sidecar")
        .join("prompt_templates")
        .join("proofread")
        .join("punctuation_rules")
        .join(file_name);
    if cfg!(debug_assertions) {
        out.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join(&new_relative),
        );
        out.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(&new_relative_alt));
        out.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join(&old_relative),
        );
        if let Ok(cwd) = env::current_dir() {
            out.push(cwd.join(&new_relative));
            out.push(cwd.join(&new_relative_alt));
            out.push(cwd.join(&old_relative));
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        out.push(resource_dir.join(&new_relative_alt));
        out.push(
            resource_dir
                .join("proofread")
                .join("punctuation_rules")
                .join(file_name),
        );
        out.push(
            resource_dir
                .join("resources")
                .join("proofread")
                .join("punctuation_rules")
                .join(file_name),
        );
        out.push(resource_dir.join("_up_").join(&new_relative_alt));
        out.push(
            resource_dir
                .join("_up_")
                .join("proofread")
                .join("punctuation_rules")
                .join(file_name),
        );
        out.push(
            resource_dir
                .join("_up_")
                .join("resources")
                .join("proofread")
                .join("punctuation_rules")
                .join(file_name),
        );
        out.push(resource_dir.join(&old_relative));
        out.push(
            resource_dir
                .join("_up_")
                .join("python_sidecar")
                .join("prompt_templates")
                .join("proofread")
                .join("punctuation_rules")
                .join(file_name),
        );
        out.push(
            resource_dir
                .join("prompt_templates")
                .join("proofread")
                .join("punctuation_rules")
                .join(file_name),
        );
    }
    out
}

fn is_name_continuation_char(re: &Regex, ch: char) -> bool {
    let mut buf = [0_u8; 4];
    re.is_match(ch.encode_utf8(&mut buf))
}

fn add_location_name_matches(
    raw: &str,
    names: &HashSet<String>,
    person_name_set: &HashSet<String>,
    collector: &mut SensitiveEntityCollector,
) {
    for token in names {
        let token = token.trim();
        if token.is_empty() || person_name_set.contains(token) {
            continue;
        }
        if raw.contains(token) {
            collector.add(
                token,
                "location",
                None,
                SensitiveEntitySourceList::LocationName,
            );
        }
    }
}

#[cfg(test)]
fn detect_sensitive_entities_rust(text: &str, rules: &EntityRules) -> SensitiveEntityMeta {
    detect_sensitive_entities_rust_with_scope(text, rules, &EntityLocationScope::default())
}

fn detect_sensitive_entities_rust_with_scope(
    text: &str,
    rules: &EntityRules,
    location_scope: &EntityLocationScope,
) -> SensitiveEntityMeta {
    let raw = text.trim();
    if raw.is_empty() {
        return SensitiveEntityMeta {
            has_sensitive_entity: false,
            kinds: vec![],
            names: vec![],
            person_names: vec![],
            organization_names: vec![],
            location_names: vec![],
            person_detection_source: String::new(),
        };
    }
    let mut collector = SensitiveEntityCollector::default();

    for token in &rules.person_names {
        let token = token.trim();
        if token.is_empty() {
            continue;
        }
        if token.chars().count() >= 2 && raw.contains(token) {
            collector.add(
                token,
                "person",
                Some("dictionary"),
                SensitiveEntitySourceList::PersonName,
            );
            continue;
        }
        for (idx, _) in raw.match_indices(token) {
            let end_idx = idx + token.len();
            let next = raw[end_idx..].chars().next();
            let next_is_name_char = next
                .map(|c| {
                    is_name_continuation_char(
                        &rules
                            .person_honorific_rule
                            .dictionary_name_continuation_pattern,
                        c,
                    )
                })
                .unwrap_or(false);
            let next_tail = &raw[end_idx..];
            let has_honorific = rules
                .person_honorific_rule
                .honorific_suffixes
                .iter()
                .any(|s| next_tail.starts_with(s));
            if !next_is_name_char || has_honorific {
                collector.add(
                    token,
                    "person",
                    Some("dictionary"),
                    SensitiveEntitySourceList::PersonName,
                );
                break;
            }
        }
    }

    for token in &rules.organization_names {
        let token = token.trim();
        if token.is_empty() {
            continue;
        }
        for (idx, _) in raw.match_indices(token) {
            let end_idx = idx + token.len();
            let prev = raw[..idx].chars().next_back();
            let next = raw[end_idx..].chars().next();
            let prev_is_name_char = prev
                .map(|c| {
                    is_name_continuation_char(
                        &rules
                            .person_honorific_rule
                            .dictionary_name_continuation_pattern,
                        c,
                    )
                })
                .unwrap_or(false);
            let next_is_name_char = next
                .map(|c| {
                    is_name_continuation_char(
                        &rules
                            .person_honorific_rule
                            .dictionary_name_continuation_pattern,
                        c,
                    )
                })
                .unwrap_or(false);
            if !prev_is_name_char && !next_is_name_char {
                collector.add(
                    token,
                    "organization",
                    None,
                    SensitiveEntitySourceList::OrganizationName,
                );
                break;
            }
        }
    }

    add_location_name_matches(
        raw,
        &rules.location_names,
        &rules.person_name_set,
        &mut collector,
    );
    add_location_name_matches(
        raw,
        &rules.station_names,
        &rules.person_name_set,
        &mut collector,
    );
    if location_scope.selected_regions_enabled() {
        for region_code in &location_scope.prefectures {
            if let Some(names) = rules.regional_location_names.get(region_code) {
                add_location_name_matches(raw, names, &rules.person_name_set, &mut collector);
            }
            if let Some(names) = rules.regional_station_names.get(region_code) {
                add_location_name_matches(raw, names, &rules.person_name_set, &mut collector);
            }
        }
    }

    if !rules.station_like_location_patterns.is_empty() {
        for re in &rules.station_like_location_patterns {
            for caps in re.captures_iter(raw) {
                let Some(matched) = caps.get(1).or_else(|| caps.get(0)) else {
                    continue;
                };
                collector.add(
                    matched.as_str(),
                    "location",
                    None,
                    SensitiveEntitySourceList::LocationName,
                );
            }
        }
    }

    for re in &rules.person_honorific_rule.candidate_patterns {
        for caps in re.captures_iter(raw) {
            let (Some(base), Some(suffix)) = (caps.get(1), caps.get(2)) else {
                continue;
            };
            let base_text = base.as_str().trim();
            let phrase = format!("{base_text}{}", suffix.as_str());
            if rules.person_honorific_rule.excludes.contains(base_text) {
                continue;
            }
            if rules.person_honorific_rule.pattern.is_match(&phrase) {
                collector.add(
                    base_text,
                    "person",
                    Some("honorific"),
                    SensitiveEntitySourceList::None,
                );
            }
        }
    }

    for token in split_token_candidates(raw) {
        if token == "大学" {
            continue;
        }
        if token.ends_with("大学") {
            if rules
                .university_rule
                .named_university_pattern
                .is_match(token)
            {
                collector.add(
                    token,
                    "organization",
                    None,
                    SensitiveEntitySourceList::OrganizationName,
                );
            }
            continue;
        }

        for (generic_names, re) in [
            (
                &["小学校", "義務教育学校"][..],
                &rules.university_rule.named_elementary_school_pattern,
            ),
            (
                &["中学校", "中等教育学校"][..],
                &rules.university_rule.named_middle_school_pattern,
            ),
            (
                &["高校", "高等学校"][..],
                &rules.university_rule.named_high_school_pattern,
            ),
            (
                &["保育園", "保育所", "認定こども園", "こども園"][..],
                &rules.university_rule.named_nursery_pattern,
            ),
            (
                &["幼稚園"][..],
                &rules.university_rule.named_kindergarten_pattern,
            ),
        ] {
            if generic_names.contains(&token) {
                continue;
            }
            if re.is_match(token) {
                collector.add(
                    token,
                    "organization",
                    None,
                    SensitiveEntitySourceList::OrganizationName,
                );
            }
        }
    }

    for token in split_token_candidates(raw) {
        let hospital_patterns = [
            &rules.hospital_rule.named_hospital_pattern,
            &rules.hospital_rule.named_clinic_pattern,
            &rules.hospital_rule.named_medical_office_pattern,
        ];
        if hospital_patterns.iter().any(|re| re.is_match(token)) {
            collector.add(
                token,
                "organization",
                None,
                SensitiveEntitySourceList::OrganizationName,
            );
        }
    }

    for token in split_token_candidates(raw) {
        if rules
            .organization_rule
            .named_institution_patterns
            .iter()
            .any(|re| re.is_match(token))
        {
            collector.add(
                token,
                "organization",
                None,
                SensitiveEntitySourceList::OrganizationName,
            );
        }
    }

    if collector.names.iter().any(|n| n.contains("会社")) {
        collector.insert_kind("corporation");
    }
    collector.finish()
}

fn split_token_candidates(text: &str) -> Vec<&str> {
    let separators = [
        ' ', '\t', '\n', '\r', '、', '。', '！', '？', '!', '?', '「', '」', '『', '』', ',', '.',
        '(', ')', '[', ']',
    ];
    text.split(|c| separators.contains(&c))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect::<Vec<&str>>()
}

#[cfg(test)]
mod tests {
    #[test]
    fn audio_preprocess_filter_maps_presets() {
        use super::audio_preprocess_filter as f;
        assert_eq!(f(None), None);
        assert_eq!(f(Some("none")), None);
        assert_eq!(f(Some("bogus")), None);
        assert_eq!(f(Some("low_noise")), Some("highpass=f=80"));
        assert_eq!(
            f(Some("strong_noise")),
            Some("highpass=f=80,afftdn=nr=12:nf=-40")
        );
        assert_eq!(
            f(Some("volume_boost")),
            Some("highpass=f=80,dynaudnorm=f=250:g=15")
        );
        assert_eq!(
            f(Some("general_improvement")),
            Some("highpass=f=80,afftdn=nr=12:nf=-40,dynaudnorm=f=250:g=15")
        );
        assert_eq!(super::normalized_audio_preprocess(Some("x")), "none");
        assert_eq!(
            super::normalized_audio_preprocess(Some("volume_boost")),
            "volume_boost"
        );
    }

    use super::*;

    const EXPORT_TEST_MARKER: &str = "秘匿テスト本文マーカー";
    const EXPORT_TEST_PASSWORD: &str = "export-test-password";

    struct ExportTestDir(PathBuf);

    impl ExportTestDir {
        fn new(tag: &str) -> Self {
            let dir = env::temp_dir().join(private_temp_name(tag));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn file_names(&self) -> Vec<String> {
            let mut names = fs::read_dir(&self.0)
                .unwrap()
                .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                .collect::<Vec<_>>();
            names.sort();
            names
        }
    }

    impl Drop for ExportTestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|window| window == needle)
    }

    fn export_test_docx_request(path: &Path, password: Option<&str>) -> SaveTranscriptionDocxRequest {
        SaveTranscriptionDocxRequest {
            path: path.to_string_lossy().into_owned(),
            rows: vec![SaveTranscriptionDocxRow {
                time: "00:00:01".to_string(),
                speaker: "Th".to_string(),
                text: EXPORT_TEST_MARKER.to_string(),
            }],
            password: password.map(str::to_string),
        }
    }

    fn export_test_xlsx_request(path: &Path, password: Option<&str>) -> SaveTranscriptionXlsxRequest {
        SaveTranscriptionXlsxRequest {
            path: path.to_string_lossy().into_owned(),
            rows: vec![SaveTranscriptionXlsxRow {
                start: "00:00:01".to_string(),
                end: "00:00:02".to_string(),
                speaker: "Cl".to_string(),
                text: EXPORT_TEST_MARKER.to_string(),
            }],
            password: password.map(str::to_string),
        }
    }

    fn export_test_json_request(path: &Path, password: Option<&str>) -> SaveTranscriptionJsonRequest {
        SaveTranscriptionJsonRequest {
            path: path.to_string_lossy().into_owned(),
            content: format!("{{\"text\":\"{EXPORT_TEST_MARKER}\"}}"),
            password: password.map(str::to_string),
        }
    }

    fn export_test_srt_request(path: &Path, password: Option<&str>) -> SaveTranscriptionSrtRequest {
        SaveTranscriptionSrtRequest {
            path: path.to_string_lossy().into_owned(),
            rows: vec![SaveTranscriptionSrtRow {
                start_seconds: 0.0,
                end_seconds: 1.5,
                speaker: "Th".to_string(),
                text: EXPORT_TEST_MARKER.to_string(),
            }],
            password: password.map(str::to_string),
        }
    }

    const CFB_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

    fn read_aes_zip_entry(path: &Path, name: &str) -> String {
        use std::io::Read;
        let mut archive = zip2::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
        let mut entry = archive
            .by_name_decrypt(name, EXPORT_TEST_PASSWORD.as_bytes())
            .unwrap();
        let mut text = String::new();
        entry.read_to_string(&mut text).unwrap();
        text
    }

    #[test]
    fn password_protected_exports_leave_only_the_destination_and_no_plaintext() {
        let dir = ExportTestDir::new("export-no-plaintext");
        let pw = Some(EXPORT_TEST_PASSWORD);
        let docx = dir.0.join("a.docx");
        let xlsx = dir.0.join("b.xlsx");
        let json = dir.0.join("c.json");
        let srt = dir.0.join("d.srt");

        write_transcription_docx(&export_test_docx_request(&docx, pw)).unwrap();
        write_transcription_xlsx(&export_test_xlsx_request(&xlsx, pw)).unwrap();
        write_transcription_json(&export_test_json_request(&json, pw)).unwrap();
        write_transcription_srt(&export_test_srt_request(&srt, pw)).unwrap();

        // 一時ファイル（.tmp など）が残らない
        assert_eq!(dir.file_names(), vec!["a.docx", "b.xlsx", "c.json", "d.srt"]);
        for path in [&docx, &xlsx, &json, &srt] {
            let bytes = fs::read(path).unwrap();
            assert!(!contains_bytes(&bytes, EXPORT_TEST_MARKER.as_bytes()), "{path:?}");
        }
        // Office は暗号化コンテナ（CFB）で、平文の ZIP ではない
        for path in [&docx, &xlsx] {
            assert_eq!(&fs::read(path).unwrap()[..8], &CFB_MAGIC);
        }
        // JSON / SRT はパスワードで復号でき、内容が元どおり
        assert!(read_aes_zip_entry(&json, "c.json").contains(EXPORT_TEST_MARKER));
        let srt_text = read_aes_zip_entry(&srt, "d.srt");
        assert!(srt_text.contains(EXPORT_TEST_MARKER));
        assert!(srt_text.contains("00:00:00,000 --> 00:00:01,500"));
    }

    #[test]
    fn exports_without_password_still_write_plain_files() {
        let dir = ExportTestDir::new("export-plain");
        let docx = dir.0.join("a.docx");
        let xlsx = dir.0.join("b.xlsx");
        let json = dir.0.join("c.json");
        let srt = dir.0.join("d.srt");

        write_transcription_docx(&export_test_docx_request(&docx, None)).unwrap();
        write_transcription_xlsx(&export_test_xlsx_request(&xlsx, Some(""))).unwrap();
        write_transcription_json(&export_test_json_request(&json, None)).unwrap();
        write_transcription_srt(&export_test_srt_request(&srt, None)).unwrap();

        assert_eq!(dir.file_names(), vec!["a.docx", "b.xlsx", "c.json", "d.srt"]);
        for (path, entry) in [(&docx, "word/document.xml"), (&xlsx, "xl/worksheets/sheet1.xml")] {
            use std::io::Read;
            let mut archive = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
            let mut xml = String::new();
            archive.by_name(entry).unwrap().read_to_string(&mut xml).unwrap();
            assert!(xml.contains(EXPORT_TEST_MARKER));
        }
        assert!(fs::read_to_string(&json).unwrap().contains(EXPORT_TEST_MARKER));
        assert!(fs::read_to_string(&srt).unwrap().contains(EXPORT_TEST_MARKER));
    }

    #[test]
    fn password_protected_export_to_missing_folder_writes_no_file() {
        let dir = ExportTestDir::new("export-missing-folder");
        let missing = dir.0.join("no-such-folder");
        let pw = Some(EXPORT_TEST_PASSWORD);

        assert!(write_transcription_docx(&export_test_docx_request(&missing.join("a.docx"), pw)).is_err());
        assert!(write_transcription_xlsx(&export_test_xlsx_request(&missing.join("b.xlsx"), pw)).is_err());
        assert!(write_transcription_json(&export_test_json_request(&missing.join("c.json"), pw)).is_err());
        assert!(write_transcription_srt(&export_test_srt_request(&missing.join("d.srt"), pw)).is_err());

        assert!(!missing.exists());
        assert!(dir.file_names().is_empty());
    }

    #[test]
    fn failed_password_protected_export_keeps_existing_destination() {
        // 保存先が中身のあるフォルダだと、最後の置き換えだけが失敗する
        let dir = ExportTestDir::new("export-failed-replace");
        let pw = Some(EXPORT_TEST_PASSWORD);
        for name in ["a.docx", "b.xlsx", "c.json", "d.srt"] {
            let destination = dir.0.join(name);
            fs::create_dir_all(&destination).unwrap();
            fs::write(destination.join("keep.txt"), b"keep").unwrap();
        }

        assert!(write_transcription_docx(&export_test_docx_request(&dir.0.join("a.docx"), pw)).is_err());
        assert!(write_transcription_xlsx(&export_test_xlsx_request(&dir.0.join("b.xlsx"), pw)).is_err());
        assert!(write_transcription_json(&export_test_json_request(&dir.0.join("c.json"), pw)).is_err());
        assert!(write_transcription_srt(&export_test_srt_request(&dir.0.join("d.srt"), pw)).is_err());

        assert_eq!(dir.file_names(), vec!["a.docx", "b.xlsx", "c.json", "d.srt"]);
        for name in ["a.docx", "b.xlsx", "c.json", "d.srt"] {
            let destination = dir.0.join(name);
            assert_eq!(fs::read(destination.join("keep.txt")).unwrap(), b"keep");
            // フォルダの中にも一時ファイルは無い
            assert_eq!(fs::read_dir(&destination).unwrap().count(), 1);
        }
    }

    #[test]
    fn password_protected_export_overwrites_existing_file_with_ciphertext_only() {
        let dir = ExportTestDir::new("export-overwrite");
        let docx = dir.0.join("a.docx");
        fs::write(&docx, b"old document").unwrap();

        write_transcription_docx(&export_test_docx_request(&docx, Some(EXPORT_TEST_PASSWORD))).unwrap();

        assert_eq!(dir.file_names(), vec!["a.docx"]);
        assert_eq!(&fs::read(&docx).unwrap()[..8], &CFB_MAGIC);
    }

    #[test]
    fn prepend_dir_to_path_puts_dir_first_and_skips_duplicates() {
        let dir = PathBuf::from("vk-loader");
        let current = env::join_paths([PathBuf::from("a"), PathBuf::from("b")]).unwrap();
        let out = prepend_dir_to_path(&current, &dir).unwrap();
        let parts: Vec<PathBuf> = env::split_paths(&out).collect();
        assert_eq!(parts, vec![dir.clone(), PathBuf::from("a"), PathBuf::from("b")]);
        assert!(prepend_dir_to_path(&out, &dir).is_none());
    }

    #[test]
    fn editor_whisper_voice_input_pack_requires_engine_and_both_models() {
        assert!(editor_whisper_voice_input_pack_installed(true, true));
        assert!(!editor_whisper_voice_input_pack_installed(false, true));
        assert!(!editor_whisper_voice_input_pack_installed(true, false));
        assert!(!editor_whisper_voice_input_pack_installed(false, false));
        assert_eq!(
            whisper_voice_input_pack_total_bytes(),
            ggml_speech::GGML_MODEL_FILES
                .iter()
                .filter(|model| model.component == "whisper_turbo")
                .map(|model| model.size)
                .sum::<u64>()
        );
    }

    #[test]
    fn vulkan_legacy_e4b_targets_are_limited_to_the_three_e4b_assets() {
        let models_root = Path::new("app-data/models");
        let model_dir = models_root.join("llm").join("gemma-4-e4b-it");
        assert_eq!(
            legacy_e4b_model_files(models_root),
            vec![
                model_dir.join(GEMMA_MAIN_GGUF_FILENAME),
                model_dir.join(GEMMA_MTP_GGUF_FILENAME),
                model_dir.join(GEMMA_MMPROJ_GGUF_FILENAME),
            ]
        );
    }

    #[test]
    fn legacy_data_notice_ignores_empty_items_but_keeps_small_files() {
        let root = env::temp_dir().join(private_temp_name("legacy-data-test"));
        fs::create_dir_all(root.join("empty-dir/nested")).unwrap();
        fs::write(root.join("empty-file"), b"").unwrap();
        fs::write(root.join("small-file"), b"x").unwrap();
        let candidates = ["empty-dir", "empty-file", "small-file", "missing"]
            .into_iter().map(|name| (name.to_string(), root.join(name))).collect();
        let items = existing_legacy_data_items(candidates);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].label, "small-file");
        assert_eq!(items[0].bytes, Some(1));
        assert_eq!(dir_size_bytes(&root.join("missing")), None);
        let unknown = serde_json::to_value(LegacyDataItem {
            label: "unknown".into(), path: "not-read".into(), bytes: None,
        }).unwrap();
        assert!(unknown["bytes"].is_null());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn legacy_data_does_not_follow_links_or_report_them_as_empty() {
        let root = env::temp_dir().join(private_temp_name("legacy-link-test"));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("target"), b"keep").unwrap();
        std::os::unix::fs::symlink(root.join("target"), root.join("link")).unwrap();
        let items = existing_legacy_data_items(vec![("link".into(), root.join("link"))]);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].bytes, None);
        assert_eq!(dir_size_bytes(&root), None);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn editor_legacy_data_candidates_exclude_current_speech_models() {
        let candidates = editor_legacy_data_candidates(
            Some(Path::new("app-data/models")),
            Some(Path::new("app-cache")),
            Some(Path::new("app-data")),
        );
        let paths = candidates
            .iter()
            .map(|(_, path)| path.to_string_lossy().replace('\\', "/"))
            .collect::<Vec<_>>();
        assert!(paths
            .iter()
            .any(|path| path.ends_with(GEMMA_MAIN_GGUF_FILENAME)));
        assert!(paths
            .iter()
            .any(|path| path.ends_with(GEMMA_MMPROJ_GGUF_FILENAME)));
        assert!(paths
            .iter()
            .any(|path| path.ends_with("llm-engine/bin/llamacpp/cpu")));
        assert!(paths.iter().any(|path| path.ends_with("lemonade")));
        assert!(paths.iter().any(|path| path.ends_with("/ffmpeg")));
        assert!(paths.iter().all(|path| !path.contains("whisper-ggml")));
        assert!(paths.iter().all(|path| !path.contains("nemotron")));
    }

    #[test]
    fn legacy_hf_hub_dir_is_app_private_and_ignores_hf_env() {
        // 他のアプリと共用の HF キャッシュを指す環境変数があっても、旧データの対象はアプリ専用
        // ディレクトリ配下に限る（削除ボタンで他アプリのモデルを消さない）。
        let saved: Vec<(&str, Option<String>)> = ["HF_HUB_CACHE", "HF_HOME"]
            .iter()
            .map(|name| (*name, env::var(name).ok()))
            .collect();
        env::set_var("HF_HUB_CACHE", "shared-cache-of-other-apps/hub");
        env::set_var("HF_HOME", "shared-hf-home");
        let data_dir = Path::new("app-data");
        let hub = legacy_app_hf_hub_dir(data_dir);
        for (name, value) in saved {
            match value {
                Some(v) => env::set_var(name, v),
                None => env::remove_var(name),
            }
        }
        assert!(hub.starts_with(data_dir));
        assert_eq!(hub, data_dir.join("hf_cache").join("hub"));
        let text = hub.to_string_lossy();
        assert!(!text.contains("shared-cache-of-other-apps"));
        assert!(!text.contains("shared-hf-home"));
    }

    #[test]
    fn legacy_faster_whisper_dirs_only_come_from_the_given_hub() {
        let root = env::temp_dir().join(private_temp_name("legacy-hf-test"));
        let hub = root.join("hf_cache").join("hub");
        fs::create_dir_all(hub.join("models--Systran--faster-whisper-large-v3")).unwrap();
        fs::create_dir_all(hub.join("models--someone--other-model")).unwrap();
        let dirs = legacy_faster_whisper_model_dirs(&hub);
        assert_eq!(dirs.len(), 1);
        assert!(dirs[0].1.starts_with(&hub));
        assert!(dirs[0].0.contains("Systran--faster-whisper-large-v3"));
        assert!(legacy_faster_whisper_model_dirs(&root.join("missing")).is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn wer_exclusions_cover_engines_and_own_exe_but_not_generic_ffmpeg() {
        let names = wer_excluded_exe_names(Some("lott.exe"));
        assert!(names.iter().any(|n| n == "whisper-cli.exe"));
        assert!(names.iter().any(|n| n == "nemo-speech.exe"));
        assert!(names.iter().any(|n| n == "lott.exe"));
        assert!(names.iter().all(|n| !n.to_ascii_lowercase().contains("ffmpeg")));
        assert!(WER_EXCLUDED_CHILD_EXES
            .iter()
            .all(|n| !n.to_ascii_lowercase().contains("ffmpeg")));
        // 本体名が子と同じでも、空でも、重複・空エントリを作らない。
        assert_eq!(wer_excluded_exe_names(Some("WHISPER-CLI.EXE")).len(), 2);
        assert_eq!(wer_excluded_exe_names(Some("")).len(), 2);
        assert_eq!(wer_excluded_exe_names(None).len(), 2);
    }

    #[test]
    fn error_mode_adds_fault_ui_suppression_and_keeps_existing_bits() {
        let mode = error_mode_without_fault_ui(0x8000); // SEM_NOOPENFILEERRORBOX
        assert_eq!(mode & 0x0001, 0x0001);
        assert_eq!(mode & 0x0002, 0x0002);
        assert_eq!(mode & 0x8000, 0x8000);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn child_job_flags_kill_on_close_and_die_on_unhandled_exception() {
        use windows_sys::Win32::System::JobObjects::{
            JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        let flags = child_job_limit_flags();
        assert_eq!(
            flags & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        );
        assert_eq!(
            flags & JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
            JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn suppress_windows_fault_reporting_ui_sets_error_mode_bits() {
        // テストプロセスのエラーモードを変えるが、足すのはダイアログ抑止ビットだけで、
        // 他のテストの結果には影響しない（クラッシュ時に WER ダイアログが出なくなるだけ）。
        use windows_sys::Win32::System::Diagnostics::Debug::{
            GetErrorMode, SEM_FAILCRITICALERRORS, SEM_NOGPFAULTERRORBOX,
        };
        suppress_windows_fault_reporting_ui();
        let mode = unsafe { GetErrorMode() };
        assert_eq!(mode & SEM_NOGPFAULTERRORBOX, SEM_NOGPFAULTERRORBOX);
        assert_eq!(mode & SEM_FAILCRITICALERRORS, SEM_FAILCRITICALERRORS);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn wer_exclusion_registers_in_hkcu_and_can_be_cleaned_up() {
        // 実在しない専用の名前だけを登録・削除する（既存の除外登録には触れない）。
        const KEY: &str = r"HKCU\Software\Microsoft\Windows\Windows Error Reporting\ExcludedApplications";
        let name = format!("lott-test-{}.exe", std::process::id());
        let query = |name: &str| {
            Command::new("reg")
                .args(["query", KEY, "/v", name])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        };
        assert!(!query(&name));
        wer_add_excluded_application(&name).expect("WerAddExcludedApplication should succeed");
        let registered = query(&name);
        // 冪等であること
        let again = wer_add_excluded_application(&name);
        let _ = wer_remove_excluded_application(&name);
        assert!(registered, "ExcludedApplications に {name} が作られていない");
        assert!(again.is_ok());
        assert!(!query(&name), "テストで作った値が消えていない");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn disable_core_dumps_sets_rlimit_core_to_zero() {
        // 自プロセスにだけ効く。テストプロセスがコアを吐かなくなるだけで他のテストには影響しない。
        assert!(disable_core_dumps());
        let mut limit = libc::rlimit {
            rlim_cur: 1,
            rlim_max: 1,
        };
        let rc = unsafe { libc::getrlimit(libc::RLIMIT_CORE, &mut limit) };
        assert_eq!(rc, 0);
        assert_eq!(limit.rlim_cur, 0);
        assert_eq!(limit.rlim_max, 0);
    }

    #[test]
    fn legacy_vulkan_llama_server_uses_the_bundled_resource_dir() {
        assert_eq!(
            legacy_vulkan_llama_server_resource_dir(Path::new("install")),
            Path::new("install/resources/llama-server-vulkan")
        );
    }

    fn rule_punct_segments(rows: &[(&str, &str, f64, f64)]) -> Vec<ProofreadSegmentInput> {
        rows.iter()
            .enumerate()
            .map(|(i, (speaker, text, start, end))| ProofreadSegmentInput {
                id: i as i64,
                text: text.to_string(),
                speaker: Some(speaker.to_string()),
                start: Some(*start),
                end: Some(*end),
            })
            .collect()
    }

    fn bundled_punct_rules() -> PunctRules {
        punct_rules_from_json(include_str!(
            "../resources/proofread/punctuation_rules/punctuation_addition.json"
        ))
    }

    #[test]
    fn rule_punctuation_keeps_whisper_cpp_punctuation_and_fills_only_missing_endings() {
        let rules = bundled_punct_rules();
        let segments = rule_punct_segments(&[
            ("SPEAKER_00", "はい、今回どうされましたか。", 0.0, 2.0),
            ("SPEAKER_01", "なんか、会社行っても、", 2.5, 4.0),
            ("SPEAKER_01", "なんかパソコンつけて、ぼーっとしてる時間が長くなってきたなーとか。", 4.2, 8.0),
            ("SPEAKER_00", "いつ頃からそんな感じなんですか", 8.5, 10.0),
        ]);
        let mut stats = PunctuationRuntimeStats::default();
        let out = punctuate_segments_by_speaker_group_rust(&segments, &rules, &mut stats);
        // 句読点で終わっている行（whisper.cpp の出力のほぼすべて）は変えない
        for segment in &segments[..3] {
            assert_eq!(out[&segment.id], segment.text);
        }
        // 句読点が無い行だけ末尾を補う
        assert!(out[&3].starts_with("いつ頃からそんな感じなんですか"));
        assert!(ends_with_japanese_punctuation(&out[&3]));

        // 「まあ」「ので」などの後の読点は、すでに句読点がある所には重ねない
        assert_eq!(punctuate_text_rust("まあ、先月ぐらいからは。", &rules, &mut stats), "まあ、先月ぐらいからは。");
        assert_eq!(punctuate_text_rust("子供教えてたので。", &rules, &mut stats), "子供教えてたので。");
        assert_eq!(punctuate_text_rust("次というか、もう。", &rules, &mut stats), "次というか、もう。");
        assert_eq!(punctuate_text_rust("なので、そう。", &rules, &mut stats), "なので、そう。");
        assert_eq!(punctuate_text_rust("まあいいか。", &rules, &mut stats), "まあいいか。");
        assert_eq!(punctuate_text_rust("あのですね、理由が。", &rules, &mut stats), "あのですね、理由が。");
        // 句読点の無い行（faster-whisper）には従来どおり読点を入れる
        assert_eq!(punctuate_text_rust("まあいいか", &rules, &mut stats), "まあ、いいか");
    }

    /// 手動確認: `demo_data/proofread-eval/inputs/*.json`（whisper.cpp の出力）にルールをかけ、変わる行を数える。
    #[test]
    #[ignore = "demo_data（git 管理外）の文字起こしが必要"]
    fn rule_punctuation_report_on_demo_transcripts() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../demo_data/proofread-eval/inputs");
        let rules = bundled_punct_rules();
        for entry in fs::read_dir(&dir).expect("demo_data/proofread-eval/inputs") {
            let path = entry.expect("entry").path();
            let data: Value = serde_json::from_str(&fs::read_to_string(&path).expect("read")).expect("json");
            let segments: Vec<ProofreadSegmentInput> = data["segments"]
                .as_array()
                .expect("segments")
                .iter()
                .enumerate()
                .map(|(i, s)| ProofreadSegmentInput {
                    id: i as i64,
                    text: normalize_ja_symbol_width(s["text"].as_str().unwrap_or("").trim()),
                    speaker: s["speaker"].as_str().map(str::to_string),
                    start: s["start"].as_f64(),
                    end: s["end"].as_f64(),
                })
                .collect();
            let mut stats = PunctuationRuntimeStats::default();
            let out = punctuate_segments_by_speaker_group_rust(&segments, &rules, &mut stats);
            let changed: Vec<_> = segments
                .iter()
                .filter(|s| out.get(&s.id).is_some_and(|t| *t != s.text))
                .collect();
            println!("{}: {} 行中 {} 行を変更", path.display(), segments.len(), changed.len());
            for s in changed {
                println!("  {} → {}", s.text, out[&s.id]);
            }
        }
    }

    #[test]
    fn japanese_question_and_exclamation_marks_become_full_width() {
        assert_eq!(normalize_ja_symbol_width("何が良かったの?"), "何が良かったの？");
        assert_eq!(normalize_ja_symbol_width("え?そっか!"), "え？そっか！");
        assert_eq!(normalize_ja_symbol_width("マジで??"), "マジで？？");
        // 英字・数字の直後は英語の表記として残す（続く記号も揃える）
        assert_eq!(normalize_ja_symbol_width("OK?!わかった?"), "OK?!わかった？");
        assert_eq!(normalize_ja_symbol_width("そうですね。"), "そうですね。");
    }

    #[test]
    fn transcription_text_normalization_is_japanese_only() {
        assert_eq!(
            normalize_transcription_output_text("何が良かったの?", "ja"),
            "何が良かったの？"
        );
        assert_eq!(normalize_transcription_output_text("Why?!", "en"), "Why?!");
    }

    #[test]
    fn japanese_punctuation_rules_are_not_applied_to_other_languages() {
        assert!(should_run_japanese_punctuation("ja", "all"));
        assert!(should_run_japanese_punctuation("JA", "punct"));
        assert!(!should_run_japanese_punctuation("en", "all"));
        assert!(!should_run_japanese_punctuation("fr", "punct"));
        assert!(!should_run_japanese_punctuation("ja", "entity"));
    }

    #[test]
    fn ggml_model_table_is_pinned_and_verifiable() {
        for model in ggml_speech::GGML_MODEL_FILES.iter() {
            assert!(matches!(model.component, "whisper_turbo" | "diarization"));
            assert_eq!(model.sha256.len(), 64);
            assert!(model.sha256.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
            assert!(model.url.starts_with("https://huggingface.co/"));
            // revision は commit（40桁）で固定し、main など動く参照を使わない
            let rev = model.url.split("/resolve/").nth(1).and_then(|r| r.split('/').next()).unwrap_or("");
            assert_eq!(rev.len(), 40, "{}", model.url);
            assert!(model.url.ends_with(model.file));
            assert!(model.size > 0);
        }
    }

    /// AppImage の AppRun が入れる $APPDIR 配下のライブラリ探索パスを、ホストコマンド
    /// （xdg-open / nvidia-smi など）へ渡さないこと。渡すと Arch 系ホストの /bin/sh が
    /// 同梱 libreadline.so.8 を掴んで `undefined symbol: rl_print_keybinding` で死ぬ。
    #[cfg(target_os = "linux")]
    #[test]
    fn host_command_env_drops_appdir_entries_and_keeps_host_ones() {
        use std::collections::HashMap;
        use std::ffi::OsString;

        let appdir = Path::new("/tmp/.mount_LoTTxy");
        let env: HashMap<&str, &str> = HashMap::from([
            (
                "LD_LIBRARY_PATH",
                "/tmp/.mount_LoTTxy/usr/lib:/opt/rocm/lib:/tmp/.mount_LoTTxy/usr/lib/x86_64-linux-gnu",
            ),
            ("PATH", "/tmp/.mount_LoTTxy/usr/bin:/usr/bin:/bin"),
            ("GST_PLUGIN_SYSTEM_PATH", "/tmp/.mount_LoTTxy/usr/lib/gstreamer-1.0"),
            ("PYTHONHOME", "/tmp/.mount_LoTTxy/usr/"),
            // hook が入れる GTK_PATH は AppDir + ホストの複合値。ホスト側だけ残す。
            (
                "GTK_PATH",
                "/tmp/.mount_LoTTxy/usr/lib/x86_64-linux-gnu/gtk-3.0:/usr/lib/x86_64-linux-gnu/gtk-3.0",
            ),
            ("XDG_CONFIG_DIRS", "/etc/xdg"),
        ]);
        let overrides: HashMap<OsString, Option<OsString>> =
            host_command_env_overrides(appdir, None, |name| env.get(name).map(OsString::from))
                .into_iter()
                .collect();

        assert_eq!(
            overrides.get(&OsString::from("LD_LIBRARY_PATH")),
            Some(&Some(OsString::from("/opt/rocm/lib")))
        );
        assert_eq!(
            overrides.get(&OsString::from("PATH")),
            Some(&Some(OsString::from("/usr/bin:/bin")))
        );
        // AppDir だけを指していた変数は削除する。
        assert_eq!(
            overrides.get(&OsString::from("GST_PLUGIN_SYSTEM_PATH")),
            Some(&None)
        );
        assert_eq!(overrides.get(&OsString::from("PYTHONHOME")), Some(&None));
        assert_eq!(
            overrides.get(&OsString::from("GTK_PATH")),
            Some(&Some(OsString::from("/usr/lib/x86_64-linux-gnu/gtk-3.0")))
        );
        // ホスト由来の値には触らない。
        assert!(!overrides.contains_key(&OsString::from("XDG_CONFIG_DIRS")));
    }

    /// AppDir を全部取り除くと PATH が空になる場合は、標準パスへ戻す（空にしない）。
    #[cfg(target_os = "linux")]
    #[test]
    fn host_command_env_never_leaves_path_empty() {
        use std::collections::HashMap;
        use std::ffi::OsString;

        let appdir = Path::new("/tmp/.mount_LoTTxy");
        let env: HashMap<&str, &str> = HashMap::from([("PATH", "/tmp/.mount_LoTTxy/usr/bin")]);
        let overrides =
            host_command_env_overrides(appdir, None, |name| env.get(name).map(OsString::from));
        assert_eq!(
            overrides,
            vec![(
                OsString::from("PATH"),
                Some(OsString::from("/usr/local/bin:/usr/bin:/bin"))
            )]
        );
    }

    /// 同梱フォールバック Vulkan ローダーのディレクトリだけは AppDir 内でも残す。
    /// 他の AppDir エントリ（同梱 libreadline 等）は従来どおり外す。
    #[test]
    fn webkit_shm_workaround_decision() {
        use std::collections::HashMap;
        let decide = |vars: &[(&str, &str)], nvidia: bool| {
            let env: HashMap<String, String> = vars
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect();
            should_force_webkit_shm(|name| env.get(name).cloned(), nvidia)
        };
        assert!(decide(&[], true));
        assert!(!decide(&[], false));
        assert!(!decide(&[("LOTT_ENABLE_DMABUF_RENDERER", "1")], true));
        assert!(decide(&[("LOTT_ENABLE_DMABUF_RENDERER", "0")], true));
        assert!(!decide(&[("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "0")], true));
        assert!(!decide(&[("WEBKIT_DISABLE_DMABUF_RENDERER", "1")], true));
    }

    #[test]
    fn webkit_shm_overrides_keep_compositing_on_ubuntu_nvidia() {
        use std::collections::HashMap;
        let decide = |vars: &[(&str, &str)], nvidia: bool| {
            let env: HashMap<String, String> = vars
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect();
            webkit_shm_env_overrides(|name| env.get(name).cloned(), nvidia)
        };
        assert_eq!(
            decide(&[], true),
            vec![
                ("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1"),
                ("WEBKIT_FORCE_DMABUF_RENDERER", "1"),
            ]
        );
        // Ubuntu の NVIDIA 判定だけを回避する追加値も、ユーザー指定を上書きしない。
        assert_eq!(
            decide(&[("WEBKIT_FORCE_DMABUF_RENDERER", "0")], true),
            vec![("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1")]
        );
        for vars in [
            vec![("LOTT_ENABLE_DMABUF_RENDERER", "1")],
            vec![("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "0")],
            vec![("WEBKIT_DISABLE_DMABUF_RENDERER", "1")],
        ] {
            assert!(decide(&vars, true).is_empty());
        }
        assert!(decide(&[], false).is_empty());
    }

    #[test]
    fn filter_appdir_entries_keeps_only_registered_loader_dir() {
        let appdir = Path::new("/tmp/.mount_LoTTxy");
        let loader = Path::new("/tmp/.mount_LoTTxy/usr/lib/lott/resources/speech-engines/vulkan-loader");
        let value = env::join_paths([
            Path::new("/tmp/.mount_LoTTxy/usr/lib"),
            loader,
            Path::new("/opt/rocm/lib"),
        ])
        .unwrap();

        let (total, kept) = filter_appdir_entries(&value, appdir, Some(loader));
        assert_eq!(total, 3);
        assert_eq!(kept, vec![loader.to_path_buf(), PathBuf::from("/opt/rocm/lib")]);

        let (_, kept) = filter_appdir_entries(&value, appdir, None);
        assert_eq!(kept, vec![PathBuf::from("/opt/rocm/lib")]);
    }

    #[test]
    fn srt_timestamp_uses_hours_and_milliseconds() {
        assert_eq!(format_srt_timestamp(0.0), "00:00:00,000");
        assert_eq!(format_srt_timestamp(3661.234), "01:01:01,234");
        assert_eq!(format_srt_timestamp(-1.0), "00:00:00,000");
    }

    #[test]
    fn transcription_srt_uses_display_speaker_and_skips_blank_rows() {
        let rows = vec![
            SaveTranscriptionSrtRow {
                start_seconds: 1.25,
                end_seconds: 3.5,
                speaker: "Th".to_string(),
                text: "こんにちは。".to_string(),
            },
            SaveTranscriptionSrtRow {
                start_seconds: 3.5,
                end_seconds: 4.0,
                speaker: "Cl".to_string(),
                text: "  ".to_string(),
            },
            SaveTranscriptionSrtRow {
                start_seconds: 4.0,
                end_seconds: 6.0,
                speaker: "-".to_string(),
                text: "話者未設定".to_string(),
            },
        ];
        assert_eq!(
            build_transcription_srt(&rows),
            "1\n00:00:01,250 --> 00:00:03,500\nTh：こんにちは。\n\n2\n00:00:04,000 --> 00:00:06,000\n話者未設定\n\n"
        );
    }

    #[test]
    fn runtime_estimate_csv_preserves_frontend_format_and_sorts_by_date() {
        let samples = vec![
            RuntimeEstimateLogSample {
                audio_seconds: 120.49,
                elapsed_seconds: 61.5,
                diarization: false,
                device: "cpu".to_string(),
                compute_type: "int8".to_string(),
                created_at: 1_000.0,
                file_size_bytes: None,
            },
            RuntimeEstimateLogSample {
                audio_seconds: 60.5,
                elapsed_seconds: 30.4,
                diarization: true,
                device: "cuda".to_string(),
                compute_type: "float16".to_string(),
                created_at: 0.0,
                file_size_bytes: Some(1024.0 * 1024.0),
            },
        ];

        assert_eq!(
            build_runtime_estimate_csv(samples).unwrap(),
            "\"日時\",\"ファイル音声長\",\"AI句読点付与までの所要時間\",\"ファイルサイズ\",\"話者分離\",\"実行デバイス\",\"計算方式\"\n\
             \"1970/01/01 09:00:00\",\"1分1秒\",\"0分30秒\",\"1.00 MB\",\"あり\",\"CUDA\",\"float16\"\n\
             \"1970/01/01 09:00:01\",\"2分0秒\",\"1分2秒\",\"\",\"なし\",\"CPU\",\"int8\""
        );
    }

    #[test]
    fn runtime_estimate_csv_escapes_text_and_rejects_invalid_dates() {
        assert_eq!(escape_runtime_csv_value("123.45"), "123.45");
        assert_eq!(escape_runtime_csv_value("a,\"b\""), "\"a,\"\"b\"\"\"");
        assert!(build_runtime_estimate_csv(vec![RuntimeEstimateLogSample {
            audio_seconds: 1.0,
            elapsed_seconds: 1.0,
            diarization: false,
            device: "cpu".to_string(),
            compute_type: "int8".to_string(),
            created_at: f64::NAN,
            file_size_bytes: None,
        }])
        .is_err());
    }

    #[test]
    fn cpu_startup_requirements_accept_exact_minimum() {
        assert!(cpu_startup_requirement_failures(
            Some(CPU_MINIMUM_MEMORY_BYTES),
            true,
            CPU_MINIMUM_LOGICAL_THREADS,
        )
        .is_empty());
    }

    #[test]
    fn cpu_startup_requirements_report_each_fundamental_shortage() {
        let failures = cpu_startup_requirement_failures(
            Some(CPU_MINIMUM_MEMORY_BYTES - 1),
            false,
            CPU_MINIMUM_LOGICAL_THREADS - 1,
        );
        assert_eq!(
            failures,
            vec![
                CpuStartupRequirementFailure::Memory {
                    installed_bytes: CPU_MINIMUM_MEMORY_BYTES - 1,
                },
                CpuStartupRequirementFailure::Avx2,
                CpuStartupRequirementFailure::LogicalThreads {
                    detected: CPU_MINIMUM_LOGICAL_THREADS - 1,
                },
            ]
        );
    }

    #[test]
    fn cpu_startup_requirements_do_not_block_when_memory_cannot_be_read() {
        assert!(
            cpu_startup_requirement_failures(None, true, CPU_MINIMUM_LOGICAL_THREADS,).is_empty()
        );
    }

    #[test]
    fn dev_cpu_startup_scenario_parser_accepts_documented_values() {
        assert_eq!(
            parse_dev_cpu_startup_scenario(" memory "),
            Some(DevCpuStartupScenario::Memory)
        );
        assert_eq!(
            parse_dev_cpu_startup_scenario("AVX2"),
            Some(DevCpuStartupScenario::Avx2)
        );
        assert_eq!(
            parse_dev_cpu_startup_scenario("threads"),
            Some(DevCpuStartupScenario::Threads)
        );
        assert_eq!(
            parse_dev_cpu_startup_scenario("all"),
            Some(DevCpuStartupScenario::All)
        );
        assert_eq!(
            parse_dev_cpu_startup_scenario("notice"),
            Some(DevCpuStartupScenario::Notice)
        );
        assert_eq!(parse_dev_cpu_startup_scenario("unknown"), None);
    }

    #[test]
    fn dev_cpu_startup_scenarios_produce_expected_failures() {
        let memory = dev_cpu_startup_scenario_inputs(DevCpuStartupScenario::Memory);
        assert_eq!(
            cpu_startup_requirement_failures(memory.0, memory.1, memory.2),
            vec![CpuStartupRequirementFailure::Memory {
                installed_bytes: 8 * 1024_u64.pow(3),
            }]
        );

        let all = dev_cpu_startup_scenario_inputs(DevCpuStartupScenario::All);
        assert_eq!(
            cpu_startup_requirement_failures(all.0, all.1, all.2).len(),
            3
        );

        let notice = dev_cpu_startup_scenario_inputs(DevCpuStartupScenario::Notice);
        assert!(cpu_startup_requirement_failures(notice.0, notice.1, notice.2).is_empty());
    }

    #[test]
    fn audio_stream_token_comparison_rejects_missing_or_changed_tokens() {
        let expected = "0123456789abcdef";
        assert!(constant_time_token_eq(expected, expected));
        assert!(!constant_time_token_eq("", expected));
        assert!(!constant_time_token_eq("0123456789abcdee", expected));
    }

    #[test]
    fn ffmpeg_duration_line_is_parsed_into_seconds() {
        let line = "  Duration: 00:50:12.34, start: 0.000000, bitrate: 128 kb/s";
        let seconds = parse_ffmpeg_duration_line(line).expect("duration should parse");
        assert!((seconds - 3012.34).abs() < 0.01);
        assert_eq!(
            parse_ffmpeg_duration_line("  Duration: N/A, start: 0.000000, bitrate: N/A"),
            None
        );
        assert_eq!(
            parse_ffmpeg_duration_line("  Stream #0:0: Audio: aac"),
            None
        );
    }

    #[test]
    fn ffmpeg_audio_codec_line_is_parsed() {
        assert_eq!(
            parse_ffmpeg_audio_codec_line(
                "  Stream #0:0[0x1](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s"
            )
            .as_deref(),
            Some("aac")
        );
        assert_eq!(
            parse_ffmpeg_audio_codec_line(
                "  Stream #0:0: Audio: pcm_s16le, 16000 Hz, mono, s16, 256 kb/s"
            )
            .as_deref(),
            Some("pcm_s16le")
        );
        assert_eq!(
            parse_ffmpeg_audio_codec_line("  Stream #0:0: Video: h264, yuv420p"),
            None
        );
    }

    #[test]
    fn only_lgpl_decodable_codecs_skip_playback_transcoding() {
        // gst-plugins-base/good（LGPL）だけで再生できるもの
        for codec in ["pcm_s16le", "pcm_f32le", "mp3", "flac", "vorbis", "opus"] {
            assert!(
                codec_is_directly_playable(codec),
                "{codec} should play directly"
            );
        }
        // LGPL 側にデコーダが無く、同梱 ffmpeg での FLAC 変換が要るもの
        for codec in ["aac", "alac", "ac3", "wmav2"] {
            assert!(
                !codec_is_directly_playable(codec),
                "{codec} should be transcoded"
            );
        }
    }

    fn assert_regex_compiles(name: &str, pattern: Option<&str>) {
        if let Some(pattern) = pattern {
            Regex::new(pattern.trim())
                .unwrap_or_else(|err| panic!("{name} regex should compile: {err}"));
        }
    }

    #[test]
    fn configured_entity_regex_patterns_compile() {
        let raw: EntityRulesFile = serde_json::from_str(include_str!(
            "../resources/proofread/punctuation_rules/named_entity_detection.json"
        ))
        .expect("named entity detection JSON should parse");

        if let Some(rule) = raw.person_honorific_rule {
            assert_regex_compiles(
                "personHonorificRule.namedPersonHonorificPattern",
                rule.named_person_honorific_pattern.as_deref(),
            );
        }
        if let Some(rule) = raw.university_rule {
            assert_regex_compiles(
                "universityRule.namedUniversityPattern",
                rule.named_university_pattern.as_deref(),
            );
            assert_regex_compiles(
                "universityRule.namedElementarySchoolPattern",
                rule.named_elementary_school_pattern.as_deref(),
            );
            assert_regex_compiles(
                "universityRule.namedMiddleSchoolPattern",
                rule.named_middle_school_pattern.as_deref(),
            );
            assert_regex_compiles(
                "universityRule.namedHighSchoolPattern",
                rule.named_high_school_pattern.as_deref(),
            );
            assert_regex_compiles(
                "universityRule.namedNurseryPattern",
                rule.named_nursery_pattern.as_deref(),
            );
            assert_regex_compiles(
                "universityRule.namedKindergartenPattern",
                rule.named_kindergarten_pattern.as_deref(),
            );
        }
        if let Some(rule) = raw.hospital_rule {
            assert_regex_compiles(
                "hospitalRule.namedHospitalPattern",
                rule.named_hospital_pattern.as_deref(),
            );
            assert_regex_compiles(
                "hospitalRule.namedClinicPattern",
                rule.named_clinic_pattern.as_deref(),
            );
            assert_regex_compiles(
                "hospitalRule.namedMedicalOfficePattern",
                rule.named_medical_office_pattern.as_deref(),
            );
        }
        if let Some(rule) = raw.organization_rule {
            for (index, pattern) in rule.named_institution_patterns.iter().enumerate() {
                let name = format!("organizationRule.namedInstitutionPatterns[{index}]");
                assert_regex_compiles(&name, Some(pattern));
            }
        }
        for (index, pattern) in raw.station_like_location_patterns.iter().enumerate() {
            let name = format!("stationLikeLocationPatterns[{index}]");
            assert_regex_compiles(&name, Some(pattern));
        }
    }

    #[test]
    fn school_patterns_detect_named_extended_school_types() {
        let rules = EntityRules::default();
        let meta = detect_sensitive_entities_rust(
            "国際医療大学 青山高等学校 みどり保育所 さくら認定こども園 中等教育学校 認定こども園",
            &rules,
        );

        assert!(meta
            .organization_names
            .contains(&"国際医療大学".to_string()));
        assert!(meta
            .organization_names
            .contains(&"青山高等学校".to_string()));
        assert!(meta
            .organization_names
            .contains(&"みどり保育所".to_string()));
        assert!(meta
            .organization_names
            .contains(&"さくら認定こども園".to_string()));
        assert!(!meta
            .organization_names
            .contains(&"中等教育学校".to_string()));
        assert!(!meta
            .organization_names
            .contains(&"認定こども園".to_string()));
    }

    #[test]
    fn location_dictionary_matches_embedded_place_names() {
        let mut rules = EntityRules::default();
        rules.location_names = HashSet::from(["大阪".to_string()]);

        let meta = detect_sensitive_entities_rust("東大阪の大阪駅で待ち合わせました。", &rules);

        assert!(meta.has_sensitive_entity);
        assert!(meta.kinds.contains(&"location".to_string()));
        assert!(meta.location_names.contains(&"大阪".to_string()));
    }

    #[test]
    fn location_normalization_excludes_embedded_person_names() {
        let person_name_set = HashSet::from(["和田".to_string(), "高".to_string()]);
        let normalized = normalize_location_name_set(
            vec![
                "和田岬".to_string(),
                "三宮".to_string(),
                "高森町".to_string(),
            ],
            &person_name_set,
        );

        assert!(!normalized.contains("和田岬"));
        assert!(normalized.contains("三宮"));
        assert!(normalized.contains("高森町"));
    }

    #[test]
    fn person_dictionary_matches_embedded_person_names() {
        let mut rules = EntityRules::default();
        rules.person_names = vec!["和田".to_string()];
        rules.person_name_set = HashSet::from(["和田".to_string()]);

        let meta = detect_sensitive_entities_rust("和田岬の近くで会いました。", &rules);

        assert!(meta.has_sensitive_entity);
        assert!(meta.kinds.contains(&"person".to_string()));
        assert!(meta.person_names.contains(&"和田".to_string()));
    }

    #[test]
    fn single_character_person_names_keep_boundary_check() {
        let mut rules = EntityRules::default();
        rules.person_names = vec!["高".to_string()];
        rules.person_name_set = HashSet::from(["高".to_string()]);

        let compound_meta = detect_sensitive_entities_rust("高校で会いました。", &rules);
        assert!(!compound_meta.person_names.contains(&"高".to_string()));

        let honorific_meta = detect_sensitive_entities_rust("高さんと話しました。", &rules);
        assert!(honorific_meta.person_names.contains(&"高".to_string()));
    }

    #[test]
    fn person_dictionary_takes_priority_over_location_dictionary() {
        let mut rules = EntityRules::default();
        rules.person_names = vec!["川崎".to_string()];
        rules.person_name_set = HashSet::from(["川崎".to_string()]);
        rules.location_names = HashSet::from(["川崎".to_string()]);

        let meta = detect_sensitive_entities_rust("川崎さんが話していました。", &rules);

        assert!(meta.person_names.contains(&"川崎".to_string()));
        assert!(!meta.location_names.contains(&"川崎".to_string()));
    }

    #[test]
    fn selected_region_location_names_are_checked_only_when_requested() {
        let mut rules = EntityRules::default();
        rules
            .regional_station_names
            .insert("47".to_string(), HashSet::from(["那覇空港".to_string()]));

        let common_meta = detect_sensitive_entities_rust("那覇空港で会いました。", &rules);
        assert!(!common_meta.location_names.contains(&"那覇空港".to_string()));

        let scoped = EntityLocationScope {
            mode: LocationDetectionMode::SelectedRegions,
            prefectures: HashSet::from(["47".to_string()]),
        };
        let regional_meta =
            detect_sensitive_entities_rust_with_scope("那覇空港で会いました。", &rules, &scoped);

        assert!(regional_meta
            .location_names
            .contains(&"那覇空港".to_string()));
    }

    #[test]
    fn station_like_location_patterns_add_location_warnings() {
        let mut rules = EntityRules::default();
        rules.station_like_location_patterns =
            vec![Regex::new(r"([一-龥々ァ-ヶー]{1,16}駅前)").unwrap()];

        let meta = detect_sensitive_entities_rust("松山駅前で会いました。", &rules);

        assert!(meta.location_names.contains(&"松山駅前".to_string()));
    }

    // ---- 専用一時領域の命名・回収 --------------------------------------------------

    /// 実在しない PID（OS の上限より大きい値）。
    const NONEXISTENT_PID: u32 = u32::MAX - 1;

    fn touch(path: &Path) {
        fs::write(path, b"x").unwrap();
    }

    fn set_age(path: &Path, age: Duration) {
        let file = fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_modified(std::time::SystemTime::now() - age).unwrap();
    }

    #[test]
    fn private_temp_name_embeds_owner_pid_at_fixed_position() {
        let name = private_temp_name("ggml-asr");
        let prefix = format!("lott-p{}-ggml-asr-", std::process::id());
        assert!(name.starts_with(&prefix), "{name}");
        assert!(name[prefix.len()..].chars().all(|c| c.is_ascii_digit()));
        assert_eq!(private_temp_owner_pid(&name), Some(std::process::id()));
        // 拡張子付きのファイル名・応答ファイル・再生キャッシュでも取り出せる。
        assert_eq!(
            private_temp_owner_pid(&format!("{name}.json")),
            Some(std::process::id())
        );
        assert_eq!(
            private_temp_owner_pid("lott-p4242-playback-00ff00ff00ff00ff.flac"),
            Some(4242)
        );
        assert_eq!(
            private_temp_owner_pid("lott-p4242-playback-00ff00ff00ff00ff.flac.part"),
            Some(4242)
        );
        assert_eq!(
            private_temp_owner_pid(&private_temp_name_for_pid(7, "input")),
            Some(7)
        );
    }

    #[test]
    fn private_temp_owner_pid_rejects_old_and_malformed_names() {
        for name in [
            // 旧形式
            "lott-ggml-audio-1234-1700000000000000000.wav",
            "lott-playback-00ff00ff00ff00ff.flac",
            "lott-voice-input-77-1.wav",
            "lott_diar_abc.json",
            // 不正な形式
            "",
            "lott-p",
            "lott-p-ggml-1",
            "lott-pabc-ggml-1",
            "lott-p123",
            "lott-p123.wav",
            "lott-p123x-ggml-1",
            "lott-p-1-ggml-1",
            "lott-p99999999999-ggml-1",
            "xlott-p123-ggml-1",
            "LOTT-P123-ggml-1",
        ] {
            assert_eq!(private_temp_owner_pid(name), None, "{name}");
        }
    }

    #[test]
    fn stale_private_temp_decision_follows_owner_and_age() {
        let own = 100;
        let alive = |pid: u32| pid == 200;
        let fresh = Some(Duration::from_secs(60));
        let old = Some(PRIVATE_TEMP_MAX_AGE);
        let decide = |owner, age| should_remove_private_temp_file(owner, own, age, alive);
        // 自プロセス・生きている別インスタンスのものは残す。
        assert!(!decide(Some(100), fresh));
        assert!(!decide(Some(200), fresh));
        assert!(!decide(Some(100), None));
        // 存在しない PID・旧形式（PID なし）は経過時間に関係なく消す。
        assert!(decide(Some(300), fresh));
        assert!(decide(Some(300), None));
        assert!(decide(None, fresh));
        assert!(decide(None, None));
        // 24時間以上経過したものは持ち主が生きていても消す。
        assert!(decide(Some(100), old));
        assert!(decide(Some(200), old));
        assert!(!decide(
            Some(200),
            Some(PRIVATE_TEMP_MAX_AGE - Duration::from_secs(1))
        ));
    }

    #[test]
    fn process_liveness_detects_self_and_missing_pids() {
        assert!(process_is_alive(std::process::id()));
        assert!(!process_is_alive(NONEXISTENT_PID));
        assert!(!process_is_alive(0));
    }

    #[test]
    fn startup_cleanup_removes_only_orphaned_stale_or_legacy_files() {
        let dir = ExportTestDir::new("cleanup-startup");
        let own = std::process::id();
        let other_alive = NONEXISTENT_PID - 1;
        let mk = |name: String| {
            let path = dir.0.join(&name);
            touch(&path);
            (name, path)
        };
        let (own_name, _) = mk(format!("lott-p{own}-ggml-audio-1.wav"));
        let (alive_name, _) = mk(format!("lott-p{other_alive}-ggml-asr-1.json"));
        let (dead_name, _) = mk(format!("lott-p{NONEXISTENT_PID}-ggml-audio-1.wav"));
        let (legacy_name, _) = mk("lott-ggml-audio-1234-1.wav".to_string());
        let (old_name, old_path) = mk(format!("lott-p{own}-playback-00ff00ff00ff00ff.flac"));
        set_age(&old_path, PRIVATE_TEMP_MAX_AGE + Duration::from_secs(60));
        // ディレクトリは対象外。
        fs::create_dir(dir.0.join(format!("lott-p{NONEXISTENT_PID}-dir"))).unwrap();

        cleanup_stale_private_temp_dir(&dir.0, own, |pid| pid == other_alive);

        let remaining = dir.file_names();
        assert!(remaining.contains(&own_name));
        assert!(remaining.contains(&alive_name));
        assert!(!remaining.contains(&dead_name));
        assert!(!remaining.contains(&legacy_name));
        assert!(!remaining.contains(&old_name));
        assert!(remaining.contains(&format!("lott-p{NONEXISTENT_PID}-dir")));
    }

    #[test]
    fn exit_cleanup_removes_only_files_owned_by_this_process() {
        let dir = ExportTestDir::new("cleanup-exit");
        let own = std::process::id();
        let other = NONEXISTENT_PID;
        for name in [
            format!("lott-p{own}-playback-00ff00ff00ff00ff.flac"),
            format!("lott-p{own}-playback-00ff00ff00ff00ff.flac.part"),
            format!("lott-p{own}-ggml-asr-1.json"),
        ] {
            touch(&dir.0.join(name));
        }
        let kept = [
            format!("lott-p{other}-playback-00ff00ff00ff00ff.flac"),
            "lott-playback-00ff00ff00ff00ff.flac".to_string(),
            "notes.txt".to_string(),
        ];
        for name in &kept {
            touch(&dir.0.join(name));
        }

        cleanup_own_private_temp_dir(&dir.0, own);

        let mut expected = kept.to_vec();
        expected.sort();
        assert_eq!(dir.file_names(), expected);
    }

    #[test]
    fn legacy_os_temp_files_are_removed_regardless_of_age() {
        let dir = ExportTestDir::new("cleanup-legacy-os-temp");
        for name in [
            "lott_llm_segments_1.json",
            "lott_llm_system_prompt_1.txt",
            "lott_overall_segments_1.json",
            "lott_overall_system_prompt_1.txt",
            "lott-playback-00ff00ff00ff00ff.flac",
            "lott_diar_1.wav",
        ] {
            touch(&dir.0.join(name)); // 作ったばかり（24時間未満）でも消える
        }
        let kept = ["other.txt", "lott-p1234-playback-00ff00ff00ff00ff.flac"];
        for name in kept {
            touch(&dir.0.join(name));
        }

        cleanup_legacy_os_temp_files(&dir.0);

        let mut expected: Vec<String> = kept.iter().map(|s| s.to_string()).collect();
        expected.sort();
        assert_eq!(dir.file_names(), expected);
    }

    #[test]
    fn playback_cache_name_pattern_is_recognized_as_owned() {
        // playback_cache_path の命名と、起動時・終了時の判定が同じ形式を前提にしていること。
        let name = format!(
            "{PRIVATE_TEMP_PID_PREFIX}{}-playback-{:016x}.flac",
            std::process::id(),
            0xabcdu64
        );
        assert_eq!(private_temp_owner_pid(&name), Some(std::process::id()));
        assert_eq!(
            private_temp_owner_pid(&format!("{name}.part")),
            Some(std::process::id())
        );
    }

    // ---- ffmpeg の入力（ローカルファイル限定・パス伏せ字・中立リンク）-----------------

    #[test]
    fn ffmpeg_input_args_whitelist_file_protocol_right_before_input() {
        let args = ffmpeg_input_args(Path::new("音声 data/依頼者 山田.m4a"));
        let args: Vec<String> = args
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            vec!["-protocol_whitelist", "file", "-i", "音声 data/依頼者 山田.m4a"]
        );
        let i = args.iter().position(|a| a == "-i").unwrap();
        assert_eq!(&args[i - 2..i], ["-protocol_whitelist", "file"]);
    }

    #[test]
    fn redact_audio_paths_hides_both_slash_styles_and_non_ascii_paths() {
        let original = r"C:\Users\山田 太郎\Documents\相談 2026\依頼者A.mp3";
        let slash = "C:/Users/山田 太郎/Documents/相談 2026/依頼者A.mp3";
        let text = format!(
            "{original}: Invalid data found\nError opening input file {slash}.\nOther line"
        );
        let redacted = redact_audio_paths(&text, &[original]);
        assert_eq!(
            redacted,
            "<音声ファイル>: Invalid data found\nError opening input file <音声ファイル>.\nOther line"
        );
        assert!(!redacted.contains("山田"));

        // 元のパスが `/` 表記で渡された場合の `\` 表記も伏せる。
        let redacted = redact_audio_paths(&format!("x {original} y"), &[slash]);
        assert_eq!(redacted, "x <音声ファイル> y");

        // 元のパスと ffmpeg へ渡したリンクのパスの両方を伏せ、長い方を先に置換する。
        let link = "/home/u/.cache/net.gakkousya.lott/private-temp/lott-p1-input-2.mp3";
        let redacted = redact_audio_paths(
            &format!("{link}: No such file; src {link}.bak; orig /data/依頼者/山田.mp3"),
            &["/data/依頼者/山田.mp3", link],
        );
        assert!(!redacted.contains("private-temp"));
        assert!(!redacted.contains("山田"));

        // 空のパスは何も置換しない。パスを含まない文もそのまま。
        assert_eq!(redact_audio_paths("abc", &[""]), "abc");
        assert_eq!(
            redact_audio_paths("Invalid data found", &["a.mp3"]),
            "Invalid data found"
        );
    }

    #[test]
    fn redacted_ffmpeg_stderr_covers_original_and_input_link_paths() {
        let text = "/mnt/依頼者 山田.mp3: Invalid data\n/cache/lott-p1-input-2.mp3: Invalid data";
        let out = redacted_ffmpeg_stderr(
            text,
            "/mnt/依頼者 山田.mp3",
            Path::new("/cache/lott-p1-input-2.mp3"),
        );
        assert_eq!(out, "<音声ファイル>: Invalid data\n<音声ファイル>: Invalid data");
    }

    #[test]
    fn neutral_input_link_name_keeps_only_safe_extension() {
        let base = "lott-p1-input-2";
        assert_eq!(neutral_input_link_name(base, "/a/山田.M4A"), "lott-p1-input-2.M4A");
        assert_eq!(neutral_input_link_name(base, r"C:\a\b.mp3"), "lott-p1-input-2.mp3");
        assert_eq!(neutral_input_link_name(base, "/a/noext"), base);
        assert_eq!(neutral_input_link_name(base, "/a/x.m p3"), base);
        assert_eq!(neutral_input_link_name(base, "/a/x.mp3;rm"), base);
        assert_eq!(neutral_input_link_name(base, "/a/x.音声"), base);
        assert_eq!(neutral_input_link_name(base, "/a/x."), base);
        assert_eq!(neutral_input_link_name(base, "/a/x.waveformfile"), base);
        assert_eq!(private_temp_owner_pid(&neutral_input_link_name(base, "/a/x.mp3")), Some(1));
    }

    #[cfg(unix)]
    #[test]
    fn unix_ffmpeg_input_is_a_neutral_symlink_removed_by_guard() {
        let dir = ExportTestDir::new("input-link");
        let source_dir = ExportTestDir::new("input-link-src");
        let original = source_dir.0.join("依頼者 山田太郎 面談.m4a");
        touch(&original);
        let original_str = original.to_string_lossy().into_owned();

        let link;
        {
            let mut guard = TempFileGuard::new();
            link = prepare_ffmpeg_input_in(&dir.0, &original_str, &mut guard);
            assert_ne!(link, original);
            assert_eq!(link.parent(), Some(dir.0.as_path()));
            let name = link.file_name().unwrap().to_string_lossy().into_owned();
            assert!(name.starts_with(&format!("lott-p{}-input-", std::process::id())));
            assert!(name.ends_with(".m4a"));
            assert!(!link.to_string_lossy().contains("山田"));
            assert_eq!(fs::read(&link).unwrap(), b"x");
            assert_eq!(fs::canonicalize(&link).unwrap(), fs::canonicalize(&original).unwrap());
            // 終了時の掃除はリンクだけを消し、元ファイルは消さない。
            cleanup_own_private_temp_dir(&dir.0, std::process::id());
            assert!(fs::symlink_metadata(&link).is_err());
            assert!(original.exists());
        }

        // guard が消す（掃除済みでもエラーにならない）。もう一度作って guard の Drop を確かめる。
        let link2;
        {
            let mut guard = TempFileGuard::new();
            link2 = prepare_ffmpeg_input_in(&dir.0, &original_str, &mut guard);
            assert!(fs::symlink_metadata(&link2).is_ok());
        }
        assert!(fs::symlink_metadata(&link2).is_err());
        assert!(original.exists());

        // 存在しない元ファイルは元のパスのまま（リンクを作らない）。
        let mut guard = TempFileGuard::new();
        let missing = source_dir.0.join("missing.mp3");
        assert_eq!(
            prepare_ffmpeg_input_in(&dir.0, &missing.to_string_lossy(), &mut guard),
            missing
        );
        assert!(dir.file_names().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn startup_cleanup_removes_orphaned_input_symlink_but_not_its_target() {
        let dir = ExportTestDir::new("input-link-orphan");
        let source_dir = ExportTestDir::new("input-link-orphan-src");
        let original = source_dir.0.join("original.mp3");
        touch(&original);
        let link = dir.0.join(format!("lott-p{NONEXISTENT_PID}-input-1.mp3"));
        std::os::unix::fs::symlink(&original, &link).unwrap();

        cleanup_stale_private_temp_dir(&dir.0, std::process::id(), |_| false);

        assert!(fs::symlink_metadata(&link).is_err());
        assert!(original.exists());
    }

    #[cfg(not(unix))]
    #[test]
    fn windows_ffmpeg_input_keeps_original_path() {
        let dir = ExportTestDir::new("input-nolink");
        let mut guard = TempFileGuard::new();
        let original = r"C:\Users\山田\依頼者.mp3";
        assert_eq!(
            prepare_ffmpeg_input_in(&dir.0, original, &mut guard),
            PathBuf::from(original)
        );
        assert!(dir.file_names().is_empty());
    }
}

fn docx_table_cell(text: &str, width: usize, v_align: Option<&str>) -> String {
    let content = xml_escape(text).replace(
        '\n',
        r#"</w:t></w:r><w:r><w:br/><w:t xml:space="preserve">"#,
    );
    let valign_xml = v_align
        .map(|v| format!(r#"<w:vAlign w:val="{v}"/>"#))
        .unwrap_or_default();
    format!(
        r#"<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{valign_xml}</w:tcPr><w:p><w:r><w:t xml:space="preserve">{content}</w:t></w:r></w:p></w:tc>"#
    )
}

fn docx_table_row<const N: usize>(cells: [&str; N], widths: [usize; N]) -> String {
    let inner = cells
        .iter()
        .zip(widths.iter())
        .map(|(c, w)| docx_table_cell(c, *w, None))
        .collect::<String>();
    format!(r#"<w:tr>{inner}</w:tr>"#)
}

fn xlsx_inline_str_cell(text: &str) -> String {
    format!(
        r#"<c s="1" t="inlineStr"><is><t xml:space="preserve">{}</t></is></c>"#,
        xml_escape(text)
    )
}

fn xlsx_row_xml<const N: usize>(row_index: u32, cells: [&str; N]) -> String {
    let inner = cells
        .iter()
        .map(|c| xlsx_inline_str_cell(c))
        .collect::<String>();
    format!(r#"<row r="{row_index}">{inner}</row>"#)
}

fn emit_progress(app: &AppHandle, stage: &str, message: &str, progress: Option<f64>) {
    let mut payload = serde_json::Map::new();
    payload.insert("stage".to_string(), Value::String(stage.to_string()));
    payload.insert("message".to_string(), Value::String(message.to_string()));
    if let Some(p) = progress {
        if let Some(num) = serde_json::Number::from_f64(p) {
            payload.insert("progress".to_string(), Value::Number(num));
        }
    }
    let _ = app.emit("transcription-progress", Value::Object(payload));
}

#[tauri::command]
async fn run_transcription(
    app: AppHandle,
    request: RunTranscriptionRequest,
) -> Result<RunTranscriptionResponse, String> {
    let _run_guard =
        match TaskRunGuard::try_acquire(&TRANSCRIPTION_ACTIVE) {
            Some(g) => g,
            None => return Ok(RunTranscriptionResponse {
                success: false,
                result: None,
                error_message: Some(
                    "文字起こしは既に実行中です。完了するかキャンセルしてから再実行してください。"
                        .to_string(),
                ),
            }),
        };
    tauri::async_runtime::spawn_blocking(move || run_transcription_blocking(app, request))
        .await
        .map_err(|e| format!("文字起こしタスクの実行に失敗しました: {e}"))?
}

#[tauri::command]
async fn run_diarization(
    app: AppHandle,
    request: RunDiarizationRequest,
) -> Result<RunDiarizationResponse, String> {
    let _run_guard =
        match TaskRunGuard::try_acquire(&DIARIZATION_ACTIVE) {
            Some(g) => g,
            None => return Ok(RunDiarizationResponse {
                success: false,
                result: None,
                error_message: Some(
                    "話者分離は既に実行中です。完了するかキャンセルしてから再実行してください。"
                        .to_string(),
                ),
            }),
        };
    tauri::async_runtime::spawn_blocking(move || run_diarization_blocking(app, request))
        .await
        .map_err(|e| format!("話者分離タスクの実行に失敗しました: {e}"))?
}

fn run_diarization_blocking(
    app: AppHandle,
    request: RunDiarizationRequest,
) -> Result<RunDiarizationResponse, String> {
    set_cancel_requested(RunningTaskKind::Diarization, false);
    if request.audio_path.trim().is_empty() {
        return Ok(RunDiarizationResponse {
            success: false,
            result: None,
            error_message: Some("音声ファイルが選択されていません。".to_string()),
        });
    }

    let speaker_count = request.speaker_count.unwrap_or(2).clamp(1, 5);
    let requested_device = request
        .device
        .unwrap_or_else(|| "cuda".to_string())
        .trim()
        .to_lowercase();
    let requested_device = match requested_device.as_str() {
        "cuda" | "cpu" => requested_device,
        _ => {
            return Ok(RunDiarizationResponse {
                success: false,
                result: None,
                error_message: Some(
                    "話者分離の device は cuda / cpu を指定してください。".to_string(),
                ),
            });
        }
    };
    emit_progress(
        &app,
        "diarization_start",
        "話者分離処理を開始します...",
        Some(1.0),
    );
    let mut diarization_output = execute_ggml_diarization(
        &app,
        &request.audio_path,
        &requested_device,
        speaker_count,
        RunningTaskKind::Diarization,
        "transcription-progress",
        request.ggml_gpu_uuid.as_deref(),
    )?;
    if take_cancel_requested(RunningTaskKind::Diarization) {
        return Ok(RunDiarizationResponse {
            success: false,
            result: None,
            error_message: Some("話者分離処理を中止しました。".to_string()),
        });
    }

    let mut diarization_device = requested_device.clone();
    let mut diarization_note: Option<String> = None;
    if !diarization_output.status.success() {
        let parsed = parse_json_from_mixed_output(&diarization_output.stdout);
        let maybe_msg = parsed
            .as_ref()
            .and_then(|j| j.get("error"))
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let maybe_detail = parsed
            .as_ref()
            .and_then(|j| j.get("error"))
            .and_then(|e| e.get("detail"))
            .and_then(Value::as_str)
            .unwrap_or("");
        // exit=1 かつ stdout 空はCUDAクラッシュ（os._exit等でPython例外が捕捉できない）を示す可能性がある。
        let stdout_empty = diarization_output.stdout.trim().is_empty();
        let looks_like_cuda_issue = maybe_msg.contains("Unspecified internal error")
            || maybe_msg.contains("CUDA")
            || maybe_detail.contains("CUDA")
            || diarization_output.status.code() == Some(-1073740791)
            || (diarization_device == "cuda"
                && diarization_output.status.code() == Some(1)
                && stdout_empty);

        if looks_like_cuda_issue && diarization_device == "cuda" {
            emit_progress(
                &app,
                "diarization_fallback",
                "話者分離の GPU 実行に失敗したため CPU へ切り替えます...",
                Some(70.0),
            );
            let retry_output = execute_ggml_diarization(
                &app,
                &request.audio_path,
                "cpu",
                speaker_count,
                RunningTaskKind::Diarization,
                "transcription-progress",
                request.ggml_gpu_uuid.as_deref(),
            )?;
            if take_cancel_requested(RunningTaskKind::Diarization) {
                return Ok(RunDiarizationResponse {
                    success: false,
                    result: None,
                    error_message: Some("話者分離処理を中止しました。".to_string()),
                });
            }
            if retry_output.status.success() {
                diarization_output = retry_output;
                diarization_device = "cpu".to_string();
                diarization_note = Some(
                    "話者分離は GPU 実行に失敗したため CPU 実行へフォールバックしました。"
                        .to_string(),
                );
            }
        }
    }

    if !diarization_output.status.success() {
        let parsed_diarization_json = parse_json_from_mixed_output(&diarization_output.stdout);
        let message = build_detailed_sidecar_error_message(
            "話者分離処理でエラーが発生しました",
            &diarization_output,
            parsed_diarization_json.as_ref(),
        );
        return Ok(RunDiarizationResponse {
            success: false,
            result: None,
            error_message: Some(message),
        });
    }

    let diarization_json = parse_json_from_mixed_output(&diarization_output.stdout)
        .ok_or_else(|| "話者分離結果の JSON 解析に失敗しました。".to_string())?;
    let diarization_result = diarization_json
        .get("result")
        .cloned()
        .ok_or_else(|| "話者分離結果が不正です。".to_string())?;
    if let Some(actual_device) = diarization_result.get("device").and_then(Value::as_str) {
        if actual_device == "cpu" || actual_device == "cuda" {
            if actual_device != diarization_device {
                diarization_note = Some(
                    "話者分離は GPU が利用できなかったため CPU 実行になりました。".to_string(),
                );
            }
            diarization_device = actual_device.to_string();
        }
    }
    let diarization_segments = diarization_result
        .get("segments")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut merged_result = request.result;
    assign_speakers_to_segments(&mut merged_result, &diarization_segments);
    if let Some(obj) = merged_result.as_object_mut() {
        obj.insert("diarizationRequested".to_string(), Value::Bool(true));
        obj.insert(
            "diarization".to_string(),
            serde_json::json!({
                "requested": true,
                "applied": true,
                "status": "applied",
                "device": diarization_device,
                "requestedDevice": requested_device,
                "gpuFallback": requested_device == "cuda" && diarization_device == "cpu",
                "provider": diarization_result.get("provider").and_then(Value::as_str),
                "segments": diarization_segments,
                "summary": diarization_result.get("summary").cloned().unwrap_or(Value::Null),
                "note": diarization_note
            }),
        );
    }

    emit_progress(
        &app,
        "diarization_done",
        "話者分離処理が完了しました。",
        Some(100.0),
    );
    Ok(RunDiarizationResponse {
        success: true,
        result: Some(merged_result),
        error_message: None,
    })
}

fn run_transcription_blocking(
    app: AppHandle,
    request: RunTranscriptionRequest,
) -> Result<RunTranscriptionResponse, String> {
    let run_id = request
        .run_id
        .unwrap_or_else(|| TRANSCRIPTION_RUN_COUNTER.fetch_add(1, Ordering::Relaxed) + 1);
    let run_started = Instant::now();
    eprintln!(
        "[LoTT][transcription][run_id={run_id}][stage=start] diarization={} parallel_diarization={}",
        request.diarization,
        request.parallel_diarization.unwrap_or(false)
    );
    set_cancel_requested(RunningTaskKind::Transcription, false);
    // 旧フロントエンドから false が届いても、カウンセリング会話のフィラーは常に保持する。
    let keep_fillers = true;
    let language = match normalize_transcription_language(request.language.as_deref()) {
        Ok(language) => language,
        Err(error_message) => {
            return Ok(RunTranscriptionResponse {
                success: false,
                result: None,
                error_message: Some(error_message),
            })
        }
    };
    eprintln!(
        "[LoTT][transcription][run_id={run_id}][stage=engine] transcription=ggml diarization=ggml keep_fillers={keep_fillers}"
    );

    let requested_model = request
        .model
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("turbo")
        .to_string();
    let requested_compute_type = request
        .compute_type
        .as_deref()
        .unwrap_or("auto")
        .to_lowercase();
    let requested_device = request.device.as_deref().unwrap_or("cuda").to_lowercase();
    let transcription_device = match requested_device.as_str() {
        "cuda" | "cpu" => requested_device,
        _ => {
            return Ok(RunTranscriptionResponse {
                success: false,
                result: None,
                error_message: Some("device は cuda / cpu を指定してください。".to_string()),
            })
        }
    };
    let compute_type = match requested_compute_type.as_str() {
        "auto" | "float16" | "float32" | "int8_float16" | "int8" => requested_compute_type,
        _ => {
            return Ok(RunTranscriptionResponse {
                success: false,
                result: None,
                error_message: Some(
                    "computeType は auto / float16 / float32 / int8_float16 / int8 を指定してください。"
                        .to_string(),
                ),
            })
        }
    };

    emit_progress(&app, "preparing", "文字起こしを開始します...", Some(1.0));

    let low_memory_mode = should_use_low_memory_mode(&request.audio_path);
    let selected_compute_type = if compute_type == "auto" {
        if transcription_device == "cpu" {
            let audio_size = audio_file_size_bytes(&request.audio_path);
            if low_memory_mode {
                "int8".to_string()
            } else if audio_size <= 6 * 1024 * 1024 {
                "float32".to_string()
            } else {
                "int8".to_string()
            }
        } else {
            // CUDA auto: first try higher-quality float16, then retry with lighter modes if needed.
            "float16".to_string()
        }
    } else {
        compute_type.clone()
    };
    let selection_note = if compute_type == "auto" {
        if transcription_device == "cpu" {
            let audio_size = audio_file_size_bytes(&request.audio_path);
            if low_memory_mode {
                "自動選択: CPU 実行 + 長尺想定のため int8 を採用"
            } else if audio_size <= 6 * 1024 * 1024 {
                "自動選択: CPU 実行 + 短尺のため float32 を採用"
            } else {
                "自動選択: CPU 実行 + 中長尺のため int8 を採用"
            }
        } else if low_memory_mode && selected_compute_type == "int8_float16" {
            "自動選択: 音声が大きいため int8_float16 を採用"
        } else {
            "自動選択: 音声が小さめのため float16 を採用"
        }
    } else {
        "手動選択"
    };
    emit_progress(
        &app,
        "compute_plan",
        &format!(
            "実行デバイス: {} / 計算方式: {}（{}）",
            transcription_device, selected_compute_type, selection_note
        ),
        Some(2.0),
    );

    let requested_speaker_count = request.speaker_count.unwrap_or(2).clamp(1, 5);
    let use_parallel_diarization = request.parallel_diarization.unwrap_or(false);

    // 文字起こしと並行して話者分離を起動する（高速モード時のみ）
    let parallel_diar_handle: Option<thread::JoinHandle<Result<SidecarExecResult, String>>> =
        if request.diarization && use_parallel_diarization {
            let app_par = app.clone();
            let audio_par = request.audio_path.clone();
            let device_par = transcription_device.clone();
            let spk = requested_speaker_count;
            let ggml_gpu_par = request.ggml_gpu_uuid.clone();
            emit_progress(
                &app,
                "diarization_start",
                "話者分離処理を開始します（文字起こしと並行実行）...",
                Some(3.0),
            );
            Some(thread::spawn(move || {
                execute_ggml_diarization(
                    &app_par,
                    &audio_par,
                    &device_par,
                    spk,
                    RunningTaskKind::Diarization,
                    "parallel-diarization-progress",
                    ggml_gpu_par.as_deref(),
                )
            }))
        } else {
            None
        };

    let output = execute_ggml_transcription(
        &app,
        &request.audio_path,
        &transcription_device,
        &requested_model,
        &language,
        low_memory_mode,
        keep_fillers,
        request.ggml_gpu_uuid.as_deref(),
        request.audio_preprocess.as_deref(),
    )?;
    eprintln!(
        "[LoTT][transcription][run_id={run_id}][stage=transcription_sidecar_done] elapsed_ms={} exit={:?} stdout_bytes={} stderr_bytes={}",
        run_started.elapsed().as_millis(),
        output.status.code(),
        output.stdout.len(),
        output.stderr.len()
    );
    if take_cancel_requested(RunningTaskKind::Transcription) {
        let diar_pid = DIARIZATION_PID.load(Ordering::SeqCst);
        if diar_pid > 0 {
            let _ = kill_process_tree_by_pid(diar_pid);
        }
        drop(parallel_diar_handle);
        return Ok(RunTranscriptionResponse {
            success: false,
            result: None,
            error_message: Some("文字起こし処理を中止しました。".to_string()),
        });
    }
    let stdout = output.stdout.clone();
    let used_gpu_fallback = false;
    let gpu_fallback_reason: Option<String> = None;

    let parsed_json = parse_json_from_mixed_output(&stdout);

    if !output.status.success() {
        let diar_pid = DIARIZATION_PID.load(Ordering::SeqCst);
        if diar_pid > 0 {
            let _ = kill_process_tree_by_pid(diar_pid);
        }
        drop(parallel_diar_handle);
        let stderr = output.stderr.clone();
        let stdout_trimmed = stdout.trim().to_string();
        let exit_code = output.status.code();
        let fallback_message = if transcription_device == "cuda" && exit_code == Some(-1073740791) {
            String::from(
                "GPU 文字起こしに失敗しました（プロセスクラッシュ）。\
CPU にはフォールバックせず終了しました。\
CUDA/cuDNN の PATH、GPU割り当て、ドライバ状態を確認してください。\
長尺音声では VRAM 不足の可能性もあるため、computeType を int8_float16 に切り替えて再実行してください。",
            )
        } else {
            format!(
                "文字起こし処理に失敗しました。exit={:?}, stdout_len={}, stderr_len={}",
                exit_code,
                stdout.len(),
                stderr.len()
            )
        };

        let error_message = parsed_json
            .as_ref()
            .and_then(|j| j.get("error"))
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .map(String::from)
            .or_else(|| {
                if stderr.is_empty() {
                    None
                } else {
                    Some(stderr.clone())
                }
            })
            .or_else(|| {
                if stdout_trimmed.is_empty() {
                    None
                } else {
                    Some(format!("音声エンジンの出力: {stdout_trimmed}"))
                }
            })
            .unwrap_or(fallback_message);

        return Ok(RunTranscriptionResponse {
            success: false,
            result: None,
            error_message: Some(error_message),
        });
    }

    let json = parsed_json.ok_or_else(|| {
        let preview: String = stdout.chars().take(500).collect();
        format!("Python 側の JSON 解析に失敗しました。出力(先頭500文字): {preview}")
    })?;

    if let Some(success) = json.get("success").and_then(Value::as_bool) {
        if success {
            let mut result = json.get("result").cloned();

            if request.diarization {
                let mut diarization_output = if let Some(handle) = parallel_diar_handle {
                    emit_progress(
                        &app,
                        "diarization_waiting",
                        "話者分離の完了を待っています...",
                        Some(87.0),
                    );
                    handle
                        .join()
                        .map_err(|_| "話者分離スレッドが異常終了しました。".to_string())??
                } else {
                    // 継次処理モード：話者分離開始前にwhisper完了セグメントをAngularへ送信し
                    // CPU LLM校正を話者分離と並行して早期起動できるようにする
                    if let Some(ref r) = result {
                        if let Some(segs) = r.get("segments") {
                            let _ = app.emit(
                                "transcription-progress",
                                serde_json::json!({
                                    "stage": "whisper_segments_ready",
                                    "segments": segs
                                }),
                            );
                        }
                    }
                    emit_progress(
                        &app,
                        "diarization_start",
                        "話者分離処理を開始します...",
                        Some(86.0),
                    );
                    execute_ggml_diarization(
                        &app,
                        &request.audio_path,
                        &transcription_device,
                        requested_speaker_count,
                        RunningTaskKind::Transcription,
                        "transcription-progress",
                        request.ggml_gpu_uuid.as_deref(),
                    )?
                };
                eprintln!(
                    "[LoTT][transcription][run_id={run_id}][stage=diarization_sidecar_done] elapsed_ms={} exit={:?} stdout_bytes={} stderr_bytes={}",
                    run_started.elapsed().as_millis(),
                    diarization_output.status.code(),
                    diarization_output.stdout.len(),
                    diarization_output.stderr.len()
                );
                let mut diarization_device = transcription_device.clone();
                let mut diarization_note: Option<String> = None;

                if !diarization_output.status.success() {
                    let parsed = parse_json_from_mixed_output(&diarization_output.stdout);
                    let maybe_msg = parsed
                        .as_ref()
                        .and_then(|j| j.get("error"))
                        .and_then(|e| e.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let maybe_detail = parsed
                        .as_ref()
                        .and_then(|j| j.get("error"))
                        .and_then(|e| e.get("detail"))
                        .and_then(Value::as_str)
                        .unwrap_or("");

                    let stdout_empty = diarization_output.stdout.trim().is_empty();
                    let looks_like_cuda_issue = maybe_msg.contains("Unspecified internal error")
                        || maybe_msg.contains("CUDA")
                        || maybe_detail.contains("CUDA")
                        || diarization_output.status.code() == Some(-1073740791)
                        || (diarization_device == "cuda"
                            && diarization_output.status.code() == Some(1)
                            && stdout_empty);

                    if looks_like_cuda_issue && diarization_device == "cuda" {
                        emit_progress(
                            &app,
                            "diarization_fallback",
                            "話者分離の GPU 実行に失敗したため CPU へ切り替えます...",
                            Some(90.0),
                        );
                        let retry_output = execute_ggml_diarization(
                            &app,
                            &request.audio_path,
                            "cpu",
                            requested_speaker_count,
                            RunningTaskKind::Transcription,
                            "transcription-progress",
                            request.ggml_gpu_uuid.as_deref(),
                        )?;
                        if retry_output.status.success() {
                            diarization_output = retry_output;
                            diarization_device = "cpu".to_string();
                            diarization_note = Some(
                                "話者分離は GPU 実行に失敗したため CPU 実行へフォールバックしました。"
                                    .to_string(),
                            );
                        }
                    }
                }

                if !diarization_output.status.success() {
                    let parsed_diarization_json =
                        parse_json_from_mixed_output(&diarization_output.stdout);
                    let message = build_detailed_sidecar_error_message(
                        "話者分離処理でエラーが発生しました",
                        &diarization_output,
                        parsed_diarization_json.as_ref(),
                    );
                    return Ok(RunTranscriptionResponse {
                        success: false,
                        result: None,
                        error_message: Some(message),
                    });
                }

                let diarization_json = parse_json_from_mixed_output(&diarization_output.stdout)
                    .ok_or_else(|| "話者分離結果の JSON 解析に失敗しました。".to_string())?;

                let diarization_result = diarization_json
                    .get("result")
                    .cloned()
                    .ok_or_else(|| "話者分離結果が不正です。".to_string())?;
                if let Some(actual_device) =
                    diarization_result.get("device").and_then(Value::as_str)
                {
                    if (actual_device == "cpu" || actual_device == "cuda")
                        && actual_device != diarization_device
                    {
                        diarization_note = Some(
                            "話者分離は GPU が利用できなかったため CPU 実行になりました。"
                                .to_string(),
                        );
                        diarization_device = actual_device.to_string();
                    }
                }

                let diarization_segments = diarization_result
                    .get("segments")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();

                if let Some(result_obj) = result.as_mut() {
                    let transcription_segment_count = result_obj
                        .get("segments")
                        .and_then(Value::as_array)
                        .map_or(0, Vec::len);
                    let assign_started = Instant::now();
                    eprintln!(
                        "[LoTT][transcription][run_id={run_id}][stage=speaker_assignment_start] transcription_segments={} diarization_segments={}",
                        transcription_segment_count,
                        diarization_segments.len()
                    );
                    assign_speakers_to_segments(result_obj, &diarization_segments);
                    eprintln!(
                        "[LoTT][transcription][run_id={run_id}][stage=speaker_assignment_done] elapsed_ms={}",
                        assign_started.elapsed().as_millis()
                    );
                }

                if let Some(obj) = result.as_mut().and_then(Value::as_object_mut) {
                    obj.insert("diarizationRequested".to_string(), Value::Bool(true));
                    obj.insert(
                        "diarization".to_string(),
                        serde_json::json!({
                            "requested": true,
                            "applied": true,
                            "status": "applied",
                            "device": diarization_device,
                            "requestedDevice": transcription_device,
                            "gpuFallback": transcription_device == "cuda" && diarization_device == "cpu",
                            "requestedSpeakerCount": requested_speaker_count,
                            "provider": diarization_result.get("provider").and_then(Value::as_str),
                            "segments": diarization_segments,
                            "summary": diarization_result.get("summary").cloned().unwrap_or(Value::Null),
                            "note": diarization_note
                        }),
                    );
                }
            }

            if used_gpu_fallback {
                if let Some(obj) = result.as_mut().and_then(Value::as_object_mut) {
                    obj.insert("fallbackUsed".to_string(), Value::Bool(true));
                    obj.insert(
                        "fallbackReason".to_string(),
                        Value::String(gpu_fallback_reason.unwrap_or_else(|| {
                            "GPU 内フォールバックが実行されました。".to_string()
                        })),
                    );
                }
            }
            if let Some(segments) = result
                .as_mut()
                .and_then(|value| value.get_mut("segments"))
                .and_then(Value::as_array_mut)
            {
                for segment in segments {
                    if let Some(text) = segment.get("text").and_then(Value::as_str) {
                        let normalized = normalize_transcription_output_text(text, &language);
                        if normalized != text {
                            segment["text"] = Value::String(normalized);
                        }
                    }
                }
            }
            emit_progress(
                &app,
                "done",
                "文字起こし結果を画面へ反映します...",
                Some(100.0),
            );
            let response_bytes = result
                .as_ref()
                .and_then(|value| serde_json::to_vec(value).ok())
                .map_or(0, |bytes| bytes.len());
            eprintln!(
                "[LoTT][transcription][run_id={run_id}][stage=ipc_return] elapsed_ms={} result_bytes={}",
                run_started.elapsed().as_millis(),
                response_bytes
            );
            return Ok(RunTranscriptionResponse {
                success: true,
                result,
                error_message: None,
            });
        }

        let message = json
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("文字起こし処理に失敗しました。")
            .to_string();

        return Ok(RunTranscriptionResponse {
            success: false,
            result: None,
            error_message: Some(message),
        });
    }

    Ok(RunTranscriptionResponse {
        success: true,
        result: Some(json),
        error_message: None,
    })
}

// ---- ggml 音声エンジン（whisper.cpp / NeMo-Speech.cpp）------------------------------------
// 既存サイドカーと同じ JSON（{"success":..,"result":..}）を返し、呼び出し側の後続処理を共用する。
// 設計: docs/ggml-speech-engine-design.md

/// ggml エンジンの開発用セットアップスクリプト（準備不足のエラーで案内する）。
const GGML_SPEECH_SETUP_SCRIPT: &str = if cfg!(target_os = "windows") {
    "scripts\\setup-ggml-speech-windows.ps1"
} else {
    "scripts/setup-ggml-speech-linux.sh"
};

/// PATH の先頭へ `dir` を足した値を返す（既に含まれていれば None）。
#[cfg(any(windows, target_os = "linux", test))]
fn prepend_dir_to_path(current: &std::ffi::OsStr, dir: &Path) -> Option<std::ffi::OsString> {
    let existing: Vec<PathBuf> = env::split_paths(current).collect();
    if existing.iter().any(|p| p == dir) {
        return None;
    }
    env::join_paths(std::iter::once(dir.to_path_buf()).chain(existing)).ok()
}

/// GPU ドライバー未導入の Windows PC 向け。System32 に vulkan-1.dll が無い場合だけ、
/// 同梱の Vulkan ローダー（resources/speech-engines/vulkan-loader）を PATH へ足し、
/// 子プロセスの ggml エンジンが CPU 実行（-ng / --device cpu）でも起動できるようにする。
/// exe の隣へ置かないのは、新しいシステム側ローダーを隠さないため。
#[cfg(windows)]
fn ensure_bundled_vulkan_loader_on_path(app: &AppHandle) {
    let system_root = env::var_os("SystemRoot").unwrap_or_else(|| std::ffi::OsString::from("C:\\Windows"));
    if PathBuf::from(system_root)
        .join("System32")
        .join("vulkan-1.dll")
        .is_file()
    {
        return;
    }
    let Some(dir) = bundled_resource_dir_candidates(app, "speech-engines")
        .into_iter()
        .map(|d| d.join("vulkan-loader"))
        .find(|d| d.join("vulkan-1.dll").is_file())
    else {
        return;
    };
    let current = env::var_os("PATH").unwrap_or_default();
    if let Some(new_path) = prepend_dir_to_path(&current, &dir) {
        env::set_var("PATH", new_path);
        eprintln!(
            "Vulkan ローダーがシステムに無いため同梱の vulkan-1.dll を PATH に追加しました: {}",
            dir.display()
        );
    }
}

/// ホストに `libvulkan.so.1`（Vulkan ローダー）があるか。`dlopen` で ld.so の探索規則どおりに
/// 判定し、開いたらすぐ閉じる。dlopen が使えない場合の保険として主要ディレクトリも見る。
#[cfg(target_os = "linux")]
fn host_has_vulkan_loader() -> bool {
    // SAFETY: 文字列は NUL 終端の静的リテラル。ハンドルは直ちに dlclose する。
    // ローダーの初期化コードが走るだけで、Vulkan の API は呼ばない。
    unsafe {
        let handle = libc::dlopen(
            b"libvulkan.so.1\0".as_ptr() as *const libc::c_char,
            libc::RTLD_LAZY | libc::RTLD_LOCAL,
        );
        if !handle.is_null() {
            libc::dlclose(handle);
            return true;
        }
    }
    [
        "/usr/lib/x86_64-linux-gnu",
        "/lib/x86_64-linux-gnu",
        "/usr/lib64",
        "/lib64",
        "/usr/lib",
        "/lib",
    ]
    .iter()
    .any(|dir| Path::new(dir).join("libvulkan.so.1").exists())
}

/// GPU ドライバー・Vulkan ローダー未導入の Linux PC 向け（Windows 版の対応物）。
/// ホストに libvulkan.so.1 が無い場合だけ、同梱の Vulkan ローダー
/// （resources/speech-engines/vulkan-loader、Ubuntu の libvulkan1）を `LD_LIBRARY_PATH` の先頭へ足し、
/// 子プロセスの ggml エンジンが CPU 実行でも起動できるようにする。
/// エンジンの隣へ置かない（RUNPATH=$ORIGIN でホストの新しいローダーを隠すため）。
/// AppImage では `apply_host_command_env` が AppDir 配下を落とすので、このディレクトリだけ
/// `BUNDLED_VULKAN_LOADER_DIR` に登録して除外させる。
#[cfg(target_os = "linux")]
fn ensure_bundled_vulkan_loader_on_path(app: &AppHandle) {
    if host_has_vulkan_loader() {
        return;
    }
    let Some(dir) = bundled_resource_dir_candidates(app, "speech-engines")
        .into_iter()
        .map(|d| d.join("vulkan-loader"))
        .find(|d| d.join("libvulkan.so.1").is_file())
    else {
        return;
    };
    let current = env::var_os("LD_LIBRARY_PATH").unwrap_or_default();
    if let Some(new_value) = prepend_dir_to_path(&current, &dir) {
        env::set_var("LD_LIBRARY_PATH", new_value);
        eprintln!(
            "Vulkan ローダーがホストに無いため同梱の libvulkan.so.1 を LD_LIBRARY_PATH に追加しました: {}",
            dir.display()
        );
    }
    let _ = BUNDLED_VULKAN_LOADER_DIR.set(dir);
}

/// WebKitGTK の DMA-BUF レンダラーまわりの環境変数を決める（純粋部分）。
/// NVIDIA プロプライエタリドライバー環境では DMA-BUF レンダラーが起動に失敗することがあるため、
/// DMA-BUF だけを避ける `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` を既定で立てる。
/// `WEBKIT_DISABLE_DMABUF_RENDERER=1` は合成器ごと無効化してスクロールが重くなるため使わない。
/// 戻り値が true のとき `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` を設定する。
#[cfg(any(target_os = "linux", test))]
fn should_force_webkit_shm<F>(read_env: F, nvidia_present: bool) -> bool
where
    F: Fn(&str) -> Option<String>,
{
    if read_env("LOTT_ENABLE_DMABUF_RENDERER").as_deref() == Some("1") {
        return false;
    }
    if read_env("WEBKIT_DMABUF_RENDERER_FORCE_SHM").is_some()
        || read_env("WEBKIT_DISABLE_DMABUF_RENDERER").is_some()
    {
        return false;
    }
    nvidia_present
}

/// Ubuntu の disable-nvidia-dmabuf.patch は SHM を追加する前に NVIDIA 判定で戻る。
/// FORCE_DMABUF はこの判定だけを回避し、FORCE_SHM と必ず組み合わせて hardware transport を避ける。
/// 参照: https://bugs.debian.org/1142771（修正前の Ubuntu 24.04 WebKitGTK も同じパッチ）。
#[cfg(any(target_os = "linux", test))]
fn webkit_shm_env_overrides<F>(read_env: F, nvidia_present: bool) -> Vec<(&'static str, &'static str)>
where
    F: Fn(&str) -> Option<String>,
{
    if !should_force_webkit_shm(&read_env, nvidia_present) {
        return Vec::new();
    }
    let mut overrides = vec![("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1")];
    if read_env("WEBKIT_FORCE_DMABUF_RENDERER").is_none() {
        overrides.push(("WEBKIT_FORCE_DMABUF_RENDERER", "1"));
    }
    overrides
}

/// `run()` の最初に呼ぶ。GTK / WebKit の初期化前でないと効かない。
#[cfg(target_os = "linux")]
fn configure_webkit_dmabuf_workaround() {
    let nvidia_present = Path::new("/proc/driver/nvidia/version").exists();
    let overrides = webkit_shm_env_overrides(|name| env::var(name).ok(), nvidia_present);
    if !overrides.is_empty() {
        for (name, value) in &overrides {
            env::set_var(name, value);
        }
        eprintln!(
            "NVIDIA ドライバー向けの WebKit SHM 合成器設定を適用しました: {overrides:?}（無効化: LOTT_ENABLE_DMABUF_RENDERER=1）"
        );
    }
}

/// ggml エンジンの実行ファイル・モデルの配置。
/// dev: python_sidecar/speech-engines/ と python_sidecar/models/（scripts/setup-ggml-speech-{linux.sh,windows.ps1} が配置）
/// release: 同梱 resources/speech-engines/ と app_local_data_dir()/models/
fn resolve_ggml_speech_paths(app: &AppHandle) -> Result<GgmlSpeechPaths, String> {
    if cfg!(debug_assertions) {
        let manifest_base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("python_sidecar");
        let base = if manifest_base.exists() {
            manifest_base
        } else {
            env::current_dir()
                .map_err(|e| format!("カレントディレクトリ解決に失敗: {e}"))?
                .join("python_sidecar")
        };
        return Ok(GgmlSpeechPaths::resolve(
            &base.join("speech-engines"),
            &base.join("models"),
        ));
    }
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("app_local_data_dir の解決に失敗しました: {e}"))?;
    let models_root = resolve_ggml_models_root(app)?;
    // Editor / Vulkan 版は whisper.cpp をインストーラーに同梱する（resources/speech-engines/whisper）。
    let engines_root = bundled_resource_dir_candidates(app, "speech-engines")
        .into_iter()
        .find(|dir| dir.join("whisper").is_dir())
        .unwrap_or_else(|| data_dir.join("speech-engines"));
    Ok(GgmlSpeechPaths::resolve(&engines_root, &models_root))
}

/// ggml モデルの置き場所（dev: python_sidecar/models、release: Editor / Vulkan とも app_local_data_dir()/models）。
fn resolve_ggml_models_root(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        let manifest_base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("python_sidecar");
        let base = if manifest_base.exists() {
            manifest_base
        } else {
            env::current_dir()
                .map_err(|e| format!("カレントディレクトリ解決に失敗: {e}"))?
                .join("python_sidecar")
        };
        return Ok(base.join("models"));
    }
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("app_local_data_dir の解決に失敗しました: {e}"))?;
    Ok(release_models_root(app).unwrap_or_else(|| data_dir.join("models")))
}

#[cfg(unix)]
fn synthetic_exit_status(code: i32) -> std::process::ExitStatus {
    use std::os::unix::process::ExitStatusExt;
    std::process::ExitStatus::from_raw(code << 8)
}

#[cfg(windows)]
fn synthetic_exit_status(code: i32) -> std::process::ExitStatus {
    use std::os::windows::process::ExitStatusExt;
    std::process::ExitStatus::from_raw(code as u32)
}

/// 起動前の失敗（ファイル不足など）を、サイドカーの失敗出力と同じ形で返す。
fn ggml_failure_result(
    message: String,
    status: Option<std::process::ExitStatus>,
    stderr: String,
) -> SidecarExecResult {
    SidecarExecResult {
        status: status.unwrap_or_else(|| synthetic_exit_status(1)),
        stdout: serde_json::json!({ "success": false, "error": { "message": message } })
            .to_string(),
        stderr,
    }
}

/// 音声調整プリセットを ffmpeg の `-af` フィルターチェーンへ対応づける。
/// `none`・空・不明値は `None`（フィルターなし。従来と同一のコマンド）。
fn audio_preprocess_filter(preset: Option<&str>) -> Option<&'static str> {
    match preset.map(str::trim) {
        Some("low_noise") => Some("highpass=f=80"),
        Some("strong_noise") => Some("highpass=f=80,afftdn=nr=12:nf=-40"),
        Some("volume_boost") => Some("highpass=f=80,dynaudnorm=f=250:g=15"),
        Some("general_improvement") => {
            Some("highpass=f=80,afftdn=nr=12:nf=-40,dynaudnorm=f=250:g=15")
        }
        _ => None,
    }
}

/// 設定 JSON へ記録する音声調整プリセット名（不明値は none）。
fn normalized_audio_preprocess(preset: Option<&str>) -> &'static str {
    match preset.map(str::trim) {
        Some("low_noise") => "low_noise",
        Some("strong_noise") => "strong_noise",
        Some("volume_boost") => "volume_boost",
        Some("general_improvement") => "general_improvement",
        _ => "none",
    }
}

/// 音声を 16kHz mono PCM16 WAV へ変換して一時ディレクトリへ置く（LGPL ffmpeg CLI を使用）。
/// ggml エンジンへは中立な一時ファイル名だけを渡し、元のファイル名を argv に出さない。
fn decode_audio_to_private_wav(
    app: &AppHandle,
    audio_path: &str,
    guard: &mut TempFileGuard,
    audio_filter: Option<&str>,
) -> Result<PathBuf, String> {
    let ffmpeg = resolve_ffmpeg_bin_for_segment_cut(app)
        .ok_or_else(|| "音声の変換に必要な ffmpeg が見つかりませんでした。".to_string())?;
    if !Path::new(audio_path).exists() {
        return Err("音声ファイルが見つかりません。".to_string());
    }
    let wav = private_llm_temp_dir(app)?.join(format!("{}.wav", private_temp_name("ggml-audio")));
    write_private_temp_file(&wav, b"")?;
    guard.push(wav.clone());
    // 入力リンクは変換が終わり次第（この関数を抜けるとき）消す。
    let mut link_guard = TempFileGuard::new();
    let input = prepare_ffmpeg_input(app, audio_path, &mut link_guard);
    let mut cmd = Command::new(&ffmpeg);
    apply_host_command_env(&mut cmd);
    cmd.arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .args(ffmpeg_input_args(&input));
    if let Some(filter) = audio_filter {
        cmd.arg("-af").arg(filter);
    }
    cmd.arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("16000")
        .arg("-c:a")
        .arg("pcm_s16le")
        .arg("-f")
        .arg("wav")
        .arg(&wav);
    apply_windows_no_window(&mut cmd);
    let output = output_in_kill_job(&mut cmd)
        .map_err(|e| format!("ffmpeg の起動に失敗しました: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "音声の変換に失敗しました: {}",
            redacted_ffmpeg_stderr(&String::from_utf8_lossy(&output.stderr), audio_path, &input)
                .trim()
        ));
    }
    Ok(wav)
}

/// ggml エンジンの CLI を起動し、stderr を1行ずつ `on_line` へ渡しながら終了を待つ。
/// PID を登録するので、既存の中止操作（cancel_transcription / cancel_diarization）で停止できる。
fn run_ggml_engine_process(
    mut cmd: Command,
    running_kind: RunningTaskKind,
    mut on_line: impl FnMut(&str),
) -> Result<SidecarExecResult, String> {
    // 自前ビルドの実行ファイルは RUNPATH=$ORIGIN の共有ライブラリとホストの GPU ドライバーだけを使う。
    // AppImage の LD_LIBRARY_PATH を持ち込まない。
    apply_host_command_env(&mut cmd);
    apply_windows_no_window(&mut cmd);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("音声エンジンの起動に失敗しました: {e}"))?;
    assign_to_kill_on_close_job(&child);
    set_running_pid(running_kind, child.id());

    let stdout_reader = child.stdout.take();
    let stdout_handle = thread::spawn(move || {
        let mut buf = String::new();
        if let Some(mut r) = stdout_reader {
            let _ = r.read_to_string(&mut buf);
        }
        buf
    });
    let mut stderr = String::new();
    if let Some(r) = child.stderr.take() {
        for line in BufReader::new(r).lines().map_while(Result::ok) {
            on_line(&line);
            stderr.push_str(&line);
            stderr.push('\n');
            if stderr.len() > 256 * 1024 {
                stderr = ggml_speech::tail_chars(&stderr, 64 * 1024);
            }
        }
    }
    let status = child.wait();
    clear_running_pid(running_kind);
    let status = status.map_err(|e| format!("音声エンジンの終了待機に失敗しました: {e}"))?;
    let stdout = stdout_handle.join().unwrap_or_default();
    Ok(SidecarExecResult {
        status,
        stdout,
        stderr,
    })
}

/// Vulkan 版の ggml エンジンに使わせる GPU を決め、`GGML_VK_VISIBLE_DEVICES` を設定する。
/// 設定で選ばれた GPU（UUID）が見つからなければ自動選択（単体 GPU の VRAM 最大 → iGPU）。
/// Vulkan 版でない・GPU が無い・環境変数で明示されている場合は何もしない。
fn apply_ggml_vulkan_device(
    cmd: &mut Command,
    backend: Option<&str>,
    preferred_uuid: Option<&str>,
) -> Option<gpu_select::VulkanDevice> {
    if backend != Some("vulkan") || env::var_os("GGML_VK_VISIBLE_DEVICES").is_some() {
        return None;
    }
    let device = gpu_select::resolve_preferred(preferred_uuid)?;
    cmd.env("GGML_VK_VISIBLE_DEVICES", device.index.to_string());
    Some(device)
}

/// whisper.cpp で文字起こしする（transcribe_cli.py と同じ結果形式）。
fn execute_ggml_transcription(
    app: &AppHandle,
    audio_path: &str,
    device: &str,
    model: &str,
    language: &str,
    low_memory_mode: bool,
    keep_fillers: bool,
    ggml_gpu_uuid: Option<&str>,
    audio_preprocess: Option<&str>,
) -> Result<SidecarExecResult, String> {
    let paths = resolve_ggml_speech_paths(app)?;
    let missing = paths.missing_for_transcription(model);
    if !missing.is_empty() {
        return Ok(ggml_failure_result(
            format!(
                "ggml エンジン（whisper.cpp）の準備が済んでいません。{} を実行してください。\n不足: {}",
                GGML_SPEECH_SETUP_SCRIPT,
                missing.join(" / ")
            ),
            None,
            String::new(),
        ));
    }
    let model_path = paths.whisper_model(model).expect("checked above");
    let use_gpu = device != "cpu";

    emit_progress(
        app,
        "preprocessing",
        "音声を変換しています...（ggml エンジン）",
        Some(3.0),
    );
    let mut guard = TempFileGuard::new();
    let wav = match decode_audio_to_private_wav(
        app,
        audio_path,
        &mut guard,
        audio_preprocess_filter(audio_preprocess),
    ) {
        Ok(v) => v,
        Err(e) => return Ok(ggml_failure_result(e, None, String::new())),
    };
    let temp_dir = private_llm_temp_dir(app)?;
    let out_name = private_temp_name("ggml-asr");
    let out_json = temp_dir.join(format!("{out_name}.json"));
    guard.push(out_json.clone());
    // 音声と出力先は一時ディレクトリからのファイル名（ASCII の生成名）だけで渡す。
    // Windows の whisper-cli はこの2つを ANSI のパスとして開くため、ユーザー名などに
    // 日本語を含む絶対パスを渡すと開けない（ggml_speech::whisper_response_file 参照）。
    let wav_name = wav
        .file_name()
        .map(PathBuf::from)
        .ok_or_else(|| "一時音声ファイル名を解決できませんでした。".to_string())?;

    let threads = thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(8);
    let whisper_args = ggml_speech::whisper_cli_args(
        &model_path,
        &paths.vad_model,
        &wav_name,
        Path::new(&out_name),
        language,
        use_gpu,
        keep_fillers,
        threads,
    );
    let mut cmd = Command::new(&paths.whisper_cli);
    cmd.current_dir(&temp_dir);
    if cfg!(target_os = "windows") {
        // argv はシステムのコードページで届き、日本語のプロンプトやモデルパスが化けるため、
        // UTF-8 の応答ファイルで渡す。
        let contents = match ggml_speech::whisper_response_file(&whisper_args) {
            Ok(v) => v,
            Err(e) => return Ok(ggml_failure_result(e, None, String::new())),
        };
        let rsp_name = format!("{}.args", private_temp_name("ggml-asr-args"));
        let rsp = temp_dir.join(&rsp_name);
        write_private_temp_file(&rsp, contents.as_bytes())?;
        guard.push(rsp);
        cmd.arg(format!("@{rsp_name}"));
    } else {
        cmd.args(whisper_args);
    }
    let gpu = if use_gpu {
        apply_ggml_vulkan_device(&mut cmd, paths.whisper_backend(), ggml_gpu_uuid)
    } else {
        None
    };
    let device_label = match (&gpu, use_gpu) {
        (Some(d), _) => d.name.clone(),
        (None, true) => "GPU".to_string(),
        (None, false) => "CPU".to_string(),
    };
    emit_progress(
        app,
        "transcribing",
        &format!("whisper.cpp で文字起こし中です...（{device_label}）"),
        Some(5.0),
    );
    let mut last = 0u32;
    let exec = run_ggml_engine_process(cmd, RunningTaskKind::Transcription, |line| {
        if let Some(p) = ggml_speech::parse_whisper_progress(line) {
            if p > last {
                last = p;
                emit_progress(
                    app,
                    "transcribing",
                    "音声を文字起こし中です...（whisper.cpp）",
                    Some(5.0 + p as f64 * 0.9),
                );
            }
        }
    })?;
    if !exec.status.success() {
        let tail = ggml_speech::tail_chars(exec.stderr.trim(), 1500);
        return Ok(ggml_failure_result(
            format!(
                "whisper.cpp の文字起こしに失敗しました（exit={:?}）。\n{tail}",
                exec.status.code()
            ),
            Some(exec.status),
            exec.stderr,
        ));
    }
    // トークンがバイト断片の場合に不正な UTF-8 が混ざることがあるため、置換文字を許して読む。
    let raw = fs::read(&out_json)
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .map_err(|e| format!("whisper.cpp の出力を読み込めませんでした: {e}"))?;
    let parsed: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("whisper.cpp の出力 JSON を解析できませんでした: {e}"))?;
    let (segments, text) = ggml_speech::convert_whisper_output(&parsed, language, keep_fillers)?;
    let filler_prompt_applied = ggml_speech::uses_filler_prompt(language, keep_fillers);
    // 長尺安定モードでも探索幅は下げない（ggml_speech::WHISPER_BEAM_SIZE のコメント参照）。
    let beam = ggml_speech::WHISPER_BEAM_SIZE;
    let result = serde_json::json!({
        "success": true,
        "result": {
            "text": text,
            "segments": segments,
            "settings": {
                "engine": "whisper.cpp",
                "gpu": gpu.as_ref().map(|d| d.name.clone()),
                "model": model,
                "device": if use_gpu { "cuda" } else { "cpu" },
                "computeType": "ggml",
                "language": language,
                "vadFilter": true,
                "wordTimestamps": false,
                "lowMemoryMode": low_memory_mode,
                "keepFillers": keep_fillers,
                "audioPreprocess": normalized_audio_preprocess(audio_preprocess),
                // 利用者の追加指示・用語辞書は使わない（話されていない語が出力へ紛れ込むのを防ぐため）。
                "initialPrompt": if filler_prompt_applied { Value::from(ggml_speech::FILLER_PROMPT) } else { Value::Null },
                "beamSize": beam,
                "bestOf": beam,
                "conditionOnPreviousText": false,
            },
            "diarizationRequested": false,
            "diarization": {
                "requested": false,
                "applied": false,
                "status": "disabled",
                "provider": Value::Null,
                "segments": [],
                "summary": Value::Null,
                "note": Value::Null,
            },
        }
    });
    emit_progress(app, "postprocess", "結果を整形しています...", Some(97.0));
    Ok(SidecarExecResult {
        status: exec.status,
        stdout: result.to_string(),
        stderr: exec.stderr,
    })
}

/// NeMo-Speech.cpp + Nemotron-3-Diarization で話者分離する（diarize_cli.py と同じ結果形式）。
fn execute_ggml_diarization(
    app: &AppHandle,
    audio_path: &str,
    device: &str,
    num_speakers: u8,
    running_kind: RunningTaskKind,
    progress_event: &str,
    ggml_gpu_uuid: Option<&str>,
) -> Result<SidecarExecResult, String> {
    let emit = |stage: &str, message: &str, progress: f64| {
        let _ = app.emit(
            progress_event,
            serde_json::json!({ "stage": stage, "message": message, "progress": progress }),
        );
    };
    let paths = resolve_ggml_speech_paths(app)?;
    let missing = paths.missing_for_diarization();
    if !missing.is_empty() {
        return Ok(ggml_failure_result(
            format!(
                "ggml エンジン（Nemotron-3-Diarization）の準備が済んでいません。{} を実行してください。\n不足: {}",
                GGML_SPEECH_SETUP_SCRIPT,
                missing.join(" / ")
            ),
            None,
            String::new(),
        ));
    }
    let use_gpu = device != "cpu";
    emit(
        "diarization_preprocessing",
        "話者分離用に音声を変換しています...",
        5.0,
    );
    let mut guard = TempFileGuard::new();
    let wav = match decode_audio_to_private_wav(app, audio_path, &mut guard, None) {
        Ok(v) => v,
        Err(e) => return Ok(ggml_failure_result(e, None, String::new())),
    };
    let out_json =
        private_llm_temp_dir(app)?.join(format!("{}.json", private_temp_name("ggml-diar")));
    guard.push(out_json.clone());

    // モデルは必ずローカルの絶対パスで渡す。リポジトリ ID を渡すと NeMo-Speech.cpp が
    // 自動ダウンロードを試みるため（通常運用時は通信しない方針）。
    let mut cmd = Command::new(&paths.nemo_speech);
    let device_override = env::var("LOTT_NEMO_SPEECH_DEVICE")
        .ok()
        .filter(|v| !v.trim().is_empty());
    // Vulkan 版は GPU を選んで GGML_VK_VISIBLE_DEVICES で1台だけ見せ、その 0 番を使う
    // （`auto` は iGPU を選ぶことがある）。
    let gpu = if use_gpu && device_override.is_none() {
        apply_ggml_vulkan_device(&mut cmd, paths.nemo_backend(), ggml_gpu_uuid)
    } else {
        None
    };
    let device_arg = device_override.unwrap_or_else(|| {
        match (&gpu, use_gpu) {
            (Some(_), _) => "vulkan:0",
            (None, true) => "auto",
            (None, false) => "cpu",
        }
        .to_string()
    });
    cmd.arg("diarize")
        .arg(&wav)
        .arg("--model")
        .arg(&paths.diar_model)
        .arg("--device")
        .arg(&device_arg)
        // 録音ファイル向けに21.12秒単位で処理する。これはCLIの`--offline`とは別のpresetで、長尺音声にも使える。
        .arg("--preset")
        .arg("v3-offline")
        .arg("--format")
        .arg("json")
        .arg("-o")
        .arg(&out_json)
        .arg("--force");
    emit(
        "diarization_running",
        &format!(
            "Nemotron-3-Diarization で話者分離中です...（{}）",
            match (&gpu, use_gpu) {
                (Some(d), _) => d.name.as_str(),
                (None, true) => "GPU",
                (None, false) => "CPU",
            }
        ),
        20.0,
    );
    let exec = run_ggml_engine_process(cmd, running_kind, |_| {})?;
    if !exec.status.success() {
        let tail = ggml_speech::tail_chars(exec.stderr.trim(), 1500);
        return Ok(ggml_failure_result(
            format!(
                "Nemotron-3-Diarization の話者分離に失敗しました（exit={:?}）。\n{tail}",
                exec.status.code()
            ),
            Some(exec.status),
            exec.stderr,
        ));
    }
    let raw = fs::read_to_string(&out_json)
        .map_err(|e| format!("話者分離の出力を読み込めませんでした: {e}"))?;
    let parsed: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("話者分離の出力 JSON を解析できませんでした: {e}"))?;
    let turns = ggml_speech::parse_nemo_diarization(&parsed)?;
    let (segments, summary) =
        ggml_speech::postprocess_diarization(&turns, usize::from(num_speakers.max(1)));
    emit("diarization_done", "話者分離が完了しました。", 98.0);
    let result = serde_json::json!({
        "success": true,
        "result": {
            "provider": "nemotron-3-diarization",
            "engine": "ggml",
            "requestedDevice": device,
            "device": if use_gpu { "cuda" } else { "cpu" },
            "backendDevice": device_arg,
            "gpu": gpu.as_ref().map(|d| d.name.clone()),
            "segments": segments,
            "summary": summary,
        }
    });
    Ok(SidecarExecResult {
        status: exec.status,
        stdout: result.to_string(),
        stderr: exec.stderr,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GgmlSpeechStatus {
    transcription_ready: bool,
    diarization_ready: bool,
    missing_for_transcription: Vec<String>,
    missing_for_diarization: Vec<String>,
    /// 実行ファイルのビルド種別（"vulkan" / "cuda" / "cpu"。不明なら null）。GPU 選択欄の表示に使う
    whisper_backend: Option<&'static str>,
    nemo_backend: Option<&'static str>,
}

/// 設定タブ用: ggml エンジンのファイルが揃っているかを返す（ファイルの有無を見るだけで、起動はしない）。
#[tauri::command]
fn check_ggml_speech_status(
    app: AppHandle,
    model: Option<String>,
) -> Result<GgmlSpeechStatus, String> {
    let paths = resolve_ggml_speech_paths(&app)?;
    let model = model.unwrap_or_else(|| "turbo".to_string());
    let missing_for_transcription = paths.missing_for_transcription(&model);
    let missing_for_diarization = paths.missing_for_diarization();
    Ok(GgmlSpeechStatus {
        transcription_ready: missing_for_transcription.is_empty(),
        diarization_ready: missing_for_diarization.is_empty(),
        missing_for_transcription,
        missing_for_diarization,
        whisper_backend: paths.whisper_backend(),
        nemo_backend: paths.nemo_backend(),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VulkanGpuList {
    devices: Vec<gpu_select::VulkanDevice>,
    /// 自動選択で使われる GPU の UUID（GPU が無ければ null）
    auto_uuid: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LegacyDataItem {
    label: String,
    path: String,
    bytes: Option<u64>,
}

// Do not follow links outside the old-data directory. Unreadable entries are unknown.
fn dir_size_bytes(path: &Path) -> Option<u64> {
    let meta = fs::symlink_metadata(path).ok()?;
    if meta.is_file() {
        return Some(meta.len());
    }
    if !meta.is_dir() {
        return None;
    }
    fs::read_dir(path).ok()?.try_fold(0_u64, |sum, entry| {
        sum.checked_add(dir_size_bytes(&entry.ok()?.path())?)
    })
}

/// Editor / Vulkan 版で使わなくなった旧版データ。
/// リリース版だけを対象にし、Editor は旧 E4B 音声入力資源、Vulkan は従来の CUDA / AMD 資源を表示する。
fn legacy_cuda_data_items(app: &AppHandle) -> Vec<LegacyDataItem> {
    if cfg!(debug_assertions) || !(is_vulkan_build(app) || is_editor_build(app)) {
        return Vec::new();
    }
    let mut candidates: Vec<(String, PathBuf)> = Vec::new();
    if is_editor_build(app) {
        candidates.extend(editor_legacy_data_candidates(
            release_models_root(app).as_deref(),
            app.path().app_cache_dir().ok().as_deref(),
            app.path().app_local_data_dir().ok().as_deref(),
        ));
        if let Ok(cache_base) = app.path().app_cache_dir() {
            let downloads = cache_base.join(LLM_ENGINE_CACHE_DIR_NAME).join("downloads");
            for (label, asset) in [
                (
                    "旧音声入力用 llama.cpp ダウンロード",
                    llama_cpu_backend_asset_name(),
                ),
                ("旧音声入力用 ffmpeg ダウンロード", ffmpeg_lgpl_asset_name()),
            ] {
                if let Ok(asset) = asset {
                    let archive = downloads.join(asset);
                    candidates.push((label.to_string(), archive.clone()));
                    candidates.push((
                        label.to_string(),
                        archive.with_file_name(format!(
                            "{}.part",
                            archive.file_name().unwrap_or_default().to_string_lossy()
                        )),
                    ));
                }
            }
        }
        return existing_legacy_data_items(candidates);
    }
    if let Some(models) = release_models_root(app) {
        candidates.push((
            "話者分離モデル（pyannote community-1）".to_string(),
            models.join("pyannote-speaker-diarization-community-1"),
        ));
        for path in legacy_e4b_model_files(&models) {
            candidates.push((
                "旧・標準の校正／音声入力モデル（Gemma 4 E4B）".to_string(),
                path,
            ));
        }
        candidates.push((
            "全体校正用のAIモデル（Gemma 4 12B）".to_string(),
            models.join("llm").join(GEMMA_12B_LLM_MODEL_DIR),
        ));
    }
    // 環境変数（HF_HUB_CACHE / HF_HOME）は見ない。アプリ専用ディレクトリだけを対象にする。
    if let Ok(data_dir) = app.path().app_local_data_dir() {
        candidates.extend(legacy_faster_whisper_model_dirs(&legacy_app_hf_hub_dir(&data_dir)));
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        for sub in ["resources/python312", "python312"] {
            candidates.push((
                "CUDA 版の Python と追加パッケージ（torch など）".to_string(),
                resource_dir.join(sub),
            ));
        }
        // CUDA 版の校正エンジンは不要データにする。
        for sub in ["resources/llama-server", "llama-server"] {
            candidates.push((
                "CUDA 版の AI 校正エンジン（llama-server）".to_string(),
                resource_dir.join(sub),
            ));
        }
        // バックグラウンド更新（/UPDATE）は旧版アンインストールを省略するため、
        // 新しいインストーラーから外した旧 Vulkan 資源が残ることがある。
        candidates.push((
            "旧 Vulkan 版の AI 校正エンジン（llama-server）".to_string(),
            legacy_vulkan_llama_server_resource_dir(&resource_dir),
        ));
    }
    // CUDA 版のパッケージ導入（pip）が使った作業場所。パッケージだけで会話データは含まない
    if let Ok(cache_dir) = app.path().app_cache_dir() {
        for sub in ["python-downloads", "python-pip", "python-tmp", "python-setup.log"] {
            candidates.push((
                "CUDA 版のパッケージ導入用キャッシュ".to_string(),
                cache_dir.join(sub),
            ));
        }
    }
    if let Ok(data_dir) = app.path().app_local_data_dir() {
        candidates.push((
            "AI校正モデルの選択設定".to_string(),
            data_dir.join("proofread-model-tier.txt"),
        ));
        candidates.push((
            "CUDA 版の Python 追加パッケージ".to_string(),
            data_dir.join("python312-site-packages"),
        ));
    }
    // 旧版の AI 校正エンジン（llama.cpp）の設定・ダウンロード置き場。Windows ではキャッシュと
    // データの保存先が同じことがあるため、同じパスは1回だけ載せる。
    for base in [app.path().app_cache_dir().ok(), app.path().app_local_data_dir().ok()]
        .into_iter()
        .flatten()
    {
        for sub in ["llm-engine", "lemonade"] {
            let path = base.join(sub);
            if !candidates.iter().any(|(_, existing)| *existing == path) {
                candidates.push(("旧版の AI 校正エンジンの設定・キャッシュ".to_string(), path));
            }
        }
    }
    existing_legacy_data_items(candidates)
}

fn existing_legacy_data_items(candidates: Vec<(String, PathBuf)>) -> Vec<LegacyDataItem> {
    candidates
        .into_iter()
        .filter(|(_, path)| path.exists())
        .filter_map(|(label, path)| {
            let bytes = dir_size_bytes(&path);
            // Empty old directories cannot free space and do not need a cleanup notice.
            if bytes == Some(0) {
                return None;
            }
            Some(LegacyDataItem {
                label,
                bytes,
                path: path.to_string_lossy().into_owned(),
            })
        })
        .collect()
}

fn editor_legacy_data_candidates(
    models_root: Option<&Path>,
    cache_base: Option<&Path>,
    app_data_dir: Option<&Path>,
) -> Vec<(String, PathBuf)> {
    let mut candidates = Vec::new();
    if let Some(models) = models_root {
        for path in legacy_e4b_model_files(models) {
            candidates.push(("旧・音声入力モデル（Gemma 4 E4B）".to_string(), path));
        }
    }
    if let Some(cache) = cache_base {
        candidates.push((
            "旧・音声入力用 CPU エンジン（llama.cpp）".to_string(),
            cache
                .join(LLM_ENGINE_CACHE_DIR_NAME)
                .join("bin")
                .join("llamacpp")
                .join("cpu"),
        ));
        candidates.push((
            "以前の音声入力用キャッシュ（lemonade）".to_string(),
            cache.join(LEGACY_LLM_ENGINE_CACHE_DIR_NAME),
        ));
    }
    if let Some(data) = app_data_dir {
        candidates.push(("旧・音声切り出し用 ffmpeg".to_string(), data.join("ffmpeg")));
    }
    candidates
}

fn legacy_e4b_model_files(models_root: &Path) -> Vec<PathBuf> {
    let model_dir = models_root.join("llm").join(GEMMA_LLM_MODEL_DIR);
    [
        GEMMA_MAIN_GGUF_FILENAME,
        GEMMA_MTP_GGUF_FILENAME,
        GEMMA_MMPROJ_GGUF_FILENAME,
    ]
    .into_iter()
    .map(|filename| model_dir.join(filename))
    .collect()
}

fn legacy_vulkan_llama_server_resource_dir(resource_dir: &Path) -> PathBuf {
    resource_dir.join("resources").join("llama-server-vulkan")
}

/// 設定タブ用: CUDA 版から残った不要データの一覧（Vulkan 版のリリースのみ。無ければ空）。
#[tauri::command]
async fn list_legacy_cuda_data(app: AppHandle) -> Result<Vec<LegacyDataItem>, String> {
    tauri::async_runtime::spawn_blocking(move || legacy_cuda_data_items(&app))
        .await
        .map_err(|e| format!("不要データの確認に失敗しました: {e}"))
}

/// CUDA 版から残った不要データを削除する。一覧と同じ規則で対象を決め直し、画面から渡された
/// パスは使わない（任意のフォルダを消せる経路を作らない）。削除できなかったものは一覧で返す。
#[tauri::command]
async fn delete_legacy_cuda_data(app: AppHandle) -> Result<Vec<LegacyDataItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        for item in legacy_cuda_data_items(&app) {
            let path = PathBuf::from(&item.path);
            let _ = if path.is_dir() {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_file(&path)
            };
        }
        legacy_cuda_data_items(&app)
    })
    .await
    .map_err(|e| format!("不要データの削除に失敗しました: {e}"))
}

/// セットアップ画面に表示するライセンス本文（`licenses/manual/`）。読めるのはこの一覧だけ。
const VIEWABLE_LICENSES: &[(&str, &str)] =
    &[("nemotron", "Nemotron-3-Diarization-OpenMDW-1.1.txt")];

#[tauri::command]
fn read_bundled_license(app: AppHandle, name: String) -> Result<String, String> {
    let file = VIEWABLE_LICENSES
        .iter()
        .find(|(key, _)| *key == name)
        .map(|(_, file)| *file)
        .ok_or_else(|| "表示できないライセンスです。".to_string())?;
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(rd) = app.path().resource_dir() {
        // tauri.conf の "../licenses" は resource_dir/_up_/licenses に置かれる
        dirs.push(rd.join("_up_").join("licenses"));
        dirs.push(rd.join("licenses"));
    }
    if cfg!(debug_assertions) {
        dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("licenses"));
    }
    dirs.into_iter()
        .map(|d| d.join("manual").join(file))
        .find_map(|p| fs::read_to_string(p).ok())
        .ok_or_else(|| format!("ライセンス本文が見つかりません（{file}）。アプリを再インストールしてください。"))
}

/// 設定タブで選ばれた GPU（UUID。None / 空は自動）を記録する。
#[tauri::command]
fn set_preferred_vulkan_gpu(uuid: Option<String>) {
    gpu_select::set_preferred_uuid(uuid);
}

/// 設定タブ用: Vulkan の GPU 一覧と、自動選択で使われる GPU を返す。
/// 列挙は子プロセスで行い、失敗・タイムアウト時は空の一覧を返す（エラーにはしない）。
#[tauri::command]
async fn list_vulkan_gpus(refresh: Option<bool>) -> Result<VulkanGpuList, String> {
    let refresh = refresh.unwrap_or(false);
    let devices = tauri::async_runtime::spawn_blocking(move || gpu_select::vulkan_devices(refresh))
        .await
        .map_err(|e| format!("GPU の列挙に失敗しました: {e}"))?;
    let auto_uuid = gpu_select::choose_auto(&devices).map(|d| d.uuid.clone());
    Ok(VulkanGpuList { devices, auto_uuid })
}


/// バンドルされた LGPL ビルドの ffmpeg バイナリのパスを返す。
/// resources/ffmpeg/ffmpeg(.exe) を探す（find_bundled_llama_server_bin と同じ流儀）。
fn find_bundled_ffmpeg_bin(app: &AppHandle) -> Option<String> {
    let path_api = app.path();
    let mut search_dirs: Vec<PathBuf> = Vec::new();

    if let Ok(rd) = path_api.resource_dir() {
        search_dirs.push(rd.join("resources").join("ffmpeg"));
        search_dirs.push(rd.join("ffmpeg"));
    }

    if let Ok(ed) = path_api.executable_dir() {
        search_dirs.push(ed.join("resources").join("ffmpeg"));
        search_dirs.push(ed.join("ffmpeg"));
        search_dirs.push(ed.join("_up_").join("resources").join("ffmpeg"));
        search_dirs.push(ed.join("_up_").join("ffmpeg"));
    }

    // dev ビルドではリソースが target/debug 配下にコピーされず resource_dir() からも
    // 解決できないため、ソースツリーの src-tauri/resources/ffmpeg を直接参照する。
    // 配置するのは setup_ffmpeg_lgpl.py が取得する LGPL ビルドなので Apache-2.0 前提は不変。
    // cfg(debug_assertions) ガードによりリリース挙動・配布物・AMD 版には影響しない。
    #[cfg(debug_assertions)]
    search_dirs.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("ffmpeg"),
    );

    let exe = std::env::consts::EXE_SUFFIX;
    for dir in &search_dirs {
        let path = dir.join(format!("ffmpeg{exe}"));
        if path.exists() {
            return Some(path.to_string_lossy().into_owned());
        }
    }
    None
}






fn should_emulate_missing_community_1() -> bool {
    matches!(
        read_dev_emulation_mode(),
        DevEmulationMode::MissingCommunity1
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DevEmulationMode {
    None,
    NoCuda,
    MissingCommunity1,
}


fn read_dev_emulation_mode() -> DevEmulationMode {
    if let Ok(raw) = env::var("LOTT_DEV_EMULATION_MODE") {
        let normalized = raw.trim().to_ascii_lowercase();
        if normalized == "no_cuda" {
            return DevEmulationMode::NoCuda;
        }
        if normalized == "missing_community1" {
            return DevEmulationMode::MissingCommunity1;
        }
        if normalized == "none" || normalized.is_empty() {
            return DevEmulationMode::None;
        }
    }
    DevEmulationMode::None
}



fn should_use_low_memory_mode(audio_path: &str) -> bool {
    const THRESHOLD_BYTES: u64 = 15 * 1024 * 1024;
    fs::metadata(audio_path)
        .map(|m| m.len() >= THRESHOLD_BYTES)
        .unwrap_or(false)
}

fn audio_file_size_bytes(audio_path: &str) -> u64 {
    fs::metadata(audio_path).map(|m| m.len()).unwrap_or(0)
}



fn overlap_seconds(a_start: f64, a_end: f64, b_start: f64, b_end: f64) -> f64 {
    let left = a_start.max(b_start);
    let right = a_end.min(b_end);
    (right - left).max(0.0)
}

const MERGE_SAME_SPEAKER_MAX_GAP_SECONDS: f64 = 1.0;
const MERGE_CONSECUTIVE_SAME_SPEAKER_SEGMENTS: bool = false;

fn should_insert_text_space(prev_text: &str, next_text: &str) -> bool {
    let prev_last = prev_text.chars().next_back();
    let next_first = next_text.chars().next();
    match (prev_last, next_first) {
        (Some(a), Some(b)) => a.is_ascii_alphanumeric() && b.is_ascii_alphanumeric(),
        _ => false,
    }
}

fn merge_segment_text(prev_text: &str, next_text: &str) -> String {
    if prev_text.is_empty() {
        return next_text.to_string();
    }
    if next_text.is_empty() {
        return prev_text.to_string();
    }
    if should_insert_text_space(prev_text, next_text) {
        format!("{prev_text} {next_text}")
    } else {
        format!("{prev_text}{next_text}")
    }
}

fn merge_consecutive_speaker_segments(segments: &mut Vec<Value>) {
    if segments.len() <= 1 {
        return;
    }

    let mut merged: Vec<Value> = Vec::with_capacity(segments.len());
    let original = std::mem::take(segments);

    for segment in original {
        let Some(curr_obj) = segment.as_object() else {
            merged.push(segment);
            continue;
        };
        let curr_speaker = curr_obj
            .get("speaker")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        let curr_start = curr_obj.get("start").and_then(Value::as_f64).unwrap_or(0.0);
        let curr_end = curr_obj
            .get("end")
            .and_then(Value::as_f64)
            .unwrap_or(curr_start);

        let Some(prev_obj) = merged.last_mut().and_then(Value::as_object_mut) else {
            merged.push(segment);
            continue;
        };
        let prev_speaker = prev_obj
            .get("speaker")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        let prev_end = prev_obj
            .get("end")
            .and_then(Value::as_f64)
            .unwrap_or(curr_start);
        let gap = curr_start - prev_end;

        if curr_speaker.is_empty()
            || prev_speaker.is_empty()
            || curr_speaker != prev_speaker
            || gap > MERGE_SAME_SPEAKER_MAX_GAP_SECONDS
        {
            merged.push(segment);
            continue;
        }

        let new_end = prev_end.max(curr_end);
        prev_obj.insert("end".to_string(), Value::from(new_end));

        let prev_text = prev_obj
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        let curr_text = curr_obj
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        prev_obj.insert(
            "text".to_string(),
            Value::String(merge_segment_text(prev_text, curr_text)),
        );

        let curr_words = curr_obj.get("words").and_then(Value::as_array).cloned();
        if let Some(words_to_add) = curr_words {
            if let Some(prev_words) = prev_obj.get_mut("words").and_then(Value::as_array_mut) {
                prev_words.extend(words_to_add);
            } else {
                prev_obj.insert("words".to_string(), Value::Array(words_to_add));
            }
        }
    }

    for (idx, seg) in merged.iter_mut().enumerate() {
        if let Some(seg_obj) = seg.as_object_mut() {
            seg_obj.insert("id".to_string(), Value::from(idx as i64));
        }
    }

    *segments = merged;
}

fn assign_speakers_to_segments(result: &mut Value, diarization_segments: &[Value]) {
    let Some(segments) = result.get_mut("segments").and_then(Value::as_array_mut) else {
        return;
    };
    // 単語の時刻を持つ結果（ggml エンジンでフィラーを残す場合）は、話者交代位置で行を分けて割り当てる。
    // 標準エンジン（word_timestamps=false）の結果は単語を持たないため、従来の行単位の割り当てのまま。
    if let Some(split) = ggml_speech::split_segments_by_speaker(segments, diarization_segments) {
        *segments = split;
        return;
    }

    for seg in segments.iter_mut() {
        let seg_obj = match seg.as_object_mut() {
            Some(v) => v,
            None => continue,
        };
        let seg_start = seg_obj.get("start").and_then(Value::as_f64).unwrap_or(0.0);
        let seg_end = seg_obj.get("end").and_then(Value::as_f64).unwrap_or(0.0);

        let mut best_speaker: Option<String> = None;
        let mut best_overlap = 0.0_f64;

        for d in diarization_segments {
            let Some(d_obj) = d.as_object() else {
                continue;
            };
            let d_start = d_obj.get("start").and_then(Value::as_f64).unwrap_or(0.0);
            let d_end = d_obj.get("end").and_then(Value::as_f64).unwrap_or(0.0);
            let ov = overlap_seconds(seg_start, seg_end, d_start, d_end);
            if ov > best_overlap {
                best_overlap = ov;
                best_speaker = d_obj
                    .get("speaker")
                    .and_then(Value::as_str)
                    .map(|s| s.to_string());
            }
        }

        seg_obj.insert(
            "speaker".to_string(),
            best_speaker.map(Value::String).unwrap_or(Value::Null),
        );
    }

    if MERGE_CONSECUTIVE_SAME_SPEAKER_SEGMENTS {
        merge_consecutive_speaker_segments(segments);
    }
}

fn parse_json_from_mixed_output(output: &str) -> Option<Value> {
    if let Ok(v) = serde_json::from_str::<Value>(output) {
        return Some(v);
    }

    let start = output.find('{')?;
    let end = output.rfind('}')?;
    if end <= start {
        return None;
    }
    let slice = &output[start..=end];
    serde_json::from_str::<Value>(slice).ok()
}

fn build_detailed_sidecar_error_message(
    prefix: &str,
    output: &SidecarExecResult,
    parsed_json: Option<&Value>,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    parts.push(prefix.to_string());

    if let Some(json) = parsed_json {
        if let Some(msg) = json
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
        {
            parts.push(msg.to_string());
        }
        if let Some(detail) = json
            .get("error")
            .and_then(|e| e.get("detail"))
            .and_then(Value::as_str)
        {
            if !detail.trim().is_empty() {
                parts.push(format!("detail: {detail}"));
            }
        }
        if let Some(traceback) = json
            .get("error")
            .and_then(|e| e.get("traceback"))
            .and_then(Value::as_str)
        {
            let one_line = traceback
                .lines()
                .filter(|l| !l.trim().is_empty())
                .last()
                .unwrap_or(traceback);
            parts.push(format!("trace: {one_line}"));
        }
    }

    if parts.len() == 1 {
        if !output.stderr.trim().is_empty() {
            parts.push(output.stderr.trim().to_string());
        } else if !output.stdout.trim().is_empty() {
            let preview: String = output.stdout.chars().take(300).collect();
            parts.push(format!("stdout: {preview}"));
        }
    }

    parts.push(format!(
        "debug: exit={:?}, stdout_len={}, stderr_len={}",
        output.status.code(),
        output.stdout.len(),
        output.stderr.len()
    ));

    let combined = parts.join(" | ");

    // VRAM不足を疑えるキーワードが含まれる場合はヒントを付加する
    let search_text = format!(
        "{} {} {}",
        combined.to_lowercase(),
        output.stderr.to_lowercase(),
        output.stdout.to_lowercase(),
    );
    let hint = if search_text.contains("out of memory")
        || search_text.contains("failed to allocate")
        || search_text.contains("not enough memory")
        || search_text.contains("cuda error")
        || search_text.contains("hip error")
        || search_text.contains("memory allocation")
    {
        Some("VRAMが不足している可能性があります。他のLLMアプリを終了してから再試行してください。")
    } else if search_text.contains("read timed out") || search_text.contains("readtimeout") {
        Some("応答がタイムアウトしました。VRAMが不足しモデルが応答できていない可能性があります。他のLLMアプリを終了してから再試行してください。")
    } else if search_text.contains("connection refused")
        || search_text.contains("newconnectionerror")
        || search_text.contains("failed to establish a new connection")
    {
        Some("サーバーへの接続が拒否されました。LM Studio / Ollama などのサーバーが起動しているか、モデルがロード済みかを確認してください。")
    } else {
        None
    };

    match hint {
        Some(h) => format!("{combined} | ヒント: {h}"),
        None => combined,
    }
}

















fn emit_progress_bytes_to(
    app: &AppHandle,
    event: &str,
    component: &str,
    status: &str,
    message: &str,
    downloaded_bytes: u64,
    total_bytes: u64,
) {
    app.emit(
        event,
        SetupProgressPayload {
            component: component.to_string(),
            status: status.to_string(),
            message: message.to_string(),
            downloaded_bytes: Some(downloaded_bytes),
            total_bytes: Some(total_bytes),
        },
    )
    .ok();
}

/// ファイルの SHA-256（小文字16進）。1.6GB のモデルでも数秒で終わるよう 1MiB ずつ読む。
fn sha256_file_hex(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut file =
        fs::File::open(path).map_err(|e| format!("ファイルを開けませんでした: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0_u8; 1 << 20];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("ファイルを読めませんでした: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

/// 途中から再開できるダウンロード（curl の `-C -`）。`.part` を残しておけば、回線が切れても
/// 次のセットアップで続きから取得する。curl が無い Windows では PowerShell で最初から取得する。
fn spawn_resumable_download(url: &str, part_file: &Path) -> Result<Child, String> {
    let curl_name = if cfg!(target_os = "windows") {
        "curl.exe"
    } else {
        "curl"
    };
    let mut curl = Command::new(curl_name);
    apply_windows_no_window(&mut curl);
    apply_host_command_env(&mut curl);
    curl.args([
        "-fL",
        "--retry",
        "3",
        "--retry-delay",
        "5",
        "--silent",
        "--show-error",
        "-C",
        "-",
        "-o",
    ])
    .arg(part_file)
    .arg(url)
    .stdout(Stdio::null())
    .stderr(Stdio::null());
    match curl.spawn() {
        Ok(child) => Ok(child),
        Err(curl_err) if cfg!(target_os = "windows") => {
            let _ = fs::remove_file(part_file);
            spawn_file_download(url, part_file)
                .map_err(|e| format!("{e}（curl を起動できませんでした: {curl_err}）"))
        }
        Err(curl_err) => Err(format!(
            "ダウンロードに使う curl を起動できませんでした: {curl_err}。curl をインストールしてから再試行してください。"
        )),
    }
}


fn download_pinned_file_blocking_with_event(
    app: &AppHandle,
    model: &PinnedDownloadFile,
    dest: &Path,
    progress_event: &str,
) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "{}の保存先フォルダを作成できませんでした（{}）: {e}。空き容量とアクセス権を確認してください。",
                model.label,
                parent.display()
            )
        })?;
    }
    let part = dest.with_file_name(format!("{}.part", model.file));
    let part_len = || part.metadata().map(|m| m.len()).unwrap_or(0);
    if part_len() > model.size {
        fs::remove_file(&part).map_err(|e| {
            format!(
                "{}の中断ファイルを削除できませんでした: {e}。ファイルを閉じてから再実行してください。",
                model.label
            )
        })?;
    }

    let message = format!("{}をダウンロード中...", model.label);
    emit_progress_bytes_to(
        app,
        progress_event,
        model.component,
        "downloading",
        &message,
        part_len(),
        model.size,
    );
    if part_len() < model.size {
        let mut child = spawn_resumable_download(model.url, &part).map_err(|e| {
            format!(
                "{}のダウンロードを開始できませんでした: {e}。curl または PowerShell を利用可能にして再実行してください。",
                model.label
            )
        })?;
        let mut last_emitted = part_len();
        loop {
            match child
                .try_wait()
                .map_err(|e| {
                    format!(
                        "{}のダウンロード処理を確認できませんでした: {e}。回線と実行環境を確認して再実行してください。",
                        model.label
                    )
                })?
            {
                Some(status) if status.success() => break,
                Some(_) => {
                    return Err(format!(
                        "{}の取得が中断されました（通信または配布元の応答エラー）。回線を確認して再実行してください（curl 利用時は .part から再開します）。",
                        model.label
                    ));
                }
                None => {
                    let downloaded = part_len();
                    if downloaded >= last_emitted + 8 * 1024 * 1024 {
                        last_emitted = downloaded;
                        emit_progress_bytes_to(
                            app,
                            progress_event,
                            model.component,
                            "downloading",
                            &message,
                            downloaded,
                            model.size,
                        );
                    }
                    thread::sleep(Duration::from_millis(800));
                }
            }
        }
    }

    let size = part_len();
    if size != model.size {
        let _ = fs::remove_file(&part);
        return Err(format!(
            "{}の検証に失敗しました（サイズが想定と異なります: {size} / {} bytes）。回線を確認して再ダウンロードしてください。",
            model.label, model.size
        ));
    }
    emit_progress_bytes_to(
        app,
        progress_event,
        model.component,
        "downloading",
        &format!("{}を検証中...", model.label),
        size,
        model.size,
    );
    let sha = sha256_file_hex(&part).map_err(|e| {
        format!(
            "{}を検証できませんでした: {e}。保存先の空き容量とアクセス権を確認して再実行してください。",
            model.label
        )
    })?;
    if sha != model.sha256 {
        let _ = fs::remove_file(&part);
        return Err(format!(
            "{}の検証に失敗しました（SHA-256 が一致しません）。回線を確認して再ダウンロードしてください。繰り返す場合は配布元の更新有無を確認してください。",
            model.label
        ));
    }
    if dest.exists() {
        fs::remove_file(dest).map_err(|e| {
            format!(
                "{}の既存ファイルを置き換えられませんでした: {e}。ファイルを閉じてアクセス権を確認してください。",
                model.label
            )
        })?;
    }
    fs::rename(&part, dest).map_err(|e| {
        format!(
            "{}を保存先へ配置できませんでした: {e}。空き容量とアクセス権を確認して再実行してください。",
            model.label
        )
    })?;
    Ok(())
}

fn download_ggml_model_blocking_with_event(
    app: &AppHandle,
    model: &ggml_speech::GgmlModelFile,
    models_root: &Path,
    progress_event: &str,
) -> Result<(), String> {
    let dest = model.path(models_root);
    if model.is_installed(models_root) {
        return Ok(());
    }
    let pinned = PinnedDownloadFile {
        component: model.component,
        label: model.label,
        file: model.file,
        url: model.url,
        sha256: model.sha256,
        size: model.size,
    };
    download_pinned_file_blocking_with_event(app, &pinned, &dest, progress_event)
}

/// 進捗単位（whisper_turbo / diarization）ごとに、Vulkan 版の ggml モデルをまとめて取得する。
fn install_ggml_models_blocking(app: &AppHandle, component: &str) -> Result<(), String> {
    install_ggml_models_blocking_with_event(app, component, "setup_progress")
}

fn install_ggml_models_blocking_with_event(
    app: &AppHandle,
    component: &str,
    progress_event: &str,
) -> Result<(), String> {
    let models_root = resolve_ggml_models_root(app)?;
    for model in ggml_speech::GGML_MODEL_FILES
        .iter()
        .filter(|m| m.component == component)
    {
        download_ggml_model_blocking_with_event(app, model, &models_root, progress_event)?;
    }
    Ok(())
}

fn emit_setup_progress(app: &AppHandle, component: &str, status: &str, message: &str) {
    app.emit(
        "setup_progress",
        SetupProgressPayload {
            component: component.to_string(),
            status: status.to_string(),
            message: message.to_string(),
            downloaded_bytes: None,
            total_bytes: None,
        },
    )
    .ok();
}

// python312._pth に UTF-8 BOM が付いていると python312.zip のパスが壊れ
// "No module named 'encodings'" で起動失敗する。BOM を除去する。
// 再インストール後など ._pth が上書きされた場合に BOM が混入することがある。




/// 認証情報を保持する文字列を、スコープ終了時に上書きしてから解放する。
/// 通常の `String::clear` だけでは確保済み領域に内容が残り得るため、volatile writeを使う。
struct SensitiveOptionalString(Option<String>);

impl SensitiveOptionalString {
    fn new(value: Option<String>) -> Self {
        Self(value)
    }


    fn clear(&mut self) {
        if let Some(value) = self.0.as_mut() {
            // SAFETY: 0 is valid UTF-8. The string is not read again after this overwrite,
            // and its length/capacity are unchanged until `clear` and normal drop.
            unsafe {
                for byte in value.as_mut_vec().iter_mut() {
                    std::ptr::write_volatile(byte, 0);
                }
            }
            value.clear();
        }
    }
}

impl Drop for SensitiveOptionalString {
    fn drop(&mut self) {
        self.clear();
    }
}

fn run_full_setup_blocking(app: AppHandle, hf_token: Option<String>) -> Result<bool, String> {
    // トークンは不要（旧版の画面から届いても使わずに消す）。
    let mut hf_token = SensitiveOptionalString::new(hf_token);
    hf_token.clear();
    Ok(run_ggml_model_setup_blocking(&app))
}

/// Vulkan 版: whisper.cpp のモデルと VAD、Nemotron を取得する（トークン不要・SHA-256 検証）。
fn run_ggml_model_setup_blocking(app: &AppHandle) -> bool {
    let mut all_ok = true;
    let models_root = match resolve_ggml_models_root(app) {
        Ok(root) => root,
        Err(e) => {
            emit_setup_progress(app, "whisper_turbo", "error", &format!("エラー: {e}"));
            emit_setup_progress(app, "diarization", "error", &format!("エラー: {e}"));
            return false;
        }
    };
    for component in ["whisper_turbo", "diarization"] {
        if ggml_speech::ggml_models_installed(&models_root, component) {
            emit_setup_progress(app, component, "skipped", "インストール済みです");
            continue;
        }
        match install_ggml_models_blocking(app, component) {
            Ok(()) => emit_setup_progress(app, component, "done", "ダウンロード完了"),
            Err(e) => {
                emit_setup_progress(app, component, "error", &e);
                all_ok = false;
            }
        }
    }
    all_ok
}


#[tauri::command]
async fn run_full_setup(app: AppHandle, hf_token: Option<String>) -> Result<bool, String> {
    let _run_guard = TaskRunGuard::try_acquire(&SETUP_ACTIVE)
        .ok_or_else(|| "セットアップは既に実行中です。完了するまでお待ちください。".to_string())?;
    tauri::async_runtime::spawn_blocking(move || run_full_setup_blocking(app, hf_token))
        .await
        .map_err(|e| format!("セットアップタスクの実行に失敗しました: {e}"))?
}















pub fn run() {
    // 会話データを含みうるクラッシュダンプ・コアダンプを OS の報告機構に作らせない（最優先で設定する）。
    #[cfg(target_os = "windows")]
    configure_crash_dump_protection();
    #[cfg(target_os = "linux")]
    let _ = disable_core_dumps();
    #[cfg(target_os = "linux")]
    configure_webkit_dmabuf_workaround();
    let audio_playback_path: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let audio_stream_token =
        Arc::new(generate_audio_stream_token().expect("audio stream token generation failed"));
    let audio_stream_port = start_audio_stream_server(
        Arc::clone(&audio_playback_path),
        Arc::clone(&audio_stream_token),
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DevWindowFocusState::default())
        .manage(AudioStreamServer {
            port: audio_stream_port,
            token: (*audio_stream_token).clone(),
            playback_path: audio_playback_path,
        })
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            ensure_bundled_vulkan_loader_on_path(app.handle());
            cleanup_stale_private_temp_files(app.handle());
            if let Some(window) = app.get_webview_window("main") {
                // Linuxのネイティブパッケージではdesktop entryのテーマアイコンに加え、
                // 実ウィンドウにもアイコンを設定する。KDE/X11のタスク切替表示で
                // _NET_WM_ICONが空になり汎用アイコンへ落ちるのを防ぐ。
                if let Some(icon) = app.default_window_icon().cloned() {
                    let _ = window.set_icon(icon);
                }
                #[cfg(target_os = "linux")]
                {
                    let _ = window.with_webview(|webview| {
                        use webkit2gtk::{
                            glib::ObjectExt, PermissionRequestExt, UserMediaPermissionRequest,
                            WebViewExt,
                        };
                        webview.inner().connect_permission_request(|_, request| {
                            if request.is::<UserMediaPermissionRequest>() {
                                request.allow();
                                true
                            } else {
                                false
                            }
                        });
                    });
                }
                if !schedule_dev_window_focus(app.handle(), &window) {
                    let _ = window.maximize();
                }
                show_cpu_startup_dialog(app, &window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            run_transcription,
            run_diarization,
            proofread_transcription,
            cancel_transcription,
            cancel_diarization,
            check_ggml_speech_status,
            list_vulkan_gpus,
            get_gpu_driver_hint,
            set_preferred_vulkan_gpu,
            list_legacy_cuda_data,
            read_bundled_license,
            delete_legacy_cuda_data,
            cancel_proofread,
            save_transcription_json,
            save_runtime_estimate_csv,
            save_transcription_docx,
            save_transcription_xlsx,
            save_transcription_srt,
            read_text_file,
            read_file_size,
            check_transcription_runtime_support,
            check_gpu_availability,
            debounce_dev_window_focus,
            check_editor_voice_input_pack_status,
            install_editor_voice_input_pack,
            dev_delete_editor_voice_input_pack,
            generate_editor_voice_input_candidates,
            get_installed_memory_bytes,
            get_audio_stream_info,
            get_audio_duration_seconds,
            prepare_playback_source,
            get_dev_demo_data_dir,
            dev_delete_downloaded_models,
            check_all_setup_status,
            run_full_setup
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 通常終了時に、自プロセスが専用一時領域へ作ったファイル（再生用キャッシュなど）を消す。
            // 子プロセス（whisper.cpp など）の停止は従来どおり Job Object が担う。
            if let tauri::RunEvent::Exit = event {
                cleanup_own_private_temp_files(app_handle);
            }
        });
}
