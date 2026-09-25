use serde_json::{json, Map, Value};
use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
    net::TcpStream,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

const DEFAULT_SYSTEM_INSTRUCTION: &str =
    include_str!("../../python_sidecar/prompt_templates/proofread/gemma4_system.txt");
const ORIGINAL_TYPE_USER_SUFFIX: &str = concat!(
    "番号付きのすべてのテキストを校正し、以下のJSON配列形式のみで返答してください。",
    "説明・前置き・マークダウンは不要です。\n",
    r#"[{"id": <番号>, "result": "校正後テキスト", "changed": "変更内容（変更なしは空文字）"}]"#
);
const GRAMMAR_USER_SUFFIX: &str = concat!(
    "番号付きのすべてのテキストを校正し、句読点（、。！？）のみを追加・修正してください。",
    "語句は一切変更しないでください。以下のJSON配列形式のみで返答してください。",
    "説明・前置き・マークダウンは不要です。\n",
    r#"[{"id": <番号>, "result": "校正後テキスト"}]"#
);
const FLEX_PUNCTUATION: &str = "、。！？!?…・";
const TRAILING_PUNCTUATION: &str = "、。！？…・";
const TERMINAL_PUNCTUATION: &str = "。！？…!?";
const SKIP_ENDINGS: &str = "」』）】〉》]";
const MIN_BATCH_CHARS: usize = 60;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const SOCKET_POLL_INTERVAL: Duration = Duration::from_millis(200);

pub(crate) type CancelCheck = Arc<dyn Fn() -> bool + Send + Sync>;

#[derive(Clone)]
pub(super) struct Emitter {
    sink: Arc<dyn Fn(Value) + Send + Sync>,
    lock: Arc<Mutex<()>>,
}

impl Emitter {
    pub(super) fn new<F>(sink: F) -> Self
    where
        F: Fn(Value) + Send + Sync + 'static,
    {
        Self {
            sink: Arc::new(sink),
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub(crate) fn emit(&self, payload: Value) {
        let _guard = self.lock.lock().unwrap_or_else(|poison| poison.into_inner());
        (self.sink)(payload);
    }

    pub(crate) fn progress(
        &self,
        message: impl Into<String>,
        current: Option<usize>,
        total: Option<usize>,
    ) {
        let mut payload = Map::new();
        payload.insert("stage".to_string(), Value::String("llm_loading".to_string()));
        payload.insert("message".to_string(), Value::String(message.into()));
        if let Some(current) = current {
            payload.insert("current".to_string(), json!(current));
        }
        if let Some(total) = total {
            payload.insert("total".to_string(), json!(total));
        }
        self.emit(Value::Object(payload));
    }

    pub(crate) fn event(
        &self,
        stage: &str,
        fields: impl IntoIterator<Item = (String, Value)>,
    ) {
        let mut payload = Map::new();
        payload.insert("stage".to_string(), Value::String(stage.to_string()));
        payload.extend(fields);
        self.emit(Value::Object(payload));
    }
}

pub(super) struct Options {
    pub(super) base_url: String,
    pub(super) model: String,
    pub(super) provider_label: String,
    pub(super) backend_name: String,
    pub(super) system_prompt: Option<String>,
    pub(super) prompt_type: String,
    pub(super) max_batch_segments: usize,
    pub(super) parallel: usize,
    pub(super) require_model_list: bool,
    pub(super) fallback_to_first_model: bool,
    pub(super) extra_payload: Option<Value>,
    pub(super) allow_grammar: bool,
}

#[derive(Debug)]
pub(crate) enum Failure {
    Cancelled,
    Connection(String),
    HttpStatus {
        status: u16,
        reason: String,
        url: String,
    },
    Other(String),
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cancelled => write!(f, "LLM校正が中止されました。"),
            Self::Connection(message) | Self::Other(message) => write!(f, "{message}"),
            Self::HttpStatus {
                status,
                reason,
                url,
            } => {
                let kind = if *status >= 500 { "Server" } else { "Client" };
                write!(f, "{status} {kind} Error: {reason} for url: {url}")
            }
        }
    }
}

#[derive(Clone)]
pub(crate) struct Segment {
    pub(crate) id: i64,
    pub(crate) text: String,
    pub(crate) speaker: Value,
    pub(crate) speaker_label: Option<String>,
}

#[derive(Clone)]
pub(crate) struct HttpTarget {
    host: String,
    authority: String,
    port: u16,
    path_prefix: String,
}

impl HttpTarget {
    pub(crate) fn from_base_url(base_url: &str) -> Result<(Self, String), String> {
        let normalized = super::validate_local_openai_base_url(base_url)?;
        let parsed = super::parse_local_openai_http_target(&normalized)?;
        Ok((
            Self {
                host: parsed.host,
                authority: parsed.authority,
                port: parsed.port,
                path_prefix: parsed.path_prefix,
            },
            normalized,
        ))
    }

    fn resolve(&self) -> Result<std::net::SocketAddr, Failure> {
        let target = super::LocalOpenAiHttpTarget {
            host: self.host.clone(),
            authority: self.authority.clone(),
            port: self.port,
            path_prefix: self.path_prefix.clone(),
        };
        super::resolve_loopback_socket_addr(&target).map_err(Failure::Connection)
    }

    pub(crate) fn endpoint(&self, suffix: &str) -> String {
        super::local_openai_endpoint_path(&self.path_prefix, suffix)
    }

    pub(crate) fn authority(&self) -> &str {
        &self.authority
    }
}

#[derive(Clone)]
struct ResultItem {
    id: i64,
    original_text: String,
    revised_text: String,
    confidence: f64,
    reason: String,
}

impl ResultItem {
    fn to_value(&self) -> Value {
        json!({
            "id": self.id,
            "originalText": self.original_text,
            "revisedText": self.revised_text,
            "confidence": self.confidence,
            "reason": self.reason,
        })
    }
}

struct BatchContext<'a> {
    target: &'a HttpTarget,
    chat_url: &'a str,
    chat_path: &'a str,
    model: &'a str,
    system_instruction: &'a str,
    prompt_type: &'a str,
    allow_grammar: bool,
    extra_payload: Option<&'a Value>,
    backend_name: &'a str,
    total_segments: usize,
    total_batches: usize,
    workers: usize,
    emitter: &'a Emitter,
    cancelled: &'a CancelCheck,
}

pub(super) fn proofread(
    input_segments: &[Value],
    options: Options,
    emitter: &Emitter,
    cancelled: CancelCheck,
) -> Result<Vec<Value>, String> {
    proofread_inner(input_segments, options, emitter, &cancelled).map_err(|failure| failure.to_string())
}

