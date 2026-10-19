"""The Modal image's build-time verification passes under the pinned .py."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
VERIFIER = REPOSITORY_ROOT / "frontend" / "scripts" / "verify_hosted_runtime.py"


def run_image_build_verification() -> subprocess.CompletedProcess:
    """Run the command `backend/modal_app.py` runs while building the image."""
    environment = {
        **os.environ,
        "CALIBRATION_REQUIREMENTS": str(REPOSITORY_ROOT / "backend/requirements.txt"),
    }
    return subprocess.run(
        [sys.executable, str(VERIFIER)],
        capture_output=True,
        text=True,
        env=environment,
        cwd=REPOSITORY_ROOT,
        timeout=600,
    )


@pytest.fixture(scope="module")
def image_build_receipt() -> dict:
    completed = run_image_build_verification()
    assert completed.returncode == 0, completed.stderr[-4000:]
    return json.loads(completed.stdout)


def test_image_build_verification_binds_current_spm_measurement_apis(
    image_build_receipt,
):
    receipt = image_build_receipt
    assert receipt["source_api_imports"] == "passed"
    assert receipt["runtime"]["packages"]["policyengine"] == "6.7.5"
    measurement = receipt["spm_measurement"]
    assert measurement["data_year"] == 2024
    assert len(measurement["forecast_sha256"]) == 64
    assert measurement["national_reference_threshold"] > 0
    assert measurement["dataset_source_inputs"] == ["is_spm_independent_minor_role"]


def test_image_build_verification_binds_py_stored_input_renames(
    image_build_receipt,
):
    # Hosted calculations map the reviewed H5's stored `would_claim_wic` onto
    # policyengine-us 2.2.1's `takes_up_wic_if_eligible` through .py.
    renames = image_build_receipt["legacy_input_renames"]
    assert renames["source"] == (
        "policyengine.tax_benefit_models.us.legacy_inputs."
        "apply_legacy_input_renames_to_microsimulation"
    )
    assert renames["pending_for_pinned_model"] == {
        "would_claim_wic": "takes_up_wic_if_eligible"
    }
