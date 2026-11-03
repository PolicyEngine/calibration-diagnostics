"""Run microcosm's own FSA compile path at 0ff293b (real modules, stubbed
unrelated imports) and dump each FSA spec's metadata as a release would carry
it: compile -> apply_fsa_student_loan_plan -> age_us_dollar_targets.

The stages between apply and aging in fiscal_targets.py:1104-1125 are keyed on
other families (read, not run). Usage: release_specs.py <pkg> <mc-root> <out.json>
"""
import gzip, json, sys
sys.path.insert(0, sys.argv[1])
from pathlib import Path
from microcosm.build.ledger_targets import compile_ledger_target_references
from microcosm.build.us_runtime.fsa_student_loan_targets import (
    plan_fsa_student_loan_targets, apply_fsa_student_loan_plan)
from microcosm.build.us_runtime.target_aging import age_us_dollar_targets

root = Path(sys.argv[2])
with gzip.open(root / "packages/microcosm-build/tests/fixtures/us_fsa_portfolio_chronicle_347_facts.jsonl.gz", "rt") as h:
    facts = tuple(json.loads(l) for l in h if l.strip())
plan = plan_fsa_student_loan_targets(facts, target_period=2024)
registry = compile_ledger_target_references(facts, plan.references, country="us")
compiled = {s.name: dict(s.metadata) for s in registry.specs}
applied = apply_fsa_student_loan_plan(registry, plan, target_period=2024)
after_apply = {s.name: s for s in applied.specs}
aged = age_us_dollar_targets(applied, facts, target_period=2024)
out = {}
for s in aged.specs:
    a = after_apply[s.name]
    out[f"{s.name}@{s.period}"] = {
        "after_apply": dict(a.metadata),
        "after_aging": dict(s.metadata),
        "value": s.value, "period": s.period, "source": s.source, "entity": s.entity,
        "family": s.family,
        "hierarchy": None if s.hierarchy is None else __import__("dataclasses").asdict(s.hierarchy),
        "diagnostic_target_label_at_compile": compiled[s.name].get("diagnostic_target_label"),
    }
json.dump(out, open(sys.argv[3], "w"), indent=1, ensure_ascii=False)
print(len(out), "specs")
