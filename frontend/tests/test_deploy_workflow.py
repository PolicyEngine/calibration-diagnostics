"""The production release preserves backend-first deployment ordering."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def _workflow():
    return yaml.load(
        (ROOT / ".github/workflows/deploy.yml").read_text(),
        Loader=yaml.BaseLoader,
    )


def test_deployment_waits_for_successful_main_ci():
    workflow = _workflow()
    assert workflow["on"] == {
        "workflow_run": {"workflows": ["CI"], "types": ["completed"]}
    }
    condition = workflow["jobs"]["deploy"]["if"]
    assert "conclusion == 'success'" in condition
    assert "event == 'push'" in condition
    assert "head_branch == 'main'" in condition


def test_deployment_uses_exact_project_and_backend_first_order():
    workflow = _workflow()
    assert workflow["jobs"]["deploy"]["environment"] == "Production"
    assert workflow["env"]["VERCEL_ORG_ID"] == "team_xsyTmFLMLGbHH7Qxu70R5G4r"
    assert workflow["env"]["VERCEL_PROJECT_ID"] == "prj_pL7dIJJ3M4hGcKr5pttWaOACVFtu"
    steps = workflow["jobs"]["deploy"]["steps"]
    names = [step.get("name") for step in steps]
    assert names.index("Deploy Modal backend") < names.index(
        "Build unaliased Vercel production candidate"
    )
    assert names.index("Run staged national and state calculations") < names.index(
        "Promote verified Vercel deployment"
    )
    frontend = next(
        step
        for step in steps
        if step.get("name") == "Build unaliased Vercel production candidate"
    )
    script = (ROOT / ".github/scripts/deploy-dashboard.sh").read_text()
    assert frontend["run"] == "bash .github/scripts/deploy-dashboard.sh deploy-frontend"
    assert "--skip-domain" in script
    assert '--project "$VERCEL_PROJECT_ID"' in script
    assert "--cwd frontend" not in script
    assert "MICROCOSM_TELEMETRY_COLLECTOR_URL" in frontend["env"]
    assert '--env "MICROCOSM_TELEMETRY_COLLECTOR_URL=' in script


def test_dashboard_checks_read_secret_metadata_before_deployment():
    job = _workflow()["jobs"]["deploy"]
    assert job["permissions"]["id-token"] == "write"
    steps = job["steps"]
    check_index = next(
        i
        for i, step in enumerate(steps)
        if step.get("name") == "Check collector read secret exists"
    )
    check = steps[check_index]
    assert (
        check["run"]
        == 'bash telemetry-service/scripts/check-secrets-exist.sh "$READ_SECRET_NAME"'
    )
    assert check["env"]["PROJECT_ID"] == "${{ vars.TELEMETRY_GCP_PROJECT_ID }}"
    assert check["env"]["READ_SECRET_NAME"] == "${{ vars.TELEMETRY_READ_SECRET_NAME }}"
    assert any(
        step.get("uses") == "google-github-actions/auth@v2"
        for step in steps[:check_index]
    )
    deploy_index = next(
        i for i, step in enumerate(steps) if step.get("name") == "Deploy Modal backend"
    )
    assert check_index < deploy_index


def test_vercel_disables_only_automatic_main_deployment():
    config = json.loads((ROOT / "frontend/vercel.json").read_text())
    assert config["git"]["deploymentEnabled"] == {"main": False}
