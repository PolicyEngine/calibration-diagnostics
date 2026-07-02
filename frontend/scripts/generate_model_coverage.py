"""Generate model-coverage.json: which policyengine-us rule variables have tests.

Usage: python generate_model_coverage.py /path/to/policyengine-us/checkout

Method:
- A *rule* is a Variable class whose definition carries a formula (def formula)
  or aggregation (adds/subtracts) — pure inputs have no rule logic to test and
  are counted separately.
- A rule counts as *tested* when any YAML test case asserts it in an `output:`
  block (asserting an output exercises the formula; appearing in `input:` does
  not test anything).
- Coverage rolls up the variables/ directory tree. This measures DIRECT
  coverage only: a variable exercised solely as a dependency of a tested
  downstream variable still counts as untested here (deliberately — indirect
  execution asserts nothing about its own values).
"""

import json
import re
import subprocess
import sys
from pathlib import Path

import yaml

repo = Path(sys.argv[1])
var_root = repo / "policyengine_us" / "variables"
test_root = repo / "policyengine_us" / "tests"
out_path = Path(__file__).resolve().parents[1] / "public" / "model-coverage.json"

CLASS_RE = re.compile(r"^class\s+([A-Za-z_0-9]+)\s*\(\s*Variable\s*\)", re.M)
FORMULA_RE = re.compile(r"def formula|^\s+adds\s*=|^\s+subtracts\s*=", re.M)

# 1. variables -----------------------------------------------------------
variables = {}  # name -> {path_parts, is_rule}
for py in var_root.rglob("*.py"):
    text = py.read_text(errors="replace")
    names = CLASS_RE.findall(text)
    if not names:
        continue
    rel = py.relative_to(var_root).parent.parts
    is_rule = bool(FORMULA_RE.search(text))
    for name in names:
        variables[name] = {"parts": rel, "is_rule": is_rule}
print(f"variables: {len(variables)} ({sum(1 for v in variables.values() if v['is_rule'])} rules)")

# 2. tested names from YAML output blocks --------------------------------
tested = set()
yaml_errors = 0
for yf in test_root.rglob("*.yaml"):
    try:
        docs = yaml.safe_load(yf.read_text(errors="replace"))
    except Exception:
        yaml_errors += 1
        continue
    if not isinstance(docs, list):
        continue
    for case in docs:
        if not isinstance(case, dict):
            continue
        output = case.get("output")
        if isinstance(output, dict):
            tested.update(str(k) for k in output.keys())
print(f"tested names: {len(tested)} (yaml errors: {yaml_errors})")

# 3. rollup tree ---------------------------------------------------------
def node():
    return {"rules": 0, "tested": 0, "inputs": 0, "children": {}, "untested": []}

root = node()
for name, meta in variables.items():
    cur = root
    for part in meta["parts"]:
        cur = cur["children"].setdefault(part, node())
    target = cur
    # bubble counts up the chain
    chain = [root]
    c = root
    for part in meta["parts"]:
        c = c["children"][part]
        chain.append(c)
    for n in chain:
        if meta["is_rule"]:
            n["rules"] += 1
            if name in tested:
                n["tested"] += 1
        else:
            n["inputs"] += 1
    if meta["is_rule"] and name not in tested:
        target["untested"].append(name)

def collect_untested(n):
    names = list(n["untested"])
    for child in n["children"].values():
        names.extend(collect_untested(child))
    return names


def serialize(name, n, depth):
    out = {
        "name": name,
        "rules": n["rules"],
        "tested": n["tested"],
        "inputs": n["inputs"],
    }
    if depth < 4 and n["children"]:
        out["children"] = [
            serialize(k, v, depth + 1)
            for k, v in sorted(n["children"].items(), key=lambda kv: -kv[1]["rules"])
        ]
    else:
        # Serialization leaf: roll up every untested name beneath this node so
        # the "largest untested pockets" table can list them.
        names = collect_untested(n)
        if names:
            out["untested"] = sorted(names)[:120]
    return out

commit = subprocess.run(
    ["git", "-C", str(repo), "rev-parse", "--short", "HEAD"],
    capture_output=True, text=True,
).stdout.strip()
version = ""
for line in (repo / "pyproject.toml").read_text().splitlines():
    if line.startswith("version"):
        version = line.split('"')[1]
        break

payload = {
    "source": {"repo": "PolicyEngine/policyengine-us", "version": version, "commit": commit},
    "totals": {
        "variables": len(variables),
        "rules": root["rules"],
        "tested": root["tested"],
        "inputs": root["inputs"],
    },
    "tree": serialize("variables", root, 0),
}
out_path.write_text(json.dumps(payload))
print(f"wrote {out_path} ({out_path.stat().st_size/1024:.0f} KB)")
print(f"coverage: {root['tested']}/{root['rules']} rules = {root['tested']/root['rules']*100:.1f}%")
