"""Derived statistics endpoints."""

import numpy as np
from fastapi import APIRouter, Depends, Query

from backend.state import get_state
from backend.models import (
    IncomeDistributionResponse,
    IncomeQuantiles,
    PovertyRateResponse,
)
from backend.state import AppState

router = APIRouter()

CENSUS_SPM_BENCHMARK = 0.127


def _geo_mask(state: AppState, state_fips: int | None, cd_geoid: int | None) -> np.ndarray:
    """Build a boolean mask for geographic filtering."""
    mask = np.ones(state.n_households, dtype=bool)
    if cd_geoid is not None:
        mask = state.households_df["cd_geoid"].values == cd_geoid
    elif state_fips is not None:
        mask = state.households_df["state"].values == state_fips
    return mask


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
    state_fips: int | None = Query(None, alias="state_fips"),
    cd_geoid: int | None = Query(None, alias="cd_geoid"),
    state: AppState = Depends(get_state),
) -> PovertyRateResponse:
    mask = _geo_mask(state, state_fips, cd_geoid)
    in_poverty = state.households_df["in_poverty"].values[mask]
    fw = state.final_weights[mask]
    iw = state.initial_weights[mask]

    n_poor_final = float((in_poverty * fw).sum())
    n_total_final = float(fw.sum())
    rate_final = n_poor_final / n_total_final if n_total_final > 0 else 0

    n_poor_initial = float((in_poverty * iw).sum())
    n_total_initial = float(iw.sum())
    rate_initial = n_poor_initial / n_total_initial if n_total_initial > 0 else 0

    # Weighted individual count
    hh_size = state.sim_service.calculate("household_size", map_to="household")
    n_individuals_weighted = float((hh_size[mask] * fw).sum())

    return PovertyRateResponse(
        spm_poverty_rate=rate_final,
        spm_poverty_rate_initial_weights=rate_initial,
        n_poor_weighted=n_poor_final,
        n_total_weighted_households=n_total_final,
        n_total_weighted_individuals=n_individuals_weighted,
        benchmark_census=CENSUS_SPM_BENCHMARK,
    )


@router.get("/median-agi")
def median_agi(
    state_fips: int | None = Query(None, alias="state_fips"),
    cd_geoid: int | None = Query(None, alias="cd_geoid"),
    state: AppState = Depends(get_state),
) -> dict:
    mask = _geo_mask(state, state_fips, cd_geoid)
    agi = state.sim_service.calculate("adjusted_gross_income", map_to="household")
    fw = state.final_weights[mask]
    agi_masked = agi[mask]
    median = _weighted_quantiles(agi_masked, fw, [0.5])[0]
    return {"median_agi": median}


@router.get("/calibration-fit")
def calibration_fit(
    geo_level: str | None = None,
    state_fips: int | None = Query(None, alias="state_fips"),
    included_only: bool = True,
    state: AppState = Depends(get_state),
) -> dict:
    """Summary of calibration fit quality across targets."""
    df = state.targets_enriched

    if included_only:
        df = df[df["included"]]

    # Filter to geographic level
    if geo_level:
        df = df[df["geo_level"] == geo_level]
    if state_fips is not None:
        df = df[df["geographic_id"].apply(
            lambda gid: str(gid).isdigit() and int(gid) // 100 == state_fips
            or str(gid) == str(state_fips)
        )]

    total = len(df)
    if total == 0:
        return {
            "total_targets": 0,
            "excellent": 0,
            "good": 0,
            "needs_work": 0,
            "avg_rel_error": 0.0,
            "weighted_score": 0.0,
        }

    abs_errors = df["abs_rel_error"].values

    excellent = int((abs_errors < 0.05).sum())
    good = int(((abs_errors >= 0.05) & (abs_errors < 0.20)).sum())
    needs_work = int((abs_errors >= 0.20).sum())

    avg_rel_error = float(abs_errors.mean())

    # Weighted score: excellent=1.0, good=0.5, needs_work=0.0
    weighted_score = (excellent * 1.0 + good * 0.5) / total if total > 0 else 0.0

    return {
        "total_targets": total,
        "excellent": excellent,
        "good": good,
        "needs_work": needs_work,
        "excellent_pct": excellent / total * 100 if total > 0 else 0,
        "good_pct": good / total * 100 if total > 0 else 0,
        "needs_work_pct": needs_work / total * 100 if total > 0 else 0,
        "avg_rel_error": avg_rel_error,
        "weighted_score": weighted_score,
    }


@router.get("/income-distribution")
def income_distribution(
    state_fips: int | None = Query(None, alias="state_fips"),
    cd_geoid: int | None = Query(None, alias="cd_geoid"),
    state: AppState = Depends(get_state),
) -> IncomeDistributionResponse:
    mask = _geo_mask(state, state_fips, cd_geoid)
    income = state.households_df["income"].values[mask].astype(np.float64)
    fw = state.final_weights[mask]
    iw = state.initial_weights[mask]
    qs = [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95]

    initial_q = _weighted_quantiles(income, iw, qs)
    final_q = _weighted_quantiles(income, fw, qs)

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
