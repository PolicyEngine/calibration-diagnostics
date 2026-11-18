import json

import pytest

from release_history.references import (
    ReferenceError_,
    load_lock,
    load_references,
    lock_is_current,
    resolve,
    validate_references,
)
from release_history.spec import load_spec, parse_spec

from .fakes import fake_spec_dict

# Synthetic Chronicle facts: invented values, the consumer-fact shape only.
FACTS = [
    {
        "lineage": {"source_record_id": "pub.tables.income_tax.fy2026.income_tax.amount"},
        "semantic_fact_key": "ledger.semantic_fact.v2:aaa",
        "label": "income tax",
        "period": {"type": "fiscal_year", "value": 2026},
        "assertion": "source_projection",
        "value": 1000.0,
    },
    {
        "lineage": {"source_record_id": "pub.tables.benefit_a.fy2026.benefit_a.amount"},
        "semantic_fact_key": "ledger.semantic_fact.v2:bbb",
        "label": "benefit a",
        "period": {"type": "fiscal_year", "value": 2026},
        "value": 30.0,
    },
    {
        "lineage": {"source_record_id": "pub.tables.benefit_b.fy2026.benefit_b.amount"},
        "semantic_fact_key": "ledger.semantic_fact.v2:ccc",
        "label": "benefit b",
        "period": {"type": "fiscal_year", "value": 2026},
        "value": 12.0,
    },
    {"lineage": {"source_record_id": "pub.tables.caseload.fy2026.row_1.count"}, "value": 1.0},
    {"lineage": {"source_record_id": "pub.tables.caseload.fy2026.row_2.count"}, "value": 2.0},
]


def references_for(spec, **overrides):
    references = {
        "schema_version": 1,
        "country": spec.country,
        "chronicle": {"source_commit": "abc"},
        "baseline": {item.id: {"none": "not chosen"} for item in spec.baseline},
        "reforms": {
            reform.id: {"citation": {"publisher": "X", "row": reform.id}, "sign": -1}
            for reform in spec.reforms
        },
    }
    references["baseline"].update(overrides)
    return references


@pytest.fixture
def facts_file(tmp_path):
    path = tmp_path / "consumer_facts.jsonl"
    path.write_text("".join(json.dumps(f) + "\n" for f in FACTS))
    return path


def test_resolution_sums_records_and_keeps_their_provenance(facts_file):
    spec = parse_spec(fake_spec_dict())
    references = references_for(
        spec,
        income_tax={"chronicle_records": ["pub.tables.income_tax.fy2026"], "basis": "forecast"},
        benefit={
            "chronicle_records": ["pub.tables.benefit_a.fy2026", "pub.tables.benefit_b.fy2026"]
        },
    )
    lock = resolve(spec, references, facts_file, None, resolved_at="t", check_digests=False)
    assert lock["baseline"]["income_tax"]["status"] == "resolved"
    assert lock["baseline"]["income_tax"]["value"] == 1000.0
    assert lock["baseline"]["benefit"]["value"] == 42.0
    assert [f["semantic_fact_key"] for f in lock["baseline"]["benefit"]["facts"]] == [
        "ledger.semantic_fact.v2:bbb",
        "ledger.semantic_fact.v2:ccc",
    ]
    assert lock["reforms"]["tax_up"]["status"] == "citation"
    assert lock["reforms"]["tax_up"]["output"] == "budgetary_impact"
    assert lock["reforms"]["tax_up"]["sign"] == -1
    assert lock_is_current(references, lock)
    references["baseline"]["households"] = {"none": "edited"}
    assert not lock_is_current(references, lock)


def test_an_ambiguous_record_set_is_refused(facts_file):
    spec = parse_spec(fake_spec_dict())
    references = references_for(
        spec, benefit_caseload={"chronicle_records": ["pub.tables.caseload.fy2026"]}
    )
    with pytest.raises(ReferenceError_, match="matches 2 facts"):
        resolve(spec, references, facts_file, None, resolved_at="t", check_digests=False)


def test_every_item_and_reform_needs_exactly_one_entry():
    spec = parse_spec(fake_spec_dict())
    references = references_for(spec)
    del references["baseline"]["income_tax"]
    references["reforms"]["extra"] = {"none": "x"}
    references["baseline"]["benefit"] = {"none": "x", "citation": {}}
    problems = validate_references(spec, references)
    assert any("income_tax: no reference entry" in p for p in problems)
    assert any("extra: not in the spec" in p for p in problems)
    assert any("exactly one of" in p for p in problems)


def test_committed_references_cover_their_specs_and_their_locks_are_current():
    for country in ("uk", "us"):
        spec, references = load_spec(country), load_references(country)
        assert validate_references(spec, references) == []
        lock = load_lock(country)
        assert lock is not None and lock_is_current(references, lock)
