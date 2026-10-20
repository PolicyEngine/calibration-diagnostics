// The production deploy job runs the calibration smoke script from a fresh
// checkout of the tested commit. The script imports the frontend's workspace
// packages, which Bun resolves only through frontend/node_modules, so the
// job's own steps must install them before the script runs. These tests copy
// the checkout's files (without node_modules) and replay the deploy job's
// install steps and its smoke-script commands, with the flags the workflow
// gives them. The job also holds Google Cloud credentials and can request
// GitHub OIDC tokens, so its install must run no lifecycle scripts, and a
// check must never install packages from a registry by itself.
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
// A step's Bun command up to and including the smoke script's path, such as
// `bun run --no-install frontend/scripts/calibration-deployment-smoke.ts`.
// The script's own arguments (deployment URLs, the bypass secret) follow the
// path and are left out, so the script stops before any network request.
const SMOKE_INVOCATION =
  /(?<![\w-])bun[ \t](?:[^\n]*?[ \t])?frontend\/scripts\/calibration-deployment-smoke\.ts(?=\s|$)/;
// What the script prints once its imports have loaded and it parses its
// (here absent) arguments.
const ARGUMENT_ERROR = "--url must name the mounted dashboard root.";
const MISSING_WORKSPACE_PACKAGE = "Cannot find module '@policyengine/calibration-tree/countries'";
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

// A local stand-in for the npm registry that answers 404 and records the
// path of every request, so a command that tries to install stays offline.
interface RecordingRegistry {
  url: string;
  requestedPaths: string[];
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
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

function smokeInvocation(step: WorkflowStep): string | null {
  return step.run?.match(SMOKE_INVOCATION)?.[0] ?? null;
}

// The files a checkout of the next commit would contain: tracked files plus
// new files that are not ignored, so ignored node_modules never come along.
function copyCheckout(): string {
  const listing = Bun.spawnSync(
    ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: REPOSITORY_ROOT, stdout: "pipe", stderr: "pipe" },
  );
  if (listing.exitCode !== 0) {
    throw new Error(`git ls-files failed: ${listing.stderr.toString()}`);
  }
  const checkoutCopy = mkdtempSync(join(tmpdir(), "deploy-checkout-"));
  cleanups.push(() => rmSync(checkoutCopy, { recursive: true, force: true }));
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

function startRecordingRegistry(): RecordingRegistry {
  const requestedPaths: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requestedPaths.push(new URL(request.url).pathname);
      return new Response("Not found", { status: 404 });
    },
  });
  cleanups.push(() => server.stop(true));
  return { url: server.url.href, requestedPaths };
}

function commandEnvironment(registryUrl?: string): Record<string, string | undefined> {
  const environment: Record<string, string | undefined> = {
    ...process.env,
    // Run the same Bun that runs this test wherever a step says `bun`.
    PATH: [dirname(process.execPath), process.env.PATH].join(delimiter),
  };
  delete environment.NODE_PATH;
  if (registryUrl !== undefined) {
    environment.BUN_CONFIG_REGISTRY = registryUrl;
    environment.NPM_CONFIG_REGISTRY = registryUrl;
  }
  return environment;
}

// GitHub Actions runs a `run:` script with bash -e in the step's directory.
// The spawn is asynchronous so the recording registry can answer meanwhile.
async function runWorkflowCommand(
  command: string,
  directory: string,
  environment: Record<string, string | undefined>,
): Promise<CommandResult> {
  const child = Bun.spawn(["bash", "--noprofile", "--norc", "-e", "-c", command], {
    cwd: directory,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [standardOutput, standardError] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode: await child.exited, output: `${standardOutput}${standardError}`.trim() };
}

async function runInstallStep(
  job: WorkflowJob,
  step: WorkflowStep & { run: string },
  checkoutCopy: string,
): Promise<void> {
  const install = await runWorkflowCommand(
    step.run,
    join(checkoutCopy, stepDirectory(job, step)),
    commandEnvironment(),
  );
  expect(install).toMatchObject({ exitCode: 0 });
}

test(
  "the deploy job installs the packages the calibration smoke script imports before each smoke check",
  async () => {
    const job = deployJob();
    const checkoutCopy = copyCheckout();
    const registry = startRecordingRegistry();
    expect(existsSync(join(checkoutCopy, "frontend/node_modules"))).toBe(false);

    const smokeChecks: { step: string; output: string }[] = [];
    for (const step of job.steps) {
      const invocation = smokeInvocation(step);
      if (invocation !== null) {
        const smoke = await runWorkflowCommand(
          invocation,
          checkoutCopy,
          commandEnvironment(registry.url),
        );
        smokeChecks.push({ step: step.name ?? invocation, output: smoke.output.split("\n")[0] });
      } else if (isInstallStep(step)) {
        await runInstallStep(job, step, checkoutCopy);
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
  "the deploy job's calibration checks never install packages from a registry",
  async () => {
    const job = deployJob();
    // No install steps are replayed: this is a job whose workspace install is missing.
    const checkoutCopy = copyCheckout();
    const registry = startRecordingRegistry();

    const smokeChecks: { step: string; missingPackage: boolean; requestedPaths: string[] }[] = [];
    for (const step of job.steps) {
      const invocation = smokeInvocation(step);
      if (invocation === null) continue;
      registry.requestedPaths.length = 0;
      const smoke = await runWorkflowCommand(
        invocation,
        checkoutCopy,
        commandEnvironment(registry.url),
      );
      smokeChecks.push({
        step: step.name ?? invocation,
        missingPackage: smoke.output.includes(MISSING_WORKSPACE_PACKAGE),
        requestedPaths: [...registry.requestedPaths],
      });
    }

    expect(smokeChecks.length).toBeGreaterThan(0);
    expect(smokeChecks).toEqual(
      smokeChecks.map(({ step }) => ({ step, missingPackage: true, requestedPaths: [] })),
    );
  },
  120_000,
);

test(
  "the deploy job's dependency install runs no lifecycle scripts",
  async () => {
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
    for (const step of installSteps) await runInstallStep(job, step, checkoutCopy);

    const packagesWhoseScriptsRan = PACKAGES_WITH_PLANTED_SCRIPTS.filter((packageDirectory) =>
      existsSync(join(checkoutCopy, packageDirectory, LIFECYCLE_MARKER)),
    );
    expect(packagesWhoseScriptsRan).toEqual([]);
  },
  120_000,
);
