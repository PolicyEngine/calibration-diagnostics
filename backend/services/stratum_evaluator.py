"""Compute target estimates from a calibrated dataset (no X matrix).

Two scopes:

1. `evaluate_targets()` — historical entry point used by the dataset-mode
   loader. Handles geographic-only constraints across a pandas DataFrame.

2. `evaluate_signature()` — single-target evaluator used by the inventory
   endpoint to fill PE aggregates for authored-only rows. Adds support for
   any constraint variable that PolicyEngine can map to the household
   entity (e.g. `snap > 0`, `medicaid_enrolled == 1`,
   `tax_unit_is_filer == 1`), and treats `is_count` targets as weighted
   counts of matching households rather than weighted variable sums.

Out of scope (both functions): person-level constraints whose meaning
breaks under household aggregation (e.g. `age < 5` to count under-5
individuals — household-mapping sums ages, not bodies). The pipeline's
`UnifiedMatrixBuilder` handles those correctly via entity mapping.
"""

from __future__ import annotations

import logging
import operator as op_module
from typing import Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


_OPS = {
    "==": op_module.eq, "!=": op_module.ne,
    ">": op_module.gt, ">=": op_module.ge,
    "<": op_module.lt, "<=": op_module.le,
}

# Constraint variables whose household-mapping makes the mask meaningless
# (person-level continuous values like age). The evaluator refuses to handle
# constraints on these so we don't quietly produce wrong numbers.
_ENTITY_ONLY_VARS = {
    "age",
    "person_id",
    "spm_unit_id",
    "tax_unit_id",
    "family_id",
}


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


class EvalCache:
    """Holds per-state-of-the-world caches across many evaluate_signature
    calls. Built from the loaded AppState so it transparently supports both
    the sandbox path (SimService — tiled to clone-level) and the dataset
    path (raw Microsimulation — MicroSeries with weights).
    """

    def __init__(self, state):
        self.state = state
        self.period = int(state.time_period)
        self._raw: dict[tuple[str, int], np.ndarray | None] = {}

    # --- Internal: source of truth for one variable, evaluated to a 1-D
    # per-household array aligned with `weights()` below.
    def _calculate(self, variable: str) -> np.ndarray | None:
        svc = self.state.sim_service
        if svc is None:
            return None
        try:
            if hasattr(svc, "_sim"):  # SimService wrapper (sandbox path)
                return np.asarray(svc.calculate(variable, map_to="household"))
            # Otherwise treat as raw Microsimulation
            series = svc.calculate(variable, map_to="household", period=self.period)
            return np.asarray(series.values)
        except Exception as exc:
            logger.debug("calculate(%s) failed: %s", variable, exc)
            return None

    def raw(self, variable: str, period: int | None = None) -> np.ndarray | None:
        """Per-household raw values for `variable`. period is informational
        only — the underlying sim is fixed to one time period for now."""
        key = (variable, period or self.period)
        if key not in self._raw:
            self._raw[key] = self._calculate(variable)
        return self._raw[key]

    def weighted(self, variable: str, period: int | None = None) -> np.ndarray | None:
        """Per-household weighted values: raw * household_weight."""
        arr = self.raw(variable, period)
        w = self.weights()
        if arr is None or w is None or len(arr) != len(w):
            return None
        return arr * w

    def weights(self) -> np.ndarray | None:
        # The loaded AppState already has the calibrated final_weights tiled.
        w = getattr(self.state, "final_weights", None)
        if w is not None and len(w) > 0:
            return np.asarray(w)
        return self.raw("household_weight")

    def state_fips(self) -> np.ndarray | None:
        return self.raw("state_fips")

    def cd_geoid(self) -> np.ndarray | None:
        return self.raw("congressional_district_geoid")


def evaluate_signature(
    variable: str,
    geo_level: str | None,
    geographic_id: str | None,
    constraints: list[tuple[str, str, str]] | tuple,
    is_count: bool,
    cache: EvalCache,
    period: int | None = None,
) -> tuple[float | None, str]:
    """Single-target evaluator. Returns (estimate, eval_note).

    `cache` carries the sim + per-variable caches across many invocations.
    Constraint variables whose meaning breaks under household aggregation
    (see _ENTITY_ONLY_VARS) cause the function to return None with an
    explanatory note.
    """
    period = period or cache.period

    # --- Geographic mask ---
    if geo_level == "national" or geo_level is None:
        geo_mask = None  # full set
    elif geo_level == "state":
        sf = cache.state_fips()
        if sf is None:
            return None, "state_fips not evaluable on dataset"
        try:
            geo_mask = sf == int(geographic_id)
        except (TypeError, ValueError):
            geo_mask = sf.astype(str) == str(geographic_id)
    elif geo_level == "district":
        cd = cache.cd_geoid()
        if cd is None:
            return None, "congressional_district_geoid not evaluable on dataset"
        try:
            geo_mask = cd.astype(int) == int(geographic_id)
        except (TypeError, ValueError):
            geo_mask = cd.astype(str) == str(geographic_id)
    else:
        return None, f"geo_level={geo_level!r} not supported"

    # --- Non-geographic constraint masks ---
    constraint_mask = None
    for cvar, op_str, cval in constraints or ():
        if cvar in _ENTITY_ONLY_VARS:
            return None, f"constraint on {cvar} requires entity-level evaluation"
        op = _OPS.get(op_str)
        if op is None:
            return None, f"unknown operator {op_str!r}"
        arr = cache.raw(cvar, period)
        if arr is None:
            return None, f"constraint variable {cvar!r} not evaluable"
        # Cast cval to numeric where possible; fall back to string compare
        try:
            target_val: Any = float(cval)
        except (TypeError, ValueError):
            target_val = cval
        try:
            m = op(arr, target_val)
        except Exception as exc:
            return None, f"could not evaluate {cvar} {op_str} {cval}: {exc}"
        constraint_mask = m if constraint_mask is None else (constraint_mask & m)

    # Combine masks
    if geo_mask is None and constraint_mask is None:
        combined = None  # full set
    elif geo_mask is None:
        combined = constraint_mask
    elif constraint_mask is None:
        combined = geo_mask
    else:
        combined = geo_mask & constraint_mask

    # --- Aggregate ---
    if is_count:
        weights = cache.weights()
        if weights is None:
            return None, "household_weight not evaluable"
        if combined is None:
            return float(weights.sum()), "count: full population"
        return float(weights[combined].sum()), "count: weighted household sum where mask"
    else:
        weighted = cache.weighted(variable, period)
        if weighted is None:
            return None, f"target variable {variable!r} not evaluable"
        if combined is None:
            return float(weighted.sum()), "dollar: full population"
        return float(weighted[combined].sum()), "dollar: weighted sum where mask"


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
