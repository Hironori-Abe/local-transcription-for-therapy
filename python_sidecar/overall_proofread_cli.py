import argparse
import gc
import json
import os
import re as _re
import subprocess
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

BATCH_TARGET_CHARS = 1000
BATCH_MAX_SEGMENTS = 20

_PROMPT_TEMPLATES_DIR = Path(__file__).parent / "prompt_templates" / "proofread"
_PROMPT_TYPE = "gemma4"
_SYSTEM_PROMPT_OVERRIDE_FILE: Optional[Path] = None
# 同時送信数（継続バッチング）。内蔵 llama-server 経路（backend 名は後方互換で lemonade）のみ。
# openai 互換は外部サーバー負荷回避で 1 固定。
_OVERALL_PARALLEL: int = 1
# emit の stderr 書き込みをワーカースレッド間で直列化し、行の混線を防ぐ。
_EMIT_LOCK = threading.Lock()

_GEMMA4_OVERALL_FIXED_SUFFIX = (
    "\n\n出力ルール：\n"
    "- すべてのセグメントをJSON配列として返す\n"
    "- 先頭文字は「[」、末尾文字は「]」にする\n"
    "- 説明・前置き・マークダウン（``` など）は一切含めない\n"
    '- スキーマ: [{"id": <番号>, "revised": "校正後テキスト", "note": "変更内容（変更なしは空文字）"}]\n\n'
    "出力例：\n"
    "入力:\n"
    "[1] Th: えーと今日はどんなことで来られましたか\n"
    "[2] Cl: はい、最近眠れなくてちょっと辛いです\n\n"
    "出力:\n"
    '[{"id": 1, "revised": "えーと、今日はどんなことで来られましたか？", "note": "読点と「？」を追加"},'
    '{"id": 2, "revised": "はい、最近眠れなくて、ちょっと辛いです。", "note": "読点と句点を追加"}]'
)

_ORIGINAL_OVERALL_FIXED_SUFFIX = (
    "\n\n### 出力ルール\n"
    "- すべてのセグメントをJSON配列として返す\n"
    "- コードブロック（``` など）・説明・前置き・マークダウンは一切含めない\n"
    "- 返答の最初の文字を「[」、最後の文字を「]」にする\n"
    '- スキーマ: [{"id": <番号>, "revised": "校正後テキスト", "note": "変更内容（変更なしは空文字）"}]\n\n'
    "### 出力例\n"
    "入力:\n"
    "[1] Th: えーと今日はどんなことで来られましたか\n"
    "[2] Cl: はい、最近眠れなくてちょっと辛いです\n\n"
    "出力:\n"
    '[{"id": 1, "revised": "えーと、今日はどんなことで来られましたか？", "note": "読点と「？」を追加"},'
    '{"id": 2, "revised": "はい、最近眠れなくて、ちょっと辛いです。", "note": "読点と句点を追加"}]'
)

_DEFAULT_SYSTEM_INSTRUCTION = (
    "あなたは日本語のカウンセリング・対話記録の全体校正を行うアシスタントです。\n"
    "以下の連続した発言を校正し、より自然で正確なテキストに整えてください。\n"
    "積極的な校正を行い、次の観点から改善を提案してください：句読点の追加・修正、誤字脱字の修正、不自然な語尾・語順の改善、冗長表現の整理、文脈の流れを損なう表現の改善、一人の発話として不自然な文章の指摘（話者分離の誤りによって複数人の発言が混入しているような違和感がある場合）。\n"
    "話者の意図・感情・内容は変えないこと。会話フィラーはそのまま残すこと。セグメントの分割・統合はしないこと。\n"
    "番号付きのすべてのテキストを校正し、以下のJSON配列形式のみで返答してください。説明・前置き・マークダウン形式は不要です。\n"
    '[{"id": <番号>, "revised": "校正後テキスト", "note": "変更内容（変更なしは空文字）"}]'
)


def _fixed_suffix() -> str:
    return _GEMMA4_OVERALL_FIXED_SUFFIX if _PROMPT_TYPE == "gemma4" else _ORIGINAL_OVERALL_FIXED_SUFFIX


