"""Node-variable inventory.

A "node variable" is a leaf in the policyengine_us variable tree: no formula,
no `adds`, no `subtracts`, no `uprating`. These are the pure inputs the
microsim cannot derive on its own — they have to come from the dataset or
calibration. This view lets users see, for the loaded run, which of those
leaves actually carry a calibration target and which are left to whatever
upstream data provides.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.state import AppState, get_state

router = APIRouter()


def _tax_benefit_system(state: AppState):
    """The state's sim_service is either a SimService wrapper (pkl mode) or
    a raw Microsimulation (dataset mode). Both expose tax_benefit_system,
    one via ._sim and the other directly."""
    sim = state.sim_service
    if sim is None:
        return None
    return getattr(sim, "_sim", sim).tax_benefit_system


def _is_leaf(var) -> bool:
    """No way to compute this variable from others — it must come from data."""
    if getattr(var, "formulas", None):
        return False
    if getattr(var, "adds", None):
        return False
    if getattr(var, "subtracts", None):
        return False
    if getattr(var, "uprating", None):
        return False
    return True


@router.get("/nodes")
def list_nodes(state: AppState = Depends(get_state)) -> dict:
    """Return every leaf input variable and whether it has a calibration target.

    is_calibrated is true iff the variable name appears in the loaded run's
    targets table at any geo level / constraint set.
    """
    tbs = _tax_benefit_system(state)
    if tbs is None:
        return {"items": [], "total": 0, "n_calibrated": 0}

    calibrated_vars: set[str] = set()
    df = state.targets_enriched
    if not df.empty and "variable" in df.columns:
        calibrated_vars = set(df["variable"].dropna().astype(str).unique())

    items = []
    for name, var in tbs.variables.items():
        if not _is_leaf(var):
            continue
        items.append({
            "name": name,
            "label": getattr(var, "label", None) or name,
            "entity": var.entity.key,
            "value_type": var.value_type.__name__,
            "definition_period": getattr(var, "definition_period", None),
            "documentation": getattr(var, "documentation", None) or None,
            "is_calibrated": name in calibrated_vars,
        })
    items.sort(key=lambda r: r["name"])

    n_cal = sum(1 for r in items if r["is_calibrated"])
    return {
        "items": items,
        "total": len(items),
        "n_calibrated": n_cal,
    }
