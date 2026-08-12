"""Recover exact Chronicle target transformations from a pinned Microcosm build."""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from decimal import Decimal
from pathlib import Path
from typing import Iterable

from .contracts import (
    AlignedFact,
    AlignmentQuality,
    CalibrationExposure,
    CapabilityResult,
    CapabilityStatus,
    ExecutionMethod,
    FactContract,
    MappingQuality,
    PeriodTreatment,
    TypedPeriod,
)
from .execution import EvaluationResult
from .planner import AlignmentDeclaration


@dataclass(frozen=True)
class ReleaseTargetAlignments:
    aligned_facts: tuple[AlignedFact, ...]
    declarations: tuple[AlignmentDeclaration, ...]
    native_target_fact_keys: tuple[str, ...]
    rejected_matches: dict[str, str]
    target_count: int
    final_estimates_by_fact_key: dict[str, Decimal]

    @property
    def matched_fact_count(self) -> int:
        return len(self.aligned_facts)


def _target_period(fact: FactContract, target: dict) -> TypedPeriod:
    metadata = target.get("metadata", {})
    # Deprecated upstream identifier: Microcosm diagnostics still use the
    # former Ledger prefix for Chronicle-backed target metadata.
    period_kind = str(metadata.get("ledger_period_type", fact.period.kind))
    target_value = str(target["period"])
    if period_kind == "month":
        month = fact.period.value.split("-", 1)[-1]
        target_value = f"{target_value}-{month}"
    return TypedPeriod(kind=period_kind, value=target_value)


def _alignment_id(release_id: str, fact_key: str) -> str:
    suffix = fact_key.rsplit(":", 1)[-1]
    return f"microcosm-release-target:{release_id}:{suffix}"


def compile_release_target_alignments(
    facts: Iterable[FactContract],
    diagnostics_path: str | Path,
    *,
    source_id: str,
    release_id: str,
) -> ReleaseTargetAlignments:
    """Match source records to their exact post-aging, post-uprating build targets.

    Source-record IDs are the stable join because Chronicle fact keys changed namespace
    between the pinned build (``arch.*``) and the evaluation snapshot
    (the deprecated upstream ``ledger.*`` key namespace).
    """

    payload = json.loads(Path(diagnostics_path).read_text())
    targets = tuple(payload.get("targets", ()))
    by_record: dict[str, dict] = {}
    for target in targets:
        source_record_id = str(
            target.get("metadata", {}).get("ledger_source_record_id", "")
        )
        if not source_record_id:
            continue
        if source_record_id in by_record:
            raise ValueError(
                f"Microcosm release has duplicate target for {source_record_id}"
            )
        by_record[source_record_id] = target

    aligned: list[AlignedFact] = []
    declarations: list[AlignmentDeclaration] = []
    native: list[str] = []
    rejected: dict[str, str] = {}
    final_estimates: dict[str, Decimal] = {}
    for fact in facts:
        source_record_id = str(fact.lineage.get("source_record_id", ""))
        target = by_record.get(source_record_id)
        if target is None:
            continue
        metadata = target.get("metadata", {})
        release_unit = str(metadata.get("ledger_measure_unit", fact.unit))
        if release_unit != fact.unit:
            rejected[fact.fact_key] = (
                f"release target unit {release_unit} does not match Chronicle unit "
                f"{fact.unit}"
            )
            continue
        release_source_period = str(
            metadata.get("ledger_fact_period", fact.period.value)
        )
        release_source_kind = str(
            metadata.get("ledger_period_type", fact.period.kind)
        )
        if (release_source_kind, release_source_period) != (
            fact.period.kind,
            fact.period.value,
        ):
            rejected[fact.fact_key] = (
                "release target source period "
                f"{release_source_kind}:{release_source_period} does not match "
                f"Chronicle period {fact.period.canonical}"
            )
            continue
        if "final_estimate" not in target or target["final_estimate"] is None:
            raise ValueError(
                f"Microcosm release target {target.get('name')!r} has no final_estimate"
            )
        final_estimate = Decimal(str(target["final_estimate"]))
        if not final_estimate.is_finite():
            raise ValueError(
                f"Microcosm release target {target.get('name')!r} has a non-finite "
                "final_estimate"
            )
        final_estimates[fact.fact_key] = final_estimate
        target_period = _target_period(fact, target)
        if target_period == fact.period:
            native.append(fact.fact_key)
            continue

        alignment_id = _alignment_id(release_id, fact.fact_key)
        target_value = Decimal(
            str(target.get("compiled_target", target.get("target")))
        )
        factor_source = str(metadata.get("aging_factor_source", ""))
        alignment_model = str(
            metadata.get("alignment_model_id", "microcosm_compiled_target_registry")
        )
        alignment_version = str(
            metadata.get("alignment_model_version", release_id)
        )
        alignment_metadata = {
            "microcosm_release_id": release_id,
            "build_target_name": target.get("name"),
            "target_role": metadata.get("target_role"),
            "aging_factor": metadata.get("aging_factor"),
            "aging_factor_source": metadata.get("aging_factor_source"),
            "benchmark_basis": "exact_compiled_microcosm_build_target",
            "calibration_exposure": "direct_calibration_target",
        }
        aligned.append(
            AlignedFact(
                alignment_id=alignment_id,
                source_fact_key=fact.fact_key,
                observed_period=fact.period,
                observed_value=fact.value,
                target_period=target_period,
                aligned_value=target_value,
                alignment_model=alignment_model,
                alignment_version=alignment_version,
                factor_sources=(factor_source,) if factor_source else (),
                method_quality=AlignmentQuality.VALIDATED,
                backtest_error=None,
                metadata=alignment_metadata,
            )
        )
        declarations.append(
            AlignmentDeclaration(
                alignment_id=alignment_id,
                source_id=source_id,
                measure=fact.measure,
                source_period=fact.period,
                target_period=target_period,
                quality=AlignmentQuality.VALIDATED,
                fact_key=fact.fact_key,
                score_eligible=True,
                calibration_exposure=CalibrationExposure.DIRECT_CALIBRATION_TARGET,
            )
        )

    return ReleaseTargetAlignments(
        aligned_facts=tuple(aligned),
        declarations=tuple(declarations),
        native_target_fact_keys=tuple(sorted(native)),
        rejected_matches=rejected,
        target_count=len(targets),
        final_estimates_by_fact_key=final_estimates,
    )


