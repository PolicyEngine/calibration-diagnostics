from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable

from .contracts import (
    AlignedFact,
    CalibrationExposure,
    CapabilityResult,
    FactContract,
    PeriodTreatment,
    TypedPeriod,
)
from .execution import EvaluationResult, validate_results
from .mappings import MappingRegistry
from .planner import AlignmentDeclaration, CapabilityPlanner, EvaluationSourceManifest
from .scoring import ScoreObservation, absolute_relative_error, build_group_score
from .snapshot import SNAPSHOT_SCHEMA


@dataclass(frozen=True)
class SourcePlan:
    source: EvaluationSourceManifest
    mappings: MappingRegistry
    alignments: tuple[AlignmentDeclaration, ...] = ()
    calibration_exposures: dict[str, CalibrationExposure] = field(
        default_factory=dict
    )


@dataclass(frozen=True)
class ScoredEvaluationResult:
    snapshot_id: str
    source_id: str
    fact_key: str
    ledger_source: str
    measure: str
    unit: str
    family: str
    observed_period: TypedPeriod
    observed_value: Decimal
    benchmark_period: TypedPeriod
    benchmark_value: Decimal
    benchmark_basis: str
    estimate: Decimal
    absolute_relative_error: Decimal | None
    period_treatment: PeriodTreatment
    alignment_id: str | None
    calibration_exposure: str
    score_eligible: bool


def load_snapshot_facts(
    snapshot_path: str | Path,
) -> tuple[tuple[FactContract, ...], dict[str, Any]]:
    """Load a normalized immutable snapshot and verify its cardinality and hash."""

    path = Path(snapshot_path)
    manifest = json.loads((path / "snapshot_manifest.json").read_text())
    if manifest.get("schema_version") != SNAPSHOT_SCHEMA:
        raise ValueError(
            f"unsupported Ledger snapshot schema: {manifest.get('schema_version')!r}"
        )
    facts_path = path / "facts.jsonl"
    facts_bytes = facts_path.read_bytes()
    expected_hash = manifest.get("normalized_facts_sha256")
    if expected_hash:
        actual_hash = hashlib.sha256(facts_bytes).hexdigest()
        if actual_hash != expected_hash:
            raise ValueError(
                "Ledger snapshot normalized facts hash does not match its manifest"
            )

    facts: list[FactContract] = []
    for line_number, line in enumerate(facts_bytes.decode().splitlines(), start=1):
        if not line.strip():
            continue
        try:
            facts.append(FactContract.from_dict(json.loads(line)))
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise ValueError(
                f"invalid normalized Ledger fact on line {line_number}: {error}"
            ) from error
    expected_count = manifest.get("fact_count")
    if expected_count != len(facts):
        raise ValueError(
            f"Ledger snapshot fact count mismatch: {len(facts)} != {expected_count}"
        )
    keys = [fact.fact_key for fact in facts]
    if len(keys) != len(set(keys)):
        raise ValueError("Ledger snapshot contains duplicate fact keys")
    return tuple(facts), manifest


def scope_facts_to_jurisdictions(
    facts: Iterable[FactContract], jurisdictions: Iterable[str]
) -> tuple[FactContract, ...]:
    """Select an explicit jurisdiction scope before building a capability matrix."""

    allowed = frozenset(jurisdictions)
    if not allowed or any(not value for value in allowed):
        raise ValueError("evaluation jurisdiction scope must be non-empty")
    scoped = tuple(fact for fact in facts if fact.jurisdiction in allowed)
    if not scoped:
        raise ValueError(
            "Chronicle snapshot contains no facts for jurisdictions "
            f"{sorted(allowed)}"
        )
    return scoped


