import email.message
import hashlib
import io
import json
import re
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path

import pytest

from evaluation_harness.microcosm_release import _hf_reader, resolve_microcosm_release


def release_documents() -> dict[str, bytes]:
    release_id = "fixture-release"
    prefix = f"releases/{release_id}"
    return {
        "latest.json": json.dumps(
            {
                "schema_version": 1,
                "release_id": release_id,
                "paths": {
                    "build_manifest": f"{prefix}/build_manifest.json",
                    "release_manifest": f"{prefix}/release_manifest.json",
                    "calibration_diagnostics": (
                        f"{prefix}/calibration_diagnostics.json"
                    ),
                },
            }
        ).encode(),
        f"{prefix}/build_manifest.json": json.dumps(
            {"build_id": release_id}
        ).encode(),
        f"{prefix}/release_manifest.json": json.dumps(
            {"build": {"build_id": release_id}}
        ).encode(),
        f"{prefix}/calibration_diagnostics.json": json.dumps(
            {
                "targets": [
                    {
                        "metadata": {
                            "chronicle_record_ids": ["record-a", "record-b"]
                        }
                    }
                ]
            }
        ).encode(),
    }


RELEASE = "microcosm-be-2025-fixture"
BUILD = "microcosm-be-2025-fixture-20261125T000000Z"
OLDER_BUILD = "microcosm-be-2025-fixture-20261101T000000Z"
OTHER_RELEASE = "microcosm-be-2026-fixture"
OTHER_RELEASE_BUILD = "microcosm-be-2026-fixture-20261120T000000Z"
BUILD_FOLDER = f"releases/{RELEASE}/{BUILD}"
BUILD_FOLDER_PATHS = {
    "build_manifest": f"{BUILD_FOLDER}/build_manifest.json",
    "release_manifest": f"{BUILD_FOLDER}/release_manifest.json",
    "calibration_diagnostics": f"{BUILD_FOLDER}/calibration_diagnostics.json",
}


def published(withdrawn: bool = False) -> dict:
    return {"published_at": "2026-11-25T00:00:00+00:00", "withdrawn": withdrawn}


def releases_record() -> dict:
    """A record whose default release has an older build beside its current
    one, next to a second release with a current build of its own."""

    return {
        "schema_version": 1,
        "default": RELEASE,
        "releases": {
            RELEASE: {
                "role": "national",
                "current": BUILD,
                "builds": {OLDER_BUILD: published(), BUILD: published()},
            },
            OTHER_RELEASE: {
                "role": "national",
                "current": OTHER_RELEASE_BUILD,
                "builds": {OTHER_RELEASE_BUILD: published()},
            },
        },
    }


def build_folder_documents(record: dict | bytes | None = None) -> dict[str, bytes]:
    """A repository with ``releases.json`` that still holds the old layout's
    ``latest.json`` and folder, which naming another build must not matter.

    The build manifest keeps the tagged layout's ``build_id``, as a moved
    build's may: only the release manifest has to name the release and build.
    """

    if record is None:
        record = releases_record()
    record_bytes = record if isinstance(record, bytes) else json.dumps(record).encode()
    return {
        **release_documents(),
        "releases.json": record_bytes,
        BUILD_FOLDER_PATHS["build_manifest"]: json.dumps(
            {"build_id": "legacy-build-id", "chronicle": {"commit": "fixture"}}
        ).encode(),
        BUILD_FOLDER_PATHS["release_manifest"]: json.dumps(
            {"schema_version": 1, "release": RELEASE, "build": BUILD}
        ).encode(),
        BUILD_FOLDER_PATHS["calibration_diagnostics"]: json.dumps(
            {"targets": [{"metadata": {"chronicle_record_ids": ["record-c"]}}]}
        ).encode(),
    }


def reader_of(
    documents: dict[str, bytes], requested: list[str] | None = None
) -> Callable[[str], bytes]:
    """A remote reader that reports an absent file as ``FileNotFoundError``."""

    def read(relative_path: str) -> bytes:
        if requested is not None:
            requested.append(relative_path)
        if relative_path not in documents:
            raise FileNotFoundError(relative_path)
        return documents[relative_path]

    return read


def write_tree(root: Path, documents: dict[str, bytes]) -> None:
    for relative_path, content in documents.items():
        path = root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def test_resolve_microcosm_release_reads_a_local_published_tree(
    tmp_path: Path,
) -> None:
    documents = release_documents()
    write_tree(tmp_path, documents)

    release = resolve_microcosm_release(tmp_path)

    assert release.release_id == "fixture-release"
    assert release.calibration_target_record_ids == {"record-a", "record-b"}
    assert release.provenance == "local_release_directory"
    assert set(release.artifact_sha256) == {
        "latest",
        "build_manifest",
        "release_manifest",
        "calibration_diagnostics",
    }


