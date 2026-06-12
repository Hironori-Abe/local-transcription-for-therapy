import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import traceback
import types
from pathlib import Path
from typing import Dict, List, Tuple


SIDECAR_DIR = Path(__file__).resolve().parent
TRANSCRIBE_TEMPLATE_DIR = SIDECAR_DIR / "prompt_templates" / "transcribe"
DEFAULT_GLOSSARY_JSON_PATH = TRANSCRIBE_TEMPLATE_DIR / "glossary.json"


def force_utf8_stdio() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def str_to_bool(value: str) -> bool:
    return value.lower() in {"1", "true", "yes", "on"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Offline transcription sidecar")
    parser.add_argument("--audio-path", required=True)
    parser.add_argument("--model", default="turbo")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--compute-type", default="int8_float16")
    parser.add_argument("--language", default="ja")
    parser.add_argument("--vad-filter", default="true")
    parser.add_argument("--word-timestamps", default="false")
    parser.add_argument("--low-memory-mode", default="false")
    parser.add_argument("--initial-prompt", default="")
    parser.add_argument("--glossary-path", default="")
    parser.add_argument("--normalize-audio", default="false")
    parser.add_argument("--highpass-filter", default="false")
    parser.add_argument("--noise-reduction", default="false")
    parser.add_argument("--noise-reduction-mode", default="standard")
    parser.add_argument("--audio-decode-backend", default="")
    return parser.parse_args()


def resolve_glossary_path(cli_value: str) -> Path | None:
    if cli_value.strip():
        return Path(cli_value.strip()).expanduser()
    env_value = os.environ.get("TRANSCRIBE_GLOSSARY_PATH", "").strip()
    if env_value:
        return Path(env_value).expanduser()
    if DEFAULT_GLOSSARY_JSON_PATH.exists():
        return DEFAULT_GLOSSARY_JSON_PATH
    return None


def parse_glossary_json(path: Path) -> Tuple[str, List[str]]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        return "", []

    initial_prompt = str(payload.get("initial_prompt", "")).strip()

    hotwords_raw = payload.get("hotwords")
    hotwords: List[str] = []
    if isinstance(hotwords_raw, list):
        hotwords = [str(v).strip() for v in hotwords_raw if str(v).strip()]

    return initial_prompt, hotwords


def _dedupe(items: List[str]) -> List[str]:
    seen: set = set()
    result: List[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


def load_glossary(path: Path | None) -> Tuple[str, List[str], str]:
    if path is None:
        return "", [], ""
    if not path.exists():
        return "", [], f"用語辞書が見つかりません: {path}"
    try:
        initial_prompt, hotwords = parse_glossary_json(path)
        return initial_prompt, _dedupe(hotwords), ""
    except Exception as exc:
        return "", [], f"用語辞書の読み込みに失敗しました: {exc}"


def merge_initial_prompt(cli_prompt: str, json_prompt: str, hotwords: List[str]) -> str:
    parts = [p.strip() for p in [json_prompt, cli_prompt] if p.strip()]
    if hotwords:
        parts.append("頻出語: " + " ".join(hotwords))
    return "\n".join(parts)


def normalize_noise_reduction_mode(value: str) -> str:
    normalized = (value or "standard").strip().lower()
    if normalized == "weak":
        return "weak"
    return "standard"


def normalize_audio_decode_backend(value: str) -> str:
    # PyAV 経路は廃止。Apache-2.0 配布方針により常に LGPL ffmpeg CLI でデコードする。
    # --audio-decode-backend / LOTT_AUDIO_DECODE_BACKEND は後方互換のため受理するが、
    # 値に関わらず "ffmpeg" に固定する。
    return "ffmpeg"


def install_pyav_import_stub() -> None:
    """Allow faster-whisper to import while this process avoids PyAV at runtime."""
    import importlib.machinery

    av_stub = types.ModuleType("av")

    class InvalidDataError(Exception):
        pass

    av_stub.error = types.SimpleNamespace(InvalidDataError=InvalidDataError)
    av_stub.__lott_stub__ = True
    av_stub.__spec__ = importlib.machinery.ModuleSpec("av", loader=None)
    sys.modules["av"] = av_stub


def no_window_subprocess_kwargs() -> Dict[str, object]:
    if os.name != "nt":
        return {}
    return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)}


