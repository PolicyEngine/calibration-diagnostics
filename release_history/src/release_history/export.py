"""Flatten a panel into a long table for notebooks.

With a `timeline.json` (pulled from Blob, or built by `bun run
scripts/release-history.ts timeline`), each row carries the change from the
previous release and the output's official reference. Without one, rows come
straight from the stored points.

`timeline.json` is written by the TypeScript side (`buildTimeline`), so its keys
are camelCase; `tests/fixtures/timeline.json` is that side's output, and the
tests read it here so the two languages can't drift apart.
"""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from typing import Any

from release_history.local_store import panel_dir, panels, read_points

POINT_COLUMNS = [
    "release_id",
    "published_at",
    "measurement_id",
    "point_status",
    "period",
    "output",
    "unit",
    "value",
    "status",
    "reason",
]
TIMELINE_COLUMNS = [
    "release_id",
    "published_at",
    "measurement_id",
    "period",
    "output",
    "unit",
    "value",
    "status",
    "reason",
    "change",
    "relative_change",
    "change_points",
    "change_status",
    "reference_status",
    "reference_value",
    "reference_basis",
]


def point_rows(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    ordered = sorted(
        points,
        key=lambda p: (
            (p.get("point") or {}).get("published_at") or "",
            p.get("measurement_id", ""),
        ),
    )
    for point in ordered:
        release = point.get("point") or {}
        for cell in point.get("cells") or []:
            rows.append(
                {
                    "release_id": release.get("release_id"),
                    "published_at": release.get("published_at"),
                    "measurement_id": point.get("measurement_id"),
                    "point_status": point.get("status"),
                    "period": cell.get("period"),
                    "output": cell.get("output"),
                    "unit": cell.get("unit"),
                    "value": cell.get("value"),
                    "status": cell.get("status"),
                    "reason": cell.get("reason"),
                }
            )
    return rows


def timeline_rows(timeline: dict[str, Any]) -> list[dict[str, Any]]:
    """One row per release and output, from the TypeScript side's camelCase timeline."""
    rows = []
    points = {p["measurementId"]: p for p in timeline.get("points") or []}
    for series in timeline.get("series") or []:
        reference = series.get("reference") or {}
        # The official figure in the model's sign convention, when it has a value.
        reference_value = reference.get("modelSignValue", reference.get("value"))
        for entry in series.get("values") or []:
            point = points.get(entry.get("measurementId"), {})
            rows.append(
                {
                    "release_id": point.get("releaseId"),
                    "published_at": point.get("publishedAt"),
                    "measurement_id": entry.get("measurementId"),
                    "period": series.get("period"),
                    "output": series.get("output"),
                    "unit": series.get("unit"),
                    "value": entry.get("value"),
                    "status": entry.get("status"),
                    "reason": entry.get("reason"),
                    "change": entry.get("change"),
                    "relative_change": entry.get("relativeChange"),
                    "change_points": entry.get("changePoints"),
                    "change_status": entry.get("changeStatus"),
                    "reference_status": reference.get("status"),
                    "reference_value": reference_value,
                    "reference_basis": reference.get("basis"),
                }
            )
    return rows


def export_csv(root: Path, country: str, panel_id: str | None = None) -> str:
    found = panels(root, country)
    if panel_id is None and len(found) > 1:
        raise ValueError(f"{len(found)} panels for {country}: name one with --panel")
    chosen = panel_id or (found[0] if found else None)
    if chosen is None:
        raise FileNotFoundError(f"No panel for {country} under {root}")
    folder = panel_dir(root, country, chosen)
    timeline = folder / "timeline.json"
    if timeline.is_file():
        rows = timeline_rows(json.loads(timeline.read_text(encoding="utf-8")))
        columns = TIMELINE_COLUMNS
    else:
        rows = point_rows(read_points(root, country, chosen))
        columns = POINT_COLUMNS
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()
