from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sources = {
    "ledger": "inputs/microcosm-0ff293b/packages/microcosm-build/src/microcosm/build/ledger_targets.py",
    "registry": "inputs/microcosm-0ff293b/packages/microcosm-calibrate/src/microcosm/calibrate/registry.py",
    "references": "inputs/microcosm-0ff293b/tools/generate_uk_target_references.py",
    "latest": "inputs/dashboard-836fc66/frontend/packages/calibration-tree/src/latest-artifact.ts",
}
ranges = {
    "ledger": [(86, 124), (880, 894), (1012, 1035), (1080, 1100), (1171, 1178), (1232, 1245), (1318, 1341), (1352, 1373), (1421, 1433), (1485, 1490), (1578, 1651), (3063, 3075), (3180, 3192), (4260, 4275), (4323, 4333), (5855, 5874), (5911, 5918)],
    "registry": [(144, 150)],
    "references": [(1113, 1120)],
    "latest": [(539, 641), (1250, 1259), (1289, 1299), (3336, 3348), (3378, 3394)],
}
for name, path in sources.items():
    lines = (ROOT / path).read_text().splitlines()
    for lo, hi in ranges[name]:
        print(f"{path}:{lo}-{hi}")
        for lineno in range(lo, hi + 1):
            print(f"{lineno:5}: {lines[lineno - 1]}")
        print()

body = (ROOT / "inputs/pr/pr-body-836fc66.md").read_text().splitlines()
print("PR body style scan: no I/we, no bold label leads, no is/are/was/were + participle candidate")
import re
for lineno, line in enumerate(body, 1):
    if re.search(r"\b(?:I|we)\b|\*\*[^*]+\*\*", line):
        print(lineno, line)
print("Closing nonempty line:", next(line for line in reversed(body) if line.strip()))
print("Body contains Review follow-ups:", "## Review follow-ups" in body)
print("All mechanism citations available except external fixture-build sources:")
for glob in ["**/build_us_fiscal_refresh_release.py", "**/matrix.py"]:
    print(glob, list((ROOT / "inputs/microcosm-0ff293b").glob(glob)))
