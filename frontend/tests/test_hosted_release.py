"""Protect the reviewed .py-certified model/data pair before opening inputs."""

import copy
import importlib
import json
from pathlib import Path

import pytest

PUBLISHED_MANIFESTS = (
    Path(__file__).resolve().parent / "fixtures" / "populace-us-2024-spm-20260915"
)


@pytest.fixture
def modules(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    return (
        importlib.import_module("scripts.hosted_release"),
        importlib.import_module("scripts.microcosm_variable_core"),
    )


def published_manifest(name: str) -> dict:
    """Byte-identical copies of the release's manifests at the pinned commit."""
    return json.loads((PUBLISHED_MANIFESTS / f"{name}.json").read_text())


@pytest.fixture
def certificate(modules):
    release, _ = modules
    config = release.reviewed_release()
    return config, published_manifest("release_manifest"), published_manifest(
        "build_manifest"
    )


def repin_manifest_digests(release, config, manifest, build) -> None:
    """Even updating the content digests cannot bypass the .py certification."""
    config["release_manifest"]["json_sha256"] = release.json_sha256(manifest)
    config["build_manifest"]["json_sha256"] = release.json_sha256(build)


def test_default_is_reviewed_release_without_pointer_request(modules):
    release, _ = modules
    config = release.validate_selection(period="2024")
    assert config["hf_revision"] == "8ab57ffc2ca41d8af631ff62ebbce95e966299f3"
    assert config["release_id"] == "populace-us-2024-spm-20260915"


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


def test_reviewed_package_versions_are_the_ones_pinned_py_installs(modules):
    release, _ = modules
    config = release.reviewed_release()
    assert config["certifying_package"] == {
        "name": "policyengine",
        "version": "6.7.5",
        "extra": "us",
    }
    derived_versions = release.py_pinned_packages(config["certifying_package"])
    assert derived_versions == {
        "policyengine-us": "2.2.1",
        "policyengine-core": "3.33.0",
        "spm-calculator": "1.0.0",
    }
    assert config["packages"] == {"policyengine": "6.7.5", **derived_versions}


def test_tuple_not_pinned_by_py_is_refused(modules, monkeypatch):
    release, _ = modules
    config = release.reviewed_release()
    # The release's own build names Core 3.32.5, which .py 6.7.5 does not pin.
    config["packages"]["policyengine-core"] = "3.32.5"
    monkeypatch.setattr(
        release, "runtime_identity", lambda: {"packages": dict(config["packages"])}
    )
    with pytest.raises(release.VariableCalculationError, match="policyengine==6.7.5"):
        release.validate_runtime(config)


def test_runtime_without_the_pinned_py_is_refused(modules, monkeypatch):
    release, _ = modules
    config = release.reviewed_release()
    observed = {**config["packages"], "policyengine": "6.5.0"}
    monkeypatch.setattr(release, "runtime_identity", lambda: {"packages": observed})
    with pytest.raises(release.VariableCalculationError, match="6.5.0") as error:
        release.validate_runtime(config)
    assert error.value.status_code == 503


def test_reviewed_digests_pin_the_published_manifests(modules, certificate):
    release, _ = modules
    config, manifest, build = certificate
    assert release.json_sha256(manifest) == config["release_manifest"]["json_sha256"]
    assert release.json_sha256(build) == config["build_manifest"]["json_sha256"]
    assert config["release_manifest"]["path"] == (
        "releases/populace-us-2024-spm-20260915/release_manifest.json"
    )


def test_matching_certificate_and_build_are_verified(modules, certificate):
    release, _ = modules
    config, manifest, build = certificate
    release.validate_manifests(config, manifest, build)
    reformatted = json.loads(json.dumps(manifest, indent=7))
    assert release.json_sha256(reformatted) == release.json_sha256(manifest)


def test_py_certified_release_needs_no_build_runtime_or_household_count(
    modules, certificate
):
    release, _ = modules
    config, manifest, build = certificate
    # The source-enrichment build records neither, and names Core 3.32.5.
    assert "runtime" not in build
    assert "default" not in build["dataset"]
    assert manifest["build"]["built_with_core_package"]["version"] == "3.32.5"
    release.validate_manifests(config, manifest, build)
    assert release.recorded_household_count(build) is None


@pytest.mark.parametrize("kind", ["dataset_sha256", "release", "parent", "model"])
def test_dataset_not_certified_by_pinned_py_cannot_be_loaded(
    modules, certificate, kind
):
    release, _ = modules
    config, manifest, build = certificate
    national = manifest["artifacts"]["populace_us_2024"]
    if kind == "dataset_sha256":
        # A self-consistent release whose bytes .py 6.7.5 never certified.
        for document in (config, national, build["dataset"]):
            document["sha256"] = "f" * 64
    elif kind == "release":
        for document in (config, manifest["build"], build):
            key = "release_id" if document is config else "build_id"
            document[key] = "future-canonical-release"
        national["revision"] = "future-canonical-release"
    elif kind == "parent":
        manifest["artifacts"]["parent_release_manifest"]["sha256"] = "0" * 64
    else:
        manifest["build"]["built_with_model_package"]["version"] = "9.0.0"
    repin_manifest_digests(release, config, manifest, build)
    with pytest.raises(release.VariableCalculationError, match="does not certify"):
        release.validate_manifests(config, manifest, build)


@pytest.mark.parametrize("kind", ["bundle_version", "certified_sha256"])
def test_release_certified_only_by_another_py_cannot_be_loaded(
    modules, certificate, monkeypatch, kind
):
    release, _ = modules
    config, manifest, build = certificate
    bundle = copy.deepcopy(release.py_bundle_manifest(config["certifying_package"]))
    if kind == "bundle_version":
        bundle["policyengine_version"] = "6.5.0"
    else:
        bundle["data_releases"]["us"]["certified_data_artifact"]["sha256"] = "e" * 64
    monkeypatch.setattr(release, "py_bundle_manifest", lambda certifier: bundle)
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
    manifest["artifacts"]["parent_release_manifest"]["sha256"] = "0" * 64
    repin_manifest_digests(release, config, manifest, build)
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
