"""Protect the reviewed model/data pair before opening population inputs."""

import copy
import importlib
import json
from pathlib import Path

import pytest


@pytest.fixture
def modules(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    return (
        importlib.import_module("scripts.hosted_release"),
        importlib.import_module("scripts.microcosm_variable_core"),
    )


@pytest.fixture
def certificate(modules):
    release, _ = modules
    config = release.reviewed_release()
    packages = config["packages"]
    manifest = {
        "schema_version": 1,
        "build": {
            "build_id": config["release_id"],
            "built_with_model_package": {
                "name": "policyengine-us",
                "version": packages["policyengine-us"],
            },
            "built_with_core_package": {
                "name": "policyengine-core",
                "version": packages["policyengine-core"],
            },
        },
        "compatible_model_packages": [
            {"name": "policyengine-us", "specifier": "==" + packages["policyengine-us"]}
        ],
        "compatible_core_packages": [
            {
                "name": "policyengine-core",
                "specifier": "==" + packages["policyengine-core"],
            }
        ],
        "default_datasets": {"national": "populace_us_2024"},
        "artifacts": {
            "populace_us_2024": {
                "kind": "microdata",
                "repo_id": config["repo"],
                "path": config["filename"],
                "revision": config["release_id"],
                "sha256": config["sha256"],
            }
        },
    }
    build = {
        "build_id": config["release_id"],
        "runtime": packages,
        "dataset": {"filename": config["filename"], "sha256": config["sha256"]},
    }
    config["release_manifest"]["json_sha256"] = release.json_sha256(manifest)
    config["build_manifest"]["json_sha256"] = release.json_sha256(build)
    return config, manifest, build


def test_default_is_reviewed_release_without_pointer_request(modules):
    release, _ = modules
    config = release.validate_selection(period="2024")
    assert config["hf_revision"] == "f09f2f3b9fa8409642dc0c7fc9c8f7516ae0e3c5"
    assert config["release_id"].startswith("populace-us-2024-buildp-")


@pytest.mark.parametrize("requested", ["latest", "main", "future-canonical-release"])
def test_future_or_moving_release_refused_before_download(
    modules, monkeypatch, requested
):
    release, core = modules
    monkeypatch.setattr(
        core, "_download_dataset", lambda *args: pytest.fail("H5 download")
    )
    with pytest.raises(release.VariableCalculationError) as error:
        core.calculate_variables(variables=["snap"], period="2024", revision=requested)
    assert error.value.status_code == 409


def test_future_period_refused_before_download(modules):
    release, _ = modules
    with pytest.raises(release.VariableCalculationError, match="2024") as error:
        release.validate_selection(period="2026")
    assert error.value.status_code == 409


def test_conflicting_environment_revision_is_not_silently_ignored(modules):
    release, _ = modules
    with pytest.raises(release.VariableCalculationError, match="configuration"):
        release.validate_selection(hf_revision="main", period="2024")


def test_wrong_runtime_rejected_before_manifest_or_h5_fetch(modules, monkeypatch):
    release, core = modules
    observed = copy.deepcopy(release.reviewed_release()["packages"])
    observed["policyengine-us"] = "1.752.2"
    monkeypatch.setattr(release, "runtime_identity", lambda: {"packages": observed})
    monkeypatch.setattr(
        core, "_download_dataset", lambda *args: pytest.fail("H5 download")
    )
    with pytest.raises(release.VariableCalculationError, match="1.752.2"):
        core.calculate_variables(variables=["snap"], period="2024")


def test_matching_certificate_and_build_are_verified(modules, certificate):
    release, _ = modules
    config, manifest, build = certificate
    release.validate_manifests(config, manifest, build)
    reformatted = json.loads(json.dumps(manifest, indent=7))
    assert release.json_sha256(reformatted) == release.json_sha256(manifest)


@pytest.mark.parametrize("kind", ["model", "core", "sha256", "release"])
def test_incompatible_future_certificate_cannot_be_loaded(modules, certificate, kind):
    release, _ = modules
    config, manifest, build = certificate
    if kind == "model":
        manifest["compatible_model_packages"][0]["specifier"] = "==9.0.0"
    elif kind == "core":
        manifest["build"]["built_with_core_package"]["version"] = "9.0.0"
    elif kind == "sha256":
        manifest["artifacts"]["populace_us_2024"]["sha256"] = "f" * 64
    else:
        manifest["build"]["build_id"] = "future-canonical-release"
    # Even updating a content digest cannot bypass model/data field checks.
    config["release_manifest"]["json_sha256"] = release.json_sha256(manifest)
    with pytest.raises(release.VariableCalculationError):
        release.validate_manifests(config, manifest, build)


def test_modified_manifest_contents_fail_pinned_digest(modules, certificate):
    release, _ = modules
    config, manifest, build = certificate
    manifest["unreviewed_field"] = "changed"
    with pytest.raises(release.VariableCalculationError, match="digest"):
        release.validate_manifests(config, manifest, build)


def test_bad_h5_bytes_rejected_without_native_open(modules, tmp_path):
    release, _ = modules
    file = tmp_path / "wrong.h5"
    file.write_bytes(b"not the certified H5")
    with pytest.raises(release.VariableCalculationError, match="SHA-256"):
        release.verify_h5(file, release.reviewed_release())


def test_ram_image_must_match_same_hash_as_disk_file(modules, tmp_path):
    release, _ = modules
    config = release.reviewed_release()
    image = b"small test image"
    config["sha256"] = release.hashlib.sha256(image).hexdigest()
    assert (
        release.verify_h5(tmp_path / "sentinel.h5", config, image=image)
        == config["sha256"]
    )


def test_future_certificate_is_refused_before_h5_download(
    modules, certificate, monkeypatch, tmp_path
):
    release, core = modules
    config, manifest, build = certificate
    manifest["compatible_model_packages"][0]["specifier"] = "==9.0.0"
    config["release_manifest"]["json_sha256"] = release.json_sha256(manifest)
    monkeypatch.setattr(release, "reviewed_release", lambda: config)
    monkeypatch.setattr(core, "validate_runtime", lambda config: {})
    monkeypatch.setattr(
        core, "_download_dataset", lambda *args: pytest.fail("H5 must not download")
    )
    paths = {}
    for key, document in (("release_manifest", manifest), ("build_manifest", build)):
        path = tmp_path / f"{key}.json"
        path.write_text(json.dumps(document))
        paths[config[key]["path"]] = str(path)

    def downloader(**kwargs):
        assert kwargs["revision"] == config["hf_revision"]
        return paths[kwargs["filename"]]

    import huggingface_hub

    monkeypatch.setattr(huggingface_hub, "hf_hub_download", downloader)
    with pytest.raises(release.VariableCalculationError, match="does not certify"):
        core.calculate_variables(variables=["snap"], period="2024")


def test_mismatched_h5_refused_before_country_import(modules, monkeypatch, tmp_path):
    release, core = modules
    bad_h5 = tmp_path / "unexpected.h5"
    bad_h5.write_bytes(b"wrong population bytes")
    monkeypatch.setattr(core, "validate_runtime", lambda config: {})
    monkeypatch.setattr(core, "download_certification", lambda *args: None)
    monkeypatch.setattr(core, "_evict_other_releases", lambda *args: None)
    monkeypatch.setattr(core, "_download_dataset", lambda *args: str(bad_h5))
    with pytest.raises(release.VariableCalculationError, match="SHA-256"):
        core.calculate_variables(variables=["snap"], period="2024")
