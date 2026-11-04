"""Offline fixture and producer hierarchy audit; stdlib only."""
import ast
import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from collections.abc import Mapping

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "work/root"
SOURCE = ROOT / "inputs/microcosm-0ff293b/packages/microcosm-build/src/microcosm/build/ledger_targets.py"
fixture_path = ROOT / "inputs/dashboard-67e6d0b/frontend/packages/calibration-tree/src/fixtures/ed-fsa-family/ed-fsa-family-schema-8.json"
fixture = json.loads(fixture_path.read_text())
print("FIXTURE_SHA256", hashlib.sha256(fixture_path.read_bytes()).hexdigest())
single, multi, matching = [], [], []
for row in fixture["targets"]:
    meta = row["metadata"]
    (multi if int(meta.get("ledger_member_fact_count", "1")) > 1 else single).append(row)
    pair = (meta.get("ledger_layout_groupby_dimension"), meta.get("ledger_layout_groupby_value_id"))
    if any((dim["id"], dim["value_id"]) == pair for dim in row["hierarchy"]["dimensions"]):
        matching.append(row)
print("FIXTURE", json.dumps({"schema": fixture["schema_version"], "targets": len(fixture["targets"]), "single": len(single), "multi": len(multi), "single_matching_groupby": sum(row in matching for row in single)}))
for row in multi:
    print("MULTI", json.dumps({"name": row["name"], "member_count": row["metadata"]["ledger_member_fact_count"], "dimensions": row["hierarchy"]["dimensions"], "varying": row["metadata"].get("ledger_aggregation_varying_dimensions"), "groupby": [row["metadata"].get("ledger_layout_groupby_dimension"), row["metadata"].get("ledger_layout_groupby_value_id")]}))

@dataclass
class HierarchyDimension:
    id: str
    label: str
    value_id: str
    value_label: str

namespace = {"Mapping": Mapping, "HierarchyDimension": HierarchyDimension, "json": json}
names = {"_inherited_dimensions", "_common_dimensions", "_constant_text", "_dimensions", "_str_at", "_at", "_dimension_value_id", "_dimension_label", "_dimension_value_label", "_mapping_value", "_nested_mapping_value"}
tree = ast.parse(SOURCE.read_text())
nodes = [ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0)]
nodes += [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), str(SOURCE), "exec"), namespace)

def fact(group="loan_type", value="a", dims=None, universe="same"):
    return {"layout": {"groupby_dimension": group, "groupby_value_id": value, "groupby_dimension_label": "Loan type", "groupby_value_label": value.strip().upper()}, "dimensions": dims or {}, "universe_constraint_set_key": universe}

cases = {
    "shared": [fact(), fact()],
    "different_value": [fact(value="a"), fact(value="b")],
    "different_dimension": [fact(), fact(group="other")],
    "whitespace": [fact(group=" loan_type ", value=" a "), fact()],
    "shared_universe": [fact(universe="u"), fact(universe="u")],
    "different_universe": [fact(universe="u"), fact(universe="v")],
}
payload = []
for name, facts in cases.items():
    dimensions = [asdict(dim) for dim in namespace["_inherited_dimensions"](tuple(facts))]
    payload.append({"name": name, "dimensions": dimensions, "representative_layout": facts[0]["layout"]})
    print("HIERARCHY", name, json.dumps(dimensions))
print("UNIVERSE", "Shared and different universe keys produce identical hierarchy dimensions; only representative key is stamped by _ledger_metadata.")
(OUT / "hierarchy-cases.json").write_text(json.dumps(payload, indent=2))

# Capture all root source ranges behind checks 3/4, including unchanged reader.
files = {
    str(SOURCE.relative_to(ROOT)): [(1018, 1101), (1318, 1436), (1479, 1547), (1578, 1653), (1680, 1717), (5039, 5063), (5853, 5921)],
    "inputs/dashboard-67e6d0b/frontend/packages/calibration-tree/src/hierarchy-target-reader.ts": [(29, 41), (89, 121)],
    "inputs/dashboard-67e6d0b/frontend/packages/calibration-tree/src/latest-artifact.ts": [(539, 631), (1231, 1289)],
}
with (OUT / "source-excerpts.log").open("w") as stream:
    for path, ranges in files.items():
        lines = (ROOT / path).read_text().splitlines()
        for start, end in ranges:
            stream.write(f"\n{path}:{start}-{end}\n")
            stream.writelines(f"{i+1}: {lines[i]}\n" for i in range(start - 1, min(end, len(lines))))

# Isolate the actual shownChronicle helpers, unchanged, from network I/O imports.
ts_path = ROOT / "inputs/dashboard-67e6d0b/frontend/packages/calibration-tree/src/latest-artifact.ts"
ts = ts_path.read_text()
def between(start, end):
    return ts[ts.index(start):ts.index(end)]
helpers = "type JsonObject = Record<string, unknown>;\ntype TargetRow = JsonObject;\n"
helpers += between("export function asObject(", "function isPlainObject(")
helpers += between("function numberOrNull(", "export function calibrationLossKind(")
helpers += between("function stringValue(", "function titleCase(")
helpers += between("function stringListOrEmpty(", "function isDuplicateDimension(")
helpers += "\nexport { shownChronicle, hierarchyListsGroupBy };\n"
(OUT / "chronicle-helpers.ts").write_text(helpers)
