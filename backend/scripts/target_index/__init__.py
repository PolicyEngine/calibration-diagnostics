"""Audit of all 5 target storage tiers in policyengine_us_data.

Targets live in five distinct places, and policy_data.db (what the dashboard
reads today) is only the compiled output of a subset:

1. storage/calibration_targets/*.csv     hand-edited canonical source values
2. storage/calibration_targets/*.py      programmatic generators (aca_ptc_targets.py)
3. utils/*.py                            hard-coded constants (cms_medicare, takeup, ...)
4. calibration/target_config.yaml        opt-in rules (no values, just inclusion logic)
5. policy_data.db                        the compiled DB shipped on HF

This module produces backend/data/target_index.json — the cross-tier union with
provenance per target — and an audit report comparing each tier against tier 5.
"""
