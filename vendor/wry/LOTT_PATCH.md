# LoTT patch to Wry 0.54.4

This directory is the crates.io source for Wry 0.54.4 with the local changes
described below.

LoTT sets `CoreWebView2EnvironmentOptions::IsCustomCrashReportingEnabled` to
`true` before creating the WebView2 environment. In WebView2 terminology this
means the host takes responsibility for crash reporting, so Windows does not
automatically send WebView2 crash dumps to Microsoft. LoTT does not collect or
upload those dumps itself.

Remove the `[patch.crates-io]` entry and this vendored copy when upstream Wry or
Tauri exposes an equivalent supported option and LoTT enables it there, and the
WebKitGTK change below is also available upstream.

On Linux and other WebKitGTK targets, `src/webkitgtk/mod.rs` and
`src/webkitgtk/synthetic_mouse_events.rs` use `evaluate_javascript` instead of
`run_javascript`, deprecated since WebKitGTK 2.40. The new API returns the
JavaScript value directly; evaluation callbacks retain the existing JSON
serialization and empty-string fallback. The default JavaScript world and
source URI remain unchanged. The vendored WebKitGTK dependency enables
`v2_40`, which Tauri already enables through Wry's `linux-body` feature.
Windows WebView2 code is unaffected by this change.

Microsoft reference:
<https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2environmentoptions3>
