"""Generate model-coverage.json: which policyengine-us rule variables the
calibration dashboard's own validation would notice breaking.

Usage:
  python generate_model_coverage.py /path/to/policyengine-us /path/to/populace \
      [--api http://localhost:4321]

Unlike upstream unit tests, the relevant checks here are the dashboard's two
validation legs:
  leg 1 — calibration targets: every target row materializes on specific model
          variables (`policyengine_variables` in the release artifact);
  leg 2 — external checks: JCT reform validation (neutralized / provision
          variables + the asserted income_tax delta) and the IRS SOI actuals
          backtest.

Tiers per rule variable (a rule = Variable class with a formula or
adds/subtracts; pure inputs are counted separately):
  anchored  — its value/aggregate is directly compared to an official number;
  exercised — it transitively feeds an anchored variable (a break here moves a
              checked number), via a static scan of formula sources;
  unreached — invisible to every dashboard check: the unknown unknowns.

The dependency scan is static (quoted variable names in each class body, plus
adds/subtracts parameter lists resolved through the parameters/ YAML tree), so
"exercised" is an approximation — good for locating blind spots, not proof.
"""

import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import yaml

pe_repo = Path(sys.argv[1])
populace_repo = Path(sys.argv[2])
api_base = "http://localhost:4321"
if "--api" in sys.argv:
    api_base = sys.argv[sys.argv.index("--api") + 1]

var_root = pe_repo / "policyengine_us" / "variables"
param_root = pe_repo / "policyengine_us" / "parameters"
build_us = populace_repo / "packages/populace-build/src/populace/build/us"
out_path = Path(__file__).resolve().parents[1] / "public" / "model-coverage.json"

CLASS_RE = re.compile(r"^class\s+([A-Za-z_0-9]+)\s*\(\s*Variable\s*\)", re.M)
FORMULA_RE = re.compile(r"def formula|^\s+adds\s*=|^\s+subtracts\s*=", re.M)
NAME_TOKEN_RE = re.compile(r"[\"']([a-z_][a-z_0-9]*)[\"']")
DOTTED_TOKEN_RE = re.compile(r"[\"']([a-z_][a-z_0-9]*(?:\.[a-z_0-9]+)+)[\"']")

# 1. variables + per-class source bodies ----------------------------------
variables = {}  # name -> {parts, is_rule, body}
for py in var_root.rglob("*.py"):
    text = py.read_text(errors="replace")
    matches = list(CLASS_RE.finditer(text))
    if not matches:
        continue
    rel = py.relative_to(var_root).parent.parts
    # Module-level constants (e.g. STATE_TANF_VARIABLES lists) are declared
    # before the classes but used inside their formulas — attribute the
    # prelude's references to every class in the file.
    prelude = text[: matches[0].start()]
    for i, m in enumerate(matches):
        body = text[m.start() : matches[i + 1].start() if i + 1 < len(matches) else len(text)]
        variables[m.group(1)] = {
            "parts": rel,
            "is_rule": bool(FORMULA_RE.search(body)),
            "body": body + prelude,
        }
known = set(variables)
print(f"variables: {len(variables)} ({sum(1 for v in variables.values() if v['is_rule'])} rules)")

# 2. dependency edges ------------------------------------------------------
def param_file_variable_names(dotted: str) -> set[str]:
    """Names of known variables listed in a parameter YAML (adds/subtracts lists)."""
    yf = param_root / (dotted.replace(".", "/") + ".yaml")
    if not yf.exists():
        return set()
    try:
        payload = yaml.safe_load(yf.read_text(errors="replace"))
    except Exception:
        return set()
    found: set[str] = set()

    def walk(node):
        if isinstance(node, str):
            if node in known:
                found.add(node)
        elif isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            for value in node.values():
                walk(value)

    walk(payload)
    return found


deps: dict[str, set[str]] = {}
for name, meta in variables.items():
    body = meta["body"]
    edge = {t for t in NAME_TOKEN_RE.findall(body) if t in known and t != name}
    for dotted in DOTTED_TOKEN_RE.findall(body):
        edge |= param_file_variable_names(dotted)
    deps[name] = edge
print(f"dependency edges: {sum(len(v) for v in deps.values())}")

# 3. anchors ---------------------------------------------------------------
def fetch_json(url: str):
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)


# leg 1: calibration targets -> policyengine_variables
calibration_anchors: set[str] = set()
filter_seeds: set[str] = set()
offset = 0
release_id = None
while True:
    q = urllib.parse.urlencode(
        {"limit": 500, "offset": offset, "sort_by": "name", "sort_dir": "asc"}
    )
    page = fetch_json(f"{api_base}/api/populace/target-diagnostics?{q}")
    release_id = page.get("release_id") or release_id
    rows = page.get("targets") or []
    for row in rows:
        for v in row.get("policyengine_variables") or []:
            calibration_anchors.add(v)
        fv = row.get("policyengine_filter_variable")
        if fv:
            filter_seeds.add(fv)
    offset += 500
    if not page.get("has_next"):
        break
print(f"leg 1: {offset} rows scanned -> {len(calibration_anchors)} calibration variables")

# leg 2a: OBBBA provisions — map parameter paths to the variables reading them
def variables_reading_parameter(path: str) -> set[str]:
    segs = [
        s
        for s in path.split(".")
        if s.islower() and not s.isdigit() and "[" not in s
    ]
    while len(segs) >= 4:
        needle = ".".join(segs)
        hits = {n for n, m in variables.items() if needle in m["body"]}
        if hits:
            # A needle matching half the model is too generic to attribute.
            return hits if len(hits) <= 40 else set()
        segs = segs[:-1]
    return set()


