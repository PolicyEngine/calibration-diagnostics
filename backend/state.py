"""Application state holding all loaded calibration artifacts."""

from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np
import pandas as pd
import scipy.sparse as sp
from fastapi import HTTPException, Query, Request
from sqlalchemy.engine import Engine


@dataclass
class AppState:
    """Immutable container for all loaded calibration data for one run.

    Two load paths populate this:
    - **pkl mode** (legacy / sandbox): full X matrix, weights from pkl/npy.
    - **dataset mode** (canonical staging): targets read from policy_data.db,
      estimates computed by evaluating PE variables on the published h5.
      X_csr / X_csc / initial_weights stay empty in this mode.
    """

    # -- From calibration_package.pkl (pkl mode) or empty (dataset mode) --
    X_csr: sp.csr_matrix = field(default_factory=lambda: sp.csr_matrix((0, 0)))
    X_csc: sp.csc_matrix = field(default_factory=lambda: sp.csc_matrix((0, 0)))
    targets_df: pd.DataFrame = field(default_factory=pd.DataFrame)
    target_names: list[str] = field(default_factory=list)
    initial_weights: np.ndarray = field(default_factory=lambda: np.array([]))
    cd_geoid: np.ndarray = field(default_factory=lambda: np.array([]))
    metadata: dict = field(default_factory=dict)

    # -- From calibration_weights.npy --
    final_weights: np.ndarray = field(default_factory=lambda: np.array([]))

    # -- Computed at startup --
    g_weights: np.ndarray = field(default_factory=lambda: np.array([]))
    targets_enriched: pd.DataFrame = field(default_factory=pd.DataFrame)
    households_df: pd.DataFrame = field(default_factory=pd.DataFrame)

    # -- Services --
    sim_service: Any = None  # SimService instance
    db_engine: Optional[Engine] = None

    # -- Optional calibration logs --
    cal_log: Optional[pd.DataFrame] = None
    diagnostics_csv: Optional[pd.DataFrame] = None

    # -- Target config --
    target_config: Optional[dict] = None
    target_config_text: Optional[str] = None   # raw yaml, preserves comments

    # -- Derived scalars --
    time_period: int = 2024
    n_targets: int = 0
    n_households: int = 0

    # -- Provenance: which run produced this state --
    dataset_id: str = ""
    run_id: str = ""


def get_state(
    request: Request,
    dataset: str | None = Query(
        None, description="Dataset id (e.g. 'us-cps'). Falls back to DEFAULT_DATASET env."
    ),
    run: str | None = Query(
        None, description="Run id (HF prefix). Falls back to DEFAULT_RUN env."
    ),
) -> "AppState":
    """FastAPI dependency that resolves a run and returns its AppState.

    Resolution order:
    1. ?dataset & ?run query params
    2. DEFAULT_DATASET / DEFAULT_RUN env vars (set at backend startup)
    3. 400 error
    """
    from backend.services import runs as runs_service

    if dataset is None or run is None:
        fallback = runs_service.default_selection()
        if fallback is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "No run selected. Pass ?dataset=&run= query params, or "
                    "set DEFAULT_DATASET and DEFAULT_RUN env vars."
                ),
            )
        dataset = dataset or fallback[0]
        run = run or fallback[1]

    registry = request.app.state.registry
    try:
        return registry.get(dataset, run)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to load run {dataset}/{run}: {exc}"
        )
