"""The production release preserves backend-first deployment ordering."""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
FRONTEND_INSTALL_COMMAND = ["bun", "install", "--frozen-lockfile"]
# `bun run <script or file>`, `bun test` and `bun <file>` load repository code, which
# resolves packages through frontend/node_modules. `bunx` fetches its own package.
BUN_SCRIPT_COMMAND = re.compile(
    r"(?<![\w-])bun\s+(?:--\S+\s+)*(?:run|test|\S+\.[cm]?[jt]sx?)(?:\s|$)"
)
# The Bun command words between `bun` and the calibration smoke script's path.
# Words after the path are the script's own arguments.
CALIBRATION_SMOKE_INVOCATION = re.compile(
    r"(?<![\w-])bun\s+(?P<bun_words>(?:\S+[ \t]+)*?)"
    r"frontend/scripts/calibration-deployment-smoke\.ts(?=\s|$)"
)


def _workflow():
    return yaml.load(
        (ROOT / ".github/workflows/deploy.yml").read_text(),
        Loader=yaml.BaseLoader,
    )


def _step_label(step):
    return step.get("name") or step.get("uses") or step.get("run", "").strip()


def _installs_locked_frontend_dependencies(step, job):
    """A one-line `bun install --frozen-lockfile [--option ...]` run in frontend."""
    default_directory = job.get("defaults", {}).get("run", {}).get("working-directory")
    directory = step.get("working-directory", default_directory)
    command = step.get("run", "").strip()
    if "\n" in command or directory != "frontend":
        return False
    arguments = shlex.split(command)
    extra_options = arguments[len(FRONTEND_INSTALL_COMMAND) :]
    return arguments[: len(FRONTEND_INSTALL_COMMAND)] == FRONTEND_INSTALL_COMMAND and all(
        option.startswith("--") for option in extra_options
    )


PRODUCTION_CONCURRENCY_GROUP = "calibration-diagnostics-production"
SUCCESSFUL_MAIN_PUSH_CLAUSES = {
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_branch == 'main'",
}


def _concurrency_group(job):
    concurrency = job.get("concurrency", {})
    return concurrency if isinstance(concurrency, str) else concurrency.get("group")


def test_deployment_waits_for_successful_main_ci():
    # Without the branch filter, every CI run, pull-request runs included,
    # creates a run of this workflow (see #260).
    workflow = _workflow()
    assert workflow["on"] == {
        "workflow_run": {
            "workflows": ["CI"],
            "types": ["completed"],
            "branches": ["main"],
        }
    }
    condition = workflow["jobs"]["deploy"]["if"]
    assert "conclusion == 'success'" in condition
    assert "event == 'push'" in condition
    assert "head_branch == 'main'" in condition


def test_production_concurrency_group_belongs_to_the_deploy_job_not_the_workflow():
    # A workflow-level group admits a run as soon as GitHub creates it, before
    # its job's `if:` skips it, and replaces any older pending run in the
    # group. On 2026-10-21, a pull-request CI run's deploy run, which would
    # have skipped, cancelled the pending deploy of #248 that way.
    workflow = _workflow()
    assert "concurrency" not in workflow
    assert workflow["jobs"]["deploy"]["concurrency"] == {
        "group": PRODUCTION_CONCURRENCY_GROUP,
        "cancel-in-progress": "false",
    }


def _requires_every_clause(condition, required_clauses):
    """Whether `condition` is a conjunction that includes every required clause.

    The `${{ }}` wrapper, whitespace, clause order, grouping parentheses and
    extra `&&`-joined clauses are accepted. Any `||` or `!` (other than `!=`)
    is rejected, because either could let the job run without the clauses.
    """
    expression = " ".join(condition.split())
    if expression.startswith("${{") and expression.endswith("}}"):
        expression = expression[3:-2].strip()
    if "||" in expression or re.search(r"!(?!=)", expression):
        return False
    clauses = {clause.strip(" ()") for clause in expression.split("&&")}
    return required_clauses <= clauses


def test_every_job_in_the_production_group_requires_a_successful_main_push():
    # The branch filter matches the triggering run's head branch name, and a
    # pull request from a fork whose branch is named main passes it. The job
    # condition, which requires a push run, is what rejects such a run, so each
    # job holding the production group requires all of these clauses.
    jobs = _workflow()["jobs"]
    jobs_in_production_group = [
        job_name
        for job_name, job in jobs.items()
        if _concurrency_group(job) == PRODUCTION_CONCURRENCY_GROUP
    ]
    assert jobs_in_production_group
    for job_name in jobs_in_production_group:
        condition = jobs[job_name].get("if", "")
        assert _requires_every_clause(condition, SUCCESSFUL_MAIN_PUSH_CLAUSES), job_name


