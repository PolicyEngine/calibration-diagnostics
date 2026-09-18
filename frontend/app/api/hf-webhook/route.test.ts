import { afterEach, beforeEach, expect, test } from "bun:test";

import { POST } from "./route";

const originalFetch = globalThis.fetch;
const ENV_NAMES = [
  "HF_WEBHOOK_SECRET",
  "GITHUB_ACTIONS_DISPATCH_TOKEN",
  "CALIBRATION_TREE_GITHUB_REPOSITORY",
  "CALIBRATION_TREE_GITHUB_WORKFLOW",
  "POPULACE_HF_REPO",
  "POPULACE_HF_REVISION",
  "SLACK_WEBHOOK_MICROCOSM_US_RELEASES",
] as const;
const originalEnv = Object.fromEntries(
  ENV_NAMES.map((name) => [name, process.env[name]]),
);

beforeEach(() => {
  for (const name of ENV_NAMES) delete process.env[name];
  process.env.HF_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.GITHUB_ACTIONS_DISPATCH_TOKEN = "test-github-token";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of ENV_NAMES) {
    const value = originalEnv[name];
    if (value == null) delete process.env[name];
    else process.env[name] = value;
  }
});

function request(payload: unknown, secret = "test-webhook-secret") {
  return new Request("https://dashboard.example/api/hf-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-secret": secret,
    },
    body: JSON.stringify(payload),
  });
}

function replaceFetch(
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
) {
  globalThis.fetch = Object.assign(implementation, {
    preconnect: originalFetch.preconnect,
  });
}

test("webhook rejects invalid authentication before dispatching", async () => {
  let fetched = false;
  replaceFetch(async () => {
    fetched = true;
    return new Response(null, { status: 204 });
  });
  const response = await POST(request({}, "wrong"));
  expect(response.status).toBe(401);
  expect(fetched).toBe(false);
});

test("webhook acknowledges unrelated repositories without dispatching", async () => {
  let fetched = false;
  replaceFetch(async () => {
    fetched = true;
    return new Response(null, { status: 204 });
  });
  const response = await POST(request({
    repo: { name: "someone/unregistered" },
    updatedRefs: [{
      ref: "refs/tags/microcosm-us-release",
      oldSha: null,
      newSha: "1".repeat(40),
    }],
  }));
  expect(response.status).toBe(200);
  expect(fetched).toBe(false);
});

test("webhook dispatches tag and main-branch events to the publisher workflow", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  replaceFetch(async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(null, { status: 204 });
  });
  const tagSha = "1".repeat(40);
  const branchSha = "2".repeat(40);
  const response = await POST(request({
    repo: { name: "policyengine/populace-us" },
    updatedRefs: [
      {
        ref: "refs/tags/microcosm-us-release",
        oldSha: null,
        newSha: tagSha,
      },
      {
        ref: "refs/heads/main",
        oldSha: "3".repeat(40),
        newSha: branchSha,
      },
    ],
  }));

  expect(response.status).toBe(200);
  expect(calls).toHaveLength(2);
  expect(calls[0].url).toContain(
    "/PolicyEngine/calibration-diagnostics/actions/workflows/publish-calibration-tree.yml/dispatches",
  );
  expect(calls[0].init.headers).toMatchObject({
    Authorization: "Bearer test-github-token",
  });
  expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
    ref: "main",
    inputs: {
      country: "us",
      event_kind: "tag",
      release_id: "microcosm-us-release",
      hf_commit_sha: tagSha,
    },
  });
  expect(JSON.parse(String(calls[1].init.body))).toMatchObject({
    inputs: {
      country: "us",
      event_kind: "branch",
      release_id: "",
      hf_commit_sha: branchSha,
    },
  });
});

test("staging repository updates dispatch finalized-build publication", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  replaceFetch(async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(null, { status: 204 });
  });
  const stagingSha = "4".repeat(40);
  const response = await POST(request({
    repo: { name: "policyengine/populace-uk-staging" },
    updatedRefs: [{
      ref: "refs/heads/main",
      oldSha: "3".repeat(40),
      newSha: stagingSha,
    }],
  }));

  expect(response.status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
    ref: "main",
    inputs: {
      country: "uk",
      event_kind: "staging",
      release_id: "",
      hf_commit_sha: stagingSha,
    },
  });
});

test("webhook returns a retriable server error when GitHub rejects dispatch", async () => {
  replaceFetch(async () => new Response("forbidden", { status: 403 }));
  const response = await POST(request({
    repo: { name: "policyengine/populace-us" },
    updatedRefs: [{
      ref: "refs/heads/main",
      oldSha: "1".repeat(40),
      newSha: "2".repeat(40),
    }],
  }));
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({
    detail: "Unable to start calibration tree publication.",
  });
});
