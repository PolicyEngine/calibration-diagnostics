from __future__ import annotations

import hashlib
import json
import math
from collections import Counter
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable

from .contracts import CalibrationExposure, PeriodTreatment
from .full_run import (
    exclude_facts_with_geography_ids,
    load_snapshot_facts,
    scope_facts_to_jurisdictions,
)
from .publisher import RUN_SCHEMA
from .scoring import ScoreObservation, build_group_score


FRONTEND_BUNDLE_SCHEMA = "cross_dataset.frontend_bundle.v1"
WITHIN_BOUNDS_RELATIVE_ERROR = Decimal("0.10")
FAR_OUTSIDE_BOUNDS_RELATIVE_ERROR = Decimal("0.25")

DEFAULT_SOURCE_LABELS = {
    "census_acs_pums_2024": "Raw ACS PUMS",
    # Deprecated artifact identifier: evaluation bundle v1 retains the former
    # Populace source ID while the UI labels it Microcosm.
    "populace_us_policyengine_us_2024": "Microcosm + PolicyEngine-US",
    "taxcalc_public_cps_2024": "Public CPS + Tax-Calculator",
    "yale_reconstruction_2024": (
        "Yale Tax-Data + Tax-Simulator (reconstruction)"
    ),
}


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _document(value: dict[str, Any]) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode()


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text().splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(f"invalid JSON in {path.name} line {line_number}") from error
        if not isinstance(row, dict):
            raise ValueError(f"non-object row in {path.name} line {line_number}")
        rows.append(row)
    return rows


