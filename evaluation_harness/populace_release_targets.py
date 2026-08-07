"""Recover exact Chronicle target transformations from a pinned Microcosm build."""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Iterable

from .contracts import (
    AlignedFact,
    AlignmentQuality,
    CalibrationExposure,
    FactContract,
    TypedPeriod,
)
from .planner import AlignmentDeclaration


@dataclass(frozen=True)
class ReleaseTargetAlignments:
    aligned_facts: tuple[AlignedFact, ...]
    declarations: tuple[AlignmentDeclaration, ...]
    native_target_fact_keys: tuple[str, ...]
    rejected_matches: dict[str, str]
    target_count: int

    @property
    def matched_fact_count(self) -> int:
        return len(self.aligned_facts)


def _target_period(fact: FactContract, target: dict) -> TypedPeriod:
    metadata = target.get("metadata", {})
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
    between the pinned build (``arch.*``) and the evaluation snapshot (``ledger.*``).
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
    )
