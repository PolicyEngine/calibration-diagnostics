"""Flatten a panel into a long table for notebooks.

With a `timeline.json` (pulled from Blob, or built by `bun run
scripts/release-history.ts timeline`), each row is one build and one output,
with the change from the build before it on the series and the output's
official reference. Without one, rows come straight from the stored points,
joined to the builds of the country's series record (`series.json`) by file
digest: a file published under two builds gives both builds its rows.

`timeline.json` is written by the TypeScript side (`buildTimeline`), so its keys
are camelCase; `tests/fixtures/timeline.json` is that side's output, and the
tests read it here so the two languages can't drift apart.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
from pathlib import Path
from typing import Any

from release_history.local_store import country_dir, panel_dir, panels, read_points

POINT_COLUMNS = [
    "build_id",
    "published_at",
    "measurement_id",
    "h5_sha256",
    "point_status",
    "period",
    "output",
    "unit",
    "value",
    "status",
    "reason",
]
TIMELINE_COLUMNS = [
    "build_id",
    "published_at",
    "current",
    "withdrawn",
    "same_file_as",
    "state",
    "measurement_id",
    "period",
    "output",
    "unit",
    "value",
    "status",
    "compared_with",
    "change",
    "relative_change",
    "change_points",
    "change_status",
    "reference_status",
    "reference_value",
    "reference_basis",
]
_LAST = dt.datetime.max.replace(tzinfo=dt.UTC)


def _published(build: dict[str, Any] | None) -> dt.datetime:
    try:
        moment = dt.datetime.fromisoformat((build or {})["published_at"])
    except (KeyError, TypeError, ValueError):
        return _LAST
    return moment if moment.tzinfo else moment.replace(tzinfo=dt.UTC)


def point_rows(
    points: list[dict[str, Any]], series: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    """One row per build and cell; a point no listed build names gets rows with no build."""
    builds: dict[str, list[dict[str, Any]]] = {}
    for build in (series or {}).get("builds") or []:
        if build.get("listing_status") == "ok" and build.get("digest"):
            builds.setdefault(build["digest"], []).append(build)
    pairs = [
        (build, point)
        for point in points
        for build in sorted(
            builds.get(point["file"]["sha256"]) or [None],
            key=lambda b: (_published(b), (b or {}).get("build_id") or ""),
        )
    ]
    pairs.sort(key=lambda pair: (_published(pair[0]), pair[1]["measurement_id"]))
    rows = []
    for build, point in pairs:
        for cell in point.get("cells") or []:
            rows.append(
                {
                    "build_id": (build or {}).get("build_id"),
                    "published_at": (build or {}).get("published_at"),
                    "measurement_id": point.get("measurement_id"),
                    "h5_sha256": point["file"]["sha256"],
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
    """One row per build and output, from the TypeScript side's camelCase timeline."""
    builds = {build["buildId"]: build for build in timeline.get("builds") or []}
    rows = []
    for output in timeline.get("outputs") or []:
        reference = output.get("reference") or {}
        # The official figure in the model's sign convention, when it has a value.
        reference_value = reference.get("modelSignValue", reference.get("value"))
        for entry in output.get("values") or []:
            build = builds[entry["buildId"]]
            rows.append(
                {
                    "build_id": build["buildId"],
                    "published_at": build["publishedAt"],
                    "current": build["current"],
                    "withdrawn": build["withdrawn"],
                    "same_file_as": build["sameFileAs"],
                    "state": build["state"],
                    "measurement_id": build["measurementId"],
                    "period": output.get("period"),
                    "output": output.get("output"),
                    "unit": output.get("unit"),
                    "value": entry.get("value"),
                    "status": entry.get("status"),
                    "compared_with": entry.get("comparedWith"),
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
    timeline = panel_dir(root, country, chosen) / "timeline.json"
    if timeline.is_file():
        rows = timeline_rows(json.loads(timeline.read_text(encoding="utf-8")))
        columns = TIMELINE_COLUMNS
    else:
        series_path = country_dir(root, country) / "series.json"
        series = (
            json.loads(series_path.read_text(encoding="utf-8")) if series_path.is_file() else None
        )
        rows = point_rows(read_points(root, country, chosen), series)
        columns = POINT_COLUMNS
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()