def test_resolve_microcosm_release_uses_the_same_paths_for_hugging_face() -> None:
    documents = release_documents()
    requested: list[str] = []

    release = resolve_microcosm_release(artifact_reader=reader_of(documents, requested))

    assert release.provenance == "hf:policyengine/populace-be-private@main"
    assert requested == ["releases.json", *documents]


def test_latest_json_layout_keeps_every_output_it_had() -> None:
    documents = release_documents()

    release = resolve_microcosm_release(artifact_reader=reader_of(documents))

    prefix = "releases/fixture-release"
    assert release.release_id == "fixture-release"
    assert release.latest == json.loads(documents["latest.json"])
    assert release.artifact_paths == {
        "build_manifest": f"{prefix}/build_manifest.json",
        "release_manifest": f"{prefix}/release_manifest.json",
        "calibration_diagnostics": f"{prefix}/calibration_diagnostics.json",
    }
    assert release.artifact_sha256 == {
        "latest": sha256(documents["latest.json"]),
        **{
            label: sha256(documents[path])
            for label, path in release.artifact_paths.items()
        },
    }


def test_resolve_microcosm_release_rejects_path_traversal() -> None:
    documents = release_documents()
    latest = json.loads(documents["latest.json"])
    latest["paths"]["build_manifest"] = "../build_manifest.json"
    documents["latest.json"] = json.dumps(latest).encode()

    with pytest.raises(ValueError, match="unsafe path"):
        resolve_microcosm_release(artifact_reader=reader_of(documents))


def test_releases_json_selects_the_current_build_of_the_default_release() -> None:
    documents = build_folder_documents()
    requested: list[str] = []

    release = resolve_microcosm_release(artifact_reader=reader_of(documents, requested))

    assert requested == ["releases.json", *BUILD_FOLDER_PATHS.values()]
    assert release.release_id == f"{RELEASE}/{BUILD}"
    assert release.artifact_paths == BUILD_FOLDER_PATHS
    assert release.artifact_sha256 == {
        label: sha256(documents[path]) for label, path in BUILD_FOLDER_PATHS.items()
    }
    assert release.calibration_target_record_ids == {"record-c"}
    assert release.provenance == "hf:policyengine/populace-be-private@main"
    assert release.latest is None
    assert release.releases_record == releases_record()


def test_releases_json_layout_reads_a_local_directory(tmp_path: Path) -> None:
    documents = build_folder_documents()
    write_tree(tmp_path, documents)

    release = resolve_microcosm_release(tmp_path)

    assert release.release_id == f"{RELEASE}/{BUILD}"
    assert release.artifact_paths == BUILD_FOLDER_PATHS
    assert release.calibration_target_record_ids == {"record-c"}
    assert release.provenance == "local_release_directory"


def http_error(code: int, error_code: str | None) -> urllib.error.HTTPError:
    headers = email.message.Message()
    if error_code is not None:
        headers["X-Error-Code"] = error_code
    return urllib.error.HTTPError(
        "https://huggingface.co/fixture", code, "fixture", headers, io.BytesIO(b"")
    )


@pytest.mark.parametrize(
    "error",
    [
        http_error(401, None),
        http_error(403, None),
        http_error(404, "RevisionNotFound"),
        http_error(404, "RepoNotFound"),
        http_error(503, None),
        urllib.error.URLError("timed out"),
        PermissionError("releases.json"),
    ],
    ids=["401", "403", "revision", "repository", "503", "network", "permission"],
)
def test_only_an_absent_releases_json_selects_latest_json(error: OSError) -> None:
    documents = release_documents()
    requested: list[str] = []
    serve = reader_of(documents, requested)

    def read(relative_path: str) -> bytes:
        if relative_path == "releases.json":
            requested.append(relative_path)
            raise error
        return serve(relative_path)

    with pytest.raises(type(error)):
        resolve_microcosm_release(artifact_reader=read)
    assert requested == ["releases.json"]


def without_default(record: dict) -> None:
    record["default"] = None


def without_current_build(record: dict) -> None:
    record["releases"][RELEASE]["current"] = None


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (without_default, "names no default release"),
        (without_current_build, f"no current build of its default release {RELEASE}"),
    ],
    ids=["no default", "no current build"],
)
def test_releases_json_without_a_current_default_build_is_refused(
    change: Callable[[dict], None], message: str
) -> None:
    record = releases_record()
    change(record)

    with pytest.raises(ValueError, match=message):
        resolve_microcosm_release(
            artifact_reader=reader_of(build_folder_documents(record))
        )


