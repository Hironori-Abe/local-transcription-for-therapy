//! ggml 音声エンジン（whisper.cpp による文字起こし / NeMo-Speech.cpp + Nemotron-3-Diarization
//! による話者分離）のうち、AppHandle に依存しない処理をまとめる。
//!
//! 出力は既存の Python サイドカー（transcribe_cli.py / diarize_cli.py）と同じ JSON 形式に揃え、
//! 呼び出し側（lib.rs）の後続処理（話者割り当て・エラー処理・フロント表示）をそのまま使えるようにする。
//! 設計は docs/ggml-speech-engine-design.md を参照。

use regex::Regex;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// 文字起こし・話者分離に使うエンジン。既定は従来の Python 経路。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SpeechEngine {
    Standard,
    Ggml,
}

impl SpeechEngine {
    pub(crate) fn parse(value: Option<&str>) -> Self {
        match value.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
            Some("ggml") => SpeechEngine::Ggml,
            _ => SpeechEngine::Standard,
        }
    }
}

pub(crate) const WHISPER_MODELS_SUBDIR: &str = "whisper-ggml";
pub(crate) const VAD_MODEL_FILE: &str = "ggml-silero-v6.2.0.bin";
pub(crate) const DIAR_MODELS_SUBDIR: &str = "nemotron-3-diarization";
pub(crate) const DIAR_MODEL_FILE: &str = "Nemotron-3-Diarization.q8_0.gguf";

/// VAD はアプリ既定（faster-whisper の vad_parameters）と同じ値を明示する。
/// whisper.cpp の既定値（speech_pad 30ms など）は faster-whisper と異なるため省略しない。
const VAD_THRESHOLD: &str = "0.5";
const VAD_MIN_SPEECH_MS: &str = "200";
const VAD_MIN_SILENCE_MS: &str = "800";
const VAD_SPEECH_PAD_MS: &str = "400";

/// 探索幅（beam / best-of）。transcribe_cli.py の通常時と同じ 3 に固定する。
/// faster-whisper の長尺安定モード（1/1）は CTranslate2 の VRAM 対策であり、whisper.cpp では不要。
/// さらに whisper.cpp の貪欲探索（1）は、窓の途中で単独タイムスタンプを出して終わると
/// Whisper の仕様どおり 30 秒の窓を丸ごと進めるため、発話が欠落することがある
/// （10分音声の冒頭 1.9〜30.6 秒が消えるのを確認。beam 3 では起きない）。
pub(crate) const WHISPER_BEAM_SIZE: u32 = 3;

/// 話者分離の短区間除去・結合（diarize_cli.py の filter_short_segments と同じ値）。
const DIAR_MIN_DURATION_SECONDS: f64 = 0.3;
const DIAR_MERGE_GAP_SECONDS: f64 = 0.5;

fn exe_name(base: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

/// UI のモデル名を ggml モデルファイル名へ対応付ける。
pub(crate) fn whisper_model_file(model: &str) -> Option<&'static str> {
    match model.trim().to_ascii_lowercase().as_str() {
        "turbo" | "large-v3-turbo" => Some("ggml-large-v3-turbo.bin"),
        "large-v3" => Some("ggml-large-v3.bin"),
        _ => None,
    }
}

/// ggml エンジンの実行に必要なファイル一式。
#[derive(Clone, Debug)]
pub(crate) struct GgmlSpeechPaths {
    pub whisper_cli: PathBuf,
    pub vad_model: PathBuf,
    pub whisper_models_dir: PathBuf,
    pub nemo_speech: PathBuf,
    pub diar_model: PathBuf,
}

