import hashlib
import io
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from evaluation_harness.frontend_bundle import FRONTEND_BUNDLE_SCHEMA
from scripts.publish_evaluation_bundle_to_hf import (
    BASE_URL_ENV,
    DEFAULT_REPO,
    HUB_URL,
    HfHubClient,
    PublishError,
    RemoteFile,
    Upload,
    _remote_matches,
    base_url_env_name,
    dashboard_country_code,
    git_blob_id,
    hub_token_from_env,
    latest_document,
    load_bundle,
    main,
    publish,
)

RUN_ID = "evaluation-0123456789abcdef01234567"
SNAPSHOT_ID = "chronicle-0123456789abcdef01234567"
OLD_RUN_ID = "evaluation-fedcba9876543210fedcba98"


def _document(value: dict[str, Any]) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def write_bundle(
    root: Path,
    *,
    run_id: str = RUN_ID,
    snapshot_id: str = SNAPSHOT_ID,
    jurisdictions: tuple[str, ...] = ("BE",),
    page_counts: tuple[int, ...] = (2, 1),
) -> Path:
    """Write a minimal but fully valid cross_dataset.frontend_bundle.v1 directory."""

    common = {
        "schema_version": FRONTEND_BUNDLE_SCHEMA,
        "run_id": run_id,
        "snapshot_id": snapshot_id,
        "jurisdictions": list(jurisdictions),
    }

    def write(relative: str, document: dict[str, Any]) -> dict[str, str]:
        content = _document(document)
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return {"path": relative, "sha256": hashlib.sha256(content).hexdigest()}

    fact_count = sum(page_counts)
    summary = write(
        "summary.json",
        {**common, "fact_count": fact_count, "matrix_complete": True, "sources": []},
    )
    groups = write("groups.json", {**common, "groups": []})
    index = write("fact-index.json", {**common, "facts": {}, "facets": {}})
    facts = []
    for page, count in enumerate(page_counts, start=1):
        partition = write(
            f"facts/{page:05d}.json",
            {
                **common,
                "page": page,
                "page_size": max(page_counts),
                "total": fact_count,
                "rows": [{"fact_key": f"fact-{page}-{row}"} for row in range(count)],
            },
        )
        facts.append({"page": page, "count": count, **partition})
    manifest = {
        **common,
        "fact_count": fact_count,
        "source_ids": [],
        "page_size": max(page_counts),
        "page_count": len(page_counts),
        "partitions": {
            "summary": summary,
            "groups": groups,
            "fact_index": index,
            "facts": facts,
        },
    }
    (root / "manifest.json").write_bytes(_document(manifest))
    return root


def bundle_paths(bundle: Path, prefix: str) -> dict[str, bytes]:
    manifest = json.loads((bundle / "manifest.json").read_bytes())
    relative = ["manifest.json", "summary.json", "groups.json", "fact-index.json"]
    relative.extend(part["path"] for part in manifest["partitions"]["facts"])
    return {prefix + name: (bundle / name).read_bytes() for name in relative}


class FakeHub:
    """In-memory stand-in for the Hub: blob ids and resolve URLs, no network."""

    def __init__(
        self, files: dict[str, bytes] | None = None, repo: str = DEFAULT_REPO
    ) -> None:
        self.files = dict(files or {})
        self.repo = repo
        self.commits: list[dict[str, Any]] = []

    def head(self) -> str:
        return f"head-{len(self.commits)}"

    def list_files(self, prefix: str, *, recursive: bool) -> list[RemoteFile]:
        base = prefix.rstrip("/") + "/"
        listed = []
        for path, content in sorted(self.files.items()):
            if not path.startswith(base):
                continue
            if not recursive and "/" in path[len(base) :]:
                continue
            listed.append(
                RemoteFile(path=path, size=len(content), blob_id=git_blob_id(content))
            )
        return listed

    def commit(
        self,
        uploads: list[Upload],
        *,
        message: str,
        description: str | None = None,
        parent_commit: str | None = None,
    ) -> str:
        for upload in uploads:
            source = upload.source
            content = source if isinstance(source, bytes) else Path(source).read_bytes()
            self.files[upload.path_in_repo] = content
        self.commits.append(
            {
                "message": message,
                "description": description,
                "parent_commit": parent_commit,
                "paths": [upload.path_in_repo for upload in uploads],
            }
        )
        return f"{HUB_URL}/datasets/{self.repo}/commit/{len(self.commits)}"

    def fetch(self, url: str) -> bytes:
        prefix = f"{HUB_URL}/datasets/{self.repo}/resolve/main/"
        if not url.startswith(prefix) or url[len(prefix) :] not in self.files:
            raise OSError(f"{url} returned HTTP 404")
        return self.files[url[len(prefix) :]]


