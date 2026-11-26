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

from typing import Any, Final, Literal, TypedDict

import numpy as np

from release_history import POINT_FORMAT_VERSION, PRODUCER_VERSION
from release_history.canonical import json_sha256
from release_history.disclosure import apply_policy
from release_history.documents import (
    EngineBundle,
    Environment,
    LimitName,
    NearLimit,
    PointDocument,
    Provenance,
    Runtime,
    SimulationRecord,
)
from release_history.measure import Measurement
from release_history.spec import Spec

KIND: Final = "release_history.measurement"


class RunFacts(TypedDict):
    """When and where a `measure` run ran, as the command records it."""

    started_at: str
    finished_at: str
    seconds: float
    runner: str


def measurement_id(panel_id: str, h5_sha256: str) -> str:
    """One data file on one panel."""
    return json_sha256({"panel_id": panel_id, "h5_sha256": h5_sha256})


def _point(
    *,
    spec: Spec,
    panel_id: str,
    status: Literal["ok", "partial", "refused"],
    reason: str | None,
    provenance: Provenance,
    env: Environment,
    producer_commit: str | None,
    runtime: RunFacts,
    simulations: list[SimulationRecord],
) -> PointDocument:
    """A point with nothing measured in it yet: all a stored refusal holds."""
    return {
        "format_version": POINT_FORMAT_VERSION,
        "kind": KIND,
        "country": spec.country,
        "panel_id": panel_id,
        "measurement_id": measurement_id(panel_id, provenance["file"]["sha256"]),
        "status": status,
        "reason": reason,
        "fetched_from": provenance["fetched_from"],
        "file": provenance["file"],
        "data": None,
        "periods": [
            {"period": period, "label": spec.label_period(period)} for period in spec.periods
        ],
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
        "runtime": _runtime(spec, runtime, simulations, provenance["file"]["bytes"]),
    }


def _runtime(
    spec: Spec, run: RunFacts, simulations: list[SimulationRecord], file_bytes: int | None
) -> Runtime:
    """The run's facts, the limits it ran under, and the limits it came near."""
    # The limits it ran under, so a reader can tell how close it came to them.
    limits = spec.runner_limits()
    peak = max((simulation["peak_rss_bytes"] for simulation in simulations), default=0)
    used: list[tuple[LimitName, float | None, int | None]] = [
        ("dataset", file_bytes, limits["dataset_bytes"]),
        ("memory", peak or None, limits["memory_bytes"]),
        ("seconds", run["seconds"], limits["seconds"]),
    ]
    return {
        "started_at": run["started_at"],
        "finished_at": run["finished_at"],
        "seconds": run["seconds"],
        "runner": run["runner"],
        "simulations": simulations,
        "limits": limits,
        "near_limits": near_limits(used, limits["warn_at"]),
    }


def near_limits(
    used: list[tuple[LimitName, float | None, int | None]], warn_at: float
) -> list[NearLimit]:
    """The limits a run came within 20% of (a share of at least `warn_at`), by name, with the
    share it used: its seconds, its largest simulation's peak memory, its file's size.

    Computed here once and stored in the point as `runtime.near_limits`; the
    TypeScript finalize reads it from there for the manifest and the run summary.
    """
    return [
        {"limit": name, "share": round(value / limit, 3)}
        for name, value, limit in sorted(used, key=lambda entry: entry[0])
        if value and limit and value / limit >= warn_at
    ]


def _bundle(bundle: dict[str, Any]) -> EngineBundle:
    return {
        "bundle_id": bundle.get("bundle_id"),
        "capital_gains_responses": bundle.get("capital_gains_responses"),
    }


def measured_point(
    *,
    spec: Spec,
    panel_id: str,
    provenance: Provenance,
    result: Measurement,
    source_ids: np.ndarray | None,
    columns: list[str],
    env: Environment,
    producer_commit: str | None,
    runtime: RunFacts,
) -> tuple[PointDocument, int]:
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
    provenance: Provenance,
    result: Measurement,
    columns: list[str],
    withheld: int,
    env: Environment,
    producer_commit: str | None,
    runtime: RunFacts,
) -> PointDocument:
    """A measured file: `ok`, or `partial` when a reform failed on the last attempt."""
    known = set(result.model_variables)
    point = _point(
        spec=spec,
        panel_id=panel_id,
        status=result.status,
        reason=None,
        provenance=provenance,
        env=env,
        producer_commit=producer_commit,
        runtime=runtime,
        simulations=result.simulations,
    )
    return {
        **point,
        "data": {
            "columns_sha256": json_sha256(columns),
            "column_count": len(columns),
            "unknown_columns": sorted(
                column for column in columns if known and column not in known
            ),
            "warnings": sorted(result.warnings),
        },
        # A failed baseline raises before any point is written, so a measured point's ran.
        "baseline": {"status": "ok"},
        "reforms": dict(result.reforms),
        "cells": [cell.document() for cell in result.cells],
        "disclosure": {**point["disclosure"], "withheld_cells": withheld},
        "engine_bundle": _bundle(result.engine_bundle),
    }


def refused_document(
    *,
    spec: Spec,
    panel_id: str,
    provenance: Provenance,
    reason: str,
    env: Environment,
    producer_commit: str | None,
    runtime: RunFacts,
) -> PointDocument:
    """A refusal the file itself causes (its source ids): stored, so it shows as a gap."""
    return _point(
        spec=spec,
        panel_id=panel_id,
        status="refused",
        reason=reason,
        provenance=provenance,
        env=env,
        producer_commit=producer_commit,
        runtime=runtime,
        simulations=[],
    )
