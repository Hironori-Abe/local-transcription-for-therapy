use encoding_rs::SHIFT_JIS;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use zip::{write::FileOptions, CompressionMethod, ZipWriter};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

struct LemonadeServer {
    child: Arc<Mutex<Option<Child>>>,
    /// 実際にサーバーが listen しているポート番号。0 は未解決。
    port: Arc<AtomicU32>,
    /// 起動中のバックエンドモード: 0=lemonade(lemond), 1=llama_server_cuda
    mode: Arc<AtomicU8>,
    /// CUDA llama-server 起動時に決めた並列スロット数 (-np)。
    /// 校正サイドカーの --parallel をこれと一致させ、継続バッチングの同時送信数を揃える。
    parallel: Arc<AtomicU8>,
}

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

/// アプリ固有の lemond が listen しているかを確認する。port=0 は常に false。
fn lemonade_app_port_open(port: u16) -> bool {
    if port == 0 {
        return false;
    }
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}").parse().unwrap(),
        Duration::from_millis(500),
    )
    .is_ok()
}

/// アプリ固有 lemond に割り当てるポートを決定する。
/// 優先順: 既存 config.json のポート（空きなら再利用）→ OS が割り当てた空きポート。
fn resolve_lemonade_port(cache_dir: &Path) -> u16 {
    // 既存の config.json からポートを読み取る
    let config_path = cache_dir.join("config.json");
    if let Ok(s) = std::fs::read_to_string(&config_path) {
        if let Ok(v) = serde_json::from_str::<Value>(&s) {
            if let Some(p) = v["port"].as_u64().filter(|&p| p > 1024 && p < 65535) {
                let port = p as u16;
                // そのポートが空いていれば再利用（再起動時の安定性）
                if !lemonade_app_port_open(port) {
                    return port;
                }
            }
        }
    }
    // OS に空きポートを割り当ててもらう（衝突回避）
    std::net::TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
        .unwrap_or(13306)
}

/// 外部 LLM アプリ（LM Studio / Ollama）との OpenAI 互換 API 連携が有効か。
/// 既定は無効（フェイルクローズ）。`%LOCALAPPDATA%\{identifier}\external-llm-policy.txt`
/// の内容が `enabled` のときだけ有効化する。このマーカーはインストール時の明示オプトインで
/// のみ書き込まれ、アプリ内に再有効化トグルは設けない（完全ロック）。
fn external_llm_enabled(app: &AppHandle) -> bool {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|d| d.join("external-llm-policy.txt"))
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.trim() == "enabled")
        .unwrap_or(false)
}

/// openai_compatible バックエンド利用時、連携が無効ならエラーメッセージを返す。
const EXTERNAL_LLM_DISABLED_MESSAGE: &str =
    "この構成では外部LLMアプリ（LM Studio / Ollama）連携が無効化されています。";

fn validate_local_openai_base_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/').to_string();
    if trimmed.is_empty() {
        return Err("ローカルOpenAI互換APIの Base URL が未指定です。".to_string());
    }
    if trimmed.contains('?') || trimmed.contains('#') {
        return Err("ローカルOpenAI互換APIの Base URL にはクエリ文字列やフラグメントを含めないでください。".to_string());
    }
    let rest = trimmed
        .strip_prefix("http://")
        .ok_or_else(|| "ローカルOpenAI互換APIの Base URL は http:// で始まる必要があります。".to_string())?;
    let authority = rest
        .split('/')
        .next()
        .unwrap_or("")
        .trim();
    if authority.is_empty() || authority.contains('@') {
        return Err("ローカルOpenAI互換APIの Base URL のホスト指定が不正です。".to_string());
    }
    let host = if let Some(after_bracket) = authority.strip_prefix('[') {
        after_bracket
            .split(']')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
    } else {
        authority
            .split(':')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
    };
    if !is_loopback_local_openai_host(&host) {
        return Err("外部送信防止のため、ローカルOpenAI互換APIは localhost / 127.x.x.x / ::1 のみ指定できます。".to_string());
    }
    Ok(trimmed)
}

fn is_loopback_local_openai_host(host: &str) -> bool {
    if host == "localhost" || host == "::1" {
        return true;
    }
    let parts: Vec<&str> = host.split('.').collect();
    parts.len() == 4
        && parts[0] == "127"
        && parts.iter().all(|part| part.parse::<u8>().is_ok())
}

struct LocalOpenAiHttpTarget {
    host: String,
    authority: String,
    port: u16,
    path_prefix: String,
}

#[derive(Clone, Debug)]
struct OpenAiUnloadTarget {
    host: String,
    authority: String,
    port: u16,
    path_prefix: String,
    server_type: String, // "LM Studio" | "ollama" | その他（アンロードしない）
    model_id: String,
}

impl OpenAiUnloadTarget {
    fn as_http_target(&self) -> LocalOpenAiHttpTarget {
        LocalOpenAiHttpTarget {
            host: self.host.clone(),
            authority: self.authority.clone(),
            port: self.port,
            path_prefix: self.path_prefix.clone(),
        }
    }
}

#[derive(Clone)]
struct OpenAiUnloadState(Arc<Mutex<Option<OpenAiUnloadTarget>>>);

impl Default for OpenAiUnloadState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(None)))
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalOpenAiModelsRequest {
    base_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalOpenAiModelsResponse {
    server_name: String,
    models: Vec<String>,
}

fn parse_local_openai_http_target(raw: &str) -> Result<LocalOpenAiHttpTarget, String> {
    let normalized = validate_local_openai_base_url(raw)?;
    let rest = normalized
        .strip_prefix("http://")
        .ok_or_else(|| "ローカルOpenAI互換APIの Base URL が不正です。".to_string())?;
    let mut parts = rest.splitn(2, '/');
    let authority = parts.next().unwrap_or("").to_string();
    let raw_path = parts.next().unwrap_or("");

    let (host, port) = if let Some(after_bracket) = authority.strip_prefix('[') {
        let host = after_bracket
            .split(']')
            .next()
            .unwrap_or("")
            .to_string();
        let tail = authority.split(']').nth(1).unwrap_or("");
        let port = if tail.is_empty() {
            80
        } else {
            let raw_port = tail
                .strip_prefix(':')
                .ok_or_else(|| "ローカルOpenAI互換APIのポート指定が不正です。".to_string())?;
            raw_port
                .parse::<u16>()
                .map_err(|_| "ローカルOpenAI互換APIのポート指定が不正です。".to_string())?
        };
        (host, port)
    } else {
        let mut host_port = authority.splitn(2, ':');
        let host = host_port.next().unwrap_or("").to_string();
        let port = if let Some(raw_port) = host_port.next() {
            raw_port
                .parse::<u16>()
                .map_err(|_| "ローカルOpenAI互換APIのポート指定が不正です。".to_string())?
        } else {
            80
        };
        (host, port)
    };

    if host.is_empty() {
        return Err("ローカルOpenAI互換APIのホスト指定が不正です。".to_string());
    }
    let path_prefix = raw_path.trim_matches('/').to_string();
    Ok(LocalOpenAiHttpTarget {
        host,
        authority,
        port,
        path_prefix,
    })
}

fn local_openai_endpoint_path(path_prefix: &str, suffix: &str) -> String {
    let suffix = suffix.trim_matches('/');
    if path_prefix.is_empty() {
        return format!("/v1/{suffix}");
    }
    if path_prefix == "v1" || path_prefix.ends_with("/v1") {
        format!("/{path_prefix}/{suffix}")
    } else {
        format!("/{path_prefix}/v1/{suffix}")
    }
}

fn decode_chunked_http_body(body: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoded = Vec::new();
    let mut pos = 0;
    while pos < body.len() {
        let Some(line_end_rel) = body[pos..].windows(2).position(|w| w == b"\r\n") else {
            return Err("chunked レスポンスの解析に失敗しました。".to_string());
        };
        let line_end = pos + line_end_rel;
        let size_line = String::from_utf8_lossy(&body[pos..line_end]);
        let size_hex = size_line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_hex, 16)
            .map_err(|_| "chunked レスポンスのサイズ解析に失敗しました。".to_string())?;
        pos = line_end + 2;
        if size == 0 {
            break;
        }
        if pos + size > body.len() {
            return Err("chunked レスポンスが途中で終了しました。".to_string());
        }
        decoded.extend_from_slice(&body[pos..pos + size]);
        pos += size + 2;
    }
    Ok(decoded)
}

fn local_openai_http_get_json(
    target: &LocalOpenAiHttpTarget,
    path: &str,
    timeout: Duration,
) -> Result<(String, Value), String> {
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let addr = (target.host.as_str(), target.port)
        .to_socket_addrs()
        .map_err(|e| format!("ローカルOpenAI互換APIのアドレス解決に失敗しました: {e}"))?
        .next()
        .ok_or_else(|| "ローカルOpenAI互換APIの接続先を解決できませんでした。".to_string())?;
    let mut stream = TcpStream::connect_timeout(&addr, timeout)
        .map_err(|e| format!("ローカルOpenAI互換APIに接続できませんでした: {e}"))?;
    let _ = stream.set_read_timeout(Some(timeout));
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {}\r\nAccept: application/json\r\nConnection: close\r\n\r\n",
        target.authority
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("ローカルOpenAI互換APIへのリクエスト送信に失敗しました: {e}"))?;
    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|e| format!("ローカルOpenAI互換APIのレスポンス取得に失敗しました: {e}"))?;

    let header_end = response
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| "ローカルOpenAI互換APIのHTTPレスポンスが不正です。".to_string())?;
    let header_bytes = &response[..header_end];
    let body_bytes = &response[header_end + 4..];
    let headers = String::from_utf8_lossy(header_bytes);
    let status_line = headers.lines().next().unwrap_or("");
    if !status_line.contains(" 200 ") {
        return Err(format!("モデル一覧取得に失敗しました: {status_line}"));
    }
    let body = if headers.to_ascii_lowercase().contains("transfer-encoding: chunked") {
        decode_chunked_http_body(body_bytes)?
    } else {
        body_bytes.to_vec()
    };
    let json: Value = serde_json::from_slice(&body)
        .map_err(|e| format!("モデル一覧レスポンスのJSON解析に失敗しました: {e}"))?;
    Ok((headers.to_string(), json))
}

/// POST リクエストを送る（レスポンスボディは不要）
fn local_openai_http_post_json_body(
    target: &LocalOpenAiHttpTarget,
    path: &str,
    body: &str,
    timeout: Duration,
) -> Result<(), String> {
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let addr = (target.host.as_str(), target.port)
        .to_socket_addrs()
        .map_err(|e| format!("アドレス解決に失敗: {e}"))?
        .next()
        .ok_or_else(|| "接続先を解決できませんでした。".to_string())?;
    let mut stream = TcpStream::connect_timeout(&addr, timeout)
        .map_err(|e| format!("接続に失敗: {e}"))?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let body_bytes = body.as_bytes();
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        target.authority,
        body_bytes.len(),
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("リクエスト送信に失敗: {e}"))?;
    stream
        .write_all(body_bytes)
        .map_err(|e| format!("リクエストボディ送信に失敗: {e}"))?;
    let mut buf = [0u8; 512];
    let _ = stream.read(&mut buf);
    Ok(())
}


/// POST リクエストを送り、レスポンスボディを JSON として返す。
fn local_openai_http_post_json_with_response(
    target: &LocalOpenAiHttpTarget,
    path: &str,
    body: &str,
    timeout: Duration,
) -> Result<Value, String> {
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let addr = (target.host.as_str(), target.port)
        .to_socket_addrs()
        .map_err(|e| format!("アドレス解決に失敗: {e}"))?
        .next()
        .ok_or_else(|| "接続先を解決できませんでした。".to_string())?;
    let mut stream = TcpStream::connect_timeout(&addr, timeout)
        .map_err(|e| format!("接続に失敗: {e}"))?;
    let _ = stream.set_read_timeout(Some(timeout));
    let body_bytes = body.as_bytes();
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        target.authority,
        body_bytes.len(),
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("リクエスト送信に失敗: {e}"))?;
    stream
        .write_all(body_bytes)
        .map_err(|e| format!("リクエストボディ送信に失敗: {e}"))?;
    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|e| format!("レスポンス取得に失敗: {e}"))?;
    let header_end = response
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| "HTTP レスポンスが不正です。".to_string())?;
    let header_bytes = &response[..header_end];
    let body_bytes = &response[header_end + 4..];
    let headers = String::from_utf8_lossy(header_bytes);
    let status_line = headers.lines().next().unwrap_or("");
    let status_code = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(0);
    if !(200..300).contains(&status_code) {
        let body_str = String::from_utf8_lossy(body_bytes);
        return Err(format!("リクエストに失敗しました: {status_line} | body: {body_str}"));
    }
    let body_decoded = if headers.to_ascii_lowercase().contains("transfer-encoding: chunked") {
        decode_chunked_http_body(body_bytes)?
    } else {
        body_bytes.to_vec()
    };
    serde_json::from_slice(&body_decoded)
        .map_err(|e| format!("JSON 解析に失敗しました: {e}"))
}

/// LM Studio に /api/v1/models/load でモデルをロードする。
/// 戻り値: Ok((instance_id, newly_loaded))
///   newly_loaded = load_time_seconds > 0 → 今回新たにロードした
///   newly_loaded = false → 既にロード済みだった
/// ロード API の呼び出し自体が失敗した場合は Err を返す。
fn lmstudio_load_model(
    target: &LocalOpenAiHttpTarget,
    model_id: &str,
) -> Result<(String, bool), String> {
    let body = serde_json::json!({
        "model": model_id,
        "context_length": 16384
    })
    .to_string();
    let response = local_openai_http_post_json_with_response(
        target,
        "/api/v1/models/load",
        &body,
        Duration::from_secs(120),
    )?;
    let instance_id = response
        .get("instance_id")
        .and_then(Value::as_str)
        .unwrap_or(model_id)
        .to_string();
    let load_time = response
        .get("load_time_seconds")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let newly_loaded = load_time > 0.0;
    Ok((instance_id, newly_loaded))
}

/// Ollama の /api/ps に表示されるモデル名と指定モデル名が一致するか判定。
/// "llama3" と "llama3:latest" のようなタグなし指定を考慮する。
fn ollama_model_name_matches(ps_name: &str, target: &str) -> bool {
    if ps_name == target {
        return true;
    }
    let ps_base = ps_name.split(':').next().unwrap_or(ps_name);
    let tgt_base = target.split(':').next().unwrap_or(target);
    ps_base == tgt_base
}

/// Ollama の /api/ps で現在メモリにロードされているか確認する。
fn ollama_model_already_running(target: &LocalOpenAiHttpTarget, model_id: &str) -> bool {
    let Ok((_, ps_json)) = local_openai_http_get_json(target, "/api/ps", Duration::from_secs(3))
    else {
        return false;
    };
    ps_json
        .get("models")
        .and_then(Value::as_array)
        .map(|models| {
            models.iter().any(|m| {
                let name = m.get("name").and_then(Value::as_str).unwrap_or("");
                ollama_model_name_matches(name, model_id)
            })
        })
        .unwrap_or(false)
}

/// 校正開始前にモデルをロードし、アンロード対象情報を返す。
/// - LM Studio: /api/v1/models/load で明示ロードし、返却された instance_id を記録する。
///              既にロード済みなら他アプリが使っている可能性があるためスキップ。
/// - Ollama   : 未ロードの場合のみアンロード対象として記録（推論リクエストで自動ロード）。
/// - Lemonade : 常にアンロード対象として記録。
/// 返り値が Some → 自分がロードした（完了・中止・終了時にアンロードする）。
/// 返り値が None → 既にロード済み or 不明なサーバー（アンロードしない）。
fn prepare_openai_unload_info(
    base_url: &str,
    model_id: &str,
    app: &tauri::AppHandle,
) -> Option<OpenAiUnloadTarget> {
    let target = parse_local_openai_http_target(base_url).ok()?;
    let path = local_openai_endpoint_path(&target.path_prefix, "models");
    let (headers, models_json) =
        local_openai_http_get_json(&target, &path, Duration::from_secs(3)).ok()?;
    let server_type = detect_local_openai_server_name(&target, &models_json, &headers);

    match server_type.as_str() {
        "LM Studio" => {
            emit_progress(app, "llm_sidecar_start", "LM Studio モデルをロード中...", None);
            match lmstudio_load_model(&target, model_id) {
                Ok((instance_id, true)) => {
                    Some(OpenAiUnloadTarget {
                        host: target.host,
                        authority: target.authority,
                        port: target.port,
                        path_prefix: target.path_prefix,
                        server_type,
                        model_id: instance_id,
                    })
                }
                Ok((_, false)) => None,
                Err(e) => {
                    emit_progress(
                        app,
                        "llm_sidecar_start",
                        &format!(
                            "⚠ LM Studio のモデル「{model_id}」が見つかりません。設定タブでモデル名を確認してください。（詳細: {e}）"
                        ),
                        None,
                    );
                    None
                }
            }
        }
        "ollama" => {
            if ollama_model_already_running(&target, model_id) {
                return None;
            }
            Some(OpenAiUnloadTarget {
                host: target.host,
                authority: target.authority,
                port: target.port,
                path_prefix: target.path_prefix,
                server_type,
                model_id: model_id.to_string(),
            })
        }
        "lemonade" => Some(OpenAiUnloadTarget {
            host: target.host,
            authority: target.authority,
            port: target.port,
            path_prefix: target.path_prefix,
            server_type,
            model_id: model_id.to_string(),
        }),
        _ => None, // 不明なサーバーはアンロードしない
    }
}

/// lemonade unload CLI を実行してモデルをメモリから解放する（失敗しても無視）。
/// snap 版 (/snap/bin/lemonade) → PATH 上の lemonade の順で試みる。
fn try_unload_lemonade_cli(port: u16) {
    for candidate in &["/snap/bin/lemonade", "lemonade"] {
        let mut cmd = Command::new(candidate);
        apply_windows_no_window(&mut cmd);
        if port > 0 {
            cmd.env("LEMONADE_PORT", port.to_string());
        }
        if let Ok(mut child) = cmd.arg("unload").stdout(Stdio::null()).stderr(Stdio::null()).spawn() {
            let _ = child.wait();
            return;
        }
    }
}

/// アンロードリクエストを送信する（失敗しても無視）。
fn try_unload_openai_model(unload: &OpenAiUnloadTarget, lemonade_port: u16) {
    let target = unload.as_http_target();
    match unload.server_type.as_str() {
        "ollama" => {
            // POST /api/chat with messages:[] and keep_alive:0
            let body = serde_json::json!({
                "model": unload.model_id,
                "messages": [],
                "keep_alive": 0
            })
            .to_string();
            let _ = local_openai_http_post_json_body(
                &target,
                "/api/chat",
                &body,
                Duration::from_secs(5),
            );
        }
        "LM Studio" => {
            // POST /api/v1/models/unload with instance_id（LM Studio 公式 API）
            let body = serde_json::json!({
                "instance_id": unload.model_id
            })
            .to_string();
            let _ = local_openai_http_post_json_body(
                &target,
                "/api/v1/models/unload",
                &body,
                Duration::from_secs(5),
            );
        }
        "lemonade" => {
            try_unload_lemonade_cli(lemonade_port);
        }
        _ => {}
    }
}

fn detect_local_openai_server_name(
    target: &LocalOpenAiHttpTarget,
    models_json: &Value,
    models_headers: &str,
) -> String {
    let lower_headers = models_headers.to_ascii_lowercase();
    if lower_headers.contains("ollama") {
        return "ollama".to_string();
    }
    if lower_headers.contains("llama.cpp") || lower_headers.contains("llamacpp") {
        return "llama.cpp".to_string();
    }
    if lower_headers.contains("lm studio") || lower_headers.contains("lmstudio") {
        return "LM Studio".to_string();
    }

    if let Some(data) = models_json.get("data").and_then(Value::as_array) {
        for item in data {
            let owned_by = item
                .get("owned_by")
                .or_else(|| item.get("ownedBy"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_ascii_lowercase();
            if owned_by.contains("ollama") {
                return "ollama".to_string();
            }
            if owned_by.contains("llama.cpp") || owned_by.contains("llamacpp") {
                return "llama.cpp".to_string();
            }
            if owned_by.contains("lm studio") || owned_by.contains("lmstudio") {
                return "LM Studio".to_string();
            }
        }
    }

    if target.port == 11434 {
        return "ollama".to_string();
    }
    if target.port == 1234 {
        return "LM Studio".to_string();
    }

    if let Ok((_, version_json)) =
        local_openai_http_get_json(target, "/api/version", Duration::from_secs(2))
    {
        if version_json.get("version").is_some() {
            return "ollama".to_string();
        }
    }
    if let Ok((_, props_json)) = local_openai_http_get_json(target, "/props", Duration::from_secs(2)) {
        if props_json.get("default_generation_settings").is_some()
            || props_json.get("model_path").is_some()
            || props_json.get("total_slots").is_some()
        {
            return "llama.cpp".to_string();
        }
    }
    if let Ok((_, lmstudio_json)) =
        local_openai_http_get_json(target, "/api/v0/models", Duration::from_secs(2))
    {
        if lmstudio_json.get("data").and_then(Value::as_array).is_some() {
            return "LM Studio".to_string();
        }
    }

    "local".to_string()
}

#[tauri::command]
fn list_local_openai_models(
    app: AppHandle,
    request: LocalOpenAiModelsRequest,
) -> Result<LocalOpenAiModelsResponse, String> {
    if !external_llm_enabled(&app) {
        return Err(EXTERNAL_LLM_DISABLED_MESSAGE.to_string());
    }
    let target = parse_local_openai_http_target(&request.base_url)?;
    let path = local_openai_endpoint_path(&target.path_prefix, "models");
    let (headers, json) = local_openai_http_get_json(&target, &path, Duration::from_secs(10))?;
    let server_name = detect_local_openai_server_name(&target, &json, &headers);
    let models = json
        .get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.get("id")
                        .or_else(|| item.get("name"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(LocalOpenAiModelsResponse {
        server_name,
        models,
    })
}

// バンドルされた Lemonade バイナリを探す（ポータブル/オフライン専用、PATH・Program Files は参照しない）
fn find_lemonade_bundled_bin(app: &AppHandle) -> Option<String> {
    let path_api = app.path();
    let mut search_dirs: Vec<PathBuf> = Vec::new();

    // resource_dir: dev では target/debug 配下(executable_dir 相当)に解決され、
    // リソースは未コピーのため dev では当てにならない。NSIS production = $INSTDIR/
    if let Ok(rd) = path_api.resource_dir() {
        search_dirs.push(rd.join("resources").join("lemonade"));
        search_dirs.push(rd.join("lemonade"));
    }

    // executable_dir: dev = target/debug/, NSIS production = $INSTDIR/
    if let Ok(ed) = path_api.executable_dir() {
        search_dirs.push(ed.join("resources").join("lemonade"));
        search_dirs.push(ed.join("lemonade"));
        // ポータブル ZIP 展開時の _up_ パス
        search_dirs.push(ed.join("_up_").join("resources").join("lemonade"));
        search_dirs.push(ed.join("_up_").join("lemonade"));
    }

    // dev ビルドではリソースが target/debug 配下にコピーされず resource_dir() / executable_dir()
    // からも解決できないため、ソースツリーの src-tauri/resources/lemonade を直接参照する。
    // これにより AMD dev でも同梱 lemond が見つかり、Lemonade(rocm/vulkan) 経路で AI 校正が動く。
    // find_bundled_llama_server_bin と同じ方式。cfg(debug_assertions) ガードのため
    // リリース挙動・配布物・ライセンス前提は不変で、NVIDIA リリースにも影響しない。
    #[cfg(debug_assertions)]
    search_dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("lemonade"));

    let exe = std::env::consts::EXE_SUFFIX;
    for dir in &search_dirs {
        // lemond(.exe) = lemonade daemon (embeddable版のサーバー本体)
        // lemonade-server(.exe) = 旧来のスタンドアロンサーバー (MSIインストール版)
        for stem in &["lemonade-server", "lemond"] {
            let path = dir.join(format!("{stem}{exe}"));
            if path.exists() {
                return Some(path.to_string_lossy().into_owned());
            }
        }
    }
    None
}

// バンドルされた Lemonade CLI バイナリを探す（status 取得用）
fn find_lemonade_cli_bin(app: &AppHandle) -> Option<String> {
    let path_api = app.path();
    let mut search_dirs: Vec<PathBuf> = Vec::new();

    if let Ok(rd) = path_api.resource_dir() {
        search_dirs.push(rd.join("resources").join("lemonade"));
        search_dirs.push(rd.join("lemonade"));
    }

    if let Ok(ed) = path_api.executable_dir() {
        search_dirs.push(ed.join("resources").join("lemonade"));
        search_dirs.push(ed.join("lemonade"));
        search_dirs.push(ed.join("_up_").join("resources").join("lemonade"));
        search_dirs.push(ed.join("_up_").join("lemonade"));
    }

    // dev ビルド用ソースツリー fallback（find_lemonade_bundled_bin と同じ理由・同じガード）。
    #[cfg(debug_assertions)]
    search_dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("lemonade"));

    let exe = std::env::consts::EXE_SUFFIX;
    for dir in &search_dirs {
        let path = dir.join(format!("lemonade{exe}"));
        if path.exists() {
            return Some(path.to_string_lossy().into_owned());
        }
    }
    None
}

/// バンドルされた llama-server バイナリのパスを返す。
/// resources/llama-server/llama-server(.exe) を探す。
fn find_bundled_llama_server_bin(app: &AppHandle) -> Option<String> {
    let path_api = app.path();
    let mut search_dirs: Vec<PathBuf> = Vec::new();

    if let Ok(rd) = path_api.resource_dir() {
        search_dirs.push(rd.join("resources").join("llama-server"));
        search_dirs.push(rd.join("llama-server"));
    }

    if let Ok(ed) = path_api.executable_dir() {
        search_dirs.push(ed.join("resources").join("llama-server"));
        search_dirs.push(ed.join("llama-server"));
        search_dirs.push(ed.join("_up_").join("resources").join("llama-server"));
        search_dirs.push(ed.join("_up_").join("llama-server"));
    }

    // dev ビルドではリソースが target/debug 配下にコピーされず resource_dir() からも
    // 解決できないため、ソースツリーの src-tauri/resources/llama-server を直接参照する。
    // これにより NVIDIA dev でも CUDA 版 llama-server が見つかり、Lemonade(vulkan) 経路を
    // 介さず CUDA で AI 校正が動く。cfg(debug_assertions) ガードのためリリース挙動・配布物・
    // ライセンス前提は不変で、AMD リリースにも影響しない。
    #[cfg(debug_assertions)]
    search_dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("llama-server"));

    let exe = std::env::consts::EXE_SUFFIX;
    for dir in &search_dirs {
        let path = dir.join(format!("llama-server{exe}"));
        if path.exists() {
            return Some(path.to_string_lossy().into_owned());
        }
    }
    None
}

/// lemond が `lemonade backends install llamacpp:vulkan` で取得した Vulkan ビルドの
/// llama-server バイナリを探す（`~/.cache/{app-id}/lemonade/bin/llamacpp/vulkan/llama-server`）。
/// AMD で 12B + MTP を直起動するために使う。rocm-stable ビルドは古くドラフトの
/// `gemma4-assistant` を認識できないため、MTP には新しい Vulkan ビルドを用いる。
fn find_lemonade_vulkan_llama_server(app: &AppHandle) -> Option<String> {
    let cache = get_lemonade_app_cache_dir(app)?;
    let exe = std::env::consts::EXE_SUFFIX;
    let path = cache
        .join("bin")
        .join("llamacpp")
        .join("vulkan")
        .join(format!("llama-server{exe}"));
    if path.exists() {
        Some(path.to_string_lossy().into_owned())
    } else {
        None
    }
}

/// lemond がダウンロードした ROCm ビルドの llama-server を返す（Vulkan 版の対）。
/// AMD の 12B + MTP 高速経路で使う。
fn find_lemonade_rocm_llama_server(app: &AppHandle) -> Option<String> {
    let cache = get_lemonade_app_cache_dir(app)?;
    let exe = std::env::consts::EXE_SUFFIX;
    let path = cache
        .join("bin")
        .join("llamacpp")
        .join("rocm-stable")
        .join(format!("llama-server{exe}"));
    if path.exists() {
        Some(path.to_string_lossy().into_owned())
    } else {
        None
    }
}

/// ROCm ビルドがドラフト arch `gemma4-assistant`（MTP）を解釈できるかを、同梱
/// `libllama.so.0.0.<build>` のビルド番号で判定する。b9247 は非対応・b9585 以降が対応
/// （実機確認）。既知良好値の閾値 9585 を使う。旧ビルドなら ROCm 経路を選ばず Vulkan へ。
fn rocm_build_supports_gemma4_assistant(bin_path: &str) -> bool {
    let Some(dir) = PathBuf::from(bin_path).parent().map(|p| p.to_path_buf()) else {
        return false;
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        // 例: libllama.so.0.0.9630
        if let Some(rest) = name.strip_prefix("libllama.so.0.0.") {
            if let Ok(build) = rest.parse::<u32>() {
                return build >= 9585;
            }
        }
    }
    false
}

fn llama_server_supports_mtp(bin_path: &str) -> bool {
    let mut cmd = Command::new(bin_path);
    apply_windows_no_window(&mut cmd);
    match cmd.arg("--help").stdout(Stdio::piped()).stderr(Stdio::piped()).output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            stdout.contains("draft-mtp") || stderr.contains("draft-mtp")
        }
        Err(_) => false,
    }
}

