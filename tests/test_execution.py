from dataclasses import replace
from decimal import Decimal
from pathlib import Path

import pyarrow.parquet as pq
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
from evaluation_harness.execution import (
    ArrayBundle,
    EvaluationResult,
    RunGroup,
    aggregate_query,
    build_run_groups,
    execute_groups,
    run_group_cache_key,
    validate_results,
)
from evaluation_harness.publisher import publish_run
from evaluation_harness.full_run import build_scored_results, build_run_summary


def capability(
    fact_key: str,
    expression: str,
    *,
    operation: str = "weighted_sum",
    constraints: tuple[dict, ...] = (),
    denominator: str | None = None,
) -> CapabilityResult:
    return CapabilityResult(
        snapshot_id="ledger-snapshot-1",
        fact_key=fact_key,
        source_id="fixture-source",
        source_type=SourceType.MODEL_DATASET_PAIR,
        mapping_release="us-v1",
        status=CapabilityStatus.DIRECT,
        reason_code=None,
        reason_detail=None,
        execution_method=ExecutionMethod.DIRECT,
        mapping_id=f"mapping.{fact_key}",
        mapping_quality=MappingQuality.EXACT,
        fact_period=TypedPeriod.parse("tax_year:2024"),
        population_period=TypedPeriod.parse("calendar_year:2024"),
        policy_period=TypedPeriod.parse("tax_year:2024"),
        period_treatment=PeriodTreatment.NATIVE,
        alignment_id=None,
        alignment_quality=AlignmentQuality.NONE,
        entity="tax_unit",
        weight_variable="weight",
        required_variables=tuple(filter(None, [expression, denominator])),
        geography_method="national",
        query=AggregateQuery(
            operation=operation,
            value_expression=expression,
            denominator_expression=denominator,
            weight="weight",
            constraints=constraints,
        ),
        calibration_exposure=CalibrationExposure.HOLDOUT,
        score_eligible=True,
    )


@pytest.fixture
def arrays() -> ArrayBundle:
    return ArrayBundle(
        arrays={
            "income": [10, 20, 30, 40],
            "benefit": [0, 5, 0, 10],
            "denominator": [2, 2, 2, 2],
            "weight": [1, 2, 1, 1],
            "filing_status": ["single", "joint", "single", "joint"],
            "agi": [5, 15, 25, 35],
        },
        dataset_version="fixture-data-v1",
        model_version="fixture-model-v1",
    )


def test_weighted_aggregation_operations(arrays: ArrayBundle) -> None:
    assert aggregate_query(capability("sum", "income").query, arrays) == Decimal("120")
    assert aggregate_query(
        capability("count", "benefit", operation="weighted_count").query, arrays
    ) == Decimal("3")
    assert aggregate_query(
        capability("mean", "income", operation="weighted_mean").query, arrays
    ) == Decimal("24")
    assert aggregate_query(
        capability(
            "ratio",
            "income",
            operation="ratio",
            denominator="denominator",
        ).query,
        arrays,
    ) == Decimal("12")


def test_common_predicates_filter_dimensions_and_ranges(arrays: ArrayBundle) -> None:
    query = capability(
        "filtered",
        "income",
        constraints=(
            {"dimension": "filing_status", "value": "single"},
            {"variable": "agi", "operator": "gte", "value": 20},
            {"variable": "agi", "operator": "lt", "value": 30},
        ),
    ).query
    assert aggregate_query(query, arrays) == Decimal("30")


def test_incompatible_array_lengths_are_rejected(arrays: ArrayBundle) -> None:
    broken = replace(arrays, arrays={**arrays.arrays, "income": [1, 2]})
    with pytest.raises(ValueError, match="length"):
        aggregate_query(capability("sum", "income").query, broken)


def test_capabilities_are_grouped_for_one_source_run() -> None:
    capabilities = [
        capability("a", "income"),
        capability("b", "benefit"),
    ]
    groups = build_run_groups(capabilities)
    assert len(groups) == 1
    assert groups[0].fact_keys == ("a", "b")
    assert set(groups[0].required_variables) == {"income", "benefit", "weight"}


class FixtureRunner:
    def __init__(self, arrays: ArrayBundle) -> None:
        self.arrays = arrays
        self.prepare_count = 0

    def prepare(self, group: RunGroup) -> ArrayBundle:
        self.prepare_count += 1
        return self.arrays


def test_execution_prepares_each_group_once(arrays: ArrayBundle) -> None:
    capabilities = [capability("a", "income"), capability("b", "benefit")]
    runner = FixtureRunner(arrays)
    results = execute_groups(build_run_groups(capabilities), capabilities, {"fixture-source": runner})
    assert runner.prepare_count == 1
    assert {result.fact_key: result.estimate for result in results} == {
        "a": Decimal("120"),
        "b": Decimal("20"),
    }


