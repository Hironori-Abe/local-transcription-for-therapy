"""whisper.cpp + Nemotron-3-Diarization の結果を統合し、既存 LoTT 出力と比較する。"""
import json
import re
import sys
from collections import Counter, defaultdict

import numpy as np
from rapidfuzz.distance import Levenshtein
from scipy.optimize import linear_sum_assignment

whisper_json, diar_json, ref_json, out_json = sys.argv[1:5]

wsegs = [
    {"start": s["offsets"]["from"] / 1000, "end": s["offsets"]["to"] / 1000, "text": s["text"].strip()}
    for s in json.load(open(whisper_json))["transcription"]
]
dsegs = json.load(open(diar_json))["segments"]
ref = json.load(open(ref_json))["transcriptionDataset"]


def assign(seg):
    ov = defaultdict(float)
    for d in dsegs:
        o = min(seg["end"], d["end"]) - max(seg["start"], d["start"])
        if o > 0:
            ov[d["speaker"]] += o
    if ov:
        return max(ov, key=ov.get)
    mid = (seg["start"] + seg["end"]) / 2
    return min(dsegs, key=lambda d: min(abs(d["start"] - mid), abs(d["end"] - mid)))["speaker"]


for s in wsegs:
    s["speaker"] = assign(s)

# --- 話者：時間ごとの発話量 ---
dur = Counter()
for d in dsegs:
    dur[d["speaker"]] += d["end"] - d["start"]
print("Nemotron 話者別発話時間(s):", {k: round(v, 1) for k, v in sorted(dur.items())})
print("Nemotron セグメント数:", len(dsegs))
ov_total = 0.0
for i, a in enumerate(dsegs):
    for b in dsegs[i + 1:]:
        if b["speaker"] != a["speaker"]:
            o = min(a["end"], b["end"]) - max(a["start"], b["start"])
            if o > 0:
                ov_total += o
print(f"重なり発話(異話者の同時発話) 合計: {ov_total:.1f}s")

# --- 話者：既存 LoTT(pyannote) との一致率（0.1s フレーム、最適ラベル対応付け） ---
T = int(max(max(d["end"] for d in dsegs), max(r["endTime"] for r in ref)) * 10) + 1
ref_lab = [None] * T
for r in ref:
    if r["speakerValue"]:
        for f in range(int(r["startTime"] * 10), int(r["endTime"] * 10)):
            ref_lab[f] = r["speakerValue"]
hyp_lab = [None] * T
for s in wsegs:
    for f in range(int(s["start"] * 10), int(s["end"] * 10)):
        hyp_lab[f] = s["speaker"]
rl = sorted({x for x in ref_lab if x})
hl = sorted({x for x in hyp_lab if x is not None})
M = np.zeros((len(rl), len(hl)))
for a, b in zip(ref_lab, hyp_lab):
    if a and b is not None:
        M[rl.index(a), hl.index(b)] += 1
r_i, h_i = linear_sum_assignment(-M)
mapping = {hl[j]: rl[i] for i, j in zip(r_i, h_i)}
both = M.sum()
agree = sum(M[i, j] for i, j in zip(r_i, h_i))
print("対応付け (Nemotron -> 既存):", mapping)
print("混同行列 (行=既存, 列=Nemotron, 秒):")
print("        " + "  ".join(f"spk{h:>2}" for h in hl))
for i, r in enumerate(rl):
    print(f"{r:>10} " + "  ".join(f"{M[i, j] / 10:6.1f}" for j in range(len(hl))))
print(f"話者一致率(両方にラベルがある時間): {agree / both * 100:.1f}%")

# --- セグメント単位の一致（既存セグメントの中点で比較） ---
seg_ok = seg_n = 0
for r in ref:
    if not r["speakerValue"]:
        continue
    mid = int((r["startTime"] + r["endTime"]) / 2 * 10)
    h = hyp_lab[mid] if mid < T else None
    if h is None:
        continue
    seg_n += 1
    seg_ok += mapping.get(h) == r["speakerValue"]
print(f"既存セグメント中点での話者一致: {seg_ok}/{seg_n} = {seg_ok / seg_n * 100:.1f}%")

# --- 文字起こし：既存 LoTT(faster-whisper) との文字編集距離 ---
norm = lambda t: re.sub(r"[\s、。，．,.!?！？「」『』…・]", "", t)
ref_raw = "".join(
    (r.get("proofread", {}).get("diff", {}).get("from") or r["content"]) for r in ref
)
hyp_txt = norm("".join(s["text"] for s in wsegs))
ref_txt = norm(ref_raw)
d = Levenshtein.distance(hyp_txt, ref_txt)
print(f"文字数: whisper.cpp={len(hyp_txt)} 既存={len(ref_txt)}")
print(f"文字編集距離: {d}  (既存比 {d / len(ref_txt) * 100:.1f}%)")
print(f"セグメント数: whisper.cpp={len(wsegs)} 既存={len(ref)}")

label = {v: k for k, v in mapping.items()}
json.dump(
    [{**s, "mappedSpeaker": mapping.get(s["speaker"], f"NEW_{s['speaker']}")} for s in wsegs],
    open(out_json, "w"),
    ensure_ascii=False,
    indent=1,
)
