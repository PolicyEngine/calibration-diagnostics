"""Step 4: diff the readers' outputs at base and head, per fixture.
Usage: python3 -I step4_diff.py <base-outdir> <head-outdir>"""
import collections, json, pathlib, re, sys
B, H = map(pathlib.Path, sys.argv[1:3])
MISSING = "<missing>"

def walk(a, b, path, out):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            walk(a.get(k, MISSING), b.get(k, MISSING), path + [k], out)
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            walk(x, y, path + [i], out)
    elif a != b:
        out.append((path, a, b))

def shape(path):
    parts = []
    for i, p in enumerate(path):
        if isinstance(p, int): parts.append("[*]")
        elif i > 0 and path[i - 1] in ("pages", "investigations", "tree_states"): parts.append("{key}")
        else: parts.append(str(p))
    return ".".join(parts)

for f in sorted(B.glob("*.json")):
    if f.name.startswith("_"): continue
    a, b = json.loads(f.read_text()), json.loads((H / f.name).read_text())
    diffs = []; walk(a, b, [], diffs)
    print(f"## {f.stem}: {len(diffs)} differing values")
    groups = collections.defaultdict(list)
    for path, x, y in diffs: groups[shape(path)].append((path, x, y))
    for s, items in sorted(groups.items()):
        path, x, y = items[0]
        short = lambda v: json.dumps(v)[:160]
        print(f"  {len(items):6d}  {s}\n          e.g. {json.dumps(path[1:4])[:200]}: {short(x)} -> {short(y)}")
