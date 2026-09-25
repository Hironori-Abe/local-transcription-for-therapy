"""Vulkan 版 ggml エンジン（whisper.cpp / Nemotron）と llama-server（校正・音声入力）の計測。
Intel Arc などで、RTX 4060（docs/ggml-speech-engine-design.md 2.2・2.3）と比べるためのもの。

  python bench.py --engines <whisper と nemo を置いたフォルダ> --llama <llama-server.exe> [--device N] [--quick]

- 音声: demo_data/10minutes・50minutes の mp3（無ければその音声は飛ばす）
- モデル: python_sidecar/models/（whisper-ggml / nemotron-3-diarization / llm）。無いものは飛ばす
- GPU: 既定は nemo-speech doctor の一覧から「内蔵 GPU 以外で容量最大」を選ぶ（アプリの自動選択と同じ規則）
- 結果: results/<日時>/ に results.json と results.md（RTX 4060 の値と並べた表）
標準ライブラリだけで動く（psutil があればメモリも記録する）。音声・書き起こしの中身は results に書き出さない。
"""
import argparse, base64, datetime, json, os, platform, re, socket, subprocess, sys, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
MODELS = REPO / "python_sidecar" / "models"
PORT = 18556

# app と同じ whisper.cpp の引数（src-tauri/src/ggml_speech.rs の whisper_cli_args、フィラーを残す既定）
FILLER_PROMPT = re.search(r'FILLER_PROMPT: &str = "([^"]*)"',
                          (REPO / "src-tauri" / "src" / "ggml_speech.rs").read_text(encoding="utf-8")).group(1)

# RTX 4060 Laptop（Vulkan、2回目以降）の参考値
REFERENCE = {
    "whisper_10min": 20.0, "nemo_10min": 9.4, "whisper_50min": 71.4, "nemo_50min": 67.1,
    "llm_e4b": 12.1, "llm_12b": 63.3, "llm_audio": 4.1,
}

try:
    import psutil  # 任意
except ImportError:
    psutil = None


def log(msg):
    print(f"[arc-bench] {msg}", flush=True)


def run_timed(cmd, env=None, cwd=None, stdout_path=None):
    """実行時間と（psutil があれば）最大 RSS を測る。"""
    t0 = time.monotonic()
    out = open(stdout_path, "wb") if stdout_path else subprocess.DEVNULL
    p = subprocess.Popen(cmd, env=env, cwd=cwd, stdout=out, stderr=subprocess.PIPE)
    peak = 0
    while p.poll() is None:
        if psutil:
            try:
                peak = max(peak, psutil.Process(p.pid).memory_info().rss)
            except psutil.Error:
                pass
        time.sleep(0.25)
    err = p.stderr.read().decode("utf-8", "replace")
    if stdout_path:
        out.close()
    return {"exit": p.returncode, "seconds": round(time.monotonic() - t0, 2),
            "peak_rss_mb": round(peak / 2**20) if psutil else None}, err


def list_gpus(nemo):
    """nemo-speech doctor の Devices 一覧（index, kind, name, GiB）。並びは Vulkan の番号と同じ。"""
    out = subprocess.run([str(nemo), "doctor"], capture_output=True, text=True, errors="replace").stdout
    gpus = []
    for m in re.finditer(r"^\s*\[(\d+)\]\s+(\S+)\s+(.+?)\s+\(([\d.]+) GiB\)", out, re.M):
        if m.group(2) != "cpu":
            gpus.append({"index": int(m.group(1)), "kind": m.group(2), "name": m.group(3), "gib": float(m.group(4))})
    return gpus, out


def choose_gpu(gpus):
    discrete = [g for g in gpus if g["kind"] == "gpu"]
    pool = discrete or gpus
    return max(pool, key=lambda g: (g["gib"], -g["index"])) if pool else None


def to_wav(ffmpeg, src, dst):
    if dst.exists():
        return
    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-ac", "1", "-ar", "16000",
                    "-c:a", "pcm_s16le", str(dst)], check=True)