def run_publish(bundle: Path, hub: FakeHub, jurisdiction: str = "BE", **kwargs: Any):
    out = io.StringIO()
    plan = publish(
        bundle,
        jurisdiction,
        client=hub,
        fetch=hub.fetch,
        out=out,
        sleep=lambda _seconds: None,
        **kwargs,
    )
    return plan, out.getvalue()


def test_dry_run_verifies_and_prints_the_plan_without_a_client(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path / "frontend")
    out = io.StringIO()

    plan = publish(bundle, "be", dry_run=True, out=out, environ={})

    text = out.getvalue()
    prefix = f"be/{RUN_ID}/frontend/"
    assert plan.remote_checked is False
    assert plan.base_path == prefix
    assert [upload.path_in_repo for upload in plan.uploads] == [
        *(prefix + name for name in ("manifest.json", "summary.json", "groups.json")),
        prefix + "fact-index.json",
        prefix + "facts/00001.json",
        prefix + "facts/00002.json",
        "be/latest.json",
    ]
    assert "dry run; remote state not checked" in text
    assert f"upload  {prefix}facts/00002.json" in text
    assert "write   be/latest.json" in text
    assert (
        f"CROSS_DATASET_ARTIFACT_BASE_URL_BE={HUB_URL}/datasets/{DEFAULT_REPO}"
        f"/resolve/main/{prefix}"
    ) in text


def test_bundle_hash_mismatch_is_refused(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path / "frontend")
    (bundle / "facts" / "00002.json").write_bytes(b'{"tampered": true}\n')

    with pytest.raises(PublishError, match="hash mismatch for facts/00002.json"):
        publish(bundle, "BE", dry_run=True)


def test_unsupported_schema_is_refused(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path / "frontend")
    manifest = json.loads((bundle / "manifest.json").read_bytes())
    manifest["schema_version"] = "cross_dataset.frontend_bundle.v2"
    (bundle / "manifest.json").write_bytes(_document(manifest))

    with pytest.raises(PublishError, match="unsupported frontend bundle schema"):
        publish(bundle, "BE", dry_run=True)


def test_partition_from_another_run_is_refused(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path / "frontend")
    other = write_bundle(tmp_path / "other", run_id=OLD_RUN_ID)
    manifest = json.loads((bundle / "manifest.json").read_bytes())
    content = (other / "groups.json").read_bytes()
    (bundle / "groups.json").write_bytes(content)
    manifest["partitions"]["groups"]["sha256"] = hashlib.sha256(content).hexdigest()
    (bundle / "manifest.json").write_bytes(_document(manifest))

    with pytest.raises(PublishError, match="belongs to another run"):
        publish(bundle, "BE", dry_run=True)


def test_jurisdiction_mismatch_is_refused(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path / "frontend", jurisdictions=("BE",))

    with pytest.raises(PublishError, match="for jurisdictions BE, not US"):
        publish(bundle, "US", dry_run=True)
    with pytest.raises(PublishError, match="two-letter code"):
        publish(bundle, "Belgium", dry_run=True)


def test_files_outside_the_manifest_are_ignored_not_uploaded(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path / "frontend")
    (bundle / ".DS_Store").write_bytes(b"junk")
    (bundle / "facts" / "notes.txt").write_text("scratch")

    loaded = load_bundle(bundle, "BE")
    hub = FakeHub()
    _, text = run_publish(bundle, hub)

    assert loaded.ignored == (".DS_Store", "facts/notes.txt")
    assert "ignored: .DS_Store (not listed in manifest.json)" in text
    assert not any(path.endswith((".DS_Store", "notes.txt")) for path in hub.files)


