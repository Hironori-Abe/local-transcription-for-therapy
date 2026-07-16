import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import traceback
from collections import defaultdict
from pathlib import Path
from typing import Dict, List


def force_utf8_stdio() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Offline diarization sidecar")
    # 音声ファイルパスは環境変数 LOTT_AUDIO_PATH を優先する（Linux で /proc/<pid>/cmdline が
    # 他ユーザーからも読めるため、argv にクライエント名を含み得るファイル名を載せない）。
    # --audio-path は手動実行用フォールバックとして残す。
    parser.add_argument("--audio-path", required=False, default="")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--diarization-model-path", default="")
    parser.add_argument("--num-speakers", type=int, default=2)
    parser.add_argument("--clustering-threshold", type=float, default=None)
    return parser.parse_args()


def emit_progress(stage: str, message: str, progress: float | None = None) -> None:
    payload: Dict[str, object] = {"stage": stage, "message": message}
    if progress is not None:
        payload["progress"] = round(progress, 1)
    sys.stderr.write(f"PROGRESS_JSON:{json.dumps(payload, ensure_ascii=False)}\n")
    sys.stderr.flush()


def configure_runtime_env() -> None:
    # Must be set before importing torch/pyannote modules.
    os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("MKL_NUM_THREADS", "1")


def no_window_subprocess_kwargs() -> Dict[str, object]:
    if os.name != "nt":
        return {}
    return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)}


def patch_torch_load_default_weights_only_false(torch_module) -> None:
    """Keep compatibility with pyannote checkpoints under torch>=2.6.

    torch 2.6 changed torch.load default weights_only=False -> True.
    Some pyannote checkpoints require full pickle loading.
    """
    original_load = getattr(torch_module, "load", None)
    if original_load is None:
        return
    if getattr(torch_module, "_offline_transcriber_torch_load_patched", False):
        return

    def patched_load(*args, **kwargs):
        # pyannote community-1 local checkpoints may fail with torch>=2.6
        # when weights_only=True (including explicit call-sites from deps).
        kwargs["weights_only"] = False
        return original_load(*args, **kwargs)

    torch_module.load = patched_load
    torch_module._offline_transcriber_torch_load_patched = True


def resolve_model_path(cli_value: str) -> Path:
    if cli_value:
        return Path(cli_value)
    env_value = os.environ.get("DIARIZATION_MODEL_PATH") or os.environ.get(
        "PYANNOTE_DIARIZATION_MODEL_PATH"
    )
    if env_value:
        return Path(env_value)
    return Path("python_sidecar/models/pyannote-speaker-diarization")


def resolve_model_config_path(model_path: Path) -> Path:
    if model_path.is_file():
        return model_path

    direct_config = model_path / "config.yaml"
    if direct_config.exists():
        return direct_config

    # Fallback: support nested layouts created by download patterns.
    for candidate in model_path.rglob("config.yaml"):
        return candidate

    return direct_config


