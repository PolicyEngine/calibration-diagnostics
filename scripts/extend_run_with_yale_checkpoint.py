"""Add the pinned Yale reconstruction checkpoint to an immutable completed run."""

from __future__ import annotations

import argparse
import hashlib
import json
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory

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
    ModelQuery,
    PeriodTreatment,
    SourceType,
    TypedPeriod,
)
from evaluation_harness.execution import EvaluationResult
from evaluation_harness.full_run import (
    ScoredEvaluationResult,
    SourcePlan,
    build_full_capability_matrix,
    build_run_summary,
    build_scored_results,
)
from evaluation_harness.frontend_bundle import publish_frontend_bundle
from evaluation_harness.integration import load_integration_overview
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.publisher import publish_run
from evaluation_harness.snapshot import SNAPSHOT_SCHEMA
from evaluation_harness.yale_reconstruction_checkpoint import (
    ESTIMATE_BASIS,
    load_yale_reconstruction_checkpoint,
    materialize_yale_reconstruction_results,
)


ROOT = Path(__file__).resolve().parents[1]
INTEGRATION = ROOT / "integrations" / "yale_reconstruction"
RECONSTRUCTION = (
    ROOT
    / "frontend"
    / "lib"
    / "microcosm"
    / "external-datasets"
    / "yale-national-2024.json"
)


def _read_jsonl(path: Path) -> tuple[dict, ...]:
    return tuple(json.loads(line) for line in path.read_text().splitlines() if line)


def _period(payload: dict | None) -> TypedPeriod | None:
    return TypedPeriod(**payload) if payload is not None else None


def _query(payload: dict | None) -> AggregateQuery | ModelQuery | None:
    if payload is None:
        return None
    values = {
        "operation": payload["operation"],
        "value_expression": payload["value_expression"],
        "weight": payload["weight"],
        "constraints": tuple(payload.get("constraints", ())),
        "denominator_expression": payload.get("denominator_expression"),
    }
    if "policy_variable" in payload:
        return ModelQuery(**values, policy_variable=payload["policy_variable"])
    return AggregateQuery(**values)


def _capability(payload: dict) -> CapabilityResult:
    return CapabilityResult(
        snapshot_id=payload["snapshot_id"],
        fact_key=payload["fact_key"],
        source_id=payload["source_id"],
        source_type=SourceType(payload["source_type"]),
        mapping_release=payload["mapping_release"],
        status=CapabilityStatus(payload["status"]),
        reason_code=payload.get("reason_code"),
        reason_detail=payload.get("reason_detail"),
        execution_method=ExecutionMethod(payload["execution_method"]),
        mapping_id=payload.get("mapping_id"),
        mapping_quality=MappingQuality(payload["mapping_quality"]),
        fact_period=_period(payload["fact_period"]),
        population_period=_period(payload.get("population_period")),
        policy_period=_period(payload.get("policy_period")),
        period_treatment=PeriodTreatment(payload["period_treatment"]),
        alignment_id=payload.get("alignment_id"),
        alignment_quality=AlignmentQuality(payload["alignment_quality"]),
        entity=payload["entity"],
        weight_variable=payload.get("weight_variable"),
        required_variables=tuple(payload.get("required_variables", ())),
        geography_method=payload.get("geography_method"),
        query=_query(payload.get("query")),
        calibration_exposure=CalibrationExposure(payload["calibration_exposure"]),
        score_eligible=bool(payload["score_eligible"]),
    )


def _result(payload: dict) -> EvaluationResult:
    optional_decimals = {
        key: Decimal(payload[key]) if payload.get(key) is not None else None
        for key in ("standard_error", "margin_of_error_90")
    }
    return EvaluationResult(
        snapshot_id=payload["snapshot_id"],
        mapping_release=payload["mapping_release"],
        source_id=payload["source_id"],
        fact_key=payload["fact_key"],
        estimate=Decimal(payload["estimate"]),
        dataset_version=payload["dataset_version"],
        model_version=payload.get("model_version"),
        population_period=payload.get("population_period"),
        policy_period=payload.get("policy_period"),
        period_treatment=payload["period_treatment"],
        alignment_id=payload.get("alignment_id"),
        calibration_exposure=payload["calibration_exposure"],
        mapping_id=payload.get("mapping_id"),
        execution_method=payload["execution_method"],
        estimate_basis=payload.get("estimate_basis", "executed_query"),
        **optional_decimals,
    )