/// フロントエンドが「VRAM不足 → 並列処理数を下げて再試行」ダイアログを出すか判定するための
/// エラーメッセージ先頭マーカー。Rust 側で OOM を検出したときだけ付与する。
const VRAM_OOM_MARKER: &str = "[VRAM_OOM]";

/// llama-server / CUDA / sidecar の出力テキストが VRAM 不足（OOM）を示すかを判定する。
/// 起動時 stderr・推論時 sidecar 出力の双方に使う。誤検出を避けるため OOM 特有の語に絞る。
fn text_indicates_vram_oom(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    const MARKERS: &[&str] = &[
        "out of memory",
        "failed to allocate",
        "cudamalloc",
        "cudaerrormemoryallocation",
        "ggml_backend_cuda_buffer_type_alloc",
    ];
    MARKERS.iter().any(|m| lower.contains(m))
}

/// ROCm 直起動の失敗を示すかを判定する。VRAM 不足に加え、対象 GPU arch の rocBLAS
/// Tensile カーネル欠如・HIP/HSA 初期化失敗なども拾う。これを検出したら ROCm 起動を
/// 失敗扱いにして Vulkan へフォールバックする。
fn text_indicates_rocm_failure(text: &str) -> bool {
    if text_indicates_vram_oom(text) {
        return true;
    }
    let lower = text.to_ascii_lowercase();
    const MARKERS: &[&str] = &[
        "rocblas error",
        "tensilelibrary",
        "no such file or directory for gpu arch",
        "hip error",
        "hsa_status_error",
        "no rocm-capable device",
    ];
    MARKERS.iter().any(|m| lower.contains(m))
}

/// stderr/stdout が VRAM 不足を示す場合のみ、エラーメッセージ先頭に OOM マーカーを付ける。
/// 既にマーカー付きならそのまま返す。
fn tag_vram_oom_if_present(message: String, stdout: &str, stderr: &str) -> String {
    if message.contains(VRAM_OOM_MARKER) {
        return message;
    }
    if text_indicates_vram_oom(stderr) || text_indicates_vram_oom(stdout) {
        format!("{VRAM_OOM_MARKER} {message}")
    } else {
        message
    }
}

/// 検出した VRAM（MiB）とユーザー上書きから、CUDA llama-server の並列スロット数 (-np) と
/// 総コンテキスト長 (--ctx-size) を決める。
/// - `override_np` が Some(>=1) ならユーザー指定を優先（auto は None / Some(0)）。
/// - `override_ctx` が Some(>=4096) ならコンテキスト長をユーザー指定で固定（auto は None / Some(0)）。
/// - np auto は VRAM 階層で決定: 12GB+(11000)→4 / 8GB+(7000)→2 / それ未満（6GB 等）→1。
///   12GB(12288MiB)・16GB はともに np=4、8GB ノート(8188MiB)は np=2。
///   手動指定は最大 24。OOM 時はフロント側が段階的（24→20→16→12→8→4→2→1）に下げて再試行する。
/// - ctx auto は 1 スロット ~8192 トークン確保（最低 16384・上限 32768）。kv_unified で全スロット共有。
fn choose_llm_parallelism(
    vram_mib: u64,
    override_np: Option<u32>,
    override_ctx: Option<u32>,
) -> (u32, u32) {
    let np = match override_np {
        Some(n) if n >= 1 => n.min(24),
        _ => {
            if vram_mib >= 11000 {
                4
            } else if vram_mib >= 7000 {
                2
            } else {
                1
            }
        }
    };
    let ctx = match override_ctx {
        Some(c) if c >= 4096 => c.min(131072),
        _ => (np * 8192).max(16384).min(32768),
    };
    (np, ctx)
}

/// llama-server.exe を CUDA モードで起動する。
/// GGUF モデルをモデルパスから直接ロードし、OpenAI 互換 API を提供する。
/// `n_parallel` は並列スロット数 (-np)、`ctx_size` は総コンテキスト長 (--ctx-size)。
/// `autofit` が true なら `--fit on`（auto-fit）で起動し `-ngl` を指定しない。
/// llama.cpp が VRAM に収まる範囲で本体・MTP ドラフトを GPU へ自動配置し、収まらない分は
/// CPU へ逃がす。12B の gemma4-assistant ドラフトは `-ngl` 明示（auto-fit 無効）下で GPU へ
/// オフロードするとロードに失敗するが、auto-fit 有効なら GPU に載っても正常に動く。
/// false（E4B 既定）なら従来どおり `-ngl 99`（本体全 GPU）+ `--spec-draft-ngl 99`（ドラフトも GPU）。
fn try_start_llama_server_cuda(
    bin_path: &str,
    model_path: &str,
    mtp_model_path: Option<&str>,
    port: u16,
    n_parallel: u32,
    ctx_size: u32,
    device_index: Option<i32>,
    autofit: bool,
) -> Result<(Child, Arc<AtomicBool>), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(bin_path) {
            let mode = meta.permissions().mode();
            if mode & 0o100 == 0 {
                let mut perms = meta.permissions();
                perms.set_mode(mode | 0o755);
                let _ = std::fs::set_permissions(bin_path, perms);
            }
        }
    }
    let mut cmd = Command::new(bin_path);
    apply_windows_no_window(&mut cmd);
    // 同梱 CUDA DLL を優先して読み込めるよう、バイナリのあるディレクトリを PATH 先頭に追加する
    if let Some(bin_dir) = PathBuf::from(bin_path).parent() {
        if bin_dir.exists() {
            let current_path = env::var("PATH").unwrap_or_default();
            #[cfg(target_os = "windows")]
            let sep = ";";
            #[cfg(not(target_os = "windows"))]
            let sep = ":";
            cmd.env("PATH", format!("{}{sep}{current_path}", bin_dir.display()));
        }
    }
    // 選択された NVIDIA GPU（llmHipDeviceIndex / nvidia-smi index）のみを見せる。
    // PCI_BUS_ID 順で nvidia-smi の index と一致させる。明示選択(>=0)のときだけ限定し、
    // 未指定(None/-1)は llama.cpp 既定（複数 GPU 時はレイヤー分割）を保つ。
    cmd.env("CUDA_DEVICE_ORDER", "PCI_BUS_ID");
    if let Some(idx) = device_index.filter(|&i| i >= 0) {
        cmd.env("CUDA_VISIBLE_DEVICES", idx.to_string());
    }
    let ctx_s = ctx_size.to_string();
    let np_s = n_parallel.to_string();
    let port_s = port.to_string();
    // FlashAttention の選択:
    // MTP ドラフト併用時は CUDA FlashAttention カーネル (ggml-cuda/fattn.cu:110) が
    // 一部 GPU/ビルドで致命的に落ち、サーバがポートを開く前にクラッシュする
    // （RTX 4060 Laptop + 同梱 llama.cpp build 9571 で確認。--flash-attn auto でも同様）。
    // そのため MTP 配線時は off にする（MTP の投機的デコードは維持）。
    // MTP 非併用時は従来どおり on（KV キャッシュ/VRAM 節約のため）。
    let flash_attn = if mtp_model_path.is_some() { "off" } else { "on" };
    cmd.arg("-m").arg(model_path).arg("--port").arg(&port_s);
    if autofit {
        // auto-fit: VRAM に収まる分だけ GPU、残りは CPU へ自動配置（-ngl は指定しない）。
        // 12B の gemma4-assistant ドラフトを GPU に載せても auto-fit 経由なら落ちない。
        cmd.arg("--fit").arg("on");
    } else {
        cmd.arg("-ngl").arg("99"); // 本体の全レイヤーを GPU へオフロード（E4B 既定）
    }
    cmd.arg("--ctx-size")
        .arg(&ctx_s) // 総コンテキスト長（VRAM 階層で自動 or ユーザー上書き）
        .arg("--flash-attn")
        .arg(flash_attn)
        .arg("-np")
        .arg(&np_s) // 並列スロット数（継続バッチングで GPU のアイドル時間を埋める）
        .arg("--host")
        .arg("127.0.0.1"); // ローカルループバックのみ
    if let Some(mtp_path) = mtp_model_path {
        // draft 側 KV キャッシュは既定 (f16) のまま指定しない
        // （MTP ヘッドは小さく KV も小さいため、量子化の節約効果はほぼない）。
        cmd.arg("--spec-type")
            .arg("draft-mtp")
            .arg("--spec-draft-model")
            .arg(mtp_path)
            .arg("--spec-draft-n-max")
            .arg("3");
        // auto-fit 時はドラフトの GPU レイヤー数も auto-fit に任せる（--spec-draft-ngl を付けない）。
        // 非 auto-fit（E4B）は従来どおりドラフトも全 GPU(99)。明示 -ngl 下で 12B ドラフトを
        // GPU に載せると Windows CUDA ビルドがロードに失敗するため、12B は autofit=true で動かす。
        if !autofit {
            cmd.arg("--spec-draft-ngl").arg("99");
        }
    }
    // stderr は破棄せずパイプで読み取り、起動時 VRAM 不足（OOM）を検出する。
    // パイプを溜めるとプロセスが書き込みでブロックするため、専用スレッドで常時ドレインする。
    cmd.stdout(Stdio::null()).stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map(|child| {
            assign_to_kill_on_close_job(&child);
            child
        })
        .map_err(|e| format!("AI校正エンジン (CUDA) の起動に失敗しました: {e}"))?;
    let oom_flag = Arc::new(AtomicBool::new(false));
    if let Some(stderr) = child.stderr.take() {
        let flag = Arc::clone(&oom_flag);
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if text_indicates_vram_oom(&line) {
                    flag.store(true, Ordering::Relaxed);
                }
            }
        });
    }
    Ok((child, oom_flag))
}

/// AMD GPU 向けに、lemond がダウンロードした Vulkan ビルドの llama-server を直接起動する。
/// NVIDIA 直起動（try_start_llama_server_cuda）の AMD 版。lemond のモデル管理を介さず、
/// ローカル GGUF（本体 + MTP ドラフト）を直接ロードして 12B + MTP（投機的デコード）を有効にする。
///
/// rocm-stable の llama-server（古いビルド）はドラフトのアーキテクチャ `gemma4-assistant` を
/// 認識できないため、MTP には Lemonade が別途取得する新しい Vulkan ビルド（b9585+）を使う。
/// VRAM が限られる AMD ノート GPU（8GB 等）でも収まるよう `-ngl` は指定せず auto-fit に任せる
/// （明示すると auto-fit が無効化され、本体 + ドラフトで OOM する）。
fn try_start_llama_server_vulkan(
    bin_path: &str,
    model_path: &str,
    mtp_model_path: Option<&str>,
    port: u16,
    ctx_size: u32,
    vk_device_index: Option<i32>,
) -> Result<(Child, Arc<AtomicBool>), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(bin_path) {
            let mode = meta.permissions().mode();
            if mode & 0o100 == 0 {
                let mut perms = meta.permissions();
                perms.set_mode(mode | 0o755);
                let _ = std::fs::set_permissions(bin_path, perms);
            }
        }
    }
    let mut cmd = Command::new(bin_path);
    apply_windows_no_window(&mut cmd);
    // 同梱共有ライブラリ（libggml-*.so / libllama.so 等）をバイナリと同じディレクトリから
    // 解決できるよう、bin ディレクトリを PATH と LD_LIBRARY_PATH の先頭に追加する。
    if let Some(bin_dir) = PathBuf::from(bin_path).parent() {
        if bin_dir.exists() {
            #[cfg(target_os = "windows")]
            let sep = ";";
            #[cfg(not(target_os = "windows"))]
            let sep = ":";
            let current_path = env::var("PATH").unwrap_or_default();
            cmd.env("PATH", format!("{}{sep}{current_path}", bin_dir.display()));
            #[cfg(not(target_os = "windows"))]
            {
                let current_ld = env::var("LD_LIBRARY_PATH").unwrap_or_default();
                cmd.env(
                    "LD_LIBRARY_PATH",
                    format!("{}{sep}{current_ld}", bin_dir.display()),
                );
            }
        }
    }
    // Vulkan デバイス選択。指定（>=0）があればそのデバイスのみ見せる（iGPU 誤選択を避け dGPU を使う）。
    // 未指定（None/-1）は llama.cpp 既定（Vulkan0）。
    if let Some(idx) = vk_device_index.filter(|&i| i >= 0) {
        cmd.env("GGML_VK_VISIBLE_DEVICES", idx.to_string());
    }
    let ctx_s = ctx_size.to_string();
    let port_s = port.to_string();
    // MTP ドラフト併用時は FlashAttention off（CUDA 経路と同方針。ドラフト併用時の安定性を優先）。
    let flash_attn = if mtp_model_path.is_some() { "off" } else { "on" };
    cmd.arg("-m")
        .arg(model_path)
        .arg("--port")
        .arg(&port_s)
        // -ngl は指定しない（auto-fit: VRAM に収まる分だけ GPU、残りは CPU へ自動配置）
        .arg("--ctx-size")
        .arg(&ctx_s)
        .arg("--flash-attn")
        .arg(flash_attn)
        .arg("--host")
        .arg("127.0.0.1");
    if let Some(mtp_path) = mtp_model_path {
        // ドラフトの GPU レイヤー数（--spec-draft-ngl）は指定せず auto に任せる
        // （8GB クラスでも本体 auto-fit と両立させ OOM を避けるため）。
        cmd.arg("--spec-type")
            .arg("draft-mtp")
            .arg("--spec-draft-model")
            .arg(mtp_path)
            .arg("--spec-draft-n-max")
            .arg("3");
    }
    cmd.stdout(Stdio::null()).stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map(|child| {
            assign_to_kill_on_close_job(&child);
            child
        })
        .map_err(|e| format!("AI校正エンジン (Vulkan) の起動に失敗しました: {e}"))?;
    let oom_flag = Arc::new(AtomicBool::new(false));
    if let Some(stderr) = child.stderr.take() {
        let flag = Arc::clone(&oom_flag);
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if text_indicates_vram_oom(&line) {
                    flag.store(true, Ordering::Relaxed);
                }
            }
        });
    }
    Ok((child, oom_flag))
}

/// AMD GPU 向けに、lemond がダウンロードした ROCm ビルドの llama-server を直接起動する。
/// Vulkan 版（try_start_llama_server_vulkan）の ROCm 版。新しい rocm ビルド（b9585+）は
/// ドラフト arch `gemma4-assistant` を解釈でき、MTP（投機的デコード）を有効化できる。
///
/// rocBLAS は `LD_LIBRARY_PATH` に therock を載せず、システム ROCm（/opt/rocm。対象 GPU arch の
/// Tensile を含む）から解決する。lemonade の therock は iGPU 専用 arch のことがあり、dGPU では
/// 推論時に rocBLAS が落ちるため。`-ngl` は指定せず `--fit on`（auto-fit）に任せ、warmup は
/// 無効化しない（起動時 forward パスで arch 不整合を表面化させ、呼び出し側が Vulkan へ退避できる）。
fn try_start_llama_server_rocm(
    bin_path: &str,
    model_path: &str,
    mtp_model_path: Option<&str>,
    port: u16,
    ctx_size: u32,
    hip_device_index: Option<i32>,
) -> Result<(Child, Arc<AtomicBool>), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(bin_path) {
            let mode = meta.permissions().mode();
            if mode & 0o100 == 0 {
                let mut perms = meta.permissions();
                perms.set_mode(mode | 0o755);
                let _ = std::fs::set_permissions(bin_path, perms);
            }
        }
    }
    let mut cmd = Command::new(bin_path);
    apply_windows_no_window(&mut cmd);
    // 同梱共有ライブラリ（libggml-hip.so / libllama.so 等）をバイナリと同じディレクトリから
    // 解決できるよう bin ディレクトリを PATH / LD_LIBRARY_PATH 先頭に追加する。
    // therock は載せない（その rocBLAS は対象 GPU arch を欠くことがある）。libamdhip64 /
    // librocblas と対象 arch の Tensile はシステム ROCm（ldconfig / /opt/rocm）から解決する。
    if let Some(bin_dir) = PathBuf::from(bin_path).parent() {
        if bin_dir.exists() {
            #[cfg(target_os = "windows")]
            let sep = ";";
            #[cfg(not(target_os = "windows"))]
            let sep = ":";
            let current_path = env::var("PATH").unwrap_or_default();
            cmd.env("PATH", format!("{}{sep}{current_path}", bin_dir.display()));
            #[cfg(not(target_os = "windows"))]
            {
                let current_ld = env::var("LD_LIBRARY_PATH").unwrap_or_default();
                cmd.env(
                    "LD_LIBRARY_PATH",
                    format!("{}{sep}{current_ld}", bin_dir.display()),
                );
            }
        }
    }
    // HIP デバイス選択。指定（>=0）があればその dGPU のみ見せる（iGPU 誤選択・VRAM不足を避ける）。
    if let Some(idx) = hip_device_index.filter(|&i| i >= 0) {
        cmd.env("HIP_VISIBLE_DEVICES", idx.to_string());
        cmd.env("ROCR_VISIBLE_DEVICES", idx.to_string());
    }
    let ctx_s = ctx_size.to_string();
    let port_s = port.to_string();
    // MTP 併用時は FlashAttention off（CUDA / Vulkan 経路と同方針）。
    let flash_attn = if mtp_model_path.is_some() { "off" } else { "on" };
    cmd.arg("-m")
        .arg(model_path)
        .arg("--port")
        .arg(&port_s)
        // -ngl は指定せず --fit on（auto-fit）に任せる（8GB クラスで本体+ドラフトを収める）。
        .arg("--fit")
        .arg("on")
        .arg("--ctx-size")
        .arg(&ctx_s)
        .arg("--flash-attn")
        .arg(flash_attn)
        .arg("--host")
        .arg("127.0.0.1");
    if let Some(mtp_path) = mtp_model_path {
        // ドラフトの GPU レイヤー数（--spec-draft-ngl）は指定せず auto-fit に任せる。
        cmd.arg("--spec-type")
            .arg("draft-mtp")
            .arg("--spec-draft-model")
            .arg(mtp_path)
            .arg("--spec-draft-n-max")
            .arg("3");
    }
    cmd.stdout(Stdio::null()).stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map(|child| {
            assign_to_kill_on_close_job(&child);
            child
        })
        .map_err(|e| format!("AI校正エンジン (ROCm) の起動に失敗しました: {e}"))?;
    // stderr から OOM・rocBLAS/Tensile arch 失敗を検出するフラグ。立ったら Vulkan へ退避する。
    let fail_flag = Arc::new(AtomicBool::new(false));
    if let Some(stderr) = child.stderr.take() {
        let flag = Arc::clone(&fail_flag);
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if text_indicates_rocm_failure(&line) {
                    flag.store(true, Ordering::Relaxed);
                }
            }
        });
    }
    Ok((child, fail_flag))
}

/// 子プロセスを Job Object に紐付け、親プロセス終了時に自動 kill させる（Windows のみ）。
/// CloseRequested ハンドラーが走らないクラッシュ・強制終了時も、同梱エンジン
/// （CUDA llama-server.exe / AMD lemond と配下のバックエンド）を確実に終了させ VRAM を解放する。
#[cfg(target_os = "windows")]
fn assign_to_kill_on_close_job(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::{
        Foundation::HANDLE,
        System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW,
            JobObjectExtendedLimitInformation, SetInformationJobObject,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
    };
    unsafe {
        let job: HANDLE = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
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

/// アプリが起動した CUDA llama-server (mode==1) を停止して VRAM を解放する。
/// 「自分でVRAMにロードしたものは完了時にアンロードする」方針に合わせ、AI校正完了後に呼ぶ。
/// 停止したら true。mode!=1（lemond 等）なら何もせず false を返す。
fn try_stop_cuda_llama_server(app: &AppHandle) -> bool {
    let state = app.state::<LemonadeServer>();
    if state.mode.load(Ordering::Relaxed) != 1 {
        return false;
    }
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    // ポートが閉じ、次回の start_lemonade_server で再検出・再起動される
    state.mode.store(0, Ordering::Relaxed);
    true
}

/// アプリ固有の Lemonade キャッシュディレクトリを返す。
/// lemond に位置引数として渡すことで、バックエンドバイナリや config.json を
/// アプリ固有の場所（~/.cache/{app-id}/lemonade/）に格納する。
fn get_lemonade_app_cache_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_cache_dir().ok().map(|d| d.join("lemonade"))
}

#[tauri::command]
fn check_lemonade_gpu_backend_installed(app: AppHandle) -> bool {
    // llama-server CUDA バイナリが存在する場合もバックエンドインストール済みと見なす
    if find_bundled_llama_server_bin(&app).is_some() {
        return true;
    }
    let Some(lemonade_dir) = get_lemonade_app_cache_dir(&app) else {
        return false;
    };
    let bin_dir = lemonade_dir.join("bin");
    if !bin_dir.exists() {
        return false;
    }
    std::fs::read_dir(&bin_dir)
        .map(|mut d| d.next().is_some())
        .unwrap_or(false)
}

/// アプリ固有キャッシュの config.json に解決済みポートを書き込む。
/// lemond は起動時にこの値を読み取るため、システムスナップ (13305) と分離される。
fn ensure_lemonade_app_port_config(cache_dir: &Path, port: u16) {
    let config_path = cache_dir.join("config.json");
    let mut config: Value = if config_path.exists() {
        std::fs::read_to_string(&config_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    config["port"] = serde_json::json!(port);
    // 40セグメントバッチに対応するため n_ctx を拡張する（既定 4096 では不足）。
    // Lemonade 10.7.0 で LEMONADE_CTX_SIZE 環境変数は廃止されたため、config.json の
    // ctx_size キーが唯一の設定手段（旧版でも config.json の ctx_size を読むため後方互換）。
    config["ctx_size"] = serde_json::json!(16384);
    // プライバシー: lemond の LAN ディスカバリ・ビーコン（RFC1918 ブロードキャスト）を止める。
    // オフライン要件上、ネットワークへ自身の存在を広報しない。Lemonade 10.8.0 で追加された
    // Cloud offload は接続先プロバイダを設定しない限り無効のため、ここでは何も登録しない。
    config["no_broadcast"] = serde_json::json!(true);
    // システム llama-server (Debian b8681) は ROCm/gfx1150 でクラッシュするため
    // prefer_system=false にしてバンドル版 ROCm バイナリを優先する
    if !config["llamacpp"].is_object() {
        config["llamacpp"] = serde_json::json!({});
    }
    if let Some(obj) = config["llamacpp"].as_object_mut() {
        obj.insert("prefer_system".to_string(), serde_json::json!(false));
    }
    if let Ok(json) = serde_json::to_string_pretty(&config) {
        let _ = std::fs::write(&config_path, json);
    }
}

/// Lemonade 経路の既定校正モデル（Gemma 4 E4B QAT）。
/// 内蔵レジストリの Gemma-4-E4B-it-GGUF は非QAT（Q4_K_M）のため、
/// QAT 版（UD-Q4_K_XL）は user_models.json へのカスタム登録で提供する。
const LEMONADE_DEFAULT_MODEL: &str = "gemma-4-E4B-it-qat";
const LEMONADE_DEFAULT_MODEL_CHECKPOINT: &str = "unsloth/gemma-4-E4B-it-qat-GGUF:UD-Q4_K_XL";
// AMD GPU で 12B + MTP を Vulkan llama-server 直起動する際の総コンテキスト長。
// 8GB クラスの AMD dGPU（例: RX 7600M XT, 8176MiB）でも 12B(Q4) + MTP ドラフトが
// auto-fit で収まる安全値（実測で 8192 は VRAM 約8.0GB/8.5GB に収まり MTP も有効）。
// 校正は話者ごと最大40セグメントのバッチで、短い発話なら 8192 トークンに十分収まる。
const AMD_12B_CTX_SIZE: u32 = 8192;
// 既定（標準）モデル: Gemma 4 E4B QAT。従来どおりのデフォルト経路。
const GEMMA_LLM_MODEL_DIR: &str = "gemma-4-e4b-it";
const GEMMA_MAIN_GGUF_FILENAME: &str = "gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf";
const GEMMA_MTP_GGUF_FILENAME: &str = "mtp-gemma-4-E4B-it.gguf";
const GEMMA_MTP_BF16_GGUF_FILENAME: &str = "gemma-4-E4B-it-BF16-MTP.gguf";

// 上位（高精度）モデル: Gemma 4 12B QAT + MTP。NVIDIA/CUDA 同梱 llama-server 経路でのみ提供し、
// large-v3 と同じく後からダウンロードする（AMD/Lemonade 経路には MTP が未配線のため対象外）。
const GEMMA_12B_LLM_MODEL_DIR: &str = "gemma-4-12b-it";
const GEMMA_12B_MAIN_GGUF_FILENAME: &str = "gemma-4-12B-it-qat-UD-Q4_K_XL.gguf";
const GEMMA_12B_MTP_GGUF_FILENAME: &str = "mtp-gemma-4-12B-it.gguf";

/// 校正AIモデルの選択肢。既定は E4b（標準）。B12（高精度）は CUDA 版のみ。
#[derive(Clone, Copy, PartialEq, Eq)]
enum GemmaTier {
    E4b,
    B12,
}

impl GemmaTier {
    fn from_marker(value: &str) -> Self {
        if value.trim() == "12b" {
            GemmaTier::B12
        } else {
            GemmaTier::E4b
        }
    }
    fn as_marker(self) -> &'static str {
        match self {
            GemmaTier::E4b => "e4b",
            GemmaTier::B12 => "12b",
        }
    }
    fn model_dir(self) -> &'static str {
        match self {
            GemmaTier::E4b => GEMMA_LLM_MODEL_DIR,
            GemmaTier::B12 => GEMMA_12B_LLM_MODEL_DIR,
        }
    }
    fn main_filename(self) -> &'static str {
        match self {
            GemmaTier::E4b => GEMMA_MAIN_GGUF_FILENAME,
            GemmaTier::B12 => GEMMA_12B_MAIN_GGUF_FILENAME,
        }
    }
}

fn gemma_llm_relative_dir(tier: GemmaTier) -> PathBuf {
    PathBuf::from("python_sidecar")
        .join("models")
        .join("llm")
        .join(tier.model_dir())
}

fn gemma_debug_model_dir_candidates(tier: GemmaTier) -> Vec<PathBuf> {
    let mut candidates = vec![
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(gemma_llm_relative_dir(tier)),
    ];
    if let Ok(cwd) = env::current_dir() {
        candidates.push(cwd.join(gemma_llm_relative_dir(tier)));
    }
    candidates
}

fn gemma_release_model_dir(app: &AppHandle, tier: GemmaTier) -> Option<PathBuf> {
    release_models_root(app)
        .map(|root| root.join("llm").join(tier.model_dir()))
}

fn gemma_main_gguf_path(dir: &Path, tier: GemmaTier) -> PathBuf {
    dir.join(tier.main_filename())
}

fn gemma_mtp_gguf_candidates(dir: &Path, tier: GemmaTier) -> Vec<PathBuf> {
    match tier {
        // E4B は同梱経路で BF16 ドラフトへのフォールバックも見る。
        GemmaTier::E4b => vec![
            dir.join(GEMMA_MTP_GGUF_FILENAME),
            dir.join("MTP").join(GEMMA_MTP_BF16_GGUF_FILENAME),
        ],
        GemmaTier::B12 => vec![dir.join(GEMMA_12B_MTP_GGUF_FILENAME)],
    }
}

fn find_existing_gemma_mtp_gguf(dir: &Path, tier: GemmaTier) -> Option<PathBuf> {
    gemma_mtp_gguf_candidates(dir, tier)
        .into_iter()
        .find(|p| p.is_file())
}

/// 校正AIモデル選択マーカー。`app_local_data_dir()/proofread-model-tier.txt` に
/// "e4b" / "12b" を保存する（NSIS の %LOCALAPPDATA%\{id} 一括削除で消える）。
fn proofread_model_tier_marker_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|d| d.join("proofread-model-tier.txt"))
}

/// ユーザーが選択した校正AIモデル階層を読む。既定は E4b。
/// NVIDIA は同梱 llama-server（CUDA）直起動、AMD は Vulkan llama-server 直起動で 12B+MTP を
/// 動かすため、ビルド識別子による E4b 丸めは行わない（実際に 12B を使えるかは
/// resolve_effective_proofread_tier / amd_vulkan_12b_launch が実行時に判定する）。
fn read_proofread_model_tier(app: &AppHandle) -> GemmaTier {
    proofread_model_tier_marker_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| GemmaTier::from_marker(&s))
        .unwrap_or(GemmaTier::E4b)
}

