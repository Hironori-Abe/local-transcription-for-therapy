//! Speculative preparation only: Whisper receives no audio until explicit start.
//! The unmodified CLI initializes its model/GPU before blocking on `-f -` stdin.
use super::*;
use std::sync::{mpsc, Condvar, Weak};

const IDLE_TIMEOUT: Duration = Duration::from_secs(120);
static PENDING: Mutex<Option<Arc<Job>>> = Mutex::new(None);

#[derive(Clone, Debug, PartialEq, Eq)]
struct FileStamp {
    path: PathBuf,
    canonical: PathBuf,
    len: u64,
    modified: std::time::SystemTime,
}

impl FileStamp {
    fn read(path: &Path) -> Result<Self, String> {
        let canonical = fs::canonicalize(path).map_err(|_| "準備するファイルが見つかりません。")?;
        let metadata =
            fs::metadata(&canonical).map_err(|_| "準備するファイルを確認できません。")?;
        if !metadata.is_file() {
            return Err("音声・モデルにはファイルを指定してください。".into());
        }
        Ok(Self {
            path: path.to_path_buf(),
            canonical,
            len: metadata.len(),
            modified: metadata
                .modified()
                .map_err(|_| "ファイルの更新日時を確認できません。")?,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Key {
    files: Vec<FileStamp>, // audio, model, VAD, CLI
    device: String,
    model: String,
    language: String,
    gpu_uuid: Option<String>,
    audio_preprocess: String,
    keep_fillers: bool,
}

impl Key {
    pub(super) fn new(
        paths: &GgmlSpeechPaths,
        audio: &str,
        device: &str,
        model: &str,
        language: &str,
        gpu_uuid: Option<&str>,
        audio_preprocess: Option<&str>,
        keep_fillers: bool,
    ) -> Result<Self, String> {
        let model_path = paths
            .whisper_model(model)
            .ok_or("未対応のWhisperモデルです。")?;
        Ok(Self {
            files: [
                Path::new(audio),
                &model_path,
                &paths.vad_model,
                &paths.whisper_cli,
            ]
            .into_iter()
            .map(FileStamp::read)
            .collect::<Result<_, _>>()?,
            device: device.into(),
            model: model.into(),
            language: normalize_transcription_language(Some(language))?,
            gpu_uuid: gpu_uuid.filter(|v| !v.is_empty()).map(str::to_owned),
            audio_preprocess: normalized_audio_preprocess(audio_preprocess).into(),
            keep_fillers,
        })
    }

    fn is_current(&self) -> bool {
        self.files
            .iter()
            .all(|stamp| FileStamp::read(&stamp.path).as_ref() == Ok(stamp))
    }
}

/// Owns a child and drains both pipes even while it waits for start. A cancelled
/// job kills owned Child handles, never a potentially reused cached PID.
struct EngineProcess {
    child: Arc<Mutex<Child>>,
    stdout: Option<thread::JoinHandle<String>>,
    stderr: mpsc::Receiver<String>,
    stderr_thread: Option<thread::JoinHandle<()>>,
}

impl EngineProcess {
    fn spawn(mut cmd: Command, job: Option<&Job>, audio_stdin: bool) -> Result<Self, String> {
        apply_host_command_env(&mut cmd);
        apply_windows_no_window(&mut cmd);
        cmd.stdin(if audio_stdin {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("音声エンジンの起動に失敗しました: {e}"))?;
        assign_to_kill_on_close_job(&child);
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let child = Arc::new(Mutex::new(child));
        let (sender, receiver) = mpsc::channel();
        let process = Self {
            child,
            stdout: Some(thread::spawn(move || {
                let mut buf = String::new();
                if let Some(mut pipe) = stdout {
                    let _ = pipe.read_to_string(&mut buf);
                }
                buf
            })),
            stderr: receiver,
            stderr_thread: Some(thread::spawn(move || {
                if let Some(pipe) = stderr {
                    for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                        if sender.send(line).is_err() {
                            break;
                        }
                    }
                }
            })),
        };
        if let Some(job) = job {
            let mut children = job.children.lock().unwrap();
            children.push(Arc::downgrade(&process.child));
            if job.cancelled.load(Ordering::SeqCst) {
                let _ = process.child.lock().unwrap().kill();
            }
        }
        Ok(process)
    }

    fn finish(&mut self, mut on_line: impl FnMut(&str)) -> Result<SidecarExecResult, String> {
        let mut stderr = String::new();
        for line in &self.stderr {
            on_line(&line);
            stderr.push_str(&line);
            stderr.push('\n');
            if stderr.len() > 256 * 1024 {
                stderr = ggml_speech::tail_chars(&stderr, 64 * 1024);
            }
        }
        let status = self
            .child
            .lock()
            .unwrap()
            .wait()
            .map_err(|e| format!("音声エンジンの終了待機に失敗しました: {e}"))?;
        let stdout = self
            .stdout
            .take()
            .and_then(|handle| handle.join().ok())
            .unwrap_or_default();
        Ok(SidecarExecResult {
            status,
            stdout,
            stderr,
        })
    }
}

impl Drop for EngineProcess {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(handle) = self.stdout.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.stderr_thread.take() {
            let _ = handle.join();
        }
    }
}

pub(super) struct Prepared {
    key: Key,
    process: EngineProcess, // dropped before the private files
    wav: PathBuf,
    pub(super) out_json: PathBuf,
    pub(super) gpu: Option<gpu_select::VulkanDevice>,
    _files: TempFileGuard,
}

impl Prepared {
    fn build(
        app: &AppHandle,
        paths: &GgmlSpeechPaths,
        key: Key,
        job: Option<&Job>,
    ) -> Result<Self, String> {
        let temp_dir = private_llm_temp_dir(app)?;
        Self::build_in(paths, key, temp_dir, job, |key, files| {
            decode_audio_to_private_wav_with_job(
                app,
                key.files[0]
                    .path
                    .to_str()
                    .ok_or("音声のパスを確認できません。")?,
                files,
                audio_preprocess_filter(Some(&key.audio_preprocess)),
                job,
            )
        })
    }

    fn build_in(
        paths: &GgmlSpeechPaths,
        key: Key,
        temp_dir: PathBuf,
        job: Option<&Job>,
        decode: impl FnOnce(&Key, &mut TempFileGuard) -> Result<PathBuf, String>,
    ) -> Result<Self, String> {
        let out_name = private_temp_name("ggml-asr");
        let out_json = temp_dir.join(format!("{out_name}.json"));
        let mut files = TempFileGuard::new();
        files.push(out_json.clone());
        let args = ggml_speech::whisper_cli_args(
            &paths
                .whisper_model(&key.model)
                .ok_or("未対応のWhisperモデルです。")?,
            &paths.vad_model,
            Path::new("-"),
            Path::new(&out_name),
            &key.language,
            key.device != "cpu",
            key.keep_fillers,
            thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4)
                .min(8),
        );
        let mut cmd = Command::new(&paths.whisper_cli);
        cmd.current_dir(&temp_dir);
        if cfg!(windows) {
            let name = format!("{}.args", private_temp_name("ggml-asr-args"));
            let path = temp_dir.join(&name);
            write_private_temp_file(&path, ggml_speech::whisper_response_file(&args)?.as_bytes())?;
            files.push(path);
            cmd.arg(format!("@{name}"));
        } else {
            cmd.args(args);
        }
        let gpu = if key.device != "cpu" {
            apply_ggml_vulkan_device(&mut cmd, paths.whisper_backend(), key.gpu_uuid.as_deref())
        } else {
            None
        };
        // No WAV bytes are sent here. The CLI stops at read_audio_data(stdin),
        // before WAV decoding, VAD, mel features, encoder and decoder.
        let process = EngineProcess::spawn(cmd, job, true)?;
        if job.is_some_and(|j| j.cancelled.load(Ordering::SeqCst)) {
            return Err("事前準備を中止しました。".into());
        }
        let wav = decode(&key, &mut files)?;
        if !key.is_current() {
            return Err("準備中に音声またはモデルが変更されました。".into());
        }
        Ok(Self {
            key,
            process,
            wav,
            out_json,
            gpu,
            _files: files,
        })
    }

    pub(super) fn run(&mut self, on_line: impl FnMut(&str)) -> Result<SidecarExecResult, String> {
        struct PidGuard;
        impl Drop for PidGuard {
            fn drop(&mut self) {
                clear_running_pid(RunningTaskKind::Transcription);
            }
        }
        set_running_pid(
            RunningTaskKind::Transcription,
            self.process.child.lock().unwrap().id(),
        );
        let _pid = PidGuard;
        if TRANSCRIPTION_CANCEL_REQUESTED.load(Ordering::SeqCst) {
            return Ok(ggml_failure_result(
                "文字起こしを中止しました。".into(),
                None,
                String::new(),
            ));
        }
        if !self.key.is_current() {
            return Err("音声またはモデルが変更されました。再度開始してください。".into());
        }
        let mut stdin = self
            .process
            .child
            .lock()
            .unwrap()
            .stdin
            .take()
            .ok_or("Whisperの入力を開けません。")?;
        let input = fs::File::open(&self.wav).map_err(|_| "準備済み音声を開けません。")?;
        // Only called by run_transcription after the explicit user action.
        let copied = std::io::copy(&mut BufReader::new(input), &mut stdin);
        drop(stdin); // EOF releases the upstream stdin reader.
        if copied.is_err() {
            let _ = self.process.child.lock().unwrap().kill();
        }
        self.process.finish(on_line)
    }
}

struct State {
    ready: bool,
    claimed: bool,
    result: Option<Prepared>,
}

pub(super) struct Job {
    key: Key,
    cancelled: AtomicBool,
    children: Mutex<Vec<Weak<Mutex<Child>>>>,
    state: Mutex<State>,
    changed: Condvar,
}

impl Job {
    fn new(key: Key) -> Arc<Self> {
        Arc::new(Self {
            key,
            cancelled: AtomicBool::new(false),
            children: Mutex::new(Vec::new()),
            state: Mutex::new(State {
                ready: false,
                claimed: false,
                result: None,
            }),
            changed: Condvar::new(),
        })
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        for child in self
            .children
            .lock()
            .unwrap()
            .iter()
            .filter_map(Weak::upgrade)
        {
            let _ = child.lock().unwrap().kill();
        }
        self.changed.notify_all();
    }

    fn publish(&self, result: Option<Prepared>, idle_timeout: Duration) {
        let mut state = self.state.lock().unwrap();
        state.ready = true;
        state.result = result;
        self.changed.notify_all();
        let deadline = Instant::now() + idle_timeout;
        while !state.claimed && !self.cancelled.load(Ordering::SeqCst) {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                self.cancel();
                break;
            }
            state = self.changed.wait_timeout(state, remaining).unwrap().0;
        }
        if self.cancelled.load(Ordering::SeqCst) {
            state.result.take();
        }
    }

    fn claim(&self) -> Result<Option<Prepared>, String> {
        let mut state = self.state.lock().unwrap();
        state.claimed = true;
        self.changed.notify_all();
        while !state.ready && !self.cancelled.load(Ordering::SeqCst) {
            if TRANSCRIPTION_CANCEL_REQUESTED.load(Ordering::SeqCst) {
                self.cancel();
            }
            state = self
                .changed
                .wait_timeout(state, Duration::from_millis(100))
                .unwrap()
                .0;
        }
        if TRANSCRIPTION_CANCEL_REQUESTED.load(Ordering::SeqCst) {
            self.cancel();
            return Err("文字起こしを中止しました。".into());
        }
        if self.cancelled.load(Ordering::SeqCst) {
            return Ok(None);
        }
        Ok(state.result.take())
    }
}

pub(super) fn discard() {
    let job = PENDING.lock().unwrap().take();
    if let Some(job) = job {
        job.cancel();
    }
}

pub(super) fn prepare(app: AppHandle, request: RunTranscriptionRequest) -> Result<(), String> {
    discard();
    if is_editor_build(&app)
        || TRANSCRIPTION_ACTIVE.load(Ordering::SeqCst)
        || WHISPER_VOICE_INPUT_ACTIVE.load(Ordering::SeqCst)
        || DIARIZATION_ACTIVE.load(Ordering::SeqCst)
    {
        return Ok(());
    }
    let paths = resolve_ggml_speech_paths(&app)?;
    let device = request.device.as_deref().unwrap_or("cuda");
    if !matches!(device, "cpu" | "cuda") {
        return Err("未対応の実行デバイスです。".into());
    }
    let key = Key::new(
        &paths,
        &request.audio_path,
        device,
        request.model.as_deref().unwrap_or("turbo"),
        request.language.as_deref().unwrap_or("ja"),
        request.ggml_gpu_uuid.as_deref(),
        request.audio_preprocess.as_deref(),
        true,
    )?;
    let job = Job::new(key.clone());
    let old = PENDING.lock().unwrap().replace(Arc::clone(&job));
    if let Some(old) = old {
        old.cancel();
    }
    thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            Prepared::build(&app, &paths, key, Some(&job))
        }))
        .ok()
        .and_then(Result::ok);
        job.publish(result, IDLE_TIMEOUT);
    });
    Ok(())
}