@pytest.mark.parametrize(
    "manifest",
    [
        {"schema_version": 1, "release": RELEASE, "build": OLDER_BUILD},
        {"schema_version": 1, "release": OTHER_RELEASE, "build": BUILD},
        {"schema_version": 1, "build": {"build_id": BUILD}},
        {"schema_version": 1},
    ],
    ids=["another build", "another release", "tagged layout", "unnamed"],
)
def test_release_manifest_must_name_the_selected_release_and_build(
    manifest: dict,
) -> None:
    documents = build_folder_documents()
    documents[BUILD_FOLDER_PATHS["release_manifest"]] = json.dumps(manifest).encode()

    with pytest.raises(ValueError, match="does not name release"):
        resolve_microcosm_release(artifact_reader=reader_of(documents))


def record_bytes(change: Callable[[dict], None]) -> bytes:
    record = releases_record()
    change(record)
    return json.dumps(record).encode()


def assign(*keys: str, value: object) -> Callable[[dict], None]:
    def change(record: dict) -> None:
        target = record
        for key in keys[:-1]:
            target = target[key]
        target[keys[-1]] = value

    return change


def remove(*keys: str) -> Callable[[dict], None]:
    def change(record: dict) -> None:
        target = record
        for key in keys[:-1]:
            target = target[key]
        del target[keys[-1]]

    return change


def rename_release(new_name: str) -> Callable[[dict], None]:
    def change(record: dict) -> None:
        record["releases"][new_name] = record["releases"].pop(OTHER_RELEASE)

    return change


def rename_build(new_name: str) -> Callable[[dict], None]:
    def change(record: dict) -> None:
        builds = record["releases"][OTHER_RELEASE]["builds"]
        builds[new_name] = builds.pop(OTHER_RELEASE_BUILD)
        record["releases"][OTHER_RELEASE]["current"] = None

    return change


BROKEN_RECORDS = {
    "larger than 4 MiB": (
        b" " * (4 * 1024 * 1024) + json.dumps(releases_record()).encode(),
        "larger than 4194304 bytes",
    ),
    "not JSON": (b'{"schema_version": 1,', "not a readable JSON document"),
    "invalid UTF-8": (b'{"default": "\xff"}', "not a readable JSON document"),
    "nested too deeply": (
        b"[" * 100_000 + b"]" * 100_000,
        "not a readable JSON document",
    ),
    "NaN": (
        json.dumps(releases_record())
        .replace('"schema_version": 1', '"schema_version": NaN')
        .encode(),
        "not a readable JSON document",
    ),
    "not an object": (b"[]", "must have exactly default, releases, schema_version"),
    "extra key": (
        record_bytes(assign("extra", value=1)),
        "must have exactly default, releases, schema_version",
    ),
    "missing key": (
        record_bytes(remove("default")),
        "must have exactly default, releases, schema_version",
    ),
    "schema_version 2": (
        record_bytes(assign("schema_version", value=2)),
        "schema_version must be 1",
    ),
    "schema_version true": (
        record_bytes(assign("schema_version", value=True)),
        "schema_version must be 1",
    ),
    "releases not an object": (
        record_bytes(assign("releases", value=[])),
        "releases must be an object",
    ),
    "unsafe release name": (
        record_bytes(rename_release("../escape")),
        "a release name is not a safe identifier",
    ),
    "release missing key": (
        record_bytes(remove("releases", OTHER_RELEASE, "role")),
        f"release {OTHER_RELEASE} must have builds, current, role",
    ),
    "invalid role": (
        record_bytes(assign("releases", OTHER_RELEASE, "role", value="National")),
        f"release {OTHER_RELEASE} has an invalid role",
    ),
    "current not a string": (
        record_bytes(assign("releases", OTHER_RELEASE, "current", value=1)),
        f"release {OTHER_RELEASE} current must be a build or null",
    ),
    "builds not an object": (
        record_bytes(assign("releases", OTHER_RELEASE, "builds", value=[])),
        f"release {OTHER_RELEASE} builds must be an object",
    ),
    "unsafe build name": (
        record_bytes(rename_build("a/b")),
        "a build name is not a safe identifier",
    ),
    "build missing withdrawn": (
        record_bytes(
            remove("releases", OTHER_RELEASE, "builds", OTHER_RELEASE_BUILD, "withdrawn")
        ),
        f"build {OTHER_RELEASE_BUILD} of {OTHER_RELEASE} is malformed",
    ),
    "empty published_at": (
        record_bytes(
            assign(
                "releases", OTHER_RELEASE, "builds", OTHER_RELEASE_BUILD,
                "published_at", value="",
            )
        ),
        f"build {OTHER_RELEASE_BUILD} of {OTHER_RELEASE} is malformed",
    ),
    "withdrawn not a boolean": (
        record_bytes(
            assign(
                "releases", OTHER_RELEASE, "builds", OTHER_RELEASE_BUILD,
                "withdrawn", value="false",
            )
        ),
        f"build {OTHER_RELEASE_BUILD} of {OTHER_RELEASE} is malformed",
    ),
    "default not a string": (
        record_bytes(assign("default", value=1)),
        "default must be a release name or null",
    ),
    "default not listed": (
        record_bytes(assign("default", value="microcosm-be-2099")),
        "default microcosm-be-2099 is not listed",
    ),
    "current not listed": (
        record_bytes(
            assign("releases", OTHER_RELEASE, "current", value="unlisted-build")
        ),
        f"current build unlisted-build of {OTHER_RELEASE} is not listed",
    ),
    "current withdrawn": (
        record_bytes(
            assign(
                "releases", OTHER_RELEASE, "builds", OTHER_RELEASE_BUILD,
                "withdrawn", value=True,
            )
        ),
        f"current build {OTHER_RELEASE_BUILD} of {OTHER_RELEASE} is withdrawn",
    ),
}