SUCCESSFUL_CONCLUSION, PUSH_EVENT, MAIN_HEAD_BRANCH = sorted(SUCCESSFUL_MAIN_PUSH_CLAUSES)


@pytest.mark.parametrize(
    ("condition", "requires_every_clause"),
    [
        pytest.param(
            f"{SUCCESSFUL_CONCLUSION} && {PUSH_EVENT} && {MAIN_HEAD_BRANCH}",
            True,
            id="current wording",
        ),
        pytest.param(
            f"${{{{ {SUCCESSFUL_CONCLUSION} && {PUSH_EVENT} && {MAIN_HEAD_BRANCH} }}}}",
            True,
            id="expression wrapper",
        ),
        pytest.param(
            f"({MAIN_HEAD_BRANCH} &&\n  {PUSH_EVENT}) && {SUCCESSFUL_CONCLUSION}",
            True,
            id="reordered and grouped",
        ),
        pytest.param(
            f"{SUCCESSFUL_CONCLUSION} && {PUSH_EVENT} && {MAIN_HEAD_BRANCH}"
            " && github.repository == 'PolicyEngine/calibration-diagnostics'",
            True,
            id="extra required clause",
        ),
        pytest.param(
            f"{SUCCESSFUL_CONCLUSION} && {MAIN_HEAD_BRANCH}",
            False,
            id="missing push clause",
        ),
        pytest.param(
            f"{SUCCESSFUL_CONCLUSION} && {PUSH_EVENT} && {MAIN_HEAD_BRANCH}"
            " || github.event.workflow_run.event == 'pull_request'",
            False,
            id="alternative after or",
        ),
        pytest.param(
            f"!({SUCCESSFUL_CONCLUSION} && {PUSH_EVENT} && {MAIN_HEAD_BRANCH})",
            False,
            id="negated",
        ),
    ],
)
def test_clause_check_accepts_rewordings_and_rejects_weaker_conditions(
    condition, requires_every_clause
):
    assert (
        _requires_every_clause(condition, SUCCESSFUL_MAIN_PUSH_CLAUSES)
        is requires_every_clause
    )


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
    # Bun resolves the frontend's packages, such as the npm package
    # @policyengine/calibration-tree, only through frontend/node_modules, so a
    # job must install before it runs repository code with Bun.
    uninstalled_steps = []
    for workflow_file in _workflow_files():
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
        'set -e\nbun run replay:build-run -- "${args[@]}"',
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


def test_deploy_dependency_install_skips_lifecycle_scripts():
    # The deploy job holds Google Cloud credentials and can request GitHub OIDC
    # tokens, so neither the project's nor any dependency's install scripts may
    # run there. The calibration checks need no install script.
    job = _workflow()["jobs"]["deploy"]
    install_commands = [
        shlex.split(step["run"])
        for step in job["steps"]
        if _installs_locked_frontend_dependencies(step, job)
    ]
    assert install_commands == [
        ["bun", "install", "--frozen-lockfile", "--ignore-scripts"]
    ]


def test_every_calibration_check_turns_off_bun_auto_install():
    # In a directory tree without node_modules, Bun installs a missing package
    # from npm when a script imports it. A check must instead fail when the
    # job's dependency install is missing. Bun reads --no-install only before the
    # script path; after it, the flag is passed to the script.
    steps = _workflow()["jobs"]["deploy"]["steps"]
    bun_words_by_step = {}
    for step in steps:
        invocation = CALIBRATION_SMOKE_INVOCATION.search(step.get("run", ""))
        if invocation:
            bun_words_by_step[step["name"]] = invocation.group("bun_words").split()
    assert sorted(bun_words_by_step) == [
        "Verify promoted calibration releases and staging",
        "Verify staged calibration releases and staging",
    ]
    assert {
        name: "--no-install" in bun_words for name, bun_words in bun_words_by_step.items()
    } == {name: True for name in bun_words_by_step}


