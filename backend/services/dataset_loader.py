"""Load a calibration run from the canonical us-data staging layout.

Unlike loader.py (which depends on calibration_package.pkl), this:
- downloads policy_data.db (targets DB) and one h5 dataset per run
- reads targets directly from the DB
- defers estimate computation to the stratum evaluator (Step 3)

The resulting AppState has X_csr / X_csc / initial_weights left empty; routes
that need the X matrix (per-target detail tabs) won't function for these runs,
but the universe view (Summary + All targets) works.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
import pandas as pd
from sqlalchemy import create_engine

from backend.services.runs import DatasetConfig, storage_prefix
from backend.state import AppState

if TYPE_CHECKING:
    from huggingface_hub import HfApi  # noqa: F401

logger = logging.getLogger(__name__)


def _ensure_staging_artifacts(
    dataset: DatasetConfig,
    run_id: str,
    cache_root: str = ".artifacts",
) -> dict[str, str]:
    """Download a staging run's required files; return a {filename: path} map."""
    from huggingface_hub import hf_hub_download

    prefix = storage_prefix(dataset, run_id)
    repo_slug = dataset.repo_id.replace("/", "__")
    # Cache under e.g. .artifacts/PolicyEngine__policyengine-us-data/staging/<run>/
    cache = Path(cache_root) / repo_slug / prefix
    cache.mkdir(parents=True, exist_ok=True)

    filenames = dataset.effective_required_files()
    resolved: dict[str, str] = {}
    for fn in filenames:
        dest = cache / fn
        if dest.exists():
            logger.info("Found cached %s: %s", fn, dest)
            resolved[fn] = str(dest)
            continue

        hf_path = f"{prefix}/{fn}"
        logger.info("Downloading %s from %s/%s ...", fn, dataset.repo_id, hf_path)
        try:
            hf_hub_download(
                repo_id=dataset.repo_id,
                filename=hf_path,
                repo_type=dataset.repo_type,
                local_dir=str(cache),
            )
        except Exception as exc:
            logger.warning("Could not download %s: %s", hf_path, exc)
            continue

        # hf_hub_download may nest the file under the prefix path.
        nested = cache / prefix / fn
        if nested.exists() and not dest.exists():
            nested.rename(dest)
            try:
                (cache / prefix).rmdir()
            except OSError:
                pass
        if dest.exists():
            resolved[fn] = str(dest)
            size_mb = dest.stat().st_size / 1e6
            logger.info("  Downloaded %s (%.1f MB)", fn, size_mb)

    return resolved


def _load_targets_from_db(db_engine) -> tuple[pd.DataFrame, list[str]]:
    """Read targets + denormalised constraint info from policy_data.db.

    Returns (targets_df, target_names) where targets_df mirrors the columns
    the rest of the dashboard expects: target_id, variable, value, period,
    geo_level, geographic_id, domain_variable, included, plus a 'constraints'
    list and a 'target_name' string built from those.
    """
    # All active targets (DB convention — calibration team uses `active` flag)
    targets = pd.read_sql(
        "SELECT target_id, variable, period, stratum_id, value, active, "
        "tolerance, source, notes FROM targets WHERE active = 1",
        db_engine,
    )

    # Pull all constraints once, group by stratum_id (faster than per-row query).
    constraints = pd.read_sql(
        "SELECT stratum_id, constraint_variable, operation, value FROM "
        "stratum_constraints",
        db_engine,
    )

    geo_vars = {"state_fips", "congressional_district_geoid", "ucgid_str"}
    by_stratum: dict[int, list[dict]] = {}
    for _, row in constraints.iterrows():
        by_stratum.setdefault(row.stratum_id, []).append({
            "variable": row.constraint_variable,
            "operation": row.operation,
            "value": row.value,
        })

    geo_levels: list[str] = []
    geographic_ids: list[str | None] = []
    domain_vars: list[str | None] = []
    constraint_lists: list[list[str]] = []

    for sid in targets["stratum_id"]:
        cons = by_stratum.get(int(sid), [])
        geo_con = next((c for c in cons if c["variable"] in geo_vars), None)
        if geo_con is None:
            geo_level = "national"
            geographic_id = None
        elif geo_con["variable"] == "state_fips":
            geo_level = "state"
            geographic_id = str(geo_con["value"])
        elif geo_con["variable"] == "congressional_district_geoid":
            geo_level = "district"
            geographic_id = str(geo_con["value"])
        else:
            geo_level = geo_con["variable"]
            geographic_id = str(geo_con["value"])

        non_geo = [c for c in cons if c["variable"] not in geo_vars]
        domain_var = ",".join(sorted({c["variable"] for c in non_geo})) or None
        readable = [f"{c['variable']} {c['operation']} {c['value']}" for c in non_geo]

        geo_levels.append(geo_level)
        geographic_ids.append(geographic_id)
        domain_vars.append(domain_var)
        constraint_lists.append(readable)

    targets["geo_level"] = geo_levels
    targets["geographic_id"] = geographic_ids
    targets["domain_variable"] = domain_vars
    targets["constraints"] = constraint_lists

    # Build readable target names: <geo_level>/<variable>/<geo_id>/[constraints]
    names: list[str] = []
    for _, r in targets.iterrows():
        geo_part = r["geographic_id"] or "US"
        constraint_part = (
            ",".join(r["constraints"]) if r["constraints"] else ""
        )
        names.append(
            f"{r['geo_level']}/{r['variable']}/{geo_part}/[{constraint_part}]"
        )
    targets["target_name"] = names

    # Convenience aliased columns matching the pkl-mode shape
    targets["target_idx"] = np.arange(len(targets))
    targets["included"] = True  # No target_config in this layout; all active
    targets["estimate"] = np.nan
    targets["rel_error"] = np.nan
    targets["abs_rel_error"] = np.nan
    targets["loss_contribution"] = 0.0
    targets["n_contributors"] = 0

    return targets, names