def whisper_run(engines, wav, work, tag, env):
    m = MODELS / "whisper-ggml"
    args = ["-m", str(m / "ggml-large-v3-turbo.bin"), "-f", wav.name, "-l", "ja", "-t", "8", "-bs", "3", "-bo", "3",
            "-mc", "56", "-lpt", "-1.0", "--vad", "-vm", str(m / "ggml-silero-v6.2.0.bin"), "-vt", "0.5",
            "-vspd", "200", "-vsd", "800", "-vp", "400", "-oj", "-of", tag, "-np", "--prompt", FILLER_PROMPT,
            "--carry-initial-prompt", "-ojf"]
    (work / "args.txt").write_bytes(("\n".join(args) + "\n").encode("utf-8"))  # アプリと同じ応答ファイル
    res, err = run_timed([str(engines / "whisper" / "bin" / "whisper-cli.exe"), "@args.txt"], env=env, cwd=work)
    out = work / f"{tag}.json"
    if res["exit"] == 0 and out.exists():
        d = json.loads(out.read_bytes().decode("utf-8", "replace"))
        segs = d.get("transcription", [])
        text = "".join(s["text"] for s in segs)
        starts = [s["offsets"]["from"] / 1000 for s in segs]
        ends = [s["offsets"]["to"] / 1000 for s in segs]
        res["segments"] = len(segs)
        res["chars"] = len(re.sub(r"\s", "", text))
        res["gaps_over_20s"] = sum(1 for a, b in zip(ends, starts[1:]) if b - a >= 20)
        res["repeat_loops"] = len(re.findall(r"(.{1,5})\1{5,}", re.sub(r"[\s、。？！]", "", text)))
        res["_text"] = text
        out.unlink()
    else:
        res["error_tail"] = err[-800:]
    return res


def nemo_run(engines, wav, work, env):
    out = work / "diar.json"
    res, err = run_timed([str(engines / "nemo" / "bin" / "nemo-speech.exe"), "diarize", str(wav), "--model",
                          str(MODELS / "nemotron-3-diarization" / "Nemotron-3-Diarization.q8_0.gguf"),
                          "--device", "vulkan:0", "--format", "json", "-o", str(out), "--force"], env=env)
    if res["exit"] == 0 and out.exists():
        segs = json.loads(out.read_text(encoding="utf-8")).get("segments", [])
        res["turns"] = len(segs)
        res["speakers"] = len({s["speaker"] for s in segs})
        out.unlink()
    else:
        res["error_tail"] = err[-800:]
    return res


def edit_ratio(a, b):
    """文字単位の編集距離 / len(b)（標準ライブラリだけの実装。10分音声程度なら数秒）。"""
    norm = lambda t: re.sub(r"[\s、。，．,.!?！？「」『』…・]", "", t)
    a, b = norm(a), norm(b)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        prev = cur
    return round(prev[-1] / max(len(b), 1) * 100, 1)


