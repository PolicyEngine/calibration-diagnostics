"""Report installed runtime identity without loading a model or population."""

import os
import platform
import resource
import shutil
from importlib import metadata
from pathlib import Path
from typing import Any


def host_resources() -> dict[str, Any]:
    """Report observed process/container limits; unknown limits remain null."""
    memory_limit = None
    for filename in (
        "/sys/fs/cgroup/memory.max",
        "/sys/fs/cgroup/memory/memory.limit_in_bytes",
    ):
        try:
            value = int(Path(filename).read_text().strip())
            if 0 < value < 1 << 62:
                memory_limit = value
                break
        except (OSError, ValueError):
            continue
    cpu_limit = None
    try:
        quota, period = Path("/sys/fs/cgroup/cpu.max").read_text().split()
        if quota != "max":
            cpu_limit = int(quota) / int(period)
    except (OSError, ValueError, ZeroDivisionError):
        pass
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return {
        "memory_limit_bytes": memory_limit,
        "cpu_limit_cores": cpu_limit,
        "peak_rss_bytes": rss if platform.system() == "Darwin" else rss * 1024,
        "free_disk_bytes": shutil.disk_usage("/tmp").free,
    }


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
        "source_commit": os.environ.get("CALIBRATION_SOURCE_COMMIT")
        or os.environ.get("VERCEL_GIT_COMMIT_SHA"),
        "source_tree_sha256": os.environ.get("CALIBRATION_SOURCE_TREE_SHA256"),
        "host_resources": host_resources(),
    }
