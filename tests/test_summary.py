"""Tests for the /summary endpoint logic (backend/routes/summary.py)."""

import numpy as np
import pandas as pd
import pytest
import scipy.sparse as sp

from backend.routes.summary import (
    _group_summary,
    _histogram,
    _pct,
    _weight_health,
    get_summary,
)
from backend.state import AppState


def _make_state(
    rel_errors: list[float],
    variables: list[str] | None = None,
    geo_levels: list[str] | None = None,
    included: list[bool] | None = None,
    g_weights: np.ndarray | None = None,
) -> AppState:
    n = len(rel_errors)
    variables = variables or ["adjusted_gross_income"] * n
    geo_levels = geo_levels or ["national"] * n
    included = included if included is not None else [True] * n
    abs_err = np.abs(rel_errors)
    sq = np.array(rel_errors) ** 2
    total = sq.sum() or 1.0
    targets = pd.DataFrame({
        "target_name": [f"t{i}" for i in range(n)],
        "variable": variables,
        "geo_level": geo_levels,
        "value": [100.0] * n,
        "estimate": [100.0 + e * 100 for e in rel_errors],
        "rel_error": rel_errors,
        "abs_rel_error": abs_err,
        "loss_contribution": sq / total,
        "included": included,
    })
    g = g_weights if g_weights is not None else np.array([1.0, 1.0, 1.0])
    return AppState(
        X_csr=sp.csr_matrix((n, len(g))),
        X_csc=sp.csc_matrix((n, len(g))),
        targets_df=targets,
        target_names=targets["target_name"].tolist(),
        initial_weights=np.ones(len(g)),
        final_weights=np.ones(len(g)),
        cd_geoid=np.zeros(len(g), dtype=int),
        g_weights=g,
        targets_enriched=targets,
        n_targets=n,
        n_households=len(g),
        dataset_id="us-cps",
        run_id="run-x",
    )


def test_summary_headline_basic():
    state = _make_state([0.0, 0.05, 0.10, 0.30])
    out = get_summary(error_bins=10, worst_n=5, state=state)
    h = out["headline"]
    assert h["dataset_id"] == "us-cps"
    assert h["run_id"] == "run-x"
    assert h["n_targets"] == 4
    assert h["n_targets_included"] == 4
    assert h["median_abs_rel_error"] == pytest.approx(0.075)
    assert h["pct_within_5pct"] == pytest.approx(0.5)
    assert h["pct_within_10pct"] == pytest.approx(0.75)
    assert h["pct_within_25pct"] == pytest.approx(0.75)


def test_summary_respects_included_flag():
    """Excluded targets must not feed the headline metrics."""
    state = _make_state(
        rel_errors=[0.01, 99.0],     # huge outlier...
        included=[True, False],       # ...but excluded
    )
    h = get_summary(state=state)["headline"]
    assert h["n_targets"] == 2
    assert h["n_targets_included"] == 1
    assert h["median_abs_rel_error"] == pytest.approx(0.01)


def test_summary_worst_by_variable_orders_by_loss():
    """Variable with largest summed loss_contribution should rank first."""
    state = _make_state(
        rel_errors=[0.5, 0.5, 0.05],
        variables=["snap", "snap", "agi"],
    )
    out = get_summary(state=state)
    groups = out["worst_by_variable"]
    assert groups[0]["group"] == "snap"
    assert groups[0]["n_targets"] == 2


def test_summary_worst_targets_ordered_by_loss():
    state = _make_state([0.01, 0.99, 0.05])
    out = get_summary(state=state, worst_n=2)
    worst = out["worst_targets"]
    assert len(worst) == 2
    assert worst[0]["abs_rel_error"] >= worst[1]["abs_rel_error"]


def test_summary_handles_empty():
    state = _make_state([])
    out = get_summary(state=state)
    assert out["headline"]["n_targets"] == 0
    assert out["headline"]["median_abs_rel_error"] is None or np.isnan(
        out["headline"]["median_abs_rel_error"] or np.nan
    )
    assert out["error_distribution"] == []


def test_histogram_overflow_bin():
    """Values beyond the 99th-pct cap should be counted in an overflow bin."""
    arr = np.concatenate([np.linspace(0, 0.1, 99), np.array([5.0])])
    hist = _histogram(arr, bins=10)
    assert any(b.get("overflow") for b in hist)


def test_histogram_empty_returns_empty():
    assert _histogram(np.array([]), bins=10) == []


def test_pct_thresholds():
    arr = np.array([0.01, 0.05, 0.20, 0.50])
    assert _pct(arr, 0.05) == pytest.approx(0.5)
    assert _pct(arr, 0.25) == pytest.approx(0.75)
    assert _pct(np.array([]), 0.05) is None


def test_group_summary_missing_column():
    df = pd.DataFrame({"abs_rel_error": [0.1], "loss_contribution": [1.0]})
    assert _group_summary(df, "missing_col", top=5) == []


def test_weight_health_flags():
    g = np.array([0.0, 0.05, 1.0, 1.0, 50.0])
    state = AppState(
        X_csr=sp.csr_matrix((1, len(g))),
        X_csc=sp.csc_matrix((1, len(g))),
        targets_df=pd.DataFrame(),
        target_names=[],
        initial_weights=np.ones(len(g)),
        final_weights=np.array([0.0, 0.05, 1.0, -1.0, 50.0]),
        cd_geoid=np.zeros(len(g), dtype=int),
        g_weights=g,
    )
    h = _weight_health(state)
    assert h["pct_zero_g"] == pytest.approx(0.2)
    assert h["pct_extreme_g_high"] == pytest.approx(0.2)
    assert h["pct_extreme_g_low"] == pytest.approx(0.2)
    assert h["pct_negative_final"] == pytest.approx(0.2)
