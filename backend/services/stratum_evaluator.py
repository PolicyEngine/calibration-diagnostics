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


def _apply_op(op_str: str, arr, cval):
    """Apply a comparison operator, handling the multi-value `in` case.

    SOI-style constraints encode multi-value filters as
    ``filing_status in JOINT|SURVIVING_SPOUSE`` (pipe-delimited). Our
    standard _OPS dict only covers scalar comparisons, so handle `in`
    explicitly here.
    """
    if op_str == "in":
        choices = [c.strip() for c in str(cval).split("|") if c.strip()]
        # Try numeric coercion of choices; fall back to string compare.
        try:
            numeric = [float(c) for c in choices]
            return np.isin(arr, numeric)
        except (TypeError, ValueError):
            return np.isin(np.asarray(arr).astype(str), choices)
    op = _OPS.get(op_str)
    if op is None:
        raise ValueError(f"unknown operator {op_str!r}")
    try:
        target_val = float(cval)
    except (TypeError, ValueError):
        target_val = cval
    return op(arr, target_val)

# Constraint variables whose household-mapping makes the mask meaningless
# (person-level continuous values like age). evaluate_signature() refuses
# these only in the household-level path; the entity-aware path
# (_evaluate_at_entity) handles them correctly by working at the variable's
# native entity.
_ENTITY_ONLY_VARS = {
    "age",
    "person_id",
    "spm_unit_id",
    "tax_unit_id",
    "family_id",
}


_NON_HOUSEHOLD_ENTITIES = ("person", "tax_unit", "spm_unit", "family", "marital_unit")


def _tbs_from(sim) -> "object | None":
    """Return the TBS from either a SimService wrapper or a raw Microsim."""
    if sim is None:
        return None
    return getattr(sim, "_sim", sim).tax_benefit_system


def _variable_entity(sim, variable: str) -> str | None:
    tbs = _tbs_from(sim)
    if tbs is None:
        return None
    v = tbs.variables.get(variable)
    return v.entity.key if v is not None else None


def _calculate_at(sim, variable: str, entity: str, period: int):
    """Compute a variable mapped to a specific entity and return the
    MicroSeries (carries both ``.values`` and ``.weights`` at that entity).

    Supports both the SimService wrapper (pkl mode) and raw Microsim
    (dataset mode). Returns None on failure.
    """
    target_sim = getattr(sim, "_sim", sim)
    try:
        return target_sim.calculate(variable, map_to=entity, period=period)
    except Exception as exc:
        logger.debug("calculate(%s, map_to=%s) failed: %s", variable, entity, exc)
        return None


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