def _detect_time_period(sim) -> int:
    try:
        raw_keys = sim.dataset.load_dataset()["household_id"]
        if isinstance(raw_keys, dict):
            return int(next(iter(raw_keys)))
    except Exception:
        pass
    return 2024


def load_run_from_dataset(
    dataset: DatasetConfig,
    run_id: str,
    cache_root: str = ".artifacts",
) -> AppState:
    """Load a staging-layout run into an AppState. Step 2 of the refactor:
    populates targets + DB + simulation but leaves estimates as NaN (Step 4
    will fill them in via the stratum evaluator).
    """
    from policyengine_us import Microsimulation

    files = _ensure_staging_artifacts(dataset, run_id, cache_root)
    if "policy_data.db" not in files or dataset.primary_h5 not in files:
        raise RuntimeError(
            f"Required files missing for {dataset.id}/{run_id}: "
            f"have {sorted(files)}"
        )

    logger.info("Connecting to policy_data.db at %s", files["policy_data.db"])
    db_engine = create_engine(f"sqlite:///{files['policy_data.db']}")

    logger.info("Loading targets from DB...")
    targets_df, target_names = _load_targets_from_db(db_engine)
    logger.info("Loaded %d active targets", len(targets_df))

    logger.info("Initializing Microsimulation from %s", files[dataset.primary_h5])
    sim = Microsimulation(dataset=files[dataset.primary_h5])
    time_period = _detect_time_period(sim)

    # Household-level scaffolding so weights/geo lookups work
    household_weight = sim.calculate(
        "household_weight", map_to="household", period=time_period,
    ).values
    n_households = len(household_weight)

    households_df = pd.DataFrame({
        "household_idx": np.arange(n_households),
        "initial_weight": household_weight.astype(np.float32),
        "final_weight": household_weight.astype(np.float32),
    })

    # Compute estimates for targets we can evaluate (national + simple
    # geographic). Constrained targets keep NaN and gain an eval_note.
    logger.info("Evaluating targets against dataset...")
    from backend.services.stratum_evaluator import evaluate_targets
    targets_df = evaluate_targets(targets_df, sim, default_period=time_period)
    n_evaluated = int(np.sum(~targets_df["estimate"].isna()))
    logger.info(
        "Evaluated %d/%d targets (others need entity-mapped constraints)",
        n_evaluated, len(targets_df),
    )

    state = AppState(
        targets_df=targets_df,
        target_names=target_names,
        targets_enriched=targets_df,
        households_df=households_df,
        sim_service=None,  # filled in step 3 alongside the evaluator
        db_engine=db_engine,
        time_period=time_period,
        n_targets=len(targets_df),
        n_households=n_households,
        dataset_id=dataset.id,
        run_id=run_id,
        # Weights live on the dataset itself; we don't have a "before
        # calibration" view because the published dataset IS the post-
        # calibration state.
        initial_weights=household_weight,
        final_weights=household_weight,
        g_weights=np.ones(n_households),
    )

    # Cache the sim on the state so the evaluator can reuse it later.
    state.sim_service = sim
    return state
