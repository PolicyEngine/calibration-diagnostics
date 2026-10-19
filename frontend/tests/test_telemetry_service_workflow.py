"""PolicyEngine/microcosm-collector deploys the collector; this repo no longer does.

`.github/workflows/telemetry-service.yml` still validates pull requests that
change `telemetry-service/`, and keeps one manual redeploy from `main` for
rolling the deploy-source switch back. That redeploy runs only when the person
dispatching it confirms that microcosm-collector's deployment is switched off,
so the two repos never deploy the same Cloud Run service at the same time.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_PATH = ROOT / ".github/workflows/telemetry-service.yml"
DEPLOY_JOBS = ("deploy-staging", "deploy-production")
CONFIRMATION_INPUT = "collector_deploy_disabled"
CONFIRMED_MANUAL_DISPATCH_ON_MAIN = (
    "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'"
    f" && inputs.{CONFIRMATION_INPUT}"
)
UNCONFIRMED_MANUAL_DISPATCH = (
    f"github.event_name == 'workflow_dispatch' && !inputs.{CONFIRMATION_INPUT}"
)
CONFIRMATION_JOB = "require-collector-deploy-disabled"


def load_workflow() -> dict:
    # BaseLoader keeps YAML's `on` key a string, as GitHub's parser does.
    return yaml.load(WORKFLOW_PATH.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)


def test_service_workflow_does_not_run_on_push() -> None:
    workflow = load_workflow()

    assert set(workflow["on"]) == {"pull_request", "workflow_dispatch"}


def test_pull_requests_that_change_the_service_are_still_validated() -> None:
    workflow = load_workflow()

    assert workflow["on"]["pull_request"]["paths"] == [
        "telemetry-service/**",
        ".github/workflows/telemetry-service.yml",
    ]
    assert "if" not in workflow["jobs"]["validate"]


def test_manual_dispatch_requires_confirming_the_collector_deploy_is_off() -> None:
    dispatch = load_workflow()["on"]["workflow_dispatch"]
    confirmation = dispatch["inputs"][CONFIRMATION_INPUT]

    assert confirmation["type"] == "boolean"
    assert confirmation["required"] == "true"
    assert confirmation["default"] == "false"
    assert "COLLECTOR_DEPLOY_ENABLED" in confirmation["description"]
    assert "PolicyEngine/microcosm-collector" in confirmation["description"]


def test_deployment_runs_only_from_a_confirmed_manual_dispatch_on_main() -> None:
    jobs = load_workflow()["jobs"]

    for job_name in DEPLOY_JOBS:
        assert jobs[job_name]["if"] == CONFIRMED_MANUAL_DISPATCH_ON_MAIN, job_name
    assert jobs["deploy-staging"]["needs"] == "validate"
    assert jobs["deploy-production"]["needs"] == "deploy-staging"
    oidc_jobs = {
        job_name
        for job_name, job in jobs.items()
        if job.get("permissions", {}).get("id-token") == "write"
    }
    assert oidc_jobs == set(DEPLOY_JOBS)


def test_unconfirmed_manual_dispatch_fails_instead_of_skipping_deployment() -> None:
    job = load_workflow()["jobs"][CONFIRMATION_JOB]

    assert job["if"] == UNCONFIRMED_MANUAL_DISPATCH
    assert "permissions" not in job
    assert "environment" not in job
    [step] = job["steps"]
    result = subprocess.run(
        ["bash", "-e", "-c", step["run"]],
        env={"PATH": os.environ["PATH"]},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert "COLLECTOR_DEPLOY_ENABLED" in result.stdout + result.stderr
    assert "PolicyEngine/microcosm-collector" in result.stdout + result.stderr