fn proofread_inner(
    input_segments: &[Value],
    options: Options,
    emitter: &Emitter,
    cancelled: &CancelCheck,
) -> Result<Vec<Value>, Failure> {
    check_cancelled(cancelled)?;
    let base_url = options.base_url.trim().trim_end_matches('/').to_string();
    if base_url.is_empty() {
        return Err(Failure::Other(
            "ローカルOpenAI互換APIの Base URL が未指定です。".to_string(),
        ));
    }
    let model = options.model.trim().to_string();
    if model.is_empty() {
        return Err(Failure::Other(format!(
            "{} のモデル名が未指定です。",
            options.provider_label
        )));
    }
    let (target, normalized_base_url) =
        HttpTarget::from_base_url(&base_url).map_err(Failure::Other)?;
    let models_path = target.endpoint("models");
    let chat_path = target.endpoint("chat/completions");
    let origin = format!("http://{}", target.authority);
    let models_url = format!("{origin}{models_path}");
    let chat_url = format!("{origin}{chat_path}");

    emitter.progress(
        format!("{} に接続中... ({normalized_base_url})", options.provider_label),
        None,
        None,
    );

    let models_data = match fetch_models(
        &target,
        &models_url,
        &models_path,
        options.require_model_list,
        &options.provider_label,
        cancelled,
        emitter,
    ) {
        Ok(data) => data,
        Err(Failure::Cancelled) => return Err(Failure::Cancelled),
        Err(error) if options.require_model_list => {
            return Err(Failure::Other(format!(
                "{} に接続できませんでした: {error}",
                options.provider_label
            )))
        }
        Err(Failure::Connection(_)) => {
            return Err(Failure::Other(format!(
                "サーバーに接続できません（{normalized_base_url}）。LM Studio / Ollama などを起動してから再試行してください。"
            )))
        }
        Err(error) => {
            emitter.progress(
                format!(
                    "{} のモデル一覧を取得できませんでした。指定モデルで続行します: {error}",
                    options.provider_label
                ),
                None,
                None,
            );
            Value::Object(Map::new())
        }
    };

    let available_ids = collect_model_ids(&models_data);
    let available_label = if available_ids.is_empty() {
        "(なし)".to_string()
    } else {
        format!(
            "[{}]",
            available_ids
                .iter()
                .map(|id| format!("'{}'", id.replace('\'', "\\'")))
                .collect::<Vec<_>>()
                .join(", ")
        )
    };
    emitter.progress(
        format!("利用可能なモデル: {available_label}"),
        None,
        None,
    );

    let mut model = model;
    if !available_ids.is_empty() && !available_ids.iter().any(|id| id == &model) {
        if options.fallback_to_first_model {
            let fallback = available_ids[0].clone();
            emitter.progress(
                format!("モデル '{model}' が見つかりません。'{fallback}' を使用します。"),
                None,
                None,
            );
            model = fallback;
        } else {
            return Err(Failure::Other(format!(
                "{} にモデル '{model}' が見つかりません。",
                options.provider_label
            )));
        }
    } else if available_ids.is_empty() {
        emitter.progress(
            format!("モデル一覧が空です。'{model}' で試みます。"),
            None,
            None,
        );
    }

    let model_path_label = model.replace('\\', "/");
    let model_label = model_path_label
        .rsplit('/')
        .next()
        .filter(|part| !part.is_empty())
        .unwrap_or(&model_path_label);
    emitter.progress(
        format!("{} 接続成功: {model_label}", options.provider_label),
        None,
        None,
    );

    let segments = parse_segments(input_segments)?;
    let (to_process, short_results) = prepare_short_segment_results(&segments);
    let batches = group_segments_by_speaker(
        &to_process,
        MIN_BATCH_CHARS,
        options.max_batch_segments.max(1),
    );
    let total_batches = batches.len();
    let total_segments = segments.len();
    let initial_count = total_segments.saturating_sub(to_process.len());
    let workers = if total_batches == 0 {
        1
    } else {
        options.parallel.max(1).min(total_batches)
    };
    let system_instruction = options
        .system_prompt
        .as_deref()
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
        .unwrap_or_else(|| DEFAULT_SYSTEM_INSTRUCTION.trim())
        .to_string();

    if total_batches == 0 {
        return Ok(segments
            .iter()
            .filter_map(|segment| short_results.get(&segment.id).map(ResultItem::to_value))
            .collect());
    }

    emitter.progress("準備中...", None, Some(total_segments));
    let shared_results = Arc::new(Mutex::new(short_results));
    let progress_count = Arc::new(AtomicUsize::new(initial_count));
    let next_batch = AtomicUsize::new(0);
    let first_error = Mutex::new(None::<Failure>);
    let context = BatchContext {
        target: &target,
        chat_url: &chat_url,
        chat_path: &chat_path,
        model: &model,
        system_instruction: &system_instruction,
        prompt_type: &options.prompt_type,
        allow_grammar: options.allow_grammar,
        extra_payload: options.extra_payload.as_ref(),
        backend_name: &options.backend_name,
        total_segments,
        total_batches,
        workers,
        emitter,
        cancelled,
    };

    if workers <= 1 {
        for batch_idx in 0..total_batches {
            check_cancelled(cancelled)?;
            match process_batch(batch_idx, &batches, &context) {
                Ok(batch_items) => {
                    store_batch_result(
                        &batch_items,
                        batches[batch_idx].len(),
                        &shared_results,
                        &progress_count,
                        total_segments,
                        emitter,
                    );
                }
                Err(error) => return Err(error),
            }
        }
    } else {
        emitter.progress(
            format!("並列処理中（同時 {workers} バッチ）..."),
            Some(initial_count),
            Some(total_segments),
        );
        thread::scope(|scope| {
            for _ in 0..workers {
                let next_batch = &next_batch;
                let shared_results = Arc::clone(&shared_results);
                let progress_count = Arc::clone(&progress_count);
                let first_error = &first_error;
                let context = &context;
                let batches = &batches;
                scope.spawn(move || loop {
                    let batch_idx = next_batch.fetch_add(1, Ordering::Relaxed);
                    if batch_idx >= batches.len() {
                        break;
                    }
                    let result = process_batch(batch_idx, batches, context);
                    match result {
                        Ok(batch_items) => store_batch_result(
                            &batch_items,
                            batches[batch_idx].len(),
                            &shared_results,
                            &progress_count,
                            total_segments,
                            emitter,
                        ),
                        Err(error) => {
                            let mut stored = first_error
                                .lock()
                                .unwrap_or_else(|poison| poison.into_inner());
                            if stored.is_none() {
                                *stored = Some(error);
                            }
                        }
                    }
                });
            }
        });
        if let Some(error) = first_error
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .take()
        {
            return Err(error);
        }
    }

    check_cancelled(cancelled)?;
    let results = shared_results
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    Ok(segments
        .iter()
        .filter_map(|segment| results.get(&segment.id).map(ResultItem::to_value))
        .collect())
}

pub(crate) fn parse_segments(values: &[Value]) -> Result<Vec<Segment>, Failure> {
    values
        .iter()
        .map(|value| {
            let id = value
                .get("id")
                .and_then(Value::as_i64)
                .ok_or_else(|| Failure::Other("セグメント id が不正です。".to_string()))?;
            let text = value
                .get("text")
                .and_then(Value::as_str)
                .ok_or_else(|| Failure::Other("セグメント text が不正です。".to_string()))?
                .to_string();
            let speaker = value.get("speaker").cloned().unwrap_or(Value::Null);
            let speaker_label = value
                .get("speakerLabel")
                .and_then(Value::as_str)
                .map(str::to_string);
            Ok(Segment {
                id,
                text,
                speaker,
                speaker_label,
            })
        })
        .collect()
}

pub(crate) fn fetch_models(
    target: &HttpTarget,
    url: &str,
    path: &str,
    require_model_list: bool,
    provider_label: &str,
    cancelled: &CancelCheck,
    emitter: &Emitter,
) -> Result<Value, Failure> {
    let deadline = Instant::now() + if require_model_list {
        Duration::from_secs(180)
    } else {
        Duration::ZERO
    };
    let timeout = if require_model_list {
        Duration::from_secs(60)
    } else {
        CONNECT_TIMEOUT
    };
    let mut attempt = 0usize;
    loop {
        check_cancelled(cancelled)?;
        attempt += 1;
        let response = send_request(
            target,
            "GET",
            path,
            None,
            timeout,
            timeout,
            cancelled.clone(),
        );
        match response {
            Err(Failure::Connection(error)) if require_model_list && Instant::now() < deadline => {
                let _ = error;
                emitter.progress(
                    format!("{provider_label} の起動を待っています... (接続再試行 {attempt})"),
                    None,
                    None,
                );
                sleep_retry(attempt, cancelled)?;
            }
            Err(error) => return Err(error),
            Ok(mut response)
                if matches!(response.status, 502 | 503 | 504)
                    && require_model_list
                    && Instant::now() < deadline =>
            {
                emitter.progress(
                    format!("{provider_label} がモデルをロード中です... (再試行 {attempt})"),
                    None,
                    None,
                );
                sleep_retry(attempt, cancelled)?;
                let _ = response.read_all();
            }
            Ok(mut response) => {
                raise_for_status(&response, url)?;
                let body = response.read_all()?;
                return serde_json::from_slice(&body)
                    .map_err(|error| Failure::Other(format!("JSON 解析に失敗しました: {error}")));
            }
        }
    }
}

