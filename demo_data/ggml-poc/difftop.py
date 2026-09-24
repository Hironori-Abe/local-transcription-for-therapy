import json,re,sys
from rapidfuzz.distance import Levenshtein
norm=lambda t: re.sub(r"[\s、。，．,.!?！？「」『』…・]","",t)
w=json.load(open("out/merged_10min.json"))
ref=json.load(open(sys.argv[1]))["transcriptionDataset"]
h=norm("".join(s["text"] for s in w)); r=norm("".join((x.get("proofread",{}).get("diff",{}).get("from") or x["content"]) for x in ref))
ops=[o for o in Levenshtein.opcodes(r,h) if o.tag!="equal"]
ops.sort(key=lambda o:-(max(o.src_end-o.src_start,o.dest_end-o.dest_start)))
for o in ops[:12]: print(o.tag, "既存:", r[o.src_start:o.src_end][:60], "| whisper.cpp:", h[o.dest_start:o.dest_end][:60])
