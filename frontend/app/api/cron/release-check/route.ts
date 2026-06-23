import { NextResponse } from "next/server";

import { kvAvailable, kvGet, kvSet } from "@/lib/kv";
import {
  loadPointerReleaseId,
  populaceRepo,
  type PopulaceCountry,
} from "@/lib/populace/latest-artifact";
import { postReleaseAlert } from "@/lib/slack";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const COUNTRIES: PopulaceCountry[] = ["us", "uk"];

// When KV isn't configured we can't dedupe by release id, so we fall back to a
// recency window: alert if latest.json was updated within this many minutes.
// Kept a touch above the cron interval so a release is never missed (at the
// cost of a rare duplicate). Add a KV store for exactly-once alerts.
const RECENCY_MS = 15 * 60 * 1000;

function webhookFor(country: PopulaceCountry): string | undefined {
  return country === "uk"
    ? process.env.SLACK_WEBHOOK_POPULACE_UK
    : process.env.SLACK_WEBHOOK_POPULACE_US;
}

export async function GET(request: Request) {
  // Vercel cron invocations carry Authorization: Bearer <CRON_SECRET> when the
  // CRON_SECRET env var is set; reject anything else so the route isn't a public
  // trigger.
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown>[] = [];
  for (const country of COUNTRIES) {
    const webhook = webhookFor(country);
    if (!webhook) {
      results.push({ country, skipped: "no webhook configured" });
      continue;
    }
    try {
      const pointer = await loadPointerReleaseId(0, country);
      if (!pointer.release_id) {
        results.push({ country, skipped: "no release" });
        continue;
      }

      const key = `populace:last-release:${country}`;
      let isNew: boolean;
      if (kvAvailable) {
        const last = await kvGet(key);
        if (last === null) {
          // First run with KV: baseline silently so we don't alert on the
          // release that was already current before alerts were enabled.
          await kvSet(key, pointer.release_id);
          results.push({ country, initialized: pointer.release_id });
          continue;
        }
        isNew = last !== pointer.release_id;
      } else {
        const ts = pointer.updated_at ? Date.parse(pointer.updated_at) : NaN;
        isNew = Number.isFinite(ts) && Date.now() - ts < RECENCY_MS;
      }

      if (isNew) {
        await postReleaseAlert(webhook, {
          country,
          releaseId: pointer.release_id,
          updatedAt: pointer.updated_at,
          repo: populaceRepo(country),
        });
        if (kvAvailable) await kvSet(key, pointer.release_id);
        results.push({ country, alerted: pointer.release_id });
      } else {
        results.push({ country, release: pointer.release_id, alerted: false });
      }
    } catch (error) {
      results.push({
        country,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({ ok: true, kv: kvAvailable, results });
}
