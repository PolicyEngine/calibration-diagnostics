"""Run committed Ledger logic with only unavailable output model types stubbed.

No source edits: all executable Ledger logic is compiled from the input AST;
the unavailable Microcosm model imports are replaced by SimpleNamespace only.
"""
import ast
import json
from pathlib import Path
import sys
import types

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "inputs/microcosm-0ff293b/packages/microcosm-build/src/microcosm/build/ledger_targets.py"
tree = ast.parse(SOURCE.read_text(), filename=str(SOURCE))
external_names = []
for node in tree.body:
    if isinstance(node, ast.ImportFrom) and node.module.startswith("microcosm"):
        external_names.extend(alias.asname or alias.name for alias in node.names)
tree.body = [node for node in tree.body if not (
    isinstance(node, ast.ImportFrom) and node.module.startswith("microcosm")
)]
module = types.ModuleType("review_ledger_targets")
sys.modules[module.__name__] = module
module.__dict__.update({name: types.SimpleNamespace for name in external_names})
module.LexicalFloat = type("LexicalFloat", (float,), {})
module.UK_GEOGRAPHY_ID_TO_LABEL = {}
exec(compile(tree, str(SOURCE), "exec"), module.__dict__)

captured = []
def capture_hierarchy(facts, **kwargs):
    captured.append(tuple(module._fact_key(fact) for fact in facts))
    return None
module._calibration_hierarchy = capture_hierarchy

def fact(key, cell, value, year=2024):
    return {
        "aggregate_fact_key": key,
        "source_record_id": "record-" + key,
        "source_release_key": "release",
        "source": {"source_name": "Publisher", "source_sha256": "digest"},
        "observed_measure": {"source_concept": "people", "source_measure_id": "count"},
        "entity": {"name": "person", "role": "person"},
        "layout": {"record_set_id": "table"},
        "period": {"type": "calendar_year", "value": year},
        "geography": {"level": "country", "id": "GB", "vintage": "2024"},
        "dimensions": {} if cell is None else {"cell": cell},
        "aggregation": {"method": "sum"},
        "value": value,
    }

def selector(f):
    return {
        "aggregate_fact_key": f["aggregate_fact_key"],
        "source_name": "Publisher", "source_measure_id": "count", "source_concept": "people",
        "entity_name": "person", "record_set_id": "table",
        "period_type": "calendar_year", "period_value": f["period"]["value"],
        "geography_level": "country", "geography_id": "GB", "geography_vintage": "2024",
        "dimensions": list(f["dimensions"]), "dimension_values": f["dimensions"],
    }

atoms = [fact("atom-a", "a", 40), fact("atom-b", "b", 50)]
total = fact("total", None, 100)
numerator = fact("growth-2025", "a", 44, 2025)

def allocation_reference(base_cells, *, signed=False, growth=None):
    base_selector = selector(atoms[0])
    del base_selector["aggregate_fact_key"]
    base_selector["dimension_values"] = {"cell": base_cells}
    partition = {
        "role": "partition", "member_selectors": [selector(atom) for atom in atoms],
        "allocation_member_keys": [atom["aggregate_fact_key"] for atom in atoms],
    }
    if signed:
        partition["discrepancy_policy"] = {
            "kind": "signed_proportional_reconciliation", "max_abs": 20,
            "max_relative": "0.5", "combine": "either", "ruling": "ruling", "disclosure": "disclosure",
        }
    operands = [{"role": "base", "expected_member_count": len(base_cells)},
                {"role": "total", **selector(total)}, partition]
    if growth is not None:
        operands.extend({"role": role, **selector(member)}
                        for role, member in zip(("numerator", "denominator"), growth))
    return module.LedgerTargetReference(
        name="allocation", ledger_selector=base_selector,
        value_operation="allocated_residual_by_ratio", value_operands=tuple(operands),
        entity="person", measure="count", period=2025 if growth else 2024,
    )

def check(label, reference, facts):
    spec = module.target_spec_from_ledger_reference(tuple(facts), reference)
    receipt = json.loads(spec.metadata["ledger_allocation_receipt"])
    base = receipt["fact_keys"]["base"]
    identity = list(captured[-1])
    representative = spec.metadata["ledger_fact_key"]
    assert sorted(base) == sorted(identity)
    assert representative in identity
    print(json.dumps({"label": label, "version": receipt["version"], "receipt_base": base,
                      "identity": identity, "representative": representative,
                      "member_count": spec.metadata["ledger_member_fact_count"]}, sort_keys=True))

for signed in (False, True):
    for base_cells in (["a"], ["a", "b"]):
        check(f"signed={signed}; base={base_cells}",
              allocation_reference(base_cells, signed=signed), [*atoms, total])
    check(f"signed={signed}; growth denominator is a base atom",
          allocation_reference(["a"], signed=signed, growth=(numerator, atoms[0])),
          [*atoms, total, numerator])

extra_denominator = fact("growth-2024", "a", 40)
reference = allocation_reference(["a"], growth=(numerator, extra_denominator))
try:
    check("invalid extra growth selector match", reference, [*atoms, total, numerator, extra_denominator])
except ValueError as exc:
    assert "base must be its exact declared subset" in str(exc)
    print("extra growth fact matching base selector REJECTED:", exc)
else:
    raise AssertionError("unexpectedly accepted matching nonpartition growth fact")

# The internal first resolver's optional preselected base cannot bypass the
# final compiler's unconditional second resolution of the labelled tuple.
labelled = module._resolve_allocation_reference_facts(reference,
    tuple([*atoms, total, numerator, extra_denominator]), base_matches=[atoms[0]])
print("preselected internal resolver labelled:", [module._fact_key(f) for f in labelled])
try:
    module.target_spec_from_ledger_reference(labelled, reference)
except ValueError as exc:
    assert "base must be its exact declared subset" in str(exc)
    print("final compiler REJECTED matching nonpartition growth fact:", exc)
else:
    raise AssertionError("unexpectedly bypassed final compiler check")

print("ALLOWED_VALUE_OPERATIONS", sorted(module.ALLOWED_VALUE_OPERATIONS))

# Direct calls validate each fact's eligibility and ownership, but do not
# re-run the catalog resolver's shared-period constraint for linear combines.
newer = fact("newer-first", "a", 40, 2024)
older = fact("older-last", "b", 50, 2023)
linear_reference = module.LedgerTargetReference(
    name="mixed-period-linear", ledger_selector={"source_name": "Publisher"},
    value_operation="linear_combination",
    value_operands=tuple({"weight": 1, "aggregate_fact_key": item["aggregate_fact_key"]}
                         for item in (newer, older)),
    entity="person", measure="count", period=2024,
)
linear = module.target_spec_from_ledger_reference((newer, older), linear_reference)
assert linear.metadata["ledger_fact_key"] == "newer-first"
print("successful mixed-period linear tuple; representative is not last:",
      linear.metadata["ledger_fact_key"], "identity:", captured[-1])
