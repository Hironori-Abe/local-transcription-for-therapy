"""jev 風「判定してから修正」校正の評価ハーネス（開発用。配布物には含めない）。

句読点付与（行ごとの校正）と全体校正を別々に評価する。いずれも内蔵の Gemma 4 E4B を
llama-server で起動し（本番と同じ -ngl 99 + MTP・FlashAttention on）、次を比べる。

句読点付与
  P0  現行: proofread_llm_cli.py で全行を校正
  P1  判定→修正: 行ごとに「句読点の修正が必要か」を Y/N で問い、確率がしきい値以上の行だけ
      proofread_llm_cli.py で校正する（句読点校正は各行を独立に処理するので、対象行だけ渡しても
      現行と同じ条件になる）

全体校正
  O0  現行: overall_proofread_cli.py で全行を校正
  O1  テーマのみ: 全文（長い場合は分割）からテーマを要約し、システムプロンプトに添えて全行を校正
  O2  テーマ＋判定→修正: テーマを添えて行ごとに「修正が必要か」を問い、しきい値以上の行だけ
      テーマ付きで校正する（前後の行は本当の隣の行を参考文として渡す）

判定は jev の Noul（真偽の確率）に相当する。E4B に Y/N の1トークンだけ答えさせ、logprobs の
P(Y) / (P(Y) + P(N)) を「修正が必要な確率」とする。行のまとまり（窓）を共有の状態として先に置き、
問う行の番号だけを最後に置くので、同じ窓の問いはプロンプトキャッシュが効く。

正解データは無いので、現行（P0 / O1）が変更した行を参照として、判定の見逃し率・対象行の割合・
所要時間を出し、人が見比べるための一覧（report.md）を書き出す。

使い方（リポジトリ直下。requests が入った Python で実行する）:
  .venv312-nvidia\\Scripts\\python.exe scripts\\proofread_gate_eval.py ^
      --input demo_data\\proofread-eval\\inputs\\10minutes.json --tasks punct,overall

  --server-url を渡すと起動済みの llama-server を使う（そのときは本番の起動条件にならない点に注意）。
  会話データはローカルの llama-server（127.0.0.1）にだけ送る。
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO = Path(__file__).resolve().parents[1]
SIDECAR = REPO / "python_sidecar"
sys.path.insert(0, str(SIDECAR))

import overall_proofread_cli as overall  # noqa: E402  (プロンプト・抽出処理を現行と共有する)

SPEAKER_ALIASES = {"SPEAKER_00": "Th", "SPEAKER_01": "Cl", "SPEAKER_02": "IP", "SPEAKER_03": "IP2", "SPEAKER_04": "IP3"}
THRESHOLD_SWEEP = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]

# ---- 判定（jev の Noul に相当）のプロンプト ------------------------------------------------

GATE_SYSTEM = {
    "punct": (
        "あなたは日本語の音声文字起こしの句読点を点検する係です。"
        "指定された1行について、句読点（、。！？）の追加・修正が必要なら Y、"
        "今のままで句読点が適切なら N とだけ答えてください。句読点以外（語句・表記）は判断に含めません。"
    ),
    "overall": (
        "あなたは日本語のカウンセリング・対話記録を点検する係です。"
        "指定された1行について、次のいずれかがあり修正が必要なら Y、そのままでよければ N とだけ答えてください。"
        "(1) 明らかな誤字・脱字・誤変換 (2) 不自然な単語・語尾・語順 (3) 句読点の不足や誤り "
        "(4) 会話のテーマから見て不自然な漢字（例: 動機→動悸、給食→休職） "
        "(5) 一人の発話として不自然（複数人の発言が混ざっている）。"
        "話し言葉らしさ（フィラー・くだけた表現・言いよどみ）は誤りではありません。"
    ),
}
GATE_QUESTION = {
    "punct": "行 [{id}] は句読点の追加・修正が必要ですか？ Y か N で答えてください。",
    "overall": "行 [{id}] は修正が必要ですか？ Y か N で答えてください。",
}

# 句読点: まとまり単位の判定（「この中に修正が必要な行はあるか」）と、各行 0/1 の判定
GROUP_GATE_SYSTEM = (
    "あなたは日本語の音声文字起こしの句読点を点検する係です。"
    "渡された数行の中に、句読点（、。！？）の追加・修正が必要な行が1行でもあれば Y、"
    "どの行も句読点が適切なら N とだけ答えてください。句読点以外（語句・表記）は判断に含めません。"
)
GROUP_GATE_QUESTION = "この中に、句読点の追加・修正が必要な行はありますか？ Y か N で答えてください。"
LABEL_GATE_SYSTEM = (
    "あなたは日本語の音声文字起こしの句読点を点検する係です。"
    "各行について、句読点（、。！？）の追加・修正が必要なら 1、適切なら 0 を付けてください。"
    "句読点以外（語句・表記）は判断に含めません。"
)
LABEL_GATE_QUESTION = "各行の番号のあとに 0 か 1 を付けて、行の順に答えてください。"

# 全体校正: 修正案の検証（jev の Noul。直しすぎを捨てる）
VERIFY_SYSTEM = (
    "あなたは日本語のカウンセリング・対話記録の校正結果を検証する係です。"
    "元の文と修正案を比べ、修正案が採用してよいものなら Y、採用すべきでないなら N とだけ答えてください。"
    "採用してよいのは、音声認識の誤り（誤字・誤変換・脱字）や句読点を直し、話者が実際に言った言葉・言い回し・"
    "時制・語尾・意味を変えていない修正です。"
    "話し言葉を書き言葉に整える修正、語尾や助詞・丁寧さを変える修正、言っていない語を足す修正、"
    "根拠のない固有名詞への置き換えは採用すべきではありません。"
)
VERIFY_QUESTION = "この修正案を採用してよいですか？ Y か N で答えてください。"

SUMMARY_SYSTEM = (
    "あなたはカウンセリング・対話記録の内容を把握する係です。"
    "文字起こし（誤変換を含むことがある）を読み、校正の手がかりになるよう、"
    "会話のテーマ・話題の流れ・よく出てくる固有の語句（専門用語・人名の呼び方など）を"
    "日本語で300字以内にまとめてください。推測で内容を足さないでください。"
)
SUMMARY_MERGE_SYSTEM = (
    "あなたはカウンセリング・対話記録の内容を把握する係です。"
    "同じ会話を区切って要約したものを渡すので、会話全体のテーマ・話題の流れ・よく出てくる固有の語句を"
    "日本語で300字以内にまとめ直してください。"
)
THEME_SECTION = "\n\n会話のテーマ（参考。誤変換かどうかの判断に使う。テーマに合わせて内容を書き換えない）：\n{theme}"


# ---- llama-server --------------------------------------------------------------------------

class Server:
    """本番の E4B 起動条件（-ngl 99・FlashAttention on・MTP）で llama-server を起動する。"""

    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.proc: Optional[subprocess.Popen] = None
        self.url = args.server_url or f"http://127.0.0.1:{args.port}"

    def __enter__(self) -> "Server":
        if self.args.server_url:
            return self
        model_dir = Path(self.args.model_dir)
        cmd = [
            str(self.args.llama_server), "-m", str(model_dir / "gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf"),
            "--port", str(self.args.port), "-ngl", "99", "--ctx-size", str(self.args.ctx),
            "--flash-attn", "on", "-np", str(self.args.np), "--host", "127.0.0.1",
        ]
        mtp = model_dir / "mtp-gemma-4-E4B-it.gguf"
        if self.args.mtp and mtp.exists():
            cmd += ["--spec-type", "draft-mtp", "--spec-draft-model", str(mtp), "--spec-draft-n-max", "3",
                    "--spec-draft-ngl", "99"]
        log = open(Path(self.args.out_dir) / "llama-server.log", "w", encoding="utf-8")
        self.proc = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT)
        deadline = time.time() + 180
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f"{self.url}/health", timeout=2) as r:
                    if r.status == 200:
                        return self
            except Exception:
                pass
            if self.proc.poll() is not None:
                raise RuntimeError("llama-server が起動直後に終了しました。llama-server.log を確認してください。")
            time.sleep(1)
        raise RuntimeError("llama-server の起動待ちがタイムアウトしました。")

    def __exit__(self, *exc: Any) -> None:
        if self.proc:
            self.proc.kill()
            self.proc.wait()

    def chat(self, body: Dict[str, Any], timeout: float = 600) -> Dict[str, Any]:
        body = {"model": "gemma", "chat_template_kwargs": {"enable_thinking": False}, **body}
        req = urllib.request.Request(
            f"{self.url}/v1/chat/completions", data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)


# ---- 入力 ----------------------------------------------------------------------------------

def normalize_ja_symbol_width(text: str) -> str:
    """アプリ（Rust の normalize_ja_symbol_width）と同じ全角化。日本語の直後の ? ! を全角にする。"""
    out = []
    keep_ascii = False
    for c in text:
        if c in "?!":
            out.append(c if keep_ascii else ("？" if c == "?" else "！"))
        else:
            keep_ascii = c.isascii() and c.isalnum()
            out.append(c)
    return "".join(out)


def load_segments(path: Path, limit: Optional[int], width_rule: bool = True) -> List[Dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    raw = data.get("segments") if isinstance(data, dict) else data
    if raw is None and isinstance(data, dict) and "transcriptionDataset" in data:  # LoTT の保存形式
        raw = [{"text": r.get("content", ""), "speaker": r.get("speakerValue"), "start": r.get("startTime"),
                "end": r.get("endTime")} for r in data["transcriptionDataset"]]
    segments = []
    for i, s in enumerate(raw or []):
        text = str(s.get("text", "")).strip()
        if width_rule:
            text = normalize_ja_symbol_width(text)
        speaker = s.get("speaker") or ""
        segments.append({"id": i, "text": text, "speaker": speaker,
                         "speakerLabel": SPEAKER_ALIASES.get(speaker, "Cl" if speaker else ""),
                         "start": s.get("start"), "end": s.get("end")})
    return segments[:limit] if limit else segments


# ---- 判定 ----------------------------------------------------------------------------------

def p_yes(response: Dict[str, Any]) -> float:
    choice = response["choices"][0]
    content = (choice.get("logprobs") or {}).get("content") or []
    if content:
        tops = content[0].get("top_logprobs") or []
        py = sum(math.exp(t["logprob"]) for t in tops if t["token"].strip().upper() == "Y")
        pn = sum(math.exp(t["logprob"]) for t in tops if t["token"].strip().upper() == "N")
        if py + pn > 0:
            return py / (py + pn)
    text = (choice.get("message") or {}).get("content", "").strip().upper()
    return 1.0 if text.startswith("Y") else 0.0


def gate(server: Server, segments: List[Dict[str, Any]], task: str, window: int, workers: int,
         theme: Optional[str] = None) -> List[float]:
    """行ごとに「修正が必要な確率」を返す。窓（window 行）を共有の状態として先に置き、問いを最後に置く。"""
    system = GATE_SYSTEM[task] + (THEME_SECTION.format(theme=theme) if theme else "")
    probs = [0.0] * len(segments)
    windows = [segments[i:i + window] for i in range(0, len(segments), window)]

    def run_window(w: List[Dict[str, Any]]) -> None:
        first, last = w[0]["id"], w[-1]["id"]
        before = segments[first - 1] if first > 0 else None
        after = segments[last + 1] if last + 1 < len(segments) else None
        lines = [f"[{s['id']}] {overall._fmt_speaker(s)}{s['text']}" for s in w]
        context = ""
        if before:
            context += f"前の文（参考・対象外）：{overall._fmt_speaker(before)}{before['text']}\n"
        if after:
            context += f"次の文（参考・対象外）：{overall._fmt_speaker(after)}{after['text']}\n"
        state = f"{context}\n文字起こし:\n" + "\n".join(lines)
        for s in w:
            if not s["text"]:
                continue
            res = server.chat({
                "messages": [{"role": "system", "content": system},
                             {"role": "user", "content": f"{state}\n\n{GATE_QUESTION[task].format(id=s['id'])}"}],
                "max_tokens": 1, "temperature": 0, "logprobs": True, "top_logprobs": 10,
            })
            probs[s["id"]] = p_yes(res)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(run_window, windows))
    return probs


def numbered(seg: Dict[str, Any]) -> str:
    return f"[{seg['id']}] {overall._fmt_speaker(seg)}{seg['text']}"


def group_gate(server: Server, segments: List[Dict[str, Any]], size: int, workers: int) -> List[float]:
    """size 行のまとまりごとに「この中に句読点の修正が必要な行はあるか」を問う。確率はまとまりの全行に付ける。"""
    probs = [0.0] * len(segments)
    groups = [segments[i:i + size] for i in range(0, len(segments), size)]

    def run(group: List[Dict[str, Any]]) -> None:
        lines = [numbered(s) for s in group if s["text"]]
        if not lines:
            return
        res = server.chat({
            "messages": [{"role": "system", "content": GROUP_GATE_SYSTEM},
                         {"role": "user", "content": "文字起こし:\n" + "\n".join(lines) + "\n\n" + GROUP_GATE_QUESTION}],
            "max_tokens": 1, "temperature": 0, "logprobs": True, "top_logprobs": 10,
        })
        p = p_yes(res)
        for s in group:
            probs[s["id"]] = p

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(run, groups))
    return probs


def label_gate(server: Server, segments: List[Dict[str, Any]], size: int, workers: int) -> List[float]:
    """size 行のまとまりを送り、各行に 0/1 を答えさせる。行番号を文法で固定し、数字のトークンの確率を読む。"""
    probs = [0.0] * len(segments)
    groups = [[s for s in segments[i:i + size] if s["text"]] for i in range(0, len(segments), size)]

    def run(group: List[Dict[str, Any]]) -> None:
        if not group:
            return
        grammar = "root ::= " + ' "\\n" '.join(f'"[{s["id"]}] " d' for s in group) + '\nd ::= "0" | "1"'
        res = server.chat({
            "messages": [{"role": "system", "content": LABEL_GATE_SYSTEM},
                         {"role": "user", "content": "文字起こし:\n" + "\n".join(numbered(s) for s in group)
                          + "\n\n" + LABEL_GATE_QUESTION}],
            "max_tokens": len(group) * 8, "temperature": 0, "logprobs": True, "top_logprobs": 10, "grammar": grammar,
        })
        steps = [c for c in (res["choices"][0].get("logprobs") or {}).get("content") or []
                 if c["token"].strip() in ("0", "1")]
        for s, step in zip(group, steps):
            tops = step.get("top_logprobs") or []
            p1 = sum(math.exp(t["logprob"]) for t in tops if t["token"].strip() == "1")
            p0 = sum(math.exp(t["logprob"]) for t in tops if t["token"].strip() == "0")
            probs[s["id"]] = p1 / (p1 + p0) if p1 + p0 else float(step["token"].strip() == "1")

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(run, groups))
    return probs


def verify_changes(server: Server, segments: List[Dict[str, Any]], revised: Dict[int, str], theme: str,
                   workers: int, context_lines: int) -> Dict[int, float]:
    """修正案を1件ずつ検証する（jev の Noul）。「採用してよい」確率を返す。対象は実質の変更がある行だけ。"""
    targets = [s for s in segments if revised[s["id"]].translate(WIDTH_ONLY) != s["text"].translate(WIDTH_ONLY)]
    system = VERIFY_SYSTEM + THEME_SECTION.format(theme=theme)
    out: Dict[int, float] = {}
    lock = threading.Lock()

    def run(s: Dict[str, Any]) -> None:
        i = s["id"]
        near = [segments[j] for j in range(max(0, i - context_lines), min(len(segments), i + context_lines + 1))
                if j != i and segments[j]["text"]]
        ctx = "\n".join(f"{overall._fmt_speaker(n)}{n['text']}" for n in near)
        user = (f"周辺の発言（参考）：\n{ctx}\n\n元の文：{overall._fmt_speaker(s)}{s['text']}\n"
                f"修正案：{overall._fmt_speaker(s)}{revised[i]}\n\n{VERIFY_QUESTION}")
        res = server.chat({"messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                           "max_tokens": 1, "temperature": 0, "logprobs": True, "top_logprobs": 10})
        with lock:
            out[i] = p_yes(res)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(run, targets))
    return out


# ---- テーマ要約 -----------------------------------------------------------------------------

def summarize(server: Server, segments: List[Dict[str, Any]], max_chars: int) -> Dict[str, Any]:
    lines = [f"{overall._fmt_speaker(s)}{s['text']}" for s in segments if s["text"]]
    chunks: List[str] = []
    cur = ""
    for line in lines:
        if cur and len(cur) + len(line) + 1 > max_chars:
            chunks.append(cur)
            cur = ""
        cur += line + "\n"
    if cur:
        chunks.append(cur)

    def ask(system: str, text: str) -> str:
        res = server.chat({"messages": [{"role": "system", "content": system}, {"role": "user", "content": text}],
                           "max_tokens": 600, "temperature": 0.2})
        return res["choices"][0]["message"]["content"].strip()

    t = time.perf_counter()
    parts = [ask(SUMMARY_SYSTEM, c) for c in chunks]
    theme = parts[0] if len(parts) == 1 else ask(
        SUMMARY_MERGE_SYSTEM, "\n\n".join(f"【区切り {i + 1}】\n{p}" for i, p in enumerate(parts)))
    return {"theme": theme, "chunks": len(chunks), "seconds": time.perf_counter() - t}


# ---- 修正（現行の処理をそのまま使う） ------------------------------------------------------

def run_cli(script: str, segments: List[Dict[str, Any]], args: argparse.Namespace, url: str,
            system_prompt: Optional[str] = None) -> Dict[str, Any]:
    """現行の校正 CLI を内蔵 llama-server 経路と同じ引数で実行する。"""
    if not segments:
        return {"items": [], "seconds": 0.0}
    with tempfile.TemporaryDirectory() as tmp:
        seg_path = Path(tmp) / "segments.json"
        seg_path.write_text(json.dumps(segments, ensure_ascii=False), encoding="utf-8")
        cmd = [args.python, str(SIDECAR / script), "--segments-json-path", str(seg_path), "--backend",
               "llama_server", "--server-url", url, "--server-model", "gemma-4-E4B-it-qat",
               "--prompt-type", "gemma4", "--parallel", str(args.np)]
        if script == "proofread_llm_cli.py":
            cmd += ["--max-batch", "40"]
        if system_prompt:
            sp_path = Path(tmp) / "system.txt"
            sp_path.write_text(system_prompt, encoding="utf-8")
            cmd += ["--system-prompt-path", str(sp_path)]
        env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
        t = time.perf_counter()
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", env=env)
        seconds = time.perf_counter() - t
    out = overall_json(proc.stdout)
    if not out or not out.get("success"):
        raise RuntimeError(f"{script} が失敗しました: {proc.stdout[-500:]} {proc.stderr[-1500:]}")
    return {"items": out["result"]["items"], "seconds": seconds}


def overall_json(stdout: str) -> Optional[Dict[str, Any]]:
    for line in reversed(stdout.strip().splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                continue
    return None


def overall_with_theme(server: Server, segments: List[Dict[str, Any]], targets: List[Dict[str, Any]],
                       theme: str, workers: int, context_lines: int = 3) -> Dict[str, Any]:
    """全体校正をテーマ付きで targets の行だけに行う。前後の参考文は全文の本当の隣の行を使う。"""
    base = (SIDECAR / "prompt_templates" / "proofread" / "gemma4_overall.txt").read_text(encoding="utf-8").strip()
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
        f.write(base + THEME_SECTION.format(theme=theme))
        override = Path(f.name)
    overall._PROMPT_TYPE = "gemma4"
    overall._SYSTEM_PROMPT_OVERRIDE_FILE = override
    import requests  # 現行 CLI と同じ送信処理（_stream_llm_chat）を使う

    session = requests.Session()
    session.trust_env = False
    batches = overall.batch_segments_by_chars(targets)
    results: Dict[int, Dict[str, Any]] = {}
    lock = threading.Lock()

    def run_batch(batch: List[Dict[str, Any]]) -> None:
        first, last = batch[0]["id"], batch[-1]["id"]
        prev_seg = segments[first - 1] if first > 0 else None
        next_seg = segments[last + 1] if last + 1 < len(segments) else None
        prev_ctx = f"{overall._fmt_speaker(prev_seg)}{prev_seg['text']}" if prev_seg else None
        next_ctx = f"{overall._fmt_speaker(next_seg)}{next_seg['text']}" if next_seg else None
        messages = overall.build_chat_messages(batch, prev_ctx, next_ctx)
        if len(batch) < len(segments):
            # 対象の行だけにすると文脈が切れて直せなくなる（例: 「冬おこせだ」）。前後 context_lines 行を
            # 参考として添える。参考行は番号を付けずに示し、JSON の対象にならないようにする。
            target_ids = {s["id"] for s in batch}
            near = sorted({j for s in batch for j in range(s["id"] - context_lines, s["id"] + context_lines + 1)
                           if 0 <= j < len(segments) and j not in target_ids and segments[j]["text"]})
            if near:
                ref = "\n".join(f"（{j}）{overall._fmt_speaker(segments[j])}{segments[j]['text']}" for j in near)
                messages[1]["content"] = (f"周辺の発言（参考。校正の対象外。出力に含めない）：\n{ref}\n\n"
                                          f"校正の対象：\n{messages[1]['content']}")
        payload = {"model": "gemma", "messages": messages,
                   "temperature": 0.15, "max_tokens": min(6144, max(512, len(batch) * 300)),
                   "chat_template_kwargs": {"enable_thinking": False}}
        raw = overall._stream_llm_chat(session, f"{server.url}/v1/chat/completions", payload, idle_timeout=60)
        batch_result = overall.extract_batch_result(raw, batch)
        with lock:
            results.update(batch_result)

    t = time.perf_counter()
    try:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            list(ex.map(run_batch, batches))
    finally:
        override.unlink(missing_ok=True)
        session.close()
    items = overall.build_result_payload(targets, results)["items"]
    return {"items": items, "seconds": time.perf_counter() - t}


# ---- 集計 ----------------------------------------------------------------------------------

def revised_map(items: List[Dict[str, Any]]) -> Dict[int, str]:
    return {int(it["id"]): it.get("revisedText", it.get("originalText", "")) for it in items}


# 半角の ? ! を全角にするだけの変更は、ルールで機械的に直せる（判定・LLM の出番ではない）。
# 評価の参照・再現率はこれを除いた「実質の変更」で数える。
WIDTH_ONLY = str.maketrans({"?": "？", "!": "！"})


def changed_ids(segments: List[Dict[str, Any]], revised: Dict[int, str], substantive: bool = True) -> set:
    def key(text: str) -> str:
        return text.translate(WIDTH_ONLY) if substantive else text
    return {s["id"] for s in segments if key(revised.get(s["id"], s["text"])) != key(s["text"])}


def sweep(probs: List[float], reference: set, n: int) -> List[Dict[str, Any]]:
    rows = []
    for th in THRESHOLD_SWEEP:
        flagged = {i for i, p in enumerate(probs) if p >= th}
        hit = len(flagged & reference)
        rows.append({"threshold": th, "flagRate": len(flagged) / n if n else 0,
                     "recall": hit / len(reference) if reference else None, "flagged": len(flagged)})
    return rows


def merge(segments: List[Dict[str, Any]], partial: Dict[int, str]) -> Dict[int, str]:
    return {s["id"]: partial.get(s["id"], s["text"]) for s in segments}


def run_punct_fix(segments: List[Dict[str, Any]], probs: List[float], threshold: float,
                  args: argparse.Namespace, url: str) -> Dict[str, Any]:
    targets = [s for s in segments if probs[s["id"]] >= threshold and s["text"]]
    fixed = run_cli("proofread_llm_cli.py", targets, args, url)
    return {"targets": len(targets), "seconds": fixed["seconds"], "revised": merge(segments, revised_map(fixed["items"]))}


def evaluate_punct(server: Server, segments: List[Dict[str, Any]], args: argparse.Namespace) -> Dict[str, Any]:
    print("[punct] P0 現行（全行）...", flush=True)
    p0 = run_cli("proofread_llm_cli.py", segments, args, server.url)
    revised = {"P0": merge(segments, revised_map(p0["items"]))}
    variants: Dict[str, Any] = {"P0": {"label": "現行（全行）", "seconds": p0["seconds"]}}
    gates: Dict[str, List[float]] = {}
    for spec in [v.strip() for v in args.punct_variants.split(",") if v.strip()]:
        t = time.perf_counter()
        if spec == "line":
            key, label = "P1", "1行ずつ判定→修正"
            probs = gate(server, segments, "punct", args.window, args.np)
        elif spec.startswith("group"):
            size = int(spec[len("group"):])
            key, label = f"P2-{size}", f"{size}行まとめて「修正が必要な行はあるか」→該当のまとまりを修正"
            probs = group_gate(server, segments, size, args.np)
        elif spec.startswith("labels"):
            size = int(spec[len("labels"):])
            key, label = f"P3-{size}", f"{size}行まとめて各行に 0/1 →1の行を修正"
            probs = label_gate(server, segments, size, args.np)
        else:
            raise SystemExit(f"未知の --punct-variants: {spec}")
        gate_s = time.perf_counter() - t
        print(f"[punct] {key} 判定 {gate_s:.1f}s、修正...", flush=True)
        fixed = run_punct_fix(segments, probs, args.threshold, args, server.url)
        gates[key] = probs
        revised[key] = fixed["revised"]
        variants[key] = {"label": f"{label}（しきい値 {args.threshold}）", "seconds": gate_s + fixed["seconds"],
                         "gateSeconds": gate_s, "fixSeconds": fixed["seconds"], "targets": fixed["targets"]}
    return {"variants": variants, "reference": "P0", "gates": gates, "revised": revised}


def evaluate_overall(server: Server, segments: List[Dict[str, Any]], args: argparse.Namespace) -> Dict[str, Any]:
    n = len(segments)
    print("[overall] テーマ要約...", flush=True)
    summary = summarize(server, segments, args.summary_max_chars)
    print(f"[overall] テーマ: {summary['theme'][:120]}...", flush=True)
    print("[overall] O0 現行（全行）...", flush=True)
    o0 = run_cli("overall_proofread_cli.py", segments, args, server.url)
    o0_rev = merge(segments, revised_map(o0["items"]))
    print("[overall] O1 テーマのみ（全行）...", flush=True)
    o1 = overall_with_theme(server, segments, [s for s in segments if s["text"]], summary["theme"], args.np)
    o1_rev = merge(segments, revised_map(o1["items"]))
    print("[overall] 判定（テーマ付き）...", flush=True)
    t = time.perf_counter()
    probs = gate(server, segments, "overall", args.window, args.np, theme=summary["theme"])
    gate_s = time.perf_counter() - t
    targets = [s for s in segments if probs[s["id"]] >= args.threshold and s["text"]]
    print(f"[overall] O2 判定で残った {len(targets)}/{n} 行を校正...", flush=True)
    o2 = overall_with_theme(server, segments, targets, summary["theme"], args.np, args.context_lines)
    o2_rev = merge(segments, revised_map(o2["items"]))
    print("[overall] O3 O1 の修正案を1件ずつ検証...", flush=True)
    t = time.perf_counter()
    keep = verify_changes(server, segments, o1_rev, summary["theme"], args.np, args.context_lines)
    verify_s = time.perf_counter() - t
    o3_rev = {i: (o1_rev[i] if keep.get(i, 0.0) >= args.verify_threshold else segments[i]["text"])
              for i in o1_rev}
    return {
        "summary": summary,
        "variants": {
            "O0": {"label": "現行（全行）", "seconds": o0["seconds"]},
            "O1": {"label": "テーマのみ（全行）", "seconds": summary["seconds"] + o1["seconds"]},
            "O2": {"label": f"テーマ＋判定→修正（しきい値 {args.threshold}）",
                   "seconds": summary["seconds"] + gate_s + o2["seconds"], "gateSeconds": gate_s,
                   "fixSeconds": o2["seconds"], "targets": len(targets)},
            "O3": {"label": f"テーマ＋全行修正→修正案を検証（採用しきい値 {args.verify_threshold}）",
                   "seconds": summary["seconds"] + o1["seconds"] + verify_s, "verifySeconds": verify_s,
                   "fixSeconds": o1["seconds"], "verified": len(keep)},
        },
        "reference": "O1", "gates": {"O2": probs}, "verify": {str(i): p for i, p in keep.items()},
        "revised": {"O0": o0_rev, "O1": o1_rev, "O2": o2_rev, "O3": o3_rev},
    }


# 全体校正 O4: 修正案を変更箇所ごとに分け、語句の変更だけを1箇所ずつ検証して、採用した箇所だけ反映する
PUNCT_CHARS = set("、。，．,.！？!?…・ 　「」『』（）()")
SPAN_VERIFY_SYSTEM = (
    "あなたは日本語のカウンセリング・対話記録の音声認識結果を検証する係です。"
    "文の一部を書き換える提案について、それが音声認識の聞き間違い・誤変換・脱字の訂正（話者が実際にはそう言ったはず）"
    "なら Y、言い回し・語尾・時制・丁寧さ・助詞を整えただけ、または言っていない語を足しただけなら N とだけ答えてください。"
    "根拠のない固有名詞への置き換えも N です。"
)
SPAN_VERIFY_QUESTION = "この書き換えは、音声認識の聞き間違い・誤変換の訂正ですか？ Y か N で答えてください。"


def edit_spans(original: str, revised: str) -> List[Dict[str, Any]]:
    """文字単位の差分を、変更箇所（元の範囲・置き換え後の文字列・句読点だけか）の並びにする。"""
    import difflib

    spans = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=original, b=revised, autojunk=False).get_opcodes():
        if tag == "equal":
            continue
        before, after = original[i1:i2], revised[j1:j2]
        spans.append({"i1": i1, "i2": i2, "before": before, "after": after,
                      "punctOnly": all(c in PUNCT_CHARS for c in before + after)})
    return spans


def apply_spans(original: str, spans: List[Dict[str, Any]]) -> str:
    out, pos = [], 0
    for sp in spans:
        out.append(original[pos:sp["i1"]])
        out.append(sp["after"] if sp["accept"] else sp["before"])
        pos = sp["i2"]
    out.append(original[pos:])
    return "".join(out)


def verify_spans(server: Server, segments: List[Dict[str, Any]], revised: Dict[int, str], theme: str,
                 workers: int, context_lines: int, threshold: float) -> Dict[str, Any]:
    system = SPAN_VERIFY_SYSTEM + THEME_SECTION.format(theme=theme)
    jobs = []
    plans: Dict[int, List[Dict[str, Any]]] = {}
    for s in segments:
        i = s["id"]
        if revised[i] == s["text"]:
            continue
        spans = edit_spans(s["text"], revised[i])
        plans[i] = spans
        for sp in spans:
            sp["accept"] = sp["punctOnly"]
            if not sp["punctOnly"]:
                jobs.append((s, sp))

    def run(job: Any) -> None:
        s, sp = job
        i = s["id"]
        near = [segments[j] for j in range(max(0, i - context_lines), min(len(segments), i + context_lines + 1))
                if j != i and segments[j]["text"]]
        ctx = "\n".join(f"{overall._fmt_speaker(n)}{n['text']}" for n in near)
        a, b = max(0, sp["i1"] - 8), min(len(s["text"]), sp["i2"] + 8)
        user = (f"周辺の発言（参考）：\n{ctx}\n\n対象の文：{overall._fmt_speaker(s)}{s['text']}\n"
                f"書き換えの提案：「{s['text'][a:sp['i1']]}【{sp['before'] or '（なし）'}】{s['text'][sp['i2']:b]}」を"
                f"「{s['text'][a:sp['i1']]}【{sp['after'] or '（削除）'}】{s['text'][sp['i2']:b]}」にする\n\n"
                f"{SPAN_VERIFY_QUESTION}")
        res = server.chat({"messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                           "max_tokens": 1, "temperature": 0, "logprobs": True, "top_logprobs": 10})
        sp["p"] = p_yes(res)
        sp["accept"] = sp["p"] >= threshold

    t = time.perf_counter()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(run, jobs))
    result = {i: s["text"] for i, s in ((s["id"], s) for s in segments)}
    for i, spans in plans.items():
        result[i] = apply_spans(segments[i]["text"], spans)
    return {"revised": result, "seconds": time.perf_counter() - t, "spans": len(jobs),
            "rejected": sum(1 for _, sp in jobs if not sp["accept"]),
            "detail": {str(i): [{k: sp.get(k) for k in ("before", "after", "punctOnly", "p", "accept")} for sp in spans]
                       for i, spans in plans.items()}}


def extend_with_o4(saved_path: Path, segments: List[Dict[str, Any]], args: argparse.Namespace) -> None:
    """保存済みの results.json（O1 とテーマ要約）を使い、O4 だけを追加で実行してレポートを作り直す。"""
    saved = json.loads(saved_path.read_text(encoding="utf-8"))
    for res in saved["results"].values():
        res["revised"] = {k: {int(i): t for i, t in v.items()} for k, v in res["revised"].items()}
    res = saved["results"]["overall"]
    with Server(args) as server:
        print("[overall] O4 O1 の修正案を変更箇所ごとに検証...", flush=True)
        o4 = verify_spans(server, segments, res["revised"]["O1"], res["summary"]["theme"], args.np,
                          args.context_lines, args.verify_threshold)
    o1 = res["variants"]["O1"]
    res["variants"]["O4"] = {"label": f"テーマ＋全行修正→変更箇所ごとに検証（採用しきい値 {args.verify_threshold}）",
                             "seconds": o1["seconds"] + o4["seconds"], "verifySeconds": o4["seconds"],
                             "fixSeconds": o1["seconds"] - res["summary"]["seconds"], "verified": o4["spans"]}
    res["revised"]["O4"] = o4["revised"]
    res["o4Spans"] = o4["detail"]
    saved["args"]["verify_threshold"] = args.verify_threshold
    saved_path.write_text(json.dumps(saved, ensure_ascii=False, indent=1), encoding="utf-8")
    for k in ("threshold", "window", "np", "mtp", "width_rule"):
        if k in saved["args"]:
            setattr(args, k, saved["args"][k])
    write_report(saved_path.parent, Path(args.input).stem, segments, saved["results"], args)
    print(f"O4: 語句の変更 {o4['spans']} 箇所のうち {o4['rejected']} 箇所を採用せず / {o4['seconds']:.1f}s")


# ---- レポート ------------------------------------------------------------------------------

def md_escape(text: str) -> str:
    return text.replace("|", "｜").replace("\n", " ")


def write_report(out_dir: Path, name: str, segments: List[Dict[str, Any]], results: Dict[str, Any],
                 args: argparse.Namespace) -> None:
    lines = [f"# 判定→修正 校正の評価: {name}", "",
             f"- 行数: {len(segments)} / 文字数: {sum(len(s['text']) for s in segments)}",
             f"- 判定のしきい値: {args.threshold} / 検証の採用しきい値: {args.verify_threshold} / 1行判定の窓: {args.window} 行 "
             f"/ 並列: {args.np} / MTP: {'on' if args.mtp else 'off'} / 全角化ルール: {'on' if args.width_rule else 'off'}",
             f"- 実行: {datetime.now().isoformat(timespec='seconds')}", ""]
    for task, res in results.items():
        title = "句読点付与" if task == "punct" else "全体校正"
        lines += [f"## {title}", ""]
        if "summary" in res:
            s = res["summary"]
            lines += [f"テーマ要約（{s['chunks']} 分割・{s['seconds']:.1f} 秒）:", "", f"> {md_escape(s['theme'])}", ""]
        lines += ["| 方式 | 所要時間 | 校正した行 | 変更（実質） | 変更（全角化を含む） | 内訳 |",
                  "|---|---|---|---|---|---|"]
        for key, v in res["variants"].items():
            if "gateSeconds" in v:
                detail = f"判定 {v['gateSeconds']:.1f}s + 修正 {v['fixSeconds']:.1f}s"
            elif "verifySeconds" in v:
                detail = f"修正 {v['fixSeconds']:.1f}s + 検証 {v['verifySeconds']:.1f}s（{v['verified']} 件）"
            else:
                detail = ""
            rev = res["revised"][key]
            lines.append(f"| {key} {v['label']} | {v['seconds']:.1f}s | {v.get('targets', len(segments))} | "
                         f"{len(changed_ids(segments, rev))} | {len(changed_ids(segments, rev, substantive=False))} | {detail} |")
        ref = res["reference"]
        reference = changed_ids(segments, res["revised"][ref])
        for gkey, probs in res.get("gates", {}).items():
            lines += ["", f"{gkey} の判定: しきい値ごとの対象行の割合と、{ref} の実質の変更をどれだけ拾えるか"
                      "（見逃し率 = 1 − 再現率）:", "",
                      "| しきい値 | 対象行 | 対象行の割合 | 再現率 |", "|---|---|---|---|"]
            for row in sweep(probs, reference, len(segments)):
                recall = "-" if row["recall"] is None else f"{row['recall']:.0%}"
                lines.append(f"| {row['threshold']} | {row['flagged']} | {row['flagRate']:.0%} | {recall} |")
        if "verify" in res:
            probs = res["verify"]
            rejected = sum(1 for p in probs.values() if p < args.verify_threshold)
            lines += ["", f"O3 の検証: O1 の実質の変更 {len(probs)} 件のうち、{rejected} 件を「話者の言葉や意味を変えている」として採用しなかった。"]
        keys = list(res["revised"].keys())
        diff_ids = [s["id"] for s in segments
                    if any(res["revised"][k][s["id"]].translate(WIDTH_ONLY) != s["text"].translate(WIDTH_ONLY) for k in keys)]
        prob_cols = list(res.get("gates", {}).keys()) + (["検証"] if "verify" in res else [])
        lines += ["", f"### 実質の変更があった行（{len(diff_ids)} 行）", "",
                  "| # | " + " | ".join(f"{c} 確率" for c in prob_cols) + " | 元 | " + " | ".join(keys) + " |",
                  "|---|" + "---|" * len(prob_cols) + "---|" + "---|" * len(keys)]
        for i in diff_ids:
            cells = [md_escape(res["revised"][k][i]) if res["revised"][k][i] != segments[i]["text"] else "（変更なし）"
                     for k in keys]
            lines.append(f"| {i} | " + " | ".join(prob_text(res, c, i) for c in prob_cols)
                         + f" | {md_escape(segments[i]['text'])} | " + " | ".join(cells) + " |")
        lines.append("")
        write_review_sheet(out_dir / f"review-{task}.csv", segments, res, prob_cols)
    (out_dir / "report.md").write_text("\n".join(lines), encoding="utf-8")


def prob_text(res: Dict[str, Any], column: str, i: int) -> str:
    if column == "検証":
        p = res["verify"].get(str(i))
        return "" if p is None else f"{p:.2f}"
    return f"{res['gates'][column][i]:.2f}"


def write_review_sheet(path: Path, segments: List[Dict[str, Any]], res: Dict[str, Any], prob_cols: List[str]) -> None:
    """実質の変更があった行を、人が「正しい修正か・直しすぎか」を付けるための表にする（Excel で開ける UTF-8 BOM）。

    各方式の「判定」欄に 正（正しい修正）／誤（誤った修正・直しすぎ）を書き込む。
    どの方式も直していないが直すべき行に気づいたら、備考に書く。
    """
    import csv

    keys = list(res["revised"].keys())

    def differs(a: str, b: str) -> bool:
        return a.translate(WIDTH_ONLY) != b.translate(WIDTH_ONLY)

    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["行"] + [f"{c} 確率" for c in prob_cols] + ["話者", "元"]
                   + [x for k in keys for x in (k, f"{k} 判定")] + ["備考"])
        for s in segments:
            i = s["id"]
            if not any(differs(res["revised"][k][i], s["text"]) for k in keys):
                continue
            cells: List[str] = []
            for k in keys:
                t = res["revised"][k][i]
                cells += [t if differs(t, s["text"]) else "", ""]
            w.writerow([i] + [prob_text(res, c, i) for c in prob_cols] + [s["speakerLabel"], s["text"]] + cells + [""])


def default_model_dir() -> Path:
    local = Path(os.environ.get("LOCALAPPDATA", "")) / "net.gakkousya.lott" / "models" / "llm" / "gemma-4-e4b-it"
    dev = SIDECAR / "models" / "llm" / "gemma-4-e4b-it"
    return dev if (dev / "gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf").exists() else local


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--input", required=True, help="文字起こし JSON（segments の配列、または LoTT の保存形式）")
    ap.add_argument("--tasks", default="punct,overall")
    ap.add_argument("--threshold", type=float, default=0.3)
    ap.add_argument("--window", type=int, default=20, help="判定で共有する行のまとまり")
    ap.add_argument("--limit", type=int, default=None, help="先頭 N 行だけで試す")
    ap.add_argument("--punct-variants", default="group5,group10,labels10",
                    help="句読点の判定方式（line / groupN / labelsN をカンマ区切り）")
    ap.add_argument("--verify-threshold", type=float, default=0.5, help="O3 で修正案を採用する確率の下限")
    ap.add_argument("--no-width-rule", dest="width_rule", action="store_false",
                    help="入力に全角化ルールをかけない（アプリの全角化導入前の状態で比べる）")
    ap.add_argument("--context-lines", type=int, default=3, help="O2 の修正で対象行の前後に添える参考行の数")
    ap.add_argument("--summary-max-chars", type=int, default=12000, help="これを超える文字起こしは分割して要約する")
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--server-url", default=None)
    ap.add_argument("--llama-server", default=str(REPO / "src-tauri" / "resources" / "llama-server-vulkan" / "llama-server.exe"),
                    help="llama-server executable; pass this path explicitly because the current Vulkan bundle does not include it")
    ap.add_argument("--model-dir", default=str(default_model_dir()))
    ap.add_argument("--port", type=int, default=18998)
    ap.add_argument("--ctx", type=int, default=32768, help="総コンテキスト長（各スロットは ctx / np）")
    ap.add_argument("--np", type=int, default=4, help="並列スロット数（校正 CLI の --parallel にも使う）")
    ap.add_argument("--no-mtp", dest="mtp", action="store_false")
    ap.add_argument("--python", default=sys.executable, help="校正 CLI を動かす Python（requests が必要）")
    ap.add_argument("--extend-o4", default=None, help="保存済みの results.json に O4 だけを追加で実行する")
    ap.add_argument("--rebuild-report", default=None, help="保存済みの results.json からレポートだけを作り直す")
    args = ap.parse_args()

    if args.extend_o4:
        saved_path = Path(args.extend_o4)
        args.out_dir = str(saved_path.parent)
        extend_with_o4(saved_path, load_segments(Path(args.input), args.limit, args.width_rule), args)
        return 0

    if args.rebuild_report:
        saved_path = Path(args.rebuild_report)
        saved = json.loads(saved_path.read_text(encoding="utf-8"))
        for res in saved["results"].values():
            res["revised"] = {k: {int(i): t for i, t in v.items()} for k, v in res["revised"].items()}
        for k in ("threshold", "window", "np", "mtp", "verify_threshold", "width_rule"):
            if k in saved["args"]:
                setattr(args, k, saved["args"][k])
        segments = load_segments(Path(args.input), saved["args"].get("limit"), args.width_rule)
        write_report(saved_path.parent, Path(args.input).stem, segments, saved["results"], args)
        print(f"レポート: {saved_path.parent / 'report.md'}")
        return 0

    input_path = Path(args.input)
    name = input_path.stem
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    args.out_dir = args.out_dir or str(REPO / "demo_data" / "proofread-eval" / "results" / f"{name}-{stamp}")
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    segments = load_segments(input_path, args.limit, args.width_rule)
    tasks = [t.strip() for t in args.tasks.split(",") if t.strip()]

    results: Dict[str, Any] = {}
    with Server(args) as server:
        for task in tasks:
            if task == "punct":
                results[task] = evaluate_punct(server, segments, args)
            elif task == "overall":
                results[task] = evaluate_overall(server, segments, args)
            else:
                raise SystemExit(f"未知の tasks: {task}")
            (out_dir / "results.json").write_text(json.dumps(
                {"input": str(input_path), "args": {k: v for k, v in vars(args).items()}, "results": results},
                ensure_ascii=False, indent=1), encoding="utf-8")
    write_report(out_dir, name, segments, results, args)
    for task, res in results.items():
        for key, v in res["variants"].items():
            changed = len(changed_ids(segments, res["revised"][key]))
            print(f"{task} {key} {v['label']}: {v['seconds']:.1f}s 実質の変更={changed}")
    print(f"レポート: {out_dir / 'report.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
