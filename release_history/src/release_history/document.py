"""The stored measurement document: the contract with the TypeScript store.

`frontend/lib/microcosm/release-history-store.ts` (`MeasurementDocument`)
reads these documents to finalize a run and build a panel's timeline.
`tests/fixtures/measurement.json` is a document made from the fake model
world; both test suites read it, so a change on one side shows on the other.
"""

from __future__ import annotations

from typing import Any

from release_history import PRODUCER_VERSION, SCHEMA_VERSION
from release_history.canonical import json_sha256
from release_history.measure import Measurement
from release_history.spec import Spec

KIND = "release_history.measurement"


def measurement_id(panel_id: str, provenance: dict[str, Any], h5_sha256: str | None) -> str:
    """One release build on one panel: the same build and file measure to the same id."""
    return json_sha256(
        {
            "panel_id": panel_id,
            "hf_repo": provenance.get("hf_repo"),
            "release_id": provenance.get("release_id"),
            "hf_commit": provenance.get("hf_commit"),
            "h5_sha256": h5_sha256,
        }
    )


def measurement_document(
    *,
    spec: Spec,
    panel_id: str,
    measurement: str,
    provenance: dict[str, Any],
    result: Measurement,
    columns: list[str],
    withheld: int,
    runtime: dict[str, Any],
) -> dict[str, Any]:
    known = set(result.model_variables)
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": KIND,
        "producer_version": PRODUCER_VERSION,
        "country": spec.country,
        "panel_id": panel_id,
        "measurement_id": measurement,
        "status": result.status,
        "point": provenance,
        "data": {
            "columns_sha256": json_sha256(columns),
            "column_count": len(columns),
            "unknown_columns": sorted(c for c in columns if known and c not in known),
            "warnings": sorted(result.warnings),
        },
        "periods": [{"period": p, "label": spec.label_period(p)} for p in spec.periods],
        "baseline": result.baseline_status,
        "reforms": result.reforms,
        "cells": [cell.to_json() for cell in result.cells],
        "disclosure": {
            "policy": spec.disclosure_policy,
            "min_source_households": spec.min_source_households,
            "withheld_cells": withheld,
        },
        "engine_bundle": result.engine_bundle,
        "runtime": {**runtime, "simulations": result.simulations},
    }


def refused_document(
    *,
    spec: Spec,
    panel_id: str,
    provenance: dict[str, Any],
    status: str,
    reason: str,
    h5_sha256: str | None,
    runtime: dict[str, Any],
    error: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """A point that is not measured, or not measured fully: stored, so it shows as a gap."""
    document: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "kind": KIND,
        "producer_version": PRODUCER_VERSION,
        "country": spec.country,
        "panel_id": panel_id,
        "measurement_id": measurement_id(panel_id, provenance, h5_sha256),
        "status": status,
        "reason": reason,
        "point": provenance,
        "cells": [],
        "runtime": runtime,
    }
    if error is not None:
        document["error"] = error
    return document
