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

SKIP_THRESHOLD = 1        # この文字数以下のセグメントはLLM処理をスキップ
TRAILING_PUNCTUATION = set("、。！？…・")  # 末尾句読点判定用
MIN_BATCH_CHARS = 60      # バッチの最小合計文字数（不足時は次バッチと結合）
MAX_BATCH_SEGMENTS = 40   # バッチの最大セグメント数（llama_cpp用）
MAX_BATCH_SEGMENTS_LEMONADE = 40  # 内蔵 llama-server 経路用（backend 名は後方互換で lemonade）

_SYSTEM_PROMPT_FILE = Path(__file__).parent / "prompt_templates" / "proofread" / "gemma4_system.txt"
_SYSTEM_PROMPT_OVERRIDE_FILE: Optional[Path] = None
_PROMPT_TYPE: str = "gemma4"
_ORIGINAL_TYPE_USER_SUFFIX = (
    "番号付きのすべてのテキストを校正し、以下のJSON配列形式のみで返答してください。"
    "説明・前置き・マークダウンは不要です。\n"
    '[{"id": <番号>, "result": "校正後テキスト", "changed": "変更内容（変更なしは空文字）"}]'
)
_DEFAULT_SYSTEM_INSTRUCTION = (
    "あなたは日本語の音声文字起こしテキストを校正するアシスタントです。各セグメントは独立して処理し、他セグメントとの統合・削除は行わないでください。\n"
    "校正ルール：句読点（、。！？）は積極的に追加・修正する。会話フィラー（あー・えーとなど）はそのまま残す。明らかな誤字脱字と余計な半角スペースは修正・削除する。それ以外の言葉・表現は変更しない。"
)

# --- GBNF 制約付きデコード ---------------------------------------------------
# 「語（句読点以外の文字）は原文どおり順序固定。前後に句読点だけ挿入/置換/削除可」を
# デコード段階で強制し、語の改変・捏造（ハリュシネーション）を構造的に防ぐ。gemma4 契約と一致。
_GRAMMAR_MODE: str = "auto"  # auto|on|off  auto は gemma4 経路のみ ON
_FLEX_PUNCT = "、。！？!?…・"  # 挿入/置換/削除を許可する句読点（スケルトンからは除外する）

# --- 並列ディスパッチ（継続バッチング） -------------------------------------
# llama-server を複数スロット (-np N) で起動し、サイドカーから複数バッチを同時送信して
# GPU のアイドル時間（HTTP往復・JSON解析・次バッチ準備）を埋める。バッチ処理は順序非依存
# （context は静的、結果は id で disjoint に集約）なので並列化しても結果は同一。
# 内蔵 llama-server 経路（backend 名は後方互換で lemonade）のみ。
# openai 互換は外部サーバー負荷を避け 1 固定。
_LEMONADE_PARALLEL: int = 1
# emit_progress / emit_event の stderr 書き込みを直列化し、ワーカースレッドからの
# 行の混線を防ぐ。
_EMIT_LOCK = threading.Lock()
_GRAMMAR_USER_SUFFIX = (
    "番号付きのすべてのテキストを校正し、句読点（、。！？）のみを追加・修正してください。"
    "語句は一切変更しないでください。以下のJSON配列形式のみで返答してください。"
    "説明・前置き・マークダウンは不要です。\n"
    '[{"id": <番号>, "result": "校正後テキスト"}]'
)


def _grammar_active() -> bool:
    """gemma4 経路で GBNF 制約デコードを適用するか。auto は gemma4 のみ ON。"""
    if _GRAMMAR_MODE == "off":
        return False
    if _GRAMMAR_MODE == "on":
        return True
    return _PROMPT_TYPE == "gemma4"


def _gbnf_verbatim_literal(text: str) -> str:
    """text をそのまま（逐語）出力する GBNF 文字列リテラルを返す。
    GBNF リテラル内の \\ と " のみエスケープする。JSON の構造部
    （`{"id":N,"result":"` など、出力に生で現れる部分）に使う。"""
    gbnf_inner = text.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{gbnf_inner}"'


def _gbnf_string_literal(text: str) -> str:
    """text を「JSON文字列値の中身」として出力する GBNF 文字列リテラルを返す。
    戻り値リテラルが生成する出力バイト列は text を JSON エスケープしたものになる
    （非ASCIIは生のUTF-8のまま、" と \\ と制御文字のみエスケープ）。
    result の中の各文字に使う。"""
    escaped = json.dumps(text, ensure_ascii=False)[1:-1]
    return _gbnf_verbatim_literal(escaped)


