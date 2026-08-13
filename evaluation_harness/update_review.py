from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable, Literal

import yaml

from .adapters.microcosm import (
    MICROCOSM_RELEASE,
    verify_release_calibration_diagnostics,
)
from .contracts import CapabilityResult, ExecutionMethod, FactContract
from .full_run import SourcePlan, build_full_capability_matrix, load_snapshot_facts
from .integration import IntegrationOverview
from .integration import load_integration_overview
from .mappings import MappingRegistry
from .microcosm_aging import (
    MicrocosmAgingPolicy,
    transform_chronicle_facts_to_microcosm_year,
)
from .microcosm_release_targets import (
    compile_release_target_alignments,
    release_target_capability_specs,
)
from .snapshot import CONSUMER_SCHEMA, SnapshotDiff, diff_snapshots
from .yale_reconstruction_checkpoint import (
    YaleReconstructionCheckpoint,
    load_yale_reconstruction_checkpoint,
    yale_checkpoint_capability_specs,
)


REVIEW_SCHEMA = "evaluation_harness.chronicle_update_review.v2"
REVIEW_MANIFEST_SCHEMA = "evaluation_harness.chronicle_update_review_manifest.v2"


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
    *,
    require_all_precomputed_specs: bool = True,
) -> dict[str, CapabilityResult]:
    return {
        capability.fact_key: capability
        for capability in build_full_capability_matrix(
            facts,
            (plan,),
            snapshot_id=snapshot_id,
            require_all_precomputed_specs=require_all_precomputed_specs,
        )
    }


def _result_capable(capability: CapabilityResult | None) -> bool:
    return (
        capability is not None
        and capability.execution_method is not ExecutionMethod.NONE
    )


def _query_executable(capability: CapabilityResult | None) -> bool:
    return bool(
        capability is not None
        and capability.execution_method
        in {ExecutionMethod.DIRECT, ExecutionMethod.MODEL}
    )


def _execution_signature(capability: CapabilityResult) -> tuple[Any, ...]:
    return (
        capability.execution_method,
        capability.query,
        capability.population_period,
        capability.policy_period,
        capability.required_variables,
        capability.weight_variable,
        capability.geography_method,
    )


def _precomputed_materialization_signature(
    capability: CapabilityResult,
) -> tuple[Any, ...]:
    return (
        capability.execution_method,
        capability.mapping_release,
        capability.mapping_id,
        capability.population_period,
        capability.policy_period,
        capability.geography_method,
    )


def _scoring_signature(capability: CapabilityResult) -> tuple[Any, ...]:
    return (
        capability.mapping_quality,
        capability.period_treatment,
        capability.alignment_id,
        capability.alignment_quality,
        capability.calibration_exposure,
        capability.score_eligible,
    )


def _source_signature(plan: SourcePlan) -> tuple[Any, ...]:
    source = plan.source
    return (
        source.source_type,
        source.dataset_version,
        source.model_version,
        tuple(sorted(source.jurisdictions)),
        source.population_period,
        source.policy_period,
        tuple(sorted(source.native_fact_periods)),
        tuple(sorted(source.advanced_fact_periods)),
        tuple(sorted(source.geographies)),
        tuple(sorted(source.entities)),
        tuple(sorted(source.weights.items())),
        tuple(sorted(source.geography_methods.items())),
        tuple(sorted(source.geography_id_prefixes.items())),
        tuple(sorted(source.geography_id_methods.items())),
        source.execution_year_from_fact,
        source.available,
    )


