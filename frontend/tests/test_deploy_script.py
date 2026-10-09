"""The deployment requires and supplies its private-release credential."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

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
    "HF_TOKEN",
)


def _environment():
    return {**os.environ, **{name: f"test-{name}" for name in CONFIGURATION}}


def test_missing_release_credential_stops_deployment_without_printing_secrets():
    environment = _environment()
    environment.pop("HF_TOKEN")
    result = subprocess.run(
        ["bash", str(SCRIPT), "require-configuration"],
        env=environment,
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "HF_TOKEN" in result.stderr
    assert "test-" not in result.stdout + result.stderr


def test_complete_configuration_passes():
    result = subprocess.run(
        ["bash", str(SCRIPT), "require-configuration"],
        env=_environment(),
        capture_output=True,
        text=True,
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
    )
    assert result.returncode == 0
    arguments = json.loads(arguments_file.read_text())
    token_argument = "HF_TOKEN=test-HF_TOKEN"
    assert token_argument in arguments
    assert arguments[arguments.index(token_argument) - 1] == "--env"
    assert not any("NEXT_PUBLIC_HF" in argument for argument in arguments)
    assert "test-HF_TOKEN" not in result.stdout + result.stderr
