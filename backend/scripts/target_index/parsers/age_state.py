"""Parser for storage/calibration_targets/age_state.csv.

Schema (wide): GEO_ID, GEO_NAME, 0-4, 5-9, 10-14, ..., 80-84, 85+ — 51 rows
(50 states + DC). Each cell is a population count for that state × age band.

Each cell → ONE target:
  variable = person_count
  geo_level = state
  geographic_id = state_fips (extracted from GEO_ID like 0400000US01 → "1")
  constraints = age >= lo AND age < hi  (open-ended for "85+": age >= 85)
  is_count = True
  period = 2024 (the file is undated; mirror the DB period family).
"""

from __future__ import annotations

import csv
from pathlib import Path

from backend.scripts.target_index.schema import TargetRecord

SOURCE_PATH = "storage/calibration_targets/age_state.csv"
PERIOD = 2024


def _parse_band(band: str) -> tuple[int, int | None]:
    """'0-4' → (0, 5);  '85+' → (85, None)."""
    band = band.strip()
    if band.endswith("+"):
        return int(band[:-1]), None
    lo_s, hi_s = band.split("-")
    return int(lo_s), int(hi_s) + 1  # "0-4" inclusive == age < 5


def _geo_id_to_fips(geo_id: str) -> str:
    """0400000US01 → '1' (strip leading zero, consistent with schema._norm_geo_id)."""
    geo_id = geo_id.strip()
    if geo_id.startswith("0400000US"):
        return str(int(geo_id[len("0400000US"):]))
    return geo_id


def parse(csv_path: Path) -> list[TargetRecord]:
    out: list[TargetRecord] = []
    with csv_path.open() as f:
        reader = csv.reader(f)
        header = next(reader)
        band_cols = header[2:]  # skip GEO_ID, GEO_NAME
        bands = [(col, _parse_band(col)) for col in band_cols]

        for i, row in enumerate(reader):
            if not row:
                continue
            fips = _geo_id_to_fips(row[0])
            for col_idx, (band_label, (lo, hi)) in enumerate(bands):
                raw = row[2 + col_idx].strip()
                if not raw:
                    continue
                value = float(raw)
                cons: list[tuple[str, str, str]] = [("age", ">=", str(lo))]
                if hi is not None:
                    cons.append(("age", "<", str(hi)))
                out.append(TargetRecord(
                    variable="person_count",
                    geo_level="state",
                    geographic_id=fips,
                    period=PERIOD,
                    constraints=tuple(cons),
                    value=value,
                    is_count=True,
                    storage_tier="csv",
                    source_path=SOURCE_PATH,
                    source_row=f"row-{i + 2}/{band_label}",
                    notes=f"Census ACS age × state — band {band_label}",
                ))
    return out
