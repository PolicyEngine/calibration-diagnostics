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
    huggingFaceToken: undefined,
    // The countries whose Slack channel is configured, as in production.
    releaseAlertCountries: new Set(["us", "uk"]),
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
  /** The update's oldSha; BEFORE_SHA unless given (null for a new main). */
  oldSha?: string | null;
  /** The configured Hugging Face token; "test-hf-token" unless given. */
  token?: string;
  /** Messages the Slack fake refuses with a 500. */
  slackRefuses?: (text: string) => boolean;
}) {
  const repo = options.repo ?? REPOSITORIES.ukRelease;
  const oldSha = "oldSha" in options ? options.oldSha ?? null : BEFORE_SHA;
  const token = "token" in options ? options.token : "test-hf-token";
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
    const payload = JSON.parse(String(init?.body));
    if (options.slackRefuses?.(payload.text)) return new Response("invalid_blocks", { status: 500 });
    slackPayloads.push(payload);
    return new Response("ok");
  }) as typeof fetch;
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const warned = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const response = await createHfWebhookHandler(
      webhookConfig({ huggingFaceToken: token }),
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
        { ref: "refs/heads/main", oldSha, newSha: AFTER_SHA },
      ],
    }));
    return {
      status: response.status,
      body: await response.json(),
      hfRequests,
      dispatches,
      tagAlerts,
      slackPayloads,
      slackTexts: slackPayloads.map((payload) => payload.text),
      logged: logged.mock.calls.map((call) => call.map(String).join(" ")),
      warned: warned.mock.calls.map((call) => call.map(String).join(" ")),
    };
  } finally {
    logged.mockRestore();
    warned.mockRestore();
    globalThis.fetch = originalFetch;
    if (priorWebhook == null) delete process.env.SLACK_WEBHOOK_POPULACE_UK;
    else process.env.SLACK_WEBHOOK_POPULACE_UK = priorWebhook;
  }
}

async function postMainUpdateResponse(options: Parameters<typeof postMainUpdate>[0]) {
  return (await postMainUpdate(options)).body;
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

test("a releases.json that cannot be read for a lasting reason is logged, and nothing is posted", async () => {
  const valid = nationalRecord(CURRENT, [OLDER, CURRENT, NEWEST]);
  const unreadable = [
    // A missing revision is not a repository without releases.json.
    () => new Response("Revision not found", {
      status: 404,
      headers: { "X-Error-Code": "RevisionNotFound" },
    }),
    // A token that cannot read the repository.
    () => new Response("Unauthorized", { status: 401 }),
  ];
  for (const after of unreadable) {
    const result = await postMainUpdate({ before: valid, after, newTag: `${NATIONAL}-20261104T101500Z-0e0e0e0e` });
    expect(result.status).toBe(200);
    expect(result.slackTexts).toEqual([]);
    expect(result.logged.some((line) => line.includes("releases.json"))).toBe(true);
    // Retrying would not help, so the dispatch and the tag alert go ahead.
    expect(result.dispatches).toHaveLength(1);
    expect(result.tagAlerts).toHaveLength(1);
  }
});

test("a transient failure reading releases.json answers 503 before dispatching or posting anything, so Hugging Face's retry posts each alert once", async () => {
  const before = nationalRecord(CURRENT, [OLDER, CURRENT]);
  const after = nationalRecord(NEWEST, [OLDER, CURRENT, NEWEST]);
  const newTag = `${NATIONAL}-20261104T101500Z-0e0e0e0e`;
  const transient: Array<() => Response> = [
    () => new Response("unavailable", { status: 503 }),
    () => new Response("rate limited", { status: 429 }),
    () => {
      throw new TypeError("fetch failed");
    },
    () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    },
  ];
  for (const failure of transient) {
    const result = await postMainUpdate({ before, after: failure, newTag });
    expect(result.status).toBe(503);
    expect(result.dispatches).toEqual([]);
    expect(result.tagAlerts).toEqual([]);
    expect(result.slackTexts).toEqual([]);
    expect(result.logged.some((line) => line.includes("releases.json"))).toBe(true);
  }
  // The retried delivery, once Hugging Face answers, does everything once.
  const retried = await postMainUpdate({ before, after, newTag });
  expect(retried.status).toBe(200);
  expect(retried.dispatches).toHaveLength(1);
  expect(retried.tagAlerts).toEqual([newTag]);
  expect(retried.slackTexts).toEqual([`New Microcosm UK build \`${NATIONAL}/${NEWEST}\`: now current`]);
});

test("a connection that fails while the body of releases.json is read is transient, so the delivery is retried", async () => {
  const before = nationalRecord(CURRENT, [OLDER, CURRENT]);
  const after = nationalRecord(NEWEST, [OLDER, CURRENT, NEWEST]);
  // The headers arrive, then the body fails, as a timeout or a dropped
  // connection does.
  const failingBody = () => new Response(new ReadableStream({
    start(controller) {
      controller.error(new TypeError("terminated"));
    },
  }), { status: 200 });

  const result = await postMainUpdate({ before, after: failingBody, newTag: `${NATIONAL}-20261104T101500Z-0e0e0e0e` });

  expect(result.status).toBe(503);
  expect(result.dispatches).toEqual([]);
  expect(result.tagAlerts).toEqual([]);
  expect(result.slackTexts).toEqual([]);
});

