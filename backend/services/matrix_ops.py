"""Sparse matrix operations for calibration diagnostics."""

import numpy as np
import pandas as pd
import scipy.sparse as sp


def get_target_contributors(
    X_csr: sp.csr_matrix,
    target_idx: int,
) -> np.ndarray:
    """Return household indices that contribute to a target (CSR row slice)."""
    return X_csr[target_idx, :].nonzero()[1]


def get_target_contributions(
    X_csr: sp.csr_matrix,
    target_idx: int,
    final_weights: np.ndarray,
) -> pd.DataFrame:
    """Return contributing households with raw and weighted values."""
    row = X_csr[target_idx, :]
    cols = row.nonzero()[1]
    raw_values = np.array(row[:, cols].todense()).flatten()
    weighted_values = raw_values * final_weights[cols]
    return pd.DataFrame({
        "household_idx": cols,
        "raw_value": raw_values,
        "weighted_value": weighted_values,
    })


def get_household_targets(
    X_csc: sp.csc_matrix,
    household_idx: int,
) -> np.ndarray:
    """Return target indices this household contributes to (CSC column slice)."""
    return X_csc[:, household_idx].nonzero()[0]


def get_household_attributions(
    X_csc: sp.csc_matrix,
    household_idx: int,
    final_weights: np.ndarray,
) -> pd.DataFrame:
    """Return targets this household contributes to, with contribution values."""
    col = X_csc[:, household_idx]
    rows = col.nonzero()[0]
    raw_values = np.array(col[rows, :].todense()).flatten()
    weighted_values = raw_values * final_weights[household_idx]
    return pd.DataFrame({
        "target_idx": rows,
        "raw_value": raw_values,
        "weighted_value": weighted_values,
    })


def compute_error_decomposition(
    X_csr: sp.csr_matrix,
    target_idx: int,
    target_value: float,
    initial_weights: np.ndarray,
    final_weights: np.ndarray,
) -> dict:
    """Three-number decomposition: raw_sum, initial_est, final_est vs target."""
    row = X_csr[target_idx, :]
    raw_sum = float(row.sum())
    initial_est = float(row.dot(initial_weights))
    final_est = float(row.dot(final_weights))

    if target_value != 0:
        raw_ratio = raw_sum / target_value
        if abs(raw_ratio - 1) > 0.5:
            diagnosis = (
                f"raw_sum is {(raw_ratio - 1):+.0%} off target — "
                "variable values or coverage wrong in source data"
            )
        elif abs(initial_est / target_value - 1) < 0.15 and abs(
            final_est / target_value - 1
        ) > 0.15:
            diagnosis = (
                "Initial weights close to target but final drifted — "
                "other constraints pulled weights away"
            )
        else:
            diagnosis = "See raw_sum, initial_estimate, final_estimate for details"
    else:
        diagnosis = "Target value is zero"

    return {
        "target_value": target_value,
        "raw_sum": raw_sum,
        "initial_estimate": initial_est,
        "final_estimate": final_est,
        "diagnosis": diagnosis,
    }


def compute_concentration(
    X_csr: sp.csr_matrix,
    target_idx: int,
    final_weights: np.ndarray,
) -> dict:
    """Top 1% and 5% weighted contribution share for a target."""
    row = X_csr[target_idx, :]
    cols = row.nonzero()[1]
    if len(cols) == 0:
        return {"top_1pct_share": 0.0, "top_5pct_share": 0.0}

    raw_values = np.array(row[:, cols].todense()).flatten()
    contributions = raw_values * final_weights[cols]
    total = contributions.sum()
    if total == 0:
        return {"top_1pct_share": 0.0, "top_5pct_share": 0.0}

    sorted_contrib = np.sort(contributions)[::-1]
    n = len(sorted_contrib)
    top_1 = sorted_contrib[: max(1, n // 100)].sum() / total
    top_5 = sorted_contrib[: max(1, n // 20)].sum() / total
    return {"top_1pct_share": float(top_1), "top_5pct_share": float(top_5)}