def test_calibration_smoke_invocation_reads_only_the_words_before_the_script():
    for command, bun_words in (
        ("bun run --no-install frontend/scripts/calibration-deployment-smoke.ts --url x", ["run", "--no-install"]),
        ("bun --no-install run frontend/scripts/calibration-deployment-smoke.ts", ["--no-install", "run"]),
        ("bun run frontend/scripts/calibration-deployment-smoke.ts --no-install", ["run"]),
        ("bun run frontend/scripts/calibration-deployment-smoke.ts \\\n--url x || {\n  exit 1\n}", ["run"]),
    ):
        invocation = CALIBRATION_SMOKE_INVOCATION.search(command)
        assert invocation, command
        assert invocation.group("bun_words").split() == bun_words, command


# The repository secrets and variable that only the dashboard's GitHub Actions
# tree publisher read. The telemetry collector builds and stores calibration
# trees instead. These settings are to be deleted from the repository's
# settings, after which a workflow that read one would get an empty value.
FORMER_TREE_PUBLISHER_SETTINGS = {
    "secrets": {"HF_TOKEN", "POPULACE_UK_STAGING_HF_TOKEN", "BLOB_READ_WRITE_TOKEN"},
    "vars": {"CALIBRATION_TREE_BUILD_ENABLED"},
}
# A `${{ ... }}` expression inside a workflow value. An `if:` value is an
# expression even without these delimiters.
WORKFLOW_EXPRESSION = re.compile(r"\$\{\{(.*?)\}\}", re.DOTALL)
# A use of the secrets or vars context, with the name it reads when that name
# is written out: `secrets.NAME` or `secrets['NAME']`, in any letter case, as
# GitHub accepts. Any other use (the whole context, a `.*` filter or a computed
# index) could read any setting.
CONTEXT_REFERENCE = re.compile(
    r"(?<![\w.])(?P<context>secrets|vars)\b"
    r"(?:\s*\.\s*(?P<property>[A-Za-z_][A-Za-z0-9_]*)\b|\s*\[\s*'(?P<index>[^']*)'\s*\])?",
    re.IGNORECASE,
)
# The tree publisher's entry points: the package's own script name and its
# module's name.
TREE_PUBLISHER_COMMAND = re.compile(r"publish[:-]calibration-tree")
# This module looks for the publisher's entry points, so it names them.
TREE_PUBLISHER_GUARD = "frontend/tests/test_deploy_workflow.py"


def _string_values(node, key=None):
    """Each string in a parsed workflow, with the mapping key it is under."""
    if isinstance(node, dict):
        for child_key, child in node.items():
            yield from _string_values(child, child_key)
    elif isinstance(node, list):
        for child in node:
            yield from _string_values(child, key)
    elif isinstance(node, str):
        yield key, node


def _former_tree_publisher_setting_reads(workflow_text):
    """Each read of a former tree publisher setting in a workflow, and each use
    of the secrets or vars context that could read any setting.

    It reads the parsed values, so YAML quoting and escapes are decoded first.
    """
    workflow = yaml.load(workflow_text, Loader=yaml.BaseLoader)
    reads = []
    for key, value in _string_values(workflow):
        expressions = [value] if key == "if" else WORKFLOW_EXPRESSION.findall(value)
        for expression in expressions:
            for reference in CONTEXT_REFERENCE.finditer(expression):
                context = reference.group("context").lower()
                name = reference.group("property") or reference.group("index")
                if name is None:
                    reads.append(f"any {context} setting: {expression.strip()}")
                elif name.upper() in FORMER_TREE_PUBLISHER_SETTINGS[context]:
                    reads.append(f"{context}.{name.upper()}")
    jobs = workflow.get("jobs", {}) if isinstance(workflow, dict) else {}
    for job_name, job in jobs.items():
        passed_secrets = job.get("secrets") if isinstance(job, dict) else None
        if isinstance(passed_secrets, str) and passed_secrets.strip() == "inherit":
            reads.append(f"jobs.{job_name}.secrets: inherit")
    return reads


def _workflow_files():
    workflows = ROOT / ".github/workflows"
    return sorted([*workflows.glob("*.yml"), *workflows.glob("*.yaml")])


def _files_naming_the_tree_publisher(files):
    """The paths, among (path, text) pairs, whose text names an entry point of
    the tree publisher: workflows, the scripts they run, the frontend manifest
    and documents alike."""
    return [
        relative_path
        for relative_path, text in files
        if relative_path != TREE_PUBLISHER_GUARD and TREE_PUBLISHER_COMMAND.search(text)
    ]


def _checkout_files():
    """Each file a checkout of the next commit would contain, with its text."""
    listing = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT,
        capture_output=True,
        check=True,
    )
    for relative_path in listing.stdout.decode().split("\0"):
        file_path = ROOT / relative_path
        if relative_path and file_path.is_file():
            yield relative_path, file_path.read_text(errors="ignore")


