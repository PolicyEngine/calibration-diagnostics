"""The production release preserves backend-first deployment ordering."""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
FRONTEND_INSTALL_COMMAND = "bun install --frozen-lockfile"
# `bun run <script or file>`, `bun test` and `bun <file>` load repository code, which
# resolves packages through frontend/node_modules. `bunx` fetches its own package.
BUN_SCRIPT_COMMAND = re.compile(
    r"(?<![\w-])bun\s+(?:--\S+\s+)*(?:run|test|\S+\.[cm]?[jt]sx?)(?:\s|$)"
)


def _workflow():
    return yaml.load(
        (ROOT / ".github/workflows/deploy.yml").read_text(),
        Loader=yaml.BaseLoader,
    )


def _step_label(step):
    return step.get("name") or step.get("uses") or step.get("run", "").strip()


def _installs_locked_frontend_dependencies(step, job):
    default_directory = job.get("defaults", {}).get("run", {}).get("working-directory")
    directory = step.get("working-directory", default_directory)
    return (
        step.get("run", "").strip() == FRONTEND_INSTALL_COMMAND
        and directory == "frontend"
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


def test_deployment_supplies_private_release_secret_and_checks_views_before_promotion():
    steps = _workflow()["jobs"]["deploy"]["steps"]
    for name in (
        "Require deployment credentials",
        "Build unaliased Vercel production candidate",
    ):
        step = next(step for step in steps if step.get("name") == name)
        assert (
            step["env"]["HF_RELEASE_READ_TOKEN"]
            == "${{ secrets.HF_RELEASE_READ_TOKEN }}"
        )
        assert "HF_TOKEN" not in step["env"]
    names = [step.get("name") for step in steps]
    check_name = "Verify staged calibration releases and staging"
    assert names.index(check_name) < names.index("Promote verified Vercel deployment")
    check = steps[names.index(check_name)]
    assert "calibration-deployment-smoke.ts" in check["run"]
    assert "${{ steps.frontend.outputs.url }}/calibration/dashboard" in check["run"]
    assert "--vercel-bypass-secret" in check["run"]
    assert (
        check["env"]["VERCEL_AUTOMATION_BYPASS_SECRET"]
        == "${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}"
    )


def test_every_bun_script_step_runs_after_its_job_installs_locked_frontend_dependencies():
    # Bun resolves the frontend's workspace packages, such as
    # @policyengine/calibration-tree, only through frontend/node_modules, so a
    # job must install before it runs repository code with Bun.
    uninstalled_steps = []
    for workflow_file in sorted((ROOT / ".github/workflows").glob("*.yml")):
        workflow = yaml.load(workflow_file.read_text(), Loader=yaml.BaseLoader)
        for job_name, job in workflow["jobs"].items():
            installed = False
            for step in job.get("steps", []):
                if _installs_locked_frontend_dependencies(step, job):
                    installed = True
                elif BUN_SCRIPT_COMMAND.search(step.get("run", "")) and not installed:
                    uninstalled_steps.append(
                        f"{workflow_file.name} / {job_name} / {_step_label(step)}"
                    )
    assert uninstalled_steps == []


def test_bun_script_detection_covers_repository_scripts_but_not_package_runners():
    for command in (
        "bun run frontend/scripts/calibration-deployment-smoke.ts --url x",
        "bun run lint",
        "bun test",
        "bun --no-install frontend/scripts/replay-build-run.ts",
        'set -e\nbun run publish:calibration-tree -- "${args[@]}"',
    ):
        assert BUN_SCRIPT_COMMAND.search(command), command
    for command in (
        'bunx --bun "vercel@${VERCEL_CLI_VERSION}" promote "$URL"',
        "bun install --frozen-lockfile",
        "uv pip install modal==1.5.5",
    ):
        assert not BUN_SCRIPT_COMMAND.search(command), command


def test_deploy_installs_locked_frontend_dependencies_without_credentials_after_the_vercel_upload():
    job = _workflow()["jobs"]["deploy"]
    steps = job["steps"]
    install_indexes = [
        index
        for index, step in enumerate(steps)
        if _installs_locked_frontend_dependencies(step, job)
    ]
    assert len(install_indexes) == 1
    install = steps[install_indexes[0]]
    assert "env" not in install
    assert "${{" not in install["run"]
    names = [step.get("name") for step in steps]
    # `vercel deploy .` uploads the repository root; installing afterwards keeps
    # frontend/node_modules out of the uploaded working tree.
    assert names.index("Build unaliased Vercel production candidate") < install_indexes[0]
    assert install_indexes[0] < names.index(
        "Verify staged calibration releases and staging"
    )


def test_timestamp_migration_can_run_through_the_publication_workflow():
    workflow = yaml.load(
        (ROOT / ".github/workflows/publish-calibration-tree.yml").read_text(),
        Loader=yaml.BaseLoader,
    )
    inputs = workflow["on"]["workflow_dispatch"]["inputs"]
    assert "migrate-timestamps" in inputs["event_kind"]["options"]
    script = next(
        step["run"]
        for step in workflow["jobs"]["publish"]["steps"]
        if step.get("name") == "Build, validate, and publish"
    )
    assert "--migrate-release-timestamps" in script


@pytest.mark.parametrize(
    ("event_kind", "expected_mode", "include_sha"),
    [
        ("manual", "--reconcile-releases", False),
        ("staging", "--reconcile-staging", True),
        ("migrate-timestamps", "--migrate-release-timestamps", False),
    ],
)
def test_publication_dispatch_preserves_dry_run_and_selects_one_mode(
    tmp_path, event_kind, expected_mode, include_sha
):
    workflow = yaml.load(
        (ROOT / ".github/workflows/publish-calibration-tree.yml").read_text(),
        Loader=yaml.BaseLoader,
    )
    script = next(
        step["run"]
        for step in workflow["jobs"]["publish"]["steps"]
        if step.get("name") == "Build, validate, and publish"
    )
    for name, value in {
        "country": "uk",
        "event_kind": event_kind,
        "hf_commit_sha": "a" * 40,
        "dry_run": "true",
    }.items():
        script = script.replace("${{ inputs." + name + " }}", value)
    arguments_file = tmp_path / "arguments.json"
    stub = tmp_path / "bun"
    stub.write_text(
        "#!/usr/bin/env python3\n"
        "import json, os, sys\n"
        "from pathlib import Path\n"
        "Path(os.environ['ARGUMENTS_FILE']).write_text(json.dumps(sys.argv[1:]))\n"
    )
    stub.chmod(0o755)
    result = subprocess.run(
        ["bash", "-c", script],
        env={
            **os.environ,
            "PATH": f"{tmp_path}:{os.environ['PATH']}",
            "ARGUMENTS_FILE": str(arguments_file),
        },
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    expected = [
        "run",
        "publish:calibration-tree",
        "--",
        "--country",
        "uk",
        expected_mode,
    ]
    if include_sha:
        expected.extend(["--sha", "a" * 40])
    expected.append("--dry-run")
    assert json.loads(arguments_file.read_text()) == expected


def test_publisher_retains_its_separate_write_credential():
    workflow = yaml.load(
        (ROOT / ".github/workflows/publish-calibration-tree.yml").read_text(),
        Loader=yaml.BaseLoader,
    )
    publisher = workflow["jobs"]["publish"]
    assert publisher["env"]["HF_TOKEN"] == "${{ secrets.HF_TOKEN }}"


@pytest.mark.parametrize("exit_code", [0, 17])
def test_post_promotion_qualification_preserves_status_and_points_to_rollback(
    tmp_path, exit_code
):
    steps = _workflow()["jobs"]["deploy"]["steps"]
    step = next(
        step
        for step in steps
        if step.get("name") == "Verify promoted calibration releases and staging"
    )
    stub = tmp_path / "bun"
    stub.write_text(f"#!/usr/bin/env bash\nexit {exit_code}\n")
    stub.chmod(0o755)
    result = subprocess.run(
        ["bash", "-e", "-c", step["run"]],
        env={**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}"},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == exit_code
    if exit_code:
        assert "frontend/HOSTED_RUNTIME.md#promotion-and-rollback" in result.stderr
        assert "vercel rollback PREVIOUS_DEPLOYMENT" in result.stderr
    else:
        assert "rollback" not in result.stdout + result.stderr