def _evaluate_at_entity(
    variable: str,
    geo_level: str | None,
    geographic_id: str | None,
    constraints,
    is_count: bool,
    sim,
    entity: str,
    period: int,
) -> tuple[float | None, str]:
    """Entity-aware evaluation: works at the target variable's native
    entity (person / tax_unit / spm_unit / family) rather than household.

    Required for targets like population counts with age-range constraints,
    or SOI tax-unit aggregates with filing_status / AGI bracket constraints
    — household-level evaluation gets these wrong because the constraint
    can't be meaningfully aggregated to household.
    """
    # Per-entity MicroSeries cache: name → MicroSeries
    series_cache: dict[str, object] = {}

    def calc(v: str):
        if v not in series_cache:
            series_cache[v] = _calculate_at(sim, v, entity, period)
        return series_cache[v]

    target_series = calc(variable)
    if target_series is None:
        return None, f"target {variable!r} not evaluable at entity={entity}"
    target_vals = np.asarray(target_series.values)
    target_weights = np.asarray(target_series.weights)
    n = len(target_vals)

    # Geo mask at this entity. PE projects state_fips / cd_geoid from
    # household down to person / tax_unit / spm_unit automatically.
    if geo_level in (None, "national"):
        mask = np.ones(n, dtype=bool)
    elif geo_level == "state":
        sf_s = calc("state_fips")
        if sf_s is None:
            return None, f"state_fips not evaluable at {entity}"
        sf = np.asarray(sf_s.values)
        try:
            mask = sf == int(geographic_id)
        except (TypeError, ValueError):
            mask = sf.astype(str) == str(geographic_id)
    elif geo_level == "district":
        cd_s = calc("congressional_district_geoid")
        if cd_s is None:
            return None, f"cd_geoid not evaluable at {entity}"
        cd = np.asarray(cd_s.values)
        try:
            mask = cd.astype(int) == int(geographic_id)
        except (TypeError, ValueError):
            mask = cd.astype(str) == str(geographic_id)
    else:
        return None, f"geo_level={geo_level!r} not supported"

    # Constraint masks at this entity
    for cvar, op_str, cval in constraints or ():
        c_s = calc(cvar)
        if c_s is None:
            return None, f"constraint {cvar!r} not evaluable at {entity}"
        arr = np.asarray(c_s.values)
        try:
            m = _apply_op(op_str, arr, cval)
        except Exception as exc:
            return None, f"could not evaluate {cvar} {op_str} {cval}: {exc}"
        mask = mask & m

    # Empty-mask: the PE dataset has zero records matching this slice
    # (common at district × multi-filter combinations). Return None instead
    # of 0 so the UI can distinguish "no data to estimate" from "PE estimate
    # is genuinely zero." A spurious 0 here looks like a -100% error vs the
    # target and pollutes the ranked views.
    if not mask.any():
        return None, f"no records match constraints at entity={entity}"

    if is_count:
        return (
            float(target_weights[mask].sum()),
            f"count at entity={entity}",
        )
    return (
        float((target_vals[mask] * target_weights[mask]).sum()),
        f"dollar at entity={entity}",
    )


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

    Routes to the entity-aware path automatically when the target
    variable's native entity is not household, or when any constraint is
    on a variable whose household-mapping would be wrong (age, etc.).
    """
    period = period or cache.period

    # Decide working entity: target variable's entity, unless a constraint
    # forces a more-granular entity. Default to household when TBS lookup
    # is unavailable so behavior matches the legacy path.
    sim = cache.state.sim_service
    target_entity = _variable_entity(sim, variable) or "household"
    forced_person = any(
        (c[0] if isinstance(c, (list, tuple)) else "") in _ENTITY_ONLY_VARS
        for c in (constraints or ())
    )
    if forced_person and target_entity == "household":
        target_entity = "person"

    if target_entity in _NON_HOUSEHOLD_ENTITIES:
        return _evaluate_at_entity(
            variable, geo_level, geographic_id, constraints,
            is_count, sim, target_entity, period,
        )

    # --- Household-level path (legacy / fast) ---
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
        arr = cache.raw(cvar, period)
        if arr is None:
            return None, f"constraint variable {cvar!r} not evaluable"
        try:
            m = _apply_op(op_str, arr, cval)
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

    # Empty-mask: see notes in _evaluate_at_entity — return None, not 0, so
    # "no records match" reads as missing rather than a real estimate.
    if combined is not None and not combined.any():
        return None, "no records match constraints at entity=household"

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


def _parse_constraint(c) -> tuple[str, str, str] | None:
    """Coerce one constraint into a (var, op, value) tuple.

    Loader rows store constraints as either pre-parsed tuples or strings of
    the form ``"var op value"`` (e.g. ``"filing_status == JOINT"``). We need
    both forms because the diagnostics-CSV join and the DB load take
    different paths into the same dataframe.
    """
    if isinstance(c, (list, tuple)) and len(c) >= 3:
        return str(c[0]), str(c[1]), str(c[2])
    s = str(c).strip()
    # Order matters: longer operators first so "==" beats "=", " in " stays
    # word-bounded so it doesn't match substrings inside a variable name.
    for op, sep in (
        ("==", "=="), ("!=", "!="), (">=", ">="), ("<=", "<="),
        (">", ">"), ("<", "<"),
        ("in", " in "),
    ):
        idx = s.find(f" {sep.strip()} ") if op != "in" else s.find(sep)
        if idx == -1 and op != "in":
            # Allow no-space form for scalar ops (e.g. "x>=5")
            idx = s.find(op)
            if idx <= 0:
                continue
        if idx == -1:
            continue
        left = s[:idx].strip()
        # For 'in', sep includes the surrounding spaces.
        skip = len(sep) if op == "in" else len(op)
        right = s[idx + skip:].strip().lstrip(" ").lstrip(op).strip()
        if left:
            return left, op, right
    return None


def _looks_like_count_target(variable: str) -> bool:
    """Detect count-style targets by naming convention.

    PE doesn't expose a "is this a population count" flag we can read off
    the variable, so we fall back to the convention that population counts
    end in ``_count`` (e.g. ``household_count``, ``tax_unit_count``). For
    these, we want a weighted sum of the boolean mask, not of the variable
    itself.
    """
    return variable.endswith("_count")


def evaluate_targets(
    targets_df: pd.DataFrame,
    sim,
    default_period: int = 2024,
) -> pd.DataFrame:
    """Fill estimate / rel_error / abs_rel_error for as many rows as we can.

    Uses ``evaluate_signature`` so constraint targets (filing_status,
    income brackets, has_children, etc.) get evaluated against the loaded
    Microsimulation, not just geographic aggregates. Anything that's still
    unevaluable (person-level continuous constraints, missing variables)
    keeps a NaN estimate and an explanatory ``eval_note``.
    """
    from types import SimpleNamespace

    out = targets_df.copy()
    out["eval_note"] = ""

    # EvalCache expects a state-like object exposing sim_service +
    # final_weights + time_period. The pkl-mode loader passes its real
    # AppState; the dataset-mode loader passes a raw Microsimulation, so we
    # synthesize a minimal one here.
    state_like = SimpleNamespace(
        sim_service=sim,
        final_weights=np.array([]),
        time_period=default_period,
    )
    cache = EvalCache(state_like)

    estimates = np.full(len(out), np.nan, dtype=np.float64)
    notes = np.array([""] * len(out), dtype=object)

    for i, (_, row) in enumerate(out.iterrows()):
        variable = row["variable"]
        # Ignore row["period"] — that's metadata about the source year of
        # target_value (e.g. SOI 2022). The PE estimate must be at the
        # dataset's period (2024 for the current h5); asking PE for any
        # other year silently returns zeros instead of erroring.
        period = default_period
        geo_level = row.get("geo_level")
        gid = row.get("geographic_id")
        raw_constraints = row.get("constraints") or []
        parsed = [_parse_constraint(c) for c in raw_constraints]
        if any(p is None for p in parsed):
            notes[i] = f"unparseable constraint in {raw_constraints!r}"
            continue
        constraints = [c for c in parsed if c is not None]
        is_count = _looks_like_count_target(variable)

        est, note = evaluate_signature(
            variable=variable,
            geo_level=geo_level,
            geographic_id=gid,
            constraints=constraints,
            is_count=is_count,
            cache=cache,
            period=period,
        )
        if est is None:
            notes[i] = note
            continue
        estimates[i] = est

    out["estimate"] = estimates
    out["eval_note"] = notes
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
