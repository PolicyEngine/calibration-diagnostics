// Optional Upstash/Vercel KV via its REST API. Used to remember the last
// release we alerted on, for exactly-once Slack alerts. When the KV env vars
// are absent the helpers degrade to no-ops and the caller falls back to a
// recency window instead.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

export const kvAvailable = Boolean(KV_URL && KV_TOKEN);

export async function kvGet(key: string): Promise<string | null> {
  if (!kvAvailable) return null;
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { result?: string | null } | null;
  return data?.result ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  if (!kvAvailable) return;
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  }).catch(() => {});
}
