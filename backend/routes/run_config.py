"""Run-config view: surfaces the `unified_run_config.json` published by
us-data's Stage 3 fit (see upstream `policyengine_us_data.fit_weights`).

Lets the user inspect exactly which fit parameters / specs produced the
loaded calibration without leaving the dashboard.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.state import AppState, get_state

router = APIRouter()


@router.get("/run-config")
def run_config(state: AppState = Depends(get_state)) -> dict:
    """Return the run's `unified_run_config.json` plus the detected scope.

    Pkl-mode (sandbox) runs and any run for which the team hasn't published
    a config return 404 — the JSON literally doesn't exist for them.
    """
    from backend.services.runs import get_dataset
    from backend.services.dataset_loader import _try_fetch_run_config

    try:
        dataset = get_dataset(state.dataset_id)
    except Exception:
        dataset = None
    if dataset is None or dataset.layout != "staging":
        raise HTTPException(
            status_code=404,
            detail="Run config is only published for staging-layout runs.",
        )

    scope = (state.metadata or {}).get("fit_scope", "regional")
    cfg = _try_fetch_run_config(dataset, state.run_id, scope)
    if cfg is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No unified_run_config.json found for "
                f"{state.dataset_id}/{state.run_id} (scope={scope})."
            ),
        )

    return {
        "dataset_id": state.dataset_id,
        "run_id": state.run_id,
        "fit_scope": scope,
        "config": cfg,
    }
