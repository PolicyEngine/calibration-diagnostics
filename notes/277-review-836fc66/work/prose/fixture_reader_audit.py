from pathlib import Path
from collections import Counter, defaultdict
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[2]
path = ROOT / "inputs/dashboard-836fc66/frontend/packages/calibration-tree/src/fixtures/ed-fsa-family/ed-fsa-family-schema-8.json"
data = path.read_bytes()
fixture = json.loads(data)
print("fixture sha256", hashlib.sha256(data).hexdigest())
print("FSA rows", len(fixture["targets"]))
groups = defaultdict(Counter)
for row in fixture["targets"]:
    hierarchy = row["hierarchy"]
    groups[hierarchy["category"]["id"]][hierarchy["geography"]["level"]] += 1
for key, levels in groups.items():
    print(key, dict(levels))
for row in fixture["targets"]:
    metadata = row.get("metadata", {})
    if "18_to_24" in row["name"] or "10k_to_20k" in row["name"]:
        print("age/debt example", row["name"], metadata.get("ledger_universe_constraint_count"))
print("Production member readers")
root = ROOT / "inputs/dashboard-836fc66/frontend"
for path in root.rglob("*"):
    if not path.is_file() or path.suffix not in (".ts", ".tsx", ".mjs"):
        continue
    if ".test." in path.name or "packages/calibration-tree" in str(path):
        continue
    for line_number, line in enumerate(path.read_text().splitlines(), 1):
        if re.search(r"member_fact_(?:count|keys)|target-investigation", line):
            print(path.relative_to(ROOT), line_number, line.strip())
