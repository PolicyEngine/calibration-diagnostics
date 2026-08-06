from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Iterable, Mapping, Protocol, Sequence

import numpy as np

from .contracts import AggregateQuery, CapabilityResult, ExecutionMethod, SourceType


@dataclass(frozen=True)
class ArrayBundle:
    arrays: Mapping[str, Sequence[Any] | np.ndarray]
    dataset_version: str
    model_version: str | None
    domain_masks: Mapping[str, Sequence[bool] | np.ndarray] = field(default_factory=dict)


@dataclass(frozen=True)
class RunGroup:
    source_id: str
    population_period: str
    policy_period: str | None
    geography_method: str
    entity: str
    fact_keys: tuple[str, ...]
    required_variables: tuple[str, ...]


@dataclass(frozen=True)
class EvaluationResult:
    snapshot_id: str
    mapping_release: str
    source_id: str
    fact_key: str
    estimate: Decimal
    dataset_version: str
    model_version: str | None
    population_period: str | None
    policy_period: str | None
    period_treatment: str
    alignment_id: str | None
    calibration_exposure: str
    mapping_id: str | None
    execution_method: str

    @classmethod
    def from_capability(
        cls,
        capability: CapabilityResult,
        *,
        estimate: Decimal,
        dataset_version: str,
        model_version: str | None,
    ) -> "EvaluationResult":
        return cls(
            snapshot_id=capability.snapshot_id,
            mapping_release=capability.mapping_release,
            source_id=capability.source_id,
            fact_key=capability.fact_key,
            estimate=estimate,
            dataset_version=dataset_version,
            model_version=model_version,
            population_period=(
                capability.population_period.canonical
                if capability.population_period
                else None
            ),
            policy_period=(
                capability.policy_period.canonical if capability.policy_period else None
            ),
            period_treatment=capability.period_treatment.value,
            alignment_id=capability.alignment_id,
            calibration_exposure=capability.calibration_exposure.value,
            mapping_id=capability.mapping_id,
            execution_method=capability.execution_method.value,
        )


class SourceRunner(Protocol):
    def prepare(self, group: RunGroup) -> ArrayBundle: ...


def _constraint_variables(query: AggregateQuery) -> set[str]:
    names: set[str] = set()
    for constraint in query.constraints:
        if "dimension" in constraint:
            names.add(str(constraint["dimension"]))
        if "variable" in constraint:
            names.add(str(constraint["variable"]))
    return names


def build_run_groups(capabilities: Iterable[CapabilityResult]) -> tuple[RunGroup, ...]:
    grouped: dict[tuple[str, str, str | None, str, str], list[CapabilityResult]] = {}
    for capability in capabilities:
        if capability.execution_method is ExecutionMethod.NONE or capability.query is None:
            continue
        key = (
            capability.source_id,
            capability.population_period.canonical if capability.population_period else "",
            capability.policy_period.canonical if capability.policy_period else None,
            capability.geography_method or "",
            capability.entity,
        )
        grouped.setdefault(key, []).append(capability)

    groups: list[RunGroup] = []
    for key, cells in sorted(grouped.items()):
        required: set[str] = set()
        for cell in cells:
            required.update(cell.required_variables)
            required.add(cell.query.weight)
            if cell.query.value_expression != "__ones__":
                required.add(cell.query.value_expression)
            if cell.query.denominator_expression:
                required.add(cell.query.denominator_expression)
            required.update(_constraint_variables(cell.query))
        groups.append(
            RunGroup(
                source_id=key[0],
                population_period=key[1],
                policy_period=key[2],
                geography_method=key[3],
                entity=key[4],
                fact_keys=tuple(sorted(cell.fact_key for cell in cells)),
                required_variables=tuple(sorted(required)),
            )
        )
    return tuple(groups)


def _array(bundle: ArrayBundle, name: str, expected_length: int) -> np.ndarray:
    if name not in bundle.arrays:
        raise ValueError(f"prepared population is missing required array {name!r}")
    value = np.asarray(bundle.arrays[name])
    if len(value) != expected_length:
        raise ValueError(
            f"array length mismatch for {name!r}: {len(value)} != {expected_length}"
        )
    return value


def _mask(query: AggregateQuery, bundle: ArrayBundle, length: int) -> np.ndarray:
    mask = np.ones(length, dtype=bool)
    for constraint in query.constraints:
        if "domain" in constraint:
            domain = str(constraint["domain"])
            if domain not in bundle.domain_masks:
                raise ValueError(f"prepared population has no mask for universe {domain!r}")
            domain_mask = np.asarray(bundle.domain_masks[domain], dtype=bool)
            if len(domain_mask) != length:
                raise ValueError(f"domain mask length mismatch for {domain!r}")
            mask &= domain_mask
            continue
        if "dimension" in constraint:
            values = _array(bundle, str(constraint["dimension"]), length)
            mask &= values == constraint["value"]
            continue
        variable = constraint.get("variable")
        operator = constraint.get("operator")
        if variable is None or operator is None:
            raise ValueError(f"unsupported constraint: {constraint!r}")
        values = _array(bundle, str(variable), length)
        expected = constraint.get("value")
        operations = {
            "eq": lambda: values == expected,
            "ne": lambda: values != expected,
            "gt": lambda: values > expected,
            "gte": lambda: values >= expected,
            "lt": lambda: values < expected,
            "lte": lambda: values <= expected,
            "in": lambda: np.isin(values, expected),
        }
        if operator not in operations:
            raise ValueError(f"unsupported constraint operator: {operator!r}")
        mask &= operations[operator]()
    return mask


