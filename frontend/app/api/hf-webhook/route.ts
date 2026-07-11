import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import type { PopulaceCountry } from "@/lib/populace/latest-artifact";
import { loadLatestDelta } from "@/lib/populace/deltas";
import { postDeltaAlert, postReleaseAlert } from "@/lib/slack";

export const runtime = "nodejs";
// Push endpoint — must run on every call, never served from cache.
export const dynamic = "force-dynamic";

// HuggingFace fires this webhook on repo content changes. We only care about
// a newly created release *tag* (`oldSha: null`), which the publish pipeline
// names after the release id — so the alert is exactly-once per release with
// no polling and no stored state. See https://huggingface.co/docs/hub/webhooks
interface UpdatedRef {
  ref: string;
  oldSha: string | null;
  newSha: string | null;
}

interface WebhookPayload {
  repo?: { name?: string };
  updatedRefs?: UpdatedRef[];
}

const TAG_PREFIX = "refs/tags/";

// Only these repos may trigger a release alert. The webhook secret is shared
// across US and UK, so without an allowlist a valid caller could spoof an
// arbitrary repo name into either Slack channel.
const ALLOWED_REPOS: Record<string, PopulaceCountry> = {
  "policyengine/populace-us": "us",
  "policyengine/populace-uk": "uk",
};

function countryForRepo(repoName: string): PopulaceCountry | null {
  return ALLOWED_REPOS[repoName.toLowerCase()] ?? null;
}

// Constant-time secret check. HF sends the configured secret as the
// `X-Webhook-Secret` header, or as a `?secret=` query param.
function secretOk(request: Request): boolean {
  const expected = process.env.HF_WEBHOOK_SECRET;
  if (!expected) return false;
  const provided =
    request.headers.get("x-webhook-secret") ??
    new URL(request.url).searchParams.get("secret") ??
    "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!secretOk(request)) {
    return NextResponse.json({ detail: "Invalid webhook secret" }, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = (await request.json()) as WebhookPayload;
  } catch {
    return NextResponse.json({ detail: "Invalid JSON" }, { status: 400 });
  }

  const repo = payload.repo?.name ?? "";
  const country = countryForRepo(repo);
  const newTags = (payload.updatedRefs ?? [])
    // A newly created tag has no prior sha: oldSha is null OR absent.
    .filter((r) => r.ref?.startsWith(TAG_PREFIX) && r.oldSha == null && r.newSha)
    .map((r) => r.ref.slice(TAG_PREFIX.length))
    .filter(Boolean);

  // Acknowledge (200) non-release events and unknown repos so HF doesn't retry,
  // but never alert for a repo outside the allowlist.
  if (!country || newTags.length === 0) {
    return NextResponse.json({ ok: true, alerted: [] });
  }
  const alerted: string[] = [];
  for (const releaseId of newTags) {
    try {
      const sent = await postReleaseAlert({ country, releaseId, repo });
      if (sent) alerted.push(releaseId);
    } catch (error) {
      // A Slack hiccup must not make HF treat the delivery as failed.
      console.error(`Slack alert failed for ${releaseId}:`, error);
    }
  }

  // Follow the release ping with the computed headline delta (latest vs the
  // previous registry release) — the epic's "on new latest.json, post the delta
  // table". Best-effort and read-fresh; a failure here never fails the webhook.
  let deltaPosted = false;
  try {
    const report = await loadLatestDelta(0, country);
    if (report.available) {
      deltaPosted = await postDeltaAlert({ country, report });
    }
  } catch (error) {
    console.error("Delta alert failed:", error);
  }

  return NextResponse.json({ ok: true, country, alerted, deltaPosted });
}