def _build_batch_grammar(batch: List[Dict]) -> str:
    """バッチ出力 [{"id":N,"result":"..."}] を制約する GBNF を生成する。
    result の中身は各セグメントの非句読点文字を順序どおり必須とし、その前後に
    _FLEX_PUNCT の句読点（0〜2個）の挿入のみ許可する。"""
    p_alts = " | ".join(_gbnf_string_literal(c) for c in _FLEX_PUNCT)

    body_rules: List[str] = []
    item_rules: List[str] = []
    item_names: List[str] = []
    for i, seg in enumerate(batch):
        body_name = f"body{i}"
        item_name = f"item{i}"
        skeleton = [c for c in str(seg["text"]) if c not in _FLEX_PUNCT]
        if skeleton:
            parts = ["F"]
            for c in skeleton:
                parts.append(_gbnf_string_literal(c))
                parts.append("F")
            body_rules.append(f"{body_name} ::= {' '.join(parts)}")
        else:
            body_rules.append(f"{body_name} ::= F")
        prefix_lit = _gbnf_verbatim_literal(f'{{"id":{int(seg["id"])},"result":"')
        suffix_lit = _gbnf_verbatim_literal('"}')
        item_rules.append(f"{item_name} ::= {prefix_lit} {body_name} {suffix_lit}")
        item_names.append(item_name)

    inner = ' ws "," ws '.join(item_names)
    lines = [
        f'root ::= ws "[" ws {inner} ws "]" ws',
        f"P ::= {p_alts}",
        "F ::= P? P?",
        'ws ::= [ \\t\\n]*',
    ]
    lines.extend(body_rules)
    lines.extend(item_rules)
    return "\n".join(lines)


def _load_system_instruction() -> str:
    try:
        if _SYSTEM_PROMPT_OVERRIDE_FILE is not None:
            text = _SYSTEM_PROMPT_OVERRIDE_FILE.read_text(encoding="utf-8").strip()
            if text:
                return text
        text = _SYSTEM_PROMPT_FILE.read_text(encoding="utf-8").strip()
        return text if text else _DEFAULT_SYSTEM_INSTRUCTION
    except OSError:
        return _DEFAULT_SYSTEM_INSTRUCTION


