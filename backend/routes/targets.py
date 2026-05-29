"""Target analysis endpoints."""

import operator as op_module
from typing import Annotated

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlmodel import Session

from backend.services.geo_utils import geo_display_name
from backend.state import get_state
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
                "loss_contribution": float(row.get("loss_contribution", 0)),
                "n_contributors": int(row.get("n_contributors", 0)),
            }
        out.append({**r, **error_info})

    if sort_by in ("abs_rel_error", "loss_contribution", "rel_error"):
        out.sort(key=lambda x: abs(x.get(sort_by, 0)), reverse=True)
    return out


@router.get("/worst-fit")
def worst_fit(
    limit: int = 20,
    included_only: bool = True,
    state: AppState = Depends(get_state),
) -> list[TargetRow]:
    enriched = state.targets_enriched
    if included_only:
        enriched = enriched[enriched["included"]]
    enriched = enriched.sort_values(
        "abs_rel_error", ascending=False
    ).head(limit)
    return [_target_row(enriched, idx) for idx in enriched.index]


# Error buckets — abs_rel_error ranges. Order matters for display.
ERROR_BUCKETS = {
    "excellent": (0.0, 0.05),
    "good":      (0.05, 0.20),
    "poor":      (0.20, 0.50),
    "extreme":   (0.50, float("inf")),
}


def _available_bundles_for_state(state) -> "frozenset[str] | None":
    """Look up which bundle h5s the loaded run actually publishes on HF.

    Returns ``None`` for runs without a resolvable HF repo (pkl-mode
    sandbox); callers that get ``None`` should treat the canonical
    bundle mapping as a best-effort label rather than a verified fact.
    """
    try:
        from backend.services.runs import get_dataset
        from backend.services.bundle_availability import published_bundles
        ds = get_dataset(state.dataset_id)
    except Exception:
        return None
    if ds is None or getattr(ds, "layout", None) != "staging":
        return None
    return published_bundles(ds.repo_id, state.run_id)


