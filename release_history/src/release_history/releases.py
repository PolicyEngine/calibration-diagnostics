"""Read a published release at its pinned commit and fetch its national H5.

A planned point comes from the country's series record (`series.py`): one
build that the release repository's `releases.json` records, read at one
resolved commit of `main`, with the digest of the data file it lists. This
module re-reads the release manifest at that commit and fails closed: only a
default national release with `default_datasets.national` is measured, and
only the file the plan expects.

The walk from `default_datasets.national` to `artifacts[key]` and the sha256
check follow `frontend/scripts/hosted_release.py` (`validate_manifests`,
`verify_h5`), done here for any country and any release rather than the one
release that runtime certifies.

Layouts:
- tagged: `releases/<folder>/release_manifest.json`, and an artifact with a
  `revision` sits at the repository root at the pinned commit;
- build folders: `releases/<release>/<build>/release_manifest.json`, and an
  artifact without a `revision` sits in that folder.
"""

from __future__ import annotations

import json
import os
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from packaging.specifiers import InvalidSpecifier, SpecifierSet

from release_history.canonical import file_sha256, json_sha256

# The Xet transfer cache filled the hosted runtime's disk; keep plain LFS downloads.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

_CUT_TAG = re.compile(r"^(?P<release>.+)-\d{8}T\d{6}Z-[0-9a-f]{8}$")
# A network or service failure is tried again this many times in all, so one bad response
# does not fail a weekly run.
TRANSIENT_TRIES = 3
TRANSIENT_BACKOFF_SECONDS = 5.0


class TransientError(RuntimeError):
    """A failure worth retrying on a later run (network, service)."""


class ReleaseRefused(RuntimeError):
    """A release that is not measured, with the reason stored on its point."""

    def __init__(self, status: str, reason: str) -> None:
        super().__init__(reason)
        self.status = status
        self.reason = reason


@dataclass(frozen=True)
class Point:
    """One data file to measure, as the plan names it: a recorded build at one commit.

    `digest` is the file's sha256 as the series listed it (None for a local
    `--revision` run, which takes the manifest's). `attempt` and `last_attempt`
    let the producer hold back a partial result until the last attempt.
    """

    build_id: str
    release_directory: str
    hf_repo: str
    hf_commit: str
    digest: str | None = None
    attempt: int = 1
    last_attempt: bool = True

    @classmethod
    def from_json(cls, value: Mapping[str, Any]) -> Point:
        return cls(
            build_id=str(value["build_id"]),
            release_directory=str(value["release_directory"]),
            hf_repo=str(value["hf_repo"]),
            hf_commit=str(value["hf_commit"]),
            digest=value.get("digest"),
            attempt=int(value.get("attempt", 1)),
            last_attempt=bool(value.get("last_attempt", True)),
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "build_id": self.build_id,
            "release_directory": self.release_directory,
            "hf_repo": self.hf_repo,
            "hf_commit": self.hf_commit,
            "digest": self.digest,
            "attempt": self.attempt,
            "last_attempt": self.last_attempt,
        }


def release_role(manifest: Mapping[str, Any]) -> dict[str, bool]:
    """The dashboard's release summary rule (`releaseRole` in the calibration-tree package)."""
    is_default = manifest.get("is_default")
    dataset_role = manifest.get("dataset_role")
    national = (manifest.get("default_datasets") or {}).get("national")
    default = is_default is True or (is_default is None and dataset_role is None and bool(national))
    local_area = isinstance(dataset_role, str) and "local_area" in dataset_role
    return {"is_default": default, "is_local_area": local_area}


@dataclass(frozen=True)
class NationalArtifact:
    key: str
    path: str
    sha256: str


def national_artifact(manifest: Mapping[str, Any], release_directory: str) -> NationalArtifact:
    role = release_role(manifest)
    if not role["is_default"] or role["is_local_area"]:
        raise ReleaseRefused("skipped", "not_default_national")
    key = (manifest.get("default_datasets") or {}).get("national")
    artifacts = manifest.get("artifacts") or {}
    artifact = artifacts.get(key) if isinstance(key, str) else None
    if not isinstance(artifact, Mapping):
        raise ReleaseRefused("error", "national_artifact_missing")
    if artifact.get("kind", "microdata") != "microdata":
        raise ReleaseRefused("error", "national_artifact_not_microdata")
    path, sha256 = artifact.get("path"), artifact.get("sha256")
    if not isinstance(path, str) or not re.fullmatch(r"[0-9a-f]{64}", str(sha256)):
        raise ReleaseRefused("error", "national_artifact_unpinned")
    in_repo = path if artifact.get("revision") else f"releases/{release_directory}/{path}"
    return NationalArtifact(key=key, path=in_repo, sha256=str(sha256))


