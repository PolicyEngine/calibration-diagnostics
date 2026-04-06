"""Household analysis endpoints."""

import operator as op_module

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.state import get_state
from backend.models import (
    AttributionRow,
    HouseholdProfile,
    HouseholdRow,
)
from backend.services import matrix_ops
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

_DEFAULT_PROFILE_VARS = [
    "employment_income",
    "spm_unit_net_income",
    "spm_unit_spm_threshold",
    "snap",
    "ssi",
    "federal_income_tax",
    "adjusted_gross_income",
    "rent",
    "tax_unit_itemizes",
    "salt_deduction",
]


@router.get("/distorted")
def distorted_households(
    min_g_weight: float = 5.0,
    filter_variable: str | None = None,
    filter_operator: str = "gt",
    filter_value: float = 0,
    state_fips: int | None = Query(None, alias="state"),
    sort_by: str = "g_weight",
    limit: int = 50,
    offset: int = 0,
    state: AppState = Depends(get_state),
) -> list[HouseholdRow]:
    df = state.households_df.copy()
    df = df[df["g_weight"] >= min_g_weight]

    filter_vals = None
    if filter_variable:
        if filter_operator not in _OPS:
            raise HTTPException(
                status_code=400, detail=f"Invalid operator: {filter_operator}"
            )
        if not state.sim_service.variable_exists(filter_variable):
            raise HTTPException(
                status_code=400, detail=f"Unknown variable: {filter_variable}"
            )
        all_vals = state.sim_service.calculate(filter_variable, map_to="household")
        filter_vals = all_vals[df["household_idx"].values]
        op_fn = _OPS[filter_operator]
        mask = op_fn(filter_vals, filter_value)
        df = df[mask.values if hasattr(mask, "values") else mask]
        if filter_vals is not None:
            df = df.copy()
            df["filter_variable_value"] = all_vals[df["household_idx"].values]

    if state_fips is not None:
        df = df[df["state"] == state_fips]

    if sort_by in df.columns:
        df = df.sort_values(sort_by, ascending=False)
    df = df.iloc[offset : offset + limit]

    return [
        HouseholdRow(
            household_idx=int(r["household_idx"]),
            income=float(r["income"]),
            spm_threshold=float(r["spm_threshold"]),
            in_poverty=bool(r["in_poverty"]),
            initial_weight=float(r["initial_weight"]),
            final_weight=float(r["final_weight"]),
            g_weight=float(r["g_weight"]),
            state=int(r["state"]),
            income_decile=int(r["income_decile"]),
            filter_variable_value=(
                float(r["filter_variable_value"])
                if "filter_variable_value" in r.index
                else None
            ),
        )
        for _, r in df.iterrows()
    ]


@router.get("/{household_idx}/profile")
def household_profile(
    household_idx: int,
    variables: str | None = None,
    state: AppState = Depends(get_state),
) -> HouseholdProfile:
    if household_idx < 0 or household_idx >= state.n_households:
        raise HTTPException(
            status_code=404,
            detail=f"household_idx {household_idx} out of range",
        )

    var_list = variables.split(",") if variables else _DEFAULT_PROFILE_VARS
    var_values = {}
    for var in var_list:
        var = var.strip()
        if not state.sim_service.variable_exists(var):
            continue
        vals = state.sim_service.calculate(var, map_to="household")
        var_values[var] = float(vals[household_idx])

    hh = state.households_df
    row = hh[hh["household_idx"] == household_idx].iloc[0]

    return HouseholdProfile(
        household_idx=household_idx,
        initial_weight=float(row["initial_weight"]),
        final_weight=float(row["final_weight"]),
        g_weight=float(row["g_weight"]),
        in_poverty=bool(row["in_poverty"]),
        state=int(row["state"]),
        cd_geoid=int(row["cd_geoid"]),
        variables=var_values,
    )


@router.get("/{household_idx}/attributions")
def household_attributions(
    household_idx: int,
    state: AppState = Depends(get_state),
) -> list[AttributionRow]:
    if household_idx < 0 or household_idx >= state.n_households:
        raise HTTPException(
            status_code=404,
            detail=f"household_idx {household_idx} out of range",
        )

    attribs = matrix_ops.get_household_attributions(
        state.X_csc, household_idx, state.final_weights,
    )
    enriched = state.targets_enriched

    rows = []
    for _, a in attribs.iterrows():
        tidx = int(a["target_idx"])
        t = enriched.iloc[tidx]
        rows.append(AttributionRow(
            target_idx=tidx,
            target_name=state.target_names[tidx],
            variable=t.get("variable"),
            geo_level=t.get("geo_level"),
            raw_value=float(a["raw_value"]),
            weighted_value=float(a["weighted_value"]),
            target_rel_error=float(t.get("rel_error", 0)),
        ))

    rows.sort(key=lambda r: r.target_rel_error)
    return rows
