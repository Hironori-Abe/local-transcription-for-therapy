import json,re,sys
from rapidfuzz.distance import Levenshtein
norm=lambda t: re.sub(r"[\s、。，．,.!?！？「」『』…・]","",t)
def load(f):
    d=json.load(open(f))
    if "transcription" not in d: return [s["text"] for s in d["result"]["segments"]]
    return [s["text"] for s in d["transcription"]]
ref=json.load(open("../10minutes/lott_20260425_173947.json"))["transcriptionDataset"]
R=norm("".join((x.get("proofread",{}).get("diff",{}).get("from") or x["content"]) for x in ref))
FW=norm("".join(load("out/fw_10min.json")))
terms=[t for t in open("app_initial_prompt.txt").read().split("頻出語:")[1].split() if len(t)>=2]
rows=[("faster-whisper(アプリ)","out/fw_10min.json"),("whisper.cpp 前回(VAD/プロンプト無)","out/whisper_10min.json"),
      ("A 最初の窓だけ+引継ぎ","out/wA_10min.json"),("B 毎窓プロンプト","out/wB_10min.json"),("C プロンプト無+引継ぎ無","out/wC_10min.json")]
print(f"{'条件':<32}{'文字数':>6}{'seg':>5}{'既存比':>8}{'FW比':>8}  混入疑い")
for name,f in rows:
    segs=load(f); H=norm("".join(segs))
    leak={t:H.count(t) for t in terms if H.count(t)>R.count(t)}
    print(f"{name:<32}{len(H):>6}{len(segs):>5}{Levenshtein.distance(H,R)/len(R)*100:>7.1f}%{Levenshtein.distance(H,FW)/len(FW)*100:>7.1f}%  {leak}")
print("既存 文字数", len(R))