def resolve_ffmpeg_bin() -> str | None:
    """ffmpeg 実行ファイルを解決する。

    優先順位:
      1. FFMPEG_BIN 環境変数（明示指定。LGPL ビルドの注入点。Tauri 側が同梱 LGPL を指す）
      2. PATH 上の ffmpeg（システム / 同梱 LGPL を PATH 経由で）
      3. サイドカー隣接の同梱 ffmpeg（ポータブル配置向け: ./ffmpeg/ or ./bin/）
      4. imageio-ffmpeg 同梱バイナリ（⚠ GPL ビルド: 明示許可時のみの開発用フォールバック）

    本アプリは Apache-2.0 配布のため、配布物では 1〜3 の LGPL ビルドを使う。
    GPL の imageio-ffmpeg フォールバックは既定で無効。開発時に必要な場合だけ
    ALLOW_GPL_FFMPEG=1 で明示的に許可する。
    """
    # 1. 明示指定（LGPL ビルドの注入点）
    explicit = os.environ.get("FFMPEG_BIN")
    if explicit and Path(explicit).exists():
        return explicit

    # 2. PATH 上
    ffmpeg_bin = shutil.which("ffmpeg")
    if ffmpeg_bin:
        return ffmpeg_bin

    # 3. サイドカー隣接の同梱バイナリ（ポータブル配置）
    exe_name = "ffmpeg" + (".exe" if os.name == "nt" else "")
    base = Path(__file__).resolve().parent
    for cand in (base / "ffmpeg" / exe_name, base / "bin" / exe_name):
        if cand.exists():
            return str(cand)

    # 4. imageio-ffmpeg（GPL ビルド・明示許可時のみの開発用フォールバック）
    if os.environ.get("ALLOW_GPL_FFMPEG", "0") == "1":
        try:
            import imageio_ffmpeg

            exe = imageio_ffmpeg.get_ffmpeg_exe()
            if exe and Path(exe).exists():
                print(
                    "WARN: GPL ビルドの imageio-ffmpeg を使用します。"
                    " Apache-2.0 配布では FFMPEG_BIN か同梱 LGPL ffmpeg を指定してください。",
                    file=sys.stderr,
                )
                return exe
        except Exception:
            return None
    return None


def to_wav_if_possible(audio_path: Path) -> Path:
    ffmpeg_bin = resolve_ffmpeg_bin()
    if ffmpeg_bin is None:
        return audio_path

    if audio_path.suffix.lower() == ".wav":
        return audio_path

    fd, tmp_path = tempfile.mkstemp(prefix="offline_transcriber_diar_", suffix=".wav")
    os.close(fd)
    tmp_file = Path(tmp_path)

    cmd = [
        ffmpeg_bin,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(audio_path),
        "-ac",
        "1",
        "-ar",
        "16000",
        str(tmp_file),
    ]
    try:
        res = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            **no_window_subprocess_kwargs(),
        )
        if res.returncode != 0 or not tmp_file.exists():
            tmp_file.unlink(missing_ok=True)
            return audio_path
        return tmp_file
    except Exception:
        tmp_file.unlink(missing_ok=True)
        return audio_path


def load_audio_input_for_pipeline(audio_path: Path):
    # pyannote can accept {"waveform": tensor, "sample_rate": int}
    # This path avoids torchcodec/ffmpeg runtime issues on some Windows setups.
    import numpy as np
    import soundfile as sf
    import torch

    samples, sample_rate = sf.read(str(audio_path), dtype="float32", always_2d=True)
    # soundfile returns [num_frames, num_channels]
    if samples.ndim == 2 and samples.shape[1] > 1:
        samples = samples.mean(axis=1, dtype=np.float32)
    else:
        samples = samples.reshape(-1).astype(np.float32, copy=False)

    if int(sample_rate) != 16000:
        original_len = int(samples.shape[0])
        target_len = max(1, int(round(original_len * (16000.0 / float(sample_rate)))))
        src_x = np.linspace(0.0, 1.0, num=original_len, endpoint=False, dtype=np.float64)
        dst_x = np.linspace(0.0, 1.0, num=target_len, endpoint=False, dtype=np.float64)
        samples = np.interp(dst_x, src_x, samples.astype(np.float64)).astype(np.float32)
        sample_rate = 16000

    waveform = torch.from_numpy(samples).unsqueeze(0)
    return {"waveform": waveform, "sample_rate": sample_rate}


def emit_json_error(message: str, error_type: str, detail: str | None = None, traceback_text: str | None = None) -> int:
    payload = {
        "success": False,
        "error": {
            "message": message,
            "type": error_type,
        },
    }
    if detail:
        payload["error"]["detail"] = detail
    if traceback_text:
        payload["error"]["traceback"] = traceback_text
    print(json.dumps(payload, ensure_ascii=False))
    return 2


