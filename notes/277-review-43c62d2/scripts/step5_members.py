"""Step 5: compare the five member facts of the balance excluding Parent PLUS
in microcosm's Chronicle fixture at 0ff293b, on the fields shownChronicle
keeps from the representative.
Usage: python3 -I step5_members.py <facts.jsonl.gz> <ed-fsa-family-schema-8.json>"""
import gzip, json, sys
facts = [json.loads(l) for l in gzip.open(sys.argv[1], "rt") if l.strip()]
fixture = json.load(open(sys.argv[2]))
row = next(r for r in fixture["targets"] if "excluding_parent_plus.dollars_outstanding" in str(r.get("target_name")))
md = row["metadata"]
print("target:", row["target_name"])
print("row metadata:", json.dumps({k: v for k, v in md.items() if k.startswith(("ledger_", "chronicle_", "source_"))}, indent=1))
members = json.loads(md["ledger_member_fact_keys"])
by_key = {}
for f in facts:
    for k in ("aggregate_fact_key", "fact_key", "semantic_fact_key", "legacy_fact_key"):
        if f.get(k): by_key[f[k]] = f
found = [by_key.get(k) for k in members]
print("members found in the Chronicle fixture:", sum(f is not None for f in found), "of", len(members))
def fields(f):
    lay = f.get("layout", {}); ca = f.get("concept_alignment", {})
    return {
        "source_record_id": f.get("lineage", {}).get("source_record_id"),
        "dimension_set_key": f.get("dimension_set_key"),
        "dimensions (filters)": f.get("dimensions"),
        "universe_constraints": f.get("universe_constraints"),
        "universe_constraint_set_key": f.get("universe_constraint_set_key"),
        "layout_record_set_id": lay.get("record_set_id"),
        "layout_groupby_dimension": lay.get("groupby_dimension"),
        "layout_groupby_value_id": lay.get("groupby_value_id"),
        "layout_measure_id": lay.get("measure_id"),
        "measure_concept": ca.get("canonical_concept"),
        "source_concept": ca.get("source_concept"),
        "value_operation": f.get("value_operation") or f.get("value", {}).get("operation") if isinstance(f.get("value"), dict) else f.get("value_operation"),
        "period": f.get("period"), "geography_id": f.get("geography", {}).get("id"),
        "unit": f.get("observed_measure", {}).get("unit"),
    }
table = [fields(f) for f in found if f]
for name in table[0]:
    values = [json.dumps(t[name], sort_keys=True) for t in table]
    print(f"{'SAME  ' if len(set(values)) == 1 else 'DIFFER'} {name}: " + (values[0][:200] if len(set(values)) == 1 else " | ".join(v[:90] for v in values)))
print("top-level keys of a fact:", sorted(found[0].keys()))