/// 指定 tier の本体 GGUF を解決する（debug: プロジェクト相対 / release: app data）。
fn resolve_gemma_main_path_for_tier(app: &AppHandle, tier: GemmaTier) -> Option<String> {
    if cfg!(debug_assertions) {
        for dir in gemma_debug_model_dir_candidates(tier) {
            let p = gemma_main_gguf_path(&dir, tier);
            if p.exists() {
                return Some(p.to_string_lossy().to_string());
            }
        }
    }
    if let Some(dir) = gemma_release_model_dir(app, tier) {
        let p = gemma_main_gguf_path(&dir, tier);
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

/// 指定 tier の MTP ドラフト GGUF を解決する。
fn resolve_gemma_mtp_path_for_tier(app: &AppHandle, tier: GemmaTier) -> Option<String> {
    if cfg!(debug_assertions) {
        for dir in gemma_debug_model_dir_candidates(tier) {
            if let Some(p) = find_existing_gemma_mtp_gguf(&dir, tier) {
                return Some(p.to_string_lossy().to_string());
            }
        }
    }
    if let Some(dir) = gemma_release_model_dir(app, tier) {
        if let Some(p) = find_existing_gemma_mtp_gguf(&dir, tier) {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

/// 実際にロードするモデル階層を決める。選択が B12 でも本体 GGUF が無ければ
/// E4b へフォールバックする（フェイルセーフ。12B 未ダウンロードでもサーバは起動する）。
fn resolve_effective_proofread_tier(app: &AppHandle) -> GemmaTier {
    let want = read_proofread_model_tier(app);
    if want == GemmaTier::B12 && resolve_gemma_main_path_for_tier(app, GemmaTier::B12).is_some() {
        GemmaTier::B12
    } else {
        GemmaTier::E4b
    }
}

/// AMD GPU（NVIDIA 直起動が使えない環境）で 12B + MTP を Vulkan llama-server 直起動で
/// 動かせるか判定し、起動に必要なパラメータ (vulkan_bin, 本体GGUF, MTPドラフト, ctx) を返す。
/// 条件を満たさなければ None（E4B や 12B 未導入は従来どおり lemond 経路へ）。
///
/// NVIDIA 直起動と同じく、lemond のモデル管理を介さずローカル GGUF を直接ロードする。
/// これにより rocm-stable では未対応のドラフト（`gemma4-assistant`）も、新しい Vulkan
/// ビルドで MTP（投機的デコード）として有効化できる。
fn amd_vulkan_12b_launch(app: &AppHandle) -> Option<(String, String, Option<String>, u32)> {
    // 実効階層が 12B のときだけ対象（E4B は従来どおり lemond で動かす）。
    if resolve_effective_proofread_tier(app) != GemmaTier::B12 {
        return None;
    }
    let vk_bin = find_lemonade_vulkan_llama_server(app)?;
    let main_path = resolve_gemma_main_path_for_tier(app, GemmaTier::B12)?;
    // MTP ドラフトは任意。新しい Vulkan ビルドのみがドラフトの arch を解釈できるが、
    // ビルド世代の検出はコスト高なので、ドラフトがあれば渡し、ロードに失敗したら
    // OOM 検出と同様にサーバ起動失敗として扱う（古いビルドでは MTP 無しで使う運用は別途）。
    let mtp_path = resolve_gemma_mtp_path_for_tier(app, GemmaTier::B12);
    Some((vk_bin, main_path, mtp_path, AMD_12B_CTX_SIZE))
}

/// ROCm 直起動パラメータ: (rocm_bin, 本体GGUF, MTPドラフト, ctx, hip_index)。
type RocmLaunch = (String, String, Option<String>, u32, i32);
/// Vulkan 直起動パラメータ: (vulkan_bin, 本体GGUF, MTPドラフト, ctx)。
type VulkanLaunch = (String, String, Option<String>, u32);

/// rocminfo（gfx 名）と rocm-smi（VRAM）から AMD GPU を列挙し、VRAM 降順（dGPU 先頭）で返す。
/// 戻り値: (hip_index, gfx, vram_mib)。取得不能時は空。
fn amd_gpu_priority_list() -> Vec<(i32, String, u64)> {
    // rocminfo: GPU エージェントの gfx 名を列挙順（= HIP デバイス順）に集める。
    let mut info_cmd = Command::new("rocminfo");
    apply_windows_no_window(&mut info_cmd);
    let gfx_list: Vec<String> = match info_cmd.output() {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .lines()
            .filter_map(|l| {
                // 例: "  Name:                    gfx1102"。ISA 行（amdgcn-...）は除外。
                let v = l.trim().strip_prefix("Name:")?.trim();
                if v.starts_with("gfx")
                    && v.len() <= 8
                    && v[3..].chars().all(|c| c.is_ascii_alphanumeric())
                    && !v[3..].is_empty()
                {
                    Some(v.to_string())
                } else {
                    None
                }
            })
            .collect(),
        _ => vec![],
    };
    // rocm-smi: GPU[N] ごとの VRAM Total Memory (B)。
    let mut smi_cmd = Command::new("rocm-smi");
    apply_windows_no_window(&mut smi_cmd);
    let mut vram_by_index: std::collections::BTreeMap<i32, u64> = std::collections::BTreeMap::new();
    if let Ok(o) = smi_cmd.arg("--showmeminfo").arg("vram").output() {
        if o.status.success() {
            for line in String::from_utf8_lossy(&o.stdout).lines() {
                // 例: "GPU[0]		: VRAM Total Memory (B): 8573157376"
                if !line.contains("VRAM Total Memory") {
                    continue;
                }
                if let (Some(lb), Some(rb)) = (line.find("GPU["), line.find(']')) {
                    if let Ok(idx) = line[lb + 4..rb].parse::<i32>() {
                        if let Some(bytes) = line
                            .rsplit(':')
                            .next()
                            .and_then(|s| s.trim().parse::<u64>().ok())
                        {
                            vram_by_index.insert(idx, bytes / (1024 * 1024));
                        }
                    }
                }
            }
        }
    }
    let n = gfx_list.len().max(vram_by_index.len());
    let mut gpus: Vec<(i32, String, u64)> = Vec::new();
    for i in 0..n as i32 {
        let gfx = gfx_list.get(i as usize).cloned().unwrap_or_default();
        let vram = vram_by_index.get(&i).copied().unwrap_or(0);
        if gfx.is_empty() && vram == 0 {
            continue;
        }
        gpus.push((i, gfx, vram));
    }
    gpus.sort_by(|a, b| b.2.cmp(&a.2));
    gpus
}

/// システム ROCm（/opt/rocm*）の rocBLAS Tensile ライブラリに、指定 gfx arch のカーネルが
/// 含まれるかを確認する。含まれなければ ROCm 直起動は推論時に rocBLAS で落ちるため、この
/// ゲートで弾いて Vulkan へフォールバックする（lemonade の therock は arch を欠くことがある）。
fn system_rocm_tensile_has_arch(gfx: &str) -> bool {
    if gfx.is_empty() {
        return false;
    }
    let Ok(entries) = std::fs::read_dir("/opt") else {
        return false;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("rocm") {
            continue;
        }
        let libdir = entry.path().join("lib").join("rocblas").join("library");
        if let Ok(files) = std::fs::read_dir(&libdir) {
            for f in files.flatten() {
                if f.file_name().to_string_lossy().contains(gfx) {
                    return true;
                }
            }
        }
    }
    false
}

/// AMD GPU で 12B + MTP を ROCm llama-server 直起動で動かせるか判定し、起動パラメータを返す。
/// 条件: 実効階層 12B ∧ rocm ビルドが gemma4-assistant 対応(b9585+) ∧ AMD GPU 検出 ∧
/// システム ROCm にその GPU arch の rocBLAS Tensile がある（推論時クラッシュを起動前に排除）。
/// 満たさなければ None（→ Vulkan 直起動、それも不可なら lemond E4B へフォールバック）。
fn amd_rocm_12b_launch(app: &AppHandle) -> Option<RocmLaunch> {
    if resolve_effective_proofread_tier(app) != GemmaTier::B12 {
        return None;
    }
    let rocm_bin = find_lemonade_rocm_llama_server(app)?;
    if !rocm_build_supports_gemma4_assistant(&rocm_bin) {
        return None;
    }
    let main_path = resolve_gemma_main_path_for_tier(app, GemmaTier::B12)?;
    let (hip_index, gfx, _vram) = amd_gpu_priority_list().into_iter().next()?;
    if !system_rocm_tensile_has_arch(&gfx) {
        return None;
    }
    let mtp_path = resolve_gemma_mtp_path_for_tier(app, GemmaTier::B12);
    Some((rocm_bin, main_path, mtp_path, AMD_12B_CTX_SIZE, hip_index))
}

/// AMD で 12B を直起動する計画（ROCm 優先・Vulkan フォールバック）を返す。
/// どちらも不可なら None（→ lemond E4B 経路へ）。NVIDIA・E4B では常に None。
fn amd_12b_launch_plan(app: &AppHandle) -> Option<(Option<RocmLaunch>, Option<VulkanLaunch>)> {
    let rocm = amd_rocm_12b_launch(app);
    let vulkan = amd_vulkan_12b_launch(app);
    if rocm.is_some() || vulkan.is_some() {
        Some((rocm, vulkan))
    } else {
        None
    }
}

/// AMD 12B 起動の共通処理（ROCm 優先 → 起動失敗時 Vulkan フォールバック）。
/// start_lemonade_server / install_lemonade の spawn_blocking 内から呼ぶ。
/// `success_msg` は成功時の戻り文字列（"started" / "installed_and_started"）。
/// 成功すれば mode=1（per-job 停止・kill-on-close の対象）を保つ。
#[allow(clippy::too_many_arguments)]
fn start_amd_12b_blocking(
    rocm: Option<RocmLaunch>,
    vulkan: Option<VulkanLaunch>,
    child_arc: &Arc<Mutex<Option<Child>>>,
    mode_arc: &Arc<AtomicU8>,
    parallel_arc: &Arc<AtomicU8>,
    resolved_port: u16,
    success_msg: &str,
) -> Result<String, String> {
    mode_arc.store(1, Ordering::Relaxed);
    parallel_arc.store(1, Ordering::Relaxed);

    // 1) ROCm 直起動（高速経路）を試す。失敗（起動エラー・rocBLAS arch・OOM・プロセス即死・
    //    タイムアウト）なら残骸を kill して Vulkan へフォールバックする。
    if let Some((bin, main_path, mtp_path, ctx_size, hip_index)) = rocm {
        if let Ok((child, fail_flag)) = try_start_llama_server_rocm(
            &bin,
            &main_path,
            mtp_path.as_deref(),
            resolved_port,
            ctx_size,
            Some(hip_index),
        ) {
            if let Ok(mut g) = child_arc.lock() {
                *g = Some(child);
            }
            // 12B はロード+warmup に時間がかかるため最大 120 秒待つ。
            let mut started = false;
            for _ in 0..240 {
                thread::sleep(Duration::from_millis(500));
                if lemonade_app_port_open(resolved_port) {
                    started = true;
                    break;
                }
                let child_dead = child_arc
                    .lock()
                    .ok()
                    .and_then(|mut g| {
                        g.as_mut()
                            .map(|c| c.try_wait().map(|s| s.is_some()).unwrap_or(false))
                    })
                    .unwrap_or(false);
                if fail_flag.load(Ordering::Relaxed) || child_dead {
                    break;
                }
            }
            if started {
                return Ok(success_msg.to_string());
            }
            // ROCm 失敗: 残骸を kill して Vulkan へ。
            if let Ok(mut g) = child_arc.lock() {
                if let Some(mut c) = g.take() {
                    let _ = c.kill();
                    let _ = c.wait();
                }
            }
        }
    }

    // 2) Vulkan 直起動（フォールバック）。
    if let Some((bin, main_path, mtp_path, ctx_size)) = vulkan {
        let (child, oom_flag) = try_start_llama_server_vulkan(
            &bin,
            &main_path,
            mtp_path.as_deref(),
            resolved_port,
            ctx_size,
            None,
        )?;
        if let Ok(mut g) = child_arc.lock() {
            *g = Some(child);
        }
        for _ in 0..240 {
            thread::sleep(Duration::from_millis(500));
            if lemonade_app_port_open(resolved_port) {
                return Ok(success_msg.to_string());
            }
            if oom_flag.load(Ordering::Relaxed) {
                if let Ok(mut g) = child_arc.lock() {
                    if let Some(mut c) = g.take() {
                        let _ = c.kill();
                        let _ = c.wait();
                    }
                }
                mode_arc.store(0, Ordering::Relaxed);
                return Err("AI校正エンジン(高精度12B)の起動時にGPUメモリ(VRAM)が不足しました。設定で校正AIモデルを標準(E4B)に戻してください。".to_string());
            }
        }
        mode_arc.store(0, Ordering::Relaxed);
        return Err("AI校正エンジン (12B) の起動タイムアウト（120秒）".to_string());
    }

    // ROCm も Vulkan も起動できなかった。
    mode_arc.store(0, Ordering::Relaxed);
    Err("AI校正エンジン(高精度12B)を起動できませんでした。設定で校正AIモデルを標準(E4B)に戻してください。".to_string())
}

/// アプリ固有キャッシュの user_models.json に既定の E4B QAT モデルを登録する。
/// 既に同名エントリがある場合は何もしない（ユーザーの手動編集を上書きしない）。
/// 12B（高精度）は lemond ではなく Vulkan llama-server 直起動で動かすため、ここには登録しない。
fn ensure_lemonade_default_model_registered(cache_dir: &Path) {
    let path = cache_dir.join("user_models.json");
    let mut models: Value = if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    if !models.is_object() {
        models = serde_json::json!({});
    }
    if models.get(LEMONADE_DEFAULT_MODEL).is_some() {
        return;
    }
    models[LEMONADE_DEFAULT_MODEL] = serde_json::json!({
        "checkpoints": { "main": LEMONADE_DEFAULT_MODEL_CHECKPOINT },
        "labels": ["custom"],
        "recipe": "llamacpp",
        "suggested": true
    });
    if let Ok(json) = serde_json::to_string_pretty(&models) {
        let _ = std::fs::write(&path, json);
    }
}

/// nvidia-smi から NVIDIA GPU 情報を取得し、VRAM 降順・compute capability 降順でソートする。
/// 戻り値: (cuda_index, name, vram_mib, compute_cap)。nvidia-smi が使えない場合は空ベクタ。
fn nvidia_gpu_priority_list() -> Vec<(u32, String, u64, f32)> {
    let mut smi_cmd = Command::new("nvidia-smi");
    apply_windows_no_window(&mut smi_cmd);
    let output = match smi_cmd
        .args([
            "--query-gpu=index,name,memory.total,compute_cap",
            "--format=csv,noheader,nounits",
        ])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return vec![],
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut gpus: Vec<(u32, String, u64, f32)> = stdout
        .lines()
        .filter_map(|line| {
            let p: Vec<&str> = line.splitn(4, ',').map(str::trim).collect();
            if p.len() < 4 {
                return None;
            }
            Some((
                p[0].parse().ok()?,
                p[1].to_string(),
                p[2].parse().ok()?,
                p[3].parse().unwrap_or(0.0_f32),
            ))
        })
        .collect();
    // VRAM 降順 → compute capability 降順（新世代 GPU 優先）
    gpus.sort_by(|a, b| {
        b.2.cmp(&a.2)
            .then(b.3.partial_cmp(&a.3).unwrap_or(std::cmp::Ordering::Equal))
    });
    gpus
}

/// nvidia-smi から GPU を列挙し、frontend の `GpuDeviceInfo` 形状の JSON を返す。
/// torch（detect_env_cli.py）が CUDA デバイスを取得できないとき（torch 未導入 / CPU 版）の
/// CUDA フォールバック用。index は nvidia-smi の PCI バス順で、`apply_child_runtime_env` の
/// `CUDA_DEVICE_ORDER=PCI_BUS_ID` + `CUDA_VISIBLE_DEVICES=<index>` と整合する。
fn nvidia_devices_for_env() -> Vec<serde_json::Value> {
    let mut smi_cmd = Command::new("nvidia-smi");
    apply_windows_no_window(&mut smi_cmd);
    let output = match smi_cmd
        .args([
            "--query-gpu=index,name,memory.total,memory.free",
            "--format=csv,noheader,nounits",
        ])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return vec![],
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .filter_map(|line| {
            let p: Vec<&str> = line.splitn(4, ',').map(str::trim).collect();
            if p.len() < 4 {
                return None;
            }
            let index: u32 = p[0].parse().ok()?;
            let name = p[1].to_string();
            let total_mb: u64 = p[2].parse().ok()?;
            let free_mb: u64 = p[3].parse().unwrap_or(total_mb);
            Some(serde_json::json!({
                "index": index,
                "name": name,
                "totalVramMb": total_mb,
                "freeVramMb": free_mb,
                "isLikelyIgpu": false,
                "gcnArchName": "",
            }))
        })
        .collect()
}

/// vulkaninfo --summary から「deviceName → Vulkan デバイスインデックス」マップを構築する。
fn vulkan_name_to_index_map() -> Option<std::collections::HashMap<String, u32>> {
    let mut vk_cmd = Command::new("vulkaninfo");
    apply_windows_no_window(&mut vk_cmd);
    let output = vk_cmd.arg("--summary").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut map = std::collections::HashMap::new();
    let mut cur_idx: Option<u32> = None;
    for line in stdout.lines() {
        let t = line.trim();
        if t.starts_with("GPU") && t.ends_with(':') {
            cur_idx = t[3..t.len() - 1].trim().parse().ok();
        } else if let Some(idx) = cur_idx {
            // "deviceName         = NVIDIA GeForce RTX 4060 Laptop GPU" 形式
            if let Some(rest) = t.strip_prefix("deviceName") {
                let name = rest
                    .trim_start_matches(|c: char| c == '=' || c.is_whitespace())
                    .to_string();
                if !name.is_empty() {
                    map.insert(name, idx);
                    cur_idx = None;
                }
            }
        }
    }
    if map.is_empty() {
        None
    } else {
        Some(map)
    }
}

/// 優先度の高い NVIDIA GPU 名と vulkaninfo のデバイス名を照合してインデックスを返す。
/// 完全一致 → 上位文字列包含の順で試みる。
fn match_nvidia_in_vulkan_map(
    priority_list: &[(u32, String, u64, f32)],
    vk_map: &std::collections::HashMap<String, u32>,
) -> Option<u32> {
    for (_, name, _, _) in priority_list {
        // 完全一致
        if let Some(&idx) = vk_map.get(name.as_str()) {
            return Some(idx);
        }
        // 部分一致（"RTX 4060" ↔ "RTX 4060 Laptop GPU" など）
        let nu = name.to_uppercase();
        for (vk_name, &idx) in vk_map {
            if !vk_name.to_uppercase().contains("NVIDIA") {
                continue;
            }
            let vu = vk_name.to_uppercase();
            if vu.contains(&nu) || nu.contains(&vu) {
                return Some(idx);
            }
        }
    }
    None
}

/// Windows WMIC フォールバック: アダプター順から最良 NVIDIA GPU の Vulkan インデックスを推定する。
/// nvidia-smi 優先リスト先頭の GPU 名（best_name）と WMIC 行を照合し、
/// その GPU より前に並ぶ他 GPU 数を Vulkan インデックスとして返す。
#[cfg(target_os = "windows")]
fn detect_nvidia_vulkan_index_wmic(best_name: &str) -> Option<u32> {
    let mut wmic_cmd = Command::new("wmic");
    apply_windows_no_window(&mut wmic_cmd);
    let output = wmic_cmd
        .args(["path", "win32_VideoController", "get", "Name"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let names: Vec<String> = stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.eq_ignore_ascii_case("Name"))
        .collect();

    let best_up = best_name.to_uppercase();
    let mut vk_idx: u32 = 0;
    for name in &names {
        let up = name.to_uppercase();
        if up.contains("NVIDIA") {
            // 優先 GPU と名前が一致するか（完全 or 包含）
            if up.contains(&best_up) || best_up.contains(&up) {
                return Some(vk_idx);
            }
        }
        // 他のアダプター（AMD / Intel / 別 NVIDIA）はインデックスを進める
        if up.contains("AMD") || up.contains("RADEON") || up.contains("INTEL") || up.contains("NVIDIA") {
            vk_idx += 1;
        }
    }
    None
}

/// 最優先 NVIDIA GPU（VRAM 最大 → compute capability 最大）の Vulkan デバイスインデックスを返す。
/// 検出できない場合は None（GGML_VK_DEVICE を設定しない）。
fn detect_nvidia_vulkan_index() -> Option<u32> {
    let priority_list = nvidia_gpu_priority_list();
    if priority_list.is_empty() {
        return None;
    }

    // vulkaninfo で正確に照合
    if let Some(vk_map) = vulkan_name_to_index_map() {
        if let Some(idx) = match_nvidia_in_vulkan_map(&priority_list, &vk_map) {
            return Some(idx);
        }
    }

    // WMIC フォールバック（vulkaninfo が使えない環境向け）
    #[cfg(target_os = "windows")]
    {
        let best_name = &priority_list[0].1;
        if let Some(idx) = detect_nvidia_vulkan_index_wmic(best_name) {
            return Some(idx);
        }
    }

    None
}

fn try_start_lemonade_bin(bin_path: &str, cache_dir: Option<&str>, _hip_device_index: Option<i32>) -> Result<Child, String> {
    // Tauri extracts resources without the execute bit on Linux; fix it before spawning.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(bin_path) {
            let mode = meta.permissions().mode();
            if mode & 0o100 == 0 {
                let mut perms = meta.permissions();
                perms.set_mode(mode | 0o755);
                let _ = std::fs::set_permissions(bin_path, perms);
            }
        }
    }
    let mut cmd = Command::new(bin_path);
    apply_windows_no_window(&mut cmd);
    // NVIDIA Optimus 環境（AMD iGPU + NVIDIA dGPU）では Vulkan device 0 が AMD iGPU に
    // なりがちで、共有 RAM を使うため推論が大幅に遅くなる。
    // NVIDIA GPU の Vulkan インデックスを検出して GGML_VK_DEVICE に設定する。
    cmd.env("DISABLE_LAYER_NV_OPTIMUS_1", "1");
    if let Some(vk_idx) = detect_nvidia_vulkan_index() {
        cmd.env("GGML_VK_DEVICE", vk_idx.to_string());
    }
    // n_ctx は config.json の ctx_size で設定する（ensure_lemonade_app_port_config が書き込む）。
    // Lemonade 10.7.0 で LEMONADE_CTX_SIZE 環境変数は廃止されたため env では渡さない。
    // AMD ROCm 環境: HIP_VISIBLE_DEVICES でデバイスを選択する。
    // ROCR_VISIBLE_DEVICES は設定しない（二重フィルター問題を避けるため）。
    #[cfg(target_os = "linux")]
    if std::path::Path::new("/dev/kfd").exists() {
        let idx = _hip_device_index
            .filter(|&i| i >= 0)
            .unwrap_or(0)
            .to_string();
        cmd.env("HIP_VISIBLE_DEVICES", idx);
    }
    // アプリ固有キャッシュディレクトリを位置引数で渡す（lemond [cache_dir] 形式）
    if let Some(dir) = cache_dir {
        cmd.arg(dir);
    }
    cmd.stdout(Stdio::null()).stderr(Stdio::null());
    cmd.spawn()
        .map(|child| {
            // CUDA llama-server と同様、強制終了・クラッシュ時も lemond（と配下のバックエンド）を
            // 確実に終了させ VRAM を解放するため kill-on-close Job に紐付ける。
            assign_to_kill_on_close_job(&child);
            child
        })
        .map_err(|e| format!("AI校正エンジンの起動に失敗しました: {e}"))
}

#[tauri::command]
fn get_lemonade_status(app: AppHandle, state: tauri::State<'_, LemonadeServer>) -> String {
    let port = state.port.load(Ordering::Relaxed) as u16;
    let has_process = state.child.lock().map(|g| g.is_some()).unwrap_or(false);
    if lemonade_app_port_open(port) {
        "running".to_string()
    } else if has_process {
        "starting".to_string()
    } else if find_lemonade_bundled_bin(&app).is_some() || find_bundled_llama_server_bin(&app).is_some() {
        // NVIDIA 版は Lemonade を同梱せず、同梱 llama-server (CUDA) を直接起動するため、
        // llama-server バイナリの存在も「インストール済み（起動可能）」と見なす。
        // これにより NVIDIA で誤って "not_installed"（＝インストールボタン）にならない。
        // AMD では find_bundled_llama_server_bin が None のため従来どおり lemonade 側で判定される。
        "stopped".to_string()
    } else {
        "not_installed".to_string()
    }
}

/// アプリ固有 lemond が listen しているポートを返す。未解決時は 0。
#[tauri::command]
fn get_lemonade_app_port(state: tauri::State<'_, LemonadeServer>) -> u16 {
    state.port.load(Ordering::Relaxed) as u16
}

/// 直近の CUDA llama-server 起動で試行した並列スロット数 (-np) を返す。
/// 起動が OOM で失敗した場合も「試行した値」が残る（store は spawn 前）。
/// フロントの VRAM 不足フォールバックが、自動(0)設定時の実効 np を知り
/// 段階的（24→20→16→12→8→4→2→1）に下げるために使う。
#[tauri::command]
fn get_llm_attempted_parallel(state: tauri::State<'_, LemonadeServer>) -> u32 {
    state.parallel.load(Ordering::Relaxed).max(1) as u32
}

// LLM バックエンドが現在ロードしているデバイスを返す: gpu / cpu / unknown / stopped
#[tauri::command]
fn get_lemonade_loaded_device(app: AppHandle, state: tauri::State<'_, LemonadeServer>) -> Result<String, String> {
    let port = state.port.load(Ordering::Relaxed) as u16;
    if !lemonade_app_port_open(port) {
        return Ok("stopped".to_string());
    }

    // llama-server CUDA モード: ポートが開いていれば GPU 確定
    if state.mode.load(Ordering::Relaxed) == 1 {
        return Ok("gpu".to_string());
    }

    let cli_path = find_lemonade_cli_bin(&app).ok_or_else(|| {
        "Lemonade CLI が見つかりません。".to_string()
    })?;

    let mut cmd = Command::new(&cli_path);
    apply_windows_no_window(&mut cmd);
    let output = cmd
        .arg("status")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Lemonade status の実行に失敗しました: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(if detail.is_empty() {
            "Lemonade status の実行に失敗しました。".to_string()
        } else {
            format!("Lemonade status の実行に失敗しました: {detail}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    for line in stdout.lines() {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.len() < 4 {
            continue;
        }
        for i in 0..(tokens.len() - 2) {
            if tokens[i].eq_ignore_ascii_case("llm")
                && tokens[i + 2].eq_ignore_ascii_case("llamacpp")
            {
                return Ok(tokens[i + 1].to_ascii_lowercase());
            }
        }
    }

    for line in stdout.lines() {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.len() < 3 {
            continue;
        }
        for i in 0..(tokens.len() - 1) {
            if tokens[i].eq_ignore_ascii_case("llm") {
                return Ok(tokens[i + 1].to_ascii_lowercase());
            }
        }
    }

    Ok("unknown".to_string())
}

/// CUDA llama-server を起動し、ポートが開く（=応答可能になる）まで待つ。OOM 検出付き。
/// `autofit` が true（12B）なら `--fit on` で起動し、本体・MTP ドラフトの GPU/CPU 配置を
/// llama.cpp の auto-fit に委ねる（VRAM に収まる分だけ GPU、残りは CPU）。これにより
/// gemma4-assistant ドラフトを GPU に載せても落ちず、収まる環境では GPU に載って高速化する。
/// false（E4B）なら従来どおり `-ngl 99` + `--spec-draft-ngl 99`（本体・ドラフトとも全 GPU）。
///
/// 成功時は child_arc にプロセスをセットして Ok(())。失敗時は Err（OOM 時は VRAM_OOM_MARKER 付き）。
#[allow(clippy::too_many_arguments)]
fn start_cuda_llama_blocking(
    bin: &str,
    model_path: &str,
    mtp_model_path: Option<&str>,
    port: u16,
    n_parallel: u32,
    ctx_size: u32,
    device_index: Option<i32>,
    autofit: bool,
    child_arc: &Arc<Mutex<Option<Child>>>,
    mode_arc: &Arc<AtomicU8>,
) -> Result<(), String> {
    let (child, oom_flag) = try_start_llama_server_cuda(
        bin,
        model_path,
        mtp_model_path,
        port,
        n_parallel,
        ctx_size,
        device_index,
        autofit,
    )?;
    *child_arc.lock().map_err(|_| "mutex poisoned".to_string())? = Some(child);

    // llama-server はモデルをロードしてから応答可能になるため、最大 60 秒待機する。
    for _ in 0..120 {
        thread::sleep(Duration::from_millis(500));
        if lemonade_app_port_open(port) {
            return Ok(());
        }
        // KV キャッシュ確保時の VRAM 不足を検出したら、残骸プロセスを kill して VRAM を解放し、
        // フロントが「並列処理数を下げて再試行」できるよう OOM マーカー付きで早期に失敗させる。
        // （auto-fit は通常 CPU へ逃がして OOM を回避するため、主に E4B の -ngl 99 経路向け。）
        if oom_flag.load(Ordering::Relaxed) {
            if let Ok(mut g) = child_arc.lock() {
                if let Some(mut c) = g.take() {
                    let _ = c.kill();
                    let _ = c.wait();
                }
            }
            mode_arc.store(0, Ordering::Relaxed);
            return Err(format!(
                "{VRAM_OOM_MARKER} AI校正エンジンの起動時にGPUメモリ(VRAM)が不足しました。並列処理数を下げて再試行してください。"
            ));
        }
    }
    Err("AI校正エンジン (CUDA) の起動タイムアウト（60秒）".to_string())
}

#[tauri::command]
async fn start_lemonade_server(
    app: AppHandle,
    state: tauri::State<'_, LemonadeServer>,
    hip_device_index: Option<i32>,
    llm_parallel: Option<u32>,
    llm_ctx: Option<u32>,
) -> Result<String, String> {
    let port = state.port.load(Ordering::Relaxed) as u16;
    if lemonade_app_port_open(port) {
        return Ok("already_running".to_string());
    }

    // NVIDIA GPU + llama-server バイナリ + GGUF モデルが揃っている場合は直接 CUDA 起動する
    let nvidia_list = nvidia_gpu_priority_list();
    let llama_server_bin = find_bundled_llama_server_bin(&app);
    let model_path = get_default_llm_model_path(app.clone());
    let mtp_model_path = match (&llama_server_bin, get_default_llm_mtp_model_path(&app)) {
        (Some(bin), Some(mtp)) if llama_server_supports_mtp(bin) => Some(mtp),
        _ => None,
    };

    let (cache_dir_str, resolved_port) = match get_lemonade_app_cache_dir(&app) {
        Some(p) => {
            let _ = std::fs::create_dir_all(&p);
            let rp = resolve_lemonade_port(&p);
            ensure_lemonade_app_port_config(&p, rp);
            ensure_lemonade_default_model_registered(&p);
            (Some(p.to_string_lossy().into_owned()), rp)
        }
        None => (None, 13306),
    };
    state.port.store(resolved_port as u32, Ordering::Relaxed);
    let child_arc = Arc::clone(&state.child);
    let mode_arc = Arc::clone(&state.mode);
    let parallel_arc = Arc::clone(&state.parallel);

    if !nvidia_list.is_empty() && llama_server_bin.is_some() && model_path.is_some() {
        let bin = llama_server_bin.unwrap();
        let mpath = model_path.unwrap();
        let mtp_path = mtp_model_path;
        // 選択された GPU（llmHipDeviceIndex / nvidia-smi index）の VRAM（MiB）を使う。
        // 未指定(-1/None)や該当なしのときは最良 GPU（VRAM 降順の先頭）にフォールバック。
        let sel_idx = hip_device_index.filter(|&i| i >= 0);
        let vram_mib = sel_idx
            .and_then(|idx| nvidia_list.iter().find(|g| g.0 == idx as u32))
            .or_else(|| nvidia_list.first())
            .map(|g| g.2)
            .unwrap_or(0);
        let (n_parallel, ctx_size) = choose_llm_parallelism(vram_mib, llm_parallel, llm_ctx);
        // 12B は auto-fit 起動（ドラフト含め GPU/CPU を llama.cpp が自動配置）。8GB クラスで本体を
        // 多く GPU に載せ高速化するため、ctx/np は AMD 12B と同じ単一スロット・8192 に揃える
        // （ctx16384/np2 だと KV が大きく本体が CPU に逃げて遅くなる実測。8192/np1 で約24 tok/s）。
        // E4B は従来どおり -ngl 99 + 自動 ctx/np。
        let is_12b = matches!(resolve_effective_proofread_tier(&app), GemmaTier::B12);
        let (n_parallel, ctx_size) = if is_12b {
            (1u32, AMD_12B_CTX_SIZE)
        } else {
            (n_parallel, ctx_size)
        };
        tauri::async_runtime::spawn_blocking(move || {
            mode_arc.store(1, Ordering::Relaxed);
            parallel_arc.store(n_parallel.min(255) as u8, Ordering::Relaxed);
            start_cuda_llama_blocking(
                &bin,
                &mpath,
                mtp_path.as_deref(),
                resolved_port,
                n_parallel,
                ctx_size,
                sel_idx,
                is_12b,
                &child_arc,
                &mode_arc,
            )?;
            Ok("started".to_string())
        })
        .await
        .map_err(|e| format!("AI校正エンジンの起動に失敗しました: {e}"))?
    } else if let Some((rocm, vulkan)) = amd_12b_launch_plan(&app) {
        // AMD GPU 直起動: 高精度(12B)+MTP。ROCm 優先 → 起動失敗時 Vulkan フォールバック（lemond 非経由）。
        // NVIDIA 直起動と同じく mode=1（per-job 停止・kill-on-close の対象）。単一スロット運用。
        tauri::async_runtime::spawn_blocking(move || {
            start_amd_12b_blocking(
                rocm,
                vulkan,
                &child_arc,
                &mode_arc,
                &parallel_arc,
                resolved_port,
                "started",
            )
        })
        .await
        .map_err(|e| format!("AI校正エンジンの起動に失敗しました: {e}"))?
    } else {
        let bin_path = find_lemonade_bundled_bin(&app).ok_or_else(|| {
            "AI校正エンジンを起動できませんでした。セットアップタブでGPUランタイムとAI校正モデルの準備が完了しているか確認し、アプリを再起動してください。".to_string()
        })?;
        tauri::async_runtime::spawn_blocking(move || {
            mode_arc.store(0, Ordering::Relaxed);
            let child = try_start_lemonade_bin(&bin_path, cache_dir_str.as_deref(), hip_device_index)?;
            *child_arc.lock().map_err(|_| "mutex poisoned".to_string())? = Some(child);
            for _ in 0..60 {
                thread::sleep(Duration::from_millis(500));
                if lemonade_app_port_open(resolved_port) {
                    return Ok("started".to_string());
                }
            }
            Err("AI校正エンジンの起動タイムアウト（30秒）".to_string())
        })
        .await
        .map_err(|e| format!("AI校正エンジンの起動に失敗しました: {e}"))?
    }
}

/// Lemonade バックエンドバイナリをダウンロード・インストールする（初回セットアップ時・要インターネット接続）。
/// backend: "llamacpp:rocm" / "llamacpp:vulkan" / "llamacpp:cpu" のいずれか。
#[tauri::command]
async fn install_lemonade_backend(
    app: AppHandle,
    state: tauri::State<'_, LemonadeServer>,
    backend: String,
) -> Result<String, String> {
    use std::io::{BufRead, BufReader};

    const ALLOWED: &[&str] = &[
        "llamacpp:cuda",
        "llamacpp:rocm",
        "llamacpp:vulkan",
        "llamacpp:cpu",
        "whispercpp:cpu",
        "whispercpp:vulkan",
    ];
    if !ALLOWED.contains(&backend.as_str()) {
        return Err(format!("未サポートのバックエンド名です: {backend}"));
    }

    let cli_path = find_lemonade_cli_bin(&app)
        .ok_or_else(|| "Lemonade CLI が見つかりません。セットアップを実行してください。".to_string())?;

    let port = state.port.load(Ordering::Relaxed) as u16;
    let app_clone = app.clone();
    let backend_clone = backend.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&cli_path);
        apply_windows_no_window(&mut cmd);
        if port > 0 {
            cmd.env("LEMONADE_PORT", port.to_string());
        }
        cmd.arg("backends").arg("install").arg(&backend_clone);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = cmd.spawn()
            .map_err(|e| format!("バックエンドインストールの起動に失敗しました: {e}"))?;

        // stdout を行単位で読み取り、フロントエンドへ進捗を通知する
        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(msg) = line {
                    let msg = msg.trim().to_string();
                    if msg.is_empty() { continue; }
                    let _ = app_clone.emit(
                        "lemonade-backend-install-progress",
                        serde_json::json!({"message": msg}),
                    );
                }
            }
        }

        let status = child.wait()
            .map_err(|e| format!("インストール完了待ちに失敗: {e}"))?;

        if status.success() {
            Ok(format!("{backend_clone} のインストールが完了しました。"))
        } else {
            Err(format!(
                "{backend_clone} のインストールに失敗しました。インターネット接続を確認してください。"
            ))
        }
    })
    .await
    .map_err(|e| format!("バックエンドインストールタスクエラー: {e}"))?
}

