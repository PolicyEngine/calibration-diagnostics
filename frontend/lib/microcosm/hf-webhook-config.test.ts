import { expect, test } from "bun:test";

import { resolveHfWebhookConfig } from "./hf-webhook-config";

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
  const config = resolveHfWebhookConfig({ SLACK_WEBHOOK_POPULACE_UK: "https://hooks.slack.example/uk" });
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
