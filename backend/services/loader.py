"""Load all calibration artifacts and compute derived fields at startup."""

import logging
import os
from pathlib import Path

import numpy as np
import pandas as pd
from sqlalchemy import create_engine

from policyengine_us_data.calibration.unified_calibration import (
    load_calibration_package,
    load_target_config,
)

from backend.services.geo_utils import parse_cd_geoids
from backend.services.sim_service import SimService
from backend.state import AppState

logger = logging.getLogger(__name__)

HF_ARTIFACTS = {
    "package_path": "calibration_package.pkl",
    "weights_path": "calibration_weights.npy",
    "db_path": "policy_data.db",
    "dataset_path": "source_imputed_stratified_extended_cps.h5",
    "cal_log_path": "calibration_log.csv",
    "diagnostics_path": "unified_diagnostics.csv",
    "target_config_path": "target_config.yaml",
}


def _ensure_artifacts(
    repo_id: str,
    repo_type: str,
    prefix: str,
    cache_root: str = ".artifacts",
) -> dict:
    """Download a run's artifacts from HuggingFace, cached per (repo, prefix).

    Returns a config dict mapping artifact keys to resolved local paths.
    Caches under <cache_root>/<repo_id-slug>/<prefix>/.
    """
    from huggingface_hub import hf_hub_download

    repo_slug = repo_id.replace("/", "__")
    cache = Path(cache_root) / repo_slug / prefix
    cache.mkdir(parents=True, exist_ok=True)
    resolved: dict = {}

    for key, hf_filename in HF_ARTIFACTS.items():
        dest = cache / hf_filename
        if dest.exists():
            logger.info("Found cached %s: %s", key, dest)
            resolved[key] = str(dest)
            continue

        hf_path = f"{prefix}/{hf_filename}"
        logger.info(
            "Downloading %s from %s/%s ...", key, repo_id, hf_path
        )
        try:
            hf_hub_download(
                repo_id=repo_id,
                filename=hf_path,
                repo_type=repo_type,
                local_dir=str(cache),
            )
        except Exception as exc:
            logger.warning("Could not download %s: %s", hf_path, exc)
            resolved[key] = None
            continue

        nested = cache / prefix / hf_filename
        if nested.exists() and not dest.exists():
            nested.rename(dest)
            try:
                (cache / prefix).rmdir()
            except OSError:
                pass

        resolved[key] = str(dest) if dest.exists() else None
        if dest.exists():
            size_mb = dest.stat().st_size / 1e6
            logger.info("  Downloaded %s (%.1f MB)", hf_filename, size_mb)

    return resolved


def load_run(
    repo_id: str,
    repo_type: str,
    prefix: str,
    cache_root: str = ".artifacts",
    dataset_id: str = "",
) -> AppState:
    """Convenience entrypoint that resolves a run's artifacts and loads them."""
    config = _ensure_artifacts(repo_id, repo_type, prefix, cache_root)
    state = load_all_artifacts(config)
    state.dataset_id = dataset_id
    state.run_id = prefix
    return state


def load_all_artifacts(config: dict) -> AppState:
    """Load every artifact and build the AppState.

    Args:
        config: dict with keys:
            package_path, weights_path, db_path, dataset_path,
            cal_log_path (optional), diagnostics_path (optional),
            target_config_path (optional)
    """

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

    # 9. Load target config and mark included/excluded
    target_config = None
    tc_path = config.get("target_config_path")
    target_config_text: str | None = None
    if tc_path and Path(tc_path).exists():
        target_config = load_target_config(tc_path)
        try:
            target_config_text = Path(tc_path).read_text(encoding="utf-8")
        except OSError as exc:
            logger.warning("Could not read raw target_config yaml: %s", exc)
        targets_enriched = _apply_included_flag(targets_enriched, target_config)
        logger.info(
            "Target config: %d included, %d excluded",
            targets_enriched["included"].sum(),
            (~targets_enriched["included"]).sum(),
        )
        # Recompute loss_contribution over included targets only
        targets_enriched = _recompute_loss_for_included(targets_enriched)
    else:
        targets_enriched["included"] = True
        logger.warning("No target config found — all targets marked as included")

    # 10. Batch-query constraints and add domain/additional columns
    if db_engine is not None:
        targets_enriched = _add_constraint_columns(targets_enriched, db_engine)
        logger.info("Added domain and additional_constraints columns")

    # 11. Load optional CSVs
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
        target_config=target_config,
        target_config_text=target_config_text,
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


