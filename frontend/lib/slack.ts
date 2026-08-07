import type { MicrocosmCountry } from "@/lib/microcosm/latest-artifact";

const DASHBOARD_URL = "https://microcosm.institute/calibration/dashboard/microcosm";

const COUNTRY_LABEL: Record<MicrocosmCountry, string> = {
  us: "🇺🇸 US",
  uk: "🇬🇧 UK",
};

const WEBHOOK_ENV: Record<MicrocosmCountry, string> = {
  us: "SLACK_WEBHOOK_POPULACE_US",
  uk: "SLACK_WEBHOOK_POPULACE_UK",
};

// Post a "new release" alert to the country's Slack incoming webhook.
// No-op (returns false) when that channel's webhook env var is unset.
export async function postReleaseAlert(opts: {
  country: MicrocosmCountry;
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
    text: `New Microcosm ${opts.country.toUpperCase()} release: ${opts.releaseId}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:rocket: *New Microcosm ${label} release*\n\`${opts.releaseId}\``,
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