fn sleep_retry(_attempt: usize, cancelled: &CancelCheck) -> Result<(), Failure> {
    #[cfg(target_os = "windows")]
    let delay_seconds = 2;
    #[cfg(not(target_os = "windows"))]
    let delay_seconds = 2u64 << _attempt.saturating_sub(1).min(2);
    let deadline = Instant::now() + Duration::from_secs(delay_seconds);
    while Instant::now() < deadline {
        check_cancelled(cancelled)?;
        thread::sleep(Duration::from_millis(100).min(deadline.saturating_duration_since(Instant::now())));
    }
    Ok(())
}

pub(crate) fn collect_model_ids(models_data: &Value) -> Vec<String> {
    models_data
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            model
                .get("id")
                .and_then(value_as_python_string)
                .filter(|id| !id.is_empty())
                .or_else(|| {
                    model
                        .get("name")
                        .and_then(value_as_python_string)
                        .filter(|name| !name.is_empty())
                })
        })
        .collect()
}

fn prepare_short_segment_results(segments: &[Segment]) -> (Vec<Segment>, HashMap<i64, ResultItem>) {
    let mut to_process = Vec::new();
    let mut results = HashMap::new();
    for segment in segments {
        if segment.text.chars().count() > 1 {
            to_process.push(segment.clone());
        } else if segment.text.chars().count() == 1
            && !TRAILING_PUNCTUATION.contains(segment.text.chars().next().unwrap_or(' '))
        {
            results.insert(
                segment.id,
                ResultItem {
                    id: segment.id,
                    original_text: segment.text.clone(),
                    revised_text: format!("{}、", segment.text),
                    confidence: 0.5,
                    reason: "「、」を追加".to_string(),
                },
            );
        } else {
            results.insert(
                segment.id,
                ResultItem {
                    id: segment.id,
                    original_text: segment.text.clone(),
                    revised_text: segment.text.clone(),
                    confidence: 0.0,
                    reason: "too_short".to_string(),
                },
            );
        }
    }
    (to_process, results)
}

fn group_segments_by_speaker(
    segments: &[Segment],
    min_batch_chars: usize,
    max_batch_segments: usize,
) -> Vec<Vec<Segment>> {
    if segments.is_empty() {
        return Vec::new();
    }
    let mut groups: Vec<Vec<Segment>> = Vec::new();
    let mut current_group = vec![segments[0].clone()];
    let mut current_speaker = segments[0].speaker.clone();
    for segment in &segments[1..] {
        if segment.speaker == current_speaker {
            current_group.push(segment.clone());
        } else {
            groups.push(current_group);
            current_group = vec![segment.clone()];
            current_speaker = segment.speaker.clone();
        }
    }
    groups.push(current_group);

    let mut split_groups = Vec::new();
    for mut group in groups {
        while group.len() > max_batch_segments {
            let tail = group.split_off(max_batch_segments);
            split_groups.push(group);
            group = tail;
        }
        if !group.is_empty() {
            split_groups.push(group);
        }
    }

    let mut merged = Vec::<Vec<Segment>>::new();
    let mut buffer = Vec::<Segment>::new();
    for group in split_groups {
        buffer.extend(group);
        let chars = buffer.iter().map(|segment| segment.text.chars().count()).sum::<usize>();
        if chars >= min_batch_chars || buffer.len() >= max_batch_segments {
            merged.push(std::mem::take(&mut buffer));
        }
    }
    if !buffer.is_empty() {
        if let Some(last) = merged.last_mut() {
            last.extend(buffer);
        } else {
            merged.push(buffer);
        }
    }

    let mut strict = Vec::new();
    for batch in merged {
        if batch.len() <= max_batch_segments {
            strict.push(batch);
        } else {
            strict.extend(batch.chunks(max_batch_segments).map(<[Segment]>::to_vec));
        }
    }
    strict
}

fn format_speaker(segment: &Segment) -> String {
    segment
        .speaker_label
        .as_deref()
        .map(str::trim)
        .filter(|label| !label.is_empty() && *label != "-")
        .map(|label| format!("{label}: "))
        .unwrap_or_default()
}

fn build_chat_messages(
    batch: &[Segment],
    previous: Option<&Segment>,
    next: Option<&Segment>,
    system_instruction: &str,
    grammar: bool,
) -> Value {
    let mut context_lines = Vec::new();
    if let Some(previous) = previous {
        context_lines.push(format!(
            "前の文（参考）：{}{}",
            format_speaker(previous),
            previous.text
        ));
    }
    if let Some(next) = next {
        context_lines.push(format!(
            "次の文（参考）：{}{}",
            format_speaker(next),
            next.text
        ));
    }
    let context_section = if context_lines.is_empty() {
        String::new()
    } else {
        format!("{}\n\n", context_lines.join("\n"))
    };
    let numbered = batch
        .iter()
        .map(|segment| format!("[{}] {}{}", segment.id, format_speaker(segment), segment.text))
        .collect::<Vec<_>>()
        .join("\n");
    let suffix = if grammar {
        GRAMMAR_USER_SUFFIX
    } else {
        ORIGINAL_TYPE_USER_SUFFIX
    };
    let user_content = format!("{context_section}{numbered}\n\n{suffix}");
    json!([
        {"role": "system", "content": system_instruction},
        {"role": "user", "content": user_content}
    ])
}

