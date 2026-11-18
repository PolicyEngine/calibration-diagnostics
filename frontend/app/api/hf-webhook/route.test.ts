import { afterEach, expect, jest, spyOn, test } from "bun:test";

import {
  resolveHfWebhookConfig,
  type HfWebhookConfig,
} from "@/lib/microcosm/hf-webhook-config";
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
  [REPOSITORIES.usRelease, { country: "us", kind: "release", repo: REPOSITORIES.usRelease }],
  [REPOSITORIES.usStaging, { country: "us", kind: "staging", repo: REPOSITORIES.usStaging }],
  [REPOSITORIES.ukRelease, { country: "uk", kind: "release", repo: REPOSITORIES.ukRelease }],
  [REPOSITORIES.ukStaging, { country: "uk", kind: "staging", repo: REPOSITORIES.ukStaging }],
  [REPOSITORIES.beRelease, { country: "be", kind: "release", repo: REPOSITORIES.beRelease }],
]);

function webhookConfig(
  overrides: Partial<HfWebhookConfig> = {},
): HfWebhookConfig {
  return {
    secret: "test-webhook-secret",
    huggingFaceToken: undefined,
    // The countries whose Slack channel is configured, as in production.
    releaseAlertCountries: new Set(["us", "uk"]),
    repositories: new Map(TEST_REPOSITORIES),
    ...overrides,
  };
}

// These tests' repositories have no releases.json: the webhook's reads of it
// get Hugging Face's "entry not found" 404 and never reach the test's own
// fetch, which sees every other request.
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

