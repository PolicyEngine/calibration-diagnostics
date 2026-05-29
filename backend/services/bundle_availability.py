"""Which calibrated h5 bundles a run actually publishes.

For staging-layout datasets the pipeline emits an arbitrary subset of
the full bundle catalog (a federal `enhanced_cps_2024.h5`, a
`national/US.h5`, 51 `states/<XX>.h5`, 436 `districts/<XX-NN>.h5`).
GHA-only runs typically publish just the federal one; tagged releases
publish all 499.

Listing the published set lets the dashboard:

1. Show only bundles that exist when the user filters /targets by
   dataset, so we stop labeling rows with files that aren't there.
2. Decide whether per-bundle Microsim evaluation is even possible for
   the loaded run, and short-circuit cleanly when it isn't.

Results are cached per (repo_id, run_id) since the published artifact
set is immutable for a given run.
"""

from __future__ import annotations

import logging
from typing import Iterable

logger = logging.getLogger(__name__)

# (repo_id, run_id) -> set of bundle paths, e.g. {"enhanced_cps_2024.h5",
# "states/CA.h5", "districts/CA-12.h5"}
_CACHE: dict[tuple[str, str], frozenset[str]] = {}


def _bundle_paths_for_run(repo_id: str, run_id: str) -> frozenset[str]:
    """Hit the HF repo file listing and pick out h5 paths under the run."""
    from huggingface_hub import HfApi
    api = HfApi()
    try:
        files = api.list_repo_files(repo_id, repo_type="model")
    except Exception as exc:
        logger.warning("HF list_repo_files failed for %s: %s", repo_id, exc)
        return frozenset()
    root_run = run_id == "main"
    current_staging = run_id == "staging"
    if root_run:
        prefix = ""
    elif current_staging:
        prefix = "staging/"
    else:
        prefix = f"staging/{run_id}/"
    bundles: set[str] = set()
    for f in files:
        if not f.startswith(prefix) or not f.endswith(".h5"):
            continue
        rel = f[len(prefix):]
        if current_staging:
            if rel == "calibration/source_imputed_stratified_extended_cps.h5":
                bundles.add("source_imputed_stratified_extended_cps.h5")
                continue
            if "/" not in rel or rel.split("/", 1)[0] not in {
                "cities", "districts", "national", "states",
            }:
                continue
        if root_run and "/" in rel and rel.split("/", 1)[0] not in {
            "cities", "districts", "national", "states",
        }:
            continue
        # Skip clone-diagnostics-style sidecars that share the .h5 stem.
        if rel.endswith(".clone_diagnostics.json"):
            continue
        bundles.add(rel)
    return frozenset(bundles)


def published_bundles(repo_id: str, run_id: str) -> frozenset[str]:
    """Cached: return the set of bundle paths under a run."""
    key = (repo_id, run_id)
    cached = _CACHE.get(key)
    if cached is not None:
        return cached
    bundles = _bundle_paths_for_run(repo_id, run_id)
    _CACHE[key] = bundles
    return bundles


def filter_to_available(
    candidates: Iterable[str],
    repo_id: str,
    run_id: str,
) -> list[str]:
    """Drop bundle names from `candidates` that the run doesn't publish.

    Used to scope the dataset-file facet on /targets/facets to what's
    actually fetchable for this run.
    """
    available = published_bundles(repo_id, run_id)
    if not available:
        return list(candidates)
    return [c for c in candidates if c in available]