def extract_diarization_segments(diarization_output) -> List[Dict[str, object]]:
    """Normalize pyannote diarization outputs across versions.

    - pyannote 3.x: returns Annotation (has itertracks)
    - pyannote 4.x community-1: may return DiarizeOutput with
      exclusive_speaker_diarization / speaker_diarization
    """
    annotation = diarization_output
    # Prefer exclusive diarization when available.
    if hasattr(diarization_output, "exclusive_speaker_diarization") and getattr(
        diarization_output, "exclusive_speaker_diarization"
    ) is not None:
        annotation = diarization_output.exclusive_speaker_diarization
    elif hasattr(diarization_output, "speaker_diarization"):
        annotation = diarization_output.speaker_diarization

    if hasattr(annotation, "itertracks"):
        segments: List[Dict[str, object]] = []
        for turn, _, speaker in annotation.itertracks(yield_label=True):
            segments.append(
                {
                    "start": float(turn.start),
                    "end": float(turn.end),
                    "speaker": str(speaker),
                }
            )
        return segments

    if hasattr(diarization_output, "serialize"):
        serialized = diarization_output.serialize()
        if isinstance(serialized, dict):
            diarization_list = (
                serialized.get("exclusive_speaker_diarization")
                or serialized.get("exclusive_diarization")
                or serialized.get("diarization")
            )
            if isinstance(diarization_list, list):
                normalized: List[Dict[str, object]] = []
                for item in diarization_list:
                    if not isinstance(item, dict):
                        continue
                    try:
                        normalized.append(
                            {
                                "start": float(item.get("start", 0.0)),
                                "end": float(item.get("end", 0.0)),
                                "speaker": str(item.get("speaker", "")),
                            }
                        )
                    except (TypeError, ValueError):
                        continue
                return normalized

    raise TypeError(f"Unsupported diarization output type: {type(diarization_output)!r}")


def filter_short_segments(
    segments: List[Dict[str, object]],
    min_duration: float = 0.3,
    merge_gap: float = 0.5,
) -> List[Dict[str, object]]:
    """Remove very short segments then merge adjacent same-speaker segments.

    1. Discard segments shorter than min_duration (seconds).
    2. Merge consecutive same-speaker segments whose gap is <= merge_gap (seconds).
    """
    filtered = [s for s in segments if float(s["end"]) - float(s["start"]) >= min_duration]

    if not filtered:
        return filtered

    merged: List[Dict[str, object]] = [dict(filtered[0])]
    for seg in filtered[1:]:
        prev = merged[-1]
        gap = float(seg["start"]) - float(prev["end"])
        if str(seg["speaker"]) == str(prev["speaker"]) and gap <= merge_gap:
            prev["end"] = seg["end"]
        else:
            merged.append(dict(seg))

    return merged


