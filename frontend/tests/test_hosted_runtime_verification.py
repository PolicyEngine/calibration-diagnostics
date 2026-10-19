"""The Modal image's build-time verification passes under the pinned .py."""

import json
import os
import subprocess
import sys
from pathlib import Path

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


def test_image_build_verification_binds_current_spm_measurement_apis():
    completed = run_image_build_verification()
    assert completed.returncode == 0, completed.stderr[-4000:]
    receipt = json.loads(completed.stdout)
    assert receipt["source_api_imports"] == "passed"
    assert receipt["runtime"]["packages"]["policyengine"] == "6.4.1"
    measurement = receipt["spm_measurement"]
    assert measurement["data_year"] == 2024
    assert len(measurement["forecast_sha256"]) == 64
    assert measurement["national_reference_threshold"] > 0
    assert measurement["dataset_source_inputs"] == ["is_spm_independent_minor_role"]
