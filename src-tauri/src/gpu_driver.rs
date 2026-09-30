//! 「GPU はあるのに使えない」状態（ドライバー未導入・古いドライバー）を見分けて、利用者への案内文を作る。
//!
//! Vulkan で GPU が1つも見つからないときだけ使う。Windows のデバイス管理（SetupAPI）で PCI の
//! 表示装置（クラスコード 03xx）を列挙し、各装置のドライバーの状態を読む。
//! - ドライバーが入っていない GPU は、デバイスマネージャーで「！」が付く（問題コードあり）か、
//!   Windows 標準の「Microsoft 基本ディスプレイ アダプター」（サービス BasicDisplay）で動いている。
//!   ノート PC の2台目の GPU は「ほかのデバイス」（表示クラス以外）に入るため、クラスではなく
//!   PCI のクラスコードで表示装置を見分ける。
//! - ドライバーが入っているのに Vulkan で見つからない場合は、ドライバーが古い可能性が高い。
//!
//! 仮想マシンの表示装置（Hyper-V・VMware など）は案内の対象にしない。

/// 表示装置1台の情報。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisplayAdapter {
    /// デバイスマネージャーに出る名前（ドライバーが無いと「Microsoft 基本ディスプレイ アダプター」など）
    pub name: String,
    /// GPU メーカー（NVIDIA / AMD / Intel 以外は None）
    pub vendor: Option<&'static str>,
    /// ドライバーが入っていない（問題コードあり、または Windows 標準の表示ドライバーで動いている）
    pub driver_missing: bool,
}

/// PCI のハードウェア ID（`PCI\VEN_10DE&DEV_...`）から GPU メーカーを読む。
pub fn vendor_from_hardware_ids(ids: &[String]) -> Option<&'static str> {
    ids.iter().find_map(|id| {
        let upper = id.to_ascii_uppercase();
        let ven = upper.split("VEN_").nth(1)?.get(..4)?.to_string();
        match ven.as_str() {
            "10DE" => Some("NVIDIA"),
            "1002" | "1022" => Some("AMD"),
            "8086" => Some("Intel"),
            _ => None,
        }
    })
}

/// 互換 ID（`PCI\CC_0300` など）から、PCI の表示装置（クラスコード 03）かを判定する。
pub fn is_display_controller(compatible_ids: &[String]) -> bool {
    compatible_ids
        .iter()
        .any(|id| id.to_ascii_uppercase().starts_with("PCI\\CC_03"))
}

/// ドライバーが入っていないかを判定する（問題コードあり、サービス未設定、または BasicDisplay）。
pub fn driver_is_missing(problem_code: u32, service: Option<&str>) -> bool {
    problem_code != 0
        || match service.map(str::trim) {
            None | Some("") => true,
            Some(s) => s.eq_ignore_ascii_case("BasicDisplay"),
        }
}

/// Vulkan で GPU が見つからなかったときの案内文。メーカーの分かる GPU が無ければ None（本当に GPU が無い）。
pub fn driver_hint(adapters: &[DisplayAdapter]) -> Option<String> {
    let gpus: Vec<&DisplayAdapter> = adapters.iter().filter(|a| a.vendor.is_some()).collect();
    let target = gpus
        .iter()
        .find(|a| a.driver_missing)
        .or_else(|| gpus.first())?;
    let vendor = target.vendor.unwrap_or_default();
    // ドライバーが無いときの名前は「Microsoft 基本ディスプレイ アダプター」などで GPU を表さないため、メーカー名で呼ぶ。
    let label = if target.driver_missing || target.name.trim().is_empty() {
        format!("{vendor} の GPU")
    } else {
        target.name.trim().to_string()
    };
    Some(if target.driver_missing {
        format!(
            "{label}が見つかりましたが、ドライバーが入っていないため使えません。\n\
{vendor} の公式サイトから、この GPU 用の最新ドライバーを入れてからアプリを起動し直すと、GPU で速く処理できます。"
        )
    } else {
        format!(
            "{label}が見つかりましたが、GPU での処理（Vulkan）に使えませんでした。ドライバーが古い可能性があります。\n\
{vendor} の公式サイトから最新のドライバーに更新してからアプリを起動し直すと、GPU で速く処理できます。"
        )
    })
}

