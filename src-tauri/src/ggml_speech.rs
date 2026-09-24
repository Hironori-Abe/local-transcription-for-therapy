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

/// フィラー・相づちを残すための初期プロンプト（毎回の 30 秒窓に付ける）。
/// Whisper は既定でフィラーを省きやすいため、話し言葉の例文で書き起こし方を寄せる。
/// 臨床的な内容（症状・薬など）や固有名詞を含めないこと: 例文中の語が、話されていないのに
/// 出力へ紛れ込むおそれがある（頻出語を入れた検証で「辛いもの」→「自傷」の誤認識を確認）。
/// 検証: demo_data/ggml-poc/README.md「初期プロンプトとフィラーの検証」
/// （公開書き起こしに対しフィラー再現 19%→68%、文字誤り率 18.6%→16.5%）。
pub(crate) const FILLER_PROMPT: &str = "以下は日本語の会話です。 えーとですね、そのー、なんか最近ちょっとバタバタしてて。まー、どうしようかなって思ってて。うーん。あのー、まあ、そうですね、なるほど、うん。";
/// whisper.cpp のトークナイザで数えた FILLER_PROMPT のトークン数（プロンプトを変えたら数え直す:
/// `whisper-cli ... --prompt "<文>" --carry-initial-prompt -mc 3` の警告に表示される）。
/// `-mc` をこの値 + 1 にすると、例文だけを毎回付け、直前テキストは引き継がない
/// （引き継ぎは雪崩型ハルシネーションの原因になるため、アプリでは常に切っている）。
pub(crate) const FILLER_PROMPT_TOKENS: u32 = 55;

/// これより短い行は、隣の同じ話者の行へつなぐ（1秒未満の行は再生しても聞き取れないため）。
const SHORT_ROW_SECONDS: f64 = 1.0;
/// 短い行をつなぐ相手との最大の間隔。
const SHORT_ROW_MERGE_GAP_SECONDS: f64 = 1.0;

/// 行を分けてよい文末の文字。文の途中（単語の途中）では行を分けない。
const SENTENCE_END_CHARS: &[char] = &['。', '？', '！', '?', '!'];

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
    keep_fillers: bool,
    threads: usize,
) -> Vec<OsString> {
    let beam = WHISPER_BEAM_SIZE.to_string();
    // 直前テキストの引き継ぎは常に切る（condition_on_previous_text=False 相当）。
    // フィラーを残す場合は例文だけを毎回付けるため、文脈長を例文のトークン数 + 1 に合わせる。
    let max_context = if keep_fillers {
        (FILLER_PROMPT_TOKENS + 1).to_string()
    } else {
        "0".to_string()
    };
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
        "-mc".into(),
        max_context.into(),
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
    if keep_fillers {
        // 例文を付けるとセグメントが長くまとまるため、話者交代位置で分割できるよう
        // トークン単位の時刻（-ojf）も出力する。
        args.extend(
            ["--prompt", FILLER_PROMPT, "--carry-initial-prompt", "-ojf"].map(OsString::from),
        );
    }
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
    with_words: bool,
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
        let mut segment = json!({
            "id": segments.len(),
            "start": start,
            "end": end,
            "text": segment_text,
            "speaker": Value::Null,
        });
        if with_words {
            let words = segment_words(item, segment_text, start, end);
            if !words.is_empty() {
                segment["words"] = Value::Array(words);
            }
        }
        segments.push(segment);
    }
    Ok((segments, text))
}

