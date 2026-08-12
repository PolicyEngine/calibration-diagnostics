import hashlib
import json
import math
from dataclasses import replace
from decimal import Decimal
from pathlib import Path

import pytest
import yaml

from evaluation_harness.contracts import (
    AlignedFact,
    AlignmentQuality,
    CapabilityStatus,
    ExecutionMethod,
    PeriodTreatment,
)
from evaluation_harness.integration import (
    load_integration_overview,
    validate_overview_against_snapshot,
)
from evaluation_harness.frontend_bundle import DEFAULT_SOURCE_LABELS
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import CapabilityPlanner
from evaluation_harness.yale_reconstruction_checkpoint import (
    load_yale_reconstruction_checkpoint,
    materialize_yale_reconstruction_results,
)


ROOT = Path(__file__).parents[1]
INTEGRATION = ROOT / "integrations" / "yale_reconstruction"
RECONSTRUCTION = (
    ROOT / "frontend" / "lib" / "microcosm" / "external-datasets"
    / "yale-national-2024.json"
)
COVERAGE_MANIFEST = INTEGRATION / "checkpoint_mappings.json"


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
    assert DEFAULT_SOURCE_LABELS[overview.source.source_id] == (
        "Yale Tax-Data + Tax-Simulator (reconstruction)"
    )
    assert overview.alignment_policy == {
        "model_id": "cbo_growth_factor_aging",
        "model_version": "1.2.0",
        "microcosm_commit": "cae8640f9e65e274aea65c7916cb37b956978e32",
        "source_module": (
            "packages/microcosm-build/src/microcosm/build/us_runtime/target_aging.py"
        ),
        "source_years": [2022, 2023],
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
    assert all(result.period_treatment is PeriodTreatment.NATIVE for result in results)


def test_yale_checkpoint_contains_ten_finite_numerical_results() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    checkpoint = _checkpoint()
    assert checkpoint["schema_version"] == (
        "evaluation_harness.yale_reconstruction_checkpoint.v1"
    )
    assert checkpoint["source_id"] == overview.source.source_id
    assert checkpoint["ledger_snapshot_id"] == overview.ledger_snapshot_id
    assert checkpoint["official_yale_output"] is False
    assert checkpoint["adapter_status"] == "standalone_precomputed_checkpoint"

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


def test_yale_checkpoint_expands_to_382_explicit_chronicle_mappings() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    checkpoint = load_yale_reconstruction_checkpoint(
        RECONSTRUCTION,
        COVERAGE_MANIFEST,
    )
    assert checkpoint.source_id == overview.source.source_id
    assert checkpoint.snapshot_id == overview.ledger_snapshot_id
    assert checkpoint.reconstruction_row_count == 420
    assert len(checkpoint.entries) == 382
    assert len({entry.fact_key for entry in checkpoint.entries}) == 382
    assert sum(entry.observed_period.value == "2022" for entry in checkpoint.entries) == 58
    assert sum(entry.observed_period.value == "2023" for entry in checkpoint.entries) == 232
    assert sum(entry.observed_period.value == "2024" for entry in checkpoint.entries) == 92
    assert set(checkpoint.verification_fact_keys) == {
        fact.fact_key for fact in overview.verification_facts
    }
    assert checkpoint.held_out_2022_row_count == 0
    assert checkpoint.unmatched_row_count == 41


def test_yale_checkpoint_adds_six_reviewed_2024_chronicle_benchmarks() -> None:
    checkpoint = load_yale_reconstruction_checkpoint(
        RECONSTRUCTION,
        COVERAGE_MANIFEST,
    )
    entries = {entry.fact_key: entry for entry in checkpoint.entries}
    expected = {
        "ledger.aggregate_fact.v2:79a47ff730c7a462e8cc1609",
        "ledger.aggregate_fact.v2:cb187e7abf9bdc592740e661",
        "ledger.aggregate_fact.v2:06c59904c06817cf61200eef",
        "ledger.aggregate_fact.v2:07c02eaf03cc25e2d454db3f",
        "ledger.aggregate_fact.v2:0e677ef6cb1f1142f25d25e9",
        "ledger.aggregate_fact.v2:709bcad59f889e75f143f9fc",
    }
    assert expected <= entries.keys()
    assert all(entries[fact_key].observed_period.value == "2024" for fact_key in expected)

    combined_income = entries[
        "ledger.aggregate_fact.v2:0e677ef6cb1f1142f25d25e9"
    ]
    assert combined_income.estimate == Decimal("297492207793.81948")
    assert len(combined_income.reconstruction_row_keys) == 3


def test_yale_checkpoint_allows_one_model_aggregate_to_validate_multiple_facts() -> None:
    checkpoint = load_yale_reconstruction_checkpoint(
        RECONSTRUCTION,
        COVERAGE_MANIFEST,
    )
    entries = {entry.fact_key: entry for entry in checkpoint.entries}
    irs_qualified_dividends = entries[
        "ledger.aggregate_fact.v2:e9177998f40a45b4641321ed"
    ]
    cbo_qualified_dividends = entries[
        "ledger.aggregate_fact.v2:709bcad59f889e75f143f9fc"
    ]
    assert irs_qualified_dividends.reconstruction_row_keys == (
        "irs_soi.ty2023.congressional_district_2022.all_returns.us."
        "qualified_dividends_amount@2024",
    )
    assert (
        cbo_qualified_dividends.reconstruction_row_keys
        == irs_qualified_dividends.reconstruction_row_keys
    )


def test_yale_checkpoint_materializes_all_ten_reviewed_values() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    mappings = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    capabilities = CapabilityPlanner(
        mappings, snapshot_id=overview.ledger_snapshot_id
    ).classify_all(overview.verification_facts, [overview.source])
    checkpoint = load_yale_reconstruction_checkpoint(
        RECONSTRUCTION,
        COVERAGE_MANIFEST,
    )
    materialized, results = materialize_yale_reconstruction_results(
        capabilities,
        overview.verification_facts,
        checkpoint,
        aligned_facts=(),
        source=overview.source,
    )
    assert len(materialized) == 10
    assert len(results) == 10
    assert all(row.execution_method is ExecutionMethod.PRECOMPUTED for row in materialized)
    assert all(row.status is CapabilityStatus.MODEL for row in materialized)
    assert all(row.period_treatment is PeriodTreatment.NATIVE for row in materialized)
    assert all(row.query is None and row.score_eligible for row in materialized)
    assert all(
        row.estimate_basis == "yale_reconstruction_aggregate_checkpoint"
        for row in results
    )


def test_yale_2023_result_reuses_the_published_microcosm_alignment() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    checkpoint = load_yale_reconstruction_checkpoint(
        RECONSTRUCTION,
        COVERAGE_MANIFEST,
    )
    entry = next(
        row for row in checkpoint.entries if row.observed_period.value == "2023"
    )
    fact = replace(
        overview.verification_facts[0],
        fact_key=entry.fact_key,
        period=entry.observed_period,
        value=Decimal("100"),
    )
    capabilities = CapabilityPlanner(
        MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml"),
        snapshot_id=overview.ledger_snapshot_id,
    ).classify_all([fact], [overview.source])
    alignment = AlignedFact(
        alignment_id="microcosm-release-target:test:2023-to-2024",
        source_fact_key=fact.fact_key,
        observed_period=fact.period,
        observed_value=fact.value,
        target_period=overview.source.population_period,
        aligned_value=Decimal("110"),
        alignment_model="cbo_growth_factor_aging",
        alignment_version="1.2.0",
        factor_sources=("test",),
        method_quality=AlignmentQuality.VALIDATED,
        backtest_error=None,
        metadata={"benchmark_basis": "exact_compiled_microcosm_build_target"},
    )
    materialized, results = materialize_yale_reconstruction_results(
        capabilities,
        [fact],
        checkpoint,
        aligned_facts=[alignment],
        source=overview.source,
    )
    assert len(results) == 1
    assert materialized[0].status is CapabilityStatus.PROJECTED
    assert materialized[0].period_treatment is PeriodTreatment.ALIGNED_FACT
    assert materialized[0].alignment_id == alignment.alignment_id


def test_yale_2022_result_reuses_the_published_microcosm_alignment() -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    checkpoint = load_yale_reconstruction_checkpoint(
        RECONSTRUCTION,
        COVERAGE_MANIFEST,
    )
    entry = next(
        row for row in checkpoint.entries if row.observed_period.value == "2022"
    )
    fact = replace(
        overview.verification_facts[0],
        fact_key=entry.fact_key,
        period=entry.observed_period,
        value=Decimal("100"),
    )
    capabilities = CapabilityPlanner(
        MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml"),
        snapshot_id=overview.ledger_snapshot_id,
    ).classify_all([fact], [overview.source])
    alignment = AlignedFact(
        alignment_id="microcosm-release-target:test:2022-to-2024",
        source_fact_key=fact.fact_key,
        observed_period=fact.period,
        observed_value=fact.value,
        target_period=overview.source.population_period,
        aligned_value=Decimal("120"),
        alignment_model="microcosm_compiled_target_registry",
        alignment_version="test",
        factor_sources=("exact_compiled_microcosm_build_target",),
        method_quality=AlignmentQuality.VALIDATED,
        backtest_error=None,
        metadata={"benchmark_basis": "exact_compiled_microcosm_build_target"},
    )
    materialized, results = materialize_yale_reconstruction_results(
        capabilities,
        [fact],
        checkpoint,
        aligned_facts=[alignment],
        source=overview.source,
    )
    assert len(results) == 1
    assert materialized[0].status is CapabilityStatus.PROJECTED
    assert materialized[0].period_treatment is PeriodTreatment.ALIGNED_FACT
    assert materialized[0].alignment_id == alignment.alignment_id


def test_yale_checkpoint_rejects_reconstruction_byte_drift(tmp_path: Path) -> None:
    changed = tmp_path / "changed-yale.json"
    changed.write_text(RECONSTRUCTION.read_text() + "\n")
    with pytest.raises(ValueError, match="SHA-256"):
        load_yale_reconstruction_checkpoint(changed, COVERAGE_MANIFEST)


def test_yale_overview_declares_access_boundary_and_includes_taxable_income() -> None:
    payload = yaml.safe_load((INTEGRATION / "overview.yaml").read_text())
    assert payload["reconstruction"]["official_yale_output"] is False
    assert payload["reconstruction"]["committed_aggregate_checkpoint_available"] is True
    assert payload["reconstruction"]["record_level_detail_available"] is False
    assert (
        payload["reconstruction"]["record_level_detail_required_for_fresh_model_run"]
        is True
    )
    assert payload["reconstruction"]["checkpoint_mapping_file"] == (
        "checkpoint_mappings.json"
    )
    assert payload["reconstruction"]["taxable_income_checkpoint_status"] == (
        "evaluated_via_exact_microcosm_2022_to_2024_alignment"
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
