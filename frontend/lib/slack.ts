import type { PopulaceCountry } from "@/lib/populace/latest-artifact";

const DASHBOARD_URL = "https://calibration-diagnostics.vercel.app/populace";

const COUNTRY_LABEL: Record<PopulaceCountry, string> = {
  us: "🇺🇸 US",
  uk: "🇬🇧 UK",
};

// Post a "new release" alert to a Slack incoming webhook.
export async function postReleaseAlert(
  webhookUrl: string,
  opts: {
    country: PopulaceCountry;
    releaseId: string;
    updatedAt: string | null;
    repo: string;
  },
): Promise<void> {
  const label = COUNTRY_LABEL[opts.country];
  const when = opts.updatedAt ? `published ${opts.updatedAt}` : "";
  const context = [opts.repo, when, `<${DASHBOARD_URL}|open calibration diagnostics>`]
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
}
