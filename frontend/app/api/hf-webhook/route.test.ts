import { expect, spyOn, test } from "bun:test";

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

// The dispatch tests' repositories have no releases.json: the webhook's reads
// of it get Hugging Face's "entry not found" 404 and never reach the test's
// own fetch, which sees only the GitHub dispatch.
function handler(
  fetchImplementation: HfWebhookHandlerDependencies["fetch"],
  overrides: Partial<HfWebhookConfig> = {},
) {
  return createHfWebhookHandler(webhookConfig(overrides), {
    fetch: async (input, init) =>
      String(input).endsWith("/releases.json")
        ? missingReleasesRecord()
        : fetchImplementation(input, init),
    postReleaseAlert: async () => false,
  });
}

function missingReleasesRecord(): Response {
  return new Response("Entry not found", {
    status: 404,
    headers: { "X-Error-Code": "EntryNotFound" },
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

// -- Slack alerts from releases.json -----------------------------------------
//
// A release repository with build folders records every build in
// releases.json (microcosm-emitter#24). Each update to main is compared
// before and after: one Slack message per newly published build, per change
// of current build and per withdrawal. All values are synthetic; the Slack
// incoming webhook is a placeholder address answered by a fake.

const UK_SLACK_WEBHOOK = "https://hooks.slack.example/services/uk-placeholder";
const NATIONAL = "microcosm-uk-2024-25-national";
const DENSE = "microcosm-uk-2024-25-dense";
const OLDER = "uk-frs-calibration-attempt-20261014T214443Z-d12ff9b3";
const CURRENT = "uk-frs-calibration-attempt-20261019T083323Z-6cba5d71";
const NEWEST = "uk-frs-calibration-attempt-20261104T101500Z-0e0e0e0e";
const DENSE_BUILD = "uk-local-candidate-f100-s42-20261019T000432Z-ee5c2dbe";
const BEFORE_SHA = "a".repeat(40);
const AFTER_SHA = "b".repeat(40);
const PUBLISHED_AT: Record<string, string> = {
  [OLDER]: "2026-10-14T21:44:43+00:00",
  [CURRENT]: "2026-10-19T08:33:23+00:00",
  [NEWEST]: "2026-11-04T10:15:00+00:00",
  [DENSE_BUILD]: "2026-10-19T00:04:32+00:00",
};

function nationalRecord(
  current: string | null,
  builds: string[],
  withdrawn: string[] = [],
): Record<string, unknown> {
  return {
    schema_version: 1,
    default: NATIONAL,
    releases: {
      [NATIONAL]: {
        role: "national",
        current,
        builds: Object.fromEntries(builds.map((build) => [
          build,
          { published_at: PUBLISHED_AT[build], withdrawn: withdrawn.includes(build) },
        ])),
      },
    },
  };
}

type RecordAnswer = Record<string, unknown> | null | (() => Response);

async function postMainUpdate(options: {
  before: RecordAnswer;
  after: RecordAnswer;
  repo?: string;
  newTag?: string;
}) {
  const repo = options.repo ?? REPOSITORIES.ukRelease;
  const hfRequests: Array<{ url: string; headers: HeadersInit | undefined }> = [];
  const dispatches: string[] = [];
  const tagAlerts: string[] = [];
  const slackPayloads: Array<{ text: string; blocks: unknown[] }> = [];
  const answer = (value: RecordAnswer) =>
    typeof value === "function"
      ? value()
      : value == null
        ? missingReleasesRecord()
        : Response.json(value);
  const fetchImplementation: HfWebhookHandlerDependencies["fetch"] = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://api.github.com/")) {
      dispatches.push(url);
      return new Response(null, { status: 204 });
    }
    const revision = /\/resolve\/([0-9a-f]{40})\/releases\.json$/.exec(url)?.[1];
    if (revision) {
      hfRequests.push({ url, headers: init?.headers });
      return answer(revision === BEFORE_SHA ? options.before : options.after);
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const originalFetch = globalThis.fetch;
  const priorWebhook = process.env.SLACK_WEBHOOK_POPULACE_UK;
  process.env.SLACK_WEBHOOK_POPULACE_UK = UK_SLACK_WEBHOOK;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) !== UK_SLACK_WEBHOOK) throw new Error(`Unexpected URL ${String(input)}`);
    slackPayloads.push(JSON.parse(String(init?.body)));
    return new Response("ok");
  }) as typeof fetch;
  const logged = spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await createHfWebhookHandler(
      webhookConfig({ huggingFaceToken: "test-hf-token" }),
      {
        fetch: fetchImplementation,
        postReleaseAlert: async ({ releaseId }) => {
          tagAlerts.push(releaseId);
          return true;
        },
      },
    )(request({
      repo: { name: repo },
      updatedRefs: [
        ...(options.newTag
          ? [{ ref: `refs/tags/${options.newTag}`, oldSha: null, newSha: AFTER_SHA }]
          : []),
        { ref: "refs/heads/main", oldSha: BEFORE_SHA, newSha: AFTER_SHA },
      ],
    }));
    return {
      status: response.status,
      hfRequests,
      dispatches,
      tagAlerts,
      slackPayloads,
      slackTexts: slackPayloads.map((payload) => payload.text),
      logged: logged.mock.calls.map((call) => call.map(String).join(" ")),
    };
  } finally {
    logged.mockRestore();
    globalThis.fetch = originalFetch;
    if (priorWebhook == null) delete process.env.SLACK_WEBHOOK_POPULACE_UK;
    else process.env.SLACK_WEBHOOK_POPULACE_UK = priorWebhook;
  }
}

