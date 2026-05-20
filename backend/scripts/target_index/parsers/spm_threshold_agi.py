"""Parser for storage/calibration_targets/spm_threshold_agi.csv.

Schema: decile, lower_spm_threshold, upper_spm_threshold,
        adjusted_gross_income, count

11 rows (one per SPM-threshold decile; the top row has upper=inf).
Each row → TWO national-level TargetRecords (period=2024 — file is undated):
  * adjusted_gross_income dollar amount
  * tax_unit_count count

The SPM-threshold decile bracket is encoded as constraints on
`spm_unit_spm_threshold` (>= lower, < upper) — except the open-ended top
band, which drops the upper bound.
"""

from __future__ import annotations

import csv
import math
from pathlib import Path

from backend.scripts.target_index.schema import TargetRecord

SOURCE_PATH = "storage/calibration_targets/spm_threshold_agi.csv"
PERIOD = 2024


def _parse_bound(s: str) -> float:
    s = s.strip()
    if s in ("inf", "Infinity"):
        return float("inf")
    if s in ("-inf", "-Infinity"):
        return float("-inf")
    return float(s)


def _bracket_constraints(lower: float, upper: float) -> tuple[tuple[str, str, str], ...]:
    cons: list[tuple[str, str, str]] = []
    if math.isfinite(lower):
        cons.append(("spm_unit_spm_threshold", ">=", str(lower)))
    if math.isfinite(upper):
        cons.append(("spm_unit_spm_threshold", "<", str(upper)))
    return tuple(cons)


def parse(csv_path: Path) -> list[TargetRecord]:
    out: list[TargetRecord] = []
    with csv_path.open() as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            decile = row["decile"].strip()
            lower = _parse_bound(row["lower_spm_threshold"])
            upper = _parse_bound(row["upper_spm_threshold"])
            agi = float(row["adjusted_gross_income"])
            count = float(row["count"])
            cons = _bracket_constraints(lower, upper)
            row_key = f"row-{i + 2}/decile-{decile}"

            out.append(TargetRecord(
                variable="adjusted_gross_income",
                geo_level="national",
                geographic_id=None,
                period=PERIOD,
                constraints=cons,
                value=agi,
                is_count=False,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=row_key,
                notes=f"SPM-threshold decile {decile} · AGI dollar amount",
            ))
            out.append(TargetRecord(
                variable="tax_unit_count",
                geo_level="national",
                geographic_id=None,
                period=PERIOD,
                constraints=cons,
                value=count,
                is_count=True,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=row_key,
                notes=f"SPM-threshold decile {decile} · tax-unit count",
            ))
    return out
