from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from decimal import Decimal
from enum import Enum
from typing import Any, Literal


class StringEnum(str, Enum):
    pass


class SourceType(StringEnum):
    AGGREGATE_DATASET = "aggregate_dataset"
    MODEL_DATASET_PAIR = "model_dataset_pair"


class CapabilityStatus(StringEnum):
    DIRECT = "evaluable_direct"
    MODEL = "evaluable_via_model"
    PROJECTED = "evaluable_projected"
    CALIBRATION_TARGET = "evaluable_in_sample"
    APPROXIMATE = "approximate_mapping"
    UNSUPPORTED_PERIOD = "unsupported_period"
    UNSUPPORTED_GEOGRAPHY = "unsupported_geography"
    UNSUPPORTED_ENTITY = "unsupported_entity"
    UNSUPPORTED_CONCEPT = "unsupported_concept"
    UNSUPPORTED_CONSTRAINT = "unsupported_constraint"
    PRIVATE_INPUT = "private_input"
    NOT_APPLICABLE = "not_applicable"


class ExecutionMethod(StringEnum):
    DIRECT = "direct"
    MODEL = "model"
    NONE = "none"


class MappingQuality(StringEnum):
    EXACT = "exact"
    APPROXIMATE = "approximate"
    NONE = "none"


class AlignmentQuality(StringEnum):
    VALIDATED = "validated"
    APPROXIMATE = "approximate"
    NONE = "none"


class PeriodTreatment(StringEnum):
    NATIVE = "native"
    ADVANCED_POPULATION = "advanced_population"
    ALIGNED_FACT = "aligned_fact"
    BUILD_TARGET_REPRODUCTION = "build_target_reproduction"
    UNSUPPORTED = "unsupported"


class CalibrationExposure(StringEnum):
    DIRECT_CALIBRATION_TARGET = "direct_calibration_target"
    USED_IN_IMPUTATION_OR_REWEIGHTING = "used_in_imputation_or_reweighting"
    RELATED_CALIBRATION_FAMILY = "related_calibration_family"
    HOLDOUT = "holdout"
    EXTERNAL_VALIDATION = "external_validation"
    UNKNOWN_EXPOSURE = "unknown_exposure"


PERIOD_PATTERNS = {
    "tax_year": re.compile(r"^\d{4}$"),
    "calendar_year": re.compile(r"^\d{4}$"),
    "fiscal_year": re.compile(r"^\d{4}$"),
    "month": re.compile(r"^\d{4}-(0[1-9]|1[0-2])$"),
}


@dataclass(frozen=True)
class TypedPeriod:
    kind: str
    value: str

    def __post_init__(self) -> None:
        pattern = PERIOD_PATTERNS.get(self.kind)
        if pattern is None or pattern.fullmatch(self.value) is None:
            raise ValueError(f"unsupported or malformed period: {self.kind}:{self.value}")

    @classmethod
    def parse(cls, value: str) -> "TypedPeriod":
        if ":" not in value:
            raise ValueError(f"typed period must contain a kind: {value!r}")
        kind, period_value = value.split(":", 1)
        return cls(kind=kind, value=period_value)

    @property
    def canonical(self) -> str:
        return f"{self.kind}:{self.value}"


SUPPORTED_UNITS = frozenset(
    {
        "USD",
        "USD_per_year",
        "count",
        "people",
        "households",
        "tax_units",
        "returns",
        "percent",
        "ratio",
    }
)


