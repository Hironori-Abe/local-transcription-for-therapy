import json,re,sys
from rapidfuzz.distance import Levenshtein
norm=lambda t: re.sub(r"[\s、。，．,.!?！？「」『』…・]","",t)
ref=json.load(open(sys.argv[1]))["transcriptionDataset"]
r=norm("".join((x.get("proofread",{}).get("diff",{}).get("from") or x["content"]) for x in ref))
for f in sys.argv[2:]:
    d=json.load(open(f))
    t=d["text"] if "text" in d else "".join(s["text"] for s in d["transcription"])
    h=norm(t); print(f"{f}: 文字数 {len(h)} / 既存 {len(r)}  編集距離 {Levenshtein.distance(h,r)} ({Levenshtein.distance(h,r)/len(r)*100:.1f}%)")
