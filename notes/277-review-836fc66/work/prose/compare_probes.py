from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[2]
old = [json.loads(line) for line in (ROOT / "inputs/pr/review-67e6d0b/identity/hierarchy_probe.log").read_text().splitlines()[:3]]
new = [json.loads(line) for line in (ROOT / "work/prose/layout_override_probe.log").read_text().splitlines()[:3]]
fixture = json.loads((ROOT / "inputs/dashboard-836fc66/frontend/packages/calibration-tree/src/fixtures/mixed-groupby-storage/hierarchy-probe-targets.json").read_text())
print("Reproduced first three original probe lines structurally equal:", old == new)
fields = ["case", "facts", "hierarchy_dimensions", "representative", "dashboard_target"]
print("Fixture matches selected fields of original first three lines:", fixture == [{key: row[key] for key in fields} for row in old])
print("Fixture keys:", sorted(fixture[0]))
