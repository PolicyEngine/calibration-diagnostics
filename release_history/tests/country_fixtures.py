"""Each country's fixture documents, made from its real spec on the synthetic world.

`tests/fixtures/<country>/` holds what the producer writes for a synthetic
series of that country: the panel, the series record (listed from a fake
release repository), the labels, and the stored points. The TypeScript side
builds `timeline.json` there from them (`frontend/scripts/release-history.test.ts`,
with the country's committed `references.lock.json`), and the schemas in
`release_history/schemas/` check all of them. Every number is synthetic; no
survey data and no real point is ever committed.

The synthetic series has every listing case: one file under two builds, a
current build, a withdrawn build, a build refused at listing, and, where the
spec reads source ids, a file stored as a gap.
"""

from __future__ import annotations

import datetime as dt
import hashlib
from pathlib import Path
from typing import Any

from release_history.canonical import json_sha256
from release_history.cli import labels_document
from release_history.document import measured_point, refused_document
from release_history.engine import panel_document
from release_history.measure import measure
from release_history.releases import Point, open_release, point_provenance
from release_history.series import build_series
from release_history.spec import Spec, countries_dir, load_spec

from .fakes import release_manifest, release_repo
from .synthetic import SyntheticBackend, SyntheticWorld

FIXTURES = Path(__file__).parent / "fixtures"
LISTED_AT = "2026-11-12T00:00:00Z"
COMMIT = "c" * 40
PACKAGES = ["policyengine-core==3.33.3"]
ENV = {
    "python": "3.12.0",
    "platform": "synthetic",
    "packages": PACKAGES,
    "packages_sha256": json_sha256(PACKAGES),
    "uv_lock_sha256": "0" * 64,
}
MODEL_VERSION = "1.0.0"
H5 = b"a synthetic national file"
RUNTIME = {
    "started_at": "2026-11-12T00:00:00Z",
    "finished_at": "2026-11-12T00:10:00Z",
    "seconds": 600.0,
    "runner": "synthetic",
}


def countries() -> list[str]:
    return sorted(p.name for p in countries_dir().iterdir() if (p / "spec.yaml").is_file())


def synthetic_digest(country: str, name: str) -> str:
    return hashlib.sha256(f"synthetic file {country} {name}".encode()).hexdigest()


def synthetic_engine(spec: Spec) -> dict[str, Any]:
    return {
        "policyengine": "6.16.1",
        "bundle_sha256": "b" * 64,
        "model": {"name": spec.model_package, "version": MODEL_VERSION, "wheel_sha256": None},
        "core": {"name": "policyengine-core", "version": "3.33.3"},
    }


def _builds(spec: Spec) -> dict[str, dict[str, Any]]:
    start = dt.date.fromisoformat(spec.series_since or "2026-10-01")
    files = {name: synthetic_digest(spec.country, name) for name in "abcd"}

    def at(days: int) -> str:
        return f"{start + dt.timedelta(days=days)}T09:00:00+00:00"

    model = spec.model_package
    return {
        "synthetic-build-1": {"published_at": at(1), "sha256": files["a"], "model": model},
        # The same file published again under a new build name: one point.
        "synthetic-build-2": {"published_at": at(3), "sha256": files["a"], "model": model},
        "synthetic-build-3": {"published_at": at(5), "sha256": files["b"], "model": model},
        "synthetic-build-4": {
            "published_at": at(7),
            "sha256": files["c"],
            "model": model,
            "withdrawn": True,
        },
        "synthetic-build-5": {"published_at": at(9), "sha256": files["d"], "model": model},
        "synthetic-build-6": {"published_at": at(11), "manifest": None},
    }


def _provenance(spec: Spec, hub: Any, build_id: str, sha256: str, workdir: Path) -> dict[str, Any]:
    """What the measure command records for a file, read through `open_release`."""
    point = Point(
        build_id=build_id,
        release_directory=build_id,
        hf_repo=spec.release_repo,
        hf_commit=COMMIT,
        digest=sha256,
    )
    opened = open_release(hub, point, workdir)
    return point_provenance(opened, spec.model_package, MODEL_VERSION)


def country_fixture(country: str, workdir: Path) -> dict[str, Any]:
    """The panel, series record, labels and points of one country's synthetic series."""
    spec = load_spec(country)
    line = spec.series_releases[0]
    builds = _builds(spec)
    manifests = {
        name: release_manifest(facts["sha256"], path="national.h5", model=facts["model"])
        for name, facts in builds.items()
        if "sha256" in facts
    }
    hub = release_repo(
        {
            line: {
                name: {**facts, "manifest": manifests.get(name)} for name, facts in builds.items()
            }
        },
        current={line: "synthetic-build-3"},
        default=line,
    )
    hub.commit = COMMIT
    for name in manifests:
        hub.files[f"releases/{line}/{name}/national.h5"] = H5
    series = build_series(spec, hub, listed_at=LISTED_AT, workdir=workdir)
    panel = panel_document(spec, synthetic_engine(spec))
    world = SyntheticWorld(spec)
    reads_source_ids = spec.disclosure_policy != "none"
    points = []
    for name in ("synthetic-build-1", "synthetic-build-3"):
        sha256 = builds[name]["sha256"]
        result = measure(spec, SyntheticBackend(world, seed=sha256))
        for simulation in result.simulations:
            simulation.update(seconds=300.0, peak_rss_bytes=1_000_000_000)
        document, _ = measured_point(
            spec=spec,
            panel_id=panel["panel_id"],
            provenance=_provenance(spec, hub, f"{line}/{name}", sha256, workdir),
            result=result,
            source_ids=world.source_ids if reads_source_ids else None,
            columns=[spec.household_id_variable, spec.weight_variable(spec.household_entity)],
            env=ENV,
            producer_commit="0" * 40,
            runtime=RUNTIME,
        )
        points.append(document)
    if reads_source_ids:
        # A file whose own source ids are missing: stored, so it shows as a gap.
        name = "synthetic-build-5"
        points.append(
            refused_document(
                spec=spec,
                panel_id=panel["panel_id"],
                provenance=_provenance(
                    spec, hub, f"{line}/{name}", builds[name]["sha256"], workdir
                ),
                reason="disclosure_source_ids_missing",
                env=ENV,
                producer_commit="0" * 40,
                runtime=RUNTIME,
            )
        )
    return {"panel": panel, "series": series, "labels": labels_document(spec), "points": points}


def fixture_files(country: str, workdir: Path) -> dict[str, Any]:
    """Each fixture file of a country, by its path under `tests/fixtures/<country>/`."""
    fixture = country_fixture(country, workdir)
    files = {
        "panel.json": fixture["panel"],
        "series.json": fixture["series"],
        "labels.json": fixture["labels"],
    }
    for point in fixture["points"]:
        files[f"points/{point['measurement_id']}.json"] = point
    return files
