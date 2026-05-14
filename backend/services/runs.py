"""Discovery of available calibration runs on HuggingFace.

A "dataset" is a HuggingFace repository (typically one per data pipeline,
e.g. policyengine-us-data-pipeline). A "run" is a top-level prefix within
that repo containing one calibration build's artifacts.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache

from huggingface_hub import HfApi

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DatasetConfig:
    """A dataset = a HuggingFace repo containing many runs."""

    id: str          # short identifier used in URLs, e.g. "us-cps"
    label: str       # human-friendly name shown in UI
    repo_id: str     # HF repo, e.g. "PolicyEngine/policyengine-us-data-pipeline"
    repo_type: str = "model"


# Default registry of datasets. Override via DATASETS env var (JSON list)
# once we support multiple. Keeping a single source of truth here for now.
DEFAULT_DATASETS: list[DatasetConfig] = [
    DatasetConfig(
        id="us-cps",
        label="US Enhanced CPS",
        repo_id="PolicyEngine/policyengine-us-data-pipeline",
        repo_type="model",
    ),
]

# Artifact files that must be present for a prefix to count as a "run".
REQUIRED_ARTIFACTS = ("calibration_package.pkl", "calibration_weights.npy")


@dataclass(frozen=True)
class RunInfo:
    dataset_id: str
    run_id: str             # the HF prefix, e.g. "test" or "build-2026-05-12"
    label: str              # display label, defaults to run_id
    last_modified: str | None = None


def list_datasets() -> list[DatasetConfig]:
    return list(DEFAULT_DATASETS)


def get_dataset(dataset_id: str) -> DatasetConfig:
    for d in DEFAULT_DATASETS:
        if d.id == dataset_id:
            return d
    raise KeyError(f"Unknown dataset_id: {dataset_id}")


@lru_cache(maxsize=8)
def list_runs(dataset_id: str) -> tuple[RunInfo, ...]:
    """Discover runs for a dataset by listing top-level prefixes on HF.

    Cached because HF listing is a network call; restart the backend
    (or evict the cache) to pick up newly-published runs.
    """
    dataset = get_dataset(dataset_id)
    api = HfApi()
    try:
        files = api.list_repo_files(
            repo_id=dataset.repo_id, repo_type=dataset.repo_type
        )
    except Exception:
        logger.exception("Failed to list HF repo %s", dataset.repo_id)
        return ()

    # Group files by top-level prefix; a valid run has all required artifacts.
    by_prefix: dict[str, set[str]] = {}
    for path in files:
        if "/" not in path:
            continue
        prefix, _, rest = path.partition("/")
        # Only consider one level deep — artifacts live directly under <prefix>/
        if "/" in rest:
            continue
        by_prefix.setdefault(prefix, set()).add(rest)

    runs: list[RunInfo] = []
    for prefix, names in sorted(by_prefix.items()):
        if not all(req in names for req in REQUIRED_ARTIFACTS):
            continue
        runs.append(
            RunInfo(
                dataset_id=dataset_id,
                run_id=prefix,
                label=prefix,
                last_modified=_fetch_last_modified(
                    api, dataset.repo_id, dataset.repo_type, prefix
                ),
            )
        )
    return tuple(runs)


def _fetch_last_modified(
    api: HfApi, repo_id: str, repo_type: str, prefix: str
) -> str | None:
    """Best-effort last-modified for a run prefix. Returns ISO string or None."""
    try:
        info = api.repo_info(repo_id=repo_id, repo_type=repo_type, files_metadata=True)
    except Exception:
        return None
    siblings = getattr(info, "siblings", None) or []
    most_recent: datetime | None = None
    for s in siblings:
        rfilename = getattr(s, "rfilename", "")
        if not rfilename.startswith(prefix + "/"):
            continue
        lc = getattr(s, "lfs", None)
        # HfApi doesn't always expose per-file mtime; fall back to repo level.
        mod = getattr(s, "last_commit", None) or getattr(s, "last_modified", None)
        if mod is None and lc is not None:
            mod = getattr(lc, "last_modified", None)
        if mod is None:
            continue
        if isinstance(mod, str):
            try:
                mod = datetime.fromisoformat(mod.replace("Z", "+00:00"))
            except ValueError:
                continue
        if most_recent is None or mod > most_recent:
            most_recent = mod
    return most_recent.isoformat() if most_recent else None


def default_selection() -> tuple[str, str] | None:
    """Return (dataset_id, run_id) defaults if env vars are set, else None."""
    ds = os.environ.get("DEFAULT_DATASET")
    run = os.environ.get("DEFAULT_RUN")
    if ds and run:
        return ds, run
    return None