/// whisper.cpp の `-ojf` のトークンを `{word, start, end}` へ変換する。
///
/// whisper.cpp は VAD 使用時、セグメントの時刻は元の音声の時間軸へ戻すが、トークンの時刻は
/// 無音を詰めた後の時間軸のまま出力する（10分音声の末尾で約12秒ずれるのを確認）。
/// そのためセグメント内でトークン時刻を [start, end] へ線形に写像し直す。
/// トークンをつないだ文字列がセグメントのテキストと一致しない場合（漢字がバイト断片の
/// トークンに分かれて文字化けした場合など）は空を返し、そのセグメントは分割しない。
fn segment_words(item: &Value, segment_text: &str, start: f64, end: f64) -> Vec<Value> {
    let Some(tokens) = item.get("tokens").and_then(Value::as_array) else {
        return Vec::new();
    };
    let raw: Vec<(&str, f64, f64)> = tokens
        .iter()
        .filter_map(|t| {
            let text = t.get("text")?.as_str()?;
            if text.starts_with("[_") {
                return None; // [_BEG_] / [_TT_n] などの特殊トークン
            }
            let o = t.get("offsets")?;
            let from = o.get("from")?.as_f64()? / 1000.0;
            let to = (o.get("to")?.as_f64()? / 1000.0).max(from);
            Some((text, from, to))
        })
        .collect();
    let joined: String = raw.iter().map(|r| r.0).collect();
    if joined.trim() != segment_text || joined.contains('\u{FFFD}') {
        return Vec::new();
    }
    let (Some(r0), Some(r1)) = (
        raw.iter().map(|r| r.1).reduce(f64::min),
        raw.iter().map(|r| r.2).reduce(f64::max),
    ) else {
        return Vec::new();
    };
    let scale = if r1 > r0 {
        (end - start) / (r1 - r0)
    } else {
        0.0
    };
    raw.into_iter()
        .map(|(text, from, to)| {
            json!({
                "word": text,
                "start": start + (from - r0) * scale,
                "end": start + (to - r0) * scale,
            })
        })
        .collect()
}

/// 話者分離の区間 `{start, end, speaker}` のうち、[t0, t1] と最も重なる話者を返す。
/// 重なりが同じなら短い区間（割り込み・相づち）を優先し、重ならなければ最も近い区間の話者。
fn speaker_for_span(t0: f64, t1: f64, diar: &[(f64, f64, String)]) -> Option<String> {
    let mut best: Option<(f64, f64, &str)> = None; // (重なり, 区間長, 話者)
    for (s, e, spk) in diar {
        let overlap = t1.min(*e) - t0.max(*s);
        if overlap <= 0.0 {
            continue;
        }
        let better = match best {
            None => true,
            Some((bo, blen, _)) => {
                overlap > bo + 1e-6 || ((overlap - bo).abs() <= 1e-6 && e - s < blen)
            }
        };
        if better {
            best = Some((overlap, e - s, spk));
        }
    }
    if let Some((_, _, spk)) = best {
        return Some(spk.to_string());
    }
    let mid = (t0 + t1) / 2.0;
    diar.iter()
        .min_by(|a, b| {
            let da = (a.0 - mid).abs().min((a.1 - mid).abs());
            let db = (b.0 - mid).abs().min((b.1 - mid).abs());
            da.total_cmp(&db)
        })
        .map(|d| d.2.clone())
}

/// (単語, 開始, 終了)
type TimedWord = (String, f64, f64);