def test_publish_uploads_the_run_and_points_latest_at_it(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path / "frontend")
    hub = FakeHub()

    plan, text = run_publish(bundle, hub)

    prefix = f"be/{RUN_ID}/frontend/"
    expected = bundle_paths(bundle, prefix)
    assert {path: hub.files[path] for path in expected} == expected
    assert json.loads(hub.files["be/latest.json"]) == {
        "schema_version": 1,
        "jurisdiction": "BE",
        "run_id": RUN_ID,
        "snapshot_id": SNAPSHOT_ID,
        "base_path": prefix,
    }
    assert hub.files["be/latest.json"] == latest_document(
        "BE", RUN_ID, SNAPSHOT_ID, prefix
    )
    assert len(hub.commits) == 1
    commit = hub.commits[0]
    assert commit["message"] == f"Publish be evaluation bundle {RUN_ID}"
    assert commit["parent_commit"] == "head-0"
    assert commit["paths"] == [*expected, "be/latest.json"]
    assert plan.latest_action == "write"
    assert (
        "Verified through the resolve URL: manifest.json, summary.json, be/latest.json"
        in text
    )
    assert (
        f"CROSS_DATASET_ARTIFACT_BASE_URL_BE={HUB_URL}/datasets/{DEFAULT_REPO}"
        f"/resolve/main/{prefix}"
    ) in text


def test_rerun_of_a_published_bundle_is_a_no_op(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path / "frontend")
    hub = FakeHub()
    run_publish(bundle, hub)
    before = dict(hub.files)

    plan, text = run_publish(bundle, hub)

    assert hub.files == before
    assert len(hub.commits) == 1
    assert plan.uploads == ()
    assert len(plan.unchanged) == 6
    assert plan.latest_action == "unchanged"
    assert "Nothing to upload: the run is already published." in text
    assert f"skip    be/{RUN_ID}/frontend/summary.json  (identical on the Hub)" in text
    assert f"skip    be/latest.json  (already points at {RUN_ID})" in text
    assert "Verified through the resolve URL: manifest.json, summary.json" in text


def test_partial_upload_is_completed_without_touching_existing_files(
    tmp_path: Path,
) -> None:
    bundle = write_bundle(tmp_path / "frontend")
    prefix = f"be/{RUN_ID}/frontend/"
    everything = bundle_paths(bundle, prefix)
    partial = {
        path: content
        for path, content in everything.items()
        if not path.endswith("facts/00002.json")
    }
    hub = FakeHub(partial)

    plan, _ = run_publish(bundle, hub)

    assert [upload.path_in_repo for upload in plan.uploads] == [
        prefix + "facts/00002.json",
        "be/latest.json",
    ]
    assert hub.commits[0]["paths"] == [prefix + "facts/00002.json", "be/latest.json"]
    assert {path: hub.files[path] for path in everything} == everything


def test_differing_file_under_an_existing_run_is_refused(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path / "frontend")
    prefix = f"be/{RUN_ID}/frontend/"
    published = bundle_paths(bundle, prefix)
    published[prefix + "summary.json"] = b'{"different": true}\n'
    hub = FakeHub(published)

    with pytest.raises(PublishError, match="immutable") as error:
        run_publish(bundle, hub)

    assert prefix + "summary.json" in str(error.value)
    assert hub.commits == []
    assert "be/latest.json" not in hub.files


def test_same_size_different_content_is_still_a_conflict(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path / "frontend")
    prefix = f"be/{RUN_ID}/frontend/"
    published = bundle_paths(bundle, prefix)
    original = published[prefix + "groups.json"]
    published[prefix + "groups.json"] = original[:-2] + b"]\n"
    assert len(published[prefix + "groups.json"]) == len(original)
    hub = FakeHub(published)

    with pytest.raises(PublishError, match="groups.json"):
        run_publish(bundle, hub)


def test_no_latest_leaves_the_pointer_alone(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path / "frontend")
    old_pointer = latest_document(
        "BE", OLD_RUN_ID, SNAPSHOT_ID, f"be/{OLD_RUN_ID}/frontend/"
    )
    hub = FakeHub({"be/latest.json": old_pointer})

    plan, text = run_publish(bundle, hub, write_latest=False)

    assert plan.latest_action == "skipped"
    assert hub.files["be/latest.json"] == old_pointer
    assert "be/latest.json" not in hub.commits[0]["paths"]
    assert "skip    be/latest.json  (--no-latest)" in text
    assert "Verified through the resolve URL: manifest.json, summary.json\n" in text


