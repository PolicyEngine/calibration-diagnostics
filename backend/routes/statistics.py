"""Derived statistics endpoints."""

import numpy as np
from fastapi import APIRouter, Depends

from backend.app import get_state
from backend.models import (
    IncomeDistributionResponse,
    IncomeQuantiles,
    PovertyRateResponse,
)
from backend.state import AppState

router = APIRouter()

CENSUS_SPM_BENCHMARK = 0.127


def _weighted_quantiles(
    values: np.ndarray,
    weights: np.ndarray,
    quantiles: list[float],
) -> list[float]:
    """Compute weighted quantiles via CDF interpolation."""
    sorted_idx = np.argsort(values)
    sorted_vals = values[sorted_idx]
    sorted_weights = weights[sorted_idx]
    cum_weights = np.cumsum(sorted_weights)
    total = cum_weights[-1]
    if total == 0:
        return [0.0] * len(quantiles)
    cum_pct = cum_weights / total
    return [float(np.interp(q, cum_pct, sorted_vals)) for q in quantiles]


@router.get("/poverty-rate")
def poverty_rate(
    state: AppState = Depends(get_state),
) -> PovertyRateResponse:
    in_poverty = state.households_df["in_poverty"].values

    n_poor_final = float((in_poverty * state.final_weights).sum())
    n_total_final = float(state.final_weights.sum())
    rate_final = n_poor_final / n_total_final if n_total_final > 0 else 0

    n_poor_initial = float((in_poverty * state.initial_weights).sum())
    n_total_initial = float(state.initial_weights.sum())
    rate_initial = n_poor_initial / n_total_initial if n_total_initial > 0 else 0

    return PovertyRateResponse(
        spm_poverty_rate=rate_final,
        spm_poverty_rate_initial_weights=rate_initial,
        n_poor_weighted=n_poor_final,
        n_total_weighted=n_total_final,
        benchmark_census=CENSUS_SPM_BENCHMARK,
    )


@router.get("/income-distribution")
def income_distribution(
    state: AppState = Depends(get_state),
) -> IncomeDistributionResponse:
    income = state.households_df["income"].values.astype(np.float64)
    qs = [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95]

    initial_q = _weighted_quantiles(income, state.initial_weights, qs)
    final_q = _weighted_quantiles(income, state.final_weights, qs)

    return IncomeDistributionResponse(
        initial_weights=IncomeQuantiles(
            p5=initial_q[0], p10=initial_q[1], p25=initial_q[2],
            p50=initial_q[3], p75=initial_q[4], p90=initial_q[5],
            p95=initial_q[6],
        ),
        final_weights=IncomeQuantiles(
            p5=final_q[0], p10=final_q[1], p25=final_q[2],
            p50=final_q[3], p75=final_q[4], p90=final_q[5],
            p95=final_q[6],
        ),
    )