def _apply_target_filters(
    df,
    *,
    search: str | None = None,
    variables: list[str] | None = None,
    geo_levels: list[str] | None = None,
    error_buckets: list[str] | None = None,
    sources: list[str] | None = None,
    geographic_id: str | None = None,
    state_fips: list[int] | None = None,
    domain_variable: str | None = None,
    min_abs_rel_error: float | None = None,
    included_only: bool | None = None,
    dataset_files: list[str] | None = None,
    available_bundles: "frozenset[str] | None" = None,
):
    """Apply the standard filter set used by list_targets and facets."""
    if included_only is not None:
        df = df[df["included"] == included_only]
    if variables:
        df = df[df["variable"].isin(variables)]
    if geo_levels:
        df = df[df["geo_level"].isin(geo_levels)]
    if error_buckets:
        # Strict: if user passed bucket names but none are recognised, return
        # an empty result rather than silently ignoring the filter.
        masks = []
        for bucket in error_buckets:
            if bucket not in ERROR_BUCKETS:
                continue
            lo, hi = ERROR_BUCKETS[bucket]
            masks.append((df["abs_rel_error"] >= lo) & (df["abs_rel_error"] < hi))
        if not masks:
            df = df.iloc[0:0]
        else:
            combined = masks[0]
            for m in masks[1:]:
                combined = combined | m
            df = df[combined]
    if sources and "source" in df.columns:
        df = df[df["source"].isin(sources)]
    if dataset_files:
        # Each target maps to one calibrated h5 in us-data's pipeline. If
        # `available_bundles` is set, fall back to the federal bundle when
        # the conventional per-bundle h5 doesn't exist for this run.
        from backend.services.geo_utils import runtime_dataset_bundle_for
        wanted = set(dataset_files)
        df = df[df.apply(
            lambda r: runtime_dataset_bundle_for(
                r.get("geo_level"), r.get("geographic_id"),
                available=available_bundles,
            ) in wanted,
            axis=1,
        )]
    if geographic_id:
        df = df[df["geographic_id"].astype(str) == str(geographic_id)]
    if state_fips:
        fips_set = set(state_fips)
        def _matches_any_state(gid):
            s = str(gid)
            if not s.isdigit():
                return s in {str(f) for f in fips_set}
            try:
                return int(s) in fips_set or (int(s) // 100) in fips_set
            except ValueError:
                return False
        df = df[df["geographic_id"].apply(_matches_any_state)]
    if domain_variable:
        df = df[
            df["domain_variable"].str.contains(
                domain_variable, case=False, na=False
            )
        ]
    if min_abs_rel_error is not None:
        df = df[df["abs_rel_error"] >= min_abs_rel_error]
    if search:
        # Search across target_name + variable + domain (case-insensitive)
        s = search.lower()
        haystack = (
            df["target_name"].fillna("").astype(str).str.lower()
            + " "
            + df["variable"].fillna("").astype(str).str.lower()
            + " "
            + df.get("domain", df.get("domain_variable", "")).fillna("").astype(str).str.lower()
        )
        df = df[haystack.str.contains(s, regex=False, na=False)]
    return df


@router.get("")
def list_targets(
    request: Request,
    sort_by: str = "loss_contribution",
    sort_order: str = "desc",
    search: str | None = None,
    variable: Annotated[list[str] | None, Query()] = None,
    geo_level: Annotated[list[str] | None, Query()] = None,
    error_bucket: Annotated[list[str] | None, Query()] = None,
    source: Annotated[list[str] | None, Query()] = None,
    geographic_id: str | None = None,
    state_fips: Annotated[list[int] | None, Query(alias="state_fips")] = None,
    domain_variable: str | None = None,
    min_abs_rel_error: float | None = None,
    included_only: bool | None = None,
    compare_run: str | None = Query(
        None, description="Second run id (same dataset) to join for compare mode."
    ),
    dataset_file: Annotated[list[str] | None, Query()] = None,
    limit: int = 50,
    offset: int = 0,
    state: AppState = Depends(get_state),
) -> TargetListResponse:
    available_bundles = _available_bundles_for_state(state)
    df = _apply_target_filters(
        state.targets_enriched,
        search=search,
        variables=variable,
        geo_levels=geo_level,
        error_buckets=error_bucket,
        sources=source,
        geographic_id=geographic_id,
        state_fips=state_fips,
        domain_variable=domain_variable,
        min_abs_rel_error=min_abs_rel_error,
        included_only=included_only,
        dataset_files=dataset_file,
        available_bundles=available_bundles,
    )

    # Compare-run join: enriches each row with estimate_b / rel_error_b /
    # abs_rel_error_b / delta from the second run, joined on target_id.
    # Loaded through the registry so a cold compare-run picks up the same
    # entity-aware evaluator pass.
    df_b = None
    if compare_run and compare_run != state.run_id:
        try:
            state_b = request.app.state.registry.get(state.dataset_id, compare_run)
            df_b = state_b.targets_enriched
        except Exception:
            df_b = None
    if df_b is not None and not df_b.empty:
        b_cols = df_b[["target_id", "estimate", "rel_error", "abs_rel_error"]].rename(
            columns={
                "estimate": "estimate_b",
                "rel_error": "rel_error_b",
                "abs_rel_error": "abs_rel_error_b",
            }
        )
        df = df.merge(b_cols, on="target_id", how="left")
        df["delta"] = df["abs_rel_error_b"] - df["abs_rel_error"]

    total = len(df)
    ascending = sort_order == "asc"
    if sort_by in df.columns:
        df = df.sort_values(sort_by, ascending=ascending)
    df = df.iloc[offset : offset + limit]

    has_compare = df_b is not None and not df_b.empty
    return TargetListResponse(
        items=[_target_row(df, idx, with_compare=has_compare) for idx in df.index],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/facets")
def get_facets(
    search: str | None = None,
    variable: Annotated[list[str] | None, Query()] = None,
    geo_level: Annotated[list[str] | None, Query()] = None,
    error_bucket: Annotated[list[str] | None, Query()] = None,
    source: Annotated[list[str] | None, Query()] = None,
    included_only: bool | None = None,
    state_fips: Annotated[list[int] | None, Query(alias="state_fips")] = None,
    state: AppState = Depends(get_state),
):
    """Per-facet counts. For each facet, counts are computed against the
    other active filters (so a facet doesn't suppress its own selection)."""

    def _filtered(exclude: str):
        return _apply_target_filters(
            state.targets_enriched,
            search=search,
            variables=variable if exclude != "variable" else None,
            geo_levels=geo_level if exclude != "geo_level" else None,
            error_buckets=error_bucket if exclude != "error_bucket" else None,
            sources=source if exclude != "source" else None,
            included_only=included_only,
            state_fips=state_fips,
        )

    def _value_counts_with_loss(df, col: str):
        if col not in df.columns:
            return []
        grouped = (
            df.groupby(col, dropna=False)
            .agg(count=(col, "size"),
                 total_loss=("loss_contribution", "sum"))
            .sort_values("total_loss", ascending=False)
        )
        out = []
        for key, row in grouped.iterrows():
            out.append({
                "value": "(none)" if key is None or (isinstance(key, float) and key != key) else str(key),
                "count": int(row["count"]),
                "total_loss": float(row["total_loss"]),
            })
        return out

    by_variable = _value_counts_with_loss(_filtered("variable"), "variable")
    by_geo_level = _value_counts_with_loss(_filtered("geo_level"), "geo_level")
    by_source = _value_counts_with_loss(_filtered("source"), "source")

    # Per-h5-bundle counts: which calibrated dataset each target rolls
    # up into. Runtime-aware so we only list bundles the run actually
    # publishes — for a federal-only GHA run that means a single entry
    # holding all 40k targets, not the theoretical 200 names.
    from backend.services.geo_utils import runtime_dataset_bundle_for
    available_bundles = _available_bundles_for_state(state)
    df_bundles = _filtered("dataset_file")
    df_bundles = df_bundles.assign(
        _bundle=df_bundles.apply(
            lambda r: runtime_dataset_bundle_for(
                r.get("geo_level"), r.get("geographic_id"),
                available=available_bundles,
            ),
            axis=1,
        )
    )
    bundle_counts = (
        df_bundles.groupby("_bundle", dropna=False)
        .size()
        .sort_values(ascending=False)
        .head(200)
    )
    by_dataset_file = [
        {"value": str(k), "count": int(v)} for k, v in bundle_counts.items()
    ]

    # Error buckets — count distribution within the current selection-aware df.
    df_for_buckets = _filtered("error_bucket")
    abs_err = df_for_buckets["abs_rel_error"].to_numpy() if "abs_rel_error" in df_for_buckets.columns else []
    by_error_bucket = []
    for name, (lo, hi) in ERROR_BUCKETS.items():
        if len(abs_err) == 0:
            count = 0
        else:
            count = int(((abs_err >= lo) & (abs_err < hi)).sum())
        by_error_bucket.append({"value": name, "count": count})

    # Status: included vs skipped
    df_status = _apply_target_filters(
        state.targets_enriched,
        search=search,
        variables=variable,
        geo_levels=geo_level,
        error_buckets=error_bucket,
        state_fips=state_fips,
    )
    by_status = []
    if "included" in df_status.columns:
        included_ct = int(df_status["included"].sum())
        skipped_ct = int((~df_status["included"]).sum())
        by_status = [
            {"value": "included", "count": included_ct},
            {"value": "skipped",  "count": skipped_ct},
        ]

    return {
        "by_variable": by_variable,
        "by_geo_level": by_geo_level,
        "by_source": by_source,
        "by_error_bucket": by_error_bucket,
        "by_status": by_status,
        "by_dataset_file": by_dataset_file,
        "buckets_definition": {
            k: {"min": v[0], "max": None if v[1] == float("inf") else v[1]}
            for k, v in ERROR_BUCKETS.items()
        },
    }


@router.get("/source-summary")
def get_source_summary(
    included_only: bool | None = True,
    state: AppState = Depends(get_state),
):
    """Per-source stats: count, mean/median |rel_error|, % within ±10%.
    Useful for spotting upstream sources the calibration fits well vs poorly.
    """
    df = state.targets_enriched
    if df.empty or "source" not in df.columns:
        return {"sources": []}
    if included_only and "included" in df.columns:
        df = df[df["included"].astype(bool)]

    grouped = (
        df.dropna(subset=["source"])
        .groupby("source", dropna=False)
        .agg(
            n_targets=("source", "size"),
            mean_abs_rel_error=("abs_rel_error", "mean"),
            median_abs_rel_error=("abs_rel_error", "median"),
            total_loss=("loss_contribution", "sum"),
        )
        .reset_index()
        .sort_values("n_targets", ascending=False)
    )
    out = []
    for _, r in grouped.iterrows():
        # Pct within 10%
        sub = df[df["source"] == r["source"]]
        abs_err = sub["abs_rel_error"].to_numpy()
        finite = abs_err[np.isfinite(abs_err)]
        within_10 = float((finite <= 0.10).mean()) if len(finite) else None
        out.append({
            "source": str(r["source"]),
            "n_targets": int(r["n_targets"]),
            "mean_abs_rel_error": _safe_float(r["mean_abs_rel_error"]),
            "median_abs_rel_error": _safe_float(r["median_abs_rel_error"]),
            "total_loss": _safe_float(r["total_loss"]),
            "pct_within_10pct": within_10,
        })
    return {"sources": out}


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


def _nan_to_none(val):
    """Convert pandas NaN to None for Pydantic compatibility."""
    if isinstance(val, float) and pd.isna(val):
        return None
    return val


def _safe_int(val) -> int | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


def _safe_float(val) -> float | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _parse_constraints_from_name(target_name: str) -> list[str]:
    """Extract non-geographic constraints from target_name.

    Target names look like: national/snap/[tax_unit_is_filer==1,snap>0]
    or: cd_0622/person_count/[age>=18,age<25]
    or: national/rent (no brackets = no constraints)
    """
    if not isinstance(target_name, str) or "[" not in target_name:
        return []
    bracket = target_name[target_name.index("[") + 1 : target_name.rindex("]")]
    if not bracket:
        return []
    return [c.strip() for c in bracket.split(",") if c.strip()]


def _target_row(df, idx: int, with_compare: bool = False) -> TargetRow:
    r = df.loc[idx]
    gl = _nan_to_none(r.get("geo_level")) or "national"
    gid = str(_nan_to_none(r.get("geographic_id")) or "US")
    constraints = _parse_constraints_from_name(str(r.get("target_name", "")))
    return TargetRow(
        target_idx=idx,
        target_id=_safe_int(r.get("target_id")),
        variable=str(r.get("variable", "")),
        geo_level=gl,
        geographic_id=gid,
        geo_display_name=geo_display_name(gl, gid),
        constraints=constraints,
        target_value=float(r["value"]),
        estimate=float(r.get("estimate", 0)),
        rel_error=float(r.get("rel_error", 0)),
        abs_error=abs(float(r.get("estimate", 0)) - float(r["value"])),
        loss_contribution=float(r.get("loss_contribution", 0)),
        included=bool(r.get("included", True)),
        source=_nan_to_none(r.get("source")),
        period=_safe_int(r.get("period")),
        tolerance=_safe_float(r.get("tolerance")),
        notes=_nan_to_none(r.get("notes")),
        estimate_b=_safe_float(r.get("estimate_b")) if with_compare else None,
        rel_error_b=_safe_float(r.get("rel_error_b")) if with_compare else None,
        abs_rel_error_b=_safe_float(r.get("abs_rel_error_b")) if with_compare else None,
        delta=_safe_float(r.get("delta")) if with_compare else None,
    )