def main() -> int:
    configure_runtime_env()
    force_utf8_stdio()
    args = parse_args()
    num_speakers = max(1, min(5, int(args.num_speakers)))

    # 音声ファイルパスは env LOTT_AUDIO_PATH を優先し、なければ --audio-path を使う。
    audio_path_str = os.environ.get("LOTT_AUDIO_PATH", "").strip() or args.audio_path.strip()
    audio_path = Path(audio_path_str)
    if not audio_path_str or not audio_path.exists():
        return emit_json_error(
            f"音声ファイルが見つかりません: {audio_path}",
            "file_not_found",
        )

    model_path = resolve_model_path(args.diarization_model_path)
    if not model_path.exists():
        return emit_json_error(
            (
                f"話者分離モデルが見つかりません: {model_path} "
                "DIARIZATION_MODEL_PATH を設定するか、"
                "python_sidecar/models/pyannote-speaker-diarization に配置してください。"
            ),
            "diarization_model_not_found",
        )

    model_config_path = resolve_model_config_path(model_path)
    if not model_config_path.exists():
        return emit_json_error(
            (
                f"話者分離モデルの config.yaml が見つかりません: {model_path} "
                "モデルを再ダウンロードするか、DIARIZATION_MODEL_PATH を確認してください。"
            ),
            "diarization_model_config_not_found",
        )

    try:
        import torch
        from pyannote.audio import Pipeline
        patch_torch_load_default_weights_only_false(torch)
    except BaseException as exc:
        return emit_json_error(
            "話者分離の依存読み込みに失敗しました。requirements-diarization-community1.txt を再確認してください。",
            "diarization_import_error",
            detail=str(exc),
        )

    diarization_audio = audio_path
    try:
        emit_progress("diarization_loading", "話者分離モデルを読み込んでいます...", 88.0)
        pipeline = Pipeline.from_pretrained(str(model_config_path))

        if args.clustering_threshold is not None:
            try:
                pipeline.instantiate({"clustering": {"threshold": args.clustering_threshold}})
            except Exception:
                pass

        # "rocm" は PyTorch ROCm の HIP-CUDA 互換レイヤーにより "cuda" として扱う。
        raw_device = str(args.device).strip().lower()
        requested_device = "cuda" if raw_device in ("cuda", "rocm") else "cpu"
        use_cuda = requested_device == "cuda" and torch.cuda.is_available()
        actual_device = "cuda" if use_cuda else "cpu"
        if use_cuda:
            pipeline.to(torch.device("cuda"))

        emit_progress("diarization_running", "話者分離を実行しています...", 94.0)
        diarization_audio = to_wav_if_possible(audio_path)
        diarization_kwargs = {"num_speakers": num_speakers}
        audio_input = load_audio_input_for_pipeline(diarization_audio)

        embeddings_done_emitted = [False]

        def diarization_hook(step_name, step_artifact, file=None, total=None, completed=None):
            if step_name == "embeddings" and not embeddings_done_emitted[0]:
                if total is not None and completed is not None and int(total) > 0 and int(completed) >= int(total):
                    embeddings_done_emitted[0] = True
                    sys.stderr.write(
                        f"PROGRESS_JSON:{json.dumps({'stage': 'diarization_embeddings_done'}, ensure_ascii=False)}\n"
                    )
                    sys.stderr.flush()

        try:
            diarization = pipeline(audio_input, hook=diarization_hook, **diarization_kwargs)
        except RuntimeError as _gpu_exc:
            _err_lower = str(_gpu_exc).lower()
            _is_gpu_err = use_cuda and any(
                k in _err_lower for k in ("miopen", "rocm", "hip", "cuda failed", "no rocm")
            )
            if not _is_gpu_err:
                raise
            # ROCm/MIOpen がこの GPU アーキテクチャをサポートしていない場合は CPU で再試行する。
            sys.stderr.write(
                f"[warn] GPU diarization failed ({_gpu_exc.__class__.__name__}), retrying on CPU\n"
            )
            sys.stderr.flush()
            pipeline.to(torch.device("cpu"))
            actual_device = "cpu"
            embeddings_done_emitted[0] = False
            diarization = pipeline(audio_input, hook=diarization_hook, **diarization_kwargs)

        diarization_segments: List[Dict[str, object]] = extract_diarization_segments(diarization)
        diarization_segments = filter_short_segments(diarization_segments)
        speaker_durations: Dict[str, float] = defaultdict(float)
        for item in diarization_segments:
            start = float(item["start"])
            end = float(item["end"])
            label = str(item["speaker"])
            speaker_durations[label] += max(0.0, end - start)

        speakers = sorted(speaker_durations.keys())
        summary = {
            "speakerCount": len(speakers),
            "speakers": [
                {"speaker": spk, "duration": round(speaker_durations[spk], 3)} for spk in speakers
            ],
        }

        emit_progress("diarization_done", "話者分離が完了しました。", 98.0)
        print(
            json.dumps(
                {
                    "success": True,
                    "result": {
                        "provider": "pyannote.audio",
                        "requestedDevice": requested_device,
                        "device": actual_device,
                        "segments": diarization_segments,
                        "summary": summary,
                    },
                },
                ensure_ascii=False,
            )
        )
        return 0

    except BaseException as exc:
        tb = traceback.format_exc()
        return emit_json_error(
            f"話者分離処理でエラーが発生しました: {exc}",
            "diarization_runtime_error",
            detail=str(exc),
            traceback_text=tb,
        )
    finally:
        if diarization_audio != audio_path:
            diarization_audio.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
