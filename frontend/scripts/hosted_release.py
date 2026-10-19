"""The reviewed immutable model/data contract for hosted variable calculations.

.py (the PyPI package ``policyengine``) is the model identity. The runtime must
install exactly the policyengine-us, policyengine-core and spm-calculator
versions that the pinned .py's country extra pins, and it accepts only the data
release that the same .py version's bundle manifest certifies.
"""

from __future__ import annotations

import hashlib
import json
from importlib import metadata
from pathlib import Path
from typing import Any

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

from scripts.runtime_identity import runtime_identity

MANIFEST_DIGEST_ALGORITHM = "sha256-json-sort-keys-compact-ascii-escaped-utf8"
RELEASE_SCHEMA_VERSION = 2
MODEL_PACKAGE = "policyengine-us"
PY_BUNDLE_MANIFEST = "policyengine/data/bundle/manifest.json"


class VariableCalculationError(RuntimeError):
    """Calculation refusal with the HTTP status appropriate to the failure."""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


def reviewed_release() -> dict[str, Any]:
    """Return the checked-in production identity, never a moving HF pointer."""
    return json.loads(Path(__file__).with_suffix(".json").read_text())


def validate_selection(
    *,
    requested_release: str | None = None,
    repo: str | None = None,
    hf_revision: str | None = None,
    filename: str | None = None,
    period: str | None = None,
) -> dict[str, Any]:
    """Refuse unreviewed releases, years, and conflicting deployment settings."""
    config = reviewed_release()
    if requested_release is not None and requested_release != config["release_id"]:
        raise VariableCalculationError(
            f"Release {requested_release!r} is not supported by this runtime. "
            f"The reviewed production release is {config['release_id']}.",
            status_code=409,
        )
    if period is not None and str(period) != str(config["data_year"]):
        raise VariableCalculationError(
            f"This runtime is qualified for data year {config['data_year']} only.",
            status_code=409,
        )
    for key, configured in (
        ("repo", repo),
        ("hf_revision", hf_revision),
        ("filename", filename),
    ):
        if configured is not None and configured != config[key]:
            raise VariableCalculationError(
                f"Deployment data configuration {key}={configured!r} conflicts "
                f"with the reviewed value {config[key]!r}.",
                status_code=503,
            )
    return config


def certifying_package(config: dict[str, Any]) -> dict[str, str]:
    """Return the reviewed .py identity that pins the model and certifies data."""
    certifier = config.get("certifying_package")
    if config.get("schema_version") != RELEASE_SCHEMA_VERSION or not (
        isinstance(certifier, dict) and set(certifier) == {"name", "version", "extra"}
    ):
        raise VariableCalculationError(
            "The reviewed release does not name its certifying .py package.",
            status_code=503,
        )
    return certifier


def _installed_certifier(certifier: dict[str, str]) -> metadata.Distribution:
    """Return the installed .py distribution, refusing any other version."""
    required = f"{certifier['name']}=={certifier['version']}"
    try:
        distribution = metadata.distribution(certifier["name"])
    except metadata.PackageNotFoundError as exc:
        raise VariableCalculationError(
            f"The reviewed release requires {required}; the runtime has None.",
            status_code=503,
        ) from exc
    if distribution.version != certifier["version"]:
        raise VariableCalculationError(
            f"The reviewed release requires {required}; "
            f"the runtime has {distribution.version!r}.",
            status_code=503,
        )
    return distribution


def py_pinned_packages(certifier: dict[str, str]) -> dict[str, str]:
    """Derive the exact package versions the installed .py pins for its extra."""
    distribution = _installed_certifier(certifier)
    required = f"{certifier['name']}=={certifier['version']}"
    pinned_versions = {}
    for requirement_text in distribution.requires or []:
        requirement = Requirement(requirement_text)
        marker = requirement.marker
        if (
            marker is None
            or marker.evaluate({"extra": ""})
            or not marker.evaluate({"extra": certifier["extra"]})
        ):
            continue
        specifiers = list(requirement.specifier)
        if len(specifiers) != 1 or specifiers[0].operator != "==":
            raise VariableCalculationError(
                f"{required} does not pin {requirement.name} to one exact version.",
                status_code=503,
            )
        pinned_versions[canonicalize_name(requirement.name)] = specifiers[0].version
    if MODEL_PACKAGE not in pinned_versions:
        raise VariableCalculationError(
            f"{required} does not pin {MODEL_PACKAGE} in its "
            f"{certifier['extra']!r} extra.",
            status_code=503,
        )
    return pinned_versions


