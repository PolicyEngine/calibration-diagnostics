"""Unified target record schema spanning the 5 storage tiers."""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Literal


StorageTier = Literal["db", "csv", "python", "generator", "yaml"]


@dataclass
class TargetRecord:
    """One calibration target, normalised across all source tiers.

    The `signature` is what we use to match the same logical target across
    tiers — e.g. tier-1 CSV row for SNAP-Alabama-2024 should signature-match
    the tier-5 DB row produced from it.
    """

    # Identity (used for matching)
    variable: str
    geo_level: str | None = None         # "national" | "state" | "district" | None
    geographic_id: str | None = None     # e.g. "01" (state fips) or "0612" (CD)
    period: int | None = None
    constraints: tuple[tuple[str, str, str], ...] = field(default_factory=tuple)
    # Each constraint is (variable, operation, value) — e.g. ("tax_unit_is_filer", "==", "1")

    # Value
    value: float | None = None
    is_count: bool = False              # True when value is a count, not a $ amount

    # Provenance
    storage_tier: StorageTier = "csv"
    source_path: str = ""                # e.g. "storage/calibration_targets/snap_state.csv"
    source_row: str = ""                 # row index, line number, or symbolic key
    notes: str = ""                      # free text — usually the data team's citation

    def signature(self) -> tuple:
        """Canonical key for cross-tier matching.

        - geographic_id is normalised through int() when numeric so '01' and
          '1' compare equal (CSVs use Census GEO_ID strings, the DB stores
          state_fips as bare integers).
        - constraint values are normalised the same way for the same reason.
        """
        return (
            self.variable,
            self.geo_level or "",
            _norm_geo_id(self.geographic_id),
            self.period or 0,
            tuple(sorted((c[0], c[1], _norm_geo_id(c[2])) for c in self.constraints)),
        )

    def to_dict(self) -> dict:
        d = asdict(self)
        d["constraints"] = [list(c) for c in self.constraints]
        d["signature"] = list(self.signature())
        return d


def _norm_geo_id(val) -> str:
    """Normalise a geographic id / constraint value: strip leading zeros for
    numeric strings; otherwise keep as-is."""
    if val is None or val == "":
        return ""
    s = str(val)
    try:
        f = float(s)
    except (TypeError, ValueError):
        return s
    # Preserve inf/nan as their string form so AGI band bounds remain comparable.
    import math
    if not math.isfinite(f):
        return s
    return str(int(f))
