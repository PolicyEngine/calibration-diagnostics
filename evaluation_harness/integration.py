from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from .contracts import FactContract, SourceType, TypedPeriod
from .planner import EvaluationSourceManifest
from .snapshot import SNAPSHOT_SCHEMA


INTEGRATION_OVERVIEW_SCHEMA = "evaluation_harness.integration_overview.v1"
INTEGRATION_FIXTURE_SCHEMA = "evaluation_harness.integration_fixture.v1"


@dataclass(frozen=True)
class IntegrationOverview:
    """Reviewed inputs that must be approved before an adapter is implemented."""

    integration_id: str
    chronicle_snapshot_id: str
    source: EvaluationSourceManifest
    verification_facts: tuple[FactContract, ...]
    alignment_policy: dict[str, Any]
    overview_path: Path


def _required(payload: dict[str, Any], key: str, context: str) -> Any:
    if key not in payload:
        raise ValueError(f"{context} requires {key}")
    return payload[key]


def _source_manifest(payload: dict[str, Any]) -> EvaluationSourceManifest:
    return EvaluationSourceManifest(
        source_id=_required(payload, "source_id", "integration source"),
        source_type=SourceType(_required(payload, "source_type", "integration source")),
        dataset_version=_required(payload, "dataset_version", "integration source"),
        model_version=payload.get("model_version"),
        jurisdictions=frozenset(payload.get("jurisdictions", ())),
        population_period=TypedPeriod.parse(
            _required(payload, "population_period", "integration source")
        ),
        policy_period=(
            TypedPeriod.parse(payload["policy_period"])
            if payload.get("policy_period")
            else None
        ),
        native_fact_periods=frozenset(payload.get("native_fact_periods", ())),
        advanced_fact_periods=frozenset(payload.get("advanced_fact_periods", ())),
        geographies=frozenset(payload.get("geographies", ())),
        entities=frozenset(payload.get("entities", ())),
        weights=dict(payload.get("weights", {})),
        geography_methods=dict(payload.get("geography_methods", {})),
        available=bool(payload.get("available", False)),
        geography_id_prefixes={
            level: tuple(prefixes)
            for level, prefixes in payload.get("geography_id_prefixes", {}).items()
        },
        geography_id_methods=dict(payload.get("geography_id_methods", {})),
        execution_year_from_fact=bool(payload.get("execution_year_from_fact", False)),
    )


def _load_facts(path: Path) -> tuple[FactContract, ...]:
    facts: list[FactContract] = []
    with path.open() as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            try:
                facts.append(FactContract.from_dict(json.loads(line)))
            except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
                raise ValueError(f"invalid verification fact on line {line_number}: {error}") from error
    keys = [fact.fact_key for fact in facts]
    if len(keys) != len(set(keys)):
        raise ValueError("verification facts contain duplicate fact keys")
    return tuple(facts)


def load_integration_overview(path: str | Path) -> IntegrationOverview:
    overview_path = Path(path)
    payload = yaml.safe_load(overview_path.read_text())
    if not isinstance(payload, dict):
        raise ValueError("integration overview YAML must contain an object")
    if payload.get("schema_version") != INTEGRATION_OVERVIEW_SCHEMA:
        raise ValueError(
            f"unsupported integration overview schema: {payload.get('schema_version')!r}"
        )
    facts_file = overview_path.parent / _required(
        payload, "verification_facts_file", "integration overview"
    )
    facts = _load_facts(facts_file)
    if len(facts) != 10:
        raise ValueError(
            f"adapter checkpoint requires exactly 10 verification facts, found {len(facts)}"
        )
    return IntegrationOverview(
        integration_id=_required(payload, "integration_id", "integration overview"),
        chronicle_snapshot_id=_required(payload, "chronicle_snapshot_id", "integration overview"),
        source=_source_manifest(_required(payload, "source", "integration overview")),
        verification_facts=facts,
        alignment_policy=dict(payload.get("alignment_policy", {})),
        overview_path=overview_path,
    )


MATERIAL_FACT_FIELDS = (
    "semantic_fact_key",
    "source",
    "jurisdiction",
    "period",
    "geography_level",
    "geography_id",
    "entity",
    "measure",
    "unit",
    "value",
    "dimensions",
    "universe_constraints",
    "provenance_class",
    "assertion",
    "aggregation",
)


def _material_value(fact: FactContract, field: str) -> Any:
    value = getattr(fact, field)
    if field == "period":
        return value.canonical
    return value


def validate_overview_against_snapshot(
    overview: IntegrationOverview,
    snapshot_path: str | Path,
) -> None:
    """Prove that the checkpoint's ten targets are exact rows in a pinned snapshot."""

    path = Path(snapshot_path)
    manifest = json.loads((path / "snapshot_manifest.json").read_text())
    schema = manifest.get("schema_version")
    if schema not in {SNAPSHOT_SCHEMA, INTEGRATION_FIXTURE_SCHEMA}:
        raise ValueError(f"unsupported verification snapshot schema: {schema!r}")
    if manifest.get("snapshot_id") != overview.chronicle_snapshot_id:
        raise ValueError(
            "integration and snapshot IDs differ: "
            f"{overview.chronicle_snapshot_id} != {manifest.get('snapshot_id')}"
        )

    facts_path = path / "facts.jsonl"
    expected_hash = manifest.get("normalized_facts_sha256")
    if expected_hash:
        actual_hash = hashlib.sha256(facts_path.read_bytes()).hexdigest()
        if actual_hash != expected_hash:
            raise ValueError("snapshot facts hash does not match its manifest")

    snapshot = {fact.fact_key: fact for fact in _load_facts(facts_path)}
    for expected in overview.verification_facts:
        actual = snapshot.get(expected.fact_key)
        if actual is None:
            raise ValueError(f"verification fact is absent from snapshot: {expected.fact_key}")
        mismatches = [
            field
            for field in MATERIAL_FACT_FIELDS
            if _material_value(expected, field) != _material_value(actual, field)
        ]
        if mismatches:
            raise ValueError(
                f"verification fact {expected.fact_key} differs in: {', '.join(mismatches)}"
            )