def find_best_cuda_device() -> Optional[int]:
    """VRAMが最大のNVIDIA GPUのCUDAインデックスを返す。見つからない場合はNone。"""
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
    """VulkanデバイスリストからNVIDIA GPUのインデックスを返す。見つからない場合はNone。"""
    try:
        result = subprocess.run(
            ["vulkaninfo", "--summary"],
            capture_output=True, text=True, timeout=10,
        )
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
    """NVIDIA GPUを優先するよう環境変数を設定し、状況メッセージを返す。"""
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
    """ROCm GPUのインデックスを返す。見つからない場合はNone。"""
    try:
        result = subprocess.run(
            ["rocm-smi", "--showproductname", "--csv"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            return None
        data_lines = [
            l for l in result.stdout.strip().splitlines()
            if l.strip() and not l.strip().lower().startswith("device")
        ]
        return 0 if data_lines else None
    except Exception:
        return None


def find_amd_vulkan_device() -> Optional[int]:
    """VulkanデバイスリストからAMD GPUのインデックスを返す。見つからない場合はNone。"""
    try:
        result = subprocess.run(
            ["vulkaninfo", "--summary"],
            capture_output=True, text=True, timeout=10,
        )
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
            elif current_idx is not None and any(
                kw in line.upper() for kw in ("AMD", "RADEON", "RADV")
            ):
                return current_idx
        return None
    except Exception:
        return None


def setup_amd_gpu_env() -> str:
    """AMD GPU (ROCm/Vulkan) を優先するよう環境変数を設定し、状況メッセージを返す。"""
    rocm_idx = find_best_rocm_device()
    vulkan_idx = find_amd_vulkan_device()

    if rocm_idx is not None:
        os.environ["ROCR_VISIBLE_DEVICES"] = str(rocm_idx)
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="LLM-based proofreading sidecar")
    parser.add_argument("--segments-json-path", required=True)
    parser.add_argument("--model-path", default="")
    parser.add_argument("--n-gpu-layers", type=int, default=-1)
    parser.add_argument("--system-prompt-path", default=None)
    parser.add_argument(
        "--backend", default="llama_cpp",
        choices=["llama_cpp", "llama_cpp_rocm", "lemonade", "openai_compatible"],
    )
    parser.add_argument("--llm-url", default="http://localhost:13305")
    parser.add_argument("--llm-model", default="gemma-4-E4B-it-qat")
    parser.add_argument("--openai-base-url", default="")
    parser.add_argument("--openai-model", default="")
    parser.add_argument("--n-ctx", type=int, default=16384)
    parser.add_argument("--max-batch", type=int, default=40)
    parser.add_argument("--prompt-type", default="gemma4", choices=["gemma4", "original"])
    parser.add_argument(
        "--grammar", default="auto", choices=["auto", "on", "off"],
        help="GBNF制約デコード: auto=gemma4のみON / on=常にON / off=無効",
    )
    parser.add_argument(
        "--parallel", type=int, default=1,
        help="内蔵 llama-server 経路で同時送信するバッチ数（継続バッチング）。サーバーの -np 以下にする",
    )
    return parser.parse_args()


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


def emit_event(stage: str, **extra: object) -> None:
    payload: Dict[str, object] = {"stage": stage, **extra}
    line = f"PROGRESS_JSON:{json.dumps(payload, ensure_ascii=False)}\n"
    with _EMIT_LOCK:
        sys.stderr.write(line)
        sys.stderr.flush()


def group_segments_by_speaker(
    segments: List[Dict],
    min_batch_chars: int = MIN_BATCH_CHARS,
    max_batch_segments: int = MAX_BATCH_SEGMENTS,
) -> List[List[Dict]]:
    """話者ごとに連続するセグメントをグループ化し、短すぎるグループは結合する。
    話者情報がない場合はすべて同一話者として扱う。"""
    if not segments:
        return []

    # Step 1: 連続する同一話者でグループ化
    raw_groups: List[List[Dict]] = []
    current_group = [segments[0]]
    current_speaker = segments[0].get("speaker")

    for seg in segments[1:]:
        speaker = seg.get("speaker")
        if speaker == current_speaker:
            current_group.append(seg)
        else:
            raw_groups.append(current_group)
            current_group = [seg]
            current_speaker = speaker
    raw_groups.append(current_group)

    # Step 2: 大きすぎるグループを MAX_BATCH_SEGMENTS で分割
    split_groups: List[List[Dict]] = []
    for group in raw_groups:
        while len(group) > max_batch_segments:
            split_groups.append(group[:max_batch_segments])
            group = group[max_batch_segments:]
        if group:
            split_groups.append(group)

    # Step 3: 短すぎるグループを蓄積して MIN_BATCH_CHARS に達したらフラッシュ
    merged: List[List[Dict]] = []
    buffer: List[Dict] = []
    for group in split_groups:
        buffer.extend(group)
        total_chars = sum(len(s["text"]) for s in buffer)
        if total_chars >= min_batch_chars or len(buffer) >= max_batch_segments:
            merged.append(buffer)
            buffer = []

    if buffer:
        if merged:
            merged[-1].extend(buffer)
        else:
            merged.append(buffer)

    # Step 4: 最終ガード。結合後に上限を超えたバッチを必ず分割する。
    strict_batches: List[List[Dict]] = []
    for batch in merged:
        if len(batch) <= max_batch_segments:
            strict_batches.append(batch)
            continue
        for i in range(0, len(batch), max_batch_segments):
            strict_batches.append(batch[i : i + max_batch_segments])

    return strict_batches


def _fmt_speaker(seg: Dict) -> str:
    label = (seg.get("speakerLabel") or "").strip()
    return f"{label}: " if label and label != "-" else ""


def build_batch_prompt(
    batch: List[Dict],
    prev_context: Optional[str],
    next_context: Optional[str],
    grammar: bool = False,
) -> str:
    """バッチ校正プロンプトを組み立てる。_PROMPT_TYPE に応じてフォーマットを切り替える。"""
    if _PROMPT_TYPE == "original":
        return _build_batch_prompt_original(batch, prev_context, next_context)

    # Gemma4 フォーマット (<|turn> / <turn|>)
    context_lines = []
    if prev_context:
        context_lines.append(f"前の文（参考）：{prev_context}")
    if next_context:
        context_lines.append(f"次の文（参考）：{next_context}")
    context_section = "\n".join(context_lines) + "\n\n" if context_lines else ""

    numbered = "\n".join(f"[{seg['id']}] {_fmt_speaker(seg)}{seg['text']}" for seg in batch)

    system_instruction = _load_system_instruction()
    user_suffix = _GRAMMAR_USER_SUFFIX if grammar else _ORIGINAL_TYPE_USER_SUFFIX

    return (
        f"<|turn>system\n{system_instruction}<turn|>\n"
        f"<|turn>user\n"
        f"{context_section}"
        f"{numbered}\n\n{user_suffix}<turn|>\n"
        f"<|turn>model\n"
    )


def _build_batch_prompt_original(
    batch: List[Dict],
    prev_context: Optional[str],
    next_context: Optional[str],
) -> str:
    """オリジナルタイプ用プロンプト。特殊トークンなし、JSON指示をユーザー側に付加する。"""
    context_lines = []
    if prev_context:
        context_lines.append(f"前の文（参考）：{prev_context}")
    if next_context:
        context_lines.append(f"次の文（参考）：{next_context}")
    context_section = "\n".join(context_lines) + "\n\n" if context_lines else ""

    numbered = "\n".join(f"[{seg['id']}] {_fmt_speaker(seg)}{seg['text']}" for seg in batch)
    system_instruction = _load_system_instruction()
    user_content = f"{context_section}{numbered}\n\n{_ORIGINAL_TYPE_USER_SUFFIX}"
    return f"{system_instruction}\n\n{user_content}"


def _normalize_completion_text(raw_text: str) -> str:
    text = raw_text.strip()
    # Gemma4 thinking blocks appear before the final answer; strip them so
    # _pick_best_json_items does not pick up draft JSON from reasoning traces.
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


def _pick_best_json_items(text: str, expected_ids: Optional[set[int]] = None) -> Optional[List[Dict]]:
    # Models sometimes emit one array per segment rather than a single combined
    # array.  Merge items across all candidate arrays, keyed by segment ID so
    # that every segment gets its result regardless of how many arrays were
    # emitted.  First occurrence of each ID wins (earlier in text = more
    # authoritative output).
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
            if "result" not in item and "revisedText" not in item:
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


def _has_valid_result_json(text: str) -> bool:
    normalized = _normalize_completion_text(text)
    return _pick_best_json_items(normalized) is not None


def _count_batch_fallback_and_changed(batch_items: List[Dict]) -> tuple[int, int]:
    fallback_count = 0
    changed_count = 0
    for item in batch_items:
        original_text = str(item.get("originalText", ""))
        revised_text = str(item.get("revisedText", ""))
        reason_text = str(item.get("reason", ""))
        confidence_val = float(item.get("confidence", 0.0) or 0.0)
        if revised_text != original_text:
            changed_count += 1
        if revised_text == original_text and reason_text == "" and confidence_val <= 0.0:
            fallback_count += 1
    return fallback_count, changed_count


_TERMINAL_PUNCT = frozenset("。！？…!?")
_SKIP_ENDINGS = frozenset("」』）】〉》]")


def _apply_speaker_change_periods(
    batch: List[Dict],
    batch_results: Dict[int, Dict],
    next_batch_first_seg: Optional[Dict],
) -> None:
    """話者が変わる直前のセグメント末尾に句点（。）を確定的に付与する。
    LLMが指示を守らなかった場合の後処理として機能する。"""
    for i, seg in enumerate(batch):
        next_seg = batch[i + 1] if i + 1 < len(batch) else next_batch_first_seg
        if next_seg is None:
            continue
        if seg.get("speaker") == next_seg.get("speaker"):
            continue
        result = batch_results.get(seg["id"])
        if result is None:
            continue
        text = result["revisedText"]
        if not text:
            continue
        last = text[-1]
        if last in _TERMINAL_PUNCT or last in _SKIP_ENDINGS:
            continue
        if last == "、":
            result["revisedText"] = text[:-1] + "。"
        else:
            result["revisedText"] = text + "。"
        reason = result.get("reason") or ""
        result["reason"] = (reason + "、話者交代前に句点") if reason else "話者交代前に句点"
        result["confidence"] = max(float(result.get("confidence") or 0.0), 0.75)


def extract_batch_json_result(completion_text: str, batch: List[Dict]) -> Dict[int, Dict]:
    """バッチLLM出力からJSON配列をパースして segment_id → result dict のマップを返す。
    パースに失敗したセグメントはオリジナルテキストをそのまま返す。"""
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
            revised = str(item.get("result", item.get("revisedText", ""))).strip()
            change_desc = str(item.get("changed", item.get("reason", ""))).strip()
            # JSONの構造文字のみからなる値（例: "}", "]"）はモデルの誤出力なので除去する
            if change_desc and all(c in "{}[]|\\,; \t\r\n" for c in change_desc):
                change_desc = ""
            if not revised:
                continue
            # LLMが「（上記と結合）」などのメタ指示を誤出力した場合は原文を維持する
            if revised.startswith("（") and revised.endswith("）") and len(revised) <= 20:
                continue
            has_change = bool(change_desc) or revised != original["text"]
            result_map[seg_id] = {
                "id": seg_id,
                "originalText": original["text"],
                "revisedText": revised,
                "confidence": 0.85 if has_change else 0.0,
                "reason": change_desc,
            }

    # パースできなかったセグメントはオリジナルをそのまま返す
    for seg in batch:
        if seg["id"] not in result_map:
            result_map[seg["id"]] = {
                "id": seg["id"],
                "originalText": seg["text"],
                "revisedText": seg["text"],
                "confidence": 0.0,
                "reason": "",
            }

    return result_map


def build_chat_messages(
    batch: List[Dict],
    prev_context: Optional[str],
    next_context: Optional[str],
    grammar: bool = False,
) -> List[Dict]:
    """ローカル OpenAI-compatible chat completions API 用のメッセージリストを生成する。"""
    context_lines = []
    if prev_context:
        context_lines.append(f"前の文（参考）：{prev_context}")
    if next_context:
        context_lines.append(f"次の文（参考）：{next_context}")
    context_section = "\n".join(context_lines) + "\n\n" if context_lines else ""
    numbered = "\n".join(f"[{seg['id']}] {_fmt_speaker(seg)}{seg['text']}" for seg in batch)
    system_instruction = _load_system_instruction()
    user_suffix = _GRAMMAR_USER_SUFFIX if grammar else _ORIGINAL_TYPE_USER_SUFFIX
    user_content = f"{context_section}{numbered}\n\n{user_suffix}"
    return [
        {"role": "system", "content": system_instruction},
        {"role": "user", "content": user_content},
    ]


def _stream_llm_chat(
    session: "Any",
    url: str,
    payload: dict,
    idle_timeout: int,
) -> str:
    """SSEストリーミングでトークンを受信し、JSON配列 [...] が完結した時点で打ち切る。
    サーバーが stream=true をサポートしない場合も通常レスポンスとして動作する。"""

    payload = {**payload, "stream": True}
    full_text = ""
    bracket_depth = 0
    json_started = False

    with session.post(url, json=payload, stream=True, timeout=(10, idle_timeout), allow_redirects=False) as resp:
        resp.raise_for_status()
        resp.encoding = "utf-8"
        content_type = resp.headers.get("content-type", "")

        if "text/event-stream" in content_type:
            # SSEストリーミングモード: トークンごとに処理
            # Gemma4はthinking modeで reasoning_content → content の順に出力する。
            # content が空の場合は reasoning_content からJSONを抽出する。
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

                # JSON配列の閉じ括弧を検出して早期打ち切り
                for ch in delta:
                    if ch == "[":
                        bracket_depth += 1
                        json_started = True
                    elif ch == "]" and json_started:
                        bracket_depth -= 1
                        if bracket_depth <= 0:
                            # [171] などの断片で早期終了しないよう、有効な結果JSONを検出できた時だけ打ち切る
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
            # 非ストリーミングフォールバック: 全体を受信してから解析
            data_obj = resp.json()
            full_text = (
                (data_obj.get("choices") or [{}])[0]
                .get("message", {}).get("content") or ""
            )

    return full_text


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
    if not _is_loopback_local_openai_host(host):
        raise RuntimeError("外部送信防止のため、ローカルOpenAI互換APIは localhost / 127.x.x.x / ::1 のみ指定できます。")
    return normalized


def _is_loopback_local_openai_host(host: str) -> bool:
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


def _prepare_short_segment_results(segments: List[Dict]) -> tuple[List[Dict], Dict[int, Dict]]:
    to_process = [s for s in segments if len(s["text"]) > SKIP_THRESHOLD]
    results_map: Dict[int, Dict] = {}
    for s in segments:
        if len(s["text"]) > SKIP_THRESHOLD:
            continue
        text = s["text"]
        if len(text) == 1 and text not in TRAILING_PUNCTUATION and text:
            results_map[s["id"]] = {
                "id": s["id"],
                "originalText": text,
                "revisedText": text + "、",
                "confidence": 0.5,
                "reason": "「、」を追加",
            }
        else:
            results_map[s["id"]] = {
                "id": s["id"],
                "originalText": text,
                "revisedText": text,
                "confidence": 0.0,
                "reason": "too_short",
            }
    return to_process, results_map


def _proofread_segments_openai_chat(
    segments: List[Dict],
    base_url: str,
    model: str,
    provider_label: str,
    backend_name: str,
    max_batch_segments: int,
    require_model_list: bool,
    fallback_to_first_model: bool,
    extra_payload: Optional[Dict[str, Any]] = None,
    allow_grammar: bool = False,
    parallel: int = 1,
) -> List[Dict]:
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
        # 503 / 接続失敗をリトライする。外部 OpenAI 互換サーバー（require_model_list=False）は
        # 既に稼働している前提なので従来どおり即時に判定する（deadline=0 でリトライしない）。
        deadline = time.monotonic() + (180.0 if require_model_list else 0.0)
        attempt = 0
        while True:
            attempt += 1
            try:
                # llama-server 起動直後はモデル列挙に時間がかかるため timeout を長めに設定
                r = session.get(models_url, timeout=60 if require_model_list else 10, allow_redirects=False)
            except _requests.exceptions.ConnectionError:
                if require_model_list and time.monotonic() < deadline:
                    emit_progress("llm_loading", f"{provider_label} の起動を待っています... (接続再試行 {attempt})")
                    time.sleep(2.0)
                    continue
                raise
            # 502/503/504 はモデルロード中の一時的な応答。ロード完了まで待つ。
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
        # 接続エラーはチャットエンドポイントでも必ず失敗するため即時中断する
        if isinstance(e, _requests.exceptions.ConnectionError):
            raise RuntimeError(
                f"サーバーに接続できません（{normalized_base_url}）。"
                "LM Studio / Ollama などを起動してから再試行してください。"
            )
        emit_progress("llm_loading", f"{provider_label} のモデル一覧を取得できませんでした。指定モデルで続行します: {e}")
        models_data = {}

    available_ids = _collect_model_ids(models_data)

    emit_progress("llm_loading", f"利用可能なモデル: {available_ids or '(なし)'}")

    if available_ids and model not in available_ids:
        if fallback_to_first_model:
            fallback = available_ids[0]
            emit_progress(
                "llm_loading",
                f"モデル '{model}' が見つかりません。'{fallback}' を使用します。",
            )
            model = fallback
        else:
            raise RuntimeError(f"{provider_label} にモデル '{model}' が見つかりません。")
    elif not available_ids:
        emit_progress(
            "llm_loading",
            f"モデル一覧が空です。'{model}' で試みます。",
        )

    emit_progress("llm_loading", f"{provider_label} 接続成功: {model}")

    to_process, results_map = _prepare_short_segment_results(segments)
    batches = group_segments_by_speaker(
        to_process,
        min_batch_chars=MIN_BATCH_CHARS,
        max_batch_segments=max_batch_segments,
    )
    total_batches = len(batches)
    total_segments = len(segments)
    processed_count = total_segments - len(to_process)
    # 同時送信数（継続バッチング）。バッチ数を超えない範囲に丸める。
    workers = max(1, min(parallel, total_batches)) if total_batches else 1
    results_lock = threading.Lock()
    progress = {"count": processed_count}

    def _process_batch(batch_idx: int) -> None:
        batch = batches[batch_idx]
        _prev_seg = batches[batch_idx - 1][-1] if batch_idx > 0 else None
        _next_seg = batches[batch_idx + 1][0] if batch_idx < total_batches - 1 else None
        prev_context = f"{_fmt_speaker(_prev_seg)}{_prev_seg['text']}" if _prev_seg else None
        next_context = f"{_fmt_speaker(_next_seg)}{_next_seg['text']}" if _next_seg else None

        emit_event("batch_start", segmentIds=[s["id"] for s in batch])
        emit_progress("llm_loading", "準備中...", total=total_segments)

        use_grammar = allow_grammar and _grammar_active()
        messages = build_chat_messages(batch, prev_context, next_context, grammar=use_grammar)
        max_tokens = min(4096, max(512, len(batch) * 200))
        # 最初の workers 個はモデルGPUロード待ちがあり得るため idle_timeout を長めにする
        idle_timeout = 60 if batch_idx < workers else 30

        payload = {
            "model": model,
            "messages": messages,
            "temperature": 0.1,
            "max_tokens": max_tokens,
        }
        if extra_payload:
            payload.update(extra_payload)
        if use_grammar:
            try:
                payload["grammar"] = _build_batch_grammar(batch)
            except Exception as e:  # 文法生成失敗時は制約なしで継続
                emit_progress("llm_loading", f"GBNF文法の生成に失敗（制約なしで継続）: {e}")

        try:
            raw_text = _stream_llm_chat(
                session,
                chat_url,
                payload,
                idle_timeout=idle_timeout,
            )
        except _requests.exceptions.HTTPError as e:
            # サーバーが grammar 非対応なら制約なしで1回だけ再試行する
            if "grammar" in payload:
                emit_progress("llm_loading", f"grammar 非対応のため制約なしで再試行します: {e}")
                payload.pop("grammar", None)
                raw_text = _stream_llm_chat(
                    session,
                    chat_url,
                    payload,
                    idle_timeout=idle_timeout,
                )
            else:
                raise

        batch_results = extract_batch_json_result(raw_text, batch)
        _apply_speaker_change_periods(batch, batch_results, _next_seg)
        batch_items = list(batch_results.values())
        no_change_count, changed_count = _count_batch_fallback_and_changed(batch_items)
        json_detected = _has_valid_result_json(raw_text)
        all_no_change = len(batch_items) > 0 and no_change_count == len(batch_items)
        all_fallback = all_no_change and not json_detected

        emit_event(
            "llm_batch_debug",
            backend=backend_name,
            batchIndex=batch_idx + 1,
            totalBatches=total_batches,
            batchSize=len(batch),
            segmentIds=[s["id"] for s in batch],
            maxTokens=max_tokens,
            rawTextChars=len(raw_text),
            itemCount=len(batch_items),
            changedCount=changed_count,
            fallbackCount=no_change_count,
            allNoChange=all_no_change,
            jsonDetected=json_detected,
            allFallback=all_fallback,
        )
        if backend_name == "lemonade":
            emit_event(
                "llm_batch_debug",
                backend="lemonade",
                batchIndex=batch_idx + 1,
                totalBatches=total_batches,
                batchSize=len(batch),
                segmentIds=[s["id"] for s in batch],
                maxTokens=max_tokens,
                rawTextChars=len(raw_text),
                itemCount=len(batch_items),
                changedCount=changed_count,
                fallbackCount=no_change_count,
                allNoChange=all_no_change,
                jsonDetected=json_detected,
                allFallback=all_fallback,
            )
        if all_no_change:
            raw_preview = raw_text.replace("\n", "\\n")
            if len(raw_preview) > 320:
                raw_preview = raw_preview[:320] + "..."
            emit_event(
                "llm_batch_raw_preview",
                backend=backend_name,
                batchIndex=batch_idx + 1,
                totalBatches=total_batches,
                allFallback=all_fallback,
                jsonDetected=json_detected,
                preview=raw_preview,
            )
            if backend_name == "lemonade":
                emit_event(
                    "llm_batch_raw_preview",
                    batchIndex=batch_idx + 1,
                    totalBatches=total_batches,
                    allFallback=all_fallback,
                    jsonDetected=json_detected,
                    preview=raw_preview,
                )

        # 共有状態の更新と累積進捗の emit は直列化する（結果は id で disjoint）
        with results_lock:
            results_map.update(batch_results)
            progress["count"] += len(batch)
            current = progress["count"]
        emit_event(
            "batch_result",
            items=batch_items,
            current=current,
            total=total_segments,
        )

    if workers <= 1:
        for batch_idx in range(total_batches):
            _process_batch(batch_idx)
    else:
        emit_progress(
            "llm_loading",
            f"並列処理中（同時 {workers} バッチ）...",
            current=processed_count,
            total=total_segments,
        )
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(_process_batch, i) for i in range(total_batches)]
            for fut in as_completed(futures):
                fut.result()  # ワーカーの例外をここで再送出（fail-fast）

    session.close()
    return [results_map[s["id"]] for s in segments if s["id"] in results_map]


