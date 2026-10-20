"""The deployment requires and supplies its private-release credential."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / ".github/scripts/deploy-dashboard.sh"
CONFIGURATION = (
    "MODAL_TOKEN_ID",
    "MODAL_TOKEN_SECRET",
    "MICROCOSM_MODAL_KEY",
    "MICROCOSM_MODAL_SECRET",
    "MICROCOSM_TELEMETRY_COLLECTOR_URL",
    "VERCEL_TOKEN",
    "VERCEL_AUTOMATION_BYPASS_SECRET",
    "HF_RELEASE_READ_TOKEN",
)


def _environment():
    return {**os.environ, **{name: f"test-{name}" for name in CONFIGURATION}}


def test_missing_release_credential_stops_deployment_without_printing_secrets():
    environment = _environment()
    environment.pop("HF_RELEASE_READ_TOKEN")
    environment["HF_TOKEN"] = "test-publisher-token"
    result = subprocess.run(
        ["bash", str(SCRIPT), "require-configuration"],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert "HF_RELEASE_READ_TOKEN" in result.stderr
    assert "test-" not in result.stdout + result.stderr


def test_complete_configuration_passes():
    result = subprocess.run(
        ["bash", str(SCRIPT), "require-configuration"],
        env=_environment(),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0


def test_frontend_receives_release_token_as_server_environment(tmp_path):
    arguments_file = tmp_path / "arguments.json"
    stub = tmp_path / "bunx"
    stub.write_text(
        "#!/usr/bin/env python3\n"
        "import json, os, sys\n"
        "from pathlib import Path\n"
        "Path(os.environ['ARGUMENTS_FILE']).write_text(json.dumps(sys.argv[1:]))\n"
        "print('https://candidate.vercel.app')\n"
    )
    stub.chmod(0o755)
    environment = {
        **_environment(),
        "PATH": f"{tmp_path}:{os.environ['PATH']}",
        "ARGUMENTS_FILE": str(arguments_file),
        "GITHUB_OUTPUT": str(tmp_path / "output"),
        "VERCEL_CLI_VERSION": "58.8.0",
        "VERCEL_PROJECT_ID": "test-project",
        "MICROCOSM_CALCULATION_URL": "https://test.modal.run",
        "MICROCOSM_BACKEND_SOURCE_COMMIT": "test-commit",
    }
    result = subprocess.run(
        ["bash", str(SCRIPT), "deploy-frontend"],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    arguments = json.loads(arguments_file.read_text())
    token_argument = "HF_TOKEN=test-HF_RELEASE_READ_TOKEN"
    assert token_argument in arguments
    assert arguments[arguments.index(token_argument) - 1] == "--env"
    assert not any("NEXT_PUBLIC_HF" in argument for argument in arguments)
    assert "test-HF_RELEASE_READ_TOKEN" not in result.stdout + result.stderr


READ_SECRET_METADATA_CALL = [
    "secrets",
    "describe",
    "test-read-secret",
    "--project",
    "test-project",
    "--format=none",
]


def _read_secret_check(tmp_path, gcloud_exit_code=0, **configuration):
    """Run check-read-secret-exists with a gcloud that records every call.

    Returns the script's result and the arguments of each gcloud call, in order.
    """
    calls_file = tmp_path / "gcloud-calls.jsonl"
    stub = tmp_path / "gcloud"
    stub.write_text(
        "#!/usr/bin/env python3\n"
        "import json, os, sys\n"
        "with open(os.environ['GCLOUD_CALLS_FILE'], 'a') as calls:\n"
        "    calls.write(json.dumps(sys.argv[1:]) + '\\n')\n"
        f"sys.exit({gcloud_exit_code})\n"
    )
    stub.chmod(0o755)
    environment = {
        "PATH": f"{tmp_path}:{os.environ['PATH']}",
        "GCLOUD_CALLS_FILE": str(calls_file),
        **configuration,
    }
    result = subprocess.run(
        ["bash", str(SCRIPT), "check-read-secret-exists"],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    gcloud_calls = (
        [json.loads(call) for call in calls_file.read_text().splitlines()]
        if calls_file.exists()
        else []
    )
    return result, gcloud_calls


def test_read_secret_check_reads_only_the_secret_metadata(tmp_path):
    result, gcloud_calls = _read_secret_check(
        tmp_path, PROJECT_ID="test-project", READ_SECRET_NAME="test-read-secret"
    )
    assert result.returncode == 0
    # Every call is recorded, so any other call, such as one that reads the
    # secret's value with `gcloud secrets versions access`, fails this test.
    assert gcloud_calls == [READ_SECRET_METADATA_CALL]


def test_missing_read_secret_stops_deployment(tmp_path):
    result, gcloud_calls = _read_secret_check(
        tmp_path,
        gcloud_exit_code=1,
        PROJECT_ID="test-project",
        READ_SECRET_NAME="test-read-secret",
    )
    assert result.returncode != 0
    assert "test-read-secret" in result.stderr
    assert gcloud_calls == [READ_SECRET_METADATA_CALL]


@pytest.mark.parametrize("missing_name", ["PROJECT_ID", "READ_SECRET_NAME"])
def test_read_secret_check_requires_its_configuration(tmp_path, missing_name):
    configuration = {"PROJECT_ID": "test-project", "READ_SECRET_NAME": "test-secret"}
    configuration.pop(missing_name)
    result, gcloud_calls = _read_secret_check(tmp_path, **configuration)
    assert result.returncode != 0
    assert missing_name in result.stderr
    assert gcloud_calls == []
