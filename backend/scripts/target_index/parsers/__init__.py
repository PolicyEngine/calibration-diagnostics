"""Per-CSV parsers for storage/calibration_targets/*.csv.

Each module exposes `parse(csv_path: Path) -> list[TargetRecord]`.

Add a new parser by:
1. Drop a module in this directory.
2. Register it in PARSER_REGISTRY below, keyed by CSV filename.

The audit orchestrator (audit.py) iterates the registry and invokes each
parser, then matches the resulting records against policy_data.db.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable

from backend.scripts.target_index.schema import TargetRecord

from . import (
    aca_marketplace_state_metal_selection_2024,
    aca_ptc_state,
    aca_spending_and_enrollment_2024,
    aca_spending_and_enrollment_2025,
    aca_spending_and_enrollment_2026,
    acs_housing_costs_2024,
    age_state,
    agi_state,
    eitc_by_agi_and_children,
    eitc_claim_controls,
    eitc_state,
    healthcare_spending,
    medicaid_enrollment_2024,
    medicaid_enrollment_2025,
    medicaid_enrollment_2026,
    np2023_d5_mid,
    population_by_state,
    real_estate_taxes_by_state_acs,
    snap_state,
    soi_targets,
    spm_threshold_agi,
)

PARSER_REGISTRY: dict[str, Callable[[Path], list[TargetRecord]]] = {
    "aca_marketplace_state_metal_selection_2024.csv": aca_marketplace_state_metal_selection_2024.parse,
    "aca_ptc_state.csv": aca_ptc_state.parse,
    "aca_spending_and_enrollment_2024.csv": aca_spending_and_enrollment_2024.parse,
    "aca_spending_and_enrollment_2025.csv": aca_spending_and_enrollment_2025.parse,
    "aca_spending_and_enrollment_2026.csv": aca_spending_and_enrollment_2026.parse,
    "acs_housing_costs_2024.csv": acs_housing_costs_2024.parse,
    "age_state.csv": age_state.parse,
    "agi_state.csv": agi_state.parse,
    "eitc_by_agi_and_children.csv": eitc_by_agi_and_children.parse,
    "eitc_claim_controls.csv": eitc_claim_controls.parse,
    "eitc_state.csv": eitc_state.parse,
    "healthcare_spending.csv": healthcare_spending.parse,
    "medicaid_enrollment_2024.csv": medicaid_enrollment_2024.parse,
    "medicaid_enrollment_2025.csv": medicaid_enrollment_2025.parse,
    "medicaid_enrollment_2026.csv": medicaid_enrollment_2026.parse,
    "np2023_d5_mid.csv": np2023_d5_mid.parse,
    "population_by_state.csv": population_by_state.parse,
    "real_estate_taxes_by_state_acs.csv": real_estate_taxes_by_state_acs.parse,
    "snap_state.csv": snap_state.parse,
    "soi_targets.csv": soi_targets.parse,
    "spm_threshold_agi.csv": spm_threshold_agi.parse,
}
