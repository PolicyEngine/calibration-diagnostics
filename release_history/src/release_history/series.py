"""The series record: a country's builds, as its release repository's `releases.json` lists them.

`releases.json` is the only listing source. The record names every build of
every release line; the series is the builds of the lines the spec names,
published on or after `series.since`. Everything is read at one resolved
commit of the repository's `main`: the record, and each selected build's
`release_manifest.json`, which gives the digest of the build's national data
file. A plan joins builds to points by that digest.

A build whose manifest is missing, or whose national file is missing,
unpinned, not microdata or not the default national release, is listed with
its reason and never planned: it has no file to measure, so it gets no point.

The record is rewritten on every run, so a corrected publish time or a
withdrawn flag reaches the timeline with no re-run. Every key is always
present, null where it does not apply; `schemas/series.schema.json` holds the
shape.
"""

from __future__ import annotations

import hashlib
import shutil
import tempfile
from pathlib import Path
from typing import Any

from microcosm_emitter_interface.releases import (
    RELEASES_RECORD_PATH,
    BuildEntry,
    ReleaseEntry,
    ReleaseRecordError,
    ReleasesRecord,
)

from release_history import SERIES_FORMAT_VERSION
from release_history.releases import HubClient, ReleaseRefusedError, national_artifact
from release_history.spec import Spec, utc_date

KIND = "release_history.series"


class SeriesError(RuntimeError):
    """A `releases.json` that cannot be read as the release writer writes it."""


def parse_record(content: bytes) -> ReleasesRecord:
    """`releases.json` checked by the release writer's own reader, microcosm-emitter's
    `ReleasesRecord.parse` (the exact shape, safe names, the 4 MB cap, a `current` that
    names a listed build that is not withdrawn, a `default` that names a listed
    release), then by the series' own rule: every publish time is ISO 8601."""
    try:
        record = ReleasesRecord.parse(content)
    except ReleaseRecordError as error:
        raise SeriesError(f"releases.json is refused: {error}") from error
    for release, entry in record.releases.items():
        for build, facts in entry.builds.items():
            try:
                utc_date(facts.published_at)
            except ValueError as error:
                raise SeriesError(
                    f"releases.json's build {release}/{build} has no ISO 8601 published_at."
                ) from error
    return record


def read_record(
    hub: HubClient, repo: str, commit: str, folder: Path
) -> tuple[ReleasesRecord | None, str | None]:
    """The parsed record and its file's sha256, or (None, None) when the repository has no
    releases.json at that commit. Any other failure raises: a series is never listed from a
    record that could not be read."""
    try:
        local = hub.download(repo, commit, RELEASES_RECORD_PATH, folder)
    except FileNotFoundError:
        return None, None
    content = Path(local).read_bytes()
    return parse_record(content), hashlib.sha256(content).hexdigest()


def build_series(
    spec: Spec,
    hub: HubClient,
    *,
    listed_at: str,
    revision: str = "main",
    workdir: Path | None = None,
) -> dict[str, Any]:
    """The country's series record at the current head of `revision`."""
    repo = spec.release_repo
    commit = hub.resolve_revision(repo, revision)
    own_workdir = workdir is None
    folder = workdir or Path(tempfile.mkdtemp(prefix="rh-series-"))
    try:
        record, record_sha = read_record(hub, repo, commit, folder)
        lines = []
        builds = []
        for line in spec.series_releases:
            release = record.releases.get(line) if record else None
            lines.append(
                {
                    "release": line,
                    "present": release is not None,
                    "role": release.role if release else None,
                }
            )
            if release is None:
                continue
            listed = sorted(
                release.builds.items(), key=lambda item: (item[1].published_at, item[0])
            )
            for build, facts in listed:
                if not spec.in_series(line, facts.published_at):
                    continue
                builds.append(
                    _listed_build(hub, repo, commit, folder, record, line, release, build, facts)
                )
        return {
            "format_version": SERIES_FORMAT_VERSION,
            "kind": KIND,
            "country": spec.country,
            "release_repo": repo,
            "rule": {"releases": list(spec.series_releases), "since": spec.series_since},
            "revision": revision,
            "commit": commit,
            "listed_at": listed_at,
            "record": {
                "present": record is not None,
                "sha256": record_sha,
                "default": record.default if record else None,
            },
            "lines": lines,
            "builds": builds,
        }
    finally:
        if own_workdir:
            shutil.rmtree(folder, ignore_errors=True)


def _listed_build(
    hub: HubClient,
    repo: str,
    commit: str,
    folder: Path,
    record: ReleasesRecord,
    line: str,
    release: ReleaseEntry,
    build: str,
    facts: BuildEntry,
) -> dict[str, Any]:
    directory = f"{line}/{build}"
    entry: dict[str, Any] = {
        "build_id": directory,
        "release": line,
        "build": build,
        "release_directory": directory,
        "published_at": facts.published_at,
        "withdrawn": facts.withdrawn,
        "current": release.current == build,
        "in_default_release": record.default == line,
        "role": release.role,
        "digest": None,
        "dataset_path": None,
        "release_manifest_sha256": None,
        "listing_status": "ok",
        "listing_reason": None,
    }
    try:
        manifest, manifest_sha = hub.read_json(
            repo, commit, f"releases/{directory}/release_manifest.json", folder
        )
    except FileNotFoundError:
        entry.update(listing_status="refused", listing_reason="release_manifest_missing")
        return entry
    entry["release_manifest_sha256"] = manifest_sha
    try:
        artifact = national_artifact(manifest, directory)
    except ReleaseRefusedError as refusal:
        entry.update(listing_status="refused", listing_reason=refusal.reason)
        return entry
    entry.update(digest=artifact.sha256, dataset_path=artifact.path)
    return entry
