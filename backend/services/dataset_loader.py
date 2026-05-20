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


def _target_to_diagnostics_key(row) -> str:
    """Build the target key used in unified_diagnostics.csv from a
    targets_enriched row.

    Diag format observed empirically:
      <geo_prefix>/<variable>                      (no constraints)
      <geo_prefix>/<variable>/[<c1>,<c2>,...]      (with constraints, no spaces)

    Where geo_prefix is:
      "national"      — when no geographic constraint
      "cd_<gid>"      — when geographic_id is a district id (no leading zeros)

    State-level rows aren't represented in the diagnostics file (the
    calibration trains national + district only). We return a key anyway;
    those will simply miss the join.
    """
    variable = str(row.get("variable") or "")
    geo_level = row.get("geo_level") or ""
    gid = row.get("geographic_id")
    if geo_level == "national" or geo_level == "" or gid is None or (isinstance(gid, float) and pd.isna(gid)):
        prefix = "national"
    elif geo_level == "district":
        try:
            prefix = f"cd_{int(float(str(gid)))}"
        except (TypeError, ValueError):
            prefix = f"cd_{gid}"
    elif geo_level == "state":
        # No state rows in diag — return a key that won't match.
        try:
            prefix = f"state_{int(float(str(gid)))}"
        except (TypeError, ValueError):
            prefix = f"state_{gid}"
    else:
        prefix = geo_level

    cons = row.get("constraints") or []
    if not cons:
        return f"{prefix}/{variable}"
    # Strip spaces from each "var op value" → "varopvalue"; join with ",".
    parts = []
    for c in cons:
        # `c` may be either a string "var op value" (from DB rebuild) or a
        # (var, op, value) tuple.
        if isinstance(c, (list, tuple)) and len(c) >= 3:
            parts.append(f"{c[0]}{c[1]}{c[2]}")
        else:
            parts.append(str(c).replace(" ", ""))
    return f"{prefix}/{variable}/[{','.join(parts)}]"


def _try_fetch_unified_diagnostics(
    dataset,
    run_id: str,
    cache_root: str = ".artifacts",
) -> "pd.DataFrame | None":
    """For staging-layout datasets, try to fetch the canonical post-
    calibration diagnostics CSV from the repo.

    Lookup order:
    1. `calibration/runs/<run_id>/diagnostics/unified_diagnostics.csv` —
       per-run diagnostics, ideal when the run id matches a published one.
    2. `calibration/logs/unified_diagnostics.csv` — the "current" canonical
       snapshot. Used as fallback when the per-run path doesn't exist.

    Returns None on any failure (network, missing file, parse error).
    """
    if dataset.layout != "staging":
        return None
    from huggingface_hub import hf_hub_download
    repo_slug = dataset.repo_id.replace("/", "__")
    cache = Path(cache_root) / repo_slug
    cache.mkdir(parents=True, exist_ok=True)

    candidate_paths = [
        f"calibration/runs/{run_id}/diagnostics/unified_diagnostics.csv",
        "calibration/logs/unified_diagnostics.csv",
    ]
    for path in candidate_paths:
        try:
            local = hf_hub_download(
                repo_id=dataset.repo_id,
                filename=path,
                repo_type=dataset.repo_type,
                local_dir=str(cache),
            )
            df = pd.read_csv(local)
            if "target" in df.columns and "estimate" in df.columns:
                logger.info("Loaded diagnostics from %s (%d rows)", path, len(df))
                return df
        except Exception as exc:
            logger.debug("diagnostics fetch failed at %s: %s", path, exc)
            continue
    return None


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
        gid = r["geographic_id"]
        if gid is None or (isinstance(gid, float) and pd.isna(gid)):
            geo_part = "US"
        else:
            geo_part = str(gid)
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

    # Dataset mode: the canonical us-data repo publishes a per-run
    # `unified_diagnostics.csv` (under calibration/runs/<run>/diagnostics/)
    # that already contains post-calibration estimates for every target the
    # pipeline trained against. We use those directly — no need to rebuild
    # the X matrix.
    #
    # Targets the diagnostics file doesn't cover (typically the ones excluded
    # by target_config.yaml during this calibration) fall back to the MVP
    # evaluator, which handles the simple geographic-only cases.
    diag_df = _try_fetch_unified_diagnostics(dataset, run_id, cache_root)
    if diag_df is not None:
        logger.info(
            "Joining %d rows from unified_diagnostics.csv onto %d targets...",
            len(diag_df), len(targets_df),
        )
        diag_by_name = dict(zip(diag_df["target"], diag_df["estimate"]))
        diag_keys = targets_df.apply(_target_to_diagnostics_key, axis=1)
        targets_df["estimate"] = diag_keys.map(diag_by_name)
        n_from_diag = int(targets_df["estimate"].notna().sum())
        logger.info(
            "  → %d/%d targets got estimates from diagnostics CSV",
            n_from_diag, len(targets_df),
        )
    else:
        logger.info("No unified_diagnostics.csv found; falling back to MVP evaluator only.")

    # Fill any remaining NaN estimates via the MVP evaluator (geographic-only).
    if targets_df["estimate"].isna().any():
        from backend.services.stratum_evaluator import evaluate_targets
        unfilled = targets_df["estimate"].isna()
        logger.info(
            "Running MVP evaluator on %d remaining targets...", int(unfilled.sum()),
        )
        filled = evaluate_targets(
            targets_df[unfilled].copy(), sim, default_period=time_period,
        )
        targets_df.loc[unfilled, "estimate"] = filled["estimate"].values
    n_evaluated = int(np.sum(~targets_df["estimate"].isna()))
    logger.info(
        "Total estimates available: %d/%d (%.1f%%)",
        n_evaluated, len(targets_df), 100 * n_evaluated / max(1, len(targets_df)),
    )

    # Compute rel_error / abs_rel_error now that estimates are filled.
    target_values = targets_df["value"].to_numpy(dtype=np.float64)
    estimates_arr = targets_df["estimate"].to_numpy(dtype=np.float64)
    with np.errstate(divide="ignore", invalid="ignore"):
        rel = np.where(
            np.abs(target_values) > 0,
            (estimates_arr - target_values) / np.abs(target_values),
            np.nan,
        )
    targets_df["rel_error"] = rel
    targets_df["abs_rel_error"] = np.abs(rel)

    # Empty sparse matrices since dataset mode doesn't have the pipeline's
    # X matrix yet (waiting on data-team publish).
    from scipy import sparse
    X_csr = sparse.csr_matrix((len(targets_df), n_households))
    X_csc = X_csr.tocsc()

    state = AppState(
        X_csr=X_csr,
        X_csc=X_csc,
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