def test_latest_pointer_moves_from_the_previous_run(tmp_path: Path) -> None:
    old_bundle = write_bundle(tmp_path / "old", run_id=OLD_RUN_ID)
    hub = FakeHub()
    run_publish(old_bundle, hub)
    bundle = write_bundle(tmp_path / "frontend")

    plan, text = run_publish(bundle, hub)

    assert plan.latest_action == "write"
    assert plan.previous_latest["run_id"] == OLD_RUN_ID
    assert f"note    be/latest.json currently points at {OLD_RUN_ID}" in text
    assert json.loads(hub.files["be/latest.json"])["run_id"] == RUN_ID
    # The previous run directory is untouched.
    old_prefix = f"be/{OLD_RUN_ID}/frontend/"
    assert {path: hub.files[path] for path in bundle_paths(old_bundle, old_prefix)} == (
        bundle_paths(old_bundle, old_prefix)
    )


def test_latest_only_commit_when_the_run_is_already_present(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path / "frontend")
    hub = FakeHub(bundle_paths(bundle, f"be/{RUN_ID}/frontend/"))

    plan, _ = run_publish(bundle, hub)

    assert [upload.path_in_repo for upload in plan.uploads] == ["be/latest.json"]
    assert hub.commits[0]["message"] == f"Point be/latest.json at {RUN_ID}"


def test_extra_remote_files_under_the_run_are_reported(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path / "frontend")
    prefix = f"be/{RUN_ID}/frontend/"
    hub = FakeHub(
        {**bundle_paths(bundle, prefix), prefix + "facts/00003.json": b"{}\n"}
    )

    plan, text = run_publish(bundle, hub)

    assert plan.extra_remote == (prefix + "facts/00003.json",)
    assert (
        f"note    {prefix}facts/00003.json exists on the Hub but is not in this bundle"
        in text
    )


def test_post_upload_verification_failure_is_an_error(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path / "frontend")
    hub = FakeHub()
    attempts: list[str] = []

    def stale_fetch(url: str) -> bytes:
        attempts.append(url)
        if url.endswith("summary.json"):
            return b"stale cdn copy"
        return hub.fetch(url)

    with pytest.raises(PublishError, match="summary.json failed verification after 5"):
        publish(
            bundle,
            "BE",
            client=hub,
            fetch=stale_fetch,
            out=io.StringIO(),
            sleep=lambda _seconds: None,
        )

    assert len(hub.commits) == 1
    assert sum(url.endswith("summary.json") for url in attempts) == 5


def test_publish_verifies_latest_and_retries_propagation(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path / "frontend")
    hub = FakeHub()
    misses = {"count": 0}
    waits: list[float] = []

    def eventually_fetch(url: str) -> bytes:
        if url.endswith("manifest.json") and misses["count"] < 2:
            misses["count"] += 1
            raise OSError(f"{url} returned HTTP 404")
        return hub.fetch(url)

    out = io.StringIO()
    publish(
        bundle, "BE", client=hub, fetch=eventually_fetch, out=out, sleep=waits.append
    )

    assert waits == [2.0, 4.0]
    assert (
        "Verified through the resolve URL: manifest.json, summary.json, be/latest.json"
        in (out.getvalue())
    )


@pytest.mark.parametrize(
    ("jurisdiction", "country_code", "env_var"),
    [
        ("US", "us", BASE_URL_ENV),
        ("BE", "be", f"{BASE_URL_ENV}_BE"),
        ("UK", "uk", f"{BASE_URL_ENV}_UK"),
        ("GB", "uk", f"{BASE_URL_ENV}_UK"),
    ],
)
def test_dashboard_variable_naming_matches_the_frontend(
    tmp_path: Path, jurisdiction: str, country_code: str, env_var: str
) -> None:
    assert dashboard_country_code(jurisdiction) == country_code
    assert base_url_env_name(country_code) == env_var
    bundle = write_bundle(tmp_path / "frontend", jurisdictions=(jurisdiction,))
    out = io.StringIO()

    plan = publish(bundle, jurisdiction.lower(), dry_run=True, out=out)

    base_url = (
        f"{HUB_URL}/datasets/{DEFAULT_REPO}/resolve/main/"
        f"{country_code}/{RUN_ID}/frontend/"
    )
    assert plan.country_code == country_code
    assert plan.env_var == env_var
    assert plan.base_url == base_url
    assert f"  {env_var}={base_url}" in out.getvalue()
    assert json.loads(plan.uploads[-1].source)["jurisdiction"] == jurisdiction


