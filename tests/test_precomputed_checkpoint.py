import json
from decimal import Decimal
from pathlib import Path

import pytest

from evaluation_harness.adapters.precomputed_checkpoint import (
    CHECKPOINT_SCHEMA,
    checkpoint_calibration_exposure,
    load_precomputed_checkpoint,
    materialize_precomputed_checkpoint_results,
    precomputed_checkpoint_capability_specs,
)
from evaluation_harness.contracts import (
    CalibrationExposure,
    CapabilityResult,
    CapabilityStatus,
    ExecutionMethod,
    FactContract,
    PeriodTreatment,
    SourceType,
    TypedPeriod,
)
from evaluation_harness.planner import EvaluationSourceManifest


PERIOD = TypedPeriod.parse("calendar_year:2026")


def fact(key: str, record_id: str, value: str) -> FactContract:
    return FactContract(
        fact_key=key,
        source="statbel_population_structure",
        jurisdiction="BE",
        period=PERIOD,
        geography_level="country",
        geography_id="BE",
        entity="person",
        measure="people",
        unit="count",
        value=Decimal(value),
        dimensions={},
        universe_constraints=(),
        provenance_class="administrative",
        lineage={"source_record_id": record_id},
    )


def source() -> EvaluationSourceManifest:
    return EvaluationSourceManifest(
        source_id="fixture_source",
        source_type=SourceType.MODEL_DATASET_PAIR,
        dataset_version="fixture_dataset",
        model_version="fixture_engine",
        jurisdictions=frozenset({"BE"}),
        population_period=PERIOD,
        policy_period=PERIOD,
        native_fact_periods=frozenset({PERIOD.canonical}),
        advanced_fact_periods=frozenset(),
        geographies=frozenset({"country"}),
        entities=frozenset({"person"}),
        weights={"person": "person_weight"},
        geography_methods={"country": "national"},
        available=True,
    )


def checkpoint_payload() -> dict:
    return {
        "schema_version": CHECKPOINT_SCHEMA,
        "source_id": "fixture_source",
        "label": "Fixture source",
        "engine": "fixture_engine",
        "dataset": "fixture_dataset",
        "jurisdiction": "BE",
        "population_year": 2026,
        "provenance": "Fixture provenance retained verbatim.",
        "inputs": {"sha256": "abc"},
        "rows": [
            {
                "row_key": "population_sum",
                "role": "target",
                "concept": "two-part population",
                "period": 2026,
                "chronicle_record_ids": ["record-a", "record-b"],
                "benchmark_value": 30,
                "estimate": 31,
                "estimate_basis": "dataset_weights",
                "unit": "persons",
                "note": "calibrated weights",
            },
            {
                "row_key": "simulated_target",
                "role": "target",
                "concept": "simulated calibrated concept",
                "period": 2026,
                "chronicle_record_ids": ["record-c"],
                "benchmark_value": 40,
                "estimate": 38,
                "estimate_basis": "engine_simulated",
                "unit": "persons",
                "note": "independent engine value",
            },
            {
                "row_key": "unsupported_validation",
                "role": "validation",
                "concept": "unavailable concept",
                "period": 2026,
                "chronicle_record_ids": ["record-d"],
                "benchmark_value": 50,
                "estimate": None,
                "estimate_basis": "unsupported",
                "unit": "persons",
                "note": "checkpoint does not contain this estimate",
            },
        ],
    }


def write_checkpoint(path: Path, payload: dict | None = None) -> None:
    path.write_text(json.dumps(payload or checkpoint_payload()))


def fixture_facts() -> tuple[FactContract, ...]:
    return (
        fact("fact-a", "record-a", "10"),
        fact("fact-b", "record-b", "20"),
        fact("fact-c", "record-c", "40"),
        fact("fact-d", "record-d", "50"),
    )


@pytest.mark.parametrize(
    ("record_ids", "basis", "targets", "expected"),
    [
        (
            ("a", "b"),
            "dataset_weights",
            {"a", "b"},
            CalibrationExposure.DIRECT_CALIBRATION_TARGET,
        ),
        (
            ("a",),
            "calibration_measure",
            {"a"},
            CalibrationExposure.DIRECT_CALIBRATION_TARGET,
        ),
        (
            ("a",),
            "engine_simulated",
            {"a"},
            CalibrationExposure.RELATED_CALIBRATION_FAMILY,
        ),
        (
            ("a",),
            "input_carried",
            {"a"},
            CalibrationExposure.OUT_OF_SAMPLE,
        ),
        (
            ("a", "b"),
            "dataset_weights",
            {"a"},
            CalibrationExposure.OUT_OF_SAMPLE,
        ),
        (
            ("a",),
            "unsupported",
            {"a"},
            CalibrationExposure.OUT_OF_SAMPLE,
        ),
    ],
)
def test_checkpoint_calibration_exposure_rule(
    record_ids: tuple[str, ...],
    basis: str,
    targets: set[str],
    expected: CalibrationExposure,
) -> None:
    assert checkpoint_calibration_exposure(record_ids, basis, targets) is expected


