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
import re
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


_CONSTRAINT_RE = re.compile(r"([A-Za-z_][\w]*)(==|!=|>=|<=|>|<)(.+)$")


def _parse_constraint(s: str) -> tuple[str, str, str] | None:
    """Parse 'var op value' (with or without spaces) into a tuple."""
    s = s.strip().replace(" ", "")
    m = _CONSTRAINT_RE.match(s)
    if not m:
        return None
    var, op, val = m.group(1), m.group(2), m.group(3).strip()
    return (var, op, _norm_constraint_value(val))


def _norm_constraint_value(v: str) -> str:
    """Normalise numeric constraint values: '1.0' → '1', '-inf' stays '-inf'."""
    s = str(v).strip()
    if s in ("inf", "-inf", "Infinity", "-Infinity"):
        return s.replace("Infinity", "inf")
    try:
        f = float(s)
        if f != f or f in (float("inf"), float("-inf")):
            return s
        if f == int(f):
            return str(int(f))
        return str(f)
    except (TypeError, ValueError):
        return s


def _parse_diagnostics_key(key: str) -> tuple | None:
    """Convert a diagnostics CSV target key into an order-independent signature.

    Examples:
      national/medicaid                                    → ('national', '', 'medicaid', ())
      national/adj.../[tax_unit_is_filer==1]               → ('national', '', 'adj...', (('tax_unit_is_filer','==','1'),))
      cd_1000/person_count/[age<5,age>-1]                  → ('district', '1000', 'person_count', (('age','<','5'),('age','>','-1')))
    """
    if not isinstance(key, str) or "/" not in key:
        return None
    head, _, rest = key.partition("/")
    if head == "national":
        geo_level, geo_id = "national", ""
    elif head.startswith("cd_"):
        geo_level, geo_id = "district", head[3:]
    else:
        geo_level, geo_id = head, ""
    if "/" in rest:
        variable, _, constraint_part = rest.partition("/")
    else:
        variable, constraint_part = rest, ""
    constraints: list[tuple[str, str, str]] = []
    if constraint_part.startswith("[") and constraint_part.endswith("]"):
        body = constraint_part[1:-1].strip()
        if body:
            for c in body.split(","):
                parsed = _parse_constraint(c)
                if parsed is not None:
                    constraints.append(parsed)
    return (geo_level, geo_id, variable, tuple(sorted(constraints)))


