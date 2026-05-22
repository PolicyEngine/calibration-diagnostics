"""Parser for storage/calibration_targets/eitc_claim_controls.csv.

IRS TY2024 EITC claim controls. First line is a `#`-prefixed citation; the
header is `year,GEO_ID,Returns,Amount`. Includes a national-level row
(GEO_ID `0100000US`) alongside the 51 state rows.

Each row yields TWO target records:
- `tax_unit_count` (count) constrained by `eitc > 0` and filer gate.
- `eitc` dollar amount, filer-gated.

Period comes from the `year` column (typically 2024).
"""

from __future__ import annotations

import csv
from pathlib import Path

from backend.scripts.target_index.schema import TargetRecord


SOURCE_PATH = "storage/calibration_targets/eitc_claim_controls.csv"


def _geo_id_to_geo(geo_id: str) -> tuple[str, str | None]:
    geo_id = geo_id.strip()
    if geo_id.startswith("0400000US"):
        return "state", geo_id[len("0400000US"):]
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
            try:
                year = int(row["year"])
                returns = float(row["Returns"])
                amount = float(row["Amount"])
            except (TypeError, ValueError):
                continue
            row_key = f"{row['GEO_ID']}#{year}#{i}"

            out.append(TargetRecord(
                variable="tax_unit_count",
                geo_level=geo_level,
                geographic_id=gid,
                period=year,
                constraints=(
                    ("tax_unit_is_filer", "==", "1"),
                    ("eitc", ">", "0"),
                ),
                value=returns,
                is_count=True,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=row_key,
                notes=f"IRS EITC claim controls TY{year} — returns",
            ))
            out.append(TargetRecord(
                variable="eitc",
                geo_level=geo_level,
                geographic_id=gid,
                period=year,
                constraints=(
                    ("tax_unit_is_filer", "==", "1"),
                ),
                value=amount,
                is_count=False,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=row_key,
                notes=f"IRS EITC claim controls TY{year} — amount",
            ))
    return out
