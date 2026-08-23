"""Publish a verified Cross-dataset frontend bundle to the Hugging Face dataset.

The reference layout is the Belgium bundle on
``https://huggingface.co/datasets/policyengine/microcosm-evaluation``::

    <cc>/<run_id>/frontend/{manifest,summary,groups,fact-index}.json
    <cc>/<run_id>/frontend/facts/NNNNN.json
    <cc>/latest.json

``<cc>`` is the dashboard country code for the bundle's jurisdiction. Run
directories are immutable: a re-run of the same bundle is a no-op, and a
differing file under an existing run ID is refused. ``latest.json`` is the only
mutable pointer. The Hugging Face client is imported lazily inside the upload
path so that the script is importable without the ``publish`` extra.

Usage::

    uv run --extra publish python scripts/publish_evaluation_bundle_to_hf.py \\
        --bundle <run>/frontend --jurisdiction US \\
        [--repo policyengine/microcosm-evaluation] [--dry-run] [--no-latest]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, TextIO

from evaluation_harness.frontend_bundle import (
    FRONTEND_BUNDLE_SCHEMA,
    frontend_bundle_partitions,
    verify_frontend_bundle,
)

DEFAULT_REPO = "policyengine/microcosm-evaluation"
REPO_TYPE = "dataset"
REVISION = "main"
HUB_URL = "https://huggingface.co"
LATEST_SCHEMA_VERSION = 1
TOKEN_ENV_VARS = ("HF_TOKEN", "HUGGINGFACE_TOKEN")
BASE_URL_ENV = "CROSS_DATASET_ARTIFACT_BASE_URL"
# Manifest jurisdictions whose dashboard country code is not their lower-case
# form. The dashboard registers Great Britain bundles under ``uk`` and accepts
# ``GB`` as an alias (frontend/lib/cross-dataset/source.ts).
COUNTRY_CODE_ALIASES = {"GB": "uk"}
VERIFY_PARTITIONS = ("manifest.json", "summary.json")
_JURISDICTION = re.compile(r"^[A-Z]{2}$")
_RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_REPO_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$")


class PublishError(Exception):
    """A refusal or verification failure; the message is shown to the operator."""


@dataclass(frozen=True)
class BundleFile:
    """One local file attested by the bundle manifest."""

    relative_path: str
    content: bytes
    size: int
    sha256: str
    git_blob_id: str


@dataclass(frozen=True)
class LocalBundle:
    path: Path
    manifest: dict[str, Any]
    files: tuple[BundleFile, ...]
    ignored: tuple[str, ...]

    @property
    def run_id(self) -> str:
        return str(self.manifest["run_id"])

    @property
    def snapshot_id(self) -> str:
        return str(self.manifest["snapshot_id"])

    @property
    def jurisdictions(self) -> list[str]:
        return list(self.manifest.get("jurisdictions") or [])


@dataclass(frozen=True)
class RemoteFile:
    """A file already present in the dataset repository."""

    path: str
    size: int | None
    blob_id: str | None = None
    sha256: str | None = None


@dataclass(frozen=True)
class Upload:
    path_in_repo: str
    source: bytes
    size: int
    sha256: str


@dataclass(frozen=True)
class PublishPlan:
    repo: str
    jurisdiction: str
    country_code: str
    run_id: str
    snapshot_id: str
    base_path: str
    uploads: tuple[Upload, ...]
    unchanged: tuple[str, ...]
    latest_action: str  # "write", "unchanged", or "skipped"
    previous_latest: dict[str, Any] | None
    extra_remote: tuple[str, ...]
    remote_checked: bool

    @property
    def base_url(self) -> str:
        return resolve_base_url(self.repo, self.base_path)

    @property
    def env_var(self) -> str:
        return base_url_env_name(self.country_code)


class HubClient(Protocol):
    """The subset of the Hub the publisher needs; faked in tests."""

    def head(self) -> str | None: ...

    def list_files(self, prefix: str, *, recursive: bool) -> list[RemoteFile]: ...

    def commit(
        self,
        uploads: Sequence[Upload],
        *,
        message: str,
        description: str | None = None,
        parent_commit: str | None = None,
    ) -> str | None: ...


Fetch = Callable[[str], bytes]


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def git_blob_id(content: bytes) -> str:
    """Return the git blob SHA-1 the Hub reports for a non-LFS file."""

    return hashlib.sha1(b"blob %d\0" % len(content) + content).hexdigest()


def hub_token_from_env(environ: Mapping[str, str] = os.environ) -> str | None:
    for name in TOKEN_ENV_VARS:
        value = environ.get(name, "").strip()
        if value:
            return value
    return None


def dashboard_country_code(jurisdiction: str) -> str:
    """Return the dashboard country code that serves a manifest jurisdiction."""

    return COUNTRY_CODE_ALIASES.get(jurisdiction, jurisdiction.lower())


def base_url_env_name(country_code: str) -> str:
    """Return the dashboard variable for a country's remote bundle (#167)."""

    if country_code == "us":
        return BASE_URL_ENV
    return f"{BASE_URL_ENV}_{country_code.upper()}"


