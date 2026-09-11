"""The reviewed immutable model/data contract for hosted variable calculations."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from packaging.specifiers import SpecifierSet

from scripts.runtime_identity import runtime_identity

MANIFEST_DIGEST_ALGORITHM = "sha256-json-sort-keys-compact-ascii-escaped-utf8"


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


def validate_runtime(config: dict[str, Any]) -> dict[str, Any]:
    """Check actual installed versions before fetching any population inputs."""
    runtime = runtime_identity()
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
    """Require reviewed manifest contents and matching model/data certification."""
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
        for package, field in (
            ("policyengine-us", "model"),
            ("policyengine-core", "core"),
        ):
            expected = config["packages"][package]
            built = build[f"built_with_{field}_package"]
            if built != {"name": package, "version": expected}:
                raise ValueError(f"built {package} mismatch")
            compatible = manifest[f"compatible_{field}_packages"]
            if not any(
                entry["name"] == package
                and expected in SpecifierSet(entry["specifier"])
                for entry in compatible
            ):
                raise ValueError(f"release does not certify {package}=={expected}")
            if build_manifest["runtime"][package] != expected:
                raise ValueError(f"build manifest {package} mismatch")
        if build_manifest["dataset"]["sha256"] != config["sha256"]:
            raise ValueError("build manifest dataset SHA-256 mismatch")
        if build_manifest["dataset"]["filename"] != config["filename"]:
            raise ValueError("build manifest dataset filename mismatch")
    except (KeyError, TypeError, ValueError) as exc:
        raise VariableCalculationError(
            f"Incompatible reviewed release certificate: {exc}"
        ) from exc


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
