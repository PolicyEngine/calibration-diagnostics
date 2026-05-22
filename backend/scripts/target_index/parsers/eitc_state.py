"""Parser for storage/calibration_targets/eitc_state.csv.

IRS SOI Historical Table 2, EITC by state (TY 2022). The first line is a
`#`-prefixed citation comment; the next line is the header
`GEO_ID,Returns,Amount`.

Each row yields TWO target records at state level:
- `tax_unit_count` (count) constrained by `eitc > 0` and filer gate — the
  Returns column counts EITC-claiming filer tax units.
- `eitc` dollar amount.

Both targets are filer-gated (`tax_unit_is_filer == 1`).
"""

from __future__ import annotations

import csv
from pathlib import Path

from backend.scripts.target_index.schema import TargetRecord


SOURCE_PATH = "storage/calibration_targets/eitc_state.csv"
PERIOD = 2022


def _geo_id_to_state_fips(geo_id: str) -> str | None:
    """0400000US01 → '01'. Returns None if not a state GEO_ID."""
    geo_id = geo_id.strip()
    if geo_id.startswith("0400000US"):
        return geo_id[len("0400000US"):]
    return None


def _uncommented(lines):
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        yield line


def parse(csv_path: Path) -> list[TargetRecord]:
    out: list[TargetRecord] = []
    with csv_path.open() as f:
        reader = csv.DictReader(_uncommented(f))
        for i, row in enumerate(reader):
            state_fips = _geo_id_to_state_fips(row["GEO_ID"])
            if state_fips is None:
                continue
            returns = float(row["Returns"])
            amount = float(row["Amount"])
            row_key = f"{row['GEO_ID']}#{i}"

            # Filer-gated, EITC-claiming tax unit count.
            out.append(TargetRecord(
                variable="tax_unit_count",
                geo_level="state",
                geographic_id=state_fips,
                period=PERIOD,
                constraints=(
                    ("tax_unit_is_filer", "==", "1"),
                    ("eitc", ">", "0"),
                ),
                value=returns,
                is_count=True,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=row_key,
                notes="IRS SOI Historical Table 2 (TY2022) — EITC returns",
            ))
            # Dollar EITC amount, filer-gated.
            out.append(TargetRecord(
                variable="eitc",
                geo_level="state",
                geographic_id=state_fips,
                period=PERIOD,
                constraints=(
                    ("tax_unit_is_filer", "==", "1"),
                ),
                value=amount,
                is_count=False,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=row_key,
                notes="IRS SOI Historical Table 2 (TY2022) — EITC amount",
            ))
    return out