function request(
  payload: unknown,
  secret = "test-webhook-secret",
  extraHeaders: Record<string, string> = {},
) {
  return new Request("https://dashboard.example/api/hf-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-secret": secret,
      ...extraHeaders,
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

test("webhook rejects invalid authentication before sending any request", async () => {
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

test("webhook acknowledges unrelated repositories without sending any request", async () => {
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

test("staging tag updates are acknowledged without a tree build request", async () => {
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
  expect(await response.json()).toEqual({ ok: true, country: "us", alerted: [] });
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
  const treeBuildRequests: string[] = [];
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
    if (url === TREE_BUILDS_URL) {
      treeBuildRequests.push(String(init?.body));
      return queuedTreeBuild("queued", "uk", "release")();
    }
    const revision = /\/resolve\/([0-9a-f]{40})\/releases\.json$/.exec(url)?.[1];
    if (revision) {
      hfRequests.push({ url, headers: init?.headers });
      return answer(revision === BEFORE_SHA ? options.before : options.after);
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const originalFetch = globalThis.fetch;
  const priorWebhook = process.env.SLACK_WEBHOOK_MICROCOSM_UK;
  process.env.SLACK_WEBHOOK_MICROCOSM_UK = UK_SLACK_WEBHOOK;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) !== UK_SLACK_WEBHOOK) throw new Error(`Unexpected URL ${String(input)}`);
    const payload = JSON.parse(String(init?.body));
    if (options.slackRefuses?.(payload.text)) return new Response("invalid_blocks", { status: 500 });
    slackPayloads.push(payload);
    return new Response("ok");
  }) as typeof fetch;
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const warned = spyOn(console, "warn").mockImplementation(() => {});
  const answerLog = spyOn(console, "info").mockImplementation(() => {});
  try {
    const response = await createHfWebhookHandler(
      webhookConfig({
        huggingFaceToken: token,
        treeBuildCollector: { baseUrl: COLLECTOR_URL },
      }),
      {
        fetch: fetchImplementation,
        vercelOidcToken: async () => OIDC_TOKEN,
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
      treeBuildRequests,
      tagAlerts,
      slackPayloads,
      slackTexts: slackPayloads.map((payload) => payload.text),
      logged: logged.mock.calls.map((call) => call.map(String).join(" ")),
      warned: warned.mock.calls.map((call) => call.map(String).join(" ")),
    };
  } finally {
    logged.mockRestore();
    warned.mockRestore();
    answerLog.mockRestore();
    globalThis.fetch = originalFetch;
    if (priorWebhook == null) delete process.env.SLACK_WEBHOOK_MICROCOSM_UK;
    else process.env.SLACK_WEBHOOK_MICROCOSM_UK = priorWebhook;
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
  // The collector is asked to queue a tree build as well.
  expect(result.treeBuildRequests).toHaveLength(1);
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
    // Retrying would not help, so the collector request and the tag alert go ahead.
    expect(result.treeBuildRequests).toHaveLength(1);
    expect(result.tagAlerts).toHaveLength(1);
  }
});

test("a transient failure reading releases.json answers 503 before requesting a tree build or posting anything, so Hugging Face's retry posts each alert once", async () => {
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
    expect(result.treeBuildRequests).toEqual([]);
    expect(result.tagAlerts).toEqual([]);
    expect(result.slackTexts).toEqual([]);
    expect(result.logged.some((line) => line.includes("releases.json"))).toBe(true);
  }
  // The retried delivery, once Hugging Face answers, does everything once.
  const retried = await postMainUpdate({ before, after, newTag });
  expect(retried.status).toBe(200);
  expect(retried.treeBuildRequests).toHaveLength(1);
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
  expect(result.treeBuildRequests).toEqual([]);
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
  expect(result.treeBuildRequests).toHaveLength(1);
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

test("a release repository whose country has no Slack channel reads no releases.json, so that read cannot answer 503", async () => {
  const result = await postMainUpdate({
    before: nationalRecord(CURRENT, [OLDER, CURRENT]),
    after: () => new Response("unavailable", { status: 503 }),
    repo: REPOSITORIES.beRelease,
  });

  expect(result.status).toBe(200);
  expect(result.hfRequests).toEqual([]);
  expect(result.treeBuildRequests).toHaveLength(1);
  expect(result.body).not.toHaveProperty("release_record_alerted");
});

test("a deleted releases.json, a change of default release and an un-withdrawal are logged and post nothing", async () => {
  const record = nationalRecord(CURRENT, [OLDER, CURRENT], [OLDER]);
  const deleted = await postMainUpdate({ before: record, after: null });
  expect(deleted.slackTexts).toEqual([]);
  expect(deleted.warned.join("\n")).toContain(`releases.json was removed from ${REPOSITORIES.ukRelease}`);
  // Only the release picker's folder listing takes its place: no reader goes
  // to tags or pointer files, and the collector builds no new release tree.
  expect(deleted.warned.join("\n")).toContain("lists its folders");
  expect(deleted.warned.join("\n")).not.toContain("pointer files");

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
    alerted: [],
    tree_build: { status: "not_configured" },
  });
});

test("a main update's answer lists the releases.json alerts it posted", async () => {
  const result = await postMainUpdateResponse({
    before: nationalRecord(CURRENT, [OLDER, CURRENT]),
    after: nationalRecord(CURRENT, [OLDER, CURRENT], [OLDER]),
  });

  expect(result.release_record_alerted).toEqual([`withdrawn ${NATIONAL}/${OLDER}`]);
});

// -- Calibration-tree builds queued in the collector -------------------------
//
// Each delivery that starts a build asks the telemetry collector to queue a
// calibration-tree build of the country and kind,
// `POST /v1/calibration-tree-builds` (microcosm-collector#66). All values are
// synthetic: the collector is a placeholder address answered by a fake, and
// the Vercel OIDC token is a fake value.

const COLLECTOR_URL = "https://collector.example";
const TREE_BUILDS_URL = `${COLLECTOR_URL}/v1/calibration-tree-builds`;
const OIDC_TOKEN = "test-vercel-oidc-token";
const NOT_BEFORE = "2026-11-13T12:10:00+00:00";
// Text of a collector error answer, which must never reach the webhook's answer.
const COLLECTOR_REFUSAL = "collector-refusal-detail";
const RETRY_DETAIL = "Unable to queue the calibration tree build; retry the delivery.";

/** The collector's answer to one request, given the request's options. */
type CollectorAnswer = (init: RequestInit) => Response | Promise<Response>;

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

interface UpdatedRefPayload {
  ref: string;
  oldSha: string | null;
  newSha: string | null;
}

function treeBuildTaskId(country: string, kind: string): string {
  return `calibration-trees-${country}-${kind}-2950000`;
}

/** The collector's 202 answer for a queued request (#66's route). */
function queuedTreeBuild(
  outcome: "queued" | "already_queued" = "queued",
  country = "us",
  kind = "staging",
): () => Response {
  return () =>
    Response.json(
      {
        status: outcome,
        task_id: treeBuildTaskId(country, kind),
        country,
        kind,
        not_before: NOT_BEFORE,
      },
      { status: 202 },
    );
}

function delivery(repo: string, updatedRefs: UpdatedRefPayload[]) {
  return { repo: { name: repo }, updatedRefs };
}

function mainUpdate(newSha: string, oldSha: string | null = testSha(30)): UpdatedRefPayload {
  return { ref: "refs/heads/main", oldSha, newSha };
}

function newTag(name: string, newSha: string): UpdatedRefPayload {
  return { ref: `refs/tags/${name}`, oldSha: null, newSha };
}

/**
 * A webhook whose fetch serves releases.json (Hugging Face's 404 unless
 * `releasesRecord` is given, which receives the read's URL) and the collector
 * (a 202 "queued" unless `collector` is given), records the collector
 * requests, and refuses every other address. The collector address is
 * configured unless `config` overrides it. The Slack alert senders post
 * nothing and return false unless given.
 */
function treeBuildWebhook(options: {
  collector?: CollectorAnswer;
  releasesRecord?: (url: string) => Response;
  config?: Partial<HfWebhookConfig>;
  vercelOidcToken?: () => Promise<string>;
  postReleaseAlert?: HfWebhookHandlerDependencies["postReleaseAlert"];
  postReleaseRecordAlert?: HfWebhookHandlerDependencies["postReleaseRecordAlert"];
} = {}) {
  const collectorRequests: CapturedRequest[] = [];
  let tokenReads = 0;
  const fetchImplementation: HfWebhookHandlerDependencies["fetch"] = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/releases.json")) {
      return options.releasesRecord?.(url) ?? missingReleasesRecord();
    }
    if (url.startsWith(`${COLLECTOR_URL}/`)) {
      collectorRequests.push({ url, init: init ?? {} });
      return (options.collector ?? queuedTreeBuild())(init ?? {});
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const POST = createHfWebhookHandler(
    webhookConfig({ treeBuildCollector: { baseUrl: COLLECTOR_URL }, ...options.config }),
    {
      fetch: fetchImplementation,
      postReleaseAlert: options.postReleaseAlert ?? (async () => false),
      postReleaseRecordAlert: options.postReleaseRecordAlert ?? (async () => false),
      vercelOidcToken:
        options.vercelOidcToken ??
        (async () => {
          tokenReads += 1;
          return OIDC_TOKEN;
        }),
    },
  );
  return { POST, collectorRequests, tokenReads: () => tokenReads };
}

/**
 * One delivery to a new treeBuildWebhook, with console.error and console.info
 * captured, sent with `webhookId` as its Webhook-Id header when given.
 */
async function deliver(
  payload: unknown,
  options: Parameters<typeof treeBuildWebhook>[0] = {},
  webhookId?: string,
) {
  const webhook = treeBuildWebhook(options);
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const answerLog = spyOn(console, "info").mockImplementation(() => {});
  try {
    const response = await webhook.POST(
      request(payload, undefined, webhookId ? { "webhook-id": webhookId } : {}),
    );
    const text = await response.text();
    return {
      status: response.status,
      text,
      body: JSON.parse(text),
      collectorRequests: webhook.collectorRequests,
      tokenReads: webhook.tokenReads(),
      logged: logged.mock.calls.map((call) => call.map(String).join(" ")),
      answersLogged: answerLog.mock.calls.map((call) => call.map(String).join(" ")),
    };
  } finally {
    logged.mockRestore();
    answerLog.mockRestore();
  }
}

function expectOneTreeBuildRequest(
  requests: CapturedRequest[],
  body: Record<string, unknown>,
) {
  expect(requests).toHaveLength(1);
  const [sent] = requests;
  expect(sent.url).toBe(TREE_BUILDS_URL);
  expect(sent.init.method).toBe("POST");
  expect(Object.fromEntries(new Headers(sent.init.headers).entries())).toEqual({
    authorization: `Bearer ${OIDC_TOKEN}`,
    "content-type": "application/json",
  });
  expect(JSON.parse(String(sent.init.body))).toEqual(body);
}

test("a staging repository's main update asks the collector to queue a staging calibration-tree build", async () => {
  for (const [repo, country] of [
    [REPOSITORIES.usStaging, "us"],
    [REPOSITORIES.ukStaging, "uk"],
  ] as const) {
    const commit = testSha(40);
    const result = await deliver(delivery(repo, [mainUpdate(commit)]));

    expect(result.status).toBe(200);
    expectOneTreeBuildRequest(result.collectorRequests, {
      country,
      kind: "staging",
      hf_repo: repo,
      hf_ref: "refs/heads/main",
      hf_commit: commit,
    });
  }
});

test("a release repository's new tag and main update in one delivery ask the collector for one release calibration-tree build, naming the tag", async () => {
  const tagCommit = testSha(41);
  const result = await deliver(
    delivery(REPOSITORIES.usRelease, [
      newTag("microcosm-us-2026-11-13", tagCommit),
      mainUpdate(testSha(42)),
    ]),
    { collector: queuedTreeBuild("queued", "us", "release") },
  );

  expect(result.status).toBe(200);
  expectOneTreeBuildRequest(result.collectorRequests, {
    country: "us",
    kind: "release",
    hf_repo: REPOSITORIES.usRelease,
    hf_ref: "refs/tags/microcosm-us-2026-11-13",
    hf_commit: tagCommit,
  });
});

test("a release repository's main update without a new tag asks the collector to queue a release calibration-tree build", async () => {
  const commit = testSha(43);
  const result = await deliver(delivery(REPOSITORIES.ukRelease, [mainUpdate(commit)]), {
    collector: queuedTreeBuild("queued", "uk", "release"),
  });

  expect(result.status).toBe(200);
  expectOneTreeBuildRequest(result.collectorRequests, {
    country: "uk",
    kind: "release",
    hf_repo: REPOSITORIES.ukRelease,
    hf_ref: "refs/heads/main",
    hf_commit: commit,
  });
});

test("a Belgian release asks the collector to queue a release calibration-tree build for be", async () => {
  const tagCommit = testSha(44);
  const result = await deliver(
    delivery(REPOSITORIES.beRelease, [newTag("microcosm-be-2026-11-13", tagCommit)]),
    { collector: queuedTreeBuild("queued", "be", "release") },
  );

  expect(result.status).toBe(200);
  expectOneTreeBuildRequest(result.collectorRequests, {
    country: "be",
    kind: "release",
    hf_repo: REPOSITORIES.beRelease,
    hf_ref: "refs/tags/microcosm-be-2026-11-13",
    hf_commit: tagCommit,
  });
});

test("a deployment that still holds the former GitHub dispatch settings sends its only request to the collector", async () => {
  // The settings are deleted by hand after this change is deployed, so a
  // deployment can run this code with them still present. Any request to
  // another address fails the fake's fetch.
  const repo = "policyengine/populace-us-staging";
  const commit = testSha(75);
  const result = await deliver(delivery(repo, [mainUpdate(commit)]), {
    config: resolveHfWebhookConfig({
      HF_WEBHOOK_SECRET: "test-webhook-secret",
      MICROCOSM_TELEMETRY_COLLECTOR_URL: COLLECTOR_URL,
      GITHUB_ACTIONS_DISPATCH_TOKEN: "former-dispatch-token",
      CALIBRATION_TREE_GITHUB_REPOSITORY: "example/dashboard",
      CALIBRATION_TREE_GITHUB_WORKFLOW: "publish.yml",
    }),
  });

  expect(result.status).toBe(200);
  expectOneTreeBuildRequest(result.collectorRequests, {
    country: "us",
    kind: "staging",
    hf_repo: repo,
    hf_ref: "refs/heads/main",
    hf_commit: commit,
  });
  expect(result.text).not.toContain("former-dispatch-token");
});

test("the collector request names the repository as configured, not as the delivery spells it", async () => {
  // The collector compares the name exactly, so neither the delivery's
  // spelling nor its lower-case form would do.
  const configured = "Example/us-Release";
  const result = await deliver(
    delivery("EXAMPLE/US-RELEASE", [mainUpdate(testSha(45))]),
    {
      config: {
        repositories: new Map([
          [configured.toLowerCase(), { country: "us", kind: "release", repo: configured }],
        ]),
      },
    },
  );

  expect(result.status).toBe(200);
  expect(result.collectorRequests).toHaveLength(1);
  expect(JSON.parse(String(result.collectorRequests[0].init.body)).hf_repo).toBe(configured);
});

test("a malformed ref or commit is left out of the collector request, which is still sent", async () => {
  // Tag names the collector's ref pattern refuses: a leading dot, a space,
  // and more than 200 characters.
  for (const tag of [".hidden", "two words", "a".repeat(201)]) {
    const commit = testSha(46);
    const result = await deliver(delivery(REPOSITORIES.beRelease, [newTag(tag, commit)]));

    expect(result.status).toBe(200);
    expectOneTreeBuildRequest(result.collectorRequests, {
      country: "be",
      kind: "release",
      hf_repo: REPOSITORIES.beRelease,
      hf_commit: commit,
    });
  }

  // Commits that are not 40 lower-case hexadecimal characters.
  for (const commit of ["A".repeat(40), "abc123"]) {
    const result = await deliver(delivery(REPOSITORIES.usStaging, [mainUpdate(commit)]));

    expect(result.status).toBe(200);
    expectOneTreeBuildRequest(result.collectorRequests, {
      country: "us",
      kind: "staging",
      hf_repo: REPOSITORIES.usStaging,
      hf_ref: "refs/heads/main",
    });
  }
});

test("the Vercel OIDC token is read for each collector request, never when the handler is created", async () => {
  const tokens = ["first-oidc-token", "second-oidc-token"];
  let reads = 0;
  const webhook = treeBuildWebhook({
    vercelOidcToken: async () => tokens[reads++] ?? "unexpected-oidc-token",
  });

  expect(reads).toBe(0);
  for (const commit of [testSha(47), testSha(48)]) {
    const response = await webhook.POST(
      request(delivery(REPOSITORIES.usStaging, [mainUpdate(commit)])),
    );
    expect(response.status).toBe(200);
  }

  expect(reads).toBe(2);
  expect(
    webhook.collectorRequests.map((sent) => new Headers(sent.init.headers).get("Authorization")),
  ).toEqual(["Bearer first-oidc-token", "Bearer second-oidc-token"]);
});

test("a 202 from the collector answers 200 with its queued or already_queued tree build", async () => {
  for (const outcome of ["queued", "already_queued"] as const) {
    const result = await deliver(delivery(REPOSITORIES.ukStaging, [mainUpdate(testSha(50))]), {
      collector: queuedTreeBuild(outcome, "uk", "staging"),
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      country: "uk",
      alerted: [],
      tree_build: {
        status: outcome,
        task_id: treeBuildTaskId("uk", "staging"),
        not_before: NOT_BEFORE,
      },
    });
    expect(result.logged).toEqual([]);
  }
});

/**
 * A failed collector request. A failure that may pass answers 503, so that
 * Hugging Face retries the delivery; a lasting one answers 200.
 */
function expectFailedTreeBuild(
  result: Awaited<ReturnType<typeof deliver>>,
  expectedStatus: 200 | 503,
) {
  expect(result.status).toBe(expectedStatus);
  if (expectedStatus === 503) {
    expect(result.body.detail).toBe(RETRY_DETAIL);
    expect(result.body).not.toHaveProperty("ok");
    expect(result.logged.some((entry) => entry.includes("answering 503"))).toBe(true);
  } else {
    expect(result.body.ok).toBe(true);
    expect(result.logged.some((entry) => entry.includes("answering 503"))).toBe(false);
  }
  expect(result.body.tree_build).toMatchObject({ status: "failed" });
  expect(Object.keys(result.body.tree_build).sort()).toEqual(["detail", "status"]);
  expect(typeof result.body.tree_build.detail).toBe("string");
  expect(result.logged.length).toBeGreaterThan(0);
  // Neither the token nor the collector's own text reaches the answer, and
  // the token is never logged.
  expect(result.text).not.toContain(OIDC_TOKEN);
  expect(result.text).not.toContain(COLLECTOR_REFUSAL);
  expect(result.logged.join("\n")).not.toContain(OIDC_TOKEN);
}

test("a collector refusal that a retry cannot change is a failed tree build: logged with its status, and the delivery answers 200", async () => {
  for (const code of [401, 403, 404, 413, 422]) {
    const result = await deliver(delivery(REPOSITORIES.usStaging, [mainUpdate(testSha(51))]), {
      collector: () => Response.json({ detail: COLLECTOR_REFUSAL }, { status: code }),
    });

    expectFailedTreeBuild(result, 200);
    expect(result.body.tree_build.detail).toContain(String(code));
    expect(result.logged.some((entry) => entry.includes(String(code)))).toBe(true);
  }
});

test("a collector answer that may pass is a failed tree build answered 503, so Hugging Face retries the delivery", async () => {
  for (const code of [429, 500, 502, 503, 504]) {
    const result = await deliver(delivery(REPOSITORIES.usStaging, [mainUpdate(testSha(51))]), {
      collector: () => Response.json({ detail: COLLECTOR_REFUSAL }, { status: code }),
    });

    expectFailedTreeBuild(result, 503);
    expect(result.body).toEqual({
      detail: RETRY_DETAIL,
      tree_build: { status: "failed", detail: `The collector answered HTTP ${code}.` },
    });
    expect(result.logged.some((entry) => entry.includes(String(code)))).toBe(true);
  }
});

test("a network failure or a timeout reaching the collector is a failed tree build answered 503", async () => {
  const failures: Array<[CollectorAnswer, string]> = [
    [() => { throw new TypeError("fetch failed"); }, "could not be reached"],
    [() => { throw new DOMException("The operation timed out.", "TimeoutError"); }, "15 seconds"],
  ];
  for (const [failure, detail] of failures) {
    const result = await deliver(delivery(REPOSITORIES.usStaging, [mainUpdate(testSha(52))]), {
      collector: failure,
    });

    expectFailedTreeBuild(result, 503);
    expect(result.body.tree_build.detail).toContain(detail);
    expect(result.collectorRequests).toHaveLength(1);
    expect(result.collectorRequests[0].init.signal).toBeInstanceOf(AbortSignal);
  }
});

// Failures that may pass: an error status, a collector that cannot be reached,
// and one that does not answer within the time limit.
const COLLECTOR_FAILURES_THAT_MAY_PASS: CollectorAnswer[] = [
  () => Response.json({ detail: COLLECTOR_REFUSAL }, { status: 503 }),
  () => {
    throw new TypeError("fetch failed");
  },
  () => {
    throw new DOMException("The operation timed out.", "TimeoutError");
  },
];

// Failures a retry cannot change: refusals, and a 202 that is not a queued build.
const LASTING_COLLECTOR_FAILURES: CollectorAnswer[] = [
  () => Response.json({ detail: COLLECTOR_REFUSAL }, { status: 403 }),
  () => Response.json({ detail: COLLECTOR_REFUSAL }, { status: 404 }),
  () => Response.json({ detail: COLLECTOR_REFUSAL }, { status: 422 }),
  () => new Response(COLLECTOR_REFUSAL, { status: 202 }),
];

function ukRecordsWithdrawingOlder(before: string, after: string) {
  const records: Record<string, Record<string, unknown>> = {
    [before]: nationalRecord(CURRENT, [OLDER, CURRENT]),
    [after]: nationalRecord(CURRENT, [OLDER, CURRENT], [OLDER]),
  };
  return (url: string) => {
    const revision = /\/resolve\/([0-9a-f]{40})\/releases\.json$/.exec(url)?.[1];
    if (!revision || !(revision in records)) throw new Error(`Unexpected URL ${url}`);
    return Response.json(records[revision]);
  };
}

test("a lasting collector failure still lets a release repository's new tag post its Slack alert: the answer is 200, names the tag in alerted and reports a failed tree build", async () => {
  const tag = "microcosm-us-2026-11-14";
  for (const collector of LASTING_COLLECTOR_FAILURES) {
    const posted: string[] = [];
    const result = await deliver(delivery(REPOSITORIES.usRelease, [newTag(tag, testSha(72))]), {
      collector,
      postReleaseAlert: async ({ releaseId }) => {
        posted.push(releaseId);
        return true;
      },
    });

    expectFailedTreeBuild(result, 200);
    expect(result.collectorRequests).toHaveLength(1);
    expect(posted).toEqual([tag]);
    expect(result.body.alerted).toEqual([tag]);
  }
});

test("a lasting collector failure still lets a UK main update post its releases.json alerts: the answer is 200, names them in release_record_alerted and reports a failed tree build", async () => {
  const before = testSha(73);
  const after = testSha(74);
  for (const collector of LASTING_COLLECTOR_FAILURES) {
    const posted: string[] = [];
    const result = await deliver(delivery(REPOSITORIES.ukRelease, [mainUpdate(after, before)]), {
      collector,
      releasesRecord: ukRecordsWithdrawingOlder(before, after),
      postReleaseRecordAlert: async ({ alert }) => {
        posted.push(alert.kind);
        return true;
      },
    });

    expectFailedTreeBuild(result, 200);
    expect(result.collectorRequests).toHaveLength(1);
    expect(posted).toEqual(["withdrawn"]);
    expect(result.body.release_record_alerted).toEqual([`withdrawn ${NATIONAL}/${OLDER}`]);
  }
});

test("a collector failure that may pass answers 503 before any Slack alert, and the retried delivery posts each alert once", async () => {
  const tag = "microcosm-uk-2026-11-14";
  const before = testSha(76);
  const after = testSha(77);
  const update = delivery(REPOSITORIES.ukRelease, [newTag(tag, after), mainUpdate(after, before)]);
  for (const collector of COLLECTOR_FAILURES_THAT_MAY_PASS) {
    const tagAlerts: string[] = [];
    const recordAlerts: string[] = [];
    const senders = {
      releasesRecord: ukRecordsWithdrawingOlder(before, after),
      postReleaseAlert: async ({ releaseId }: { releaseId: string }) => {
        tagAlerts.push(releaseId);
        return true;
      },
      postReleaseRecordAlert: async ({ alert }: { alert: { kind: string } }) => {
        recordAlerts.push(alert.kind);
        return true;
      },
    };

    const failed = await deliver(update, { ...senders, collector });
    expectFailedTreeBuild(failed, 503);
    expect(tagAlerts).toEqual([]);
    expect(recordAlerts).toEqual([]);

    const retried = await deliver(update, {
      ...senders,
      collector: queuedTreeBuild("already_queued", "uk", "release"),
    });
    expect(retried.status).toBe(200);
    expect(retried.collectorRequests).toHaveLength(1);
    expect(tagAlerts).toEqual([tag]);
    expect(recordAlerts).toEqual(["withdrawn"]);
  }
});

test("the log records each answer to a delivery that starts a build, with its Webhook-Id, repository, ref and commit", async () => {
  const webhookId = "test-webhook-delivery";
  const commit = testSha(79);
  const update = delivery(REPOSITORIES.ukRelease, [mainUpdate(commit)]);
  const described =
    `Hugging Face delivery ${webhookId} for ${REPOSITORIES.ukRelease} refs/heads/main at ${commit}`;

  const collectorFailure = await deliver(
    update,
    { collector: () => new Response(COLLECTOR_REFUSAL, { status: 503 }) },
    webhookId,
  );
  expect(collectorFailure.status).toBe(503);
  expect(collectorFailure.logged).toContain(`Answered 503 to ${described}.`);
  expect(collectorFailure.answersLogged).toEqual([]);

  const recordFailure = await deliver(
    update,
    { releasesRecord: () => new Response("unavailable", { status: 503 }) },
    webhookId,
  );
  expect(recordFailure.status).toBe(503);
  expect(recordFailure.logged).toContain(`Answered 503 to ${described}.`);

  // A retry or replay reuses the Webhook-Id, so its 200 follows the 503s above.
  const retried = await deliver(update, {}, webhookId);
  expect(retried.status).toBe(200);
  expect(retried.answersLogged).toEqual([`Answered 200 to ${described}.`]);

  const lastingFailure = await deliver(
    update,
    { collector: () => new Response(COLLECTOR_REFUSAL, { status: 403 }) },
    webhookId,
  );
  expect(lastingFailure.status).toBe(200);
  expect(lastingFailure.answersLogged).toEqual([`Answered 200 to ${described}.`]);

  const withoutId = await deliver(update);
  expect(withoutId.answersLogged).toEqual([
    `Answered 200 to Hugging Face delivery without a Webhook-Id for ${REPOSITORIES.ukRelease} refs/heads/main at ${commit}.`,
  ]);
});

test("a delivery that starts no build logs no answer", async () => {
  const result = await deliver(
    delivery(REPOSITORIES.usStaging, [newTag("not-a-finalized-run", testSha(80))]),
  );

  expect(result.status).toBe(200);
  expect(result.answersLogged).toEqual([]);
  expect(result.logged).toEqual([]);
});

/** An answer of the given status whose body read fails with `error`. */
function bodyReadFailure(error: Error, status = 202): CollectorAnswer {
  return () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(error);
        },
      }),
      { status },
    );
}