def _alignment(payload: dict) -> AlignedFact:
    return AlignedFact(
        alignment_id=payload["alignment_id"],
        source_fact_key=payload["source_fact_key"],
        observed_period=_period(payload["observed_period"]),
        observed_value=Decimal(payload["observed_value"]),
        target_period=_period(payload["target_period"]),
        aligned_value=Decimal(payload["aligned_value"]),
        alignment_model=payload["alignment_model"],
        alignment_version=payload["alignment_version"],
        factor_sources=tuple(payload.get("factor_sources", ())),
        method_quality=AlignmentQuality(payload["method_quality"]),
        backtest_error=(
            Decimal(payload["backtest_error"])
            if payload.get("backtest_error") is not None
            else None
        ),
        metadata=dict(payload.get("metadata", {})),
    )


def _score(payload: dict) -> ScoredEvaluationResult:
    return ScoredEvaluationResult(
        snapshot_id=payload["snapshot_id"],
        source_id=payload["source_id"],
        fact_key=payload["fact_key"],
        ledger_source=payload["ledger_source"],
        measure=payload["measure"],
        unit=payload["unit"],
        family=payload["family"],
        observed_period=_period(payload["observed_period"]),
        observed_value=Decimal(payload["observed_value"]),
        benchmark_period=_period(payload["benchmark_period"]),
        benchmark_value=Decimal(payload["benchmark_value"]),
        benchmark_basis=payload["benchmark_basis"],
        estimate=Decimal(payload["estimate"]),
        absolute_relative_error=(
            Decimal(payload["absolute_relative_error"])
            if payload.get("absolute_relative_error") is not None
            else None
        ),
        period_treatment=PeriodTreatment(payload["period_treatment"]),
        alignment_id=payload.get("alignment_id"),
        calibration_exposure=payload["calibration_exposure"],
        score_eligible=bool(payload["score_eligible"]),
    )


def _frontend_facts(frontend: Path) -> tuple[FactContract, ...]:
    facts: list[FactContract] = []
    for path in sorted((frontend / "facts").glob("*.json")):
        page = json.loads(path.read_text())
        for row in page["rows"]:
            provenance = row["provenance"]
            lineage = {
                key: provenance[key]
                for key in ("source_record_id", "source_cell_keys", "source_row_keys")
                if key in provenance
            }
            facts.append(
                FactContract(
                    fact_key=row["fact_key"],
                    semantic_fact_key=provenance.get("semantic_fact_key"),
                    source=row["ledger_source"],
                    jurisdiction="US",
                    period=TypedPeriod.parse(row["observed_period"]),
                    geography_level=row["geography_level"],
                    geography_id=row["geography_id"],
                    entity=row["entity"],
                    measure=row["measure"],
                    unit=row["unit"],
                    value=Decimal(row["observed_value"]),
                    dimensions=dict(row.get("dimensions", {})),
                    universe_constraints=tuple(row.get("universe_constraints", ())),
                    provenance_class=provenance["provenance_class"],
                    aggregation=dict(provenance.get("aggregation", {})),
                    observed_measure=dict(provenance.get("observed_measure", {})),
                    source_metadata=dict(provenance),
                    lineage=lineage,
                    label=row.get("label"),
                )
            )
    return tuple(facts)


