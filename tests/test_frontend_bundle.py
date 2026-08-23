import hashlib
import json
from dataclasses import replace
from decimal import Decimal
from pathlib import Path
from typing import Any

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
    _build_groups,
    _performance_buckets,
    frontend_bundle_partitions,
    publish_frontend_bundle,
    verify_frontend_bundle,
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
    jurisdiction: str = "US",
) -> FactContract:
    return FactContract(
        fact_key=key,
        source=source,
        jurisdiction=jurisdiction,
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


def supported(chronicle_fact: FactContract, source_id: str) -> CapabilityResult:
    return CapabilityResult(
        snapshot_id="chronicle-test",
        fact_key=chronicle_fact.fact_key,
        source_id=source_id,
        source_type=SourceType.MODEL_DATASET_PAIR,
        mapping_release=f"{source_id}-mapping-v1",
        status=CapabilityStatus.MODEL,
        reason_code=None,
        reason_detail=None,
        execution_method=ExecutionMethod.MODEL,
        mapping_id=f"{source_id}-agi",
        mapping_quality=MappingQuality.EXACT,
        fact_period=chronicle_fact.period,
        population_period=TypedPeriod.parse("tax_year:2024"),
        policy_period=TypedPeriod.parse("tax_year:2024"),
        period_treatment=PeriodTreatment.NATIVE,
        alignment_id=None,
        alignment_quality=AlignmentQuality.NONE,
        entity=chronicle_fact.entity,
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
    chronicle_fact: FactContract,
    source_id: str,
    *,
    status: CapabilityStatus,
    reason_code: str,
) -> CapabilityResult:
    return CapabilityResult.unsupported(
        snapshot_id="chronicle-test",
        fact=chronicle_fact,
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


def published_inputs(
    tmp_path: Path,
    *,
    include_non_us_snapshot_fact: bool = False,
    include_excluded_geography_fact: bool = False,
) -> tuple[Path, Path]:
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
    snapshot_facts = facts
    if include_non_us_snapshot_fact:
        snapshot_facts = (
            *facts,
            fact(
                "fact-be",
                source="statbel",
                measure="statbel.population",
                geography_id="BE",
                entity="person",
                unit="count",
                jurisdiction="BE",
            ),
        )
    if include_excluded_geography_fact:
        snapshot_facts = (
            *snapshot_facts,
            fact(
                "fact-guam",
                source="usda_snap",
                measure="usda_snap.total_benefits",
                geography_level="state",
                geography_id="0400000US66",
                entity="government",
                unit="usd",
            ),
        )
    snapshot = tmp_path / "snapshot"
    snapshot.mkdir(parents=True)
    facts_text = "".join(f"{item.to_json()}\n" for item in snapshot_facts)
    (snapshot / "facts.jsonl").write_text(facts_text)
    (snapshot / "snapshot_manifest.json").write_text(
        json.dumps(
            {
                "schema_version": SNAPSHOT_SCHEMA,
                "snapshot_id": "chronicle-test",
                "fact_count": len(snapshot_facts),
                "normalized_facts_sha256": hashlib.sha256(facts_text.encode()).hexdigest(),
            }
        )
    )

    microcosm_a = replace(
        supported(facts[0], "microcosm"),
        status=CapabilityStatus.CALIBRATION_TARGET,
        calibration_exposure=CalibrationExposure.DIRECT_CALIBRATION_TARGET,
    )
    microcosm_b = supported(facts[1], "microcosm")
    cps_a = supported(facts[0], "cps")
    capabilities = (
        microcosm_a,
        microcosm_b,
        unsupported(
            facts[2],
            "microcosm",
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
        result(microcosm_a, "101"),
        replace(
            result(microcosm_b, "140"),
            standard_error=Decimal("3"),
            margin_of_error_90=Decimal("4.935"),
        ),
        result(cps_a, "80"),
    )
    scores = build_scored_results(facts, capabilities, results, ())
    summary = build_run_summary(facts, capabilities, results, scores)
    if include_non_us_snapshot_fact or include_excluded_geography_fact:
        summary["evaluation_scope"] = {
            "jurisdictions": ["US"],
            "source_snapshot_fact_count": len(snapshot_facts),
            "included_fact_count": len(facts),
            "excluded_fact_count": len(snapshot_facts) - len(facts),
        }
        if include_excluded_geography_fact:
            summary["evaluation_scope"].update(
                {
                    "excluded_geography_ids": ["0400000US66"],
                    "excluded_geography_fact_count": 1,
                }
            )
    run = tmp_path / "run"
    publish_run(run, capabilities, results, scores=scores, summary=summary)
    return snapshot, run


def test_performance_buckets_use_ten_and_twenty_five_percent_boundaries() -> None:
    rows = [
        {
            "fact_key": "green",
            "score_eligible": True,
            "absolute_relative_error": "0.10",
        },
        {
            "fact_key": "yellow-low",
            "score_eligible": True,
            "absolute_relative_error": "0.10001",
        },
        {
            "fact_key": "yellow-high",
            "score_eligible": True,
            "absolute_relative_error": "0.25",
        },
        {
            "fact_key": "red",
            "score_eligible": True,
            "absolute_relative_error": "0.25001",
        },
        {
            "fact_key": "unavailable",
            "score_eligible": False,
            "absolute_relative_error": None,
        },
    ]

    assert _performance_buckets(
        rows, {row["fact_key"] for row in rows}, total=5
    ) == {
        "within_bounds": 1,
        "outside_bounds": 2,
        "far_outside_bounds": 1,
        "unavailable": 1,
        "total": 5,
    }


def test_shared_calibration_sample_unions_multiple_microcosm_sources() -> None:
    facts = (fact("fact-a"), fact("fact-b"))
    source_ids = [
        "microcosm_be_v04_axiom",
        "microcosm_be_v04_euromod",
        "euromod_be2025_jrc_silc",
    ]
    direct_by_source = {
        "microcosm_be_v04_axiom": {"fact-a"},
        "microcosm_be_v04_euromod": {"fact-b"},
        "euromod_be2025_jrc_silc": set(),
    }
    capabilities = [
        {
            "source_id": source_id,
            "fact_key": chronicle_fact.fact_key,
            "execution_method": "precomputed",
            "period_treatment": "native",
            "calibration_exposure": (
                "direct_calibration_target"
                if chronicle_fact.fact_key in direct_by_source[source_id]
                else "out_of_sample"
            ),
            "reason_code": None,
        }
        for source_id in source_ids
        for chronicle_fact in facts
    ]

    groups = _build_groups(facts, source_ids, capabilities, [])

    in_sample = next(
        row
        for row in groups
        if row["dimension"] == "populace_calibration_sample"
        and row["key"] == "in_sample"
    )
    assert in_sample["fact_count"] == 2
    assert all(
        value["evaluable"] == 2 for value in in_sample["sources"].values()
    )


def test_frontend_bundle_is_partitioned_complete_and_sparse(tmp_path: Path) -> None:
    snapshot, run = published_inputs(tmp_path)
    output = tmp_path / "frontend"
    manifest = publish_frontend_bundle(
        snapshot,
        run,
        output,
        page_size=2,
        source_labels={
            "microcosm": "Microcosm + PolicyEngine-US",
            "cps": "Public CPS + Tax-Calculator",
        },
    )

    assert manifest["schema_version"] == FRONTEND_BUNDLE_SCHEMA
    assert manifest["fact_count"] == 3
    assert manifest["page_count"] == 2
    assert [part["count"] for part in manifest["partitions"]["facts"]] == [2, 1]

    summary = json.loads((output / "summary.json").read_text())
    assert summary["matrix_complete"] is True
    assert summary["sources"][1]["label"] == "Microcosm + PolicyEngine-US"
    assert summary["sources"][0]["result_count"] == 1
    assert summary["sources"][0]["performance_buckets"] == {
        "within_bounds": 0,
        "outside_bounds": 1,
        "far_outside_bounds": 0,
        "unavailable": 2,
        "total": 3,
    }
    assert summary["sources"][1]["performance_buckets"] == {
        "within_bounds": 1,
        "outside_bounds": 0,
        "far_outside_bounds": 1,
        "unavailable": 1,
        "total": 3,
    }

    first_page = json.loads((output / "facts" / "00001.json").read_text())
    assert [row["fact_key"] for row in first_page["rows"]] == ["fact-a", "fact-b"]
    state = first_page["rows"][1]
    assert state["sources"]["microcosm"]["estimate"] == "140"
    assert state["sources"]["microcosm"]["standard_error"] == "3"
    assert state["sources"]["microcosm"]["margin_of_error_90"] == "4.935"
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
    assert state_group["sources"]["microcosm"]["evaluable"] == 1
    assert state_group["sources"]["microcosm"]["performance_buckets"] == {
        "within_bounds": 0,
        "outside_bounds": 0,
        "far_outside_bounds": 1,
        "unavailable": 0,
        "total": 1,
    }
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
    microcosm_in_sample = next(
        row
        for row in groups
        if row["dimension"] == "populace_calibration_sample"
        and row["key"] == "in_sample"
    )
    assert microcosm_in_sample["fact_count"] == 1
    assert microcosm_in_sample["sources"]["microcosm"]["evaluable"] == 1
    assert microcosm_in_sample["sources"]["cps"]["evaluable"] == 1
    assert microcosm_in_sample["sources"]["cps"]["loss"] == "0.2"
    microcosm_out_of_sample = next(
        row
        for row in groups
        if row["dimension"] == "populace_calibration_sample"
        and row["key"] == "out_of_sample"
    )
    assert microcosm_out_of_sample["fact_count"] == 2
    assert microcosm_out_of_sample["sources"]["microcosm"]["evaluable"] == 1
    assert microcosm_out_of_sample["sources"]["cps"]["evaluable"] == 0
    state_microcosm_in_sample = next(
        row
        for row in groups
        if row["dimension"] == "geography_populace_calibration_sample"
        and row["key"] == "state|in_sample"
    )
    assert state_microcosm_in_sample["fact_count"] == 0
    assert state_microcosm_in_sample["sources"]["microcosm"]["evaluable"] == 0
    assert state_microcosm_in_sample["sources"]["cps"]["evaluable"] == 0
    state_external = next(
        row
        for row in groups
        if row["dimension"] == "geography_calibration_exposure"
        and row["key"] == "state|external_validation"
    )
    assert state_external["sources"]["microcosm"]["evaluable"] == 1
    assert state_external["sources"]["microcosm"]["relative_error_count"] == 1
    assert state_external["sources"]["microcosm"]["loss"] == "0.3"
    empty_state_direct = next(
        row
        for row in groups
        if row["dimension"] == "geography_calibration_exposure"
        and row["key"] == "state|direct_calibration_target"
    )
    assert empty_state_direct["fact_count"] == 0
    assert empty_state_direct["sources"]["microcosm"]["evaluable"] == 0
    assert empty_state_direct["sources"]["microcosm"]["loss"] is None
    assert empty_state_direct["sources"]["microcosm"]["performance_buckets"] == {
        "within_bounds": 0,
        "outside_bounds": 0,
        "far_outside_bounds": 0,
        "unavailable": 0,
        "total": 0,
    }
    unsupported_period = next(
        row
        for row in groups
        if row["dimension"] == "period_treatment" and row["key"] == "unsupported"
    )
    assert unsupported_period["sources"]["cps"]["evaluable"] == 0


def test_frontend_bundle_applies_the_runs_explicit_us_scope(tmp_path: Path) -> None:
    snapshot, run = published_inputs(tmp_path, include_non_us_snapshot_fact=True)
    output = tmp_path / "frontend"

    manifest = publish_frontend_bundle(snapshot, run, output)

    assert manifest["fact_count"] == 3
    summary = json.loads((output / "summary.json").read_text())
    assert summary["jurisdictions"] == ["US"]
    index = json.loads((output / "fact-index.json").read_text())
    assert "fact-be" not in index["facts"]


def test_frontend_bundle_applies_explicit_geography_exclusions(tmp_path: Path) -> None:
    snapshot, run = published_inputs(
        tmp_path, include_excluded_geography_fact=True
    )
    output = tmp_path / "frontend"

    manifest = publish_frontend_bundle(snapshot, run, output)

    assert manifest["fact_count"] == 3
    index = json.loads((output / "fact-index.json").read_text())
    assert "fact-guam" not in index["facts"]


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


def test_verify_frontend_bundle_accepts_published_output(tmp_path: Path) -> None:
    snapshot, run = published_inputs(tmp_path)
    output = tmp_path / "frontend"
    manifest = publish_frontend_bundle(snapshot, run, output, page_size=2)

    verified = verify_frontend_bundle(output)

    assert verified == manifest
    assert [part["path"] for part in frontend_bundle_partitions(verified)] == [
        "summary.json",
        "groups.json",
        "fact-index.json",
        "facts/00001.json",
        "facts/00002.json",
    ]


def test_verify_frontend_bundle_rejects_tampering(tmp_path: Path) -> None:
    snapshot, run = published_inputs(tmp_path)
    output = tmp_path / "frontend"
    publish_frontend_bundle(snapshot, run, output, page_size=2)
    page = output / "facts" / "00002.json"
    original = page.read_bytes()

    page.write_bytes(b'{"rows": []}\n')
    with pytest.raises(ValueError, match="hash mismatch for facts/00002.json"):
        verify_frontend_bundle(output)

    page.write_bytes(original)
    manifest = json.loads((output / "manifest.json").read_text())
    manifest["run_id"] = "evaluation-other"
    (output / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="belongs to another run or snapshot"):
        verify_frontend_bundle(output)

    manifest["partitions"]["facts"].pop()
    (output / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="sequence is incomplete"):
        verify_frontend_bundle(output)

    manifest["schema_version"] = "cross_dataset.frontend_bundle.v0"
    (output / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="unsupported frontend bundle schema"):
        verify_frontend_bundle(output)

    with pytest.raises(ValueError, match="no manifest.json"):
        verify_frontend_bundle(tmp_path / "missing")


@pytest.mark.parametrize(
    ("updates", "message"),
    [
        ({"page": 999}, "inconsistent page metadata"),
        ({"page": True}, "inconsistent page metadata"),
        ({"rows": []}, "inconsistent row count"),
        ({"rows": {}}, "inconsistent row count"),
    ],
)
def test_verify_frontend_bundle_rejects_attested_invalid_fact_pages(
    tmp_path: Path, updates: dict[str, Any], message: str
) -> None:
    snapshot, run = published_inputs(tmp_path)
    output = tmp_path / "frontend"
    publish_frontend_bundle(snapshot, run, output, page_size=2)
    manifest_path = output / "manifest.json"
    manifest = json.loads(manifest_path.read_bytes())
    page_path = output / "facts" / "00001.json"
    page = json.loads(page_path.read_bytes())
    page.update(updates)
    content = json.dumps(page).encode()
    page_path.write_bytes(content)
    manifest["partitions"]["facts"][0]["sha256"] = hashlib.sha256(content).hexdigest()
    manifest_path.write_text(json.dumps(manifest))

    with pytest.raises(ValueError, match=message):
        verify_frontend_bundle(output)


def test_frontend_bundle_partitions_rejects_noncanonical_manifests(
    tmp_path: Path,
) -> None:
    snapshot, run = published_inputs(tmp_path)
    output = tmp_path / "frontend"
    original = publish_frontend_bundle(snapshot, run, output, page_size=2)

    manifest = json.loads(json.dumps(original))
    manifest["partitions"]["extra"] = manifest["partitions"]["summary"]
    with pytest.raises(ValueError, match="unknown partitions: extra"):
        frontend_bundle_partitions(manifest)

    manifest = json.loads(json.dumps(original))
    manifest["partitions"]["facts"][0]["path"] = "facts/./00001.json"
    with pytest.raises(ValueError, match="unsafe path"):
        frontend_bundle_partitions(manifest)

    manifest = json.loads(json.dumps(original))
    manifest["partitions"]["groups"]["path"] = "summary.json"
    with pytest.raises(ValueError, match="paths must be unique"):
        frontend_bundle_partitions(manifest)
