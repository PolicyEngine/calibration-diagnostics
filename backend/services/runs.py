"""Discovery of available calibration runs on HuggingFace.

A "dataset" is a HuggingFace repository plus a layout convention. A "run" is
one published calibration build whose artifacts live under some prefix in the
repo. Two layouts are supported today:

- **flat**:    repo/<run_id>/<artifact>           (the legacy sandbox repo)
- **staging**: repo/staging/<run_id>/<artifact>   (the canonical us-data repo)

Each layout declares which artifact filenames must be present for a candidate
prefix to count as a real run, since the two repos publish different files.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from datetime import datetime
from functools import lru_cache

from huggingface_hub import HfApi

logger = logging.getLogger(__name__)

# Default required files per layout. Override per-dataset if a particular
# repo publishes a different file set.
DEFAULT_REQUIRED_FILES = {
    "flat":    ("calibration_package.pkl", "calibration_weights.npy"),
    "staging": ("policy_data.db",),  # at least the targets DB; an .h5 picked at load time
}


@dataclass(frozen=True)
class DatasetConfig:
    """A dataset = an HF repo plus a layout convention."""

    id: str
    label: str
    repo_id: str
    repo_type: str = "model"
    layout: str = "flat"                       # "flat" or "staging"
    # Files that must exist under a prefix for it to be considered a run.
    required_files: tuple[str, ...] = ()
    # For the staging layout: which h5 dataset to load when this dataset is
    # selected. The pipeline publishes several (cps, enhanced_cps, ...).
    primary_h5: str = "enhanced_cps_2024.h5"

    def effective_required_files(self) -> tuple[str, ...]:
        if self.required_files:
            return self.required_files
        defaults = DEFAULT_REQUIRED_FILES.get(self.layout, ())
        # Staging layout also requires the configured primary h5 to be present.
        if self.layout == "staging" and self.primary_h5:
            return defaults + (self.primary_h5,)
        return defaults


DEFAULT_DATASETS: list[DatasetConfig] = [
    DatasetConfig(
        id="us-cps",
        label="US ECPS (sandbox)",
        repo_id="PolicyEngine/policyengine-us-data-pipeline",
        layout="flat",
    ),
    DatasetConfig(
        id="us-data",
        label="US Data (canonical)",
        repo_id="PolicyEngine/policyengine-us-data",
        layout="staging",
        primary_h5="enhanced_cps_2024.h5",
    ),
]


@dataclass(frozen=True)
class RunInfo:
    dataset_id: str
    run_id: str                 # the prefix path within the repo
    label: str
    last_modified: str | None = None


def list_datasets() -> list[DatasetConfig]:
    return list(DEFAULT_DATASETS)


def get_dataset(dataset_id: str) -> DatasetConfig:
    for d in DEFAULT_DATASETS:
        if d.id == dataset_id:
            return d
    raise KeyError(f"Unknown dataset_id: {dataset_id}")


def _group_flat(files: list[str]) -> dict[str, set[str]]:
    """For flat layout: prefix = first path segment, files = direct children."""
    by_prefix: dict[str, set[str]] = {}
    for path in files:
        if "/" not in path:
            continue
        prefix, _, rest = path.partition("/")
        if "/" in rest:  # only files directly under <prefix>/
            continue
        by_prefix.setdefault(prefix, set()).add(rest)
    return by_prefix


def _group_staging(files: list[str]) -> dict[str, set[str]]:
    """For staging layout: prefix = "staging/<run_id>", files = direct children."""
    by_prefix: dict[str, set[str]] = {}
    for path in files:
        if not path.startswith("staging/"):
            continue
        parts = path.split("/", 2)
        if len(parts) < 3:
            continue
        run_id = parts[1]
        rest = parts[2]
        if "/" in rest:
            continue
        by_prefix.setdefault(run_id, set()).add(rest)
    return by_prefix


@lru_cache(maxsize=8)
def list_runs(dataset_id: str) -> tuple[RunInfo, ...]:
    """Discover runs for a dataset. Cached; restart to refresh from HF."""
    dataset = get_dataset(dataset_id)
    api = HfApi()
    try:
        files = api.list_repo_files(
            repo_id=dataset.repo_id, repo_type=dataset.repo_type
        )
    except Exception:
        logger.exception("Failed to list HF repo %s", dataset.repo_id)
        return ()

    if dataset.layout == "flat":
        by_prefix = _group_flat(files)
    elif dataset.layout == "staging":
        by_prefix = _group_staging(files)
    else:
        logger.error("Unknown layout %r for dataset %s", dataset.layout, dataset_id)
        return ()

    required = dataset.effective_required_files()
    runs: list[RunInfo] = []
    for prefix, names in sorted(by_prefix.items(), reverse=True):
        if not all(req in names for req in required):
            continue
        runs.append(
            RunInfo(
                dataset_id=dataset_id,
                run_id=prefix,
                label=prefix,
                last_modified=None,  # cheap; populate lazily if needed
            )
        )
    return tuple(runs)


def storage_prefix(dataset: DatasetConfig, run_id: str) -> str:
    """The path prefix within the repo where this run's files live."""
    if dataset.layout == "staging":
        return f"staging/{run_id}"
    return run_id


def default_selection() -> tuple[str, str] | None:
    ds = os.environ.get("DEFAULT_DATASET")
    run = os.environ.get("DEFAULT_RUN")
    if ds and run:
        return ds, run
    return None