def apply_release_target_estimates(
    results: Iterable[EvaluationResult],
    release_targets: ReleaseTargetAlignments,
) -> tuple[EvaluationResult, ...]:
    """Use the pinned release's post-calibration estimates for direct targets.

    Re-running a generic aggregate query is not authoritative for these rows: the
    release diagnostics record the exact materialized target row and calibrated
    weights used by the Microcosm build. Holdouts remain untouched.
    """

    return tuple(
        replace(
            result,
            estimate=release_targets.final_estimates_by_fact_key[result.fact_key],
            estimate_basis="microcosm_release_final_estimate",
        )
        if result.fact_key in release_targets.final_estimates_by_fact_key
        else result
        for result in results
    )


def materialize_release_target_results(
    capabilities: Iterable[CapabilityResult],
    release_targets: ReleaseTargetAlignments,
    *,
    source_id: str,
    dataset_version: str,
    model_version: str,
    population_period: TypedPeriod,
    policy_period: TypedPeriod,
) -> tuple[tuple[CapabilityResult, ...], tuple[EvaluationResult, ...]]:
    """Represent exact build diagnostics as evaluated capability cells.

    Some build targets, notably JCT tax-expenditure targets, are materialized by
    Microcosm's build pipeline but do not have a general-purpose household query
    in this harness. The pinned release diagnostics are nevertheless the
    authoritative post-calibration estimate for those exact Chronicle records.
    """

    aligned_by_fact_key = {
        row.source_fact_key: row for row in release_targets.aligned_facts
    }
    target_fact_keys = set(release_targets.final_estimates_by_fact_key)
    materialized_capabilities: list[CapabilityResult] = []
    materialized_results: list[EvaluationResult] = []
    for capability in capabilities:
        if (
            capability.source_id != source_id
            or capability.fact_key not in target_fact_keys
        ):
            materialized_capabilities.append(capability)
            continue

        alignment = aligned_by_fact_key.get(capability.fact_key)
        materialized = replace(
            capability,
            status=CapabilityStatus.CALIBRATION_TARGET,
            reason_code=None,
            reason_detail=None,
            execution_method=ExecutionMethod.PRECOMPUTED,
            mapping_id=capability.mapping_id or "microcosm-release-diagnostics",
            mapping_quality=MappingQuality.EXACT,
            population_period=population_period,
            policy_period=policy_period,
            period_treatment=(
                PeriodTreatment.ALIGNED_FACT
                if alignment is not None
                else PeriodTreatment.NATIVE
            ),
            alignment_id=alignment.alignment_id if alignment is not None else None,
            alignment_quality=(
                alignment.method_quality
                if alignment is not None
                else AlignmentQuality.NONE
            ),
            weight_variable=None,
            required_variables=(),
            geography_method="microcosm_release_diagnostics",
            query=None,
            calibration_exposure=CalibrationExposure.DIRECT_CALIBRATION_TARGET,
            # A release diagnostic makes an otherwise unmapped build target
            # scoreable (for example JCT counterfactuals). If a reviewed
            # mapping exists, however, preserve its explicit eligibility
            # decision so source-declared missing observations stay unscored.
            score_eligible=(
                capability.score_eligible
                if capability.mapping_id is not None
                else True
            ),
        )
        materialized_capabilities.append(materialized)
        materialized_results.append(
            EvaluationResult.from_capability(
                materialized,
                estimate=release_targets.final_estimates_by_fact_key[
                    capability.fact_key
                ],
                dataset_version=dataset_version,
                model_version=model_version,
                estimate_basis="microcosm_release_final_estimate",
            )
        )

    return tuple(materialized_capabilities), tuple(materialized_results)
