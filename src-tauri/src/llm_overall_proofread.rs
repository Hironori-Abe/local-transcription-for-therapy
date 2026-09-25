use serde_json::{json, Map, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use super::llm_proofread::{self, CancelCheck, Emitter, Failure, HttpTarget, Segment};

const BATCH_TARGET_CHARS: usize = 1000;
const BATCH_MAX_SEGMENTS: usize = 20;

const GEMMA4_OVERALL_FIXED_SUFFIX: &str = concat!(
    "\n\n出力ルール：\n",
    "- すべてのセグメントをJSON配列として返す\n",
    "- 先頭文字は「[」、末尾文字は「]」にする\n",
    "- 説明・前置き・マークダウン（``` など）は一切含めない\n",
    "- スキーマ: [{\"id\": <番号>, \"revised\": \"校正後テキスト\", \"note\": \"変更内容（変更なしは空文字）\"}]\n\n",
    "出力例：\n",
    "入力:\n",
    "[1] Th: えーと今日はどんなことで来られましたか\n",
    "[2] Cl: はい、最近眠れなくてちょっと辛いです\n\n",
    "出力:\n",
    "[{\"id\": 1, \"revised\": \"えーと、今日はどんなことで来られましたか？\", \"note\": \"読点と「？」を追加\"},",
    "{\"id\": 2, \"revised\": \"はい、最近眠れなくて、ちょっと辛いです。\", \"note\": \"読点と句点を追加\"}]"
);

const ORIGINAL_OVERALL_FIXED_SUFFIX: &str = concat!(
    "\n\n### 出力ルール\n",
    "- すべてのセグメントをJSON配列として返す\n",
    "- コードブロック（``` など）・説明・前置き・マークダウンは一切含めない\n",
    "- 返答の最初の文字を「[」、最後の文字を「]」にする\n",
    "- スキーマ: [{\"id\": <番号>, \"revised\": \"校正後テキスト\", \"note\": \"変更内容（変更なしは空文字）\"}]\n\n",
    "### 出力例\n",
    "入力:\n",
    "[1] Th: えーと今日はどんなことで来られましたか\n",
    "[2] Cl: はい、最近眠れなくてちょっと辛いです\n\n",
    "出力:\n",
    "[{\"id\": 1, \"revised\": \"えーと、今日はどんなことで来られましたか？\", \"note\": \"読点と「？」を追加\"},",
    "{\"id\": 2, \"revised\": \"はい、最近眠れなくて、ちょっと辛いです。\", \"note\": \"読点と句点を追加\"}]"
);

const DEFAULT_SYSTEM_INSTRUCTION: &str = concat!(
    "あなたは日本語のカウンセリング・対話記録の全体校正を行うアシスタントです。\n",
    "以下の連続した発言を校正し、より自然で正確なテキストに整えてください。\n",
    "積極的な校正を行い、次の観点から改善を提案してください：句読点の追加・修正、誤字脱字の修正、不自然な語尾・語順の改善、冗長表現の整理、文脈の流れを損なう表現の改善、一人の発話として不自然な文章の指摘（話者分離の誤りによって複数人の発言が混入しているような違和感がある場合）。\n",
    "話者の意図・感情・内容は変えないこと。会話フィラーはそのまま残すこと。セグメントの分割・統合はしないこと。\n",
    "番号付きのすべてのテキストを校正し、以下のJSON配列形式のみで返答してください。説明・前置き・マークダウン形式は不要です。\n",
    "[{\"id\": <番号>, \"revised\": \"校正後テキスト\", \"note\": \"変更内容（変更なしは空文字）\"}]"
);

const NOTE_NOISE_CHARS: &str = "{}[]|\\,; \t\r\n";

pub(crate) struct Options {
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) provider_label: String,
    pub(crate) system_prompt: Option<String>,
    pub(crate) prompt_type: String,
    pub(crate) parallel: usize,
    pub(crate) require_model_list: bool,
    pub(crate) fallback_to_first_model: bool,
    pub(crate) extra_payload: Option<Value>,
    pub(crate) prompt_templates_dir: Option<PathBuf>,
}

struct BatchContext<'a> {
    target: &'a HttpTarget,
    chat_url: &'a str,
    chat_path: &'a str,
    model: &'a str,
    system_instruction: &'a str,
    extra_payload: Option<&'a Value>,
    total_segments: usize,
    total_batches: usize,
    workers: usize,
    progress_count: &'a AtomicUsize,
    emitter: &'a Emitter,
    cancelled: &'a CancelCheck,
}

