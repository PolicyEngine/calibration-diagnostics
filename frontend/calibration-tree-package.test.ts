// The calibration tree package (the tree builder, its schema-6 types and
// readers, the Blob I/O and the publisher) has one source:
// PolicyEngine/microcosm-collector's packages/calibration-tree, published to
// npm as @policyengine/calibration-tree. The dashboard installs one published
// version from npm, keeps no copy of its own, and runs the installed
// package's publisher.
import { expect, test } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";

const FRONTEND_ROOT = import.meta.dir;
const PACKAGE_NAME = "@policyengine/calibration-tree";
const INSTALLED_PACKAGE = join("node_modules", "@policyengine", "calibration-tree");
const PUBLISHER_MODULE = join(INSTALLED_PACKAGE, "src", "publish-calibration-tree.ts");
// An exact release, such as 0.1.0: no range, tag, path or workspace protocol.
const EXACT_RELEASE = /^\d+\.\d+\.\d+$/;

interface FrontendManifest {
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
  workspaces?: unknown;
}

interface BunLockfile {
  workspaces: Record<string, unknown>;
  packages: Record<string, unknown[]>;
}

function frontendManifest(): FrontendManifest {
  return JSON.parse(readFileSync(join(FRONTEND_ROOT, "package.json"), "utf8"));
}

function pinnedVersion(): string {
  return frontendManifest().dependencies[PACKAGE_NAME];
}

// Files a checkout of the next commit would contain under a frontend
// directory: tracked files and new files that are not ignored.
function checkoutFiles(directory: string): string[] {
  const listing = Bun.spawnSync(
    ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", directory],
    { cwd: FRONTEND_ROOT, stdout: "pipe", stderr: "pipe" },
  );
  if (listing.exitCode !== 0) {
    throw new Error(`git ls-files failed: ${listing.stderr.toString()}`);
  }
  return listing.stdout.toString().split("\0").filter(Boolean);
}

test("the dashboard pins one published version of the calibration tree package", () => {
  expect(pinnedVersion()).toMatch(EXACT_RELEASE);
});

test("the dashboard keeps no workspace copy of the calibration tree package", () => {
  const manifest = frontendManifest();
  expect({ workspaces: manifest.workspaces, packageFiles: checkoutFiles("packages") }).toEqual({
    workspaces: undefined,
    packageFiles: [],
  });
});

test("the lockfile installs the pinned version from the npm registry with its integrity", () => {
  const lockfile = Bun.JSONC.parse(
    readFileSync(join(FRONTEND_ROOT, "bun.lock"), "utf8"),
  ) as BunLockfile;
  // An npm entry is [name@version, registry ("" for the default), metadata, integrity].
  const [resolution, registry, , integrity] = lockfile.packages[PACKAGE_NAME] ?? [];
  expect({
    workspaces: Object.keys(lockfile.workspaces),
    resolution,
    registry,
    integrityAlgorithm: String(integrity).split("-")[0],
  }).toEqual({
    workspaces: [""],
    resolution: `${PACKAGE_NAME}@${pinnedVersion()}`,
    registry: "",
    integrityAlgorithm: "sha512",
  });
});

test("the installed package is the pinned release, not a link to a local copy", () => {
  const installedManifest = JSON.parse(
    readFileSync(join(FRONTEND_ROOT, INSTALLED_PACKAGE, "package.json"), "utf8"),
  ) as { version: string };
  expect({
    version: installedManifest.version,
    location: relative(FRONTEND_ROOT, realpathSync(join(FRONTEND_ROOT, INSTALLED_PACKAGE))),
  }).toEqual({ version: pinnedVersion(), location: INSTALLED_PACKAGE });
});

test("the publisher script runs the installed package's publisher module", () => {
  const exportedPublisher = relative(
    FRONTEND_ROOT,
    Bun.resolveSync(`${PACKAGE_NAME}/publish-calibration-tree`, FRONTEND_ROOT),
  );
  expect({
    script: frontendManifest().scripts["publish:calibration-tree"],
    exportedPublisher,
  }).toEqual({
    script: `bun run ${PUBLISHER_MODULE}`,
    exportedPublisher: PUBLISHER_MODULE,
  });
});

test("lint typechecks the dashboard alone; the collector typechecks the package", () => {
  expect(frontendManifest().scripts.lint).toBe("tsc --noEmit");
});