test("a network failure's log names its cause, never the request's headers or the token", async () => {
  // Node's fetch throws TypeError("fetch failed"), or "terminated" while it
  // reads a body, and names what failed only in the error's cause.
  const failures: Array<{ collector: CollectorAnswer; detail: string; cause: string }> = [
    {
      collector: () => {
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("getaddrinfo ENOTFOUND collector.example"), {
            code: "ENOTFOUND",
          }),
        });
      },
      detail: "The collector could not be reached.",
      cause: "getaddrinfo ENOTFOUND collector.example",
    },
    {
      // A connection refused at every address: an AggregateError without a
      // message, whose code names the failure.
      collector: () => {
        throw new TypeError("fetch failed", {
          cause: Object.assign(new AggregateError([], ""), { code: "ECONNREFUSED" }),
        });
      },
      detail: "The collector could not be reached.",
      cause: "ECONNREFUSED",
    },
    {
      collector: bodyReadFailure(
        new TypeError("terminated", { cause: new Error("other side closed") }),
      ),
      detail: "The collector's HTTP 202 answer could not be read.",
      cause: "other side closed",
    },
  ];
  for (const failure of failures) {
    const result = await deliver(delivery(REPOSITORIES.usStaging, [mainUpdate(testSha(71))]), {
      collector: failure.collector,
    });

    expectFailedTreeBuild(result, 503);
    expect(result.body.tree_build.detail).toBe(failure.detail);
    const logged = result.logged.join("\n");
    expect(logged).toContain(failure.cause);
    expect(logged.toLowerCase()).not.toContain("authorization");
    expect(logged).not.toContain("Bearer");
    // The answer keeps its fixed sentence.
    expect(result.text).not.toContain(failure.cause);
  }
});

