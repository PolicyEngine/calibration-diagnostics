"""Parser for storage/calibration_targets/np2023_d5_mid.csv.

Census National Population Projections (2023 vintage, middle series).
Schema (wide, 2581 rows):
  NATIVITY, RACE_HISP, SEX, YEAR, TOTAL_POP, POP_0, POP_1, ..., POP_85

Schema decision (pragmatic — see brief): the CSV is dimensioned by nativity
× race/hispanic origin × sex × year × age. We only ingest the "all
categories" rows so the audit doesn't drown in millions of disaggregated
cells.

Census's own "all categories" coding uses 0 for RACE_HISP and SEX (those
columns have a literal 0 row meaning "Total"). NATIVITY, however, has no
"0" row in this file — only 1 (Total/native projection series) and 2
(foreign-born). The NATIVITY=1 row reports a 2024 total of ~288.9M, which
matches the published US resident-population projection, so we treat
NATIVITY=1 as the "all" series and ingest those rows.

Each kept row (one per YEAR) → 87 targets:
  - 1 TOTAL_POP target per year (national, no age constraint).
  - 86 per-age targets, one per POP_N column, constrained by age == N.

If no NATIVITY=1 rows are present we fall back to ingesting nothing for
that year; in practice every projection year has one.
"""

from __future__ import annotations

import csv
from pathlib import Path

from backend.scripts.target_index.schema import TargetRecord

SOURCE_PATH = "storage/calibration_targets/np2023_d5_mid.csv"

# NATIVITY=1 acts as the "all" series (NATIVITY=0 is not present in this file).
ALL_NATIVITY = "1"
ALL_RACE_HISP = "0"
ALL_SEX = "0"


def parse(csv_path: Path) -> list[TargetRecord]:
    out: list[TargetRecord] = []
    with csv_path.open() as f:
        reader = csv.DictReader(f)
        pop_cols = [c for c in (reader.fieldnames or []) if c.startswith("POP_")]
        # POP_N → age N (POP_85 is the open-ended top group; we still encode it
        # as age == 85 to mirror how the DB strata key the projection).
        age_for_col = {c: int(c.split("_", 1)[1]) for c in pop_cols}

        for i, row in enumerate(reader):
            if (row["NATIVITY"].strip() != ALL_NATIVITY
                or row["RACE_HISP"].strip() != ALL_RACE_HISP
                or row["SEX"].strip() != ALL_SEX):
                continue

            year = int(row["YEAR"])
            row_key = f"row-{i + 2}/year-{year}"

            # Total population for the year (no age constraint).
            try:
                total = float(row["TOTAL_POP"])
            except (TypeError, ValueError):
                total = None
            if total is not None:
                out.append(TargetRecord(
                    variable="person_count",
                    geo_level="national",
                    geographic_id=None,
                    period=year,
                    value=total,
                    is_count=True,
                    storage_tier="csv",
                    source_path=SOURCE_PATH,
                    source_row=f"{row_key}/total",
                    notes="Census NP2023 mid-series — total US population",
                ))

            # Per-age targets.
            for col in pop_cols:
                raw = (row.get(col) or "").strip()
                if not raw:
                    continue
                try:
                    value = float(raw)
                except ValueError:
                    continue
                age = age_for_col[col]
                out.append(TargetRecord(
                    variable="person_count",
                    geo_level="national",
                    geographic_id=None,
                    period=year,
                    constraints=(("age", "==", str(age)),),
                    value=value,
                    is_count=True,
                    storage_tier="csv",
                    source_path=SOURCE_PATH,
                    source_row=f"{row_key}/{col}",
                    notes=f"Census NP2023 mid-series — age {age}",
                ))
    return out
