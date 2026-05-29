"""Per-bundle PE-aggregate evaluation.

The dataset_loader builds one Microsim from the federal
``enhanced_cps_2024.h5``. The per-state and per-district bundles
published by versioned us-data runs hold *different* calibrated
weights — so the federal-fit PE aggregate is **not** the per-bundle
PE aggregate. To validate "is this dataset well-calibrated against its
targets", we have to re-evaluate against the bundle's own h5.

This module:

- Lazily downloads each bundle h5 from HF (cache to disk).
- Loads each into its own ``Microsimulation`` instance (LRU cached in
  memory, max 10).
- Runs the entity-aware evaluator over the subset of targets that
  belong to the bundle, returning per-row ``estimate`` /
  ``rel_error`` / ``abs_rel_error`` evaluated against THAT h5.
- Persists results to a per-bundle pickle so subsequent picks of the
  same bundle skip both the h5 load and the evaluator pass.

Triggered from ``/targets`` only when the caller filters to exactly
one bundle that actually exists for the run; multi-bundle and
no-filter calls keep the federal-fit numbers.
"""

from __future__ import annotations

import logging
import threading
from collections import OrderedDict
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)

# LRU of bundle Microsims, keyed by (repo_id, run_id, bundle_path).
# Bounded so we don't exhaust memory if a user clicks through many
# states / districts in a session.
_SIM_CACHE: "OrderedDict[tuple[str, str, str], object]" = OrderedDict()
_SIM_LOCK = threading.Lock()
_SIM_MAX = 10


def _h5_local_path(
    repo_id: str,
    run_id: str,
    bundle: str,
    cache_root: str,
) -> Path:
    """Lazily fetch the bundle's h5 from HF and return its local path."""
    repo_slug = repo_id.replace("/", "__")
    cache = (
        Path(cache_root) / repo_slug / "root" / run_id
        if run_id == "main"
        else Path(cache_root) / repo_slug / "staging" / run_id
    )
    cache.mkdir(parents=True, exist_ok=True)
    local = cache / bundle  # nested in cache, e.g. states/CA.h5
    if local.exists():
        return local

    from huggingface_hub import hf_hub_download
    hf_path = bundle if run_id == "main" else f"staging/{run_id}/{bundle}"
    logger.info("Downloading bundle h5 %s/%s", repo_id, hf_path)
    downloaded = hf_hub_download(
        repo_id=repo_id,
        filename=hf_path,
        repo_type="model",
        local_dir=str(cache),
    )
    return Path(downloaded)


def _get_sim(
    repo_id: str,
    run_id: str,
    bundle: str,
    cache_root: str = ".artifacts",
):
    """LRU-cached Microsim loaded from the bundle's h5."""
    key = (repo_id, run_id, bundle)
    with _SIM_LOCK:
        cached = _SIM_CACHE.get(key)
        if cached is not None:
            _SIM_CACHE.move_to_end(key)
            return cached

    h5_path = _h5_local_path(repo_id, run_id, bundle, cache_root)
    from policyengine_us import Microsimulation
    logger.info("Initialising bundle Microsim from %s", h5_path)
    sim = Microsimulation(dataset=str(h5_path))

    with _SIM_LOCK:
        _SIM_CACHE[key] = sim
        _SIM_CACHE.move_to_end(key)
        while len(_SIM_CACHE) > _SIM_MAX:
            evicted_key, _ = _SIM_CACHE.popitem(last=False)
            logger.info("Evicted bundle sim %s from LRU", evicted_key)
    return sim


def _estimate_cache_path(
    repo_id: str,
    run_id: str,
    bundle: str,
    cache_root: str = ".artifacts",
) -> Path:
    repo_slug = repo_id.replace("/", "__")
    cache = (
        Path(cache_root) / repo_slug / "root" / run_id
        if run_id == "main"
        else Path(cache_root) / repo_slug / "staging" / run_id
    )
    cache.mkdir(parents=True, exist_ok=True)
    safe = bundle.replace("/", "__")
    return cache / f"{safe}.bundle_estimates.pkl"


def evaluate_bundle(
    targets_df: pd.DataFrame,
    *,
    repo_id: str,
    run_id: str,
    bundle: str,
    time_period: int = 2024,
    cache_root: str = ".artifacts",
) -> pd.DataFrame:
    """Re-evaluate ``targets_df`` against ``bundle``'s h5.

    Mutates a copy and returns it with the federal ``estimate`` /
    ``rel_error`` / ``abs_rel_error`` columns overridden by per-bundle
    numbers. Uses a per-bundle pickle cache so the second pick of the
    same bundle is effectively instant.
    """
    out = targets_df.copy()
    cache_path = _estimate_cache_path(repo_id, run_id, bundle, cache_root)

    # Fast path: cached estimates.
    if cache_path.exists():
        try:
            cached = pd.read_pickle(cache_path)
            joined = out.drop(
                columns=["estimate", "rel_error", "abs_rel_error"],
                errors="ignore",
            ).merge(
                cached[["target_id", "estimate", "rel_error", "abs_rel_error"]],
                on="target_id",
                how="left",
            )
            logger.info(
                "Loaded cached bundle estimates (%d rows) for %s",
                len(cached), bundle,
            )
            return joined
        except Exception as exc:
            logger.warning(
                "Bundle estimate cache read failed (%s); recomputing.", exc,
            )

    sim = _get_sim(repo_id, run_id, bundle, cache_root)
    from backend.services.stratum_evaluator import evaluate_targets
    evaluated = evaluate_targets(out, sim, default_period=time_period)

    slim = evaluated[
        ["target_id", "estimate", "rel_error", "abs_rel_error"]
    ].copy()
    try:
        slim.to_pickle(cache_path)
        logger.info(
            "Cached bundle %s estimates (%d rows) → %s",
            bundle, len(slim), cache_path,
        )
    except Exception as exc:
        logger.warning("Failed to cache bundle estimates: %s", exc)
    return evaluated