test("a 202 whose body is not the collector's queued answer is a failed tree build answered 200", async () => {
  const unreadable: CollectorAnswer[] = [
    () => new Response(COLLECTOR_REFUSAL, { status: 202 }),
    () => Response.json({ status: COLLECTOR_REFUSAL, task_id: "x", not_before: NOT_BEFORE }, { status: 202 }),
    () => Response.json({ status: "queued" }, { status: 202 }),
  ];
  for (const answer of unreadable) {
    const result = await deliver(delivery(REPOSITORIES.usStaging, [mainUpdate(testSha(53))]), {
      collector: answer,
    });

    expectFailedTreeBuild(result, 200);
  }
});

test("the collector's answer is logged with at most 200 characters of its body", async () => {
  const longBody = "z".repeat(1_000);
  const answers: CollectorAnswer[] = [
    () => new Response(longBody, { status: 422 }),
    () => new Response(longBody, { status: 202 }),
  ];
  for (const answer of answers) {
    const result = await deliver(delivery(REPOSITORIES.usStaging, [mainUpdate(testSha(67))]), {
      collector: answer,
    });

    expectFailedTreeBuild(result, 200);
    const logged = result.logged.join("\n");
    expect(logged).toContain("z".repeat(200));
    expect(logged).not.toContain("z".repeat(201));
    expect(result.text).not.toContain("z".repeat(10));
  }
});