def _plan_signature(plan: SourcePlan) -> tuple[Any, ...]:
    return (
        _source_signature(plan),
        plan.mappings.to_data(),
        plan.alignments,
        plan.calibration_exposures,
        plan.precomputed_capabilities,
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
    source_changes_requiring_execution: tuple[str, ...]
    source_changes_requiring_materialization: tuple[str, ...]
    execution_changes: tuple[str, ...]
    precomputed_materialization_changes: tuple[str, ...]
    scoring_changes_requiring_rescore: tuple[str, ...]
    value_changes_requiring_rescore: tuple[str, ...]
    requires_classification: bool
    requires_execution: bool
    requires_precomputed_materialization: bool
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
    materialization_changes: list[str] = []
    source_execution_changes: list[str] = []
    source_materialization_changes: list[str] = []
    scoring_changes: list[str] = []
    value_changes: list[str] = []
    source_changed = _source_signature(old_plan) != _source_signature(new_plan)

    for old_fact, new_fact in pairs:
        identity = _review_identity(old_fact, new_fact, duplicate_semantics)
        old_capability = (
            old_capabilities.get(old_fact.fact_key) if old_fact else None
        )
        new_capability = (
            new_capabilities.get(new_fact.fact_key) if new_fact else None
        )
        old_exec = _result_capable(old_capability)
        new_exec = _result_capable(new_capability)
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
            assert new_capability is not None
            newly_executable.append(identity)
            if new_capability.execution_method is ExecutionMethod.PRECOMPUTED:
                materialization_changes.append(identity)
            else:
                execution_changes.append(identity)
        elif old_exec and new_exec:
            assert old_capability is not None and new_capability is not None
            if source_changed:
                if new_capability.execution_method is ExecutionMethod.PRECOMPUTED:
                    source_materialization_changes.append(identity)
                elif _query_executable(new_capability):
                    source_execution_changes.append(identity)
            elif (
                new_capability.execution_method is ExecutionMethod.PRECOMPUTED
                and _precomputed_materialization_signature(old_capability)
                != _precomputed_materialization_signature(new_capability)
            ):
                materialization_changes.append(identity)
            elif _execution_signature(old_capability) != _execution_signature(
                new_capability
            ):
                if new_capability.execution_method is ExecutionMethod.PRECOMPUTED:
                    materialization_changes.append(identity)
                elif _query_executable(new_capability):
                    execution_changes.append(identity)
            if (
                not source_changed
                and _scoring_signature(old_capability)
                != _scoring_signature(new_capability)
            ):
                scoring_changes.append(identity)
            if (
                old_fact is not None
                and new_fact is not None
                and old_fact.value != new_fact.value
            ):
                value_changes.append(identity)

    changed_snapshot = from_snapshot != to_snapshot
    plan_changed = _plan_signature(old_plan) != _plan_signature(new_plan)
    requires_execution = bool(execution_changes or source_execution_changes)
    requires_materialization = bool(
        materialization_changes or source_materialization_changes
    )
    requires_rescore = (
        requires_execution
        or requires_materialization
        or bool(scoring_changes)
        or bool(value_changes)
        or bool(retired_executable)
    )
    return SourceUpdateReview(
        source_id=old_plan.source.source_id,
        from_snapshot=from_snapshot,
        to_snapshot=to_snapshot,
        old_fact_count=len(old_values),
        new_fact_count=len(new_values),
        old_executable_count=sum(map(_result_capable, old_capabilities.values())),
        new_executable_count=sum(map(_result_capable, new_capabilities.values())),
        mapping_regressions=tuple(regressions),
        newly_executable=tuple(newly_executable),
        retired_executable=tuple(retired_executable),
        source_changes_requiring_execution=tuple(
            sorted(set(source_execution_changes))
        ),
        source_changes_requiring_materialization=tuple(
            sorted(set(source_materialization_changes))
        ),
        execution_changes=tuple(sorted(set(execution_changes))),
        precomputed_materialization_changes=tuple(
            sorted(set(materialization_changes))
        ),
        scoring_changes_requiring_rescore=tuple(
            sorted(set(scoring_changes))
        ),
        value_changes_requiring_rescore=tuple(value_changes),
        requires_classification=changed_snapshot or plan_changed,
        requires_execution=requires_execution,
        requires_precomputed_materialization=requires_materialization,
        requires_rescore=requires_rescore,
        requires_publish=(
            changed_snapshot
            or plan_changed
            or bool(regressions)
            or bool(newly_executable)
            or bool(retired_executable)
            or bool(value_changes)
        ),
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
    capabilities = _classify(
        candidates.values(),
        plan,
        snapshot_id,
        require_all_precomputed_specs=False,
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
        capability = capabilities[fact.fact_key]
        if _result_capable(capability) and capability.score_eligible:
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
    action: Literal[
        "classify", "execute", "materialize", "rescore", "publish"
    ],
) -> tuple[str, ...]:
    attribute = {
        "classify": "requires_classification",
        "execute": "requires_execution",
        "materialize": "requires_precomputed_materialization",
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
            for action in (
                "classify",
                "execute",
                "materialize",
                "rescore",
                "publish",
            )
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
        raise ValueError("unsupported Chronicle update review schema")
    output = Path(output_path)
    if output.exists():
        raise FileExistsError(f"Chronicle update review already exists: {output}")
    review_hash = hashlib.sha256(_canonical_json(document)).hexdigest()
    review_id = "chronicle-review-" + review_hash[:24]
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
            "unsupported Chronicle consumer schema: "
            f"{consumer_schema!r}; expected {CONSUMER_SCHEMA!r}"
        )
    if not str(manifest.get("snapshot_id", "")).startswith("chronicle-"):
        raise ValueError("Chronicle snapshot ID is missing or malformed")
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
    *,
    microcosm_calibration_diagnostics: Path | None = None,
    yale_checkpoint: YaleReconstructionCheckpoint | None = None,
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
    aging_policy = MicrocosmAgingPolicy.from_facts(
        facts,
        release_diagnostics_path=microcosm_calibration_diagnostics,
    )
    declarations = []
    aligned_facts = []
    for source_year in source_years:
        results = transform_chronicle_facts_to_microcosm_year(
            facts,
            aging_policy,
            source_year=source_year,
            build_year=build_year,
        )
        comparable = tuple(result for result in results if result.comparable)
        declarations.extend(
            result.to_alignment_declaration(overview.source.source_id)
            for result in comparable
        )
        aligned_facts.extend(result.to_aligned_fact() for result in comparable)

    precomputed = ()
    if overview.integration_id == "microcosm_policyengine_us_2024":
        if microcosm_calibration_diagnostics is None:
            raise ValueError(
                "Microcosm update review requires pinned calibration diagnostics"
            )
        release_targets = compile_release_target_alignments(
            facts,
            microcosm_calibration_diagnostics,
            source_id=overview.source.source_id,
            release_id=MICROCOSM_RELEASE.release_id,
        )
        exact_keys = {
            fact.source_fact_key for fact in release_targets.aligned_facts
        }
        declarations = [
            *release_targets.declarations,
            *(
                declaration
                for declaration in declarations
                if declaration.fact_key not in exact_keys
            ),
        ]
        precomputed = release_target_capability_specs(
            release_targets,
            source_id=overview.source.source_id,
            population_period=overview.source.population_period,
            policy_period=overview.source.policy_period,
        )
    elif overview.integration_id == "yale_reconstruction_2024":
        if microcosm_calibration_diagnostics is None:
            raise ValueError(
                "Yale update review requires pinned Microcosm calibration "
                "diagnostics for its approved pre-2024 alignments"
            )
        if yale_checkpoint is None:
            raise ValueError("Yale update review requires its pinned checkpoint")
        release_targets = compile_release_target_alignments(
            facts,
            microcosm_calibration_diagnostics,
            source_id=overview.source.source_id,
            release_id=MICROCOSM_RELEASE.release_id,
        )
        exact_keys = {
            fact.source_fact_key for fact in release_targets.aligned_facts
        }
        declarations = [
            *release_targets.declarations,
            *(
                declaration
                for declaration in declarations
                if declaration.fact_key not in exact_keys
            ),
        ]
        aligned_facts = [
            *release_targets.aligned_facts,
            *(
                alignment
                for alignment in aligned_facts
                if alignment.source_fact_key not in exact_keys
            ),
        ]
        precomputed = yale_checkpoint_capability_specs(
            facts,
            yale_checkpoint,
            aligned_facts=aligned_facts,
            source=overview.source,
        )
    return SourcePlan(
        overview.source,
        mappings,
        tuple(declarations),
        precomputed_capabilities=precomputed,
    )


def _load_yale_checkpoint(
    overview: IntegrationOverview,
) -> YaleReconstructionCheckpoint:
    payload = yaml.safe_load(overview.overview_path.read_text())
    reconstruction = payload.get("reconstruction", {})
    repository_root = overview.overview_path.parents[2]
    return load_yale_reconstruction_checkpoint(
        repository_root / reconstruction["aggregate_reconstruction_file"],
        overview.overview_path.parent / reconstruction["checkpoint_mapping_file"],
    )


def compile_update_review(
    from_snapshot_path: str | Path,
    to_snapshot_path: str | Path,
    integration_paths: Iterable[str | Path],
    *,
    microcosm_calibration_diagnostics: str | Path | None = None,
) -> dict[str, Any]:
    """Build the review gate before any run adopts a new Chronicle snapshot."""

    old_compatibility = validate_snapshot_compatibility(from_snapshot_path)
    new_compatibility = validate_snapshot_compatibility(to_snapshot_path)
    old_facts, old_manifest = load_snapshot_facts(from_snapshot_path)
    new_facts, new_manifest = load_snapshot_facts(to_snapshot_path)
    diff = diff_snapshots(from_snapshot_path, to_snapshot_path)
    reviews: list[SourceUpdateReview] = []
    gates: list[VerificationGate] = []
    diagnostics_path = None
    if microcosm_calibration_diagnostics is not None:
        diagnostics_path = verify_release_calibration_diagnostics(
            Path(microcosm_calibration_diagnostics),
            MICROCOSM_RELEASE,
        )
    for path_value in integration_paths:
        path = Path(path_value)
        overview_path = path / "overview.yaml" if path.is_dir() else path
        overview = load_integration_overview(overview_path)
        integration = overview_path.parent
        if overview.chronicle_snapshot_id != old_manifest["snapshot_id"]:
            raise ValueError(
                f"integration {overview.integration_id} is pinned to "
                f"{overview.chronicle_snapshot_id}, not review baseline "
                f"{old_manifest['snapshot_id']}"
            )
        mappings = MappingRegistry.from_yaml(integration / "mappings.yaml")
        yale_checkpoint = (
            _load_yale_checkpoint(overview)
            if overview.integration_id == "yale_reconstruction_2024"
            else None
        )
        old_plan = _plan_for_facts(
            overview,
            mappings,
            old_facts,
            microcosm_calibration_diagnostics=diagnostics_path,
            yale_checkpoint=yale_checkpoint,
        )
        new_plan = _plan_for_facts(
            overview,
            mappings,
            new_facts,
            microcosm_calibration_diagnostics=diagnostics_path,
            yale_checkpoint=yale_checkpoint,
        )
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