def resolve_base_url(repo: str, base_path: str) -> str:
    return f"{HUB_URL}/datasets/{repo}/resolve/{REVISION}/{base_path}"


def latest_document(
    jurisdiction: str, run_id: str, snapshot_id: str, base_path: str
) -> bytes:
    """Render ``<cc>/latest.json`` byte-for-byte like the published Belgium file."""

    document = {
        "schema_version": LATEST_SCHEMA_VERSION,
        "jurisdiction": jurisdiction,
        "run_id": run_id,
        "snapshot_id": snapshot_id,
        "base_path": base_path,
    }
    return json.dumps(document, indent=1).encode()


def normalize_jurisdiction(value: str) -> str:
    jurisdiction = value.strip().upper()
    if not _JURISDICTION.match(jurisdiction):
        raise PublishError(
            f"jurisdiction must be a two-letter code such as US or BE, not {value!r}"
        )
    return jurisdiction


def load_bundle(bundle_path: str | Path, jurisdiction: str) -> LocalBundle:
    """Verify a bundle directory and hash every file the manifest attests."""

    bundle = Path(bundle_path)
    if not bundle.is_dir():
        raise PublishError(f"bundle directory does not exist: {bundle}")
    manifest_path = bundle / "manifest.json"
    try:
        manifest_content = manifest_path.read_bytes()
    except OSError as error:
        raise PublishError(
            "bundle verification failed: frontend bundle has no manifest.json: "
            f"{bundle}"
        ) from error
    try:
        manifest = verify_frontend_bundle(bundle)
    except ValueError as error:
        raise PublishError(f"bundle verification failed: {error}") from error
    try:
        manifest_changed = manifest_path.read_bytes() != manifest_content
    except OSError as error:
        raise PublishError(
            "bundle manifest changed while it was being loaded"
        ) from error
    if manifest_changed:
        raise PublishError("bundle manifest changed while it was being loaded")
    jurisdictions = manifest.get("jurisdictions") or []
    if jurisdiction not in jurisdictions:
        listed = ", ".join(jurisdictions) or "(none)"
        raise PublishError(
            f"bundle {manifest['run_id']} is for jurisdictions {listed}, "
            f"not {jurisdiction}"
        )
    if not _RUN_ID.match(manifest["run_id"]):
        raise PublishError(f"run_id is not a safe path segment: {manifest['run_id']!r}")
    files = [
        BundleFile(
            relative_path="manifest.json",
            content=manifest_content,
            size=len(manifest_content),
            sha256=_sha256(manifest_content),
            git_blob_id=git_blob_id(manifest_content),
        )
    ]
    for descriptor in frontend_bundle_partitions(manifest):
        relative_path = descriptor["path"]
        local_path = bundle / relative_path
        content = local_path.read_bytes()
        sha256 = _sha256(content)
        if sha256 != descriptor["sha256"]:
            raise PublishError(
                f"bundle partition {relative_path} changed while it was being loaded"
            )
        files.append(
            BundleFile(
                relative_path=relative_path,
                content=content,
                size=len(content),
                sha256=sha256,
                git_blob_id=git_blob_id(content),
            )
        )
    attested = {item.relative_path for item in files}
    ignored = tuple(
        sorted(
            path.relative_to(bundle).as_posix()
            for path in bundle.rglob("*")
            if path.is_file() and path.relative_to(bundle).as_posix() not in attested
        )
    )
    return LocalBundle(
        path=bundle, manifest=manifest, files=tuple(files), ignored=ignored
    )


