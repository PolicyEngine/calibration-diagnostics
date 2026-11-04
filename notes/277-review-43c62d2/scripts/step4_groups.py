"""Step 4: the statistic picker's groups ("N statistics") at base and head,
from each fixture's unfiltered targets-page variables. Base keys on
[source, level, variable] (microcosm-targets-view.tsx:261-266 at 2306113);
head on statisticGroupKey (statistic-groups.ts:15-18 at 43c62d2)."""
import json, pathlib, sys, collections
B, H = map(pathlib.Path, sys.argv[1:3])
for f in sorted(B.glob("*.json")):
    if f.name.startswith("_"): continue
    bv = json.loads(f.read_text())["page_default"]["variables"]
    hv = json.loads((H / f.name).read_text())["page_default"]["variables"]
    bk = collections.defaultdict(list); hk = collections.defaultdict(list)
    for v in bv: bk["::".join([v["source"], v["level"] or "", v["variable"]])].append(v["variable_key"])
    for v in hv:
        levels = v.get("levels") if v.get("levels") is not None else [v.get("level") or ""]
        hk["::".join([v["source"], "+".join(levels), v["variable"]])].append(v["variable_key"])
    bset = {frozenset(x) for x in bk.values()}; hset = {frozenset(x) for x in hk.values()}
    print(f"{f.stem}: categories {len(bv)}; groups base {len(bk)} head {len(hk)}; "
          f"groups that differ: base-only {len(bset - hset)}, head-only {len(hset - bset)}")
    for g in sorted(hset - bset, key=sorted)[:6]:
        print("   head groups together:", sorted(g))
    for g in sorted(bset - hset, key=sorted)[:6]:
        print("   base grouped:", sorted(g), [bv_["level"] for bv_ in bv if bv_["variable_key"] in g])
