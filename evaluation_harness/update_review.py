from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable, Literal

from .contracts import CapabilityResult, ExecutionMethod, FactContract
from .full_run import SourcePlan, load_snapshot_facts
from .integration import IntegrationOverview
from .integration import load_integration_overview
from .mappings import MappingRegistry
from .planner import CapabilityPlanner
from .microcosm_aging import (
    MicrocosmAgingPolicy,
    transform_ledger_facts_to_microcosm_year,
)
from .snapshot import CONSUMER_SCHEMA, SnapshotDiff, diff_snapshots


REVIEW_SCHEMA = "evaluation_harness.ledger_update_review.v1"
REVIEW_MANIFEST_SCHEMA = "evaluation_harness.ledger_update_review_manifest.v1"


def _facts_by_key(
    facts: Iterable[FactContract],
) -> dict[str, FactContract]:
    result: dict[str, FactContract] = {}
    for fact in facts:
        if fact.fact_key in result:
            raise ValueError(f"duplicate aggregate fact key: {fact.fact_key}")
        result[fact.fact_key] = fact
    return result


def _fingerprint(fact: FactContract) -> str:
    payload = {
        "semantic_fact_key": fact.semantic_fact_key,
        "source": fact.source,
        "jurisdiction": fact.jurisdiction,
        "period": fact.period.canonical,
        "geography_level": fact.geography_level,
        "geography_id": fact.geography_id,
        "entity": fact.entity,
        "measure": fact.measure,
        "unit": fact.unit,
        "dimensions": fact.dimensions,
        "universe_constraints": list(fact.universe_constraints),
        "aggregation": fact.aggregation,
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _pair_facts(
    old_facts: Iterable[FactContract],
    new_facts: Iterable[FactContract],
) -> tuple[tuple[FactContract | None, FactContract | None], ...]:
    old = _facts_by_key(old_facts)
    new = _facts_by_key(new_facts)
    pairs: list[tuple[FactContract | None, FactContract | None]] = []
    for key in sorted(old.keys() & new.keys()):
        pairs.append((old.pop(key), new.pop(key)))

    old_by_fingerprint: dict[str, list[FactContract]] = {}
    new_by_fingerprint: dict[str, list[FactContract]] = {}
    for fact in old.values():
        old_by_fingerprint.setdefault(_fingerprint(fact), []).append(fact)
    for fact in new.values():
        new_by_fingerprint.setdefault(_fingerprint(fact), []).append(fact)
    for fingerprint in sorted(old_by_fingerprint.keys() & new_by_fingerprint.keys()):
        old_matches = old_by_fingerprint[fingerprint]
        new_matches = new_by_fingerprint[fingerprint]
        if len(old_matches) == 1 and len(new_matches) == 1:
            old_fact = old_matches[0]
            new_fact = new_matches[0]
            pairs.append((old.pop(old_fact.fact_key), new.pop(new_fact.fact_key)))
    pairs.extend((fact, None) for fact in sorted(old.values(), key=lambda item: item.fact_key))
    pairs.extend((None, fact) for fact in sorted(new.values(), key=lambda item: item.fact_key))
    return tuple(pairs)


def _review_identity(
    old_fact: FactContract | None,
    new_fact: FactContract | None,
    duplicate_semantics: set[str],
) -> str:
    fact = new_fact or old_fact
    assert fact is not None
    semantic = fact.semantic_fact_key
    if semantic and semantic not in duplicate_semantics:
        return semantic
    return (semantic + "|" if semantic else "") + fact.fact_key


def _classify(
    facts: Iterable[FactContract],
    plan: SourcePlan,
    snapshot_id: str,
) -> dict[str, CapabilityResult]:
    planner = CapabilityPlanner(
        plan.mappings,
        alignments=plan.alignments,
        snapshot_id=snapshot_id,
    )
    return {
        fact.fact_key: planner.classify(fact, plan.source)
        for fact in facts
    }


def _executable(capability: CapabilityResult | None) -> bool:
    return (
        capability is not None
        and capability.execution_method is not ExecutionMethod.NONE
        and capability.query is not None
    )


def _execution_signature(capability: CapabilityResult) -> tuple[Any, ...]:
    return (
        capability.execution_method,
        capability.mapping_id,
        capability.query,
        capability.population_period,
        capability.policy_period,
        capability.period_treatment,
        capability.required_variables,
        capability.weight_variable,
        capability.geography_method,
    )


@dataclass(frozen=True)
class SourceUpdateReview:
    source_id: str
    from_snapshot: str
    to_snapshot: str
    old_fact_count: int
    new_fact_count: int
    old_executable_count: int
    new_executable_count: int
    mapping_regressions: tuple[dict[str, str | None], ...]
    newly_executable: tuple[str, ...]
    retired_executable: tuple[str, ...]
    execution_changes: tuple[str, ...]
    value_changes_requiring_rescore: tuple[str, ...]
    requires_classification: bool
    requires_execution: bool
    requires_rescore: bool
    requires_publish: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class VerificationGate:
    integration_id: str
    source_id: str
    expected_count: int
    matched_count: int
    testable_count: int
    failures: tuple[dict[str, str | None], ...]
    passed: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def review_source_update(
    old_facts: Iterable[FactContract],
    new_facts: Iterable[FactContract],
    *,
    old_plan: SourcePlan,
    new_plan: SourcePlan,
    from_snapshot: str,
    to_snapshot: str,
) -> SourceUpdateReview:
    if old_plan.source.source_id != new_plan.source.source_id:
        raise ValueError("source update plans must have the same source_id")
    old_values = _facts_by_key(old_facts)
    new_values = _facts_by_key(new_facts)
    old_capabilities = _classify(old_values.values(), old_plan, from_snapshot)
    new_capabilities = _classify(new_values.values(), new_plan, to_snapshot)
    pairs = _pair_facts(old_values.values(), new_values.values())
    old_semantic_counts: dict[str, int] = {}
    new_semantic_counts: dict[str, int] = {}
    for fact in old_values.values():
        if fact.semantic_fact_key:
            old_semantic_counts[fact.semantic_fact_key] = (
                old_semantic_counts.get(fact.semantic_fact_key, 0) + 1
            )
    for fact in new_values.values():
        if fact.semantic_fact_key:
            new_semantic_counts[fact.semantic_fact_key] = (
                new_semantic_counts.get(fact.semantic_fact_key, 0) + 1
            )
    duplicate_semantics = {
        semantic
        for semantic in old_semantic_counts.keys() | new_semantic_counts.keys()
        if max(old_semantic_counts.get(semantic, 0), new_semantic_counts.get(semantic, 0))
        > 1
    }

    regressions: list[dict[str, str | None]] = []
    newly_executable: list[str] = []
    retired_executable: list[str] = []
    execution_changes: list[str] = []
    value_changes: list[str] = []

    for old_fact, new_fact in pairs:
        identity = _review_identity(old_fact, new_fact, duplicate_semantics)
        old_capability = (
            old_capabilities.get(old_fact.fact_key) if old_fact else None
        )
        new_capability = (
            new_capabilities.get(new_fact.fact_key) if new_fact else None
        )
        old_exec = _executable(old_capability)
        new_exec = _executable(new_capability)
        if old_exec and not new_exec:
            assert old_fact is not None and old_capability is not None
            regressions.append(
                {
                    "semantic_fact_key": identity,
                    "from_fact_key": old_fact.fact_key,
                    "to_fact_key": new_fact.fact_key if new_fact else None,
                    "from_status": old_capability.status.value,
                    "to_status": new_capability.status.value if new_capability else None,
                    "reason_code": (
                        new_capability.reason_code
                        if new_capability
                        else "fact_removed"
                    ),
                }
            )
            retired_executable.append(identity)
        elif not old_exec and new_exec:
            newly_executable.append(identity)
            execution_changes.append(identity)
        elif old_exec and new_exec:
            assert old_capability is not None and new_capability is not None
            if _execution_signature(old_capability) != _execution_signature(
                new_capability
            ):
                execution_changes.append(identity)
            if (
                old_fact is not None
                and new_fact is not None
                and old_fact.value != new_fact.value
            ):
                value_changes.append(identity)

    changed_snapshot = from_snapshot != to_snapshot
    requires_execution = bool(execution_changes)
    requires_rescore = requires_execution or bool(value_changes)
    return SourceUpdateReview(
        source_id=old_plan.source.source_id,
        from_snapshot=from_snapshot,
        to_snapshot=to_snapshot,
        old_fact_count=len(old_values),
        new_fact_count=len(new_values),
        old_executable_count=sum(map(_executable, old_capabilities.values())),
        new_executable_count=sum(map(_executable, new_capabilities.values())),
        mapping_regressions=tuple(regressions),
        newly_executable=tuple(newly_executable),
        retired_executable=tuple(retired_executable),
        execution_changes=tuple(sorted(set(execution_changes))),
        value_changes_requiring_rescore=tuple(value_changes),
        requires_classification=changed_snapshot,
        requires_execution=requires_execution,
        requires_rescore=requires_rescore,
        requires_publish=changed_snapshot,
    )


def verification_gate(
    overview: IntegrationOverview,
    candidate_facts: Iterable[FactContract],
    *,
    plan: SourcePlan,
    snapshot_id: str,
) -> VerificationGate:
    if overview.source.source_id != plan.source.source_id:
        raise ValueError("verification overview and plan source IDs differ")
    candidates = _facts_by_key(candidate_facts)
    candidates_by_fingerprint: dict[str, list[FactContract]] = {}
    for candidate in candidates.values():
        candidates_by_fingerprint.setdefault(_fingerprint(candidate), []).append(
            candidate
        )
    expected = tuple(overview.verification_facts)
    planner = CapabilityPlanner(
        plan.mappings,
        alignments=plan.alignments,
        snapshot_id=snapshot_id,
    )
    failures: list[dict[str, str | None]] = []
    testable = 0
    matched = 0
    for original in expected:
        identity = original.semantic_fact_key or original.fact_key
        fact = candidates.get(original.fact_key)
        if fact is None:
            matches = candidates_by_fingerprint.get(_fingerprint(original), [])
            fact = matches[0] if len(matches) == 1 else None
        if fact is None:
            failures.append(
                {
                    "semantic_fact_key": identity,
                    "fact_key": original.fact_key,
                    "status": None,
                    "reason_code": "verification_fact_missing",
                }
            )
            continue
        matched += 1
        capability = planner.classify(fact, plan.source)
        if _executable(capability) and capability.score_eligible:
            testable += 1
        else:
            failures.append(
                {
                    "semantic_fact_key": identity,
                    "fact_key": fact.fact_key,
                    "status": capability.status.value,
                    "reason_code": capability.reason_code,
                }
            )
    expected_count = len(expected)
    return VerificationGate(
        integration_id=overview.integration_id,
        source_id=overview.source.source_id,
        expected_count=expected_count,
        matched_count=matched,
        testable_count=testable,
        failures=tuple(failures),
        passed=(
            expected_count == 10
            and matched == expected_count
            and testable == expected_count
            and not failures
        ),
    )


def select_affected_sources(
    reviews: Iterable[SourceUpdateReview],
    *,
    action: Literal["classify", "execute", "rescore", "publish"],
) -> tuple[str, ...]:
    attribute = {
        "classify": "requires_classification",
        "execute": "requires_execution",
        "rescore": "requires_rescore",
        "publish": "requires_publish",
    }[action]
    return tuple(
        sorted(
            review.source_id
            for review in reviews
            if bool(getattr(review, attribute))
        )
    )


def build_update_review_document(
    diff: SnapshotDiff,
    source_reviews: Iterable[SourceUpdateReview],
    gates: Iterable[VerificationGate],
) -> dict[str, Any]:
    reviews = tuple(source_reviews)
    gate_values = tuple(gates)
    regressions = sum(len(review.mapping_regressions) for review in reviews)
    return {
        "schema_version": REVIEW_SCHEMA,
        "from_snapshot": diff.from_snapshot,
        "to_snapshot": diff.to_snapshot,
        "snapshot_diff": diff.to_dict(),
        "source_reviews": [review.to_dict() for review in reviews],
        "verification_gates": [gate.to_dict() for gate in gate_values],
        "affected_sources": {
            action: list(select_affected_sources(reviews, action=action))
            for action in ("classify", "execute", "rescore", "publish")
        },
        "ready_for_evaluation": (
            regressions == 0
            and all(gate.passed for gate in gate_values)
        ),
    }


def _canonical_json(value: Any) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode()


def publish_update_review(
    document: dict[str, Any],
    output_path: str | Path,
) -> dict[str, Any]:
    if document.get("schema_version") != REVIEW_SCHEMA:
        raise ValueError("unsupported Ledger update review schema")
    output = Path(output_path)
    if output.exists():
        raise FileExistsError(f"Ledger update review already exists: {output}")
    review_hash = hashlib.sha256(_canonical_json(document)).hexdigest()
    review_id = "ledger-review-" + review_hash[:24]
    published = {**document, "review_id": review_id}
    review_bytes = _canonical_json(published)
    manifest = {
        "schema_version": REVIEW_MANIFEST_SCHEMA,
        "review_id": review_id,
        "from_snapshot": document["from_snapshot"],
        "to_snapshot": document["to_snapshot"],
        "review_sha256": hashlib.sha256(review_bytes).hexdigest(),
    }
    output.mkdir(parents=True)
    (output / "review.json").write_bytes(review_bytes)
    (output / "review_manifest.json").write_bytes(_canonical_json(manifest))
    return manifest


def validate_snapshot_compatibility(
    snapshot_path: str | Path,
) -> dict[str, Any]:
    facts, manifest = load_snapshot_facts(snapshot_path)
    consumer_schema = manifest.get("consumer_schema_version")
    if consumer_schema != CONSUMER_SCHEMA:
        raise ValueError(
            "unsupported Ledger consumer schema: "
            f"{consumer_schema!r}; expected {CONSUMER_SCHEMA!r}"
        )
    if not str(manifest.get("snapshot_id", "")).startswith("ledger-"):
        raise ValueError("Ledger snapshot ID is missing or malformed")
    return {
        "snapshot_id": manifest["snapshot_id"],
        "fact_count": len(facts),
        "consumer_schema_version": consumer_schema,
        "normalized_facts_sha256": manifest.get("normalized_facts_sha256"),
    }


def _plan_for_facts(
    overview: IntegrationOverview,
    mappings: MappingRegistry,
    facts: tuple[FactContract, ...],
) -> SourcePlan:
    policy = overview.alignment_policy
    if not policy.get("evaluate_transformed_facts"):
        return SourcePlan(overview.source, mappings)
    source_years = policy.get("source_years")
    build_year = policy.get("build_year")
    if not isinstance(source_years, list) or not all(
        isinstance(year, int) for year in source_years
    ):
        raise ValueError(
            f"integration {overview.integration_id} alignment source_years are invalid"
        )
    if not isinstance(build_year, int):
        raise ValueError(
            f"integration {overview.integration_id} alignment build_year is invalid"
        )
    aging_policy = MicrocosmAgingPolicy.from_facts(facts)
    declarations = []
    for source_year in source_years:
        results = transform_ledger_facts_to_microcosm_year(
            facts,
            aging_policy,
            source_year=source_year,
            build_year=build_year,
        )
        declarations.extend(
            result.to_alignment_declaration(overview.source.source_id)
            for result in results
            if result.comparable
        )
    return SourcePlan(overview.source, mappings, tuple(declarations))


def compile_update_review(
    from_snapshot_path: str | Path,
    to_snapshot_path: str | Path,
    integration_paths: Iterable[str | Path],
) -> dict[str, Any]:
    """Build the review gate before any run adopts a new Ledger snapshot."""

    old_compatibility = validate_snapshot_compatibility(from_snapshot_path)
    new_compatibility = validate_snapshot_compatibility(to_snapshot_path)
    old_facts, old_manifest = load_snapshot_facts(from_snapshot_path)
    new_facts, new_manifest = load_snapshot_facts(to_snapshot_path)
    diff = diff_snapshots(from_snapshot_path, to_snapshot_path)
    reviews: list[SourceUpdateReview] = []
    gates: list[VerificationGate] = []
    for path_value in integration_paths:
        path = Path(path_value)
        overview_path = path / "overview.yaml" if path.is_dir() else path
        overview = load_integration_overview(overview_path)
        integration = overview_path.parent
        if overview.ledger_snapshot_id != old_manifest["snapshot_id"]:
            raise ValueError(
                f"integration {overview.integration_id} is pinned to "
                f"{overview.ledger_snapshot_id}, not review baseline "
                f"{old_manifest['snapshot_id']}"
            )
        mappings = MappingRegistry.from_yaml(integration / "mappings.yaml")
        old_plan = _plan_for_facts(overview, mappings, old_facts)
        new_plan = _plan_for_facts(overview, mappings, new_facts)
        reviews.append(
            review_source_update(
                old_facts,
                new_facts,
                old_plan=old_plan,
                new_plan=new_plan,
                from_snapshot=old_manifest["snapshot_id"],
                to_snapshot=new_manifest["snapshot_id"],
            )
        )
        gates.append(
            verification_gate(
                overview,
                new_facts,
                plan=new_plan,
                snapshot_id=new_manifest["snapshot_id"],
            )
        )
    document = build_update_review_document(diff, reviews, gates)
    document["snapshot_compatibility"] = {
        "from": old_compatibility,
        "to": new_compatibility,
    }
    return document