@pytest.mark.parametrize(
    ("content", "message"), list(BROKEN_RECORDS.values()), ids=list(BROKEN_RECORDS)
)
def test_releases_json_breaking_the_record_rules_is_refused(
    content: bytes, message: str
) -> None:
    """Each record is refused by its own rule, named in the message."""

    with pytest.raises(ValueError, match=re.escape(f"releases.json: {message}")):
        resolve_microcosm_release(
            artifact_reader=reader_of(build_folder_documents(content))
        )


def test_releases_json_with_a_leading_byte_order_mark_is_read() -> None:
    content = b"\xef\xbb\xbf" + json.dumps(releases_record()).encode()

    release = resolve_microcosm_release(
        artifact_reader=reader_of(build_folder_documents(content))
    )

    assert release.release_id == f"{RELEASE}/{BUILD}"


def make_directory(record_path: Path) -> None:
    record_path.mkdir()


def make_broken_link(record_path: Path) -> None:
    record_path.symlink_to(record_path.parent / "missing-blob")


def make_link_loop(record_path: Path) -> None:
    record_path.symlink_to(record_path)


@pytest.mark.parametrize(
    "make_record_path",
    [make_directory, make_broken_link, make_link_loop],
    ids=["directory", "broken link", "link loop"],
)
def test_local_releases_json_that_is_not_a_regular_file_is_refused(
    tmp_path: Path, make_record_path: Callable[[Path], None]
) -> None:
    write_tree(tmp_path, release_documents())
    make_record_path(tmp_path / "releases.json")

    with pytest.raises(ValueError, match="releases.json is not a regular file"):
        resolve_microcosm_release(tmp_path)


def test_local_releases_json_may_be_a_link_to_a_file(tmp_path: Path) -> None:
    """A Hugging Face cache snapshot links each file to a blob elsewhere."""

    snapshot = tmp_path / "snapshot"
    documents = build_folder_documents()
    write_tree(snapshot, {
        path: content for path, content in documents.items() if path != "releases.json"
    })
    blob = tmp_path / "blobs" / "releases-record"
    blob.parent.mkdir()
    blob.write_bytes(documents["releases.json"])
    (snapshot / "releases.json").symlink_to(blob)

    release = resolve_microcosm_release(snapshot)

    assert release.release_id == f"{RELEASE}/{BUILD}"


def test_latest_json_layout_refuses_a_release_manifest_build_that_is_not_an_object() -> None:
    documents = release_documents()
    documents["releases/fixture-release/release_manifest.json"] = json.dumps(
        {"build": "fixture-release"}
    ).encode()

    with pytest.raises(ValueError, match="do not match latest release_id"):
        resolve_microcosm_release(artifact_reader=reader_of(documents))


def test_hugging_face_reader_reports_an_absent_file_as_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def urlopen(request: urllib.request.Request):
        raise http_error(404, "EntryNotFound")

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    read = _hf_reader("policyengine/populace-be-private", "main")

    with pytest.raises(FileNotFoundError, match="releases.json"):
        read("releases.json")


@pytest.mark.parametrize(
    "error",
    [
        http_error(404, "RevisionNotFound"),
        http_error(404, "RepoNotFound"),
        http_error(404, None),
        http_error(401, "EntryNotFound"),
        http_error(503, None),
    ],
    ids=["revision", "repository", "unlabelled 404", "401", "503"],
)
def test_hugging_face_reader_raises_every_other_failure(
    monkeypatch: pytest.MonkeyPatch, error: urllib.error.HTTPError
) -> None:
    def urlopen(request: urllib.request.Request):
        raise error

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    read = _hf_reader("policyengine/populace-be-private", "main")

    with pytest.raises(urllib.error.HTTPError) as raised:
        read("releases.json")
    assert raised.value is error
    assert not isinstance(raised.value, FileNotFoundError)
