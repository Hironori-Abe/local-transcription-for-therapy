//! Vulkan の GPU を列挙し、ggml エンジン（whisper.cpp / NeMo-Speech.cpp）に使わせる GPU を決める。
//!
//! 番号は `vkEnumeratePhysicalDevices` の並び。ggml-vulkan の `GGML_VK_VISIBLE_DEVICES` もこの並びを
//! 指すため、版の異なる ggml を持つ実行ファイルに同じ番号を渡せる。iGPU と dGPU を併載した機種では
//! iGPU が 0 番になることがあり（RTX 4060 Laptop + Radeon 780M で確認）、ggml の既定に任せると
//! iGPU で動いてしまう。
//!
//! Vulkan の初期化は全 GPU ドライバーを読み込むため、アプリ本体ではなく、自分自身を
//! `--lott-list-vulkan-devices` 付きの子プロセスとして起動して列挙する（ドライバーの不具合で
//! アプリが落ちたり固まったりしないように。タイムアウトあり）。

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// 子プロセスとして列挙だけを行うときの引数（main.rs が見る）。
pub const LIST_VULKAN_DEVICES_ARG: &str = "--lott-list-vulkan-devices";
const LIST_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceKind {
    Discrete,
    Integrated,
    Virtual,
    Cpu,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VulkanDevice {
    /// `vkEnumeratePhysicalDevices` の並び（= `GGML_VK_VISIBLE_DEVICES` の番号）
    pub index: u32,
    pub name: String,
    pub kind: DeviceKind,
    /// 最大の device-local ヒープ（MiB）。iGPU では共有メモリの大きさになるため、選択では種別を先に見る
    pub vram_mb: u64,
    /// 設定に保存する識別子。番号は GPU の抜き差しで変わりうるため UUID で覚える
    pub uuid: String,
}

/// 自動選択: 単体 GPU があればその中で VRAM 最大、無ければ iGPU、それも無ければ仮想 GPU。
/// VRAM が同じなら番号の小さい方。CPU 実装（llvmpipe 等）は選ばない。
pub fn choose_auto(devices: &[VulkanDevice]) -> Option<&VulkanDevice> {
    [
        DeviceKind::Discrete,
        DeviceKind::Integrated,
        DeviceKind::Virtual,
    ]
    .into_iter()
    .find_map(|kind| {
        devices
            .iter()
            .filter(|d| d.kind == kind)
            .max_by(|a, b| a.vram_mb.cmp(&b.vram_mb).then(b.index.cmp(&a.index)))
    })
}

/// 設定で選ばれた GPU（UUID）があればそれを、見つからなければ自動選択の GPU を返す。
pub fn resolve<'a>(
    devices: &'a [VulkanDevice],
    preferred_uuid: Option<&str>,
) -> Option<&'a VulkanDevice> {
    preferred_uuid
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .and_then(|u| devices.iter().find(|d| d.uuid.eq_ignore_ascii_case(u)))
        .or_else(|| choose_auto(devices))
}

// ---- 列挙（子プロセス側） ------------------------------------------------------------

/// 子プロセスとして呼ばれたときの処理。列挙結果を JSON で標準出力へ書く。
pub fn print_vulkan_devices() {
    let devices = enumerate_in_process().unwrap_or_default();
    println!(
        "{}",
        serde_json::to_string(&devices).unwrap_or_else(|_| "[]".into())
    );
}

