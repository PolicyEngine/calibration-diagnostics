import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import type { PopulaceCountry } from "@/lib/populace/latest-artifact";
import { postReleaseAlert } from "@/lib/slack";

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

function countryForRepo(repoName: string): PopulaceCountry {
  return repoName.toLowerCase().includes("uk") ? "uk" : "us";
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
  const newTags = (payload.updatedRefs ?? [])
    .filter((r) => r.ref?.startsWith(TAG_PREFIX) && r.oldSha === null && r.newSha)
    .map((r) => r.ref.slice(TAG_PREFIX.length))
    .filter(Boolean);

  // Acknowledge non-release events (commits, deletions, discussions) so HF
  // doesn't retry them.
  if (!repo || newTags.length === 0) {
    return NextResponse.json({ ok: true, alerted: [] });
  }

  const country = countryForRepo(repo);
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

  return NextResponse.json({ ok: true, country, alerted });
}