@dataclass(frozen=True)
class FactContract:
    fact_key: str
    source: str
    jurisdiction: str
    period: TypedPeriod
    geography_level: str
    geography_id: str
    entity: str
    measure: str
    unit: str
    value: Decimal
    dimensions: dict[str, Any]
    universe_constraints: tuple[Any, ...]
    provenance_class: str

    def __post_init__(self) -> None:
        if not self.fact_key:
            raise ValueError("fact_key must not be empty")
        if self.unit not in SUPPORTED_UNITS:
            raise ValueError(f"unsupported fact unit: {self.unit!r}")
        if not isinstance(self.value, Decimal):
            object.__setattr__(self, "value", Decimal(str(self.value)))

    def to_dict(self) -> dict[str, Any]:
        return {
            "fact_key": self.fact_key,
            "source": self.source,
            "jurisdiction": self.jurisdiction,
            "period": self.period.canonical,
            "geography_level": self.geography_level,
            "geography_id": self.geography_id,
            "entity": self.entity,
            "measure": self.measure,
            "unit": self.unit,
            "value": str(self.value),
            "dimensions": self.dimensions,
            "universe_constraints": list(self.universe_constraints),
            "provenance_class": self.provenance_class,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "FactContract":
        return cls(
            fact_key=payload["fact_key"],
            source=payload["source"],
            jurisdiction=payload["jurisdiction"],
            period=TypedPeriod.parse(payload["period"]),
            geography_level=payload["geography_level"],
            geography_id=payload["geography_id"],
            entity=payload["entity"],
            measure=payload["measure"],
            unit=payload["unit"],
            value=Decimal(payload["value"]),
            dimensions=dict(payload.get("dimensions", {})),
            universe_constraints=tuple(payload.get("universe_constraints", ())),
            provenance_class=payload["provenance_class"],
        )

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"))


@dataclass(frozen=True)
class AggregateQuery:
    operation: Literal["weighted_sum", "weighted_count", "weighted_mean", "ratio"]
    value_expression: str
    weight: str
    constraints: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class ModelQuery(AggregateQuery):
    policy_variable: str = ""


Query = AggregateQuery | ModelQuery


@dataclass(frozen=True)
class CapabilityResult:
    snapshot_id: str
    fact_key: str
    source_id: str
    source_type: SourceType
    mapping_release: str
    status: CapabilityStatus
    reason_code: str | None
    reason_detail: str | None
    execution_method: ExecutionMethod
    mapping_id: str | None
    mapping_quality: MappingQuality
    fact_period: TypedPeriod
    population_period: TypedPeriod | None
    policy_period: TypedPeriod | None
    period_treatment: PeriodTreatment
    alignment_id: str | None
    alignment_quality: AlignmentQuality
    entity: str
    weight_variable: str | None
    required_variables: tuple[str, ...]
    geography_method: str | None
    query: Query | None
    calibration_exposure: CalibrationExposure
    score_eligible: bool

    def __post_init__(self) -> None:
        executable = self.execution_method is not ExecutionMethod.NONE
        if self.source_type is SourceType.AGGREGATE_DATASET and self.execution_method is ExecutionMethod.MODEL:
            raise ValueError("raw dataset capability cannot request model execution")
        if executable and self.query is None:
            raise ValueError("executable capability requires a query")
        if not executable and self.query is not None:
            raise ValueError("unsupported capability cannot contain an executable query")
        if self.period_treatment is PeriodTreatment.ALIGNED_FACT:
            if not self.alignment_id or self.alignment_quality is AlignmentQuality.NONE:
                raise ValueError("aligned fact capability requires alignment provenance")
        if self.status in {
            CapabilityStatus.UNSUPPORTED_PERIOD,
            CapabilityStatus.UNSUPPORTED_GEOGRAPHY,
            CapabilityStatus.UNSUPPORTED_ENTITY,
            CapabilityStatus.UNSUPPORTED_CONCEPT,
            CapabilityStatus.UNSUPPORTED_CONSTRAINT,
            CapabilityStatus.PRIVATE_INPUT,
            CapabilityStatus.NOT_APPLICABLE,
        } and executable:
            raise ValueError("unsupported capability cannot be executable")

    @classmethod
    def direct(
        cls,
        *,
        snapshot_id: str,
        fact: FactContract,
        source_id: str,
        source_type: SourceType,
        mapping_release: str,
        mapping_id: str,
        mapping_quality: MappingQuality,
        population_period: TypedPeriod,
        period_treatment: PeriodTreatment,
        alignment_id: str | None,
        alignment_quality: AlignmentQuality,
        weight_variable: str,
        required_variables: tuple[str, ...],
        geography_method: str,
        query: AggregateQuery,
        calibration_exposure: CalibrationExposure,
        score_eligible: bool,
    ) -> "CapabilityResult":
        status = (
            CapabilityStatus.PROJECTED
            if period_treatment is PeriodTreatment.ALIGNED_FACT
            else CapabilityStatus.DIRECT
        )
        return cls(
            snapshot_id=snapshot_id,
            fact_key=fact.fact_key,
            source_id=source_id,
            source_type=source_type,
            mapping_release=mapping_release,
            status=status,
            reason_code=None,
            reason_detail=None,
            execution_method=ExecutionMethod.DIRECT,
            mapping_id=mapping_id,
            mapping_quality=mapping_quality,
            fact_period=fact.period,
            population_period=population_period,
            policy_period=None,
            period_treatment=period_treatment,
            alignment_id=alignment_id,
            alignment_quality=alignment_quality,
            entity=fact.entity,
            weight_variable=weight_variable,
            required_variables=required_variables,
            geography_method=geography_method,
            query=query,
            calibration_exposure=calibration_exposure,
            score_eligible=score_eligible,
        )

    @classmethod
    def unsupported(
        cls,
        *,
        snapshot_id: str,
        fact: FactContract,
        source_id: str,
        source_type: SourceType,
        mapping_release: str,
        status: CapabilityStatus,
        reason_code: str,
        reason_detail: str,
    ) -> "CapabilityResult":
        return cls(
            snapshot_id=snapshot_id,
            fact_key=fact.fact_key,
            source_id=source_id,
            source_type=source_type,
            mapping_release=mapping_release,
            status=status,
            reason_code=reason_code,
            reason_detail=reason_detail,
            execution_method=ExecutionMethod.NONE,
            mapping_id=None,
            mapping_quality=MappingQuality.NONE,
            fact_period=fact.period,
            population_period=None,
            policy_period=None,
            period_treatment=PeriodTreatment.UNSUPPORTED,
            alignment_id=None,
            alignment_quality=AlignmentQuality.NONE,
            entity=fact.entity,
            weight_variable=None,
            required_variables=(),
            geography_method=None,
            query=None,
            calibration_exposure=CalibrationExposure.UNKNOWN_EXPOSURE,
            score_eligible=False,
        )


@dataclass(frozen=True)
class AlignedFact:
    source_fact_key: str
    observed_period: TypedPeriod
    observed_value: Decimal
    target_period: TypedPeriod
    aligned_value: Decimal
    alignment_model: str
    alignment_version: str
    factor_sources: tuple[str, ...]
    method_quality: AlignmentQuality
    backtest_error: Decimal | None

    def __post_init__(self) -> None:
        if self.observed_period == self.target_period:
            raise ValueError("aligned fact target period must differ from its observed period")
        if self.method_quality is AlignmentQuality.NONE:
            raise ValueError("aligned fact requires a reviewed alignment quality")