fn process_batch(
    batch_idx: usize,
    batches: &[Vec<Segment>],
    context: &BatchContext<'_>,
) -> Result<Vec<ResultItem>, Failure> {
    check_cancelled(context.cancelled)?;
    let batch = &batches[batch_idx];
    let previous = batch_idx.checked_sub(1).and_then(|idx| batches[idx].last());
    let next = batches.get(batch_idx + 1).and_then(|batch| batch.first());
    context.emitter.event(
        "batch_start",
        [("segmentIds".to_string(), json!(batch.iter().map(|segment| segment.id).collect::<Vec<_>>()))],
    );
    context.emitter.progress("準備中...", None, Some(context.total_segments));

    let grammar_active = context.allow_grammar && context.prompt_type == "gemma4";
    let messages = build_chat_messages(
        batch,
        previous,
        next,
        context.system_instruction,
        grammar_active,
    );
    let max_tokens = 4096usize.min(512usize.max(batch.len() * 200));
    let idle_timeout = if batch_idx < context.workers {
        Duration::from_secs(60)
    } else {
        Duration::from_secs(30)
    };
    let mut payload = json!({
        "model": context.model,
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": max_tokens,
    });
    if let (Some(extra), Some(payload_obj)) = (
        context.extra_payload,
        payload.as_object_mut(),
    ) {
        if let Some(extra_obj) = extra.as_object() {
            for (key, value) in extra_obj {
                payload_obj.insert(key.clone(), value.clone());
            }
        }
    }
    if grammar_active {
        match build_batch_grammar(batch) {
            Ok(grammar) => {
                payload["grammar"] = Value::String(grammar);
            }
            Err(error) => context.emitter.progress(
                format!("GBNF文法の生成に失敗（制約なしで継続）: {error}"),
                None,
                None,
            ),
        }
    }

    let raw_text = match stream_llm_chat(
        context.target,
        context.chat_url,
        context.chat_path,
        &payload,
        idle_timeout,
        context.cancelled.clone(),
    ) {
        Ok(text) => text,
        Err(error) if payload.get("grammar").is_some() && matches!(&error, Failure::HttpStatus { .. }) => {
            context.emitter.progress(
                format!("grammar 非対応のため制約なしで再試行します: {error}"),
                None,
                None,
            );
            if let Some(payload_obj) = payload.as_object_mut() {
                payload_obj.remove("grammar");
            }
            stream_llm_chat(
                context.target,
                context.chat_url,
                context.chat_path,
                &payload,
                idle_timeout,
                context.cancelled.clone(),
            )?
        }
        Err(error) => return Err(error),
    };

    let mut batch_results = extract_batch_json_result(&raw_text, batch);
    apply_speaker_change_periods(batch, &mut batch_results, next);
    let batch_items = batch_results.iter().map(ResultItem::to_value).collect::<Vec<_>>();
    let (fallback_count, changed_count) = count_fallback_and_changed(&batch_results);
    let json_detected = has_valid_result_json(&raw_text);
    let all_no_change = !batch_items.is_empty() && fallback_count == batch_items.len();
    let all_fallback = all_no_change && !json_detected;
    let segment_ids = json!(batch.iter().map(|segment| segment.id).collect::<Vec<_>>());
    let debug_fields = || {
        vec![
            ("backend".to_string(), json!(context.backend_name)),
            ("batchIndex".to_string(), json!(batch_idx + 1)),
            ("totalBatches".to_string(), json!(context.total_batches)),
            ("batchSize".to_string(), json!(batch.len())),
            ("segmentIds".to_string(), segment_ids.clone()),
            ("maxTokens".to_string(), json!(max_tokens)),
            ("rawTextChars".to_string(), json!(raw_text.chars().count())),
            ("itemCount".to_string(), json!(batch_items.len())),
            ("changedCount".to_string(), json!(changed_count)),
            ("fallbackCount".to_string(), json!(fallback_count)),
            ("allNoChange".to_string(), json!(all_no_change)),
            ("jsonDetected".to_string(), json!(json_detected)),
            ("allFallback".to_string(), json!(all_fallback)),
        ]
    };
    context.emitter.event("llm_batch_debug", debug_fields());
    if context.backend_name == "llama_server" {
        let mut fields = debug_fields();
        fields.retain(|(key, _)| key != "backend");
        fields.insert(0, ("backend".to_string(), json!("llama_server")));
        context.emitter.event("llm_batch_debug", fields);
    }
    if all_no_change {
        let preview = truncate_chars(&raw_text.replace('\n', "\\n"), 320);
        let mut fields = vec![
            ("backend".to_string(), json!(context.backend_name)),
            ("batchIndex".to_string(), json!(batch_idx + 1)),
            ("totalBatches".to_string(), json!(context.total_batches)),
            ("allFallback".to_string(), json!(all_fallback)),
            ("jsonDetected".to_string(), json!(json_detected)),
            ("preview".to_string(), json!(preview)),
        ];
        context.emitter.event("llm_batch_raw_preview", fields.clone());
        if context.backend_name == "llama_server" {
            fields.retain(|(key, _)| key != "backend");
            context.emitter.event("llm_batch_raw_preview", fields);
        }
    }
    Ok(batch_results)
}

fn store_batch_result(
    batch_items: &[ResultItem],
    batch_size: usize,
    results: &Arc<Mutex<HashMap<i64, ResultItem>>>,
    progress_count: &Arc<AtomicUsize>,
    total_segments: usize,
    emitter: &Emitter,
) {
    let mut map = results.lock().unwrap_or_else(|poison| poison.into_inner());
    for item in batch_items {
        map.insert(item.id, item.clone());
    }
    drop(map);
    let current = progress_count.fetch_add(batch_size, Ordering::Relaxed) + batch_size;
    emitter.event(
        "batch_result",
        [
            ("items".to_string(), Value::Array(batch_items.iter().map(ResultItem::to_value).collect())),
            ("current".to_string(), json!(current)),
            ("total".to_string(), json!(total_segments)),
        ],
    );
}

fn apply_speaker_change_periods(
    batch: &[Segment],
    results: &mut [ResultItem],
    next_batch_first: Option<&Segment>,
) {
    let result_indices = results
        .iter()
        .enumerate()
        .map(|(index, item)| (item.id, index))
        .collect::<HashMap<_, _>>();
    for (index, segment) in batch.iter().enumerate() {
        let next = batch.get(index + 1).or(next_batch_first);
        let Some(next) = next else { continue };
        if segment.speaker == next.speaker {
            continue;
        }
        let Some(result_index) = result_indices.get(&segment.id).copied() else {
            continue;
        };
        let result = &mut results[result_index];
        let Some(last) = result.revised_text.chars().last() else {
            continue;
        };
        if TERMINAL_PUNCTUATION.contains(last) || SKIP_ENDINGS.contains(last) {
            continue;
        }
        if last == '、' {
            result.revised_text.pop();
            result.revised_text.push('。');
        } else {
            result.revised_text.push('。');
        }
        result.reason = if result.reason.is_empty() {
            "話者交代前に句点".to_string()
        } else {
            format!("{}、話者交代前に句点", result.reason)
        };
        result.confidence = result.confidence.max(0.75);
    }
}

fn count_fallback_and_changed(items: &[ResultItem]) -> (usize, usize) {
    let mut fallback_count = 0;
    let mut changed_count = 0;
    for item in items {
        if item.revised_text != item.original_text {
            changed_count += 1;
        }
        if item.revised_text == item.original_text && item.reason.is_empty() && item.confidence <= 0.0 {
            fallback_count += 1;
        }
    }
    (fallback_count, changed_count)
}

fn extract_batch_json_result(raw_text: &str, batch: &[Segment]) -> Vec<ResultItem> {
    let normalized = normalize_completion_text(raw_text);
    let segment_index = batch
        .iter()
        .map(|segment| (segment.id, segment))
        .collect::<HashMap<_, _>>();
    let expected_ids = segment_index.keys().copied().collect::<HashSet<_>>();
    let candidates = pick_best_json_items(&normalized, Some(&expected_ids));
    let mut results = Vec::new();
    let mut result_ids = HashSet::new();
    for item in candidates {
        let Some(id) = item.get("id").and_then(value_as_i64) else { continue };
        let Some(original) = segment_index.get(&id) else { continue };
        let revised_value = item.get("result").or_else(|| item.get("revisedText"));
        let Some(revised_value) = revised_value else { continue };
        let revised = value_as_python_string(revised_value).unwrap_or_default().trim().to_string();
        let change_value = item.get("changed").or_else(|| item.get("reason"));
        let mut reason = change_value
            .and_then(value_as_python_string)
            .unwrap_or_default()
            .trim()
            .to_string();
        if !reason.is_empty() && reason.chars().all(|ch| "{}[]|\\,; \t\r\n".contains(ch)) {
            reason.clear();
        }
        if revised.is_empty()
            || (revised.starts_with('（') && revised.ends_with('）') && revised.chars().count() <= 20)
        {
            continue;
        }
        let confidence = if !reason.is_empty() || revised != original.text {
            0.85
        } else {
            0.0
        };
        if result_ids.insert(id) {
            results.push(ResultItem {
                id,
                original_text: original.text.clone(),
                revised_text: revised,
                confidence,
                reason,
            });
        }
    }
    for segment in batch {
        if result_ids.insert(segment.id) {
            results.push(ResultItem {
                id: segment.id,
                original_text: segment.text.clone(),
                revised_text: segment.text.clone(),
                confidence: 0.0,
                reason: String::new(),
            });
        }
    }
    results
}

