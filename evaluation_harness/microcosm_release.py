"""Resolve the small manifest surface of a published Microcosm release.

A Microcosm release repository records which build is current in one of two
layouts, and this module reads both:

- ``releases.json``, the layout of the US and UK release repositories, and of
  Belgium's once it moves::

      releases.json
      releases/<release>/<build>/build_manifest.json
      releases/<release>/<build>/release_manifest.json
      releases/<release>/<build>/calibration_diagnostics.json

  The resolved build is the current build of the record's default release,
  the build the telemetry collector treats as the repository's latest. Its
  ``release_id`` is ``<release>/<build>``, its folder under ``releases/``, and
  its release manifest must name that release and build, as the collector
  and Microcosm's loader require.

- ``latest.json``, the layout Belgium's release repository uses until its
  move: one pointer file naming a build and the paths of its three documents
  under ``releases/<build>/``. It is read exactly as before, and produces the
  same result.

As in Microcosm's loader, ``releases.json`` decides whenever the repository
has one, and only its absence selects ``latest.json``: a missing local file,
or Hugging Face's answer that the file does not exist (404 with
``X-Error-Code: EntryNotFound``). Every other failure to read it is raised,
so a refused token or a server error never resolves the build that an old
``latest.json`` names in a repository that has moved.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Callable


BELGIUM_MICROCOSM_REPOSITORY = "policyengine/populace-be-private"
REQUIRED_RELEASE_PATHS = (
    "build_manifest",
    "release_manifest",
    "calibration_diagnostics",
)
RELEASES_RECORD_PATH = "releases.json"
LATEST_POINTER_PATH = "latest.json"
#: The largest ``releases.json`` the record's writer accepts.
MAX_RELEASES_RECORD_BYTES = 4 * 1024 * 1024
# A release or build name: one path segment that cannot leave its folder (the
# emitter interface's SAFE_IDENTIFIER), and a release role (ROLE_IDENTIFIER).
_SAFE_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
_ROLE_IDENTIFIER = re.compile(r"[a-z][a-z0-9_]{0,63}")
_RECORD_KEYS = frozenset({"default", "releases", "schema_version"})
_RELEASE_KEYS = frozenset({"builds", "current", "role"})
_BUILD_KEYS = frozenset({"published_at", "withdrawn"})

#: Reads one file of the repository by its path. It raises
#: ``FileNotFoundError`` only when the file does not exist.
ArtifactReader = Callable[[str], bytes]


@dataclass(frozen=True)
class ResolvedMicrocosmRelease:
    """Authenticated-in-place JSON documents of the build that
    ``releases.json`` or, before it, ``latest.json`` selects."""

    release_id: str
    #: ``latest.json`` when it selected the build, otherwise ``None``.
    latest: dict | None
    build_manifest: dict
    release_manifest: dict
    calibration_diagnostics: dict
    artifact_paths: dict[str, str]
    artifact_sha256: dict[str, str]
    provenance: str
    #: ``releases.json`` when it selected the build, otherwise ``None``.
    releases_record: dict | None = None

    @property
    def calibration_target_record_ids(self) -> frozenset[str]:
        """Return every explicit Chronicle record used by a calibration target."""

        record_ids: set[str] = set()
        targets = self.calibration_diagnostics.get("targets")
        if not isinstance(targets, list):
            raise ValueError("Microcosm calibration diagnostics must contain targets")
        for target in targets:
            metadata = target.get("metadata", {})
            values = metadata.get("chronicle_record_ids", ())
            if not isinstance(values, list) or any(
                not isinstance(value, str) or not value for value in values
            ):
                raise ValueError(
                    "Microcosm target chronicle_record_ids must be non-empty strings"
                )
            record_ids.update(values)
        return frozenset(record_ids)


def _json_document(content: bytes, label: str) -> dict:
    try:
        payload = json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Microcosm {label} is not valid JSON") from error
    if not isinstance(payload, dict):
        raise ValueError(f"Microcosm {label} must contain an object")
    return payload


def _release_path(value: object, release_id: str, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"Microcosm latest manifest requires paths.{label}")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"Microcosm latest manifest has unsafe path: {value!r}")
    expected_prefix = ("releases", release_id)
    if path.parts[:2] != expected_prefix:
        raise ValueError(
            f"Microcosm {label} path is outside release {release_id}: {value}"
        )
    return value


def _refuse_record(message: str) -> ValueError:
    return ValueError(f"Microcosm {RELEASES_RECORD_PATH}: {message}")


def _is_safe_identifier(value: object) -> bool:
    return isinstance(value, str) and _SAFE_IDENTIFIER.fullmatch(value) is not None


def _reject_constant(constant: str) -> None:
    # JSON.parse refuses NaN and Infinity, which Python's json reads.
    raise ValueError(f"{constant} is not JSON.")


def _releases_record(content: bytes) -> dict[str, Any]:
    """``releases.json``, checked against the record's rules.

    The rules are the telemetry collector's ``parse_releases_record``
    (``telemetry_collector/releases_record.py`` in
    PolicyEngine/microcosm-collector), which refuses exactly what the
    calibration tree package's parser refuses: a record larger than 4 MiB or
    not a readable JSON document; one without exactly its keys at every level
    or with a ``schema_version`` other than 1; a release or build name that is
    not a safe identifier; an invalid role; a malformed build; a ``current``
    that is not a listed build or is withdrawn; and a ``default`` that is not a
    listed release. This harness cannot import that parser, so it repeats the
    rules.
    """

    if len(content) > MAX_RELEASES_RECORD_BYTES:
        raise _refuse_record(f"larger than {MAX_RELEASES_RECORD_BYTES} bytes.")
    try:
        # As TextDecoder reads it: invalid UTF-8 refused, a leading BOM dropped.
        document = json.loads(
            content.decode("utf-8-sig"), parse_constant=_reject_constant
        )
    except (ValueError, RecursionError):
        # RecursionError: nested more deeply than the decoder goes.
        raise _refuse_record("not a readable JSON document.") from None
    if not isinstance(document, dict) or set(document) != _RECORD_KEYS:
        raise _refuse_record("must have exactly default, releases, schema_version.")
    schema_version = document["schema_version"]
    if isinstance(schema_version, bool) or schema_version != 1:
        raise _refuse_record("schema_version must be 1.")
    releases = document["releases"]
    if not isinstance(releases, dict):
        raise _refuse_record("releases must be an object.")
    for release, entry in releases.items():
        if not _is_safe_identifier(release):
            raise _refuse_record("a release name is not a safe identifier.")
        if not isinstance(entry, dict) or set(entry) != _RELEASE_KEYS:
            raise _refuse_record(f"release {release} must have builds, current, role.")
        role = entry["role"]
        if not isinstance(role, str) or _ROLE_IDENTIFIER.fullmatch(role) is None:
            raise _refuse_record(f"release {release} has an invalid role.")
        if entry["current"] is not None and not isinstance(entry["current"], str):
            raise _refuse_record(f"release {release} current must be a build or null.")
        builds = entry["builds"]
        if not isinstance(builds, dict):
            raise _refuse_record(f"release {release} builds must be an object.")
        for build, build_entry in builds.items():
            if not _is_safe_identifier(build):
                raise _refuse_record("a build name is not a safe identifier.")
            if (
                not isinstance(build_entry, dict)
                or set(build_entry) != _BUILD_KEYS
                or not isinstance(build_entry["published_at"], str)
                or not build_entry["published_at"]
                or not isinstance(build_entry["withdrawn"], bool)
            ):
                raise _refuse_record(f"build {build} of {release} is malformed.")
    default = document["default"]
    if default is not None and not isinstance(default, str):
        raise _refuse_record("default must be a release name or null.")
    if default is not None and default not in releases:
        raise _refuse_record(f"default {default} is not listed.")
    for release, entry in releases.items():
        current = entry["current"]
        if current is None:
            continue
        if current not in entry["builds"]:
            raise _refuse_record(f"current build {current} of {release} is not listed.")
        if entry["builds"][current]["withdrawn"]:
            raise _refuse_record(f"current build {current} of {release} is withdrawn.")
    return document


def _hf_reader(repository: str, revision: str) -> ArtifactReader:
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")

    def read(relative_path: str) -> bytes:
        url = (
            f"https://huggingface.co/datasets/{repository}/resolve/"
            f"{revision}/{relative_path}"
        )
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            # Only this answer says the file is absent. A 404 also answers an
            # unknown revision or a repository the token cannot see, which
            # says nothing about the file.
            if error.code == 404 and error.headers.get("X-Error-Code") == "EntryNotFound":
                raise FileNotFoundError(
                    f"{repository}@{revision} has no {relative_path}"
                ) from error
            raise

    return read


def _read_if_present(read: ArtifactReader, relative_path: str) -> bytes | None:
    try:
        return read(relative_path)
    except FileNotFoundError:
        return None


def resolve_microcosm_release(
    release_dir: str | Path | None = None,
    *,
    repository: str = BELGIUM_MICROCOSM_REPOSITORY,
    revision: str = "main",
    artifact_reader: ArtifactReader | None = None,
) -> ResolvedMicrocosmRelease:
    """Resolve the current build from a local release tree or Hugging Face.

    ``releases.json`` selects the current build of its default release; a
    repository without one is resolved through ``latest.json``, as before.

    A local directory is read in place and never copied.  When it is omitted,
    the same relative artifacts are fetched from the configured Hugging Face
    dataset repository at ``revision``.  ``artifact_reader`` is an injectable
    remote reader for deterministic tests, which raises ``FileNotFoundError``
    only for a file that does not exist; callers must not combine it with
    ``release_dir``.
    """

    if release_dir is not None and artifact_reader is not None:
        raise ValueError("release_dir and artifact_reader are mutually exclusive")
    if release_dir is not None:
        root = Path(release_dir)
        if not root.is_dir():
            raise FileNotFoundError(f"Microcosm release directory does not exist: {root}")

        def read(relative_path: str) -> bytes:
            candidate = root.joinpath(*PurePosixPath(relative_path).parts)
            if not candidate.is_file():
                raise FileNotFoundError(
                    f"Microcosm release artifact does not exist: {candidate}"
                )
            return candidate.read_bytes()

        # Artifact hashes carry identity; keeping machine-specific absolute
        # paths out of the run summary makes local and hosted publication
        # deterministic across worktrees.
        provenance = "local_release_directory"
    else:
        read = artifact_reader or _hf_reader(repository, revision)
        provenance = f"hf:{repository}@{revision}"

    record_bytes = _read_if_present(read, RELEASES_RECORD_PATH)
    latest: dict | None = None
    releases_record: dict | None = None
    selection_sha256: dict[str, str] = {}
    if record_bytes is not None:
        releases_record = _releases_record(record_bytes)
        release = releases_record["default"]
        if release is None:
            raise _refuse_record("names no default release.")
        build = releases_record["releases"][release]["current"]
        if build is None:
            raise _refuse_record(
                f"names no current build of its default release {release}."
            )
        release_id = f"{release}/{build}"
        artifact_paths = {
            label: f"releases/{release_id}/{label}.json"
            for label in REQUIRED_RELEASE_PATHS
        }
    else:
        latest_bytes = read(LATEST_POINTER_PATH)
        latest = _json_document(latest_bytes, "latest manifest")
        if latest.get("schema_version") != 1:
            raise ValueError(
                f"unsupported Microcosm latest schema: {latest.get('schema_version')!r}"
            )
        release_id = latest.get("release_id")
        if not isinstance(release_id, str) or not release_id:
            raise ValueError("Microcosm latest manifest requires release_id")
        paths_payload = latest.get("paths")
        if not isinstance(paths_payload, dict):
            raise ValueError("Microcosm latest manifest requires paths")
        artifact_paths = {
            label: _release_path(paths_payload.get(label), release_id, label)
            for label in REQUIRED_RELEASE_PATHS
        }
        selection_sha256 = {"latest": hashlib.sha256(latest_bytes).hexdigest()}
    artifact_bytes = {
        label: read(relative_path)
        for label, relative_path in artifact_paths.items()
    }
    documents = {
        label: _json_document(content, label.replace("_", " "))
        for label, content in artifact_bytes.items()
    }
    if releases_record is not None:
        named = (
            documents["release_manifest"].get("release"),
            documents["release_manifest"].get("build"),
        )
        if named != (release, build):
            raise ValueError(
                f"Microcosm {artifact_paths['release_manifest']} does not name "
                f"release {release!r} and build {build!r}: {named[0]!r}, "
                f"{named[1]!r}"
            )
    else:
        build_id = documents["build_manifest"].get("build_id")
        tagged_build = documents["release_manifest"].get("build", {})
        release_build_id = (
            tagged_build.get("build_id") if isinstance(tagged_build, dict) else None
        )
        if build_id != release_id or release_build_id != release_id:
            raise ValueError(
                "Microcosm release manifests do not match latest release_id: "
                f"{build_id!r}, {release_build_id!r}, {release_id!r}"
            )
    resolved = ResolvedMicrocosmRelease(
        release_id=release_id,
        latest=latest,
        build_manifest=documents["build_manifest"],
        release_manifest=documents["release_manifest"],
        calibration_diagnostics=documents["calibration_diagnostics"],
        artifact_paths=artifact_paths,
        artifact_sha256={
            **selection_sha256,
            **{
                label: hashlib.sha256(content).hexdigest()
                for label, content in artifact_bytes.items()
            },
        },
        provenance=provenance,
        releases_record=releases_record,
    )
    # Validate target metadata while the release is being resolved rather than
    # deferring malformed provenance until checkpoint classification.
    resolved.calibration_target_record_ids
    return resolved