impl GgmlSpeechPaths {
    /// `engines_root` / `models_root` から既定の配置を組み立てる。
    /// 環境変数（LOTT_WHISPER_CPP_BIN / LOTT_NEMO_SPEECH_BIN / LOTT_GGML_WHISPER_MODELS_DIR /
    /// LOTT_NEMOTRON_DIAR_MODEL）があればそちらを優先する（開発・検証用）。
    pub(crate) fn resolve(engines_root: &Path, models_root: &Path) -> Self {
        let from_env = |key: &str| {
            env::var_os(key)
                .filter(|v| !v.is_empty())
                .map(PathBuf::from)
        };
        let whisper_models_dir = from_env("LOTT_GGML_WHISPER_MODELS_DIR")
            .unwrap_or_else(|| models_root.join(WHISPER_MODELS_SUBDIR));
        Self {
            whisper_cli: from_env("LOTT_WHISPER_CPP_BIN").unwrap_or_else(|| {
                engines_root
                    .join("whisper")
                    .join("bin")
                    .join(exe_name("whisper-cli"))
            }),
            vad_model: whisper_models_dir.join(VAD_MODEL_FILE),
            whisper_models_dir,
            nemo_speech: from_env("LOTT_NEMO_SPEECH_BIN").unwrap_or_else(|| {
                engines_root
                    .join("nemo")
                    .join("bin")
                    .join(exe_name("nemo-speech"))
            }),
            diar_model: from_env("LOTT_NEMOTRON_DIAR_MODEL")
                .unwrap_or_else(|| models_root.join(DIAR_MODELS_SUBDIR).join(DIAR_MODEL_FILE)),
        }
    }

    pub(crate) fn whisper_model(&self, model: &str) -> Option<PathBuf> {
        whisper_model_file(model).map(|f| self.whisper_models_dir.join(f))
    }

    /// 文字起こしに必要なファイルのうち、見つからないものを返す。
    pub(crate) fn missing_for_transcription(&self, model: &str) -> Vec<String> {
        let mut missing = Vec::new();
        if !self.whisper_cli.is_file() {
            missing.push(format!("whisper-cli: {}", self.whisper_cli.display()));
        }
        match self.whisper_model(model) {
            Some(p) if p.is_file() => {}
            Some(p) => missing.push(format!("Whisper モデル: {}", p.display())),
            None => missing.push(format!("ggml エンジンが対応していないモデルです: {model}")),
        }
        if !self.vad_model.is_file() {
            missing.push(format!("VAD モデル: {}", self.vad_model.display()));
        }
        missing
    }

    /// 話者分離に必要なファイルのうち、見つからないものを返す。
    pub(crate) fn missing_for_diarization(&self) -> Vec<String> {
        let mut missing = Vec::new();
        if !self.nemo_speech.is_file() {
            missing.push(format!("nemo-speech: {}", self.nemo_speech.display()));
        }
        if !self.diar_model.is_file() {
            missing.push(format!("話者分離モデル: {}", self.diar_model.display()));
        }
        missing
    }
}

/// whisper-cli に渡す引数を組み立てる（入力 WAV と出力先は一時ディレクトリ内の中立な名前）。
#[allow(clippy::too_many_arguments)]
pub(crate) fn whisper_cli_args(
    model_path: &Path,
    vad_model_path: &Path,
    wav_path: &Path,
    output_prefix: &Path,
    language: &str,
    use_gpu: bool,
    threads: usize,
) -> Vec<OsString> {
    let beam = WHISPER_BEAM_SIZE.to_string();
    let mut args: Vec<OsString> = vec![
        "-m".into(),
        model_path.into(),
        "-f".into(),
        wav_path.into(),
        "-l".into(),
        language.into(),
        "-t".into(),
        threads.max(1).to_string().into(),
        "-bs".into(),
        beam.clone().into(),
        "-bo".into(),
        beam.into(),
        // condition_on_previous_text=False 相当。直前テキストの引き継ぎによる雪崩型ハルシネーションを防ぐ。
        "-mc".into(),
        "0".into(),
        "-lpt".into(),
        "-1.0".into(),
        "--vad".into(),
        "-vm".into(),
        vad_model_path.into(),
        "-vt".into(),
        VAD_THRESHOLD.into(),
        "-vspd".into(),
        VAD_MIN_SPEECH_MS.into(),
        "-vsd".into(),
        VAD_MIN_SILENCE_MS.into(),
        "-vp".into(),
        VAD_SPEECH_PAD_MS.into(),
        "-oj".into(),
        "-of".into(),
        output_prefix.into(),
        "-np".into(),
        "-pp".into(),
    ];
    if !use_gpu {
        args.push("-ng".into());
    }
    args
}