// オフライン動作専用: winget は使用しない。バンドルバイナリを起動するだけ
#[tauri::command]
async fn install_lemonade(app: AppHandle, state: tauri::State<'_, LemonadeServer>) -> Result<String, String> {
    // NVIDIA GPU + llama-server バイナリ + GGUF モデルが揃っている場合は直接 CUDA 起動する
    let nvidia_list = nvidia_gpu_priority_list();
    let llama_server_bin = find_bundled_llama_server_bin(&app);
    let model_path = get_default_llm_model_path(app.clone());
    let mtp_model_path = match (&llama_server_bin, get_default_llm_mtp_model_path(&app)) {
        (Some(bin), Some(mtp)) if llama_server_supports_mtp(bin) => Some(mtp),
        _ => None,
    };

    let (cache_dir_str, resolved_port) = match get_lemonade_app_cache_dir(&app) {
        Some(p) => {
            let _ = std::fs::create_dir_all(&p);
            let rp = resolve_lemonade_port(&p);
            ensure_lemonade_app_port_config(&p, rp);
            ensure_lemonade_default_model_registered(&p);
            (Some(p.to_string_lossy().into_owned()), rp)
        }
        None => (None, 13306),
    };
    state.port.store(resolved_port as u32, Ordering::Relaxed);
    let child_arc = Arc::clone(&state.child);
    let mode_arc = Arc::clone(&state.mode);
    let parallel_arc = Arc::clone(&state.parallel);
    let app_clone = app.clone();

    if !nvidia_list.is_empty() && llama_server_bin.is_some() && model_path.is_some() {
        let bin = llama_server_bin.unwrap();
        let mpath = model_path.unwrap();
        let mtp_path = mtp_model_path;
        // VRAM から並列スロット数・コンテキスト長を自動決定（install/start 経路は上書きなし=auto）
        let vram_mib = nvidia_list.first().map(|g| g.2).unwrap_or(0);
        let (n_parallel, ctx_size) = choose_llm_parallelism(vram_mib, None, None);
        // 12B は auto-fit 起動。ctx/np は AMD 12B と同じ単一スロット・8192 に揃える
        // （auto-fit が本体を多く GPU に載せ高速化するため）。E4B は従来の自動値。
        let is_12b = matches!(resolve_effective_proofread_tier(&app), GemmaTier::B12);
        let (n_parallel, ctx_size) = if is_12b {
            (1u32, AMD_12B_CTX_SIZE)
        } else {
            (n_parallel, ctx_size)
        };
        tauri::async_runtime::spawn_blocking(move || {
            let _ = app_clone.emit(
                "lemonade-install-progress",
                serde_json::json!({"stage": "starting", "message": "AI校正エンジンを起動中..."}),
            );
            mode_arc.store(1, Ordering::Relaxed);
            parallel_arc.store(n_parallel.min(255) as u8, Ordering::Relaxed);
            // install/start 経路はデバイス選択 UI を経由しないため None（llama.cpp 既定）
            start_cuda_llama_blocking(
                &bin,
                &mpath,
                mtp_path.as_deref(),
                resolved_port,
                n_parallel,
                ctx_size,
                None,
                is_12b,
                &child_arc,
                &mode_arc,
            )?;
            Ok("installed_and_started".to_string())
        })
        .await
        .map_err(|e| format!("AI校正エンジンの起動に失敗しました: {e}"))?
    } else if let Some((rocm, vulkan)) = amd_12b_launch_plan(&app) {
        // AMD GPU 直起動: 高精度(12B)+MTP。ROCm 優先 → 起動失敗時 Vulkan フォールバック（lemond 非経由）。
        tauri::async_runtime::spawn_blocking(move || {
            let _ = app_clone.emit(
                "lemonade-install-progress",
                serde_json::json!({"stage": "starting", "message": "AI校正エンジン(高精度12B)を起動中..."}),
            );
            start_amd_12b_blocking(
                rocm,
                vulkan,
                &child_arc,
                &mode_arc,
                &parallel_arc,
                resolved_port,
                "installed_and_started",
            )
        })
        .await
        .map_err(|e| format!("AI校正エンジンの起動に失敗しました: {e}"))?
    } else {
        let bin_path = find_lemonade_bundled_bin(&app).ok_or_else(|| {
            "AI校正エンジンを起動できませんでした。セットアップタブでGPUランタイムとAI校正モデルの準備が完了しているか確認し、アプリを再起動してください。".to_string()
        })?;
        tauri::async_runtime::spawn_blocking(move || {
            let _ = app_clone.emit(
                "lemonade-install-progress",
                serde_json::json!({"stage": "starting", "message": "AI校正エンジンを起動中..."}),
            );
            mode_arc.store(0, Ordering::Relaxed);
            let child = try_start_lemonade_bin(&bin_path, cache_dir_str.as_deref(), None)?;
            *child_arc.lock().map_err(|_| "mutex poisoned".to_string())? = Some(child);
            for _ in 0..60 {
                thread::sleep(Duration::from_millis(500));
                if lemonade_app_port_open(resolved_port) {
                    return Ok("installed_and_started".to_string());
                }
            }
            Err("AI校正エンジンの起動タイムアウト（30秒）".to_string())
        })
        .await
        .map_err(|e| format!("AI校正エンジンの起動に失敗しました: {e}"))?
    }
}

#[tauri::command]
fn stop_lemonade_server(state: tauri::State<'_, LemonadeServer>) -> Result<(), String> {
    let mut guard = state.child.lock().map_err(|_| "mutex poisoned".to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = kill_process_tree_by_pid(child.id());
        let _ = child.kill();
    }
    Ok(())
}

static TRANSCRIPTION_PID: AtomicU32 = AtomicU32::new(0);
static PROOFREAD_PID: AtomicU32 = AtomicU32::new(0);
static LLM_PROOFREAD_PID: AtomicU32 = AtomicU32::new(0);
static DIARIZATION_PID: AtomicU32 = AtomicU32::new(0);
static LLM_PROOFREAD_INVOCATION_COUNTER: AtomicU64 = AtomicU64::new(0);
static TRANSCRIPTION_CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);
static PROOFREAD_CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);
static LLM_PROOFREAD_CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);
static DIARIZATION_CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

// 二重起動ガード用フラグ。
// GPU/モデルを多重ロードしないよう、コマンド単位で同種タスクの同時実行を排他する。
// AI校正（句読点付与）と全体校正は同じ gemma を VRAM にロードし、キャンセル PID スロットも
// 共有しているため、1つの LLM_PROOFREAD_ACTIVE で相互排他する。
static TRANSCRIPTION_ACTIVE: AtomicBool = AtomicBool::new(false);
static DIARIZATION_ACTIVE: AtomicBool = AtomicBool::new(false);
static LLM_PROOFREAD_ACTIVE: AtomicBool = AtomicBool::new(false);

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

#[derive(Copy, Clone)]
enum RunningTaskKind {
    Transcription,
    Proofread,
    LlmProofread,
    Diarization,
}

fn set_running_pid(kind: RunningTaskKind, pid: u32) {
    match kind {
        RunningTaskKind::Transcription => TRANSCRIPTION_PID.store(pid, Ordering::SeqCst),
        RunningTaskKind::Proofread => PROOFREAD_PID.store(pid, Ordering::SeqCst),
        RunningTaskKind::LlmProofread => LLM_PROOFREAD_PID.store(pid, Ordering::SeqCst),
        RunningTaskKind::Diarization => DIARIZATION_PID.store(pid, Ordering::SeqCst),
    }
}

fn clear_running_pid(kind: RunningTaskKind) {
    match kind {
        RunningTaskKind::Transcription => TRANSCRIPTION_PID.store(0, Ordering::SeqCst),
        RunningTaskKind::Proofread => PROOFREAD_PID.store(0, Ordering::SeqCst),
        RunningTaskKind::LlmProofread => LLM_PROOFREAD_PID.store(0, Ordering::SeqCst),
        RunningTaskKind::Diarization => DIARIZATION_PID.store(0, Ordering::SeqCst),
    }
}

fn get_running_pid(kind: RunningTaskKind) -> u32 {
    match kind {
        RunningTaskKind::Transcription => TRANSCRIPTION_PID.load(Ordering::SeqCst),
        RunningTaskKind::Proofread => PROOFREAD_PID.load(Ordering::SeqCst),
        RunningTaskKind::LlmProofread => LLM_PROOFREAD_PID.load(Ordering::SeqCst),
        RunningTaskKind::Diarization => DIARIZATION_PID.load(Ordering::SeqCst),
    }
}

fn set_cancel_requested(kind: RunningTaskKind, requested: bool) {
    match kind {
        RunningTaskKind::Transcription => {
            TRANSCRIPTION_CANCEL_REQUESTED.store(requested, Ordering::SeqCst)
        }
        RunningTaskKind::Proofread => PROOFREAD_CANCEL_REQUESTED.store(requested, Ordering::SeqCst),
        RunningTaskKind::LlmProofread => {
            LLM_PROOFREAD_CANCEL_REQUESTED.store(requested, Ordering::SeqCst)
        }
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
        RunningTaskKind::LlmProofread => {
            LLM_PROOFREAD_CANCEL_REQUESTED.swap(false, Ordering::SeqCst)
        }
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
    audio_path: String,
    diarization: bool,
    speaker_count: Option<u8>,
    device: Option<String>,
    compute_type: Option<String>,
    model: Option<String>,
    language: Option<String>,
    initial_prompt: Option<String>,
    normalize_audio: Option<bool>,
    highpass_filter: Option<bool>,
    noise_reduction: Option<bool>,
    noise_reduction_mode: Option<String>,
    parallel_diarization: Option<bool>,
    clustering_threshold: Option<f64>,
    hip_device_index: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunTranscriptionResponse {
    success: bool,
    result: Option<Value>,
    error_message: Option<String>,
}

fn normalize_noise_reduction_mode(value: Option<&str>) -> &'static str {
    match value
        .unwrap_or("standard")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "weak" => "weak",
        _ => "standard",
    }
}

