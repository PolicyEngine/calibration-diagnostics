import { afterEach, expect, test } from "bun:test";

import { resolveHfWebhookConfig } from "./hf-webhook-config";
import { hasReleaseAlertChannel, postReleaseAlert } from "@/lib/slack";

test("resolves the registered release and staging repositories without ambient state", () => {
  const config = resolveHfWebhookConfig({});

  expect(Array.from(config.repositories.entries())).toEqual([
    ["policyengine/populace-us", { country: "us", kind: "release", repo: "policyengine/populace-us" }],
    ["policyengine/populace-us-staging", { country: "us", kind: "staging", repo: "policyengine/populace-us-staging" }],
    ["policyengine/populace-uk-private", { country: "uk", kind: "release", repo: "policyengine/populace-uk-private" }],
    ["policyengine/populace-uk-staging", { country: "uk", kind: "staging", repo: "policyengine/populace-uk-staging" }],
    ["policyengine/populace-be-private", { country: "be", kind: "release", repo: "policyengine/populace-be-private" }],
  ]);
  expect(config).toMatchObject({
    secret: undefined,
    githubToken: undefined,
    githubRepository: "PolicyEngine/calibration-diagnostics",
    githubWorkflow: "publish-calibration-tree.yml",
  });
});

test("applies repository and GitHub overrides from an explicit environment", () => {
  const config = resolveHfWebhookConfig({
    HF_WEBHOOK_SECRET: "configured-secret",
    GITHUB_ACTIONS_DISPATCH_TOKEN: "  github-token  ",
    CALIBRATION_TREE_GITHUB_REPOSITORY: "  example/dashboard  ",
    CALIBRATION_TREE_GITHUB_WORKFLOW: "  publish.yml  ",
    POPULACE_UK_HF_REPO: "example/uk-release",
    POPULACE_UK_STAGING_HF_REPO: "example/uk-staging",
  });

  expect(config).toMatchObject({
    secret: "configured-secret",
    githubToken: "github-token",
    githubRepository: "example/dashboard",
    githubWorkflow: "publish.yml",
  });
  expect(config.repositories.get("example/uk-release")).toEqual({
    country: "uk",
    kind: "release",
    repo: "example/uk-release",
  });
  expect(config.repositories.get("example/uk-staging")).toEqual({
    country: "uk",
    kind: "staging",
    repo: "example/uk-staging",
  });
  expect(config.repositories.has("policyengine/populace-uk-private")).toBe(
    false,
  );
  expect(config.repositories.has("policyengine/populace-uk-staging")).toBe(
    false,
  );
});

test("reads the Hugging Face token for releases.json alerts as the dashboard's other readers do: HF_TOKEN, else HUGGINGFACE_TOKEN", () => {
  expect(resolveHfWebhookConfig({ HF_TOKEN: "hf-token", HUGGINGFACE_TOKEN: "other" }).huggingFaceToken)
    .toBe("hf-token");
  expect(resolveHfWebhookConfig({ HUGGINGFACE_TOKEN: "fallback-token" }).huggingFaceToken)
    .toBe("fallback-token");
  expect(resolveHfWebhookConfig({}).huggingFaceToken).toBeUndefined();
  // As hfAuthHeaders: a set HF_TOKEN wins even when empty, and is used as it is.
  expect(resolveHfWebhookConfig({ HF_TOKEN: "", HUGGINGFACE_TOKEN: "other" }).huggingFaceToken).toBe("");
  expect(resolveHfWebhookConfig({ HF_TOKEN: " padded " }).huggingFaceToken).toBe(" padded ");
});

test("reads releases.json only for the countries whose Slack channel is configured", () => {
  const config = resolveHfWebhookConfig({ SLACK_WEBHOOK_MICROCOSM_UK: "https://hooks.slack.example/uk" });
  expect([...config.releaseAlertCountries]).toEqual(["uk"]);
  expect([...resolveHfWebhookConfig({}).releaseAlertCountries]).toEqual([]);
});

test("each registration keeps its repository's name as configured, in its configured letter case", () => {
  const config = resolveHfWebhookConfig({
    POPULACE_UK_HF_REPO: "Example/UK-Release",
    POPULACE_UK_STAGING_HF_REPO: "Example/UK-Staging",
  });

  expect(config.repositories.get("example/uk-release")).toEqual({
    country: "uk",
    kind: "release",
    repo: "Example/UK-Release",
  });
  expect(config.repositories.get("example/uk-staging")).toEqual({
    country: "uk",
    kind: "staging",
    repo: "Example/UK-Staging",
  });
});

// The collector address for calibration-tree builds follows the build
// monitor's rules for MICROCOSM_TELEMETRY_COLLECTOR_URL. All addresses are
// placeholders.

function treeBuildCollector(value: string | undefined) {
  return resolveHfWebhookConfig({ MICROCOSM_TELEMETRY_COLLECTOR_URL: value }).treeBuildCollector;
}

test("the collector address for tree builds is MICROCOSM_TELEMETRY_COLLECTOR_URL: HTTPS except on localhost, without its trailing slash", () => {
  expect(treeBuildCollector("https://collector.example")).toEqual({ baseUrl: "https://collector.example" });
  expect(treeBuildCollector("  https://collector.example/  ")).toEqual({ baseUrl: "https://collector.example" });
  expect(treeBuildCollector("https://collector.example/prefix/")).toEqual({
    baseUrl: "https://collector.example/prefix",
  });
  expect(treeBuildCollector("http://localhost:8080/")).toEqual({ baseUrl: "http://localhost:8080" });
  expect(treeBuildCollector("http://127.0.0.1:8080")).toEqual({ baseUrl: "http://127.0.0.1:8080" });
});