# Workflow fragments that read one of the former tree publisher's settings, or
# could read any setting, in the forms GitHub accepts.
READS_A_FORMER_TREE_PUBLISHER_SETTING = (
    "env:\n  TOKEN: ${{ secrets.HF_TOKEN }}\n",
    "env:\n  TOKEN: ${{ secrets['hf_token'] }}\n",
    "env:\n  TOKEN: ${{ Secrets . Blob_Read_Write_Token }}\n",
    "jobs:\n  publish:\n    if: vars.CALIBRATION_TREE_BUILD_ENABLED != 'FALSE'\n",
    # A YAML escape: the value GitHub reads is `secrets.HF_TOKEN`.
    'env:\n  TOKEN: "${{ secrets.\\x48F_TOKEN }}"\n',
    "env:\n  EVERYTHING: ${{ toJSON(secrets) }}\n",
    "env:\n  EVERYTHING: ${{ join(secrets.*, ' ') }}\n",
    "env:\n  TOKEN: ${{ secrets[format('POPULACE_{0}_STAGING_HF_TOKEN', matrix.country)] }}\n",
    "jobs:\n  call:\n    uses: ./.github/workflows/other.yml\n    secrets: 'inherit'\n",
    # A `}}` inside a quoted string does not end the expression.
    "env:\n  BODY: ${{ format('{{\"token\":\"{0}\"}}', secrets.HF_TOKEN) }}\n",
    # GitHub evaluates expressions in mapping keys too.
    'env:\n  "${{ secrets.HF_TOKEN }}": present\n',
)
# Workflow fragments that read none of them.
READS_NO_FORMER_TREE_PUBLISHER_SETTING = (
    "env:\n  TOKEN: ${{ secrets.HF_RELEASE_READ_TOKEN }}\n",
    "env:\n  TOKEN: ${{ secrets.HF_TOKEN_2 }}\n",
    "env:\n  TOKEN: ${{ env.HF_TOKEN }}\n",
    "env:\n  NAME: ${{ vars.TELEMETRY_SERVICE }}\n",
    "steps:\n  - run: gcloud secrets versions access latest --secret=HF_TOKEN\n",
    "jobs:\n  call:\n    uses: ./.github/workflows/other.yml\n    secrets:\n      TOKEN: ${{ secrets.HF_RELEASE_READ_TOKEN }}\n",
)


def test_setting_detection_covers_the_forms_github_accepts():
    assert {
        fragment: bool(_former_tree_publisher_setting_reads(fragment))
        for fragment in READS_A_FORMER_TREE_PUBLISHER_SETTING
    } == {fragment: True for fragment in READS_A_FORMER_TREE_PUBLISHER_SETTING}
    assert {
        fragment: _former_tree_publisher_setting_reads(fragment)
        for fragment in READS_NO_FORMER_TREE_PUBLISHER_SETTING
    } == {fragment: [] for fragment in READS_NO_FORMER_TREE_PUBLISHER_SETTING}


def test_no_workflow_reads_the_former_tree_publisher_settings():
    assert [
        f"{workflow_file.name}: {read}"
        for workflow_file in _workflow_files()
        for read in _former_tree_publisher_setting_reads(workflow_file.read_text())
    ] == []


def test_publisher_detection_reads_every_file_except_its_own_guard():
    files = [
        (".github/scripts/trees.sh", "bun run publish:calibration-tree --country uk\n"),
        (
            "frontend/scripts/trees.ts",
            'await import("@policyengine/calibration-tree/publish-calibration-tree");\n',
        ),
        (".github/workflows/trees.yml", "run: bun run publish:calibration-tree\n"),
        ("frontend/package.json", '"trees": "bun run publish:calibration-tree"\n'),
        ("frontend/tests/test_deploy_workflow.py", "publish:calibration-tree\n"),
        ("docs/trees.md", "The collector builds the trees.\n"),
    ]
    assert _files_naming_the_tree_publisher(files) == [
        ".github/scripts/trees.sh",
        "frontend/scripts/trees.ts",
        ".github/workflows/trees.yml",
        "frontend/package.json",
    ]


def test_no_repository_file_names_the_tree_publisher():
    # The collector is the only writer of the calibration tree store, so
    # nothing here runs the package's publisher.
    assert _files_naming_the_tree_publisher(_checkout_files()) == []


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
