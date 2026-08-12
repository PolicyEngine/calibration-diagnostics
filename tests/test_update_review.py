import hashlib
import json
from dataclasses import replace
from decimal import Decimal
from pathlib import Path

import pytest

from evaluation_harness.contracts import FactContract, SourceType, TypedPeriod
from evaluation_harness.full_run import SourcePlan
from evaluation_harness.integration import load_integration_overview
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import EvaluationSourceManifest
from evaluation_harness.snapshot import CONSUMER_SCHEMA, SNAPSHOT_SCHEMA, SnapshotDiff
from evaluation_harness.update_review import (
    REVIEW_SCHEMA,
    build_update_review_document,
    publish_update_review,
    review_source_update,
    select_affected_sources,
    validate_snapshot_compatibility,
    verification_gate,
)


ROOT = Path(__file__).parents[1]


def fact(
    key: str,
    semantic: str,
    *,
    value: str = "100",
    geography: str = "country",
    geography_id: str = "0100000US",
    measure: str = "irs_soi.adjusted_gross_income",
) -> FactContract:
    return FactContract(
        fact_key=key,
        semantic_fact_key=semantic,
        source="irs_soi",
        jurisdiction="US",
        period=TypedPeriod.parse("tax_year:2024"),
        geography_level=geography,
        geography_id=geography_id,
        entity="tax_unit",
        measure=measure,
        unit="usd",
        value=Decimal(value),
        dimensions={},
        universe_constraints=(),
        provenance_class="administrative",
        aggregation={"method": "sum"},
    )


def registry() -> MappingRegistry:
    return MappingRegistry.from_data(
        {
            "mapping_release": "test-mappings-v1",
            "mappings": [
                {
                    "mapping_id": "agi",
                    "chronicle_selector": {
                        "sources": ["irs_soi"],
                        "measures": ["irs_soi.adjusted_gross_income"],
                        "units": ["usd"],
                        "entities": ["tax_unit"],
                    },
                    "execution": "model",
                    "source_expression": "agi",
                    "operation": "weighted_sum",
                    "required_variables": ["agi"],
                    "mapping_quality": "exact",
                    "calibration_exposure": "external_validation",
                }
            ],
        }
    )


def source() -> EvaluationSourceManifest:
    return EvaluationSourceManifest(
        source_id="model",
        source_type=SourceType.MODEL_DATASET_PAIR,
        dataset_version="data-v1",
        model_version="model-v1",
        jurisdictions=frozenset({"US"}),
        population_period=TypedPeriod.parse("tax_year:2024"),
        policy_period=TypedPeriod.parse("tax_year:2024"),
        native_fact_periods=frozenset({"tax_year:2024"}),
        advanced_fact_periods=frozenset(),
        geographies=frozenset({"country"}),
        entities=frozenset({"tax_unit"}),
        weights={"tax_unit": "weight"},
        geography_methods={"country": "fixed_country"},
        available=True,
    )


def test_source_review_flags_mapping_regressions_without_reexecuting_value_only_changes() -> None:
    old_a = fact("old-a", "semantic-a")
    old_b = fact("old-b", "semantic-b")
    old_c = fact(
        "old-c",
        "semantic-c",
        measure="irs_soi.not_mapped",
    )
    new_a = replace(old_a, value=Decimal("125"))
    new_b = replace(
        old_b,
        geography_level="state",
        geography_id="0400000US06",
    )
    new_d = fact(
        "new-d",
        "semantic-d",
        measure="irs_soi.not_mapped",
    )
    plan = SourcePlan(source(), registry())

    review = review_source_update(
        (old_a, old_b, old_c),
        (new_a, new_b, new_d),
        old_plan=plan,
        new_plan=plan,
        from_snapshot="chronicle-old",
        to_snapshot="chronicle-new",
    )

    assert review.mapping_regressions == (
        {
            "semantic_fact_key": "semantic-b",
            "from_fact_key": "old-b",
            "to_fact_key": "old-b",
            "from_status": "evaluable_via_model",
            "to_status": "unsupported_geography",
            "reason_code": "geography_not_supported",
        },
    )
    assert review.value_changes_requiring_rescore == ("semantic-a",)
    assert review.newly_executable == ()
    assert review.requires_classification
    assert review.requires_rescore
    assert not review.requires_execution
    assert review.requires_publish


