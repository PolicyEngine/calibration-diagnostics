import json
from pathlib import Path

import pytest

from evaluation_harness.microcosm_release import resolve_microcosm_release


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


def test_resolve_microcosm_release_reads_a_local_published_tree(
    tmp_path: Path,
) -> None:
    documents = release_documents()
    for relative_path, content in documents.items():
        path = tmp_path / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

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

    def read(relative_path: str) -> bytes:
        requested.append(relative_path)
        return documents[relative_path]

    release = resolve_microcosm_release(artifact_reader=read)

    assert release.provenance == "hf:policyengine/populace-be-private@main"
    assert requested == list(documents)


def test_resolve_microcosm_release_rejects_path_traversal() -> None:
    documents = release_documents()
    latest = json.loads(documents["latest.json"])
    latest["paths"]["build_manifest"] = "../build_manifest.json"
    documents["latest.json"] = json.dumps(latest).encode()

    with pytest.raises(ValueError, match="unsafe path"):
        resolve_microcosm_release(artifact_reader=documents.__getitem__)
