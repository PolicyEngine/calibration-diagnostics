import hashlib
import json
from decimal import Decimal
from pathlib import Path

import pytest

from evaluation_harness.contracts import (
    AggregateQuery,
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
from evaluation_harness.frontend_bundle import (
    FRONTEND_BUNDLE_SCHEMA,
    publish_frontend_bundle,
)
from evaluation_harness.full_run import build_run_summary, build_scored_results
from evaluation_harness.publisher import publish_run
from evaluation_harness.snapshot import SNAPSHOT_SCHEMA


def fact(
    key: str,
    *,
    source: str = "irs_soi",
    measure: str = "irs_soi.adjusted_gross_income",
    period: str = "tax_year:2024",
    geography_level: str = "country",
    geography_id: str = "0100000US",
    entity: str = "tax_unit",
    unit: str = "usd",
    value: str = "100",
) -> FactContract:
    return FactContract(
        fact_key=key,
        source=source,
        jurisdiction="US",
        period=TypedPeriod.parse(period),
        geography_level=geography_level,
        geography_id=geography_id,
        entity=entity,
        measure=measure,
        unit=unit,
        value=Decimal(value),
        dimensions={"filing_status": "all"},
        universe_constraints=({"domain": "all_people"},),
        provenance_class="administrative",
        label=f"Label for {key}",
        lineage={"source_record_id": f"record-{key}"},
        source_metadata={
            "url": "https://example.test/source.csv",
            "source_table": "Example table",
            "source_sha256": "a" * 64,
        },
    )


def supported(ledger_fact: FactContract, source_id: str) -> CapabilityResult:
    return CapabilityResult(
        snapshot_id="ledger-test",
        fact_key=ledger_fact.fact_key,
        source_id=source_id,
        source_type=SourceType.MODEL_DATASET_PAIR,
        mapping_release=f"{source_id}-mapping-v1",
        status=CapabilityStatus.MODEL,
        reason_code=None,
        reason_detail=None,
        execution_method=ExecutionMethod.MODEL,
        mapping_id=f"{source_id}-agi",
        mapping_quality=MappingQuality.EXACT,
        fact_period=ledger_fact.period,
        population_period=TypedPeriod.parse("tax_year:2024"),
        policy_period=TypedPeriod.parse("tax_year:2024"),
        period_treatment=PeriodTreatment.NATIVE,
        alignment_id=None,
        alignment_quality=AlignmentQuality.NONE,
        entity=ledger_fact.entity,
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


def unsupported(
    ledger_fact: FactContract,
    source_id: str,
    *,
    status: CapabilityStatus,
    reason_code: str,
) -> CapabilityResult:
    return CapabilityResult.unsupported(
        snapshot_id="ledger-test",
        fact=ledger_fact,
        source_id=source_id,
        source_type=SourceType.MODEL_DATASET_PAIR,
        mapping_release=f"{source_id}-mapping-v1",
        status=status,
        reason_code=reason_code,
        reason_detail=f"Detail for {reason_code}",
    )


def result(cell: CapabilityResult, estimate: str) -> EvaluationResult:
    return EvaluationResult.from_capability(
        cell,
        estimate=Decimal(estimate),
        dataset_version=f"{cell.source_id}-data-v1",
        model_version=f"{cell.source_id}-model-v1",
    )


def published_inputs(tmp_path: Path) -> tuple[Path, Path]:
    facts = (
        fact("fact-a"),
        fact(
            "fact-b",
            source="census_acs",
            measure="census_acs.population",
            geography_level="state",
            geography_id="0400000US06",
            entity="person",
            unit="count",
            value="200",
        ),
        fact("fact-c", period="tax_year:2023", measure="irs_soi.ordinary_dividends"),
    )
    snapshot = tmp_path / "snapshot"
    snapshot.mkdir(parents=True)
    facts_text = "".join(f"{item.to_json()}\n" for item in facts)
    (snapshot / "facts.jsonl").write_text(facts_text)
    (snapshot / "snapshot_manifest.json").write_text(
        json.dumps(
            {
                "schema_version": SNAPSHOT_SCHEMA,
                "snapshot_id": "ledger-test",
                "fact_count": len(facts),
                "normalized_facts_sha256": hashlib.sha256(facts_text.encode()).hexdigest(),
            }
        )
    )

    populace_a = supported(facts[0], "populace")
    populace_b = supported(facts[1], "populace")
    cps_a = supported(facts[0], "cps")
    capabilities = (
        populace_a,
        populace_b,
        unsupported(
            facts[2],
            "populace",
            status=CapabilityStatus.UNSUPPORTED_PERIOD,
            reason_code="period_not_supported",
        ),
        cps_a,
        unsupported(
            facts[1],
            "cps",
            status=CapabilityStatus.UNSUPPORTED_GEOGRAPHY,
            reason_code="geography_not_supported",
        ),
        unsupported(
            facts[2],
            "cps",
            status=CapabilityStatus.UNSUPPORTED_PERIOD,
            reason_code="period_not_supported",
        ),
    )
    results = (
        result(populace_a, "101"),
        result(populace_b, "198"),
        result(cps_a, "90"),
    )
    scores = build_scored_results(facts, capabilities, results, ())
    summary = build_run_summary(facts, capabilities, results, scores)
    run = tmp_path / "run"
    publish_run(run, capabilities, results, scores=scores, summary=summary)
    return snapshot, run


def test_frontend_bundle_is_partitioned_complete_and_sparse(tmp_path: Path) -> None:
    snapshot, run = published_inputs(tmp_path)
    output = tmp_path / "frontend"
    manifest = publish_frontend_bundle(
        snapshot,
        run,
        output,
        page_size=2,
        source_labels={
            "populace": "Populace + PolicyEngine-US",
            "cps": "Tax-Calculator + public CPS",
        },
    )

    assert manifest["schema_version"] == FRONTEND_BUNDLE_SCHEMA
    assert manifest["fact_count"] == 3
    assert manifest["page_count"] == 2
    assert [part["count"] for part in manifest["partitions"]["facts"]] == [2, 1]

    summary = json.loads((output / "summary.json").read_text())
    assert summary["matrix_complete"] is True
    assert summary["sources"][1]["label"] == "Populace + PolicyEngine-US"
    assert summary["sources"][0]["result_count"] == 1

    first_page = json.loads((output / "facts" / "00001.json").read_text())
    assert [row["fact_key"] for row in first_page["rows"]] == ["fact-a", "fact-b"]
    state = first_page["rows"][1]
    assert state["sources"]["populace"]["estimate"] == "198"
    assert state["sources"]["cps"] == {
        "status": "unsupported_geography",
        "reason_code": "geography_not_supported",
        "reason_detail": "Detail for geography_not_supported",
        "execution_method": "none",
        "mapping_quality": "none",
        "period_treatment": "unsupported",
        "calibration_exposure": "unknown_exposure",
        "score_eligible": False,
    }
    assert state["provenance"]["url"] == "https://example.test/source.csv"

    index = json.loads((output / "fact-index.json").read_text())
    assert index["facts"] == {"fact-a": 1, "fact-b": 1, "fact-c": 2}
    groups = json.loads((output / "groups.json").read_text())["groups"]
    state_group = next(
        row for row in groups if row["dimension"] == "geography" and row["key"] == "state"
    )
    assert state_group["sources"]["populace"]["evaluable"] == 1
    assert state_group["sources"]["cps"]["reason_codes"] == {
        "geography_not_supported": 1
    }
    exposure_group = next(
        row
        for row in groups
        if row["dimension"] == "calibration_exposure"
        and row["key"] == "external_validation"
    )
    assert exposure_group["sources"]["cps"]["scored"] == 1
    unsupported_period = next(
        row
        for row in groups
        if row["dimension"] == "period_treatment" and row["key"] == "unsupported"
    )
    assert unsupported_period["sources"]["cps"]["evaluable"] == 0


def test_frontend_bundle_verifies_source_hashes_and_is_immutable(tmp_path: Path) -> None:
    snapshot, run = published_inputs(tmp_path)
    output = tmp_path / "frontend"
    (run / "scores.jsonl").write_text("tampered\n")
    with pytest.raises(ValueError, match="hash"):
        publish_frontend_bundle(snapshot, run, output)

    snapshot, run = published_inputs(tmp_path / "second")
    publish_frontend_bundle(snapshot, run, output)
    with pytest.raises(FileExistsError):
        publish_frontend_bundle(snapshot, run, output)