pub(crate) fn normalize_completion_text(raw_text: &str) -> String {
    static THINKING: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static START_THINKING: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let mut text = raw_text.trim().to_string();
    text = THINKING
        .get_or_init(|| regex::Regex::new(r"(?is)<thinking>[\s\S]*?</thinking>").unwrap())
        .replace_all(&text, "")
        .trim()
        .to_string();
    text = START_THINKING
        .get_or_init(|| {
            regex::Regex::new(r"(?is)<start_of_thinking>[\s\S]*?<end_of_thinking>").unwrap()
        })
        .replace_all(&text, "")
        .trim()
        .to_string();
    for marker in ["<turn|>", "<|turn>", "<end_of_turn>", "<start_of_turn>", "<bos>", "<eos>"] {
        text = text.replace(marker, "").trim().to_string();
    }
    text
}

fn pick_best_json_items(text: &str, expected_ids: Option<&HashSet<i64>>) -> Vec<Value> {
    let mut merged = Vec::new();
    let mut seen = HashSet::new();
    for candidate in iter_json_array_candidates(text) {
        let Ok(parsed) = serde_json::from_str::<Value>(&candidate) else { continue };
        let Some(items) = parsed.as_array() else { continue };
        for item in items {
            if !item.is_object() || item.get("id").is_none() {
                continue;
            }
            if item.get("result").is_none() && item.get("revisedText").is_none() {
                continue;
            }
            let Some(id) = item.get("id").and_then(value_as_i64) else { continue };
            if expected_ids.is_some_and(|expected| !expected.contains(&id)) || !seen.insert(id) {
                continue;
            }
            merged.push(item.clone());
        }
    }
    merged
}

fn has_valid_result_json(text: &str) -> bool {
    !pick_best_json_items(&normalize_completion_text(text), None).is_empty()
}

pub(crate) fn iter_json_array_candidates(text: &str) -> Vec<String> {
    static FENCED: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let mut candidates = Vec::new();
    for captures in FENCED
        .get_or_init(|| regex::Regex::new(r"(?is)```(?:json)?\s*([\s\S]*?)```").unwrap())
        .captures_iter(text)
    {
        if let Some(block) = captures.get(1).map(|match_| match_.as_str().trim()) {
            if !block.is_empty() {
                candidates.push(block.to_string());
            }
        }
    }
    let chars = text.char_indices().collect::<Vec<_>>();
    let mut in_string = false;
    let mut escaped = false;
    let mut depth = 0usize;
    let mut start = None;
    for (char_index, (byte_index, ch)) in chars.iter().enumerate() {
        if escaped {
            escaped = false;
            continue;
        }
        if *ch == '\\' {
            escaped = true;
            continue;
        }
        if *ch == '"' {
            in_string = !in_string;
            continue;
        }
        if in_string {
            continue;
        }
        if *ch == '[' {
            if depth == 0 {
                start = Some(*byte_index);
            }
            depth += 1;
        } else if *ch == ']' && depth > 0 {
            depth -= 1;
            if depth == 0 {
                if let Some(start) = start.take() {
                    let end = chars
                        .get(char_index + 1)
                        .map(|(byte_index, _)| *byte_index)
                        .unwrap_or(text.len());
                    let candidate = text[start..end].trim();
                    if !candidate.is_empty() {
                        candidates.push(candidate.to_string());
                    }
                }
            }
        }
    }
    let mut seen = HashSet::new();
    candidates.retain(|candidate| seen.insert(candidate.clone()));
    candidates
}

pub(crate) fn stream_llm_chat(
    target: &HttpTarget,
    url: &str,
    path: &str,
    payload: &Value,
    idle_timeout: Duration,
    cancelled: CancelCheck,
) -> Result<String, Failure> {
    stream_llm_chat_inner(target, url, path, payload, idle_timeout, cancelled, false)
}

pub(crate) fn stream_llm_chat_overall(
    target: &HttpTarget,
    url: &str,
    path: &str,
    payload: &Value,
    idle_timeout: Duration,
    cancelled: CancelCheck,
) -> Result<String, Failure> {
    stream_llm_chat_inner(target, url, path, payload, idle_timeout, cancelled, true)
}

fn stream_llm_chat_inner(
    target: &HttpTarget,
    url: &str,
    path: &str,
    payload: &Value,
    idle_timeout: Duration,
    cancelled: CancelCheck,
    accept_overall_result_keys: bool,
) -> Result<String, Failure> {
    let mut payload = payload.clone();
    payload["stream"] = Value::Bool(true);
    let body = serde_json::to_vec(&payload)
        .map_err(|error| Failure::Other(format!("リクエストJSONの生成に失敗しました: {error}")))?;
    let mut response = send_request(
        target,
        "POST",
        path,
        Some(&body),
        CONNECT_TIMEOUT,
        idle_timeout,
        cancelled.clone(),
    )?;
    raise_for_status(&response, url)?;
    if response.content_type.to_ascii_lowercase().contains("text/event-stream") {
        read_sse_response(&mut response, accept_overall_result_keys)
    } else {
        let bytes = response.read_all()?;
        let data: Value = serde_json::from_slice(&bytes)
            .map_err(|error| Failure::Other(format!("JSON 解析に失敗しました: {error}")))?;
        Ok(data
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string())
    }
}

fn read_sse_response(
    response: &mut HttpResponse,
    accept_overall_result_keys: bool,
) -> Result<String, Failure> {
    let mut full_text = String::new();
    let mut reasoning_text = String::new();
    let mut line_buffer = Vec::<u8>::new();
    let mut bracket_depth = 0i32;
    let mut json_started = false;
    let mut complete = false;
    loop {
        let chunk = response.read_body_chunk(4096)?;
        if chunk.is_empty() {
            break;
        }
        line_buffer.extend_from_slice(&chunk);
        while let Some(newline) = line_buffer.iter().position(|byte| *byte == b'\n') {
            let mut line = line_buffer.drain(..=newline).collect::<Vec<_>>();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if process_sse_line(
                &line,
                &mut full_text,
                &mut reasoning_text,
                &mut bracket_depth,
                &mut json_started,
                accept_overall_result_keys,
            ) {
                complete = true;
                break;
            }
        }
        if complete {
            break;
        }
    }
    if !complete && !line_buffer.is_empty() {
        process_sse_line(
            &line_buffer,
            &mut full_text,
            &mut reasoning_text,
            &mut bracket_depth,
            &mut json_started,
            accept_overall_result_keys,
        );
    }
    if full_text.is_empty() && !reasoning_text.is_empty() {
        full_text = reasoning_text;
    }
    Ok(full_text)
}

fn process_sse_line(
    line: &[u8],
    full_text: &mut String,
    reasoning_text: &mut String,
    bracket_depth: &mut i32,
    json_started: &mut bool,
    accept_overall_result_keys: bool,
) -> bool {
    let line = String::from_utf8_lossy(line);
    if !line.starts_with("data: ") {
        return false;
    }
    let data = line[6..].trim();
    if data == "[DONE]" {
        return false;
    }
    let Ok(chunk) = serde_json::from_str::<Value>(data) else {
        return false;
    };
    let Some(delta_obj) = chunk
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("delta"))
    else {
        return false;
    };
    if let Some(reasoning) = delta_obj.get("reasoning_content").and_then(Value::as_str) {
        reasoning_text.push_str(reasoning);
    }
    let Some(delta) = delta_obj.get("content").and_then(Value::as_str) else {
        return false;
    };
    if delta.is_empty() {
        return false;
    }
    full_text.push_str(delta);
    for ch in delta.chars() {
        if ch == '[' {
            *bracket_depth += 1;
            *json_started = true;
        } else if ch == ']' && *json_started {
            *bracket_depth -= 1;
            if *bracket_depth <= 0 {
                if has_valid_result_json_for_sse(full_text, accept_overall_result_keys) {
                    *bracket_depth = 0;
                    return true;
                }
                *bracket_depth = 0;
                *json_started = false;
            }
        }
    }
    *json_started
        && *bracket_depth <= 0
        && has_valid_result_json_for_sse(full_text, accept_overall_result_keys)
}