fn enumerate_in_process() -> Result<Vec<VulkanDevice>, String> {
    use ash::vk;
    // SAFETY: Vulkan ローダーを動的に読み込み、インスタンスを作って物理デバイスの情報を読むだけ。
    // 作ったインスタンスは戻る前に破棄する。
    unsafe {
        let entry =
            ash::Entry::load().map_err(|e| format!("Vulkan ローダーを読み込めません: {e}"))?;
        let app_info = vk::ApplicationInfo::default().api_version(vk::API_VERSION_1_1);
        let create_info = vk::InstanceCreateInfo::default().application_info(&app_info);
        let instance = entry
            .create_instance(&create_info, None)
            .map_err(|e| format!("Vulkan を初期化できません: {e}"))?;
        let physical = instance.enumerate_physical_devices().unwrap_or_default();
        let mut out = Vec::with_capacity(physical.len());
        for (index, pd) in physical.into_iter().enumerate() {
            let props = instance.get_physical_device_properties(pd);
            let name = props
                .device_name_as_c_str()
                .map(|c| c.to_string_lossy().into_owned())
                .unwrap_or_default();
            let kind = match props.device_type {
                vk::PhysicalDeviceType::DISCRETE_GPU => DeviceKind::Discrete,
                vk::PhysicalDeviceType::INTEGRATED_GPU => DeviceKind::Integrated,
                vk::PhysicalDeviceType::VIRTUAL_GPU => DeviceKind::Virtual,
                vk::PhysicalDeviceType::CPU => DeviceKind::Cpu,
                _ => DeviceKind::Other,
            };
            let mem = instance.get_physical_device_memory_properties(pd);
            let vram = mem
                .memory_heaps_as_slice()
                .iter()
                .filter(|h| h.flags.contains(vk::MemoryHeapFlags::DEVICE_LOCAL))
                .map(|h| h.size)
                .max()
                .unwrap_or(0);
            let uuid = if props.api_version >= vk::API_VERSION_1_1 {
                let mut id = vk::PhysicalDeviceIDProperties::default();
                let mut props2 = vk::PhysicalDeviceProperties2::default().push_next(&mut id);
                instance.get_physical_device_properties2(pd, &mut props2);
                id.device_uuid.iter().map(|b| format!("{b:02x}")).collect()
            } else {
                String::new()
            };
            out.push(VulkanDevice {
                index: index as u32,
                name,
                kind,
                vram_mb: vram / (1024 * 1024),
                uuid,
            });
        }
        instance.destroy_instance(None);
        Ok(out)
    }
}

// ---- 列挙（アプリ側） ----------------------------------------------------------------

static CACHE: Mutex<Option<Vec<VulkanDevice>>> = Mutex::new(None);
/// 設定タブで選ばれた GPU（UUID）。フロントが設定の読み込み時・変更時に渡す。
/// 要求ごとに UUID を受け取らない経路（音声入力など）もこれで同じ GPU を使う。
static PREFERRED_UUID: Mutex<Option<String>> = Mutex::new(None);

pub fn set_preferred_uuid(uuid: Option<String>) {
    if let Ok(mut p) = PREFERRED_UUID.lock() {
        *p = uuid.map(|u| u.trim().to_string()).filter(|u| !u.is_empty());
    }
}

pub fn preferred_uuid() -> Option<String> {
    PREFERRED_UUID.lock().ok().and_then(|p| p.clone())
}

/// 設定に従って使う GPU（要求で UUID が来ればそれを、無ければ設定の値を使う）。
pub fn resolve_preferred(requested_uuid: Option<&str>) -> Option<VulkanDevice> {
    let devices = vulkan_devices(false);
    let fallback = preferred_uuid();
    let uuid = requested_uuid
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .or(fallback.as_deref());
    resolve(&devices, uuid).cloned()
}

/// Vulkan の GPU 一覧を返す。`refresh` が偽ならアプリ起動中の前回結果を使う。
/// Vulkan ドライバーが無い・列挙に失敗した・タイムアウトした場合は空。
pub fn vulkan_devices(refresh: bool) -> Vec<VulkanDevice> {
    if !refresh {
        if let Some(cached) = CACHE.lock().ok().and_then(|c| c.clone()) {
            return cached;
        }
    }
    let devices = enumerate_isolated().unwrap_or_else(|e| {
        eprintln!("[LoTT][gpu] Vulkan の GPU を列挙できませんでした: {e}");
        Vec::new()
    });
    if let Ok(mut c) = CACHE.lock() {
        *c = Some(devices.clone());
    }
    devices
}