def resolve_ffmpeg_bin() -> str | None:
    explicit = os.environ.get("FFMPEG_BIN", "").strip()
    if explicit:
        return explicit

    ffmpeg_bin = shutil.which("ffmpeg")
    if ffmpeg_bin:
        return ffmpeg_bin

    exe_name = "ffmpeg" + (".exe" if os.name == "nt" else "")
    for cand in (SIDECAR_DIR / "ffmpeg" / exe_name, SIDECAR_DIR / "bin" / exe_name):
        if cand.exists():
            return str(cand)
    return None


def decode_audio_with_ffmpeg(audio_path: str, sampling_rate: int = 16000):
    import numpy as np

    ffmpeg_bin = resolve_ffmpeg_bin()
    if not ffmpeg_bin:
        raise RuntimeError(
            "ffmpeg が見つかりません。FFMPEG_BIN または PATH で ffmpeg を指定してください。"
        )

    cmd = [
        ffmpeg_bin,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        audio_path,
        "-map",
        "0:a:0",
        "-vn",
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "-ac",
        "1",
        "-ar",
        str(sampling_rate),
        "pipe:1",
    ]
    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        **no_window_subprocess_kwargs(),
    )
    if proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"ffmpeg による音声デコードに失敗しました: {stderr}")

    audio = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    if audio.size == 0:
        raise RuntimeError("ffmpeg による音声デコード結果が空でした。")
    return audio


