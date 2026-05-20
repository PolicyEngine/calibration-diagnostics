"""Parser for storage/calibration_targets/snap_state.csv.

Schema: GEO_ID, Households, Cost — 52 rows (DC + states + national row).
Each row produces TWO target records: a `snap` cost (in dollars) and a
`snap_unit` enrollment count, both at state level (or national for GEO_ID
matching 0100000US).

Period is 2024 (the file is undated; the DB-side period is 2024 for this
variable family, so we mirror it).
"""

from __future__ import annotations

import csv
from pathlib import Path

from backend.scripts.target_index.schema import TargetRecord


SOURCE_PATH = "storage/calibration_targets/snap_state.csv"
PERIOD = 2024


def _geo_id_to_geo(geo_id: str) -> tuple[str, str | None]:
    """0400000US01 → ('state', '01'). 0100000US → ('national', None)."""
    geo_id = geo_id.strip()
    if geo_id.startswith("0400000US"):
        state_fips = geo_id[len("0400000US"):]
        return "state", state_fips
    if geo_id.startswith("0100000US"):
        return "national", None
    return "national", None


def parse(csv_path: Path) -> list[TargetRecord]:
    out: list[TargetRecord] = []
    with csv_path.open() as f:
        reader = csv.DictReader(_uncommented(f))
        for i, row in enumerate(reader):
            geo_level, gid = _geo_id_to_geo(row["GEO_ID"])
            households = float(row["Households"])
            cost = float(row["Cost"])
            row_key = f"row-{i + 2}"  # +2 for header + 1-indexed

            # The DB encodes the household-count target as variable=snap with
            # constraint `snap > 0` (counts the population where snap > 0).
            out.append(TargetRecord(
                variable="snap",
                geo_level=geo_level,
                geographic_id=gid,
                period=PERIOD,
                constraints=(("snap", ">", "0"),),
                value=households,
                is_count=True,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=row_key,
                notes="USDA FNS SNAP — households enrolled (snap > 0 count)",
            ))
            out.append(TargetRecord(
                variable="snap",
                geo_level=geo_level,
                geographic_id=gid,
                period=PERIOD,
                value=cost,
                is_count=False,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=row_key,
                notes="USDA FNS SNAP — dollar cost",
            ))
    return out


def _uncommented(lines):
    """Yield only non-comment, non-empty lines (some CSVs start with a # header)."""
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        yield line
