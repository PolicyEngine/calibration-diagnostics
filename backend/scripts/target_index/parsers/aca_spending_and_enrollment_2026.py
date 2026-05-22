"""Parser for storage/calibration_targets/aca_spending_and_enrollment_2026.csv.

Identical schema/semantics to the 2024 file, with period=2026.
"""

from __future__ import annotations

import csv
from pathlib import Path

from backend.scripts.target_index.schema import TargetRecord


SOURCE_PATH = "storage/calibration_targets/aca_spending_and_enrollment_2026.csv"
PERIOD = 2026

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
            state = row["state"].strip().upper()
            gid = STATE_CODE_TO_FIPS.get(state)
            if gid is None:
                continue
            enrollment = float(row["enrollment"])
            spending = float(row["spending"])
            row_key = f"row-{i + 2}"

            out.append(TargetRecord(
                variable="tax_unit_count",
                geo_level="state",
                geographic_id=gid,
                period=PERIOD,
                constraints=(
                    ("aca_ptc", ">", "0"),
                    ("tax_unit_is_filer", "==", "1"),
                ),
                value=enrollment,
                is_count=True,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=row_key,
                notes="ACA marketplace enrollment (PTC recipients), 2026",
            ))
            out.append(TargetRecord(
                variable="aca_ptc",
                geo_level="state",
                geographic_id=gid,
                period=PERIOD,
                constraints=(("tax_unit_is_filer", "==", "1"),),
                value=spending,
                is_count=False,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=row_key,
                notes="ACA PTC spending ($), 2026",
            ))
    return out