def _decimal(value: Any) -> Decimal:
    if isinstance(value, np.generic):
        value = value.item()
    return Decimal(str(value))


def aggregate_query(query: AggregateQuery, bundle: ArrayBundle) -> Decimal:
    if query.weight not in bundle.arrays:
        raise ValueError(f"prepared population is missing weight {query.weight!r}")
    weights = np.asarray(bundle.arrays[query.weight])
    length = len(weights)
    mask = _mask(query, bundle, length)
    if query.value_expression == "__ones__":
        values = np.ones(length)
    else:
        values = _array(bundle, query.value_expression, length)

    if query.operation == "weighted_sum":
        estimate = np.sum(values[mask] * weights[mask])
    elif query.operation == "weighted_count":
        estimate = np.sum(weights[mask & (values != 0)])
    elif query.operation == "weighted_mean":
        denominator = np.sum(weights[mask])
        if denominator == 0:
            raise ValueError("weighted mean has a zero total weight")
        estimate = np.sum(values[mask] * weights[mask]) / denominator
    elif query.operation == "ratio":
        if not query.denominator_expression:
            raise ValueError("ratio query requires denominator_expression")
        denominator_values = _array(bundle, query.denominator_expression, length)
        denominator = np.sum(denominator_values[mask] * weights[mask])
        if denominator == 0:
            raise ValueError("ratio query has a zero denominator")
        estimate = np.sum(values[mask] * weights[mask]) / denominator
    else:
        raise ValueError(f"unsupported aggregate operation: {query.operation!r}")
    return _decimal(estimate)


def execute_groups(
    groups: Iterable[RunGroup],
    capabilities: Iterable[CapabilityResult],
    runners: Mapping[str, SourceRunner],
) -> tuple[EvaluationResult, ...]:
    by_cell = {
        (capability.source_id, capability.fact_key): capability
        for capability in capabilities
    }
    results: list[EvaluationResult] = []
    for group in groups:
        if group.source_id not in runners:
            raise ValueError(f"no runner registered for source {group.source_id!r}")
        bundle = runners[group.source_id].prepare(group)
        for fact_key in group.fact_keys:
            capability = by_cell[(group.source_id, fact_key)]
            estimate = aggregate_query(capability.query, bundle)
            results.append(
                EvaluationResult.from_capability(
                    capability,
                    estimate=estimate,
                    dataset_version=bundle.dataset_version,
                    model_version=bundle.model_version,
                )
            )
    validate_results(by_cell.values(), results)
    return tuple(results)


def run_group_cache_key(
    group: RunGroup,
    *,
    ledger_subset_hash: str,
    source_manifest_hash: str,
    mapping_hash: str,
    alignment_hash: str,
    harness_version: str,
) -> str:
    payload = {
        "group": {
            "source_id": group.source_id,
            "population_period": group.population_period,
            "policy_period": group.policy_period,
            "geography_method": group.geography_method,
            "entity": group.entity,
            "fact_keys": group.fact_keys,
            "required_variables": group.required_variables,
        },
        "ledger_subset_hash": ledger_subset_hash,
        "source_manifest_hash": source_manifest_hash,
        "mapping_hash": mapping_hash,
        "alignment_hash": alignment_hash,
        "harness_version": harness_version,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def validate_results(
    capabilities: Iterable[CapabilityResult],
    results: Iterable[EvaluationResult],
) -> None:
    capability_map = {
        (capability.source_id, capability.fact_key): capability
        for capability in capabilities
    }
    seen: set[tuple[str, str]] = set()
    for result in results:
        key = (result.source_id, result.fact_key)
        if key in seen:
            raise ValueError(f"duplicate evaluation result for {key}")
        seen.add(key)
        capability = capability_map.get(key)
        if capability is None:
            raise ValueError(f"evaluation result has no capability row: {key}")
        if not result.dataset_version:
            raise ValueError(f"evaluation result has no dataset version: {key}")
        if capability.source_type is SourceType.MODEL_DATASET_PAIR and not result.model_version:
            raise ValueError(f"modeled evaluation result has no model version: {key}")
        if result.snapshot_id != capability.snapshot_id:
            raise ValueError(f"result snapshot does not match capability: {key}")
        if result.mapping_release != capability.mapping_release:
            raise ValueError(f"result mapping release does not match capability: {key}")

