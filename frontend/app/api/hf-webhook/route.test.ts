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

function querySecretRequest(payload: unknown, secret = "test-webhook-secret") {
  const url = new URL("https://dashboard.example/api/hf-webhook");
  url.searchParams.set("secret", secret);
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function replaceFetch(
  implementation: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
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

test("webhook rejects requests when its server-side secret is missing", async () => {
  delete process.env.HF_WEBHOOK_SECRET;
  let fetched = false;
  replaceFetch(async () => {
    fetched = true;
    return new Response(null, { status: 204 });
  });

  const response = await POST(request({}));

  expect(response.status).toBe(401);
  expect(fetched).toBe(false);
});

test("webhook accepts the documented query-parameter secret", async () => {
  let fetched = false;
  replaceFetch(async () => {
    fetched = true;
    return new Response(null, { status: 204 });
  });

  const response = await POST(
    querySecretRequest({
      repo: { name: "someone/unregistered" },
      updatedRefs: [],
    }),
  );

  expect(response.status).toBe(200);
  expect(fetched).toBe(false);
});

test("webhook acknowledges unrelated repositories without dispatching", async () => {
  let fetched = false;
  replaceFetch(async () => {
    fetched = true;
    return new Response(null, { status: 204 });
  });
  const response = await POST(
    request({
      repo: { name: "someone/unregistered" },
      updatedRefs: [
        {
          ref: "refs/tags/microcosm-us-release",
          oldSha: null,
          newSha: "1".repeat(40),
        },
      ],
    }),
  );
  expect(response.status).toBe(200);
  expect(fetched).toBe(false);
});

test("webhook coalesces tag and main-branch changes into one reconciliation", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  replaceFetch(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(null, { status: 204 });
  });
  const tagSha = "1".repeat(40);
  const branchSha = "2".repeat(40);
  const response = await POST(
    request({
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
    }),
  );

  expect(response.status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toContain(
    "/PolicyEngine/calibration-diagnostics/actions/workflows/publish-calibration-tree.yml/dispatches",
  );
  expect(calls[0].init.headers).toMatchObject({
    Authorization: "Bearer test-github-token",
  });
  const dispatch = JSON.parse(String(calls[0].init.body));
  expect(dispatch).toMatchObject({
    ref: "main",
    inputs: {
      country: "us",
      event_kind: "tag",
      release_id: "microcosm-us-release",
      hf_commit_sha: tagSha,
    },
  });
  expect(dispatch.inputs).not.toHaveProperty("backfill");
});

test("release main-branch updates dispatch every registered country", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  replaceFetch(async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(null, { status: 204 });
  });
  const releases = [
    ["policyengine/populace-us", "us", "a"],
    ["policyengine/populace-uk-private", "uk", "b"],
    ["policyengine/populace-be-private", "be", "c"],
  ] as const;

  for (const [repo, country, shaCharacter] of releases) {
    const sha = shaCharacter.repeat(40);
    const response = await POST(
      request({
        repo: { name: repo },
        updatedRefs: [
          {
            ref: "refs/heads/main",
            oldSha: "3".repeat(40),
            newSha: sha,
          },
        ],
      }),
    );
    expect(response.status).toBe(200);
    const dispatch = JSON.parse(String(calls.at(-1)?.init.body));
    expect(dispatch).toMatchObject({
      ref: "main",
      inputs: {
        country,
        event_kind: "branch",
        release_id: "",
        hf_commit_sha: sha,
      },
    });
  }

  expect(calls).toHaveLength(releases.length);
});

test("staging main-branch updates dispatch every registered staging country", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  replaceFetch(async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(null, { status: 204 });
  });
  const stagingRepositories = [
    ["policyengine/populace-us-staging", "us", "d"],
    ["policyengine/populace-uk-staging", "uk", "e"],
  ] as const;

  for (const [repo, country, shaCharacter] of stagingRepositories) {
    const sha = shaCharacter.repeat(40);
    const response = await POST(
      request({
        repo: { name: repo },
        updatedRefs: [
          {
            ref: "refs/heads/main",
            oldSha: "3".repeat(40),
            newSha: sha,
          },
        ],
      }),
    );
    expect(response.status).toBe(200);
    expect(JSON.parse(String(calls.at(-1)?.init.body))).toMatchObject({
      ref: "main",
      inputs: {
        country,
        event_kind: "staging",
        release_id: "",
        hf_commit_sha: sha,
      },
    });
  }

  expect(calls).toHaveLength(stagingRepositories.length);
});

test("staging tag updates are acknowledged without dispatching", async () => {
  let fetched = false;
  replaceFetch(async () => {
    fetched = true;
    return new Response(null, { status: 204 });
  });

  const response = await POST(
    request({
      repo: { name: "policyengine/populace-us-staging" },
      updatedRefs: [
        {
          ref: "refs/tags/not-a-finalized-run",
          oldSha: null,
          newSha: "4".repeat(40),
        },
      ],
    }),
  );

  expect(response.status).toBe(200);
  expect(fetched).toBe(false);
  expect(await response.json()).toMatchObject({ dispatched: [] });
});

test("webhook returns a retriable server error when GitHub rejects dispatch", async () => {
  replaceFetch(async () => new Response("forbidden", { status: 403 }));
  const response = await POST(
    request({
      repo: { name: "policyengine/populace-us" },
      updatedRefs: [
        {
          ref: "refs/heads/main",
          oldSha: "1".repeat(40),
          newSha: "2".repeat(40),
        },
      ],
    }),
  );
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({
    detail: "Unable to start calibration tree publication.",
  });
});
