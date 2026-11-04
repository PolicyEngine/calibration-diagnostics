import { expect, test } from "bun:test";

import { resolveHfWebhookConfig } from "./hf-webhook-config";

test("resolves the registered release and staging repositories without ambient state", () => {
  const config = resolveHfWebhookConfig({});

  expect(Array.from(config.repositories.entries())).toEqual([
    ["policyengine/populace-us", { country: "us", kind: "release" }],
    ["policyengine/populace-us-staging", { country: "us", kind: "staging" }],
    ["policyengine/populace-uk-private", { country: "uk", kind: "release" }],
    ["policyengine/populace-uk-staging", { country: "uk", kind: "staging" }],
    ["policyengine/populace-be-private", { country: "be", kind: "release" }],
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
  });
  expect(config.repositories.get("example/uk-staging")).toEqual({
    country: "uk",
    kind: "staging",
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
