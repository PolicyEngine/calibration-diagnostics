import hashlib
import json
from dataclasses import replace
from decimal import Decimal
from pathlib import Path

import pytest

from evaluation_harness.contracts import (
    AggregateQuery,
    AlignedFact,
    AlignmentQuality,
    CalibrationExposure,
    CapabilityResult,
    CapabilityStatus,
    ExecutionMethod,
    FactContract,
    MappingQuality,
    PeriodTreatment,
    SourceType,
    TypedPeriod,
)
from evaluation_harness.execution import EvaluationResult
from evaluation_harness.full_run import (
    SourcePlan,
    build_full_capability_matrix,
    build_scored_results,
    build_run_summary,
    load_snapshot_facts,
)
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import EvaluationSourceManifest


def fact(
    fact_key: str,
    *,
    period: str = "tax_year:2024",
    value: str = "100",
) -> FactContract:
    return FactContract(
        fact_key=fact_key,
        source="irs_soi",
        jurisdiction="US",
        period=TypedPeriod.parse(period),
        geography_level="country",
        geography_id="0100000US",
        entity="tax_unit",
        measure="irs_soi.adjusted_gross_income",
        unit="usd",
        value=Decimal(value),
        dimensions={},
        universe_constraints=(),
        provenance_class="administrative",
        aggregation={"method": "sum"},
    )