def test_load_checkpoint_resolves_composite_to_one_summed_score(
    tmp_path: Path,
) -> None:
    checkpoint_path = tmp_path / "checkpoint.json"
    write_checkpoint(checkpoint_path)

    checkpoint = load_precomputed_checkpoint(
        checkpoint_path,
        fixture_facts(),
        calibration_target_record_ids={"record-a", "record-b", "record-c"},
    )

    assert checkpoint.provenance == "Fixture provenance retained verbatim."
    assert checkpoint.row_count == checkpoint.resolved_row_count == 3
    composite = checkpoint.entries[0]
    assert composite.fact_keys == ("fact-a", "fact-b")
    assert composite.anchor_fact_key == "fact-a"
    assert composite.benchmark_value == Decimal("30")
    assert composite.calibration_exposure is (
        CalibrationExposure.DIRECT_CALIBRATION_TARGET
    )
    assert len(checkpoint.aligned_facts) == 2
    assert {row.aligned_value for row in checkpoint.aligned_facts} == {
        Decimal("30")
    }
    assert all(
        row.observed_value in {Decimal("10"), Decimal("20")}
        for row in checkpoint.aligned_facts
    )
    assert [row.score_eligible for row in checkpoint.declarations] == [True, False]
    assert all(row.semantic for row in checkpoint.declarations)
    anchor_alignment = checkpoint.aligned_facts[0]
    assert anchor_alignment.metadata["chronicle_record_ids"] == [
        "record-a",
        "record-b",
    ]
    assert anchor_alignment.metadata["input_fact_keys"] == ["fact-a", "fact-b"]
    assert checkpoint.aligned_facts[1].metadata["group_anchor_alignment_id"] == (
        anchor_alignment.alignment_id
    )


def test_checkpoint_specs_materialize_supported_and_explain_unsupported(
    tmp_path: Path,
) -> None:
    checkpoint_path = tmp_path / "checkpoint.json"
    write_checkpoint(checkpoint_path)
    facts = fixture_facts()
    checkpoint = load_precomputed_checkpoint(
        checkpoint_path,
        facts,
        calibration_target_record_ids={"record-a", "record-b", "record-c"},
    )
    manifest = source()
    specs = {
        spec.fact_key: spec
        for spec in precomputed_checkpoint_capability_specs(
            checkpoint,
            source=manifest,
        )
    }
    assert set(specs) == {"fact-a", "fact-c", "fact-d"}
    assert specs["fact-a"].status is CapabilityStatus.CALIBRATION_TARGET
    assert specs["fact-a"].period_treatment is PeriodTreatment.ALIGNED_FACT
    assert specs["fact-c"].status is CapabilityStatus.MODEL
    assert specs["fact-c"].calibration_exposure is (
        CalibrationExposure.RELATED_CALIBRATION_FAMILY
    )
    assert specs["fact-d"].status is CapabilityStatus.UNSUPPORTED_CONCEPT
    assert specs["fact-d"].reason_code == "checkpoint_estimate_unsupported"
    assert specs["fact-d"].reason_detail == (
        "checkpoint does not contain this estimate"
    )

    capabilities = tuple(
        CapabilityResult.unsupported(
            snapshot_id="snapshot-be",
            fact=row,
            source_id=manifest.source_id,
            source_type=manifest.source_type,
            mapping_release="empty-mappings",
            status=CapabilityStatus.UNSUPPORTED_CONCEPT,
            reason_code="mapping_not_found",
            reason_detail="No ordinary mapping exists.",
        )
        for row in facts
    )
    materialized, results = materialize_precomputed_checkpoint_results(
        capabilities,
        checkpoint,
        source=manifest,
    )
    by_fact = {row.fact_key: row for row in materialized}
    assert by_fact["fact-a"].execution_method is ExecutionMethod.PRECOMPUTED
    assert by_fact["fact-a"].score_eligible
    assert by_fact["fact-b"].reason_code == "mapping_not_found"
    assert by_fact["fact-d"].execution_method is ExecutionMethod.NONE
    assert by_fact["fact-d"].reason_code == "checkpoint_estimate_unsupported"
    assert by_fact["fact-d"].reason_detail == (
        "checkpoint does not contain this estimate"
    )
    assert by_fact["fact-d"].calibration_exposure is (
        CalibrationExposure.OUT_OF_SAMPLE
    )
    result_by_fact = {row.fact_key: row for row in results}
    assert set(result_by_fact) == {"fact-a", "fact-c"}
    assert result_by_fact["fact-a"].estimate == Decimal("31")
    assert result_by_fact["fact-a"].estimate_basis == "dataset_weights"
    assert result_by_fact["fact-c"].estimate_basis == "engine_simulated"


def test_checkpoint_rejects_benchmark_that_is_not_chronicle_sum(
    tmp_path: Path,
) -> None:
    payload = checkpoint_payload()
    payload["rows"][0]["benchmark_value"] = 29
    checkpoint_path = tmp_path / "checkpoint.json"
    write_checkpoint(checkpoint_path, payload)

    with pytest.raises(ValueError, match="benchmark does not match Chronicle sum"):
        load_precomputed_checkpoint(checkpoint_path, fixture_facts())