/// 文字起こし言語コードを正規化する。
///
/// faster-whisper が受け付けるのは ISO 639-1 系の 2〜3 文字コード（例: `ja` / `en` /
/// `haw` / `yue`）。pyannote の話者分離は言語非依存なので、対応言語の集合は
/// faster-whisper のトークナイザー側に委ねる（不正値は sidecar が弾く）。ここでは
/// 形式チェックのみ行い、空・不正時は既定の `ja` にフォールバックする。
fn normalize_transcription_language(value: Option<&str>) -> String {
    let v = value.unwrap_or("ja").trim().to_ascii_lowercase();
    if (2..=3).contains(&v.len()) && v.chars().all(|c| c.is_ascii_lowercase()) {
        v
    } else {
        "ja".to_string()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunDiarizationRequest {
    audio_path: String,
    speaker_count: Option<u8>,
    device: Option<String>,
    result: Value,
    clustering_threshold: Option<f64>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProofreadRuntimeConfigRequest {
    chunk_size: Option<i64>,
    chunk_max_chars: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProofreadRuntimeConfigResponse {
    chunk_size: i64,
    chunk_max_chars: i64,
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
struct LlmProofreadRequest {
    segments: Vec<ProofreadSegmentInput>,
    model_path: String,
    n_gpu_layers: Option<i32>,
    system_prompt: Option<String>,
    backend: Option<String>,
    lemonade_url: Option<String>,
    lemonade_model: Option<String>,
    openai_base_url: Option<String>,
    openai_model: Option<String>,
    n_ctx: Option<i64>,
    max_batch: Option<i64>,
    prompt_type: Option<String>,
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
                "けれども", "けれど", "けども", "けど", "が", "して", "くて", "って", "て",
                "で", "し", "から", "ので", "のに", "とか", "たり", "たら", "ば", "なら",
                "ながら", "つつ", "と", "に", "を", "は", "も", "や", "へ",
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
        let el = Regex::new(r"^[一-龥々ぁ-ゖァ-ヶーA-Za-z0-9０-９・･]{1,8}(?:小学校|義務教育学校)$")
            .expect("default elementary regex");
        let mid = Regex::new(r"^[一-龥々ぁ-ゖァ-ヶーA-Za-z0-9０-９・･]{1,8}(?:中学校|中等教育学校)$")
            .expect("default middle regex");
        let hi = Regex::new(r"^[一-龥々ぁ-ゖァ-ヶーA-Za-z0-9０-９・･]{1,8}(?:高校|高等学校)$")
            .expect("default high regex");
        let nu = Regex::new(r"^[一-龥々ぁ-ゖァ-ヶーA-Za-z0-9０-９・･]{1,8}(?:保育園|保育所|認定こども園|こども園)$")
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallDiarizationModelResponse {
    success: bool,
    message: String,
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
    lemonade_backend: bool,
    python_env: bool,
    python_env_expected_path: String,
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
struct SaveTextShiftJisRequest {
    path: String,
    content: String,
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
struct DiarizationModelStatusResponse {
    exists: bool,
    has_config: bool,
    expected_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptionRuntimeStatusResponse {
    available: bool,
    reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DevEmulationStatusResponse {
    mode: String,
    no_cuda: bool,
    missing_community_1: bool,
}

struct SidecarExecResult {
    status: std::process::ExitStatus,
    stdout: String,
    stderr: String,
}

fn get_python_bin(_app: &AppHandle) -> String {
    // 1. 明示的な環境変数オーバーライド
    if let Ok(value) = env::var("PYTHON_BIN") {
        let normalized = normalize_python_bin_candidate(&value);
        if is_usable_python_bin_candidate(&normalized) {
            return normalized;
        }
    }

    // 2. Windows: dev では .venv312、production では resources/python312
    #[cfg(target_os = "windows")]
    {
        if cfg!(debug_assertions) {
            let dev_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join(".venv312")
                .join("Scripts")
                .join("python.exe");
            if dev_candidate.exists() {
                return dev_candidate.to_string_lossy().to_string();
            }
        }

        if let Ok(resource_dir) = _app.path().resource_dir() {
            for subdir in &["resources/python312", "python312"] {
                let bundled = resource_dir.join(subdir).join("python.exe");
                if bundled.exists() {
                    return bundled.to_string_lossy().to_string();
                }
            }
        }
    }

    // 3. フォールバック
    if cfg!(target_os = "windows") {
        "py".to_string()
    } else {
        "python3".to_string()
    }
}

fn resolve_default_python_bin() -> String {
    if let Ok(value) = env::var("PYTHON_BIN") {
        let normalized = normalize_python_bin_candidate(&value);
        if is_usable_python_bin_candidate(&normalized) {
            return normalized;
        }
    }
    if cfg!(target_os = "windows") { "py".to_string() } else { "python3".to_string() }
}

fn normalize_python_bin_candidate(value: &str) -> String {
    value.trim().trim_matches('"').to_string()
}

fn is_usable_python_bin_candidate(value: &str) -> bool {
    if value.is_empty() {
        return false;
    }
    let as_path = Path::new(value);
    if as_path.exists() {
        return true;
    }

    // Non-path command names such as "py" / "python" are still valid candidates.
    !(value.contains('\\') || value.contains('/') || value.contains(':'))
}

#[tauri::command]
fn save_transcription_json(app: AppHandle, request: SaveTranscriptionJsonRequest) -> Result<(), String> {
    if let Some(pw) = request.password.as_deref().filter(|p| !p.is_empty()) {
        // Write temp JSON, then have Python create AES-256 ZIP via pyzipper
        let temp_path = format!("{}.tmp", request.path);
        fs::write(&temp_path, &request.content)
            .map_err(|e| format!("一時ファイル書き込みに失敗しました: {e}"))?;
        let result = encrypt_json_to_zip(&app, &temp_path, &request.path, pw);
        let _ = fs::remove_file(&temp_path);
        result
    } else {
        fs::write(&request.path, request.content).map_err(|e| format!("JSON 保存に失敗しました: {e}"))
    }
}

#[tauri::command]
fn save_text_shift_jis(request: SaveTextShiftJisRequest) -> Result<(), String> {
    let (bytes, _, _) = SHIFT_JIS.encode(&request.content);
    fs::write(&request.path, bytes.as_ref())
        .map_err(|e| format!("Shift-JIS テキスト保存に失敗しました: {e}"))
}

fn install_diarization_model_impl(
    app: &AppHandle,
    token: &str,
) -> Result<InstallDiarizationModelResponse, String> {
    let model_dir = resolve_default_diarization_model_dir(app)?;
    fs::create_dir_all(&model_dir)
        .map_err(|e| format!("モデル保存先ディレクトリの作成に失敗しました: {e}"))?;

    let default_python_bin = resolve_default_python_bin();
    let python_bin = resolve_diarization_python_bin(app, &default_python_bin);

    let mut pip_cmd = Command::new(&python_bin);
    apply_windows_no_window(&mut pip_cmd);
    pip_cmd
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .arg("-m")
        .arg("pip")
        .arg("install")
        .arg("--upgrade")
        .arg("huggingface-hub<1.0")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let pip_output = pip_cmd
        .output()
        .map_err(|e| format!("huggingface-hub の準備に失敗しました: {e}"))?;
    if !pip_output.status.success() {
        let stderr = String::from_utf8_lossy(&pip_output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&pip_output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Ok(InstallDiarizationModelResponse {
            success: false,
            message: format!("huggingface-hub のインストールに失敗しました。{detail}"),
        });
    }

    let script_path = resolve_download_diarization_model_script_path(app)
        .map_err(|e| format!("話者分離ダウンロードスクリプトが見つかりません: {e}"))?;

    let mut dl_cmd = Command::new(&python_bin);
    apply_windows_no_window(&mut dl_cmd);
    dl_cmd
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("HF_TOKEN", token)
        .arg(&script_path)
        .arg(model_dir.to_string_lossy().as_ref());

    match run_download_streaming(app, &mut dl_cmd, "diarization") {
        Ok(msg) => Ok(InstallDiarizationModelResponse { success: true, message: msg }),
        Err(e) => Ok(InstallDiarizationModelResponse { success: false, message: e }),
    }
}

#[tauri::command]
fn save_transcription_docx(app: AppHandle, request: SaveTranscriptionDocxRequest) -> Result<(), String> {
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

    let file = fs::File::create(&request.path)
        .map_err(|e| format!("Word ファイル作成に失敗しました: {e}"))?;
    let mut zip = ZipWriter::new(file);
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

    zip.finish()
        .map_err(|e| format!("DOCX 生成の完了に失敗しました: {e}"))?;

    if let Some(pw) = request.password.as_deref().filter(|p| !p.is_empty()) {
        if let Err(e) = encrypt_office_file(&app, &request.path, pw) {
            let _ = fs::remove_file(&request.path);
            return Err(e);
        }
    }

    Ok(())
}

#[tauri::command]
fn save_transcription_xlsx(app: AppHandle, request: SaveTranscriptionXlsxRequest) -> Result<(), String> {
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

    let file = fs::File::create(&request.path)
        .map_err(|e| format!("Excel ファイル作成に失敗しました: {e}"))?;
    let mut zip = ZipWriter::new(file);
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

    zip.finish()
        .map_err(|e| format!("XLSX 生成の完了に失敗しました: {e}"))?;

    if let Some(pw) = request.password.as_deref().filter(|p| !p.is_empty()) {
        if let Err(e) = encrypt_office_file(&app, &request.path, pw) {
            let _ = fs::remove_file(&request.path);
            return Err(e);
        }
    }

    Ok(())
}

/// スコープ離脱時（早期 return・`?`・panic を含む）に登録済みの一時ファイルを
/// 必ず削除する RAII ガード。会話本文や校正プロンプトなど PII を含む一時ファイルの
/// 取り残しを防ぐ。
struct TempFileGuard {
    paths: Vec<PathBuf>,
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

fn run_encrypt_script(app: &AppHandle, args: &[&str], password: &str) -> Result<(), String> {
    use std::io::Write;

    let script_path = resolve_encrypt_office_script_path(app)?;
    let python_bin = get_python_bin(app);

    let mut cmd = Command::new(&python_bin);
    apply_windows_no_window(&mut cmd);
    cmd.env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .arg(&script_path);
    for arg in args {
        cmd.arg(arg);
    }
    // パスワードはコマンドライン引数ではなく stdin 経由で渡す。Windows では同一
    // ユーザーの他プロセスが実行中プロセスの引数（コマンドライン）を参照できるため、
    // PII 保護対象である暗号化パスワードを argv に載せない。
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("暗号化スクリプトの起動に失敗しました: {e}"))?;

    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "暗号化スクリプトの stdin 取得に失敗しました。".to_string())?;
        stdin
            .write_all(password.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .map_err(|e| format!("暗号化パスワードの送信に失敗しました: {e}"))?;
        // stdin をここで drop して EOF を送る。
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("暗号化スクリプトの実行に失敗しました: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ファイルの暗号化に失敗しました: {stderr}"));
    }

    Ok(())
}

fn encrypt_office_file(app: &AppHandle, file_path: &str, password: &str) -> Result<(), String> {
    run_encrypt_script(app, &["office", file_path], password)
}

fn encrypt_json_to_zip(app: &AppHandle, json_temp: &str, zip_path: &str, password: &str) -> Result<(), String> {
    run_encrypt_script(app, &["json", json_temp, zip_path], password)
}

// ─── Audio streaming server ──────────────────────────────────────────────────
// A minimal HTTP/1.1 server bound to 127.0.0.1 that serves local audio files
// with Range request support.  This lets GStreamer (WebKitGTK media backend)
// seek by making byte-range requests — something blob:// URLs cannot provide.

struct AudioStreamServer {
    port: u16,
    allowed_path: Arc<Mutex<Option<String>>>,
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

fn serve_audio_connection(mut stream: std::net::TcpStream, allowed_path: Arc<Mutex<Option<String>>>) {
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

    // Respond to CORS preflight
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

    let url_path = parts[1].trim_start_matches('/');
    let file_path = url_decode_path(url_path);

    // 登録済みパスと一致するか確認（パストラバーサル防止）
    let allowed = {
        let guard = allowed_path.lock().unwrap_or_else(|e| e.into_inner());
        guard.clone()
    };
    let is_allowed = allowed.as_deref().map(|a| {
        let req = std::fs::canonicalize(&file_path).ok();
        let all = std::fs::canonicalize(a).ok();
        req.is_some() && req == all
    }).unwrap_or(false);
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
    let status = if range_opt.is_some() { "206 Partial Content" } else { "200 OK" };

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

fn start_audio_stream_server(allowed_path: Arc<Mutex<Option<String>>>) -> u16 {
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0").expect("audio stream server bind failed");
    let port = listener.local_addr().expect("audio stream server addr").port();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let ap = Arc::clone(&allowed_path);
            thread::spawn(move || serve_audio_connection(stream, ap));
        }
    });
    port
}

#[tauri::command]
fn get_audio_stream_port(state: tauri::State<'_, AudioStreamServer>) -> u16 {
    state.port
}

#[tauri::command]
fn set_audio_allowed_path(path: String, state: tauri::State<'_, AudioStreamServer>) {
    let mut guard = state.allowed_path.lock().unwrap_or_else(|e| e.into_inner());
    *guard = if path.is_empty() { None } else { Some(path) };
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
        candidate.canonicalize().ok().map(|p| p.to_string_lossy().into_owned())
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
fn dev_delete_downloaded_models(target: Option<String>) -> DevDeleteModelsResponse {
    if !cfg!(debug_assertions) {
        return DevDeleteModelsResponse {
            deleted: vec![],
            not_found: vec![],
            errors: vec!["dev ビルドでのみ使用できます".to_string()],
        };
    }

    let target = target.as_deref().unwrap_or("all");
    let mut deleted: Vec<String> = vec![];
    let mut not_found: Vec<String> = vec![];
    let mut errors: Vec<String> = vec![];

    let delete_whisper_turbo = target == "all" || target == "whisper_turbo";
    let delete_whisper_large_v3 = target == "all" || target == "whisper_large_v3";
    let delete_diarization = target == "all" || target == "diarization";
    let delete_llm = target == "all" || target == "llm";

    let hub = get_hf_hub_cache();

    // Whisper turbo (HuggingFace Hub cache)
    if delete_whisper_turbo {
        for name in &[
            "models--mobiuslabsgmbh--faster-whisper-large-v3-turbo",
            "models--Systran--faster-whisper-turbo",
        ] {
            let path = hub.join(name);
            if path.exists() {
                match fs::remove_dir_all(&path) {
                    Ok(_) => deleted.push(path.to_string_lossy().into_owned()),
                    Err(e) => errors.push(format!("{}: {e}", path.display())),
                }
            } else {
                not_found.push(path.to_string_lossy().into_owned());
            }
        }
    }

    // Whisper large-v3 (HuggingFace Hub cache)
    if delete_whisper_large_v3 {
        let path = hub.join("models--Systran--faster-whisper-large-v3");
        if path.exists() {
            match fs::remove_dir_all(&path) {
                Ok(_) => deleted.push(path.to_string_lossy().into_owned()),
                Err(e) => errors.push(format!("{}: {e}", path.display())),
            }
        } else {
            not_found.push(path.to_string_lossy().into_owned());
        }
    }

    let sidecar_base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("python_sidecar");

    // Diarization model (project-relative)
    if delete_diarization {
        for name in &[
            "pyannote-speaker-diarization-community-1",
            "pyannote-speaker-diarization",
        ] {
            let path = sidecar_base.join("models").join(name);
            if path.exists() {
                match fs::remove_dir_all(&path) {
                    Ok(_) => deleted.push(path.to_string_lossy().into_owned()),
                    Err(e) => errors.push(format!("{}: {e}", path.display())),
                }
            } else {
                not_found.push(path.to_string_lossy().into_owned());
            }
        }
    }

    // Gemma GGUF model (project-relative)
    if delete_llm {
        let gemma_dir = sidecar_base.join("models").join("llm");
        if gemma_dir.exists() {
            match fs::remove_dir_all(&gemma_dir) {
                Ok(_) => deleted.push(gemma_dir.to_string_lossy().into_owned()),
                Err(e) => errors.push(format!("{}: {e}", gemma_dir.display())),
            }
        } else {
            not_found.push(gemma_dir.to_string_lossy().into_owned());
        }
    }

    DevDeleteModelsResponse { deleted, not_found, errors }
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
fn get_proofread_system_prompt(app: AppHandle) -> Result<ReadTextFileResponse, String> {
    let path = resolve_proofread_system_prompt_path(&app)?;
    let content = read_text_file_content(&path)?;
    Ok(ReadTextFileResponse { content })
}

#[tauri::command]
fn get_default_proofread_system_prompt(app: AppHandle) -> Result<ReadTextFileResponse, String> {
    let path = resolve_default_proofread_system_prompt_path(&app)?;
    let content = read_text_file_content(&path)?;
    Ok(ReadTextFileResponse { content })
}

#[tauri::command]
fn get_overall_proofread_system_prompt(app: AppHandle) -> Result<ReadTextFileResponse, String> {
    let path = resolve_overall_proofread_system_prompt_path(&app)?;
    let content = read_text_file_content(&path)?;
    Ok(ReadTextFileResponse { content })
}

#[tauri::command]
fn get_default_overall_proofread_system_prompt(app: AppHandle) -> Result<ReadTextFileResponse, String> {
    let path = resolve_default_overall_proofread_system_prompt_path(&app)?;
    let content = read_text_file_content(&path)?;
    Ok(ReadTextFileResponse { content })
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
fn open_external_url(url: String) -> Result<(), String> {
    let normalized = url.trim();
    let allowed_prefixes = [
        "https://huggingface.co/",
        "https://developer.nvidia.com/cuda-12-9-2-download-archive",
        "https://developer.nvidia.com/cudnn-downloads",
        "https://rocm.docs.amd.com/projects/install-on-linux/en/latest/install/quick-start.html",
        "https://rocm.docs.amd.com/projects/install-on-windows/en/latest/install/install.html",
    ];
    if !allowed_prefixes.iter().any(|p| normalized.starts_with(p)) {
        return Err("許可されていない URL です。".to_string());
    }
    // cmd /C start に渡す前にシェルメタキャラクターを拒否する
    if normalized.chars().any(|c| matches!(c, '&' | '|' | ';' | '`' | '\'' | '"' | '\n' | '\r' | '\0')) {
        return Err("URL に許可されていない文字が含まれています。".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("cmd");
        apply_windows_no_window(&mut cmd);
        cmd.args(["/C", "start", "", normalized])
            .spawn()
            .map_err(|e| format!("URL を開けませんでした: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(normalized)
            .spawn()
            .map_err(|e| format!("URL を開けませんでした: {e}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(normalized)
            .spawn()
            .map_err(|e| format!("URL を開けませんでした: {e}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("この OS では URL オープンに対応していません。".to_string())
}

#[tauri::command]
async fn check_transcription_runtime_support(
    app: AppHandle,
) -> Result<TranscriptionRuntimeStatusResponse, String> {
    // torch インポート + CUDA 初期化を伴う Python サブプロセスは数秒かかるため、
    // メインスレッド（UI スレッド）で実行すると UI が固まる。spawn_blocking で
    // ワーカースレッドへ逃がし、UI を止めずに再確認できるようにする。
    tauri::async_runtime::spawn_blocking(move || check_transcription_runtime_support_blocking(app))
        .await
        .map_err(|e| format!("GPU ランタイム確認タスクの実行に失敗しました: {e}"))?
}

fn check_transcription_runtime_support_blocking(
    app: AppHandle,
) -> Result<TranscriptionRuntimeStatusResponse, String> {
    if should_emulate_no_cuda() {
        return Ok(TranscriptionRuntimeStatusResponse {
            available: false,
            reason:
                "開発用エミュレーションで CUDA を無効化しています（OFFLINE_TRANSCRIBER_DEV_EMULATION_MODE=no_cuda）。"
                    .to_string(),
        });
    }
    // Python パッケージ未インストールの場合は torch インポートが失敗するため、
    // 先にセットアップ状態を確認して誤解を招くメッセージを防ぐ。
    #[cfg(target_os = "windows")]
    {
        let (python_ready, _) = check_python_venv(&app);
        if !python_ready {
            return Ok(TranscriptionRuntimeStatusResponse {
                available: false,
                reason: "Python 環境がセットアップされていません。セットアップタブでインストールを実行してください。".to_string(),
            });
        }
    }
    if should_emulate_missing_community_1() {
        return Ok(TranscriptionRuntimeStatusResponse {
            available: true,
            reason:
                "開発用エミュレーションで community-1 未配置のみを再現しています（OFFLINE_TRANSCRIBER_DEV_EMULATION_MODE=missing_community1）。"
                    .to_string(),
        });
    }

    strip_python312_pth_bom(&app);

    let default_python_bin = resolve_default_python_bin();
    let python_bin = resolve_diarization_python_bin(&app, &default_python_bin);

    let mut cmd = Command::new(&python_bin);
    apply_windows_no_window(&mut cmd);
    cmd.env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .arg("-c")
        .arg(
            "import json, torch; available=bool(torch.cuda.is_available()) and int(torch.cuda.device_count())>0; hip=bool(getattr(torch.version,'hip',None)); print(json.dumps({'available': available, 'hip': hip}))",
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    apply_child_runtime_env(&mut cmd, "cuda", None);

    let output = cmd.output().map_err(|e| {
        format!(
            "GPU ランタイム確認の実行に失敗しました (python={}): {e}",
            python_bin
        )
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let detail = if !stderr.is_empty() { &stderr } else if !stdout.is_empty() { &stdout } else { "" };
        let reason = if detail.is_empty() {
            "GPU ランタイム確認の実行に失敗しました。".to_string()
        } else {
            format!("GPU ランタイム確認でエラーが発生しました: {detail}")
        };
        return Ok(TranscriptionRuntimeStatusResponse {
            available: false,
            reason,
        });
    }

    let parsed = serde_json::from_str::<Value>(&stdout).unwrap_or(Value::Null);
    let available = parsed
        .get("available")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if available {
        let is_rocm = parsed
            .get("hip")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let reason = if is_rocm {
            "AMD GPU（ROCm / HIP）で GPU 推論が利用可能です。".to_string()
        } else {
            "CUDA が利用可能です。".to_string()
        };
        return Ok(TranscriptionRuntimeStatusResponse { available: true, reason });
    }

    let reason = parsed
        .get("error")
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .unwrap_or_else(|| "GPU が確認できませんでした。CPU モードで動作します。".to_string());
    Ok(TranscriptionRuntimeStatusResponse {
        available: false,
        reason,
    })
}

fn xml_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// 指定ディレクトリ配下に huggingface_hub のダウンロード中断マーカー
/// （`*.incomplete`）が残っているかを再帰的に調べる。
///
/// 走査中の IO エラーは「マーカー無し」として扱い、決して panic しない。
/// これは「完了しているのに未完了と誤判定する（= false negative）」を避けるため。
/// 実際にマーカーを見つけたときだけ true を返す。
fn has_incomplete_download_markers(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if file_type.is_dir() {
            if has_incomplete_download_markers(&path) {
                return true;
            }
        } else if path.extension().and_then(|e| e.to_str()) == Some("incomplete") {
            return true;
        }
    }
    false
}

/// 話者分離モデル（pyannote community-1）が「実行に使える完全な状態」かを判定する。
///
/// 設定タブのインストール状況表示・ダウンロード要否判定の**専用**ヘルパー。
/// アプリ起動の初期化経路（Tauri `setup` 等）からは呼ばない（呼ぶと判定コストや
/// 誤判定が起動を巻き込むため）。`config.yaml` だけでなく、それが参照する実体ファイル
/// （segmentation / embedding / plda）の存在と非空サイズ、さらに DL 中断マーカーの
/// 不在まで確認することで、「途中で切れて一部だけ揃った状態」を正しく未完了と判定する。
///
/// IO エラーで panic しない。判定不能なものは「未完了（false）」側へ倒す。
fn diarization_model_is_complete(model_dir: &Path) -> bool {
    // config.yaml が参照する実体ファイル。いずれも存在し、サイズが 0 でないこと。
    const ESSENTIAL_FILES: &[&[&str]] = &[
        &["config.yaml"],
        &["segmentation", "pytorch_model.bin"],
        &["embedding", "pytorch_model.bin"],
        &["plda", "plda.npz"],
        &["plda", "xvec_transform.npz"],
    ];
    for parts in ESSENTIAL_FILES {
        let mut path = model_dir.to_path_buf();
        for part in *parts {
            path.push(part);
        }
        match fs::metadata(&path) {
            Ok(meta) if meta.is_file() && meta.len() > 0 => {}
            _ => return false,
        }
    }

    // ダウンロードが途中で止まっていれば未完了扱い（補完 DL を促す）。
    if has_incomplete_download_markers(&model_dir.join(".cache").join("huggingface")) {
        return false;
    }

    true
}

#[tauri::command]
fn check_diarization_model_status(
    app: AppHandle,
) -> Result<DiarizationModelStatusResponse, String> {
    if should_emulate_missing_community_1() {
        let model_dir = resolve_default_diarization_model_dir(&app)?;
        return Ok(DiarizationModelStatusResponse {
            exists: false,
            has_config: false,
            expected_path: model_dir.to_string_lossy().to_string(),
        });
    }

    let model_dir = resolve_default_diarization_model_dir(&app)?;
    let has_config = diarization_model_is_complete(&model_dir);
    Ok(DiarizationModelStatusResponse {
        exists: model_dir.exists(),
        has_config,
        expected_path: model_dir.to_string_lossy().to_string(),
    })
}

fn get_hf_hub_cache() -> PathBuf {
    if let Ok(path) = env::var("HF_HUB_CACHE") {
        return PathBuf::from(path);
    }
    if let Ok(hf_home) = env::var("HF_HOME") {
        return PathBuf::from(hf_home).join("hub");
    }
    let home = env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/"));
    home.join(".cache").join("huggingface").join("hub")
}

/// リリースビルドで HF Hub キャッシュをアプリ固有ディレクトリへ向ける。
/// これにより全モデルが %LOCALAPPDATA%\{identifier}\ 以下に収まり、
/// NSIS アンインストーラーによる一括削除が可能になる。
/// dev ビルドはデフォルトの HF_HOME/~/.cache/huggingface/hub を使う。
fn get_app_hf_hub_cache(app: &AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        return get_hf_hub_cache();
    }
    // 環境変数が明示されていればそちらを優先する。
    if let Ok(path) = env::var("HF_HUB_CACHE") {
        return PathBuf::from(path);
    }
    if let Ok(hf_home) = env::var("HF_HOME") {
        return PathBuf::from(hf_home).join("hub");
    }
    app.path()
        .app_local_data_dir()
        .map(|d| d.join("hf_cache").join("hub"))
        .unwrap_or_else(|_| get_hf_hub_cache())
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

fn check_whisper_turbo_cached_at(hub: &Path) -> bool {
    // faster-whisper >= 1.1 では turbo は mobiuslabsgmbh リポジトリを使う
    let candidates = [
        "models--mobiuslabsgmbh--faster-whisper-large-v3-turbo",
        "models--Systran--faster-whisper-turbo",
    ];
    candidates.iter().any(|name| {
        let snapshots = hub.join(name).join("snapshots");
        snapshots.is_dir()
            && fs::read_dir(&snapshots).map_or(false, |d| {
                d.flatten().any(|entry| {
                    let snapshot = entry.path();
                    snapshot.join("model.bin").is_file()
                        && snapshot.join("config.json").is_file()
                        && snapshot.join("tokenizer.json").is_file()
                })
            })
    })
}

fn check_whisper_large_v3_cached_at(hub: &Path) -> bool {
    let snapshots = hub
        .join("models--Systran--faster-whisper-large-v3")
        .join("snapshots");
    snapshots.is_dir()
        && fs::read_dir(&snapshots).map_or(false, |d| {
            d.flatten().any(|entry| {
                let snapshot = entry.path();
                snapshot.join("model.bin").is_file()
                    && snapshot.join("config.json").is_file()
                    && snapshot.join("tokenizer.json").is_file()
            })
        })
}

fn check_whisper_turbo_cached(app: &AppHandle) -> bool {
    // 旧 ~/.cache/huggingface/hub への移行互換フォールバックは廃止。
    // リリースはアプリ固有データ領域、dev は HF_HOME 既定のみを参照する。
    let app_hub = get_app_hf_hub_cache(app);
    check_whisper_turbo_cached_at(&app_hub)
}

fn get_gemma_gguf_info(app: &AppHandle) -> (bool, String) {
    // セットアップタブの標準チェックリストは既定（E4B）モデルを対象にする。
    let tier = GemmaTier::E4b;
    if cfg!(debug_assertions) {
        for dir in gemma_debug_model_dir_candidates(tier) {
            let p = gemma_main_gguf_path(&dir, tier);
            if p.exists() {
                return (true, p.to_string_lossy().to_string());
            }
        }
        let expected = gemma_main_gguf_path(&gemma_debug_model_dir_candidates(tier)[0], tier);
        return (false, expected.to_string_lossy().to_string());
    }

    // リリース: アプリ固有データ領域へ集約する（NSIS の %LOCALAPPDATA%\{id} 一括削除で消える）。
    let p = gemma_release_model_dir(app, tier)
        .map(|dir| gemma_main_gguf_path(&dir, tier))
        .unwrap_or_else(|| gemma_main_gguf_path(&gemma_llm_relative_dir(tier), tier));
    (p.exists(), p.to_string_lossy().to_string())
}

fn get_gemma_mtp_gguf_info(app: &AppHandle) -> (bool, String) {
    let tier = GemmaTier::E4b;
    if cfg!(debug_assertions) {
        for dir in gemma_debug_model_dir_candidates(tier) {
            if let Some(p) = find_existing_gemma_mtp_gguf(&dir, tier) {
                return (true, p.to_string_lossy().to_string());
            }
        }
        let expected = gemma_debug_model_dir_candidates(tier)[0].join(GEMMA_MTP_GGUF_FILENAME);
        return (false, expected.to_string_lossy().to_string());
    }

    let dir = gemma_release_model_dir(app, tier).unwrap_or_else(|| gemma_llm_relative_dir(tier));
    if let Some(p) = find_existing_gemma_mtp_gguf(&dir, tier) {
        return (true, p.to_string_lossy().to_string());
    }
    let expected = dir.join(GEMMA_MTP_GGUF_FILENAME);
    (false, expected.to_string_lossy().to_string())
}

#[tauri::command]
fn check_all_setup_status(app: AppHandle) -> Result<AllSetupStatus, String> {
    let whisper_turbo = if should_emulate_missing_community_1() {
        false
    } else {
        check_whisper_turbo_cached(&app)
    };

    let model_dir = resolve_default_diarization_model_dir(&app)?;
    let diarization = if should_emulate_missing_community_1() {
        false
    } else {
        diarization_model_is_complete(&model_dir)
    };
    let diarization_expected_path = model_dir.to_string_lossy().to_string();

    let (gemma_gguf, gemma_gguf_expected_path) = get_gemma_gguf_info(&app);
    let gemma_mtp_needed = !app.config().identifier.contains("amd");
    let (gemma_mtp_gguf, gemma_mtp_gguf_expected_path) = if gemma_mtp_needed {
        get_gemma_mtp_gguf_info(&app)
    } else {
        (true, String::new())
    };

    let lemonade_backend = check_lemonade_gpu_backend_installed(app.clone());

    let (python_env, python_env_expected_path) = check_python_venv(&app);

    Ok(AllSetupStatus {
        whisper_turbo,
        diarization,
        diarization_expected_path,
        gemma_gguf,
        gemma_gguf_expected_path,
        gemma_mtp_gguf,
        gemma_mtp_gguf_expected_path,
        lemonade_backend,
        python_env,
        python_env_expected_path,
    })
}

#[tauri::command]
fn get_dev_emulation_status() -> DevEmulationStatusResponse {
    let mode = read_dev_emulation_mode();
    DevEmulationStatusResponse {
        mode: mode.as_str().to_string(),
        no_cuda: should_emulate_no_cuda(),
        missing_community_1: should_emulate_missing_community_1(),
    }
}

#[tauri::command]
async fn check_gpu_availability(app: AppHandle) -> serde_json::Value {
    // nvidia-smi / rocm-smi の起動は数百ms〜秒オーダーになりうるため、メインスレッドを
    // 塞がないよう spawn_blocking でワーカースレッドへ逃がす。
    tauri::async_runtime::spawn_blocking(move || check_gpu_availability_blocking(app))
        .await
        .unwrap_or_else(|_| {
            serde_json::json!({
                "cudaAvailable": false,
                "rocmAvailable": false,
                "buildVariant": "cuda",
            })
        })
}

fn check_gpu_availability_blocking(app: AppHandle) -> serde_json::Value {
    let mut nvidia_cmd = Command::new("nvidia-smi");
    apply_windows_no_window(&mut nvidia_cmd);
    let cuda_available = nvidia_cmd
        .args(["--query-gpu=name", "--format=csv,noheader"])
        .output()
        .map(|o| o.status.success() && !o.stdout.trim_ascii().is_empty())
        .unwrap_or(false);

    let rocm_kfd = std::path::Path::new("/dev/kfd").exists();
    let mut rocm_cmd = Command::new("rocm-smi");
    apply_windows_no_window(&mut rocm_cmd);
    let rocm_smi_ok = rocm_cmd
        .arg("--showproductname")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    let rocm_available = rocm_kfd || rocm_smi_ok;

    let build_variant = if app.config().identifier.contains("amd") {
        "rocm"
    } else {
        "cuda"
    };

    serde_json::json!({
        "cudaAvailable": cuda_available,
        "rocmAvailable": rocm_available,
        "buildVariant": build_variant,
        "externalLlmEnabled": external_llm_enabled(&app),
    })
}

#[tauri::command]
async fn detect_compute_env(app: AppHandle) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move || detect_compute_env_blocking(app))
        .await
        .unwrap_or_else(|_| {
            serde_json::json!({"backendType": "none", "devices": [], "recommendedIndex": -1, "cpu": {"cores": 0}})
        })
}

fn detect_compute_env_blocking(app: AppHandle) -> serde_json::Value {
    let fallback = serde_json::json!({
        "backendType": "none",
        "devices": [],
        "recommendedIndex": -1,
        "cpu": {"cores": 0}
    });
    let script_path = match resolve_detect_env_script_path(&app) {
        Ok(p) if p.exists() => p,
        _ => return fallback,
    };
    let python_bin = get_python_bin(&app);
    let hf_hub_cache = get_app_hf_hub_cache(&app);
    let mut cmd = Command::new(&python_bin);
    apply_windows_no_window(&mut cmd);
    // HIP_VISIBLE_DEVICES は設定しない（全デバイスを列挙するため）
    cmd.env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("HF_HUB_CACHE", hf_hub_cache.as_os_str())
        .arg(&script_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = match cmd.output() {
        Ok(o) => o,
        Err(_) => return fallback,
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut result = serde_json::from_str::<serde_json::Value>(stdout.trim()).unwrap_or(fallback);

    // torch 経由で CUDA デバイスが取れなかった場合の nvidia-smi フォールバック。
    // torch-CUDA 未導入（CPU 版 / 未セットアップ）でも、ドライバ同梱の nvidia-smi で
    // 見える NVIDIA GPU を列挙し、複数 GPU 環境でも設定画面で選択できるようにする。
    // 文字起こし本体（ctranslate2-CUDA）は torch とは別経路なので、torch 不在でも
    // GPU 選択は意味を持つ。torch が既にデバイスを返した場合は上書きしない。
    let torch_has_devices = result
        .get("devices")
        .and_then(|d| d.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false);
    if !torch_has_devices {
        let nv_devices = nvidia_devices_for_env();
        if !nv_devices.is_empty() {
            // 空き VRAM が最大の GPU を推奨にする（nvidia-smi の index を返す）。
            let recommended = nv_devices
                .iter()
                .max_by_key(|d| d.get("freeVramMb").and_then(|v| v.as_u64()).unwrap_or(0))
                .and_then(|d| d.get("index").and_then(|v| v.as_i64()))
                .unwrap_or(-1);
            if let Some(obj) = result.as_object_mut() {
                obj.insert("backendType".to_string(), serde_json::json!("cuda"));
                obj.insert("recommendedIndex".to_string(), serde_json::json!(recommended));
                obj.insert("devices".to_string(), serde_json::Value::Array(nv_devices));
            }
        }
    }
    result
}

#[tauri::command]
async fn download_whisper_model(app: AppHandle, model_name: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || download_whisper_model_blocking(app, model_name))
        .await
        .map_err(|e| format!("ダウンロードタスクの実行に失敗しました: {e}"))?
}

fn download_whisper_model_blocking(app: AppHandle, model_name: String) -> Result<bool, String> {
    let script_path = resolve_download_whisper_model_script_path(&app)
        .map_err(|e| format!("ダウンロードスクリプトが見つかりません: {e}"))?;
    let python_bin = get_python_bin(&app);
    let component = match model_name.as_str() {
        "large-v3" => "whisper_large_v3",
        _ => "whisper_turbo",
    };
    let hf_hub_cache = get_app_hf_hub_cache(&app);
    let mut cmd = Command::new(&python_bin);
    apply_windows_no_window(&mut cmd);
    cmd.env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("HF_HUB_CACHE", hf_hub_cache.as_os_str())
        .env("HF_HUB_DISABLE_XET", "1")
        .env("HF_HUB_DOWNLOAD_TIMEOUT", "60")
        .arg(&script_path)
        .arg(&model_name);
    run_download_streaming(&app, &mut cmd, component)?;

    let cached = match model_name.as_str() {
        "large-v3" => check_whisper_large_v3_cached_at(&hf_hub_cache),
        _ => check_whisper_turbo_cached_at(&hf_hub_cache),
    };
    if !cached {
        return Err(format!(
            "ダウンロード後の確認に失敗しました。model.bin を含む完全な snapshot が見つかりません: {}",
            hf_hub_cache.display()
        ));
    }
    Ok(true)
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
async fn proofread_transcription_llm(
    app: AppHandle,
    request: LlmProofreadRequest,
) -> Result<ProofreadTranscriptionResponse, String> {
    let _run_guard = match TaskRunGuard::try_acquire(&LLM_PROOFREAD_ACTIVE) {
        Some(g) => g,
        None => {
            return Ok(ProofreadTranscriptionResponse {
                success: false,
                result: None,
                error_message: Some(
                    "AI校正（句読点付与/全体校正）が既に実行中です。完了するかキャンセルしてから再実行してください。"
                        .to_string(),
                ),
            })
        }
    };
    tauri::async_runtime::spawn_blocking(move || proofread_transcription_llm_blocking(app, request))
        .await
        .map_err(|e| format!("LLM校正タスクの実行に失敗しました: {e}"))?
}

#[tauri::command]
async fn run_overall_proofread(
    app: AppHandle,
    request: LlmProofreadRequest,
) -> Result<OverallProofreadResponse, String> {
    let _run_guard = match TaskRunGuard::try_acquire(&LLM_PROOFREAD_ACTIVE) {
        Some(g) => g,
        None => {
            return Ok(OverallProofreadResponse {
                success: false,
                result: None,
                error_message: Some(
                    "AI校正（句読点付与/全体校正）が既に実行中です。完了するかキャンセルしてから再実行してください。"
                        .to_string(),
                ),
            })
        }
    };
    tauri::async_runtime::spawn_blocking(move || run_overall_proofread_blocking(app, request))
        .await
        .map_err(|e| format!("全体校正タスクの実行に失敗しました: {e}"))?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmModelEntry {
    name: String,
    path: String,
}

fn get_llm_models_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir_relative = PathBuf::from("python_sidecar").join("models").join("llm");

    if cfg!(debug_assertions) {
        let manifest_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(&dir_relative);
        if manifest_path.is_dir() {
            return Some(manifest_path);
        }
        if let Ok(cwd) = env::current_dir() {
            let dev_path = cwd.join(&dir_relative);
            if dev_path.is_dir() {
                return Some(dev_path);
            }
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join(&dir_relative);
        if bundled.is_dir() {
            return Some(bundled);
        }
    }

    None
}

#[tauri::command]
fn list_llm_models(app: AppHandle) -> Vec<LlmModelEntry> {
    let Some(dir) = get_llm_models_dir(&app) else {
        return vec![];
    };

    let mut models = vec![];
    let Ok(entries) = fs::read_dir(&dir) else {
        return vec![];
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Ok(inner) = fs::read_dir(&path) {
                for inner_entry in inner.flatten() {
                    let inner_path = inner_entry.path();
                    if inner_path.extension().and_then(|e| e.to_str()) == Some("gguf") {
                        let name = inner_path
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("unknown")
                            .to_string();
                        models.push(LlmModelEntry {
                            name,
                            path: inner_path.to_string_lossy().to_string(),
                        });
                    }
                }
            }
        } else if path.extension().and_then(|e| e.to_str()) == Some("gguf") {
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();
            models.push(LlmModelEntry {
                name,
                path: path.to_string_lossy().to_string(),
            });
        }
    }

    models
}

#[tauri::command]
fn open_llm_models_folder(app: AppHandle) -> Result<(), String> {
    let dir = get_llm_models_dir(&app)
        .ok_or_else(|| "LLMモデルフォルダが見つかりません。".to_string())?;
    let dir_str = dir.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&dir_str)
            .spawn()
            .map_err(|e| format!("フォルダを開けませんでした: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&dir_str)
            .spawn()
            .map_err(|e| format!("フォルダを開けませんでした: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&dir_str)
            .spawn()
            .map_err(|e| format!("フォルダを開けませんでした: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
fn get_default_llm_model_path(app: AppHandle) -> Option<String> {
    // 選択中の階層（E4B 標準 / 12B 高精度）の本体 GGUF を解決する。
    // B12 選択でも未ダウンロードなら E4b へフォールバックする（フェイルセーフ）。
    resolve_gemma_main_path_for_tier(&app, resolve_effective_proofread_tier(&app))
}

fn get_default_llm_mtp_model_path(app: &AppHandle) -> Option<String> {
    // 本体と同じ実効階層の MTP ドラフトを解決し、本体と MTP の階層が食い違わないようにする。
    resolve_gemma_mtp_path_for_tier(app, resolve_effective_proofread_tier(app))
}

/// 校正AIモデルの選択（"e4b" / "12b"）を返す。AMD 版は常に "e4b"。
#[tauri::command]
fn get_proofread_model_tier(app: AppHandle) -> String {
    read_proofread_model_tier(&app).as_marker().to_string()
}

/// 校正AIモデルの選択を保存する（"e4b" / "12b"）。NVIDIA(CUDA)・AMD(Vulkan) いずれも 12B 可。
#[tauri::command]
fn set_proofread_model_tier(app: AppHandle, tier: String) -> Result<(), String> {
    let resolved = GemmaTier::from_marker(&tier);
    let path = proofread_model_tier_marker_path(&app)
        .ok_or_else(|| "設定の保存先を解決できませんでした。".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("設定フォルダの作成に失敗しました: {e}"))?;
    }
    std::fs::write(&path, resolved.as_marker())
        .map_err(|e| format!("設定の保存に失敗しました: {e}"))?;
    Ok(())
}

/// 上位モデル（Gemma 4 12B 本体 GGUF）がダウンロード済みかを返す。
#[tauri::command]
fn check_gemma_12b_installed(app: AppHandle) -> bool {
    resolve_gemma_main_path_for_tier(&app, GemmaTier::B12).is_some()
}

/// 上位モデル（Gemma 4 12B QAT + MTP）を後からダウンロードする（large-v3 と同じ後付け方式）。
#[tauri::command]
async fn download_gemma_12b(app: AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || download_gemma_12b_blocking(&app).map(|_| true))
        .await
        .map_err(|e| format!("12Bモデルのダウンロードに失敗しました: {e}"))?
}

#[tauri::command]
fn cancel_llm_proofread() -> Result<String, String> {
    match request_cancel(RunningTaskKind::LlmProofread)? {
        true => Ok("LLM校正処理の中止要求を送信しました。".to_string()),
        false => Ok("中止対象のLLM校正処理は実行されていません。".to_string()),
    }
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

#[tauri::command]
fn preview_proofread_runtime_config(
    _app: AppHandle,
    request: ProofreadRuntimeConfigRequest,
) -> Result<ProofreadRuntimeConfigResponse, String> {
    let chunk_size = request.chunk_size.unwrap_or(12).clamp(1, 64);
    let chunk_max_chars = request.chunk_max_chars.unwrap_or(1200).clamp(200, 6000);

    Ok(ProofreadRuntimeConfigResponse {
        chunk_size,
        chunk_max_chars,
    })
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

    let chunk_size = request.chunk_size.unwrap_or(12).clamp(1, 64);
    let chunk_max_chars = request.chunk_max_chars.unwrap_or(1200).clamp(200, 6000);
    let mode = request.mode.as_deref().unwrap_or("all");
    let run_punct = mode == "all" || mode == "punct";
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

fn proofread_transcription_llm_blocking(
    app: AppHandle,
    request: LlmProofreadRequest,
) -> Result<ProofreadTranscriptionResponse, String> {
    proofread_transcription_llm_blocking_with_kind(app, request, RunningTaskKind::LlmProofread)
}

fn proofread_transcription_llm_blocking_with_kind(
    app: AppHandle,
    request: LlmProofreadRequest,
    task_kind: RunningTaskKind,
) -> Result<ProofreadTranscriptionResponse, String> {
    set_cancel_requested(task_kind, false);
    let lemonade_port = app.state::<LemonadeServer>().port.load(Ordering::Relaxed) as u16;

    if request.segments.is_empty() {
        return Ok(ProofreadTranscriptionResponse {
            success: false,
            result: None,
            error_message: Some("校正対象のセグメントがありません。".to_string()),
        });
    }

    let backend = request.backend.as_deref().unwrap_or("llama_cpp");
    let is_lemonade = backend == "lemonade";
    let is_openai_compatible = backend == "openai_compatible";
    let is_llama_cpp = backend == "llama_cpp" || backend == "llama_cpp_rocm";

    if !is_llama_cpp && !is_lemonade && !is_openai_compatible {
        return Ok(ProofreadTranscriptionResponse {
            success: false,
            result: None,
            error_message: Some(format!("未対応の LLM バックエンドです: {backend}")),
        });
    }

    if is_openai_compatible && !external_llm_enabled(&app) {
        return Ok(ProofreadTranscriptionResponse {
            success: false,
            result: None,
            error_message: Some(EXTERNAL_LLM_DISABLED_MESSAGE.to_string()),
        });
    }

    if !is_lemonade && !is_openai_compatible && request.model_path.is_empty() {
        return Ok(ProofreadTranscriptionResponse {
            success: false,
            result: None,
            error_message: Some("LLMモデルのパスが指定されていません。".to_string()),
        });
    }

    let openai_base_url = if is_openai_compatible {
        let raw = request.openai_base_url.as_deref().unwrap_or("");
        Some(validate_local_openai_base_url(raw)?)
    } else {
        None
    };
    let openai_model = if is_openai_compatible {
        let model = request.openai_model.as_deref().unwrap_or("").trim().to_string();
        if model.is_empty() {
            return Ok(ProofreadTranscriptionResponse {
                success: false,
                result: None,
                error_message: Some("ローカルOpenAI互換APIのモデル名が指定されていません。".to_string()),
            });
        }
        Some(model)
    } else {
        None
    };

    // openai_compatible の場合、モデルが既にロード済みかを確認する。
    // 未ロードの場合は校正完了・中止・アプリ終了時にアンロードを試みる。
    let openai_unload_info: Option<OpenAiUnloadTarget> = if is_openai_compatible {
        let base = openai_base_url.as_deref().unwrap_or("");
        let model = openai_model.as_deref().unwrap_or("");
        prepare_openai_unload_info(base, model, &app).inspect(|info| {
            if let Ok(mut guard) = app.state::<OpenAiUnloadState>().0.lock() {
                *guard = Some(info.clone());
            }
        })
    } else {
        None
    };

    let script_path = resolve_llm_proofread_script_path(&app)?;

    let python_bin = get_python_bin(&app);

    // セグメントを一時JSONファイルに書き出す
    let segments_json: Vec<serde_json::Value> = request
        .segments
        .iter()
        .map(|s| serde_json::json!({"id": s.id, "text": s.text, "speaker": s.speaker}))
        .collect();
    let segments_json_str = serde_json::to_string(&segments_json)
        .map_err(|e| format!("JSON シリアライズに失敗: {e}"))?;

    let tmp_dir = std::env::temp_dir();
    let invocation_id = LLM_PROOFREAD_INVOCATION_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp_path = tmp_dir.join(format!("lott_llm_segments_{}_{}.json", std::process::id(), invocation_id));
    std::fs::write(&tmp_path, &segments_json_str)
        .map_err(|e| format!("一時ファイルの書き込みに失敗: {e}"))?;

    let system_prompt_tmp_path = request
        .system_prompt
        .as_deref()
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
        .map(|prompt| {
            let path = tmp_dir.join(format!("lott_llm_system_prompt_{}_{}.txt", std::process::id(), invocation_id));
            std::fs::write(&path, prompt)
                .map_err(|e| format!("LLM システムプロンプトの一時保存に失敗しました: {e}"))?;
            Ok::<PathBuf, String>(path)
        })
        .transpose()?;

    // 会話本文/システムプロンプトを含む一時ファイルは、以降のどの早期 return でも
    // 確実に削除されるよう RAII ガードへ登録する（spawn 失敗・パイプ取得失敗を含む）。
    let mut _tmp_guard = TempFileGuard::new();
    _tmp_guard.push(tmp_path.clone());
    if let Some(ref path) = system_prompt_tmp_path {
        _tmp_guard.push(path.clone());
    }

    let n_gpu_layers = request.n_gpu_layers.unwrap_or(-1);
    let n_ctx = request.n_ctx.unwrap_or(16384).clamp(4096, 131072);
    let max_batch = request.max_batch.unwrap_or(40).clamp(1, 100);

    let mut cmd = Command::new(&python_bin);
    apply_windows_no_window(&mut cmd);
    cmd.env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .arg(&script_path)
        .arg("--segments-json-path")
        .arg(&tmp_path)
        .arg("--backend")
        .arg(backend)
        .arg("--n-ctx")
        .arg(n_ctx.to_string())
        .arg("--max-batch")
        .arg(max_batch.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if is_lemonade {
        let url = request.lemonade_url.as_deref().unwrap_or("http://localhost:13306");
        let model = request.lemonade_model.as_deref().unwrap_or(LEMONADE_DEFAULT_MODEL);
        cmd.arg("--lemonade-url").arg(url);
        cmd.arg("--lemonade-model").arg(model);
        // CUDA llama-server (mode==1) のときだけ、起動時に決めたスロット数 (-np) と同じ
        // 同時送信数で並列ディスパッチし GPU のアイドルを埋める。
        // lemond(AMD, mode==0) は自身の並列度に従うため逐次（--parallel 既定=1）のままにする。
        let lemo = app.state::<LemonadeServer>();
        if lemo.mode.load(Ordering::Relaxed) == 1 {
            let np = lemo.parallel.load(Ordering::Relaxed).max(1);
            cmd.arg("--parallel").arg(np.to_string());
        }
    } else if is_openai_compatible {
        cmd.arg("--openai-base-url")
            .arg(openai_base_url.as_deref().unwrap_or(""))
            .arg("--openai-model")
            .arg(openai_model.as_deref().unwrap_or(""));
    } else {
        cmd.arg("--model-path")
            .arg(&request.model_path)
            .arg("--n-gpu-layers")
            .arg(n_gpu_layers.to_string());
    }
    if let Some(path) = &system_prompt_tmp_path {
        cmd.arg("--system-prompt-path").arg(path);
    }
    if let Some(ref pt) = request.prompt_type {
        if pt == "gemma4" || pt == "original" {
            cmd.arg("--prompt-type").arg(pt);
        }
    }

    emit_progress(
        &app,
        "llm_sidecar_start",
        "LLM校正サイドカーを起動しています...",
        None,
    );
    emit_progress(
        &app,
        "llm_sidecar_debug",
        &format!(
            "backend={backend}, python_bin={python_bin}, script_path={}",
            script_path.display()
        ),
        None,
    );

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("LLM proofread sidecar の起動に失敗しました: {e}"))?;
    set_running_pid(task_kind, child.id());

    let stdout_reader = child
        .stdout
        .take()
        .ok_or_else(|| "stdout パイプ取得に失敗しました。".to_string())?;
    let stderr_reader = child
        .stderr
        .take()
        .ok_or_else(|| "stderr パイプ取得に失敗しました。".to_string())?;

    let stdout_buf = Arc::new(Mutex::new(String::new()));
    let stderr_buf = Arc::new(Mutex::new(String::new()));

    let stdout_buf_clone = Arc::clone(&stdout_buf);
    let stdout_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout_reader);
        for line in reader.lines() {
            if let Ok(text) = line {
                let mut out = stdout_buf_clone.lock().expect("stdout mutex poisoned");
                out.push_str(&text);
                out.push('\n');
            }
        }
    });

    let stderr_buf_clone = Arc::clone(&stderr_buf);
    let app_clone = app.clone();
    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr_reader);
        for line in reader.lines() {
            if let Ok(text) = line {
                if let Some(marker_pos) = text.find("PROGRESS_JSON:") {
                    let payload = &text[(marker_pos + "PROGRESS_JSON:".len())..];
                    let payload_trimmed = payload.trim();
                    if let Ok(json) = serde_json::from_str::<Value>(payload_trimmed) {
                        let _ = app_clone.emit("transcription-progress", json);
                    } else {
                        let mut err = stderr_buf_clone.lock().expect("stderr mutex poisoned");
                        err.push_str(&text);
                        err.push('\n');
                    }
                } else {
                    let mut err = stderr_buf_clone.lock().expect("stderr mutex poisoned");
                    err.push_str(&text);
                    err.push('\n');
                }
            }
        }
    });

    let status = match child.wait() {
        Ok(v) => {
            clear_running_pid(task_kind);
            v
        }
        Err(e) => {
            clear_running_pid(task_kind);
            let _ = std::fs::remove_file(&tmp_path);
            if let Some(path) = &system_prompt_tmp_path {
                let _ = std::fs::remove_file(path);
            }
            // wait 失敗時もアンロードを試みる
            if let Some(ref info) = openai_unload_info {
                try_unload_openai_model(info, lemonade_port);
                if let Ok(mut guard) = app.state::<OpenAiUnloadState>().0.lock() {
                    *guard = None;
                }
            }
            if is_lemonade && !try_stop_cuda_llama_server(&app) {
                try_unload_lemonade_cli(lemonade_port);
            }
            return Err(format!(
                "LLM proofread sidecar の終了待機に失敗しました: {e}"
            ));
        }
    };

    let _ = stdout_handle.join();
    let _ = stderr_handle.join();
    let _ = std::fs::remove_file(&tmp_path);
    if let Some(path) = &system_prompt_tmp_path {
        let _ = std::fs::remove_file(path);
    }

    // サイドカー終了後（成功・中止・失敗すべて）に必ずアンロードを試みる
    if let Some(ref info) = openai_unload_info {
        try_unload_openai_model(info, lemonade_port);
        if let Ok(mut guard) = app.state::<OpenAiUnloadState>().0.lock() {
            *guard = None;
        }
    }
    if is_lemonade && !try_stop_cuda_llama_server(&app) {
        try_unload_lemonade_cli(lemonade_port);
    }

    let stdout = stdout_buf.lock().map(|v| v.clone()).unwrap_or_default();
    let stderr = stderr_buf.lock().map(|v| v.clone()).unwrap_or_default();

    if take_cancel_requested(task_kind) {
        return Ok(ProofreadTranscriptionResponse {
            success: false,
            result: None,
            error_message: Some("LLM校正が中止されました。".to_string()),
        });
    }

    let parsed = parse_json_from_mixed_output(&stdout);

    if !status.success() {
        // 推論中の VRAM 不足（OOM）を stdout/stderr から検出し、検出時はメッセージにマーカーを付与する。
        // stdout/stderr は SidecarExecResult へムーブされるため、判定は move 前に済ませておく。
        let oom = text_indicates_vram_oom(&stderr) || text_indicates_vram_oom(&stdout);
        let tag = |m: String| {
            if oom && !m.contains(VRAM_OOM_MARKER) {
                format!("{VRAM_OOM_MARKER} {m}")
            } else {
                m
            }
        };
        // Python が JSON エラーを出力していればそのメッセージを優先する
        let clean_msg = parsed
            .as_ref()
            .and_then(|j| j.get("error"))
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string);
        if let Some(msg) = clean_msg {
            return Ok(ProofreadTranscriptionResponse {
                success: false,
                result: None,
                error_message: Some(tag(msg)),
            });
        }
        let err_msg = build_detailed_sidecar_error_message(
            "LLM校正処理に失敗しました。",
            &python_bin,
            &SidecarExecResult {
                status,
                stdout,
                stderr,
            },
            parsed.as_ref(),
        );
        return Ok(ProofreadTranscriptionResponse {
            success: false,
            result: None,
            error_message: Some(tag(err_msg)),
        });
    }

    let json = parsed.ok_or_else(|| {
        format!(
            "LLM校正の出力をパースできませんでした。stdout: {}",
            stdout.chars().take(300).collect::<String>()
        )
    })?;

    let success = json
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !success {
        let msg = json
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("LLM校正でエラーが発生しました。")
            .to_string();
        return Ok(ProofreadTranscriptionResponse {
            success: false,
            result: None,
            error_message: Some(tag_vram_oom_if_present(msg, &stdout, &stderr)),
        });
    }

    let result = json.get("result").cloned();
    Ok(ProofreadTranscriptionResponse {
        success: true,
        result,
        error_message: None,
    })
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
    for phrase in &rules.force_comma_after {
        if phrase.is_empty() {
            continue;
        }
        out = out.replace(phrase, &format!("{phrase}、"));
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
    let mut rules = PunctRules::default();
    let Some(path) = resolve_proofread_rule_file_candidates(app, "punctuation_addition.json")
        .into_iter()
        .find(|p| p.exists())
    else {
        return rules;
    };
    let Ok(text) = fs::read_to_string(path) else {
        return rules;
    };
    let Ok(raw) = serde_json::from_str::<PunctRulesFile>(&text) else {
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
        let location_names = normalize_location_name_set(region.location_names, &rules.person_name_set);
        if !location_names.is_empty() {
            rules.regional_location_names.insert(code.clone(), location_names);
        }
        let station_names = normalize_location_name_set(region.station_names, &rules.person_name_set);
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
    use super::*;

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
        assert!(meta.organization_names.contains(&"みどり保育所".to_string()));
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
    let _run_guard = match TaskRunGuard::try_acquire(&TRANSCRIPTION_ACTIVE) {
        Some(g) => g,
        None => {
            return Ok(RunTranscriptionResponse {
                success: false,
                result: None,
                error_message: Some(
                    "文字起こしは既に実行中です。完了するかキャンセルしてから再実行してください。"
                        .to_string(),
                ),
            })
        }
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
    let _run_guard = match TaskRunGuard::try_acquire(&DIARIZATION_ACTIVE) {
        Some(g) => g,
        None => {
            return Ok(RunDiarizationResponse {
                success: false,
                result: None,
                error_message: Some(
                    "話者分離は既に実行中です。完了するかキャンセルしてから再実行してください。"
                        .to_string(),
                ),
            })
        }
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
    let script_path = resolve_diarize_script_path(&app)?;
    if !script_path.exists() {
        return Ok(RunDiarizationResponse {
            success: false,
            result: None,
            error_message: Some(format!(
                "話者分離 sidecar スクリプトが存在しません: {}",
                script_path.display()
            )),
        });
    }
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
    let python_bin = get_python_bin(&app);
    let diarization_python_bin = resolve_diarization_python_bin(&app, &python_bin);

    emit_progress(
        &app,
        "diarization_start",
        "話者分離処理を開始します...",
        Some(1.0),
    );
    let mut diarization_output = execute_diarization(
        &app,
        &diarization_python_bin,
        &script_path,
        &request.audio_path,
        &requested_device,
        speaker_count,
        request.clustering_threshold,
        RunningTaskKind::Diarization,
        "transcription-progress",
        None,
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
            let retry_output = execute_diarization(
                &app,
                &diarization_python_bin,
                &script_path,
                &request.audio_path,
                "cpu",
                speaker_count,
                request.clustering_threshold,
                RunningTaskKind::Diarization,
                "transcription-progress",
                None,
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
            &diarization_python_bin,
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
                    "話者分離は CUDA が利用できなかったため CPU 実行になりました。".to_string(),
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
    set_cancel_requested(RunningTaskKind::Transcription, false);
    let script_path = resolve_sidecar_script_path(&app)?;
    if !script_path.exists() {
        return Ok(RunTranscriptionResponse {
            success: false,
            result: None,
            error_message: Some(format!(
                "Python sidecar スクリプトが存在しません: {}",
                script_path.display()
            )),
        });
    }

    let python_bin = get_python_bin(&app);

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

    let retry_plan = if transcription_device == "cuda" {
        build_gpu_retry_plan(&selected_compute_type, low_memory_mode)
    } else {
        vec![selected_compute_type.clone()]
    };
    let initial_prompt = request.initial_prompt.as_deref();
    let language = normalize_transcription_language(request.language.as_deref());
    let normalize_audio = request.normalize_audio.unwrap_or(false);
    let highpass_filter = request.highpass_filter.unwrap_or(false);
    let noise_reduction = request.noise_reduction.unwrap_or(false);
    let noise_reduction_mode =
        normalize_noise_reduction_mode(request.noise_reduction_mode.as_deref());
    let requested_speaker_count = request.speaker_count.unwrap_or(2).clamp(1, 5);

    let use_parallel_diarization = request.parallel_diarization.unwrap_or(false);

    // 文字起こしと並行して話者分離を起動する（高速モード時のみ）
    let parallel_diar_handle: Option<thread::JoinHandle<Result<SidecarExecResult, String>>> =
        if request.diarization && use_parallel_diarization {
            match resolve_diarize_script_path(&app) {
                Ok(dscript) if dscript.exists() => {
                    let app_par = app.clone();
                    let diar_bin = resolve_diarization_python_bin(&app, &python_bin);
                    let audio_par = request.audio_path.clone();
                    let device_par = transcription_device.clone();
                    let spk = requested_speaker_count;
                    let cluster_thresh = request.clustering_threshold;
                    let hip_idx_par = request.hip_device_index;
                    emit_progress(
                        &app,
                        "diarization_start",
                        "話者分離処理を開始します（文字起こしと並行実行）...",
                        Some(3.0),
                    );
                    Some(thread::spawn(move || {
                        execute_diarization(
                            &app_par,
                            &diar_bin,
                            &dscript,
                            &audio_par,
                            &device_par,
                            spk,
                            cluster_thresh,
                            RunningTaskKind::Diarization,
                            "parallel-diarization-progress",
                            hip_idx_par,
                        )
                    }))
                }
                _ => None,
            }
        } else {
            None
        };

    let mut selected_attempt_compute = retry_plan
        .first()
        .cloned()
        .unwrap_or_else(|| selected_compute_type.clone());
    let mut output = execute_transcription(
        &app,
        &python_bin,
        &script_path,
        &request.audio_path,
        &transcription_device,
        &selected_attempt_compute,
        &requested_model,
        &language,
        initial_prompt,
        low_memory_mode,
        normalize_audio,
        highpass_filter,
        noise_reduction,
        noise_reduction_mode,
        false,
        request.hip_device_index,
    )?;
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
    let mut stdout = output.stdout.clone();
    let mut used_gpu_fallback = false;
    let mut gpu_fallback_reason: Option<String> = None;
    let mut attempt_index = 0usize;
    while !output.status.success() && attempt_index + 1 < retry_plan.len() {
        let parsed_attempt_json = parse_json_from_mixed_output(&stdout);
        if !should_retry_gpu_attempt(&output, parsed_attempt_json.as_ref()) {
            break;
        }

        let retry_compute_type = retry_plan[attempt_index + 1].clone();
        emit_progress(
            &app,
            "compute_switch",
            &format!(
                "計算方式 {} で失敗したため {} で再試行します（{}/{})",
                selected_attempt_compute,
                retry_compute_type,
                attempt_index + 2,
                retry_plan.len()
            ),
            Some(7.0),
        );
        let retry_output = execute_transcription(
            &app,
            &python_bin,
            &script_path,
            &request.audio_path,
            &transcription_device,
            &retry_compute_type,
            &requested_model,
            &language,
            initial_prompt,
            true,
            normalize_audio,
            highpass_filter,
            noise_reduction,
            noise_reduction_mode,
            true,
            request.hip_device_index,
        )?;
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
        output = retry_output;
        stdout = output.stdout.clone();
        selected_attempt_compute = retry_compute_type;
        attempt_index += 1;
    }

    if output.status.success() && attempt_index > 0 {
        used_gpu_fallback = true;
        gpu_fallback_reason = Some(format!(
            "GPU 実行({})が不安定だったため、GPU 実行({})へフォールバックしました（再試行 {} 回）。",
            selected_compute_type, selected_attempt_compute, attempt_index
        ));
    }

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
                "文字起こし処理に失敗しました。exit={:?}, python_bin={}, stdout_len={}, stderr_len={}",
                exit_code,
                python_bin,
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
                    Some(format!("Python sidecar 出力: {stdout_trimmed}"))
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
                let diarize_script_path = resolve_diarize_script_path(&app)?;
                let diarization_python_bin = resolve_diarization_python_bin(&app, &python_bin);
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
                    execute_diarization(
                        &app,
                        &diarization_python_bin,
                        &diarize_script_path,
                        &request.audio_path,
                        &transcription_device,
                        requested_speaker_count,
                        request.clustering_threshold,
                        RunningTaskKind::Transcription,
                        "transcription-progress",
                        request.hip_device_index,
                    )?
                };
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
                        let retry_output = execute_diarization(
                            &app,
                            &diarization_python_bin,
                            &diarize_script_path,
                            &request.audio_path,
                            "cpu",
                            requested_speaker_count,
                            request.clustering_threshold,
                            RunningTaskKind::Transcription,
                            "transcription-progress",
                            None,
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
                        &diarization_python_bin,
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
                            "話者分離は CUDA が利用できなかったため CPU 実行になりました。"
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
                    assign_speakers_to_segments(result_obj, &diarization_segments);
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

fn execute_transcription(
    app: &AppHandle,
    python_bin: &str,
    script_path: &PathBuf,
    audio_path: &str,
    device: &str,
    compute_type: &str,
    model: &str,
    language: &str,
    initial_prompt: Option<&str>,
    low_memory_mode: bool,
    normalize_audio: bool,
    highpass_filter: bool,
    noise_reduction: bool,
    noise_reduction_mode: &str,
    is_retry: bool,
    hip_device_index: Option<i32>,
) -> Result<SidecarExecResult, String> {
    let hf_hub_cache = get_app_hf_hub_cache(app);
    let mut cmd = Command::new(python_bin);
    apply_windows_no_window(&mut cmd);
    cmd.env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("HF_HUB_CACHE", hf_hub_cache.as_os_str())
        .env("HF_HUB_DISABLE_XET", "1")
        .env("HF_HUB_DOWNLOAD_TIMEOUT", "60")
        .arg(script_path)
        .arg("--audio-path")
        .arg(audio_path)
        .arg("--model")
        .arg(model)
        .arg("--device")
        .arg(device)
        .arg("--compute-type")
        .arg(compute_type)
        .arg("--language")
        .arg(language)
        .arg("--vad-filter")
        .arg("true")
        .arg("--word-timestamps")
        .arg("false")
        .arg("--low-memory-mode")
        .arg(if low_memory_mode { "true" } else { "false" })
        .arg("--normalize-audio")
        .arg(if normalize_audio { "true" } else { "false" })
        .arg("--highpass-filter")
        .arg(if highpass_filter { "true" } else { "false" })
        .arg("--noise-reduction")
        .arg(if noise_reduction { "true" } else { "false" })
        .arg("--noise-reduction-mode")
        .arg(noise_reduction_mode)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(prompt) = initial_prompt {
        let trimmed = prompt.trim();
        if !trimmed.is_empty() {
            cmd.arg("--initial-prompt").arg(trimmed);
        }
    }

    apply_child_runtime_env(&mut cmd, device, hip_device_index);
    apply_diarization_model_env(&mut cmd, app, script_path);
    apply_ffmpeg_bin_env(&mut cmd, app);
    // 文字起こしは事前取得済みモデルをキャッシュから読む。実行時のネット取得を禁止する。
    apply_offline_model_env(&mut cmd);

    if is_retry {
        emit_progress(
            app,
            "sidecar_retry_start",
            &format!("GPU設定を切り替えて再試行しています...（{}）", compute_type),
            Some(8.0),
        );
    } else {
        emit_progress(
            app,
            "sidecar_start",
            &format!("Python sidecar を起動しています...（{}）", compute_type),
            Some(3.0),
        );
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Python sidecar の起動に失敗しました: {e}"))?;
    set_running_pid(RunningTaskKind::Transcription, child.id());

    if is_retry {
        emit_progress(
            app,
            "sidecar_retry_running",
            &format!("文字起こし処理を再試行中です...（{}）", compute_type),
            Some(10.0),
        );
    } else {
        emit_progress(
            app,
            "sidecar_running",
            &format!("文字起こし処理を実行中です...（{}）", compute_type),
            Some(6.0),
        );
    }

    let stdout_reader = child
        .stdout
        .take()
        .ok_or_else(|| "Python sidecar の stdout パイプ取得に失敗しました。".to_string())?;
    let stderr_reader = child
        .stderr
        .take()
        .ok_or_else(|| "Python sidecar の stderr パイプ取得に失敗しました。".to_string())?;

    let stdout_buf = Arc::new(Mutex::new(String::new()));
    let stderr_buf = Arc::new(Mutex::new(String::new()));

    let stdout_buf_clone = Arc::clone(&stdout_buf);
    let stdout_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout_reader);
        for line in reader.lines() {
            if let Ok(text) = line {
                let mut out = stdout_buf_clone.lock().expect("stdout mutex poisoned");
                out.push_str(&text);
                out.push('\n');
            }
        }
    });

    let stderr_buf_clone = Arc::clone(&stderr_buf);
    let app_clone = app.clone();
    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr_reader);
        for line in reader.lines() {
            if let Ok(text) = line {
                if let Some(marker_pos) = text.find("PROGRESS_JSON:") {
                    let payload = &text[(marker_pos + "PROGRESS_JSON:".len())..];
                    let payload_trimmed = payload.trim();
                    if let Ok(json) = serde_json::from_str::<Value>(payload_trimmed) {
                        let _ = app_clone.emit("transcription-progress", json);
                    } else {
                        let mut err = stderr_buf_clone.lock().expect("stderr mutex poisoned");
                        err.push_str(&text);
                        err.push('\n');
                    }
                } else {
                    let mut err = stderr_buf_clone.lock().expect("stderr mutex poisoned");
                    err.push_str(&text);
                    err.push('\n');
                }
            }
        }
    });

    let status = match child.wait() {
        Ok(v) => {
            clear_running_pid(RunningTaskKind::Transcription);
            v
        }
        Err(e) => {
            clear_running_pid(RunningTaskKind::Transcription);
            return Err(format!("Python sidecar の終了待機に失敗しました: {e}"));
        }
    };

    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    let stdout = stdout_buf.lock().map(|v| v.clone()).unwrap_or_default();
    let stderr = stderr_buf.lock().map(|v| v.clone()).unwrap_or_default();

    Ok(SidecarExecResult {
        status,
        stdout,
        stderr,
    })
}

fn execute_diarization(
    app: &AppHandle,
    python_bin: &str,
    script_path: &PathBuf,
    audio_path: &str,
    device: &str,
    num_speakers: u8,
    clustering_threshold: Option<f64>,
    running_kind: RunningTaskKind,
    progress_event: &str,
    hip_device_index: Option<i32>,
) -> Result<SidecarExecResult, String> {
    let mut cmd = Command::new(python_bin);
    apply_windows_no_window(&mut cmd);
    cmd.env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        // pyannote/torch 系で Windows の OpenMP 重複初期化を回避するため、
        // diarization プロセス側のみ許容設定を付与する。
        .env("KMP_DUPLICATE_LIB_OK", "TRUE")
        .env("OMP_NUM_THREADS", "1")
        .env("MKL_NUM_THREADS", "1")
        .arg(script_path)
        .arg("--audio-path")
        .arg(audio_path)
        .arg("--device")
        .arg(device)
        .arg("--num-speakers")
        .arg(num_speakers.to_string());
    if let Some(thresh) = clustering_threshold {
        cmd.arg("--clustering-threshold").arg(thresh.to_string());
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    apply_child_runtime_env(&mut cmd, device, hip_device_index);
    apply_diarization_model_env(&mut cmd, app, script_path);
    apply_ffmpeg_bin_env(&mut cmd, app);
    // 話者分離モデルはローカル配置。実行時のネット取得を禁止する。
    apply_offline_model_env(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Diarization sidecar の起動に失敗しました: {e}"))?;
    set_running_pid(running_kind, child.id());

    let stdout_reader = child
        .stdout
        .take()
        .ok_or_else(|| "Diarization sidecar の stdout パイプ取得に失敗しました。".to_string())?;
    let stderr_reader = child
        .stderr
        .take()
        .ok_or_else(|| "Diarization sidecar の stderr パイプ取得に失敗しました。".to_string())?;

    let stdout_buf = Arc::new(Mutex::new(String::new()));
    let stderr_buf = Arc::new(Mutex::new(String::new()));

    let stdout_buf_clone = Arc::clone(&stdout_buf);
    let stdout_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout_reader);
        for line in reader.lines() {
            if let Ok(text) = line {
                let mut out = stdout_buf_clone.lock().expect("stdout mutex poisoned");
                out.push_str(&text);
                out.push('\n');
            }
        }
    });

    let stderr_buf_clone = Arc::clone(&stderr_buf);
    let app_clone = app.clone();
    let progress_event_owned = progress_event.to_string();
    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr_reader);
        for line in reader.lines() {
            if let Ok(text) = line {
                if let Some(marker_pos) = text.find("PROGRESS_JSON:") {
                    let payload = &text[(marker_pos + "PROGRESS_JSON:".len())..];
                    if let Ok(json) = serde_json::from_str::<Value>(payload.trim()) {
                        let _ = app_clone.emit(&progress_event_owned, json);
                    } else {
                        let mut err = stderr_buf_clone.lock().expect("stderr mutex poisoned");
                        err.push_str(&text);
                        err.push('\n');
                    }
                } else {
                    let mut err = stderr_buf_clone.lock().expect("stderr mutex poisoned");
                    err.push_str(&text);
                    err.push('\n');
                }
            }
        }
    });

    let status = match child.wait() {
        Ok(v) => {
            clear_running_pid(running_kind);
            v
        }
        Err(e) => {
            clear_running_pid(running_kind);
            return Err(format!("Diarization sidecar の終了待機に失敗しました: {e}"));
        }
    };

    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    let stdout = stdout_buf.lock().map(|v| v.clone()).unwrap_or_default();
    let stderr = stderr_buf.lock().map(|v| v.clone()).unwrap_or_default();

    Ok(SidecarExecResult {
        status,
        stdout,
        stderr,
    })
}

fn apply_diarization_model_env(cmd: &mut Command, app: &AppHandle, script_path: &Path) {
    if env::var("DIARIZATION_MODEL_PATH").is_ok() {
        return;
    }
    // 既定の保存先（dev: プロジェクト相対 / release: app_local_data_dir）を優先する。
    // ダウンロード先（resolve_default_diarization_model_dir）と実行時参照を一致させる。
    if let Ok(default_model_dir) = resolve_default_diarization_model_dir(app) {
        if default_model_dir.exists() {
            cmd.env(
                "DIARIZATION_MODEL_PATH",
                default_model_dir.to_string_lossy().to_string(),
            );
            return;
        }
    }
    // フォールバック: スクリプト隣接の models ディレクトリ（同梱・ポータブル配置向け）。
    if let Some(sidecar_dir) = script_path.parent() {
        let default_model_dir = resolve_default_diarization_model_dir_from_base(sidecar_dir);
        if default_model_dir.exists() {
            cmd.env(
                "DIARIZATION_MODEL_PATH",
                default_model_dir.to_string_lossy().to_string(),
            );
        }
    }
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
    search_dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("ffmpeg"));

    let exe = std::env::consts::EXE_SUFFIX;
    for dir in &search_dirs {
        let path = dir.join(format!("ffmpeg{exe}"));
        if path.exists() {
            return Some(path.to_string_lossy().into_owned());
        }
    }
    None
}

/// 同梱 LGPL ffmpeg があれば FFMPEG_BIN として渡す。
/// transcribe_cli.py は PyAV の代わりにこの CLI で音声をデコードし、
/// diarize_cli.py も同じバイナリで WAV 変換する（Apache-2.0 配布の前提）。
/// imageio-ffmpeg の GPL フォールバックは、明示許可されない限り使わせない。
fn apply_ffmpeg_bin_env(cmd: &mut Command, app: &AppHandle) {
    cmd.env("ALLOW_GPL_FFMPEG", "0");
    if env::var("FFMPEG_BIN").is_ok() {
        return;
    }
    if let Some(bin) = find_bundled_ffmpeg_bin(app) {
        cmd.env("FFMPEG_BIN", bin);
    }
}

/// 実行時サイドカー（文字起こし・話者分離）がモデル読み込み時に意図せず
/// インターネットへ接続しないよう、offline 系の環境変数を付与して fail-closed 化する。
///
/// 本アプリのモデルはローカル配置（pyannote community-1）または事前ダウンロード済み
/// （faster-whisper を HF_HUB_CACHE へ取得）であり、通常運用ではキャッシュヒットで
/// 完結する。万一サブファイルが欠落していた場合でも、黙ってネットワーク取得する
/// （= 通常運用時にインターネットへ接続する）のではなく、明示的に失敗させる。
///
/// 注意: モデル取得を行うダウンロード系 CLI（download_*_cli.py / setup_venv_cli.py /
/// detect_env_cli.py）にはこのヘルパーを適用しないこと。これらはネットワーク取得が前提。
fn apply_offline_model_env(cmd: &mut Command) {
    cmd.env("HF_HUB_OFFLINE", "1")
        .env("TRANSFORMERS_OFFLINE", "1")
        .env("HF_HUB_DISABLE_TELEMETRY", "1")
        .env("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1");
}

fn apply_child_runtime_env(cmd: &mut Command, device: &str, _hip_device_index: Option<i32>) {
    let emulate_no_cuda = should_emulate_no_cuda();
    if cfg!(target_os = "windows") {
        cmd.env("KMP_DUPLICATE_LIB_OK", "TRUE");
        if device == "cuda" {
            // GPU 実行時は CPU 側スレッドを抑制して競合を避ける。
            cmd.env("OMP_NUM_THREADS", "1");
            cmd.env("MKL_NUM_THREADS", "1");
        } else {
            // CPU 実行時は利用可能並列数を使う。
            let parallel = std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4)
                .max(1);
            cmd.env("OMP_NUM_THREADS", parallel.to_string());
            cmd.env("MKL_NUM_THREADS", parallel.to_string());
        }
    }

    if cfg!(target_os = "windows") && !emulate_no_cuda {
        if let Some(extra_path) = collect_windows_cuda_paths() {
            let current = env::var("PATH").unwrap_or_default();
            let merged = if current.is_empty() {
                extra_path
            } else {
                format!("{extra_path};{current}")
            };
            cmd.env("PATH", merged);
        }
    }

    if device == "cuda" {
        if emulate_no_cuda {
            // 開発時の CUDA なし挙動エミュレーション用。
            cmd.env("CUDA_VISIBLE_DEVICES", "-1");
            return;
        }
        // Hybrid GPU 環境で iGPU 側に寄る挙動を避けるため、CUDA デバイス順序を固定。
        // PCI_BUS_ID 順は nvidia-smi の index と一致するため、設定ドロップダウンで選んだ
        // インデックスをそのまま CUDA_VISIBLE_DEVICES に渡せる。
        cmd.env("CUDA_DEVICE_ORDER", "PCI_BUS_ID");
        // 選択された GPU（nvidia-smi / PCI バス順インデックス）を使う。
        // 未指定(-1)/None のときは従来どおり先頭(0)。複数 NVIDIA GPU 環境で
        // 文字起こし・話者分離を指定 GPU に振り分けられるようにする。
        let cuda_idx = _hip_device_index
            .filter(|&i| i >= 0)
            .unwrap_or(0)
            .to_string();
        cmd.env("CUDA_VISIBLE_DEVICES", &cuda_idx);
        // AMD ROCm 環境: /dev/kfd の存在で検出し HIP デバイス選択変数を設定する。
        // NVIDIA 環境ではこれらの変数は無視されるため設定しても安全。
        // hip_device_index が指定されている場合はそのデバイスを優先する。
        // ROCR_VISIBLE_DEVICES は設定しない: HIP_VISIBLE_DEVICES と同時に設定すると
        // ROCR が先にデバイスリストを絞り込み、HIP が絞り込み後のインデックスを参照するため
        // device index >= 1 の場合に「デバイスが見つからない」エラーが発生する。
        #[cfg(target_os = "linux")]
        if std::path::Path::new("/dev/kfd").exists() {
            let idx = _hip_device_index
                .filter(|&i| i >= 0)
                .unwrap_or(0)
                .to_string();
            cmd.env("HIP_VISIBLE_DEVICES", &idx);
        }
    }
}

fn should_emulate_no_cuda() -> bool {
    matches!(read_dev_emulation_mode(), DevEmulationMode::NoCuda)
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

impl DevEmulationMode {
    fn as_str(self) -> &'static str {
        match self {
            DevEmulationMode::None => "none",
            DevEmulationMode::NoCuda => "no_cuda",
            DevEmulationMode::MissingCommunity1 => "missing_community1",
        }
    }
}

fn read_dev_emulation_mode() -> DevEmulationMode {
    if let Ok(raw) = env::var("OFFLINE_TRANSCRIBER_DEV_EMULATION_MODE") {
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

fn collect_windows_cuda_paths() -> Option<String> {
    if !cfg!(target_os = "windows") {
        return None;
    }

    let mut dirs: Vec<String> = Vec::new();

    if let Some(p) = find_windows_dll_parent("cublas64_12.dll") {
        dirs.push(p);
    }
    if let Some(p) = find_windows_dll_parent("cudnn64_9.dll") {
        dirs.push(p);
    }

    // where.exe で見つからないケース向けの一般的なインストール先ヒント。
    let fallback_candidates = [
        r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.9\bin",
        r"C:\Program Files\NVIDIA\CUDNN\v9.20\bin\12.9\x64",
    ];
    for candidate in fallback_candidates {
        if Path::new(candidate).exists() && !dirs.iter().any(|d| d.eq_ignore_ascii_case(candidate))
        {
            dirs.push(candidate.to_string());
        }
    }

    if dirs.is_empty() {
        None
    } else {
        Some(dirs.join(";"))
    }
}

fn find_windows_dll_parent(dll_name: &str) -> Option<String> {
    let mut cmd = Command::new("where.exe");
    apply_windows_no_window(&mut cmd);
    let output = cmd.arg(dll_name).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout.lines().find(|line| !line.trim().is_empty())?.trim();
    let parent = Path::new(first_line).parent()?;
    Some(parent.to_string_lossy().to_string())
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

fn build_gpu_retry_plan(selected_compute_type: &str, low_memory_mode: bool) -> Vec<String> {
    let mut plan: Vec<String> = Vec::new();
    let mut push_unique = |value: &str| {
        if !plan.iter().any(|v| v == value) {
            plan.push(value.to_string());
        }
    };

    push_unique(selected_compute_type);
    if low_memory_mode {
        push_unique("int8_float16");
    }
    push_unique("float16");
    push_unique("float32");
    push_unique("int8_float16");
    push_unique("int8");
    plan
}

fn should_retry_gpu_attempt(output: &SidecarExecResult, parsed_json: Option<&Value>) -> bool {
    let crash_like = matches!(
        output.status.code(),
        Some(-1073740791) | Some(-1073741515) | Some(-1073741819)
    );
    if crash_like {
        return true;
    }

    let stdout_empty = output.stdout.trim().is_empty();
    let stderr_empty = output.stderr.trim().is_empty();
    if stdout_empty && stderr_empty {
        return true;
    }

    if let Some(json) = parsed_json {
        let err_type = json
            .get("error")
            .and_then(|e| e.get("type"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if err_type == "file_not_found" {
            return false;
        }
    }

    // Runtime errors may still be recoverable via compute-type switch.
    true
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
    python_bin: &str,
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
        "debug: exit={:?}, python_bin={}, stdout_len={}, stderr_len={}",
        output.status.code(),
        python_bin,
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

fn resolve_encrypt_office_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    let script_name = "encrypt_office_cli.py";
    let script_relative = PathBuf::from("python_sidecar").join(script_name);

    if cfg!(debug_assertions) {
        let manifest_dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(&script_relative);
        if manifest_dev_path.exists() {
            return Ok(manifest_dev_path);
        }

        let cwd = env::current_dir().map_err(|e| format!("カレントディレクトリ解決に失敗: {e}"))?;
        let dev_path = cwd.join(&script_relative);
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    let bundled_candidates = resolve_bundled_sidecar_script_candidates(app, script_name)?;
    for candidate in &bundled_candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "暗号化スクリプトが見つかりません: {}",
        bundled_candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<String>>()
            .join(" / ")
    ))
}

fn resolve_sidecar_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    let script_name = "transcribe_cli.py";
    let script_relative = PathBuf::from("python_sidecar").join(script_name);

    if cfg!(debug_assertions) {
        let manifest_dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(&script_relative);
        if manifest_dev_path.exists() {
            return Ok(manifest_dev_path);
        }

        let cwd = env::current_dir().map_err(|e| format!("カレントディレクトリ解決に失敗: {e}"))?;
        let dev_path = cwd.join(&script_relative);
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    let bundled_candidates = resolve_bundled_sidecar_script_candidates(app, script_name)?;
    for candidate in &bundled_candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "Python sidecar スクリプトが見つかりません: {}",
        bundled_candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<String>>()
            .join(" / ")
    ))
}

fn resolve_diarize_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    let script_name = "diarize_cli.py";
    let script_relative = PathBuf::from("python_sidecar").join(script_name);

    if cfg!(debug_assertions) {
        let manifest_dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(&script_relative);
        if manifest_dev_path.exists() {
            return Ok(manifest_dev_path);
        }

        let cwd = env::current_dir().map_err(|e| format!("カレントディレクトリ解決に失敗: {e}"))?;
        let dev_path = cwd.join(&script_relative);
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    let bundled_candidates = resolve_bundled_sidecar_script_candidates(app, script_name)?;
    for candidate in &bundled_candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "Diarization sidecar スクリプトが見つかりません: {}",
        bundled_candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<String>>()
            .join(" / ")
    ))
}

fn resolve_llm_proofread_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    let script_name = "proofread_llm_cli.py";
    let script_relative = PathBuf::from("python_sidecar").join(script_name);

    if cfg!(debug_assertions) {
        let manifest_dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(&script_relative);
        if manifest_dev_path.exists() {
            return Ok(manifest_dev_path);
        }

        let cwd = env::current_dir().map_err(|e| format!("カレントディレクトリ解決に失敗: {e}"))?;
        let dev_path = cwd.join(&script_relative);
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    let bundled_candidates = resolve_bundled_sidecar_script_candidates(app, script_name)?;
    for candidate in &bundled_candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "LLM proofread sidecar スクリプトが見つかりません: {}",
        bundled_candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<String>>()
            .join(" / ")
    ))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverallProofreadResponse {
    success: bool,
    result: Option<OverallProofreadResult>,
    error_message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverallProofreadResult {
    items: Vec<serde_json::Value>,
    changed_count: i64,
    unchanged_count: i64,
}

fn resolve_overall_proofread_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    let script_name = "overall_proofread_cli.py";
    let script_relative = PathBuf::from("python_sidecar").join(script_name);

    if cfg!(debug_assertions) {
        let manifest_dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(&script_relative);
        if manifest_dev_path.exists() {
            return Ok(manifest_dev_path);
        }
        let cwd = env::current_dir().map_err(|e| format!("カレントディレクトリ解決に失敗: {e}"))?;
        let dev_path = cwd.join(&script_relative);
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    let bundled_candidates = resolve_bundled_sidecar_script_candidates(app, script_name)?;
    for candidate in &bundled_candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "overall proofread sidecar スクリプトが見つかりません: {}",
        bundled_candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<String>>()
            .join(" / ")
    ))
}

fn run_overall_proofread_blocking(
    app: AppHandle,
    request: LlmProofreadRequest,
) -> Result<OverallProofreadResponse, String> {
    set_cancel_requested(RunningTaskKind::LlmProofread, false);
    let lemonade_port = app.state::<LemonadeServer>().port.load(Ordering::Relaxed) as u16;

    if request.segments.is_empty() {
        return Ok(OverallProofreadResponse {
            success: false,
            result: None,
            error_message: Some("校正対象のセグメントがありません。".to_string()),
        });
    }

    let backend = request.backend.as_deref().unwrap_or("llama_cpp");
    let is_lemonade = backend == "lemonade";
    let is_openai_compatible = backend == "openai_compatible";
    let is_llama_cpp = backend == "llama_cpp" || backend == "llama_cpp_rocm";

    if !is_llama_cpp && !is_lemonade && !is_openai_compatible {
        return Ok(OverallProofreadResponse {
            success: false,
            result: None,
            error_message: Some(format!("未対応の LLM バックエンドです: {backend}")),
        });
    }

    if is_openai_compatible && !external_llm_enabled(&app) {
        return Ok(OverallProofreadResponse {
            success: false,
            result: None,
            error_message: Some(EXTERNAL_LLM_DISABLED_MESSAGE.to_string()),
        });
    }

    if !is_lemonade && !is_openai_compatible && request.model_path.is_empty() {
        return Ok(OverallProofreadResponse {
            success: false,
            result: None,
            error_message: Some("LLMモデルのパスが指定されていません。".to_string()),
        });
    }

    let openai_base_url = if is_openai_compatible {
        let raw = request.openai_base_url.as_deref().unwrap_or("");
        Some(validate_local_openai_base_url(raw)?)
    } else {
        None
    };
    let openai_model = if is_openai_compatible {
        let model = request.openai_model.as_deref().unwrap_or("").trim().to_string();
        if model.is_empty() {
            return Ok(OverallProofreadResponse {
                success: false,
                result: None,
                error_message: Some("ローカルOpenAI互換APIのモデル名が指定されていません。".to_string()),
            });
        }
        Some(model)
    } else {
        None
    };

    // openai_compatible の場合、モデルが既にロード済みかを確認する。
    // 未ロードの場合は校正完了・中止・アプリ終了時にアンロードを試みる。
    let openai_unload_info: Option<OpenAiUnloadTarget> = if is_openai_compatible {
        let base = openai_base_url.as_deref().unwrap_or("");
        let model = openai_model.as_deref().unwrap_or("");
        prepare_openai_unload_info(base, model, &app).inspect(|info| {
            if let Ok(mut guard) = app.state::<OpenAiUnloadState>().0.lock() {
                *guard = Some(info.clone());
            }
        })
    } else {
        None
    };

    let script_path = resolve_overall_proofread_script_path(&app)?;

    let python_bin = get_python_bin(&app);

    let segments_json: Vec<serde_json::Value> = request
        .segments
        .iter()
        .map(|s| serde_json::json!({"id": s.id, "text": s.text, "speaker": s.speaker}))
        .collect();
    let segments_json_str = serde_json::to_string(&segments_json)
        .map_err(|e| format!("JSON シリアライズに失敗: {e}"))?;

    let tmp_dir = std::env::temp_dir();
    let invocation_id = LLM_PROOFREAD_INVOCATION_COUNTER.fetch_add(1, Ordering::Relaxed);

    let system_prompt_tmp_path = request
        .system_prompt
        .as_deref()
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
        .map(|prompt| {
            let path = tmp_dir.join(format!(
                "lott_overall_system_prompt_{}_{}.txt",
                std::process::id(),
                invocation_id
            ));
            std::fs::write(&path, prompt)
                .map_err(|e| format!("全体校正システムプロンプトの一時保存に失敗しました: {e}"))?;
            Ok::<PathBuf, String>(path)
        })
        .transpose()?;

    let tmp_path = tmp_dir.join(format!(
        "lott_overall_segments_{}_{}.json",
        std::process::id(),
        invocation_id
    ));
    std::fs::write(&tmp_path, &segments_json_str)
        .map_err(|e| format!("一時ファイルの書き込みに失敗: {e}"))?;

    // 会話本文/システムプロンプトを含む一時ファイルは、以降のどの早期 return でも
    // 確実に削除されるよう RAII ガードへ登録する（spawn 失敗・パイプ取得失敗を含む）。
    let mut _tmp_guard = TempFileGuard::new();
    _tmp_guard.push(tmp_path.clone());
    if let Some(ref path) = system_prompt_tmp_path {
        _tmp_guard.push(path.clone());
    }

    let n_gpu_layers = request.n_gpu_layers.unwrap_or(-1);
    let n_ctx = request.n_ctx.unwrap_or(16384).clamp(4096, 131072);

    let mut cmd = Command::new(&python_bin);
    apply_windows_no_window(&mut cmd);
    cmd.env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .arg(&script_path)
        .arg("--segments-json-path")
        .arg(&tmp_path)
        .arg("--backend")
        .arg(backend)
        .arg("--n-ctx")
        .arg(n_ctx.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if is_lemonade {
        let url = request.lemonade_url.as_deref().unwrap_or("http://localhost:13306");
        let model = request.lemonade_model.as_deref().unwrap_or(LEMONADE_DEFAULT_MODEL);
        cmd.arg("--lemonade-url").arg(url);
        cmd.arg("--lemonade-model").arg(model);
        // CUDA llama-server (mode==1) のときだけ、起動時に決めたスロット数 (-np) と同じ
        // 同時送信数で並列ディスパッチし GPU のアイドルを埋める（全体校正も継続バッチング）。
        let lemo = app.state::<LemonadeServer>();
        if lemo.mode.load(Ordering::Relaxed) == 1 {
            let np = lemo.parallel.load(Ordering::Relaxed).max(1);
            cmd.arg("--parallel").arg(np.to_string());
        }
    } else if is_openai_compatible {
        cmd.arg("--openai-base-url")
            .arg(openai_base_url.as_deref().unwrap_or(""))
            .arg("--openai-model")
            .arg(openai_model.as_deref().unwrap_or(""));
    } else {
        cmd.arg("--model-path")
            .arg(&request.model_path)
            .arg("--n-gpu-layers")
            .arg(n_gpu_layers.to_string());
    }
    if let Some(ref pt) = request.prompt_type {
        if pt == "gemma4" || pt == "original" {
            cmd.arg("--prompt-type").arg(pt);
        }
    }
    if let Some(ref path) = system_prompt_tmp_path {
        cmd.arg("--system-prompt-path").arg(path);
    }

    emit_progress(&app, "llm_sidecar_start", "全体校正サイドカーを起動しています...", None);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("overall proofread sidecar の起動に失敗しました: {e}"))?;
    set_running_pid(RunningTaskKind::LlmProofread, child.id());

    let stdout_reader = child.stdout.take()
        .ok_or_else(|| "stdout パイプ取得に失敗しました。".to_string())?;
    let stderr_reader = child.stderr.take()
        .ok_or_else(|| "stderr パイプ取得に失敗しました。".to_string())?;

    let stdout_buf = Arc::new(Mutex::new(String::new()));
    let stderr_buf = Arc::new(Mutex::new(String::new()));

    let stdout_buf_clone = Arc::clone(&stdout_buf);
    let stdout_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout_reader);
        for line in reader.lines() {
            if let Ok(text) = line {
                let mut out = stdout_buf_clone.lock().expect("stdout mutex poisoned");
                out.push_str(&text);
                out.push('\n');
            }
        }
    });

    let stderr_buf_clone = Arc::clone(&stderr_buf);
    let app_clone = app.clone();
    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr_reader);
        for line in reader.lines() {
            if let Ok(text) = line {
                if let Some(marker_pos) = text.find("PROGRESS_JSON:") {
                    let payload = &text[(marker_pos + "PROGRESS_JSON:".len())..];
                    if let Ok(json) = serde_json::from_str::<Value>(payload.trim()) {
                        let _ = app_clone.emit("transcription-progress", json);
                    } else {
                        let mut err = stderr_buf_clone.lock().expect("stderr mutex poisoned");
                        err.push_str(&text);
                        err.push('\n');
                    }
                } else {
                    let mut err = stderr_buf_clone.lock().expect("stderr mutex poisoned");
                    err.push_str(&text);
                    err.push('\n');
                }
            }
        }
    });

    let status = match child.wait() {
        Ok(v) => {
            clear_running_pid(RunningTaskKind::LlmProofread);
            v
        }
        Err(e) => {
            clear_running_pid(RunningTaskKind::LlmProofread);
            let _ = std::fs::remove_file(&tmp_path);
            if let Some(ref info) = openai_unload_info {
                try_unload_openai_model(info, lemonade_port);
                if let Ok(mut guard) = app.state::<OpenAiUnloadState>().0.lock() {
                    *guard = None;
                }
            }
            if is_lemonade && !try_stop_cuda_llama_server(&app) {
                try_unload_lemonade_cli(lemonade_port);
            }
            return Err(format!("overall proofread sidecar の終了待機に失敗しました: {e}"));
        }
    };

    let _ = stdout_handle.join();
    let _ = stderr_handle.join();
    let _ = std::fs::remove_file(&tmp_path);
    if let Some(ref p) = system_prompt_tmp_path {
        let _ = std::fs::remove_file(p);
    }

    // サイドカー終了後（成功・中止・失敗すべて）に必ずアンロードを試みる
    if let Some(ref info) = openai_unload_info {
        try_unload_openai_model(info, lemonade_port);
        if let Ok(mut guard) = app.state::<OpenAiUnloadState>().0.lock() {
            *guard = None;
        }
    }
    if is_lemonade && !try_stop_cuda_llama_server(&app) {
        try_unload_lemonade_cli(lemonade_port);
    }

    let stdout = stdout_buf.lock().map(|v| v.clone()).unwrap_or_default();
    let stderr = stderr_buf.lock().map(|v| v.clone()).unwrap_or_default();

    if take_cancel_requested(RunningTaskKind::LlmProofread) {
        return Ok(OverallProofreadResponse {
            success: false,
            result: None,
            error_message: Some("全体校正が中止されました。".to_string()),
        });
    }

    let parsed = parse_json_from_mixed_output(&stdout);

    if !status.success() {
        // 推論中の VRAM 不足（OOM）を検出。stdout/stderr が SidecarExecResult へムーブされる前に判定する。
        let oom = text_indicates_vram_oom(&stderr) || text_indicates_vram_oom(&stdout);
        let tag = |m: String| {
            if oom && !m.contains(VRAM_OOM_MARKER) {
                format!("{VRAM_OOM_MARKER} {m}")
            } else {
                m
            }
        };
        // Python が JSON エラーを出力していればそのメッセージを優先する
        let clean_msg = parsed
            .as_ref()
            .and_then(|j| j.get("error"))
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string);
        if let Some(msg) = clean_msg {
            return Ok(OverallProofreadResponse {
                success: false,
                result: None,
                error_message: Some(tag(msg)),
            });
        }
        let err_msg = build_detailed_sidecar_error_message(
            "全体校正処理に失敗しました。",
            &python_bin,
            &SidecarExecResult { status, stdout, stderr },
            parsed.as_ref(),
        );
        return Ok(OverallProofreadResponse {
            success: false,
            result: None,
            error_message: Some(tag(err_msg)),
        });
    }

    let json = parsed.ok_or_else(|| {
        format!(
            "全体校正の出力をパースできませんでした。stdout: {}",
            stdout.chars().take(300).collect::<String>()
        )
    })?;

    let success = json.get("success").and_then(Value::as_bool).unwrap_or(false);
    if !success {
        let msg = json
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("全体校正でエラーが発生しました。")
            .to_string();
        return Ok(OverallProofreadResponse {
            success: false,
            result: None,
            error_message: Some(tag_vram_oom_if_present(msg, &stdout, &stderr)),
        });
    }

    let result_val = json.get("result").cloned().unwrap_or(Value::Null);
    let items = result_val
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let changed_count = result_val
        .get("changedCount")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let unchanged_count = result_val
        .get("unchangedCount")
        .and_then(Value::as_i64)
        .unwrap_or(0);

    Ok(OverallProofreadResponse {
        success: true,
        result: Some(OverallProofreadResult { items, changed_count, unchanged_count }),
        error_message: None,
    })
}

/// ダウンロードサブプロセスの stdout をストリーム読みし、進捗イベントを emit する。
///
/// Python スクリプトは以下の形式で stdout に出力する:
/// - 進捗行: `{"type": "progress", "downloaded_bytes": N}`  (繰り返し)
/// - 最終行: `{"success": true/false, "message": "..."}`
///
/// 成功時は message 文字列を返し、失敗時はエラーメッセージを返す。
fn run_download_streaming(
    app: &AppHandle,
    cmd: &mut Command,
    component: &str,
) -> Result<String, String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::inherit());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("プロセス起動に失敗しました: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "stdout の取得に失敗しました".to_string())?;
    let reader = BufReader::new(stdout);

    let mut final_result: Option<serde_json::Value> = None;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };

        match v.get("type").and_then(|t| t.as_str()) {
            Some("progress") => {
                let progress_component = v["component"].as_str().unwrap_or(component);
                let downloaded = v["downloaded_bytes"].as_u64().unwrap_or(0);
                let total = v["total_bytes"].as_u64().filter(|&t| t > 0);
                let msg = if downloaded > 0 {
                    if let Some(t) = total {
                        format!(
                            "ダウンロード中... {:.0} / {:.0} MB",
                            downloaded as f64 / 1_048_576.0,
                            t as f64 / 1_048_576.0
                        )
                    } else {
                        format!("ダウンロード中... {:.0} MB", downloaded as f64 / 1_048_576.0)
                    }
                } else {
                    "ダウンロード中...".to_string()
                };
                app.emit(
                    "setup_progress",
                    SetupProgressPayload {
                        component: progress_component.to_string(),
                        status: "downloading".to_string(),
                        message: msg,
                        downloaded_bytes: if downloaded > 0 { Some(downloaded) } else { None },
                        total_bytes: total,
                    },
                )
                .ok();
            }
            _ => {
                final_result = Some(v);
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("ダウンロードプロセスの終了確認に失敗しました: {e}"))?;

    if let Some(v) = final_result {
        let success = v["success"].as_bool().unwrap_or(false);
        let message = v["message"]
            .as_str()
            .unwrap_or(if success { "完了" } else { "ダウンロードに失敗しました" })
            .to_string();
        if !status.success() {
            Err(format!(
                "ダウンロードプロセスが失敗しました{}: {}",
                status.code().map(|code| format!(" (exit code {code})")).unwrap_or_default(),
                message
            ))
        } else if success {
            Ok(message)
        } else {
            Err(message)
        }
    } else {
        Err("ダウンロード結果が取得できませんでした".to_string())
    }
}

fn resolve_download_whisper_model_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    let script_name = "download_whisper_model_cli.py";
    let script_relative = PathBuf::from("python_sidecar").join(script_name);

    if cfg!(debug_assertions) {
        let manifest_dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(&script_relative);
        if manifest_dev_path.exists() {
            return Ok(manifest_dev_path);
        }

        let cwd = env::current_dir().map_err(|e| format!("カレントディレクトリ解決に失敗: {e}"))?;
        let dev_path = cwd.join(&script_relative);
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    let bundled_candidates = resolve_bundled_sidecar_script_candidates(app, script_name)?;
    for candidate in &bundled_candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "ダウンロードスクリプトが見つかりません: {}",
        bundled_candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<String>>()
            .join(" / ")
    ))
}

fn resolve_download_gemma_gguf_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    let script_name = "download_gemma_gguf_cli.py";
    let script_relative = PathBuf::from("python_sidecar").join(script_name);

    if cfg!(debug_assertions) {
        let manifest_dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(&script_relative);
        if manifest_dev_path.exists() {
            return Ok(manifest_dev_path);
        }
        let cwd = env::current_dir().map_err(|e| format!("カレントディレクトリ解決に失敗: {e}"))?;
        let dev_path = cwd.join(&script_relative);
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    let bundled_candidates = resolve_bundled_sidecar_script_candidates(app, script_name)?;
    for candidate in &bundled_candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "Gemmaダウンロードスクリプトが見つかりません: {}",
        bundled_candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<String>>()
            .join(" / ")
    ))
}

fn resolve_download_diarization_model_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    let script_name = "download_diarization_model_cli.py";
    let script_relative = PathBuf::from("python_sidecar").join(script_name);

    if cfg!(debug_assertions) {
        let manifest_dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(&script_relative);
        if manifest_dev_path.exists() {
            return Ok(manifest_dev_path);
        }
        let cwd = env::current_dir().map_err(|e| format!("カレントディレクトリ解決に失敗: {e}"))?;
        let dev_path = cwd.join(&script_relative);
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    let bundled_candidates = resolve_bundled_sidecar_script_candidates(app, script_name)?;
    for candidate in &bundled_candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "話者分離ダウンロードスクリプトが見つかりません: {}",
        bundled_candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<String>>()
            .join(" / ")
    ))
}