/// whisper-cli の `-pp` 出力（`...: progress =  42%`）から進捗率を取り出す。
pub(crate) fn parse_whisper_progress(line: &str) -> Option<u32> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"progress\s*=\s*(\d{1,3})%").expect("valid regex"));
    re.captures(line)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<u32>().ok())
        .map(|v| v.min(100))
}

/// whisper-cli の JSON（`-oj`）を transcribe_cli.py と同じ `segments` / `text` へ変換する。
/// 明らかなハルシネーションの行は transcribe_cli.py と同じ基準で除外する。
pub(crate) fn convert_whisper_output(
    output: &Value,
    language: &str,
) -> Result<(Vec<Value>, String), String> {
    let items = output
        .get("transcription")
        .and_then(Value::as_array)
        .ok_or_else(|| "whisper.cpp の出力に transcription がありません。".to_string())?;
    let mut segments = Vec::with_capacity(items.len());
    let mut text = String::new();
    for item in items {
        let raw = item.get("text").and_then(Value::as_str).unwrap_or("");
        let segment_text = raw.trim();
        let offsets = item.get("offsets");
        let start_ms = offsets
            .and_then(|o| o.get("from"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let end_ms = offsets
            .and_then(|o| o.get("to"))
            .and_then(Value::as_f64)
            .unwrap_or(start_ms);
        let start = start_ms / 1000.0;
        let end = (end_ms / 1000.0).max(start);
        if is_likely_hallucination(segment_text, language, end - start) {
            continue;
        }
        text.push_str(segment_text);
        segments.push(json!({
            "id": segments.len(),
            "start": start,
            "end": end,
            "text": segment_text,
            "speaker": Value::Null,
        }));
    }
    Ok((segments, text))
}

/// transcribe_cli.py `_is_likely_hallucination` の移植。language=ja のときだけ判定する。
pub(crate) fn is_likely_hallucination(text: &str, language: &str, duration: f64) -> bool {
    if language != "ja" {
        return false;
    }
    let t = text.trim();
    let chars: Vec<char> = t.chars().collect();
    if chars.is_empty() || chars.len() == 1 {
        return true;
    }
    if !chars.iter().any(|c| c.is_alphabetic() || c.is_numeric()) {
        return true;
    }
    if chars
        .iter()
        .any(|&c| ('\u{25A0}'..='\u{27BF}').contains(&c) || c == '\u{FFFD}')
    {
        return true;
    }
    if chars.iter().filter(|&&c| c == '«' || c == '»').count() >= 3 {
        return true;
    }
    let alpha: Vec<char> = chars
        .iter()
        .copied()
        .filter(|c| c.is_alphabetic())
        .collect();
    if alpha.is_empty() {
        let non_digit_non_space = chars
            .iter()
            .any(|&c| !c.is_numeric() && c != ' ' && c != '\u{3000}');
        return non_digit_non_space || chars.len() > 5;
    }
    if chars.iter().any(|&c| {
        ('\u{0400}'..='\u{04FF}').contains(&c)
            || ('\u{0600}'..='\u{06FF}').contains(&c)
            || ('\u{AC00}'..='\u{D7AF}').contains(&c)
            || ('\u{1100}'..='\u{11FF}').contains(&c)
    }) {
        return true;
    }
    let cjk = alpha.iter().filter(|&&c| (c as u32) > 0x2E7F).count();
    let non_cjk = alpha.len() - cjk;
    if cjk > 0 {
        if alpha.len() == 1 && chars.len() > 3 {
            return true;
        }
        if non_cjk > 0 && (non_cjk as f64) / (alpha.len() as f64) > 0.5 {
            return true;
        }
        let distinct: HashSet<char> = alpha.iter().copied().collect();
        if distinct.len() == 1 && alpha.len() >= 3 {
            return true;
        }
        static KATAKANA_RUN: OnceLock<Regex> = OnceLock::new();
        let re = KATAKANA_RUN
            .get_or_init(|| Regex::new(r"[ア-ン] [ア-ン] [ア-ン]").expect("valid regex"));
        return re.is_match(t);
    }
    if alpha.len() <= 8 {
        return true;
    }
    let len = chars.len();
    if len <= 5 || (duration >= 6.0 && len <= 30) {
        return true;
    }
    let ratio = |ch: char| chars.iter().filter(|&&c| c == ch).count() as f64 / len as f64;
    if len > 10 && ratio(',') > 0.12 {
        return true;
    }
    if len > 10 && ratio('.') > 0.15 {
        return true;
    }
    static DOTTED: OnceLock<Regex> = OnceLock::new();
    let dotted = DOTTED.get_or_init(|| Regex::new(r"([A-Za-z]\.){3,}").expect("valid regex"));
    if dotted.is_match(t) {
        return true;
    }
    len > 10 && ratio('-') > 0.20
}

/// nemo-speech diarize の JSON 出力の1区間。speaker は1始まりの登場順チャンネル番号。
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct DiarTurn {
    pub start: f64,
    pub end: f64,
    pub speaker: i64,
}

pub(crate) fn parse_nemo_diarization(output: &Value) -> Result<Vec<DiarTurn>, String> {
    let items = output
        .get("segments")
        .and_then(Value::as_array)
        .ok_or_else(|| "NeMo-Speech.cpp の出力に segments がありません。".to_string())?;
    Ok(items
        .iter()
        .filter_map(|item| {
            let start = item.get("start")?.as_f64()?;
            let end = item.get("end")?.as_f64()?;
            let speaker = item.get("speaker")?.as_i64()?;
            (end > start).then_some(DiarTurn {
                start,
                end,
                speaker,
            })
        })
        .collect())
}

/// Nemotron の区間を現行の話者分離結果（`SPEAKER_00` 形式）へ整える。
///
/// 1. 合計発話時間の上位 `max_speakers` 人だけを残す（Nemotron は話者数を指定できないため）
/// 2. 0.3 秒未満の区間を除き、同じ話者の 0.5 秒以内の区間を結合する
/// 3. 最初に話した順に SPEAKER_00, SPEAKER_01, … を振り直す（表示名の既定値 Th / Cl と対応させる）
///
/// 重なり区間は残す。文字起こしの行への割り当ては重なり最大の話者を採るため、
/// PoC では重なりを除くより一致率が高かった（docs/ggml-speech-engine-design.md）。
/// 話者ごとの発話時間（summary）だけは重なりを除いて集計する。
pub(crate) fn postprocess_diarization(
    turns: &[DiarTurn],
    max_speakers: usize,
) -> (Vec<Value>, Value) {
    let mut totals: HashMap<i64, f64> = HashMap::new();
    for t in turns {
        *totals.entry(t.speaker).or_default() += t.end - t.start;
    }
    let mut ranked: Vec<(i64, f64)> = totals.into_iter().collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    let keep: HashSet<i64> = ranked
        .iter()
        .take(max_speakers.max(1))
        .map(|(s, _)| *s)
        .collect();

    let mut kept: Vec<DiarTurn> = turns
        .iter()
        .filter(|t| keep.contains(&t.speaker) && t.end - t.start >= DIAR_MIN_DURATION_SECONDS)
        .cloned()
        .collect();
    kept.sort_by(|a, b| a.start.total_cmp(&b.start).then(a.end.total_cmp(&b.end)));
    let mut merged: Vec<DiarTurn> = Vec::with_capacity(kept.len());
    for t in kept {
        if let Some(prev) = merged.last_mut() {
            if prev.speaker == t.speaker && t.start - prev.end <= DIAR_MERGE_GAP_SECONDS {
                prev.end = prev.end.max(t.end);
                continue;
            }
        }
        merged.push(t);
    }

    let mut labels: HashMap<i64, String> = HashMap::new();
    for t in &merged {
        let next = labels.len();
        labels
            .entry(t.speaker)
            .or_insert_with(|| format!("SPEAKER_{next:02}"));
    }
    let segments: Vec<Value> = merged
        .iter()
        .map(|t| {
            json!({
                "start": t.start,
                "end": t.end,
                "speaker": labels[&t.speaker],
            })
        })
        .collect();

    let durations = exclusive_durations(&merged);
    let mut speakers: Vec<(&String, f64)> = labels
        .iter()
        .map(|(spk, label)| (label, durations.get(spk).copied().unwrap_or(0.0)))
        .collect();
    speakers.sort_by(|a, b| a.0.cmp(b.0));
    let summary = json!({
        "speakerCount": speakers.len(),
        "speakers": speakers
            .iter()
            .map(|(label, d)| json!({ "speaker": label, "duration": (d * 1000.0).round() / 1000.0 }))
            .collect::<Vec<_>>(),
    });
    (segments, summary)
}

/// 重なり区間を「後から話し始めた話者」に帰属させて、話者ごとの発話時間を求める。
fn exclusive_durations(turns: &[DiarTurn]) -> HashMap<i64, f64> {
    let mut points: Vec<f64> = turns.iter().flat_map(|t| [t.start, t.end]).collect();
    points.sort_by(f64::total_cmp);
    points.dedup();
    let mut out: HashMap<i64, f64> = HashMap::new();
    for w in points.windows(2) {
        let (a, b) = (w[0], w[1]);
        if let Some(owner) = turns
            .iter()
            .filter(|t| t.start <= a && t.end >= b)
            .max_by(|x, y| x.start.total_cmp(&y.start))
        {
            *out.entry(owner.speaker).or_default() += b - a;
        }
    }
    out
}

/// 出力の末尾だけを残す（エラー表示用）。
pub(crate) fn tail_chars(text: &str, max_chars: usize) -> String {
    let count = text.chars().count();
    if count <= max_chars {
        return text.to_string();
    }
    text.chars().skip(count - max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_parse_defaults_to_standard() {
        assert_eq!(SpeechEngine::parse(None), SpeechEngine::Standard);
        assert_eq!(
            SpeechEngine::parse(Some("standard")),
            SpeechEngine::Standard
        );
        assert_eq!(SpeechEngine::parse(Some("unknown")), SpeechEngine::Standard);
        assert_eq!(SpeechEngine::parse(Some(" GGML ")), SpeechEngine::Ggml);
    }

    #[test]
    fn model_file_mapping() {
        assert_eq!(whisper_model_file("turbo"), Some("ggml-large-v3-turbo.bin"));
        assert_eq!(whisper_model_file("large-v3"), Some("ggml-large-v3.bin"));
        assert_eq!(whisper_model_file("medium"), None);
    }

    #[test]
    fn whisper_args_match_app_defaults() {
        let args = whisper_cli_args(
            Path::new("/m/model.bin"),
            Path::new("/m/vad.bin"),
            Path::new("/t/in.wav"),
            Path::new("/t/out"),
            "ja",
            true,
            8,
        );
        let joined: Vec<String> = args
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let joined = joined.join(" ");
        assert!(joined.contains("-bs 3 -bo 3"));
        assert!(joined.contains("-mc 0"));
        assert!(joined.contains("--vad -vm /m/vad.bin -vt 0.5 -vspd 200 -vsd 800 -vp 400"));
        assert!(!joined.contains("-ng"));
        assert!(!joined.contains("--prompt"));

        let cpu = whisper_cli_args(
            Path::new("m"),
            Path::new("v"),
            Path::new("i"),
            Path::new("o"),
            "ja",
            false,
            0,
        );
        let s: Vec<String> = cpu
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let s = s.join(" ");
        assert!(s.contains("-bs 3 -bo 3"));
        assert!(s.contains("-t 1"));
        assert!(s.ends_with("-ng"));
    }

    #[test]
    fn progress_parsing() {
        assert_eq!(
            parse_whisper_progress("whisper_print_progress_callback: progress =  42%"),
            Some(42)
        );
        assert_eq!(parse_whisper_progress("progress = 100%"), Some(100));
        assert_eq!(parse_whisper_progress("whisper_init_from_file"), None);
    }

    #[test]
    fn converts_whisper_json_and_drops_hallucinations() {
        let raw = json!({
            "transcription": [
                {"offsets": {"from": 0, "to": 1940}, "text": " 日本語雑談"},
                {"offsets": {"from": 1940, "to": 3680}, "text": "こんにちは"},
                {"offsets": {"from": 3680, "to": 4000}, "text": "。"},
                {"offsets": {"from": 4000, "to": 5000}, "text": "ううう"},
            ]
        });
        let (segments, text) = convert_whisper_output(&raw, "ja").unwrap();
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[1]["id"], 1);
        assert_eq!(segments[1]["start"], 1.94);
        assert_eq!(segments[1]["end"], 3.68);
        assert_eq!(segments[1]["text"], "こんにちは");
        assert!(segments[0]["speaker"].is_null());
        assert_eq!(text, "日本語雑談こんにちは");
    }

    #[test]
    fn hallucination_rules_follow_python() {
        let h = |t: &str| is_likely_hallucination(t, "ja", 1.0);
        assert!(h(""));
        assert!(h("あ"));
        assert!(h("、、、"));
        assert!(h("白白白"));
        assert!(h("Спасибо"));
        assert!(h("ノ ノ ア モ ノ"));
        assert!(h("突 yeter"));
        assert!(h("privat"));
        assert!(h(". 0 0 0.0."));
        assert!(!h("そうですね"));
        assert!(!h("2003"));
        assert!(!h("SSRIを飲んでいます"));
        assert!(!is_likely_hallucination("privat", "en", 1.0));
    }

    fn turn(start: f64, end: f64, speaker: i64) -> DiarTurn {
        DiarTurn {
            start,
            end,
            speaker,
        }
    }

    #[test]
    fn diarization_keeps_top_speakers_and_relabels_by_first_turn() {
        // 話者3が最初に話し、話者2が最長。話者1・4はごく短いノイズ。
        let turns = vec![
            turn(0.0, 2.0, 1),
            turn(1.0, 10.0, 3),
            turn(10.2, 30.0, 2),
            turn(30.5, 40.0, 3),
            turn(35.0, 35.2, 4),
        ];
        let (segments, summary) = postprocess_diarization(&turns, 2);
        let speakers: Vec<&str> = segments
            .iter()
            .map(|s| s["speaker"].as_str().unwrap())
            .collect();
        assert_eq!(speakers, vec!["SPEAKER_00", "SPEAKER_01", "SPEAKER_00"]);
        assert_eq!(summary["speakerCount"], 2);
    }

    #[test]
    fn diarization_filters_short_and_merges_close_turns() {
        let turns = vec![
            turn(0.0, 1.0, 1),
            turn(1.3, 2.0, 1), // 0.3秒の間 → 結合
            turn(2.1, 2.3, 2), // 0.2秒 → 除去
            turn(3.0, 4.0, 1), // 1.0秒の間 → 別区間
        ];
        let (segments, _) = postprocess_diarization(&turns, 5);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0]["end"], 2.0);
        assert_eq!(segments[1]["start"], 3.0);
    }

    #[test]
    fn summary_counts_overlap_once() {
        // 0-10 話者1、4-6 話者2（割り込み）。重なり 2 秒は話者2に帰属。
        let turns = vec![turn(0.0, 10.0, 1), turn(4.0, 6.0, 2)];
        let (segments, summary) = postprocess_diarization(&turns, 2);
        assert_eq!(segments.len(), 2);
        let durations: Vec<f64> = summary["speakers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["duration"].as_f64().unwrap())
            .collect();
        assert_eq!(durations, vec![8.0, 2.0]);
    }

    #[test]
    fn parses_nemo_output() {
        let raw = json!({"segments": [
            {"start": 0.051, "end": 2.109, "speaker": 1},
            {"start": 3.0, "end": 3.0, "speaker": 2},
            {"start": 4.691, "end": 19.599, "speaker": 3}
        ]});
        let turns = parse_nemo_diarization(&raw).unwrap();
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[1], turn(4.691, 19.599, 3));
    }

    /// 実物の whisper-cli / nemo-speech を、アプリと同じ引数・同じ変換処理で動かす結合テスト。
    /// `scripts/setup-ggml-speech-linux.sh` 実行後に、16kHz mono WAV を指定して走らせる:
    ///   LOTT_GGML_TEST_WAV=/path/to/audio.wav cargo test --lib real_engines -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_engines_end_to_end() {
        use std::process::Command;
        let Some(wav) = env::var_os("LOTT_GGML_TEST_WAV").map(PathBuf::from) else {
            eprintln!("LOTT_GGML_TEST_WAV が未設定のためスキップ");
            return;
        };
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../python_sidecar");
        let paths = GgmlSpeechPaths::resolve(&base.join("speech-engines"), &base.join("models"));
        assert!(
            paths.missing_for_transcription("turbo").is_empty(),
            "{:?}",
            paths.missing_for_transcription("turbo")
        );
        assert!(
            paths.missing_for_diarization().is_empty(),
            "{:?}",
            paths.missing_for_diarization()
        );
        let tmp = env::temp_dir().join(format!("lott-ggml-test-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();

        let started = std::time::Instant::now();
        let out_prefix = tmp.join("asr");
        let status = Command::new(&paths.whisper_cli)
            .args(whisper_cli_args(
                &paths.whisper_model("turbo").unwrap(),
                &paths.vad_model,
                &wav,
                &out_prefix,
                "ja",
                true,
                8,
            ))
            .status()
            .unwrap();
        assert!(status.success());
        let asr: Value = serde_json::from_str(
            &std::fs::read_to_string(out_prefix.with_extension("json")).unwrap(),
        )
        .unwrap();
        let (segments, text) = convert_whisper_output(&asr, "ja").unwrap();
        eprintln!(
            "whisper.cpp: {} segments, {} chars, {:.1}s",
            segments.len(),
            text.chars().count(),
            started.elapsed().as_secs_f64()
        );
        assert!(!segments.is_empty());

        let started = std::time::Instant::now();
        let diar_out = tmp.join("diar.json");
        let status = Command::new(&paths.nemo_speech)
            .arg("diarize")
            .arg(&wav)
            .arg("--model")
            .arg(&paths.diar_model)
            .arg("--device")
            .arg(env::var("LOTT_NEMO_SPEECH_DEVICE").unwrap_or_else(|_| "auto".into()))
            .args(["--format", "json", "-o"])
            .arg(&diar_out)
            .arg("--force")
            .status()
            .unwrap();
        assert!(status.success());
        let diar: Value =
            serde_json::from_str(&std::fs::read_to_string(&diar_out).unwrap()).unwrap();
        let turns = parse_nemo_diarization(&diar).unwrap();
        let (diar_segments, summary) = postprocess_diarization(&turns, 2);
        eprintln!(
            "nemotron: {} turns -> {} segments, {:.1}s, summary={summary}",
            turns.len(),
            diar_segments.len(),
            started.elapsed().as_secs_f64()
        );
        assert_eq!(summary["speakerCount"], 2);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn tail_keeps_last_chars() {
        assert_eq!(tail_chars("あいうえお", 2), "えお");
        assert_eq!(tail_chars("abc", 10), "abc");
    }
}