test("a newly published build that becomes current is announced as now current", async () => {
  const result = await postMainUpdate({
    before: nationalRecord(CURRENT, [OLDER, CURRENT]),
    after: nationalRecord(NEWEST, [OLDER, CURRENT, NEWEST]),
  });

  expect(result.status).toBe(200);
  expect(result.slackTexts).toEqual([`New Microcosm UK build \`${NATIONAL}/${NEWEST}\`: now current`]);
  // The existing context text: the repository, the publication time and the
  // dashboard link.
  const context = JSON.stringify(result.slackPayloads[0].blocks);
  expect(context).toContain(REPOSITORIES.ukRelease);
  expect(context).toContain(`published ${PUBLISHED_AT[NEWEST]}`);
  expect(context).toContain("calibration diagnostics");
  // The tree publication is still dispatched first.
  expect(result.dispatches).toHaveLength(1);
});

test("a newly published build that does not become current names the build that stays current", async () => {
  const result = await postMainUpdate({
    before: nationalRecord(CURRENT, [OLDER, CURRENT]),
    after: nationalRecord(CURRENT, [OLDER, CURRENT, NEWEST]),
  });

  expect(result.slackTexts).toEqual([
    `New Microcosm UK build \`${NATIONAL}/${NEWEST}\`: published, not current (current stays \`${CURRENT}\`)`,
  ]);
});

test("a change of current build is announced with the builds before and after", async () => {
  const result = await postMainUpdate({
    before: nationalRecord(OLDER, [OLDER, CURRENT]),
    after: nationalRecord(CURRENT, [OLDER, CURRENT]),
  });

  expect(result.slackTexts).toEqual([
    `Microcosm UK \`${NATIONAL}\`: current build changed from \`${OLDER}\` to \`${CURRENT}\``,
  ]);
});

test("a withdrawal is announced", async () => {
  const result = await postMainUpdate({
    before: nationalRecord(CURRENT, [OLDER, CURRENT]),
    after: nationalRecord(CURRENT, [OLDER, CURRENT], [OLDER]),
  });

  expect(result.slackTexts).toEqual([`Microcosm UK build \`${NATIONAL}/${OLDER}\` withdrawn`]);
});