def test_latest_document_reproduces_the_published_belgium_pointer() -> None:
    # Captured from be/latest.json on the live dataset (blob b409101a...).
    content = latest_document(
        "BE",
        "evaluation-f28ca06a0b0d2baf13c87f2f",
        "chronicle-82b574e3a8526ce0718ad08d",
        "be/evaluation-f28ca06a0b0d2baf13c87f2f/frontend/",
    )

    assert content == (
        b'{\n "schema_version": 1,\n "jurisdiction": "BE",\n'
        b' "run_id": "evaluation-f28ca06a0b0d2baf13c87f2f",\n'
        b' "snapshot_id": "chronicle-82b574e3a8526ce0718ad08d",\n'
        b' "base_path": "be/evaluation-f28ca06a0b0d2baf13c87f2f/frontend/"\n}'
    )
    assert len(content) == 217
    assert git_blob_id(content) == "b409101a699bdb50f57501072fa2e5b62f7e1932"


def test_remote_identity_uses_size_with_lfs_sha256_or_git_blob_id() -> None:
    content = b'{"a":1}\n'
    size = len(content)
    sha256 = hashlib.sha256(content).hexdigest()
    blob_id = git_blob_id(content)

    def matches(remote: RemoteFile) -> bool:
        return _remote_matches(remote, size=size, sha256=sha256, git_blob_id=blob_id)

    assert matches(RemoteFile("x", size, blob_id=blob_id))
    assert matches(RemoteFile("x", size, sha256=sha256))
    assert matches(RemoteFile("x", None, sha256=sha256))
    assert not matches(RemoteFile("x", size + 1, blob_id=blob_id))
    assert not matches(RemoteFile("x", size, blob_id="0" * 40))
    assert not matches(RemoteFile("x", size, blob_id=blob_id, sha256="0" * 64))
    assert not matches(RemoteFile("x", size))


def test_token_comes_only_from_the_environment(tmp_path: Path) -> None:
    assert hub_token_from_env({}) is None
    assert hub_token_from_env({"HF_TOKEN": " hf_abc "}) == "hf_abc"
    assert hub_token_from_env({"HUGGINGFACE_TOKEN": "hf_def"}) == "hf_def"
    assert (
        hub_token_from_env({"HF_TOKEN": "", "HUGGINGFACE_TOKEN": "hf_def"}) == "hf_def"
    )
    bundle = write_bundle(tmp_path / "frontend")

    with pytest.raises(PublishError, match="HF_TOKEN or HUGGINGFACE_TOKEN"):
        publish(bundle, "BE", environ={}, out=io.StringIO())


def test_repo_id_is_validated(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path / "frontend")

    with pytest.raises(PublishError, match="owner/name"):
        publish(bundle, "BE", repo="not-a-repo", dry_run=True)


