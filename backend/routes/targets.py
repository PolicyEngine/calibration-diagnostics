"""Target analysis endpoints."""

import operator as op_module

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session

from backend.app import get_state
from backend.models import (
    ConstraintCheck,
    ConstraintDiffResponse,
    ContributorRow,
    ConvergencePoint,
    EligibilityAuditResponse,
    ErrorDecomposition,
    ProvenanceResponse,
    TargetListResponse,
    TargetRow,
)
from backend.services import db_service, matrix_ops
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


def _validate_target_idx(state: AppState, target_idx: int) -> None:
    if target_idx < 0 or target_idx >= state.n_targets:
        raise HTTPException(
            status_code=404,
            detail=f"target_idx {target_idx} out of range [0, {state.n_targets})",
        )


# --- Literal-segment routes BEFORE parametric routes ---


@router.get("/search")
def search_targets(
    variable: str,
    sort_by: str = "abs_rel_error",
    state: AppState = Depends(get_state),
) -> list[dict]:
    if state.db_engine is None:
        raise HTTPException(status_code=503, detail="No database connected")

    with Session(state.db_engine) as session:
        db_results = db_service.search_targets(session, variable)

    enriched = state.targets_enriched
    out = []
    for r in db_results:
        match = enriched[enriched.get("target_id") == r["target_id"]]
        error_info = {}
        if len(match) > 0:
            row = match.iloc[0]
            error_info = {
                "target_idx": int(match.index[0]),
                "estimate": float(row.get("estimate", 0)),
                "rel_error": float(row.get("rel_error", 0)),
                "abs_rel_error": float(row.get("abs_rel_error", 0)),
                "pull_score": float(row.get("pull_score", 0)),
                "n_contributors": int(row.get("n_contributors", 0)),
            }
        out.append({**r, **error_info})

    if sort_by in ("abs_rel_error", "pull_score", "rel_error"):
        out.sort(key=lambda x: abs(x.get(sort_by, 0)), reverse=True)
    return out


@router.get("/poverty-impact")
def poverty_impact(
    limit: int = 20,
    state: AppState = Depends(get_state),
) -> list[TargetRow]:
    enriched = state.targets_enriched.sort_values(
        "pull_score", ascending=False
    ).head(limit)
    return [_target_row(enriched, idx) for idx in enriched.index]


@router.get("")
def list_targets(
    sort_by: str = "pull_score",
    sort_order: str = "desc",
    variable: str | None = None,
    geo_level: str | None = None,
    domain_variable: str | None = None,
    min_abs_rel_error: float | None = None,
    limit: int = 50,
    offset: int = 0,
    state: AppState = Depends(get_state),
) -> TargetListResponse:
    df = state.targets_enriched

    if variable:
        df = df[df["variable"].str.contains(variable, case=False, na=False)]
    if geo_level:
        df = df[df["geo_level"] == geo_level]
    if domain_variable:
        df = df[
            df["domain_variable"].str.contains(
                domain_variable, case=False, na=False
            )
        ]
    if min_abs_rel_error is not None:
        df = df[df["abs_rel_error"] >= min_abs_rel_error]

    total = len(df)
    ascending = sort_order == "asc"
    if sort_by in df.columns:
        df = df.sort_values(sort_by, ascending=ascending)
    df = df.iloc[offset : offset + limit]

    return TargetListResponse(
        items=[_target_row(df, idx) for idx in df.index],
        total=total,
        offset=offset,
        limit=limit,
    )


# --- Parametric routes ---


@router.get("/{target_idx}/error-decomposition")
def error_decomposition(
    target_idx: int,
    state: AppState = Depends(get_state),
) -> ErrorDecomposition:
    _validate_target_idx(state, target_idx)
    target_value = float(state.targets_enriched.iloc[target_idx]["value"])
    decomp = matrix_ops.compute_error_decomposition(
        state.X_csr, target_idx, target_value,
        state.initial_weights, state.final_weights,
    )
    concentration = matrix_ops.compute_concentration(
        state.X_csr, target_idx, state.final_weights,
    )
    return ErrorDecomposition(
        target_name=state.target_names[target_idx],
        concentration=concentration,
        **decomp,
    )


