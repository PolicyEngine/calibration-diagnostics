"""Report installed runtime identity without loading a model or population."""

import os
from importlib import metadata
from typing import Any


def runtime_identity() -> dict[str, Any]:
    """Return observed distributions; absent optional bundle packages stay null."""
    packages = {}
    for name in (
        "policyengine-us",
        "policyengine-core",
        "spm-calculator",
        "policyengine",
        "microcosm-data",
    ):
        try:
            packages[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            packages[name] = None
    return {
        "packages": packages,
        "source_commit": os.environ.get("VERCEL_GIT_COMMIT_SHA"),
    }