fn enumerate_isolated() -> Result<Vec<VulkanDevice>, String> {
    let exe =
        std::env::current_exe().map_err(|e| format!("実行ファイルの場所を取得できません: {e}"))?;
    let mut cmd = Command::new(exe);
    cmd.arg(LIST_VULKAN_DEVICES_ARG)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("列挙プロセスを起動できません: {e}"))?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() > LIST_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("タイムアウトしました".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(format!("列挙プロセスの終了を待てません: {e}")),
        }
    }
    let mut out = String::new();
    if let Some(mut s) = child.stdout.take() {
        let _ = s.read_to_string(&mut out);
    }
    parse_listing(&out)
}

/// 列挙プロセスの標準出力（最後の JSON 行）を読む。
fn parse_listing(stdout: &str) -> Result<Vec<VulkanDevice>, String> {
    let line = stdout
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with('['))
        .ok_or_else(|| "列挙結果がありません".to_string())?;
    serde_json::from_str(line).map_err(|e| format!("列挙結果を読めません: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dev(index: u32, kind: DeviceKind, vram_mb: u64) -> VulkanDevice {
        VulkanDevice {
            index,
            name: format!("gpu{index}"),
            kind,
            vram_mb,
            uuid: format!("uuid{index}"),
        }
    }

    #[test]
    fn prefers_discrete_over_integrated_even_with_more_shared_memory() {
        // RTX 4060 Laptop + Radeon 780M の実際の並び（iGPU が 0 番、共有メモリの方が大きい）
        let d = [
            dev(0, DeviceKind::Integrated, 16278),
            dev(1, DeviceKind::Discrete, 7957),
        ];
        assert_eq!(choose_auto(&d).unwrap().index, 1);
    }

    #[test]
    fn picks_larger_vram_among_discrete_and_lower_index_on_tie() {
        let d = [
            dev(0, DeviceKind::Discrete, 8192),
            dev(1, DeviceKind::Integrated, 32768),
            dev(2, DeviceKind::Discrete, 16384),
        ];
        assert_eq!(choose_auto(&d).unwrap().index, 2);
        let tie = [
            dev(3, DeviceKind::Discrete, 8192),
            dev(1, DeviceKind::Discrete, 8192),
        ];
        assert_eq!(choose_auto(&tie).unwrap().index, 1);
    }

    #[test]
    fn falls_back_to_integrated_and_never_picks_cpu() {
        let d = [
            dev(0, DeviceKind::Cpu, 65536),
            dev(1, DeviceKind::Integrated, 4096),
        ];
        assert_eq!(choose_auto(&d).unwrap().index, 1);
        assert!(choose_auto(&[dev(0, DeviceKind::Cpu, 65536)]).is_none());
        assert!(choose_auto(&[]).is_none());
    }

    #[test]
    fn user_choice_wins_but_missing_choice_falls_back_to_auto() {
        let d = [
            dev(0, DeviceKind::Integrated, 16278),
            dev(1, DeviceKind::Discrete, 7957),
        ];
        assert_eq!(resolve(&d, Some("UUID0")).unwrap().index, 0);
        assert_eq!(resolve(&d, Some("gone")).unwrap().index, 1);
        assert_eq!(resolve(&d, Some("")).unwrap().index, 1);
        assert_eq!(resolve(&d, None).unwrap().index, 1);
    }

    #[test]
    fn parses_last_json_line() {
        let out = "some driver noise\n[{\"index\":1,\"name\":\"RTX\",\"kind\":\"discrete\",\"vramMb\":7957,\"uuid\":\"ab\"}]\n";
        let d = parse_listing(out).unwrap();
        assert_eq!(d[0].kind, DeviceKind::Discrete);
        assert_eq!(d[0].vram_mb, 7957);
        assert!(parse_listing("").is_err());
    }
}