def _remote_matches(
    remote: RemoteFile, *, size: int, sha256: str, git_blob_id: str
) -> bool:
    """Identical on the Hub: same size and the same LFS SHA-256 or git blob id."""

    if remote.size is not None and remote.size != size:
        return False
    if remote.sha256 is not None:
        return remote.sha256 == sha256
    if remote.blob_id is not None:
        return remote.blob_id == git_blob_id
    return False


def _remote_latest(client: HubClient, country_code: str) -> RemoteFile | None:
    path = f"{country_code}/latest.json"
    for entry in client.list_files(country_code, recursive=False):
        if entry.path == path:
            return entry
    return None


def build_plan(
    bundle: LocalBundle,
    jurisdiction: str,
    *,
    repo: str,
    client: HubClient | None,
    write_latest: bool,
    fetch: Fetch | None = None,
) -> PublishPlan:
    """Compare the bundle with the repository and decide what to upload.

    Without a client (dry run) every attested file is planned for upload and
    the remote state is reported as unchecked.
    """

    country_code = dashboard_country_code(jurisdiction)
    base_path = f"{country_code}/{bundle.run_id}/frontend/"
    latest_path = f"{country_code}/latest.json"
    latest_content = latest_document(
        jurisdiction, bundle.run_id, bundle.snapshot_id, base_path
    )
    latest_upload = Upload(
        path_in_repo=latest_path,
        source=latest_content,
        size=len(latest_content),
        sha256=_sha256(latest_content),
    )
    if client is None:
        uploads = [
            Upload(
                path_in_repo=base_path + item.relative_path,
                source=item.content,
                size=item.size,
                sha256=item.sha256,
            )
            for item in bundle.files
        ]
        if write_latest:
            uploads.append(latest_upload)
        return PublishPlan(
            repo=repo,
            jurisdiction=jurisdiction,
            country_code=country_code,
            run_id=bundle.run_id,
            snapshot_id=bundle.snapshot_id,
            base_path=base_path,
            uploads=tuple(uploads),
            unchanged=(),
            latest_action="write" if write_latest else "skipped",
            previous_latest=None,
            extra_remote=(),
            remote_checked=False,
        )

    remote_by_path = {
        entry.path: entry
        for entry in client.list_files(base_path.rstrip("/"), recursive=True)
    }
    uploads = []
    unchanged = []
    conflicts = []
    for item in bundle.files:
        path_in_repo = base_path + item.relative_path
        remote = remote_by_path.pop(path_in_repo, None)
        if remote is None:
            uploads.append(
                Upload(
                    path_in_repo=path_in_repo,
                    source=item.content,
                    size=item.size,
                    sha256=item.sha256,
                )
            )
        elif _remote_matches(
            remote, size=item.size, sha256=item.sha256, git_blob_id=item.git_blob_id
        ):
            unchanged.append(path_in_repo)
        else:
            conflicts.append(path_in_repo)
    if conflicts:
        raise PublishError(
            f"run {bundle.run_id} is already published under {base_path} with "
            "different content; run directories are immutable. Differing files: "
            + ", ".join(conflicts)
        )
    extra_remote = tuple(sorted(remote_by_path))

    latest_action = "skipped"
    previous_latest: dict[str, Any] | None = None
    if write_latest:
        remote_latest = _remote_latest(client, country_code)
        if remote_latest is None:
            latest_action = "write"
        elif _remote_matches(
            remote_latest,
            size=latest_upload.size,
            sha256=latest_upload.sha256,
            git_blob_id=git_blob_id(latest_content),
        ):
            latest_action = "unchanged"
        else:
            latest_action = "write"
            if fetch is not None:
                previous_latest = _previous_latest(fetch, repo, latest_path)
        if latest_action == "write":
            uploads.append(latest_upload)
    return PublishPlan(
        repo=repo,
        jurisdiction=jurisdiction,
        country_code=country_code,
        run_id=bundle.run_id,
        snapshot_id=bundle.snapshot_id,
        base_path=base_path,
        uploads=tuple(uploads),
        unchanged=tuple(unchanged),
        latest_action=latest_action,
        previous_latest=previous_latest,
        extra_remote=extra_remote,
        remote_checked=True,
    )


