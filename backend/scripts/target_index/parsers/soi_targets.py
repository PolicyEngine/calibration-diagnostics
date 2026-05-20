"""Parser for storage/calibration_targets/soi_targets.csv.

The largest CSV (~11.9k rows). Each row is an IRS Statistics of Income target:
- Year: e.g. 2015, 2018, 2022
- SOI table: e.g. "Table 1.1"
- XLSX column / row: spreadsheet coords (used as part of source_row)
- Variable: PE variable name (adjusted_gross_income, eitc, etc.)
- Filing status: All / Joint / Single / HoH / MFS / SeparateReturns
- AGI lower/upper bound: numeric (with -inf / inf for open-ended)
- Count flag: True → row is a return-count target; False → dollar amount
- Taxable only: filter narrowing the population
- Full population: another filter flag
- Value: the actual target number

These are all national-level (no state breakdown) but heavily constrained
by AGI band + filing status + filer-only restrictions.
"""

from __future__ import annotations

import csv
from pathlib import Path

from backend.scripts.target_index.schema import TargetRecord

SOURCE_PATH = "storage/calibration_targets/soi_targets.csv"


def _parse_bound(s: str) -> float:
    s = s.strip()
    if s in ("-inf", "-Infinity"): return float("-inf")
    if s in ("inf", "Infinity"): return float("inf")
    return float(s)


def _constraints_from_row(row: dict) -> tuple[tuple[str, str, str], ...]:
    """Build the constraint tuple that mirrors how the pipeline strata are
    keyed in policy_data.db. Order matters for canonical signature matching."""
    cons: list[tuple[str, str, str]] = []

    # Filer gating: all SOI targets implicitly assume tax_unit_is_filer == 1
    cons.append(("tax_unit_is_filer", "==", "1"))

    # Filing status (when not "All")
    fs = row["Filing status"].strip()
    if fs and fs.lower() != "all":
        cons.append(("tax_unit_filing_status", "==", fs))

    # AGI band
    lo = _parse_bound(row["AGI lower bound"])
    hi = _parse_bound(row["AGI upper bound"])
    if lo != float("-inf"):
        cons.append(("adjusted_gross_income", ">=", str(lo)))
    if hi != float("inf"):
        cons.append(("adjusted_gross_income", "<", str(hi)))

    # Taxable-only / Full-population flags
    if _truthy(row.get("Taxable only")):
        cons.append(("tax_unit_is_taxable", "==", "1"))
    if _truthy(row.get("Full population")):
        cons.append(("full_population", "==", "1"))

    return tuple(cons)


def _truthy(val) -> bool:
    if isinstance(val, bool): return val
    if val is None: return False
    s = str(val).strip().lower()
    return s in ("true", "1", "yes")


def parse(csv_path: Path) -> list[TargetRecord]:
    out: list[TargetRecord] = []
    with csv_path.open() as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            try:
                year = int(row["Year"])
                value = float(row["Value"])
            except (TypeError, ValueError):
                continue  # malformed row, skip silently — audit will see it missing

            variable = row["Variable"].strip()
            is_count = _truthy(row.get("Count"))

            cons = _constraints_from_row(row)
            row_key = f"{row['SOI table']}/{row['XLSX row']}/{row['XLSX column']}"

            out.append(TargetRecord(
                variable=variable,
                geo_level="national",
                geographic_id=None,
                period=year,
                constraints=cons,
                value=value,
                is_count=is_count,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=row_key,
                notes=f"IRS SOI {row['SOI table']} · filing={row['Filing status']}",
            ))
    return out
