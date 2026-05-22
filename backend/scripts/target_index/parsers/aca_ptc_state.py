"""Parser for storage/calibration_targets/aca_ptc_state.csv.

Schema (after the leading `#`-comment line): GEO_ID, Returns, TotalPTCAmount.
Source: IRS SOI Historical Table 2 (TY2022), columns N85770 / A85770.

Each row produces TWO target records:
- Returns: count of tax units with aca_ptc > 0 (variable=tax_unit_count)
- TotalPTCAmount: dollar amount of aca_ptc

Both are filer-gated (tax_unit_is_filer == 1). State-level via the GEO_ID
`0400000US<fips>` convention (leading zeros stripped to mirror DB ints).

Period defaults to 2022 (the SOI tax year for this file).
"""

from __future__ import annotations

import csv
from pathlib import Path

from backend.scripts.target_index.schema import TargetRecord


SOURCE_PATH = "storage/calibration_targets/aca_ptc_state.csv"
PERIOD = 2022


def _geo_id_to_geo(geo_id: str) -> tuple[str, str | None]:
    """0400000US01 → ('state', '1'). 0100000US → ('national', None)."""
    geo_id = geo_id.strip()
    if geo_id.startswith("0400000US"):
        fips_raw = geo_id[len("0400000US"):]
        return "state", str(int(fips_raw)) if fips_raw.isdigit() else fips_raw
    if geo_id.startswith("0100000US"):
        return "national", None
    return "national", None


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
            geo_level, gid = _geo_id_to_geo(row["GEO_ID"])
            returns = float(row["Returns"])
            amount = float(row["TotalPTCAmount"])
            row_key = f"row-{i + 2}"  # +2 for header + comment + 1-indexed-ish

            # Count of filers receiving PTC
            out.append(TargetRecord(
                variable="tax_unit_count",
                geo_level=geo_level,
                geographic_id=gid,
                period=PERIOD,
                constraints=(
                    ("aca_ptc", ">", "0"),
                    ("tax_unit_is_filer", "==", "1"),
                ),
                value=returns,
                is_count=True,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=row_key,
                notes="IRS SOI Historical Table 2 — PTC returns (N85770)",
            ))
            # Dollar amount of PTC
            out.append(TargetRecord(
                variable="aca_ptc",
                geo_level=geo_level,
                geographic_id=gid,
                period=PERIOD,
                constraints=(("tax_unit_is_filer", "==", "1"),),
                value=amount,
                is_count=False,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=row_key,
                notes="IRS SOI Historical Table 2 — PTC amount (A85770, $)",
            ))
    return out
