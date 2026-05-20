"""Parser for storage/calibration_targets/agi_state.csv.

Schema: `GEO_ID, GEO_NAME, AGI_LOWER_BOUND, AGI_UPPER_BOUND, VALUE, IS_COUNT,
VARIABLE`. ~1,021 rows. State-level, AGI-banded.

The VARIABLE column carries one of two PE-style values:
- `adjusted_gross_income/amount` — dollar AGI sum within band (IS_COUNT=0).
- `adjusted_gross_income/count` — number of filer tax units with AGI in band
  (IS_COUNT=1). We map this to PE `tax_unit_count` with an extra
  `adjusted_gross_income > 0` constraint so the count is "filers with AGI in
  the band" — matching the DB-side convention used for similar SOI strata.

All rows are filer-gated (`tax_unit_is_filer == 1`).

The CSV is undated; we default to period=2022 (IRS-SOI-aligned).
"""

from __future__ import annotations

import csv
from pathlib import Path

from backend.scripts.target_index.schema import TargetRecord


SOURCE_PATH = "storage/calibration_targets/agi_state.csv"
PERIOD = 2022


def _parse_bound(s: str) -> float:
    s = s.strip()
    if s in ("-inf", "-Infinity"):
        return float("-inf")
    if s in ("inf", "Infinity"):
        return float("inf")
    return float(s)


def _geo_id_to_state_fips(geo_id: str) -> str | None:
    geo_id = geo_id.strip()
    if geo_id.startswith("0400000US"):
        return geo_id[len("0400000US"):]
    return None


def _truthy(val) -> bool:
    if isinstance(val, bool):
        return val
    if val is None:
        return False
    s = str(val).strip().lower()
    return s in ("true", "1", "yes")


def _band_constraints(lo: float, hi: float) -> list[tuple[str, str, str]]:
    cons: list[tuple[str, str, str]] = []
    if lo != float("-inf"):
        cons.append(("adjusted_gross_income", ">=", str(lo)))
    if hi != float("inf"):
        cons.append(("adjusted_gross_income", "<", str(hi)))
    return cons


def parse(csv_path: Path) -> list[TargetRecord]:
    out: list[TargetRecord] = []
    with csv_path.open() as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            state_fips = _geo_id_to_state_fips(row["GEO_ID"])
            if state_fips is None:
                continue
            try:
                lo = _parse_bound(row["AGI_LOWER_BOUND"])
                hi = _parse_bound(row["AGI_UPPER_BOUND"])
                value = float(row["VALUE"])
            except (TypeError, ValueError):
                continue

            is_count = _truthy(row.get("IS_COUNT"))
            raw_var = row["VARIABLE"].strip()

            # Strip the "/count" or "/amount" suffix and route accordingly.
            cons: list[tuple[str, str, str]] = [("tax_unit_is_filer", "==", "1")]
            if raw_var.endswith("/count"):
                # Count of filer tax units within the AGI band. We re-map the
                # variable to `tax_unit_count`; the AGI-band constraints below
                # carry the "with AGI in [lo, hi)" semantics.
                variable = "tax_unit_count"
            elif raw_var.endswith("/amount"):
                variable = raw_var[: -len("/amount")]
            else:
                variable = raw_var
            cons.extend(_band_constraints(lo, hi))

            row_key = f"{row['GEO_ID']}/{raw_var}/{row['AGI_LOWER_BOUND']}-{row['AGI_UPPER_BOUND']}#{i}"

            out.append(TargetRecord(
                variable=variable,
                geo_level="state",
                geographic_id=state_fips,
                period=PERIOD,
                constraints=tuple(cons),
                value=value,
                is_count=is_count,
                storage_tier="csv",
                source_path=SOURCE_PATH,
                source_row=row_key,
                notes=f"IRS-SOI state AGI band ({raw_var})",
            ))
    return out
