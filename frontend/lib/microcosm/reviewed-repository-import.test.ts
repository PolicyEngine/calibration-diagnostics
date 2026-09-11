import { expect, test } from "bun:test";

import { COUNTRY_REGISTRY } from "./countries";
import { HOSTED_US_RELEASE } from "./production-release";

// A US-only data-selection conflict must fail US reads only. Asserting it while
// building the repository table would throw during module import instead, taking
// every country's routes and pages — and `next build`, which imports every
// route to collect page data — down with it.
const FIXTURE = `${import.meta.dir}/reviewed-repository-import.fixture.ts`;
const SECRET = "fixture-webhook-secret";
const OVERRIDES = ["POPULACE_HF_REPO", "POPULACE_HF_REVISION"] as const;

const ROUTES_IMPORTED = {
  "hf-webhook": "ok",
  microcosm: "ok",
  releases: "ok",
  variable: "ok",
  microcosm_variable: "ok",
};
const NOT_ALLOWLISTED = '200:{"ok":true,"alerted":[]}';

function importedUnder(
  overrides: Partial<Record<(typeof OVERRIDES)[number], string>>,
) {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of OVERRIDES) delete env[name];
  // Never let a configured Slack webhook turn this fixture into a real post.
  for (const name of Object.keys(env)) {
    if (name.startsWith("SLACK_WEBHOOK_")) delete env[name];
  }
  const child = Bun.spawnSync({
    cmd: [process.execPath, "run", FIXTURE],
    cwd: `${import.meta.dir}/../..`,
    env: { ...env, ...overrides, HF_WEBHOOK_SECRET: SECRET },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: child.exitCode,
    stderr: child.stderr.toString(),
    stdout: child.stdout.toString(),
  };
}

test("a conflicting US data override fails US reads, not module import", () => {
  const child = importedUnder({
    POPULACE_HF_REPO: "policyengine/unreviewed-override-fixture",
    POPULACE_HF_REVISION: "main",
  });
  expect(child.exitCode).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual({
    imported: true,
    us_repo: "refused:409",
    us_revision: "refused:409",
    uk_repo: `ok:${COUNTRY_REGISTRY.uk.repo}`,
    be_repo: `ok:${COUNTRY_REGISTRY.be.repo}`,
    be_revision: `ok:${COUNTRY_REGISTRY.be.revision}`,
    be_geography: `ok:${COUNTRY_REGISTRY.be.geography}`,
    route_imports: ROUTES_IMPORTED,
    // The refused country is left out of the alert allowlist; the others stay.
    reviewed_us_tag: NOT_ALLOWLISTED,
    uk_tag: '200:{"ok":true,"country":"uk","alerted":[]}',
  });
});

test("the reviewed deployment keeps every country's reads working", () => {
  const child = importedUnder({});
  expect(child.stderr).toBe("");
  expect(child.exitCode).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual({
    imported: true,
    us_repo: `ok:${HOSTED_US_RELEASE.repo}`,
    us_revision: `ok:${HOSTED_US_RELEASE.hf_revision}`,
    uk_repo: `ok:${COUNTRY_REGISTRY.uk.repo}`,
    be_repo: `ok:${COUNTRY_REGISTRY.be.repo}`,
    be_revision: `ok:${COUNTRY_REGISTRY.be.revision}`,
    be_geography: `ok:${COUNTRY_REGISTRY.be.geography}`,
    route_imports: ROUTES_IMPORTED,
    reviewed_us_tag: '200:{"ok":true,"country":"us","alerted":[]}',
    uk_tag: '200:{"ok":true,"country":"uk","alerted":[]}',
  });
});