def _apply_included_flag(
    targets_enriched: pd.DataFrame,
    target_config: dict,
) -> pd.DataFrame:
    """Mark each target as included or excluded based on target_config rules."""
    include_rules = target_config.get("include", [])
    exclude_rules = target_config.get("exclude", [])

    if not include_rules and not exclude_rules:
        targets_enriched["included"] = True
        return targets_enriched

    if include_rules:
        mask = _match_rules(targets_enriched, include_rules)
    else:
        mask = np.ones(len(targets_enriched), dtype=bool)

    if exclude_rules:
        drop = _match_rules(targets_enriched, exclude_rules)
        mask &= ~drop

    targets_enriched["included"] = mask
    return targets_enriched


def _match_rules(targets_df: pd.DataFrame, rules: list[dict]) -> np.ndarray:
    """Build a boolean mask matching any of the given rules.

    Reimplements unified_calibration._match_rules for use at the app level.
    """
    mask = np.zeros(len(targets_df), dtype=bool)
    for rule in rules:
        rule_mask = targets_df["variable"] == rule["variable"]
        if "geo_level" in rule:
            rule_mask = rule_mask & (targets_df["geo_level"] == rule["geo_level"])
        if "domain_variable" in rule:
            rule_mask = rule_mask & (
                targets_df["domain_variable"] == rule["domain_variable"]
            )
        mask |= rule_mask.values
    return mask


def _recompute_loss_for_included(targets_enriched: pd.DataFrame) -> pd.DataFrame:
    """Recompute loss_contribution scoped to included targets only."""
    included = targets_enriched["included"].values
    sq_errors = targets_enriched["rel_error"].values ** 2
    total_included_loss = sq_errors[included].sum()
    if total_included_loss > 0:
        loss = np.where(included, sq_errors / total_included_loss, 0.0)
    else:
        loss = np.zeros(len(targets_enriched))
    targets_enriched["loss_contribution"] = loss
    return targets_enriched


GEOGRAPHIC_VARS = {"state_fips", "congressional_district_geoid", "ucgid_str"}
ADDITIONAL_VARS = {"tax_unit_is_filer"}


def _add_constraint_columns(
    targets_enriched: pd.DataFrame,
    db_engine,
) -> pd.DataFrame:
    """Add domain and additional_constraints columns.

    Domain comes from the package's domain_variable column (internally
    consistent with the package data). Full constraint details from the
    DB are only reliable when the DB and package are from the same build.
    """
    # domain_variable from the package is the GROUP_CONCAT of
    # non-geographic constraint variable names. Use it directly.
    targets_enriched["domain"] = targets_enriched["domain_variable"].apply(
        lambda v: str(v) if pd.notna(v) else None
    )

    # For additional_constraints, check if the target name contains
    # tax_unit_is_filer. The target_name encodes all constraints in
    # its [...] suffix, so we can parse it from there.
    def _extract_additional(target_name: str) -> str | None:
        if not isinstance(target_name, str):
            return None
        parts = []
        if "tax_unit_is_filer" in target_name:
            parts.append("tax_unit_is_filer == 1")
        return ", ".join(parts) or None

    targets_enriched["additional_constraints"] = targets_enriched["target_name"].apply(
        _extract_additional
    )
    return targets_enriched


def _load_csv(path: str | None) -> pd.DataFrame | None:
    """Load a CSV if the path exists."""
    if path and Path(path).exists():
        logger.info("Loading CSV from %s", path)
        return pd.read_csv(path)
    return None
