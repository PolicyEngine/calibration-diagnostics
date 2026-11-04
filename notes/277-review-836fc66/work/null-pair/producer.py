"""Run supplied compiler and catalog resolver; substitute output model types only."""
import ast
from copy import deepcopy
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
module = types.ModuleType("review_null_pair_ledger_targets")
sys.modules[module.__name__] = module
module.__dict__.update({name: types.SimpleNamespace for name in external_names})
module.LexicalFloat = type("LexicalFloat", (float,), {})
module.UK_GEOGRAPHY_ID_TO_LABEL = {}
exec(compile(tree, str(SOURCE), "exec"), module.__dict__)

fixture = json.loads((ROOT / "inputs/dashboard-836fc66/frontend/packages/calibration-tree/src/fixtures/mixed-groupby-storage/hierarchy-probe-targets.json").read_text())[0]
facts = fixture["facts"]
seed = types.SimpleNamespace(provider=types.SimpleNamespace(id="provider", label="Publisher"),
    category=types.SimpleNamespace(id="balance", label="Balance", provider_id="provider"),
    target_label="Combined balance")
reference = module.LedgerTargetReference(name="combined-balance",
    ledger_selector={"source_name": "Publisher"}, value_operation="sum",
    expected_member_count=2, entity="person", measure="balance", period=2024, hierarchy=seed)

def emit(case, input_facts, resolve=True):
    selected = (module._resolve_reference_fact(reference, module._ledger_fact_index(input_facts))
                if resolve else tuple(input_facts))
    spec = module.target_spec_from_ledger_reference(selected, reference)
    print(json.dumps({"case": case, "facts": input_facts,
        "selected_keys": [module._fact_key(fact) for fact in selected],
        "representative": spec.metadata["ledger_fact_key"],
        "layout_pair": [spec.metadata.get("ledger_layout_groupby_dimension"),
                        spec.metadata.get("ledger_layout_groupby_value_id")],
        "dashboard_target": {"name": spec.name, "metadata": spec.metadata,
                             "hierarchy": vars(spec.hierarchy)}},
        default=lambda value: vars(value), sort_keys=True))

emit("original mixed storage, catalog", facts)
emit("reversed original input, catalog sorts key order", list(reversed(facts)))
emit("reversed original tuple, direct compiler", list(reversed(facts)), resolve=False)
renamed = deepcopy(facts)
renamed[0]["aggregate_fact_key"] = "z-explicit"
renamed[0]["source_record_id"] = "z-explicit"
renamed[0]["label"] = "z-explicit"
emit("renamed explicit fact, catalog", renamed)
