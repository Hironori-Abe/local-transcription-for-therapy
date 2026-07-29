# LoTT patch to Wry 0.54.4

This directory is the crates.io source for Wry 0.54.4 with one Windows-only
privacy change in `src/webview2/mod.rs`.

LoTT sets `CoreWebView2EnvironmentOptions::IsCustomCrashReportingEnabled` to
`true` before creating the WebView2 environment. In WebView2 terminology this
means the host takes responsibility for crash reporting, so Windows does not
automatically send WebView2 crash dumps to Microsoft. LoTT does not collect or
upload those dumps itself.

Remove the `[patch.crates-io]` entry and this vendored copy when upstream Wry or
Tauri exposes an equivalent supported option and LoTT enables it there.

Microsoft reference:
<https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2environmentoptions3>