reform_anchors: set[str] = set()
obbba = json.loads((build_us / "obbba_reforms.json").read_text())
unmapped = []
for reform in obbba["reforms"]:
    mapped: set[str] = set()
    for p in reform["parameter_changes"]:
        mapped |= variables_reading_parameter(p)
    if not mapped:
        unmapped.append(reform["id"])
    reform_anchors |= mapped
    # Each row asserts the delta of its budget measure (income_tax for most,
    # estate_tax for the estate provision).
    if reform.get("budget_measure"):
        reform_anchors.add(reform["budget_measure"])
if unmapped:
    print(f"leg 2a: no variable match for {unmapped}")

# leg 2b: tax-expenditure neutralizations (out-of-sample) + in-sample JCT rows
tax_exp = json.loads((build_us / "tax_expenditure_reforms.json").read_text())
reform_anchors |= {r["neutralized_variable"] for r in tax_exp["reforms"]}
reform_anchors |= {
    r["budget_measure"] for r in tax_exp["reforms"] if r.get("budget_measure")
}
fiscal = json.loads((build_us / "fiscal_target_references.json").read_text())
reform_anchors |= {
    r["metadata"]["neutralized_variable"]
    for r in fiscal["target_references"]
    if "neutralized_variable" in (r.get("metadata") or {})
}
reform_anchors.add("income_tax")  # every reform row asserts the income_tax delta

# leg 2c: SOI actuals backtest
soi = json.loads((build_us / "soi_baseline_levels.json").read_text())
backtest_anchors = {level["variable"] for level in soi["levels"]}

all_anchors = (calibration_anchors | reform_anchors | backtest_anchors) & known
unknown_anchors = (calibration_anchors | reform_anchors | backtest_anchors) - known
if unknown_anchors:
    print(f"anchor names not in this model version (skipped): {sorted(unknown_anchors)}")
print(
    f"anchors: {len(all_anchors)} "
    f"(calibration {len(calibration_anchors & known)}, "
    f"reform {len(reform_anchors & known)}, backtest {len(backtest_anchors & known)})"
)

# 4. closure: exercised = transitive dependencies of anchored --------------
exercised: set[str] = set()
stack = list(all_anchors | (filter_seeds & known))
seen = set(stack)
while stack:
    for dep in deps.get(stack.pop(), ()):
        if dep not in seen:
            seen.add(dep)
            stack.append(dep)
            exercised.add(dep)
exercised -= all_anchors

def tier(name: str) -> str:
    if name in all_anchors:
        return "anchored"
    if name in exercised:
        return "exercised"
    return "unreached"


# 5. rollup tree -----------------------------------------------------------
# Full depth, with the rule names per tier at leaf directories, so the view
# can drill into any cluster and list what is and is not covered there.
def node():
    return {
        "rules": 0,
        "anchored": 0,
        "exercised": 0,
        "inputs": 0,
        "children": {},
        "names": {"anchored": [], "exercised": [], "unreached": []},
    }


root = node()
for name, meta in variables.items():
    chain = [root]
    cur = root
    for part in meta["parts"]:
        cur = cur["children"].setdefault(part, node())
        chain.append(cur)
    t = tier(name)
    for n in chain:
        if meta["is_rule"]:
            n["rules"] += 1
            if t == "anchored":
                n["anchored"] += 1
            elif t == "exercised":
                n["exercised"] += 1
        else:
            n["inputs"] += 1
    if meta["is_rule"]:
        chain[-1]["names"][t].append(name)


def serialize(name, n):
    out = {
        "name": name,
        "rules": n["rules"],
        "anchored": n["anchored"],
        "exercised": n["exercised"],
        "inputs": n["inputs"],
    }
    if n["children"]:
        out["children"] = [
            serialize(k, v)
            for k, v in sorted(n["children"].items(), key=lambda kv: -kv[1]["rules"])
        ]
    for key in ("anchored", "exercised", "unreached"):
        if n["names"][key]:
            out[f"{key}_names"] = sorted(n["names"][key])
    return out


commit = subprocess.run(
    ["git", "-C", str(pe_repo), "rev-parse", "--short", "HEAD"],
    capture_output=True,
    text=True,
).stdout.strip()
version = ""
for line in (pe_repo / "pyproject.toml").read_text().splitlines():
    if line.startswith("version"):
        version = line.split('"')[1]
        break

reached = root["anchored"] + root["exercised"]
payload = {
    "source": {"repo": "PolicyEngine/policyengine-us", "version": version, "commit": commit},
    "release_id": release_id,
    "anchor_counts": {
        "calibration": len(calibration_anchors & known),
        "reform": len(reform_anchors & known),
        "backtest": len(backtest_anchors & known),
    },
    "totals": {
        "variables": len(variables),
        "rules": root["rules"],
        "anchored": root["anchored"],
        "exercised": root["exercised"],
        "unreached": root["rules"] - reached,
        "inputs": root["inputs"],
    },
    "tree": serialize("variables", root),
}
out_path.write_text(json.dumps(payload))
print(f"wrote {out_path} ({out_path.stat().st_size/1024:.0f} KB)")
print(
    f"anchored {root['anchored']} + exercised {root['exercised']} = "
    f"{reached}/{root['rules']} rules reached "
    f"({reached/root['rules']*100:.1f}%), {root['rules']-reached} unreached"
)