test("tree builds need only the collector address, not the build monitor's read credential setting", () => {
  const config = resolveHfWebhookConfig({ MICROCOSM_TELEMETRY_COLLECTOR_URL: "https://collector.example" });

  expect(config.treeBuildCollector).toEqual({ baseUrl: "https://collector.example" });
  // The build monitor refuses this value of its Vercel OIDC setting; tree
  // builds never read it.
  const withInvalidOidcSetting = resolveHfWebhookConfig({
    MICROCOSM_TELEMETRY_COLLECTOR_URL: "https://collector.example",
    MICROCOSM_TELEMETRY_VERCEL_OIDC: "not-a-setting",
  });
  expect(withInvalidOidcSetting.treeBuildCollector).toEqual({ baseUrl: "https://collector.example" });
});

test("an invalid collector address is kept as a problem, never thrown, and the problem does not repeat it", () => {
  const invalid: Array<[string, string]> = [
    ["http://collector.example", "HTTPS"],
    ["ftp://collector.example", "HTTPS"],
    ["https://user:secret-password@collector.example", "credentials"],
    ["https://collector.example/?key=value", "query"],
    ["https://collector.example/#fragment", "query"],
    ["::not-an-address::", "not a valid URL"],
  ];
  for (const [value, reason] of invalid) {
    const config = resolveHfWebhookConfig({ MICROCOSM_TELEMETRY_COLLECTOR_URL: value });

    expect(config.treeBuildCollector).toEqual({ problem: expect.stringContaining(reason) });
    expect(JSON.stringify(config.treeBuildCollector)).not.toContain(value);
    expect(JSON.stringify(config.treeBuildCollector)).not.toContain("secret-password");
    // The rest of the configuration still resolves, so the webhook keeps dispatching.
    expect(config.repositories.size).toBe(5);
  }
});

test("an unset or empty collector address leaves tree builds not configured", () => {
  expect(resolveHfWebhookConfig({}).treeBuildCollector).toBeUndefined();
  expect(treeBuildCollector("")).toBeUndefined();
  expect(treeBuildCollector("   ")).toBeUndefined();
  // A set address is configured, so the checks above are not met merely
  // because the address is never read.
  expect(treeBuildCollector("https://collector.example")).toBeDefined();
});

test("Slack configuration accepts legacy aliases and prefers Microcosm variables", () => {
  const legacy = {
    SLACK_WEBHOOK_POPULACE_US: "https://hooks.slack.example/legacy-us", // compat: populace alias, remove after 0.2.0
    SLACK_WEBHOOK_POPULACE_UK: "https://hooks.slack.example/legacy-uk", // compat: populace alias, remove after 0.2.0
  };
  expect([...resolveHfWebhookConfig(legacy).releaseAlertCountries]).toEqual(["us", "uk"]);
  expect(hasReleaseAlertChannel("uk", { ...legacy, SLACK_WEBHOOK_MICROCOSM_UK: "" })).toBe(false);
  expect(hasReleaseAlertChannel("uk", { ...legacy, SLACK_WEBHOOK_MICROCOSM_UK: "https://hooks.slack.example/current" })).toBe(true);
});

// The tests below replace fetch, post a release alert, and check which
// webhook URL receives it.
const LEGACY_UK_WEBHOOK_ENV = "SLACK_WEBHOOK_POPULACE_UK"; // compat: populace alias, remove after 0.2.0
const UK_SLACK_ENV = ["SLACK_WEBHOOK_MICROCOSM_UK", LEGACY_UK_WEBHOOK_ENV];
const originalFetch = globalThis.fetch;
const priorUkSlackEnv = UK_SLACK_ENV.map((name) => [name, process.env[name]] as const);
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of priorUkSlackEnv) {
    if (value == null) delete process.env[name];
    else process.env[name] = value;
  }
});

async function postUkReleaseAlert(environment: Record<string, string>) {
  for (const name of UK_SLACK_ENV) {
    if (name in environment) process.env[name] = environment[name];
    else delete process.env[name];
  }
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return new Response("ok");
  }) as typeof fetch;
  const sent = await postReleaseAlert({ country: "uk", releaseId: "release-a", repo: "example/uk-release" });
  return { sent, urls };
}

test("a release alert goes to the legacy Slack webhook when the environment provides only that variable", async () => {
  expect(await postUkReleaseAlert({
    [LEGACY_UK_WEBHOOK_ENV]: "https://hooks.slack.example/legacy-uk",
  })).toEqual({ sent: true, urls: ["https://hooks.slack.example/legacy-uk"] });
});

test("a release alert goes to the Microcosm Slack webhook when the environment provides both variables", async () => {
  expect(await postUkReleaseAlert({
    SLACK_WEBHOOK_MICROCOSM_UK: "https://hooks.slack.example/current-uk",
    [LEGACY_UK_WEBHOOK_ENV]: "https://hooks.slack.example/legacy-uk",
  })).toEqual({ sent: true, urls: ["https://hooks.slack.example/current-uk"] });
});

test("an empty Microcosm Slack webhook turns release alerts off even when the environment provides the legacy one", async () => {
  expect(await postUkReleaseAlert({
    SLACK_WEBHOOK_MICROCOSM_UK: "",
    [LEGACY_UK_WEBHOOK_ENV]: "https://hooks.slack.example/legacy-uk",
  })).toEqual({ sent: false, urls: [] });
  expect(await postUkReleaseAlert({})).toEqual({ sent: false, urls: [] });
});
