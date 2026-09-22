import { expect, test } from "bun:test";

import type { HfWebhookConfig } from "@/lib/microcosm/hf-webhook-config";
import {
  createHfWebhookHandler,
  type HfWebhookHandlerDependencies,
} from "@/lib/microcosm/hf-webhook-handler";

const REPOSITORIES = {
  usRelease: "example/us-release",
  usStaging: "example/us-staging",
  ukRelease: "example/uk-release",
  ukStaging: "example/uk-staging",
  beRelease: "example/be-release",
} as const;

const TEST_REPOSITORIES: HfWebhookConfig["repositories"] = new Map([
  [REPOSITORIES.usRelease, { country: "us", kind: "release" }],
  [REPOSITORIES.usStaging, { country: "us", kind: "staging" }],
  [REPOSITORIES.ukRelease, { country: "uk", kind: "release" }],
  [REPOSITORIES.ukStaging, { country: "uk", kind: "staging" }],
  [REPOSITORIES.beRelease, { country: "be", kind: "release" }],
]);

function webhookConfig(
  overrides: Partial<HfWebhookConfig> = {},
): HfWebhookConfig {
  return {
    secret: "test-webhook-secret",
    githubToken: "test-github-token",
    githubRepository: "PolicyEngine/calibration-diagnostics",
    githubWorkflow: "publish-calibration-tree.yml",
    repositories: new Map(TEST_REPOSITORIES),
    ...overrides,
  };
}

function handler(
  fetchImplementation: HfWebhookHandlerDependencies["fetch"],
  overrides: Partial<HfWebhookConfig> = {},
) {
  return createHfWebhookHandler(webhookConfig(overrides), {
    fetch: fetchImplementation,
    postReleaseAlert: async () => false,
  });
}

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

function testSha(index: number): string {
  return (index + 1).toString(16).padStart(40, "0");
}

test("webhook rejects invalid authentication before dispatching", async () => {
  let fetched = false;
  const POST = handler(async () => {
    fetched = true;
    return new Response(null, { status: 204 });
  });

  const response = await POST(request({}, "wrong"));

  expect(response.status).toBe(401);
  expect(fetched).toBe(false);
});

test("webhook rejects requests when its configured secret is missing", async () => {
  let fetched = false;
  const POST = handler(
    async () => {
      fetched = true;
      return new Response(null, { status: 204 });
    },
    { secret: undefined },
  );

  const response = await POST(request({}));

  expect(response.status).toBe(401);
  expect(fetched).toBe(false);
});

test("webhook accepts the documented query-parameter secret", async () => {
  let fetched = false;
  const POST = handler(async () => {
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
  const POST = handler(async () => {
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
  const POST = handler(async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(null, { status: 204 });
  });
  const tagSha = "1".repeat(40);
  const branchSha = "2".repeat(40);

  const response = await POST(
    request({
      repo: { name: REPOSITORIES.usRelease },
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

test("release updates dispatch every configured release repository", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const POST = handler(async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(null, { status: 204 });
  });
  const releases = Array.from(TEST_REPOSITORIES.entries()).filter(
    ([, registration]) => registration.kind === "release",
  );

  for (const [index, [repo, registration]] of releases.entries()) {
    const sha = testSha(index);
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
        country: registration.country,
        event_kind: "branch",
        release_id: "",
        hf_commit_sha: sha,
      },
    });
  }

  expect(calls).toHaveLength(releases.length);
});

test("staging updates dispatch every configured staging repository", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const POST = handler(async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(null, { status: 204 });
  });
  const stagingRepositories = Array.from(TEST_REPOSITORIES.entries()).filter(
    ([, registration]) => registration.kind === "staging",
  );

  for (const [index, [repo, registration]] of stagingRepositories.entries()) {
    const sha = testSha(index + 8);
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
        country: registration.country,
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
  const POST = handler(async () => {
    fetched = true;
    return new Response(null, { status: 204 });
  });

  const response = await POST(
    request({
      repo: { name: REPOSITORIES.usStaging },
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
  const POST = handler(async () => new Response("forbidden", { status: 403 }));

  const response = await POST(
    request({
      repo: { name: REPOSITORIES.usRelease },
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