def test_cache_key_changes_for_every_reproducibility_input() -> None:
    group = build_run_groups([capability("a", "income")])[0]
    base = run_group_cache_key(
        group,
        ledger_subset_hash="facts-1",
        source_manifest_hash="source-1",
        mapping_hash="mapping-1",
        alignment_hash="alignment-1",
        harness_version="code-1",
    )
    fields = {
        "ledger_subset_hash": "facts-2",
        "source_manifest_hash": "source-2",
        "mapping_hash": "mapping-2",
        "alignment_hash": "alignment-2",
        "harness_version": "code-2",
    }
    for key, value in fields.items():
        arguments = {
            "ledger_subset_hash": "facts-1",
            "source_manifest_hash": "source-1",
            "mapping_hash": "mapping-1",
            "alignment_hash": "alignment-1",
            "harness_version": "code-1",
        }
        arguments[key] = value
        assert run_group_cache_key(group, **arguments) != base


def test_validation_rejects_results_without_capability_and_duplicates() -> None:
    cap = capability("a", "income")
    result = EvaluationResult.from_capability(
        cap,
        estimate=Decimal("100"),
        dataset_version="data-v1",
        model_version="model-v1",
    )
    validate_results([cap], [result])
    with pytest.raises(ValueError, match="duplicate"):
        validate_results([cap], [result, result])
    with pytest.raises(ValueError, match="capability"):
        validate_results([], [result])


def test_publish_run_is_immutable_and_writes_json_and_parquet(tmp_path: Path) -> None:
    cap = capability("a", "income")
    result = EvaluationResult.from_capability(
        cap,
        estimate=Decimal("100"),
        dataset_version="data-v1",
        model_version="model-v1",
    )
    output = tmp_path / "run"
    facts = [
        FactContract(
            fact_key="a",
            source="fixture",
            jurisdiction="US",
            period=TypedPeriod.parse("tax_year:2024"),
            geography_level="country",
            geography_id="0100000US",
            entity="tax_unit",
            measure="fixture.income",
            unit="usd",
            value=Decimal("80"),
            dimensions={},
            universe_constraints=(),
            provenance_class="fixture",
        )
    ]
    scores = build_scored_results(facts, [cap], [result], [])
    summary = build_run_summary(facts, [cap], [result], scores)
    manifest = publish_run(
        output,
        [cap],
        [result],
        scores=scores,
        summary=summary,
    )
    assert manifest["result_count"] == 1
    assert manifest["score_count"] == 1
    assert (output / "capabilities.jsonl").exists()
    assert (output / "estimates.jsonl").exists()
    assert (output / "scores.jsonl").exists()
    assert (output / "summary.json").exists()
    assert pq.read_table(output / "capabilities.parquet").num_rows == 1
    assert pq.read_table(output / "estimates.parquet").num_rows == 1
    assert pq.read_table(output / "scores.parquet").num_rows == 1
    assert (output / "alignments.jsonl").read_text() == ""
    with pytest.raises(FileExistsError):
        publish_run(output, [cap], [result])


def test_publish_run_carries_the_observed_and_aged_benchmarks(tmp_path: Path) -> None:
    cap = replace(
        capability("aged", "income"),
        status=CapabilityStatus.PROJECTED,
        fact_period=TypedPeriod.parse("tax_year:2023"),
        period_treatment=PeriodTreatment.ALIGNED_FACT,
        alignment_id="cbo_growth_factor_aging@1.2.0:aged",
        alignment_quality=AlignmentQuality.VALIDATED,
        score_eligible=False,
    )
    result = EvaluationResult.from_capability(
        cap,
        estimate=Decimal("115"),
        dataset_version="data-v1",
        model_version="model-v1",
    )
    alignment = AlignedFact(
        alignment_id=cap.alignment_id,
        source_fact_key=cap.fact_key,
        observed_period=TypedPeriod.parse("tax_year:2023"),
        observed_value=Decimal("100"),
        target_period=TypedPeriod.parse("tax_year:2024"),
        aligned_value=Decimal("110"),
        alignment_model="cbo_growth_factor_aging",
        alignment_version="1.2.0",
        factor_sources=("cbo.ty2024.agi",),
        method_quality=AlignmentQuality.VALIDATED,
        backtest_error=None,
        metadata={"aging_factor": "1.1", "note": "Aged using Populace logic."},
    )
    output = tmp_path / "aged-run"
    manifest = publish_run(output, [cap], [result], [alignment])
    row = __import__("json").loads((output / "alignments.jsonl").read_text())
    assert manifest["alignment_count"] == 1
    assert row["observed_value"] == "100"
    assert row["aligned_value"] == "110"
    assert row["metadata"]["note"] == "Aged using Populace logic."
