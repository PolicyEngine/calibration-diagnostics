import { NextResponse } from "next/server";

import {
  normalizeComparisonScorecard,
  snapshotComparisonScorecard,
} from "@/lib/populace/comparison-artifact";
import { scrub } from "@/lib/populace/latest-artifact";

// The live incumbent-comparison scorecard is not published yet
// (PolicyEngine/populace-benchmarks#3). When it is, point this at the artifact
// (a raw GitHub URL or HF resolve URL) and the route serves it live, falling
// back to the committed archived 9f1260b snapshot on any failure.
const BENCHMARKS_SCORECARD_URL = process.env.POPULACE_BENCHMARKS_SCORECARD_URL?.trim();

type JsonObject = Record<string, unknown>;

export const revalidate = 300;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

async function loadLiveScorecard(url: string): Promise<JsonObject> {
  const response = await fetch(url, { next: { revalidate } });
  if (!response.ok) {
    throw new Error(`Failed to fetch scorecard ${url}: ${response.status}`);
  }
  return {
    available: true,
    source: "populace_benchmarks_live",
    path: url,
    ...normalizeComparisonScorecard(asObject(await response.json())),
  };
}

export async function GET() {
  const snapshot = snapshotComparisonScorecard();
  let payload = snapshot;
  let liveError: string | null = null;

  if (BENCHMARKS_SCORECARD_URL) {
    try {
      payload = (await loadLiveScorecard(BENCHMARKS_SCORECARD_URL)) as typeof snapshot;
    } catch (error) {
      liveError = error instanceof Error ? error.message : String(error);
      payload = snapshot;
    }
  }

  const archived = payload.source !== "populace_benchmarks_live";

  return NextResponse.json(
    scrub({
      ...payload,
      archived,
      live_scorecard_configured: Boolean(BENCHMARKS_SCORECARD_URL),
      live_scorecard_error: liveError,
      notes: [
        "Populace (candidate) is scored against the enhanced CPS (incumbent) with a matched-household, symmetric-refit, held-out-target protocol.",
        archived
          ? "This is the archived scorecard for release populace-us-2024-9f1260b-20260611. The live incumbent comparison is not published as a machine-readable artifact yet (PolicyEngine/populace-benchmarks#3); set POPULACE_BENCHMARKS_SCORECARD_URL to serve it live once it is."
          : "Served live from the configured populace-benchmarks scorecard.",
        "The eCPS comparison is benchmark-harness material and intentionally lives outside live populace (PolicyEngine/populace#37); the live calibration-fit view is the populace release summary.",
      ],
    }),
  );
}
