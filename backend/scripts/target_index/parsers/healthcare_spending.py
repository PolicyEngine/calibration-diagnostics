"""Parser for storage/calibration_targets/healthcare_spending.csv.

Schema (header has the column name `age_10_year_lower_bound` duplicated):
    age_10_year_lower_bound,
    health_insurance_premiums_without_medicare_part_b,
    over_the_counter_health_expenses,
    other_medical_expenses,
    medicare_part_b_premiums,
    age,
    age_10_year_lower_bound

10 rows, one per 10-year age band (0, 10, 20, …, 80).

Each row contributes FOUR national-level $-amount targets (period=2024),
one per dollar variable. The age band is encoded as a pair of constraints
(`age >= lower`, `age < lower + 10`); the top band (80+) drops the upper
bound and uses only `age >= 80`.

We deliberately use csv.reader rather than DictReader because the header
contains a duplicated column name (DictReader would collapse them and we'd
lose the first occurrence).
"""

from __future__ import annotations

import csv
from pathlib import Path

from backend.scripts.target_index.schema import TargetRecord

SOURCE_PATH = "storage/calibration_targets/healthcare_spending.csv"
PERIOD = 2024
BAND_WIDTH = 10
TOP_BAND_LOWER = 80  # 80+ is open-ended; no upper bound applied.

# Column positions in the CSV row (0-indexed).
# Although the header has `age_10_year_lower_bound` in BOTH position 0 and
# position 6, inspection of the data shows column 0 holds the clean integer
# band lower bound (0, 10, 20, …, 80) while column 6 holds an aggregated
# dollar amount (e.g. 1.08e9 for the 80+ band) — *not* the band lower bound.
# We therefore use column 0 as the canonical lower bound. (The spec hint
# suggested the second occurrence; the data overrides the hint here.)
COL_BAND_LOWER = 0
COL_HIP = 1  # health_insurance_premiums_without_medicare_part_b
COL_OTC = 2  # over_the_counter_health_expenses
COL_OTHER = 3  # other_medical_expenses
COL_MEDB = 4  # medicare_part_b_premiums
# COL_AGE = 5 — mean age within band, unused for target construction
# Column 6 is a duplicated header but holds a separate aggregate; unused.

DOLLAR_VARS = [
    ("health_insurance_premiums_without_medicare_part_b", COL_HIP),
    ("over_the_counter_health_expenses", COL_OTC),
    ("other_medical_expenses", COL_OTHER),
    ("medicare_part_b_premiums", COL_MEDB),
]


def _band_constraints(lower: float) -> tuple[tuple[str, str, str], ...]:
    cons: list[tuple[str, str, str]] = [("age", ">=", str(int(lower)))]
    if int(lower) < TOP_BAND_LOWER:
        cons.append(("age", "<", str(int(lower) + BAND_WIDTH)))
    return tuple(cons)


def parse(csv_path: Path) -> list[TargetRecord]:
    out: list[TargetRecord] = []
    with csv_path.open() as f:
        reader = csv.reader(f)
        next(reader, None)  # skip the (duplicate-column) header
        for i, row in enumerate(reader):
            if not row:
                continue
            lower = float(row[COL_BAND_LOWER])
            cons = _band_constraints(lower)
            for var, col in DOLLAR_VARS:
                value = float(row[col])
                out.append(TargetRecord(
                    variable=var,
                    geo_level="national",
                    geographic_id=None,
                    period=PERIOD,
                    constraints=cons,
                    value=value,
                    is_count=False,
                    storage_tier="csv",
                    source_path=SOURCE_PATH,
                    source_row=f"row-{i + 2}/band-{int(lower)}",
                    notes=f"Healthcare spending {PERIOD} · age band {int(lower)}+",
                ))
    return out
