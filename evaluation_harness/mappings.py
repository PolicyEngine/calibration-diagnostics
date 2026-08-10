from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from .contracts import (
    CalibrationExposure,
    ExecutionMethod,
    FactContract,
    MappingQuality,
)


@dataclass(frozen=True)
class LedgerSelector:
    sources: frozenset[str]
    measures: frozenset[str]
    units: frozenset[str]
    entities: frozenset[str]
    fact_keys: frozenset[str] = frozenset()
    excluded_fact_keys: frozenset[str] = frozenset()

    def matches(self, fact: FactContract) -> bool:
        return (
            (not self.fact_keys or fact.fact_key in self.fact_keys)
            and fact.fact_key not in self.excluded_fact_keys
            and fact.source in self.sources
            and fact.measure in self.measures
            and fact.unit in self.units
            and fact.entity in self.entities
        )


@dataclass(frozen=True)
class MappingRule:
    mapping_id: str
    selector: LedgerSelector
    execution: ExecutionMethod
    source_expression: str
    operation: str
    denominator_expression: str | None
    execution_entity: str | None
    build_target_periods: frozenset[str]
    required_variables: tuple[str, ...]
    mapping_quality: MappingQuality
    supported_dimensions: frozenset[str]
    descriptive_dimensions: frozenset[str]
    descriptive_constraint_variables: frozenset[str]
    supported_constraint_domains: frozenset[str]
    supported_constraint_variables: frozenset[str]
    calibration_exposure: CalibrationExposure

    @classmethod
    def from_data(cls, payload: dict[str, Any]) -> "MappingRule":
        selector = payload["ledger_selector"]
        execution = ExecutionMethod(payload["execution"])
        if execution in {ExecutionMethod.NONE, ExecutionMethod.PRECOMPUTED}:
            raise ValueError("mapping execution must be direct or model")
        supported_dimensions = frozenset(payload.get("supported_dimensions", ()))
        supported_constraint_variables = set(
            payload.get("supported_constraint_variables", ())
        )
        if (
            "irs_soi" in selector["sources"]
            and "income_range" in supported_dimensions
        ):
            # Chronicle materializes IRS AGI brackets as both a descriptive
            # income_range dimension and executable first-class AGI bounds.
            supported_constraint_variables.add(
                "us:statutes/26/62#adjusted_gross_income"
            )
        return cls(
            mapping_id=payload["mapping_id"],
            selector=LedgerSelector(
                sources=frozenset(selector["sources"]),
                measures=frozenset(selector["measures"]),
                units=frozenset(selector["units"]),
                entities=frozenset(selector["entities"]),
                fact_keys=frozenset(selector.get("fact_keys", ())),
                excluded_fact_keys=frozenset(
                    selector.get("excluded_fact_keys", ())
                ),
            ),
            execution=execution,
            source_expression=payload["source_expression"],
            operation=payload["operation"],
            denominator_expression=payload.get("denominator_expression"),
            execution_entity=payload.get("execution_entity"),
            build_target_periods=frozenset(
                payload.get("build_target_periods", ())
            ),
            required_variables=tuple(payload.get("required_variables", ())),
            mapping_quality=MappingQuality(payload.get("mapping_quality", "exact")),
            supported_dimensions=supported_dimensions,
            descriptive_dimensions=frozenset(
                payload.get("descriptive_dimensions", ())
            ),
            descriptive_constraint_variables=frozenset(
                payload.get("descriptive_constraint_variables", ())
            ),
            supported_constraint_domains=frozenset(
                payload.get("supported_constraint_domains", ())
            ),
            supported_constraint_variables=frozenset(
                supported_constraint_variables
            ),
            calibration_exposure=CalibrationExposure(
                payload.get("calibration_exposure", "unknown_exposure")
            ),
        )

    def to_data(self) -> dict[str, Any]:
        return {
            "mapping_id": self.mapping_id,
            "ledger_selector": {
                "sources": sorted(self.selector.sources),
                "measures": sorted(self.selector.measures),
                "units": sorted(self.selector.units),
                "entities": sorted(self.selector.entities),
                **(
                    {"fact_keys": sorted(self.selector.fact_keys)}
                    if self.selector.fact_keys
                    else {}
                ),
                **(
                    {
                        "excluded_fact_keys": sorted(
                            self.selector.excluded_fact_keys
                        )
                    }
                    if self.selector.excluded_fact_keys
                    else {}
                ),
            },
            "execution": self.execution.value,
            "source_expression": self.source_expression,
            "operation": self.operation,
            **(
                {"denominator_expression": self.denominator_expression}
                if self.denominator_expression
                else {}
            ),
            **(
                {"execution_entity": self.execution_entity}
                if self.execution_entity
                else {}
            ),
            **(
                {"build_target_periods": sorted(self.build_target_periods)}
                if self.build_target_periods
                else {}
            ),
            "required_variables": list(self.required_variables),
            "mapping_quality": self.mapping_quality.value,
            "supported_dimensions": sorted(self.supported_dimensions),
            "descriptive_dimensions": sorted(self.descriptive_dimensions),
            "descriptive_constraint_variables": sorted(
                self.descriptive_constraint_variables
            ),
            "supported_constraint_domains": sorted(self.supported_constraint_domains),
            "supported_constraint_variables": sorted(self.supported_constraint_variables),
            "calibration_exposure": self.calibration_exposure.value,
        }


@dataclass(frozen=True)
class MappingRegistry:
    mapping_release: str
    mappings: tuple[MappingRule, ...]

    @classmethod
    def from_data(cls, payload: dict[str, Any]) -> "MappingRegistry":
        release = payload.get("mapping_release")
        if not release:
            raise ValueError("mapping registry requires mapping_release")
        mappings = tuple(MappingRule.from_data(item) for item in payload.get("mappings", ()))
        ids = [mapping.mapping_id for mapping in mappings]
        if len(ids) != len(set(ids)):
            raise ValueError("mapping registry contains duplicate mapping_id values")
        return cls(mapping_release=release, mappings=mappings)

    @classmethod
    def from_yaml(cls, path: str | Path) -> "MappingRegistry":
        payload = yaml.safe_load(Path(path).read_text())
        if not isinstance(payload, dict):
            raise ValueError("mapping registry YAML must contain an object")
        return cls.from_data(payload)

    def to_data(self) -> dict[str, Any]:
        return {
            "mapping_release": self.mapping_release,
            "mappings": [mapping.to_data() for mapping in self.mappings],
        }

    def match(self, fact: FactContract) -> MappingRule | None:
        matches = [mapping for mapping in self.mappings if mapping.selector.matches(fact)]
        if len(matches) > 1:
            raise ValueError(
                f"fact {fact.fact_key} matches multiple mappings: "
                f"{[mapping.mapping_id for mapping in matches]}"
            )
        return matches[0] if matches else None
