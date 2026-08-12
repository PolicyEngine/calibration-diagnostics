"""Materialize the pinned Yale Tax-Data/Tax-Simulator reconstruction checkpoint."""

from __future__ import annotations

import hashlib
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
from .planner import EvaluationSourceManifest


CHECKPOINT_SCHEMA = "evaluation_harness.yale_reconstruction_mappings.v2"
MAPPING_RELEASE = "yale-reconstruction-checkpoint-v2"
ESTIMATE_BASIS = "yale_reconstruction_aggregate_checkpoint"


@dataclass(frozen=True)
class YaleCheckpointTerm:
    reconstruction_row_key: str
    coefficient: Decimal


@dataclass(frozen=True)
class YaleCheckpointEntry:
    fact_key: str
    reconstruction_terms: tuple[YaleCheckpointTerm, ...]
    estimate: Decimal
    observed_period: TypedPeriod
    match_basis: str
    calibration_exposure: CalibrationExposure

    @property
    def reconstruction_row_keys(self) -> tuple[str, ...]:
        return tuple(term.reconstruction_row_key for term in self.reconstruction_terms)


@dataclass(frozen=True)
class YaleReconstructionCheckpoint:
    source_id: str
    snapshot_id: str
    reconstruction_sha256: str
    reconstruction_row_count: int
    held_out_2022_row_count: int
    unmatched_row_count: int
    verification_fact_keys: tuple[str, ...]
    entries: tuple[YaleCheckpointEntry, ...]


def load_yale_reconstruction_checkpoint(
    reconstruction_path: str | Path,
    mappings_path: str | Path,
) -> YaleReconstructionCheckpoint:
    """Load and cross-check the immutable reconstruction and its reviewed joins."""

    reconstruction_file = Path(reconstruction_path)
    mapping_file = Path(mappings_path)
    reconstruction_bytes = reconstruction_file.read_bytes()
    reconstruction_sha256 = hashlib.sha256(reconstruction_bytes).hexdigest()
    reconstruction = json.loads(reconstruction_bytes)
    mappings = json.loads(mapping_file.read_text())

    if mappings.get("schema_version") != CHECKPOINT_SCHEMA:
        raise ValueError(
            "unsupported Yale reconstruction mapping schema: "
            f"{mappings.get('schema_version')!r}"
        )
    expected_sha256 = str(mappings.get("reconstruction_sha256", ""))
    if reconstruction_sha256 != expected_sha256:
        raise ValueError(
            "Yale reconstruction SHA-256 does not match the reviewed checkpoint"
        )
    if reconstruction.get("dataset") != "yale_national":
        raise ValueError("Yale reconstruction has an unexpected dataset identifier")
    if reconstruction.get("year") != 2024:
        raise ValueError("Yale reconstruction checkpoint must represent 2024")
    if "RECONSTRUCTION, not Yale's published output" not in str(
        reconstruction.get("notes", "")
    ):
        raise ValueError("Yale reconstruction must retain its unofficial-output warning")
    rows = reconstruction.get("rows")
    if not isinstance(rows, dict):
        raise ValueError("Yale reconstruction rows must be a keyed object")
    expected_row_count = int(mappings.get("reconstruction_row_count", -1))
    if len(rows) != expected_row_count:
        raise ValueError(
            f"Yale reconstruction has {len(rows)} rows, expected {expected_row_count}"
        )

    entries: list[YaleCheckpointEntry] = []
    for payload in mappings.get("mappings", ()):
        term_payloads = payload.get("reconstruction_terms")
        if term_payloads is None:
            term_payloads = (
                {
                    "reconstruction_row_key": payload["reconstruction_row_key"],
                    "coefficient": "1",
                },
            )
        terms: list[YaleCheckpointTerm] = []
        estimate = Decimal("0")
        for term_payload in term_payloads:
            row_key = str(term_payload["reconstruction_row_key"])
            if row_key not in rows:
                raise ValueError(f"Yale reconstruction row is missing: {row_key}")
            coefficient = Decimal(str(term_payload.get("coefficient", "1")))
            if not coefficient.is_finite():
                raise ValueError(
                    f"Yale reconstruction coefficient is non-finite: {row_key}"
                )
            term_estimate = Decimal(str(rows[row_key]))
            if not term_estimate.is_finite():
                raise ValueError(f"Yale reconstruction row is non-finite: {row_key}")
            terms.append(
                YaleCheckpointTerm(
                    reconstruction_row_key=row_key,
                    coefficient=coefficient,
                )
            )
            estimate += coefficient * term_estimate
        if not terms:
            raise ValueError("Yale reconstruction mapping must contain a term")
        if not estimate.is_finite():
            raise ValueError("Yale reconstruction expression is non-finite")
        period = TypedPeriod.parse(str(payload["observed_period"]))
        if period not in {
            TypedPeriod.parse("tax_year:2022"),
            TypedPeriod.parse("tax_year:2023"),
            TypedPeriod.parse("tax_year:2024"),
        }:
            raise ValueError(
                "Yale checkpoint only supports native 2024 and approved 2022/2023 "
                f"alignments, not {period.canonical}"
            )
        entries.append(
            YaleCheckpointEntry(
                fact_key=str(payload["fact_key"]),
                reconstruction_terms=tuple(terms),
                estimate=estimate,
                observed_period=period,
                match_basis=str(payload["match_basis"]),
                calibration_exposure=CalibrationExposure(
                    payload["calibration_exposure"]
                ),
            )
        )

    fact_keys = [entry.fact_key for entry in entries]
    if len(fact_keys) != len(set(fact_keys)):
        raise ValueError("Yale reconstruction checkpoint has duplicate fact mappings")
    verification_fact_keys = tuple(mappings.get("verification_fact_keys", ()))
    if len(verification_fact_keys) != 10 or not set(verification_fact_keys) <= set(
        fact_keys
    ):
        raise ValueError("Yale checkpoint must retain all ten verification facts")
    held_out_2022_row_count = int(mappings.get("held_out_2022_row_count", -1))
    unmatched_row_count = int(mappings.get("unmatched_row_count", -1))
    referenced_row_keys = {
        row_key for entry in entries for row_key in entry.reconstruction_row_keys
    }
    if len(referenced_row_keys) + held_out_2022_row_count + unmatched_row_count != len(
        rows
    ):
        raise ValueError(
            "Yale reconstruction row audit does not reconcile referenced, held-out, "
            "and unmatched aggregate rows"
        )

    return YaleReconstructionCheckpoint(
        source_id=str(mappings["source_id"]),
        snapshot_id=str(mappings["chronicle_snapshot_id"]),
        reconstruction_sha256=reconstruction_sha256,
        reconstruction_row_count=len(rows),
        held_out_2022_row_count=held_out_2022_row_count,
        unmatched_row_count=unmatched_row_count,
        verification_fact_keys=verification_fact_keys,
        entries=tuple(entries),
    )