def validate_runtime(config: dict[str, Any]) -> dict[str, Any]:
    """Check actual installed versions before fetching any population inputs."""
    certifier = certifying_package(config)
    required = f"{certifier['name']}=={certifier['version']}"
    runtime = runtime_identity()
    installed_certifier = runtime["packages"].get(certifier["name"])
    if installed_certifier != certifier["version"]:
        raise VariableCalculationError(
            f"The reviewed release requires {required}; "
            f"the runtime has {installed_certifier!r}.",
            status_code=503,
        )
    pinned_versions = py_pinned_packages(certifier)
    reviewed_versions = {
        package: version
        for package, version in config["packages"].items()
        if package != certifier["name"]
    }
    if (
        config["packages"].get(certifier["name"]) != certifier["version"]
        or reviewed_versions != pinned_versions
    ):
        raise VariableCalculationError(
            f"The reviewed package versions {reviewed_versions} are not the ones "
            f"{required} pins: {pinned_versions}.",
            status_code=503,
        )
    for package, expected in config["packages"].items():
        installed = runtime["packages"].get(package)
        if installed != expected:
            raise VariableCalculationError(
                f"The reviewed release requires {package}=={expected}; "
                f"the runtime has {installed!r}.",
                status_code=503,
            )
    return runtime


def json_sha256(value: Any) -> str:
    """Hash semantic JSON using sorted keys, compact separators and ASCII escapes."""
    canonical = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def validate_manifests(
    config: dict[str, Any],
    manifest: dict[str, Any],
    build_manifest: dict[str, Any],
) -> None:
    """Require reviewed manifest contents and the pinned .py's data certification."""
    if config.get("manifest_digest_algorithm") != MANIFEST_DIGEST_ALGORITHM:
        raise VariableCalculationError("Unsupported manifest digest algorithm.")
    for key, document in (
        ("release_manifest", manifest),
        ("build_manifest", build_manifest),
    ):
        if json_sha256(document) != config[key]["json_sha256"]:
            raise VariableCalculationError(f"The {key} content digest is not reviewed.")
    try:
        if manifest["schema_version"] != 1:
            raise ValueError("unsupported release manifest schema")
        build = manifest["build"]
        release_id = config["release_id"]
        if build["build_id"] != release_id or build_manifest["build_id"] != release_id:
            raise ValueError("release identity mismatch")
        key = manifest["default_datasets"]["national"]
        artifact = manifest["artifacts"][key]
        for field, expected in {
            "kind": "microdata",
            "repo_id": config["repo"],
            "path": config["filename"],
            "revision": release_id,
            "sha256": config["sha256"],
        }.items():
            if artifact[field] != expected:
                raise ValueError(f"artifact {field} mismatch")
        if build_manifest["dataset"]["sha256"] != config["sha256"]:
            raise ValueError("build manifest dataset SHA-256 mismatch")
        if build_manifest["dataset"]["filename"] != config["filename"]:
            raise ValueError("build manifest dataset filename mismatch")
    except (KeyError, TypeError, ValueError) as exc:
        raise VariableCalculationError(
            f"Incompatible reviewed release certificate: {exc}"
        ) from exc
    # The release's own built-with Core and build-runtime fields are not the
    # model identity: .py is. Its certification replaces those checks.
    validate_py_certification(config, manifest)


def py_bundle_manifest(certifier: dict[str, str]) -> dict[str, Any]:
    """Read the bundle manifest shipped inside the installed .py distribution."""
    distribution = _installed_certifier(certifier)
    bundle_path = Path(str(distribution.locate_file(PY_BUNDLE_MANIFEST)))
    try:
        return json.loads(bundle_path.read_text())
    except (OSError, ValueError) as exc:
        raise VariableCalculationError(
            f"{certifier['name']}=={certifier['version']} has no readable "
            "bundle manifest.",
            status_code=503,
        ) from exc


