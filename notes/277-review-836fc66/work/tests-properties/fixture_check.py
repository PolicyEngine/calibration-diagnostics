from pathlib import Path
import json
base=Path(__file__).resolve().parents[2]
fixture=json.loads((base/'inputs/dashboard-836fc66/frontend/packages/calibration-tree/src/fixtures/mixed-groupby-storage/hierarchy-probe-targets.json').read_text())
probe=[json.loads(line) for line in (base/'inputs/pr/review-67e6d0b/identity/hierarchy_probe.log').read_text().splitlines()[:3]]
keys=['case','facts','hierarchy_dimensions','representative','dashboard_target']
for i,(a,b) in enumerate(zip(fixture,probe),1):
    print(f'case {i}: {a["case"]}; exact equality of all five retained fields = {a == {k:b[k] for k in keys}}; omitted = {sorted(set(b)-set(a))}')
print('fixture count =', len(fixture), '; probe first-three count =',len(probe))