pub(super) fn take(key: &Key) -> Result<Option<Prepared>, String> {
    let job = PENDING.lock().unwrap().take();
    let Some(job) = job else {
        return Ok(None);
    };
    if job.key != *key || !key.is_current() {
        job.cancel();
        return Ok(None);
    }
    let prepared = job.claim()?;
    if prepared.as_ref().is_some_and(|p| {
        !p.key.is_current()
            || p.process
                .child
                .lock()
                .unwrap()
                .try_wait()
                .ok()
                .flatten()
                .is_some()
    }) {
        return Ok(None);
    }
    Ok(prepared)
}

pub(super) fn build_now(
    app: &AppHandle,
    paths: &GgmlSpeechPaths,
    key: Key,
) -> Result<Prepared, String> {
    Prepared::build(app, paths, key, None)
}

/// Track ffmpeg too so reselection/expiry kills both speculative children.
pub(super) fn output_for_job(cmd: Command, job: &Job) -> Result<std::process::Output, String> {
    let mut process = EngineProcess::spawn(cmd, Some(job), false)?;
    let result = process.finish(|_| {})?;
    Ok(std::process::Output {
        status: result.status,
        stdout: result.stdout.into_bytes(),
        stderr: result.stderr.into_bytes(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    static CACHE_TEST_LOCK: Mutex<()> = Mutex::new(());

    struct Fixture {
        dir: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let dir = env::temp_dir().join(private_temp_name("synthetic-preparation-test"));
            fs::create_dir(&dir).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
            }
            Self { dir }
        }
        fn key(&self) -> Key {
            let path = self.dir.join("synthetic-input");
            fs::write(&path, b"synthetic audio placeholder").unwrap();
            Key {
                files: vec![FileStamp::read(&path).unwrap()],
                device: "cpu".into(),
                model: "turbo".into(),
                language: "ja".into(),
                gpu_uuid: None,
                audio_preprocess: "none".into(),
                keep_fillers: true,
            }
        }
        fn command(&self) -> Command {
            let mut cmd = Command::new(env::current_exe().unwrap());
            cmd.args([
                "--exact",
                "speech_preparation::tests::fake_engine_child",
                "--nocapture",
            ])
            .env("LOTT_PREPARATION_TEST_CHILD", &self.dir);
            cmd
        }
        fn await_ready(&self) {
            let deadline = Instant::now() + Duration::from_secs(5);
            while !self.dir.join("ready").exists() {
                assert!(Instant::now() < deadline, "fake child failed to initialize");
                thread::sleep(Duration::from_millis(10));
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn fake_engine_child() {
        let Some(dir) = env::var_os("LOTT_PREPARATION_TEST_CHILD").map(PathBuf::from) else {
            return;
        };
        fs::write(dir.join("ready"), b"initialized").unwrap();
        let mut input = Vec::new();
        std::io::stdin().read_to_end(&mut input).unwrap();
        fs::write(dir.join("received"), &input).unwrap();
    }

    #[test]
    fn child_receives_nothing_until_explicit_audio_and_eof() {
        let fixture = Fixture::new();
        let mut process = EngineProcess::spawn(fixture.command(), None, true).unwrap();
        fixture.await_ready();
        assert!(!fixture.dir.join("received").exists());
        assert!(process.child.lock().unwrap().try_wait().unwrap().is_none());
        let mut stdin = process.child.lock().unwrap().stdin.take().unwrap();
        stdin.write_all(b"synthetic WAV bytes").unwrap();
        drop(stdin);
        assert!(process.finish(|_| {}).unwrap().status.success());
        assert_eq!(
            fs::read(fixture.dir.join("received")).unwrap(),
            b"synthetic WAV bytes"
        );
    }

    #[test]
    fn cancellation_kills_owned_child_and_reaps_it_without_sending_audio() {
        let fixture = Fixture::new();
        let job = Job::new(fixture.key());
        let mut process = EngineProcess::spawn(fixture.command(), Some(&job), true).unwrap();
        fixture.await_ready();
        job.cancel();
        assert!(!process.finish(|_| {}).unwrap().status.success());
        assert!(process.child.lock().unwrap().try_wait().unwrap().is_some());
        assert!(!fixture.dir.join("received").exists());
    }

    #[test]
    fn replacement_and_settings_invalidate_preparation() {
        let fixture = Fixture::new();
        let key = fixture.key();
        assert!(key.is_current());
        for replacement in ["language", "device", "gpu", "filter", "model"] {
            let mut changed = key.clone();
            match replacement {
                "language" => changed.language = "en".into(),
                "device" => changed.device = "cuda".into(),
                "gpu" => changed.gpu_uuid = Some("another GPU".into()),
                "filter" => changed.audio_preprocess = "low_noise".into(),
                _ => changed.model = "large-v3".into(),
            }
            assert_ne!(key, changed);
        }
        fs::write(&key.files[0].path, b"replacement with different size").unwrap();
        assert!(!key.is_current());
    }

    #[test]
    fn idle_job_expires_and_failed_preparation_can_be_claimed_without_waiting() {
        let fixture = Fixture::new();
        let job = Job::new(fixture.key());
        job.publish(None, Duration::from_millis(1));
        assert!(job.cancelled.load(Ordering::SeqCst));
        assert!(job.claim().unwrap().is_none());
        let failed = Job::new(fixture.key());
        failed.state.lock().unwrap().claimed = true;
        failed.publish(None, Duration::from_secs(120));
        assert!(failed.claim().unwrap().is_none());
    }

    #[test]
    fn expiry_reaps_waiting_process_and_removes_private_wav() {
        let fixture = Fixture::new();
        let key = fixture.key();
        let job = Job::new(key.clone());
        let process = EngineProcess::spawn(fixture.command(), Some(&job), true).unwrap();
        fixture.await_ready();
        let child = Arc::clone(&process.child);
        let wav = fixture.dir.join("decoded.wav");
        write_private_temp_file(&wav, b"synthetic decoded bytes").unwrap();
        let mut files = TempFileGuard::new();
        files.push(wav.clone());
        let prepared = Prepared {
            key,
            process,
            wav: wav.clone(),
            out_json: fixture.dir.join("result.json"),
            gpu: None,
            _files: files,
        };
        job.publish(Some(prepared), Duration::from_millis(1));
        assert!(child.lock().unwrap().try_wait().unwrap().is_some());
        assert!(!wav.exists());
        assert!(!fixture.dir.join("received").exists());
    }

    #[test]
    fn taking_mismatched_settings_cancels_the_cached_process() {
        let _cache = CACHE_TEST_LOCK.lock().unwrap();
        let fixture = Fixture::new();
        let key = fixture.key();
        let job = Job::new(key.clone());
        let mut process = EngineProcess::spawn(fixture.command(), Some(&job), true).unwrap();
        fixture.await_ready();
        *PENDING.lock().unwrap() = Some(Arc::clone(&job));
        let mut different = key;
        different.audio_preprocess = "volume_boost".into();
        assert!(take(&different).unwrap().is_none());
        assert!(job.cancelled.load(Ordering::SeqCst));
        assert!(!process.finish(|_| {}).unwrap().status.success());
        assert!(!fixture.dir.join("received").exists());
    }

    #[test]
    fn matching_cache_reuses_child_and_removes_wav_after_explicit_start() {
        let _cache = CACHE_TEST_LOCK.lock().unwrap();
        let fixture = Fixture::new();
        let key = fixture.key();
        let job = Job::new(key.clone());
        let process = EngineProcess::spawn(fixture.command(), Some(&job), true).unwrap();
        fixture.await_ready();
        let pid = process.child.lock().unwrap().id();
        let wav = fixture.dir.join("decoded.wav");
        write_private_temp_file(&wav, b"synthetic decoded bytes").unwrap();
        let mut files = TempFileGuard::new();
        files.push(wav.clone());
        let prepared = Prepared {
            key: key.clone(),
            process,
            wav: wav.clone(),
            out_json: fixture.dir.join("result.json"),
            gpu: None,
            _files: files,
        };
        *PENDING.lock().unwrap() = Some(Arc::clone(&job));
        let publisher = thread::spawn(move || job.publish(Some(prepared), IDLE_TIMEOUT));
        let mut reused = take(&key).unwrap().expect("prepared process reused");
        publisher.join().unwrap();
        assert_eq!(reused.process.child.lock().unwrap().id(), pid);
        assert!(!fixture.dir.join("received").exists());
        assert!(reused.run(|_| {}).unwrap().status.success());
        assert_eq!(
            fs::read(fixture.dir.join("received")).unwrap(),
            b"synthetic decoded bytes"
        );
        drop(reused);
        assert!(!wav.exists());
    }

    /// Actual unchanged whisper-cli: no result or VAD before start, exact JSON
    /// transcription equality with ordinary file input. Opt-in and offline.
    #[cfg(unix)]
    #[test]
    #[ignore = "requires local models, demo audio, and application private-temp"]
    fn real_whisper_preparation_matches_file_input() {
        #[cfg(target_os = "linux")]
        linux_crash_protection::configure().unwrap();
        let dir = PathBuf::from(env::var_os("LOTT_PREP_TEST_PRIVATE_TEMP").expect("private-temp"));
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(fs::metadata(&dir).unwrap().permissions().mode() & 0o077, 0);
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let models = PathBuf::from(env::var_os("LOTT_PREP_TEST_MODELS").expect("model directory"));
        let audio = env::var("LOTT_PREP_TEST_AUDIO").expect("demo MP3 path");
        let paths = GgmlSpeechPaths {
            whisper_cli: root.join("python_sidecar/speech-engines/whisper/bin/whisper-cli"),
            vad_model: models.join(ggml_speech::VAD_MODEL_FILE),
            whisper_models_dir: models,
            nemo_speech: PathBuf::new(),
            diar_model: PathBuf::new(),
        };
        let key = Key::new(&paths, &audio, "cuda", "turbo", "ja", None, None, true).unwrap();
        let job = Job::new(key.clone());
        let started = Instant::now();
        let mut prepared =
            Prepared::build_in(&paths, key, dir.clone(), Some(&job), |key, files| {
                let wav = dir.join(format!("{}.wav", private_temp_name("prep-test")));
                write_private_temp_file(&wav, b"")?;
                files.push(wav.clone());
                let mut links = TempFileGuard::new();
                let input =
                    prepare_ffmpeg_input_in(&dir, key.files[0].path.to_str().unwrap(), &mut links);
                let mut cmd = Command::new(root.join("src-tauri/resources/ffmpeg/ffmpeg"));
                cmd.args(["-hide_banner", "-loglevel", "error", "-y"])
                    .args(ffmpeg_input_args(&input))
                    .args(["-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav"])
                    .arg(&wav);
                assert!(output_for_job(cmd, &job)?.status.success());
                Ok(wav)
            })
            .unwrap();
        let preparation_seconds = started.elapsed().as_secs_f64();
        thread::sleep(Duration::from_secs(1));
        assert!(
            !prepared.out_json.exists(),
            "no transcript before the user's start"
        );
        assert!(prepared
            .process
            .child
            .lock()
            .unwrap()
            .try_wait()
            .unwrap()
            .is_none());
        let mut waiting_stderr = Vec::new();
        while let Ok(line) = prepared.process.stderr.try_recv() {
            assert!(ggml_speech::parse_whisper_progress(&line).is_none());
            waiting_stderr.push(line);
        }
        let started = Instant::now();
        assert!(prepared.run(|_| {}).unwrap().status.success());
        let run_seconds = started.elapsed().as_secs_f64();
        let piped: Value = serde_json::from_slice(&fs::read(&prepared.out_json).unwrap()).unwrap();
        let out_name = private_temp_name("prep-test-file-input");
        let stock_json = dir.join(format!("{out_name}.json"));
        prepared._files.push(stock_json.clone());
        let args = ggml_speech::whisper_cli_args(
            &paths.whisper_model("turbo").unwrap(),
            &paths.vad_model,
            &prepared.wav,
            Path::new(&out_name),
            "ja",
            true,
            true,
            thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4)
                .min(8),
        );
        let mut cmd = Command::new(&paths.whisper_cli);
        cmd.current_dir(&dir).args(args);
        let stock = EngineProcess::spawn(cmd, None, false)
            .unwrap()
            .finish(|_| {})
            .unwrap();
        assert!(stock.status.success());
        let file_input: Value = serde_json::from_slice(&fs::read(&stock_json).unwrap()).unwrap();
        assert!(
            piped["transcription"] == file_input["transcription"],
            "transcription output differs"
        );
        eprintln!("preparation={preparation_seconds:.3}s, start-to-complete={run_seconds:.3}s, identical {} segments; no audio/progress before start ({} initialization lines)",
            piped["transcription"].as_array().unwrap().len(), waiting_stderr.len());
        let wav = prepared.wav.clone();
        let output = prepared.out_json.clone();
        drop(prepared);
        assert!(!wav.exists() && !output.exists() && !stock_json.exists());
    }
}
