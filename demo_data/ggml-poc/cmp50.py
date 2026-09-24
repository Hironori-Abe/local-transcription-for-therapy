import json,re
from collections import Counter
from rapidfuzz.distance import Levenshtein
norm=lambda t: re.sub(r"[\s、。，．,.!?！？「」『』…・]","",t)
def load(f):
    d=json.load(open(f))
    return [s["text"] for s in (d["transcription"] if "transcription" in d else d["result"]["segments"])]
ref=json.load(open("../50minutes/lott_20260425_205535.json"))["transcriptionDataset"]
R=norm("".join((x.get("proofread",{}).get("diff",{}).get("from") or x["content"]) for x in ref))
FW=norm("".join(load("out/fw_50min.json")))
for name,f in [("faster-whisper(アプリ)","out/fw_50min.json"),("whisper.cpp 前回","out/whisper_50min.json"),("whisper.cpp C","out/wC_50min.json")]:
    s=load(f);H=norm("".join(s))
    run=1;mx=1
    for i in range(1,len(s)):
        run=run+1 if s[i].strip()==s[i-1].strip() else 1; mx=max(mx,run)
    long=[t for t in s if len(norm(t))>60 and len(set(norm(t)))<len(norm(t))*0.25]
    print(f"{name:<24} 文字数{len(H):>6} seg{len(s):>5} 既存比{Levenshtein.distance(H,R)/len(R)*100:6.1f}% FW比{Levenshtein.distance(H,FW)/len(FW)*100:6.1f}% 最長連続同一{mx} 反復疑い{len(long)}")
print("既存 文字数",len(R))
