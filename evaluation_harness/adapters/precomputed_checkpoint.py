"""Adapt reviewed aggregate checkpoints to the shared evaluation contracts.

The checkpoint stores logical evaluation rows keyed by Chronicle source-record
IDs rather than by snapshot-specific fact keys.  This adapter resolves that
stable lineage join, verifies the checkpoint benchmark against Chronicle, and
turns each logical row into exactly one capability/result cell.  A logical row
that sums several Chronicle facts uses its first record ID as the score anchor;
semantic alignments retain the summed benchmark for every constituent while
the remaining constituent cells stay unmaterialized.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable, Mapping

from ..contracts import (
    AlignedFact,
    AlignmentQuality,
    CalibrationExposure,
    CapabilityResult,
    CapabilityStatus,
    FactContract,
    MappingQuality,
    PeriodTreatment,
    PrecomputedCapabilitySpec,
    TypedPeriod,
    UNSUPPORTED_CAPABILITY_STATUSES,
)
from ..execution import EvaluationResult
from ..planner import AlignmentDeclaration, EvaluationSourceManifest


CHECKPOINT_SCHEMA = "microcosm_be.evaluation_source_checkpoint.v1"
MAPPING_RELEASE = "microcosm-be-evaluation-source-checkpoint-v1"
SUPPORTED_ESTIMATE_BASES = frozenset(
    {
        "dataset_weights",
        "calibration_measure",
        "engine_simulated",
        "input_carried",
    }
)
ESTIMATE_BASES = SUPPORTED_ESTIMATE_BASES | {"unsupported"}
DIRECT_CALIBRATION_BASES = frozenset(
    {"calibration_measure", "dataset_weights"}
)

_UNIT_ALIASES = {
    "persons": "count",
}


@dataclass(frozen=True)
class PrecomputedCheckpointEntry:
    row_key: str
    role: str
    concept: str
    chronicle_record_ids: tuple[str, ...]
    fact_keys: tuple[str, ...]
    anchor_fact_key: str
    observed_period: TypedPeriod
    benchmark_value: Decimal
    estimate: Decimal | None
    estimate_basis: str
    unit: str
    note: str
    calibration_exposure: CalibrationExposure

    @property
    def supported(self) -> bool:
        return self.estimate_basis in SUPPORTED_ESTIMATE_BASES

    @property
    def composite(self) -> bool:
        return len(self.fact_keys) > 1


@dataclass(frozen=True)
class PrecomputedCheckpoint:
    source_id: str
    label: str
    engine: str
    dataset: str
    jurisdiction: str
    population_year: int
    provenance: str
    inputs: dict[str, Any]
    checkpoint_sha256: str
    row_count: int
    entries: tuple[PrecomputedCheckpointEntry, ...]
    aligned_facts: tuple[AlignedFact, ...]
    declarations: tuple[AlignmentDeclaration, ...]
    unresolved_record_ids: dict[str, str]
    unresolved_rows: dict[str, str]

    @property
    def resolved_row_count(self) -> int:
        return len(self.entries)

    @property
    def supported_row_count(self) -> int:
        return sum(entry.supported for entry in self.entries)

    @property
    def population_period(self) -> TypedPeriod:
        return TypedPeriod(kind="calendar_year", value=str(self.population_year))


def checkpoint_calibration_exposure(
    chronicle_record_ids: Iterable[str],
    estimate_basis: str,
    calibration_target_record_ids: Iterable[str],
) -> CalibrationExposure:
    """Classify checkpoint rows by their exact calibration exposure.

    A row is ``direct_calibration_target`` if and only if every one of its
    Chronicle record IDs belongs to the release target set and its estimate
    basis is ``calibration_measure`` or ``dataset_weights``.  A row is
    ``related_calibration_family`` if every record ID belongs to that set and
    the basis is ``engine_simulated``.  Every other combination, including
    input-carried and unsupported rows, is exactly ``out_of_sample``.
    """

    record_ids = tuple(chronicle_record_ids)
    target_ids = frozenset(calibration_target_record_ids)
    calibrated_concept = bool(record_ids) and all(
        record_id in target_ids for record_id in record_ids
    )
    if calibrated_concept and estimate_basis in DIRECT_CALIBRATION_BASES:
        return CalibrationExposure.DIRECT_CALIBRATION_TARGET
    if calibrated_concept and estimate_basis == "engine_simulated":
        return CalibrationExposure.RELATED_CALIBRATION_FAMILY
    return CalibrationExposure.OUT_OF_SAMPLE


def _decimal(value: Any, *, field: str, row_key: str) -> Decimal:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError) as error:
        raise ValueError(
            f"precomputed checkpoint row {row_key!r} has invalid {field}"
        ) from error
    if not parsed.is_finite():
        raise ValueError(
            f"precomputed checkpoint row {row_key!r} has non-finite {field}"
        )
    return parsed


def _required_text(payload: Mapping[str, Any], field: str, *, context: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{context} requires non-blank {field}")
    return value


def _normalized_unit(unit: str) -> str:
    return _UNIT_ALIASES.get(unit, unit)


def _alignment_id(source_id: str, row_key: str, fact_key: str) -> str:
    return f"precomputed-checkpoint:{source_id}:{row_key}:{fact_key}"


def _composite_alignments(
    entry: PrecomputedCheckpointEntry,
    facts: tuple[FactContract, ...],
    *,
    source_id: str,
    checkpoint_sha256: str,
) -> tuple[tuple[AlignedFact, ...], tuple[AlignmentDeclaration, ...]]:
    if not entry.composite:
        return (), ()

    aligned: list[AlignedFact] = []
    declarations: list[AlignmentDeclaration] = []
    anchor_alignment_id = _alignment_id(
        source_id,
        entry.row_key,
        entry.anchor_fact_key,
    )
    for index, fact in enumerate(facts):
        is_anchor = index == 0
        alignment_id = _alignment_id(source_id, entry.row_key, fact.fact_key)
        metadata: dict[str, Any] = {
            "alignment_kind": "semantic",
            "benchmark_basis": "chronicle_record_sum",
            "checkpoint_row_key": entry.row_key,
            "group_anchor_alignment_id": anchor_alignment_id,
            "independent_group_score": is_anchor,
            "calibration_exposure": entry.calibration_exposure.value,
        }
        if is_anchor:
            metadata.update(
                {
                    "chronicle_record_ids": list(entry.chronicle_record_ids),
                    "input_fact_keys": list(entry.fact_keys),
                }
            )
        else:
            metadata.update(
                {
                    "component_record_id": entry.chronicle_record_ids[index],
                    "component_fact_key": fact.fact_key,
                }
            )
        aligned.append(
            AlignedFact(
                alignment_id=alignment_id,
                source_fact_key=fact.fact_key,
                observed_period=fact.period,
                observed_value=fact.value,
                target_period=fact.period,
                aligned_value=entry.benchmark_value,
                alignment_model="chronicle_record_sum",
                alignment_version=checkpoint_sha256,
                factor_sources=(
                    entry.chronicle_record_ids
                    if is_anchor
                    else (anchor_alignment_id,)
                ),
                method_quality=AlignmentQuality.VALIDATED,
                backtest_error=None,
                metadata=metadata,
            )
        )
        declarations.append(
            AlignmentDeclaration(
                alignment_id=alignment_id,
                source_id=source_id,
                measure=fact.measure,
                source_period=fact.period,
                target_period=fact.period,
                quality=AlignmentQuality.VALIDATED,
                fact_key=fact.fact_key,
                score_eligible=is_anchor and entry.supported,
                calibration_exposure=entry.calibration_exposure,
                semantic=True,
            )
        )
    return tuple(aligned), tuple(declarations)


def load_precomputed_checkpoint(
    checkpoint_path: str | Path,
    facts: Iterable[FactContract],
    *,
    calibration_target_record_ids: Iterable[str] = (),
) -> PrecomputedCheckpoint:
    """Load, resolve, and Chronicle-cross-check one immutable checkpoint."""

    path = Path(checkpoint_path)
    checkpoint_bytes = path.read_bytes()
    checkpoint_sha256 = hashlib.sha256(checkpoint_bytes).hexdigest()
    try:
        payload = json.loads(checkpoint_bytes)
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid precomputed checkpoint JSON: {path}") from error
    if not isinstance(payload, dict):
        raise ValueError("precomputed checkpoint must be a JSON object")
    if payload.get("schema_version") != CHECKPOINT_SCHEMA:
        raise ValueError(
            "unsupported precomputed checkpoint schema: "
            f"{payload.get('schema_version')!r}"
        )

    context = "precomputed checkpoint"
    source_id = _required_text(payload, "source_id", context=context)
    label = _required_text(payload, "label", context=context)
    engine = _required_text(payload, "engine", context=context)
    dataset = _required_text(payload, "dataset", context=context)
    jurisdiction = _required_text(payload, "jurisdiction", context=context)
    provenance = _required_text(payload, "provenance", context=context)
    population_year = payload.get("population_year")
    if (
        not isinstance(population_year, int)
        or isinstance(population_year, bool)
        or population_year < 1000
        or population_year > 9999
    ):
        raise ValueError("precomputed checkpoint requires a four-digit population_year")
    inputs = payload.get("inputs", {})
    if not isinstance(inputs, dict):
        raise ValueError("precomputed checkpoint inputs must be an object")
    row_payloads = payload.get("rows")
    if not isinstance(row_payloads, list):
        raise ValueError("precomputed checkpoint rows must be an array")

    fact_values = tuple(facts)
    facts_by_record_id: dict[str, FactContract] = {}
    for fact in fact_values:
        record_id = fact.lineage.get("source_record_id")
        if not isinstance(record_id, str) or not record_id:
            continue
        if record_id in facts_by_record_id:
            raise ValueError(
                "snapshot contains duplicate Chronicle source_record_id: "
                f"{record_id}"
            )
        facts_by_record_id[record_id] = fact

    target_ids = frozenset(calibration_target_record_ids)
    entries: list[PrecomputedCheckpointEntry] = []
    aligned_facts: list[AlignedFact] = []
    declarations: list[AlignmentDeclaration] = []
    unresolved_record_ids: dict[str, str] = {}
    unresolved_rows: dict[str, str] = {}
    seen_row_keys: set[str] = set()
    seen_anchors: set[str] = set()
    for index, row in enumerate(row_payloads):
        if not isinstance(row, dict):
            raise ValueError(f"precomputed checkpoint row {index} must be an object")
        row_context = f"precomputed checkpoint row {index}"
        row_key = _required_text(row, "row_key", context=row_context)
        if row_key in seen_row_keys:
            raise ValueError(f"precomputed checkpoint has duplicate row_key: {row_key}")
        seen_row_keys.add(row_key)
        role = _required_text(row, "role", context=row_context)
        if role not in {"target", "validation"}:
            raise ValueError(
                f"precomputed checkpoint row {row_key!r} has invalid role {role!r}"
            )
        concept = _required_text(row, "concept", context=row_context)
        note = _required_text(row, "note", context=row_context)
        unit = _required_text(row, "unit", context=row_context)
        estimate_basis = _required_text(
            row, "estimate_basis", context=row_context
        )
        if estimate_basis not in ESTIMATE_BASES:
            raise ValueError(
                f"precomputed checkpoint row {row_key!r} has invalid "
                f"estimate_basis {estimate_basis!r}"
            )

        record_id_payload = row.get("chronicle_record_ids")
        if not isinstance(record_id_payload, list) or not record_id_payload:
            raise ValueError(
                f"precomputed checkpoint row {row_key!r} requires record IDs"
            )
        if any(not isinstance(value, str) or not value for value in record_id_payload):
            raise ValueError(
                f"precomputed checkpoint row {row_key!r} has a blank record ID"
            )
        record_ids = tuple(record_id_payload)
        if len(record_ids) != len(set(record_ids)):
            raise ValueError(
                f"precomputed checkpoint row {row_key!r} has duplicate record IDs"
            )

        missing = tuple(
            record_id for record_id in record_ids if record_id not in facts_by_record_id
        )
        if missing:
            reason = "no snapshot fact has this Chronicle source_record_id"
            for record_id in missing:
                unresolved_record_ids[record_id] = reason
            unresolved_rows[row_key] = (
                "unresolved Chronicle record IDs: " + ", ".join(missing)
            )
            continue
        resolved_facts = tuple(facts_by_record_id[value] for value in record_ids)
        if any(fact.jurisdiction != jurisdiction for fact in resolved_facts):
            raise ValueError(
                f"precomputed checkpoint row {row_key!r} resolves outside "
                f"jurisdiction {jurisdiction}"
            )
        period_value = str(row.get("period", ""))
        if not period_value or any(
            fact.period.value != period_value for fact in resolved_facts
        ):
            raise ValueError(
                f"precomputed checkpoint row {row_key!r} period does not match "
                "its Chronicle facts"
            )
        observed_period = resolved_facts[0].period
        if any(fact.period != observed_period for fact in resolved_facts):
            raise ValueError(
                f"precomputed checkpoint row {row_key!r} mixes period types"
            )
        normalized_unit = _normalized_unit(unit)
        if any(
            _normalized_unit(fact.unit) != normalized_unit
            for fact in resolved_facts
        ):
            raise ValueError(
                f"precomputed checkpoint row {row_key!r} unit does not match "
                "its Chronicle facts"
            )

        benchmark_value = _decimal(
            row.get("benchmark_value"), field="benchmark_value", row_key=row_key
        )
        chronicle_sum = sum(
            (fact.value for fact in resolved_facts), Decimal(0)
        )
        if benchmark_value != chronicle_sum:
            raise ValueError(
                f"precomputed checkpoint row {row_key!r} benchmark does not "
                f"match Chronicle sum: {benchmark_value} != {chronicle_sum}"
            )

        estimate_payload = row.get("estimate")
        if estimate_basis == "unsupported":
            if estimate_payload is not None:
                raise ValueError(
                    f"unsupported precomputed checkpoint row {row_key!r} "
                    "must not contain an estimate"
                )
            estimate = None
        else:
            if estimate_payload is None:
                raise ValueError(
                    f"supported precomputed checkpoint row {row_key!r} "
                    "requires an estimate"
                )
            estimate = _decimal(
                estimate_payload, field="estimate", row_key=row_key
            )

        fact_keys = tuple(fact.fact_key for fact in resolved_facts)
        anchor_fact_key = fact_keys[0]
        if anchor_fact_key in seen_anchors:
            raise ValueError(
                "precomputed checkpoint rows resolve to duplicate anchor fact: "
                f"{anchor_fact_key}"
            )
        seen_anchors.add(anchor_fact_key)
        entry = PrecomputedCheckpointEntry(
            row_key=row_key,
            role=role,
            concept=concept,
            chronicle_record_ids=record_ids,
            fact_keys=fact_keys,
            anchor_fact_key=anchor_fact_key,
            observed_period=observed_period,
            benchmark_value=benchmark_value,
            estimate=estimate,
            estimate_basis=estimate_basis,
            unit=unit,
            note=note,
            calibration_exposure=checkpoint_calibration_exposure(
                record_ids,
                estimate_basis,
                target_ids,
            ),
        )
        entries.append(entry)
        row_alignments, row_declarations = _composite_alignments(
            entry,
            resolved_facts,
            source_id=source_id,
            checkpoint_sha256=checkpoint_sha256,
        )
        aligned_facts.extend(row_alignments)
        declarations.extend(row_declarations)

    return PrecomputedCheckpoint(
        source_id=source_id,
        label=label,
        engine=engine,
        dataset=dataset,
        jurisdiction=jurisdiction,
        population_year=population_year,
        provenance=provenance,
        inputs=dict(inputs),
        checkpoint_sha256=checkpoint_sha256,
        row_count=len(row_payloads),
        entries=tuple(entries),
        aligned_facts=tuple(aligned_facts),
        declarations=tuple(declarations),
        unresolved_record_ids=unresolved_record_ids,
        unresolved_rows=unresolved_rows,
    )


def _supported_status(entry: PrecomputedCheckpointEntry) -> CapabilityStatus:
    if (
        entry.calibration_exposure
        is CalibrationExposure.DIRECT_CALIBRATION_TARGET
    ):
        return CapabilityStatus.CALIBRATION_TARGET
    if entry.estimate_basis == "engine_simulated":
        return CapabilityStatus.MODEL
    return CapabilityStatus.DIRECT


def precomputed_checkpoint_capability_specs(
    checkpoint: PrecomputedCheckpoint,
    *,
    source: EvaluationSourceManifest,
) -> tuple[PrecomputedCapabilitySpec, ...]:
    """Describe both supported and explicitly unsupported checkpoint rows."""

    if checkpoint.source_id != source.source_id:
        raise ValueError("precomputed checkpoint and source manifest IDs differ")
    if checkpoint.jurisdiction not in source.jurisdictions:
        raise ValueError(
            "precomputed checkpoint jurisdiction is absent from source manifest"
        )

    alignment_by_fact_key = {
        row.source_fact_key: row for row in checkpoint.aligned_facts
    }
    specs: list[PrecomputedCapabilitySpec] = []
    for entry in checkpoint.entries:
        alignment = alignment_by_fact_key.get(entry.anchor_fact_key)
        supported = entry.supported
        specs.append(
            PrecomputedCapabilitySpec(
                source_id=checkpoint.source_id,
                fact_key=entry.anchor_fact_key,
                mapping_release=MAPPING_RELEASE,
                status=(
                    _supported_status(entry)
                    if supported
                    else CapabilityStatus.UNSUPPORTED_CONCEPT
                ),
                mapping_id=f"precomputed-checkpoint:{entry.row_key}",
                mapping_quality=(
                    MappingQuality.EXACT if supported else MappingQuality.NONE
                ),
                population_period=source.population_period,
                policy_period=source.policy_period,
                period_treatment=(
                    PeriodTreatment.ALIGNED_FACT
                    if supported and alignment is not None
                    else (
                        PeriodTreatment.NATIVE
                        if supported
                        else PeriodTreatment.UNSUPPORTED
                    )
                ),
                alignment_id=(
                    alignment.alignment_id
                    if supported and alignment is not None
                    else None
                ),
                alignment_quality=(
                    alignment.method_quality
                    if supported and alignment is not None
                    else AlignmentQuality.NONE
                ),
                geography_method="precomputed_chronicle_record_alignment",
                calibration_exposure=entry.calibration_exposure,
                score_eligible=supported,
                reason_code=(
                    None if supported else "checkpoint_estimate_unsupported"
                ),
                reason_detail=None if supported else entry.note,
            )
        )
    return tuple(specs)


def materialize_precomputed_results(
    capabilities: Iterable[CapabilityResult],
    specs: Iterable[PrecomputedCapabilitySpec],
    *,
    source_id: str,
    estimates_by_fact_key: Mapping[str, Decimal],
    estimate_bases_by_fact_key: Mapping[str, str],
    dataset_version: str,
    model_version: str | None,
) -> tuple[tuple[CapabilityResult, ...], tuple[EvaluationResult, ...]]:
    """Apply a generic reviewed surface and materialize its supported values."""

    from ..full_run import apply_precomputed_capability_specs

    spec_values = tuple(specs)
    supported_fact_keys = {
        spec.fact_key
        for spec in spec_values
        if spec.source_id == source_id
        and spec.status not in UNSUPPORTED_CAPABILITY_STATUSES
    }
    estimate_fact_keys = set(estimates_by_fact_key)
    if estimate_fact_keys != set(estimate_bases_by_fact_key):
        raise ValueError(
            "precomputed estimates and estimate bases have different facts"
        )
    if estimate_fact_keys != supported_fact_keys:
        raise ValueError(
            "precomputed estimates do not match the supported capability surface"
        )

    materialized_capabilities = apply_precomputed_capability_specs(
        capabilities,
        spec_values,
    )
    results: list[EvaluationResult] = []
    for materialized in materialized_capabilities:
        if (
            materialized.source_id != source_id
            or materialized.fact_key not in supported_fact_keys
        ):
            continue
        estimate = estimates_by_fact_key[materialized.fact_key]
        if not estimate.is_finite():
            raise ValueError(
                f"precomputed estimate is non-finite: {materialized.fact_key}"
            )
        results.append(
            EvaluationResult.from_capability(
                materialized,
                estimate=estimate,
                dataset_version=dataset_version,
                model_version=model_version,
                estimate_basis=estimate_bases_by_fact_key[
                    materialized.fact_key
                ],
            )
        )
    return materialized_capabilities, tuple(results)


def materialize_precomputed_checkpoint_results(
    capabilities: Iterable[CapabilityResult],
    checkpoint: PrecomputedCheckpoint,
    *,
    source: EvaluationSourceManifest,
) -> tuple[tuple[CapabilityResult, ...], tuple[EvaluationResult, ...]]:
    """Materialize every supported row while retaining unsupported reasons."""

    specs = precomputed_checkpoint_capability_specs(checkpoint, source=source)
    supported_entries = tuple(entry for entry in checkpoint.entries if entry.supported)
    return materialize_precomputed_results(
        capabilities,
        specs,
        source_id=checkpoint.source_id,
        estimates_by_fact_key={
            entry.anchor_fact_key: entry.estimate
            for entry in supported_entries
            if entry.estimate is not None
        },
        estimate_bases_by_fact_key={
            entry.anchor_fact_key: entry.estimate_basis
            for entry in supported_entries
        },
        dataset_version=source.dataset_version,
        model_version=source.model_version,
    )