test("a 202 whose body cannot be read is a failed tree build answered 503", async () => {
  const result = await deliver(delivery(REPOSITORIES.usStaging, [mainUpdate(testSha(68))]), {
    collector: bodyReadFailure(new TypeError("terminated")),
  });

  expectFailedTreeBuild(result, 503);
  expect(result.body.tree_build.detail).toBe("The collector's HTTP 202 answer could not be read.");
  expect(result.logged.some((entry) => entry.includes("terminated"))).toBe(true);
});

test("when an error answer's body cannot be read, its status decides whether the delivery is retried", async () => {
  const cases: Array<[number, 200 | 503]> = [[404, 200], [503, 503]];
  for (const [code, expectedStatus] of cases) {
    const result = await deliver(delivery(REPOSITORIES.usStaging, [mainUpdate(testSha(78))]), {
      collector: bodyReadFailure(new TypeError("terminated"), code),
    });

    expectFailedTreeBuild(result, expectedStatus);
    expect(result.body.tree_build.detail).toBe(`The collector's HTTP ${code} answer could not be read.`);
  }

  // A timeout while reading a refusal's body is still decided by the refusal.
  const timedOut = await deliver(delivery(REPOSITORIES.usStaging, [mainUpdate(testSha(81))]), {
    collector: bodyReadFailure(new DOMException("The operation timed out.", "TimeoutError"), 404),
  });
  expectFailedTreeBuild(timedOut, 200);
  expect(timedOut.body.tree_build.detail).toBe("The collector did not answer within 15 seconds.");
});