def exclude_facts_with_geography_ids(
    facts: Iterable[FactContract], geography_ids: Iterable[str]
) -> tuple[FactContract, ...]:
    """Remove explicitly out-of-scope geographies before classification.

    Chronicle uses the US jurisdiction for some territory rows. A jurisdiction
    filter alone therefore cannot express a model surface limited to the 50
    states and DC. Keeping this as an explicit, auditable second scope step
    prevents those rows from becoming misleading ``mapping_not_found`` cells.
    """

    excluded = frozenset(geography_ids)
    if any(not value for value in excluded):
        raise ValueError("excluded geography IDs must not be blank")
    return tuple(fact for fact in facts if fact.geography_id not in excluded)


def build_full_capability_matrix(
    facts: Iterable[FactContract],
    source_plans: Iterable[SourcePlan],
    *,
    snapshot_id: str,
) -> tuple[CapabilityResult, ...]:
    """Classify every fact once for every source-specific mapping registry."""

    fact_values = tuple(facts)
    plans = tuple(source_plans)
    source_ids = [plan.source.source_id for plan in plans]
    if len(source_ids) != len(set(source_ids)):
        raise ValueError("full-run source plans contain duplicate source IDs")

    capabilities = tuple(
        capability
        for plan in plans
        for capability in CapabilityPlanner(
            plan.mappings,
            alignments=plan.alignments,
            calibration_exposures=plan.calibration_exposures,
            snapshot_id=snapshot_id,
        ).classify_all(fact_values, [plan.source])
    )
    expected = len(fact_values) * len(plans)
    cells = {(row.fact_key, row.source_id) for row in capabilities}
    if len(capabilities) != expected or len(cells) != expected:
        raise ValueError(
            "full capability matrix is incomplete: "
            f"found {len(cells)} unique cells, expected {expected}"
        )
    return capabilities


def build_scored_results(
    facts: Iterable[FactContract],
    capabilities: Iterable[CapabilityResult],
    results: Iterable[EvaluationResult],
    aligned_facts: Iterable[AlignedFact],
) -> tuple[ScoredEvaluationResult, ...]:
    """Attach the correct observed or transformed benchmark to every estimate."""

    fact_values = tuple(facts)
    capability_values = tuple(capabilities)
    result_values = tuple(results)
    alignment_values = tuple(aligned_facts)
    validate_results(capability_values, result_values)
    fact_by_key = {fact.fact_key: fact for fact in fact_values}
    if len(fact_by_key) != len(fact_values):
        raise ValueError("facts contain duplicate fact keys")
    capability_by_cell = {
        (capability.source_id, capability.fact_key): capability
        for capability in capability_values
    }
    if len(capability_by_cell) != len(capability_values):
        raise ValueError("capabilities contain duplicate fact/source cells")
    alignment_by_id = {
        alignment.alignment_id: alignment for alignment in alignment_values
    }
    if len(alignment_by_id) != len(alignment_values):
        raise ValueError("aligned facts contain duplicate alignment IDs")

    scored: list[ScoredEvaluationResult] = []
    for result in result_values:
        capability = capability_by_cell[(result.source_id, result.fact_key)]
        try:
            fact = fact_by_key[result.fact_key]
        except KeyError as error:
            raise ValueError(
                f"evaluation result has no Ledger fact: {result.fact_key}"
            ) from error
        if capability.period_treatment is PeriodTreatment.ALIGNED_FACT:
            alignment = alignment_by_id.get(capability.alignment_id or "")
            if alignment is None:
                raise ValueError(
                    f"evaluation result has no aligned benchmark: {result.fact_key}"
                )
            if alignment.source_fact_key != fact.fact_key:
                raise ValueError(
                    f"aligned benchmark belongs to another fact: {result.fact_key}"
                )
            if (
                alignment.observed_period != fact.period
                or alignment.observed_value != fact.value
            ):
                raise ValueError(
                    f"aligned benchmark does not preserve the observed fact: {result.fact_key}"
                )
            benchmark_period = alignment.target_period
            benchmark_value = alignment.aligned_value
            benchmark_basis = str(
                alignment.metadata.get(
                    "benchmark_basis", "microcosm_aligned_fact"
                )
            )
        else:
            benchmark_period = fact.period
            benchmark_value = fact.value
            benchmark_basis = "ledger_observed"
        scored.append(
            ScoredEvaluationResult(
                snapshot_id=result.snapshot_id,
                source_id=result.source_id,
                fact_key=result.fact_key,
                ledger_source=fact.source,
                measure=fact.measure,
                unit=fact.unit,
                family=fact.measure,
                observed_period=fact.period,
                observed_value=fact.value,
                benchmark_period=benchmark_period,
                benchmark_value=benchmark_value,
                benchmark_basis=benchmark_basis,
                estimate=result.estimate,
                absolute_relative_error=absolute_relative_error(
                    result.estimate, benchmark_value
                ),
                period_treatment=capability.period_treatment,
                alignment_id=capability.alignment_id,
                calibration_exposure=capability.calibration_exposure.value,
                score_eligible=capability.score_eligible,
            )
        )
    return tuple(scored)


