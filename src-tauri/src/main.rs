#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // GPU の列挙だけを行う子プロセスとして呼ばれた場合（gpu_select.rs 参照）
    if std::env::args().nth(1).as_deref() == Some(lott_lib::LIST_VULKAN_DEVICES_ARG) {
        lott_lib::print_vulkan_devices();
        return;
    }
    lott_lib::run()
}
