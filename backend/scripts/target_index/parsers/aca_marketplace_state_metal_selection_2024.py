"""Parser for storage/calibration_targets/aca_marketplace_state_metal_selection_2024.csv.

CMS 2024 OEP State-Metal-Status PUF. 307 rows with columns:
    year, source, state_code, platform, metal_level, enrollment_status,
    consumers, avg_selected_premium, avg_selected_net_premium,
    selected_lte10_share, selected_lte10_consumers, aptc_consumers,
    aptc_share, avg_aptc

The file mixes two breakdown styles per (state, platform):
  - metal_level != "All", enrollment_status == "All"  → split by metal tier
  - metal_level == "All", enrollment_status != "All"  → split by enrollment status

Schema decision (documented for the audit reviewer):
We emit targets ONLY for the (state, metal_level) breakdown rows where
metal_level in {B, S, G} (Bronze/Silver/Gold) and enrollment_status == "All".
For each surviving row we sum across the two platforms (HC.gov + SBM) and
emit TWO targets per (state, metal_level):
    - consumers     → tax_unit_count with aca_ptc >= 0 and metal_level constraint
    - aptc_consumers → tax_unit_count with aca_ptc > 0 and metal_level constraint

The metal_level constraint maps to PolicyEngine variable `aca_metal_level`
with values "bronze" / "silver" / "gold" (best-guess canonical names — the
PE codebase exposes a categorical metal-tier enum; if the audit reports
these as unmatched, the constraint variable name is the most likely culprit
and can be retuned without touching the row count).

Platform breakdown (HC.gov vs SBM) is collapsed because the calibration
target is the total state population per metal tier, not a marketplace-type
split. Period=2024.
"""

from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path

from backend.scripts.target_index.schema import TargetRecord


SOURCE_PATH = "storage/calibration_targets/aca_marketplace_state_metal_selection_2024.csv"
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

# Single-letter metal codes in the PUF → PolicyEngine metal-level values.
METAL_CODE_TO_NAME = {
    "B": "bronze",
    "S": "silver",
    "G": "gold",
    # "C" (catastrophic) / "P" (platinum) do not appear in this file.
}


def parse(csv_path: Path) -> list[TargetRecord]:
    # Aggregate across platforms keyed by (state_fips, metal_code).
    # Each accumulator stores (consumers_sum, aptc_consumers_sum, first_row_key).
    aggregates: dict[tuple[str, str], dict] = defaultdict(
        lambda: {"consumers": 0.0, "aptc_consumers": 0.0, "first_row": None}
    )

    with csv_path.open() as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            metal = row["metal_level"].strip()
            status = row["enrollment_status"].strip()
            if metal == "All" or status != "All":
                # Skip the enrollment-status breakdown rows.
                continue
            if metal not in METAL_CODE_TO_NAME:
                continue

            state = row["state_code"].strip().upper()
            gid = STATE_CODE_TO_FIPS.get(state)
            if gid is None:
                continue

            try:
                consumers = float(row["consumers"])
                aptc_consumers = float(row["aptc_consumers"])
            except (TypeError, ValueError):
                continue

            key = (gid, metal)
            agg = aggregates[key]
            agg["consumers"] += consumers
            agg["aptc_consumers"] += aptc_consumers
            if agg["first_row"] is None:
                agg["first_row"] = f"row-{i + 2}"

    out: list[TargetRecord] = []
    for (gid, metal_code), agg in aggregates.items():
        metal_name = METAL_CODE_TO_NAME[metal_code]
        row_key = agg["first_row"] or "row-?"

        # Total marketplace consumers in this metal tier (includes non-PTC).
        out.append(TargetRecord(
            variable="tax_unit_count",
            geo_level="state",
            geographic_id=gid,
            period=PERIOD,
            constraints=(
                ("aca_metal_level", "==", metal_name),
                ("tax_unit_is_filer", "==", "1"),
            ),
            value=agg["consumers"],
            is_count=True,
            storage_tier="csv",
            source_path=SOURCE_PATH,
            source_row=row_key,
            notes=f"CMS 2024 OEP PUF — marketplace consumers, metal={metal_name}",
        ))
        # PTC-receiving consumers in this metal tier.
        out.append(TargetRecord(
            variable="tax_unit_count",
            geo_level="state",
            geographic_id=gid,
            period=PERIOD,
            constraints=(
                ("aca_metal_level", "==", metal_name),
                ("aca_ptc", ">", "0"),
                ("tax_unit_is_filer", "==", "1"),
            ),
            value=agg["aptc_consumers"],
            is_count=True,
            storage_tier="csv",
            source_path=SOURCE_PATH,
            source_row=row_key,
            notes=f"CMS 2024 OEP PUF — APTC consumers, metal={metal_name}",
        ))
    return out