const TREE_BUILD_TIME_LIMIT_MS = 15_000;

/**
 * A response body that never arrives. As with fetch, aborting the request's
 * signal errors the body being read, with the signal's reason.
 */
function bodyThatNeverArrives(signal: AbortSignal | null | undefined): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      signal?.addEventListener("abort", () => controller.error(signal.reason), { once: true });
    },
  });
}

async function runPendingContinuations() {
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
}

/**
 * Turns the real clock back on and restores console.error after a
 * deliverAtTimeLimit call, or null when none is pending. The call's finally
 * block runs it when the test's wait settles. A test that waits until Bun's
 * per-test timeout never reaches that block, so the afterEach below runs it
 * instead, and the tests after it in the same process see the real clock and
 * the real console.error.
 */
let restoreAfterTimeLimitDelivery: (() => void) | null = null;

afterEach(() => {
  restoreAfterTimeLimitDelivery?.();
});

/**
 * One delivery on Bun's fake clock, which also moves AbortSignal.timeout.
 * The collector request's time limit starts with its token read. From the
 * moment `readToken` is called, the clock moves one second at a time to 1 ms
 * before the limit, where the answer must still be pending, and then to the
 * limit.
 */
async function deliverAtTimeLimit(
  payload: unknown,
  options: { readToken: () => Promise<string>; collector?: CollectorAnswer },
) {
  let markTokenReadStarted!: () => void;
  const tokenReadStarted = new Promise<void>((resolve) => {
    markTokenReadStarted = resolve;
  });
  const webhook = treeBuildWebhook({
    collector: options.collector,
    vercelOidcToken: () => {
      markTokenReadStarted();
      return options.readToken();
    },
  });
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const answerLog = spyOn(console, "info").mockImplementation(() => {});
  jest.useFakeTimers();
  let restored = false;
  // Runs once, from the finally block or from afterEach, whichever comes
  // first, so a timed-out call's late finally never undoes a later call.
  const restore = () => {
    if (restored) return;
    restored = true;
    if (restoreAfterTimeLimitDelivery === restore) restoreAfterTimeLimitDelivery = null;
    jest.useRealTimers();
    logged.mockRestore();
    answerLog.mockRestore();
  };
  restoreAfterTimeLimitDelivery = restore;
  try {
    let answered = false;
    const answer = webhook.POST(request(payload));
    void answer.then(() => {
      answered = true;
    });
    await tokenReadStarted;
    for (let elapsed = 0; elapsed < TREE_BUILD_TIME_LIMIT_MS - 1; ) {
      const step = Math.min(1_000, TREE_BUILD_TIME_LIMIT_MS - 1 - elapsed);
      jest.advanceTimersByTime(step);
      elapsed += step;
      await runPendingContinuations();
    }
    const answeredBeforeLimit = answered;
    jest.advanceTimersByTime(1);
    const response = await answer;
    const text = await response.text();
    return {
      answeredBeforeLimit,
      status: response.status,
      text,
      body: JSON.parse(text),
      collectorRequests: webhook.collectorRequests,
      tokenReads: webhook.tokenReads(),
      logged: logged.mock.calls.map((call) => call.map(String).join(" ")),
      answersLogged: answerLog.mock.calls.map((call) => call.map(String).join(" ")),
    };
  } finally {
    restore();
  }
}