def _previous_latest(
    fetch: Fetch, repo: str, latest_path: str
) -> dict[str, Any] | None:
    try:
        document = json.loads(fetch(resolve_base_url(repo, latest_path)))
    except (OSError, ValueError):
        return None
    return document if isinstance(document, dict) else None


def commit_message(plan: PublishPlan) -> tuple[str, str]:
    bundle_uploads = [
        upload
        for upload in plan.uploads
        if upload.path_in_repo.startswith(plan.base_path)
    ]
    if bundle_uploads:
        message = f"Publish {plan.country_code} evaluation bundle {plan.run_id}"
    else:
        message = f"Point {plan.country_code}/latest.json at {plan.run_id}"
    description = "\n".join(
        [
            f"Jurisdiction: {plan.jurisdiction}",
            f"Run: {plan.run_id}",
            f"Snapshot: {plan.snapshot_id}",
            f"Files uploaded: {len(bundle_uploads)}; unchanged: {len(plan.unchanged)}",
            f"latest.json: {plan.latest_action}",
            "Published by scripts/publish_evaluation_bundle_to_hf.py",
        ]
    )
    return message, description


def verify_published(
    plan: PublishPlan,
    bundle: LocalBundle,
    fetch: Fetch,
    *,
    attempts: int = 5,
    delay: float = 2.0,
    sleep: Callable[[float], None] = time.sleep,
) -> list[str]:
    """Re-download the key partitions through the resolve URL and check hashes."""

    expected = {item.relative_path: item.sha256 for item in bundle.files}
    checks = [
        (plan.base_url + name, expected[name], name) for name in VERIFY_PARTITIONS
    ]
    if plan.latest_action == "write":
        content = latest_document(
            plan.jurisdiction, plan.run_id, plan.snapshot_id, plan.base_path
        )
        latest_path = f"{plan.country_code}/latest.json"
        checks.append(
            (resolve_base_url(plan.repo, latest_path), _sha256(content), latest_path)
        )
    verified: list[str] = []
    for url, sha256, label in checks:
        last_error = ""
        for attempt in range(1, attempts + 1):
            try:
                actual = _sha256(fetch(url))
            except OSError as error:
                last_error = str(error)
            else:
                if actual == sha256:
                    verified.append(label)
                    break
                last_error = f"SHA-256 {actual} does not match local {sha256}"
            if attempt < attempts:
                sleep(delay * attempt)
        else:
            raise PublishError(
                f"published file {url} failed verification after {attempts} "
                f"attempts: {last_error}"
            )
    return verified