def proofread_segments_llm(
    segments: List[Dict], llm_url: str, llm_model: str,
    max_batch: int = MAX_BATCH_SEGMENTS_LEMONADE,
) -> List[Dict]:
    # chat_template_kwargs で thinking モードを無効化する。
    # llama-server は thinking=1 がデフォルト。このパラメータを渡しても無害。
    return _proofread_segments_openai_chat(
        segments=segments,
        base_url=llm_url,
        model=llm_model,
        provider_label="AI校正エンジン",
        backend_name="lemonade",
        max_batch_segments=max(1, max_batch),
        require_model_list=True,
        fallback_to_first_model=True,
        extra_payload={"chat_template_kwargs": {"enable_thinking": False}},
        allow_grammar=True,
        parallel=_LEMONADE_PARALLEL,
    )


def proofread_segments_openai_compatible(
    segments: List[Dict], base_url: str, model: str,
    max_batch: int = MAX_BATCH_SEGMENTS,
) -> List[Dict]:
    return _proofread_segments_openai_chat(
        segments=segments,
        base_url=base_url,
        model=model,
        provider_label="ローカルOpenAI互換API",
        backend_name="openai_compatible",
        max_batch_segments=max(1, max_batch),
        require_model_list=False,
        fallback_to_first_model=False,
    )