fn get_gemma_tier_target_dir(app: &AppHandle, tier: GemmaTier) -> PathBuf {
    if cfg!(debug_assertions) {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(gemma_llm_relative_dir(tier));
    }
    // リリース: アプリ固有データ領域へ集約する（NSIS の %LOCALAPPDATA%\{id} 一括削除で消える）。
    if let Some(dir) = gemma_release_model_dir(app, tier) {
        return dir;
    }
    gemma_llm_relative_dir(tier)
}

fn download_gemma_gguf_blocking(app: &AppHandle) -> Result<(), String> {
    let script_path = resolve_download_gemma_gguf_script_path(app)
        .map_err(|e| format!("Gemmaダウンロードスクリプトが見つかりません: {e}"))?;
    let target_dir = get_gemma_tier_target_dir(app, GemmaTier::E4b);

    let python_bin = get_python_bin(app);

    let mut cmd = Command::new(&python_bin);
    apply_windows_no_window(&mut cmd);
    cmd.env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .arg(&script_path)
        .arg(target_dir.to_string_lossy().as_ref());
    if app.config().identifier.contains("amd") {
        cmd.arg("--skip-mtp");
    }

    run_download_streaming(app, &mut cmd, "gemma_gguf").map(|_| ())
}

/// 上位モデル（Gemma 4 12B QAT + MTP）を後からダウンロードする（large-v3 と同じ後付け方式）。
/// NVIDIA は CUDA 同梱 llama-server、AMD は Vulkan llama-server 直起動で 12B+MTP を使うため、
/// 本体 GGUF と MTP ドラフトの両方を取得する（--skip-mtp は付けない）。
fn download_gemma_12b_blocking(app: &AppHandle) -> Result<(), String> {
    let script_path = resolve_download_gemma_gguf_script_path(app)
        .map_err(|e| format!("Gemmaダウンロードスクリプトが見つかりません: {e}"))?;
    let target_dir = get_gemma_tier_target_dir(app, GemmaTier::B12);

    let python_bin = get_python_bin(app);

    let mut cmd = Command::new(&python_bin);
    apply_windows_no_window(&mut cmd);
    cmd.env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .arg(&script_path)
        .arg(target_dir.to_string_lossy().as_ref())
        .arg("--model")
        .arg("12b");

    run_download_streaming(app, &mut cmd, "gemma_12b").map(|_| ())
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
fn strip_python312_pth_bom(_app: &AppHandle) {
    #[cfg(target_os = "windows")]
    if let Ok(resource_dir) = _app.path().resource_dir() {
        for subdir in &["resources/python312", "python312"] {
            let py_dir = resource_dir.join(subdir);
            if !py_dir.join("python.exe").exists() {
                continue;
            }
            let pth = py_dir.join("python312._pth");
            if let Ok(bytes) = std::fs::read(&pth) {
                if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
                    let _ = std::fs::write(&pth, &bytes[3..]);
                }
            }
            break;
        }
    }
}