def http_get(url: str, *, timeout: float = 60.0) -> bytes:
    """Fetch a public resolve URL without credentials, like the dashboard does."""

    request = urllib.request.Request(
        url, headers={"User-Agent": "calibration-diagnostics-publish/1"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        raise OSError(f"{url} returned HTTP {error.code}") from error
    except urllib.error.URLError as error:
        raise OSError(f"{url} is unreachable: {error.reason}") from error


class HfHubClient:
    """Thin adapter over ``huggingface_hub.HfApi``, imported only when used."""

    def __init__(self, repo: str, *, token: str | None = None, api: Any = None) -> None:
        if api is None:
            try:
                from huggingface_hub import HfApi  # optional dependency: publish extra
            except ImportError as error:
                raise PublishError(
                    "huggingface_hub is not installed; run with "
                    "`uv run --extra publish python scripts/...` (the publish extra)"
                ) from error
            api = HfApi(token=token)
        self._api = api
        self._repo = repo

    def head(self) -> str | None:
        info = self._api.repo_info(self._repo, repo_type=REPO_TYPE, revision=REVISION)
        sha = getattr(info, "sha", None)
        return str(sha) if sha else None

    def list_files(self, prefix: str, *, recursive: bool) -> list[RemoteFile]:
        try:
            entries = list(
                self._api.list_repo_tree(
                    self._repo,
                    prefix,
                    recursive=recursive,
                    repo_type=REPO_TYPE,
                    revision=REVISION,
                )
            )
        except Exception as error:
            if _is_entry_not_found(error):
                return []  # the prefix does not exist yet
            raise
        files: list[RemoteFile] = []
        for entry in entries:
            if not hasattr(entry, "blob_id"):
                continue  # folders carry a tree id, not a blob id
            lfs = getattr(entry, "lfs", None)
            if isinstance(lfs, Mapping):
                lfs_sha256 = lfs.get("sha256")
            else:
                lfs_sha256 = getattr(lfs, "sha256", None)
            files.append(
                RemoteFile(
                    path=str(entry.path),
                    size=getattr(entry, "size", None),
                    blob_id=getattr(entry, "blob_id", None),
                    sha256=str(lfs_sha256) if lfs_sha256 else None,
                )
            )
        return files

    def commit(
        self,
        uploads: Sequence[Upload],
        *,
        message: str,
        description: str | None = None,
        parent_commit: str | None = None,
    ) -> str | None:
        from huggingface_hub import CommitOperationAdd  # optional dependency

        operations = [
            CommitOperationAdd(
                path_in_repo=upload.path_in_repo, path_or_fileobj=upload.source
            )
            for upload in uploads
        ]
        info = self._api.create_commit(
            repo_id=self._repo,
            repo_type=REPO_TYPE,
            revision=REVISION,
            operations=operations,
            commit_message=message,
            commit_description=description,
            parent_commit=parent_commit,
        )
        url = getattr(info, "commit_url", None) or getattr(info, "oid", None)
        return str(url) if url else None


def _is_entry_not_found(error: Exception) -> bool:
    try:
        from huggingface_hub.errors import EntryNotFoundError
    except ImportError:  # pragma: no cover - exercised only with a fake API
        return type(error).__name__ in {
            "EntryNotFoundError",
            "RemoteEntryNotFoundError",
        }
    return isinstance(error, EntryNotFoundError)


def _format_size(size: int) -> str:
    return f"{size:,} bytes"


def render_plan(plan: PublishPlan, bundle: LocalBundle, *, dry_run: bool) -> str:
    lines = [
        f"Bundle: {bundle.path}",
        f"  schema: {FRONTEND_BUNDLE_SCHEMA}",
        f"  run_id: {bundle.run_id}",
        f"  snapshot_id: {bundle.snapshot_id}",
        f"  jurisdictions: {', '.join(bundle.jurisdictions)}",
        f"  files: {len(bundle.files)} verified (SHA-256), "
        f"{_format_size(sum(item.size for item in bundle.files))}",
    ]
    for path in bundle.ignored:
        lines.append(f"  ignored: {path} (not listed in manifest.json)")
    lines.append(f"Target: {plan.repo} ({REPO_TYPE}, revision {REVISION})")
    lines.append(f"  base path: {plan.base_path}")
    if dry_run:
        lines.append("Upload plan (dry run; remote state not checked):")
    else:
        lines.append("Upload plan:")
    latest_path = f"{plan.country_code}/latest.json"
    for upload in plan.uploads:
        verb = "write " if upload.path_in_repo == latest_path else "upload"
        lines.append(f"  {verb}  {upload.path_in_repo}  {_format_size(upload.size)}")
    for path in plan.unchanged:
        lines.append(f"  skip    {path}  (identical on the Hub)")
    if plan.latest_action == "unchanged":
        lines.append(f"  skip    {latest_path}  (already points at {plan.run_id})")
    elif plan.latest_action == "skipped":
        lines.append(f"  skip    {latest_path}  (--no-latest)")
    if plan.previous_latest is not None:
        lines.append(
            f"  note    {latest_path} currently points at "
            f"{plan.previous_latest.get('run_id')}"
        )
    for path in plan.extra_remote:
        lines.append(f"  note    {path} exists on the Hub but is not in this bundle")
    return "\n".join(lines)


def render_result(plan: PublishPlan) -> str:
    return "\n".join(
        [
            "Dashboard configuration:",
            f"  {plan.env_var}={plan.base_url}",
        ]
    )


def publish(
    bundle_path: str | Path,
    jurisdiction: str,
    *,
    repo: str = DEFAULT_REPO,
    dry_run: bool = False,
    write_latest: bool = True,
    client: HubClient | None = None,
    fetch: Fetch = http_get,
    environ: Mapping[str, str] = os.environ,
    out: TextIO | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> PublishPlan:
    """Verify, upload, point ``latest.json``, and re-verify one bundle.

    ``client`` and ``fetch`` are injectable so tests run without a network.
    """

    out = sys.stdout if out is None else out
    if not _REPO_ID.match(repo):
        raise PublishError(f"repo must be an owner/name dataset ID, not {repo!r}")
    jurisdiction = normalize_jurisdiction(jurisdiction)
    bundle = load_bundle(bundle_path, jurisdiction)
    if dry_run:
        plan = build_plan(
            bundle, jurisdiction, repo=repo, client=None, write_latest=write_latest
        )
        print(render_plan(plan, bundle, dry_run=True), file=out)
        print(render_result(plan), file=out)
        return plan

    if client is None:
        token = hub_token_from_env(environ)
        if token is None:
            raise PublishError(
                "set HF_TOKEN or HUGGINGFACE_TOKEN to a Hugging Face token with write "
                f"access to {repo} (or use --dry-run)"
            )
        client = HfHubClient(repo, token=token)
    head = client.head()
    plan = build_plan(
        bundle,
        jurisdiction,
        repo=repo,
        client=client,
        write_latest=write_latest,
        fetch=fetch,
    )
    print(render_plan(plan, bundle, dry_run=False), file=out)
    if plan.uploads:
        message, description = commit_message(plan)
        commit = client.commit(
            plan.uploads, message=message, description=description, parent_commit=head
        )
        print(f"Committed {len(plan.uploads)} file(s): {commit or message}", file=out)
    else:
        print("Nothing to upload: the run is already published.", file=out)
    verified = verify_published(plan, bundle, fetch, sleep=sleep)
    print(f"Verified through the resolve URL: {', '.join(verified)}", file=out)
    print(render_result(plan), file=out)
    return plan


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Publish a verified cross_dataset.frontend_bundle.v1 directory to the "
            "Hugging Face evaluation dataset."
        )
    )
    parser.add_argument(
        "--bundle",
        required=True,
        type=Path,
        help="frontend bundle directory (the one containing manifest.json)",
    )
    parser.add_argument(
        "--jurisdiction",
        required=True,
        help="two-letter jurisdiction the bundle must declare, such as US or BE",
    )
    parser.add_argument(
        "--repo",
        default=DEFAULT_REPO,
        help=f"dataset repository (default {DEFAULT_REPO})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="verify the bundle and print the upload plan without network calls",
    )
    parser.add_argument(
        "--no-latest",
        action="store_true",
        help="do not point <cc>/latest.json at this run",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        publish(
            arguments.bundle,
            arguments.jurisdiction,
            repo=arguments.repo,
            dry_run=arguments.dry_run,
            write_latest=not arguments.no_latest,
        )
    except PublishError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
