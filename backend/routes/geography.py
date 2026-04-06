"""Geography listing and lookup endpoints."""

import numpy as np
from fastapi import APIRouter, Depends

from backend.services.geo_utils import (
    cd_display_name,
    list_states,
    state_name,
)
from backend.state import AppState, get_state

router = APIRouter()


@router.get("/states")
def get_states() -> list[dict]:
    """List all states with FIPS, name, and abbreviation."""
    return list_states()


@router.get("/districts")
def get_districts(
    state: AppState = Depends(get_state),
) -> list[dict]:
    """List all congressional districts present in the dataset."""
    cd_col = state.households_df["cd_geoid"].values
    unique_cds = sorted(set(int(x) for x in cd_col if x != 0))
    return [
        {"cd_geoid": cd, "name": cd_display_name(cd)}
        for cd in unique_cds
    ]


@router.get("/districts/{state_fips}")
def get_districts_for_state(
    state_fips: int,
    state: AppState = Depends(get_state),
) -> list[dict]:
    """List congressional districts in a specific state."""
    cd_col = state.households_df["cd_geoid"].values
    unique_cds = sorted(set(
        int(x) for x in cd_col
        if x != 0 and int(x) // 100 == state_fips
    ))
    return [
        {"cd_geoid": cd, "name": cd_display_name(cd)}
        for cd in unique_cds
    ]