def _score_summary(rows: list[ScoredEvaluationResult]) -> dict[str, Any]:
    observations = [
        ScoreObservation(
            fact_key=row.fact_key,
            benchmark=row.benchmark_value,
            estimate=row.estimate,
            family=row.family,
            period_treatment=row.period_treatment,
            calibration_exposure=CalibrationExposure(row.calibration_exposure),
            score_eligible=row.score_eligible,
        )
        for row in rows
    ]
    score = build_group_score(observations)
    return {
        "covered": score.covered,
        "scored": score.scored,
        "relative_error_count": score.relative_error_count,
        "loss": str(score.loss) if score.loss is not None else None,
        "display_score": (
            str(score.display_score) if score.display_score is not None else None
        ),
    }


def build_run_summary(
    facts: Iterable[FactContract],
    capabilities: Iterable[CapabilityResult],
    results: Iterable[EvaluationResult],
    scores: Iterable[ScoredEvaluationResult],
) -> dict[str, Any]:
    """Summarize completeness, capability reasons, execution, and scores by source."""

    fact_values = tuple(facts)
    capability_values = tuple(capabilities)
    result_values = tuple(results)
    score_values = tuple(scores)
    source_ids = sorted({row.source_id for row in capability_values})
    expected = len(fact_values) * len(source_ids)
    unique_cells = {(row.fact_key, row.source_id) for row in capability_values}
    sources: dict[str, Any] = {}
    for source_id in source_ids:
        source_capabilities = [
            row for row in capability_values if row.source_id == source_id
        ]
        source_results = [row for row in result_values if row.source_id == source_id]
        source_scores = [row for row in score_values if row.source_id == source_id]
        sources[source_id] = {
            "capability_count": len(source_capabilities),
            "capability_statuses": dict(
                sorted(Counter(row.status.value for row in source_capabilities).items())
            ),
            "reason_codes": dict(
                sorted(
                    Counter(
                        row.reason_code
                        for row in source_capabilities
                        if row.reason_code is not None
                    ).items()
                )
            ),
            "period_treatments": dict(
                sorted(
                    Counter(
                        row.period_treatment.value for row in source_capabilities
                    ).items()
                )
            ),
            "executable_count": sum(row.query is not None for row in source_capabilities),
            "result_count": len(source_results),
            "score_eligible_result_count": sum(
                row.score_eligible for row in source_scores
            ),
            "score": _score_summary(source_scores),
            "scores_by_period_treatment": {
                treatment: _score_summary(
                    [
                        row
                        for row in source_scores
                        if row.period_treatment.value == treatment
                    ]
                )
                for treatment in sorted(
                    {row.period_treatment.value for row in source_scores}
                )
            },
        }
    return {
        "snapshot_ids": sorted({row.snapshot_id for row in capability_values}),
        "fact_count": len(fact_values),
        "source_count": len(source_ids),
        "expected_capability_count": expected,
        "capability_count": len(capability_values),
        "unique_capability_cell_count": len(unique_cells),
        "matrix_complete": (
            len(capability_values) == expected and len(unique_cells) == expected
        ),
        "result_count": len(result_values),
        "score_count": len(score_values),
        "sources": sources,
    }