def llm_run(llama, env, server_args, body, reps):
    with socket.socket() as s:
        if s.connect_ex(("127.0.0.1", PORT)) == 0:
            return {"error": f"port {PORT} is in use"}
    t0 = time.monotonic()
    p = subprocess.Popen([str(llama), "--port", str(PORT), "--host", "127.0.0.1", *server_args], env=env,
                         stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    ready = None
    while time.monotonic() - t0 < 600 and p.poll() is None:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=2) as r:
                if r.status == 200:
                    ready = time.monotonic() - t0
                    break
        except Exception:
            time.sleep(0.5)
    res = {"load_seconds": round(ready, 1) if ready else None, "runs": []}
    if ready:
        for _ in range(reps):
            t = time.monotonic()
            req = urllib.request.Request(f"http://127.0.0.1:{PORT}/v1/chat/completions", data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=1800) as r:
                    tm = json.loads(r.read()).get("timings", {})
                res["runs"].append({"seconds": round(time.monotonic() - t, 2), "prompt_n": tm.get("prompt_n"),
                                    "prompt_tps": round(tm.get("prompt_per_second", 0), 1),
                                    "gen_n": tm.get("predicted_n"), "gen_tps": round(tm.get("predicted_per_second", 0), 1),
                                    "draft_n": tm.get("draft_n"), "draft_accepted": tm.get("draft_n_accepted")})
            except Exception as e:
                res["runs"].append({"error": str(e)[:300]})
    else:
        p.kill()
        res["error_tail"] = p.stderr.read().decode("utf-8", "replace")[-800:]
    p.kill()
    p.wait()
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engines", required=True, type=Path)
    ap.add_argument("--llama", required=True, type=Path)
    ap.add_argument("--ffmpeg", default=None)
    ap.add_argument("--device", type=int, default=None, help="Vulkan の番号（既定は自動選択）")
    ap.add_argument("--quick", action="store_true", help="10分音声・各1回だけ（50分音声と12Bを飛ばす）")
    a = ap.parse_args()

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    outdir = HERE / "results" / stamp
    work = outdir / "work"
    work.mkdir(parents=True)
    ffmpeg = a.ffmpeg or next((str(p) for p in [REPO / "src-tauri" / "resources" / "ffmpeg" / "ffmpeg.exe"] if p.exists()), "ffmpeg")

    gpus, doctor = list_gpus(a.engines / "nemo" / "bin" / "nemo-speech.exe")
    gpu = next((g for g in gpus if g["index"] == a.device), None) if a.device is not None else choose_gpu(gpus)
    if not gpu:
        sys.exit("Vulkan の GPU が見つかりません。nemo-speech doctor の出力:\n" + doctor)
    log(f"GPU: [{gpu['index']}] {gpu['name']}（{gpu['kind']}, {gpu['gib']} GiB）/ 全 GPU: {[g['name'] for g in gpus]}")
    env = dict(os.environ, GGML_VK_VISIBLE_DEVICES=str(gpu["index"]))

    results = {"date": stamp, "machine": {"os": platform.platform(), "cpu": platform.processor(), "gpus": gpus,
                                          "selected_gpu": gpu, "doctor": doctor}, "speech": {}, "llm": {}}

    # ---- 文字起こし・話者分離 ----
    for name, reps in [("10min", 1 if a.quick else 3), ("50min", 0 if a.quick else 1)]:
        mp3 = next((REPO / "demo_data" / f"{name}utes").glob("*.mp3"), None) if (REPO / "demo_data" / f"{name}utes").exists() else None
        if not mp3 or reps == 0:
            log(f"{name}: 音声が無いか --quick のため飛ばします")
            continue
        wav = work / f"{name}.wav"
        to_wav(ffmpeg, mp3, wav)
        entry = {"whisper": [], "nemo": []}
        # 1回目はシェーダーのコンパイルが入るので別に記録する（ドライバーのキャッシュに残る）
        for i in range(reps + (1 if name == "10min" else 0)):
            log(f"{name} 文字起こし {i + 1}")
            entry["whisper"].append(whisper_run(a.engines, wav, work, f"w{i}", env))
            log(f"{name} 話者分離 {i + 1}")
            entry["nemo"].append(nemo_run(a.engines, wav, work, env))
        texts = [r.pop("_text", None) for r in entry["whisper"]]
        entry["whisper_identical_across_runs"] = len({t for t in texts if t is not None}) <= 1
        ref = next((REPO / "demo_data" / f"{name}utes").glob("lott_*.json"), None)
        if ref and name == "10min" and texts[-1]:
            data = json.loads(ref.read_text(encoding="utf-8"))["transcriptionDataset"]
            ref_text = "".join((x.get("proofread", {}).get("diff", {}).get("from") or x["content"]) for x in data)
            entry["edit_vs_existing_pct"] = edit_ratio(texts[-1], ref_text)
        results["speech"][name] = entry
        wav.unlink()

    # ---- 校正・音声入力（llama-server） ----
    llm = MODELS / "llm"
    e4b = llm / "gemma-4-e4b-it"
    b12 = llm / "gemma-4-12b-it"
    ref10 = next((REPO / "demo_data" / "10minutes").glob("lott_*.json"), None)
    sysmsg = (REPO / "python_sidecar" / "prompt_templates" / "proofread" / "gemma4_system.txt").read_text(encoding="utf-8")
    if ref10:
        lines = [f"{i}\t{x['content']}" for i, x in enumerate(json.loads(ref10.read_text(encoding="utf-8"))["transcriptionDataset"][:80])]
    else:
        lines = [f"{i}\tえーと、今日はですね、ちょっと最近のことを話したいと思います。" for i in range(80)]
    body = {"messages": [{"role": "system", "content": sysmsg}, {"role": "user", "content": "\n".join(lines)}],
            "temperature": 0, "max_tokens": 2048, "cache_prompt": False}
    common = ["--ctx-size", "8192", "-np", "1", "--flash-attn", "on"]
    reps = 1 if a.quick else 2
    e4b_main = e4b / "gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf"
    if e4b_main.exists():
        log("校正 E4B + MTP")
        results["llm"]["e4b"] = llm_run(a.llama, env, ["-m", str(e4b_main), "-ngl", "99", *common, "--spec-type", "draft-mtp",
                                                       "--spec-draft-model", str(e4b / "mtp-gemma-4-E4B-it.gguf"),
                                                       "--spec-draft-n-max", "3", "--spec-draft-ngl", "99"], body, reps + 1)
        mmproj = e4b / "mmproj-BF16.gguf"
        mp3 =next((REPO / "demo_data" / "10minutes").glob("*.mp3"), None)
        if mmproj.exists() and mp3:
            clip = work / "15s.wav"
            subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-ss", "30", "-t", "15", "-i", str(mp3),
                            "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(clip)], check=True)
            vsys = (REPO / "python_sidecar" / "prompt_templates" / "voice_input" / "gemma4_e4b_retranscribe_system.txt").read_text(encoding="utf-8")
            abody = {"messages": [{"role": "system", "content": vsys}, {"role": "user", "content": [
                {"type": "text", "text": "入力行: （不明）"},
                {"type": "input_audio", "input_audio": {"data": base64.b64encode(clip.read_bytes()).decode(), "format": "wav"}}]}],
                "temperature": 0, "max_tokens": 256, "cache_prompt": False}
            log("音声入力 E4B + mmproj")
            results["llm"]["audio"] = llm_run(a.llama, env, ["-m", str(e4b_main), "--mmproj", str(mmproj), "--fit", "on", *common], abody, reps + 1)
            clip.unlink()
    else:
        log("E4B が無いため校正を飛ばします")
    b12_main = b12 / "gemma-4-12B-it-qat-UD-Q4_K_XL.gguf"
    if b12_main.exists() and not a.quick:
        log("校正 12B + MTP")
        results["llm"]["12b"] = llm_run(a.llama, env, ["-m", str(b12_main), "--fit", "on", *common, "--spec-type", "draft-mtp",
                                                       "--spec-draft-model", str(b12 / "mtp-gemma-4-12B-it.gguf"),
                                                       "--spec-draft-n-max", "3"], body, reps + 1)

    (outdir / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    (outdir / "results.md").write_text(render_md(results), encoding="utf-8")
    (work / "args.txt").unlink(missing_ok=True)
    try:
        work.rmdir()
    except OSError:
        pass
    log(f"完了: {outdir / 'results.md'}")


def warm(values):
    """2回目以降の平均（1回しかなければその値）。"""
    vals = [v for v in values if v is not None]
    if not vals:
        return None
    rest = vals[1:] or vals
    return round(sum(rest) / len(rest), 1)


def render_md(r):
    g = r["machine"]["selected_gpu"]
    rows = []

    def add(label, key, value, first=None):
        ref = REFERENCE.get(key)
        ratio = f"{value / ref:.2f}倍" if value and ref else "-"
        rows.append(f"| {label} | {first if first is not None else '-'} | {value if value is not None else '-'} | {ref} | {ratio} |")

    for name in ("10min", "50min"):
        e = r["speech"].get(name)
        if not e:
            continue
        ws = [x["seconds"] for x in e["whisper"] if x.get("exit") == 0]
        ns = [x["seconds"] for x in e["nemo"] if x.get("exit") == 0]
        add(f"文字起こし {name}", f"whisper_{name}", warm(ws) if name == "10min" else (ws[0] if ws else None), ws[0] if ws and name == "10min" else None)
        add(f"話者分離 {name}", f"nemo_{name}", warm(ns) if name == "10min" else (ns[0] if ns else None), ns[0] if ns and name == "10min" else None)
    for key, label in (("e4b", "校正 E4B + MTP（1回）"), ("12b", "校正 12B + MTP（1回）"), ("audio", "音声入力（15秒）")):
        e = r["llm"].get(key)
        if e and e.get("runs"):
            secs = [x.get("seconds") for x in e["runs"]]
            add(label, f"llm_{key}", warm(secs), secs[0])
    lines = [f"# Vulkan 計測結果 {r['date']}", "", f"- GPU: {g['name']}（{g['kind']}, {g['gib']} GiB, Vulkan {g['index']}）",
             f"- OS: {r['machine']['os']}", f"- CPU: {r['machine']['cpu']}", "",
             "| 項目 | 1回目（秒） | 2回目以降（秒） | RTX 4060 Vulkan（秒） | 比 |", "|---|---|---|---|---|", *rows, ""]
    for name, e in r["speech"].items():
        w = e["whisper"][-1]
        n = e["nemo"][-1]
        lines.append(f"- {name}: セグメント {w.get('segments')}・{w.get('chars')}文字・20秒以上の空白 {w.get('gaps_over_20s')}・"
                     f"反復 {w.get('repeat_loops')}・繰り返しで同一 {e['whisper_identical_across_runs']}・"
                     f"話者 {n.get('speakers')}人 / {n.get('turns')}区間"
                     + (f"・既存出力との文字差 {e['edit_vs_existing_pct']}%（RTX 4060 Vulkan は 17.2%）" if "edit_vs_existing_pct" in e else ""))
    for key, e in r["llm"].items():
        ok = [x for x in e.get("runs", []) if "error" not in x]
        if ok:
            x = ok[-1]
            lines.append(f"- {key}: 入力 {x['prompt_tps']} tok/s・生成 {x['gen_tps']} tok/s・MTP 採択 {x.get('draft_accepted')}/{x.get('draft_n')}"
                         f"・読み込み {e['load_seconds']}秒")
        else:
            lines.append(f"- {key}: 失敗 {e.get('error') or e.get('error_tail', '')[-200:]}")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()