def test_newly_executable_fact_selects_model_execution() -> None:
    plan = SourcePlan(source(), registry())
    old = (fact("old-a", "semantic-a"),)
    new = (*old, fact("new-b", "semantic-b"))
    review = review_source_update(
        old,
        new,
        old_plan=plan,
        new_plan=plan,
        from_snapshot="chronicle-old",
        to_snapshot="chronicle-new",
    )
    assert review.newly_executable == ("semantic-b",)
    assert review.requires_execution
    assert select_affected_sources([review], action="execute") == ("model",)
    assert select_affected_sources([review], action="publish") == ("model",)


def test_both_active_adapter_gates_keep_ten_directly_testable_facts() -> None:
    for integration_name in ("microcosm_policyengine_us", "taxcalc_cps"):
        integration = ROOT / "integrations" / integration_name
        overview = load_integration_overview(integration / "overview.yaml")
        plan = SourcePlan(
            overview.source,
            MappingRegistry.from_yaml(integration / "mappings.yaml"),
        )
        gate = verification_gate(
            overview,
            overview.verification_facts,
            plan=plan,
            snapshot_id=overview.chronicle_snapshot_id,
        )
        assert gate.expected_count == 10
        assert gate.matched_count == 10
        assert gate.testable_count == 10
        assert gate.failures == ()
        assert gate.passed


def test_verification_gate_rejects_a_ten_na_completion() -> None:
    integration = ROOT / "integrations" / "taxcalc_cps"
    overview = load_integration_overview(integration / "overview.yaml")
    plan = SourcePlan(
        overview.source,
        MappingRegistry.from_yaml(integration / "mappings.yaml"),
    )
    unsupported = tuple(
        replace(
            item,
            geography_level="congressional_district",
            geography_id="5001700US0601",
        )
        for item in overview.verification_facts
    )
    gate = verification_gate(
        overview,
        unsupported,
        plan=plan,
        snapshot_id="chronicle-new",
    )
    assert gate.matched_count == 10
    assert gate.testable_count == 0
    assert len(gate.failures) == 10
    assert not gate.passed


def write_snapshot(path: Path, *, consumer_schema: str = CONSUMER_SCHEMA) -> Path:
    path.mkdir()
    row = fact("fact-a", "semantic-a")
    facts = row.to_json() + "\n"
    (path / "facts.jsonl").write_text(facts)
    (path / "snapshot_manifest.json").write_text(
        json.dumps(
            {
                "schema_version": SNAPSHOT_SCHEMA,
                "snapshot_id": "chronicle-test",
                "consumer_schema_version": consumer_schema,
                "fact_count": 1,
                "normalized_facts_sha256": hashlib.sha256(facts.encode()).hexdigest(),
            }
        )
    )
    return path


def test_snapshot_compatibility_checks_schema_hash_count_and_consumer_contract(
    tmp_path: Path,
) -> None:
    compatible = validate_snapshot_compatibility(write_snapshot(tmp_path / "ok"))
    assert compatible["snapshot_id"] == "chronicle-test"
    assert compatible["fact_count"] == 1

    with pytest.raises(ValueError, match="consumer schema"):
        validate_snapshot_compatibility(
            write_snapshot(tmp_path / "bad", consumer_schema="ledger.consumer_fact.v2")
        )


def test_update_review_publication_is_immutable_and_content_addressed(
    tmp_path: Path,
) -> None:
    plan = SourcePlan(source(), registry())
    old = (fact("old-a", "semantic-a"),)
    new = (replace(old[0], value=Decimal("125")),)
    source_review = review_source_update(
        old,
        new,
        old_plan=plan,
        new_plan=plan,
        from_snapshot="chronicle-old",
        to_snapshot="chronicle-new",
    )
    diff = SnapshotDiff(
        from_snapshot="chronicle-old",
        to_snapshot="chronicle-new",
        added=(),
        removed=(),
        changed_values=("old-a",),
        changed_definitions=(),
        key_churn=(),
    )
    document = build_update_review_document(
        diff,
        [source_review],
        [],
    )
    assert document["schema_version"] == REVIEW_SCHEMA
    assert document["affected_sources"]["rescore"] == ["model"]
    output = tmp_path / "review"
    manifest = publish_update_review(document, output)
    assert manifest["review_id"].startswith("chronicle-review-")
    assert (output / "review.json").exists()
    assert (output / "review_manifest.json").exists()
    with pytest.raises(FileExistsError):
        publish_update_review(document, output)