test("the 15-second time limit covers the Vercel OIDC token read: a read that never settles is a failed tree build answered 200", async () => {
  const result = await deliverAtTimeLimit(
    delivery(REPOSITORIES.usStaging, [mainUpdate(testSha(69))]),
    { readToken: () => new Promise<string>(() => {}) },
  );

  expect(result.answeredBeforeLimit).toBe(false);
  expectFailedTreeBuild(result, 200);
  expect(result.body.tree_build.detail).toBe("The Vercel OIDC token could not be read.");
  expect(result.collectorRequests).toEqual([]);
});

test("one 15-second time limit covers the token read and the collector's 202 answer together: after a 5-second token read, a body that never arrives is a failed tree build answered 503", async () => {
  const result = await deliverAtTimeLimit(
    delivery(REPOSITORIES.usStaging, [mainUpdate(testSha(70))]),
    {
      readToken: () => new Promise<string>((resolve) => setTimeout(() => resolve(OIDC_TOKEN), 5_000)),
      collector: (init) =>
        new Response(bodyThatNeverArrives(init.signal), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        }),
    },
  );

  // The answer comes 15 seconds after the token read began, not 15 seconds
  // after the request was sent.
  expect(result.answeredBeforeLimit).toBe(false);
  expectFailedTreeBuild(result, 503);
  expect(result.body.tree_build.detail).toBe("The collector did not answer within 15 seconds.");
  expect(result.collectorRequests).toHaveLength(1);
});