def _row_to_diagnostics_signature(row) -> tuple:
    """Same signature shape as _parse_diagnostics_key but built from a
    targets_enriched row. Order-independent."""
    variable = str(row.get("variable") or "")
    geo_level = row.get("geo_level") or "national"
    gid = row.get("geographic_id")
    if gid is None or (isinstance(gid, float) and pd.isna(gid)):
        geo_id_norm = ""
    else:
        try:
            geo_id_norm = str(int(float(str(gid))))
        except (TypeError, ValueError):
            geo_id_norm = str(gid)
    cons = row.get("constraints") or []
    parsed_cons = []
    for c in cons:
        if isinstance(c, (list, tuple)) and len(c) >= 3:
            parsed_cons.append((str(c[0]), str(c[1]),
                               _norm_constraint_value(str(c[2]))))
        elif isinstance(c, str):
            p = _parse_constraint(c)
            if p is not None:
                parsed_cons.append(p)
    return (geo_level, geo_id_norm, variable, tuple(sorted(parsed_cons)))


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
) -> "tuple[pd.DataFrame, str] | None":
    """For staging-layout datasets, try to fetch the canonical post-
    calibration diagnostics CSV from the repo.

    Uses the Stage 3 artifact catalog (mirrored locally as
    ``backend.services.fit_artifacts`` until us-data ships a release that
    exports ``policyengine_us_data.fit_weights.artifacts``). Tries both
    regional (`unified_diagnostics.csv`) and national
    (`national_unified_diagnostics.csv`) filenames so we don't silently
    miss national-scope runs.

    For each scope we look in two locations:
    1. `calibration/runs/<run_id>/diagnostics/<file>` — per-run.
    2. `calibration/logs/<file>` — "current" canonical snapshot.

    Returns ``(df, scope)`` on success — knowing the scope lets later code
    pick the matching weights / run_config files. Returns ``None`` if
    nothing was found.
    """
    if dataset.layout != "staging":
        return None
    from huggingface_hub import hf_hub_download
    from backend.services.fit_artifacts import (
        artifacts_for_scope,
        SCOPES,
    )

    repo_slug = dataset.repo_id.replace("/", "__")
    cache = Path(cache_root) / repo_slug
    cache.mkdir(parents=True, exist_ok=True)

    for scope in SCOPES:
        filename = artifacts_for_scope(scope).diagnostics
        candidate_paths = [
            f"calibration/runs/{run_id}/diagnostics/{filename}",
            f"calibration/logs/{filename}",
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
                    logger.info(
                        "Loaded %s-scope diagnostics from %s (%d rows)",
                        scope, path, len(df),
                    )
                    return df, scope
            except Exception as exc:
                logger.debug("diagnostics fetch failed at %s: %s", path, exc)
                continue
    return None


def _ensure_staging_artifacts(
    dataset: DatasetConfig,
    run_id: str,
    cache_root: str = ".artifacts",
) -> dict[str, str]:
    """Download a staging run's required files; return a {logical_name: path} map.

    Logical names are the flat filenames (``policy_data.db``,
    ``enhanced_cps_2024.h5``); on HF they may live at the run root OR
    nested under ``calibration/`` / ``datasets/``. We probe both so
    versioned releases and GHA staging both load through the same code
    path, and store everything flat in the local cache.
    """
    from huggingface_hub import hf_hub_download
    from backend.services.runs import _resolve_staging_file_paths
    import shutil

    prefix = storage_prefix(dataset, run_id)
    repo_slug = dataset.repo_id.replace("/", "__")
    cache = Path(cache_root) / repo_slug / prefix
    cache.mkdir(parents=True, exist_ok=True)

    logical_names = list(dataset.effective_required_files())
    actual_paths = _resolve_staging_file_paths(
        dataset.repo_id, run_id, logical_names,
    )

    resolved: dict[str, str] = {}
    for fn in logical_names:
        dest = cache / fn  # flat in our cache
        if dest.exists():
            logger.info("Found cached %s: %s", fn, dest)
            resolved[fn] = str(dest)
            continue

        hf_path = actual_paths.get(fn)
        if hf_path is None:
            logger.warning("Run %s does not publish %s; skipping.", run_id, fn)
            continue
        logger.info("Downloading %s from %s/%s ...", fn, dataset.repo_id, hf_path)
        try:
            downloaded = hf_hub_download(
                repo_id=dataset.repo_id,
                filename=hf_path,
                repo_type=dataset.repo_type,
                local_dir=str(cache),
            )
        except Exception as exc:
            logger.warning("Could not download %s: %s", hf_path, exc)
            continue

        # hf_hub_download honors the repo path under local_dir, so the
        # file lands at cache/<hf_path>. Move it to the flat dest so the
        # rest of the loader doesn't need to know about the layout.
        src = Path(downloaded)
        if src != dest:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dest))
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
    # `included` is set to True later only for rows that match a published
    # entry in unified_diagnostics.csv — the only honest signal we have for
    # "this target was actually evaluated by the calibration loss this run."
    # The DB's `active` flag is always 1 and so isn't useful here.
    targets["included"] = False
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

    # If we've previously computed estimates for this run, the parquet
    # cache is good for the lifetime of the run (run_id is immutable per
    # publish). Skip the CSV join + entity-aware evaluator entirely.
    # Pickle keeps pandas types (object cols with lists, etc.) and needs no
    # extra deps. Cache key is the immutable run_id, so no staleness risk
    # within a run; bump SCHEMA_VERSION below to invalidate on shape change.
    enriched_cache_path = (
        Path(cache_root) / dataset.repo_id.replace("/", "__")
        / "staging" / run_id / "targets_enriched.pkl"
    )
    SCHEMA_VERSION = 1
    cached_enriched: pd.DataFrame | None = None
    detected_scope_cached: str | None = None
    if enriched_cache_path.exists():
        try:
            meta_path = enriched_cache_path.with_suffix(".meta.json")
            if meta_path.exists():
                import json as _json
                meta = _json.loads(meta_path.read_text())
                if meta.get("version") == SCHEMA_VERSION:
                    cached_enriched = pd.read_pickle(enriched_cache_path)
                    detected_scope_cached = meta.get("fit_scope")
                    logger.info(
                        "Loaded cached targets_enriched (%d rows) from %s",
                        len(cached_enriched), enriched_cache_path,
                    )
        except Exception as exc:
            logger.warning("Failed to read enriched cache (%s); recomputing.", exc)
            cached_enriched = None

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
    # Skip CSV join + evaluator entirely if the parquet cache was already
    # warmed for this run. targets_df becomes the cached frame; we still
    # need to compute downstream stuff (households_df, sparse mats).
    if cached_enriched is not None:
        targets_df = cached_enriched
        diag_result = None
        diag_scope = detected_scope_cached
    else:
        diag_result = _try_fetch_unified_diagnostics(dataset, run_id, cache_root)
        diag_scope: str | None = None
    if diag_result is not None:
        diag_df, diag_scope = diag_result
        logger.info(
            "Joining %d rows from %s-scope diagnostics onto %d targets...",
            len(diag_df), diag_scope, len(targets_df),
        )
        # Parse each diag key into a constraint-order-independent signature
        # and build sig → estimate.
        diag_sig_to_estimate: dict[tuple, float] = {}
        for diag_target, est in zip(diag_df["target"], diag_df["estimate"]):
            sig = _parse_diagnostics_key(diag_target)
            if sig is not None:
                diag_sig_to_estimate[sig] = est
        # Compute the same signature on each of our rows and join.
        targets_df["estimate"] = targets_df.apply(
            lambda r: diag_sig_to_estimate.get(_row_to_diagnostics_signature(r)),
            axis=1,
        )
        # A CSV match means the pipeline evaluated this target in its loss.
        # That's our "included" signal — it correctly distinguishes in-loss
        # rows (~14k) from authored-but-not-evaluated rows (~27k).
        targets_df["included"] = targets_df["estimate"].notna()
        n_from_diag = int(targets_df["estimate"].notna().sum())
        logger.info(
            "  → %d/%d targets got estimates from diagnostics CSV (marked included=True)",
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

    # Stash the detected fit scope so other artifact lookups can pick the
    # right regional/national filenames. Falls back to regional when we
    # couldn't fetch diagnostics at all (best guess for legacy runs).
    detected_scope = diag_scope or "regional"

    # Write the enriched parquet cache so subsequent loads can skip the
    # CSV join + evaluator entirely. Only write if we actually did the
    # work (cached_enriched is None means we recomputed this load).
    if cached_enriched is None:
        try:
            enriched_cache_path.parent.mkdir(parents=True, exist_ok=True)
            targets_df.to_pickle(enriched_cache_path)
            import json as _json
            enriched_cache_path.with_suffix(".meta.json").write_text(
                _json.dumps({"fit_scope": detected_scope, "version": SCHEMA_VERSION})
            )
            logger.info("Cached targets_enriched → %s", enriched_cache_path)
        except Exception as exc:
            logger.warning("Failed to cache enriched targets (%s); continuing.", exc)

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
        metadata={"fit_scope": detected_scope},
    )

    # Cache the sim on the state so the evaluator can reuse it later.
    state.sim_service = sim
    return state