def validate_py_certification(config: dict[str, Any], manifest: dict[str, Any]) -> None:
    """Accept only the data release that the pinned .py certifies for its extra."""
    certifier = certifying_package(config)
    bundle = py_bundle_manifest(certifier)
    release_id = config["release_id"]
    model_version = config["packages"][MODEL_PACKAGE]
    try:
        if bundle["policyengine_version"] != certifier["version"]:
            raise ValueError("this release: the bundle belongs to another .py version")
        certified = bundle["data_releases"][certifier["extra"]]
        certification = certified["certification"]
        artifact = certified["certified_data_artifact"]
        data_package = certified["data_package"]
        expected_dataset_uri = (
            f"hf://{config['repo']}/{config['filename']}@{release_id}"
        )
        for label, certified_value, reviewed_value in (
            ("the release", certified["build_id"], release_id),
            ("the data build", certification["data_build_id"], release_id),
            ("the dataset SHA-256", artifact["sha256"], config["sha256"]),
            ("the dataset URI", artifact["uri"], expected_dataset_uri),
            ("the data repository", data_package["repo_id"], config["repo"]),
            (
                "the release manifest",
                data_package["release_manifest_path"],
                config["release_manifest"]["path"],
            ),
            (
                "the release revision",
                data_package["release_manifest_revision"],
                release_id,
            ),
            (
                "the build manifest",
                certified["datasets"]["build_manifest"]["path"],
                config["build_manifest"]["path"],
            ),
            (
                "the model version",
                certification["certified_for_model_version"],
                model_version,
            ),
            ("the model package", certified["model_package"]["version"], model_version),
            (
                "the built-with model",
                {
                    "name": MODEL_PACKAGE,
                    "version": certification["built_with_model_version"],
                },
                manifest["build"]["built_with_model_package"],
            ),
        ):
            if certified_value != reviewed_value:
                raise ValueError(label)
        for parent in ("parent_release_manifest", "parent_build_manifest"):
            if certified["datasets"][parent]["revision"] != release_id:
                raise ValueError(f"the {parent} revision")
        # Every file .py records at this release revision, including the parent
        # manifests, must be the file the reviewed release manifest lists.
        for key, record in certified["datasets"].items():
            if record.get("revision") != release_id:
                continue
            listed = manifest["artifacts"].get(key)
            if not isinstance(listed, dict) or listed.get("sha256") != record["sha256"]:
                raise ValueError(f"the {key} digest")
    except (KeyError, TypeError, ValueError) as exc:
        raise VariableCalculationError(
            "Incompatible reviewed release certificate: "
            f"{certifier['name']}=={certifier['version']} does not certify {exc}."
        ) from exc


def recorded_household_count(build_manifest: dict[str, Any]) -> int | None:
    """Return the build's exported household count when its manifest records one.

    A .py-certified source-enrichment release, such as the reviewed
    populace-us-2024-spm-20260915, does not record it; callers then rely on the
    .py certification checked by ``validate_manifests``.
    """
    dataset = build_manifest.get("dataset") or {}
    return (dataset.get("default") or {}).get("n_exported_households")


def download_certification(config: dict[str, Any], downloader: Any) -> None:
    """Read manifests at the immutable HF commit before downloading the H5."""
    documents = []
    for key in ("release_manifest", "build_manifest"):
        path = downloader(
            repo_id=config["repo"],
            filename=config[key]["path"],
            revision=config["hf_revision"],
            repo_type="dataset",
        )
        documents.append(json.loads(Path(path).read_text()))
    validate_manifests(config, *documents)


def verify_h5(
    path: str | Path, config: dict[str, Any], *, image: bytes | None = None
) -> str:
    """Hash actual H5 bytes before any native input loader can open them."""
    if image is None:
        with Path(path).open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
    else:
        digest = hashlib.sha256(image).hexdigest()
    if digest != config["sha256"]:
        raise VariableCalculationError(
            f"Dataset SHA-256 {digest} does not match the reviewed {config['sha256']}."
        )
    return digest


def load_verified_native_input(path: str | Path, config: dict[str, Any]) -> Any:
    """Open reviewed H5 input using the country's actual native dataset API."""
    validate_runtime(config)
    verify_h5(path, config)
    from policyengine_us.data import USSingleYearDataset

    dataset = USSingleYearDataset(file_path=str(path))
    if str(dataset.time_period) != str(config["data_year"]):
        raise VariableCalculationError(
            "The native dataset time period is not reviewed."
        )
    return dataset
