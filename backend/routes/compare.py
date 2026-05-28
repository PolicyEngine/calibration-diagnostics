"""Pairwise run comparison.

Same dataset, two runs. Joins both runs' ``targets_enriched`` on
``target_id`` and surfaces:

- Headline deltas: how much closer (or farther) each run is overall.
- Biggest movers: per-target rows where the absolute relative error
  shifted most between A and B, split into improvements and regressions.

We do NOT use the standard ``get_state`` dependency because we need two
states at once. The route resolves both runs through the registry
directly.
"""

from __future__ import annotations

from typing import Annotated

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query, Request

router = APIRouter()


_DEFAULT_MOVERS = 25


def _headline(df: pd.DataFrame) -> dict:
    """Headline error stats over the included subset of a run."""
    if df.empty or "abs_rel_error" not in df.columns:
        return _empty_headline()
    included = df[df["included"].astype(bool)] if "included" in df.columns else df
    abs_err = included["abs_rel_error"].to_numpy()
    finite = abs_err[np.isfinite(abs_err)]
    if not len(finite):
        return _empty_headline(n_total=int(len(df)), n_included=int(len(included)))
    return {
        "n_total": int(len(df)),
        "n_included": int(len(included)),
        "n_with_estimate": int(np.sum(~np.isnan(abs_err))),
        "median_abs_rel_error": float(np.median(finite)),
        "mean_abs_rel_error": float(np.mean(finite)),
        "p95_abs_rel_error": float(np.percentile(finite, 95)),
        "pct_within_5pct": float(np.mean(finite <= 0.05)),
        "pct_within_10pct": float(np.mean(finite <= 0.10)),
        "pct_within_25pct": float(np.mean(finite <= 0.25)),
    }


def _empty_headline(n_total: int = 0, n_included: int = 0) -> dict:
    return {
        "n_total": n_total,
        "n_included": n_included,
        "n_with_estimate": 0,
        "median_abs_rel_error": None,
        "mean_abs_rel_error": None,
        "p95_abs_rel_error": None,
        "pct_within_5pct": None,
        "pct_within_10pct": None,
        "pct_within_25pct": None,
    }


def _movers(merged: pd.DataFrame, top_n: int) -> dict:
    """Return ``top_n`` rows in each direction (improvements / regressions).

    Rank by signed change in absolute relative error:
        delta = abs_rel_error_b - abs_rel_error_a
    Negative ⇒ B is closer (improvement). Positive ⇒ B is farther
    (regression). Rows missing an estimate in either run are excluded.
    """
    valid = merged.dropna(subset=["abs_rel_error_a", "abs_rel_error_b"])
    if valid.empty:
        return {"improved": [], "regressed": []}
    delta = valid["abs_rel_error_b"] - valid["abs_rel_error_a"]
    ranked = valid.assign(delta=delta)

    cols = [
        "target_id", "variable", "geo_level", "geographic_id",
        "value", "estimate_a", "estimate_b",
        "rel_error_a", "rel_error_b",
        "abs_rel_error_a", "abs_rel_error_b", "delta",
    ]
    improved = ranked.nsmallest(top_n, "delta")[cols].to_dict(orient="records")
    regressed = ranked.nlargest(top_n, "delta")[cols].to_dict(orient="records")
    return {"improved": improved, "regressed": regressed}


def _by_variable(merged: pd.DataFrame, top_n: int) -> list[dict]:
    """Per-variable rollup: mean abs_rel_error for each run + counts of
    targets that improved / regressed by >1pp."""
    valid = merged.dropna(subset=["abs_rel_error_a", "abs_rel_error_b"])
    if valid.empty:
        return []
    grouped = valid.groupby("variable").agg(
        n_targets=("target_id", "size"),
        mean_a=("abs_rel_error_a", "mean"),
        mean_b=("abs_rel_error_b", "mean"),
    )
    delta = valid["abs_rel_error_b"] - valid["abs_rel_error_a"]
    improvement_counts = valid.assign(d=delta).groupby("variable")["d"].apply(
        lambda s: int((s < -0.01).sum())
    )
    regression_counts = valid.assign(d=delta).groupby("variable")["d"].apply(
        lambda s: int((s > 0.01).sum())
    )
    grouped["n_improved"] = improvement_counts
    grouped["n_regressed"] = regression_counts
    grouped["mean_delta"] = grouped["mean_b"] - grouped["mean_a"]
    grouped = grouped.sort_values("mean_delta", ascending=False)
    rows = []
    for var, r in grouped.head(top_n).iterrows():
        rows.append({
            "variable": str(var),
            "n_targets": int(r["n_targets"]),
            "mean_abs_rel_error_a": float(r["mean_a"]),
            "mean_abs_rel_error_b": float(r["mean_b"]),
            "mean_delta": float(r["mean_delta"]),
            "n_improved": int(r["n_improved"]),
            "n_regressed": int(r["n_regressed"]),
        })
    return rows


def _scrub(obj):
    """Replace non-finite floats with None for JSON serialization."""
    if isinstance(obj, dict):
        return {k: _scrub(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_scrub(x) for x in obj]
    if isinstance(obj, float) and not np.isfinite(obj):
        return None
    return obj


@router.get("/compare")
def compare(
    request: Request,
    dataset: Annotated[str, Query(description="Dataset id, e.g. us-data")],
    run_a: Annotated[str, Query(description="Baseline run id")],
    run_b: Annotated[str, Query(description="Comparison run id")],
    top_n: Annotated[int, Query(ge=5, le=200)] = _DEFAULT_MOVERS,
) -> dict:
    """Side-by-side comparison of two runs of the same dataset.

    Joins on ``target_id`` so the comparison is target-equivalent (both
    runs must come from the same dataset → same targets table). Same run
    on both sides is allowed; deltas will be all zero.
    """
    if not run_a or not run_b:
        raise HTTPException(status_code=400, detail="run_a and run_b are required")

    registry = request.app.state.registry
    try:
        state_a = registry.get(dataset, run_a)
        state_b = registry.get(dataset, run_b)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load one of the runs: {exc}",
        )

    df_a = state_a.targets_enriched
    df_b = state_b.targets_enriched
    if df_a.empty or df_b.empty:
        raise HTTPException(
            status_code=400,
            detail="One of the runs has no targets loaded.",
        )

    headline_a = _headline(df_a)
    headline_b = _headline(df_b)

    # Join on target_id. Carry along identity columns (value etc.)
    # from A; both runs should agree on these since dataset is shared.
    keep = ["target_id", "variable", "geo_level", "geographic_id", "value"]
    a = df_a[keep + ["estimate", "rel_error", "abs_rel_error"]].rename(
        columns={
            "estimate": "estimate_a",
            "rel_error": "rel_error_a",
            "abs_rel_error": "abs_rel_error_a",
        }
    )
    b = df_b[["target_id", "estimate", "rel_error", "abs_rel_error"]].rename(
        columns={
            "estimate": "estimate_b",
            "rel_error": "rel_error_b",
            "abs_rel_error": "abs_rel_error_b",
        }
    )
    merged = a.merge(b, on="target_id", how="inner")

    payload = {
        "dataset": dataset,
        "run_a": run_a,
        "run_b": run_b,
        "headline_a": headline_a,
        "headline_b": headline_b,
        "movers": _movers(merged, top_n),
        "by_variable": _by_variable(merged, top_n),
    }
    return _scrub(payload)
