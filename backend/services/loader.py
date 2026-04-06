"""Load all calibration artifacts and compute derived fields at startup."""

import logging
import os
from pathlib import Path

import numpy as np
import pandas as pd
from sqlalchemy import create_engine

from policyengine_us_data.calibration.unified_calibration import (
    load_calibration_package,
)

from backend.services.geo_utils import parse_cd_geoids
from backend.services.sim_service import SimService
from backend.state import AppState

logger = logging.getLogger(__name__)

HF_REPO = "PolicyEngine/policyengine-us-data-pipeline"
HF_REPO_TYPE = "model"
HF_PREFIX = "test"

HF_ARTIFACTS = {
    "package_path": "calibration_package.pkl",
    "weights_path": "calibration_weights.npy",
    "db_path": "policy_data.db",
    "dataset_path": "source_imputed_stratified_extended_cps.h5",
    "cal_log_path": "calibration_log.csv",
    "diagnostics_path": "unified_diagnostics.csv",
}


def _ensure_artifacts(config: dict, cache_dir: str = ".artifacts") -> dict:
    """Download missing artifacts from HuggingFace.

    For each config key, if the local path doesn't exist, downloads
    from HF_REPO/HF_PREFIX/{filename}. Returns an updated config
    with resolved local paths.
    """
    from huggingface_hub import hf_hub_download

    cache = Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    resolved = dict(config)

    for key, hf_filename in HF_ARTIFACTS.items():
        local_path = config.get(key)

        if local_path and Path(local_path).exists():
            logger.info("Found local %s: %s", key, local_path)
            continue

        dest = cache / hf_filename
        if dest.exists():
            logger.info("Found cached %s: %s", key, dest)
            resolved[key] = str(dest)
            continue

        hf_path = f"{HF_PREFIX}/{hf_filename}"
        logger.info(
            "Downloading %s from %s/%s ...", key, HF_REPO, hf_path
        )
        downloaded = hf_hub_download(
            repo_id=HF_REPO,
            filename=hf_path,
            repo_type=HF_REPO_TYPE,
            local_dir=str(cache),
        )
        # hf_hub_download may nest under HF_PREFIX/
        nested = cache / HF_PREFIX / hf_filename
        if nested.exists() and not dest.exists():
            nested.rename(dest)
            # Clean up empty prefix dir
            try:
                (cache / HF_PREFIX).rmdir()
            except OSError:
                pass

        resolved[key] = str(dest)
        size_mb = dest.stat().st_size / 1e6
        logger.info("  Downloaded %s (%.1f MB)", hf_filename, size_mb)

    return resolved


