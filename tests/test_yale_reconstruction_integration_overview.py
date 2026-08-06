import hashlib
import json
import math
from pathlib import Path

import yaml

from evaluation_harness.contracts import CapabilityStatus, PeriodTreatment
from evaluation_harness.integration import (
    load_integration_overview,
    validate_overview_against_snapshot,
)
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import CapabilityPlanner


ROOT = Path(__file__).parents[1]
INTEGRATION = ROOT / "integrations" / "yale_reconstruction"
RECONSTRUCTION = (
    ROOT / "frontend" / "lib" / "populace" / "external-datasets"
    / "yale-national-2024.json"
)


def _checkpoint() -> dict:
    return json.loads((INTEGRATION / "verification_results.json").read_text())


def test_yale_overview_pins_reconstruction_dataset_and_model() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    assert overview.integration_id == "yale_reconstruction_2024"
    assert overview.source.source_id == "yale_reconstruction_2024"
    assert overview.source.source_type.value == "model_dataset_pair"
    assert overview.source.dataset_version == (
        "budget-lab-yale-tax-data@a3919fd96d87837388f1b8bd588ff6859be391af"
    )
    assert overview.source.model_version == (
        "budget-lab-yale-tax-simulator@310870383d24ed3e84b7179ce35860cf177197cc"
    )
    assert overview.source.geographies == frozenset({"country"})
    assert overview.source.entities == frozenset({"tax_unit"})
    assert overview.alignment_policy == {
        "model_id": "cbo_growth_factor_aging",
        "model_version": "1.2.0",
        "populace_commit": "cae8640f9e65e274aea65c7916cb37b956978e32",
        "source_module": (
            "packages/populace-build/src/populace/build/us_runtime/target_aging.py"
        ),
        "source_years": [2023],
        "build_year": 2024,
        "evaluate_transformed_facts": True,
        "display_observed_and_transformed_values": True,
    }


def test_yale_has_ten_real_numeric_verification_facts() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    assert len(overview.verification_facts) == 10
    assert len({fact.fact_key for fact in overview.verification_facts}) == 10
    assert len({fact.measure for fact in overview.verification_facts}) == 10
    assert {fact.unit for fact in overview.verification_facts} == {"count", "usd"}
    assert {fact.period.canonical for fact in overview.verification_facts} == {
        "tax_year:2024"
    }
    assert all(fact.value.is_finite() for fact in overview.verification_facts)


def test_all_ten_yale_facts_are_executable_not_na() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    mappings = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    results = CapabilityPlanner(
        mappings, snapshot_id=overview.ledger_snapshot_id
    ).classify_all(overview.verification_facts, [overview.source])
    assert len(results) == 10
    assert all(result.status is CapabilityStatus.MODEL for result in results)
    assert all(result.query is not None and result.score_eligible for result in results)
    assert all(
        result.period_treatment is PeriodTreatment.ADVANCED_POPULATION
        for result in results
    )


def test_yale_checkpoint_contains_ten_finite_numerical_results() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    checkpoint = _checkpoint()
    assert checkpoint["schema_version"] == (
        "evaluation_harness.yale_reconstruction_checkpoint.v1"
    )
    assert checkpoint["source_id"] == overview.source.source_id
    assert checkpoint["ledger_snapshot_id"] == overview.ledger_snapshot_id
    assert checkpoint["official_yale_output"] is False
    assert checkpoint["adapter_status"] == "overview_only_awaiting_confirmation"

    rows = checkpoint["results"]
    assert len(rows) == 10
    assert {row["fact_key"] for row in rows} == {
        fact.fact_key for fact in overview.verification_facts
    }
    assert all(math.isfinite(row["estimate"]) for row in rows)
    assert all(row["status"] == "ok" for row in rows)


def test_yale_checkpoint_values_are_from_the_committed_reconstruction() -> None:
    checkpoint = _checkpoint()
    reconstruction = json.loads(RECONSTRUCTION.read_text())
    assert reconstruction["dataset"] == "yale_national"
    assert "RECONSTRUCTION, not Yale's published output" in reconstruction["notes"]
    assert hashlib.sha256(RECONSTRUCTION.read_bytes()).hexdigest() == checkpoint[
        "reconstruction_sha256"
    ]
    for row in checkpoint["results"]:
        assert row["estimate"] == reconstruction["rows"][row["reconstruction_row_key"]]


def test_yale_overview_declares_access_boundary_and_taxable_income_gap() -> None:
    payload = yaml.safe_load((INTEGRATION / "overview.yaml").read_text())
    assert payload["reconstruction"]["official_yale_output"] is False
    assert payload["reconstruction"]["committed_aggregate_checkpoint_available"] is True
    assert payload["reconstruction"]["record_level_detail_available"] is False
    assert payload["reconstruction"]["record_level_detail_required_for_adapter"] is True
    assert payload["reconstruction"]["taxable_income_checkpoint_status"] == (
        "deferred_no_native_2024_ledger_fact"
    )
    assert payload["reconstruction"]["legacy_artifact_commit"] == (
        "37922ec2bc07a3f32cd5e920c0aa06385fa52a56"
    )
    assert payload["reconstruction"]["upstream_pin_basis"] == (
        "latest_commits_before_legacy_artifact_commit"
    )
    assert payload["reconstruction"]["exact_original_upstream_pins_recorded"] is False


def test_yale_verification_facts_match_committed_snapshot_fixture() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    validate_overview_against_snapshot(
        overview,
        INTEGRATION / "ledger_snapshot_fixture",
    )
