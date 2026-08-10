from __future__ import annotations

from dataclasses import dataclass, field
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
    geography_id_prefixes: dict[str, tuple[str, ...]] = field(default_factory=dict)
    geography_id_methods: dict[str, str] = field(default_factory=dict)
    execution_year_from_fact: bool = False

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
    calibration_exposure: CalibrationExposure | None = None
    semantic: bool = False

    def __post_init__(self) -> None:
        if not self.alignment_id:
            raise ValueError("alignment declaration requires an ID")
        if self.quality is AlignmentQuality.NONE:
            raise ValueError("alignment declaration requires a reviewed quality")
        if self.source_period == self.target_period and not self.semantic:
            raise ValueError(
                "same-period alignment declarations must be semantic"
            )


class CapabilityPlanner:
    def __init__(
        self,
        mappings: MappingRegistry,
        *,
        alignments: Iterable[AlignmentDeclaration] = (),
        calibration_exposures: dict[str, CalibrationExposure] | None = None,
        snapshot_id: str = "unversioned-snapshot",
    ) -> None:
        self.mappings = mappings
        self.alignments = tuple(alignments)
        self.calibration_exposures = dict(calibration_exposures or {})
        self.snapshot_id = snapshot_id
        self._exact_alignments: dict[tuple[str, str], list[AlignmentDeclaration]] = {}
        self._measure_alignments: dict[
            tuple[str, str, TypedPeriod], list[AlignmentDeclaration]
        ] = {}
        for alignment in self.alignments:
            if alignment.fact_key is not None:
                self._exact_alignments.setdefault(
                    (alignment.source_id, alignment.fact_key), []
                ).append(alignment)
            else:
                self._measure_alignments.setdefault(
                    (alignment.source_id, alignment.measure, alignment.source_period),
                    [],
                ).append(alignment)

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
            *self._exact_alignments.get((source.source_id, fact.fact_key), ()),
            *self._measure_alignments.get(
                (source.source_id, fact.measure, fact.period), ()
            ),
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

    @staticmethod
    def _query_constraint(constraint: dict) -> dict:
        operator_aliases = {
            "==": "eq",
            "!=": "ne",
            ">": "gt",
            ">=": "gte",
            "<": "lt",
            "<=": "lte",
        }
        if "operator" not in constraint:
            return dict(constraint)
        return {
            **constraint,
            "operator": operator_aliases.get(
                str(constraint["operator"]), str(constraint["operator"])
            ),
        }

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
        allowed_geography_prefixes = source.geography_id_prefixes.get(
            fact.geography_level, ()
        )
        if allowed_geography_prefixes and not fact.geography_id.startswith(
            allowed_geography_prefixes
        ):
            return self._unsupported(
                fact,
                source,
                CapabilityStatus.UNSUPPORTED_GEOGRAPHY,
                "geography_vintage_not_supported",
                f"{fact.geography_id} does not match the reviewed "
                f"{fact.geography_level} prefixes {allowed_geography_prefixes}",
            )
        mapping = self.mappings.match(fact)
        execution_entity = (
            mapping.execution_entity if mapping and mapping.execution_entity else fact.entity
        )
        if execution_entity not in source.entities:
            return self._unsupported(
                fact,
                source,
                CapabilityStatus.UNSUPPORTED_ENTITY,
                "entity_not_supported",
                f"{source.source_id} does not represent {execution_entity}",
            )

        period = fact.period.canonical
        alignment = self._alignment(fact, source)
        if alignment is not None and alignment.semantic:
            treatment = PeriodTreatment.ALIGNED_FACT
        elif period in source.native_fact_periods:
            treatment = PeriodTreatment.NATIVE
        elif period in source.advanced_fact_periods:
            treatment = PeriodTreatment.ADVANCED_POPULATION
        elif mapping is not None and period in mapping.build_target_periods:
            treatment = PeriodTreatment.BUILD_TARGET_REPRODUCTION
        else:
            if alignment is None:
                return self._unsupported(
                    fact,
                    source,
                    CapabilityStatus.UNSUPPORTED_PERIOD,
                    "period_not_supported",
                    f"no native, advanced, or aligned path for {period}",
                )
            treatment = PeriodTreatment.ALIGNED_FACT

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
        weight = source.weights.get(execution_entity)
        if not weight:
            return self._unsupported(
                fact,
                source,
                CapabilityStatus.UNSUPPORTED_ENTITY,
                "weight_not_available",
                f"no {execution_entity} weight is configured",
            )

        constraints = tuple(
            [
                {"dimension": "__geography__", "value": fact.geography_id},
                *[
                    {"dimension": key, "value": value}
                    for key, value in sorted(fact.dimensions.items())
                    if key not in mapping.descriptive_dimensions
                    and str(value).lower() not in {"all", "total"}
                ],
            ]
            + [
                self._query_constraint(constraint)
                for constraint in fact.universe_constraints
                if constraint.get("variable")
                not in mapping.descriptive_constraint_variables
            ]
        )
        query_type = ModelQuery if mapping.execution is ExecutionMethod.MODEL else AggregateQuery
        query_arguments = {
            "operation": mapping.operation,
            "value_expression": mapping.source_expression,
            "weight": weight,
            "constraints": constraints,
            "denominator_expression": mapping.denominator_expression,
        }
        if query_type is ModelQuery:
            query = ModelQuery(
                **query_arguments,
                policy_variable=mapping.source_expression,
            )
        else:
            query = AggregateQuery(**query_arguments)

        calibration_exposure = self.calibration_exposures.get(fact.fact_key)
        if calibration_exposure is None:
            calibration_exposure = (
                alignment.calibration_exposure
                if alignment is not None
                and alignment.calibration_exposure is not None
                else mapping.calibration_exposure
            )
        if treatment is PeriodTreatment.ALIGNED_FACT:
            status = CapabilityStatus.PROJECTED
        elif mapping.mapping_quality is MappingQuality.APPROXIMATE:
            status = CapabilityStatus.APPROXIMATE
        elif calibration_exposure is CalibrationExposure.DIRECT_CALIBRATION_TARGET:
            status = CapabilityStatus.CALIBRATION_TARGET
        elif mapping.execution is ExecutionMethod.MODEL:
            status = CapabilityStatus.MODEL
        else:
            status = CapabilityStatus.DIRECT

        score_eligible = (
            mapping.mapping_quality is MappingQuality.EXACT
            and fact.fact_key not in mapping.unscored_fact_keys
            and (
                treatment
                in {
                    PeriodTreatment.NATIVE,
                    PeriodTreatment.ADVANCED_POPULATION,
                    PeriodTreatment.BUILD_TARGET_REPRODUCTION,
                }
                or (
                    treatment is PeriodTreatment.ALIGNED_FACT
                    and alignment is not None
                    and alignment.score_eligible
                )
            )
        )
        geography_method = source.geography_methods[fact.geography_level]
        for prefix, method in source.geography_id_methods.items():
            if fact.geography_id.startswith(prefix):
                geography_method = method
                break
        population_period = source.population_period
        policy_period = source.policy_period
        if source.execution_year_from_fact:
            execution_year = fact.period.value[:4]
            population_period = TypedPeriod(
                kind=source.population_period.kind,
                value=execution_year,
            )
            if source.policy_period is not None:
                policy_period = TypedPeriod(
                    kind=source.policy_period.kind,
                    value=execution_year,
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
            population_period=population_period,
            policy_period=policy_period,
            period_treatment=treatment,
            alignment_id=alignment.alignment_id if alignment else None,
            alignment_quality=alignment.quality if alignment else AlignmentQuality.NONE,
            entity=execution_entity,
            weight_variable=weight,
            required_variables=mapping.required_variables,
            geography_method=geography_method,
            query=query,
            calibration_exposure=calibration_exposure,
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
