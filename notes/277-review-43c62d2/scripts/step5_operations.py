"""Step 5: count the value operations each microcosm target reference file
asks for at 0ff293b, to see which multi-fact targets shownChronicle reaches.
Usage: python3 -I step5_operations.py <file.json> ..."""
import collections, json, sys
def walk(x, out):
    if isinstance(x, dict):
        op = x.get("value_operation")
        if isinstance(op, str):
            sel = x.get("facts") or x.get("fact_selectors") or x.get("selectors") or x.get("operands")
            out[op] += 1
        for v in x.values(): walk(v, out)
    elif isinstance(x, list):
        for v in x: walk(v, out)
for path in sys.argv[1:]:
    out = collections.Counter(); walk(json.load(open(path)), out)
    print(path.split("/")[-1], dict(out.most_common()))