def proofread_segments(
    segments: List[Dict], model_path: str, n_gpu_layers: int, amd_mode: bool = False,
    n_ctx: int = 16384, max_batch: int = MAX_BATCH_SEGMENTS,
) -> List[Dict]:
    from llama_cpp import Llama

    emit_progress("llm_loading", "モデルを読み込み中...")

    gpu_msg = setup_amd_gpu_env() if amd_mode else setup_nvidia_gpu_env()
    emit_progress("llm_loading", gpu_msg)

    try:
        import llama_cpp as _lc
        if hasattr(_lc, "llama_supports_gpu_offload") and not _lc.llama_supports_gpu_offload():
            emit_progress(
                "llm_loading",
                "警告: llama-cpp-python がGPU非対応ビルドです。"
                "CUDA版への再インストールが必要です: "
                "set CMAKE_ARGS=-DGGML_CUDA=on && pip install llama-cpp-python --no-cache-dir",
            )
            n_gpu_layers = 0
    except Exception:
        pass

    import os
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

    # 短いセグメントはスキップ（1文字は末尾句読点を自動補完）
    to_process = [s for s in segments if len(s["text"]) > SKIP_THRESHOLD]
    results_map: Dict[int, Dict] = {}
    for s in segments:
        if len(s["text"]) > SKIP_THRESHOLD:
            continue
        text = s["text"]
        if len(text) == 1 and text not in TRAILING_PUNCTUATION and text:
            revised = text + "、"
            results_map[s["id"]] = {
                "id": s["id"],
                "originalText": text,
                "revisedText": revised,
                "confidence": 0.5,
                "reason": "「、」を追加",
            }
        else:
            results_map[s["id"]] = {
                "id": s["id"],
                "originalText": text,
                "revisedText": text,
                "confidence": 0.0,
                "reason": "too_short",
            }

    # 話者ごとにバッチ化
    batches = group_segments_by_speaker(to_process, max_batch_segments=max(1, max_batch))
    total_batches = len(batches)
    total_segments = len(segments)
    # スキップ済みセグメントを初期カウントとして計上
    processed_count = total_segments - len(to_process)

    for batch_idx, batch in enumerate(batches):
        _prev_seg = batches[batch_idx - 1][-1] if batch_idx > 0 else None
        _next_seg = batches[batch_idx + 1][0] if batch_idx < total_batches - 1 else None
        prev_context = f"{_fmt_speaker(_prev_seg)}{_prev_seg['text']}" if _prev_seg else None
        next_context = f"{_fmt_speaker(_next_seg)}{_next_seg['text']}" if _next_seg else None

        emit_event("batch_start", segmentIds=[s["id"] for s in batch])

        use_grammar = _grammar_active()
        prompt = build_batch_prompt(batch, prev_context, next_context, grammar=use_grammar)
        max_tokens = min(4096, max(512, len(batch) * 200))

        grammar_obj = None
        if use_grammar:
            try:
                from llama_cpp import LlamaGrammar
                grammar_obj = LlamaGrammar.from_string(_build_batch_grammar(batch))
            except Exception as e:  # 文法生成/解析失敗時は制約なしで継続
                emit_progress("llm_loading", f"GBNF文法の適用に失敗（制約なしで継続）: {e}")
                grammar_obj = None

        completion = llm(
            prompt,
            max_tokens=max_tokens,
            temperature=0.1,
            stop=["<turn|>", "<|turn>"],
            echo=False,
            grammar=grammar_obj,
        )

        raw_text = completion["choices"][0]["text"] if completion["choices"] else ""
        batch_results = extract_batch_json_result(raw_text, batch)
        _apply_speaker_change_periods(batch, batch_results, _next_seg)
        results_map.update(batch_results)
        batch_items = list(batch_results.values())
        no_change_count, changed_count = _count_batch_fallback_and_changed(batch_items)
        json_detected = _has_valid_result_json(raw_text)
        all_no_change = len(batch_items) > 0 and no_change_count == len(batch_items)
        all_fallback = all_no_change and not json_detected
        emit_event(
            "llm_batch_debug",
            backend="llama_cpp",
            batchIndex=batch_idx + 1,
            totalBatches=total_batches,
            batchSize=len(batch),
            segmentIds=[s["id"] for s in batch],
            maxTokens=max_tokens,
            rawTextChars=len(raw_text),
            itemCount=len(batch_items),
            changedCount=changed_count,
            fallbackCount=no_change_count,
            allNoChange=all_no_change,
            jsonDetected=json_detected,
            allFallback=all_fallback,
        )
        if all_no_change or no_change_count > 0:
            raw_preview = raw_text.replace("\n", "\\n")
            if len(raw_preview) > 600:
                raw_preview = raw_preview[:600] + "..."
            emit_event(
                "llm_batch_raw_preview",
                backend="llama_cpp",
                batchIndex=batch_idx + 1,
                totalBatches=total_batches,
                allFallback=all_fallback,
                jsonDetected=json_detected,
                noChangeCount=no_change_count,
                preview=raw_preview,
                segmentTexts=[s["text"] for s in batch],
            )

        processed_count += len(batch)
        emit_event(
            "batch_result",
            items=batch_items,
            current=processed_count,
            total=total_segments,
        )

    # 元の順序で返す
    ordered = [results_map[s["id"]] for s in segments if s["id"] in results_map]

    # CUDA VRAMを明示的に解放（プロセス終了後のVRAM残留を防ぐ）
    del llm
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass

    return ordered