test("the update that first creates releases.json posts one summary message", async () => {
  const after = nationalRecord(CURRENT, [OLDER, CURRENT]);
  (after.releases as Record<string, unknown>)[DENSE] = {
    role: "local_area",
    current: DENSE_BUILD,
    builds: { [DENSE_BUILD]: { published_at: PUBLISHED_AT[DENSE_BUILD], withdrawn: false } },
  };
  const result = await postMainUpdate({ before: null, after });

  expect(result.slackTexts).toEqual([
    "Microcosm UK now records its releases in `releases.json`: 3 builds in 2 releases",
  ]);
  const summary = JSON.stringify(result.slackPayloads[0].blocks);
  expect(summary).toContain(`\`${NATIONAL}\`: current build \`${CURRENT}\``);
  expect(summary).toContain(`\`${DENSE}\`: current build \`${DENSE_BUILD}\``);
});

test("an update that leaves releases.json unchanged posts nothing", async () => {
  const record = nationalRecord(CURRENT, [OLDER, CURRENT]);
  const result = await postMainUpdate({ before: record, after: record });

  expect(result.hfRequests).toHaveLength(2);
  expect(result.slackTexts).toEqual([]);
  expect(result.logged).toEqual([]);
});

test("releases.json is read at the commits before and after the update, with the configured Hugging Face token", async () => {
  const result = await postMainUpdate({
    before: nationalRecord(CURRENT, [OLDER, CURRENT]),
    after: nationalRecord(CURRENT, [OLDER, CURRENT]),
  });

  expect(result.hfRequests.map((read) => read.url).sort()).toEqual([
    `https://huggingface.co/datasets/${REPOSITORIES.ukRelease}/resolve/${BEFORE_SHA}/releases.json`,
    `https://huggingface.co/datasets/${REPOSITORIES.ukRelease}/resolve/${AFTER_SHA}/releases.json`,
  ]);
  for (const read of result.hfRequests) {
    expect(read.headers).toMatchObject({ Authorization: "Bearer test-hf-token" });
  }
});

test("an invalid releases.json before or after the update is logged, and nothing is posted", async () => {
  const valid = nationalRecord(CURRENT, [OLDER, CURRENT]);
  // A record the release writer refuses: its current build is withdrawn.
  const invalid = nationalRecord(CURRENT, [OLDER, CURRENT, NEWEST], [CURRENT]);
  for (const [before, after] of [[valid, invalid], [invalid, valid]]) {
    const result = await postMainUpdate({ before, after });
    expect(result.status).toBe(200);
    expect(result.slackTexts).toEqual([]);
    expect(result.logged.some((line) => line.includes("releases.json"))).toBe(true);
  }
});

test("a releases.json that cannot be read is logged, and nothing is posted", async () => {
  const valid = nationalRecord(CURRENT, [OLDER, CURRENT, NEWEST]);
  const unreadable = [
    () => new Response("unavailable", { status: 503 }),
    // A missing revision is not a repository without releases.json.
    () => new Response("Revision not found", {
      status: 404,
      headers: { "X-Error-Code": "RevisionNotFound" },
    }),
  ];
  for (const after of unreadable) {
    const result = await postMainUpdate({ before: valid, after });
    expect(result.status).toBe(200);
    expect(result.slackTexts).toEqual([]);
    expect(result.logged.some((line) => line.includes("releases.json"))).toBe(true);
  }
});

test("a repository without releases.json gets no releases.json alert, and its new tags still alert", async () => {
  const tag = `${NATIONAL}-20261104T101500Z-0e0e0e0e`;
  const result = await postMainUpdate({ before: null, after: null, newTag: tag });

  expect(result.hfRequests).toHaveLength(2);
  expect(result.slackTexts).toEqual([]);
  expect(result.logged).toEqual([]);
  expect(result.tagAlerts).toEqual([tag]);
});

test("a staging repository's main update reads no releases.json", async () => {
  const result = await postMainUpdate({
    before: nationalRecord(CURRENT, [OLDER, CURRENT]),
    after: nationalRecord(NEWEST, [OLDER, CURRENT, NEWEST]),
    repo: REPOSITORIES.ukStaging,
  });

  expect(result.hfRequests).toEqual([]);
  expect(result.slackTexts).toEqual([]);
});
