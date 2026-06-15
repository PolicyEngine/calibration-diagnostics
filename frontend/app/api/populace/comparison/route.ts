import { NextResponse } from "next/server";

import {
  normalizeComparisonScorecard,
  snapshotComparisonScorecard,
} from "@/lib/populace/comparison-artifact";
import { scrub } from "@/lib/populace/latest-artifact";

// The incumbent comparison lives in PolicyEngine/populace-benchmarks
// (PolicyEngine/populace#37 moved it out of live populace). By default the
// route resolves that repo's latest.json pointer
// (PolicyEngine/populace-benchmarks#3) and serves the scorecard it names,
// falling back to the committed archived 9f1260b snapshot until the artifact
// is reachable. POPULACE_BENCHMARKS_POINTER_URL overrides the pointer;
// POPULACE_BENCHMARKS_SCORECARD_URL points straight at a scorecard (skips the
// pointer).
const BENCHMARKS_RAW_BASE =
  "https://raw.githubusercontent.com/PolicyEngine/populace-benchmarks/main";
const DEFAULT_POINTER_URL = `${BENCHMARKS_RAW_BASE}/benchmarks/us/incumbent-comparison/latest.json`;
const POINTER_URL =
  process.env.POPULACE_BENCHMARKS_POINTER_URL?.trim() || DEFAULT_POINTER_URL;
const DIRECT_SCORECARD_URL = process.env.POPULACE_BENCHMARKS_SCORECARD_URL?.trim();

type JsonObject = Record<string, unknown>;

export const revalidate = 300;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

async function fetchJson(url: string): Promise<JsonObject> {
  const response = await fetch(url, { next: { revalidate } });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return asObject(await response.json());
}

// Resolve a scorecard_path from the pointer against the same repo the pointer
// came from, so a custom POINTER_URL on a branch/fork resolves consistently.
function resolveScorecardUrl(pointerUrl: string, scorecardPath: string): string {
  if (/^https?:\/\//.test(scorecardPath)) return scorecardPath;
  const base = pointerUrl.replace(
    /\/benchmarks\/us\/incumbent-comparison\/latest\.json$/,
    "",
  );
  return `${base}/${scorecardPath.replace(/^\/+/, "")}`;
}

async function loadLiveScorecard(): Promise<JsonObject> {
  if (DIRECT_SCORECARD_URL) {
    const raw = await fetchJson(DIRECT_SCORECARD_URL);
    return {
      available: true,
      source: "populace_benchmarks_live",
      path: DIRECT_SCORECARD_URL,
      scorecard_status: typeof raw.status === "string" ? raw.status : null,
      ...normalizeComparisonScorecard(raw),
    };
  }
  const pointer = await fetchJson(POINTER_URL);
  const scorecardPath = pointer.scorecard_path;
  if (typeof scorecardPath !== "string" || !scorecardPath) {
    throw new Error(`Pointer ${POINTER_URL} has no scorecard_path.`);
  }
  const scorecardUrl = resolveScorecardUrl(POINTER_URL, scorecardPath);
  const raw = await fetchJson(scorecardUrl);
  return {
    available: true,
    source: "populace_benchmarks_live",
    path: scorecardUrl,
    pointer_url: POINTER_URL,
    scorecard_status:
      typeof pointer.status === "string"
        ? pointer.status
        : typeof raw.status === "string"
          ? raw.status
          : null,
    ...normalizeComparisonScorecard(raw),
  };
}

export async function GET() {
  const snapshot = snapshotComparisonScorecard();
  let payload: JsonObject = snapshot;
  let liveError: string | null = null;

  try {
    payload = await loadLiveScorecard();
  } catch (error) {
    liveError = error instanceof Error ? error.message : String(error);
    payload = snapshot;
  }

  const live = payload.source === "populace_benchmarks_live";
  const scorecardStatus =
    typeof payload.scorecard_status === "string" ? payload.scorecard_status : "archived";

  return NextResponse.json(
    scrub({
      ...payload,
      // "archived" = serving the committed snapshot (not reached live). Distinct
      // from scorecard_status, which is the artifact's own provenance.
      archived: !live,
      scorecard_status: scorecardStatus,
      source_pointer: live ? (payload.pointer_url ?? POINTER_URL) : POINTER_URL,
      live_scorecard_error: liveError,
      notes: [
        "Populace (candidate) is scored against the enhanced CPS (incumbent) with a matched-household, symmetric-refit, held-out-target protocol.",
        live
          ? `Served live from populace-benchmarks (${scorecardStatus} scorecard).`
          : "The benchmarks scorecard was not reachable, so this is the committed archived snapshot for release populace-us-2024-9f1260b-20260611 (PolicyEngine/populace-benchmarks#3 / #4 publish it).",
        "The eCPS comparison is benchmark-harness material and intentionally lives outside live populace (PolicyEngine/populace#37); the live calibration-fit view is the populace release summary.",
      ],
    }),
  );
}
