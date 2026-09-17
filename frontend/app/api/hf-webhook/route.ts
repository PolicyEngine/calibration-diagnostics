import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { selectableCountries, type MicrocosmCountry } from "@/lib/microcosm/countries";
import { microcosmRepo } from "@/lib/microcosm/latest-artifact";
import { postReleaseAlert } from "@/lib/slack";

export const runtime = "nodejs";
// Push endpoint — must run on every call, never served from cache.
export const dynamic = "force-dynamic";

// Hugging Face calls this endpoint for repository changes. New release tags
// publish immutable tree artifacts; updates to the repository's main branch
// re-read latest.json and advance the dashboard manifest when appropriate.
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
const MAIN_BRANCH_REF = "refs/heads/main";

// Only the registered country repositories may start a publication. The
// webhook secret is shared across countries, so without an allowlist a valid
// caller could spoof an arbitrary repo name into any Slack channel. Fixture
// registrations are never allowlisted. Repositories are the env-resolved ones
// the dashboard actually reads (a POPULACE_*_HF_REPO override moves the
// allowlist with it). Build the map per request from the server instance's
// resolved deployment configuration.
function allowedRepos(): Map<string, MicrocosmCountry> {
  const allowed = new Map<string, MicrocosmCountry>();
  for (const country of selectableCountries()) {
    try {
      allowed.set(microcosmRepo(country).toLowerCase(), country);
    } catch (error) {
      console.error(`Release alerts are disabled for ${country}:`, error);
    }
  }
  return allowed;
}

function countryForRepo(repoName: string): MicrocosmCountry | null {
  return allowedRepos().get(repoName.toLowerCase()) ?? null;
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

interface TreeBuildDispatch {
  country: MicrocosmCountry;
  eventKind: "tag" | "branch";
  releaseId?: string;
  hfCommitSha: string;
}

async function dispatchTreeBuild(input: TreeBuildDispatch): Promise<void> {
  const token = process.env.GITHUB_ACTIONS_DISPATCH_TOKEN?.trim();
  if (!token) throw new Error("GITHUB_ACTIONS_DISPATCH_TOKEN is not configured.");
  const repository =
    process.env.CALIBRATION_TREE_GITHUB_REPOSITORY?.trim() ||
    "PolicyEngine/calibration-diagnostics";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("CALIBRATION_TREE_GITHUB_REPOSITORY is invalid.");
  }
  const workflow =
    process.env.CALIBRATION_TREE_GITHUB_WORKFLOW?.trim() ||
    "publish-calibration-tree.yml";
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          country: input.country,
          event_kind: input.eventKind,
          release_id: input.releaseId ?? "",
          hf_commit_sha: input.hfCommitSha,
          backfill: false,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status !== 204) {
    const body = await response.text();
    throw new Error(
      `GitHub workflow dispatch returned ${response.status}: ${body.slice(0, 200)}`,
    );
  }
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
  const updatedRefs = payload.updatedRefs ?? [];
  const newTagRefs = updatedRefs
    // A newly created tag has no prior sha: oldSha is null OR absent.
    .filter((r) => r.ref?.startsWith(TAG_PREFIX) && r.oldSha == null && r.newSha);
  const newTags = newTagRefs
    .map((updatedRef) => updatedRef.ref.slice(TAG_PREFIX.length))
    .filter(Boolean);
  const mainUpdates = updatedRefs.filter(
    (updatedRef) =>
      updatedRef.ref === MAIN_BRANCH_REF && Boolean(updatedRef.newSha),
  );

  // Acknowledge unrelated events and unknown repositories so Hugging Face does
  // not retry them. Only allowlisted repository names can start a workflow.
  if (!country || (newTags.length === 0 && mainUpdates.length === 0)) {
    return NextResponse.json({ ok: true, dispatched: [], alerted: [] });
  }

  const dispatches: TreeBuildDispatch[] = [
    ...newTagRefs.map((updatedRef) => ({
      country,
      eventKind: "tag" as const,
      releaseId: updatedRef.ref.slice(TAG_PREFIX.length),
      hfCommitSha: updatedRef.newSha!,
    })),
    ...mainUpdates.map((updatedRef) => ({
      country,
      eventKind: "branch" as const,
      hfCommitSha: updatedRef.newSha!,
    })),
  ];
  try {
    for (const dispatch of dispatches) await dispatchTreeBuild(dispatch);
  } catch (error) {
    console.error("Calibration tree workflow dispatch failed:", error);
    return NextResponse.json(
      { detail: "Unable to start calibration tree publication." },
      { status: 502 },
    );
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

  return NextResponse.json({
    ok: true,
    country,
    dispatched: dispatches.map((dispatch) => ({
      event_kind: dispatch.eventKind,
      release_id: dispatch.releaseId ?? null,
      hf_commit_sha: dispatch.hfCommitSha,
    })),
    alerted,
  });
}