def _verify_run_artifact(run_path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    manifest = json.loads((run_path / "run_manifest.json").read_text())
    if manifest.get("schema_version") != RUN_SCHEMA:
        raise ValueError(f"unsupported evaluation run schema: {manifest.get('schema_version')!r}")
    files = {
        "capabilities.jsonl": "capabilities_sha256",
        "estimates.jsonl": "estimates_sha256",
        "alignments.jsonl": "alignments_sha256",
        "scores.jsonl": "scores_sha256",
        "summary.json": "summary_sha256",
    }
    for filename, hash_field in files.items():
        path = run_path / filename
        if not path.is_file():
            raise ValueError(f"evaluation run is missing {filename}")
        actual = _sha256(path.read_bytes())
        if actual != manifest.get(hash_field):
            raise ValueError(f"evaluation run hash mismatch for {filename}")
    summary = json.loads((run_path / "summary.json").read_text())
    if summary.get("matrix_complete") is not True:
        raise ValueError("evaluation run capability matrix is incomplete")
    return manifest, summary


def _facts_in_run_scope(
    facts: tuple[Any, ...], run_summary: dict[str, Any]
) -> tuple[Any, ...]:
    scope = run_summary.get("evaluation_scope")
    if scope is None:
        return facts
    if not isinstance(scope, dict):
        raise ValueError("evaluation run has a malformed evaluation_scope")
    jurisdictions = scope.get("jurisdictions")
    if (
        not isinstance(jurisdictions, list)
        or not jurisdictions
        or any(not isinstance(value, str) or not value for value in jurisdictions)
    ):
        raise ValueError("evaluation run has no explicit jurisdiction scope")
    if scope.get("source_snapshot_fact_count") != len(facts):
        raise ValueError("evaluation scope source fact count does not match snapshot")
    jurisdiction_scoped = scope_facts_to_jurisdictions(facts, jurisdictions)
    excluded_geography_ids = scope.get("excluded_geography_ids", [])
    if (
        not isinstance(excluded_geography_ids, list)
        or any(
            not isinstance(value, str) or not value
            for value in excluded_geography_ids
        )
    ):
        raise ValueError("evaluation run has malformed excluded geography IDs")
    scoped = exclude_facts_with_geography_ids(
        jurisdiction_scoped, excluded_geography_ids
    )
    excluded_geography_count = len(jurisdiction_scoped) - len(scoped)
    declared_geography_count = scope.get("excluded_geography_fact_count")
    if (
        declared_geography_count is not None
        and declared_geography_count != excluded_geography_count
    ):
        raise ValueError(
            "evaluation scope excluded geography fact count does not reconcile"
        )
    declared_non_us_count = scope.get("excluded_non_us_fact_count")
    if (
        declared_non_us_count is not None
        and declared_non_us_count != len(facts) - len(jurisdiction_scoped)
    ):
        raise ValueError(
            "evaluation scope excluded non-US fact count does not reconcile"
        )
    if scope.get("included_fact_count") != len(scoped):
        raise ValueError("evaluation scope included fact count does not reconcile")
    if scope.get("excluded_fact_count") != len(facts) - len(scoped):
        raise ValueError("evaluation scope excluded fact count does not reconcile")
    return scoped


def _canonical_period(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, dict) and isinstance(value.get("kind"), str) and isinstance(
        value.get("value"), str
    ):
        return f"{value['kind']}:{value['value']}"
    raise ValueError(f"malformed typed period: {value!r}")


def _source_versions(
    rows: Iterable[dict[str, Any]], source_id: str
) -> tuple[str | None, str | None]:
    source_rows = [row for row in rows if row.get("source_id") == source_id]
    datasets = sorted(
        {str(row["dataset_version"]) for row in source_rows if row.get("dataset_version")}
    )
    models = sorted(
        {str(row["model_version"]) for row in source_rows if row.get("model_version")}
    )
    if len(datasets) > 1 or len(models) > 1:
        raise ValueError(f"source {source_id} has multiple dataset/model versions")
    return (datasets[0] if datasets else None, models[0] if models else None)


def _source_cell(
    capability: dict[str, Any],
    result: dict[str, Any] | None,
    score: dict[str, Any] | None,
    alignment: dict[str, Any] | None,
) -> dict[str, Any]:
    cell: dict[str, Any] = {
        "status": capability["status"],
        "reason_code": capability.get("reason_code"),
        "reason_detail": capability.get("reason_detail"),
        "execution_method": capability["execution_method"],
        "mapping_id": capability.get("mapping_id"),
        "mapping_quality": capability["mapping_quality"],
        "period_treatment": capability["period_treatment"],
        "calibration_exposure": capability["calibration_exposure"],
        "score_eligible": capability["score_eligible"],
        "population_period": _canonical_period(capability.get("population_period")),
        "policy_period": _canonical_period(capability.get("policy_period")),
        "required_variables": capability.get("required_variables", []),
    }
    if result is not None:
        cell.update(
            {
                "estimate": result["estimate"],
                "dataset_version": result.get("dataset_version"),
                "model_version": result.get("model_version"),
                "standard_error": result.get("standard_error"),
                "margin_of_error_90": result.get("margin_of_error_90"),
                "estimate_basis": result.get("estimate_basis"),
            }
        )
    if score is not None:
        cell.update(
            {
                "benchmark_value": score["benchmark_value"],
                "benchmark_period": _canonical_period(score["benchmark_period"]),
                "benchmark_basis": score["benchmark_basis"],
                "absolute_relative_error": score.get("absolute_relative_error"),
            }
        )
    if alignment is not None:
        cell["alignment"] = alignment
    return {
        key: value
        for key, value in cell.items()
        if value is not None and value != [] and value != {}
    }


def _fact_row(
    fact: Any,
    source_ids: list[str],
    capabilities: dict[tuple[str, str], dict[str, Any]],
    results: dict[tuple[str, str], dict[str, Any]],
    scores: dict[tuple[str, str], dict[str, Any]],
    alignments: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    cells: dict[str, Any] = {}
    for source_id in source_ids:
        capability = capabilities[(source_id, fact.fact_key)]
        result = results.get((source_id, fact.fact_key))
        score = scores.get((source_id, fact.fact_key))
        alignment = alignments.get(capability.get("alignment_id") or "")
        cells[source_id] = _source_cell(capability, result, score, alignment)
    source_metadata = fact.source_metadata
    lineage = fact.lineage
    provenance = {
        "provenance_class": fact.provenance_class,
        "semantic_fact_key": fact.semantic_fact_key,
        "source_record_id": lineage.get("source_record_id"),
        "source_cell_keys": lineage.get("source_cell_keys", []),
        "source_row_keys": lineage.get("source_row_keys", []),
        "url": source_metadata.get("url"),
        "source_table": source_metadata.get("source_table"),
        "source_sha256": source_metadata.get("source_sha256"),
        "vintage": source_metadata.get("vintage"),
        "raw_r2_uri": source_metadata.get("raw_r2_uri"),
        "aggregation": fact.aggregation,
        "observed_measure": fact.observed_measure,
    }
    return {
        "fact_key": fact.fact_key,
        "label": fact.label or fact.fact_key,
        "ledger_source": fact.source,
        "measure": fact.measure,
        "unit": fact.unit,
        "observed_period": fact.period.canonical,
        "observed_value": str(fact.value),
        "geography_level": fact.geography_level,
        "geography_id": fact.geography_id,
        "entity": fact.entity,
        "dimensions": fact.dimensions,
        "universe_constraints": list(fact.universe_constraints),
        "provenance": {
            key: value
            for key, value in provenance.items()
            if value is not None and value != [] and value != {}
        },
        "sources": cells,
    }


def _display_label(value: str) -> str:
    return value.replace("_", " ").replace(".", " / ").title()


def _score_for_group(
    source_scores: list[dict[str, Any]], fact_keys: set[str]
) -> tuple[int, int, str | None, str | None]:
    observations = [
        ScoreObservation(
            fact_key=row["fact_key"],
            benchmark=Decimal(row["benchmark_value"]),
            estimate=Decimal(row["estimate"]),
            family=row["family"],
            period_treatment=PeriodTreatment(row["period_treatment"]),
            calibration_exposure=CalibrationExposure(row["calibration_exposure"]),
            score_eligible=bool(row["score_eligible"]),
        )
        for row in source_scores
        if row["fact_key"] in fact_keys
    ]
    score = build_group_score(observations)
    return (
        score.scored,
        score.relative_error_count,
        str(score.display_score) if score.display_score is not None else None,
        str(score.loss) if score.loss is not None else None,
    )


def _performance_buckets(
    source_scores: list[dict[str, Any]],
    fact_keys: set[str],
    *,
    total: int,
) -> dict[str, int]:
    """Classify every target into stable relative-error display bands."""

    counts = {
        "within_bounds": 0,
        "outside_bounds": 0,
        "far_outside_bounds": 0,
    }
    seen: set[str] = set()
    for row in source_scores:
        fact_key = str(row["fact_key"])
        if fact_key not in fact_keys or not row.get("score_eligible"):
            continue
        value = row.get("absolute_relative_error")
        if value is None:
            continue
        if fact_key in seen:
            raise ValueError(f"duplicate score row for performance bucket: {fact_key}")
        seen.add(fact_key)
        error = Decimal(str(value))
        if not error.is_finite() or error < 0:
            raise ValueError(f"invalid absolute relative error for {fact_key}: {value}")
        if error <= WITHIN_BOUNDS_RELATIVE_ERROR:
            counts["within_bounds"] += 1
        elif error <= FAR_OUTSIDE_BOUNDS_RELATIVE_ERROR:
            counts["outside_bounds"] += 1
        else:
            counts["far_outside_bounds"] += 1
    classified = sum(counts.values())
    if classified > total:
        raise ValueError("performance bucket counts exceed the target total")
    return {
        **counts,
        "unavailable": total - classified,
        "total": total,
    }


def _build_groups(
    facts: Iterable[Any],
    source_ids: list[str],
    capabilities: list[dict[str, Any]],
    scores: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    fact_values = tuple(facts)
    definitions = {
        "ledger_source": lambda fact: fact.source,
        "concept": lambda fact: fact.measure,
        "period": lambda fact: fact.period.canonical,
        "geography": lambda fact: fact.geography_level,
    }
    capabilities_by_source = {
        source_id: [row for row in capabilities if row["source_id"] == source_id]
        for source_id in source_ids
    }
    scores_by_source = {
        source_id: [row for row in scores if row["source_id"] == source_id]
        for source_id in source_ids
    }

    def common_fact_set_sources(fact_keys: set[str]) -> dict[str, Any]:
        """Score every source on one shared, source-independent fact set."""

        source_values: dict[str, Any] = {}
        for source_id in source_ids:
            cells = [
                row
                for row in capabilities_by_source[source_id]
                if row["fact_key"] in fact_keys
            ]
            scored, relative_error_count, display_score, loss = _score_for_group(
                scores_by_source[source_id], fact_keys
            )
            source_values[source_id] = {
                "evaluable": sum(row["execution_method"] != "none" for row in cells),
                "scored": scored,
                "relative_error_count": relative_error_count,
                "display_score": display_score,
                "loss": loss,
                "performance_buckets": _performance_buckets(
                    scores_by_source[source_id],
                    fact_keys,
                    total=len(fact_keys),
                ),
                "reason_codes": dict(
                    sorted(
                        Counter(
                            row["reason_code"]
                            for row in cells
                            if row.get("reason_code")
                        ).items()
                    )
                ),
            }
        return source_values

    groups: list[dict[str, Any]] = []
    for dimension, key_for in definitions.items():
        grouped: dict[str, set[str]] = {}
        for fact in fact_values:
            grouped.setdefault(str(key_for(fact)), set()).add(fact.fact_key)
        for key, fact_keys in sorted(grouped.items()):
            source_values: dict[str, Any] = {}
            for source_id in source_ids:
                cells = [
                    row
                    for row in capabilities_by_source[source_id]
                    if row["fact_key"] in fact_keys
                ]
                scored, relative_error_count, display_score, loss = _score_for_group(
                    scores_by_source[source_id], fact_keys
                )
                source_values[source_id] = {
                    "evaluable": sum(row["execution_method"] != "none" for row in cells),
                    "scored": scored,
                    "relative_error_count": relative_error_count,
                    "display_score": display_score,
                    "loss": loss,
                    "performance_buckets": _performance_buckets(
                        scores_by_source[source_id],
                        fact_keys,
                        total=len(fact_keys),
                    ),
                    "reason_codes": dict(
                        sorted(
                            Counter(
                                row["reason_code"]
                                for row in cells
                                if row.get("reason_code")
                            ).items()
                        )
                    ),
                }
            groups.append(
                {
                    "dimension": dimension,
                    "key": key,
                    "label": _display_label(key),
                    "fact_count": len(fact_keys),
                    "sources": source_values,
                }
            )
    microcosm_source_ids = [
        source_id
        for source_id in source_ids
        if any(name in source_id.lower() for name in ("populace", "microcosm"))
    ]
    if len(microcosm_source_ids) != 1:
        raise ValueError(
            "frontend bundle requires exactly one Microcosm source to define the "
            "shared calibration sample"
        )
    microcosm_source_id = microcosm_source_ids[0]
    all_fact_keys = {fact.fact_key for fact in fact_values}
    in_sample_fact_keys = {
        row["fact_key"]
        for row in capabilities_by_source[microcosm_source_id]
        if row.get("calibration_exposure") == "direct_calibration_target"
    }
    sample_fact_keys = {
        "in_sample": in_sample_fact_keys,
        "out_of_sample": all_fact_keys - in_sample_fact_keys,
    }
    # Deprecated artifact identifier: bundle v1 names the Microcosm calibration
    # partition with the former Populace product name.
    for sample, fact_keys in sample_fact_keys.items():
        groups.append(
            {
                "dimension": "populace_calibration_sample",
                "key": sample,
                "label": _display_label(sample),
                "fact_count": len(fact_keys),
                "sources": common_fact_set_sources(fact_keys),
            }
        )
    for dimension, capability_field in (
        ("period_treatment", "period_treatment"),
        ("calibration_exposure", "calibration_exposure"),
    ):
        keys = sorted(
            {
                str(row[capability_field])
                for row in capabilities
                if row.get(capability_field)
            }
        )
        for key in keys:
            fact_keys = {
                row["fact_key"]
                for row in capabilities
                if row.get(capability_field) == key
            }
            source_values: dict[str, Any] = {}
            for source_id in source_ids:
                cells = [
                    row
                    for row in capabilities_by_source[source_id]
                    if row.get(capability_field) == key
                ]
                source_fact_keys = {row["fact_key"] for row in cells}
                scored, relative_error_count, display_score, loss = _score_for_group(
                    scores_by_source[source_id], source_fact_keys
                )
                source_values[source_id] = {
                    "evaluable": sum(row["execution_method"] != "none" for row in cells),
                    "scored": scored,
                    "relative_error_count": relative_error_count,
                    "display_score": display_score,
                    "loss": loss,
                    "performance_buckets": _performance_buckets(
                        scores_by_source[source_id],
                        source_fact_keys,
                        total=len(cells),
                    ),
                    "reason_codes": dict(
                        sorted(
                            Counter(
                                row["reason_code"]
                                for row in cells
                                if row.get("reason_code")
                            ).items()
                        )
                    ),
                }
            groups.append(
                {
                    "dimension": dimension,
                    "key": key,
                    "label": _display_label(key),
                    "fact_count": len(fact_keys),
                    "sources": source_values,
                }
            )
    geography_by_fact_key = {
        fact.fact_key: fact.geography_level for fact in fact_values
    }
    geographies = sorted(set(geography_by_fact_key.values()))
    for geography in geographies:
        geography_fact_keys = {
            fact_key
            for fact_key, level in geography_by_fact_key.items()
            if level == geography
        }
        for sample, fact_keys in sample_fact_keys.items():
            intersection = geography_fact_keys & fact_keys
            groups.append(
                {
                    "dimension": "geography_populace_calibration_sample",
                    "key": f"{geography}|{sample}",
                    "label": (
                        f"{_display_label(geography)} / "
                        f"{_display_label(sample)}"
                    ),
                    "fact_count": len(intersection),
                    "sources": common_fact_set_sources(intersection),
                }
            )
    exposures = sorted(
        {
            str(row["calibration_exposure"])
            for row in capabilities
            if row.get("calibration_exposure")
        }
    )
    for geography in geographies:
        for exposure in exposures:
            source_values: dict[str, Any] = {}
            group_fact_keys: set[str] = set()
            for source_id in source_ids:
                cells = [
                    row
                    for row in capabilities_by_source[source_id]
                    if geography_by_fact_key[row["fact_key"]] == geography
                    and row.get("calibration_exposure") == exposure
                ]
                source_fact_keys = {row["fact_key"] for row in cells}
                group_fact_keys.update(source_fact_keys)
                scored, relative_error_count, display_score, loss = _score_for_group(
                    scores_by_source[source_id], source_fact_keys
                )
                source_values[source_id] = {
                    "evaluable": sum(
                        row["execution_method"] != "none" for row in cells
                    ),
                    "scored": scored,
                    "relative_error_count": relative_error_count,
                    "display_score": display_score,
                    "loss": loss,
                    "performance_buckets": _performance_buckets(
                        scores_by_source[source_id],
                        source_fact_keys,
                        total=len(cells),
                    ),
                    "reason_codes": dict(
                        sorted(
                            Counter(
                                row["reason_code"]
                                for row in cells
                                if row.get("reason_code")
                            ).items()
                        )
                    ),
                }
            groups.append(
                {
                    "dimension": "geography_calibration_exposure",
                    "key": f"{geography}|{exposure}",
                    "label": (
                        f"{_display_label(geography)} / "
                        f"{_display_label(exposure)}"
                    ),
                    "fact_count": len(group_fact_keys),
                    "sources": source_values,
                }
            )
    return groups


def _write_partition(path: Path, value: dict[str, Any]) -> dict[str, str]:
    content = _document(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return {"path": path.as_posix(), "sha256": _sha256(content)}


def publish_frontend_bundle(
    snapshot_path: str | Path,
    run_path: str | Path,
    output_path: str | Path,
    *,
    page_size: int = 100,
    source_labels: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Publish deterministic, immutable JSON partitions consumed by the web API."""

    if page_size < 1 or page_size > 250:
        raise ValueError("frontend bundle page_size must be between 1 and 250")
    output = Path(output_path)
    if output.exists():
        raise FileExistsError(f"frontend bundle already exists: {output}")
    run = Path(run_path)
    run_manifest, run_summary = _verify_run_artifact(run)
    snapshot_facts, snapshot_manifest = load_snapshot_facts(snapshot_path)
    facts = _facts_in_run_scope(snapshot_facts, run_summary)
    snapshot_id = snapshot_manifest["snapshot_id"]
    if run_manifest.get("snapshot_ids") != [snapshot_id]:
        raise ValueError("evaluation run and Chronicle snapshot IDs do not match")
    if run_summary.get("fact_count") != len(facts):
        raise ValueError("evaluation run and Chronicle snapshot fact counts do not match")

    capabilities = _read_jsonl(run / "capabilities.jsonl")
    results = _read_jsonl(run / "estimates.jsonl")
    alignments_values = _read_jsonl(run / "alignments.jsonl")
    scores_values = _read_jsonl(run / "scores.jsonl")
    source_ids = sorted(str(source_id) for source_id in run_summary["sources"])
    expected_cells = len(facts) * len(source_ids)
    capability_by_cell = {
        (row["source_id"], row["fact_key"]): row for row in capabilities
    }
    if len(capabilities) != expected_cells or len(capability_by_cell) != expected_cells:
        raise ValueError("evaluation capability matrix does not cover every frontend cell")
    result_by_cell = {(row["source_id"], row["fact_key"]): row for row in results}
    score_by_cell = {
        (row["source_id"], row["fact_key"]): row for row in scores_values
    }
    alignment_by_id = {row["alignment_id"]: row for row in alignments_values}
    if len(alignment_by_id) != len(alignments_values):
        raise ValueError("evaluation run has duplicate alignment IDs")

    labels = {**DEFAULT_SOURCE_LABELS, **(source_labels or {})}
    source_summaries: list[dict[str, Any]] = []
    for source_id in source_ids:
        source_capabilities = [
            row for row in capabilities if row["source_id"] == source_id
        ]
        dataset_version, model_version = _source_versions(results, source_id)
        value = run_summary["sources"][source_id]
        source_summaries.append(
            {
                "source_id": source_id,
                "label": labels.get(source_id, _display_label(source_id)),
                "source_type": source_capabilities[0]["source_type"],
                "dataset_version": dataset_version,
                "model_version": model_version,
                "capability_count": value["capability_count"],
                "result_count": value["result_count"],
                "score": value["score"],
                "performance_buckets": _performance_buckets(
                    [row for row in scores_values if row["source_id"] == source_id],
                    {row["fact_key"] for row in source_capabilities},
                    total=len(source_capabilities),
                ),
                "capability_statuses": value["capability_statuses"],
                "reason_codes": value["reason_codes"],
                "period_treatments": value["period_treatments"],
            }
        )

    output.mkdir(parents=True)
    common = {
        "schema_version": FRONTEND_BUNDLE_SCHEMA,
        "run_id": run_manifest["run_id"],
        "snapshot_id": snapshot_id,
        "jurisdictions": sorted({fact.jurisdiction for fact in facts}),
    }
    summary_document = {
        **common,
        "fact_count": len(facts),
        "matrix_complete": True,
        "sources": source_summaries,
    }
    summary_partition = _write_partition(output / "summary.json", summary_document)

    groups_document = {
        **common,
        "groups": _build_groups(facts, source_ids, capabilities, scores_values),
    }
    groups_partition = _write_partition(output / "groups.json", groups_document)

    rows = [
        _fact_row(
            fact,
            source_ids,
            capability_by_cell,
            result_by_cell,
            score_by_cell,
            alignment_by_id,
        )
        for fact in sorted(facts, key=lambda item: item.fact_key)
    ]
    page_count = math.ceil(len(rows) / page_size)
    fact_partitions: list[dict[str, Any]] = []
    fact_index: dict[str, int] = {}
    facets: dict[str, Any] = {
        "ledger_source": {},
        "measure": {},
        "period": {},
        "geography": {},
        "source_status": {source_id: {} for source_id in source_ids},
        "source_period_treatment": {source_id: {} for source_id in source_ids},
        "source_calibration_exposure": {source_id: {} for source_id in source_ids},
    }

    def add_facet(dimension: str, key: str, page: int) -> None:
        values = facets[dimension].setdefault(key, [])
        if not values or values[-1] != page:
            values.append(page)

    for index in range(page_count):
        page = index + 1
        page_rows = rows[index * page_size : (index + 1) * page_size]
        for row in page_rows:
            fact_index[row["fact_key"]] = page
            add_facet("ledger_source", row["ledger_source"], page)
            add_facet("measure", row["measure"], page)
            add_facet("period", row["observed_period"], page)
            add_facet("geography", row["geography_level"], page)
            for source_id, cell in row["sources"].items():
                for facet, field in (
                    ("source_status", "status"),
                    ("source_period_treatment", "period_treatment"),
                    ("source_calibration_exposure", "calibration_exposure"),
                ):
                    values = facets[facet][source_id].setdefault(cell[field], [])
                    if not values or values[-1] != page:
                        values.append(page)
        relative = Path("facts") / f"{page:05d}.json"
        partition = _write_partition(
            output / relative,
            {
                **common,
                "page": page,
                "page_size": page_size,
                "total": len(rows),
                "rows": page_rows,
            },
        )
        partition["path"] = relative.as_posix()
        fact_partitions.append({"page": page, "count": len(page_rows), **partition})

    index_partition = _write_partition(
        output / "fact-index.json",
        {**common, "facts": fact_index, "facets": facets},
    )
    manifest = {
        **common,
        "fact_count": len(facts),
        "source_ids": source_ids,
        "page_size": page_size,
        "page_count": page_count,
        "source_run_schema": run_manifest["schema_version"],
        "source_run_hashes": {
            key: value for key, value in run_manifest.items() if key.endswith("_sha256")
        },
        "partitions": {
            "summary": {**summary_partition, "path": "summary.json"},
            "groups": {**groups_partition, "path": "groups.json"},
            "fact_index": {**index_partition, "path": "fact-index.json"},
            "facts": fact_partitions,
        },
    }
    (output / "manifest.json").write_bytes(_document(manifest))
    return manifest