@router.get("/{target_idx}/provenance")
def provenance(
    target_idx: int,
    state: AppState = Depends(get_state),
) -> ProvenanceResponse:
    _validate_target_idx(state, target_idx)
    if state.db_engine is None:
        raise HTTPException(status_code=503, detail="No database connected")

    row = state.targets_enriched.iloc[target_idx]
    target_id = row.get("target_id")
    if target_id is None:
        raise HTTPException(status_code=404, detail="No target_id mapping")

    with Session(state.db_engine) as session:
        prov = db_service.get_target_provenance(session, int(target_id))

    if prov is None:
        raise HTTPException(status_code=404, detail="Target not found in database")

    prov["geo_level"] = row.get("geo_level")
    prov["geographic_id"] = str(row.get("geographic_id", ""))
    prov["uprating_factor"] = row.get("uprating_factor")
    if prov["uprating_factor"] and prov["value"]:
        prov["uprated_value"] = prov["value"] * prov["uprating_factor"]
    else:
        prov["uprated_value"] = prov["value"]

    return ProvenanceResponse(**prov)


@router.get("/{target_idx}/eligibility-audit")
def eligibility_audit(
    target_idx: int,
    criterion_variable: str = Query(...),
    criterion_operator: str = Query("gt"),
    criterion_value: float = Query(0),
    state: AppState = Depends(get_state),
) -> EligibilityAuditResponse:
    _validate_target_idx(state, target_idx)
    if criterion_operator not in _OPS:
        raise HTTPException(status_code=400, detail=f"Invalid operator: {criterion_operator}")
    if not state.sim_service.variable_exists(criterion_variable):
        raise HTTPException(status_code=400, detail=f"Unknown variable: {criterion_variable}")

    contributors = matrix_ops.get_target_contributors(state.X_csr, target_idx)
    criterion_vals = state.sim_service.calculate(criterion_variable, map_to="household")
    contributor_vals = criterion_vals[contributors]

    op_fn = _OPS[criterion_operator]
    meets = op_fn(contributor_vals, criterion_value)
    fails = ~meets

    n_meet = int(meets.sum())
    n_fail = int(fails.sum())
    total = len(contributors)

    # Weighted contribution from failing households
    row = state.X_csr[target_idx, :]
    fail_cols = contributors[fails]
    if len(fail_cols) > 0:
        fail_weighted = float(
            row[:, fail_cols].multiply(state.final_weights[fail_cols]).sum()
        )
    else:
        fail_weighted = 0.0

    estimate = float(state.targets_enriched.iloc[target_idx]["estimate"])
    pct_est_failing = (fail_weighted / estimate * 100) if estimate != 0 else 0.0

    return EligibilityAuditResponse(
        target_name=state.target_names[target_idx],
        total_contributors=total,
        meet_criterion=n_meet,
        fail_criterion=n_fail,
        pct_failing=n_fail / total * 100 if total > 0 else 0.0,
        weighted_contribution_from_failing=fail_weighted,
        pct_estimate_from_failing=pct_est_failing,
        diagnosis=(
            f"{n_fail / total:.1%} of contributors do not meet criterion "
            f"({criterion_variable} {criterion_operator} {criterion_value}). "
            f"They contribute {pct_est_failing:.1f}% of the estimate."
            if total > 0
            else "No contributors"
        ),
    )


@router.get("/{target_idx}/constraint-diff")
def constraint_diff(
    target_idx: int,
    state: AppState = Depends(get_state),
) -> ConstraintDiffResponse:
    _validate_target_idx(state, target_idx)
    if state.db_engine is None:
        raise HTTPException(status_code=503, detail="No database connected")

    row = state.targets_enriched.iloc[target_idx]
    stratum_id = row.get("stratum_id")
    if stratum_id is None:
        raise HTTPException(status_code=404, detail="No stratum_id mapping")

    with Session(state.db_engine) as session:
        constraints = db_service.get_target_constraints(
            session, int(stratum_id)
        )

    contributors = matrix_ops.get_target_contributors(state.X_csr, target_idx)
    geo_vars = {"state_fips", "congressional_district_geoid", "ucgid_str"}
    checks = []

    for c in constraints:
        if c["variable"] in geo_vars:
            continue
        if not state.sim_service.variable_exists(c["variable"]):
            checks.append(ConstraintCheck(
                variable=c["variable"],
                operation=c["operation"],
                value=c["value"],
                contributors_satisfying=0,
                contributors_violating=0,
                pct_violating=0,
                status="SKIPPED_UNKNOWN_VARIABLE",
            ))
            continue

        vals = state.sim_service.calculate(c["variable"], map_to="household")
        contributor_vals = vals[contributors]

        threshold = _parse_value(c["value"])
        op_map = {
            ">": op_module.gt,
            ">=": op_module.ge,
            "<": op_module.lt,
            "<=": op_module.le,
            "==": op_module.eq,
            "!=": op_module.ne,
        }
        op_fn = op_map.get(c["operation"])
        if op_fn is None:
            continue

        meets = op_fn(contributor_vals, threshold)
        n_meet = int(meets.sum())
        n_fail = len(contributors) - n_meet
        pct_fail = n_fail / len(contributors) * 100 if len(contributors) > 0 else 0

        if pct_fail > 10:
            status = "VIOLATION"
        elif pct_fail > 1:
            status = "MINOR_VIOLATION"
        else:
            status = "OK"

        checks.append(ConstraintCheck(
            variable=c["variable"],
            operation=c["operation"],
            value=c["value"],
            contributors_satisfying=n_meet,
            contributors_violating=n_fail,
            pct_violating=pct_fail,
            status=status,
        ))

    return ConstraintDiffResponse(
        target_name=state.target_names[target_idx],
        stratum_id=int(stratum_id),
        constraints=checks,
    )