fn has_valid_result_json_for_sse(text: &str, accept_overall_result_keys: bool) -> bool {
    if !accept_overall_result_keys {
        return has_valid_result_json(text);
    }
    let normalized = normalize_completion_text(text);
    iter_json_array_candidates(&normalized).into_iter().any(|candidate| {
        let Ok(parsed) = serde_json::from_str::<Value>(&candidate) else {
            return false;
        };
        let Some(items) = parsed.as_array() else {
            return false;
        };
        items.iter().any(|item| {
            item.is_object()
                && item.get("id").and_then(value_as_i64).is_some()
                && (item.get("revised").is_some()
                    || item.get("result").is_some()
                    || item.get("revisedText").is_some())
        })
    })
}

fn build_batch_grammar(batch: &[Segment]) -> Result<String, String> {
    let punct_alternatives = FLEX_PUNCTUATION
        .chars()
        .map(|ch| gbnf_string_literal(&ch.to_string()))
        .collect::<Result<Vec<_>, _>>()?
        .join(" | ");
    let mut body_rules = Vec::new();
    let mut item_rules = Vec::new();
    let mut item_names = Vec::new();
    for (index, segment) in batch.iter().enumerate() {
        let body_name = format!("body{index}");
        let item_name = format!("item{index}");
        let skeleton = segment
            .text
            .chars()
            .filter(|ch| !FLEX_PUNCTUATION.contains(*ch))
            .collect::<Vec<_>>();
        if skeleton.is_empty() {
            body_rules.push(format!("{body_name} ::= F"));
        } else {
            let mut parts = vec!["F".to_string()];
            for ch in skeleton {
                parts.push(gbnf_string_literal(&ch.to_string())?);
                parts.push("F".to_string());
            }
            body_rules.push(format!("{body_name} ::= {}", parts.join(" ")));
        }
        let prefix = gbnf_verbatim_literal(&format!(r#"{{"id":{},"result":""#, segment.id));
        let suffix = gbnf_verbatim_literal("\"}");
        item_rules.push(format!("{item_name} ::= {prefix} {body_name} {suffix}"));
        item_names.push(item_name);
    }
    let inner = item_names.join(" ws \",\" ws ");
    let mut lines = vec![
        format!("root ::= ws \"[\" ws {inner} ws \"]\" ws"),
        format!("P ::= {punct_alternatives}"),
        "F ::= P? P?".to_string(),
        r"ws ::= [ \t\n]*".to_string(),
    ];
    lines.extend(body_rules);
    lines.extend(item_rules);
    Ok(lines.join("\n"))
}

fn gbnf_verbatim_literal(text: &str) -> String {
    let escaped = text.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

fn gbnf_string_literal(text: &str) -> Result<String, String> {
    let json = serde_json::to_string(text).map_err(|error| error.to_string())?;
    Ok(gbnf_verbatim_literal(&json[1..json.len() - 1]))
}

fn send_request(
    target: &HttpTarget,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
    connect_timeout: Duration,
    idle_timeout: Duration,
    cancelled: CancelCheck,
) -> Result<HttpResponse, Failure> {
    check_cancelled(&cancelled)?;
    if path.contains('\r') || path.contains('\n') {
        return Err(Failure::Other("HTTP パスが不正です。".to_string()));
    }
    let address = target.resolve()?;
    let stream = TcpStream::connect_timeout(&address, connect_timeout)
        .map_err(|error| Failure::Connection(format!("接続に失敗しました: {error}")))?;
    let _ = stream.set_read_timeout(Some(SOCKET_POLL_INTERVAL));
    let _ = stream.set_write_timeout(Some(connect_timeout));
    let _ = stream.set_nodelay(true);
    let body = body.unwrap_or_default();
    let mut request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {}\r\nAccept: */*\r\nAccept-Encoding: identity\r\nConnection: close\r\n",
        target.authority
    );
    if method == "POST" {
        request.push_str("Content-Type: application/json\r\n");
    }
    request.push_str(&format!("Content-Length: {}\r\n\r\n", body.len()));
    let mut stream = stream;
    stream
        .write_all(request.as_bytes())
        .and_then(|_| stream.write_all(body))
        .map_err(|error| Failure::Connection(format!("リクエスト送信に失敗しました: {error}")))?;

    let mut reader = RawReader {
        stream,
        idle_timeout,
        last_activity: Instant::now(),
        cancelled,
        pending: Vec::new(),
    };
    let (status, reason, headers) = reader.read_headers()?;
    let content_type = headers.get("content-type").cloned().unwrap_or_default();
    let transfer_chunked = headers
        .get("transfer-encoding")
        .is_some_and(|value| value.to_ascii_lowercase().contains("chunked"));
    let content_length = headers
        .get("content-length")
        .and_then(|value| value.trim().parse::<usize>().ok());
    let framing = if transfer_chunked {
        BodyFraming::Chunked
    } else if content_length.is_some() {
        BodyFraming::Length
    } else {
        BodyFraming::UntilEof
    };
    Ok(HttpResponse {
        reader,
        status,
        reason,
        content_type,
        framing,
        remaining: content_length.unwrap_or(0),
        chunk_remaining: 0,
        need_chunk_crlf: false,
        done: false,
    })
}

fn raise_for_status(response: &HttpResponse, url: &str) -> Result<(), Failure> {
    if response.status >= 400 {
        Err(Failure::HttpStatus {
            status: response.status,
            reason: response.reason.clone(),
            url: url.to_string(),
        })
    } else {
        Ok(())
    }
}

#[derive(Clone, Copy)]
enum BodyFraming {
    Length,
    Chunked,
    UntilEof,
}

struct RawReader {
    stream: TcpStream,
    idle_timeout: Duration,
    last_activity: Instant,
    cancelled: CancelCheck,
    pending: Vec<u8>,
}

impl RawReader {
    fn read_wire(&mut self, max_bytes: usize) -> Result<Vec<u8>, Failure> {
        loop {
            check_cancelled(&self.cancelled)?;
            let mut buffer = vec![0u8; max_bytes.max(1).min(8192)];
            match self.stream.read(&mut buffer) {
                Ok(0) => return Ok(Vec::new()),
                Ok(size) => {
                    self.last_activity = Instant::now();
                    buffer.truncate(size);
                    return Ok(buffer);
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    if self.last_activity.elapsed() >= self.idle_timeout {
                        return Err(Failure::Other(format!("ReadTimeout: {error}")));
                    }
                }
                Err(error) => {
                    return Err(Failure::Connection(format!("HTTP 接続が失敗しました: {error}")))
                }
            }
        }
    }

    fn read_headers(&mut self) -> Result<(u16, String, HashMap<String, String>), Failure> {
        let mut bytes = Vec::new();
        loop {
            if let Some(end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                let header_end = end + 4;
                self.pending.extend_from_slice(&bytes[header_end..]);
                bytes.truncate(end);
                let text = String::from_utf8_lossy(&bytes);
                let mut lines = text.split("\r\n");
                let status_line = lines.next().unwrap_or("");
                let mut status_parts = status_line.splitn(3, ' ');
                let _version = status_parts.next();
                let status = status_parts
                    .next()
                    .and_then(|value| value.parse::<u16>().ok())
                    .ok_or_else(|| Failure::Other("HTTP ステータス行を解析できません。".to_string()))?;
                let reason = status_parts.next().unwrap_or("").to_string();
                let mut headers = HashMap::new();
                for line in lines {
                    if let Some((name, value)) = line.split_once(':') {
                        headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
                    }
                }
                return Ok((status, reason, headers));
            }
            if bytes.len() > 64 * 1024 {
                return Err(Failure::Other("HTTP ヘッダーが大きすぎます。".to_string()));
            }
            let chunk = self.read_wire(4096)?;
            if chunk.is_empty() {
                return Err(Failure::Connection("HTTP 応答ヘッダーが途中で終了しました。".to_string()));
            }
            bytes.extend_from_slice(&chunk);
        }
    }

    fn take_pending(&mut self, max_bytes: usize) -> Vec<u8> {
        let count = max_bytes.min(self.pending.len());
        self.pending.drain(..count).collect()
    }

    fn read_raw(&mut self, max_bytes: usize) -> Result<Vec<u8>, Failure> {
        if !self.pending.is_empty() {
            return Ok(self.take_pending(max_bytes));
        }
        self.read_wire(max_bytes)
    }

    fn read_exact_wire(&mut self, size: usize) -> Result<Vec<u8>, Failure> {
        let mut bytes = Vec::with_capacity(size);
        while bytes.len() < size {
            let chunk = self.read_raw(size - bytes.len())?;
            if chunk.is_empty() {
                return Err(Failure::Other("HTTP 応答ボディが途中で終了しました。".to_string()));
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }

    fn read_line(&mut self) -> Result<Vec<u8>, Failure> {
        let mut line = Vec::new();
        loop {
            let byte = if self.pending.is_empty() {
                let next = self.read_wire(1)?;
                if next.is_empty() {
                    return Err(Failure::Other("HTTP チャンク行が途中で終了しました。".to_string()));
                }
                next[0]
            } else {
                self.pending.remove(0)
            };
            line.push(byte);
            if byte == b'\n' {
                line.truncate(line.len().saturating_sub(2));
                return Ok(line);
            }
            if line.len() > 8192 {
                return Err(Failure::Other("HTTP チャンク行が長すぎます。".to_string()));
            }
        }
    }
}

struct HttpResponse {
    reader: RawReader,
    status: u16,
    reason: String,
    content_type: String,
    framing: BodyFraming,
    remaining: usize,
    chunk_remaining: usize,
    need_chunk_crlf: bool,
    done: bool,
}

impl HttpResponse {
    fn read_body_chunk(&mut self, max_bytes: usize) -> Result<Vec<u8>, Failure> {
        if self.done {
            return Ok(Vec::new());
        }
        match self.framing {
            BodyFraming::Length => {
                if self.remaining == 0 {
                    self.done = true;
                    return Ok(Vec::new());
                }
                let chunk = self.reader.read_raw(max_bytes.min(self.remaining))?;
                if chunk.is_empty() {
                    return Err(Failure::Other("HTTP 応答ボディが途中で終了しました。".to_string()));
                }
                self.remaining -= chunk.len();
                Ok(chunk)
            }
            BodyFraming::UntilEof => {
                let chunk = self.reader.read_raw(max_bytes)?;
                if chunk.is_empty() {
                    self.done = true;
                }
                Ok(chunk)
            }
            BodyFraming::Chunked => {
                if self.need_chunk_crlf {
                    let ending = self.reader.read_exact_wire(2)?;
                    if ending != b"\r\n" {
                        return Err(Failure::Other("HTTP チャンク終端が不正です。".to_string()));
                    }
                    self.need_chunk_crlf = false;
                }
                if self.chunk_remaining == 0 {
                    let line = self.reader.read_line()?;
                    let line = String::from_utf8_lossy(&line);
                    let size = line
                        .split(';')
                        .next()
                        .unwrap_or("")
                        .trim();
                    self.chunk_remaining = usize::from_str_radix(size, 16).map_err(|_| {
                        Failure::Other("HTTP チャンクサイズを解析できません。".to_string())
                    })?;
                    if self.chunk_remaining == 0 {
                        loop {
                            if self.reader.read_line()?.is_empty() {
                                break;
                            }
                        }
                        self.done = true;
                        return Ok(Vec::new());
                    }
                }
                let chunk = self.reader.read_raw(max_bytes.min(self.chunk_remaining))?;
                if chunk.is_empty() {
                    return Err(Failure::Other("HTTP チャンクが途中で終了しました。".to_string()));
                }
                self.chunk_remaining -= chunk.len();
                if self.chunk_remaining == 0 {
                    self.need_chunk_crlf = true;
                }
                Ok(chunk)
            }
        }
    }

    fn read_all(&mut self) -> Result<Vec<u8>, Failure> {
        let mut body = Vec::new();
        loop {
            let chunk = self.read_body_chunk(8192)?;
            if chunk.is_empty() {
                break;
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }
}

pub(crate) fn check_cancelled(cancelled: &CancelCheck) -> Result<(), Failure> {
    if cancelled() {
        Err(Failure::Cancelled)
    } else {
        Ok(())
    }
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let prefix = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{prefix}...")
    } else {
        prefix
    }
}

pub(crate) fn value_as_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|number| i64::try_from(number).ok()))
        .or_else(|| value.as_f64().and_then(|number| Some(number as i64)))
        .or_else(|| value.as_str().and_then(|text| text.parse::<i64>().ok()))
        .or_else(|| value.as_bool().map(i64::from))
}

pub(crate) fn value_as_python_string(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Null => Some("None".to_string()),
        Value::Bool(value) => Some(if *value { "True" } else { "False" }.to_string()),
        Value::Number(number) => Some(number.to_string()),
        Value::Array(values) => Some(format!("{:?}", values)),
        Value::Object(_) => Some("{}".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::{SocketAddr, TcpListener, TcpStream},
        process::Command,
        sync::atomic::{AtomicBool, AtomicUsize},
    };

    struct FakeServer {
        address: SocketAddr,
        phase: Arc<AtomicUsize>,
        model_requests: Arc<[AtomicUsize; 2]>,
        requests: Arc<Mutex<Vec<(usize, Value)>>>,
        stopping: Arc<AtomicBool>,
        worker: Option<thread::JoinHandle<()>>,
    }

    impl FakeServer {
        fn start() -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind fake llama-server");
            let address = listener.local_addr().expect("fake server address");
            listener.set_nonblocking(true).expect("nonblocking listener");
            let phase = Arc::new(AtomicUsize::new(0));
            let model_requests = Arc::new([
                AtomicUsize::new(0),
                AtomicUsize::new(0),
            ]);
            let requests = Arc::new(Mutex::new(Vec::new()));
            let stopping = Arc::new(AtomicBool::new(false));
            let thread_phase = Arc::clone(&phase);
            let thread_models = Arc::clone(&model_requests);
            let thread_requests = Arc::clone(&requests);
            let thread_stopping = Arc::clone(&stopping);
            let worker = thread::spawn(move || {
                let mut connections = Vec::new();
                while !thread_stopping.load(Ordering::SeqCst) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            let phase = Arc::clone(&thread_phase);
                            let models = Arc::clone(&thread_models);
                            let requests = Arc::clone(&thread_requests);
                            connections.push(thread::spawn(move || {
                                handle_fake_request(stream, phase, models, requests)
                            }));
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(_) => break,
                    }
                }
                for connection in connections {
                    let _ = connection.join();
                }
            });
            Self {
                address,
                phase,
                model_requests,
                requests,
                stopping,
                worker: Some(worker),
            }
        }

        fn set_phase(&self, phase: usize) {
            self.phase.store(phase.min(1), Ordering::SeqCst);
        }

        fn stop(&mut self) {
            self.stopping.store(true, Ordering::SeqCst);
            if let Some(worker) = self.worker.take() {
                let _ = worker.join();
            }
        }
    }

    impl Drop for FakeServer {
        fn drop(&mut self) {
            self.stop();
        }
    }

    fn handle_fake_request(
        mut stream: TcpStream,
        phase: Arc<AtomicUsize>,
        model_requests: Arc<[AtomicUsize; 2]>,
        requests: Arc<Mutex<Vec<(usize, Value)>>>,
    ) {
        // Windows ではノンブロッキングのリスナーから受けた接続もノンブロッキングになるため戻す
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 4096];
        let (header_end, content_length) = loop {
            let Ok(size) = stream.read(&mut chunk) else { return };
            if size == 0 {
                return;
            }
            bytes.extend_from_slice(&chunk[..size]);
            if let Some(end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                let header_end = end + 4;
                let headers = String::from_utf8_lossy(&bytes[..end]);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or(0);
                if bytes.len() >= header_end + length {
                    break (header_end, length);
                }
            }
        };
        while bytes.len() < header_end + content_length {
            let Ok(size) = stream.read(&mut chunk) else { return };
            if size == 0 {
                return;
            }
            bytes.extend_from_slice(&chunk[..size]);
        }
        let request_line = String::from_utf8_lossy(&bytes)
            .lines()
            .next()
            .unwrap_or("")
            .to_string();
        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap_or("");
        let path = parts.next().unwrap_or("");
        let request_phase = phase.load(Ordering::SeqCst).min(1);
        if method == "GET" && path.ends_with("/models") {
            let attempt = model_requests[request_phase].fetch_add(1, Ordering::SeqCst);
            if attempt == 0 {
                write_fake_response(&mut stream, 503, "Service Unavailable", "application/json", "{}");
            } else {
                write_fake_response(
                    &mut stream,
                    200,
                    "OK",
                    "application/json",
                    r#"{"data":[{"id":"gemma-4-E4B-it-qat"}]}"#,
                );
            }
            return;
        }
        if method != "POST" || !path.ends_with("/chat/completions") {
            write_fake_response(&mut stream, 404, "Not Found", "application/json", "{}");
            return;
        }
        let body = &bytes[header_end..header_end + content_length];
        let Ok(request_body) = serde_json::from_slice::<Value>(body) else {
            write_fake_response(&mut stream, 400, "Bad Request", "application/json", "{}");
            return;
        };
        requests
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .push((request_phase, request_body.clone()));
        if request_body.get("grammar").is_some() {
            write_fake_response(
                &mut stream,
                400,
                "Bad Request",
                "application/json",
                r#"{"error":{"message":"grammar is not supported"}}"#,
            );
            return;
        }
        let user_content = request_body
            .pointer("/messages/1/content")
            .and_then(Value::as_str)
            .unwrap_or("");
        let answer = if user_content.contains("[0]") {
            json!([{"id":0,"result":"こんにちは","changed":"句読点付与"}])
        } else {
            json!([{"id":1,"result":"今日はいい天気。","changed":"句点付与"}])
        };
        let delta = json!({"choices":[{"delta":{"content":answer.to_string()}}]});
        let event_body = format!("data: {delta}\n\ndata: [DONE]\n\n");
        write_fake_response(
            &mut stream,
            200,
            "OK",
            "text/event-stream",
            &event_body,
        );
    }

    fn write_fake_response(
        stream: &mut TcpStream,
        status: u16,
        reason: &str,
        content_type: &str,
        body: &str,
    ) {
        let headers = format!(
            "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.as_bytes().len()
        );
        let _ = stream.write_all(headers.as_bytes());
        let _ = stream.write_all(body.as_bytes());
        let _ = stream.flush();
    }

    #[test]
    #[ignore = "手動の Python/Rust 同等性確認。Python requests が必要"]
    fn python_and_rust_match_request_bodies_and_output_with_retries() {
        let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repository root");
        let test_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("codex");
        std::fs::create_dir_all(&test_dir).expect("test directory");
        let segments = json!([
            {"id": 0, "text": "こんにちは", "speaker": "SPEAKER_00", "speakerLabel": "Th"},
            {"id": 1, "text": "今日はいい天気", "speaker": "SPEAKER_01", "speakerLabel": "Cl"}
        ]);
        let input_path = test_dir.join("proofread-equivalence-input.json");
        std::fs::write(
            &input_path,
            serde_json::to_vec(&segments).expect("serialize test segments"),
        )
        .expect("write synthetic input");

        let mut server = FakeServer::start();
        let base_url = format!("http://127.0.0.1:{}", server.address.port());
        let python = std::env::var("PYTHON").unwrap_or_else(|_| "python".to_string());
        let helper = test_dir.join("run_python_proofread.py");
        let cli = repo.join("python_sidecar").join("proofread_llm_cli.py");
        let python_result = Command::new(python)
            .current_dir(repo)
            .arg(helper)
            .arg(cli)
            .arg("--segments-json-path")
            .arg(&input_path)
            .arg("--backend")
            .arg("llama_server")
            .arg("--server-url")
            .arg(&base_url)
            .arg("--server-model")
            .arg("gemma-4-E4B-it-qat")
            .arg("--max-batch")
            .arg("1")
            .arg("--parallel")
            .arg("2")
            .output()
            .expect("run Python proofread comparison");
        assert!(
            python_result.status.success(),
            "Python CLI failed: {}\nstdout: {}",
            String::from_utf8_lossy(&python_result.stderr),
            String::from_utf8_lossy(&python_result.stdout)
        );
        let python_json: Value = serde_json::from_slice(&python_result.stdout)
            .expect("parse Python CLI output JSON");

        server.set_phase(1);
        let segments = segments.as_array().expect("segment array").clone();
        let emitter = Emitter::new(|_| {});
        let rust_items = proofread(
            &segments,
            Options {
                base_url: base_url.clone(),
                model: "gemma-4-E4B-it-qat".to_string(),
                provider_label: "AI校正エンジン".to_string(),
                backend_name: "llama_server".to_string(),
                system_prompt: None,
                prompt_type: "gemma4".to_string(),
                max_batch_segments: 1,
                parallel: 2,
                require_model_list: true,
                fallback_to_first_model: true,
                extra_payload: Some(json!({
                    "chat_template_kwargs": {"enable_thinking": false}
                })),
                allow_grammar: true,
            },
            &emitter,
            Arc::new(|| false),
        )
        .expect("Rust proofread");
        let rust_json = json!({"success": true, "result": {"items": rust_items}});
        assert_eq!(python_json, rust_json, "Python/Rust result JSON differs");

        server.stop();
        let requests = server
            .requests
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut python_bodies = requests
            .iter()
            .filter(|(phase, _)| *phase == 0)
            .map(|(_, body)| body.to_string())
            .collect::<Vec<_>>();
        let mut rust_bodies = requests
            .iter()
            .filter(|(phase, _)| *phase == 1)
            .map(|(_, body)| body.to_string())
            .collect::<Vec<_>>();
        python_bodies.sort();
        rust_bodies.sort();
        assert_eq!(python_bodies, rust_bodies, "chat request body sets differ");
        assert_eq!(python_bodies.len(), 4, "expected grammar + retry per batch");
        assert_eq!(server.model_requests[0].load(Ordering::SeqCst), 2);
        assert_eq!(server.model_requests[1].load(Ordering::SeqCst), 2);
        assert_eq!(
            python_bodies.iter().filter(|body| body.contains("grammar")).count(),
            2,
            "expected one grammar rejection for each batch"
        );
        assert_eq!(
            rust_bodies.iter().filter(|body| body.contains("grammar")).count(),
            2,
            "expected Rust to retry each rejected grammar request"
        );
    }
}
