import { afterEach, expect, test } from "bun:test";

import { parseReleasesRecord } from "@policyengine/calibration-tree/release-record";

import { postReleaseAlert, releaseRecordAlertPayload } from "@/lib/slack";

import { releaseRecordAlerts, type ReleaseRecordAlert } from "./release-record-alerts";

// releases.json records before and after one update of a release repository's
// main, compared directly. All values are synthetic.
const NATIONAL = "microcosm-uk-2024-25-national";
const DENSE = "microcosm-uk-2024-25-dense";
const OLDER = "uk-frs-calibration-attempt-20261014T214443Z-d12ff9b3";
const CURRENT = "uk-frs-calibration-attempt-20261019T083323Z-6cba5d71";
const NEWEST = "uk-frs-calibration-attempt-20261104T101500Z-0e0e0e0e";
const DENSE_BUILD = "uk-local-candidate-f100-s42-20261104T000432Z-ee5c2dbe";
const REPO = "example/uk-release";

interface ReleaseShape {
  role: string;
  current: string | null;
  builds: Record<string, { withdrawn?: boolean }>;
}

function record(releases: Record<string, ReleaseShape>, defaultRelease: string | null = NATIONAL) {
  return parseReleasesRecord({
    schema_version: 1,
    default: defaultRelease,
    releases: Object.fromEntries(Object.entries(releases).map(([release, entry]) => [
      release,
      {
        role: entry.role,
        current: entry.current,
        builds: Object.fromEntries(Object.entries(entry.builds).map(([build, flags]) => [
          build,
          { published_at: "2026-11-04T10:15:00+00:00", withdrawn: flags.withdrawn ?? false },
        ])),
      },
    ])),
  });
}

const national = (current: string | null, builds: ReleaseShape["builds"]) => ({
  [NATIONAL]: { role: "national", current, builds },
});

const texts = (alerts: ReleaseRecordAlert[]) =>
  alerts.map((alert) => releaseRecordAlertPayload("uk", REPO, alert).text);

test("several changes in one update are announced in order: new builds, current changes, withdrawals", () => {
  const before = record(national(OLDER, { [OLDER]: {}, [CURRENT]: {} }));
  const after = record({
    ...national(CURRENT, { [OLDER]: { withdrawn: true }, [CURRENT]: {}, [NEWEST]: {} }),
    [DENSE]: { role: "local_area", current: DENSE_BUILD, builds: { [DENSE_BUILD]: {} } },
  });

  expect(texts(releaseRecordAlerts(before, after))).toEqual([
    `New Microcosm UK build \`${DENSE}/${DENSE_BUILD}\`: now current`,
    `New Microcosm UK build \`${NATIONAL}/${NEWEST}\`: published, not current (current stays \`${CURRENT}\`)`,
    `Microcosm UK \`${NATIONAL}\`: current build changed from \`${OLDER}\` to \`${CURRENT}\``,
    `Microcosm UK build \`${NATIONAL}/${OLDER}\` withdrawn`,
  ]);
});

test("a new release's first build is announced as a newly published build", () => {
  const before = record(national(CURRENT, { [CURRENT]: {} }));
  const after = record({
    ...national(CURRENT, { [CURRENT]: {} }),
    [DENSE]: { role: "local_area", current: null, builds: { [DENSE_BUILD]: {} } },
  });

  expect(texts(releaseRecordAlerts(before, after))).toEqual([
    `New Microcosm UK build \`${DENSE}/${DENSE_BUILD}\`: published, not current (\`${DENSE}\` has no current build)`,
  ]);
});

test("a release's first current build is announced as a change from none", () => {
  const before = record({ [DENSE]: { role: "local_area", current: null, builds: { [DENSE_BUILD]: {} } } }, null);
  const after = record({ [DENSE]: { role: "local_area", current: DENSE_BUILD, builds: { [DENSE_BUILD]: {} } } }, null);

  expect(texts(releaseRecordAlerts(before, after))).toEqual([
    `Microcosm UK \`${DENSE}\`: current build changed from none to \`${DENSE_BUILD}\``,
  ]);
});