def materialize_yale_reconstruction_results(
    capabilities: Iterable[CapabilityResult],
    facts: Iterable[FactContract],
    checkpoint: YaleReconstructionCheckpoint,
    *,
    aligned_facts: Iterable[AlignedFact],
    source: EvaluationSourceManifest,
) -> tuple[tuple[CapabilityResult, ...], tuple[EvaluationResult, ...]]:
    """Replace reviewed Yale cells with immutable precomputed model results."""

    capability_values = tuple(capabilities)
    fact_values = tuple(facts)
    alignment_values = tuple(aligned_facts)
    fact_by_key = {fact.fact_key: fact for fact in fact_values}
    if len(fact_by_key) != len(fact_values):
        raise ValueError("facts contain duplicate fact keys")
    alignments_by_fact: dict[str, list[AlignedFact]] = {}
    for alignment in alignment_values:
        alignments_by_fact.setdefault(alignment.source_fact_key, []).append(alignment)
    entry_by_fact = {entry.fact_key: entry for entry in checkpoint.entries}
    if checkpoint.source_id != source.source_id:
        raise ValueError("Yale checkpoint and source manifest IDs differ")

    materialized_capabilities: list[CapabilityResult] = []
    results: list[EvaluationResult] = []
    for capability in capability_values:
        entry = entry_by_fact.get(capability.fact_key)
        if capability.source_id != source.source_id or entry is None:
            materialized_capabilities.append(capability)
            continue
        fact = fact_by_key.get(capability.fact_key)
        if fact is None:
            raise ValueError(f"Yale checkpoint fact is absent: {capability.fact_key}")
        if fact.period != entry.observed_period:
            raise ValueError(
                f"Yale checkpoint period differs for {capability.fact_key}: "
                f"{entry.observed_period.canonical} != {fact.period.canonical}"
            )
        if (
            fact.jurisdiction != "US"
            or fact.geography_level != "country"
            or fact.entity != "tax_unit"
        ):
            raise ValueError(
                f"Yale checkpoint fact is outside the national tax-unit surface: "
                f"{capability.fact_key}"
            )

        alignment = None
        if fact.period.value in {"2022", "2023"}:
            candidates = [
                row
                for row in alignments_by_fact.get(fact.fact_key, ())
                if row.target_period == TypedPeriod.parse("tax_year:2024")
                and row.observed_period == fact.period
                and row.observed_value == fact.value
            ]
            if len(candidates) != 1:
                raise ValueError(
                    "Yale pre-2024 checkpoint fact requires exactly one approved "
                    f"Microcosm alignment, found {len(candidates)}: {fact.fact_key}"
                )
            alignment = candidates[0]
            if (
                alignment.observed_period != fact.period
                or alignment.observed_value != fact.value
                or alignment.target_period != TypedPeriod.parse("tax_year:2024")
            ):
                raise ValueError(
                    f"Yale alignment does not preserve and transform {fact.fact_key}"
                )

        materialized = replace(
            capability,
            mapping_release=MAPPING_RELEASE,
            status=(
                CapabilityStatus.PROJECTED
                if alignment is not None
                else CapabilityStatus.MODEL
            ),
            reason_code=None,
            reason_detail=None,
            execution_method=ExecutionMethod.PRECOMPUTED,
            mapping_id=f"yale-checkpoint:{capability.fact_key.rsplit(':', 1)[-1]}",
            mapping_quality=MappingQuality.EXACT,
            population_period=source.population_period,
            policy_period=source.policy_period,
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
            geography_method="precomputed_national_reconstruction_checkpoint",
            query=None,
            calibration_exposure=entry.calibration_exposure,
            score_eligible=True,
        )
        materialized_capabilities.append(materialized)
        results.append(
            EvaluationResult.from_capability(
                materialized,
                estimate=entry.estimate,
                dataset_version=source.dataset_version,
                model_version=source.model_version,
                estimate_basis=ESTIMATE_BASIS,
            )
        )

    return tuple(materialized_capabilities), tuple(results)