fn check_python_venv(_app: &AppHandle) -> (bool, String) {
    #[cfg(not(target_os = "windows"))]
    {
        let python_bin = get_python_bin(_app);
        let ok = std::process::Command::new(&python_bin)
            .args([
                "-c",
                "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('faster_whisper') else 1)",
            ])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        return (ok, python_bin);
    }

    #[cfg(target_os = "windows")]
    {
        // dev: .venv312 があれば OK
        if cfg!(debug_assertions) {
            let dev_python = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join(".venv312")
                .join("Scripts")
                .join("python.exe");
            if dev_python.exists() {
                return (true, dev_python.to_string_lossy().to_string());
            }
        }

        // production: resources/python312/python.exe + パッケージ確認
        // NSIS では resource_dir = $INSTDIR, リソースは $INSTDIR/resources/ に置かれる
        if let Ok(resource_dir) = _app.path().resource_dir() {
            let python312_dir = ["resources/python312", "python312"]
                .iter()
                .map(|s| resource_dir.join(s))
                .find(|p| p.join("python.exe").exists());

            if let Some(py312) = python312_dir {
                let python_exe = py312.join("python.exe");
                let path_str = python_exe.to_string_lossy().to_string();
                let packages_ok = py312
                    .join("Lib")
                    .join("site-packages")
                    .join("faster_whisper")
                    .join("__init__.py")
                    .exists();
                return (packages_ok, path_str);
            }

            // python.exe が見つからない場合はエラーパスを返す
            let expected = resource_dir.join("resources").join("python312").join("python.exe");
            return (false, expected.to_string_lossy().to_string());
        }

        (false, String::new())
    }
}