def _temporary_snapshot(path: Path, facts: tuple[FactContract, ...], snapshot_id: str) -> None:
    facts_text = "".join(fact.to_json() + "\n" for fact in sorted(facts, key=lambda fact: fact.fact_key))
    (path / "facts.jsonl").write_text(facts_text)
    (path / "snapshot_manifest.json").write_text(
        json.dumps(
            {
                "schema_version": SNAPSHOT_SCHEMA,
                "snapshot_id": snapshot_id,
                "fact_count": len(facts),
                "normalized_facts_sha256": hashlib.sha256(facts_text.encode()).hexdigest(),
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )


def extend(base_run: Path, output: Path) -> dict:
    base_frontend = base_run / "frontend"
    base_summary = json.loads((base_run / "summary.json").read_text())
    base_manifest = json.loads((base_run / "run_manifest.json").read_text())
    facts = _frontend_facts(base_frontend)
    snapshot_id = base_manifest["snapshot_ids"][0]
    if len(facts) != base_summary["fact_count"]:
        raise ValueError("base frontend and run have different fact counts")

    capabilities = tuple(
        _capability(row) for row in _read_jsonl(base_run / "capabilities.jsonl")
    )
    results = tuple(_result(row) for row in _read_jsonl(base_run / "estimates.jsonl"))
    alignments = tuple(
        _alignment(row) for row in _read_jsonl(base_run / "alignments.jsonl")
    )
    scores = tuple(_score(row) for row in _read_jsonl(base_run / "scores.jsonl"))
    if any(row.source_id == "yale_reconstruction_2024" for row in capabilities):
        raise ValueError("base run already contains the Yale reconstruction")

    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    if overview.ledger_snapshot_id != snapshot_id:
        raise ValueError("Yale overview and base run snapshot IDs differ")
    plan = SourcePlan(
        source=overview.source,
        mappings=MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml"),
    )
    yale_capabilities = build_full_capability_matrix(
        facts,
        [plan],
        snapshot_id=snapshot_id,
    )
    checkpoint = load_yale_reconstruction_checkpoint(
        RECONSTRUCTION,
        INTEGRATION / "checkpoint_mappings.json",
    )
    yale_capabilities, yale_results = materialize_yale_reconstruction_results(
        yale_capabilities,
        facts,
        checkpoint,
        aligned_facts=alignments,
        source=overview.source,
    )
    if len(yale_results) != len(checkpoint.entries):
        raise ValueError(
            f"materialized {len(yale_results)} Yale results, expected "
            f"{len(checkpoint.entries)}"
        )
    yale_scores = build_scored_results(
        facts,
        yale_capabilities,
        yale_results,
        alignments,
    )

    combined_capabilities = (*capabilities, *yale_capabilities)
    combined_results = (*results, *yale_results)
    combined_scores = (*scores, *yale_scores)
    summary = {
        **base_summary,
        **build_run_summary(
            facts,
            combined_capabilities,
            combined_results,
            combined_scores,
        ),
    }
    summary["yale_reconstruction_checkpoint"] = {
        "official_yale_output": False,
        "reconstruction_sha256": checkpoint.reconstruction_sha256,
        "reconstruction_row_count": checkpoint.reconstruction_row_count,
        "evaluated_mapping_count": len(checkpoint.entries),
        "native_2024_fact_count": sum(
            entry.observed_period.value == "2024" for entry in checkpoint.entries
        ),
        "aligned_2023_fact_count": sum(
            entry.observed_period.value == "2023" for entry in checkpoint.entries
        ),
        "aligned_2022_fact_count": sum(
            entry.observed_period.value == "2022" for entry in checkpoint.entries
        ),
        "held_out_2022_row_count": checkpoint.held_out_2022_row_count,
        "unmatched_row_count": checkpoint.unmatched_row_count,
        "estimate_basis": ESTIMATE_BASIS,
        "dataset_version": overview.source.dataset_version,
        "model_version": overview.source.model_version,
        "interpretation": (
            "Precomputed output from the repository's pinned reconstruction of "
            "Yale Tax-Data and Tax-Simulator. This is not official Yale output."
        ),
        "period_policy": (
            "Native 2024 Chronicle facts are compared directly. Eligible 2022 and "
            "2023 facts use the same exact Microcosm-to-2024 alignments already "
            "published in this run."
        ),
    }
    manifest = publish_run(
        output,
        combined_capabilities,
        combined_results,
        alignments,
        scores=combined_scores,
        summary=summary,
    )
    with TemporaryDirectory(prefix="yale-chronicle-snapshot-") as temporary:
        snapshot = Path(temporary)
        _temporary_snapshot(snapshot, facts, snapshot_id)
        publish_frontend_bundle(snapshot, output, output / "frontend")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-run", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    manifest = extend(arguments.base_run, arguments.output)
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
