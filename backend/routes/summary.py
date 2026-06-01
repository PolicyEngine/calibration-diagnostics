"""Run-level summary scorecard for the landing page."""

from typing import Annotated

import numpy as np
from fastapi import APIRouter, Depends, Query

from backend.state import AppState, get_state

router = APIRouter()


@router.get("/summary")
def get_summary(
    error_bins: Annotated[int, Query(ge=4, le=60)] = 20,
    worst_n: Annotated[int, Query(ge=1, le=50)] = 10,
    state: AppState = Depends(get_state),
):
    """Headline scorecard for a single run.

    Returns headline metrics, an abs-rel-error histogram, worst-fit categories
    (grouped by variable), worst-fit targets, and weight-health stats. Designed
    to be the only call needed to render the landing page.
    """
    df = state.targets_enriched
    if df.empty or "abs_rel_error" not in df.columns:
        return _empty_summary(state)
    if "included" in df.columns:
        included = df[df["included"].astype(bool)]
    else:
        included = df

    abs_err_all = included["abs_rel_error"].to_numpy(dtype=float)
    rel_err_all = included["rel_error"].to_numpy(dtype=float)
    finite_mask = np.isfinite(abs_err_all) & np.isfinite(rel_err_all)
    abs_err = abs_err_all[finite_mask]
    rel_err = rel_err_all[finite_mask]

    # n_targets_with_estimate is computability coverage — counted across the
    # WHOLE bundle, not just the included subset. In sandbox mode every X row
    # produces an estimate (so this equals n_targets); in dataset mode only
    # the MVP-evaluable subset does.
    full_abs = df["abs_rel_error"].to_numpy(dtype=float)
    n_with_estimate = int(np.sum(np.isfinite(full_abs)))

    headline = {
        "dataset_id": state.dataset_id,
        "run_id": state.run_id,
        "n_targets": int(len(df)),
        "n_targets_included": int(len(included)),
        "n_targets_with_estimate": n_with_estimate,
        "median_abs_rel_error": _safe_float(np.median(abs_err)) if len(abs_err) else None,
        "mean_abs_rel_error": _safe_float(np.mean(abs_err)) if len(abs_err) else None,
        "p95_abs_rel_error": _safe_float(np.percentile(abs_err, 95)) if len(abs_err) else None,
        "pct_within_5pct": _pct(abs_err, 0.05),
        "pct_within_10pct": _pct(abs_err, 0.10),
        "pct_within_25pct": _pct(abs_err, 0.25),
        "total_loss": _safe_float(np.sum(rel_err ** 2)),
        "n_households": int(state.n_households),
        "time_period": int(state.time_period),
    }

    error_distribution = _histogram(abs_err, error_bins)

    worst_by_variable = _group_summary(included, "variable", top=worst_n)
    worst_by_geo_level = _group_summary(included, "geo_level", top=worst_n)

    # Rank worst targets by loss_contribution when we have it (pkl mode);
    # otherwise fall back to abs_rel_error so we still show meaningful rows
    # in dataset mode where loss_contribution is uniformly 0.
    rank_col = "loss_contribution"
    if included[rank_col].fillna(0).max() == 0:
        rank_col = "abs_rel_error"
    worst_targets = (
        included.nlargest(worst_n, rank_col)[
            [
                "target_name", "variable", "geo_level", "value",
                "estimate", "rel_error", "abs_rel_error", "loss_contribution",
            ]
        ]
        .assign(target_idx=lambda d: d.index.astype(int))
        .to_dict(orient="records")
    )
    weight_health = _weight_health(state)

    payload = {
        "headline": headline,
        "error_distribution": error_distribution,
        "worst_by_variable": worst_by_variable,
        "worst_by_geo_level": worst_by_geo_level,
        "worst_targets": worst_targets,
        "weight_health": weight_health,
    }
    return _scrub_nans(payload)