pub(crate) fn proofread(
    input_segments: &[Value],
    options: Options,
    emitter: &Emitter,
    cancelled: CancelCheck,
) -> Result<Value, String> {
    proofread_inner(input_segments, options, emitter, &cancelled)
        .map_err(|failure| failure.to_string())
}

fn proofread_inner(
    input_segments: &[Value],
    options: Options,
    emitter: &Emitter,
    cancelled: &CancelCheck,
) -> Result<Value, Failure> {
    llm_proofread::check_cancelled(cancelled)?;

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
    let origin = format!("http://{}", target.authority());
    let models_url = format!("{origin}{models_path}");
    let chat_url = format!("{origin}{chat_path}");

    emitter.progress(
        format!(
            "{} に接続中... ({normalized_base_url})",
            options.provider_label
        ),
        None,
        None,
    );

    let models_data = match llm_proofread::fetch_models(
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
        Err(error) => {
            emitter.progress(format!("モデル一覧取得失敗（続行）: {error}"), None, None);
            Value::Object(Map::new())
        }
    };

    let available_ids = llm_proofread::collect_model_ids(&models_data);
    let available_label = if available_ids.is_empty() {
        "(なし)".to_string()
    } else {
        format!(
            "[{}]",
            available_ids
                .iter()
                .map(|id| python_repr_string(id))
                .collect::<Vec<_>>()
                .join(", ")
        )
    };
    emitter.progress(format!("利用可能なモデル: {available_label}"), None, None);

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

    let segments = llm_proofread::parse_segments(input_segments)?;
    let batches = batch_segments_by_chars(&segments);
    let total_batches = batches.len();
    let total_segments = segments.len();
    let workers = if total_batches == 0 {
        1
    } else {
        options.parallel.max(1).min(total_batches)
    };
    let system_instruction = load_system_instruction(
        options.system_prompt.as_deref(),
        &options.prompt_type,
        options.prompt_templates_dir.as_deref(),
    );

    if total_batches == 0 {
        return Ok(build_result_payload(&segments, &HashMap::new()));
    }

    let shared_results = Arc::new(Mutex::new(HashMap::<i64, Value>::new()));
    let progress_count = AtomicUsize::new(0);
    let next_batch = AtomicUsize::new(0);
    let stop_dispatch = Arc::new(AtomicBool::new(false));
    let first_error = Mutex::new(None::<Failure>);
    let context = BatchContext {
        target: &target,
        chat_url: &chat_url,
        chat_path: &chat_path,
        model: &model,
        system_instruction: &system_instruction,
        extra_payload: options.extra_payload.as_ref(),
        total_segments,
        total_batches,
        workers,
        progress_count: &progress_count,
        emitter,
        cancelled,
    };

    if workers <= 1 {
        for batch_idx in 0..total_batches {
            llm_proofread::check_cancelled(cancelled)?;
            let batch_results = process_batch(batch_idx, &batches, &context)?;
            store_batch_result(
                batch_results,
                batches[batch_idx].len(),
                &shared_results,
                &progress_count,
                batch_idx,
                total_batches,
                total_segments,
                emitter,
            );
        }
    } else {
        emit_overall_progress(
            emitter,
            format!("並列処理中（同時 {workers} バッチ）..."),
            Some(0),
            Some(total_segments),
        );
        thread::scope(|scope| {
            for _ in 0..workers {
                let next_batch = &next_batch;
                let shared_results = Arc::clone(&shared_results);
                let stop_dispatch = Arc::clone(&stop_dispatch);
                let first_error = &first_error;
                let context = &context;
                let batches = &batches;
                scope.spawn(move || loop {
                    if stop_dispatch.load(Ordering::Acquire) {
                        break;
                    }
                    let batch_idx = next_batch.fetch_add(1, Ordering::Relaxed);
                    if batch_idx >= batches.len() {
                        break;
                    }
                    match process_batch(batch_idx, batches, context) {
                        Ok(batch_results) => store_batch_result(
                            batch_results,
                            batches[batch_idx].len(),
                            &shared_results,
                            context.progress_count,
                            batch_idx,
                            context.total_batches,
                            context.total_segments,
                            context.emitter,
                        ),
                        Err(error) => {
                            stop_dispatch.store(true, Ordering::Release);
                            let mut stored = first_error
                                .lock()
                                .unwrap_or_else(|poison| poison.into_inner());
                            if stored.is_none() {
                                *stored = Some(error);
                            }
                            break;
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

    llm_proofread::check_cancelled(cancelled)?;
    let results = shared_results
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    Ok(build_result_payload(&segments, &results))
}

fn store_batch_result(
    batch_results: HashMap<i64, Value>,
    batch_size: usize,
    results: &Arc<Mutex<HashMap<i64, Value>>>,
    progress_count: &AtomicUsize,
    batch_idx: usize,
    total_batches: usize,
    total_segments: usize,
    emitter: &Emitter,
) {
    let mut map = results.lock().unwrap_or_else(|poison| poison.into_inner());
    map.extend(batch_results);
    drop(map);
    let current = progress_count.fetch_add(batch_size, Ordering::Relaxed) + batch_size;
    emit_overall_progress(
        emitter,
        format!("バッチ {}/{total_batches} 完了", batch_idx + 1),
        Some(current),
        Some(total_segments),
    );
}

fn process_batch(
    batch_idx: usize,
    batches: &[Vec<Segment>],
    context: &BatchContext<'_>,
) -> Result<HashMap<i64, Value>, Failure> {
    llm_proofread::check_cancelled(context.cancelled)?;
    let batch = &batches[batch_idx];
    let previous = batch_idx.checked_sub(1).and_then(|idx| batches[idx].last());
    let next = batches.get(batch_idx + 1).and_then(|batch| batch.first());
    let previous_context = previous.map(overall_segment_text);
    let next_context = next.map(overall_segment_text);

    emit_overall_progress(
        context.emitter,
        format!(
            "バッチ {}/{} を処理中...",
            batch_idx + 1,
            context.total_batches
        ),
        None,
        Some(context.total_segments),
    );

    let messages = build_chat_messages(
        batch,
        previous_context.as_deref(),
        next_context.as_deref(),
        context.system_instruction,
    );
    let max_tokens = 6144usize.min(512usize.max(batch.len().saturating_mul(300)));
    let idle_timeout = if batch_idx < context.workers {
        Duration::from_secs(60)
    } else {
        Duration::from_secs(30)
    };
    let mut payload = json!({
        "model": context.model,
        "messages": messages,
        "temperature": 0.15,
        "max_tokens": max_tokens,
    });
    if let (Some(extra), Some(payload_obj)) = (context.extra_payload, payload.as_object_mut()) {
        if let Some(extra_obj) = extra.as_object() {
            for (key, value) in extra_obj {
                payload_obj.insert(key.clone(), value.clone());
            }
        }
    }

    let raw_text = llm_proofread::stream_llm_chat_overall(
        context.target,
        context.chat_url,
        context.chat_path,
        &payload,
        idle_timeout,
        context.cancelled.clone(),
    )?;
    Ok(extract_batch_result(&raw_text, batch))
}

fn emit_overall_progress(
    emitter: &Emitter,
    message: String,
    current: Option<usize>,
    total: Option<usize>,
) {
    let mut fields = vec![("message".to_string(), Value::String(message))];
    if let Some(current) = current {
        fields.push(("current".to_string(), json!(current)));
    }
    if let Some(total) = total {
        fields.push(("total".to_string(), json!(total)));
    }
    emitter.event("overall_proofread", fields);
}

pub(crate) fn batch_segments_by_chars(segments: &[Segment]) -> Vec<Vec<Segment>> {
    if segments.is_empty() {
        return Vec::new();
    }
    let mut batches = Vec::new();
    let mut current = Vec::new();
    let mut current_chars = 0usize;
    for segment in segments {
        let text_len = segment.text.chars().count();
        if !current.is_empty()
            && (current_chars + text_len > BATCH_TARGET_CHARS
                || current.len() >= BATCH_MAX_SEGMENTS)
        {
            batches.push(current);
            current = vec![segment.clone()];
            current_chars = text_len;
        } else {
            current.push(segment.clone());
            current_chars += text_len;
        }
    }
    if !current.is_empty() {
        batches.push(current);
    }
    batches
}

pub(crate) fn build_chat_messages(
    batch: &[Segment],
    previous_context: Option<&str>,
    next_context: Option<&str>,
    system_instruction: &str,
) -> Value {
    let mut context_lines = Vec::new();
    if let Some(previous_context) = previous_context.filter(|text| !text.is_empty()) {
        context_lines.push(format!("前の文（参考）：{previous_context}"));
    }
    if let Some(next_context) = next_context.filter(|text| !text.is_empty()) {
        context_lines.push(format!("次の文（参考）：{next_context}"));
    }
    let context_section = if context_lines.is_empty() {
        String::new()
    } else {
        format!("{}\n\n", context_lines.join("\n"))
    };
    let numbered = batch
        .iter()
        .map(|segment| {
            format!(
                "[{}] {}{}",
                segment.id,
                format_overall_speaker(segment),
                segment.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    json!([
        {"role": "system", "content": system_instruction},
        {"role": "user", "content": format!("{context_section}{numbered}")}
    ])
}

pub(crate) fn extract_batch_result(
    completion_text: &str,
    batch: &[Segment],
) -> HashMap<i64, Value> {
    let text = llm_proofread::normalize_completion_text(completion_text);
    let segment_index = batch
        .iter()
        .map(|segment| (segment.id, segment))
        .collect::<HashMap<_, _>>();
    let expected_ids = segment_index.keys().copied().collect::<HashSet<_>>();
    let items = pick_best_json_items(&text, Some(&expected_ids));
    let mut result_map = HashMap::new();
    if let Some(items) = items {
        for item in items {
            let Some(id) = item.get("id").and_then(llm_proofread::value_as_i64) else {
                continue;
            };
            let Some(original) = segment_index.get(&id) else {
                continue;
            };
            let revised_value = item
                .get("revised")
                .or_else(|| item.get("result"))
                .or_else(|| item.get("revisedText"));
            let revised = python_string_or_default(revised_value, "")
                .trim()
                .to_string();
            let mut note =
                python_string_or_default(item.get("note").or_else(|| item.get("changed")), "")
                    .trim()
                    .to_string();
            if !note.is_empty() && note.chars().all(|ch| NOTE_NOISE_CHARS.contains(ch)) {
                note.clear();
            }
            if revised.is_empty()
                || (revised.starts_with('（')
                    && revised.ends_with('）')
                    && revised.chars().count() <= 20)
            {
                continue;
            }
            let (revised_text, note) = if !original.text.is_empty()
                && revised != original.text
                && levenshtein_similarity(&original.text, &revised) < 0.3
            {
                (original.text.clone(), String::new())
            } else {
                (revised, note)
            };
            result_map.insert(
                id,
                json!({
                    "id": id,
                    "originalText": original.text,
                    "revisedText": revised_text,
                    "note": note,
                }),
            );
        }
    }
    for segment in batch {
        result_map.entry(segment.id).or_insert_with(|| {
            json!({
                "id": segment.id,
                "originalText": segment.text,
                "revisedText": segment.text,
                "note": "",
            })
        });
    }
    result_map
}

pub(crate) fn build_result_payload(
    segments: &[Segment],
    results_map: &HashMap<i64, Value>,
) -> Value {
    let mut items = Vec::new();
    let mut changed_count = 0i64;
    let mut unchanged_count = 0i64;
    for segment in segments {
        let Some(result) = results_map.get(&segment.id) else {
            continue;
        };
        let original = result
            .get("originalText")
            .and_then(Value::as_str)
            .unwrap_or(&segment.text);
        let revised = result
            .get("revisedText")
            .and_then(Value::as_str)
            .unwrap_or(&segment.text);
        let note = result.get("note").and_then(Value::as_str).unwrap_or("");
        let changed = revised != original;
        if changed {
            changed_count += 1;
        } else {
            unchanged_count += 1;
        }
        items.push(json!({
            "id": segment.id,
            "originalText": original,
            "revisedText": revised,
            "note": note,
            "speakerLabel": speaker_label(segment),
            "changed": changed,
        }));
    }
    json!({
        "items": items,
        "changedCount": changed_count,
        "unchangedCount": unchanged_count,
    })
}

fn pick_best_json_items(text: &str, expected_ids: Option<&HashSet<i64>>) -> Option<Vec<Value>> {
    let mut merged = Vec::new();
    let mut seen = HashSet::new();
    for candidate in llm_proofread::iter_json_array_candidates(text) {
        let Ok(parsed) = serde_json::from_str::<Value>(&candidate) else {
            continue;
        };
        let Some(items) = parsed.as_array() else {
            continue;
        };
        for item in items {
            if !item.is_object() || item.get("id").is_none() {
                continue;
            }
            if item.get("revised").is_none()
                && item.get("result").is_none()
                && item.get("revisedText").is_none()
            {
                continue;
            }
            let Some(id) = item.get("id").and_then(llm_proofread::value_as_i64) else {
                continue;
            };
            if expected_ids.is_some_and(|expected| !expected.contains(&id)) || !seen.insert(id) {
                continue;
            }
            merged.push(item.clone());
        }
    }
    (!merged.is_empty()).then_some(merged)
}

fn levenshtein_similarity(a: &str, b: &str) -> f64 {
    let mut a = a.chars().take(150).collect::<Vec<_>>();
    let mut b = b.chars().take(150).collect::<Vec<_>>();
    let la = a.len();
    let lb = b.len();
    if la == 0 && lb == 0 {
        return 1.0;
    }
    if la == 0 || lb == 0 {
        return 0.0;
    }
    if la > lb {
        std::mem::swap(&mut a, &mut b);
    }
    let la = a.len();
    let lb = b.len();
    let mut previous = (0..=la).collect::<Vec<_>>();
    for bch in b {
        let mut current = Vec::with_capacity(la + 1);
        current.push(previous[0] + 1);
        for (index, ach) in a.iter().enumerate() {
            current.push(std::cmp::min(
                current[index] + 1,
                std::cmp::min(
                    previous[index + 1] + 1,
                    previous[index] + usize::from(*ach != bch),
                ),
            ));
        }
        previous = current;
    }
    1.0 - previous[la] as f64 / la.max(lb) as f64
}

fn load_system_instruction(
    override_text: Option<&str>,
    prompt_type: &str,
    prompt_templates_dir: Option<&Path>,
) -> String {
    let suffix = fixed_suffix(prompt_type);
    if let Some(text) = override_text.map(str::trim).filter(|text| !text.is_empty()) {
        return format!("{text}{suffix}");
    }
    let filename = if prompt_type == "gemma4" {
        "gemma4_overall.txt"
    } else {
        "general_overall.txt"
    };
    let base = prompt_templates_dir
        .map(|dir| dir.join(filename))
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| DEFAULT_SYSTEM_INSTRUCTION.to_string());
    format!("{base}{suffix}")
}

fn fixed_suffix(prompt_type: &str) -> &'static str {
    if prompt_type == "gemma4" {
        GEMMA4_OVERALL_FIXED_SUFFIX
    } else {
        ORIGINAL_OVERALL_FIXED_SUFFIX
    }
}

fn overall_segment_text(segment: &Segment) -> String {
    format!("{}{}", format_overall_speaker(segment), segment.text)
}

fn format_overall_speaker(segment: &Segment) -> String {
    let label = raw_speaker_label(segment);
    if !label.is_empty() && label != "-" {
        format!("{label}: ")
    } else {
        String::new()
    }
}

fn raw_speaker_label(segment: &Segment) -> String {
    let label = segment
        .speaker_label
        .as_deref()
        .filter(|label| !label.is_empty())
        .map(str::to_string)
        .or_else(|| segment.speaker.as_str().map(str::to_string))
        .unwrap_or_default();
    label.trim().to_string()
}

fn speaker_label(segment: &Segment) -> String {
    raw_speaker_label(segment)
}

fn python_string_or_default(value: Option<&Value>, default: &str) -> String {
    value
        .and_then(llm_proofread::value_as_python_string)
        .unwrap_or_else(|| default.to_string())
}

fn python_repr_string(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "\\'"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::{SocketAddr, TcpListener, TcpStream},
        process::Command,
        sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc, Mutex,
        },
        thread,
        time::Duration,
    };

    fn segment(id: i64, text: &str, speaker: Option<&str>, label: Option<&str>) -> Segment {
        Segment {
            id,
            text: text.to_string(),
            speaker: speaker.map_or(Value::Null, |value| Value::String(value.to_string())),
            speaker_label: label.map(str::to_string),
        }
    }

    #[test]
    fn batches_match_target_and_segment_limits() {
        let segments = (0..21)
            .map(|id| segment(id, "a", Some("SPEAKER_00"), None))
            .collect::<Vec<_>>();
        let batches = batch_segments_by_chars(&segments);
        assert_eq!(batches.len(), 2);
        assert_eq!(batches[0].len(), 20);
        assert_eq!(batches[1].len(), 1);

        let long = vec![
            segment(0, &"あ".repeat(1000), None, None),
            segment(1, "い", None, None),
        ];
        let batches = batch_segments_by_chars(&long);
        assert_eq!(batches.iter().map(Vec::len).collect::<Vec<_>>(), vec![1, 1]);
    }

    #[test]
    fn chat_messages_include_context_and_speaker_fallback() {
        let batch = vec![segment(2, "本文", Some("SPEAKER_01"), None)];
        let messages = build_chat_messages(
            &batch,
            Some("Th: 前の文"),
            Some("Cl: 次の文"),
            "system instruction",
        );
        assert_eq!(
            messages,
            json!([
                {"role": "system", "content": "system instruction"},
                {"role": "user", "content": "前の文（参考）：Th: 前の文\n次の文（参考）：Cl: 次の文\n\n[2] SPEAKER_01: 本文"}
            ])
        );
    }

    #[test]
    fn invalid_json_and_low_similarity_fall_back_to_original() {
        let batch = vec![segment(1, "今日は晴れです", Some("S"), None)];
        let invalid = extract_batch_result("これはJSONではありません", &batch);
        assert_eq!(
            invalid[&1].get("revisedText").and_then(Value::as_str),
            Some("今日は晴れです")
        );
        assert_eq!(invalid[&1].get("note").and_then(Value::as_str), Some(""));

        let low = extract_batch_result(
            r#"[{"id":1,"revised":"全く別の文章","note":"大きく変更"}]"#,
            &batch,
        );
        assert_eq!(
            low[&1].get("revisedText").and_then(Value::as_str),
            Some("今日は晴れです")
        );
        assert_eq!(low[&1].get("note").and_then(Value::as_str), Some(""));
    }

    #[test]
    fn result_payload_counts_and_speaker_labels_match_python_shape() {
        let segments = vec![
            segment(0, "原文", Some("SPEAKER_00"), Some("Th")),
            segment(1, "変更なし", Some("SPEAKER_01"), None),
        ];
        let results = extract_batch_result(
            r#"[{"id":0,"revised":"変更後","note":"修正"},{"id":1,"revised":"変更なし","note":""}]"#,
            &segments,
        );
        assert_eq!(
            build_result_payload(&segments, &results),
            json!({
                "items": [
                    {"id":0,"originalText":"原文","revisedText":"原文","note":"","speakerLabel":"Th","changed":false},
                    {"id":1,"originalText":"変更なし","revisedText":"変更なし","note":"","speakerLabel":"SPEAKER_01","changed":false}
                ],
                "changedCount":0,
                "unchangedCount":2
            })
        );
    }

    #[test]
    fn load_system_instruction_uses_override_template_and_builtin_fallback() {
        let template_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("python_sidecar")
            .join("prompt_templates")
            .join("proofread");
        let from_template = load_system_instruction(None, "gemma4", Some(&template_dir));
        assert!(from_template
            .starts_with("あなたは日本語のカウンセリング・対話記録の校正アシスタントです。"));
        assert!(from_template.ends_with(GEMMA4_OVERALL_FIXED_SUFFIX));

        let override_text = load_system_instruction(Some("  独自プロンプト  "), "original", None);
        assert_eq!(
            override_text,
            format!("独自プロンプト{ORIGINAL_OVERALL_FIXED_SUFFIX}")
        );

        let fallback = load_system_instruction(None, "gemma4", None);
        assert_eq!(
            fallback,
            format!("{DEFAULT_SYSTEM_INSTRUCTION}{GEMMA4_OVERALL_FIXED_SUFFIX}")
        );
    }

    #[test]
    fn cancellation_is_checked_before_request() {
        let emitter = Emitter::new(|_| {});
        let cancelled: CancelCheck = Arc::new(|| true);
        let result = proofread(
            &[json!({"id": 0, "text": "本文"})],
            Options {
                base_url: "http://127.0.0.1:1".to_string(),
                model: "model".to_string(),
                provider_label: "ローカルOpenAI互換API".to_string(),
                system_prompt: None,
                prompt_type: "gemma4".to_string(),
                parallel: 1,
                require_model_list: false,
                fallback_to_first_model: false,
                extra_payload: None,
                prompt_templates_dir: None,
            },
            &emitter,
            cancelled,
        );
        assert_eq!(result, Err("LLM校正が中止されました。".to_string()));
    }

    #[derive(Clone, Copy)]
    enum FakeResponseMode {
        Valid,
        InvalidForId(i64),
    }

    struct FakeServer {
        address: SocketAddr,
        phase: Arc<AtomicUsize>,
        model_requests: Arc<[AtomicUsize; 2]>,
        requests: Arc<Mutex<Vec<(usize, Value)>>>,
        stopping: Arc<AtomicBool>,
        worker: Option<thread::JoinHandle<()>>,
    }

    impl FakeServer {
        fn start(response_mode: FakeResponseMode, retry_model_once: bool, model_id: &str) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind overall fake server");
            let address = listener.local_addr().expect("overall fake server address");
            listener
                .set_nonblocking(true)
                .expect("nonblocking listener");
            let phase = Arc::new(AtomicUsize::new(0));
            let model_requests = Arc::new([AtomicUsize::new(0), AtomicUsize::new(0)]);
            let requests = Arc::new(Mutex::new(Vec::new()));
            let stopping = Arc::new(AtomicBool::new(false));
            let thread_phase = Arc::clone(&phase);
            let thread_models = Arc::clone(&model_requests);
            let thread_requests = Arc::clone(&requests);
            let thread_stopping = Arc::clone(&stopping);
            let model_id = model_id.to_string();
            let worker = thread::spawn(move || {
                let mut connections = Vec::new();
                while !thread_stopping.load(Ordering::SeqCst) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            let phase = Arc::clone(&thread_phase);
                            let models = Arc::clone(&thread_models);
                            let requests = Arc::clone(&thread_requests);
                            let model_id = model_id.clone();
                            connections.push(thread::spawn(move || {
                                handle_fake_request(
                                    stream,
                                    phase,
                                    models,
                                    requests,
                                    response_mode,
                                    retry_model_once,
                                    &model_id,
                                )
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
        response_mode: FakeResponseMode,
        retry_model_once: bool,
        model_id: &str,
    ) {
        // Windows ではノンブロッキングのリスナーから受けた接続もノンブロッキングになるため戻す
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 4096];
        let (header_end, content_length) = loop {
            let Ok(size) = stream.read(&mut chunk) else {
                return;
            };
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
            let Ok(size) = stream.read(&mut chunk) else {
                return;
            };
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
            if retry_model_once && attempt == 0 {
                write_fake_response(
                    &mut stream,
                    503,
                    "Service Unavailable",
                    "application/json",
                    "{}",
                );
            } else {
                write_fake_response(
                    &mut stream,
                    200,
                    "OK",
                    "application/json",
                    &format!(r#"{{"data":[{{"id":"{model_id}"}}]}}"#),
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
        let user_content = request_body
            .pointer("/messages/1/content")
            .and_then(Value::as_str)
            .unwrap_or("");
        let invalid = match response_mode {
            FakeResponseMode::Valid => false,
            FakeResponseMode::InvalidForId(id) => user_content.contains(&format!("[{id}]")),
        };
        let answer = if invalid {
            "not valid json".to_string()
        } else {
            let items = extract_ids_from_user_content(user_content)
                .into_iter()
                .map(|id| {
                    json!({
                        "id": id,
                        "revised": format!("セグメント{id}"),
                        "note": ""
                    })
                })
                .collect::<Vec<_>>();
            serde_json::to_string(&items).expect("serialize fake overall response")
        };
        let delta = json!({"choices":[{"delta":{"content":answer}}]});
        let event_body = format!("data: {delta}\n\ndata: [DONE]\n\n");
        write_fake_response(&mut stream, 200, "OK", "text/event-stream", &event_body);
    }

    fn extract_ids_from_user_content(text: &str) -> Vec<i64> {
        text.split('[')
            .skip(1)
            .filter_map(|part| part.split(']').next()?.parse::<i64>().ok())
            .collect()
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

    fn equivalence_segments() -> Vec<Value> {
        (0..21)
            .map(|id| {
                json!({
                    "id": id,
                    "text": format!("セグメント{id}"),
                    "speaker": if id % 2 == 0 { "SPEAKER_00" } else { "SPEAKER_01" },
                    "speakerLabel": if id % 2 == 0 { "Th" } else { "Cl" },
                })
            })
            .collect()
    }

    fn run_python_overall(
        repo: &Path,
        input_path: &Path,
        base_url: &str,
        backend: &str,
        model: &str,
        parallel: usize,
    ) -> Value {
        let python = std::env::var("PYTHON").unwrap_or_else(|_| "python".to_string());
        let cli = repo.join("python_sidecar").join("overall_proofread_cli.py");
        let mut command = Command::new(python);
        command
            .current_dir(repo)
            .arg(&cli)
            .arg("--segments-json-path")
            .arg(input_path)
            .arg("--backend")
            .arg(backend)
            .arg("--prompt-type")
            .arg("gemma4")
            .arg("--parallel")
            .arg(parallel.to_string());
        if backend == "llama_server" {
            command
                .arg("--server-url")
                .arg(base_url)
                .arg("--server-model")
                .arg(model);
        } else {
            command
                .arg("--openai-base-url")
                .arg(base_url)
                .arg("--openai-model")
                .arg(model);
        }
        let output = command.output().expect("run Python overall proofreading");
        assert!(
            output.status.success(),
            "Python overall failed: {}\nstdout: {}",
            String::from_utf8_lossy(&output.stderr),
            String::from_utf8_lossy(&output.stdout)
        );
        serde_json::from_slice(&output.stdout).expect("parse Python overall output")
    }

    fn run_rust_overall(
        repo: &Path,
        segments: &[Value],
        base_url: &str,
        backend: &str,
        model: &str,
        parallel: usize,
    ) -> Value {
        let template_dir = repo
            .join("python_sidecar")
            .join("prompt_templates")
            .join("proofread");
        let emitter = Emitter::new(|_| {});
        let output = proofread(
            segments,
            Options {
                base_url: base_url.to_string(),
                model: model.to_string(),
                provider_label: if backend == "llama_server" {
                    "AI校正エンジン".to_string()
                } else {
                    "ローカルOpenAI互換API".to_string()
                },
                system_prompt: None,
                prompt_type: "gemma4".to_string(),
                parallel,
                require_model_list: backend == "llama_server",
                fallback_to_first_model: backend == "llama_server",
                extra_payload: (backend == "llama_server")
                    .then(|| json!({"chat_template_kwargs": {"enable_thinking": false}})),
                prompt_templates_dir: Some(template_dir),
            },
            &emitter,
            Arc::new(|| false),
        )
        .expect("Rust overall proofreading");
        json!({"success": true, "result": output})
    }

    fn run_equivalence_case(response_mode: FakeResponseMode, parallel: usize) {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repository root");
        let input_path = std::env::temp_dir().join(format!(
            "lott-overall-equivalence-{}-{}.json",
            std::process::id(),
            parallel
        ));
        let segments = equivalence_segments();
        std::fs::write(
            &input_path,
            serde_json::to_vec(&segments).expect("serialize overall test segments"),
        )
        .expect("write overall test segments");

        let mut server = FakeServer::start(response_mode, true, "available-model");
        let base_url = format!("http://127.0.0.1:{}", server.address.port());
        let python_json = run_python_overall(
            repo,
            &input_path,
            &base_url,
            "llama_server",
            "requested-model",
            parallel,
        );
        server.set_phase(1);
        let rust_json = run_rust_overall(
            repo,
            &segments,
            &base_url,
            "llama_server",
            "requested-model",
            parallel,
        );
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
        assert_eq!(python_bodies.len(), 2, "expected two overall batches");
        assert_eq!(server.model_requests[0].load(Ordering::SeqCst), 2);
        assert_eq!(server.model_requests[1].load(Ordering::SeqCst), 2);
        let _ = std::fs::remove_file(input_path);
    }

    #[test]
    #[ignore = "手動の Python/Rust 同等性確認。Python requests が必要"]
    fn python_and_rust_match_overall_requests_and_output_with_retries() {
        run_equivalence_case(FakeResponseMode::Valid, 1);
        run_equivalence_case(FakeResponseMode::Valid, 3);
        run_equivalence_case(FakeResponseMode::InvalidForId(0), 3);

        let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repository root");
        let segments = equivalence_segments();
        let input_path = std::env::temp_dir().join(format!(
            "lott-overall-openai-missing-{}.json",
            std::process::id()
        ));
        std::fs::write(
            &input_path,
            serde_json::to_vec(&segments).expect("serialize missing model segments"),
        )
        .expect("write missing model segments");
        let mut server = FakeServer::start(FakeResponseMode::Valid, false, "available-model");
        let base_url = format!("http://127.0.0.1:{}", server.address.port());
        let python = std::env::var("PYTHON").unwrap_or_else(|_| "python".to_string());
        let cli = repo.join("python_sidecar").join("overall_proofread_cli.py");
        let output = Command::new(python)
            .current_dir(repo)
            .arg(&cli)
            .arg("--segments-json-path")
            .arg(&input_path)
            .arg("--backend")
            .arg("openai_compatible")
            .arg("--openai-base-url")
            .arg(&base_url)
            .arg("--openai-model")
            .arg("missing-model")
            .output()
            .expect("run Python missing-model overall proofreading");
        assert!(!output.status.success());
        let python_json: Value =
            serde_json::from_slice(&output.stdout).expect("parse Python missing-model output");
        server.set_phase(1);
        let emitter = Emitter::new(|_| {});
        let rust_error = proofread(
            &segments,
            Options {
                base_url: base_url.clone(),
                model: "missing-model".to_string(),
                provider_label: "ローカルOpenAI互換API".to_string(),
                system_prompt: None,
                prompt_type: "gemma4".to_string(),
                parallel: 1,
                require_model_list: false,
                fallback_to_first_model: false,
                extra_payload: None,
                prompt_templates_dir: None,
            },
            &emitter,
            Arc::new(|| false),
        )
        .expect_err("missing model should fail");
        let python_message = python_json
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .expect("Python missing-model error message");
        assert_eq!(python_message, rust_error);
        server.stop();
        let requests = server
            .requests
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        assert!(
            requests.is_empty(),
            "missing model must not send chat requests"
        );
        assert_eq!(server.model_requests[0].load(Ordering::SeqCst), 1);
        assert_eq!(server.model_requests[1].load(Ordering::SeqCst), 1);
        let _ = std::fs::remove_file(input_path);
    }
}