test("an unchanged record and an absent one give no alerts", () => {
  const unchanged = record(national(CURRENT, { [CURRENT]: {} }));
  expect(releaseRecordAlerts(unchanged, unchanged)).toEqual([]);
  expect(releaseRecordAlerts(null, null)).toEqual([]);
  expect(releaseRecordAlerts(unchanged, null)).toEqual([]);
});

// Slack refuses a section whose text is empty or longer than 3,000
// characters, and a message with more than 50 blocks.
const SECTION_TEXT_LIMIT = 3000;
const BLOCK_LIMIT = 50;

function sectionTexts(blocks: unknown[]): string[] {
  return blocks.flatMap((block) => {
    const value = block as { type?: string; text?: { text?: string } };
    return value.type === "section" ? [value.text?.text ?? ""] : [];
  });
}

test("the summary of a releases.json created with no releases has no empty section", () => {
  const payload = releaseRecordAlertPayload("uk", REPO, {
    kind: "record_created",
    buildCount: 0,
    releases: [],
  });

  expect(payload.text).toBe("Microcosm UK now records its releases in `releases.json`: 0 builds in 0 releases");
  for (const text of sectionTexts(payload.blocks)) expect(text.length).toBeGreaterThan(0);
});

test("the summary of a long releases.json stays within Slack's limits and names every release", () => {
  const releases = Array.from({ length: 60 }, (_, index) => ({
    release: `microcosm-uk-2024-25-local-k${String(index + 1).padStart(3, "0")}`,
    currentBuild: `uk-local-candidate-f100-s42-20261104T${String(index).padStart(6, "0")}Z-ee5c2dbe`,
  }));
  const payload = releaseRecordAlertPayload("uk", REPO, {
    kind: "record_created",
    buildCount: 60,
    releases,
  });

  const sections = sectionTexts(payload.blocks);
  expect(payload.blocks.length).toBeLessThanOrEqual(BLOCK_LIMIT);
  for (const text of sections) {
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(SECTION_TEXT_LIMIT);
  }
  const listed = sections.join("\n");
  for (const { release, currentBuild } of releases) {
    expect(listed).toContain(`\`${release}\`: current build \`${currentBuild}\``);
  }
});

test("a publication time is escaped for Slack's formatted text", () => {
  const payload = releaseRecordAlertPayload("uk", REPO, {
    kind: "published",
    release: NATIONAL,
    build: NEWEST,
    publishedAt: "<!channel> & <https://example.org|label>",
    becameCurrent: true,
    currentBuild: NEWEST,
  });

  const shown = JSON.stringify(payload.blocks);
  expect(shown).toContain("published &lt;!channel&gt; &amp; &lt;https://example.org|label&gt;");
  expect(shown).not.toContain("<!channel>");
});

const originalFetch = globalThis.fetch;
const priorWebhook = process.env.SLACK_WEBHOOK_POPULACE_UK;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (priorWebhook == null) delete process.env.SLACK_WEBHOOK_POPULACE_UK;
  else process.env.SLACK_WEBHOOK_POPULACE_UK = priorWebhook;
});

test("a tag name is escaped in its release alert", async () => {
  const placeholderWebhook = "https://hooks.slack.example/services/uk-placeholder";
  const posted: string[] = [];
  process.env.SLACK_WEBHOOK_POPULACE_UK = placeholderWebhook;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) !== placeholderWebhook) throw new Error(`Unexpected URL ${String(input)}`);
    posted.push(String(init?.body));
    return new Response("ok");
  }) as typeof fetch;

  await postReleaseAlert({ country: "uk", releaseId: "release<!here>&more", repo: REPO });

  expect(posted).toHaveLength(1);
  const body = JSON.parse(posted[0]);
  expect(body.text).toContain("release&lt;!here&gt;&amp;more");
  expect(JSON.stringify(body.blocks)).toContain("release&lt;!here&gt;&amp;more");
  expect(posted[0]).not.toContain("<!here>");
});
