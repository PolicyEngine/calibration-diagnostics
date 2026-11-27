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

from release_history.documents import (
    PointDocument,
    SeriesBuild,
    SeriesRecord,
    TimelineDocument,
)
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
    "reference_model_compatibility",
    "unknown_columns",
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


def _published(build: SeriesBuild | None) -> dt.datetime:
    if build is None:
        return _LAST
    try:
        moment = dt.datetime.fromisoformat(build["published_at"])
    except ValueError:
        return _LAST
    return moment if moment.tzinfo else moment.replace(tzinfo=dt.UTC)


def _build_order(build: SeriesBuild | None) -> tuple[dt.datetime, str]:
    return _published(build), build["build_id"] if build else ""


def point_rows(
    points: list[PointDocument], series: SeriesRecord | None = None
) -> list[dict[str, object]]:
    """One row per build and cell; a point no listed build names gets rows with no build."""
    builds: dict[str, list[SeriesBuild]] = {}
    for build in series["builds"] if series else []:
        if build["listing_status"] == "ok" and build["digest"]:
            builds.setdefault(build["digest"], []).append(build)
    pairs: list[tuple[SeriesBuild | None, PointDocument]] = []
    for point in points:
        listed: list[SeriesBuild | None] = [*builds.get(point["file"]["sha256"], [])] or [None]
        pairs += [(build, point) for build in sorted(listed, key=_build_order)]
    pairs.sort(key=lambda pair: (_published(pair[0]), pair[1]["measurement_id"]))
    rows: list[dict[str, object]] = []
    for build, point in pairs:
        for cell in point["cells"]:
            rows.append(
                {
                    "build_id": build["build_id"] if build else None,
                    "published_at": build["published_at"] if build else None,
                    "measurement_id": point["measurement_id"],
                    "h5_sha256": point["file"]["sha256"],
                    "point_status": point["status"],
                    "period": cell["period"],
                    "output": cell["output"],
                    "unit": cell["unit"],
                    "value": cell["value"],
                    "status": cell["status"],
                    "reason": cell["reason"],
                }
            )
    return rows


def timeline_rows(timeline: TimelineDocument) -> list[dict[str, object]]:
    """One row per build and output, from the TypeScript side's camelCase timeline."""
    builds = {build["buildId"]: build for build in timeline["builds"]}
    rows: list[dict[str, object]] = []
    for output in timeline["outputs"]:
        reference = output["reference"]
        # The official figure in the model's sign convention, when it has a value.
        reference_value = (
            reference.get("modelSignValue", reference.get("value")) if reference else None
        )
        for entry in output["values"]:
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
                    "reference_model_compatibility": build["referenceModelCompatibility"],
                    "unknown_columns": ";".join(build["unknownColumns"] or []),
                    "period": output["period"],
                    "output": output["output"],
                    "unit": output["unit"],
                    "value": entry["value"],
                    "status": entry["status"],
                    "compared_with": entry["comparedWith"],
                    "change": entry["change"],
                    "relative_change": entry["relativeChange"],
                    "change_points": entry["changePoints"],
                    "change_status": entry["changeStatus"],
                    "reference_status": reference["status"] if reference else None,
                    "reference_value": reference_value,
                    "reference_basis": reference.get("basis") if reference else None,
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
