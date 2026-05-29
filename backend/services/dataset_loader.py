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
import os
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

    For each scope we look in:
    1. `calibration/runs/<run_id>/diagnostics/<file>` — per-run.
    2. `calibration/logs/<file>` — "current" canonical snapshot, but only
       for the latest discovered run. Reusing current logs for older staging
       runs silently reports the wrong calibration fit.

    Returns ``(df, scope)`` on success — knowing the scope lets later code
    pick the matching weights / run_config files. Returns ``None`` if
    nothing was found.
    """
    if dataset.layout == "root":
        from huggingface_hub import hf_hub_download
        from backend.services.fit_artifacts import artifacts_for_scope

        filename = artifacts_for_scope("regional").diagnostics
        path = f"calibration/logs/{filename}"
        repo_slug = dataset.repo_id.replace("/", "__")
        cache = Path(cache_root) / repo_slug
        cache.mkdir(parents=True, exist_ok=True)
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
                    "Loaded root production diagnostics from %s (%d rows)",
                    path, len(df),
                )
                return df, "regional"
        except Exception as exc:
            logger.debug("diagnostics fetch failed at %s: %s", path, exc)
        return None

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
        ]
        try:
            from backend.services import runs as runs_service
            latest = next(iter(runs_service.list_runs(dataset.id)), None)
            if latest is not None and latest.run_id == run_id:
                candidate_paths.append(f"calibration/logs/{filename}")
        except Exception as exc:
            logger.debug("Could not determine latest run for diagnostics fallback: %s", exc)
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


def _join_diagnostics(
    targets_df: pd.DataFrame,
    diag_df: pd.DataFrame,
) -> int:
    """Attach published calibration diagnostics to DB targets.

    Diagnostics keys do not carry target_id or period, and the DB can contain
    multiple active rows with the same variable/geography/constraint signature.
    Join one diagnostics row to at most one DB row, picking the closest target
    value when duplicates exist. For joined rows, the diagnostics true_value is
    the calibrated target value, so use that value for package-derived error
    calculations instead of the raw DB source value.
    """
    sig_to_indices: dict[tuple, list[int]] = {}
    for idx, row in targets_df.iterrows():
        sig_to_indices.setdefault(_row_to_diagnostics_signature(row), []).append(idx)

    matched_indices: set[int] = set()
    n_joined = 0
    has_true = "true_value" in diag_df.columns
    has_rel = "rel_error" in diag_df.columns
    has_abs = "abs_rel_error" in diag_df.columns

    for _, diag_row in diag_df.iterrows():
        sig = _parse_diagnostics_key(diag_row.get("target"))
        if sig is None:
            continue
        candidates = [
            idx for idx in sig_to_indices.get(sig, [])
            if idx not in matched_indices
        ]
        if not candidates:
            continue

        true_value = diag_row.get("true_value") if has_true else np.nan
        if pd.notna(true_value):
            def distance(idx: int) -> float:
                raw_value = targets_df.at[idx, "value"]
                try:
                    return abs(float(raw_value) - float(true_value)) / max(
                        1.0, abs(float(raw_value))
                    )
                except (TypeError, ValueError):
                    return float("inf")
            chosen = min(candidates, key=distance)
        else:
            chosen = candidates[0]

        matched_indices.add(chosen)
        if pd.notna(true_value):
            targets_df.at[chosen, "value"] = float(true_value)
        targets_df.at[chosen, "estimate"] = diag_row.get("estimate")
        if has_rel and pd.notna(diag_row.get("rel_error")):
            targets_df.at[chosen, "rel_error"] = float(diag_row["rel_error"])
        if has_abs and pd.notna(diag_row.get("abs_rel_error")):
            targets_df.at[chosen, "abs_rel_error"] = float(diag_row["abs_rel_error"])
        targets_df.at[chosen, "included"] = True
        if has_rel and pd.notna(diag_row.get("rel_error")):
            targets_df.at[chosen, "loss_contribution"] = float(diag_row["rel_error"]) ** 2
        n_joined += 1

    return n_joined


def _household_series(sim, variable: str, period: int, default=None) -> np.ndarray:
    try:
        return np.asarray(
            sim.calculate(variable, map_to="household", period=period).values
        )
    except Exception:
        if default is None:
            raise
        return np.asarray(default)


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

    repo_slug = dataset.repo_id.replace("/", "__")
    prefix = storage_prefix(dataset, run_id)
    cache = (
        Path(cache_root) / repo_slug / "root" / run_id
        if dataset.layout == "root"
        else Path(cache_root) / repo_slug / prefix
    )
    cache.mkdir(parents=True, exist_ok=True)

    logical_names = list(dataset.effective_required_files())
    actual_paths = (
        {name: name for name in logical_names}
        if dataset.layout == "root"
        else _resolve_staging_file_paths(dataset.repo_id, run_id, logical_names)
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
    # cache is good for the lifetime of the run + selected h5 (run_id is
    # immutable per publish). Skip the CSV join + entity-aware evaluator
    # entirely.
    # Pickle keeps pandas types (object cols with lists, etc.) and needs no
    # extra deps. Cache key is the immutable run_id, so no staleness risk
    # within a run; bump SCHEMA_VERSION below to invalidate on shape change.
    cache_stem = Path(dataset.primary_h5).stem.replace("/", "_")
    layout_cache_dir = "root" if dataset.layout == "root" else "staging"
    enriched_cache_path = (
        Path(cache_root) / dataset.repo_id.replace("/", "__")
        / layout_cache_dir / run_id / f"targets_enriched.{cache_stem}.pkl"
    )
    SCHEMA_VERSION = 4
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

    compute_household_fields = os.environ.get(
        "COMPUTE_HOUSEHOLD_FIELDS", "",
    ).lower() in {"1", "true", "yes"}
    if compute_household_fields:
        state_fips = _household_series(
            sim, "state_fips", time_period, default=np.zeros(n_households)
        ).astype(int)
        cd_geoid = _household_series(
            sim, "congressional_district_geoid", time_period,
            default=np.zeros(n_households),
        ).astype(int)
        hh_income = _household_series(
            sim, "spm_unit_net_income", time_period, default=np.zeros(n_households)
        )
        hh_threshold = _household_series(
            sim, "spm_unit_spm_threshold", time_period, default=np.zeros(n_households)
        )
        in_poverty = hh_income < hh_threshold
        try:
            income_decile = pd.qcut(hh_income, 10, labels=False, duplicates="drop")
            income_decile = np.asarray(income_decile).astype(np.int8)
        except Exception:
            income_decile = np.zeros(n_households, dtype=np.int8)
    else:
        logger.info(
            "Skipping household income/geography fields "
            "(set COMPUTE_HOUSEHOLD_FIELDS=true to compute them)."
        )
        state_fips = np.zeros(n_households, dtype=int)
        cd_geoid = np.zeros(n_households, dtype=int)
        hh_income = np.zeros(n_households, dtype=np.float32)
        hh_threshold = np.zeros(n_households, dtype=np.float32)
        in_poverty = np.zeros(n_households, dtype=bool)
        income_decile = np.zeros(n_households, dtype=np.int8)

    households_df = pd.DataFrame({
        "household_idx": np.arange(n_households),
        "income": hh_income.astype(np.float32),
        "spm_threshold": hh_threshold.astype(np.float32),
        "in_poverty": in_poverty,
        "initial_weight": household_weight.astype(np.float32),
        "final_weight": household_weight.astype(np.float32),
        "g_weight": np.ones(n_households, dtype=np.float32),
        "state": state_fips,
        "cd_geoid": cd_geoid,
        "income_decile": income_decile,
    })

    # Dataset mode: the canonical us-data repo publishes a per-run
    # `unified_diagnostics.csv` (under calibration/runs/<run>/diagnostics/).
    # We use it to identify targets that were actually in the calibration loss
    # and to pick the published true_value, then recompute PE aggregates from
    # the h5 with policyengine_us so the dashboard's "PE aggregate" column is
    # sourced from the same package API users would call manually.
    #
    # Targets the diagnostics file doesn't cover (typically excluded by
    # target_config.yaml during this calibration) are left unestimated unless
    # explicitly requested; evaluating all authored targets is slow and
    # misleading for "included targets" diagnostics.
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
        # A CSV match means the pipeline evaluated this target in its loss.
        # Join one-to-one: target_id is absent from diagnostics and signatures
        # can repeat across source periods in policy_data.db.
        n_from_diag = _join_diagnostics(targets_df, diag_df)
        logger.info(
            "  → %d/%d targets got estimates from diagnostics CSV (marked included=True)",
            n_from_diag, len(targets_df),
        )
    elif cached_enriched is None:
        logger.info("No unified_diagnostics.csv found; falling back to MVP evaluator only.")

    compute_pe_aggregates = os.environ.get(
        "COMPUTE_PE_AGGREGATES", "true",
    ).lower() not in {"0", "false", "no"}
    if (
        cached_enriched is None
        and diag_result is not None
        and compute_pe_aggregates
        and targets_df["included"].any()
    ):
        from backend.services.stratum_evaluator import evaluate_targets

        included_mask = targets_df["included"].astype(bool)
        logger.info(
            "Computing PE aggregates from published h5 for %d in-loss targets...",
            int(included_mask.sum()),
        )
        evaluated = evaluate_targets(
            targets_df[included_mask].copy(),
            sim,
            default_period=time_period,
        )
        idx = evaluated.index
        targets_df.loc[idx, "estimate"] = evaluated["estimate"].values
        targets_df.loc[idx, "rel_error"] = evaluated["rel_error"].values
        targets_df.loc[idx, "abs_rel_error"] = evaluated["abs_rel_error"].values
        if "eval_note" in evaluated.columns:
            targets_df.loc[idx, "eval_note"] = evaluated["eval_note"].values
        with np.errstate(invalid="ignore"):
            targets_df.loc[idx, "loss_contribution"] = (
                targets_df.loc[idx, "rel_error"].astype(float) ** 2
            )
        logger.info(
            "Computed PE aggregates for %d/%d in-loss targets.",
            int(targets_df.loc[idx, "estimate"].notna().sum()),
            int(included_mask.sum()),
        )

    # Fill remaining NaN estimates only when diagnostics were unavailable, or
    # explicitly requested. Evaluating tens of thousands of skipped/authored
    # targets through Microsimulation makes normal dashboard loads look hung.
    eval_skipped = os.environ.get("EVALUATE_SKIPPED_TARGETS", "").lower() in {
        "1", "true", "yes",
    }
    should_eval_remaining = cached_enriched is None and (
        diag_result is None or eval_skipped
    )
    if targets_df["estimate"].isna().any() and should_eval_remaining:
        from backend.services.stratum_evaluator import evaluate_targets
        unfilled = targets_df["estimate"].isna()
        logger.info(
            "Running MVP evaluator on %d remaining targets...", int(unfilled.sum()),
        )
        filled = evaluate_targets(
            targets_df[unfilled].copy(), sim, default_period=time_period,
        )
        targets_df.loc[unfilled, "estimate"] = filled["estimate"].values
    elif targets_df["estimate"].isna().any():
        logger.info(
            "Skipping MVP evaluator for %d non-diagnostics targets "
            "(set EVALUATE_SKIPPED_TARGETS=true to compute them).",
            int(targets_df["estimate"].isna().sum()),
        )
    n_evaluated = int(np.sum(~targets_df["estimate"].isna()))
    logger.info(
        "Total estimates available: %d/%d (%.1f%%)",
        n_evaluated, len(targets_df), 100 * n_evaluated / max(1, len(targets_df)),
    )

    # Compute rel_error / abs_rel_error for rows not populated by diagnostics.
    target_values = targets_df["value"].to_numpy(dtype=np.float64)
    estimates_arr = targets_df["estimate"].to_numpy(dtype=np.float64)
    with np.errstate(divide="ignore", invalid="ignore"):
        rel = np.where(
            np.abs(target_values) > 0,
            (estimates_arr - target_values) / np.abs(target_values),
            np.nan,
        )
    targets_df["rel_error"] = np.where(
        targets_df["rel_error"].notna(), targets_df["rel_error"], rel,
    )
    targets_df["abs_rel_error"] = np.where(
        targets_df["abs_rel_error"].notna(),
        targets_df["abs_rel_error"],
        np.abs(rel),
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