def _scrub_nans(obj):
    """Recursively replace non-finite floats with None so JSON serialisation
    doesn't choke. Dataset mode produces NaN estimates for any target that
    needs entity-mapped constraint evaluation."""
    if isinstance(obj, dict):
        return {k: _scrub_nans(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_scrub_nans(x) for x in obj]
    if isinstance(obj, float) and not np.isfinite(obj):
        return None
    return obj


def _empty_summary(state: AppState) -> dict:
    return {
        "headline": {
            "dataset_id": state.dataset_id,
            "run_id": state.run_id,
            "n_targets": 0,
            "n_targets_included": 0,
            "median_abs_rel_error": None,
            "mean_abs_rel_error": None,
            "p95_abs_rel_error": None,
            "pct_within_5pct": None,
            "pct_within_10pct": None,
            "pct_within_25pct": None,
            "total_loss": 0.0,
            "n_households": int(state.n_households),
            "time_period": int(state.time_period),
        },
        "error_distribution": [],
        "worst_by_variable": [],
        "worst_by_geo_level": [],
        "worst_targets": [],
        "weight_health": _weight_health(state),
    }


def _safe_float(x) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(v):
        return None
    return v


def _pct(arr: np.ndarray, threshold: float) -> float | None:
    if len(arr) == 0:
        return None
    return float(np.mean(arr <= threshold))


def _histogram(arr: np.ndarray, bins: int, cap: float = 2.0) -> list[dict]:
    """Equal-width bins over [0, cap] plus a single overflow bucket.

    With default cap=2.0 and bins=20, each bucket is 10% wide; anything ≥200%
    abs_rel_error lands in the overflow bucket. This keeps the chart readable
    even when a handful of targets have pathological errors (e.g. 157,675%).
    """
    if len(arr) == 0:
        return []
    in_range = arr[arr <= cap]
    counts, edges = np.histogram(in_range, bins=bins, range=(0.0, cap))
    overflow = int(np.sum(arr > cap))
    out = [
        {"bin_min": float(edges[i]), "bin_max": float(edges[i + 1]),
         "count": int(counts[i])}
        for i in range(len(counts))
    ]
    if overflow:
        out.append({"bin_min": cap, "bin_max": float(np.max(arr)),
                    "count": overflow, "overflow": True})
    return out


def _group_summary(df, by: str, top: int) -> list[dict]:
    if by not in df.columns:
        return []
    grouped = df.groupby(by, dropna=False).agg(
        n_targets=("abs_rel_error", "size"),
        mean_abs_rel_error=("abs_rel_error", "mean"),
        median_abs_rel_error=("abs_rel_error", "median"),
        total_loss=("loss_contribution", "sum"),
    )
    sort_col = "total_loss"
    if grouped["total_loss"].fillna(0).eq(0).all():
        sort_col = "mean_abs_rel_error"
    grouped = grouped.sort_values(sort_col, ascending=False).head(top)
    out = []
    for key, row in grouped.iterrows():
        out.append({
            "group": str(key) if key is not None else "(none)",
            "n_targets": int(row["n_targets"]),
            "mean_abs_rel_error": _safe_float(row["mean_abs_rel_error"]),
            "median_abs_rel_error": _safe_float(row["median_abs_rel_error"]),
            "total_loss": _safe_float(row["total_loss"]),
        })
    return out


def _weight_health(state: AppState) -> dict:
    g = state.g_weights
    finals = state.final_weights
    return {
        "n_households": int(len(g)),
        "pct_zero_g": float(np.mean(g == 0)) if len(g) else None,
        "pct_negative_final": float(np.mean(finals < 0)) if len(finals) else None,
        "pct_extreme_g_high": float(np.mean(g > 10)) if len(g) else None,
        "pct_extreme_g_low": float(np.mean((g > 0) & (g < 0.1))) if len(g) else None,
        "g_median": _safe_float(np.median(g)) if len(g) else None,
        "g_p95": _safe_float(np.percentile(g, 95)) if len(g) else None,
        "g_p5": _safe_float(np.percentile(g, 5)) if len(g) else None,
    }
