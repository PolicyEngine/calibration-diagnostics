"""Parser for storage/calibration_targets/eitc_by_agi_and_children.csv.

IRS SOI Publication 1304 Table 2.5, TY2022. EITC broken down by AGI band ×
qualifying-child count. First line is a `#`-prefixed citation; header is
`count_children,agi_lower,agi_upper,returns,amount`.

`count_children=3` means "three or more" — so we emit `eitc_child_count >= 3`
in that case, otherwise an exact `== <n>` match.

Each row yields TWO national-level targets:
- `tax_unit_count` (count, constrained by `eitc > 0`).
- `eitc` dollar amount.
"""

from __future__ import annotations

import csv
from pathlib import Path

from backend.scripts.target_index.schema import TargetRecord


SOURCE_PATH = "storage/calibration_targets/eitc_by_agi_and_children.csv"
PERIOD = 2022


def _parse_bound(s: str) -> float:
    s = s.strip()
    if s in ("-inf", "-Infinity"):
        return float("-inf")
    if s in ("inf", "Infinity"):
        return float("inf")
    return float(s)


def _uncommented(lines):
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        yield line


def _base_constraints(count_children: int, lo: float, hi: float) -> list[tuple[str, str, str]]:
    cons: list[tuple[str, str, str]] = [
        ("tax_unit_is_filer", "==", "1"),
        ("eitc", ">", "0"),
    ]
    # count_children=3 in the source means "three or more".
    if count_children >= 3:
        cons.append(("eitc_child_count", ">=", "3"))
    else:
        cons.append(("eitc_child_count", "==", str(count_children)))
    if lo != float("-inf"):
        cons.append(("adjusted_gross_income", ">=", str(lo)))
    if hi != float("inf"):
        cons.append(("adjusted_gross_income", "<", str(hi)))
    return cons


def parse(csv_path: Path) -> list[TargetRecord]:
    out: list[TargetRecord] = []
    with csv_path.open() as f:
        reader = csv.DictReader(_uncommented(f))
        for i, row in enumerate(reader):
            try:
                count_children = int(row["count_children"])
                lo = _parse_bound(row["agi_lower"])
                hi = _parse_bound(row["agi_upper"])
                returns = float(row["returns"])
                amount = float(row["amount"])
            except (TypeError, ValueError):
                continue

            cons = tuple(_base_constraints(count_children, lo, hi))
            row_key = f"c{count_children}/{row['agi_lower']}-{row['agi_upper']}#{i}"

            out.append(TargetRecord(
                variable="tax_unit_count",
                geo_level="national",
                geographic_id=None,
                period=PERIOD,
                constraints=cons,
                value=returns,
                is_count=True,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=row_key,
                notes="IRS SOI Pub 1304 Table 2.5 (TY2022) — EITC returns by AGI×kids",
            ))
            out.append(TargetRecord(
                variable="eitc",
                geo_level="national",
                geographic_id=None,
                period=PERIOD,
                constraints=cons,
                value=amount,
                is_count=False,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=row_key,
                notes="IRS SOI Pub 1304 Table 2.5 (TY2022) — EITC amount by AGI×kids",
            ))
    return out