def main() -> int:
    global _SYSTEM_PROMPT_OVERRIDE_FILE, _PROMPT_TYPE, _GRAMMAR_MODE, _LEMONADE_PARALLEL
    force_utf8_stdio()
    args = parse_args()
    if args.system_prompt_path:
        _SYSTEM_PROMPT_OVERRIDE_FILE = Path(args.system_prompt_path)
    if args.prompt_type:
        _PROMPT_TYPE = args.prompt_type
    if args.grammar:
        _GRAMMAR_MODE = args.grammar
    if args.parallel:
        _LEMONADE_PARALLEL = max(1, args.parallel)

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
            print(json.dumps({"success": False, "error": {"message": "セグメントが空です。", "type": "validation_error"}}, ensure_ascii=False))
            return 1

        if args.backend == "lemonade":
            items = proofread_segments_llm(segments, args.llm_url, args.llm_model, max_batch=args.max_batch)
        elif args.backend == "openai_compatible":
            items = proofread_segments_openai_compatible(segments, args.openai_base_url, args.openai_model, max_batch=args.max_batch)
        elif args.backend == "llama_cpp_rocm":
            items = proofread_segments(segments, args.model_path, args.n_gpu_layers, amd_mode=True, n_ctx=args.n_ctx, max_batch=args.max_batch)
        else:
            items = proofread_segments(segments, args.model_path, args.n_gpu_layers, n_ctx=args.n_ctx, max_batch=args.max_batch)

        print(json.dumps({
            "success": True,
            "result": {"items": items},
        }, ensure_ascii=False))
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