test("a failed Vercel OIDC token read is a failed tree build answered 200, with no collector request", async () => {
  const failedReads: Array<() => Promise<string>> = [
    async () => {
      throw new Error("The 'x-vercel-oidc-token' header is missing from the request.");
    },
    async () => "",
  ];
  for (const vercelOidcToken of failedReads) {
    const result = await deliver(delivery(REPOSITORIES.usStaging, [mainUpdate(testSha(54))]), {
      vercelOidcToken,
    });

    expect(result.collectorRequests).toEqual([]);
    expectFailedTreeBuild(result, 200);
  }
});

test("an invalid collector address is a failed tree build answered 200 on every delivery", async () => {
  const invalidAddress = "http://collector.example";
  const { treeBuildCollector } = resolveHfWebhookConfig({
    MICROCOSM_TELEMETRY_COLLECTOR_URL: invalidAddress,
  });
  const webhook = treeBuildWebhook({ config: { treeBuildCollector } });
  const logged = spyOn(console, "error").mockImplementation(() => {});
  try {
    for (const commit of [testSha(55), testSha(56)]) {
      const response = await webhook.POST(
        request(delivery(REPOSITORIES.usStaging, [mainUpdate(commit)])),
      );
      const text = await response.text();
      const body = JSON.parse(text);

      expect(response.status).toBe(200);
      expect(body.tree_build).toMatchObject({ status: "failed" });
      expect(text).not.toContain(invalidAddress);
    }
    expect(webhook.collectorRequests).toEqual([]);
    expect(webhook.tokenReads()).toBe(0);
    expect(logged.mock.calls).toHaveLength(2);
  } finally {
    logged.mockRestore();
  }
});

test("without a collector address, no collector request is sent and the answer's tree build is not_configured", async () => {
  const result = await deliver(delivery(REPOSITORIES.usStaging, [mainUpdate(testSha(57))]), {
    config: { treeBuildCollector: undefined },
  });

  expect(result.status).toBe(200);
  expect(result.collectorRequests).toEqual([]);
  expect(result.tokenReads).toBe(0);
  expect(result.body).toEqual({
    ok: true,
    country: "us",
    alerted: [],
    tree_build: { status: "not_configured" },
  });
  expect(result.logged).toEqual([]);
});

test("a transient releases.json failure answers 503 before the collector request, and the retried delivery sends it once", async () => {
  const update = delivery(REPOSITORIES.ukRelease, [mainUpdate(testSha(59))]);
  const unavailable = await deliver(update, {
    releasesRecord: () => new Response("unavailable", { status: 503 }),
  });

  expect(unavailable.status).toBe(503);
  expect(unavailable.body).toEqual({
    detail: "Unable to read releases.json; retry the delivery.",
  });
  expect(unavailable.collectorRequests).toEqual([]);
  expect(unavailable.tokenReads).toBe(0);

  const retried = await deliver(update, {
    collector: queuedTreeBuild("already_queued", "uk", "release"),
  });
  expect(retried.status).toBe(200);
  expect(retried.collectorRequests).toHaveLength(1);
});

test("deliveries that start no build send no collector request", async () => {
  const webhook = treeBuildWebhook();
  const noBuild: Array<[unknown, Record<string, unknown>]> = [
    // An unregistered repository.
    [
      delivery("someone/unregistered", [mainUpdate(testSha(60))]),
      { ok: true, alerted: [] },
    ],
    // No new tag and no main update.
    [
      delivery(REPOSITORIES.usRelease, [
        { ref: "refs/heads/other", oldSha: testSha(61), newSha: testSha(62) },
        { ref: "refs/tags/moved", oldSha: testSha(63), newSha: testSha(64) },
      ]),
      { ok: true, alerted: [] },
    ],
    // A staging repository's new tag starts no build.
    [
      delivery(REPOSITORIES.usStaging, [newTag("not-a-finalized-run", testSha(65))]),
      { ok: true, country: "us", alerted: [] },
    ],
  ];
  for (const [payload, answer] of noBuild) {
    const response = await webhook.POST(request(payload));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(JSON.stringify(answer));
  }
  expect(webhook.collectorRequests).toEqual([]);
  expect(webhook.tokenReads()).toBe(0);

  // The same webhook sends one for a delivery that starts a build, so the
  // checks above are not met merely because it never sends any.
  await webhook.POST(request(delivery(REPOSITORIES.usStaging, [mainUpdate(testSha(66))])));
  expect(webhook.collectorRequests).toHaveLength(1);
});
