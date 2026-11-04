"""Exercise actual catalog resolver and hierarchy producer with mixed storage."""
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
module = types.ModuleType("review_hierarchy_ledger_targets")
sys.modules[module.__name__] = module
module.__dict__.update({name: types.SimpleNamespace for name in external_names})
module.LexicalFloat = type("LexicalFloat", (float,), {})
module.UK_GEOGRAPHY_ID_TO_LABEL = {}
exec(compile(tree, str(SOURCE), "exec"), module.__dict__)

def fact(key, *, explicit=None, groupby=None):
    dimensions = {} if explicit is None else {"loan_type": explicit}
    layout = {"record_set_id": "table"}
    if groupby is not None:
        layout.update(groupby_dimension="loan_type", groupby_value_id=groupby,
                      groupby_dimension_label="Loan type", groupby_value_label=groupby.upper())
    return {
        "aggregate_fact_key": key, "source_record_id": key,
        "label": key, "source_release_key": "release",
        "source": {"source_name": "Publisher", "source_sha256": "digest"},
        "observed_measure": {"source_concept": "balance", "source_measure_id": "balance"},
        "entity": {"name": "person", "role": "person"}, "layout": layout,
        "period": {"type": "calendar_year", "value": 2024},
        "geography": {"level": "country", "id": "GB", "name": "United Kingdom", "vintage": "2024"},
        "dimensions": dimensions, "dimension_labels": {"loan_type": "Loan type"},
        "dimension_value_labels": {"loan_type": {"a": "A", "b": "B"}},
        "aggregation": {"method": "sum"}, "value": 20,
    }

seed = types.SimpleNamespace(provider=types.SimpleNamespace(id="provider", label="Publisher"),
    category=types.SimpleNamespace(id="balance", label="Balance", provider_id="provider"),
    target_label="Combined balance")
reference = module.LedgerTargetReference(name="combined-balance",
    ledger_selector={"source_name": "Publisher"}, value_operation="sum",
    expected_member_count=2, entity="person", measure="balance", period=2024, hierarchy=seed)

def probe(label, facts):
    # Use complete catalog selection, not a direct tuple bypass.
    resolved = module._resolve_reference_fact(reference, module._ledger_fact_index(facts))
    spec = module.target_spec_from_ledger_reference(resolved, reference)
    dimensions = [vars(dimension) for dimension in spec.hierarchy.dimensions]
    representative = spec.metadata["ledger_fact_key"]
    groupby = spec.metadata.get("ledger_layout_groupby_dimension")
    groupby_value = spec.metadata.get("ledger_layout_groupby_value_id")
    listed = any(dimension["id"] == groupby and dimension["value_id"] == groupby_value
                 for dimension in dimensions)
    result = {"case": label, "representative": representative,
        "member_keys": json.loads(spec.metadata["ledger_member_fact_keys"]),
        "layout_pair": [groupby, groupby_value], "hierarchy_dimensions": dimensions,
        "dashboard_layout_groupby_value_varies": not listed,
        "facts": facts,
        "dashboard_target": {"name": spec.name, "metadata": spec.metadata,
            "hierarchy": vars(spec.hierarchy)}}
    print(json.dumps(result, default=lambda value: vars(value), sort_keys=True))
    return result

mixed_facts = [fact("a-explicit", explicit="a"), fact("b-layout", groupby="a")]
for member, sex in zip(mixed_facts, ("female", "male")):
    member["dimensions"]["sex"] = sex
    member["dimension_labels"]["sex"] = "Sex"
    member["dimension_value_labels"]["sex"] = {"female": "Female", "male": "Male"}
mixed = probe("ordinary a + layout a; disjoint sex cells", mixed_facts)
assert mixed["hierarchy_dimensions"] == []
assert mixed["dashboard_layout_groupby_value_varies"] is True

common = probe("ordinary a in both; only representative layout a",
    [fact("a-explicit", explicit="a"), fact("b-layout", explicit="a", groupby="a")])
assert common["hierarchy_dimensions"][0]["id"] == "loan_type"
assert common["hierarchy_dimensions"][0]["value_id"] == "a"
assert common["dashboard_layout_groupby_value_varies"] is False

# This demonstrates that the hierarchy is not a literal layout-pair test;
# both ordinary dimensions are a, while the first layout writes b. Whether
# that conflicting input is Chronicle-valid is not established by the local
# evidence, so do not rely on this case as the review's primary finding.
conflicting = probe("ordinary a in both; first layout b and representative layout a",
    [fact("a-conflict", explicit="a", groupby="b"), fact("b-layout", explicit="a", groupby="a")])
assert conflicting["dashboard_layout_groupby_value_varies"] is False

print("EXTRA_COMMENT_COUNTEREXAMPLE")
probe("ordinary a in both; both layout b", [fact("a", explicit="a", groupby="b"), fact("b", explicit="a", groupby="b")])
