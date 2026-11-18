"""The reference engine's identity and the panel id.

The engine is read from the installed policyengine.py bundle manifest
(`policyengine/data/bundle/manifest.json`) without importing policyengine, so
reading it has no side effects (no country import, no Hub request). This is the
`py_bundle_manifest` approach of `frontend/scripts/hosted_release.py`, for any
country.

Every panel-id input is the country's own: its engine pins, the producer
version, the point format and its spec's number-changing part. So bumping one
country's lockfile or spec gives that country a new panel and leaves every
other country's panel alone. References are not an input.

`panel.json` holds only what the id hashes, plus the engine it names. Facts
that can change inside one panel (the resolved environment, the producer
commit) are recorded on each point instead; labels and references are
replaceable country files.
"""

from __future__ import annotations

import json
import platform
from importlib import metadata
from pathlib import Path
from typing import Any

from release_history import PANEL_FORMAT_VERSION, POINT_FORMAT_VERSION, PRODUCER_VERSION
from release_history.canonical import DIGEST_ALGORITHM, file_sha256, json_sha256
from release_history.spec import Spec, measurement_definition

BUNDLE_MANIFEST = "policyengine/data/bundle/manifest.json"
CORE_PACKAGE = "policyengine-core"


class EngineMismatch(RuntimeError):
    """The installed packages are not the ones the bundle pins."""


def bundle_manifest() -> dict[str, Any]:
    distribution = metadata.distribution("policyengine")
    path = Path(str(distribution.locate_file(BUNDLE_MANIFEST)))
    return json.loads(path.read_text(encoding="utf-8"))


def _installed(package: str) -> str:
    try:
        return metadata.version(package)
    except metadata.PackageNotFoundError as error:
        raise EngineMismatch(f"{package} is not installed") from error


def engine_identity(spec: Spec, bundle: dict[str, Any] | None = None) -> dict[str, Any]:
    """The engine a panel runs on, refusing any drift from the bundle's pins."""
    bundle = bundle if bundle is not None else bundle_manifest()
    version = bundle["policyengine_version"]
    if _installed("policyengine") != version:
        raise EngineMismatch("the installed policyengine differs from its own bundle manifest")
    packages = bundle["packages"]
    model = packages.get(spec.model_package)
    if not model:
        raise EngineMismatch(f"the bundle does not pin {spec.model_package}")
    core = packages[CORE_PACKAGE]
    for name, pinned in ((spec.model_package, model["version"]), (CORE_PACKAGE, core["version"])):
        if _installed(name) != pinned:
            raise EngineMismatch(f"{name} differs from the bundle's pin {pinned}")
    return {
        "policyengine": version,
        "bundle_sha256": json_sha256(bundle),
        "model": {
            "name": spec.model_package,
            "version": model["version"],
            "wheel_sha256": model.get("sha256"),
        },
        "core": {"name": CORE_PACKAGE, "version": core["version"]},
    }


def panel_key(spec: Spec, engine: dict[str, Any]) -> dict[str, Any]:
    """Exactly the inputs the panel id hashes."""
    return {
        "country": spec.country,
        "policyengine": engine["policyengine"],
        "model": f"{engine['model']['name']}=={engine['model']['version']}",
        "core": f"{engine['core']['name']}=={engine['core']['version']}",
        "producer_version": PRODUCER_VERSION,
        "point_format_version": POINT_FORMAT_VERSION,
        "spec_sha256": spec.digest,
    }


def panel_id(spec: Spec, engine: dict[str, Any]) -> str:
    return json_sha256(panel_key(spec, engine))


def environment(lockfile: Path | None = None) -> dict[str, Any]:
    """The resolved environment a point ran on; recorded on each point, not hashed."""
    packages = sorted(
        f"{dist.metadata['Name']}=={dist.version}"
        for dist in metadata.distributions()
        if dist.metadata.get("Name")
    )
    return {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "packages": packages,
        "packages_sha256": json_sha256(packages),
        "uv_lock_sha256": file_sha256(lockfile) if lockfile and lockfile.is_file() else None,
    }


def panel_document(spec: Spec, engine: dict[str, Any]) -> dict[str, Any]:
    """Written once: the panel key, the hashed definition and the engine it names."""
    return {
        "format_version": PANEL_FORMAT_VERSION,
        "kind": "release_history.panel",
        "panel_id": panel_id(spec, engine),
        "panel_key": panel_key(spec, engine),
        "digest_algorithm": DIGEST_ALGORITHM,
        "country": spec.country,
        "engine": engine,
        "producer_version": PRODUCER_VERSION,
        "point_format_version": POINT_FORMAT_VERSION,
        "spec_sha256": spec.digest,
        "definition": measurement_definition(spec.raw),
    }