def compatibility(manifest: Mapping[str, Any], package: str, version: str) -> str:
    """Whether the reference model is inside the release's declared range."""
    declared = [
        entry
        for entry in manifest.get("compatible_model_packages") or []
        if isinstance(entry, Mapping) and entry.get("name") == package
    ]
    if not declared:
        return "undeclared"
    try:
        inside = any(version in SpecifierSet(str(entry.get("specifier", ""))) for entry in declared)
    except InvalidSpecifier:
        return "unreadable"
    return "inside" if inside else "outside"


def build_provenance(build_manifest: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """The build facts a later "why did it move" tool joins on; pointers, not copies."""
    if not build_manifest:
        return None
    calibration = build_manifest.get("calibration") or {}
    code = build_manifest.get("code") or {}
    # A build folder's build manifest names its build in "build"; a tagged one has "attempt_id".
    build_name = build_manifest.get("build")
    return {
        "code_repository": code.get("repository"),
        "code_commit": code.get("git_commit"),
        "attempt_id": build_manifest.get("attempt_id")
        or (build_name if isinstance(build_name, str) else None),
        "target_surface_sha256": (calibration.get("target_surface") or {}).get("sha256"),
        "n_targets": (calibration.get("target_surface") or {}).get("n_targets"),
        "target_registry_version": (calibration.get("target_registry") or {}).get("version"),
        "household_weight_year": calibration.get("household_weight_year"),
        "runtime": build_manifest.get("runtime"),
    }


class HubClient:
    """Reads from the Hugging Face Hub at exact commits."""

    def __init__(self, token: str | None = None) -> None:
        self.token = token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")

    def _call(self, function, *args, **kwargs):
        for attempt in range(TRANSIENT_TRIES):
            try:
                return function(*args, **kwargs)
            except Exception as error:  # noqa: BLE001 - classified below
                name = type(error).__name__
                if name in ("EntryNotFoundError", "RemoteEntryNotFoundError"):
                    raise FileNotFoundError(kwargs.get("filename") or args) from error
                if name in ("RepositoryNotFoundError", "RevisionNotFoundError", "GatedRepoError"):
                    raise ReleaseRefused("error", "repository_or_revision_unreadable") from error
                if attempt + 1 == TRANSIENT_TRIES:
                    raise TransientError(name) from error
                time.sleep(TRANSIENT_BACKOFF_SECONDS * (attempt + 1))
        raise AssertionError("unreachable")

    def resolve_revision(self, repo: str, revision: str) -> str:
        from huggingface_hub import HfApi

        info = self._call(
            HfApi(token=self.token).repo_info, repo, repo_type="dataset", revision=revision
        )
        return str(info.sha)

    def file_size(self, repo: str, commit: str, path: str) -> int | None:
        from huggingface_hub import HfApi

        infos = self._call(
            HfApi(token=self.token).get_paths_info,
            repo,
            [path],
            revision=commit,
            repo_type="dataset",
        )
        for info in infos:
            size = getattr(info, "size", None)
            if size is not None:
                return int(size)
        return None

    def download(self, repo: str, commit: str, path: str, directory: Path) -> Path:
        from huggingface_hub import hf_hub_download

        return Path(
            self._call(
                hf_hub_download,
                repo_id=repo,
                filename=path,
                revision=commit,
                repo_type="dataset",
                token=self.token,
                local_dir=str(directory),
            )
        )

    def read_json(self, repo: str, commit: str, path: str, directory: Path) -> tuple[Any, str]:
        local = self.download(repo, commit, path, directory)
        data = local.read_bytes()
        return json.loads(data), file_sha256(local)


def release_directory_for(revision: str, series_releases: tuple[str, ...]) -> str:
    """A cut tag is read from its line's folder; any other revision names its own."""
    match = _CUT_TAG.match(revision)
    if match and match.group("release") in series_releases:
        return match.group("release")
    return revision


@dataclass
class OpenedRelease:
    point: Point
    manifest: dict[str, Any]
    manifest_path: str
    manifest_sha256: str
    build_manifest: dict[str, Any] | None
    build_manifest_path: str | None
    build_manifest_sha256: str | None
    artifact: NationalArtifact
    size_bytes: int | None


def open_release(hub: HubClient, point: Point, workdir: Path) -> OpenedRelease:
    folder = f"releases/{point.release_directory}"
    manifest_path = f"{folder}/release_manifest.json"
    try:
        manifest, manifest_sha = hub.read_json(
            point.hf_repo, point.hf_commit, manifest_path, workdir
        )
    except FileNotFoundError as error:
        raise ReleaseRefused("error", "release_manifest_missing") from error
    build_path = f"{folder}/build_manifest.json"
    try:
        build_manifest, build_sha = hub.read_json(
            point.hf_repo, point.hf_commit, build_path, workdir
        )
    except FileNotFoundError:
        build_manifest, build_sha, build_path = None, None, None
    artifact = national_artifact(manifest, point.release_directory)
    size = hub.file_size(point.hf_repo, point.hf_commit, artifact.path)
    return OpenedRelease(
        point,
        manifest,
        manifest_path,
        manifest_sha,
        build_manifest,
        build_path,
        build_sha,
        artifact,
        size,
    )


def download_verified(hub: HubClient, opened: OpenedRelease, workdir: Path) -> Path:
    """Download the national H5 at the pinned commit; refuse it on a sha256 mismatch."""
    local = hub.download(
        opened.point.hf_repo, opened.point.hf_commit, opened.artifact.path, workdir
    )
    digest = file_sha256(local)
    if digest != opened.artifact.sha256:
        local.unlink(missing_ok=True)
        raise ReleaseRefused("error", "sha256_mismatch")
    return local


def point_provenance(opened: OpenedRelease, model_package: str, model_version: str) -> dict:
    """What a point records about its file: the file itself, and where it was fetched from.

    Only facts that cannot change after the measurement. `file` is the file alone (its
    sha256 and size), so a file published under two builds is one fact. What a build's
    manifests declare about the file (when it was built, with what, the declared model
    range) belongs to the build the point was fetched through, so it sits under
    `fetched_from` with that build's id. Listing facts (publish time, `current`,
    withdrawn) live in the series record, so a corrected publish time never needs a
    re-run.
    """
    manifest = opened.manifest
    # A tagged release's manifest nests its build facts in a "build" object. A build-folder
    # release (microcosm#1534, #1537) names its build there as a string, keeps the facts at the
    # top level, and records the tag it was moved from, if any, in "migrated_from".
    named = manifest.get("build")
    build = named if isinstance(named, Mapping) else {}
    migrated = manifest.get("migrated_from")
    migrated = dict(migrated) if isinstance(migrated, Mapping) else None
    return {
        "fetched_from": {
            "build_id": opened.point.build_id,
            "hf_repo": opened.point.hf_repo,
            "hf_commit": opened.point.hf_commit,
            "release_manifest": {
                "path": opened.manifest_path,
                "sha256": opened.manifest_sha256,
                "json_sha256": json_sha256(manifest),
            },
            "build_manifest": (
                {"path": opened.build_manifest_path, "sha256": opened.build_manifest_sha256}
                if opened.build_manifest_path
                else None
            ),
            "dataset": {"key": opened.artifact.key, "path": opened.artifact.path},
            "declared": {
                "build": build.get("build_id") or (named if isinstance(named, str) else None),
                "cut_tag": build.get("cut_tag") or (migrated or {}).get("tag"),
                "migrated_from": migrated,
                "built_at": build.get("built_at") or manifest.get("built_at"),
                "built_with_model": build.get("built_with_model_package")
                or manifest.get("built_with_model_package"),
                "built_with_core": build.get("built_with_core_package")
                or manifest.get("built_with_core_package"),
                "compatible_models": manifest.get("compatible_model_packages"),
                "reference_model_compatibility": compatibility(
                    manifest, model_package, model_version
                ),
                "description": manifest.get("description"),
                "build_provenance": build_provenance(opened.build_manifest),
            },
        },
        "file": {"sha256": opened.artifact.sha256, "bytes": opened.size_bytes},
    }
