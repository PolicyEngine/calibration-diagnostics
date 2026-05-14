"""Test-time stubs for heavy policyengine deps.

The diagnostics backend imports policyengine_us_data and policyengine_us at
module load time (via db_service and loader). Tests don't exercise those
paths — they work against synthetic AppState fixtures — so we stub them
out here to avoid requiring the full data stack in the test env.
"""

from __future__ import annotations

import sys
import types


class _Placeholder:
    pass


def _stub(name: str) -> types.ModuleType:
    mod = types.ModuleType(name)
    sys.modules[name] = mod
    return mod


def _ensure_stubs() -> None:
    if "policyengine_us_data" in sys.modules:
        return

    _stub("policyengine_us_data")
    _stub("policyengine_us_data.calibration")
    cal = _stub("policyengine_us_data.calibration.unified_calibration")
    cal.load_calibration_package = lambda *a, **kw: None  # type: ignore[attr-defined]
    cal.load_target_config = lambda *a, **kw: None  # type: ignore[attr-defined]

    _stub("policyengine_us_data.db")
    db = _stub("policyengine_us_data.db.create_database_tables")
    db.Stratum = _Placeholder  # type: ignore[attr-defined]
    db.StratumConstraint = _Placeholder  # type: ignore[attr-defined]
    db.Target = _Placeholder  # type: ignore[attr-defined]

    pe_us = _stub("policyengine_us")
    pe_us.Microsimulation = _Placeholder  # type: ignore[attr-defined]


_ensure_stubs()