def registry(release: str) -> MappingRegistry:
    return MappingRegistry.from_data(
        {
            "mapping_release": release,
            "mappings": [
                {
                    "mapping_id": f"{release}.agi",
                    "ledger_selector": {
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


def source(source_id: str) -> EvaluationSourceManifest:
    return EvaluationSourceManifest(
        source_id=source_id,
        source_type=SourceType.MODEL_DATASET_PAIR,
        dataset_version=f"{source_id}-data",
        model_version=f"{source_id}-model",
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


def capability(
    ledger_fact: FactContract,
    *,
    source_id: str = "populace",
    treatment: PeriodTreatment = PeriodTreatment.NATIVE,
    alignment_id: str | None = None,
) -> CapabilityResult:
    return CapabilityResult(
        snapshot_id="ledger-test",
        fact_key=ledger_fact.fact_key,
        source_id=source_id,
        source_type=SourceType.MODEL_DATASET_PAIR,
        mapping_release=f"{source_id}-mappings",
        status=(
            CapabilityStatus.PROJECTED
            if treatment is PeriodTreatment.ALIGNED_FACT
            else CapabilityStatus.MODEL
        ),
        reason_code=None,
        reason_detail=None,
        execution_method=ExecutionMethod.MODEL,
        mapping_id="agi",
        mapping_quality=MappingQuality.EXACT,
        fact_period=ledger_fact.period,
        population_period=TypedPeriod.parse("tax_year:2024"),
        policy_period=TypedPeriod.parse("tax_year:2024"),
        period_treatment=treatment,
        alignment_id=alignment_id,
        alignment_quality=(
            AlignmentQuality.VALIDATED
            if alignment_id
            else AlignmentQuality.NONE
        ),
        entity="tax_unit",
        weight_variable="weight",
        required_variables=("agi",),
        geography_method="fixed_country",
        query=AggregateQuery(
            operation="weighted_sum",
            value_expression="agi",
            weight="weight",
        ),
        calibration_exposure=CalibrationExposure.EXTERNAL_VALIDATION,
        score_eligible=True,
    )


def result(cell: CapabilityResult, estimate: str) -> EvaluationResult:
    return EvaluationResult.from_capability(
        cell,
        estimate=Decimal(estimate),
        dataset_version="data-v1",
        model_version="model-v1",
    )


def test_full_matrix_contains_one_cell_for_every_fact_source_pair() -> None:
    facts = (
        fact("ledger.aggregate_fact.v2:aaaaaaaaaaaaaaaaaaaaaaaa"),
        fact("ledger.aggregate_fact.v2:bbbbbbbbbbbbbbbbbbbbbbbb"),
        fact("ledger.aggregate_fact.v2:cccccccccccccccccccccccc"),
    )
    plans = (
        SourcePlan(source("populace"), registry("populace-v1")),
        SourcePlan(source("taxcalc-cps"), registry("taxcalc-v1")),
    )
    cells = build_full_capability_matrix(facts, plans, snapshot_id="ledger-test")
    assert len(cells) == len(facts) * len(plans)
    assert {(cell.fact_key, cell.source_id) for cell in cells} == {
        (ledger_fact.fact_key, plan.source.source_id)
        for ledger_fact in facts
        for plan in plans
    }


def test_source_plan_propagates_fact_specific_calibration_exposure() -> None:
    ledger_fact = fact("ledger.aggregate_fact.v2:exposure")
    plan = SourcePlan(
        source("populace"),
        registry("populace-v1"),
        calibration_exposures={
            ledger_fact.fact_key: CalibrationExposure.DIRECT_CALIBRATION_TARGET
        },
    )

    cell = build_full_capability_matrix(
        [ledger_fact], [plan], snapshot_id="ledger-test"
    )[0]

    assert cell.status is CapabilityStatus.CALIBRATION_TARGET
    assert cell.calibration_exposure is CalibrationExposure.DIRECT_CALIBRATION_TARGET


def test_native_result_is_scored_against_observed_ledger_value() -> None:
    ledger_fact = fact("ledger.aggregate_fact.v2:aaaaaaaaaaaaaaaaaaaaaaaa")
    cell = capability(ledger_fact)
    scored = build_scored_results(
        [ledger_fact], [cell], [result(cell, "110")], []
    )[0]
    assert scored.observed_value == Decimal("100")
    assert scored.benchmark_value == Decimal("100")
    assert scored.benchmark_period == TypedPeriod.parse("tax_year:2024")
    assert scored.benchmark_basis == "ledger_observed"
    assert scored.absolute_relative_error == Decimal("0.1")


def test_aligned_result_is_scored_against_transformed_not_2023_value() -> None:
    ledger_fact = fact(
        "ledger.aggregate_fact.v2:aaaaaaaaaaaaaaaaaaaaaaaa",
        period="tax_year:2023",
    )
    alignment_id = "populace-aging:agi-2023-2024"
    cell = capability(
        ledger_fact,
        treatment=PeriodTreatment.ALIGNED_FACT,
        alignment_id=alignment_id,
    )
    alignment = AlignedFact(
        alignment_id=alignment_id,
        source_fact_key=ledger_fact.fact_key,
        observed_period=ledger_fact.period,
        observed_value=Decimal("100"),
        target_period=TypedPeriod.parse("tax_year:2024"),
        aligned_value=Decimal("125"),
        alignment_model="cbo_growth_factor_aging",
        alignment_version="1.2.0",
        factor_sources=("cbo",),
        method_quality=AlignmentQuality.VALIDATED,
        backtest_error=None,
    )
    scored = build_scored_results(
        [ledger_fact], [cell], [result(cell, "100")], [alignment]
    )[0]
    assert scored.observed_value == Decimal("100")
    assert scored.benchmark_value == Decimal("125")
    assert scored.benchmark_period == TypedPeriod.parse("tax_year:2024")
    assert scored.benchmark_basis == "populace_aligned_fact"
    assert scored.absolute_relative_error == Decimal("0.2")


def test_scoring_rejects_an_aligned_result_without_its_benchmark() -> None:
    ledger_fact = fact(
        "ledger.aggregate_fact.v2:aaaaaaaaaaaaaaaaaaaaaaaa",
        period="tax_year:2023",
    )
    cell = capability(
        ledger_fact,
        treatment=PeriodTreatment.ALIGNED_FACT,
        alignment_id="missing-alignment",
    )
    with pytest.raises(ValueError, match="aligned benchmark"):
        build_scored_results([ledger_fact], [cell], [result(cell, "100")], [])


def test_summary_proves_matrix_completeness_and_reports_unsupported_reasons() -> None:
    ledger_fact = fact("ledger.aggregate_fact.v2:aaaaaaaaaaaaaaaaaaaaaaaa")
    executable = capability(ledger_fact, source_id="populace")
    unsupported = CapabilityResult.unsupported(
        snapshot_id="ledger-test",
        fact=ledger_fact,
        source_id="taxcalc-cps",
        source_type=SourceType.MODEL_DATASET_PAIR,
        mapping_release="taxcalc-v1",
        status=CapabilityStatus.UNSUPPORTED_CONCEPT,
        reason_code="mapping_not_found",
        reason_detail="No reviewed mapping.",
    )
    evaluated = result(executable, "110")
    scored = build_scored_results(
        [ledger_fact], [executable, unsupported], [evaluated], []
    )
    summary = build_run_summary(
        [ledger_fact], [executable, unsupported], [evaluated], scored
    )
    assert summary["expected_capability_count"] == 2
    assert summary["capability_count"] == 2
    assert summary["matrix_complete"] is True
    assert summary["sources"]["taxcalc-cps"]["reason_codes"] == {
        "mapping_not_found": 1
    }


def test_snapshot_loader_verifies_count_and_normalized_hash(tmp_path: Path) -> None:
    snapshot = tmp_path / "snapshot"
    snapshot.mkdir()
    ledger_fact = fact("ledger.aggregate_fact.v2:aaaaaaaaaaaaaaaaaaaaaaaa")
    facts_text = ledger_fact.to_json() + "\n"
    (snapshot / "facts.jsonl").write_text(facts_text)
    (snapshot / "snapshot_manifest.json").write_text(
        json.dumps(
            {
                "schema_version": "evaluation_harness.ledger_snapshot.v1",
                "snapshot_id": "ledger-test",
                "fact_count": 1,
                "normalized_facts_sha256": hashlib.sha256(
                    facts_text.encode()
                ).hexdigest(),
            }
        )
    )
    loaded, manifest = load_snapshot_facts(snapshot)
    assert loaded == (ledger_fact,)
    assert manifest["snapshot_id"] == "ledger-test"

    bad_manifest = json.loads((snapshot / "snapshot_manifest.json").read_text())
    bad_manifest["fact_count"] = 2
    (snapshot / "snapshot_manifest.json").write_text(json.dumps(bad_manifest))
    with pytest.raises(ValueError, match="fact count"):
        load_snapshot_facts(snapshot)