def _load_system_instruction() -> str:
    if _SYSTEM_PROMPT_OVERRIDE_FILE is not None:
        try:
            text = _SYSTEM_PROMPT_OVERRIDE_FILE.read_text(encoding="utf-8").strip()
            if text:
                return text + _fixed_suffix()
        except OSError:
            pass
    filename = "gemma4_overall.txt" if _PROMPT_TYPE == "gemma4" else "general_overall.txt"
    path = _PROMPT_TEMPLATES_DIR / filename
    try:
        text = path.read_text(encoding="utf-8").strip()
        base = text if text else _DEFAULT_SYSTEM_INSTRUCTION
    except OSError:
        base = _DEFAULT_SYSTEM_INSTRUCTION
    return base + _fixed_suffix()


def find_best_cuda_device() -> Optional[int]:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=index,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            return None
        best_idx: Optional[int] = None
        best_mem = -1
        for line in result.stdout.strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) == 2:
                idx, mem = int(parts[0]), int(parts[1])
                if mem > best_mem:
                    best_mem = mem
                    best_idx = idx
        return best_idx
    except Exception:
        return None


def find_nvidia_vulkan_device() -> Optional[int]:
    try:
        result = subprocess.run(["vulkaninfo", "--summary"], capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            return None
        current_idx: Optional[int] = None
        for line in result.stdout.splitlines():
            line = line.strip()
            if line.startswith("GPU") and line.endswith(":"):
                try:
                    current_idx = int(line[3:-1])
                except ValueError:
                    current_idx = None
            elif current_idx is not None and "NVIDIA" in line.upper():
                return current_idx
        return None
    except Exception:
        return None


def setup_nvidia_gpu_env() -> str:
    cuda_idx = find_best_cuda_device()
    vulkan_idx = find_nvidia_vulkan_device()
    if cuda_idx is not None:
        os.environ["CUDA_VISIBLE_DEVICES"] = str(cuda_idx)
    target_vk = vulkan_idx if vulkan_idx is not None else cuda_idx
    if target_vk is not None:
        os.environ["GGML_VK_DEVICE"] = str(target_vk)
    if cuda_idx is not None:
        return f"NVIDIA GPU (CUDA #{cuda_idx}) を選択しました"
    elif target_vk is not None:
        return f"NVIDIA GPU (Vulkan #{target_vk}) を選択しました"
    else:
        return "NVIDIA GPUが検出されませんでした。CPUで実行します。"


def find_best_rocm_device() -> Optional[int]:
    try:
        result = subprocess.run(
            ["rocm-smi", "--showproductname", "--csv"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            return None
        data_lines = [l for l in result.stdout.strip().splitlines()
                      if l.strip() and not l.strip().lower().startswith("device")]
        return 0 if data_lines else None
    except Exception:
        return None


def find_amd_vulkan_device() -> Optional[int]:
    try:
        result = subprocess.run(["vulkaninfo", "--summary"], capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            return None
        current_idx: Optional[int] = None
        for line in result.stdout.splitlines():
            line = line.strip()
            if line.startswith("GPU") and line.endswith(":"):
                try:
                    current_idx = int(line[3:-1])
                except ValueError:
                    current_idx = None
            elif current_idx is not None and any(kw in line.upper() for kw in ("AMD", "RADEON", "RADV")):
                return current_idx
        return None
    except Exception:
        return None


def setup_amd_gpu_env() -> str:
    rocm_idx = find_best_rocm_device()
    vulkan_idx = find_amd_vulkan_device()
    if rocm_idx is not None:
        os.environ["HIP_VISIBLE_DEVICES"] = str(rocm_idx)
    if vulkan_idx is not None:
        os.environ["GGML_VK_DEVICE"] = str(vulkan_idx)
    if rocm_idx is not None and vulkan_idx is not None:
        return f"AMD GPU (ROCm #{rocm_idx}, Vulkan #{vulkan_idx}) を選択しました"
    elif rocm_idx is not None:
        return f"AMD GPU (ROCm #{rocm_idx}) を選択しました"
    elif vulkan_idx is not None:
        return f"AMD GPU (Vulkan #{vulkan_idx}) を選択しました"
    else:
        return "AMD GPUが検出されませんでした。CPUで実行します。"


def force_utf8_stdio() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def emit_progress(stage: str, message: str, current: Optional[int] = None, total: Optional[int] = None) -> None:
    payload: Dict[str, object] = {"stage": stage, "message": message}
    if current is not None:
        payload["current"] = current
    if total is not None:
        payload["total"] = total
    line = f"PROGRESS_JSON:{json.dumps(payload, ensure_ascii=False)}\n"
    with _EMIT_LOCK:
        sys.stderr.write(line)
        sys.stderr.flush()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Overall proofreading sidecar")
    parser.add_argument("--segments-json-path", required=True)
    parser.add_argument("--model-path", default="")
    parser.add_argument("--n-gpu-layers", type=int, default=-1)
    parser.add_argument(
        "--backend", default="llama_cpp",
        choices=["llama_cpp", "llama_cpp_rocm", "lemonade", "openai_compatible"],
    )
    parser.add_argument("--llm-url", default="http://localhost:13305")
    parser.add_argument("--llm-model", default="gemma-4-E4B-it-qat")
    parser.add_argument("--openai-base-url", default="")
    parser.add_argument("--openai-model", default="")
    parser.add_argument("--n-ctx", type=int, default=16384)
    parser.add_argument("--prompt-type", default="gemma4", choices=["gemma4", "original"])
    parser.add_argument("--system-prompt-path", default=None)
    parser.add_argument(
        "--parallel", type=int, default=1,
        help="内蔵 llama-server 経路で同時送信するバッチ数（継続バッチング）。サーバーの -np 以下にする",
    )
    return parser.parse_args()


def batch_segments_by_chars(
    segments: List[Dict],
    target_chars: int = BATCH_TARGET_CHARS,
    max_segs: int = BATCH_MAX_SEGMENTS,
) -> List[List[Dict]]:
    if not segments:
        return []
    batches: List[List[Dict]] = []
    current: List[Dict] = []
    current_chars = 0
    for seg in segments:
        text_len = len(seg.get("text", ""))
        if current and (current_chars + text_len > target_chars or len(current) >= max_segs):
            batches.append(current)
            current = [seg]
            current_chars = text_len
        else:
            current.append(seg)
            current_chars += text_len
    if current:
        batches.append(current)
    return batches


def _fmt_speaker(seg: Dict) -> str:
    label = (seg.get("speakerLabel") or seg.get("speaker") or "").strip()
    return f"{label}: " if label and label != "-" else ""


def build_batch_prompt(batch: List[Dict], prev_context: Optional[str], next_context: Optional[str]) -> str:
    context_lines = []
    if prev_context:
        context_lines.append(f"前の文（参考）：{prev_context}")
    if next_context:
        context_lines.append(f"次の文（参考）：{next_context}")
    context_section = "\n".join(context_lines) + "\n\n" if context_lines else ""
    numbered = "\n".join(f"[{seg['id']}] {_fmt_speaker(seg)}{seg['text']}" for seg in batch)
    system_instruction = _load_system_instruction()
    return (
        f"<|turn>system\n{system_instruction}<turn|>\n"
        f"<|turn>user\n"
        f"{context_section}"
        f"{numbered}<turn|>\n"
        f"<|turn>model\n"
    )


def build_chat_messages(batch: List[Dict], prev_context: Optional[str], next_context: Optional[str]) -> List[Dict]:
    context_lines = []
    if prev_context:
        context_lines.append(f"前の文（参考）：{prev_context}")
    if next_context:
        context_lines.append(f"次の文（参考）：{next_context}")
    context_section = "\n".join(context_lines) + "\n\n" if context_lines else ""
    numbered = "\n".join(f"[{seg['id']}] {_fmt_speaker(seg)}{seg['text']}" for seg in batch)
    system_instruction = _load_system_instruction()
    return [
        {"role": "system", "content": system_instruction},
        {"role": "user", "content": f"{context_section}{numbered}"},
    ]


def _normalize_completion_text(raw_text: str) -> str:
    text = raw_text.strip()
    text = _re.sub(r"<thinking>[\s\S]*?</thinking>", "", text, flags=_re.IGNORECASE).strip()
    text = _re.sub(r"<start_of_thinking>[\s\S]*?<end_of_thinking>", "", text, flags=_re.IGNORECASE).strip()
    for marker in ["<turn|>", "<|turn>", "<end_of_turn>", "<start_of_turn>", "<bos>", "<eos>"]:
        text = text.replace(marker, "").strip()
    return text


def _iter_json_array_candidates(text: str) -> List[str]:
    candidates: List[str] = []
    for m in _re.finditer(r"```(?:json)?\s*([\s\S]*?)```", text, _re.IGNORECASE):
        block = m.group(1).strip()
        if block:
            candidates.append(block)
    in_string = False
    escaped = False
    depth = 0
    start_idx: Optional[int] = None
    for idx, ch in enumerate(text):
        if escaped:
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "[":
            if depth == 0:
                start_idx = idx
            depth += 1
        elif ch == "]" and depth > 0:
            depth -= 1
            if depth == 0 and start_idx is not None:
                block = text[start_idx: idx + 1].strip()
                if block:
                    candidates.append(block)
                start_idx = None
    uniq: List[str] = []
    seen = set()
    for c in candidates:
        if c in seen:
            continue
        seen.add(c)
        uniq.append(c)
    return uniq


def _pick_best_json_items(text: str, expected_ids: Optional[set] = None) -> Optional[List[Dict]]:
    merged: Dict[int, Dict] = {}
    for candidate in _iter_json_array_candidates(text):
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, list):
            continue
        for item in parsed:
            if not isinstance(item, dict):
                continue
            if "id" not in item:
                continue
            # Accept "revised" (overall), "result" (segment), or "revisedText"
            if "revised" not in item and "result" not in item and "revisedText" not in item:
                continue
            try:
                seg_id = int(item.get("id", -1))
            except (TypeError, ValueError):
                continue
            if expected_ids is not None and seg_id not in expected_ids:
                continue
            if seg_id not in merged:
                merged[seg_id] = item
    return list(merged.values()) if merged else None


def _levenshtein_similarity(a: str, b: str) -> float:
    """文字列類似度 (0.0〜1.0)。長い文字列は先頭 150 字で比較。"""
    a, b = a[:150], b[:150]
    la, lb = len(a), len(b)
    if la == 0 and lb == 0:
        return 1.0
    if la == 0 or lb == 0:
        return 0.0
    if la > lb:
        a, b, la, lb = b, a, lb, la
    prev = list(range(la + 1))
    for bch in b:
        curr = [prev[0] + 1]
        for i, ach in enumerate(a):
            curr.append(min(curr[-1] + 1, prev[i + 1] + 1, prev[i] + (0 if ach == bch else 1)))
        prev = curr
    return 1.0 - prev[la] / max(la, lb)


def _has_valid_result_json(text: str) -> bool:
    normalized = _normalize_completion_text(text)
    return _pick_best_json_items(normalized) is not None


def extract_batch_result(completion_text: str, batch: List[Dict]) -> Dict[int, Dict]:
    text = _normalize_completion_text(completion_text)
    result_map: Dict[int, Dict] = {}
    seg_index = {s["id"]: s for s in batch}
    expected_ids = set(seg_index.keys())
    items = _pick_best_json_items(text, expected_ids=expected_ids)
    if items:
        for item in items:
            try:
                seg_id = int(item.get("id", -1))
            except (TypeError, ValueError):
                continue
            original = seg_index.get(seg_id)
            if original is None:
                continue
            revised = str(item.get("revised", item.get("result", item.get("revisedText", "")))).strip()
            note = str(item.get("note", item.get("changed", ""))).strip()
            if note and all(c in "{}[]|\\,; \t\r\n" for c in note):
                note = ""
            if not revised:
                continue
            if revised.startswith("（") and revised.endswith("）") and len(revised) <= 20:
                continue
            # ID混在検出: 元テキストと類似度が低すぎる場合は変更なしとみなす
            orig_text = original["text"]
            if orig_text and revised != orig_text and _levenshtein_similarity(orig_text, revised) < 0.3:
                revised = orig_text
                note = ""
            result_map[seg_id] = {
                "id": seg_id,
                "originalText": original["text"],
                "revisedText": revised,
                "note": note,
            }
    for seg in batch:
        if seg["id"] not in result_map:
            result_map[seg["id"]] = {
                "id": seg["id"],
                "originalText": seg["text"],
                "revisedText": seg["text"],
                "note": "",
            }
    return result_map


def build_result_payload(segments: List[Dict], results_map: Dict[int, Dict]) -> dict:
    """校正結果をフロントエンド向け構造化データに変換する。"""
    items = []
    changed_count = 0
    unchanged_count = 0
    for seg in segments:
        r = results_map.get(seg["id"])
        if r is None:
            continue
        original = r.get("originalText", seg["text"])
        revised = r.get("revisedText", seg["text"])
        note = r.get("note", "")
        speaker_label = (seg.get("speakerLabel") or seg.get("speaker") or "").strip()
        changed = revised != original
        if changed:
            changed_count += 1
        else:
            unchanged_count += 1
        items.append({
            "id": seg["id"],
            "originalText": original,
            "revisedText": revised,
            "note": note,
            "speakerLabel": speaker_label,
            "changed": changed,
        })
    return {
        "items": items,
        "changedCount": changed_count,
        "unchangedCount": unchanged_count,
    }


def _normalize_local_openai_base_url(base_url: str) -> str:
    normalized = (base_url or "").strip().rstrip("/")
    if not normalized:
        raise RuntimeError("ローカルOpenAI互換APIの Base URL が未指定です。")
    parsed = urlparse(normalized)
    if parsed.scheme != "http":
        raise RuntimeError("ローカルOpenAI互換APIの Base URL は http:// で始まる必要があります。")
    if parsed.query or parsed.fragment:
        raise RuntimeError("ローカルOpenAI互換APIの Base URL にはクエリ文字列やフラグメントを含めないでください。")
    host = (parsed.hostname or "").lower()
    if not _is_loopback_host(host):
        raise RuntimeError("外部送信防止のため、ローカルOpenAI互換APIは localhost / 127.x.x.x / ::1 のみ指定できます。")
    return normalized


def _is_loopback_host(host: str) -> bool:
    if host in {"localhost", "::1"}:
        return True
    parts = host.split(".")
    return (
        len(parts) == 4
        and parts[0] == "127"
        and all(part.isdigit() and 0 <= int(part) <= 255 for part in parts)
    )


def _openai_compatible_endpoint(base_url: str, suffix: str) -> str:
    base = base_url.rstrip("/")
    endpoint_suffix = suffix.strip("/")
    if base.endswith("/v1"):
        return f"{base}/{endpoint_suffix}"
    return f"{base}/v1/{endpoint_suffix}"


def _collect_model_ids(models_data: Dict[str, Any]) -> List[str]:
    available_ids: List[str] = []
    for m in (models_data.get("data") or []):
        mid = m.get("id") or m.get("name") or ""
        if mid:
            available_ids.append(mid)
    return available_ids


def _stream_llm_chat(session: Any, url: str, payload: dict, idle_timeout: int) -> str:
    payload = {**payload, "stream": True}
    full_text = ""
    bracket_depth = 0
    json_started = False

    with session.post(url, json=payload, stream=True, timeout=(10, idle_timeout), allow_redirects=False) as resp:
        resp.raise_for_status()
        resp.encoding = "utf-8"
        content_type = resp.headers.get("content-type", "")

        if "text/event-stream" in content_type:
            reasoning_text = ""
            for raw_line in resp.iter_lines(decode_unicode=True):
                if not raw_line or not raw_line.startswith("data: "):
                    continue
                data = raw_line[6:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                    delta_obj = (chunk.get("choices") or [{}])[0].get("delta", {})
                    delta = (delta_obj.get("content") or "")
                    reasoning = (delta_obj.get("reasoning_content") or "")
                except (json.JSONDecodeError, IndexError, KeyError):
                    continue

                if reasoning:
                    reasoning_text += reasoning
                if not delta:
                    continue

                full_text += delta
                for ch in delta:
                    if ch == "[":
                        bracket_depth += 1
                        json_started = True
                    elif ch == "]" and json_started:
                        bracket_depth -= 1
                        if bracket_depth <= 0:
                            if _has_valid_result_json(full_text):
                                bracket_depth = 0
                                break
                            bracket_depth = 0
                            json_started = False
                if json_started and bracket_depth <= 0 and _has_valid_result_json(full_text):
                    break

            if not full_text and reasoning_text:
                full_text = reasoning_text
        else:
            data_obj = resp.json()
            full_text = (
                (data_obj.get("choices") or [{}])[0]
                .get("message", {}).get("content") or ""
            )

    return full_text


def _run_openai_chat_batches(
    segments: List[Dict],
    base_url: str,
    model: str,
    provider_label: str,
    backend_name: str,
    require_model_list: bool,
    fallback_to_first_model: bool,
    extra_payload: Optional[Dict[str, Any]] = None,
    parallel: int = 1,
) -> Dict[int, Dict]:
    import requests as _requests

    normalized_base_url = _normalize_local_openai_base_url(base_url)
    model = (model or "").strip()
    if not model:
        raise RuntimeError(f"{provider_label} のモデル名が未指定です。")

    models_url = _openai_compatible_endpoint(normalized_base_url, "models")
    chat_url = _openai_compatible_endpoint(normalized_base_url, "chat/completions")

    emit_progress("llm_loading", f"{provider_label} に接続中... ({normalized_base_url})")
    session = _requests.Session()
    session.trust_env = False

    def _fetch_models_data():
        # コールドスタート時、サーバーはモデルの GPU ロード / 初回 CUDA カーネル JIT が
        # 終わるまで /v1/models に 503 を返す（ポートは先に開くため「起動済み」に見える）。
        # require_model_list=True のローカル内蔵 llama-server 経路では、ロード完了まで
        # 503 / 接続失敗をリトライする。外部サーバー（require_model_list=False）は従来どおり即時判定。
        deadline = time.monotonic() + (180.0 if require_model_list else 0.0)
        attempt = 0
        while True:
            attempt += 1
            try:
                r = session.get(models_url, timeout=60 if require_model_list else 10, allow_redirects=False)
            except _requests.exceptions.ConnectionError:
                if require_model_list and time.monotonic() < deadline:
                    emit_progress("llm_loading", f"{provider_label} の起動を待っています... (接続再試行 {attempt})")
                    time.sleep(2.0)
                    continue
                raise
            if r.status_code in (502, 503, 504) and require_model_list and time.monotonic() < deadline:
                emit_progress("llm_loading", f"{provider_label} がモデルをロード中です... (再試行 {attempt})")
                time.sleep(2.0)
                continue
            r.raise_for_status()
            return r.json()

    try:
        models_data = _fetch_models_data()
    except Exception as e:
        if require_model_list:
            raise RuntimeError(f"{provider_label} に接続できませんでした: {e}")
        emit_progress("llm_loading", f"モデル一覧取得失敗（続行）: {e}")
        models_data = {}

    available_ids = _collect_model_ids(models_data)
    emit_progress("llm_loading", f"利用可能なモデル: {available_ids or '(なし)'}")

    if available_ids and model not in available_ids:
        if fallback_to_first_model:
            fallback = available_ids[0]
            emit_progress("llm_loading", f"モデル '{model}' が見つかりません。'{fallback}' を使用します。")
            model = fallback
        else:
            raise RuntimeError(f"{provider_label} にモデル '{model}' が見つかりません。")

    emit_progress("llm_loading", f"{provider_label} 接続成功: {model}")

    batches = batch_segments_by_chars(segments)
    total_batches = len(batches)
    total_segments = len(segments)
    # 同時送信数（継続バッチング）。バッチ数を超えない範囲に丸める。
    workers = max(1, min(parallel, total_batches)) if total_batches else 1
    results_map: Dict[int, Dict] = {}
    results_lock = threading.Lock()
    progress = {"count": 0}

    def _process_batch(batch_idx: int) -> None:
        batch = batches[batch_idx]
        _prev_seg = batches[batch_idx - 1][-1] if batch_idx > 0 else None
        _next_seg = batches[batch_idx + 1][0] if batch_idx < total_batches - 1 else None
        prev_context = f"{_fmt_speaker(_prev_seg)}{_prev_seg['text']}" if _prev_seg else None
        next_context = f"{_fmt_speaker(_next_seg)}{_next_seg['text']}" if _next_seg else None

        emit_progress(
            "overall_proofread",
            f"バッチ {batch_idx + 1}/{total_batches} を処理中...",
            total=total_segments,
        )

        messages = build_chat_messages(batch, prev_context, next_context)
        max_tokens = min(6144, max(512, len(batch) * 300))
        # 最初の workers 個はモデルGPUロード待ちがあり得るため idle_timeout を長めにする
        idle_timeout = 60 if batch_idx < workers else 30

        payload: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": 0.15,
            "max_tokens": max_tokens,
        }
        if extra_payload:
            payload.update(extra_payload)

        raw_text = _stream_llm_chat(session, chat_url, payload, idle_timeout=idle_timeout)
        batch_results = extract_batch_result(raw_text, batch)
        # 共有状態の更新と累積進捗の emit は直列化する（結果は id で disjoint）
        with results_lock:
            results_map.update(batch_results)
            progress["count"] += len(batch)
            current = progress["count"]
        emit_progress(
            "overall_proofread",
            f"バッチ {batch_idx + 1}/{total_batches} 完了",
            current=current,
            total=total_segments,
        )

    if workers <= 1:
        for batch_idx in range(total_batches):
            _process_batch(batch_idx)
    else:
        emit_progress(
            "overall_proofread",
            f"並列処理中（同時 {workers} バッチ）...",
            current=0,
            total=total_segments,
        )
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(_process_batch, i) for i in range(total_batches)]
            for fut in as_completed(futures):
                fut.result()  # ワーカーの例外をここで再送出（fail-fast）

    session.close()
    return results_map


def overall_proofread_llm(
    segments: List[Dict], llm_url: str, llm_model: str,
) -> Dict[int, Dict]:
    return _run_openai_chat_batches(
        segments=segments,
        base_url=llm_url,
        model=llm_model,
        provider_label="AI校正エンジン",
        backend_name="lemonade",
        require_model_list=True,
        fallback_to_first_model=True,
        extra_payload={"chat_template_kwargs": {"enable_thinking": False}},
        parallel=_OVERALL_PARALLEL,
    )


def overall_proofread_openai_compatible(
    segments: List[Dict], base_url: str, model: str,
) -> Dict[int, Dict]:
    return _run_openai_chat_batches(
        segments=segments,
        base_url=base_url,
        model=model,
        provider_label="ローカルOpenAI互換API",
        backend_name="openai_compatible",
        require_model_list=False,
        fallback_to_first_model=False,
    )


def overall_proofread_llama_cpp(
    segments: List[Dict], model_path: str, n_gpu_layers: int,
    amd_mode: bool = False, n_ctx: int = 16384,
) -> Dict[int, Dict]:
    from llama_cpp import Llama

    emit_progress("llm_loading", "モデルを読み込み中...")
    gpu_msg = setup_amd_gpu_env() if amd_mode else setup_nvidia_gpu_env()
    emit_progress("llm_loading", gpu_msg)

    try:
        import llama_cpp as _lc
        if hasattr(_lc, "llama_supports_gpu_offload") and not _lc.llama_supports_gpu_offload():
            emit_progress("llm_loading", "警告: llama-cpp-python がGPU非対応ビルドです。")
            n_gpu_layers = 0
    except Exception:
        pass

    n_threads = max(1, (os.cpu_count() or 4) // 4)
    llm = Llama(
        model_path=model_path,
        n_ctx=max(4096, n_ctx),
        n_gpu_layers=n_gpu_layers,
        main_gpu=0,
        n_threads=n_threads,
        n_threads_batch=n_threads,
        verbose=False,
    )
    emit_progress("llm_loading", "モデルの読み込み完了")

    batches = batch_segments_by_chars(segments)
    total_batches = len(batches)
    total_segments = len(segments)
    processed_count = 0
    results_map: Dict[int, Dict] = {}

    for batch_idx, batch in enumerate(batches):
        _prev_seg = batches[batch_idx - 1][-1] if batch_idx > 0 else None
        _next_seg = batches[batch_idx + 1][0] if batch_idx < total_batches - 1 else None
        prev_context = f"{_fmt_speaker(_prev_seg)}{_prev_seg['text']}" if _prev_seg else None
        next_context = f"{_fmt_speaker(_next_seg)}{_next_seg['text']}" if _next_seg else None

        emit_progress(
            "overall_proofread",
            f"バッチ {batch_idx + 1}/{total_batches} を処理中...",
            current=processed_count,
            total=total_segments,
        )

        prompt = build_batch_prompt(batch, prev_context, next_context)
        max_tokens = min(6144, max(512, len(batch) * 300))
        completion = llm(
            prompt,
            max_tokens=max_tokens,
            temperature=0.15,
            stop=["<turn|>", "<|turn>"],
            echo=False,
        )
        raw_text = completion["choices"][0]["text"] if completion["choices"] else ""
        batch_results = extract_batch_result(raw_text, batch)
        results_map.update(batch_results)
        processed_count += len(batch)

        emit_progress(
            "overall_proofread",
            f"バッチ {batch_idx + 1}/{total_batches} 完了",
            current=processed_count,
            total=total_segments,
        )

    del llm
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass

    return results_map


def main() -> int:
    global _PROMPT_TYPE, _SYSTEM_PROMPT_OVERRIDE_FILE, _OVERALL_PARALLEL
    force_utf8_stdio()
    args = parse_args()
    _PROMPT_TYPE = args.prompt_type
    if args.system_prompt_path:
        _SYSTEM_PROMPT_OVERRIDE_FILE = Path(args.system_prompt_path)
    if args.parallel:
        _OVERALL_PARALLEL = max(1, args.parallel)

    if args.backend in ("llama_cpp", "llama_cpp_rocm") and not args.model_path:
        print(json.dumps({
            "success": False,
            "error": {"message": "llama_cpp バックエンドではモデルパスが必要です。", "type": "validation_error"},
        }, ensure_ascii=False))
        return 1
    if args.backend == "openai_compatible" and (not args.openai_base_url or not args.openai_model):
        print(json.dumps({
            "success": False,
            "error": {"message": "openai_compatible バックエンドでは Base URL とモデル名が必要です。", "type": "validation_error"},
        }, ensure_ascii=False))
        return 1

    try:
        with open(args.segments_json_path, encoding="utf-8") as f:
            segments = json.load(f)

        if not segments:
            print(json.dumps({
                "success": False,
                "error": {"message": "セグメントが空です。", "type": "validation_error"},
            }, ensure_ascii=False))
            return 1

        emit_progress("overall_proofread", f"全体校正を開始します（セグメント数: {len(segments)}）")

        if args.backend == "lemonade":
            results_map = overall_proofread_llm(segments, args.llm_url, args.llm_model)
        elif args.backend == "openai_compatible":
            results_map = overall_proofread_openai_compatible(segments, args.openai_base_url, args.openai_model)
        elif args.backend == "llama_cpp_rocm":
            results_map = overall_proofread_llama_cpp(segments, args.model_path, args.n_gpu_layers, amd_mode=True, n_ctx=args.n_ctx)
        else:
            results_map = overall_proofread_llama_cpp(segments, args.model_path, args.n_gpu_layers, n_ctx=args.n_ctx)

        payload = build_result_payload(segments, results_map)
        print(json.dumps({"success": True, "result": payload}, ensure_ascii=False))
        return 0

    except Exception as exc:
        tb = traceback.format_exc()
        print(json.dumps({
            "success": False,
            "error": {
                "message": str(exc),
                "type": type(exc).__name__,
                "traceback": tb,
            },
        }, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
