import json, sys
from collections import Counter
rel = json.load(open(sys.argv[1]))
fx = json.load(open(sys.argv[2]))
rows = {r["name"]: r for r in fx["targets"]}
print("names equal:", sorted(rel) == sorted(rows), len(rel), len(rows))
for stage in ("after_apply", "after_aging"):
    missing, extra, diff, order_diff = Counter(), Counter(), Counter(), 0
    for name, r in rows.items():
        a, b = rel[name][stage], r["metadata"]
        for k in a.keys() - b.keys(): missing[k] += 1
        for k in b.keys() - a.keys(): extra[k] += 1
        for k in a.keys() & b.keys():
            if a[k] != b[k]: diff[k] += 1
        if list(a) != list(b): order_diff += 1
    print(f"\n[{stage}] keys a release has that the fixture lacks: {dict(missing)}")
    print(f"[{stage}] keys the fixture has that a release lacks: {dict(extra)}")
    print(f"[{stage}] keys whose values differ: {dict(diff)}")
    print(f"[{stage}] rows whose key order differs: {order_diff}")
vals = Counter()
for name, r in rows.items():
    m = rel[name]["after_aging"]
    vals[(m.get("measure_mode"), m.get("basis"), m.get("aged_to"), m.get("aging_factor"), m.get("aging_factor_source"))] += 1
print("\naging keys by measure_mode (mode, basis, aged_to, factor, source):", dict(vals))
other = Counter()
for name, r in rows.items():
    x = rel[name]
    if x["source"] != r["source"]: other["source"] += 1
    if x["entity"] != r["entity"]: other["entity"] += 1
    if x["period"] != r["period"]: other["period"] += 1
    if x["value"] != r["target"]: other["target(value)"] += 1
    if x["family"] != r["registry"]["family"]: other["family"] += 1
    h = x["hierarchy"]; fh = r["hierarchy"]
    for part in ("provider", "category", "geography", "target"):
        if h[part] != fh[part]: other[f"hierarchy.{part}"] += 1
    if [ {k: d[k] for k in ("id","label","value_id","value_label")} for d in h["dimensions"]] != fh["dimensions"]: other["hierarchy.dimensions"] += 1
    if set(h) - {"provider","category","geography","dimensions","target"}: other["hierarchy.extra_fields:"+",".join(sorted(set(h)-{"provider","category","geography","dimensions","target"}))] += 1
print("non-metadata fields that differ (count of rows):", dict(other) or "none")
print("diagnostic_target_label stamped at compile (then dropped by apply):", sum(1 for n in rows if rel[n]["diagnostic_target_label_at_compile"]), "of", len(rows))
