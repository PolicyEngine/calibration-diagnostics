"""Parser for storage/calibration_targets/acs_housing_costs_2024.csv.

Schema: state_code, state_fips, annual_contract_rent, real_estate_taxes.
51 rows. State-level dollar amounts (already in dollars, no scaling).

Each row → TWO targets:
  1. rent ($ annual_contract_rent), state-level.
  2. real_estate_taxes ($ real_estate_taxes), state-level.

period=2024. is_count=False for both.
"""

from __future__ import annotations

import csv
from pathlib import Path

from backend.scripts.target_index.schema import TargetRecord

SOURCE_PATH = "storage/calibration_targets/acs_housing_costs_2024.csv"
PERIOD = 2024


def parse(csv_path: Path) -> list[TargetRecord]:
    out: list[TargetRecord] = []
    with csv_path.open() as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            # state_fips column may be zero-padded ("02") — normalise to bare int-string.
            fips_raw = row["state_fips"].strip()
            try:
                fips = str(int(fips_raw))
            except ValueError:
                continue
            rent = float(row["annual_contract_rent"])
            ret = float(row["real_estate_taxes"])
            row_key = f"row-{i + 2}"

            out.append(TargetRecord(
                variable="rent",
                geo_level="state",
                geographic_id=fips,
                period=PERIOD,
                value=rent,
                is_count=False,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=f"{row_key}/rent",
                notes="ACS 2024 — annual contract rent (state aggregate, $)",
            ))
            out.append(TargetRecord(
                variable="real_estate_taxes",
                geo_level="state",
                geographic_id=fips,
                period=PERIOD,
                value=ret,
                is_count=False,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=f"{row_key}/real_estate_taxes",
                notes="ACS 2024 — real estate taxes (state aggregate, $)",
            ))
    return out
