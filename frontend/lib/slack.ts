import type { PopulaceCountry } from "@/lib/populace/latest-artifact";
import { deltaSlackPayload, type DeltaReport } from "@/lib/populace/deltas";

const DASHBOARD_URL = "https://populace.dev/calibration/dashboard/populace";
const COMPARE_URL = "https://populace.dev/calibration/dashboard/populace/compare";

const COUNTRY_LABEL: Record<PopulaceCountry, string> = {
  us: "🇺🇸 US",
  uk: "🇬🇧 UK",
};

const WEBHOOK_ENV: Record<PopulaceCountry, string> = {
  us: "SLACK_WEBHOOK_POPULACE_US",
  uk: "SLACK_WEBHOOK_POPULACE_UK",
};

// Post a "new release" alert to the country's Slack incoming webhook.
// No-op (returns false) when that channel's webhook env var is unset.
export async function postReleaseAlert(opts: {
  country: PopulaceCountry;
  releaseId: string;
  repo: string;
  updatedAt?: string | null;
}): Promise<boolean> {
  const webhookUrl = process.env[WEBHOOK_ENV[opts.country]];
  if (!webhookUrl) return false;

  const label = COUNTRY_LABEL[opts.country];
  const context = [
    opts.repo,
    opts.updatedAt ? `published ${opts.updatedAt}` : "",
    `<${DASHBOARD_URL}|calibration diagnostics>`,
  ]
    .filter(Boolean)
    .join(" · ");

  const payload = {
    text: `New Populace ${opts.country.toUpperCase()} release: ${opts.releaseId}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:rocket: *New Populace ${label} release*\n\`${opts.releaseId}\``,
        },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: context }],
      },
    ],
  };

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

// Post a computed release-delta table to the country's Slack incoming webhook.
// No-op (returns false) when that channel's webhook env var is unset — the same
// SLACK_WEBHOOK_POPULACE_{US,UK} the populace publish CLI uses.
export async function postDeltaAlert(opts: {
  country: PopulaceCountry;
  report: DeltaReport;
}): Promise<boolean> {
  const webhookUrl = process.env[WEBHOOK_ENV[opts.country]];
  if (!webhookUrl) return false;

  const payload = deltaSlackPayload(opts.report, {
    dashboardUrl: COMPARE_URL,
    country: opts.country,
  });
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
