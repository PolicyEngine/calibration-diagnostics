"""The stored point: the contract with the TypeScript store.

A point is one data file measured on one panel. Its id hashes the panel id and
the file's sha256 only, so the same file published under two build names is one
point, and a file replaced under one build name is a new point.

A point holds only facts that cannot change after the measurement: ids,
statuses, cells, the disclosure block, the file's facts, where it was fetched
from, the engine bundle, the environment it ran in and the run's facts. Listing
facts (release and build names, publish time, `current`, withdrawn) live in the
country's series record. Every key is always present, null where it does not
apply; `schemas/point.schema.json` holds the shape.

`frontend/lib/microcosm/release-history-store.ts` (`MeasurementDocument`) reads
these documents to finalize a run and build each panel's timeline.
"""

from __future__ import annotations

from typing import Any

from release_history import POINT_FORMAT_VERSION, PRODUCER_VERSION
from release_history.canonical import json_sha256
from release_history.disclosure import apply_policy
from release_history.measure import Measurement
from release_history.spec import Spec

KIND = "release_history.measurement"


def measurement_id(panel_id: str, h5_sha256: str) -> str:
    """One data file on one panel."""
    return json_sha256({"panel_id": panel_id, "h5_sha256": h5_sha256})


def _point(
    *,
    spec: Spec,
    panel_id: str,
    h5_sha256: str,
    status: str,
    reason: str | None,
    provenance: dict[str, Any],
    env: dict[str, Any],
    producer_commit: str | None,
    runtime: dict[str, Any],
) -> dict[str, Any]:
    return {
        "format_version": POINT_FORMAT_VERSION,
        "kind": KIND,
        "country": spec.country,
        "panel_id": panel_id,
        "measurement_id": measurement_id(panel_id, h5_sha256),
        "status": status,
        "reason": reason,
        "fetched_from": provenance["fetched_from"],
        "file": provenance["file"],
        "data": None,
        "periods": [{"period": p, "label": spec.label_period(p)} for p in spec.periods],
        "baseline": None,
        "reforms": None,
        "cells": [],
        "disclosure": {
            "policy": spec.disclosure_policy,
            "min_source_households": spec.min_source_households,
            "withheld_cells": None,
        },
        "engine_bundle": None,
        "environment": env,
        "producer": {"version": PRODUCER_VERSION, "commit": producer_commit},
        "runtime": {
            "started_at": runtime.get("started_at"),
            "finished_at": runtime.get("finished_at"),
            "seconds": runtime.get("seconds"),
            "runner": runtime.get("runner"),
            "simulations": runtime.get("simulations") or [],
        },
    }


def _error(record: dict[str, Any] | None) -> dict[str, Any] | None:
    if record is None:
        return None
    return {key: record.get(key) for key in ("stage", "class", "name", "where")}


def _reform(record: dict[str, Any]) -> dict[str, Any]:
    """A reform's status, with every key present: `applied` is null for a reform whose
    definition failed, `error` is null for one that ran."""
    return {
        "status": record["status"],
        "definition_sha256": record.get("definition_sha256"),
        "applied": record.get("applied"),
        "error": _error(record.get("error")),
    }


def _bundle(bundle: dict[str, Any] | None) -> dict[str, Any]:
    bundle = bundle or {}
    return {key: bundle.get(key) for key in ("bundle_id", "capital_gains_responses")}


def measured_point(
    *,
    spec: Spec,
    panel_id: str,
    provenance: dict[str, Any],
    result: Measurement,
    source_ids: Any,
    columns: list[str],
    env: dict[str, Any],
    producer_commit: str | None,
    runtime: dict[str, Any],
) -> tuple[dict[str, Any], int]:
    """The spec's disclosure policy, then the stored document, with the number of cells
    withheld: what `release-history measure` writes for a measured file, and what the
    fixtures are made with."""
    withheld = apply_policy(
        spec.disclosure_policy,
        result.cells,
        result.tables,
        source_ids=source_ids,
        floor=spec.min_source_households,
    )
    document = measurement_document(
        spec=spec,
        panel_id=panel_id,
        provenance=provenance,
        result=result,
        columns=columns,
        withheld=withheld,
        env=env,
        producer_commit=producer_commit,
        runtime=runtime,
    )
    return document, withheld


def measurement_document(
    *,
    spec: Spec,
    panel_id: str,
    provenance: dict[str, Any],
    result: Measurement,
    columns: list[str],
    withheld: int,
    env: dict[str, Any],
    producer_commit: str | None,
    runtime: dict[str, Any],
) -> dict[str, Any]:
    """A measured file: `ok`, or `partial` when a reform failed on the last attempt."""
    known = set(result.model_variables)
    document = _point(
        spec=spec,
        panel_id=panel_id,
        h5_sha256=provenance["file"]["sha256"],
        status=result.status,
        reason=None,
        provenance=provenance,
        env=env,
        producer_commit=producer_commit,
        runtime={**runtime, "simulations": result.simulations},
    )
    document.update(
        {
            "data": {
                "columns_sha256": json_sha256(columns),
                "column_count": len(columns),
                "unknown_columns": sorted(c for c in columns if known and c not in known),
                "warnings": sorted(result.warnings),
            },
            "baseline": {"status": result.baseline_status["status"]},
            "reforms": {reform_id: _reform(record) for reform_id, record in result.reforms.items()},
            # Every key always present: a cell with no reason holds a null one.
            "cells": [{"reason": None, **cell.to_json()} for cell in result.cells],
            "engine_bundle": _bundle(result.engine_bundle),
        }
    )
    document["disclosure"]["withheld_cells"] = withheld
    return document


def refused_document(
    *,
    spec: Spec,
    panel_id: str,
    provenance: dict[str, Any],
    reason: str,
    env: dict[str, Any],
    producer_commit: str | None,
    runtime: dict[str, Any],
) -> dict[str, Any]:
    """A refusal the file itself causes (its source ids): stored, so it shows as a gap."""
    return _point(
        spec=spec,
        panel_id=panel_id,
        h5_sha256=provenance["file"]["sha256"],
        status="refused",
        reason=reason,
        provenance=provenance,
        env=env,
        producer_commit=producer_commit,
        runtime=runtime,
    )
