"""The collector's source, tests and deployment live in PolicyEngine/microcosm-collector.

This repo only uses the deployed collector: the dashboard server reads from it,
and the production dashboard deploy checks that its read secret exists. The
directory the collector was developed in is removed, nothing here refers to it,
and no workflow here deploys the collector's Cloud Run service or migration job.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GITHUB_DIRECTORY = ROOT / ".github"
# Built from parts, so that this file does not match its own search.
REMOVED_DIRECTORY = "telemetry" + "-service"
REMOVED_PATH_REFERENCES = (f"{REMOVED_DIRECTORY}/", f"{REMOVED_DIRECTORY}.yml")
COLLECTOR_DEPLOYMENT_MARKERS = (
    "vars.TELEMETRY_SERVICE",
    "vars.TELEMETRY_PRODUCTION_SERVICE",
    "vars.TELEMETRY_MIGRATION_JOB",
    "vars.TELEMETRY_IMAGE_NAME",
    "gcloud run deploy",
    "gcloud run jobs",
    "gcloud run services update-traffic",
)


def tracked_files() -> list[Path]:
    listing = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True
    ).stdout
    return [
        ROOT / relative_path.decode()
        for relative_path in listing.split(b"\0")
        if relative_path and (ROOT / relative_path.decode()).is_file()
    ]


def test_the_collector_directory_and_its_workflow_are_removed() -> None:
    assert not (ROOT / REMOVED_DIRECTORY).exists()
    assert not (GITHUB_DIRECTORY / "workflows" / f"{REMOVED_DIRECTORY}.yml").exists()


def test_no_tracked_file_refers_to_the_removed_collector_directory() -> None:
    referring_files = [
        str(tracked_path.relative_to(ROOT))
        for tracked_path in tracked_files()
        if any(
            reference.encode() in tracked_path.read_bytes()
            for reference in REMOVED_PATH_REFERENCES
        )
    ]

    assert referring_files == []


def test_no_workflow_or_workflow_script_deploys_the_collector() -> None:
    deploying_files = [
        str(github_path.relative_to(ROOT))
        for github_path in sorted(GITHUB_DIRECTORY.rglob("*"))
        if github_path.is_file()
        and any(
            marker in github_path.read_text(encoding="utf-8")
            for marker in COLLECTOR_DEPLOYMENT_MARKERS
        )
    ]

    assert deploying_files == []
