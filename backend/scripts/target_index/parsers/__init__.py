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

from . import snap_state, soi_targets

# Filename → parser callable. Keep alphabetical for reviewability.
PARSER_REGISTRY: dict[str, Callable[[Path], list[TargetRecord]]] = {
    "snap_state.csv": snap_state.parse,
    "soi_targets.csv": soi_targets.parse,
    # TODO: 17 more CSVs to register. The audit script's coverage flag will
    # show which ones still need adapters.
}