@router.get("/{target_idx}/contributors")
def contributors(
    target_idx: int,
    min_g_weight: float | None = None,
    poverty_only: bool = False,
    sort_by: str = "g_weight",
    limit: int = 50,
    offset: int = 0,
    state: AppState = Depends(get_state),
) -> list[ContributorRow]:
    _validate_target_idx(state, target_idx)
    contribs = matrix_ops.get_target_contributions(
        state.X_csr, target_idx, state.final_weights,
    )
    hh = state.households_df
    merged = contribs.merge(
        hh[["household_idx", "income", "g_weight", "in_poverty", "state"]],
        on="household_idx",
    )

    if poverty_only:
        merged = merged[merged["in_poverty"]]
    if min_g_weight is not None:
        merged = merged[merged["g_weight"] >= min_g_weight]

    if sort_by in merged.columns:
        merged = merged.sort_values(sort_by, ascending=False)
    merged = merged.iloc[offset : offset + limit]

    return [
        ContributorRow(
            household_idx=int(r["household_idx"]),
            raw_value=float(r["raw_value"]),
            weighted_value=float(r["weighted_value"]),
            income=float(r["income"]),
            g_weight=float(r["g_weight"]),
            in_poverty=bool(r["in_poverty"]),
            state=int(r["state"]),
        )
        for _, r in merged.iterrows()
    ]


@router.get("/{target_idx}/convergence")
def convergence(
    target_idx: int,
    state: AppState = Depends(get_state),
) -> list[ConvergencePoint]:
    _validate_target_idx(state, target_idx)
    if state.cal_log is None:
        raise HTTPException(status_code=404, detail="No calibration log available")

    name = state.target_names[target_idx]
    filtered = state.cal_log[state.cal_log["target_name"] == name]
    return [
        ConvergencePoint(
            epoch=int(r["epoch"]),
            estimate=float(r["estimate"]),
            target=float(r["target"]),
            rel_error=float(r["rel_error"]),
            loss=float(r["loss"]),
        )
        for _, r in filtered.iterrows()
    ]


# --- Helpers ---


def _target_row(df, idx: int) -> TargetRow:
    r = df.loc[idx]
    return TargetRow(
        target_idx=idx,
        target_name=str(r.get("target_name", "")),
        variable=str(r.get("variable", "")),
        geo_level=r.get("geo_level"),
        geographic_id=str(r.get("geographic_id", "")),
        domain_variable=r.get("domain_variable"),
        target_value=float(r["value"]),
        estimate=float(r.get("estimate", 0)),
        rel_error=float(r.get("rel_error", 0)),
        abs_rel_error=float(r.get("abs_rel_error", 0)),
        poor_weight_share=float(r.get("poor_weight_share", 0)),
        pull_score=float(r.get("pull_score", 0)),
        n_contributors=int(r.get("n_contributors", 0)),
        n_poor_contributors=int(r.get("n_poor_contributors", 0)),
    )


def _parse_value(val: str):
    """Parse a constraint value string to a numeric type."""
    if val.lower() in ("true", "false"):
        return val.lower() == "true"
    try:
        return float(val)
    except ValueError:
        return val
