"""Weight distribution endpoints."""

import operator as op_module

import numpy as np
from fastapi import APIRouter, Depends, HTTPException

from backend.app import get_state
from backend.models import (
    HistogramBin,
    WeightDistribution,
    WeightSlice,
)
from backend.state import AppState

router = APIRouter()

_OPS = {
    "gt": op_module.gt,
    "gte": op_module.ge,
    "lt": op_module.lt,
    "lte": op_module.le,
    "eq": op_module.eq,
    "ne": op_module.ne,
}


def _weight_stats(w: np.ndarray) -> dict:
    """Compute standard weight distribution statistics."""
    if len(w) == 0:
        return {"kish_effective_n": 0, "cv": 0, "design_effect": 1, "mean": 0,
                "median": 0, "p5": 0, "p25": 0, "p75": 0, "p95": 0, "max": 0,
                "top_1pct_weight_share": 0, "top_5pct_weight_share": 0}

    total = w.sum()
    kish = float(total ** 2 / (w ** 2).sum()) if (w ** 2).sum() > 0 else 0
    mean = float(w.mean())
    std = float(w.std())
    cv = std / mean if mean > 0 else 0

    sorted_w = np.sort(w)[::-1]
    n = len(sorted_w)
    top_1 = float(sorted_w[: max(1, n // 100)].sum() / total) if total > 0 else 0
    top_5 = float(sorted_w[: max(1, n // 20)].sum() / total) if total > 0 else 0

    return {
        "kish_effective_n": kish,
        "cv": cv,
        "design_effect": 1 + cv ** 2,
        "mean": mean,
        "median": float(np.median(w)),
        "p5": float(np.percentile(w, 5)),
        "p25": float(np.percentile(w, 25)),
        "p75": float(np.percentile(w, 75)),
        "p95": float(np.percentile(w, 95)),
        "max": float(w.max()),
        "top_1pct_weight_share": top_1 * 100,
        "top_5pct_weight_share": top_5 * 100,
    }


@router.get("/distribution")
def weight_distribution(
    slice_by: str = "none",
    metric: str = "g_weight",
    state: AppState = Depends(get_state),
) -> WeightDistribution:
    metric_map = {
        "g_weight": state.g_weights,
        "final_weight": state.final_weights,
        "initial_weight": state.initial_weights,
    }
    if metric not in metric_map:
        raise HTTPException(status_code=400, detail=f"Unknown metric: {metric}")

    w = metric_map[metric]
    overall = _weight_stats(w)

    slices = []
    if slice_by == "income_decile":
        deciles = state.households_df["income_decile"].values
        for d in range(10):
            mask = deciles == d
            s = _weight_stats(w[mask])
            slices.append(WeightSlice(
                label=f"Decile {d + 1}",
                n=int(mask.sum()),
                kish_effective_n=s["kish_effective_n"],
                mean=s["mean"],
                median=s["median"],
            ))
    elif slice_by == "poverty_status":
        for label, mask in [
            ("Poor", state.households_df["in_poverty"].values),
            ("Non-poor", ~state.households_df["in_poverty"].values),
        ]:
            s = _weight_stats(w[mask])
            slices.append(WeightSlice(
                label=label,
                n=int(mask.sum()),
                kish_effective_n=s["kish_effective_n"],
                mean=s["mean"],
                median=s["median"],
            ))
    elif slice_by == "state":
        states = state.households_df["state"].values
        for st in np.unique(states):
            mask = states == st
            s = _weight_stats(w[mask])
            slices.append(WeightSlice(
                label=f"State {int(st):02d}",
                n=int(mask.sum()),
                kish_effective_n=s["kish_effective_n"],
                mean=s["mean"],
                median=s["median"],
            ))

    return WeightDistribution(**overall, slices=slices)


@router.get("/histogram")
def weight_histogram(
    metric: str = "g_weight",
    bins: int = 50,
    log_scale: bool = True,
    filter_variable: str | None = None,
    filter_operator: str = "gt",
    filter_value: float = 0,
    state: AppState = Depends(get_state),
) -> list[HistogramBin]:
    metric_map = {
        "g_weight": state.g_weights,
        "final_weight": state.final_weights,
        "initial_weight": state.initial_weights,
    }
    if metric not in metric_map:
        raise HTTPException(status_code=400, detail=f"Unknown metric: {metric}")

    w = metric_map[metric].copy()

    if filter_variable:
        if filter_operator not in _OPS:
            raise HTTPException(status_code=400, detail=f"Invalid operator: {filter_operator}")
        if not state.sim_service.variable_exists(filter_variable):
            raise HTTPException(status_code=400, detail=f"Unknown variable: {filter_variable}")
        vals = state.sim_service.calculate(filter_variable, map_to="household")
        mask = _OPS[filter_operator](vals, filter_value)
        w = w[mask]

    positive = w[w > 0]
    if len(positive) == 0:
        return []

    if log_scale:
        log_vals = np.log10(positive)
        bin_edges = np.logspace(log_vals.min(), log_vals.max(), bins + 1)
    else:
        bin_edges = np.linspace(positive.min(), positive.max(), bins + 1)

    counts, edges = np.histogram(positive, bins=bin_edges)
    return [
        HistogramBin(
            bin_min=float(edges[i]),
            bin_max=float(edges[i + 1]),
            count=int(counts[i]),
        )
        for i in range(len(counts))
    ]
