"""Parser for storage/calibration_targets/real_estate_taxes_by_state_acs.csv.

Schema: state_code, real_estate_taxes_bn — 51 rows. The `_bn` suffix means
the value is in BILLIONS of dollars; multiply by 1e9 for the canonical
target value (which must be in dollars to match the DB).

Each row → ONE target:
  variable = real_estate_taxes
  geo_level = state
  geographic_id = state_fips (from STATE_CODE_TO_FIPS lookup)
  value = real_estate_taxes_bn * 1e9
  is_count = False
  period = 2024
"""

from __future__ import annotations

import csv
from pathlib import Path

from backend.scripts.target_index.schema import TargetRecord

SOURCE_PATH = "storage/calibration_targets/real_estate_taxes_by_state_acs.csv"
PERIOD = 2024

STATE_CODE_TO_FIPS = {
    "AL": "1", "AK": "2", "AZ": "4", "AR": "5", "CA": "6", "CO": "8",
    "CT": "9", "DE": "10", "DC": "11", "FL": "12", "GA": "13", "HI": "15",
    "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21",
    "LA": "22", "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27",
    "MS": "28", "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33",
    "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39",
    "OK": "40", "OR": "41", "PA": "42", "RI": "44", "SC": "45", "SD": "46",
    "TN": "47", "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53",
    "WV": "54", "WI": "55", "WY": "56",
}


def parse(csv_path: Path) -> list[TargetRecord]:
    out: list[TargetRecord] = []
    with csv_path.open() as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            state = row["state_code"].strip().upper()
            fips = STATE_CODE_TO_FIPS.get(state)
            if fips is None:
                continue
            value_bn = float(row["real_estate_taxes_bn"])
            value = value_bn * 1e9

            out.append(TargetRecord(
                variable="real_estate_taxes",
                geo_level="state",
                geographic_id=fips,
                period=PERIOD,
                value=value,
                is_count=False,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=f"row-{i + 2}",
                notes="ACS — real estate taxes by state ($, scaled ×1e9 from billions)",
            ))
    return out
