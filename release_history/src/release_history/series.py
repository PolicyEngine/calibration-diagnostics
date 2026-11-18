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
import json
import re
import shutil
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from release_history import SERIES_FORMAT_VERSION
from release_history.releases import HubClient, ReleaseRefused, national_artifact
from release_history.spec import Spec, utc_date

RECORD_PATH = "releases.json"
KIND = "release_history.series"
# The release writer's rules (microcosm-emitter's `releases` interface), as the dashboard's
# `parseReleasesRecordBytes` (@policyengine/calibration-tree `release-record`) reads them.
_RECORD_SCHEMA_VERSION = 1
MAX_RECORD_BYTES = 4 * 1024 * 1024
_SAFE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_ROLE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_RECORD_KEYS = {"default", "releases", "schema_version"}
_RELEASE_KEYS = {"builds", "current", "role"}
_BUILD_KEYS = {"published_at", "withdrawn"}


class SeriesError(RuntimeError):
    """A `releases.json` that cannot be read as the release writer writes it."""


def _exactly(value: Any, keys: set[str]) -> bool:
    return isinstance(value, Mapping) and set(value) == keys


def parse_record(record: Any) -> dict[str, Any]:
    """The record's releases, checked as the release writer checks them: the exact shape,
    safe names, a `current` that names a listed build that is not withdrawn, a `default`
    that names a listed release, and (for the series) an ISO 8601 publish time."""
    if not _exactly(record, _RECORD_KEYS):
        raise SeriesError("releases.json must have exactly default, releases, schema_version.")
    version = record["schema_version"]
    if isinstance(version, bool) or version != _RECORD_SCHEMA_VERSION:
        raise SeriesError("releases.json's schema_version must be 1.")
    releases = record["releases"]
    if not isinstance(releases, Mapping):
        raise SeriesError("releases.json's releases must be an object.")
    parsed: dict[str, Any] = {}
    for name, entry in releases.items():
        if not _SAFE.match(str(name)):
            raise SeriesError("releases.json names a release that is not a safe identifier.")
        if not _exactly(entry, _RELEASE_KEYS):
            raise SeriesError(f"releases.json's release {name} must have builds, current, role.")
        if not isinstance(entry["role"], str) or not _ROLE.match(entry["role"]):
            raise SeriesError(f"releases.json's release {name} has an invalid role.")
        current = entry["current"]
        if current is not None and not isinstance(current, str):
            raise SeriesError(f"releases.json's release {name} current must be a build or null.")
        if not isinstance(entry["builds"], Mapping):
            raise SeriesError(f"releases.json's release {name} builds must be an object.")
        checked = {}
        for build, facts in entry["builds"].items():
            if not _SAFE.match(str(build)):
                raise SeriesError(f"releases.json's release {name} names an unsafe build.")
            if (
                not _exactly(facts, _BUILD_KEYS)
                or not isinstance(facts["published_at"], str)
                or not isinstance(facts["withdrawn"], bool)
            ):
                raise SeriesError(f"releases.json's build {name}/{build} is malformed.")
            try:
                utc_date(facts["published_at"])
            except ValueError as error:
                raise SeriesError(
                    f"releases.json's build {name}/{build} has no ISO 8601 published_at."
                ) from error
            checked[str(build)] = {
                "published_at": facts["published_at"],
                "withdrawn": facts["withdrawn"],
            }
        if current is not None and (current not in checked or checked[current]["withdrawn"]):
            raise SeriesError(f"releases.json's current build of {name} is unlisted or withdrawn.")
        parsed[str(name)] = {"role": entry["role"], "current": current, "builds": checked}
    default = record["default"]
    if default is not None and (not isinstance(default, str) or default not in parsed):
        raise SeriesError("releases.json's default must be a listed release or null.")
    return {"default": default, "releases": parsed}


def read_record(
    hub: HubClient, repo: str, commit: str, folder: Path
) -> tuple[dict[str, Any] | None, str | None]:
    """The parsed record and its file's sha256, or (None, None) when the repository has no
    releases.json at that commit. Any other failure raises: a series is never listed from a
    record that could not be read."""
    try:
        local = hub.download(repo, commit, RECORD_PATH, folder)
    except FileNotFoundError:
        return None, None
    data = Path(local).read_bytes()
    if len(data) > MAX_RECORD_BYTES:
        raise SeriesError(f"releases.json is larger than {MAX_RECORD_BYTES} bytes.")
    try:
        raw = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SeriesError("releases.json is not a readable JSON document.") from error
    return parse_record(raw), hashlib.sha256(data).hexdigest()


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
            release = (record or {}).get("releases", {}).get(line)
            lines.append(
                {
                    "release": line,
                    "present": release is not None,
                    "role": (release or {}).get("role"),
                }
            )
            if release is None:
                continue
            listed = sorted(
                release["builds"].items(), key=lambda item: (item[1]["published_at"], item[0])
            )
            for build, facts in listed:
                if not spec.in_series(line, facts["published_at"]):
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
                "default": (record or {}).get("default"),
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
    record: Mapping[str, Any],
    line: str,
    release: Mapping[str, Any],
    build: str,
    facts: Mapping[str, Any],
) -> dict[str, Any]:
    directory = f"{line}/{build}"
    entry: dict[str, Any] = {
        "build_id": directory,
        "release": line,
        "build": build,
        "release_directory": directory,
        "published_at": facts["published_at"],
        "withdrawn": facts["withdrawn"],
        "current": release.get("current") == build,
        "in_default_release": record.get("default") == line,
        "role": release.get("role"),
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
    except ReleaseRefused as refusal:
        entry.update(listing_status="refused", listing_reason=refusal.reason)
        return entry
    entry.update(digest=artifact.sha256, dataset_path=artifact.path)
    return entry
