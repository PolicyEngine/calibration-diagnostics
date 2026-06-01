"""Tests for published H5 bundle discovery."""

from unittest.mock import patch

from backend.services import bundle_availability


def test_current_staging_bundles_are_top_level_only():
    files = [
        "staging/calibration/policy_data.db",
        "staging/calibration/source_imputed_stratified_extended_cps.h5",
        "staging/states/WY.h5",
        "staging/districts/WY-01.h5",
        "staging/national/US.h5",
        "staging/cities/NYC.h5",
        "staging/1.115.5-patch-usdata-gha26360067320-a1/enhanced_cps_2024.h5",
    ]

    bundle_availability._CACHE.clear()
    with patch("huggingface_hub.HfApi") as MockApi:
        MockApi.return_value.list_repo_files.return_value = files
        bundles = bundle_availability.published_bundles(
            "PolicyEngine/test",
            "staging",
        )

    assert bundles == frozenset({
        "source_imputed_stratified_extended_cps.h5",
        "states/WY.h5",
        "districts/WY-01.h5",
        "national/US.h5",
        "cities/NYC.h5",
    })
