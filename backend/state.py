"""Application state holding all loaded calibration artifacts."""

from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np
import pandas as pd
import scipy.sparse as sp
from sqlalchemy.engine import Engine


@dataclass
class AppState:
    """Immutable container for all loaded calibration data.

    Created once at startup by loader.load_all_artifacts() and attached
    to the FastAPI app.  Every route handler receives this via the
    get_state() dependency.
    """

    # -- From calibration_package.pkl --
    X_csr: sp.csr_matrix  # (n_targets, n_households) row access
    X_csc: sp.csc_matrix  # same data, column access
    targets_df: pd.DataFrame  # raw targets_df from package
    target_names: list[str]
    initial_weights: np.ndarray  # (n_households,)
    cd_geoid: np.ndarray  # (n_households,)
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

    # -- Derived scalars --
    time_period: int = 2024
    n_targets: int = 0
    n_households: int = 0