fn resolve_setup_venv_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    let script_name = "setup_venv_cli.py";
    let script_relative = PathBuf::from("python_sidecar").join(script_name);

    if cfg!(debug_assertions) {
        let manifest_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(&script_relative);
        if manifest_path.exists() {
            return Ok(manifest_path);
        }
    }

    let bundled_candidates = resolve_bundled_sidecar_script_candidates(app, script_name)?;
    for candidate in &bundled_candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "setup_venv_cli.py が見つかりません: {}",
        bundled_candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<String>>()
            .join(" / ")
    ))
}

fn resolve_requirements_runtime_path(app: &AppHandle) -> Result<PathBuf, String> {
    let filename = if app.config().identifier.contains("amd") {
        "requirements-amd.txt"
    } else {
        "requirements-runtime.txt"
    };
    let rel = PathBuf::from("python_sidecar").join(filename);

    if cfg!(debug_assertions) {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(&rel);
        if p.exists() {
            return Ok(p);
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join(&rel);
        if bundled.exists() {
            return Ok(bundled);
        }
        let up = resource_dir.join("_up_").join(&rel);
        if up.exists() {
            return Ok(up);
        }
    }

    Err(format!("{} が見つかりません", filename))
}

fn run_venv_setup_streaming(app: &AppHandle, cmd: &mut Command) -> Result<(), String> {
    use std::io::BufRead;
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("venv セットアップスクリプトの起動に失敗しました: {e}"))?;

    let stdout = child.stdout.take().ok_or("stdout が取得できません")?;
    let stderr = child.stderr.take();
    let reader = std::io::BufReader::new(stdout);

    for line in reader.lines() {
        let line = line.map_err(|e| format!("出力の読み取りに失敗: {e}"))?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        match v.get("type").and_then(|t| t.as_str()) {
            Some("progress") => {
                let msg = v["message"].as_str().unwrap_or("処理中...");
                emit_setup_progress(app, "python_env", "downloading", msg);
            }
            Some("done") => {
                let _ = child.wait();
                return Ok(());
            }
            Some("error") => {
                let msg = v["message"]
                    .as_str()
                    .unwrap_or("エラーが発生しました")
                    .to_string();
                let _ = child.wait();
                return Err(msg);
            }
            _ => {}
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("プロセス待機に失敗: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        let stderr_text = stderr
            .and_then(|mut s| {
                let mut buf = String::new();
                std::io::Read::read_to_string(&mut s, &mut buf).ok()?;
                let trimmed = buf.trim().to_string();
                if trimmed.is_empty() { None } else { Some(trimmed) }
            })
            .unwrap_or_default();
        if stderr_text.is_empty() {
            Err("Python 環境のセットアップに失敗しました".to_string())
        } else {
            Err(format!("Python 環境のセットアップに失敗しました:\n{stderr_text}"))
        }
    }
}

fn setup_python_venv_blocking(_app: &AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let python_bin = get_python_bin(_app);
        let script_path = resolve_setup_venv_script_path(_app)?;
        let req_path = resolve_requirements_runtime_path(_app)?;
        let variant = if _app.config().identifier.contains("amd") { "rocm" } else { "cuda" };
        let mut cmd = Command::new(&python_bin);
        cmd.env("PYTHONUTF8", "1")
            .env("PYTHONIOENCODING", "utf-8")
            .args([
                script_path.to_str().unwrap_or(""),
                req_path.to_str().unwrap_or(""),
                "--variant", variant,
            ]);
        return run_venv_setup_streaming(_app, &mut cmd);
    }

    #[cfg(target_os = "windows")]
    {
        let resource_dir = _app
            .path()
            .resource_dir()
            .map_err(|e| format!("resource_dir 解決に失敗: {e}"))?;
        let bundled_python = ["resources/python312", "python312"]
            .iter()
            .map(|s| resource_dir.join(s).join("python.exe"))
            .find(|p| p.exists())
            .ok_or_else(|| format!(
                "同梱 Python が見つかりません: {}",
                resource_dir.join("resources").join("python312").join("python.exe").display()
            ))?;

        strip_python312_pth_bom(_app);

        let script_path = resolve_setup_venv_script_path(_app)?;
        let req_path = resolve_requirements_runtime_path(_app)?;

        let mut cmd = Command::new(&bundled_python);
        apply_windows_no_window(&mut cmd);
        cmd.env("PYTHONUTF8", "1")
            .env("PYTHONIOENCODING", "utf-8")
            .args([
                script_path.to_str().unwrap_or(""),
                req_path.to_str().unwrap_or(""),
            ]);

        run_venv_setup_streaming(_app, &mut cmd)
    }
}

fn run_full_setup_blocking(app: AppHandle, hf_token: Option<String>) -> Result<bool, String> {
    let mut all_ok = true;

    // 0. Python venv（Windows のみ）
    {
        let (venv_ok, _) = check_python_venv(&app);
        if venv_ok {
            emit_setup_progress(&app, "python_env", "skipped", "インストール済みです");
        } else {
            match setup_python_venv_blocking(&app) {
                Ok(_) => emit_setup_progress(&app, "python_env", "done", "セットアップ完了"),
                Err(e) => {
                    emit_setup_progress(&app, "python_env", "error", &format!("エラー: {e}"));
                    return Ok(false);
                }
            }
        }
    }

    // 1. faster-whisper turbo model
    if check_whisper_turbo_cached(&app) {
        emit_setup_progress(&app, "whisper_turbo", "skipped", "インストール済みです");
    } else {
        emit_setup_progress(&app, "whisper_turbo", "downloading", "faster-whisper turboモデルをダウンロード中...");
        match download_whisper_model_blocking(app.clone(), "turbo".to_string()) {
            Ok(_) => emit_setup_progress(&app, "whisper_turbo", "done", "ダウンロード完了"),
            Err(e) => {
                emit_setup_progress(&app, "whisper_turbo", "error", &format!("エラー: {e}"));
                all_ok = false;
            }
        }
    }

    // 2. diarization model (requires HF token)
    // config.yaml だけでなく実体ファイル・DL中断マーカーまで見て完全性を判定する。
    // 途中で切れて一部だけ揃った状態は未完了扱いにし、補完 DL を走らせる。
    let dia_ok = resolve_default_diarization_model_dir(&app)
        .map(|d| diarization_model_is_complete(&d))
        .unwrap_or(false);
    if dia_ok {
        emit_setup_progress(&app, "diarization", "skipped", "インストール済みです");
    } else {
        let token = hf_token.as_deref().unwrap_or("").trim().to_string();
        if token.is_empty() {
            emit_setup_progress(&app, "diarization", "skipped", "トークン未入力のためスキップ");
        } else {
            emit_setup_progress(&app, "diarization", "downloading", "話者分離モデルをダウンロード中...");
            match install_diarization_model_impl(&app, &token) {
                Ok(r) if r.success => emit_setup_progress(&app, "diarization", "done", &r.message),
                Ok(r) => {
                    emit_setup_progress(&app, "diarization", "error", &r.message);
                    all_ok = false;
                }
                Err(e) => {
                    emit_setup_progress(&app, "diarization", "error", &e);
                    all_ok = false;
                }
            }
        }
    }

    // 3. Gemma 4 E4B GGUF + MTP draft model
    let (gemma_ok, _) = get_gemma_gguf_info(&app);
    let gemma_mtp_needed = !app.config().identifier.contains("amd");
    let gemma_mtp_ok = if gemma_mtp_needed {
        get_gemma_mtp_gguf_info(&app).0
    } else {
        true
    };
    if gemma_ok && gemma_mtp_ok {
        emit_setup_progress(&app, "gemma_gguf", "skipped", "インストール済みです");
        if gemma_mtp_needed {
            emit_setup_progress(&app, "gemma_mtp_gguf", "skipped", "インストール済みです");
        }
    } else {
        if !gemma_ok {
            emit_setup_progress(&app, "gemma_gguf", "downloading", "Gemma 4 E4Bモデルをダウンロード中（約4.3GB）...");
        }
        if gemma_mtp_needed && !gemma_mtp_ok {
            emit_setup_progress(&app, "gemma_mtp_gguf", "downloading", "Gemma 4 E4B MTPモデルをダウンロード中（約60MB）...");
        }
        match download_gemma_gguf_blocking(&app) {
            Ok(_) => {
                let (gemma_ok_after, _) = get_gemma_gguf_info(&app);
                let gemma_mtp_ok_after = if gemma_mtp_needed {
                    get_gemma_mtp_gguf_info(&app).0
                } else {
                    true
                };
                if gemma_ok {
                    emit_setup_progress(&app, "gemma_gguf", "skipped", "インストール済みです");
                } else {
                    emit_setup_progress(
                        &app,
                        "gemma_gguf",
                        if gemma_ok_after { "done" } else { "error" },
                        if gemma_ok_after { "ダウンロード完了" } else { "Gemma 4 E4Bモデルが見つかりません" },
                    );
                }
                if gemma_mtp_needed {
                    if gemma_mtp_ok {
                        emit_setup_progress(&app, "gemma_mtp_gguf", "skipped", "インストール済みです");
                    } else {
                        emit_setup_progress(
                            &app,
                            "gemma_mtp_gguf",
                            if gemma_mtp_ok_after { "done" } else { "error" },
                            if gemma_mtp_ok_after { "ダウンロード完了" } else { "Gemma 4 E4B MTPモデルが見つかりません" },
                        );
                    }
                }
                if !gemma_ok_after || !gemma_mtp_ok_after {
                    all_ok = false;
                }
            }
            Err(e) => {
                // ダウンロード前から揃っていたコンポーネントまでエラー表示にしない
                if gemma_ok {
                    emit_setup_progress(&app, "gemma_gguf", "skipped", "インストール済みです");
                } else {
                    emit_setup_progress(&app, "gemma_gguf", "error", &format!("エラー: {e}"));
                }
                if gemma_mtp_needed {
                    if gemma_mtp_ok {
                        emit_setup_progress(&app, "gemma_mtp_gguf", "skipped", "インストール済みです");
                    } else {
                        emit_setup_progress(&app, "gemma_mtp_gguf", "error", &format!("エラー: {e}"));
                    }
                }
                all_ok = false;
            }
        }
    }

    Ok(all_ok)
}

#[tauri::command]
async fn run_full_setup(app: AppHandle, hf_token: Option<String>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || run_full_setup_blocking(app, hf_token))
        .await
        .map_err(|e| format!("セットアップタスクの実行に失敗しました: {e}"))?
}

fn resolve_detect_env_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    let script_name = "detect_env_cli.py";
    let script_relative = PathBuf::from("python_sidecar").join(script_name);

    if cfg!(debug_assertions) {
        let manifest_dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(&script_relative);
        if manifest_dev_path.exists() {
            return Ok(manifest_dev_path);
        }

        let cwd = env::current_dir().map_err(|e| format!("カレントディレクトリ解決に失敗: {e}"))?;
        let dev_path = cwd.join(&script_relative);
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    let bundled_candidates = resolve_bundled_sidecar_script_candidates(app, script_name)?;
    for candidate in &bundled_candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "detect_env_cli スクリプトが見つかりません: {}",
        bundled_candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<String>>()
            .join(" / ")
    ))
}

fn resolve_proofread_system_prompt_path(app: &AppHandle) -> Result<PathBuf, String> {
    let prompt_relative = PathBuf::from("python_sidecar")
        .join("prompt_templates")
        .join("proofread")
        .join("gemma4_system.txt");

    if cfg!(debug_assertions) {
        let manifest_dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(&prompt_relative);
        if manifest_dev_path.exists() {
            return Ok(manifest_dev_path);
        }

        let cwd = env::current_dir().map_err(|e| format!("カレントディレクトリ解決に失敗: {e}"))?;
        let dev_path = cwd.join(&prompt_relative);
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir 解決に失敗: {e}"))?;
    let bundled_candidates = vec![
        resource_dir.join(&prompt_relative),
        resource_dir.join("_up_").join(&prompt_relative),
        resource_dir
            .join("prompt_templates")
            .join("proofread")
            .join("gemma4_system.txt"),
        resource_dir
            .join("_up_")
            .join("prompt_templates")
            .join("proofread")
            .join("gemma4_system.txt"),
    ];

    for candidate in &bundled_candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "校正プロンプトが見つかりません: {}",
        bundled_candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<String>>()
            .join(" / ")
    ))
}

fn resolve_default_proofread_system_prompt_path(app: &AppHandle) -> Result<PathBuf, String> {
    let prompt_relative = PathBuf::from("python_sidecar")
        .join("prompt_templates")
        .join("proofread")
        .join("general_system.txt");

    if cfg!(debug_assertions) {
        let manifest_dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(&prompt_relative);
        if manifest_dev_path.exists() {
            return Ok(manifest_dev_path);
        }

        let cwd = env::current_dir().map_err(|e| format!("current_dir failed: {e}"))?;
        let dev_path = cwd.join(&prompt_relative);
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir failed: {e}"))?;
    let bundled_candidates = vec![
        resource_dir.join(&prompt_relative),
        resource_dir.join("_up_").join(&prompt_relative),
        resource_dir
            .join("prompt_templates")
            .join("proofread")
            .join("general_system.txt"),
        resource_dir
            .join("_up_")
            .join("prompt_templates")
            .join("proofread")
            .join("general_system.txt"),
    ];

    for candidate in &bundled_candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "Default proofread prompt not found: {}",
        bundled_candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<String>>()
            .join(" / ")
    ))
}

fn resolve_overall_proofread_system_prompt_path(app: &AppHandle) -> Result<PathBuf, String> {
    let prompt_relative = PathBuf::from("python_sidecar")
        .join("prompt_templates")
        .join("proofread")
        .join("gemma4_overall.txt");

    if cfg!(debug_assertions) {
        let manifest_dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(&prompt_relative);
        if manifest_dev_path.exists() {
            return Ok(manifest_dev_path);
        }

        let cwd = env::current_dir().map_err(|e| format!("カレントディレクトリ解決に失敗: {e}"))?;
        let dev_path = cwd.join(&prompt_relative);
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir 解決に失敗: {e}"))?;
    let bundled_candidates = vec![
        resource_dir.join(&prompt_relative),
        resource_dir.join("_up_").join(&prompt_relative),
        resource_dir
            .join("prompt_templates")
            .join("proofread")
            .join("gemma4_overall.txt"),
        resource_dir
            .join("_up_")
            .join("prompt_templates")
            .join("proofread")
            .join("gemma4_overall.txt"),
    ];

    for candidate in &bundled_candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "全体校正プロンプトが見つかりません: {}",
        bundled_candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<String>>()
            .join(" / ")
    ))
}

fn resolve_default_overall_proofread_system_prompt_path(app: &AppHandle) -> Result<PathBuf, String> {
    let prompt_relative = PathBuf::from("python_sidecar")
        .join("prompt_templates")
        .join("proofread")
        .join("general_overall.txt");

    if cfg!(debug_assertions) {
        let manifest_dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(&prompt_relative);
        if manifest_dev_path.exists() {
            return Ok(manifest_dev_path);
        }

        let cwd = env::current_dir().map_err(|e| format!("カレントディレクトリ解決に失敗: {e}"))?;
        let dev_path = cwd.join(&prompt_relative);
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir 解決に失敗: {e}"))?;
    let bundled_candidates = vec![
        resource_dir.join(&prompt_relative),
        resource_dir.join("_up_").join(&prompt_relative),
        resource_dir
            .join("prompt_templates")
            .join("proofread")
            .join("general_overall.txt"),
        resource_dir
            .join("_up_")
            .join("prompt_templates")
            .join("proofread")
            .join("general_overall.txt"),
    ];

    for candidate in &bundled_candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "全体校正デフォルトプロンプトが見つかりません: {}",
        bundled_candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<String>>()
            .join(" / ")
    ))
}

fn resolve_bundled_sidecar_script_candidates(
    app: &AppHandle,
    script_name: &str,
) -> Result<Vec<PathBuf>, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir 解決に失敗: {e}"))?;
    Ok(vec![
        resource_dir.join("python_sidecar").join(script_name),
        resource_dir
            .join("_up_")
            .join("python_sidecar")
            .join(script_name),
    ])
}

fn resolve_default_diarization_model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        let manifest_base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("python_sidecar");
        let manifest_dev_path = resolve_default_diarization_model_dir_from_base(&manifest_base);
        if manifest_dev_path.exists() {
            return Ok(manifest_dev_path);
        }

        let cwd = env::current_dir().map_err(|e| format!("カレントディレクトリ解決に失敗: {e}"))?;
        let dev_base = cwd.join("python_sidecar");
        let dev_path = resolve_default_diarization_model_dir_from_base(&dev_base);
        return Ok(dev_path);
    }

    // リリース: アプリ固有データ領域へ集約する（NSIS の %LOCALAPPDATA%\{id} 一括削除で消える）。
    let root = release_models_root(app)
        .ok_or_else(|| "app_local_data_dir の解決に失敗しました".to_string())?;
    Ok(root.join("pyannote-speaker-diarization-community-1"))
}

fn resolve_default_diarization_model_dir_from_base(sidecar_base: &Path) -> PathBuf {
    let models_dir = sidecar_base.join("models");
    let community = models_dir.join("pyannote-speaker-diarization-community-1");
    if community.exists() {
        return community;
    }
    let legacy = models_dir.join("pyannote-speaker-diarization");
    if legacy.exists() {
        return legacy;
    }
    // Fallback path (may not exist yet): keep community-1 as default target.
    community
}

fn resolve_diarization_python_bin(app: &AppHandle, _fallback_python_bin: &str) -> String {
    // DIARIZATION_PYTHON_BIN で個別上書き可能（話者分離だけ別 venv を使いたい場合）
    if let Ok(value) = env::var("DIARIZATION_PYTHON_BIN") {
        let normalized = normalize_python_bin_candidate(&value);
        if is_usable_python_bin_candidate(&normalized) {
            return normalized;
        }
    }
    // それ以外は共通の Python 解決ロジックを使う
    get_python_bin(app)
}

pub fn run() {
    let audio_allowed_path: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let audio_stream_port = start_audio_stream_server(Arc::clone(&audio_allowed_path));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(LemonadeServer {
            child: Arc::new(Mutex::new(None)),
            port: Arc::new(AtomicU32::new(0)),
            mode: Arc::new(AtomicU8::new(0)),
            parallel: Arc::new(AtomicU8::new(1)),
        })
        .manage(DevWindowFocusState::default())
        .manage(AudioStreamServer { port: audio_stream_port, allowed_path: audio_allowed_path })
        .manage(OpenAiUnloadState::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if !schedule_dev_window_focus(app.handle(), &window) {
                    let _ = window.maximize();
                }
                let lemonade_child_arc = Arc::clone(&app.state::<LemonadeServer>().child);
                let lemonade_port_arc = Arc::clone(&app.state::<LemonadeServer>().port);
                let openai_unload_arc = Arc::clone(&app.state::<OpenAiUnloadState>().0);
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed = event {
                        if let Ok(mut guard) = lemonade_child_arc.lock() {
                            if let Some(mut child) = guard.take() {
                                let _ = kill_process_tree_by_pid(child.id());
                                let _ = child.kill();
                            }
                        }
                        let lemonade_port = lemonade_port_arc.load(Ordering::Relaxed) as u16;
                        // アプリ終了時: Lemonade モデルをアンロード（snap/bundled 共通）
                        try_unload_lemonade_cli(lemonade_port);
                        // アプリ終了時: ローカルOpenAI互換API経由でロードしたモデルをアンロード
                        if let Ok(mut guard) = openai_unload_arc.lock() {
                            if let Some(unload_info) = guard.take() {
                                try_unload_openai_model(&unload_info, lemonade_port);
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            run_transcription,
            run_diarization,
            proofread_transcription,
            proofread_transcription_llm,
            run_overall_proofread,
            preview_proofread_runtime_config,
            cancel_transcription,
            cancel_diarization,
            cancel_proofread,
            cancel_llm_proofread,
            list_llm_models,
            open_llm_models_folder,
            get_default_llm_model_path,
            get_proofread_model_tier,
            set_proofread_model_tier,
            check_gemma_12b_installed,
            download_gemma_12b,
            get_proofread_system_prompt,
            get_default_proofread_system_prompt,
            get_overall_proofread_system_prompt,
            get_default_overall_proofread_system_prompt,
            save_transcription_json,
            save_text_shift_jis,
            save_transcription_docx,
            save_transcription_xlsx,
            read_text_file,
            read_file_size,
            open_external_url,
            check_transcription_runtime_support,
            check_diarization_model_status,
            check_gpu_availability,
            detect_compute_env,
            get_dev_emulation_status,
            get_lemonade_status,
            get_lemonade_app_port,
            get_llm_attempted_parallel,
            get_lemonade_loaded_device,
            check_lemonade_gpu_backend_installed,
            list_local_openai_models,
            debounce_dev_window_focus,
            start_lemonade_server,
            stop_lemonade_server,
            install_lemonade,
            install_lemonade_backend,
            get_audio_stream_port,
            set_audio_allowed_path,
            get_dev_demo_data_dir,
            dev_delete_downloaded_models,
            download_whisper_model,
            check_all_setup_status,
            run_full_setup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
