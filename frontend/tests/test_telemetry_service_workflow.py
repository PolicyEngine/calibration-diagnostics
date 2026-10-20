"""PolicyEngine/microcosm-collector deploys the collector; this repo no longer does.

`.github/workflows/telemetry-service.yml` still validates pull requests that
change `telemetry-service/`, and keeps one manual redeploy from `main` for
rolling the deploy-source switch back. Every dispatch first runs a job that
fails unless the dispatch is from `main`, the person dispatching it confirms
that microcosm-collector's deployment is switched off, and no
microcosm-collector Push run is queued or in progress. So the two repos never
deploy the same Cloud Run service at the same time, and a refused dispatch is
a failed run rather than a green run whose deployment jobs were skipped.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_PATH = ROOT / ".github/workflows/telemetry-service.yml"
DEPLOY_JOBS = ("deploy-staging", "deploy-production")
CONFIRMATION_INPUT = "collector_deploy_disabled"
CONFIRMED_MANUAL_DISPATCH_ON_MAIN = (
    "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'"
    f" && inputs.{CONFIRMATION_INPUT}"
)
MANUAL_DISPATCH = "github.event_name == 'workflow_dispatch'"
UNCONFIRMED_OR_NOT_FROM_MAIN = (
    f"github.ref != 'refs/heads/main' || !inputs.{CONFIRMATION_INPUT}"
)
CONFIRMATION_JOB = "require-collector-deploy-disabled"
COLLECTOR_PUSH_RUNS_ENDPOINT = (
    "repos/PolicyEngine/microcosm-collector/actions/workflows/push.yaml/runs"
    "?per_page=100"
)
COLLECTOR_RUN_URL = "https://github.com/PolicyEngine/microcosm-collector/actions/runs"


def load_workflow() -> dict:
    # BaseLoader keeps YAML's `on` key a string, as GitHub's parser does.
    return yaml.load(WORKFLOW_PATH.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)


def confirmation_steps() -> tuple[dict, dict]:
    refusal_step, checkout_step, push_run_step = load_workflow()["jobs"][
        CONFIRMATION_JOB
    ]["steps"]
    assert checkout_step["uses"] == "actions/checkout@v4"
    return refusal_step, push_run_step


def run_step_script(
    step: dict, environment: dict[str, str]
) -> subprocess.CompletedProcess:
    # GitHub runs a `run:` step without an explicit shell as `bash -e {0}`,
    # from the repository root.
    return subprocess.run(
        ["bash", "-e", "-c", step["run"]],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


def collector_push_runs_response(*run_statuses: str) -> str:
    return json.dumps(
        {
            "total_count": len(run_statuses),
            "workflow_runs": [
                {
                    "id": 1000 + run_index,
                    "status": run_status,
                    "html_url": f"{COLLECTOR_RUN_URL}/{1000 + run_index}",
                }
                for run_index, run_status in enumerate(run_statuses)
            ],
        }
    )


def install_gh_stub(stub_directory: Path, response: str, exit_code: int = 0) -> Path:
    """Put a `gh` on PATH that records its arguments and prints `response`."""
    recorded_call = stub_directory / "gh-call.json"
    stub = stub_directory / "gh"
    stub.write_text(
        "#!/usr/bin/env python3\n"
        "import json, os, sys\n"
        f"with open({str(recorded_call)!r}, 'w') as recorded:\n"
        "    json.dump({'arguments': sys.argv[1:],"
        " 'token': os.environ.get('GH_TOKEN')}, recorded)\n"
        f"sys.stdout.write({response!r})\n"
        f"sys.exit({exit_code})\n",
        encoding="utf-8",
    )
    stub.chmod(0o755)
    return recorded_call


def stubbed_environment(stub_directory: Path) -> dict[str, str]:
    return {
        "PATH": f"{stub_directory}{os.pathsep}{os.environ['PATH']}",
        "GH_TOKEN": "test-github-token",
    }


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
    assert jobs["deploy-staging"]["needs"] == ["validate", CONFIRMATION_JOB]
    assert jobs["deploy-production"]["needs"] == "deploy-staging"
    oidc_jobs = {
        job_name
        for job_name, job in jobs.items()
        if job.get("permissions", {}).get("id-token") == "write"
    }
    assert oidc_jobs == set(DEPLOY_JOBS)


def test_every_manual_dispatch_runs_the_confirmation_job_without_credentials() -> None:
    job = load_workflow()["jobs"][CONFIRMATION_JOB]

    assert job["if"] == MANUAL_DISPATCH
    assert "permissions" not in job
    assert "environment" not in job


def test_dispatch_unconfirmed_or_from_another_branch_fails_without_deploying() -> None:
    refusal_step, push_run_step = confirmation_steps()

    assert refusal_step["if"] == UNCONFIRMED_OR_NOT_FROM_MAIN
    # The Push run check runs only if the refusal step was skipped.
    assert "if" not in push_run_step
    result = run_step_script(refusal_step, {"PATH": os.environ["PATH"]})
    assert result.returncode != 0
    output = result.stdout + result.stderr
    assert "Nothing was deployed" in output
    assert "main" in output
    assert "COLLECTOR_DEPLOY_ENABLED" in output
    assert "PolicyEngine/microcosm-collector" in output


@pytest.mark.parametrize("unfinished_status", ["queued", "in_progress", "waiting"])
def test_confirmed_dispatch_fails_while_a_collector_push_run_is_unfinished(
    tmp_path: Path, unfinished_status: str
) -> None:
    _, push_run_step = confirmation_steps()
    recorded_call = install_gh_stub(
        tmp_path, collector_push_runs_response("completed", unfinished_status)
    )

    result = run_step_script(push_run_step, stubbed_environment(tmp_path))

    assert result.returncode != 0
    output = result.stdout + result.stderr
    assert "Nothing was deployed" in output
    assert f"{COLLECTOR_RUN_URL}/1001" in output
    assert f"{COLLECTOR_RUN_URL}/1000" not in output
    assert json.loads(recorded_call.read_text(encoding="utf-8")) == {
        "arguments": ["api", COLLECTOR_PUSH_RUNS_ENDPOINT],
        "token": "test-github-token",
    }


def test_confirmed_dispatch_continues_when_every_collector_push_run_is_finished(
    tmp_path: Path,
) -> None:
    _, push_run_step = confirmation_steps()
    install_gh_stub(tmp_path, collector_push_runs_response("completed", "completed"))

    result = run_step_script(push_run_step, stubbed_environment(tmp_path))

    assert result.returncode == 0, result.stdout + result.stderr


def test_confirmed_dispatch_fails_when_the_collector_push_runs_cannot_be_listed(
    tmp_path: Path,
) -> None:
    _, push_run_step = confirmation_steps()
    install_gh_stub(tmp_path, "", exit_code=1)

    result = run_step_script(push_run_step, stubbed_environment(tmp_path))

    assert result.returncode != 0


def test_push_run_check_uses_the_workflow_token_for_a_public_api_read() -> None:
    _, push_run_step = confirmation_steps()

    assert push_run_step["env"] == {"GH_TOKEN": "${{ github.token }}"}
