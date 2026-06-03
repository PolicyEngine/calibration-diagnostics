import { NextResponse } from "next/server";

export const revalidate = 300;

export async function GET() {
  return NextResponse.json({
    available: false,
    reason:
      "The deployed Vercel frontend can read committed public Microplex JSON summaries, but full target diagnostics live in generated run bundles. Configure a hosted Python backend with MICROPLEX_ARTIFACT_ROOTS and NEXT_PUBLIC_API_URL to expose this endpoint with live rows.",
    path: null,
    diagnostic_schema_version: null,
    metric: null,
    period: null,
    baseline_dataset: null,
    candidate_dataset: null,
    dataset_labels: {},
    summary: {},
    total_targets: 0,
    returned: 0,
    limit: 0,
    offset: 0,
    has_next: false,
    targets: [],
    microplex_bundle: {
      artifact_id: null,
      artifact_dir: null,
      target_diagnostics_path: null,
      native_scores_path: null,
    },
  });
}
