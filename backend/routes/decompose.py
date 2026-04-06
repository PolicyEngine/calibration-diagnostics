"""Composite variable decomposition endpoint."""

import numpy as np
from fastapi import APIRouter, Depends, HTTPException

from backend.state import get_state
from backend.models import (
    DecomposeComponent,
    DecomposeRequest,
    DecomposeResponse,
)
from backend.state import AppState

router = APIRouter()


@router.post("/decompose")
def decompose(
    body: DecomposeRequest,
    state: AppState = Depends(get_state),
) -> DecomposeResponse:
    sim = state.sim_service
    if not sim.variable_exists(body.variable):
        raise HTTPException(
            status_code=400, detail=f"Unknown variable: {body.variable}"
        )

    dependencies = sim.get_formula_dependencies(body.variable)
    if not dependencies:
        raise HTTPException(
            status_code=400,
            detail=f"Variable '{body.variable}' has no adds/subtracts dependencies. "
            "It may be an input variable or use a formula that doesn't decompose this way.",
        )

    # Build subgroup mask
    mask = np.ones(state.n_households, dtype=bool)
    if body.subgroup == "near_poverty":
        income = sim.calculate("spm_unit_net_income", map_to="household")
        threshold = sim.calculate("spm_unit_spm_threshold", map_to="household")
        mask = (income > 0.8 * threshold) & (income < 1.2 * threshold)

    iw = state.initial_weights
    fw = state.final_weights

    components = []
    for var in dependencies:
        if not sim.variable_exists(var):
            continue
        vals = sim.calculate(var, map_to="household")
        initial_total = float(vals[mask] @ iw[mask])
        final_total = float(vals[mask] @ fw[mask])
        if abs(initial_total) > 0:
            shift_pct = (final_total - initial_total) / abs(initial_total) * 100
        else:
            shift_pct = 0.0
        components.append(DecomposeComponent(
            variable=var,
            initial_total=initial_total,
            final_total=final_total,
            shift_pct=shift_pct,
        ))

    components.sort(key=lambda c: abs(c.shift_pct), reverse=True)

    # Compute composite-level values
    composite_vals = sim.calculate(body.variable, map_to="household")
    composite_initial = float(composite_vals[mask] @ iw[mask])
    composite_final = float(composite_vals[mask] @ fw[mask])

    return DecomposeResponse(
        components=components,
        composite_initial=composite_initial,
        composite_final=composite_final,
    )