def apply_audio_preprocessing(
    audio,
    normalize: bool,
    highpass: bool,
    noise_reduction: bool,
    noise_reduction_mode: str = "standard",
):
    import numpy as np

    audio = np.asarray(audio, dtype=np.float32)
    if not normalize and not highpass and not noise_reduction:
        return audio

    noise_mode = normalize_noise_reduction_mode(noise_reduction_mode)

    if highpass:
        try:
            # Windowed-sinc FIR highpass via overlap-add FFT (numpy only).
            # scipy is intentionally avoided: importing it after CUDA loads
            # causes DLL conflicts on Windows that crash the process.
            hp_taps = 127
            hp_n = len(audio)
            if hp_n >= hp_taps:
                hp_fc = 80.0 / 16000.0  # normalized cutoff (0..0.5)
                hp_k = np.arange(hp_taps, dtype=np.float64) - (hp_taps - 1) / 2
                with np.errstate(divide="ignore", invalid="ignore"):
                    hp_lp = np.where(
                        hp_k == 0.0,
                        2.0 * hp_fc,
                        np.sin(2.0 * np.pi * hp_fc * hp_k) / (np.pi * hp_k),
                    )
                hp_lp = hp_lp * np.hanning(hp_taps)
                hp_lp /= hp_lp.sum()
                hp_h = -hp_lp
                hp_h[hp_taps // 2] += 1.0  # spectral inversion -> highpass
                hp_hop = 1 << 15  # 32768 samples per block (~2 s at 16 kHz)
                hp_nfft = 1 << int(np.ceil(np.log2(hp_hop + hp_taps - 1)))  # 65536
                hp_H = np.fft.rfft(hp_h, n=hp_nfft)
                hp_out = np.zeros(hp_n + hp_taps - 1, dtype=np.float32)
                for hp_s in range(0, hp_n, hp_hop):
                    hp_seg = audio[hp_s: min(hp_s + hp_hop, hp_n)].astype(np.float64)
                    hp_y = np.fft.irfft(np.fft.rfft(hp_seg, n=hp_nfft) * hp_H, n=hp_nfft)
                    hp_e = min(hp_s + hp_nfft, len(hp_out))
                    hp_out[hp_s:hp_e] += hp_y[:hp_e - hp_s].astype(np.float32)
                audio = np.clip(hp_out[:hp_n], -1.0, 1.0)
        except Exception:
            pass

    if noise_reduction:
        try:
            if noise_mode == "weak":
                nr_std_multiplier = 1.0
                nr_mask_power = 1.0
                nr_mask_floor = 0.35
            else:
                nr_std_multiplier = 1.5
                nr_mask_power = 1.5
                nr_mask_floor = 0.20
            # Two-pass spectral gating (numpy only; scipy avoided for DLL safety).
            nr_nfft = 1024
            nr_hop = nr_nfft // 4  # 256, 75 % overlap
            nr_win = np.hanning(nr_nfft).astype(np.float32)
            nr_win_f64 = nr_win.astype(np.float64)
            nr_win_sq = nr_win ** 2
            nr_n = len(audio)

            if nr_n >= nr_nfft * 4:
                nr_total_possible = max(1, (nr_n - nr_nfft) // nr_hop + 1)
                nr_sample_step = max(1, nr_total_possible // 300)
                nr_frames_list: List[np.ndarray] = []
                nr_energies_list: List[float] = []
                nr_p = 0
                nr_fi = 0
                while nr_p + nr_nfft <= nr_n:
                    if nr_fi % nr_sample_step == 0:
                        nr_f = audio[nr_p:nr_p + nr_nfft].astype(np.float64) * nr_win_f64
                        nr_m = np.abs(np.fft.rfft(nr_f))
                        nr_frames_list.append(nr_m)
                        nr_energies_list.append(float(np.mean(nr_m ** 2)))
                    nr_p += nr_hop
                    nr_fi += 1

                if nr_frames_list:
                    nr_e_arr = np.array(nr_energies_list)
                    nr_e_thresh = float(np.percentile(nr_e_arr, 30))
                    nr_quiet = [m for m, e in zip(nr_frames_list, nr_energies_list)
                                if e <= nr_e_thresh]
                    if not nr_quiet:
                        nr_quiet = nr_frames_list
                    nr_stacked = np.array(nr_quiet)
                    nr_mean = nr_stacked.mean(axis=0)
                    nr_std = nr_stacked.std(axis=0)
                    nr_thresh = (nr_mean + nr_std_multiplier * nr_std).astype(np.float32)

                    nr_half = nr_nfft // 2
                    nr_x = np.pad(audio, (nr_half, nr_nfft + nr_hop))
                    nr_total = len(nr_x)
                    nr_out = np.zeros(nr_total, dtype=np.float32)
                    nr_wsq = np.zeros(nr_total, dtype=np.float32)
                    nr_p = 0
                    while nr_p + nr_nfft <= nr_total:
                        nr_f = nr_x[nr_p:nr_p + nr_nfft].astype(np.float64) * nr_win_f64
                        nr_spec = np.fft.rfft(nr_f)
                        nr_m = np.abs(nr_spec).astype(np.float32)
                        nr_mask = np.maximum(
                            np.clip(
                                (nr_m - nr_thresh) / (nr_thresh + 1e-7), 0.0, 1.0
                            ).astype(np.float64) ** nr_mask_power,
                            nr_mask_floor,
                        )
                        nr_fo = np.fft.irfft(nr_spec * nr_mask, n=nr_nfft).astype(np.float32) * nr_win
                        nr_out[nr_p:nr_p + nr_nfft] += nr_fo
                        nr_wsq[nr_p:nr_p + nr_nfft] += nr_win_sq
                        nr_p += nr_hop

                    nr_denom = np.where(nr_wsq > 1e-8, nr_wsq, 1.0)
                    audio = np.clip((nr_out / nr_denom)[nr_half:nr_half + nr_n], -1.0, 1.0)
        except Exception:
            pass

    if normalize:
        rms = float(np.sqrt(np.mean(audio ** 2)))
        if rms > 1e-6:
            target_rms = 0.1  # -20 dBFS
            scale = min(target_rms / rms, 10.0)  # cap at +20 dB
            audio = np.clip(audio * scale, -1.0, 1.0)

    return np.asarray(audio, dtype=np.float32)


def _is_likely_hallucination(text: str, language: str, duration: float) -> bool:
    """language=ja 時、ハルシネーションと判定されるセグメントを除外する。
    - 記号・句読点のみ
    - キリル文字・アラビア文字・ハングル（日本語会話には出現しない）
    - 日本語文字が皆無かつ短いセグメント
    - 非日本語 alpha が 50% 超の混合セグメント（例: "突 yeter"）
    - 同一 CJK 文字の繰り返し（例: "白白白"）
    - ドット密度の高い英語ゴミ（例: "advertised .. ...... .."）
    - 数字+句読点スパム（例: ". 0 0 0.0. 0. 0!"）
    """
    if language != "ja":
        return False
    t = text.strip()
    if not t:
        return True
    # 1文字のみ（単一漢字・単一仮名など）は発話として成立しない
    if len(t) == 1:
        return True
    # 文字（アルファ）も数字も含まない = 句読点・記号のみ → 必ずハルシネーション
    if not any(c.isalpha() or c.isdigit() for c in t):
        return True
    # 幾何学図形・代替文字（◆■●等 U+25A0–U+27BF, U+FFFD）は発話文字起こしに出現しない
    if any('■' <= c <= '➿' or c == '�' for c in t):
        return True
    # 二重山括弧引用符（«»）が3文字以上 = 欧州語ゴミ（"dom « « rear ... « «" 等）
    if t.count('«') + t.count('»') >= 3:
        return True

    alpha_chars = [c for c in t if c.isalpha()]
    if not alpha_chars:
        # 数字のみセグメント:
        # - 句読点・記号が混じる（".00", ". 0 0 0.0." など）→ スパム
        # - 純粋な数字でも長い（6文字超）→ スパム
        # - 短い純粋数字（"3", "2003" など）→ 保持
        non_digit_non_space = ''.join(c for c in t if not c.isdigit() and c not in ' 　')
        if non_digit_non_space or len(t) > 5:
            return True
        return False

    # キリル文字・アラビア文字・ハングルは日本語療法会話に出現しない
    if any(
        'Ѐ' <= c <= 'ӿ'    # Cyrillic
        or '؀' <= c <= 'ۿ'  # Arabic
        or '가' <= c <= '힯'  # Korean Hangul syllables
        or 'ᄀ' <= c <= 'ᇿ'  # Korean Jamo
        for c in t
    ):
        return True

    cjk_alpha = [c for c in alpha_chars if ord(c) > 0x2E7F]
    non_cjk_alpha = [c for c in alpha_chars if ord(c) <= 0x2E7F]

    if cjk_alpha:
        # CJK 文字が1文字のみで残りが記号・句読点（例: "現...、、、"）
        if len(alpha_chars) == 1 and len(t) > 3:
            return True
        # 日本語文字が含まれている場合: 非日本語 alpha が 50% 超なら混合ハルシネーション
        if non_cjk_alpha and len(non_cjk_alpha) / len(alpha_chars) > 0.5:
            return True
        # 同一文字の繰り返し: "...白白白"、"うううう" など（3文字以上）
        if len(set(alpha_chars)) == 1 and len(alpha_chars) >= 3:
            return True
        # 単一カタカナ文字がスペース区切りで3つ以上連続（例: "ノ ノ ア モ ノ"）
        if re.search(r'[ア-ン] [ア-ン] [ア-ン]', t):
            return True
        return False

    # 以下は日本語文字が皆無（ASCII 英字・ラテン系のみ）
    # alpha が 8 文字以下の短いトークン（"ighooo", "privat", "Nh Nh" など）
    if len(alpha_chars) <= 8:
        return True
    # 長さ・時間比率チェック
    if len(t) <= 5 or (duration >= 6.0 and len(t) <= 30):
        return True
    # カンマ密度が高い（"3idid,idid T, butido, to the,, acc,,,,,, ..." など）
    if len(t) > 10 and t.count(',') / len(t) > 0.12:
        return True
    # ドット密度が高い（"... ...av000 administr"、"advertised .. ...... .." など）
    if len(t) > 10 and t.count('.') / len(t) > 0.15:
        return True
    # "A.O.O.O.H.A." のようなドット区切り単一文字の連続
    if re.search(r'([A-Za-z]\.){3,}', t):
        return True
    # ハイフン密度が高い（"-gg-c-gc-cc-h-gp-" のような繰り返しパターン）
    if len(t) > 10 and t.count('-') / len(t) > 0.20:
        return True
    return False


def emit_progress(stage: str, message: str, progress: float | None = None) -> None:
    payload: Dict[str, object] = {"stage": stage, "message": message}
    if progress is not None:
        payload["progress"] = round(progress, 1)
    sys.stderr.write(f"PROGRESS_JSON:{json.dumps(payload, ensure_ascii=False)}\\n")
    sys.stderr.flush()


def configure_runtime_env(device: str) -> None:
    # Must be set before importing native libs using OpenMP runtime.
    os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
    if device == "cuda":
        os.environ.setdefault("OMP_NUM_THREADS", "1")
        os.environ.setdefault("MKL_NUM_THREADS", "1")
        return

    detected = os.cpu_count() or 4
    target_threads = max(1, min(16, detected))
    os.environ.setdefault("OMP_NUM_THREADS", str(target_threads))
    os.environ.setdefault("MKL_NUM_THREADS", str(target_threads))


def list_gpu_devices() -> int:
    """--list-devices モード: HIP/CUDA デバイス一覧を JSON で出力して終了する。"""
    force_utf8_stdio()
    result: Dict[str, object] = {"devices": [], "recommendedIndex": -1}
    try:
        import torch  # type: ignore
        count = torch.cuda.device_count()
        min_free_mb = 3072  # Whisper turbo float32 の最低要件
        best_idx = -1
        best_free = -1
        devices = []
        for i in range(count):
            props = torch.cuda.get_device_properties(i)
            try:
                free_bytes, total_bytes = torch.cuda.mem_get_info(i)
                free_mb = free_bytes // (1024 * 1024)
                total_mb = total_bytes // (1024 * 1024)
            except Exception:
                total_mb = props.total_memory // (1024 * 1024)
                free_mb = total_mb
            devices.append({
                "index": i,
                "name": torch.cuda.get_device_name(i),
                "totalVramMb": total_mb,
                "freeVramMb": free_mb,
            })
            if free_mb >= min_free_mb and free_mb > best_free:
                best_free = free_mb
                best_idx = i
        result["devices"] = devices
        result["recommendedIndex"] = best_idx
    except Exception as e:
        result["error"] = str(e)
    print(json.dumps(result))
    return 0


def main() -> int:
    if "--list-devices" in sys.argv:
        return list_gpu_devices()
    args = parse_args()
    configure_runtime_env(args.device)
    force_utf8_stdio()

    vad_filter = str_to_bool(args.vad_filter)
    word_timestamps = str_to_bool(args.word_timestamps)
    low_memory_mode = str_to_bool(args.low_memory_mode)
    normalize_audio_flag = str_to_bool(args.normalize_audio)
    highpass_filter_flag = str_to_bool(args.highpass_filter)
    noise_reduction_flag = str_to_bool(args.noise_reduction)
    noise_reduction_mode = normalize_noise_reduction_mode(args.noise_reduction_mode)
    audio_decode_backend = normalize_audio_decode_backend(
        args.audio_decode_backend or os.environ.get("LOTT_AUDIO_DECODE_BACKEND", "")
    )
    initial_prompt_raw = args.initial_prompt.strip()
    glossary_path = resolve_glossary_path(args.glossary_path)
    glossary_initial_prompt, glossary_hotwords, glossary_error = load_glossary(glossary_path)
    initial_prompt = merge_initial_prompt(initial_prompt_raw, glossary_initial_prompt, glossary_hotwords)

    # language=ja の場合、日本語固定プレフィックスを先頭に追加して言語ドリフトを抑制する。
    # turbo はデコーダー層が少なく言語の混在が起きやすいため、このバイアスが有効。
    if args.language == "ja":
        ja_prefix = "以下は日本語の会話です。"
        initial_prompt = (ja_prefix + " " + initial_prompt).strip() if initial_prompt else ja_prefix

    audio_path = Path(args.audio_path)
    if not audio_path.exists():
        print(
            json.dumps(
                {
                    "success": False,
                    "error": {
                        "message": f"音声ファイルが見つかりません: {audio_path}",
                        "type": "file_not_found",
                    },
                },
                ensure_ascii=False,
            )
        )
        return 2

    settings = {
        "model": args.model,
        "device": args.device,
        "computeType": args.compute_type,  # 実効値は ROCm 補正後に上書きされる
        "language": args.language,
        "vadFilter": vad_filter,
        "wordTimestamps": word_timestamps,
        "lowMemoryMode": low_memory_mode,
        "initialPrompt": initial_prompt,
        "initialPromptBase": initial_prompt_raw,
        "glossaryPath": str(glossary_path) if glossary_path else "",
        "glossaryHotwordCount": len(glossary_hotwords),
        "glossaryLoadWarning": glossary_error or None,
        "normalizeAudio": normalize_audio_flag,
        "highpassFilter": highpass_filter_flag,
        "noiseReduction": noise_reduction_flag,
        "noiseReductionMode": noise_reduction_mode if noise_reduction_flag else "off",
        "audioDecodeBackend": audio_decode_backend,
    }

    # CT2_CUDA_ALLOCATOR はライブラリロード時に参照されるため faster_whisper import より前に設定する。
    # ROCm 環境: MallocAsync アロケータが AMD GPU と非互換のため cub_caching へ切替（issue #2012）。
    # gfx1102（RX 7600 系）は hipBLASLt カーネル欠落のため gfx1100 として動作させる。
    is_rocm = False
    effective_compute_type = args.compute_type
    if args.device == "cuda":
        try:
            import torch as _torch
            if getattr(_torch.version, "hip", None):
                is_rocm = True
                os.environ.setdefault("CT2_CUDA_ALLOCATOR", "cub_caching")
                try:
                    if _torch.cuda.is_available():
                        _gcn = getattr(_torch.cuda.get_device_properties(0), "gcnArchName", "")
                        if _gcn.split(":")[0].strip().lower() == "gfx1102":
                            os.environ.setdefault("HSA_OVERRIDE_GFX_VERSION", "11.0.0")
                except Exception:
                    pass
        except ImportError:
            pass

    try:
        # PyAV を使わず、同梱 / PATH 上の LGPL ffmpeg CLI でデコードする
        # （Apache-2.0 配布方針）。faster-whisper のトップレベル import av は
        # 最小 stub で通し、前処理は numpy 配列上で apply_audio_preprocessing に一本化する。
        install_pyav_import_stub()

        from faster_whisper import WhisperModel

        emit_progress("model_loading", "モデルを読み込んでいます...", 2.0)

        settings["computeType"] = effective_compute_type
        model = WhisperModel(args.model, device=args.device, compute_type=effective_compute_type)

        emit_progress("preprocessing", "ffmpeg で音声を読み込んでいます...", 4.0)
        audio_path_to_use = decode_audio_with_ffmpeg(str(audio_path))
        if normalize_audio_flag or highpass_filter_flag or noise_reduction_flag:
            audio_path_to_use = apply_audio_preprocessing(
                audio_path_to_use,
                normalize_audio_flag,
                highpass_filter_flag,
                noise_reduction_flag,
                noise_reduction_mode,
            )

        emit_progress("transcribing", "音声を文字起こし中です...", 5.0)
        transcribe_options: Dict[str, object] = {
            "language": args.language,
            "vad_filter": vad_filter,
            "word_timestamps": word_timestamps,
        }
        if vad_filter:
            # VAD 閾値はデフォルト 0.5 を維持する。
            # 0.6 に上げると BGM のない清音会話でも発話区間を過剰に除外してしまう。
            # min_speech_duration_ms: 200ms 未満の短いノイズバーストを発話とみなさない。
            # min_silence_duration_ms: 日本語会話の自然な間（デフォルト 2000ms から短縮）。
            transcribe_options["vad_parameters"] = {
                "threshold": 0.5,
                "min_speech_duration_ms": 200,
                "min_silence_duration_ms": 800,
            }
        # no_speech_threshold: faster-whisper デフォルト 0.6 を維持する。
        # 0.4 に厳しくすると ROCm の非決定性（実行ごとに no_speech_prob が微妙に変わる）
        # により同じ音声でも結果が大きく変わるため、デフォルト値で安定させる。
        # log_prob_threshold: デフォルト値を明示してライブラリのバージョン差を回避する。
        transcribe_options["log_prob_threshold"] = -1.0

        # Stability profile:
        # - Long audio: reduce decode search width to lower VRAM/compute spikes.
        # - Normal audio: keep moderate values for balance.
        # condition_on_previous_text は常に False にする。True にするとノイズ区間で
        # 生成した誤り（英語・記号連続など）が次セグメントに連鎖して雪崩型ハルシネーションを起こす。
        if low_memory_mode:
            beam_size = 1
            best_of = 1
            emit_progress("transcribing", "長尺向け安定モードで処理しています...", 8.0)
        else:
            beam_size = 3
            best_of = 3
        condition_on_previous_text = False

        transcribe_options["beam_size"] = beam_size
        transcribe_options["best_of"] = best_of
        transcribe_options["condition_on_previous_text"] = condition_on_previous_text
        # compression_ratio_threshold: デフォルト 2.4 を維持する。
        # 2.0 に厳格化すると、同一トピック（「ドリアン」「タイ」等）を繰り返す自然な会話が
        # 圧縮率過大と誤判定されてセグメントごと破棄される。
        transcribe_options["compression_ratio_threshold"] = 2.4
        # 軽度の繰り返しペナルティでループハルシネーションを抑制（1.0=無効、1.3超は日本語に過剰）。
        transcribe_options["repetition_penalty"] = 1.1
        # 同じ trigram の連続繰り返しをデコード時点でブロックする。
        transcribe_options["no_repeat_ngram_size"] = 3
        # word_timestamps 有効時は長い無音区間後のハルシネーション検出を有効化（閾値 20 秒）。
        if word_timestamps:
            transcribe_options["hallucination_silence_threshold"] = 20
        if initial_prompt:
            transcribe_options["initial_prompt"] = initial_prompt

        settings["beamSize"] = beam_size
        settings["bestOf"] = best_of
        settings["conditionOnPreviousText"] = condition_on_previous_text

        segments_gen, info = model.transcribe(audio_path_to_use, **transcribe_options)

        segments_json: List[Dict[str, object]] = []
        all_text_parts: List[str] = []
        audio_duration = getattr(info, "duration", None)
        last_progress = 5

        for segment in segments_gen:
            segment_text = segment.text.strip()
            seg_duration = segment.end - segment.start

            # progress tracking（フィルタ前に実行）
            if audio_duration and audio_duration > 0:
                current = min(95, max(5, int((segment.end / audio_duration) * 100)))
                if current >= last_progress + 3:
                    last_progress = current
                    emit_progress("transcribing", "音声を文字起こし中です...", float(current))

            # per-segment 信頼度フィルタは削除済み。
            # ROCm float32 の非決定性で no_speech_prob が実行ごとに変わるため、
            # 0.5 の手動閾値が正常発話を誤って除外していた。
            # Whisper 自身の no_speech_threshold=0.6 に判断を委ねる。

            if _is_likely_hallucination(segment_text, args.language, seg_duration):
                continue

            all_text_parts.append(segment_text)
            segment_payload: Dict[str, object] = {
                "id": len(segments_json),
                "start": segment.start,
                "end": segment.end,
                "text": segment_text,
                "speaker": None,
            }
            segments_json.append(segment_payload)

        emit_progress("postprocess", "結果を整形しています...", 97.0)
        payload = {
            "success": True,
            "result": {
                "text": "".join(part for part in all_text_parts if part),
                "segments": segments_json,
                "settings": settings,
                "diarizationRequested": False,
                "diarization": {
                    "requested": False,
                    "applied": False,
                    "status": "disabled",
                    "provider": None,
                    "segments": [],
                    "summary": None,
                    "note": None,
                },
            },
        }

        emit_progress("done", "完了しました。", 100.0)
        print(json.dumps(payload, ensure_ascii=False))
        return 0

    except Exception as exc:
        traceback_text = traceback.format_exc()
        message = f"文字起こし処理でエラーが発生しました: {exc}"
        if "WinError 1314" in str(exc) or "WinError 1314" in traceback_text:
            message = (
                "モデルのダウンロード時に Windows 権限エラーが発生しました (WinError 1314)。"
                "管理者権限のターミナルで再実行するか、Windows の開発者モードを有効化してください。"
            )
        elif "cublas64_12.dll" in str(exc) or "cudnn64_9.dll" in str(exc):
            message = (
                "CUDA/cuDNN の DLL が見つからないため GPU 実行できません。"
                "PATH に CUDA と cuDNN の bin を追加してください。"
            )
        print(
            json.dumps(
                {
                    "success": False,
                    "error": {
                        "message": message,
                        "type": "runtime_error",
                        "traceback": traceback_text,
                    },
                },
                ensure_ascii=False,
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
