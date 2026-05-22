"""Tier 3 reader: hand-coded target constants in policyengine_us_data.utils.

Returns TargetRecords for the dicts the calibration team maintains as
Python literals (not CSVs). Today these cover Medicare (4 dicts) and a
post-calibration ACA take-up target.
"""

from __future__ import annotations

from pathlib import Path

from backend.scripts.target_index.schema import TargetRecord


def collect() -> list[TargetRecord]:
    out: list[TargetRecord] = []

    # --- Medicare (utils/cms_medicare.py) ----------------------------------
    try:
        from policyengine_us_data.utils import cms_medicare as cms
    except ImportError:
        cms = None
    if cms is not None:
        src = "utils/cms_medicare.py"

        for year, value in cms.MEDICARE_PART_B_GROSS_PREMIUM_INCOME.items():
            out.append(TargetRecord(
                variable="medicare_part_b",   # gross premium dollars
                geo_level="national",
                period=year,
                value=float(value),
                is_count=False,
                storage_tier="python",
                source_path=src,
                source_row="MEDICARE_PART_B_GROSS_PREMIUM_INCOME",
                notes="CMS Medicare Trustees Report — gross Part B premium income",
            ))

        for year, value in cms.MEDICARE_ENROLLMENT_TARGETS.items():
            out.append(TargetRecord(
                variable="person_count",
                geo_level="national",
                period=year,
                constraints=(("medicare_enrolled", "==", "1"),),
                value=float(value),
                is_count=True,
                storage_tier="python",
                source_path=src,
                source_row="MEDICARE_ENROLLMENT_TARGETS",
                notes="CMS Medicare Trustees Report Table V.B3 — enrollee count",
            ))

        for year, value in cms.MEDICARE_STATE_BUY_IN_MINIMUM_BENEFICIARIES.items():
            out.append(TargetRecord(
                variable="person_count",
                geo_level="national",
                period=year,
                constraints=(("state_buy_in_medicare", "==", "1"),),
                value=float(value),
                is_count=True,
                storage_tier="python",
                source_path=src,
                source_row="MEDICARE_STATE_BUY_IN_MINIMUM_BENEFICIARIES",
                notes="CMS state buy-in Medicare beneficiaries minimum",
            ))

        for year, value in cms.BENEFICIARY_PAID_MEDICARE_PART_B_PREMIUM_TARGETS.items():
            out.append(TargetRecord(
                variable="medicare_part_b_premiums",
                geo_level="national",
                period=year,
                value=float(value),
                is_count=False,
                storage_tier="python",
                source_path=src,
                source_row="BENEFICIARY_PAID_MEDICARE_PART_B_PREMIUM_TARGETS",
                notes="CMS — beneficiary-paid Medicare Part B premiums total",
            ))

    # --- ACA post-calibration (utils/takeup.py) ----------------------------
    try:
        from policyengine_us_data.utils import takeup
    except ImportError:
        takeup = None
    if takeup is not None and hasattr(takeup, "ACA_POST_CALIBRATION_PERSON_TARGETS"):
        src = "utils/takeup.py"
        for year, value in takeup.ACA_POST_CALIBRATION_PERSON_TARGETS.items():
            out.append(TargetRecord(
                variable="person_count",
                geo_level="national",
                period=year,
                constraints=(("aca_ptc", ">", "0"),),
                value=float(value),
                is_count=True,
                storage_tier="python",
                source_path=src,
                source_row="ACA_POST_CALIBRATION_PERSON_TARGETS",
                notes="CMS Marketplace OEP — APTC consumers (post-calibration fallback)",
            ))

    return out
