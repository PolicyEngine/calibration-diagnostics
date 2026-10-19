// The production deploy job runs the calibration smoke script from a fresh
// checkout of the tested commit. The script imports the frontend's workspace
// packages, which Bun resolves only through frontend/node_modules, so the
// job's own steps must install them before the script runs. This test copies
// the checkout's files (without node_modules) and replays the deploy job's
// install steps in order, checking at each smoke step that the script loads.
// The job also holds Google Cloud credentials and can request GitHub OIDC
// tokens, so its install must run no lifecycle scripts.
import { afterEach, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../..");
const DEPLOY_WORKFLOW = join(REPOSITORY_ROOT, ".github/workflows/deploy.yml");
const SMOKE_SCRIPT = "frontend/scripts/calibration-deployment-smoke.ts";
// What the script prints once its imports have loaded and it parses its
// (here absent) arguments; it stops before any network request.
const ARGUMENT_ERROR = "--url must name the mounted dashboard root.";
const INSTALL_COMMAND = /(?<![\w-])bun\s+install\b/;
// Planted only in the copy: install scripts that leave this file if they run.
const LIFECYCLE_MARKER = "lifecycle-script-ran";
const LIFECYCLE_SCRIPT_NAMES = ["preinstall", "install", "postinstall", "prepare"];
const PACKAGES_WITH_PLANTED_SCRIPTS = ["frontend", "frontend/packages/calibration-tree"];

interface WorkflowStep {
  name?: string;
  run?: string;
  "working-directory"?: string;
}

interface WorkflowJob {
  defaults?: { run?: { "working-directory"?: string } };
  steps: WorkflowStep[];
}

interface CommandResult {
  exitCode: number;
  output: string;
}

const checkoutCopies: string[] = [];

afterEach(() => {
  for (const checkoutCopy of checkoutCopies.splice(0)) {
    rmSync(checkoutCopy, { recursive: true, force: true });
  }
});

function deployJob(): WorkflowJob {
  const workflow = Bun.YAML.parse(readFileSync(DEPLOY_WORKFLOW, "utf8")) as {
    jobs: Record<string, WorkflowJob>;
  };
  return workflow.jobs.deploy;
}

function isInstallStep(step: WorkflowStep): step is WorkflowStep & { run: string } {
  return step.run !== undefined && INSTALL_COMMAND.test(step.run);
}

function stepDirectory(job: WorkflowJob, step: WorkflowStep): string {
  return step["working-directory"] ?? job.defaults?.run?.["working-directory"] ?? ".";
}

// The files a checkout of the next commit would contain: tracked files plus
// new files that are not ignored, so ignored node_modules never come along.
function copyCheckout(): string {
  const listing = Bun.spawnSync(
    ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: REPOSITORY_ROOT },
  );
  if (listing.exitCode !== 0) {
    throw new Error(`git ls-files failed: ${listing.stderr.toString()}`);
  }
  const checkoutCopy = mkdtempSync(join(tmpdir(), "deploy-checkout-"));
  checkoutCopies.push(checkoutCopy);
  for (const trackedFile of listing.stdout.toString().split("\0").filter(Boolean)) {
    const source = join(REPOSITORY_ROOT, trackedFile);
    // A tracked file deleted in the working tree is not part of the next commit.
    if (!existsSync(source)) continue;
    const destination = join(checkoutCopy, trackedFile);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
  return checkoutCopy;
}

function commandEnvironment(): Record<string, string | undefined> {
  const environment: Record<string, string | undefined> = {
    ...process.env,
    // Run the same Bun that runs this test wherever a step says `bun`.
    PATH: [dirname(process.execPath), process.env.PATH].join(delimiter),
  };
  delete environment.NODE_PATH;
  return environment;
}

function commandResult(result: Bun.ReadableSyncSubprocess): CommandResult {
  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`.trim(),
  };
}

// GitHub Actions runs a `run:` script with bash -e in the step's directory.
function runWorkflowCommand(command: string, directory: string): CommandResult {
  return commandResult(
    Bun.spawnSync(["bash", "--noprofile", "--norc", "-e", "-c", command], {
      cwd: directory,
      env: commandEnvironment(),
      stdout: "pipe",
      stderr: "pipe",
    }),
  );
}

// Loads the smoke script exactly as the workflow names it, from the
// repository root. `--no-install` turns off Bun's automatic npm install for
// directories without node_modules, so only the workflow's own install steps
// can make the imports resolve, and the test never reaches the network.
function loadSmokeScript(checkoutCopy: string): CommandResult {
  return commandResult(
    Bun.spawnSync([process.execPath, "--no-install", "run", SMOKE_SCRIPT], {
      cwd: checkoutCopy,
      env: commandEnvironment(),
      stdout: "pipe",
      stderr: "pipe",
    }),
  );
}

test(
  "the deploy job installs the packages the calibration smoke script imports before each smoke check",
  () => {
    const job = deployJob();
    const checkoutCopy = copyCheckout();

    // The copy is a clean checkout: the script's package imports cannot load yet.
    expect(existsSync(join(checkoutCopy, "frontend/node_modules"))).toBe(false);
    expect(loadSmokeScript(checkoutCopy).output).toContain(
      "Cannot find module '@policyengine/calibration-tree/countries'",
    );

    const smokeChecks: { step: string; output: string }[] = [];
    for (const step of job.steps) {
      if (step.run?.includes(`bun run ${SMOKE_SCRIPT}`)) {
        const firstLine = loadSmokeScript(checkoutCopy).output.split("\n")[0];
        smokeChecks.push({ step: step.name ?? step.run, output: firstLine });
      } else if (isInstallStep(step)) {
        const install = runWorkflowCommand(step.run, join(checkoutCopy, stepDirectory(job, step)));
        expect(install).toMatchObject({ exitCode: 0 });
      }
    }

    expect(smokeChecks.length).toBeGreaterThan(0);
    expect(smokeChecks).toEqual(
      smokeChecks.map(({ step }) => ({ step, output: ARGUMENT_ERROR })),
    );
  },
  120_000,
);

test(
  "the deploy job's dependency install runs no lifecycle scripts",
  () => {
    const job = deployJob();
    const checkoutCopy = copyCheckout();
    for (const packageDirectory of PACKAGES_WITH_PLANTED_SCRIPTS) {
      const manifestFile = join(checkoutCopy, packageDirectory, "package.json");
      const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
      for (const scriptName of LIFECYCLE_SCRIPT_NAMES) {
        manifest.scripts = { ...manifest.scripts, [scriptName]: `touch ${LIFECYCLE_MARKER}` };
      }
      writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    }

    const installSteps = job.steps.filter(isInstallStep);
    expect(installSteps.length).toBeGreaterThan(0);
    for (const step of installSteps) {
      const install = runWorkflowCommand(step.run, join(checkoutCopy, stepDirectory(job, step)));
      expect(install).toMatchObject({ exitCode: 0 });
    }

    const packagesWhoseScriptsRan = PACKAGES_WITH_PLANTED_SCRIPTS.filter((packageDirectory) =>
      existsSync(join(checkoutCopy, packageDirectory, LIFECYCLE_MARKER)),
    );
    expect(packagesWhoseScriptsRan).toEqual([]);
  },
  120_000,
);