/// PC の表示装置を列挙する（Windows のみ。ほかの OS では空）。
#[cfg(target_os = "windows")]
pub fn display_adapters() -> Vec<DisplayAdapter> {
    use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
        CM_Get_DevNode_Status, SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInfo,
        SetupDiGetClassDevsW, SetupDiGetDeviceRegistryPropertyW, CR_SUCCESS, DIGCF_ALLCLASSES,
        DIGCF_PRESENT, SPDRP_COMPATIBLEIDS, SPDRP_DEVICEDESC, SPDRP_HARDWAREID, SPDRP_SERVICE,
        SP_DEVINFO_DATA,
    };
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;

    /// REG_SZ / REG_MULTI_SZ のプロパティを文字列の列として読む。
    unsafe fn read_strings(
        set: windows_sys::Win32::Devices::DeviceAndDriverInstallation::HDEVINFO,
        data: &mut SP_DEVINFO_DATA,
        property: u32,
    ) -> Vec<String> {
        let mut buf = vec![0u16; 2048];
        let mut required = 0u32;
        let ok = SetupDiGetDeviceRegistryPropertyW(
            set,
            data,
            property,
            std::ptr::null_mut(),
            buf.as_mut_ptr() as *mut u8,
            (buf.len() * 2) as u32,
            &mut required,
        );
        if ok == 0 {
            return Vec::new();
        }
        let len = (required as usize / 2).min(buf.len());
        buf[..len]
            .split(|c| *c == 0)
            .filter(|s| !s.is_empty())
            .map(String::from_utf16_lossy)
            .collect()
    }

    let enumerator: Vec<u16> = "PCI\0".encode_utf16().collect();
    let mut out = Vec::new();
    // SAFETY: SetupAPI の列挙ハンドルを作り、装置ごとのプロパティを読むだけ。戻る前に破棄する。
    unsafe {
        let set = SetupDiGetClassDevsW(
            std::ptr::null(),
            enumerator.as_ptr(),
            std::ptr::null_mut(),
            DIGCF_PRESENT | DIGCF_ALLCLASSES,
        );
        if set as isize == INVALID_HANDLE_VALUE as isize {
            return out;
        }
        let mut index = 0u32;
        loop {
            let mut data: SP_DEVINFO_DATA = std::mem::zeroed();
            data.cbSize = std::mem::size_of::<SP_DEVINFO_DATA>() as u32;
            if SetupDiEnumDeviceInfo(set, index, &mut data) == 0 {
                break;
            }
            index += 1;
            if !is_display_controller(&read_strings(set, &mut data, SPDRP_COMPATIBLEIDS)) {
                continue;
            }
            let name = read_strings(set, &mut data, SPDRP_DEVICEDESC)
                .into_iter()
                .next()
                .unwrap_or_default();
            let vendor = vendor_from_hardware_ids(&read_strings(set, &mut data, SPDRP_HARDWAREID));
            let service = read_strings(set, &mut data, SPDRP_SERVICE).into_iter().next();
            let mut status = 0u32;
            let mut problem = 0u32;
            let problem = if CM_Get_DevNode_Status(&mut status, &mut problem, data.DevInst, 0)
                == CR_SUCCESS
            {
                problem
            } else {
                0
            };
            out.push(DisplayAdapter {
                name,
                vendor,
                driver_missing: driver_is_missing(problem, service.as_deref()),
            });
        }
        SetupDiDestroyDeviceInfoList(set);
    }
    out
}

#[cfg(not(target_os = "windows"))]
pub fn display_adapters() -> Vec<DisplayAdapter> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|v| v.to_string()).collect()
    }

    /// 実機の表示装置と案内文を表示する: cargo test --lib print_display_adapters -- --ignored --nocapture
    #[test]
    #[ignore]
    fn print_display_adapters() {
        let adapters = display_adapters();
        for adapter in &adapters {
            println!("{adapter:?}");
        }
        println!("hint: {:?}", driver_hint(&adapters));
    }

    #[test]
    fn vendor_and_class_are_read_from_pci_ids() {
        assert_eq!(
            vendor_from_hardware_ids(&ids(&["PCI\\VEN_10DE&DEV_28E0&SUBSYS_0B281028"])),
            Some("NVIDIA")
        );
        assert_eq!(vendor_from_hardware_ids(&ids(&["PCI\\VEN_8086&DEV_A7A0"])), Some("Intel"));
        assert_eq!(vendor_from_hardware_ids(&ids(&["PCI\\VEN_1414&DEV_5353"])), None);
        assert!(is_display_controller(&ids(&["PCI\\VEN_10DE", "PCI\\CC_030200"])));
        assert!(!is_display_controller(&ids(&["PCI\\CC_0403"])));
    }

    #[test]
    fn missing_driver_is_detected_from_problem_code_or_basic_display() {
        assert!(driver_is_missing(28, Some("nvlddmkm")));
        assert!(driver_is_missing(0, Some("BasicDisplay")));
        assert!(driver_is_missing(0, None));
        assert!(!driver_is_missing(0, Some("nvlddmkm")));
    }

    #[test]
    fn hint_prefers_gpu_without_driver_and_ignores_virtual_adapters() {
        let hyperv = DisplayAdapter {
            name: "Microsoft Hyper-V Video".into(),
            vendor: None,
            driver_missing: false,
        };
        assert_eq!(driver_hint(&[hyperv.clone()]), None);

        let intel_ok = DisplayAdapter {
            name: "Intel(R) Arc(TM) Graphics".into(),
            vendor: Some("Intel"),
            driver_missing: false,
        };
        let nvidia_missing = DisplayAdapter {
            name: "Microsoft 基本ディスプレイ アダプター".into(),
            vendor: Some("NVIDIA"),
            driver_missing: true,
        };
        let hint = driver_hint(&[hyperv, intel_ok.clone(), nvidia_missing]).unwrap();
        assert!(hint.starts_with("NVIDIA の GPUが見つかりましたが、ドライバーが入っていない"));

        let old = driver_hint(&[intel_ok]).unwrap();
        assert!(old.starts_with("Intel(R) Arc(TM) Graphicsが見つかりましたが、GPU での処理（Vulkan）"));
    }
}