test("when one side fails for a lasting reason and the other transiently, the lasting failure decides: no retry", async () => {
  // A record the release writer refuses before the update cannot become
  // readable by retrying, so the delivery is not retried for the other side.
  const refused = nationalRecord(CURRENT, [OLDER, CURRENT], [CURRENT]);
  const result = await postMainUpdate({
    before: refused,
    after: () => new Response("unavailable", { status: 503 }),
  });

  expect(result.status).toBe(200);
  expect(result.dispatches).toHaveLength(1);
  expect(result.slackTexts).toEqual([]);
  expect(result.body.release_record_problem ?? "").toContain("is withdrawn");
});

test("a lasting failure is named in the answer, and a record that did not change is not", async () => {
  const record = nationalRecord(CURRENT, [OLDER, CURRENT]);
  const lasting = await postMainUpdate({
    before: record,
    after: () => new Response("Unauthorized", { status: 401 }),
  });
  expect(lasting.body.release_record_alerted).toEqual([]);
  expect(lasting.body.release_record_problem ?? "").toContain("401");

  const unchanged = await postMainUpdate({ before: record, after: record });
  expect(unchanged.body.release_record_alerted).toEqual([]);
  expect(unchanged.body).not.toHaveProperty("release_record_problem");
});

test("a release repository whose country has no Slack channel reads no releases.json and is never answered 503", async () => {
  const result = await postMainUpdate({
    before: nationalRecord(CURRENT, [OLDER, CURRENT]),
    after: () => new Response("unavailable", { status: 503 }),
    repo: REPOSITORIES.beRelease,
  });

  expect(result.status).toBe(200);
  expect(result.hfRequests).toEqual([]);
  expect(result.dispatches).toHaveLength(1);
  expect(result.body).not.toHaveProperty("release_record_alerted");
});

test("a deleted releases.json, a change of default release and an un-withdrawal are logged and post nothing", async () => {
  const record = nationalRecord(CURRENT, [OLDER, CURRENT], [OLDER]);
  const deleted = await postMainUpdate({ before: record, after: null });
  expect(deleted.slackTexts).toEqual([]);
  expect(deleted.warned.join("\n")).toContain(`releases.json was removed from ${REPOSITORIES.ukRelease}`);

  const otherDefault = nationalRecord(CURRENT, [OLDER, CURRENT], [OLDER]);
  (otherDefault.releases as Record<string, unknown>)[DENSE] = {
    role: "local_area",
    current: null,
    builds: {},
  };
  otherDefault.default = DENSE;
  const defaultChanged = await postMainUpdate({ before: record, after: otherDefault });
  expect(defaultChanged.slackTexts).toEqual([]);
  expect(defaultChanged.warned.join("\n")).toContain(`default release changed from ${NATIONAL} to ${DENSE}`);

  const restored = await postMainUpdate({ before: record, after: nationalRecord(CURRENT, [OLDER, CURRENT]) });
  expect(restored.slackTexts).toEqual([]);
  expect(restored.warned.join("\n")).toContain(`${NATIONAL}/${OLDER} is no longer withdrawn`);
});

test("a main created by the update (oldSha null) reads releases.json only after it", async () => {
  const result = await postMainUpdate({
    before: null,
    after: nationalRecord(CURRENT, [OLDER, CURRENT]),
    oldSha: null,
  });

  expect(result.hfRequests.map((read) => read.url)).toEqual([
    `https://huggingface.co/datasets/${REPOSITORIES.ukRelease}/resolve/${AFTER_SHA}/releases.json`,
  ]);
  expect(result.slackTexts).toEqual([
    "Microcosm UK now records its releases in `releases.json`: 2 builds in 1 release",
  ]);
});

test("a Slack failure for one alert is logged, and the update's other alerts are still posted", async () => {
  const result = await postMainUpdate({
    before: nationalRecord(CURRENT, [OLDER, CURRENT]),
    after: nationalRecord(CURRENT, [OLDER, CURRENT, NEWEST], [OLDER]),
    slackRefuses: (text) => text.startsWith("New Microcosm"),
  });

  expect(result.status).toBe(200);
  expect(result.slackTexts).toEqual([`Microcosm UK build \`${NATIONAL}/${OLDER}\` withdrawn`]);
  expect(result.logged.some((line) => line.includes(`published ${NATIONAL}/${NEWEST}`))).toBe(true);
  expect(result.body.release_record_alerted).toEqual([`withdrawn ${NATIONAL}/${OLDER}`]);
});

test("without a Hugging Face token, releases.json is requested with no Authorization header", async () => {
  const result = await postMainUpdate({
    before: nationalRecord(CURRENT, [OLDER, CURRENT]),
    after: nationalRecord(CURRENT, [OLDER, CURRENT]),
    token: undefined,
  });

  expect(result.hfRequests).toHaveLength(2);
  for (const read of result.hfRequests) {
    expect(new Headers(read.headers).has("Authorization")).toBe(false);
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

test("a delivery without a main update answers as before, naming no releases.json alerts", async () => {
  const POST = handler(async () => new Response(null, { status: 204 }));

  const response = await POST(
    request({
      repo: { name: REPOSITORIES.ukRelease },
      updatedRefs: [
        { ref: "refs/tags/microcosm-uk-release", oldSha: null, newSha: "1".repeat(40) },
      ],
    }),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ok: true,
    country: "uk",
    dispatched: [
      { event_kind: "tag", release_id: "microcosm-uk-release", hf_commit_sha: "1".repeat(40) },
    ],
    alerted: [],
  });
});

test("a main update's answer lists the releases.json alerts it posted", async () => {
  const result = await postMainUpdateResponse({
    before: nationalRecord(CURRENT, [OLDER, CURRENT]),
    after: nationalRecord(CURRENT, [OLDER, CURRENT], [OLDER]),
  });

  expect(result.release_record_alerted).toEqual([`withdrawn ${NATIONAL}/${OLDER}`]);
});
