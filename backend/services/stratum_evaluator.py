"""Compute target estimates from a calibrated dataset (no X matrix).

MVP scope:
- **national targets** with no constraints → straight aggregate of the
  variable across all households for the target period.
- **state-level targets** (geographic constraint only) → filter households
  to the state, then aggregate.
- **district-level targets** (geographic constraint only) → filter to the
  congressional district, then aggregate.
- **constrained targets** (person-level, tax-unit-level, domain conditions
  like `child_age < 6`, `tax_unit_is_filer == 1`) → out of scope for the MVP.
  Estimate stays NaN; caller marks the row so the UI shows "—".

The pipeline's own `UnifiedMatrixBuilder.build_matrix()` is the right tool
for the full job — entity mapping, clone iteration, takeup re-randomization
— but it needs a GeographyAssignment we don't yet construct from a published
staging run. This evaluator gives us *some* real numbers today; the full
build-matrix path is a follow-up.
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


def _is_geographic_only(constraints: list[str]) -> bool:
    """A row is 'geographic-only' if all constraints are state/district."""
    if not constraints:
        return True
    geo_prefixes = (
        "state_fips ", "congressional_district_geoid ", "ucgid_str ",
    )
    return all(c.startswith(geo_prefixes) for c in constraints)


def _evaluate_variable(sim, variable: str, period: int) -> np.ndarray | None:
    """Calculate a variable at household level, weighted. Returns the weighted
    values per household, or None if the variable can't be evaluated."""
    try:
        series = sim.calculate(variable, map_to="household", period=period)
    except Exception as exc:
        logger.debug("Could not calculate %s for %s: %s", variable, period, exc)
        return None
    # MicroSeries × weights = weighted values per household
    return series.values * series.weights


def evaluate_targets(
    targets_df: pd.DataFrame,
    sim,
    default_period: int = 2024,
) -> pd.DataFrame:
    """Fill estimate / rel_error / abs_rel_error for targets we can compute.

    Mutates a copy and returns it. Targets we don't know how to handle keep
    NaN estimates and gain an `eval_note` column explaining why.
    """
    out = targets_df.copy()
    out["eval_note"] = ""

    # Pre-calculate per-household geography once.
    try:
        state_fips_hh = sim.calculate(
            "state_fips", map_to="household", period=default_period,
        ).values
    except Exception:
        state_fips_hh = None
    try:
        cd_geoid_hh = sim.calculate(
            "congressional_district_geoid",
            map_to="household", period=default_period,
        ).values
    except Exception:
        cd_geoid_hh = None

    # Cache evaluated variables across rows (same var → only call sim once)
    var_cache: dict[tuple[str, int], np.ndarray | None] = {}

    estimates = np.full(len(out), np.nan, dtype=np.float64)

    for i, (_, row) in enumerate(out.iterrows()):
        constraints = row.get("constraints") or []
        if not _is_geographic_only(constraints):
            out.iloc[i, out.columns.get_loc("eval_note")] = (
                "requires entity-mapped constraint evaluation (not in MVP)"
            )
            continue

        variable = row["variable"]
        period = int(row.get("period") or default_period)
        cache_key = (variable, period)
        if cache_key not in var_cache:
            var_cache[cache_key] = _evaluate_variable(sim, variable, period)
        weighted = var_cache[cache_key]
        if weighted is None:
            out.iloc[i, out.columns.get_loc("eval_note")] = (
                f"variable '{variable}' not available in dataset"
            )
            continue

        geo_level = row.get("geo_level")
        gid = row.get("geographic_id")
        if geo_level == "national":
            mask = np.ones_like(weighted, dtype=bool)
        elif geo_level == "state" and gid and state_fips_hh is not None:
            try:
                mask = state_fips_hh == int(gid)
            except (TypeError, ValueError):
                mask = state_fips_hh.astype(str) == str(gid)
        elif geo_level == "district" and gid and cd_geoid_hh is not None:
            try:
                mask = cd_geoid_hh.astype(int) == int(gid)
            except (TypeError, ValueError):
                mask = cd_geoid_hh.astype(str) == str(gid)
        else:
            out.iloc[i, out.columns.get_loc("eval_note")] = (
                f"geo_level={geo_level!r} not supported in MVP"
            )
            continue

        estimates[i] = float(weighted[mask].sum())

    out["estimate"] = estimates
    target_values = out["value"].to_numpy(dtype=np.float64)
    with np.errstate(divide="ignore", invalid="ignore"):
        rel = np.where(
            np.abs(target_values) > 0,
            (estimates - target_values) / np.abs(target_values),
            np.nan,
        )
    out["rel_error"] = rel
    out["abs_rel_error"] = np.abs(rel)
    return out
