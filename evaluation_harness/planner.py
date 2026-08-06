from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .contracts import (
    AggregateQuery,
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
from .mappings import MappingRegistry, MappingRule


@dataclass(frozen=True)
class EvaluationSourceManifest:
    source_id: str
    source_type: SourceType
    dataset_version: str
    model_version: str | None
    jurisdictions: frozenset[str]
    population_period: TypedPeriod
    policy_period: TypedPeriod | None
    native_fact_periods: frozenset[str]
    advanced_fact_periods: frozenset[str]
    geographies: frozenset[str]
    entities: frozenset[str]
    weights: dict[str, str]
    geography_methods: dict[str, str]
    available: bool

    def __post_init__(self) -> None:
        if self.source_type is SourceType.MODEL_DATASET_PAIR and not self.model_version:
            raise ValueError("model-dataset source requires a model version")
        if self.source_type is SourceType.AGGREGATE_DATASET and self.model_version:
            raise ValueError("raw dataset manifest cannot declare a model version")


@dataclass(frozen=True)
class AlignmentDeclaration:
    alignment_id: str
    source_id: str
    measure: str
    source_period: TypedPeriod
    target_period: TypedPeriod
    quality: AlignmentQuality
    fact_key: str | None = None
    score_eligible: bool = False

    def __post_init__(self) -> None:
        if not self.alignment_id:
            raise ValueError("alignment declaration requires an ID")
        if self.quality is AlignmentQuality.NONE:
            raise ValueError("alignment declaration requires a reviewed quality")


class CapabilityPlanner:
    def __init__(
        self,
        mappings: MappingRegistry,
        *,
        alignments: Iterable[AlignmentDeclaration] = (),
        snapshot_id: str = "unversioned-snapshot",
    ) -> None:
        self.mappings = mappings
        self.alignments = tuple(alignments)
        self.snapshot_id = snapshot_id

    def _unsupported(
        self,
        fact: FactContract,
        source: EvaluationSourceManifest,
        status: CapabilityStatus,
        reason_code: str,
        detail: str,
    ) -> CapabilityResult:
        return CapabilityResult.unsupported(
            snapshot_id=self.snapshot_id,
            fact=fact,
            source_id=source.source_id,
            source_type=source.source_type,
            mapping_release=self.mappings.mapping_release,
            status=status,
            reason_code=reason_code,
            reason_detail=detail,
        )

    def _alignment(
        self,
        fact: FactContract,
        source: EvaluationSourceManifest,
    ) -> AlignmentDeclaration | None:
        matches = [
            alignment
            for alignment in self.alignments
            if alignment.source_id == source.source_id
            and alignment.measure == fact.measure
            and alignment.source_period == fact.period
            and (alignment.fact_key is None or alignment.fact_key == fact.fact_key)
        ]
        if len(matches) > 1:
            raise ValueError(
                f"fact {fact.fact_key} has multiple period alignment declarations for "
                f"source {source.source_id}"
            )
        return matches[0] if matches else None

    @staticmethod
    def _unsupported_semantics(fact: FactContract, mapping: MappingRule) -> str | None:
        unsupported_dimensions = set(fact.dimensions) - mapping.supported_dimensions
        if unsupported_dimensions:
            return "unsupported dimensions: " + ", ".join(sorted(unsupported_dimensions))
        for constraint in fact.universe_constraints:
            if not isinstance(constraint, dict):
                return f"unsupported constraint shape: {constraint!r}"
            if "domain" in constraint:
                if constraint["domain"] not in mapping.supported_constraint_domains:
                    return f"unsupported universe domain: {constraint['domain']}"
            elif constraint.get("variable") not in mapping.supported_constraint_variables:
                return f"unsupported constraint variable: {constraint.get('variable')}"
        return None

    def classify(
        self,
        fact: FactContract,
        source: EvaluationSourceManifest,
    ) -> CapabilityResult:
        if fact.jurisdiction not in source.jurisdictions:
            return self._unsupported(
                fact,
                source,
                CapabilityStatus.NOT_APPLICABLE,
                "jurisdiction_not_applicable",
                f"{source.source_id} does not represent {fact.jurisdiction}",
            )
        if not source.available:
            return self._unsupported(
                fact,
                source,
                CapabilityStatus.PRIVATE_INPUT,
                "source_input_unavailable",
                f"inputs for {source.source_id} are not available to this runner",
            )
        if fact.geography_level not in source.geographies:
            return self._unsupported(
                fact,
                source,
                CapabilityStatus.UNSUPPORTED_GEOGRAPHY,
                "geography_not_supported",
                f"{source.source_id} does not support {fact.geography_level}",
            )
        if fact.entity not in source.entities:
            return self._unsupported(
                fact,
                source,
                CapabilityStatus.UNSUPPORTED_ENTITY,
                "entity_not_supported",
                f"{source.source_id} does not represent {fact.entity}",
            )

        period = fact.period.canonical
        alignment: AlignmentDeclaration | None = None
        if period in source.native_fact_periods:
            treatment = PeriodTreatment.NATIVE
        elif period in source.advanced_fact_periods:
            treatment = PeriodTreatment.ADVANCED_POPULATION
        else:
            alignment = self._alignment(fact, source)
            if alignment is None:
                return self._unsupported(
                    fact,
                    source,
                    CapabilityStatus.UNSUPPORTED_PERIOD,
                    "period_not_supported",
                    f"no native, advanced, or aligned path for {period}",
                )
            treatment = PeriodTreatment.ALIGNED_FACT

        mapping = self.mappings.match(fact)
        if mapping is None:
            return self._unsupported(
                fact,
                source,
                CapabilityStatus.UNSUPPORTED_CONCEPT,
                "mapping_not_found",
                f"no reviewed mapping for {fact.source}:{fact.measure}:{fact.unit}",
            )
        if source.source_type is SourceType.AGGREGATE_DATASET and mapping.execution is ExecutionMethod.MODEL:
            raise ValueError(
                f"raw dataset {source.source_id} cannot use model mapping {mapping.mapping_id}"
            )
        semantic_issue = self._unsupported_semantics(fact, mapping)
        if semantic_issue:
            return self._unsupported(
                fact,
                source,
                CapabilityStatus.UNSUPPORTED_CONSTRAINT,
                "slice_semantics_not_supported",
                semantic_issue,
            )
        weight = source.weights.get(fact.entity)
        if not weight:
            return self._unsupported(
                fact,
                source,
                CapabilityStatus.UNSUPPORTED_ENTITY,
                "weight_not_available",
                f"no {fact.entity} weight is configured",
            )

        constraints = tuple(
            [{"dimension": key, "value": value} for key, value in sorted(fact.dimensions.items())]
            + list(fact.universe_constraints)
        )
        query_type = ModelQuery if mapping.execution is ExecutionMethod.MODEL else AggregateQuery
        query_arguments = {
            "operation": mapping.operation,
            "value_expression": mapping.source_expression,
            "weight": weight,
            "constraints": constraints,
        }
        if query_type is ModelQuery:
            query = ModelQuery(
                **query_arguments,
                policy_variable=mapping.source_expression,
            )
        else:
            query = AggregateQuery(**query_arguments)

        if treatment is PeriodTreatment.ALIGNED_FACT:
            status = CapabilityStatus.PROJECTED
        elif mapping.mapping_quality is MappingQuality.APPROXIMATE:
            status = CapabilityStatus.APPROXIMATE
        elif mapping.calibration_exposure is CalibrationExposure.DIRECT_CALIBRATION_TARGET:
            status = CapabilityStatus.CALIBRATION_TARGET
        elif mapping.execution is ExecutionMethod.MODEL:
            status = CapabilityStatus.MODEL
        else:
            status = CapabilityStatus.DIRECT

        score_eligible = (
            mapping.mapping_quality is MappingQuality.EXACT
            and (
                treatment
                in {PeriodTreatment.NATIVE, PeriodTreatment.ADVANCED_POPULATION}
                or (
                    treatment is PeriodTreatment.ALIGNED_FACT
                    and alignment is not None
                    and alignment.score_eligible
                )
            )
        )
        return CapabilityResult(
            snapshot_id=self.snapshot_id,
            fact_key=fact.fact_key,
            source_id=source.source_id,
            source_type=source.source_type,
            mapping_release=self.mappings.mapping_release,
            status=status,
            reason_code=None,
            reason_detail=None,
            execution_method=mapping.execution,
            mapping_id=mapping.mapping_id,
            mapping_quality=mapping.mapping_quality,
            fact_period=fact.period,
            population_period=source.population_period,
            policy_period=source.policy_period,
            period_treatment=treatment,
            alignment_id=alignment.alignment_id if alignment else None,
            alignment_quality=alignment.quality if alignment else AlignmentQuality.NONE,
            entity=fact.entity,
            weight_variable=weight,
            required_variables=mapping.required_variables,
            geography_method=source.geography_methods[fact.geography_level],
            query=query,
            calibration_exposure=mapping.calibration_exposure,
            score_eligible=score_eligible,
        )

    def classify_all(
        self,
        facts: Iterable[FactContract],
        sources: Iterable[EvaluationSourceManifest],
    ) -> tuple[CapabilityResult, ...]:
        results = tuple(
            self.classify(fact, source)
            for fact in facts
            for source in sources
        )
        keys = {(result.fact_key, result.source_id) for result in results}
        if len(keys) != len(results):
            raise ValueError("capability matrix contains duplicate fact/source cells")
        return results