/// 単語列を文に分ける。文末記号（。？！）の直後と、空白で始まる単語の直前で区切る。
fn split_into_sentences(words: Vec<TimedWord>) -> Vec<Vec<TimedWord>> {
    let mut sentences: Vec<Vec<TimedWord>> = Vec::new();
    let mut current: Vec<TimedWord> = Vec::new();
    for w in words {
        if !current.is_empty() && w.0.starts_with(char::is_whitespace) {
            sentences.push(std::mem::take(&mut current));
        }
        let ends_sentence = w.0.trim_end().ends_with(SENTENCE_END_CHARS);
        current.push(w);
        if ends_sentence {
            sentences.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        sentences.push(current);
    }
    sentences
}

/// 単語の時刻を持つセグメントを文ごとの行に分け、文ごとに話者を割り当てる。
///
/// フィラー用の例文を付けると Whisper はセグメントを長くまとめ（中央値 2.2 秒→9 秒）、
/// 1行に2人の発話が混ざって行単位の割り当てが崩れる（10分音声で一致率 92.6%→68.8%）。
/// 1文1行にして文ごとに話者を決めると 89.8% まで戻り、行の長さも標準エンジンと同程度
/// （中央値 2.4 秒）になる。
///
/// 単語単位で話者交代位置に切る方式は、トークン時刻の誤差（数百ミリ秒）で単語の途中や
/// 句点だけの行ができ、読めなくなったため採らない（2026-09-25 の画面確認で判明）。
/// 単語の時刻を持つセグメントが無ければ None を返す（従来の行単位の割り当てを使う）。
pub(crate) fn split_segments_by_speaker(
    segments: &[Value],
    diarization_segments: &[Value],
) -> Option<Vec<Value>> {
    let has_words = segments.iter().any(|s| {
        s.get("words")
            .and_then(Value::as_array)
            .is_some_and(|w| !w.is_empty())
    });
    let diar: Vec<(f64, f64, String)> = diarization_segments
        .iter()
        .filter_map(|d| {
            Some((
                d.get("start")?.as_f64()?,
                d.get("end")?.as_f64()?,
                d.get("speaker")?.as_str()?.to_string(),
            ))
        })
        .collect();
    if !has_words || diar.is_empty() {
        return None;
    }

    let mut out: Vec<Value> = Vec::with_capacity(segments.len());
    for seg in segments {
        let start = seg.get("start").and_then(Value::as_f64).unwrap_or(0.0);
        let end = seg.get("end").and_then(Value::as_f64).unwrap_or(start);
        let words: Vec<TimedWord> = seg
            .get("words")
            .and_then(Value::as_array)
            .map(|ws| {
                ws.iter()
                    .filter_map(|w| {
                        Some((
                            w.get("word")?.as_str()?.to_string(),
                            w.get("start")?.as_f64()?,
                            w.get("end")?.as_f64()?,
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default();
        if words.is_empty() {
            let mut kept = seg.clone();
            kept["speaker"] = speaker_for_span(start, end, &diar)
                .map(Value::String)
                .unwrap_or(Value::Null);
            out.push(kept);
            continue;
        }

        let sentences = split_into_sentences(words);
        let n = sentences.len();
        for (i, ws) in sentences.into_iter().enumerate() {
            let text = ws.iter().map(|w| w.0.as_str()).collect::<String>();
            let text = text.trim();
            if text.is_empty() {
                continue;
            }
            let sub_start = if i == 0 { start } else { ws[0].1 };
            let sub_end = if i + 1 == n { end } else { ws[ws.len() - 1].2 }.max(sub_start);
            let speaker = speaker_for_span(sub_start, sub_end.max(sub_start + 0.02), &diar);
            out.push(json!({
                "start": sub_start,
                "end": sub_end,
                "text": text,
                "speaker": speaker.map(Value::String).unwrap_or(Value::Null),
                "words": ws
                    .iter()
                    .map(|w| json!({ "word": w.0, "start": w.1, "end": w.2 }))
                    .collect::<Vec<_>>(),
            }));
        }
    }
    let mut out = merge_short_rows(out);
    for (i, seg) in out.iter_mut().enumerate() {
        seg["id"] = json!(i);
    }
    Some(out)
}

fn row_f64(row: &Value, key: &str) -> f64 {
    row.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

fn is_short_row(row: &Value) -> bool {
    row_f64(row, "end") - row_f64(row, "start") < SHORT_ROW_SECONDS
}

/// `later` を `earlier` の後ろにつないだ行を返す。
fn join_rows(earlier: &Value, later: &Value) -> Value {
    let mut joined = earlier.clone();
    let text = format!(
        "{}{}",
        earlier.get("text").and_then(Value::as_str).unwrap_or(""),
        later.get("text").and_then(Value::as_str).unwrap_or("")
    );
    joined["text"] = Value::String(text);
    joined["start"] = json!(row_f64(earlier, "start").min(row_f64(later, "start")));
    joined["end"] = json!(row_f64(earlier, "end").max(row_f64(later, "end")));
    let mut words = earlier
        .get("words")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    words.extend(
        later
            .get("words")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    );
    joined["words"] = Value::Array(words);
    joined
}

/// 1秒未満の行を、間隔 1 秒以内の同じ話者の前の行（無ければ次の行）へつなぐ。
/// つなげない行（相手の発話中に入った相づちなど）は記録を消さずにそのまま残す。
fn merge_short_rows(rows: Vec<Value>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::with_capacity(rows.len());
    let mut pending: Option<Value> = None; // 次の行の先頭へつなぐ候補
    for mut row in rows {
        if let Some(short) = pending.take() {
            if short["speaker"] == row["speaker"]
                && row_f64(&row, "start") - row_f64(&short, "end") <= SHORT_ROW_MERGE_GAP_SECONDS
            {
                row = join_rows(&short, &row);
            } else {
                out.push(short);
            }
        }
        if is_short_row(&row) {
            if let Some(prev) = out.last_mut() {
                if prev["speaker"] == row["speaker"]
                    && row_f64(&row, "start") - row_f64(prev, "end") <= SHORT_ROW_MERGE_GAP_SECONDS
                {
                    *prev = join_rows(prev, &row);
                    continue;
                }
            }
            pending = Some(row);
            continue;
        }
        out.push(row);
    }
    out.extend(pending);
    out
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
            false,
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
        let (segments, text) = convert_whisper_output(&raw, "ja", false).unwrap();
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
        let (segments, text) = convert_whisper_output(&asr, "ja", true).unwrap();
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
        let split =
            split_segments_by_speaker(&segments, &diar_segments).expect("words があれば分割される");
        eprintln!("speaker split: {} -> {} rows", segments.len(), split.len());
        assert!(split.iter().all(|s| s["speaker"].is_string()));
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
    fn whisper_args_with_fillers_carry_prompt_without_history() {
        let args = whisper_cli_args(
            Path::new("m"),
            Path::new("v"),
            Path::new("i"),
            Path::new("o"),
            "ja",
            true,
            true,
            8,
        );
        let s: Vec<String> = args
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let i = s.iter().position(|a| a == "-mc").unwrap();
        assert_eq!(s[i + 1], (FILLER_PROMPT_TOKENS + 1).to_string());
        assert!(s.contains(&"--carry-initial-prompt".to_string()));
        assert!(s.contains(&"-ojf".to_string()));
        assert!(s.contains(&FILLER_PROMPT.to_string()));
    }

    #[test]
    fn filler_prompt_has_no_clinical_terms() {
        for term in ["眠れ", "薬", "つらく", "死", "病院", "自傷", "頻出語"] {
            assert!(!FILLER_PROMPT.contains(term), "{term}");
        }
    }

    fn whisper_item(text: &str, from: u64, to: u64, tokens: &[(&str, u64, u64)]) -> Value {
        let mut toks = vec![json!({"text": "[_BEG_]", "offsets": {"from": 0, "to": 0}})];
        toks.extend(
            tokens
                .iter()
                .map(|(t, a, b)| json!({"text": t, "offsets": {"from": a, "to": b}})),
        );
        json!({"text": text, "offsets": {"from": from, "to": to}, "tokens": toks})
    }

    #[test]
    fn words_are_remapped_into_segment_range() {
        // VAD で詰めた時間軸のトークン（100〜102秒）を、元の時間軸のセグメント（110〜114秒）へ写像する。
        let raw = json!({"transcription": [whisper_item(
            "そうですね",
            110_000,
            114_000,
            &[("そう", 100_000, 101_000), ("ですね", 101_000, 102_000)],
        )]});
        let (segments, _) = convert_whisper_output(&raw, "ja", true).unwrap();
        let words = segments[0]["words"].as_array().unwrap();
        assert_eq!(words.len(), 2);
        assert_eq!(words[0]["start"], 110.0);
        assert_eq!(words[1]["start"], 112.0);
        assert_eq!(words[1]["end"], 114.0);
        let (plain, _) = convert_whisper_output(&raw, "ja", false).unwrap();
        assert!(plain[0].get("words").is_none());
    }

    #[test]
    fn words_are_dropped_when_tokens_do_not_rebuild_text() {
        let raw = json!({"transcription": [whisper_item(
            "漢字",
            0,
            1_000,
            &[("\u{FFFD}", 0, 500), ("字", 500, 1_000)],
        )]});
        let (segments, _) = convert_whisper_output(&raw, "ja", true).unwrap();
        assert!(segments[0].get("words").is_none());
    }

    fn word(w: &str, a: f64, b: f64) -> Value {
        json!({"word": w, "start": a, "end": b})
    }

    #[test]
    fn splits_long_segment_into_sentences_with_own_speakers() {
        let segments = vec![json!({
            "id": 0, "start": 0.0, "end": 6.0, "text": "そうなんですよ。 あのー、うん。", "speaker": null,
            "words": [
                word("そう", 0.0, 1.0), word("なんです", 1.0, 2.0), word("よ。", 2.0, 3.0),
                word(" あのー", 3.2, 4.5), word("、うん。", 4.5, 6.0),
            ]
        })];
        let diar = vec![
            json!({"start": 0.0, "end": 3.0, "speaker": "SPEAKER_00"}),
            json!({"start": 3.1, "end": 6.0, "speaker": "SPEAKER_01"}),
        ];
        let split = split_segments_by_speaker(&segments, &diar).unwrap();
        assert_eq!(split.len(), 2);
        assert_eq!(split[0]["text"], "そうなんですよ。");
        assert_eq!(split[0]["speaker"], "SPEAKER_00");
        assert_eq!(split[0]["start"], 0.0);
        assert_eq!(split[1]["text"], "あのー、うん。");
        assert_eq!(split[1]["speaker"], "SPEAKER_01");
        assert_eq!(split[1]["end"], 6.0);
        assert_eq!(split[1]["id"], 1);
    }

    #[test]
    fn never_splits_inside_a_sentence() {
        // 文の途中で話者分離の話者が変わっても、単語の途中や文の途中では行を分けない。
        let segments = vec![json!({
            "id": 0, "start": 0.0, "end": 3.0, "text": "言い訳になってしまうかも", "speaker": null,
            "words": [word("言い", 0.0, 1.0), word("訳に", 1.0, 1.5), word("なってしまうかも", 1.5, 3.0)]
        })];
        let diar = vec![
            json!({"start": 0.0, "end": 1.2, "speaker": "SPEAKER_00"}),
            json!({"start": 1.2, "end": 3.0, "speaker": "SPEAKER_01"}),
        ];
        let split = split_segments_by_speaker(&segments, &diar).unwrap();
        assert_eq!(split.len(), 1);
        assert_eq!(split[0]["text"], "言い訳になってしまうかも");
        assert_eq!(split[0]["speaker"], "SPEAKER_01");
    }

    fn row(start: f64, end: f64, speaker: &str, text: &str) -> Value {
        json!({"start": start, "end": end, "speaker": speaker, "text": text, "words": []})
    }

    #[test]
    fn short_rows_join_same_speaker_neighbors_but_are_never_dropped() {
        let rows = vec![
            row(0.0, 3.0, "A", "今日はね。"),
            row(3.2, 3.6, "A", "うん。"), // 前の同じ話者へ
            row(4.0, 4.4, "B", "そう。"), // 前後とも別の話者 → そのまま残す
            row(5.0, 5.3, "A", "で、"),   // 前は別の話者 → 次の同じ話者の先頭へ
            row(5.5, 8.0, "A", "話を戻すと。"),
        ];
        let merged = merge_short_rows(rows);
        let texts: Vec<&str> = merged.iter().map(|r| r["text"].as_str().unwrap()).collect();
        assert_eq!(
            texts,
            vec!["今日はね。うん。", "そう。", "で、話を戻すと。"]
        );
        assert_eq!(merged[0]["end"], 3.6);
        assert_eq!(merged[2]["start"], 5.0);
    }

    #[test]
    fn short_row_is_not_joined_across_a_long_gap() {
        let rows = vec![row(0.0, 3.0, "A", "はい。"), row(5.0, 5.4, "A", "うん。")];
        assert_eq!(merge_short_rows(rows).len(), 2);
    }

    #[test]
    fn segments_without_words_keep_existing_assignment() {
        let segments =
            vec![json!({"id": 0, "start": 0.0, "end": 2.0, "text": "はい", "speaker": null})];
        let diar = vec![json!({"start": 0.0, "end": 2.0, "speaker": "SPEAKER_00"})];
        assert!(split_segments_by_speaker(&segments, &diar).is_none());
    }

    #[test]
    fn tail_keeps_last_chars() {
        assert_eq!(tail_chars("あいうえお", 2), "えお");
        assert_eq!(tail_chars("abc", 10), "abc");
    }
}
