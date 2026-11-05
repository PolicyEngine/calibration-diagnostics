import type { MicrocosmCountry } from "@policyengine/calibration-tree/latest-artifact";

import type { ReleaseRecordAlert } from "@/lib/microcosm/release-record-alerts";

const DASHBOARD_URL = "https://microcosm.institute/calibration/dashboard/microcosm";

const COUNTRY_LABEL: Partial<Record<MicrocosmCountry, string>> = {
  us: "🇺🇸 US",
  uk: "🇬🇧 UK",
  be: "🇧🇪 BE",
};

const WEBHOOK_ENV: Partial<Record<MicrocosmCountry, string>> = {
  // Deprecated upstream identifiers: the configured webhook variables still
  // use the former Populace names.
  us: "SLACK_WEBHOOK_POPULACE_US",
  uk: "SLACK_WEBHOOK_POPULACE_UK",
};

interface SlackPayload {
  text: string;
  blocks: unknown[];
}

// Slack's limits on a message: a section's text holds 1 to 3,000
// characters, and a message holds at most 50 blocks.
const SECTION_TEXT_LIMIT = 3000;
const BLOCK_LIMIT = 50;

/**
 * A value shown in Slack's formatted text, with `&`, `<` and `>` escaped as
 * Slack requires, so a value can never mention a channel or form a link.
 * Release, build and repository names are safe identifiers already; this is
 * for values the dashboard does not check, such as a tag's name or a
 * build's `published_at`.
 */
export function slackEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// The context shown under every release alert: the repository, the
// publication time when known, and the dashboard link.
function alertContext(repo: string, publishedAt?: string | null) {
  return {
    type: "context",
    elements: [{
      type: "mrkdwn",
      text: [
        slackEscape(repo),
        publishedAt ? `published ${slackEscape(publishedAt)}` : "",
        `<${DASHBOARD_URL}|calibration diagnostics>`,
      ]
        .filter(Boolean)
        .join(" · "),
    }],
  };
}

const section = (text: string) => ({ type: "section", text: { type: "mrkdwn", text } });

/**
 * Lines as section blocks within Slack's limits: as many whole lines per
 * section as fit in 3,000 characters, no empty section, and at most
 * `maxBlocks` sections, the last one saying how many lines were left out.
 */
function lineSections(lines: string[], maxBlocks: number) {
  const sections: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > SECTION_TEXT_LIMIT && current) {
      sections.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) sections.push(current);
  if (sections.length > maxBlocks) {
    const kept = sections.slice(0, maxBlocks - 1);
    const shownLines = kept.reduce((count, text) => count + text.split("\n").length, 0);
    kept.push(`…and ${lines.length - shownLines} more`);
    return kept.map(section);
  }
  return sections.map(section);
}

/**
 * Whether the country has a Slack channel for release alerts: its incoming
 * webhook variable is set in `environment`.
 */
export function hasReleaseAlertChannel(
  country: MicrocosmCountry,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const webhookEnv = WEBHOOK_ENV[country];
  return Boolean(webhookEnv && environment[webhookEnv]);
}

// Post to the country's Slack incoming webhook. No-op (returns false) when
// that channel's webhook env var is unset.
async function postToCountryChannel(
  country: MicrocosmCountry,
  payload: SlackPayload,
): Promise<boolean> {
  const webhookEnv = WEBHOOK_ENV[country];
  if (!webhookEnv) return false;
  const webhookUrl = process.env[webhookEnv];
  if (!webhookUrl) return false;

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack webhook ${res.status}: ${body.slice(0, 200)}`);
  }
  return true;
}

// Post a "new release" alert for a new Hugging Face tag.
export async function postReleaseAlert(opts: {
  country: MicrocosmCountry;
  releaseId: string;
  repo: string;
  updatedAt?: string | null;
}): Promise<boolean> {
  const label = COUNTRY_LABEL[opts.country] ?? opts.country.toUpperCase();
  // A tag's name comes from the repository, unchecked.
  const releaseId = slackEscape(opts.releaseId);
  return postToCountryChannel(opts.country, {
    text: `New Microcosm ${opts.country.toUpperCase()} release: ${releaseId}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:rocket: *New Microcosm ${label} release*\n\`${releaseId}\``,
        },
      },
      alertContext(opts.repo, opts.updatedAt),
    ],
  });
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * The Slack message for one change to a repository's releases.json: its
 * sentence (also the notification text) and, for the summary sent when the
 * record is created, one entry per release.
 */
export function releaseRecordAlertPayload(
  country: MicrocosmCountry,
  repo: string,
  alert: ReleaseRecordAlert,
): SlackPayload {
  const microcosm = `Microcosm ${country.toUpperCase()}`;
  const name = (build: string | null) => (build == null ? "none" : `\`${build}\``);
  switch (alert.kind) {
    case "published": {
      const build = `\`${alert.release}/${alert.build}\``;
      const outcome = alert.becameCurrent
        ? "now current"
        : alert.currentBuild == null
          ? `published, not current (\`${alert.release}\` has no current build)`
          : `published, not current (current stays \`${alert.currentBuild}\`)`;
      const text = `New ${microcosm} build ${build}: ${outcome}`;
      return { text, blocks: [section(text), alertContext(repo, alert.publishedAt)] };
    }
    case "current_changed": {
      const text =
        `${microcosm} \`${alert.release}\`: current build changed from ` +
        `${name(alert.from)} to ${name(alert.to)}`;
      return { text, blocks: [section(text), alertContext(repo)] };
    }
    case "withdrawn": {
      const text = `${microcosm} build \`${alert.release}/${alert.build}\` withdrawn`;
      return { text, blocks: [section(text), alertContext(repo)] };
    }
    case "record_created": {
      const text =
        `${microcosm} now records its releases in \`releases.json\`: ` +
        `${plural(alert.buildCount, "build")} in ${plural(alert.releases.length, "release")}`;
      const releases = alert.releases.map(({ release, currentBuild }) =>
        currentBuild == null
          ? `• \`${release}\`: no current build`
          : `• \`${release}\`: current build \`${currentBuild}\``
      );
      // The sentence and the context take two of the message's blocks.
      return {
        text,
        blocks: [section(text), ...lineSections(releases, BLOCK_LIMIT - 2), alertContext(repo)],
      };
    }
  }
}

// Post one releases.json alert to the country's channel; false when the
// channel has no webhook configured.
export async function postReleaseRecordAlert(opts: {
  country: MicrocosmCountry;
  repo: string;
  alert: ReleaseRecordAlert;
}): Promise<boolean> {
  return postToCountryChannel(
    opts.country,
    releaseRecordAlertPayload(opts.country, opts.repo, opts.alert),
  );
}