def test_cli_exit_codes(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    bundle = write_bundle(tmp_path / "frontend")

    assert main(["--bundle", str(bundle), "--jurisdiction", "be", "--dry-run"]) == 0
    assert "be/latest.json" in capsys.readouterr().out
    assert (
        main(
            [
                "--bundle",
                str(bundle),
                "--jurisdiction",
                "US",
                "--dry-run",
                "--no-latest",
            ]
        )
        == 1
    )
    captured = capsys.readouterr()
    assert captured.err.startswith("error: bundle ")
    assert "not US" in captured.err


def test_cli_no_latest_drops_the_pointer_from_the_plan(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    bundle = write_bundle(tmp_path / "frontend")

    assert (
        main(
            [
                "--bundle",
                str(bundle),
                "--jurisdiction",
                "BE",
                "--dry-run",
                "--no-latest",
            ]
        )
        == 0
    )
    text = capsys.readouterr().out
    assert "write   be/latest.json" not in text
    assert "skip    be/latest.json  (--no-latest)" in text


@dataclass
class FakeRepoFile:
    path: str
    size: int
    blob_id: str
    lfs: dict[str, Any] | None = None


@dataclass
class FakeRepoFolder:
    path: str
    tree_id: str


class FakeHfApi:
    """Mimics the HfApi calls the adapter makes; installs nothing, sends nothing."""

    def __init__(self, entries: dict[str, list[Any]]) -> None:
        self.entries = entries
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def repo_info(self, repo_id: str, **kwargs: Any) -> Any:
        self.calls.append(("repo_info", {"repo_id": repo_id, **kwargs}))
        return type("Info", (), {"sha": "abc123"})()

    def list_repo_tree(
        self, repo_id: str, path_in_repo: str, **kwargs: Any
    ) -> list[Any]:
        from huggingface_hub.errors import EntryNotFoundError

        self.calls.append(
            ("list_repo_tree", {"repo_id": repo_id, "path": path_in_repo, **kwargs})
        )
        if path_in_repo not in self.entries:
            raise EntryNotFoundError("Entry Not Found")
        return self.entries[path_in_repo]

    def create_commit(self, **kwargs: Any) -> Any:
        self.calls.append(("create_commit", kwargs))
        return type("CommitInfo", (), {"commit_url": "https://huggingface.co/c/1"})()


def test_hf_hub_client_adapts_hfapi_calls(tmp_path: Path) -> None:
    pytest.importorskip("huggingface_hub")
    from huggingface_hub import CommitOperationAdd

    api = FakeHfApi(
        {
            "be/run/frontend": [
                FakeRepoFolder("be/run/frontend/facts", "tree"),
                FakeRepoFile("be/run/frontend/manifest.json", 10, "blob-1"),
                FakeRepoFile(
                    "be/run/frontend/facts/00001.json",
                    20,
                    "blob-2",
                    lfs={"sha256": "f" * 64, "size": 20, "pointer_size": 130},
                ),
            ]
        }
    )
    client = HfHubClient("policyengine/microcosm-evaluation", api=api)

    assert client.head() == "abc123"
    assert client.list_files("be/run/frontend", recursive=True) == [
        RemoteFile("be/run/frontend/manifest.json", 10, blob_id="blob-1"),
        RemoteFile(
            "be/run/frontend/facts/00001.json", 20, blob_id="blob-2", sha256="f" * 64
        ),
    ]
    assert client.list_files("us", recursive=False) == []
    listing = api.calls[1]
    assert listing[1]["repo_type"] == "dataset"
    assert listing[1]["revision"] == "main"
    assert listing[1]["recursive"] is True

    page = tmp_path / "00001.json"
    page.write_bytes(b"{}\n")
    url = client.commit(
        [
            Upload("be/run/frontend/facts/00001.json", page, 3, "0" * 64),
            Upload("be/latest.json", b"{}", 2, "1" * 64),
        ],
        message="Publish be evaluation bundle run",
        description="details",
        parent_commit="abc123",
    )

    assert url == "https://huggingface.co/c/1"
    commit = api.calls[-1][1]
    assert commit["repo_id"] == "policyengine/microcosm-evaluation"
    assert commit["repo_type"] == "dataset"
    assert commit["revision"] == "main"
    assert commit["commit_message"] == "Publish be evaluation bundle run"
    assert commit["commit_description"] == "details"
    assert commit["parent_commit"] == "abc123"
    operations = commit["operations"]
    assert all(isinstance(operation, CommitOperationAdd) for operation in operations)
    assert [operation.path_in_repo for operation in operations] == [
        "be/run/frontend/facts/00001.json",
        "be/latest.json",
    ]


def test_script_imports_without_huggingface_hub(tmp_path: Path) -> None:
    import importlib
    import subprocess
    import sys

    script = importlib.import_module("scripts.publish_evaluation_bundle_to_hf").__file__
    bundle = write_bundle(tmp_path / "frontend")
    code = (
        "import builtins, sys\n"
        "real_import = builtins.__import__\n"
        "def guarded(name, *args, **kwargs):\n"
        "    if name.split('.')[0] == 'huggingface_hub':\n"
        "        raise ImportError('huggingface_hub is not installed')\n"
        "    return real_import(name, *args, **kwargs)\n"
        "builtins.__import__ = guarded\n"
        "import runpy\n"
        f"sys.argv = ['publish', '--bundle', {str(bundle)!r}, "
        "'--jurisdiction', 'BE', '--dry-run']\n"
        f"runpy.run_path({script!r}, run_name='__main__')\n"
    )
    completed = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(script).resolve().parents[1],
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert "be/latest.json" in completed.stdout