def load_all_artifacts(config: dict) -> AppState:
    """Load every artifact and build the AppState.

    Args:
        config: dict with keys:
            package_path, weights_path, db_path, dataset_path,
            cal_log_path (optional), diagnostics_path (optional)
    """
    # 0. Download any missing artifacts from HuggingFace
    config = _ensure_artifacts(config)

    # 1. Load calibration package
    logger.info("Loading calibration package from %s", config["package_path"])
    package = load_calibration_package(config["package_path"])
    X_csr = package["X_sparse"]
    targets_df = package["targets_df"]
    target_names = package["target_names"]
    initial_weights = package["initial_weights"]
    cd_geoid = package.get("cd_geoid", np.array([]))
    metadata = package.get("metadata", {})

    n_targets, n_households = X_csr.shape
    logger.info("Matrix shape: %d targets x %d households", n_targets, n_households)

    # 2. Load final weights
    logger.info("Loading final weights from %s", config["weights_path"])
    final_weights = np.load(config["weights_path"])
    assert len(final_weights) == n_households, (
        f"Weight length {len(final_weights)} != matrix cols {n_households}"
    )

    # 3. Build CSC for column access
    logger.info("Building CSC matrix for column access...")
    X_csc = X_csr.tocsc()

    # 4. Initialize Microsimulation
    logger.info("Initializing Microsimulation from %s", config["dataset_path"])
    from policyengine_us import Microsimulation

    sim = Microsimulation(dataset=config["dataset_path"])
    time_period = _detect_time_period(sim)
    n_base = len(sim.calculate("household_id", map_to="household").values)
    n_clones = n_households // n_base
    logger.info(
        "Base households: %d, clones: %d, total: %d",
        n_base, n_clones, n_households,
    )
    sim_service = SimService(sim, time_period, n_clones)
    logger.info("Microsimulation ready, time_period=%d", time_period)

    # 5. Compute core household fields
    logger.info("Computing household fields...")
    hh_income = sim_service.calculate("spm_unit_net_income", map_to="household")
    hh_threshold = sim_service.calculate(
        "spm_unit_spm_threshold", map_to="household"
    )

    # 6. Derive g-weights, poverty flags, deciles
    g_weights = final_weights / np.maximum(initial_weights, 1e-10)
    in_poverty = hh_income < hh_threshold
    income_decile = pd.qcut(
        hh_income, 10, labels=False, duplicates="drop"
    )

    cd_geoid_int, state_fips = parse_cd_geoids(cd_geoid)

    households_df = pd.DataFrame({
        "household_idx": np.arange(n_households),
        "income": hh_income.astype(np.float32),
        "spm_threshold": hh_threshold.astype(np.float32),
        "in_poverty": in_poverty,
        "initial_weight": initial_weights.astype(np.float32),
        "final_weight": final_weights.astype(np.float32),
        "g_weight": g_weights.astype(np.float32),
        "state": state_fips,
        "cd_geoid": cd_geoid_int,
        "income_decile": income_decile.astype(np.int8),
    })
    logger.info("households_df: %d rows", len(households_df))

    # 7. Enrich targets with error metrics and loss contribution
    logger.info("Enriching targets with diagnostics...")
    targets_enriched = _enrich_targets(
        targets_df, target_names, X_csr, final_weights, initial_weights, in_poverty
    )
    logger.info("targets_enriched: %d rows", len(targets_enriched))

    # 8. Connect to targets database
    db_engine = None
    if config.get("db_path") and Path(config["db_path"]).exists():
        db_engine = create_engine(f"sqlite:///{config['db_path']}")
        logger.info("Connected to policy_data.db at %s", config["db_path"])

    # 9. Load optional CSVs
    cal_log = _load_csv(config.get("cal_log_path"))
    diagnostics_csv = _load_csv(config.get("diagnostics_path"))

    return AppState(
        X_csr=X_csr,
        X_csc=X_csc,
        targets_df=targets_df,
        target_names=target_names,
        initial_weights=initial_weights,
        cd_geoid=cd_geoid,
        metadata=metadata,
        final_weights=final_weights,
        g_weights=g_weights,
        targets_enriched=targets_enriched,
        households_df=households_df,
        sim_service=sim_service,
        db_engine=db_engine,
        cal_log=cal_log,
        diagnostics_csv=diagnostics_csv,
        time_period=time_period,
        n_targets=n_targets,
        n_households=n_households,
    )


def _detect_time_period(sim) -> int:
    """Detect time period from the dataset."""
    raw_keys = sim.dataset.load_dataset()["household_id"]
    if isinstance(raw_keys, dict):
        return int(next(iter(raw_keys)))
    return 2024


def _enrich_targets(
    targets_df: pd.DataFrame,
    target_names: list[str],
    X_csr,
    final_weights: np.ndarray,
    initial_weights: np.ndarray,
    in_poverty: np.ndarray,
) -> pd.DataFrame:
    """Add estimate, rel_error, loss_contribution, contributor counts."""
    enriched = targets_df.copy()
    enriched["target_name"] = target_names[: len(enriched)]

    estimates = X_csr.dot(final_weights)
    target_values = enriched["value"].values

    rel_errors = np.where(
        np.abs(target_values) > 0,
        (estimates - target_values) / np.abs(target_values),
        0.0,
    )

    enriched["estimate"] = estimates
    enriched["rel_error"] = rel_errors
    enriched["abs_rel_error"] = np.abs(rel_errors)

    # Loss contribution: each target's share of total squared relative error
    squared_errors = rel_errors ** 2
    total_loss = squared_errors.sum()
    if total_loss > 0:
        enriched["loss_contribution"] = squared_errors / total_loss
    else:
        enriched["loss_contribution"] = 0.0

    # Contributor counts (no poverty-specific metrics)
    n_contributors = np.zeros(len(enriched), dtype=np.int32)
    for i in range(len(enriched)):
        n_contributors[i] = len(X_csr[i, :].nonzero()[1])
    enriched["n_contributors"] = n_contributors

    return enriched


def _load_csv(path: str | None) -> pd.DataFrame | None:
    """Load a CSV if the path exists."""
    if path and Path(path).exists():
        logger.info("Loading CSV from %s", path)
        return pd.read_csv(path)
    return None
